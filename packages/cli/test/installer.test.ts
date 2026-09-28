import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("upgrade exposes an exact artifact and rollback preview, not generic help", () => {
    const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../src/launcher.ts"), "upgrade", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("--archive PATH --sha256 HASH --release VERSION");
    expect(result.stdout.toString()).toContain("--rollback");
});

import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spyOn } from "bun:test";
import { gzipSync, gunzipSync } from "node:zlib";
import { applyInstallation, previewInstallation, type InstallSelection } from "../src/installation";
import { distributionHash, writeDistributionManifest } from "../src/distribution-manifest";
import { encodeReleaseArchive, packageReleaseArchive, readReleaseArchive, verifyReleaseArchive } from "../src/release-archive";
import { DISTRIBUTION } from "../src/routes";

import { installerFixture } from "./fixtures/installer";

test("owned offline installation upgrades and rolls back without executing the candidate or rewriting retained work", async () => {
    const f = await installerFixture(), one = await f.archive("1.0.0-test.1"), two = await f.archive("1.0.0-test.2");
    const first = await previewInstallation(one.selection); expect(first.eligible).toBe(true);
    expect(await fs.lstat(f.prefix).then(() => true, () => false)).toBe(false);
    await expect(applyInstallation(one.selection, "0".repeat(64))).rejects.toThrow("preview changed");
    await applyInstallation(one.selection, first.identity);
    expect(await fs.readlink(join(f.prefix, "bin/wring"))).toBe("../current/wring");
    await applyInstallation(two.selection, (await previewInstallation(two.selection)).identity);
    const rollback: InstallSelection = { action: "rollback", prefix: f.prefix, appDir: f.appDir };
    const back = await previewInstallation(rollback); expect(back.target?.version).toBe("1.0.0-test.1");
    await applyInstallation(rollback, back.identity);
    expect(await fs.readlink(join(f.prefix, "current"))).toBe(`versions/${first.target!.id}`);
    expect(await fs.readFile(join(f.appDir, "retained.txt"), "utf8")).toBe("unchanged evidence and uncertainty");
    expect(await fs.lstat(join(f.root, "must-not-execute")).then(() => true, () => false)).toBe(false);
    const remove: InstallSelection = { action: "uninstall", prefix: f.prefix, appDir: f.appDir }, preview = await previewInstallation(remove);
    await applyInstallation(remove, preview.identity);
    expect(await fs.readdir(join(f.prefix, "bin"))).toEqual([]);
    expect(await fs.lstat(join(f.prefix, "versions")).then(() => true, () => false)).toBe(false);
    expect(await fs.readFile(join(f.appDir, "retained.txt"), "utf8")).toBe("unchanged evidence and uncertainty");
});

test("archive checksum, version, platform, path, type, inventory and content guards reject before installation", async () => {
    const f = await installerFixture(), fixture = await f.archive("1.0.0-test.1");
    const options = { sha256: fixture.selection.sha256!, version: fixture.selection.version! };
    expect(() => verifyReleaseArchive(fixture.bytes.subarray(0, -12), options)).toThrow("SHA-256");
    expect(() => verifyReleaseArchive(fixture.bytes, { ...options, version: "1.0.0-other" })).toThrow("version/platform");
    expect(() => verifyReleaseArchive(fixture.bytes, { ...options, platform: "win32-x64" })).toThrow("version/platform");
    const entries = readReleaseArchive(fixture.bytes);
    const wrongContent = encodeReleaseArchive(entries.map(e => e.path === "wring" ? { ...e, data: Buffer.from("changed binary") } : e));
    expect(() => verifyReleaseArchive(wrongContent, { ...options, sha256: distributionHash(wrongContent) })).toThrow("content differs");
    const wrongLink = encodeReleaseArchive(entries.map(e => e.kind === "symlink" ? { ...e, target: "../../outside" } : e));
    expect(() => verifyReleaseArchive(wrongLink, { ...options, sha256: distributionHash(wrongLink) })).toThrow("content differs");
    const extra = encodeReleaseArchive([...entries, { path: "unexpected", kind: "file", mode: 0o644, data: Buffer.from("unknown"), target: "" }]);
    expect(() => verifyReleaseArchive(extra, { ...options, sha256: distributionHash(extra) })).toThrow("inventory differs");
    function tamper(change: (tar: Buffer) => void) {
        const tar = gunzipSync(fixture.bytes); change(tar); tar.fill(32, 148, 156);
        tar.write(tar.subarray(0, 512).reduce((a, b) => a + b, 0).toString(8).padStart(6, "0") + "\0 ", 148);
        const bytes = gzipSync(tar); return () => verifyReleaseArchive(bytes, { ...options, sha256: distributionHash(bytes) });
    }
    expect(tamper(tar => { tar.fill(0, 0, 100); tar.write("../outside", 0); })).toThrow("Unsafe");
    expect(tamper(tar => { tar[156] = 49; })).toThrow("type");
    expect(tamper(tar => { tar[156] = 120; })).toThrow("type");
    expect(await fs.lstat(f.prefix).then(() => true, () => false)).toBe(false);
});

