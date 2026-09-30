/** The contained-graph kernel: every decision, over any durable journal.
 *
 * Authority is the immutable plan + grant plus a hash-chained, append-only
 * event history. No mutable snapshot is authoritative: every read replays
 * the history and every transition (not only every hash) is revalidated.
 * Allowance is reserved before an effect and a distinct dispatch marker is
 * durable before the driver runs. After dispatch the kernel only reconciles
 * retained observations; missing evidence is an explicit uncertain state and
 * never a second paid call or push.
 *
 * This module has no host imports: no file system, process, environment or
 * random source. Storage, mutual exclusion and admission of the plan and grant
 * belong to a GraphJournal; time comes from the injected clock. The local file
 * journal is in ./contained, and a deterministic workflow sandbox can bundle this
 * module unchanged. */
import { hashValue } from '@wringer/records/canonical';
import { Redactor } from '@wringer/engine/redactor';
import { closesFork, graphInput, graphOutcomes, graphRegions, graphReservation, type ContainedGraphNode, type ContainedGraphPlan, type GraphAuthority } from '@wringer/plan/graph-shape';
import type { GraphCandidate, GraphDecision, GraphDriver, GraphEffectRequest, GraphEvent, GraphEventKind, GraphInput, GraphNodeState, ContainedGraphOptions, GraphPreparation, GraphReservation, GraphResult, GraphRoute, GraphSend, GraphState } from './contained-types';
export type * from './contained-types';

/** Durable storage for one graph. The kernel revalidates everything it reads. */
export interface GraphJournal {
    /** Passed unchanged to the driver: where effects keep their own evidence. */
    readonly directory: string;
    /** The stored plan, grant and every retained event in order, as stored. */
    read(): Promise<{ plan: unknown; authority: unknown; events: unknown[] }>;
    /** Prepare storage before the first write. */
    open(): Promise<void>;
    /** Admit a validated plan and grant into empty storage; refuse storage that is not empty. */
    create(plan: ContainedGraphPlan, authority: GraphAuthority): Promise<void>;
    /** Store the event at its sequence exactly once; never overwrite. */
    append(event: GraphEvent): Promise<void>;
    /** Serialise every writer of this graph. */
    exclusive<T>(name: string, action: () => Promise<T>): Promise<T>;
    /** The plan's and grant's contracts; the grant is judged at the graph's start. To
     * `admit` is to accept them for a new history, refusing credentials the writing
     * host holds. To `replay` is to read a retained history, which must read the same
     * on every host. */
    validatePlan(value: unknown, purpose: 'admit' | 'replay'): ContainedGraphPlan;
    validateAuthority(value: unknown, plan: ContainedGraphPlan, at: Date, purpose: 'admit' | 'replay'): GraphAuthority;
}

