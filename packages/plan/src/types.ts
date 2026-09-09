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
export interface PlanDeclaration {
    version: 1 | 2;
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
}
export interface ExecutionPlan extends Omit<PlanDeclaration, "version"> {
    environment: PlanDeclaration["environment"] & {
        writable_directories: string[];
    };
    schema_version: "wringer.execution-plan.v1" | "wringer.execution-plan.v2";
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
