import type { RuntimePolicy } from "@wringer/runtime";
import type { AgentDeclaration as AcpAgentDeclaration } from "@wringer/acp";
export type AgentRole = "planner" | "worker" | "judge";
export interface RepositoryRef {
    url: string;
    commit: string;
}
export type AgentDeclaration = AcpAgentDeclaration;
export type RuntimeDeclaration = RuntimePolicy;
export interface DeclaredCommand {
    id: string;
    argv: string[];
    cwd: string;
    timeout_seconds: number;
}
export interface AcceptanceCriterion {
    id: string;
    title: string;
    quote: string;
    kind: "check" | "human";
    required: boolean;
    show?: DeclaredCommand;
}
export interface AcceptanceCheck extends DeclaredCommand {
    criteria: string[];
    files: string[];
    /** v3 only: command exit alone cannot establish assertion evidence. */
    evidence?: { kind: "assertions"; format: "wringer-check.v1" };
}
export interface AcceptanceContract {
    criteria: AcceptanceCriterion[];
    checks: AcceptanceCheck[];
    protected_paths: string[];
}
export interface ExecutionBudget {
    max_sessions: number;
    max_worker_turns: number;
    max_judge_turns: number;
    max_planner_turns: number;
    wall_clock_seconds: number;
    session_timeout_seconds: number;
}
export type ExecutionAction = "plan" | "build" | "verify" | "judge" | "deliver";
export interface DesignReview {
    criterionId: string;
    referenceIds: string[];
    captures: { id: string; path: string; mimeType: "image/png"; width: number; height: number }[];
}
export interface DesignDeclaration {
    snapshotPath: string;
    snapshotSha256: string;
    reviews: DesignReview[];
}
export interface LoopPolicy {
    repeatCandidate: "stop";
    repeatedOutcomeWarning: number;
}
export interface PlaybookSelection {
    path: string;
    /** SHA-256 of the complete exact UTF-8 source blob, not a mutable name. */
    sha256: string;
    taskFamily: string;
    /** Retained future-selection provenance, not execution or research eligibility authority. */
    adoption?: PlaybookAdoptionReceipt;
}
export interface PlaybookAdoptionReceipt {
    schema_version: "wringer.playbook-adoption.v1";
    repository: string;
    taskFamily: string;
    action: "promote" | "rollback";
    actor: string;
    note: string;
    at: string;
    previousRevision: string;
    previousDigest: string | null;
    selectedDigest: string | null;
    experimentSha256: string;
    evidenceRevision: string;
    appliesTo: "future-plans-only";
    executionApproved: false;
    sha256: string;
}
export interface PlanDeclaration {
    version: 1 | 2 | 3;
    name: string;
    intent: string;
    repository: RepositoryRef;
    runtime: RuntimeDeclaration;
    agents: {
        worker: AgentDeclaration;
        judge: AgentDeclaration;
        planner?: AgentDeclaration;
    };
    environment: {
        context: string[];
        tools: {
            name: string;
            version: string;
            probe: string[];
        }[];
        setup: DeclaredCommand[];
        baseline: DeclaredCommand[];
        writable_directories?: string[];
    };
    scope: {
        writable: string[];
    };
    acceptance: AcceptanceContract;
    budget: ExecutionBudget;
    /** v2 only: approved design bytes and exact required visual observations. */
    design?: DesignDeclaration;
    /** v3 only; finite deterministic feedback policy, never acceptance authority. */
    loop?: LoopPolicy;
    /** v3 only; one explicitly selected worker-only advisory artifact. */
    playbook?: PlaybookSelection;
    /** v3 only: retained rollback-to-no-playbook decision, never execution authority. */
    approachAdoption?: PlaybookAdoptionReceipt;
}
export interface ExecutionPlan extends Omit<PlanDeclaration, "version"> {
    environment: PlanDeclaration["environment"] & {
        writable_directories: string[];
    };
    schema_version: "wringer.execution-plan.v1" | "wringer.execution-plan.v2" | "wringer.execution-plan.v3";
    intent_sha256: string;
    acceptance_sha256: string;
    plan_sha256: string;
}
export interface ExecutionAuthority {
    schema_version: "wringer.execution-authority.v1";
    actor: string;
    repository: RepositoryRef;
    plan_sha256: string;
    acceptance_sha256: string;
    actions: ExecutionAction[];
    budget: ExecutionBudget;
    granted_at: string;
    expires_at: string;
}
export interface EnvironmentObservation {
    kind: "tool" | "baseline";
    id: string;
    status: "passed" | "failed" | "unavailable";
    exit_code: number | null;
    output: string;
    source_commit: string;
    runtime_id: string;
    image: string;
    command_sha256: string;
}
export interface EnvironmentMap {
    schema_version: "wringer.environment-map.v1";
    repository: RepositoryRef;
    plan_sha256: string;
    source_tree: string;
    inventory_sha256: string;
    files: {
        path: string;
        mode: string;
        blob: string;
    }[];
    context: {
        path: string;
        blob: string;
        text: string;
        sha256: string;
    }[];
    components: {
        path: string;
        files: number;
    }[];
    tools: {
        name: string;
        version: string;
        probe: string[];
        observation: EnvironmentObservation | null;
    }[];
    baseline: {
        declaration: DeclaredCommand;
        observation: EnvironmentObservation | null;
    }[];
    protected_paths: string[];
    writable_paths: string[];
    limits: string[];
    map_sha256: string;
}
