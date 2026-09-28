import { expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dispatch } from "../../cli/src/app";
import * as application from "../src";
const api = application as any;
test("dead coordination lock recovery is exact, retains uncertainty and serializes competing recoverers", async () => {
    expect(typeof api.inspectLockRecovery).toBe("function");
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-dead-lock-"))), id = "a".repeat(64);
    await mkdir(join(root, "client-transactions"), { mode: 0o700 });
    const selected = { kind: "client", id }, path = join(root, "client-transactions", id + ".lock");
    await writeFile(path, JSON.stringify({ pid: process.pid, expected: "b".repeat(64) }), { mode: 0o600 });
    const live = await api.inspectLockRecovery(root, selected); expect(live.eligible).toBeFalse();
    await expect(api.applyLockRecovery(root, selected, live.identity, "Automated fixture")).rejects.toThrow("dead");
    const child = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "pipe" }); await child.exited;
    await writeFile(path, JSON.stringify({ pid: child.pid, expected: "b".repeat(64) }));
    const before = (await readdir(root, { recursive: true })).sort(), preview = await api.inspectLockRecovery(root, selected);
    expect((await readdir(root, { recursive: true })).sort()).toEqual(before); expect(preview.eligible).toBeTrue();
    expect((await dispatch(["recover", "--app-dir", root, "--lock-kind", "client", "--lock-id", id, "--dry-run", "--json"])).value).toEqual(preview);
    await expect(api.applyLockRecovery(root, selected, "0".repeat(64), "Automated fixture")).rejects.toThrow("changed");
    const results = await Promise.allSettled([api.applyLockRecovery(root, selected, preview.identity, "Automated fixture"), api.applyLockRecovery(root, selected, preview.identity, "Automated fixture")]);
    expect(results.filter(row => row.status === "fulfilled").length).toBeGreaterThan(0);
    expect(await Bun.file(path).exists()).toBeFalse();
    const result = await api.applyLockRecovery(root, selected, preview.identity, "Automated fixture");
    expect(result.dispatched).toBeFalse(); expect(result.uncertaintyRetained).toBeTrue();
    expect(JSON.parse(await Bun.file(join(root, result.retainedLock)).text()).pid).toBe(child.pid);
    await writeFile(path, JSON.stringify({ pid: process.pid, expected: "c".repeat(64) }));
    await api.applyLockRecovery(root, selected, preview.identity, "Automated fixture");
    expect(JSON.parse(await Bun.file(path).text()).pid).toBe(process.pid);
    await expect(api.inspectLockRecovery(root, { kind: "client", id: "../foreign" })).rejects.toThrow();
    await writeFile(join(root, result.retainedLock), JSON.stringify({ pid: process.pid }));
    await expect(api.applyLockRecovery(root, selected, preview.identity, "Automated fixture")).rejects.toThrow("changed");
});

test("OS coordination lock excludes another process and is released when its owner is killed", async () => {
    expect(typeof api.withMaintenanceLock).toBe("function");
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-maintenance-process-")));
    const child = Bun.spawn([process.execPath, new URL("./fixtures-maintenance-child.ts", import.meta.url).pathname, root], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    try {
        const reader = child.stdout.getReader(), output = await Promise.race([reader.read(), Bun.sleep(5000).then(() => { throw new Error("Owner did not take the coordination lock"); })]);
        expect(new TextDecoder().decode(output.value)).toBe("locked\n"); reader.releaseLock();
        await expect(api.withMaintenanceLock(root, async () => "unexpected")).rejects.toThrow("locked");
    } finally { child.kill("SIGKILL"); await child.exited; }
    expect(await api.withMaintenanceLock(root, async () => "recovered-without-stale-mutex")).toBe("recovered-without-stale-mutex");
}, 10000);
