/** Durable serial execution of a compiled contained graph.
 *
 * Authority is the immutable plan + grant plus a hash-chained, append-only
 * event history. No mutable snapshot is authoritative: every read replays
 * the history and every transition (not only every hash) is revalidated.
 * Allowance is reserved before an effect and a distinct dispatch marker is
 * durable before the driver runs. After dispatch the kernel only reconciles
 * retained observations; missing evidence is an explicit uncertain state and
 * never a second paid call or push. */
import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Redactor } from '@wringer/engine';
import { graphOutcomes, graphReservation, hashValue, validateContainedGraph, validateGraphAuthority, type ContainedGraphNode, type ContainedGraphPlan, type GraphAuthority } from '@wringer/plan';
import { locked, safePath } from '@wringer/workflow';
import type { GraphCandidate, GraphDecision, GraphDriver, GraphEffectRequest, GraphEvent, GraphEventKind, GraphInput, GraphNodeState, ContainedGraphOptions, GraphPreparation, GraphReservation, GraphResult, GraphRoute, GraphSend, GraphState } from './contained-types';
export * from './contained-types';

const EVENT_SCHEMA = 'wringer.contained-graph-event.v1';
const LOCK = 'contained-graph';
const MAX_EVENT_BYTES = 1024 * 1024, MAX_EVENTS = 4096, MAX_PLAN_BYTES = 8 * 1024 * 1024, MAX_AUTHORITY_BYTES = 64 * 1024;
const KINDS: GraphEventKind[] = ['start', 'reserve', 'dispatch', 'prepared', 'send', 'result', 'decision', 'route'];
const SUCCESS: Record<ContainedGraphNode['kind'], string> = { loop: 'ready', check: 'passed', 'human-hold': 'continued', delivery: 'delivered', router: 'routed' };
const HEX64 = /^[a-f0-9]{64}$/, OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function fail(message: string): never { throw new Error(message); }
function exact(value: unknown, label: string, fields: string[]): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
    const row = value as Record<string, any>, keys = Object.keys(row);
    if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) fail(`${label} has missing or unknown fields`);
    return row;
}
function bounded(value: unknown, label: string, maximum: number): string {
    if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail(`${label} must be bounded non-empty text`);
    if (new Redactor().scrub(value as string) !== value) fail(`${label} contains a detected credential`);
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
    cursor: string; startedAt: string; deadline: string;
    terminal: 'done' | 'fail' | null; reason: string | null;
}
interface History { directory: string; plan: ContainedGraphPlan; authority: GraphAuthority; events: GraphEvent[]; progress: Progress; }

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
    if (typeof row.outcome !== 'string' || !['loop', 'check', 'delivery'].includes(node.kind) || !graphOutcomes(node.kind).includes(row.outcome)) fail(`Outcome ${String(row.outcome)} is not defined for ${node.kind} ${id}`);
    const result: GraphResult = { kind: 'complete', outcome: row.outcome, candidate: row.candidate === null ? null : candidate(row.candidate, `${id} candidate`), evidenceSha256: evidence(row.evidenceSha256, id) };
    if (node.kind === 'loop') {
        if (result.outcome === 'ready' && !result.candidate) fail(`Loop ${id} reported ready without a candidate`);
        if (result.candidate && result.candidate.owner !== id) fail(`Candidate owner must be the producing loop ${id}`);
        if (result.candidate && result.candidate.source.url !== plan.repository.url) fail(`Candidate source is not the graph repository`);
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
    if (node.input === 'root') return { node: 'root', source: { url: plan.repository.url, commit: plan.repository.commit }, candidate: null, evidenceSha256: plan.sha256 };
    const prior = progress.nodes[node.input];
    if (!prior?.result) fail(`Input ${node.input} of ${id} has no recorded result`);
    const input: GraphInput = { node: node.input, source: prior.result.candidate?.source ?? prior.reservation.input.source, candidate: prior.result.candidate, evidenceSha256: prior.result.evidenceSha256 };
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
    const node = plan.nodes[from]! as Exclude<ContainedGraphNode, { kind: 'router' }>, via: string[] = [];
    let next: string;
    // A recorded required failure can never become success in an acyclic graph;
    // stop before any later hold, preparation or Send could act on it.
    if (plan.required.includes(from) && outcome !== SUCCESS[node.kind]) return { outcome, to: 'fail', via, reason: `Required node ${from} ended ${outcome}; a failed requirement cannot be routed onward` };
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
function apply(plan: ContainedGraphPlan, progress: Progress, event: GraphEvent, first: boolean) {
    const data = event.data;
    if (event.kind === 'start') {
        if (!first || event.node !== null) fail('Only the first graph event may start it');
        const row = exact(data, 'start', ['startedAt', 'deadline']);
        if (row.startedAt !== event.at || !Number.isFinite(Date.parse(row.startedAt))) fail('Graph start time is invalid');
        if (row.deadline !== new Date(Date.parse(row.startedAt) + plan.budget.wallClockSeconds * 1000).toISOString()) fail('Graph deadline differs from the root wall-clock allowance');
        Object.assign(progress, { startedAt: row.startedAt, deadline: row.deadline, cursor: plan.entry });
        return;
    }
    if (first) fail('Graph history must begin with start');
    if (progress.terminal) fail('The graph has already finished; no further event can be recorded');
    const id = event.node;
    if (id !== progress.cursor) fail('Graph event names a node other than the current graph position');
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
            if (!state || !['loop', 'check', 'delivery'].includes(node.kind)) fail(`${id} cannot dispatch`);
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
            progress.cursor = expected.to;
            if (expected.to === 'done' || expected.to === 'fail') { progress.terminal = expected.to; progress.reason = expected.reason; }
            return;
        }
    }
    fail('Unknown graph event kind');
}
function eventRecord(value: unknown, sequence: number, previous: string | null, plan: ContainedGraphPlan): GraphEvent {
    const row = exact(value, `Graph event ${sequence}`, ['schema_version', 'graphSha256', 'sequence', 'previousSha256', 'at', 'node', 'kind', 'data', 'sha256']);
    if (row.schema_version !== EVENT_SCHEMA) fail('Unsupported graph event version');
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

async function boundedFile(directory: string, name: string, maximum: number): Promise<string> {
    const path = await safePath(directory, name), stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) fail(`${name} must be a regular file`);
    if (stat.size > maximum) fail(`${name} exceeds its bound`);
    return readFile(path, 'utf8');
}
function parse(text: string, label: string): unknown { try { return JSON.parse(text); } catch { fail(`${label} is not valid JSON`); } }
async function syncDirectory(path: string) { const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
/** Complete bytes appear under their final name or not at all; never overwritten. */
async function durableCreate(directory: string, name: string, content: string) {
    const target = await safePath(directory, name), staging = await safePath(directory, '.wringer/graph-pending');
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const stat = await lstat(staging);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Graph staging must be a real directory');
    const temp = join(staging, `${randomUUID()}.tmp`), handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    try { await link(temp, target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail(`${name} already exists; graph records are never overwritten`); throw error; }
    finally { await unlink(temp).catch(() => undefined); }
    await syncDirectory(dirname(target));
}
const eventName = (sequence: number) => `events/${String(sequence).padStart(4, '0')}.json`;
function emptyProgress(): Progress { return { nodes: Object.create(null), reserved: { roleSessions: 0, verificationAttempts: 0 }, cursor: '', startedAt: '', deadline: '', terminal: null, reason: null }; }

async function load(directory: string): Promise<History> {
    const plan = validateContainedGraph(parse(await boundedFile(directory, 'plan.json', MAX_PLAN_BYTES), 'plan.json'));
    const eventsPath = await safePath(directory, 'events'), stat = await lstat(eventsPath);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('Graph events must be a real directory');
    const names = (await readdir(eventsPath)).sort();
    if (!names.length) fail('Graph history has no events');
    if (names.length > MAX_EVENTS) fail('Graph history exceeds its event bound');
    names.forEach((name, index) => { if (`events/${name}` !== eventName(index)) fail('Graph events are not one contiguous sequence'); });
    const events: GraphEvent[] = [], progress = emptyProgress();
    for (let sequence = 0; sequence < names.length; sequence++) {
        const file = `events/${names[sequence]}`;
        const event = eventRecord(parse(await boundedFile(directory, file, MAX_EVENT_BYTES), file), sequence, events.at(-1)?.sha256 ?? null, plan);
        apply(plan, progress, event, sequence === 0);
        events.push(event);
    }
    const authority = validateGraphAuthority(parse(await boundedFile(directory, 'authority.json', MAX_AUTHORITY_BYTES), 'authority.json'), plan, new Date(progress.startedAt));
    return { directory, plan, authority, events, progress };
}
/** Build and validate a transition on a copy. Nothing is written yet, so a
 * refused transition or a refused preflight leaves no trace. */
function prepare(history: History, kind: GraphEventKind, node: string | null, data: unknown, at: Date) {
    const previous = history.events.at(-1) ?? null;
    const body = { schema_version: EVENT_SCHEMA, graphSha256: history.plan.sha256, sequence: history.events.length, previousSha256: previous?.sha256 ?? null, at: at.toISOString(), node, kind, data: structuredClone(data) };
    const event = { ...body, sha256: hashValue(body) } as GraphEvent;
    if (history.events.length >= MAX_EVENTS || Buffer.byteLength(JSON.stringify(event)) > MAX_EVENT_BYTES) fail('Graph event exceeds its bound');
    const next = structuredClone(history.progress);
    apply(history.plan, next, event, history.events.length === 0);
    return { event, next };
}
async function commit(history: History, prepared: ReturnType<typeof prepare>, options: ContainedGraphOptions) {
    if (prepared.event.sequence !== history.events.length) fail('Graph history moved during this transition');
    await durableCreate(history.directory, eventName(prepared.event.sequence), JSON.stringify(prepared.event, null, 2) + '\n');
    history.events.push(prepared.event);
    history.progress = prepared.next;
    await options.checkpoint?.(prepared.event);
    return prepared.event;
}
const append = (history: History, kind: GraphEventKind, node: string | null, data: unknown, options: ContainedGraphOptions, at = clock(options)) => commit(history, prepare(history, kind, node, data, at), options);
const expired = (history: History, at: Date) => at.getTime() > Date.parse(history.progress.deadline) || at.getTime() >= Date.parse(history.authority.expiresAt);
function project(history: History, at: Date, hold: string | null = null): GraphState {
    const { progress, plan } = history;
    let phase: GraphState['phase'], reason: string | null = null;
    if (progress.terminal === 'done') phase = 'complete';
    else if (progress.terminal === 'fail') { phase = 'failed'; reason = progress.reason; }
    else {
        const node = plan.nodes[progress.cursor]!, state = progress.nodes[progress.cursor];
        if (!state) phase = 'pending';
        else if (node.kind === 'human-hold') { phase = state.decision ? 'pending' : 'human-hold'; reason = state.decision ? null : node.prompt; }
        else if (state.result) phase = 'pending';
        else if (node.kind === 'delivery' && state.prepared && !state.sent) { phase = 'send-hold'; reason = 'Delivery is prepared. Publication needs an explicit graph Send bound to this revision.'; }
        else if (state.dispatched) { phase = 'uncertain'; reason = state.sent ? 'Send was recorded without confirmed publication. Resume reconciles read-only and never sends again.' : 'Dispatch was recorded without a retained outcome. Resume reconciles by observation only and never dispatches again.'; }
        else phase = 'pending';
        if (hold !== null) { phase = 'human-hold'; reason = hold; }
        if (expired(history, at)) { reason = `The root wall clock or graph authority expired while ${phase}${reason ? `: ${reason}` : ''}. Inspection and read-only reconciliation remain available; no new work starts.`; phase = 'expired'; }
    }
    return { plan, authority: history.authority, events: history.events, revision: history.events.at(-1)!.sha256, cursor: progress.cursor, startedAt: progress.startedAt, deadline: progress.deadline, nodes: structuredClone(progress.nodes), reserved: { ...progress.reserved }, phase, reason };
}

export async function initializeContainedGraph(directory: string, planInput: ContainedGraphPlan, authorityInput: GraphAuthority, options: ContainedGraphOptions = {}): Promise<GraphState> {
    const at = clock(options), plan = validateContainedGraph(structuredClone(planInput)), authority = validateGraphAuthority(structuredClone(authorityInput), plan, at);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const root = await lstat(directory);
    if (root.isSymbolicLink() || !root.isDirectory()) fail('Graph state must be a real directory');
    return locked(directory, LOCK, async function initializeLocked() {
        const present = (await readdir(directory)).filter(name => name !== '.wringer');
        if (present.length) fail('This graph state directory is not empty. Inspect it with graph status or continue with graph resume; nothing was overwritten.');
        await durableCreate(directory, 'plan.json', JSON.stringify(plan, null, 2) + '\n');
        await durableCreate(directory, 'authority.json', JSON.stringify(authority, null, 2) + '\n');
        await mkdir(await safePath(directory, 'events'), { mode: 0o700 });
        const history: History = { directory, plan, authority, events: [], progress: emptyProgress() };
        const startedAt = at.toISOString();
        await append(history, 'start', null, { startedAt, deadline: new Date(at.getTime() + plan.budget.wallClockSeconds * 1000).toISOString() }, options, at);
        return project(history, at);
    });
}
/** Lock-free: replay the complete retained history. Expiry is a phase, never a read refusal. */
export async function readContainedGraph(directory: string, options: Pick<ContainedGraphOptions, 'now'> = {}): Promise<GraphState> {
    return project(await load(directory), clock(options));
}
export async function advanceContainedGraph(directory: string, driver: GraphDriver, options: ContainedGraphOptions = {}): Promise<GraphState> {
    options.signal?.throwIfAborted();
    return locked(directory, LOCK, async function advanceLocked() {
        const history = await load(directory);
        let hold: string | null = null;
        for (let step = 0; step < 4 * MAX_EVENTS; step++) {
            options.signal?.throwIfAborted();
            const progress = history.progress;
            if (progress.terminal) break;
            const at = clock(options), late = expired(history, at), id = progress.cursor, node = history.plan.nodes[id]!, state = progress.nodes[id];
            if (!state) { if (late) break; await append(history, 'reserve', id, { reservation: expectedReservation(history.plan, progress, id) }, options, at); continue; }
            if (state.result) { await append(history, 'route', id, resolveRoute(history.plan, progress, id, state.result.outcome), options, at); continue; }
            if (node.kind === 'human-hold') {
                if (!state.decision) break;
                await append(history, 'result', id, { kind: 'complete', outcome: state.decision.choice === 'continue' ? 'continued' : 'rejected', candidate: state.reservation.input.candidate, evidenceSha256: state.decisionSha256 }, options, at);
                continue;
            }
            if (node.kind === 'delivery' && state.prepared && !state.sent) break;
            const request: GraphEffectRequest = { directory, plan: history.plan, authority: history.authority, node: id, reservation: structuredClone(state.reservation), signal: options.signal };
            if (!state.dispatched) {
                if (late) break;
                const marker = prepare(history, 'dispatch', id, {}, at);
                // Effect-free prerequisites. A refusal leaves the node reserved, never uncertain.
                await driver.preflight?.(request, 'dispatch');
                await commit(history, marker, options);
                await driver.dispatch(request);
            }
            const observed = await driver.observe(request);
            if (observed === null) break;
            const observation = structuredClone(observed);
            if (observation.kind === 'held') {
                if (node.kind !== 'loop') fail(`Only a contained loop can report a child hold; ${id} is a ${node.kind}`);
                hold = bounded(observation.reason, 'Child hold reason', 16384);
                break;
            }
            if (node.kind === 'delivery' && !state.sent && observation.kind === 'prepared') {
                await append(history, 'prepared', id, observation, options);
                continue;
            }
            if (node.kind === 'delivery' && observation.kind === 'prepared') {
                if (!same(observation, state.prepared)) fail(`Delivery ${id} changed its prepared identity after Send`);
                break;
            }
            await append(history, 'result', id, observation, options);
        }
        return project(history, clock(options), hold);
    });
}
export async function decideContainedGraph(directory: string, decisionInput: GraphDecision, options: ContainedGraphOptions = {}): Promise<GraphState> {
    const decision = decisionRecord(structuredClone(decisionInput));
    return locked(directory, LOCK, async function decideLocked() {
        const history = await load(directory), at = clock(options);
        if (expired(history, at)) fail('The graph root wall clock or authority has expired; no decision was recorded');
        // Binding to node, revision and held input is enforced by the shared transition.
        await append(history, 'decision', decision.node, decision, options, at);
        const recorded = history.progress.nodes[decision.node]!;
        await append(history, 'result', decision.node, { kind: 'complete', outcome: decision.choice === 'continue' ? 'continued' : 'rejected', candidate: recorded.reservation.input.candidate, evidenceSha256: recorded.decisionSha256 }, options, at);
        await append(history, 'route', decision.node, resolveRoute(history.plan, history.progress, decision.node, history.progress.nodes[decision.node]!.result!.outcome), options, at);
        return project(history, clock(options));
    });
}
export async function sendContainedGraph(directory: string, sendInput: GraphSend, driver: GraphDriver, options: ContainedGraphOptions = {}): Promise<GraphState> {
    const send = sendRecord(structuredClone(sendInput));
    return locked(directory, LOCK, async function sendLocked() {
        const history = await load(directory), at = clock(options);
        if (expired(history, at)) fail('The graph root wall clock or authority has expired; nothing was sent');
        // Single Send, revision and prepared identity are enforced by the shared transition.
        const marker = prepare(history, 'send', send.node, send, at);
        const state = marker.next.nodes[send.node]!, prepared = structuredClone(state.prepared!);
        const request: GraphEffectRequest = { directory, plan: history.plan, authority: history.authority, node: send.node, reservation: structuredClone(state.reservation), signal: options.signal };
        await driver.preflight?.(request, 'send');
        await commit(history, marker, options);
        await driver.send(request, prepared);
        const observed = await driver.observe(request);
        if (observed !== null && observed.kind === 'complete') {
            await append(history, 'result', send.node, structuredClone(observed), options);
            await append(history, 'route', send.node, resolveRoute(history.plan, history.progress, send.node, history.progress.nodes[send.node]!.result!.outcome), options);
        }
        return project(history, clock(options));
    });
}
