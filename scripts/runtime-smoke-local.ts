import { lstat } from "node:fs/promises";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { parseSmokeProfile, runtimeSmoke } from "./runtime-smoke";
import { runtimeRedactor } from "../packages/runtime/src";

export interface LocalSmokeOptions { image: string; address: string; output: string }
export function parseLocalSmokeArguments(args: string[]): LocalSmokeOptions {
    const values: Record<string, string> = {};
    if (args.length !== 6) throw new Error("Use --image EXACT_DIGEST_REF --address LOCAL_IPV4 --output NEW_DIRECTORY; no other options are accepted");
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index]!, value = args[index + 1];
        if (!["--image", "--address", "--output"].includes(key) || Object.hasOwn(values, key) || !value?.trim() || value.startsWith("--") || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Arguments must name exactly one image, local address and new output directory");
        values[key] = value;
    }
    return { image: values["--image"]!, address: values["--address"]!, output: values["--output"]! };
}
type Interfaces = Record<string, NetworkInterfaceInfo[] | undefined>;
export function localSmokePolicy(options: LocalSmokeOptions, platform: string = process.platform, interfaces: Interfaces = networkInterfaces()) {
    if (platform !== "darwin") throw new Error("This helper requires macOS and Apple container; use runtime-smoke.ts with an explicit profile on other platforms");
    // Reuse the strict image/address policy before binding any socket. Port 1
    // is validation-only; the listener always asks the OS for a free port.
    const profile = parseSmokeProfile({ runtime: { kind: "apple-container", image: options.image, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] }, networkProbe: { address: options.address, port: 1 }, timeoutMs: 600000 });
    const assigned = Object.values(interfaces).flatMap(rows => rows ?? []).some(row => row.family === "IPv4" && row.internal === false && row.address === options.address);
    if (!assigned) throw new Error("The positive-control address must be a non-loopback IPv4 address currently assigned to this Mac; third-party destinations are refused");
    if (typeof options.output !== "string" || !options.output.trim() || /[\x00-\x1f\x7f]/.test(options.output)) throw new Error("A new output directory is required");
    return profile.runtime;
}
export interface LocalSmokeListener { address: string; port: number; close(): Promise<void> }
/** No application protocol: pause every accepted socket and immediately close it. */
export async function openLocalSmokeListener(address: string): Promise<LocalSmokeListener> {
    const server = createServer({ pauseOnConnect: true }, socket => socket.destroy());
    server.maxConnections = 8;
    await new Promise<void>((done, reject) => {
        server.once("error", reject);
        server.listen({ host: address, port: 0, exclusive: true }, () => { server.off("error", reject); done(); });
    });
    const bound = server.address();
    const close = () => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    if (!bound || typeof bound === "string" || bound.address !== address || bound.family !== "IPv4" || !Number.isInteger(bound.port) || bound.port < 1) {
        await close();
        throw new Error("The local listener did not bind the exact approved address and an assigned TCP port");
    }
    return { address: bound.address, port: bound.port, close };
}
interface LocalSmokeDependencies {
    /** Deterministic unit seams only; the command line exposes no substitutes. */
    platform?: string;
    interfaces?: () => Interfaces;
    listen?: typeof openLocalSmokeListener;
    smoke?: typeof runtimeSmoke;
}
export async function runtimeSmokeLocal(options: LocalSmokeOptions, signal?: AbortSignal, dependencies: LocalSmokeDependencies = {}) {
    signal?.throwIfAborted();
    const runtime = localSmokePolicy(options, dependencies.platform ?? process.platform, (dependencies.interfaces ?? networkInterfaces)()), directory = resolve(options.output);
    try { await lstat(directory); throw new Error("Output already exists; choose a new directory. No listener or runtime was started"); }
    catch (error: any) { if (error.code !== "ENOENT") throw error; }
    signal?.throwIfAborted();
    const listener = await (dependencies.listen ?? openLocalSmokeListener)(options.address);
    try {
        if (listener.address !== options.address) throw new Error("Listener address differs from the approved local interface");
        const profile = parseSmokeProfile({ runtime, networkProbe: { address: listener.address, port: listener.port }, timeoutMs: 600000 });
        signal?.throwIfAborted();
        // A single helper owns the listener across allocation, measurement and
        // cleanup. No unrelated listener's expiration races a host approval.
        const deadline = AbortSignal.timeout(profile.timeoutMs), bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
        const report = await (dependencies.smoke ?? runtimeSmoke)(profile, directory, bounded);
        return { profile, report, directory };
    } finally { await listener.close(); }
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") console.log("bun scripts/runtime-smoke-local.ts --image EXACT_DIGEST_REF --address LOCAL_IPV4 --output NEW_DIRECTORY\nmacOS only. Address must belong to this Mac. Opens its own temporary TCP handshake listener, sends no application payload, then runs the real Apple smoke with 1 CPU, 512 MiB, deny policy, no credentials and a 600-second measurement ceiling. Closes the listener on completion, failure or interruption. No provider/model prompt; not a blind-test verdict.");
    else {
        const abort = new AbortController(), cancel = () => abort.abort(new Error("Local smoke interrupted"));
        process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
        try {
            const value = await runtimeSmokeLocal(parseLocalSmokeArguments(args), abort.signal);
            console.log(`Runtime smoke: ${value.report.status}. Evidence: ${resolve(value.directory, "report.json")}.\nActual local TCP positive control: ${value.profile.networkProbe.address}:${value.profile.networkProbe.port} (recorded in profile.json; listener closed).\nNo model prompt or provider authentication measured; not a blind-test verdict.`);
            process.exitCode = value.report.status === "pass" ? 0 : value.report.status === "fail" ? 1 : 2;
        } catch (error) { console.error(runtimeRedactor()(String(error))); process.exitCode = 2; }
        finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
    }
}
