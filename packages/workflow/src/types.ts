export type Section = "requirements" | "decisions" | "tasks";
export interface SourceSpan {
    id: string;
    start: number;
    end: number;
    quote: string;
}
export interface Requirement {
    id: string;
    title: string;
    quote: string;
    source_id: string;
    required: boolean;
    human: boolean;
    guidance?: string;
}
export interface Question {
    id: string;
    semantic_key: string;
    requirement_ids: string[];
    question: string;
    required: boolean;
    human: boolean;
    suggested_answer?: string;
    answer?: string;
}
export interface Assumption {
    id: string;
    semantic_key: string;
    requirement_ids: string[];
    statement: string;
    human: boolean;
    status: "pending" | "accepted" | "overruled";
    note?: string;
}
export interface ProposedGate {
    id: string;
    run: string;
    proves: string;
    timeout?: number;
}
export interface PlanTask {
    id: string;
    brief: string;
    dir: string;
    objective: string;
    requirement_ids: string[];
}
export interface NativePlan {
    schema_version: "wringer.workflow-plan.v1";
    source_sha256: string;
    ledger_sha256: string;
    title: string;
    intent: string;
    requirements: Requirement[];
    questions: Question[];
    assumptions: Assumption[];
    tasks: PlanTask[];
    gates: ProposedGate[];
    show: Record<string, string>;
    created_at: string;
}
export interface SpecDocument {
    schema_version: "wringer.spec.v1";
    approved: boolean;
    title: string;
    intent: string;
    criteria: {
        id: string;
        title: string;
        required: boolean;
        human: boolean;
        guidance?: string;
    }[];
    open_questions: {
        id: string;
        question: string;
        required: boolean;
        answer: string;
    }[];
    tasks: {
        id: string;
        brief: string;
        dir: string;
        objective: string;
    }[];
    gates: never[];
}
export type AuthorityAction = "draft" | "resolve-questions" | "accept-assumptions" | "approve-plan" | "install-gates" | "build";
export interface OperatorAuthority {
    schema_version: "wringer.operator-authority.v1";
    repo: string;
    actor: string;
    granted_at: string;
    expires_at?: string;
    actions: AuthorityAction[];
    budget: {
        max_draft_calls: number;
        max_repair_attempts: number;
        max_worker_turns: number;
    };
}
export interface Approval {
    schema_version: "wringer.workflow-approval.v1";
    digest: string;
    actor: string;
    at: string;
    authority_sha256: string | null;
}
export interface StopRecord {
    schema_version: "wringer.workflow-stop.v1";
    at: string;
    reason: string;
    message: string;
    cwd: string;
    next_move: string;
    preserved: string[];
    details?: unknown;
}
export interface DraftOptions {
    repo: string;
    prdPath: string;
    endpoint: string;
    model: string;
    apiKeyEnv?: string;
    send?: boolean;
    maxCalls?: number;
    maxRepairAttempts?: number;
    maxOutputTokens?: number;
    timeoutMs?: number;
    retryUncertain?: boolean;
    context?: string;
    feedback?: string;
    signal?: AbortSignal;
    transport?: (request: DraftRequest, init: {
        endpoint: string;
        apiKey?: string;
        signal: AbortSignal;
    }) => Promise<unknown>;
    onEvent?: (event: Record<string, unknown>) => void | Promise<void>;
}
export interface DraftRequest {
    model: string;
    max_tokens: number;
    messages: {
        role: "system" | "user";
        content: string;
    }[];
}
export interface DraftResult {
    status: "drafted" | "dry-run";
    plan?: NativePlan;
    sourcePath: string;
    calls: number;
    reused: Section[];
    totalCalls: number;
    tokens: {
        prompt: number | null;
        completion: number | null;
        total: number | null;
    };
    requestPaths: string[];
}
export interface CompiledPlan {
    digest: string;
    plan: NativePlan;
    spec: SpecDocument;
    tasksPath: string;
    briefPaths: string[];
    gates: ProposedGate[];
    show: Record<string, string>;
    display: string;
}
export interface ServiceResult {
    status: string;
    /** Exact worker starts reported by the engine checkpoint; absent is unknown, never zero. */
    workerTurns?: number;
    runId?: string;
    evidenceDir?: string;
    reason?: string;
    message?: string;
    nextMove?: string;
    humanPending?: string[];
    unproved?: string[];
    [key: string]: unknown;
}
export interface DriveServices {
    preflight?: (repo: string) => Promise<ServiceResult>;
    installGates: (repo: string, plan: CompiledPlan) => Promise<void>;
    build: (repo: string, plan: CompiledPlan, maxWorkerTurns: number) => Promise<ServiceResult>;
    verify: (repo: string) => Promise<ServiceResult>;
    renderBoard?: (repo: string, result: ServiceResult) => Promise<string>;
}
export interface DriveOptions {
    repo: string;
    prdPath?: string;
    authorityPath?: string;
    headless?: boolean;
    draft?: Omit<DraftOptions, "repo" | "prdPath">;
    services: DriveServices;
    answers?: Record<string, string>;
    onEvent?: (event: Record<string, unknown>) => void | Promise<void>;
    signal?: AbortSignal;
}
export interface DriveResult {
    status: "ready" | "stopped";
    journeyId: string;
    stop?: StopRecord;
    result?: ServiceResult;
    boardPath?: string;
}
