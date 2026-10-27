import { resolve } from "node:path";

/** Bounded read-only Git object observation for pinned source artifacts: no hook,
 * global configuration, replacement object or prompt; output capped and timed. */
export async function gitBytes(repo: string, args: string[], maximum: number): Promise<Uint8Array> {
    const child = Bun.spawn(["git", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: resolve(repo), env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => child.kill(), 10000);
    const bounded = async (stream: ReadableStream<Uint8Array>, limit: number) => { const reader = stream.getReader(), chunks: Uint8Array[] = []; let bytes = 0; try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > limit) throw new Error("Playbook Git observation exceeds its finite byte ceiling"); chunks.push(part.value); } return Buffer.concat(chunks); } catch (error) { child.kill(); throw error; } finally { reader.releaseLock(); } };
    try { const [stdout, , code] = await Promise.all([bounded(child.stdout, maximum), bounded(child.stderr, 8192), child.exited]); if (code !== 0) throw new Error("Cannot read the exact approved playbook from Git source objects"); return stdout; } finally { clearTimeout(timeout); }
}
