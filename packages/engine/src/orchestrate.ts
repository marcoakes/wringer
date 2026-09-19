/**
 * Setup, services, readiness, phases and teardown — the coordination a real
 * application needs, carried by the run instead of by a script beside it.
 *
 * Measured from ZenJev's own CI coordinator (117 lines) on 19 September 2026: it
 * re-implemented detached spawn, SIGTERM→SIGKILL, timeouts and per-label log
 * capture; ran two migrations and two seeds; started a worker and two application
 * instances; polled two readiness URLs (one on a JSON body path, one on an
 * authenticated 401); ran four gate subsets; stopped everything; and aggregated
 * the bundles by hand. The supervision, the phase ordering and the aggregation
 * are Wringer's job. The commands themselves are the application's, and stay in
 * the application's own configuration.
 *
 * Three rules this module will not bend. A setup or service that fails before
 * readiness is an ENVIRONMENT outcome (exit 2), not a gate failure (exit 1) —
 * the application was never asked a question. Cancellation signals only process
 * groups this run started. And nothing here is retried: a retry that could repeat
 * a paid call or an external write is the project's decision, not the harness's.
 */
import { EngineError, type Config, type Service, type Step } from "./types";
import { Bundle } from "./io";
import { runProcess, startService, type ServiceHandle } from "./process";
export const ORCHESTRATION_LIMITS = [
    "A setup or service failure before readiness is an environment outcome, not a product result: no gate was asked a question, and exit 2 says so.",
    "Nothing under setup: or services: is retried. A retry could repeat a paid call or an external write, and that is the project's decision to make explicitly.",
    "Cancellation and teardown signal only the process groups this run started, by the leader pid it holds. No other pgid is signalled.",
    "A readiness answer establishes that the declared URL answered as declared. It does not establish that the service is correct, or that it will still answer later.",
    "Teardown always runs, including after a failed gate and after a cancelled run. A teardown command that itself fails is recorded and does not rewrite the run's outcome.",
];
export interface StepRecord {
    id: string;
    kind: "setup" | "teardown";
    command: string;
    exit_code: number;
    duration_ms: number;
    timed_out: boolean;
    status: "passed" | "failed";
    log: string;
}
export interface ServiceRecord {
    id: string;
    command: string;
    pid: number;
    readiness: {
        url: string;
        expect: string;
        waited_ms: number;
        status: "ready" | "not-measured" | "exited-before-readiness" | "timed-out" | "refused";
        detail: string;
    };
    stopped: {
        code: number | null;
        signal: string | null;
        forced: boolean;
    } | null;
    log: string;
}
export interface Orchestration {
    schema_version: "wringer.orchestration.v1";
    outcome: "ready" | "environment" | "not-declared";
    setup: StepRecord[];
    services: ServiceRecord[];
    phases: {
        id: string;
        needs: string[];
        gates: string[];
    }[];
    teardown: StepRecord[];
    reason: string;
    limits: string[];
}
/** A declared indirection only: NAME comes from the value of another variable's name. */
function environmentFor(step: Pick<Step, "env">, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...base };
    for (const [name, from] of Object.entries(step.env ?? {}))
        env[name] = base[from];
    return env;
}
export class EnvironmentError extends EngineError {
    constructor(message: string, readonly record: Orchestration) { super(message, 2, "wring doctor"); }
}
export interface OrchestrationOptions {
    signal?: AbortSignal;
    environment?: NodeJS.ProcessEnv;
}
/**
 * Runs the declared prelude and holds the services the phases need. The caller
 * must call `stop()` in a `finally`, whatever happened to the gates.
 */
