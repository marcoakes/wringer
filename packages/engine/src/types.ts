export class EngineError extends Error {
    constructor(message: string, readonly exit_code = 2, readonly next_move?: string) { super(message); this.name = "EngineError"; }
}
export interface Gate {
    id: string;
    run: string;
    timeout: number;
    optional: boolean;
    proves: string[];
    concurrent: boolean;
    stability?: {
        attempts: number;
        require_consistent: boolean;
    };
    artifacts?: {
        max_bytes: number;
        total_bytes: number;
    };
}
export interface Config {
    version: 1;
    gates: Gate[];
    evidence: {
        include: string[];
        redact: {
            env: string[];
        };
    };
    run?: {
        worker: string;
        max_iterations: number;
        worker_timeout: number;
        wall_clock?: number;
        prove?: boolean;
        prove_setup?: string;
        containment?: Containment;
    };
    judge?: {
        endpoint: string;
        model: string;
        api_key_env: string;
        timeout?: number;
        max_tokens?: number;
    };
    show?: Record<string, string>;
    deliver?: {
        branch?: string;
        base?: string;
        remote?: string;
        issues_dir?: string;
    };
    execution?: Execution;
    provenance?: {
        require_signature?: boolean;
        signer?: string;
        expect_identity?: unknown;
    };
    [key: string]: unknown;
}
export interface Execution {
    backend: "local" | "container";
    runtime?: "docker" | "podman" | "nerdctl";
    image?: string;
    network?: boolean;
    env?: string[];
    user?: string;
}
export interface Containment {
    runtime: "docker" | "podman" | "nerdctl";
    image: string;
    requires: string[];
    env: string[];
    user?: string;
    egress: {
        policy: "none" | "allowlist";
        hosts: string[];
        ports: number[];
        broker_image?: string;
    };
}
export interface Snapshot {
    root: string;
    head_sha: string | null;
    branch: string | null;
    dirty: boolean;
    changed_files: string[];
    untracked: string[];
    status: string;
    diff: string;
    untracked_hashes: Record<string, string>;
    fingerprint: string;
}
export interface ProcessResult {
    exit_code: number;
    duration_ms: number;
    timed_out: boolean;
    interrupted: boolean;
    stdout: string;
    stderr: string;
    stdout_truncated: boolean;
    stderr_truncated: boolean;
}
export interface GateResult {
    gate_id: string;
    command: string;
    exit_code: number;
    duration_ms: number;
    timed_out: boolean;
    stdout_truncated: boolean;
    stderr_truncated: boolean;
    optional: boolean;
    status: "passed" | "failed";
}
export type EventCallback = (event: Record<string, unknown>) => void;
export interface VerifyOptions {
    gate?: string | string[];
    output?: string;
    serial?: boolean;
    signal?: AbortSignal;
    onEvent?: EventCallback;
    prove?: boolean;
    workerExecution?: unknown;
}
export interface VerifyOutcome {
    status: "passed" | "failed" | "interrupted";
    failed_gate: string | null;
    rerun: string | null;
    evidence_dir: string;
    template_only: boolean;
    exit_code: number;
    manifest: any;
    results: GateResult[];
    acceptance?: any;
    stability?: any;
    vacuity?: any;
}
export interface RunOptions extends Pick<VerifyOptions, "signal" | "onEvent" | "gate" | "serial"> {
    maxIterations?: number;
    workerTimeout?: number;
    wallClock?: number;
    declaredWorker?: string;
    resume?: string;
    task?: string;
}
export interface RunOutcome {
    worker_turns: number;
    status: "converged" | "stopped" | "interrupted";
    reason: string;
    iterations: number;
    loop_dir: string;
    final: VerifyOutcome | null;
    exit_code: number;
    next_move?: string;
}