test("ownership, same-version replacement, new record compatibility and in-flight migration holds preserve source state", async () => {
    const f = await installerFixture(), one = await f.archive("1.0.0-test.1"), two = await f.archive("1.0.0-test.2", true);
    await fs.mkdir(f.prefix, { mode: 0o700 }); await fs.writeFile(join(f.prefix, "unrelated"), "keep");
    await expect(previewInstallation(one.selection)).rejects.toThrow("unrelated");
    const owned = join(f.root, "owned"); one.selection.prefix = owned; two.selection.prefix = owned;
    await applyInstallation(one.selection, (await previewInstallation(one.selection)).identity);
    await fs.mkdir(join(f.appDir, "owners")); await fs.writeFile(join(f.appDir, "owners/owner.lock"), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
    const held = await previewInstallation(two.selection); expect(held.eligible).toBe(false); expect(held.holds).toContain("owner-running-close-before-switch");
    await expect(applyInstallation(two.selection, held.identity)).rejects.toThrow("held");
    await fs.unlink(join(f.appDir, "owners/owner.lock"));
    await fs.writeFile(join(f.appDir, "uncertain.json"), '{"status":"uncertain"}', { mode: 0o600 });
    expect((await previewInstallation(two.selection)).holds).toContain("uncertain-operation-reconcile-before-switch");
    await fs.unlink(join(f.appDir, "uncertain.json"));
    await applyInstallation(two.selection, (await previewInstallation(two.selection)).identity);
    const rollback = await previewInstallation({ action: "rollback", prefix: owned, appDir: f.appDir });
    expect(rollback.eligible).toBe(false); expect(rollback.holds).toContain("target-lacks-compatible-record:schema/new.schema.json");
    await fs.writeFile(join(owned, "bin/unrelated"), "keep");
    await expect(previewInstallation({ action: "uninstall", prefix: owned, appDir: f.appDir })).rejects.toThrow("Unrelated file");
    expect(await fs.readFile(join(owned, "bin/unrelated"), "utf8")).toBe("keep");
    expect(await fs.readFile(join(f.prefix, "unrelated"), "utf8")).toBe("keep");
});

test("a lost switch response resumes the exact installation and a completed replay does not switch back", async () => {
    const f = await installerFixture(), one = await f.archive("1.0.0-test.1"), preview = await previewInstallation(one.selection);
    const rename = fs.rename; let injected = false;
    const fault = spyOn(fs, "rename").mockImplementation(async (from, to) => {
        await rename(from, to); if (String(to) === join(f.prefix, "current") && !injected) { injected = true; throw new Error("injected lost switch response"); }
    });
    try { await expect(applyInstallation(one.selection, preview.identity)).rejects.toThrow("lost switch"); } finally { fault.mockRestore(); }
    const result = await applyInstallation(one.selection, preview.identity); expect(result.current).toBe(preview.target!.id);
    const two = await f.archive("1.0.0-test.2"); await applyInstallation(two.selection, (await previewInstallation(two.selection)).identity);
    const before = await fs.readlink(join(f.prefix, "current"));
    const replay = await applyInstallation(one.selection, preview.identity); expect(replay.identity).toBe(result.identity);
    expect(await fs.readlink(join(f.prefix, "current"))).toBe(before);
});

test("interrupted removal retains its exact manifest and refuses newly introduced foreign files", async () => {
    const f = await installerFixture(), one = await f.archive("1.0.0-test.1"); await applyInstallation(one.selection, (await previewInstallation(one.selection)).identity);
    const selection: InstallSelection = { action: "uninstall", prefix: f.prefix, appDir: f.appDir }, preview = await previewInstallation(selection);
    const unlink = fs.unlink; let injected = false;
    const fault = spyOn(fs, "unlink").mockImplementation(async path => {
        await unlink(path); if (String(path).endsWith("/LICENSE") && !injected) { injected = true; throw new Error("injected removal interruption"); }
    });
    try { await expect(applyInstallation(selection, preview.identity)).rejects.toThrow("removal interruption"); } finally { fault.mockRestore(); }
    const foreign = join(f.prefix, "versions", preview.state.current!, "foreign"); await fs.writeFile(foreign, "keep");
    await expect(applyInstallation(selection, preview.identity)).rejects.toThrow("unrelated data"); expect(await fs.readFile(foreign, "utf8")).toBe("keep");
    await fs.rename(foreign, join(f.root, "saved-foreign")); await applyInstallation(selection, preview.identity);
    expect(await fs.readFile(join(f.appDir, "retained.txt"), "utf8")).toBe("unchanged evidence and uncertainty");
});

test("lost final receipt cleanup is resumable and permits the next preview", async () => {
    const f = await installerFixture(), one = await f.archive("1.0.0-test.1"), preview = await previewInstallation(one.selection);
    const unlink = fs.unlink; let injected = false;
    const fault = spyOn(fs, "unlink").mockImplementation(async path => {
        if (String(path) === join(f.prefix, "pending.json") && !injected) { injected = true; throw new Error("injected receipt cleanup interruption"); }
        await unlink(path);
    });
    try { await expect(applyInstallation(one.selection, preview.identity)).rejects.toThrow("cleanup interruption"); } finally { fault.mockRestore(); }
    await applyInstallation(one.selection, preview.identity);
    expect((await previewInstallation({ action: "uninstall", prefix: f.prefix, appDir: f.appDir })).eligible).toBe(true);
});

test("a partial first ownership write leaves the destination recoverable", async () => {
    const f = await installerFixture(), one = await f.archive("1.0.0-test.1"), preview = await previewInstallation(one.selection);
    const open = fs.open; let injected = false;
    const fault = spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        const handle = await open(...args);
        if (String(args[0]).endsWith("/INSTALLATION.json") && args[1] === "wx" && !injected) {
            injected = true; const write = handle.writeFile.bind(handle);
            handle.writeFile = async () => { await write("{\"partial\""); throw new Error("injected partial ownership write"); };
        }
        return handle;
    });
    try { await expect(applyInstallation(one.selection, preview.identity)).rejects.toThrow("partial ownership"); } finally { fault.mockRestore(); }
    await applyInstallation(one.selection, preview.identity);
    expect(await fs.readlink(join(f.prefix, "current"))).toBe(`versions/${preview.target!.id}`);
});

