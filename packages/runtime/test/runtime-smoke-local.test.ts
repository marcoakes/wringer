import { expect, test } from "bun:test";
import { mkdtemp, readFile, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir, type NetworkInterfaceInfo } from "node:os";
import { join } from "node:path";
import { localSmokePolicy, parseLocalSmokeArguments, runtimeSmokeLocal } from "../../../scripts/runtime-smoke-local";
import type { runtimeSmoke } from "../../../scripts/runtime-smoke";

// Synthetic interfaces/listener/measurement only. These tests open no socket,
// start no runtime and establish no live platform or provider success.
const image = `example.invalid/fixture@sha256:${"a".repeat(64)}`, address = "192.0.2.44";
const interfaces = () => ({ fixture: [{ address, family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: `${address}/24` } as NetworkInterfaceInfo] });
const options = (output = "/unused/new-smoke") => ({ image, address, output });
const fakeReport = { status: "inconclusive", modelPromptsSent: 0, providerCredentialsForwarded: false } as Awaited<ReturnType<typeof runtimeSmoke>>;

test("local smoke arguments are strict and do not offer credential, command or foreign-service switches", () => {
    expect(parseLocalSmokeArguments(["--address", address, "--output", "new-output", "--image", image])).toEqual(options("new-output"));
    for (const args of [[], ["--image", image], ["--image", image, "--address", address, "--env", "CODEX_API_KEY"], ["--image", image, "--image", image, "--output", "x"], ["--image", image, "--address", address, "--output", ""], ["--image", image, "--address", address, "--output", "x", "--command", "anything"]]) expect(() => parseLocalSmokeArguments(args)).toThrow();
});
test("only a real assigned macOS unicast IPv4 and a digest-pinned image form the fixed zero-credential policy", () => {
    const policy = localSmokePolicy(options(), "darwin", interfaces());
    expect(policy).toMatchObject({ kind: "apple-container", image, cpus: 1, memoryMiB: 512, network: { policy: "deny", allow: [], dns: [] }, env: [] });
    expect(() => localSmokePolicy(options(), "linux", interfaces())).toThrow("macOS");
    expect(() => localSmokePolicy({ ...options(), image: "mutable:latest" }, "darwin", interfaces())).toThrow();
    for (const value of ["192.0.2.45", "8.8.8.8", "127.0.0.1", "0.0.0.0", "224.0.0.1", "::1", "example.invalid"]) expect(() => localSmokePolicy({ ...options(), address: value }, "darwin", interfaces())).toThrow();
    expect(() => localSmokePolicy(options(), "darwin", { fixture: interfaces().fixture.map(row => ({ ...row, internal: true })) })).toThrow("assigned");
});
test("existing file, directory or symlink output is refused before opening any listener", async () => {
    const root = await mkdtemp(join(tmpdir(), "wringer-local-smoke-existing-")), file = join(root, "file"), link = join(root, "link");
    await writeFile(file, "Retained evidence"); await symlink(file, link);
    let opened = 0;
    for (const output of [root, file, link]) await expect(runtimeSmokeLocal(options(output), undefined, { platform: "darwin", interfaces, listen: async () => { opened++; throw new Error("Must not bind"); } })).rejects.toThrow("already exists");
    expect(opened).toBe(0); expect(await readFile(file, "utf8")).toBe("Retained evidence");
});
test("chosen ephemeral endpoint and fixed profile reach the measurement and listener closes on return", async () => {
    const root = await mkdtemp(join(tmpdir(), "wringer-local-smoke-profile-")), output = join(root, "measurement");
    const calls: string[] = [];
    const value = await runtimeSmokeLocal(options(output), undefined, {
        platform: "darwin", interfaces,
        listen: async selected => { expect(selected).toBe(address); calls.push("listen"); return { address, port: 54321, close: async () => { calls.push("close"); } }; },
        smoke: async (profile, directory, signal) => {
            calls.push("measure"); expect(signal?.aborted).toBe(false); expect(profile.timeoutMs).toBe(600000); expect(profile.networkProbe).toEqual({ address, port: 54321 }); expect(profile.runtime.env).toEqual([]);
            await mkdir(directory); await writeFile(join(directory, "profile.json"), JSON.stringify(profile));
            return fakeReport;
        },
    });
    expect(value.report.status).toBe("inconclusive"); expect(calls).toEqual(["listen", "measure", "close"]);
    expect(JSON.parse(await readFile(join(output, "profile.json"), "utf8")).networkProbe).toEqual({ address, port: 54321 });
});
test("failure, malformed listener identity and interruption close the helper-owned listener without claiming a pass", async () => {
    const root = await mkdtemp(join(tmpdir(), "wringer-local-smoke-close-"));
    let closed = 0, measured = 0;
    await expect(runtimeSmokeLocal(options(join(root, "failure")), undefined, { platform: "darwin", interfaces, listen: async () => ({ address, port: 54321, close: async () => { closed++; } }), smoke: async () => { measured++; throw new Error("Synthetic unavailable runtime"); } })).rejects.toThrow("Synthetic unavailable");
    await expect(runtimeSmokeLocal(options(join(root, "wrong-interface")), undefined, { platform: "darwin", interfaces, listen: async () => ({ address: "192.0.2.45", port: 54321, close: async () => { closed++; } }), smoke: async () => { measured++; return fakeReport; } })).rejects.toThrow("differs");
    const abort = new AbortController();
    await expect(runtimeSmokeLocal(options(join(root, "interrupted")), abort.signal, { platform: "darwin", interfaces, listen: async () => { abort.abort(new Error("Fixture interrupted")); return { address, port: 54321, close: async () => { closed++; } }; }, smoke: async () => { measured++; return fakeReport; } })).rejects.toThrow("Fixture interrupted");
    expect(closed).toBe(3); expect(measured).toBe(1);
    let opened = false;
    await expect(runtimeSmokeLocal(options(join(root, "already-aborted")), abort.signal, { platform: "darwin", interfaces, listen: async () => { opened = true; throw Error("Must not bind"); } })).rejects.toThrow("Fixture interrupted");
    expect(opened).toBe(false);
});
