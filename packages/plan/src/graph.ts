import { isAbsolute } from 'node:path';
import { Redactor } from '@wringer/engine';
import { canonicalJson, hashValue } from './canonical';
import { validateExecutionPlan } from './compile';
import type { ExecutionPlan, RepositoryRef } from './types';

export interface GraphBudget { maxRoleSessions: number; maxVerificationAttempts: number; wallClockSeconds: number; }
export interface GraphPublication { remote: string; sourceBranch: string; targetBranch: string; }
/** A gate whose files are pinned by content in the plan, never read from a candidate. */
export interface GraphGate { id: string; argv: string[]; cwd: string; timeout_seconds: number; files: { path: string; content: string }[]; }
export interface GraphProsecutor { plan: ExecutionPlan; maxChallenges: number; }
/** The one file a prosecutor may write: a JSON array of executable challenges. */
export const PROSECUTOR_ARTIFACT = 'wringer/challenges.json';
export type ContainedGraphNode =
    | { kind: 'loop'; input: string; plan: ExecutionPlan; then: string }
    | { kind: 'check'; input: string; then: string }
    | { kind: 'human-hold'; input: string; prompt: string; then: string }
    | { kind: 'delivery'; input: string; publication: GraphPublication; then: string }
    | { kind: 'router'; input: string; routes: { outcome: string; to: string }[]; otherwise: string }
    | { kind: 'fork'; input: string; branches: string[]; join: string }
    | { kind: 'join'; fork: string; then: string }
    /** Version 3: closes a fork by selecting one surviving candidate, or none. */
    | { kind: 'tournament'; fork: string; prosecutor: GraphProsecutor; controls: { id: string; commit: string }[]; evaluator: GraphGate[]; tie: 'no-winner' | 'tree-order'; then: string };