// Each graph version writes its own event version; older graphs keep theirs.
const eventSchema = (plan: ContainedGraphPlan) => plan.schema_version === 'wringer.contained-graph-plan.v4' ? 'wringer.contained-graph-event.v4' : plan.schema_version === 'wringer.contained-graph-plan.v3' ? 'wringer.contained-graph-event.v3' : plan.schema_version === 'wringer.contained-graph-plan.v2' ? 'wringer.contained-graph-event.v2' : 'wringer.contained-graph-event.v1';
const LOCK = 'contained-graph';
const SHAPES = new Redactor([], {}, [], true);
const byteLength = (text: string) => new TextEncoder().encode(text).length;
/** structuredClone for the JSON records the kernel handles, where no structuredClone exists. */
function clone<T>(value: T, depth = 0): T {
    if (depth > 64) fail('Graph data nesting exceeds its bound');
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(item => clone(item, depth + 1)) as T;
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = clone(item, depth + 1);
    return copy as T;
}
const EFFECT_KINDS = ['loop', 'check', 'delivery', 'join', 'tournament', 'delegate'];
const MAX_EVENT_BYTES = 1024 * 1024, MAX_EVENTS = 4096, MAX_PLAN_BYTES = 8 * 1024 * 1024, MAX_AUTHORITY_BYTES = 64 * 1024;
const KINDS: GraphEventKind[] = ['start', 'reserve', 'dispatch', 'prepared', 'send', 'result', 'decision', 'route'];
const SUCCESS: Record<ContainedGraphNode['kind'], string> = { loop: 'ready', check: 'passed', 'human-hold': 'continued', delivery: 'delivered', router: 'routed', fork: 'forked', join: 'integrated', tournament: 'selected', delegate: 'returned' };
const HEX64 = /^[a-f0-9]{64}$/, OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function fail(message: string): never { throw new Error(message); }
function exact(value: unknown, label: string, fields: string[]): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
    const row = value as Record<string, any>, keys = Object.keys(row);
    if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) fail(`${label} has missing or unknown fields`);
    return row;
}
function bounded(value: unknown, label: string, maximum: number): string {
    if (typeof value !== 'string' || !value.trim() || byteLength(value) > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail(`${label} must be bounded non-empty text`);
    // Shapes only: a retained record must read the same on every host. Credentials the
    // writing host holds are refused by the write-time screen, never on replay.
    if (SHAPES.scrub(value as string) !== value) fail(`${label} contains a detected credential`);
    return value as string;
}
const same = (left: unknown, right: unknown) => hashValue(left ?? null) === hashValue(right ?? null);
function clock(options: ContainedGraphOptions): Date {
    const at = options.now?.() ?? new Date();
    if (!(at instanceof Date) || !Number.isFinite(at.getTime())) fail('Graph clock is invalid');
    return at;
}

/** Replay state. `events` is kept beside it so a transition can be tried on a copy. */
interface Progress {
    nodes: Record<string, GraphNodeState>;
    reserved: { roleSessions: number; verificationAttempts: number };
    /** Every node that may record its next event; a serial graph has one. */
    active: string[];
    /** Branch nodes that routed into each join, one per branch. */
    arrivals: Record<string, { branch: string; node: string }[]>;
    cancelled: string[]; startedAt: string; deadline: string;
    terminal: 'done' | 'fail' | null; reason: string | null;
}
interface History { journal: GraphJournal; plan: ContainedGraphPlan; authority: GraphAuthority; events: GraphEvent[]; progress: Progress; }
/** Which branch of which fork each private branch node belongs to. */
function branchIndex(plan: ContainedGraphPlan) {
    const index = new Map<string, { fork: string; branch: string }>();
    for (const [fork, branches] of Object.entries(graphRegions(plan))) for (const [branch, nodes] of Object.entries(branches)) for (const node of nodes) index.set(node, { fork, branch });
    return index;
}

function candidate(value: unknown, label: string): GraphCandidate {
    const row = exact(value, label, ['source', 'tree', 'owner']), source = exact(row.source, `${label} source`, ['url', 'commit']);
    bounded(source.url, `${label} source URL`, 4096);
    if (typeof source.commit !== 'string' || !OBJECT_ID.test(source.commit)) fail(`${label} commit must be a full object id`);
    if (typeof row.tree !== 'string' || !OBJECT_ID.test(row.tree)) fail(`${label} tree must be a full object id`);
    if (typeof row.owner !== 'string' || !/^[a-z][a-z0-9-]*$/.test(row.owner)) fail(`${label} owner is invalid`);
    return { source: { url: source.url, commit: source.commit }, tree: row.tree, owner: row.owner };
}
function evidence(value: unknown, label: string): string {
    if (typeof value !== 'string' || !HEX64.test(value)) fail(`${label} evidence digest must be sha256`);
    return value;
}
/** Observations are caller-owned driver output: validate a copy, never trust shape or prose. */
function validateResult(plan: ContainedGraphPlan, id: string, state: GraphNodeState, value: unknown): GraphResult {
    const node = plan.nodes[id]!, row = exact(value, `${id} result`, ['kind', 'outcome', 'candidate', 'evidenceSha256']);
    if (row.kind !== 'complete') fail(`${id} result must be a completed observation`);
    if (typeof row.outcome !== 'string' || !EFFECT_KINDS.includes(node.kind) || !graphOutcomes(node.kind).includes(row.outcome)) fail(`Outcome ${String(row.outcome)} is not defined for ${node.kind} ${id}`);
    const result: GraphResult = { kind: 'complete', outcome: row.outcome, candidate: row.candidate === null ? null : candidate(row.candidate, `${id} candidate`), evidenceSha256: evidence(row.evidenceSha256, id) };
    if (node.kind === 'loop') {
        if (result.outcome === 'ready' && !result.candidate) fail(`Loop ${id} reported ready without a candidate`);
        if (result.candidate && result.candidate.owner !== id) fail(`Candidate owner must be the producing loop ${id}`);
        if (result.candidate && result.candidate.source.url !== plan.repository.url) fail(`Candidate source is not the graph repository`);
    } else if (node.kind === 'join') {
        // Only the join owns an integration; a conflict has no merged candidate.
        if (result.outcome === 'conflict' && result.candidate) fail(`Join ${id} reported a conflict with a candidate`);
        if (result.outcome !== 'conflict' && !result.candidate) fail(`Join ${id} reported ${result.outcome} without its integrated candidate`);
        if (result.candidate && result.candidate.owner !== id) fail(`Candidate owner must be the integrating join ${id}`);
        if (result.candidate && result.candidate.source.url !== plan.repository.url) fail(`Candidate source is not the graph repository`);
    } else if (node.kind === 'delegate') {
        // Only a returned patch is a candidate, owned by the delegation, of this graph's source.
        if (result.outcome !== 'returned' && result.candidate) fail(`Delegate ${id} reported ${result.outcome} with a candidate`);
        if (result.outcome === 'returned' && (!result.candidate || result.candidate.owner !== id)) fail(`Delegate ${id} must own the candidate it returns`);
        if (result.candidate && result.candidate.source.url !== plan.repository.url) fail(`Candidate source is not the graph repository`);
    } else if (node.kind === 'tournament') {
        // Only a surviving branch candidate can be selected, and only as the tournament's own.
        if (result.outcome !== 'selected' && result.candidate) fail(`Tournament ${id} reported ${result.outcome} with a candidate`);
        if (result.outcome === 'selected') {
            if (!result.candidate || result.candidate.owner !== id) fail(`Tournament ${id} must own the candidate it selects`);
            const chosen = result.candidate;
            if (!(state.reservation.input.branches ?? []).some(row => row.candidate && row.candidate.source.commit === chosen.source.commit && row.candidate.tree === chosen.tree && row.candidate.source.url === chosen.source.url)) fail(`Tournament ${id} selected a candidate that no branch delivered`);
        }
    } else if (node.kind === 'check') {
        if (!same(result.candidate, state.reservation.input.candidate)) fail(`A check cannot replace its input candidate`);
    } else if (node.kind === 'delivery') {
        if (!state.sent) fail(`Delivery ${id} cannot report delivered before its explicit Send`);
        if (!same(result.candidate, state.reservation.input.candidate)) fail(`Delivery ${id} completed a candidate other than its input`);
    }
    return result;
}
function validatePreparation(id: string, state: GraphNodeState, value: unknown): GraphPreparation {
    const row = exact(value, `${id} preparation`, ['kind', 'candidate', 'evidenceSha256']);
    if (row.kind !== 'prepared') fail(`${id} preparation has the wrong kind`);
    const prepared: GraphPreparation = { kind: 'prepared', candidate: candidate(row.candidate, `${id} prepared candidate`), evidenceSha256: evidence(row.evidenceSha256, id) };
    if (!same(prepared.candidate, state.reservation.input.candidate)) fail(`Delivery ${id} prepared a candidate other than its input`);
    return prepared;
}
function expectedInput(plan: ContainedGraphPlan, progress: Progress, id: string): GraphInput {
    const node = plan.nodes[id]!;
    if (node.kind === 'tournament') {
        // Every branch arrives, disqualified or not, in declared branch order.
        const fork = plan.nodes[node.fork] as Extract<ContainedGraphNode, { kind: 'fork' }>, forked = progress.nodes[node.fork];
        if (!forked?.result) fail(`Fork ${node.fork} of ${id} has no recorded result`);
        const branches = fork.branches.map(branch => {
            const arrival = (progress.arrivals[id] ?? []).find(row => row.branch === branch);
            const result = arrival ? progress.nodes[arrival.node]?.result : undefined;
            if (!arrival || !result) fail(`Tournament ${id} has no arrival from branch ${branch}`);
            return { branch, node: arrival.node, outcome: result.outcome, candidate: result.candidate, evidenceSha256: result.evidenceSha256 };
        });
        return { node: node.fork, source: forked.result.candidate?.source ?? forked.reservation.input.source, candidate: null, evidenceSha256: hashValue(branches), branches };
    }
    if (node.kind === 'join') {
        // The exact candidate each branch delivered, in declared branch order.
        const fork = plan.nodes[node.fork] as Extract<ContainedGraphNode, { kind: 'fork' }>, forked = progress.nodes[node.fork];
        if (!forked?.result) fail(`Fork ${node.fork} of ${id} has no recorded result`);
        const branches = fork.branches.map(branch => {
            const arrival = (progress.arrivals[id] ?? []).find(row => row.branch === branch);
            const result = arrival ? progress.nodes[arrival.node]?.result : undefined;
            if (!arrival || !result?.candidate) fail(`Join ${id} has no candidate from branch ${branch}`);
            return { branch, node: arrival.node, candidate: result.candidate, evidenceSha256: result.evidenceSha256 };
        });
        return { node: node.fork, source: forked.result.candidate?.source ?? forked.reservation.input.source, candidate: null, evidenceSha256: hashValue(branches), branches };
    }
    const read = graphInput(node)!;
    if (read === 'root') return { node: 'root', source: { url: plan.repository.url, commit: plan.repository.commit }, candidate: null, evidenceSha256: plan.sha256 };
    const prior = progress.nodes[read];
    if (!prior?.result) fail(`Input ${read} of ${id} has no recorded result`);
    const input: GraphInput = { node: read, source: prior.result.candidate?.source ?? prior.reservation.input.source, candidate: prior.result.candidate, evidenceSha256: prior.result.evidenceSha256 };
    if (['check', 'delivery'].includes(node.kind) && !input.candidate) fail(`${node.kind} ${id} has no candidate to act on`);
    return input;
}
function expectedReservation(plan: ContainedGraphPlan, progress: Progress, id: string): GraphReservation {
    return { ...graphReservation(plan, id), deadline: progress.deadline, input: expectedInput(plan, progress, id) };
}
/** A node's `then` is followed only on its success outcome. Any other outcome
 * fails unless `then` names a router over this node's outcomes. Completion
 * requires every required node to have succeeded, whatever the route. */
function resolveRoute(plan: ContainedGraphPlan, progress: Progress, from: string, outcome: string): GraphRoute {
    const forked = plan.nodes[from]!;
    if (forked.kind === 'fork') return { outcome, to: forked.join, via: [], reason: null, branches: [...forked.branches] };
    const node = forked as Exclude<ContainedGraphNode, { kind: 'router' | 'fork' }>, via: string[] = [];
    let next: string;
    // A recorded required failure can never become success in an acyclic graph;
    // stop before any later hold, preparation or Send could act on it.
    if (plan.required.includes(from) && outcome !== SUCCESS[node.kind]) return { outcome, to: 'fail', via, reason: `Required node ${from} ended ${outcome}; a failed requirement cannot be routed onward` };
    // A tournament candidate that stops or fails still arrives, to be disqualified there.
    if (outcome !== SUCCESS[node.kind] && plan.nodes[node.then]?.kind === 'tournament') return { outcome, to: node.then, via, reason: null };
    if (outcome === SUCCESS[node.kind]) next = node.then;
    else {
        const target = plan.nodes[node.then];
        if (target?.kind !== 'router' || target.input !== from) return { outcome, to: 'fail', via, reason: `${from} ended ${outcome}` };
        next = node.then;
    }
    while (plan.nodes[next]?.kind === 'router') {
        if (via.length >= 64) fail('Router chain exceeds the graph bound');
        const router = plan.nodes[next] as Extract<ContainedGraphNode, { kind: 'router' }>;
        via.push(next);
        const selected = router.input === from ? outcome : plan.nodes[router.input]?.kind === 'router' ? 'routed' : progress.nodes[router.input]?.result?.outcome;
        if (selected === undefined) fail(`Router ${next} input has no recorded outcome`);
        next = router.routes.find(route => route.outcome === selected)?.to ?? router.otherwise;
    }
    // Defence in depth: the compiler makes every done path visit every required
    // node and the rule above fails a required failure at once.
    if (next === 'done') {
        const missing = plan.required.find(required => { const row = progress.nodes[required]; return !row?.result || row.result.outcome !== SUCCESS[plan.nodes[required]!.kind]; });
        if (missing) return { outcome, to: 'fail', via, reason: `Required node ${missing} did not succeed; routing cannot complete the graph` };
    }
    if (next === 'fail') return { outcome, to: 'fail', via, reason: `${from} ${outcome} routed to fail` };
    return { outcome, to: next, via, reason: null };
}
function decisionRecord(value: unknown): GraphDecision {
    const row = exact(value, 'Graph decision', ['node', 'expectedRevision', 'inputSha256', 'choice', 'actor', 'note']);
    if (typeof row.node !== 'string' || !/^[a-z][a-z0-9-]*$/.test(row.node)) fail('Decision names an invalid node');
    if (typeof row.expectedRevision !== 'string' || !HEX64.test(row.expectedRevision)) fail('Decision needs the exact current graph revision');
    if (typeof row.inputSha256 !== 'string' || !HEX64.test(row.inputSha256)) fail('Decision needs the exact held input digest');
    if (!['continue', 'reject'].includes(row.choice)) fail('Decision choice must be continue or reject');
    return { node: row.node, expectedRevision: row.expectedRevision, inputSha256: row.inputSha256, choice: row.choice, actor: bounded(row.actor, 'Decision actor', 200), note: bounded(row.note, 'Decision note', 16384) };
}
function sendRecord(value: unknown): GraphSend {
    const row = exact(value, 'Graph Send', ['node', 'expectedRevision', 'preparedSha256', 'actor', 'note']);
    if (typeof row.node !== 'string' || !/^[a-z][a-z0-9-]*$/.test(row.node)) fail('Send names an invalid node');
    if (typeof row.expectedRevision !== 'string' || !HEX64.test(row.expectedRevision)) fail('Send needs the exact current graph revision');
    if (typeof row.preparedSha256 !== 'string' || !HEX64.test(row.preparedSha256)) fail('Send needs the exact prepared delivery digest');
    return { node: row.node, expectedRevision: row.expectedRevision, preparedSha256: row.preparedSha256, actor: bounded(row.actor, 'Send actor', 200), note: bounded(row.note, 'Send note', 16384) };
}

/** The single transition function. Replay and append both use it, so the
 * kernel cannot write an event its own reader would refuse. */
function apply(plan: ContainedGraphPlan, progress: Progress, event: GraphEvent, first: boolean, branches = branchIndex(plan)) {
    const data = event.data;
    if (event.kind === 'start') {
        if (!first || event.node !== null) fail('Only the first graph event may start it');
        const row = exact(data, 'start', ['startedAt', 'deadline']);
        if (row.startedAt !== event.at || !Number.isFinite(Date.parse(row.startedAt))) fail('Graph start time is invalid');
        if (row.deadline !== new Date(Date.parse(row.startedAt) + plan.budget.wallClockSeconds * 1000).toISOString()) fail('Graph deadline differs from the root wall-clock allowance');
        Object.assign(progress, { startedAt: row.startedAt, deadline: row.deadline, active: [plan.entry] });
        return;
    }
    if (first) fail('Graph history must begin with start');
    if (progress.terminal) fail('The graph has already finished; no further event can be recorded');
    const id = event.node ?? fail('Graph event needs a node');
    if (!progress.active.includes(id)) fail('Graph event names a node that is not an active graph position');
    const node = plan.nodes[id]!;
    if (!node || node.kind === 'router') fail('Graph event names a node that cannot record state');
    const state = progress.nodes[id];
    switch (event.kind) {
        case 'reserve': {
            if (state) fail(`${id} is already reserved`);
            const expected = expectedReservation(plan, progress, id);
            if (!same(exact(data, 'reserve', ['reservation']).reservation, expected)) fail(`Reservation for ${id} differs from the graph allowance and its input`);
            const next = { roleSessions: progress.reserved.roleSessions + expected.roleSessions, verificationAttempts: progress.reserved.verificationAttempts + expected.verificationAttempts };
            if (next.roleSessions > plan.budget.maxRoleSessions || next.verificationAttempts > plan.budget.maxVerificationAttempts) fail('Graph allowance cannot reserve this node');
            progress.reserved = next;
            progress.nodes[id] = { reservation: expected, dispatched: false, sent: false };
            return;
        }
        case 'dispatch': {
            if (!state || !EFFECT_KINDS.includes(node.kind)) fail(`${id} cannot dispatch`);
            if (state.dispatched) fail(`${id} was already dispatched; dispatch is never repeated`);
            exact(data, 'dispatch', []);
            state.dispatched = true;
            return;
        }
        case 'prepared': {
            if (!state || node.kind !== 'delivery' || !state.dispatched || state.prepared) fail(`${id} cannot record a preparation`);
            state.prepared = validatePreparation(id, state, data);
            return;
        }
        case 'send': {
            if (!state || node.kind !== 'delivery' || !state.prepared) fail(`${id} has no prepared delivery to Send`);
            if (state.sent) fail(`Send was already recorded for ${id}; it is never reissued`);
            const send = sendRecord(data);
            if (send.node !== id) fail('Send names a node other than the prepared delivery');
            if (send.expectedRevision !== event.previousSha256) fail('Send is not bound to the current graph revision; reload before sending');
            if (send.preparedSha256 !== hashValue(state.prepared)) fail('Send is bound to another prepared delivery');
            state.sent = true; state.send = send;
            return;
        }
        case 'decision': {
            if (node.kind !== 'human-hold') fail(`${id} is not a graph human hold waiting for a decision`);
            if (!state || state.decision) fail(`${id} is not waiting for a decision`);
            const decision = decisionRecord(data);
            if (decision.node !== id) fail('Decision names a node other than the current hold');
            if (decision.expectedRevision !== event.previousSha256) fail('Decision is not bound to the current graph revision; reload before deciding');
            if (decision.inputSha256 !== hashValue(state.reservation.input)) fail('Decision is bound to another held input');
            state.decision = decision; state.decisionSha256 = event.sha256;
            return;
        }
        case 'result': {
            if (!state || state.result) fail(`${id} cannot record another result`);
            if (node.kind === 'human-hold') {
                if (!state.decision) fail(`${id} has no recorded decision`);
                const expected: GraphResult = { kind: 'complete', outcome: state.decision.choice === 'continue' ? 'continued' : 'rejected', candidate: state.reservation.input.candidate, evidenceSha256: state.decisionSha256! };
                if (!same(data, expected)) fail(`${id} result differs from its recorded decision`);
                state.result = expected;
            } else if (node.kind === 'fork') {
                const expected: GraphResult = { kind: 'complete', outcome: 'forked', candidate: state.reservation.input.candidate, evidenceSha256: state.reservation.input.evidenceSha256 };
                if (!same(data, expected)) fail(`Fork ${id} result must pass its exact input to every branch`);
                state.result = expected;
            } else {
                if (!state.dispatched) fail(`${id} recorded a result without a dispatch`);
                state.result = validateResult(plan, id, state, data);
            }
            return;
        }
        case 'route': {
            if (!state?.result || state.route) fail(`${id} cannot route`);
            const expected = resolveRoute(plan, progress, id, state.result.outcome);
            if (!same(data, expected)) fail(`Route from ${id} differs from its recorded outcome`);
            state.route = expected;
            progress.active = progress.active.filter(name => name !== id);
            if (expected.to === 'done' || expected.to === 'fail') {
                // A failure anywhere ends the graph; other open branches are cancelled, never resumed.
                progress.terminal = expected.to; progress.reason = expected.reason;
                progress.cancelled = [...progress.active]; progress.active = [];
            } else if (node.kind === 'fork') progress.active.push(...(expected.branches ?? []));
            else if (closesFork(plan.nodes[expected.to])) {
                const joined = plan.nodes[expected.to] as Extract<ContainedGraphNode, { kind: 'join' | 'tournament' }>, fork = plan.nodes[joined.fork] as Extract<ContainedGraphNode, { kind: 'fork' }>, where = branches.get(id);
                if (!where || where.fork !== joined.fork) fail(`${id} cannot arrive at join ${expected.to} from outside its branches`);
                const arrivals = progress.arrivals[expected.to] ??= [];
                if (arrivals.some(row => row.branch === where.branch)) fail(`Branch ${where.branch} already arrived at join ${expected.to}`);
                arrivals.push({ branch: where.branch, node: id });
                if (arrivals.length === fork.branches.length) progress.active.push(expected.to);
            } else progress.active.push(expected.to);
            progress.active.sort();
            return;
        }
    }
    fail('Unknown graph event kind');
}
function eventRecord(value: unknown, sequence: number, previous: string | null, plan: ContainedGraphPlan): GraphEvent {
    const row = exact(value, `Graph event ${sequence}`, ['schema_version', 'graphSha256', 'sequence', 'previousSha256', 'at', 'node', 'kind', 'data', 'sha256']);
    if (row.schema_version !== eventSchema(plan)) fail('Unsupported graph event version');
    if (row.graphSha256 !== plan.sha256) fail('Graph event belongs to another graph');
    if (row.sequence !== sequence) fail('Graph event sequence differs from its position');
    if (row.previousSha256 !== previous) fail('Graph event chain is broken');
    if (typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at))) fail('Graph event time is invalid');
    if (row.node !== null && (typeof row.node !== 'string' || !/^[a-z][a-z0-9-]*$/.test(row.node))) fail('Graph event node is invalid');
    if (!KINDS.includes(row.kind)) fail('Unknown graph event kind');
    if (!row.data || typeof row.data !== 'object' || Array.isArray(row.data)) fail('Graph event data must be an object');
    const { sha256, ...body } = row;
    if (sha256 !== hashValue(body)) fail('Graph event digest changed');
    return row as GraphEvent;
}


