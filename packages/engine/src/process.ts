import { spawn } from "node:child_process";
import { EngineError, type ProcessResult } from "./types";
import { Redactor } from "./io";
const CAP = 1024 * 1024;
export interface ProcessOptions {
    cwd: string;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    redactor?: Redactor;
    maxBytes?: number;
    input?: string | Uint8Array;
    onSpawn?: (pid: number) => void;
}
export interface ServiceExit {
    code: number | null;
    signal: string | null;
    error?: string;
}
/**
 * A long-lived process this run owns.
 *
 * ZenJev's CI coordinator re-implemented all of this — detached spawn, a SIGTERM
 * that reaches the whole group, a SIGKILL after grace, streams to a log, and a
 * set of "owned" children so cancellation kills nothing it did not start. The
 * pieces were already here for bounded commands; only the not-awaited case was
 * missing.
 */
export interface ServiceHandle {
    readonly id: string;
    readonly pid: number;
    /** The exit this service made on its own, or null while it is still running. */
    exited(): ServiceExit | null;
    /** Scrubbed and capped exactly as a bounded command's capture is. */
    capture(): Pick<ProcessResult, "stdout" | "stderr" | "stdout_truncated" | "stderr_truncated">;
    /** SIGTERM to the group this run started, then SIGKILL after grace. Never another pgid. */
    stop(graceMs?: number): Promise<ServiceExit & {
        forced: boolean;
    }>;
}
export function startService(id: string, command: string | string[], options: ProcessOptions): ServiceHandle {
    if (process.platform === "win32")
        throw new EngineError("Native service supervision currently requires macOS or Linux process groups");
    const cap = options.maxBytes ?? CAP;
    const buffers = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    const size = { stdout: 0, stderr: 0 };
    const argv = typeof command === "string" ? ["/bin/sh", "-c", command] : command;
    if (!argv.length)
        throw new EngineError("Empty service argv");
    const child = spawn(argv[0]!, argv.slice(1), { cwd: options.cwd, env: options.env ?? process.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let exit: ServiceExit | null = null;
    child.once("error", e => { buffers.stderr.push(Buffer.from(`${e.message}\n`)); exit ??= { code: (e as NodeJS.ErrnoException).code === "ENOENT" ? 127 : 126, signal: null, error: e.message }; });
    child.once("close", (code, signal) => { exit ??= { code, signal }; });
    for (const stream of ["stdout", "stderr"] as const)
        child[stream]!.on("data", (b: Buffer) => {
            const before = size[stream];
            size[stream] += b.length;
            if (before < cap + 65536)
                buffers[stream].push(b.subarray(0, cap + 65536 - before));
        });
    // Only the group this call created is ever signalled, by its own leader pid.
    const own = child.pid;
    const signalGroup = (value: NodeJS.Signals) => {
        if (!own)
            return;
        try {
            process.kill(-own, value);
        }
        catch { }
    };
    const redactor = options.redactor ?? new Redactor();
    return {
        id, pid: own ?? -1,
        exited: () => exit,
        capture: () => {
            const clean = (stream: "stdout" | "stderr") => { const text = redactor.scrub(Buffer.concat(buffers[stream]).toString("utf8")); return Buffer.from(text).subarray(0, cap).toString("utf8") + (size[stream] > cap ? "\n[output truncated at configured byte limit]\n" : ""); };
            return { stdout: clean("stdout"), stderr: clean("stderr"), stdout_truncated: size.stdout > cap, stderr_truncated: size.stderr > cap };
        },
        stop: async (graceMs = 2000) => {
            const seen = () => exit as ServiceExit | null;
            if (seen())
                return { ...seen()!, forced: false };
            signalGroup("SIGTERM");
            const deadline = Date.now() + graceMs;
            while (!seen() && Date.now() < deadline)
                await new Promise(r => setTimeout(r, 50));
            if (seen())
                return { ...seen()!, forced: false };
            signalGroup("SIGKILL");
            const hard = Date.now() + 1000;
            while (!seen() && Date.now() < hard)
                await new Promise(r => setTimeout(r, 50));
            child.stdout?.destroy();
            child.stderr?.destroy();
            return { code: seen()?.code ?? null, signal: seen()?.signal ?? "SIGKILL", forced: true };
        },
    };
}
/** Pipes stay in memory until they have been scrubbed; descendants share a reapable POSIX group. */
export async function runProcess(command: string | string[], options: ProcessOptions): Promise<ProcessResult> {
    if (process.platform === "win32")
        throw new EngineError("Native worker supervision currently requires macOS or Linux process groups");
    const started = performance.now();
    const cap = options.maxBytes ?? CAP;
    const buffers = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    const size = { stdout: 0, stderr: 0 };
    let timed_out = false, interrupted = false;
    const argv = typeof command === "string" ? ["/bin/sh", "-c", command] : command;
    if (!argv.length)
        throw new EngineError("Empty subprocess argv");
    const child = spawn(argv[0]!, argv.slice(1), { cwd: options.cwd, env: options.env ?? process.env, detached: true, stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    if (options.input !== undefined) {
        child.stdin!.on("error", () => { });
        child.stdin!.end(options.input);
    }
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = () => {
        if (!child.pid)
            return;
        try {
            process.kill(-child.pid, "SIGTERM");
        }
        catch { }
        killTimer = setTimeout(() => {
            try {
                process.kill(-child.pid!, "SIGKILL");
            }
            catch { }
        }, 150);
    };
    const abort = () => { interrupted = true; kill(); };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted)
        abort();
    options.onSpawn?.(child.pid!);
    for (const stream of ["stdout", "stderr"] as const)
        child[stream]!.on("data", (b: Buffer) => {
            const before = size[stream];
            size[stream] += b.length;
            if (before < cap + 65536)
                buffers[stream].push(b.subarray(0, cap + 65536 - before));
        });
    const timer = setTimeout(() => { timed_out = true; kill(); }, (options.timeout ?? 120) * 1000);
    let closed = false;
    let exit = 1;
    await new Promise<void>((done) => {
        let drain: ReturnType<typeof setTimeout> | undefined;
        const finish = (code: number) => {
            if (closed)
                return;
            closed = true;
            exit = code;
            if (drain)
                clearTimeout(drain);
            done();
        };
        child.once("error", e => { buffers.stderr.push(Buffer.from(e.message)); finish((e as NodeJS.ErrnoException).code === "ENOENT" ? 127 : 126); });
        child.once("close", (code, signal) => finish(code ?? (signal === "SIGKILL" ? 137 : 143)));
        child.once("exit", (code, signal) => {
            drain = setTimeout(() => { kill(); child.stdout?.destroy(); child.stderr?.destroy(); finish(code ?? (signal === "SIGKILL" ? 137 : 143)); }, 250);
        });
    });
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    // Always finish the TERM/KILL sequence even if the leader exited early.
    if (killTimer)
        await new Promise<void>(r => setTimeout(r, 175));
    const redactor = options.redactor ?? new Redactor();
    const clean = (stream: "stdout" | "stderr") => { const text = redactor.scrub(Buffer.concat(buffers[stream]).toString("utf8")); const bytes = Buffer.from(text); return bytes.subarray(0, cap).toString("utf8") + (size[stream] > cap ? "\n[output truncated at configured byte limit]\n" : ""); };
    return { exit_code: exit, duration_ms: Math.max(0, Math.round(performance.now() - started)), timed_out, interrupted, stdout: clean("stdout"), stderr: clean("stderr"), stdout_truncated: size.stdout > cap, stderr_truncated: size.stderr > cap };
}
