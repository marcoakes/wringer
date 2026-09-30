/** The shape of a contained graph and the pure facts derived from it: which
 * node a node reads, its outcomes, its reservation and each fork's branches.
 * No host imports, so a deterministic workflow sandbox can bundle it; the full
 * validation of a graph stays in ./graph. */
import { hashValue } from '@wringer/records/canonical';
import type { ExecutionPlan, RepositoryRef } from './types';

export interface GraphBudget { maxRoleSessions: number; maxVerificationAttempts: number; wallClockSeconds: number; }
export interface GraphPublication { remote: string; sourceBranch: string; targetBranch: string; }
/** A gate whose files are pinned by content in the plan, never read from a candidate. */
export interface GraphGate { id: string; argv: string[]; cwd: string; timeout_seconds: number; files: { path: string; content: string }[]; }
export interface GraphProsecutor { plan: ExecutionPlan; maxChallenges: number; }
/** The one file a prosecutor may write: a JSON array of executable challenges. */
export const PROSECUTOR_ARTIFACT = 'wringer/challenges.json';
/** An external A2A agent, pinned by endpoint and by the digest of its Agent Card. */
export interface GraphPeer { url: string; cardSha256: string; skill: string; }
export type ContainedGraphNode =
    | { kind: 'loop'; input: string; plan: ExecutionPlan; then: string }
    | { kind: 'check'; input: string; then: string }
    | { kind: 'human-hold'; input: string; prompt: string; then: string }
    | { kind: 'delivery'; input: string; publication: GraphPublication; then: string }
    | { kind: 'router'; input: string; routes: { outcome: string; to: string }[]; otherwise: string }
    | { kind: 'fork'; input: string; branches: string[]; join: string }
    | { kind: 'join'; fork: string; then: string }
    /** Version 3: closes a fork by selecting one surviving candidate, or none. */
    | { kind: 'tournament'; fork: string; prosecutor: GraphProsecutor; controls: { id: string; commit: string }[]; evaluator: GraphGate[]; tie: 'no-winner' | 'tree-order'; then: string }
    /** Version 4: one bounded task delegated to an external A2A agent. Its patch is a
     * candidate only a following check can verify; the peer's claim grants nothing. */
    | { kind: 'delegate'; input: string; peer: GraphPeer; instruction: string; verify: ExecutionPlan; timeoutSeconds: number; then: string };
export interface ContainedGraphPlan {
    schema_version: 'wringer.contained-graph-plan.v1' | 'wringer.contained-graph-plan.v2' | 'wringer.contained-graph-plan.v3' | 'wringer.contained-graph-plan.v4'; id: string; repository: RepositoryRef; entry: string;
    required: string[]; budget: GraphBudget; nodes: Record<string, ContainedGraphNode>;
    /** Version 2 and later: the most branches whose effects may run at once. */
    parallelism?: number; sha256: string;
}
export interface GraphAuthority {
    schema_version: 'wringer.contained-graph-authority.v1'; graphSha256: string; repository: RepositoryRef;
    actor: string; grantedAt: string; expiresAt: string; budget: GraphBudget; maySend: false; sha256: string;
}
/** A node that closes a fork: it waits for every branch and reads their results. */
export const closesFork = (node: ContainedGraphNode | undefined): node is Extract<ContainedGraphNode, { kind: 'join' | 'tournament' }> => node?.kind === 'join' || node?.kind === 'tournament';
const SINKS = ['done', 'fail'];
function fail(message: string): never { throw new Error(message); }
export function graphEdges(node: ContainedGraphNode): string[] { return node.kind === 'router' ? [...node.routes.map(row => row.to), node.otherwise] : node.kind === 'fork' ? [...node.branches] : [node.then]; }
/** The node whose result a node reads; a join or tournament reads its branches instead. */
export function graphInput(node: ContainedGraphNode): string | null { return closesFork(node) ? null : node.input; }
export function graphOutcomes(kind: ContainedGraphNode['kind']): string[] {
    // A child's human hold is a hold the graph reports, never a branch outcome.
    return ({ loop: ['ready', 'stopped'], check: ['passed', 'failed', 'unavailable'], 'human-hold': ['continued', 'rejected'], delivery: ['delivered'], router: ['routed'], fork: ['forked'], join: ['integrated', 'failed', 'conflict', 'unavailable'], tournament: ['selected', 'no-winner', 'unavailable'], delegate: ['returned', 'failed', 'canceled', 'unavailable'] })[kind];
}
/** The nearest loop, join, tournament or delegate owns the exact candidate and its evidence. */
export function graphCandidateOwner(plan: Pick<ContainedGraphPlan, 'nodes'>, nodeId: string): string | null {
    const seen = new Set<string>(); let cursor = nodeId;
    while (cursor !== 'root') {
        if (seen.has(cursor)) fail('Candidate reference cycle'); seen.add(cursor);
        const node = plan.nodes[cursor]; if (!node) fail('Unknown candidate reference');
        if (node.kind === 'loop' || node.kind === 'delegate' || closesFork(node)) return cursor;
        if (node.kind === 'router') return null;
        cursor = node.input;
    }
    return null;
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
    // One external task counts as one role session; its check reserves its own verification.
    if (node.kind === 'delegate') return { roleSessions: 1, verificationAttempts: 0 };
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
const GRAPH_VERSIONS: Record<string, 1 | 2 | 3 | 4> = { 'wringer.contained-graph-plan.v1': 1, 'wringer.contained-graph-plan.v2': 2, 'wringer.contained-graph-plan.v3': 3, 'wringer.contained-graph-plan.v4': 4 };
/** The declaration version a compiled graph was compiled from. */
export function graphVersion(input: unknown): 1 | 2 | 3 | 4 {
    const schema = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>).schema_version : undefined;
    return GRAPH_VERSIONS[String(schema)] ?? fail('Unsupported contained graph schema version');
}
/** A compiled graph's digest covers every other field. */
export function checkGraphDigest(value: Record<string, unknown>) {
    const { sha256, ...body } = value;
    if (sha256 !== hashValue(body)) fail('Compiled graph digest changed');
}
/** A grant binds one graph, its source and allowance, never Send, for a bounded time. */
export function checkGraphAuthority(value: Record<string, any>, plan: ContainedGraphPlan, at: Date) {
    if (value.schema_version !== 'wringer.contained-graph-authority.v1') fail('Unsupported graph authority version');
    if (value.graphSha256 !== plan.sha256 || hashValue(value.repository) !== hashValue(plan.repository) || hashValue(value.budget) !== hashValue(plan.budget)) fail('Graph authority is bound to another contract or allowance');
    if (value.maySend !== false) fail('Graph execution authority cannot grant Send');
    if (typeof value.actor !== 'string' || !value.actor.trim() || new TextEncoder().encode(value.actor).length > 200 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.actor)) fail('actor must be bounded text');
    if (!Number.isFinite(at.getTime()) || !Number.isFinite(Date.parse(value.grantedAt)) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.grantedAt) > at.getTime() || Date.parse(value.expiresAt) <= at.getTime()) fail('Graph authority is expired or not yet valid');
    const { sha256, ...body } = value;
    if (sha256 !== hashValue(body)) fail('Graph authority digest changed');
}