function emptyProgress(): Progress { return { nodes: Object.create(null), reserved: { roleSessions: 0, verificationAttempts: 0 }, active: [], arrivals: Object.create(null), cancelled: [], startedAt: '', deadline: '', terminal: null, reason: null }; }

async function load(journal: GraphJournal): Promise<History> {
    const stored = await journal.read(), plan = journal.validatePlan(stored.plan, 'replay');
    if (!stored.events.length) fail('Graph history has no events');
    if (stored.events.length > MAX_EVENTS) fail('Graph history exceeds its event bound');
    const events: GraphEvent[] = [], progress = emptyProgress(), branches = branchIndex(plan);
    for (let sequence = 0; sequence < stored.events.length; sequence++) {
        const event = eventRecord(stored.events[sequence], sequence, events.at(-1)?.sha256 ?? null, plan);
        apply(plan, progress, event, sequence === 0, branches);
        events.push(event);
    }
    const authority = journal.validateAuthority(stored.authority, plan, new Date(progress.startedAt), 'replay');
    return { journal, plan, authority, events, progress };
}
/** Build and validate a transition on a copy. Nothing is written yet, so a
 * refused transition or a refused preflight leaves no trace. */
function prepare(history: History, kind: GraphEventKind, node: string | null, data: unknown, at: Date) {
    const previous = history.events.at(-1) ?? null;
    const body = { schema_version: eventSchema(history.plan), graphSha256: history.plan.sha256, sequence: history.events.length, previousSha256: previous?.sha256 ?? null, at: at.toISOString(), node, kind, data: clone(data) };
    const event = { ...body, sha256: hashValue(body) } as GraphEvent;
    if (history.events.length >= MAX_EVENTS || byteLength(JSON.stringify(event)) > MAX_EVENT_BYTES) fail('Graph event exceeds its bound');
    const next = clone(history.progress);
    apply(history.plan, next, event, history.events.length === 0);
    return { event, next };
}
async function commit(history: History, prepared: ReturnType<typeof prepare>, options: ContainedGraphOptions) {
    if (prepared.event.sequence !== history.events.length) fail('Graph history moved during this transition');
    await history.journal.append(prepared.event);
    history.events.push(prepared.event);
    history.progress = prepared.next;
    await options.checkpoint?.(prepared.event);
    return prepared.event;
}
const append = (history: History, kind: GraphEventKind, node: string | null, data: unknown, options: ContainedGraphOptions, at = clock(options)) => commit(history, prepare(history, kind, node, data, at), options);
const expired = (history: History, at: Date) => at.getTime() > Date.parse(history.progress.deadline) || at.getTime() >= Date.parse(history.authority.expiresAt);
/** Classify every active node. Uncertain effects need attention first, then
 * holds, then Send; anything else is work a resume can still do. */
