import type { AcpTransport, AcpTurnResult, AgentDeclaration, AgentRole } from "@wringer/acp";
export interface RepositorySource {
    url: string;
    commit: string; /** Local Git bundle is transported, then cloned inside; never mounted. */
    bundlePath?: string;
}
export interface NetworkRule {
    cidr: string;
    ports: number[];
}
export interface NetworkPolicy {
    policy: "deny" | "allowlist";
    allow?: NetworkRule[];
    dns?: string[];
}
interface BasePolicy {
    image: string;
    cpus: number;
    memoryMiB: number;
    network: NetworkPolicy;
    /** Environment-variable names only; no host filesystem/agent-home forwarding. */
    env?: string[];
}
export interface ApplePolicy extends BasePolicy {
    kind: "apple-container";
    binary?: string;
}
export interface KubernetesPolicy extends BasePolicy {
    kind: "gvisor-kubernetes";
    binary?: string;
    context: string;
    namespace: string;
    runtimeClass: string;
    secretRefs?: Record<string, {
        name: string;
        key: string;
    }>;
}
export type RuntimePolicy = ApplePolicy | KubernetesPolicy;
export interface WorkerScope {
    /** Exact existing repository files/directories; a directory permits its descendants. */
    writable: string[];
    /** Controller-pinned acceptance/policy paths, including check dependencies. */
    protected: string[];
    /** Explicit empty, untracked dependency/build directories, not delivered source. */
    writableDirectories?: string[];
}
export interface RoleExecutionRequest {
    role: AgentRole;
    repo: RepositorySource;
    runtime: RuntimePolicy;
    agent: AgentDeclaration;
    prompt: string;
    /** Exact protected snapshot in the cloned source, never a caller-controlled URL. */
    design?: { snapshotPath: string; snapshotSha256: string; referenceIds: string[] };
    budget: {
        maxTurns: number;
        timeoutMs: number;
    };
    allowedToolKinds?: string[];
    /** Mandatory for worker allocation; never inferred from the agent prompt. */
    scope?: WorkerScope;
    signal?: AbortSignal;
    onEvent?: (event: Record<string, unknown>) => void | Promise<void>;
}
export interface RuntimeProvenance {
    schema_version: "wringer.runtime.v1" | "wringer.runtime.v2";
    runtimeId: string;
    role: AgentRole | "verifier";
    kind: RuntimePolicy["kind"];
    image: string;
    repository: RepositorySource;
    clonedInside: true;
    hostMounts: [
    ];
    repositoryAccess: "read-only" | "read-write";
    declared: RuntimePolicy;
    observed: Record<string, unknown>;
    limits: string[];
}
export interface RoleExecutionResult extends AcpTurnResult {
    provenance: RuntimeProvenance;
    change?: {
        baseCommit: string;
        patch: string;
        sha256: string;
    };
}
export interface AgentPreflightResult extends RoleExecutionResult {
    promptSent: false;
    modelWorkRequested: false;
    providerCredentialValidated: false;
    effectiveCredential: "not-attested";
    credentialNames: string[];
    authMethodReturned: boolean;
    authLine: string;
}
export interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}
export interface RuntimeCommandOptions {
    input?: string | Uint8Array;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    signal?: AbortSignal;
}
/** Injectable solely for deterministic protocol tests; production defaults to actual CLI processes. */
export interface RuntimeDriver {
    command(argv: string[], options?: RuntimeCommandOptions): Promise<CommandResult>;
    connect(argv: string[], options?: RuntimeCommandOptions): Promise<AcpTransport>;
}
export type RoleExecutor = (request: RoleExecutionRequest) => Promise<RoleExecutionResult>;
export interface ContainedCommandRequest {
    repo: RepositorySource;
    runtime: RuntimePolicy;
    commands: {
        id: string;
        command?: string;
        argv?: string[];
        cwd?: string;
        timeoutMs: number;
    }[];
    /** Restore controller-pinned check inputs from this separate source before running checks. */
    acceptanceSource?: RepositorySource;
    protectedFiles?: string[];
    /** Empty, untracked dependency/build directories precreated before acceptance-parent lockdown. */
    writableDirectories?: string[];
    /** Controller-declared PNG outputs only; captured before destroying the verifier. */
    captureArtifacts?: CaptureArtifactDeclaration[];
    timeoutMs: number;
    signal?: AbortSignal;
    onEvent?: (event: Record<string, unknown>) => void | Promise<void>;
}
export interface ContainedCommandResult {
    provenance: RuntimeProvenance;
    results: {
        id: string;
        code: number;
        stdout: string;
        stderr: string;
        durationMs: number;
    }[];
    sourceChanged: boolean;
    sourceTree: string;
    checkInputsSha256?: string;
    artifacts?: CapturedImageArtifact[];
}
export interface CaptureArtifactDeclaration { id: string; path: string; mimeType: "image/png"; width?: number; height?: number; }
export interface CapturedImageArtifact { id: string; path: string; mimeType: "image/png"; sha256: string; bytes: number; base64: string; width: number; height: number; }
export class RuntimeError extends Error {
    constructor(message: string, readonly code = "runtime-refused") { super(message); this.name = "RuntimeError"; }
}
