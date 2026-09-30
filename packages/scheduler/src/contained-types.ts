import type { ContainedGraphPlan, GraphAuthority, RepositoryRef } from '@wringer/plan';

/** The exact candidate a contained loop produced. Only a loop creates one. */
export interface GraphCandidate { source: RepositoryRef; tree: string; owner: string; }
/** What a node received: its predecessor (`root` or a node id), that
 * predecessor's source, candidate and evidence digest. */
/** One branch's arrival. A join's branches always carry a candidate; a tournament's
 * also carry the arriving outcome, and a disqualified branch may have no candidate. */
export interface GraphBranchInput { branch: string; node: string; outcome?: string; candidate: GraphCandidate | null; evidenceSha256: string; }
export interface GraphInput { node: string; source: RepositoryRef; candidate: GraphCandidate | null; evidenceSha256: string; /** A join's or tournament's inputs, one per branch in declared order. */ branches?: GraphBranchInput[]; }
export interface GraphResult { kind: 'complete'; outcome: string; candidate: GraphCandidate | null; evidenceSha256: string; }
export interface GraphPreparation { kind: 'prepared'; candidate: GraphCandidate; evidenceSha256: string; }
export type GraphObservation = GraphResult | GraphPreparation | { kind: 'held'; reason: string };
export interface GraphReservation { roleSessions: number; verificationAttempts: number; deadline: string; input: GraphInput; }
export interface GraphRoute { outcome: string; to: string; via: string[]; reason: string | null; /** A fork's route: every branch it opens. */ branches?: string[]; }
export type GraphEventKind = 'start' | 'reserve' | 'dispatch' | 'prepared' | 'send' | 'result' | 'decision' | 'route';
export interface GraphEvent {
    schema_version: 'wringer.contained-graph-event.v1' | 'wringer.contained-graph-event.v2' | 'wringer.contained-graph-event.v3' | 'wringer.contained-graph-event.v4'; graphSha256: string; sequence: number; previousSha256: string | null;
    at: string; node: string | null; kind: GraphEventKind;
    data: any; sha256: string;
}
export interface GraphNodeState {
    reservation: GraphReservation; dispatched: boolean; prepared?: GraphPreparation; sent: boolean; send?: GraphSend;
    decision?: GraphDecision; decisionSha256?: string; result?: GraphResult; route?: GraphRoute;
}
export type GraphPhase = 'pending' | 'human-hold' | 'send-hold' | 'uncertain' | 'complete' | 'failed' | 'expired';
export interface GraphState {
    plan: ContainedGraphPlan; authority: GraphAuthority; events: GraphEvent[]; revision: string;
    /** The first active node (a serial graph has exactly one). */
    cursor: string;
    active: string[];
    holds: { node: string; kind: 'human' | 'child' | 'send'; reason: string }[];
    /** Branch nodes still open when another branch failed the graph. */
    cancelled: string[];
    startedAt: string; deadline: string; nodes: Record<string, GraphNodeState>;
    reserved: { roleSessions: number; verificationAttempts: number };
    phase: GraphPhase;
    reason: string | null;
}
export interface GraphEffectRequest {
    directory: string; plan: ContainedGraphPlan; authority: GraphAuthority; node: string;
    reservation: GraphReservation; signal?: AbortSignal;
}
/** The scheduler owns reservations. Production dispatch must use contained
 * services; observe must only reconcile retained domain observations. */
export interface GraphDriver {
    /** Optional, effect-free prerequisites (runtime present, child derivable,
     * publication target reachable). Runs after the transition is validated and
     * before its durable marker, so a refusal leaves nothing charged as uncertain. */
    preflight?(request: GraphEffectRequest, operation: 'dispatch' | 'send'): Promise<void>;
    dispatch(request: GraphEffectRequest): Promise<void>;
    observe(request: GraphEffectRequest): Promise<GraphObservation | null>;
    send(request: GraphEffectRequest, preparation: GraphPreparation): Promise<void>;
}
export interface ContainedGraphOptions {
    signal?: AbortSignal;
    /** Deterministic fixtures only; never a public CLI option. */
    now?: () => Date;
    /** Crash probes run after a durable boundary, before the next operation. */
    checkpoint?: (event: GraphEvent) => Promise<void>;
}
export interface GraphDecision { node: string; expectedRevision: string; inputSha256: string; choice: 'continue' | 'reject'; actor: string; note: string; }
export interface GraphSend { node: string; expectedRevision: string; preparedSha256: string; actor: string; note: string; }
