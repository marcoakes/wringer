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
/** Ordinary processes on this computer under the operator's own account. Nothing is
 * contained: the operator chose it explicitly, every record says so, and protected
 * mode refuses it. Network access cannot be restricted, so "unenforced" is the only
 * value its policy can declare. */
export interface TrustedLocalPolicy {
    kind: "trusted-local";
    network: { policy: "unenforced" };
    /** Environment-variable names forwarded to agents, beyond the account's own login state. */
    env?: string[];
    /** Container-only settings, absent by construction. */
    image?: undefined; cpus?: undefined; memoryMiB?: undefined; binary?: undefined;
}
export type ContainedRuntimePolicy = ApplePolicy | KubernetesPolicy;
export type RuntimePolicy = ContainedRuntimePolicy | TrustedLocalPolicy;
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
export interface ContainedRuntimeProvenance {
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
/** A role or check that ran on this computer: a fresh clone in a temporary directory,
 * under the operator's account, with no boundary established. */
export interface TrustedLocalRuntimeProvenance {
    schema_version: "wringer.runtime.v3";
    runtimeId: string;
    role: AgentRole | "verifier";
    kind: "trusted-local";
    boundary: "trusted-local";
    established: "none";
    repository: RepositorySource;
    workspace: "fresh-temporary-clone";
    repositoryAccess: "read-only" | "read-write";
    declared: TrustedLocalPolicy;
    /** Container-only facts, absent by construction: nothing was cloned inside a boundary. */
    image?: undefined; clonedInside?: undefined; hostMounts?: undefined;
    observed: Record<string, unknown>;
    limits: string[];
}
export type RuntimeProvenance = ContainedRuntimeProvenance | TrustedLocalRuntimeProvenance;
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
    /** Working directory of a host process (trusted-local only). */
    cwd?: string;
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
