import { isAbsolute } from 'node:path';
import { Redactor } from '@wringer/engine';
import { canonicalJson, hashValue } from './canonical';
import { validateExecutionPlan } from './compile';
import type { ExecutionPlan, RepositoryRef } from './types';

export interface GraphBudget { maxRoleSessions: number; maxVerificationAttempts: number; wallClockSeconds: number; }
export interface GraphPublication { remote: string; sourceBranch: string; targetBranch: string; }
export type ContainedGraphNode =
    | { kind: 'loop'; input: string; plan: ExecutionPlan; then: string }
    | { kind: 'check'; input: string; then: string }
    | { kind: 'human-hold'; input: string; prompt: string; then: string }
    | { kind: 'delivery'; input: string; publication: GraphPublication; then: string }
    | { kind: 'router'; input: string; routes: { outcome: string; to: string }[]; otherwise: string };
export interface ContainedGraphPlan {
    schema_version: 'wringer.contained-graph-plan.v1'; id: string; repository: RepositoryRef; entry: string;
    required: string[]; budget: GraphBudget; nodes: Record<string, ContainedGraphNode>; sha256: string;
}
export interface GraphAuthority {
    schema_version: 'wringer.contained-graph-authority.v1'; graphSha256: string; repository: RepositoryRef;
    actor: string; grantedAt: string; expiresAt: string; budget: GraphBudget; maySend: false; sha256: string;
}
const KINDS = ['loop', 'check', 'router', 'human-hold', 'delivery'];
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
export function graphEdges(node: ContainedGraphNode): string[] { return node.kind === 'router' ? [...node.routes.map(row => row.to), node.otherwise] : [node.then]; }
export function graphOutcomes(kind: ContainedGraphNode['kind']): string[] {
    // A child's human hold is a hold the graph reports, never a branch outcome.
    return ({ loop: ['ready', 'stopped'], check: ['passed', 'failed', 'unavailable'], 'human-hold': ['continued', 'rejected'], delivery: ['delivered'], router: ['routed'] })[kind];
}
/** The nearest loop owns the exact candidate and its contained evidence. */
export function graphCandidateOwner(plan: Pick<ContainedGraphPlan, 'nodes'>, nodeId: string): string | null {
    const seen = new Set<string>(); let cursor = nodeId;
    while (cursor !== 'root') {
        if (seen.has(cursor)) fail('Candidate reference cycle'); seen.add(cursor);
        const node = plan.nodes[cursor]; if (!node) fail('Unknown candidate reference');
        if (node.kind === 'loop') return cursor;
        if (node.kind === 'router') return null;
        cursor = node.input;
    }
    return null;
}
export function graphReservation(plan: Pick<ContainedGraphPlan, 'nodes'>, nodeId: string) {
    const node = plan.nodes[nodeId]; if (!node) fail('Unknown reservation node');
    // A loop's existing verifier-attempt ceiling is max_sessions. Reserve one
    // additional environment-discovery execution. Operator-driven displays are
    // separate explicit actions; this is the graph's automated allowance.
    return { roleSessions: node.kind === 'loop' ? node.plan.budget.max_sessions : 0,
        verificationAttempts: node.kind === 'loop' ? node.plan.budget.max_sessions + 1 : node.kind === 'check' ? 1 : 0 };
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
/** Compile data only. Repository TypeScript and command strings are not evaluated. */
export function compileContainedGraph(input: unknown): ContainedGraphPlan {
    const value = object(input, 'graph', ['version', 'id', 'repository', 'entry', 'required', 'budget', 'nodes']);
    if (value.version !== 1) fail('Contained graph declaration version must be 1');
    const graphId = id(value.id, 'graph id'), entry = id(value.entry, 'entry');
    const source = object(value.repository, 'source', ['url', 'commit']);
    const repository = { url: text(source.url, 'source URL', 4096), commit: text(source.commit, 'source commit', 64) };
    const limits = object(value.budget, 'graph budget', ['maxRoleSessions', 'maxVerificationAttempts', 'wallClockSeconds']);
    const budget = { maxRoleSessions: integer(limits.maxRoleSessions, 'role allowance'), maxVerificationAttempts: integer(limits.maxVerificationAttempts, 'verification allowance'), wallClockSeconds: integer(limits.wallClockSeconds, 'wall allowance', 1) };
    if (!value.nodes || typeof value.nodes !== 'object' || Array.isArray(value.nodes) || !Object.keys(value.nodes).length || Object.keys(value.nodes).length > 64) fail('A contained graph needs 1–64 nodes');
    const nodes: Record<string, ContainedGraphNode> = Object.create(null);
    const fields: Record<string, string[]> = { loop: ['kind', 'input', 'plan', 'then'], check: ['kind', 'input', 'then'], 'human-hold': ['kind', 'input', 'prompt', 'then'], delivery: ['kind', 'input', 'publication', 'then'], router: ['kind', 'input', 'routes', 'otherwise'] };
    for (const [name, raw] of Object.entries(value.nodes)) {
        id(name, 'node id'); if ([...SINKS, 'root'].includes(name)) fail('Reserved node id');
        const kind = (raw as any)?.kind; if (!KINDS.includes(kind)) fail('Unsupported graph node kind');
        const row = object(raw, `node ${name}`, fields[kind]!), input = id(row.input, 'input');
        if (kind === 'loop') {
            const plan = validateExecutionPlan(row.plan);
            if (!['wringer.execution-plan.v3', 'wringer.execution-plan.v4'].includes(plan.schema_version)) fail('A contained graph leaf needs a measured v3/v4 plan');
            if (hashValue(plan.repository) !== hashValue(repository)) fail('All graph templates must pin the same root source');
            nodes[name] = { kind, input, plan, then: id(row.then, 'edge') };
        } else if (kind === 'check') nodes[name] = { kind, input, then: id(row.then, 'edge') };
        else if (kind === 'human-hold') nodes[name] = { kind, input, prompt: text(row.prompt, 'human prompt'), then: id(row.then, 'edge') };
        else if (kind === 'delivery') nodes[name] = { kind, input, publication: publication(row.publication), then: id(row.then, 'edge') };
        else {
            if (!Array.isArray(row.routes) || !row.routes.length || row.routes.length > 8) fail('Router needs bounded outcome routes');
            const routes = row.routes.map((input: unknown) => { const route = object(input, 'route', ['outcome', 'to']); return { outcome: id(route.outcome, 'outcome'), to: id(route.to, 'edge') }; });
            unique(routes.map((r: any) => r.outcome), 'Router outcomes'); nodes[name] = { kind: 'router', input, routes, otherwise: id(row.otherwise, 'edge') };
        }
    }
    if (!Object.values(nodes).some(node => node.kind === 'loop')) fail('A serial contained graph needs a source-pinned loop');
    const incoming = new Map(Object.keys(nodes).map(name => [name, [] as string[]]));
    for (const [name, node] of Object.entries(nodes)) for (const next of graphEdges(node)) { if (!nodes[next] && !SINKS.includes(next)) fail(`Unknown graph edge ${name} → ${next}`); incoming.get(next)?.push(name); }
    if (!nodes[entry] || incoming.get(entry)!.length) fail('Graph entry must be an existing untargeted node');
    const seen = new Set<string>(), active = new Set<string>(), order: string[] = [];
    function visit(name: string) { if (SINKS.includes(name)) return; if (active.has(name)) fail('Graph cycle; iteration belongs inside a bounded loop'); if (seen.has(name)) return; active.add(name); for (const next of graphEdges(nodes[name]!)) visit(next); active.delete(name); seen.add(name); order.unshift(name); }
    visit(entry); if (seen.size !== Object.keys(nodes).length) fail('Graph has an unreachable node');
    const dominators = new Map<string, Set<string>>();
    for (const name of order) {
        const paths = incoming.get(name)!.map(parent => new Set([parent, ...dominators.get(parent)!]));
        const available = paths.length ? new Set([...paths[0]!].filter(parent => paths.every(path => path.has(parent)))) : new Set<string>(); dominators.set(name, available);
        const node = nodes[name]!;
        if (node.kind === 'router' && node.input === 'root') fail('Root source has no branch outcome');
        if (node.input !== 'root' && !available.has(node.input)) fail(`Node ${name} input is not available on every path`);
        if (['check', 'delivery'].includes(node.kind) && !graphCandidateOwner({ nodes }, node.input)) fail(`Node ${name} needs a contained candidate`);
        if (node.kind === 'human-hold' && node.input !== 'root' && !graphCandidateOwner({ nodes }, node.input)) fail(`Node ${name} needs a contained candidate to hold`);
        if (node.kind === 'loop' && node.input !== 'root' && !graphCandidateOwner({ nodes }, node.input)) fail(`Node ${name} needs a candidate source`);
        if (node.kind === 'router') for (const route of node.routes) if (!graphOutcomes(nodes[node.input]!.kind).includes(route.outcome)) fail('Router outcome is not defined by its input type');
    }
    if (!Array.isArray(value.required) || !value.required.length) fail('Name required successful graph nodes');
    const required = unique(value.required.map((name: unknown) => id(name, 'required node')), 'Required nodes').sort();
    for (const name of required) if (!nodes[name] || nodes[name]!.kind === 'router') fail('Required nodes must name consequential effects or human holds');
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
    const body = { schema_version: 'wringer.contained-graph-plan.v1' as const, id: graphId, repository, entry, required, budget, nodes };
    const wire = canonicalJson(body); if (Buffer.byteLength(wire) > 2 * 1024 * 1024) fail('Graph exceeds its bounded 2 MiB contract');
    if (new Redactor().scrub(wire) !== wire) fail('Graph contains a detected credential');
    return freeze({ ...body, sha256: hashValue(body) });
}
export function validateContainedGraph(input: unknown): ContainedGraphPlan {
    const value = object(input, 'compiled graph', ['schema_version', 'id', 'repository', 'entry', 'required', 'budget', 'nodes', 'sha256']);
    if (value.schema_version !== 'wringer.contained-graph-plan.v1') fail('Unsupported contained graph schema version');
    const { sha256, schema_version, ...declaration } = value;
    if (sha256 !== hashValue({ schema_version, ...declaration })) fail('Compiled graph digest changed');
    return compileContainedGraph({ version: 1, ...declaration });
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