function project(history: History, at: Date, childHolds: Map<string, string> = new Map()): GraphState {
    const { progress, plan } = history;
    let phase: GraphState['phase'], reason: string | null = null;
    const holds: GraphState['holds'] = [];
    if (progress.terminal === 'done') phase = 'complete';
    else if (progress.terminal === 'fail') { phase = 'failed'; reason = progress.reason; }
    else {
        const rows = progress.active.map(id => {
            const node = plan.nodes[id]!, state = progress.nodes[id];
            if (childHolds.has(id)) return { id, kind: 'child' as const, reason: childHolds.get(id)! };
            if (!state || state.result || node.kind === 'fork') return { id, kind: 'pending' as const, reason: null };
            if (node.kind === 'human-hold') return state.decision ? { id, kind: 'pending' as const, reason: null } : { id, kind: 'human' as const, reason: node.prompt };
            if (node.kind === 'delivery' && state.prepared && !state.sent) return { id, kind: 'send' as const, reason: 'Delivery is prepared. Publication needs an explicit graph Send bound to this revision.' };
            if (state.dispatched) return { id, kind: 'uncertain' as const, reason: state.sent ? 'Send was recorded without confirmed publication. Resume reconciles read-only and never sends again.' : 'Dispatch was recorded without a retained outcome. Resume reconciles by observation only and never dispatches again.' };
            return { id, kind: 'pending' as const, reason: null };
        });
        for (const row of rows) if (row.kind === 'human' || row.kind === 'child' || row.kind === 'send') holds.push({ node: row.id, kind: row.kind, reason: row.reason! });
        const first = (kind: string) => rows.find(row => row.kind === kind);
        const chosen = first('uncertain') ?? first('human') ?? first('child') ?? first('send') ?? first('pending');
        phase = !chosen || chosen.kind === 'pending' ? 'pending' : chosen.kind === 'uncertain' ? 'uncertain' : chosen.kind === 'send' ? 'send-hold' : 'human-hold';
        reason = chosen?.reason ?? null;
        if (expired(history, at)) { reason = `The root wall clock or graph authority expired while ${phase}${reason ? `: ${reason}` : ''}. Inspection and read-only reconciliation remain available; no new work starts.`; phase = 'expired'; }
    }
    return { plan, authority: history.authority, events: history.events, revision: history.events.at(-1)!.sha256, cursor: progress.active[0] ?? progress.terminal ?? '', active: [...progress.active], holds, cancelled: [...progress.cancelled], startedAt: progress.startedAt, deadline: progress.deadline, nodes: clone(progress.nodes), reserved: { ...progress.reserved }, phase, reason };
}