export interface ContainedGraphPlan {
    schema_version: 'wringer.contained-graph-plan.v1' | 'wringer.contained-graph-plan.v2' | 'wringer.contained-graph-plan.v3'; id: string; repository: RepositoryRef; entry: string;
    required: string[]; budget: GraphBudget; nodes: Record<string, ContainedGraphNode>;
    /** Versions 2 and 3: the most branches whose effects may run at once. */
    parallelism?: number; sha256: string;
}
export interface GraphAuthority {
    schema_version: 'wringer.contained-graph-authority.v1'; graphSha256: string; repository: RepositoryRef;
    actor: string; grantedAt: string; expiresAt: string; budget: GraphBudget; maySend: false; sha256: string;
}
const KINDS = ['loop', 'check', 'router', 'human-hold', 'delivery'], PARALLEL_KINDS = ['fork', 'join'], TOURNAMENT_KINDS = ['tournament'];
/** A node that closes a fork: it waits for every branch and reads their results. */
export const closesFork = (node: ContainedGraphNode | undefined): node is Extract<ContainedGraphNode, { kind: 'join' | 'tournament' }> => node?.kind === 'join' || node?.kind === 'tournament';
const SINKS = ['done', 'fail'];
function fail(message: string): never { throw new Error(message); }
function object(value: unknown, label: string, fields: string[]): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
    const row = value as Record<string, any>;
    if (Object.keys(row).some(key => !fields.includes(key))) fail(`${label} has an unknown field`);
    for (const key of fields) if (!Object.hasOwn(row, key)) fail(`${label} is missing ${key}`);
    return row;
}
function text(value: unknown, label: string, maximum = 16384): string {
    if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail(`${label} must be bounded text`);
    return value as string;
}
function id(value: unknown, label: string) { const name = text(value, label, 80); if (!/^[a-z][a-z0-9-]*$/.test(name)) fail(`Invalid ${label}`); return name; }
function integer(value: unknown, label: string, minimum = 0): number { if (!Number.isSafeInteger(value) || Number(value) < minimum) fail(`Invalid finite ${label}`); return value as number; }
function unique(values: string[], label: string) { if (new Set(values).size !== values.length) fail(`${label} contains a duplicate`); return values; }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export function graphEdges(node: ContainedGraphNode): string[] { return node.kind === 'router' ? [...node.routes.map(row => row.to), node.otherwise] : node.kind === 'fork' ? [...node.branches] : [node.then]; }
/** The node whose result a node reads; a join or tournament reads its branches instead. */
export function graphInput(node: ContainedGraphNode): string | null { return closesFork(node) ? null : node.input; }
export function graphOutcomes(kind: ContainedGraphNode['kind']): string[] {
    // A child's human hold is a hold the graph reports, never a branch outcome.
    return ({ loop: ['ready', 'stopped'], check: ['passed', 'failed', 'unavailable'], 'human-hold': ['continued', 'rejected'], delivery: ['delivered'], router: ['routed'], fork: ['forked'], join: ['integrated', 'failed', 'conflict', 'unavailable'], tournament: ['selected', 'no-winner', 'unavailable'] })[kind];
}
/** The nearest loop, join or tournament owns the exact candidate and its contained evidence. */
export function graphCandidateOwner(plan: Pick<ContainedGraphPlan, 'nodes'>, nodeId: string): string | null {
    const seen = new Set<string>(); let cursor = nodeId;
    while (cursor !== 'root') {
        if (seen.has(cursor)) fail('Candidate reference cycle'); seen.add(cursor);
        const node = plan.nodes[cursor]; if (!node) fail('Unknown candidate reference');
        if (node.kind === 'loop' || closesFork(node)) return cursor;
        if (node.kind === 'router') return null;
        cursor = node.input;
    }
    return null;
}
/** True when a node's input chain reaches the root source through forks only. */
function rootLike(nodes: Record<string, ContainedGraphNode>, name: string): boolean {
    for (let cursor = name, step = 0; step < 128; step++) { if (cursor === 'root') return true; const node = nodes[cursor]; if (node?.kind !== 'fork') return false; cursor = node.input; }
    return false;
}
export function graphReservation(plan: Pick<ContainedGraphPlan, 'nodes'>, nodeId: string) {
    const node = plan.nodes[nodeId]; if (!node) fail('Unknown reservation node');
    // A loop's existing verifier-attempt ceiling is max_sessions. Reserve one
    // additional environment-discovery execution. Operator-driven displays are
    // separate explicit actions; this is the graph's automated allowance. A join
    // reserves one fresh verification of the integrated candidate per branch plan.
    if (node.kind === 'join') { const fork = plan.nodes[node.fork]; return { roleSessions: 0, verificationAttempts: fork?.kind === 'fork' ? fork.branches.length : 0 }; }
    // A tournament reserves its one prosecutor session, one validation run per
    // trusted control, and one challenge run and one final evaluation per candidate.
    if (node.kind === 'tournament') { const fork = plan.nodes[node.fork], candidates = fork?.kind === 'fork' ? fork.branches.length : 0; return { roleSessions: 1, verificationAttempts: node.controls.length + 2 * candidates }; }
    return { roleSessions: node.kind === 'loop' ? node.plan.budget.max_sessions : 0,
        verificationAttempts: node.kind === 'loop' ? node.plan.budget.max_sessions + 1 : node.kind === 'check' ? 1 : 0 };
}
/** Each fork's branches: the private nodes between a branch entry and the join. */
export function graphRegions(plan: Pick<ContainedGraphPlan, 'nodes'>): Record<string, Record<string, string[]>> {
    const regions: Record<string, Record<string, string[]>> = {};
    for (const [name, node] of Object.entries(plan.nodes)) {
        if (node.kind !== 'fork') continue;
        regions[name] = {};
        for (const entry of node.branches) {
            const region = new Set<string>(), stack = [entry];
            while (stack.length) {
                const next = stack.pop()!;
                if (next === node.join || SINKS.includes(next) || region.has(next) || !plan.nodes[next]) continue;
                region.add(next); stack.push(...graphEdges(plan.nodes[next]!));
            }
            regions[name]![entry] = [...region].sort();
        }
    }
    return regions;
}
function publication(input: unknown): GraphPublication {
    const value = object(input, 'publication', ['remote', 'sourceBranch', 'targetBranch']);
    const remote = text(value.remote, 'publication remote', 4096), sourceBranch = text(value.sourceBranch, 'publication branch', 200), targetBranch = text(value.targetBranch, 'publication branch', 200);
    for (const branch of [sourceBranch, targetBranch]) if (/^[/-]|[\s~^:?*\[\\\x00-\x1f\x7f]|\.\.|@\{/.test(branch) || branch.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock')) || branch.endsWith('.')) fail('Unsafe publication branch');
    if (sourceBranch === targetBranch || ['main', 'master'].includes(sourceBranch)) fail('Publication requires a distinct nondefault branch');
    if (!isAbsolute(remote)) {
        let url: URL; try { url = new URL(remote); } catch { fail('Invalid publication URL'); }
        if (!['https:', 'ssh:'].includes(url!.protocol) || url!.password || url!.search || url!.hash || url!.protocol === 'https:' && url!.username) fail('Publication must use a credential-free HTTPS/SSH URL or explicit local bare origin');
    }
    return { remote, sourceBranch, targetBranch };
}
function relative(value: unknown, label: string) {
    const path = text(value, label, 512);
    if (isAbsolute(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')) fail(`${label} must be a safe relative path`);
    return path;
}
/** A gate pinned by content: bounded argv, a safe working directory and inline files. */
export function graphGate(input: unknown, label: string): GraphGate {
    const row = object(input, label, ['id', 'argv', 'cwd', 'timeout_seconds', 'files']);
    if (!Array.isArray(row.argv) || !row.argv.length || row.argv.length > 64) fail(`${label} needs a bounded argv`);
    if (!Array.isArray(row.files) || row.files.length > 32) fail(`${label} pins at most 32 files`);
    const files = row.files.map((file: unknown, index: number) => {
        const entry = object(file, `${label} file ${index}`, ['path', 'content']);
        if (typeof entry.content !== 'string' || Buffer.byteLength(entry.content) > 256 * 1024) fail(`${label} file content must be text of at most 256 KiB`);
        return { path: relative(entry.path, `${label} file path`), content: entry.content as string };
    });
    unique(files.map((file: { path: string }) => file.path), `${label} files`);
    const seconds = integer(row.timeout_seconds, `${label} timeout`, 1); if (seconds > 3600) fail(`${label} timeout must be at most 3600 seconds`);
    return { id: id(row.id, `${label} id`), argv: row.argv.map((arg: unknown) => text(arg, `${label} argument`, 4096)), cwd: row.cwd === '.' ? '.' : relative(row.cwd, `${label} cwd`), timeout_seconds: seconds, files };
}
function tournament(row: Record<string, any>, name: string, repository: RepositoryRef): Extract<ContainedGraphNode, { kind: 'tournament' }> {
    const prosecutor = object(row.prosecutor, `tournament ${name} prosecutor`, ['plan', 'maxChallenges']);
    const plan = validateExecutionPlan(prosecutor.plan);
    if (!['wringer.execution-plan.v3', 'wringer.execution-plan.v4'].includes(plan.schema_version)) fail('A prosecutor needs a measured v3/v4 plan');
    if (hashValue(plan.repository) !== hashValue(repository)) fail('All graph templates must pin the same root source');
    if (plan.scope.writable.length !== 1 || plan.scope.writable[0] !== PROSECUTOR_ARTIFACT) fail(`A prosecutor may write only ${PROSECUTOR_ARTIFACT}; it never edits a candidate`);
    const maxChallenges = integer(prosecutor.maxChallenges, 'challenge limit'); if (maxChallenges > 16) fail('A prosecutor proposes at most 16 challenges');
    if (!Array.isArray(row.controls) || row.controls.length > 4) fail('A tournament names at most 4 trusted controls');
    const controls = row.controls.map((control: unknown, index: number) => {
        const entry = object(control, `control ${index}`, ['id', 'commit']);
        if (typeof entry.commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(entry.commit)) fail('A trusted control is an exact commit');
        return { id: id(entry.id, 'control id'), commit: entry.commit as string };
    });
    unique(controls.map((control: { id: string }) => control.id), 'Tournament controls');
    if (!Array.isArray(row.evaluator) || !row.evaluator.length || row.evaluator.length > 8) fail('A tournament keeps 1–8 final evaluator gates');
    const evaluator = row.evaluator.map((gate: unknown, index: number) => graphGate(gate, `evaluator gate ${index}`));
    unique(evaluator.map((gate: GraphGate) => gate.id), 'Evaluator gates');
    const pinned = new Map<string, string>();
    for (const file of evaluator.flatMap((gate: GraphGate) => gate.files)) { if (pinned.has(file.path) && pinned.get(file.path) !== file.content) fail(`Evaluator pins ${file.path} with two different contents`); pinned.set(file.path, file.content); }
    if (!['no-winner', 'tree-order'].includes(row.tie)) fail('A tournament tie is no-winner or tree-order');
    return { kind: 'tournament', fork: id(row.fork, 'fork'), prosecutor: { plan, maxChallenges }, controls, evaluator, tie: row.tie, then: id(row.then, 'edge') };
}
/** Compile data only. Repository TypeScript and command strings are not evaluated. */
export function compileContainedGraph(input: unknown): ContainedGraphPlan {
    const version = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>).version : undefined;
    if (version !== 1 && version !== 2 && version !== 3) fail('Contained graph declaration version must be 1, 2 or 3');
    const value = object(input, 'graph', ['version', 'id', 'repository', 'entry', 'required', 'budget', 'nodes', ...(version !== 1 ? ['parallelism'] : [])]);
    const graphId = id(value.id, 'graph id'), entry = id(value.entry, 'entry');
    const parallelism = version !== 1 ? integer(value.parallelism, 'parallelism', 1) : undefined;
    if (parallelism !== undefined && parallelism > 8) fail('Graph parallelism must allow 1–8 concurrent branches');
    const source = object(value.repository, 'source', ['url', 'commit']);
    const repository = { url: text(source.url, 'source URL', 4096), commit: text(source.commit, 'source commit', 64) };
    const limits = object(value.budget, 'graph budget', ['maxRoleSessions', 'maxVerificationAttempts', 'wallClockSeconds']);
    const budget = { maxRoleSessions: integer(limits.maxRoleSessions, 'role allowance'), maxVerificationAttempts: integer(limits.maxVerificationAttempts, 'verification allowance'), wallClockSeconds: integer(limits.wallClockSeconds, 'wall allowance', 1) };
    if (!value.nodes || typeof value.nodes !== 'object' || Array.isArray(value.nodes) || !Object.keys(value.nodes).length || Object.keys(value.nodes).length > 64) fail('A contained graph needs 1–64 nodes');
    const nodes: Record<string, ContainedGraphNode> = Object.create(null);
    const fields: Record<string, string[]> = { loop: ['kind', 'input', 'plan', 'then'], check: ['kind', 'input', 'then'], 'human-hold': ['kind', 'input', 'prompt', 'then'], delivery: ['kind', 'input', 'publication', 'then'], router: ['kind', 'input', 'routes', 'otherwise'], fork: ['kind', 'input', 'branches', 'join'], join: ['kind', 'fork', 'then'], tournament: ['kind', 'fork', 'prosecutor', 'controls', 'evaluator', 'tie', 'then'] };
    for (const [name, raw] of Object.entries(value.nodes)) {
        id(name, 'node id'); if ([...SINKS, 'root'].includes(name)) fail('Reserved node id');
        const kind = (raw as any)?.kind;
        if (PARALLEL_KINDS.includes(kind) && version === 1) fail('Fork and join nodes need a version 2 graph');
        if (TOURNAMENT_KINDS.includes(kind) && version !== 3) fail('Tournament nodes need a version 3 graph');
        if (!KINDS.includes(kind) && !PARALLEL_KINDS.includes(kind) && !TOURNAMENT_KINDS.includes(kind)) fail('Unsupported graph node kind');
        const row = object(raw, `node ${name}`, fields[kind]!);
        if (kind === 'join') { nodes[name] = { kind, fork: id(row.fork, 'fork'), then: id(row.then, 'edge') }; continue; }
        if (kind === 'tournament') { nodes[name] = tournament(row, name, repository); continue; }
        const input = id(row.input, 'input');
        if (kind === 'loop') {
            const plan = validateExecutionPlan(row.plan);
            if (!['wringer.execution-plan.v3', 'wringer.execution-plan.v4'].includes(plan.schema_version)) fail('A contained graph leaf needs a measured v3/v4 plan');
            if (hashValue(plan.repository) !== hashValue(repository)) fail('All graph templates must pin the same root source');
            nodes[name] = { kind, input, plan, then: id(row.then, 'edge') };
        } else if (kind === 'check') nodes[name] = { kind, input, then: id(row.then, 'edge') };
        else if (kind === 'human-hold') nodes[name] = { kind, input, prompt: text(row.prompt, 'human prompt'), then: id(row.then, 'edge') };
        else if (kind === 'delivery') nodes[name] = { kind, input, publication: publication(row.publication), then: id(row.then, 'edge') };
        else if (kind === 'fork') {
            if (!Array.isArray(row.branches) || row.branches.length < 2 || row.branches.length > 8) fail('A fork needs 2–8 branches');
            nodes[name] = { kind, input, branches: unique(row.branches.map((branch: unknown) => id(branch, 'branch')), 'Fork branches'), join: id(row.join, 'join') };
        } else {
            if (!Array.isArray(row.routes) || !row.routes.length || row.routes.length > 8) fail('Router needs bounded outcome routes');
            const routes = row.routes.map((input: unknown) => { const route = object(input, 'route', ['outcome', 'to']); return { outcome: id(route.outcome, 'outcome'), to: id(route.to, 'edge') }; });
            unique(routes.map((r: any) => r.outcome), 'Router outcomes'); nodes[name] = { kind: 'router', input, routes, otherwise: id(row.otherwise, 'edge') };
        }
    }
    if (!Object.values(nodes).some(node => node.kind === 'loop')) fail('A serial contained graph needs a source-pinned loop');
    // A fork and the join or tournament that closes it name each other; every branch entry reads its fork.
    for (const [name, node] of Object.entries(nodes)) {
        if (node.kind === 'fork') {
            const join = nodes[node.join];
            if (!closesFork(join) || join.fork !== name) fail(`Fork ${name} must name its own join`);
            for (const branch of node.branches) if (!nodes[branch] || graphInput(nodes[branch]!) !== name) fail(`Branch ${branch} must take its input from fork ${name}`);
        } else if (closesFork(node)) {
            const fork = nodes[node.fork];
            if (fork?.kind !== 'fork' || fork.join !== name) fail(`${node.kind === 'join' ? 'Join' : 'Tournament'} ${name} must name the fork that names it`);
        }
    }
    const incoming = new Map(Object.keys(nodes).map(name => [name, [] as string[]]));
    for (const [name, node] of Object.entries(nodes)) for (const next of graphEdges(node)) { if (!nodes[next] && !SINKS.includes(next)) fail(`Unknown graph edge ${name} → ${next}`); incoming.get(next)?.push(name); }
    if (!nodes[entry] || incoming.get(entry)!.length) fail('Graph entry must be an existing untargeted node');
    const seen = new Set<string>(), active = new Set<string>(), order: string[] = [];
    function visit(name: string) { if (SINKS.includes(name)) return; if (active.has(name)) fail('Graph cycle; iteration belongs inside a bounded loop'); if (seen.has(name)) return; active.add(name); for (const next of graphEdges(nodes[name]!)) visit(next); active.delete(name); seen.add(name); order.unshift(name); }
    visit(entry); if (seen.size !== Object.keys(nodes).length) fail('Graph has an unreachable node');
    // Branches are private regions that end only at their join or fail.
    const branchOf = new Map<string, { fork: string; entry: string }>();
    for (const [forkName, node] of Object.entries(nodes)) {
        if (node.kind !== 'fork') continue;
        for (const branch of node.branches) {
            const stack = [branch], region = new Set<string>(); let reachesJoin = false;
            while (stack.length) {
                const next = stack.pop()!;
                if (next === node.join) { reachesJoin = true; continue; }
                if (next === 'done') fail(`Branch ${branch} must reach join ${node.join} before the graph finishes`);
                if (next === 'fail' || region.has(next)) continue;
                const inner = nodes[next]!;
                if (inner.kind === 'fork') fail(`Fork ${next} is nested inside branch ${branch}; nested forks are not supported`);
                if (inner.kind === 'delivery') fail(`A delivery cannot run inside branch ${branch}; deliver after the join`);
                if (closesFork(inner)) fail(`Branch ${branch} reaches another fork's join`);
                if (branchOf.has(next)) fail(`Branches must not share node ${next}`);
                region.add(next); branchOf.set(next, { fork: forkName, entry: branch }); stack.push(...graphEdges(inner));
            }
            if (!reachesJoin) fail(`Branch ${branch} never reaches its join`);
        }
    }
    for (const [name, where] of branchOf) {
        for (const parent of incoming.get(name)!) if (!(branchOf.get(parent)?.entry === where.entry || parent === where.fork && name === where.entry)) fail(`Branch node ${name} is reachable from outside its branch`);
        const read = graphInput(nodes[name]!)!;
        if (!(read === where.fork || branchOf.get(read)?.entry === where.entry)) fail(`Branch node ${name} reads outside its branch`);
    }
    for (const [name, node] of Object.entries(nodes)) {
        if (branchOf.has(name)) continue;
        const read = graphInput(node);
        if (read && branchOf.has(read)) fail(`Only the join can read branch results; ${name} reads ${read}`);
        if (!closesFork(node)) continue;
        for (const parent of incoming.get(name)!) {
            // A router is resolved inline: the node that arrives is the router's input.
            const arriving = nodes[parent]?.kind === 'router' ? (nodes[parent] as Extract<ContainedGraphNode, { kind: 'router' }>).input : parent;
            const where = branchOf.get(parent), owner = graphCandidateOwner({ nodes }, arriving);
            if (!where || where.fork !== node.fork) fail(`Join ${name} is reached from outside its branches`);
            if (!owner || branchOf.get(owner)?.entry !== where.entry) fail(`Each branch must produce its own candidate before join ${name}`);
        }
    }
    const dominators = new Map<string, Set<string>>();
    for (const name of order) {
        const node = nodes[name]!;
        let available: Set<string>;
        if (closesFork(node)) {
            // Wait-all: the join is reached only after every branch, so each
            // branch's own dominators hold, together with the fork's.
            const fork = nodes[node.fork] as Extract<ContainedGraphNode, { kind: 'fork' }>;
            available = new Set([node.fork, ...dominators.get(node.fork)!]);
            for (const branch of fork.branches) {
                const paths = incoming.get(name)!.filter(parent => branchOf.get(parent)?.entry === branch).map(parent => new Set([parent, ...dominators.get(parent)!]));
                for (const parent of paths.length ? [...paths[0]!].filter(candidate => paths.every(path => path.has(candidate))) : []) available.add(parent);
            }
        } else {
            const paths = incoming.get(name)!.map(parent => new Set([parent, ...dominators.get(parent)!]));
            available = paths.length ? new Set([...paths[0]!].filter(parent => paths.every(path => path.has(parent)))) : new Set<string>();
        }
        dominators.set(name, available);
        const read = graphInput(node);
        if (read === null) continue;
        if (node.kind === 'router' && read === 'root') fail('Root source has no branch outcome');
        if (read !== 'root' && !available.has(read)) fail(`Node ${name} input is not available on every path`);
        if (['check', 'delivery'].includes(node.kind) && !graphCandidateOwner({ nodes }, read)) fail(`Node ${name} needs a contained candidate`);
        if (node.kind === 'check' && nodes[graphCandidateOwner({ nodes }, read)!]?.kind === 'join') fail(`Check ${name} repeats its join: the join already verified the integrated candidate against every branch plan`);
        if (node.kind === 'check' && nodes[graphCandidateOwner({ nodes }, read)!]?.kind === 'tournament') fail(`Check ${name} cannot follow a tournament: the winner already passed its own checks and every validated challenge, and the final evaluator assesses it`);
        if (node.kind === 'human-hold' && !rootLike(nodes, read) && !graphCandidateOwner({ nodes }, read)) fail(`Node ${name} needs a contained candidate to hold`);
        if (node.kind === 'loop' && !rootLike(nodes, read) && !graphCandidateOwner({ nodes }, read)) fail(`Node ${name} needs a candidate source`);
        if (node.kind === 'fork' && !rootLike(nodes, read) && !graphCandidateOwner({ nodes }, read)) fail(`Fork ${name} needs the root or a candidate to branch from`);
        if (node.kind === 'router' && nodes[read]?.kind === 'fork') fail('A router cannot branch on a fork; route on a branch or join outcome');
        if (node.kind === 'router') for (const route of node.routes) if (!graphOutcomes(nodes[read]!.kind).includes(route.outcome)) fail('Router outcome is not defined by its input type');
    }
    if (!Array.isArray(value.required) || !value.required.length) fail('Name required successful graph nodes');
    const required = unique(value.required.map((name: unknown) => id(name, 'required node')), 'Required nodes').sort();
    for (const name of required) if (!nodes[name] || ['router', 'fork'].includes(nodes[name]!.kind)) fail('Required nodes must name consequential effects or human holds');
    // A candidate that stops or fails is a tournament outcome, never a graph failure.
    for (const name of required) {
        const where = branchOf.get(name), fork = where ? nodes[where.fork] : undefined;
        if (fork?.kind === 'fork' && nodes[fork.join]?.kind === 'tournament') fail(`Tournament branch node ${name} cannot be required: a disqualified candidate is an outcome, not a graph failure`);
    }
    const finishes = Object.entries(nodes).filter(([, node]) => graphEdges(node).includes('done'));
    if (!finishes.length || finishes.some(([name]) => required.some(needed => needed !== name && !dominators.get(name)!.has(needed)))) fail('A done path bypasses a required node');
    const within = (path: string, prefix: string) => prefix === '.' || path === prefix || path.startsWith(prefix + '/');
    const leaves = Object.values(nodes).filter((node): node is Extract<ContainedGraphNode, { kind: 'loop' }> => node.kind === 'loop');
    const acceptanceInputs = [...new Set(leaves.flatMap(node => [...node.plan.acceptance.protected_paths, ...node.plan.acceptance.checks.flatMap(check => check.files)]))];
    for (const { plan } of leaves) for (const path of acceptanceInputs) {
        const protectedPaths = [...plan.acceptance.protected_paths, ...plan.acceptance.checks.flatMap(check => check.files)];
        if (plan.scope.writable.some(writable => within(path, writable) || within(writable, path)) && !protectedPaths.some(protectedPath => within(path, protectedPath))) fail('A loop can write another leaf acceptance input; protect the complete graph acceptance set');
    }
    const reservations = Object.keys(nodes).map(name => graphReservation({ nodes }, name));
    if (reservations.reduce((sum, row) => sum + row.roleSessions, 0) > budget.maxRoleSessions) fail('Graph role allowance cannot reserve every declared loop');
    if (reservations.reduce((sum, row) => sum + row.verificationAttempts, 0) > budget.maxVerificationAttempts) fail('Graph verification allowance cannot reserve every declared leaf');
    const body = version === 3
        ? { schema_version: 'wringer.contained-graph-plan.v3' as const, id: graphId, repository, entry, required, budget, parallelism: parallelism!, nodes }
        : version === 2
        ? { schema_version: 'wringer.contained-graph-plan.v2' as const, id: graphId, repository, entry, required, budget, parallelism: parallelism!, nodes }
        : { schema_version: 'wringer.contained-graph-plan.v1' as const, id: graphId, repository, entry, required, budget, nodes };
    const wire = canonicalJson(body); if (Buffer.byteLength(wire) > 2 * 1024 * 1024) fail('Graph exceeds its bounded 2 MiB contract');
    if (new Redactor().scrub(wire) !== wire) fail('Graph contains a detected credential');
    return freeze({ ...body, sha256: hashValue(body) });
}
export function validateContainedGraph(input: unknown): ContainedGraphPlan {
    const schema = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>).schema_version : undefined;
    const version = ({ 'wringer.contained-graph-plan.v1': 1, 'wringer.contained-graph-plan.v2': 2, 'wringer.contained-graph-plan.v3': 3 } as Record<string, number>)[String(schema)] ?? fail('Unsupported contained graph schema version');
    const value = object(input, 'compiled graph', ['schema_version', 'id', 'repository', 'entry', 'required', 'budget', 'nodes', ...(version !== 1 ? ['parallelism'] : []), 'sha256']);
    const { sha256, schema_version, ...declaration } = value;
    if (sha256 !== hashValue({ schema_version, ...declaration })) fail('Compiled graph digest changed');
    return compileContainedGraph({ version, ...declaration });
}
export function createGraphAuthority(planInput: ContainedGraphPlan, options: { actor: string; expiresAt: string; at?: Date }): GraphAuthority {
    const plan = validateContainedGraph(planInput), at = options.at ?? new Date();
    const body = { schema_version: 'wringer.contained-graph-authority.v1' as const, graphSha256: plan.sha256, repository: plan.repository, actor: text(options.actor, 'actor', 200), grantedAt: at.toISOString(), expiresAt: options.expiresAt, budget: plan.budget, maySend: false as const };
    return validateGraphAuthority({ ...body, sha256: hashValue(body) }, plan, at);
}
export function validateGraphAuthority(input: unknown, planInput: ContainedGraphPlan, at = new Date()): GraphAuthority {
    const plan = validateContainedGraph(planInput), value = object(input, 'graph authority', ['schema_version', 'graphSha256', 'repository', 'actor', 'grantedAt', 'expiresAt', 'budget', 'maySend', 'sha256']);
    if (value.schema_version !== 'wringer.contained-graph-authority.v1') fail('Unsupported graph authority version');
    if (value.graphSha256 !== plan.sha256 || hashValue(value.repository) !== hashValue(plan.repository) || hashValue(value.budget) !== hashValue(plan.budget)) fail('Graph authority is bound to another contract or allowance');
    if (value.maySend !== false) fail('Graph execution authority cannot grant Send');
    text(value.actor, 'actor', 200);
    if (!Number.isFinite(at.getTime()) || !Number.isFinite(Date.parse(value.grantedAt)) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.grantedAt) > at.getTime() || Date.parse(value.expiresAt) <= at.getTime()) fail('Graph authority is expired or not yet valid');
    const { sha256, ...body } = value;
    if (sha256 !== hashValue(body)) fail('Graph authority digest changed');
    const wire = canonicalJson(value); if (new Redactor().scrub(wire) !== wire) fail('Graph authority contains a detected credential');
    return freeze(value as GraphAuthority);
}
