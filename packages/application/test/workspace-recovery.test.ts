import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as application from "../src";
import { dispatch } from "../../cli/src/app";
const api = application as any;
async function fixture(pid: number) {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-recover-"))), workspaceId = crypto.randomUUID(); await application.createAssistantDirectory(root);
    await application.writeAssistantRecord(root, `workspaces/${workspaceId}.json`, { schema_version: "wringer.workspace.v2", id: workspaceId, mode: "verification", repo: join(root, "unused-source"), client: "generic", preferences: { destination: null, profileId: null, credentialReferences: [] }, boundary: { approval: "cooperative-local", execution: "trusted-local" }, createdAt: new Date().toISOString() });
    const owner = join(root, "owners", workspaceId); await mkdir(owner, { recursive: true, mode: 0o700 });
    await writeFile(join(owner, "owner.lock"), JSON.stringify({ pid, workspaceId, at: new Date().toISOString() }));
    await writeFile(join(owner, "connection.json"), JSON.stringify({ schema_version: "wringer.assistant-connection.v2", workspaceId, mode: "verification", endpoint: "http://127.0.0.1:1234", token: "a".repeat(64) }));
    await writeFile(join(owner, "operator.json"), JSON.stringify({ schema_version: "wringer.operator-location.v1", pid, url: `http://127.0.0.1:1235/#token=${"b".repeat(64)}` }));
    return { root, workspaceId, owner };
}
test("owner recovery refuses live ownership and exposes no private capability in its preview", async () => {
    expect(typeof api.inspectWorkspaceRecovery).toBe("function"); const f = await fixture(process.pid);
    const preview = await api.inspectWorkspaceRecovery(f.root, f.workspaceId);
    expect((await dispatch(["recover", "--workspace", f.workspaceId, "--app-dir", f.root, "--dry-run", "--json"])).value).toEqual(preview);
    expect(preview.ownerState).toBe("live"); expect(preview.eligible).toBe(false); expect(JSON.stringify(preview)).not.toContain("#token="); expect(JSON.stringify(preview)).not.toContain("a".repeat(64));
    await expect(api.applyWorkspaceRecovery(f.root, f.workspaceId, { expectedIdentity: preview.identity, actor: "Automated fixture" })).rejects.toThrow("dead");
    expect(await Bun.file(join(f.owner, "owner.lock")).exists()).toBe(true);
});
test("dead owner recovery retains private records, never dispatches, and exact retry cannot remove a replacement owner", async () => {
    expect(typeof api.inspectWorkspaceRecovery).toBe("function");
    const child = Bun.spawn([process.execPath, "-e", "process.exit(0)"], { stdout: "ignore", stderr: "ignore" }); await child.exited;
    const f = await fixture(child.pid), preview = await api.inspectWorkspaceRecovery(f.root, f.workspaceId);
    expect(preview.ownerState).toBe("dead"); expect(preview.eligible).toBe(true);
    await expect(api.applyWorkspaceRecovery(f.root, f.workspaceId, { expectedIdentity: "c".repeat(64), actor: "Automated fixture" })).rejects.toThrow("changed");
    const result = await api.applyWorkspaceRecovery(f.root, f.workspaceId, { expectedIdentity: preview.identity, actor: "Automated fixture" });
    expect(result.dispatched).toBe(false); expect(await Bun.file(join(f.owner, "owner.lock")).exists()).toBe(false);
    const kept = await Bun.file(join(f.root, result.retainedDirectory, "connection.json")).json(); expect(kept.token).toBe("a".repeat(64));
    await mkdir(f.owner, { recursive: true }); await writeFile(join(f.owner, "owner.lock"), "replacement owner");
    expect(await api.applyWorkspaceRecovery(f.root, f.workspaceId, { expectedIdentity: preview.identity, actor: "Automated fixture" })).toEqual(result);
    expect(await Bun.file(join(f.owner, "owner.lock")).text()).toBe("replacement owner");
    await writeFile(join(f.root, result.retainedDirectory, "connection.json"), JSON.stringify({ ...kept, token: "changed" }));
    await expect(api.applyWorkspaceRecovery(f.root, f.workspaceId, { expectedIdentity: preview.identity, actor: "Automated fixture" })).rejects.toThrow("archive");
    expect(await Bun.file(join(f.owner, "owner.lock")).text()).toBe("replacement owner");
});