test("migration holds derived verification reservations and runner requests without allocating or dispatching", async () => {
    const f = await installerFixture(), one = await f.archive("1.0.0-test.1"), id = crypto.randomUUID(), operationId = crypto.randomUUID();
    const job = join(f.appDir, "verification-jobs", id); await fs.mkdir(join(job, "operations"), { recursive: true, mode: 0o700 });
    const { writeAssistantRecord } = await import("@wringer/application");
    await writeAssistantRecord(f.appDir, `verification-jobs/${id}/operations/${operationId}.json`, { schema_version: "wringer.verification-operation.v1", id: operationId, jobId: id });
    const pending = await previewInstallation(one.selection); expect(pending.eligible).toBe(false); expect(pending.holds).toContain("verification-outcome-unconfirmed");
    await fs.mkdir(join(job, "observations"), { mode: 0o700 });
    await writeAssistantRecord(f.appDir, `verification-jobs/${id}/observations/${operationId}.json`, { schema_version: "wringer.verification-observation.v1", operationId, jobId: id, outcome: "completed" });
    expect((await previewInstallation(one.selection)).eligible).toBe(true);
    const { createAssistantRunner } = await import("@wringer/application"); let executions = 0;
    const runner = await createAssistantRunner(join(f.appDir, "legacy/runner"), { execute: async () => { executions++; return {}; } });
    const request = { id: crypto.randomUUID(), jobId: crypto.randomUUID(), kind: "start", body: {} };
    await runner.enqueue(request);
    const queued = await previewInstallation(one.selection); expect(queued.eligible).toBe(false); expect(queued.holds).toContain("delegation-operation-unfinished"); expect(executions).toBe(0);
    await runner.cancel(request.jobId); expect((await previewInstallation(one.selection)).eligible).toBe(true); expect(executions).toBe(0);
});