export class Orchestrator {
    private readonly handles: ServiceHandle[] = [];
    private readonly serviceRecords: ServiceRecord[] = [];
    private readonly setupRecords: StepRecord[] = [];
    private readonly teardownRecords: StepRecord[] = [];
    private outcome: Orchestration["outcome"];
    private reason: string;
    constructor(private readonly repo: string, private readonly config: Config, private readonly bundle: Bundle, private readonly options: OrchestrationOptions = {}) {
        const declared = config.setup.length || config.services.length || config.phases.length || config.teardown.length;
        this.outcome = declared ? "ready" : "not-declared";
        this.reason = declared ? "The declared prelude has not run yet." : "This repository declares no setup, services, phases or teardown.";
    }
    get declared() { return this.outcome !== "not-declared"; }
    private async step(kind: "setup" | "teardown", one: Step): Promise<StepRecord> {
        const log = `${kind}/${one.id}.log`;
        // Teardown is deliberately NOT bound to the run's abort signal: a cancelled run is exactly
        // when cleanup matters, and an aborted signal would kill it before it started. Its own
        // timeout still bounds it.
        const result = await runProcess(one.run, { cwd: this.repo, timeout: one.timeout, ...(kind === "setup" ? { signal: this.options.signal } : {}), redactor: this.bundle.redactor, env: environmentFor(one, this.options.environment ?? process.env) });
        await this.bundle.write(log, `$ ${one.run}\n${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}`);
        return { id: one.id, kind, command: one.run, exit_code: result.exit_code, duration_ms: result.duration_ms, timed_out: result.timed_out, status: result.exit_code === 0 && !result.timed_out ? "passed" : "failed", log };
    }
    /** Ordered, bounded, never retried. The first failure is an environment outcome. */
    async setup(): Promise<void> {
        for (const one of this.config.setup) {
            this.options.signal?.throwIfAborted();
            const record = await this.step("setup", one);
            this.setupRecords.push(record);
            await this.bundle.event("setup.finished", { id: one.id, exit_code: record.exit_code, status: record.status });
            if (record.status === "failed") {
                this.outcome = "environment";
                this.reason = `Setup step ${one.id} ${record.timed_out ? `exceeded its ${one.timeout} s timeout` : `exited ${record.exit_code}`}. No gate ran, so nothing was asked of the application. Nothing under setup: is retried.`;
                throw new EnvironmentError(this.reason, this.record());
            }
        }
    }
    /**
     * Starts every named service this run does not already hold, THEN waits for each declared
     * readiness answer. The order matters: ZenJev's worker is reported by the application's own
     * health endpoint, so polling it before the application started would time out on a service
     * that was about to be fine. Any started service exiting during any poll ends the wait.
     */
    async ensure(ids: string[]): Promise<void> {
        const starting: { service: Service; handle: ServiceHandle }[] = [];
        for (const id of ids) {
            if (this.handles.some(h => h.id === id))
                continue;
            const service = this.config.services.find(s => s.id === id)!;
            this.options.signal?.throwIfAborted();
            const handle = startService(id, service.run, { cwd: this.repo, redactor: this.bundle.redactor, env: environmentFor(service, this.options.environment ?? process.env) });
            this.handles.push(handle);
            starting.push({ service, handle });
            await this.bundle.event("service.started", { id, pid: handle.pid });
        }
        for (const { service, handle } of starting) {
            const readiness = service.readiness
                ? await this.waitFor(service as Service & { readiness: NonNullable<Service["readiness"]> }, handle)
                : { url: "none declared", expect: "nothing", waited_ms: 0, status: "not-measured" as const, detail: `${service.id} declares no readiness URL of its own, so it was started and nothing measured whether it is serving.` };
            this.serviceRecords.push({ id: service.id, command: service.run, pid: handle.pid, readiness, stopped: null, log: `services/${service.id}.log` });
            if (readiness.status !== "ready" && readiness.status !== "not-measured") {
                this.outcome = "environment";
                this.reason = `Service ${service.id} did not become ready: ${readiness.detail} No gate ran against it, so nothing was asked of the application. Nothing under services: is retried.`;
                await this.captureServices();
                throw new EnvironmentError(this.reason, this.record());
            }
        }
    }
    private async waitFor(service: Service & { readiness: NonNullable<Service["readiness"]> }, handle: ServiceHandle): Promise<ServiceRecord["readiness"]> {
        void handle;
        const expect = service.readiness.body_path ? `${service.readiness.body_path} = ${service.readiness.equals}` : `HTTP ${service.readiness.status}`;
        const began = Date.now(), deadline = began + service.readiness.timeout * 1000;
        let last = "no answer yet";
        while (Date.now() < deadline) {
            this.options.signal?.throwIfAborted();
            // Any service this run started dying ends the wait, named — exactly as ZenJev's
            // coordinator passed the whole set of processes to each readiness poll.
            for (const held of this.handles) {
                const early = held.exited();
                if (early)
                    return { url: service.readiness.url, expect, waited_ms: Date.now() - began, status: "exited-before-readiness", detail: `service ${held.id} exited (${early.signal ?? `code ${early.code}`}) before ${service.readiness.url} answered ${expect}.` };
            }
            try {
                const response = await fetch(service.readiness.url, { signal: AbortSignal.timeout(2000), redirect: "manual" });
                if (service.readiness.body_path) {
                    const body: unknown = await response.json();
                    const found = service.readiness.body_path.split(".").reduce<any>((value, key) => value == null ? value : value[key], body);
                    if (String(found) === service.readiness.equals)
                        return { url: service.readiness.url, expect, waited_ms: Date.now() - began, status: "ready", detail: `${service.readiness.url} answered with ${service.readiness.body_path} = ${service.readiness.equals}.` };
                    last = `answered HTTP ${response.status} with ${service.readiness.body_path} = ${JSON.stringify(found) ?? "absent"}`;
                }
                else if (response.status === service.readiness.status)
                    return { url: service.readiness.url, expect, waited_ms: Date.now() - began, status: "ready", detail: `${service.readiness.url} answered HTTP ${service.readiness.status}.` };
                else
                    last = `answered HTTP ${response.status}`;
            }
            catch (error) {
                last = `did not answer: ${(error as Error).message}`;
            }
            await new Promise(r => setTimeout(r, 250));
        }
        return { url: service.readiness.url, expect, waited_ms: Date.now() - began, status: "timed-out", detail: `${service.readiness.url} never answered ${expect} within ${service.readiness.timeout} s; it last ${last}.` };
    }
    private async captureServices(): Promise<void> {
        for (const handle of this.handles) {
            const capture = handle.capture();
            await this.bundle.write(`services/${handle.id}.log`, `${capture.stdout}${capture.stderr ? `\n[stderr]\n${capture.stderr}` : ""}${capture.stdout_truncated || capture.stderr_truncated ? "\n[output truncated at configured byte limit]\n" : ""}`);
        }
    }
    /** Always called, whatever happened. Stops only what this run started, then runs teardown. */
    async stop(): Promise<void> {
        for (const handle of this.handles.reverse()) {
            const stopped = await handle.stop();
            const record = this.serviceRecords.find(r => r.id === handle.id);
            if (record)
                record.stopped = { code: stopped.code, signal: stopped.signal, forced: stopped.forced };
            await this.bundle.event("service.stopped", { id: handle.id, pid: handle.pid, forced: stopped.forced });
        }
        await this.captureServices();
        this.handles.length = 0;
        for (const one of this.config.teardown) {
            try {
                const record = await this.step("teardown", one);
                this.teardownRecords.push(record);
                await this.bundle.event("teardown.finished", { id: one.id, exit_code: record.exit_code, status: record.status });
            }
            catch (error) {
                this.teardownRecords.push({ id: one.id, kind: "teardown", command: one.run, exit_code: 1, duration_ms: 0, timed_out: false, status: "failed", log: `teardown/${one.id}.log` });
                await this.bundle.event("teardown.finished", { id: one.id, status: "failed", detail: (error as Error).message });
            }
        }
    }
    record(): Orchestration {
        return {
            schema_version: "wringer.orchestration.v1", outcome: this.outcome,
            setup: this.setupRecords, services: this.serviceRecords,
            phases: this.config.phases.map(p => ({ id: p.id, needs: [...p.needs], gates: [...p.gates] })),
            teardown: this.teardownRecords,
            reason: this.outcome === "ready" ? `The declared prelude completed: ${this.setupRecords.length} setup step(s), ${this.serviceRecords.length} service(s) ready.` : this.reason,
            limits: ORCHESTRATION_LIMITS,
        };
    }
}