export async function initializeJournaledGraph(journal: GraphJournal, planInput: ContainedGraphPlan, authorityInput: GraphAuthority, options: ContainedGraphOptions = {}): Promise<GraphState> {
    const at = clock(options), plan = journal.validatePlan(clone(planInput), 'admit'), authority = journal.validateAuthority(clone(authorityInput), plan, at, 'admit');
    await journal.open();
    return journal.exclusive(LOCK, async function initializeLocked() {
        await journal.create(plan, authority);
        const history: History = { journal, plan, authority, events: [], progress: emptyProgress() };
        const startedAt = at.toISOString();
        await append(history, 'start', null, { startedAt, deadline: new Date(at.getTime() + plan.budget.wallClockSeconds * 1000).toISOString() }, options, at);
        return project(history, at);
    });
}
/** Lock-free: replay the complete retained history. Expiry is a phase, never a read refusal. */
export async function readJournaledGraph(journal: GraphJournal, options: Pick<ContainedGraphOptions, 'now'> = {}): Promise<GraphState> {
    return project(await load(journal), clock(options));
}
export async function advanceJournaledGraph(journal: GraphJournal, driver: GraphDriver, options: ContainedGraphOptions = {}): Promise<GraphState> {
    options.signal?.throwIfAborted();
    return journal.exclusive(LOCK, async function advanceLocked() {
        const history = await load(journal), parallelism = history.plan.parallelism ?? 1, holds = new Map<string, string>();
        const request = (id: string): GraphEffectRequest => ({ directory: journal.directory, plan: history.plan, authority: history.authority, node: id, reservation: clone(history.progress.nodes[id]!.reservation), signal: options.signal });
        for (let step = 0; step < 4 * MAX_EVENTS; step++) {
            options.signal?.throwIfAborted();
            if (history.progress.terminal) break;
            const at = clock(options), late = expired(history, at);
            // Transitions without an effect, for every active node in a fixed order.
            let moved = false;
            for (const id of [...history.progress.active]) {
                if (history.progress.terminal) break;
                if (!history.progress.active.includes(id)) continue;
                const node = history.plan.nodes[id]!, state = history.progress.nodes[id];
                if (!state) { if (late) continue; await append(history, 'reserve', id, { reservation: expectedReservation(history.plan, history.progress, id) }, options, at); moved = true; continue; }
                if (state.result) { await append(history, 'route', id, resolveRoute(history.plan, history.progress, id, state.result.outcome), options, at); moved = true; continue; }
                if (node.kind === 'human-hold' && state.decision) { await append(history, 'result', id, { kind: 'complete', outcome: state.decision.choice === 'continue' ? 'continued' : 'rejected', candidate: state.reservation.input.candidate, evidenceSha256: state.decisionSha256 }, options, at); moved = true; continue; }
                if (node.kind === 'fork') { await append(history, 'result', id, { kind: 'complete', outcome: 'forked', candidate: state.reservation.input.candidate, evidenceSha256: state.reservation.input.evidenceSha256 }, options, at); moved = true; }
            }
            if (history.progress.terminal) break;
            if (moved) continue;
            const effects = history.progress.active.filter(id => EFFECT_KINDS.includes(history.plan.nodes[id]!.kind) && history.progress.nodes[id] && !history.progress.nodes[id]!.result);
            const ready = late ? [] : effects.filter(id => !history.progress.nodes[id]!.dispatched).slice(0, parallelism);
            let failure: unknown = null;
            if (ready.length) {
                // Every preflight is effect-free and runs before any marker, so one
                // refusal leaves every ready node reserved and resumable.
                for (const id of ready) await driver.preflight?.(request(id), 'dispatch');
                for (const id of ready) await append(history, 'dispatch', id, {}, options, at);
                const settled = await Promise.allSettled(ready.map(id => driver.dispatch(request(id))));
                failure = settled.find((row): row is PromiseRejectedResult => row.status === 'rejected')?.reason ?? null;
            }
            // Reconcile every dispatched effect from retained evidence only, in the same order.
            let observed = false;
            for (const id of effects) {
                const node = history.plan.nodes[id]!, state = history.progress.nodes[id]!;
                if (!state.dispatched || state.result || node.kind === 'delivery' && state.prepared && !state.sent) continue;
                const found = await driver.observe(request(id));
                if (found === null) continue;
                const observation = clone(found);
                if (observation.kind === 'held') {
                    if (node.kind !== 'loop') fail(`Only a contained loop can report a child hold; ${id} is a ${node.kind}`);
                    const reason = bounded(observation.reason, 'Child hold reason', 16384);
                    options.screen?.(reason, 'Child hold reason');
                    holds.set(id, reason);
                    continue;
                }
                if (node.kind === 'delivery' && !state.sent && observation.kind === 'prepared') { await append(history, 'prepared', id, observation, options); observed = true; continue; }
                if (node.kind === 'delivery' && observation.kind === 'prepared') {
                    if (!same(observation, state.prepared)) fail(`Delivery ${id} changed its prepared identity after Send`);
                    continue;
                }
                await append(history, 'result', id, observation, options); observed = true;
            }
            if (failure) throw failure;
            if (!observed) break;
        }
        return project(history, clock(options), holds);
    });
}
export async function decideJournaledGraph(journal: GraphJournal, decisionInput: GraphDecision, options: ContainedGraphOptions = {}): Promise<GraphState> {
    const decision = decisionRecord(clone(decisionInput));
    options.screen?.(decision.actor, 'Decision actor'); options.screen?.(decision.note, 'Decision note');
    return journal.exclusive(LOCK, async function decideLocked() {
        const history = await load(journal), at = clock(options);
        if (expired(history, at)) fail('The graph root wall clock or authority has expired; no decision was recorded');
        // Binding to node, revision and held input is enforced by the shared transition.
        await append(history, 'decision', decision.node, decision, options, at);
        const recorded = history.progress.nodes[decision.node]!;
        await append(history, 'result', decision.node, { kind: 'complete', outcome: decision.choice === 'continue' ? 'continued' : 'rejected', candidate: recorded.reservation.input.candidate, evidenceSha256: recorded.decisionSha256 }, options, at);
        await append(history, 'route', decision.node, resolveRoute(history.plan, history.progress, decision.node, history.progress.nodes[decision.node]!.result!.outcome), options, at);
        return project(history, clock(options));
    });
}
export async function sendJournaledGraph(journal: GraphJournal, sendInput: GraphSend, driver: GraphDriver, options: ContainedGraphOptions = {}): Promise<GraphState> {
    const send = sendRecord(clone(sendInput));
    options.screen?.(send.actor, 'Send actor'); options.screen?.(send.note, 'Send note');
    return journal.exclusive(LOCK, async function sendLocked() {
        const history = await load(journal), at = clock(options);
        if (expired(history, at)) fail('The graph root wall clock or authority has expired; nothing was sent');
        // Single Send, revision and prepared identity are enforced by the shared transition.
        const marker = prepare(history, 'send', send.node, send, at);
        const state = marker.next.nodes[send.node]!, prepared = clone(state.prepared!);
        const request: GraphEffectRequest = { directory: journal.directory, plan: history.plan, authority: history.authority, node: send.node, reservation: clone(state.reservation), signal: options.signal };
        await driver.preflight?.(request, 'send');
        await commit(history, marker, options);
        await driver.send(request, prepared);
        const observed = await driver.observe(request);
        if (observed !== null && observed.kind === 'complete') {
            await append(history, 'result', send.node, clone(observed), options);
            await append(history, 'route', send.node, resolveRoute(history.plan, history.progress, send.node, history.progress.nodes[send.node]!.result!.outcome), options);
        }
        return project(history, clock(options));
    });
}

/** Shape checks of a human decision or a Send, for a caller that validates before submitting. */
export const graphDecisionRecord = (value: unknown) => decisionRecord(clone(value));
export const graphSendRecord = (value: unknown) => sendRecord(clone(value));
