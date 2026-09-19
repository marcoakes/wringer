export class EngineError extends Error {
    constructor(message: string, readonly exit_code = 2, readonly next_move?: string) { super(message); this.name = "EngineError"; }
}
export type Adapter = "vitest" | "playwright" | "node-test";
/** Where a gate's structured assertion report comes from, and which runner wrote it. */
export interface GateEvidence {
    kind: "assertions";
    adapter: Adapter;
    /** A repository-relative file the gate's own command writes; absent means the gate's stdout. */
    report?: string;
}
export interface Gate {
    id: string;
    run: string;
    timeout: number;
    optional: boolean;
    proves: string[];
    /** Supporting evidence that can never override a failure of a required binding gate. */
    corroborates: string[];
    evidence?: GateEvidence;
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
/** One declared prerequisite a bounded probe can measure. Additive; absent in most repositories. */
export interface Requirement {
    kind: "browser" | "native_database" | "filesystem" | "container_service";
    timeout: number;
    /** browser: the node_modules package that pins the browser. */
    module?: string;
    /** browser: which engine to launch. */
    engine?: "chromium" | "firefox" | "webkit";
    /** native_database: the environment variable NAME carrying the URL. Never the URL. */
    url_env?: string;
    /** container_service: the client binary to ask for status. */
    binary?: string;
}
/** A bounded, project-owned command in the run's prelude or epilogue. Never retried. */
export interface Step {
    id: string;
    run: string;
    timeout: number;
    /** NAME -> the name of the variable whose value to use. An indirection, never a literal. */
    env?: Record<string, string>;
}
export interface Service {
    id: string;
    run: string;
    env?: Record<string, string>;
    /** Absent when this service has no URL of its own — ZenJev's worker is reported by the
     * application's health endpoint, not by one of its own. Then it is started and recorded as
     * not measured, which is true, rather than given a URL it does not serve. */
    readiness?: {
        url: string;
        status: number;
        body_path?: string;
        equals?: string;
        timeout: number;
    };
}
export interface Phase {
    id: string;
    gates: string[];
    needs: string[];
}
export interface Config {
    version: 1;
    gates: Gate[];
    requires: Requirement[];
    setup: Step[];
    services: Service[];
    phases: Phase[];
    teardown: Step[];
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
    /** The environment declared steps and services read from. Defaults to this process's. */
    environment?: NodeJS.ProcessEnv;
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
    selection: any;
    /** The declared prelude's record, or a not-declared placeholder. */
    orchestration: any;
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
