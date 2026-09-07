import { spawn } from "node:child_process";
import type { AcpTransport } from "@wringer/acp";
import { RuntimeError, type RuntimeDriver, type RuntimeCommandOptions } from "./types";
export const clientEnvironment = (extra: NodeJS.ProcessEnv = {}) => Object.fromEntries(Object.entries({ ...Object.fromEntries(["PATH", "HOME", "KUBECONFIG", "CONTAINER_HOST", "XDG_RUNTIME_DIR", "TMPDIR"].map(name => [name, process.env[name]])), ...extra }).filter(([, value]) => value !== undefined)) as NodeJS.ProcessEnv;
export function connectProcess(argv: string[], options: RuntimeCommandOptions = {}): AcpTransport {
    if (!argv.length || argv.some(arg => typeof arg !== "string" || arg.includes("\0")))
        throw new RuntimeError("Invalid runtime argv");
    const child = spawn(argv[0]!, argv.slice(1), { env: clientEnvironment(options.env), stdio: ["pipe", "pipe", "pipe"], detached: true });
    child.stdin.on("error", () => { });
    const exited = new Promise<{
        code: number | null;
        signal?: string | null;
    }>(resolve => { child.once("error", error => { child.stderr.emit("data", Buffer.from(error.message)); resolve({ code: 127 }); }); child.once("close", (code, signal) => resolve({ code, signal })); });
    let terminated = false;
    return { input: child.stdin, output: child.stdout, errors: child.stderr, exited, async terminate() { if (terminated)
            return; terminated = true; try {
            if (child.pid)
                process.kill(-child.pid, "SIGTERM");
        }
        catch { } await new Promise(resolve => setTimeout(resolve, 100)); try {
            if (child.pid)
                process.kill(-child.pid, "SIGKILL");
        }
        catch { } child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); } };
}
export const processDriver: RuntimeDriver = {
    async connect(argv, options) { return connectProcess(argv, options); },
    async command(argv, options = {}) {
        const transport = connectProcess(argv, options), limit = 64 * 1024 * 1024;
        let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), overflow = false, aborted = false, timedOut = false;
        const collect = (stream: "stdout" | "stderr", chunk: Buffer) => { const previous = stream === "stdout" ? stdout : stderr; if (previous.length + chunk.length > limit) {
            overflow = true;
            void transport.terminate();
            return;
        } if (stream === "stdout")
            stdout = Buffer.concat([previous, chunk]);
        else
            stderr = Buffer.concat([previous, chunk]); };
        transport.output.on("data", chunk => collect("stdout", chunk));
        transport.errors?.on("data", chunk => collect("stderr", chunk));
        transport.input.on("error", () => { });
        transport.input.end(options.input);
        const abort = () => { aborted = true; void transport.terminate(); };
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted)
            abort();
        const timer = setTimeout(() => { timedOut = true; void transport.terminate(); }, options.timeoutMs ?? 30000);
        try {
            const result = await transport.exited;
            if (overflow)
                throw new RuntimeError("Runtime command output exceeded 64 MiB; partial output refused", "capture-limit");
            if (timedOut)
                throw new RuntimeError("Runtime command exceeded its deadline", "timeout");
            if (aborted)
                throw new RuntimeError("Runtime command was interrupted", "cancelled");
            return { code: result.code ?? 143, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") };
        }
        finally {
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", abort);
            await transport.terminate();
        }
    }
};
