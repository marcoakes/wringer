import { expect, test } from "bun:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantDirectory, writeAssistantRecord, inspectWorkspaceRecovery, applyWorkspaceRecovery } from "@wringer/application";
import { createVerificationOwner } from "../src/verification-owner";
import { callAssistantConnection } from "../src/assistant-transport";
test("an actually killed page owner can be explicitly recovered and restarted without new work", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-owner-crash-"))), id = crypto.randomUUID(); await createAssistantDirectory(root);
    await writeAssistantRecord(root, `workspaces/${id}.json`, { schema_version: "wringer.workspace.v2", id, mode: "verification", repo: join(root, "unused-source"), client: "generic", preferences: { destination: null, profileId: null, credentialReferences: [] }, boundary: { approval: "cooperative-local", execution: "trusted-local" }, createdAt: new Date().toISOString() });
    const child = Bun.spawn([process.execPath, new URL("./fixtures/verification-owner-child.ts", import.meta.url).pathname, root, id], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
    try {
        const reader = child.stdout.getReader(), first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toBe("ready\n"); reader.releaseLock();
        expect((await inspectWorkspaceRecovery(root, id)).ownerState).toBe("live");
        child.kill("SIGKILL"); await child.exited;
        const preview = await inspectWorkspaceRecovery(root, id);
        expect(preview.eligible).toBe(true);
        const recovery = await applyWorkspaceRecovery(root, id, { expectedIdentity: preview.identity, actor: "Automated owner crash fixture" });
        expect(recovery.dispatched).toBe(false);
        const owner = await createVerificationOwner(root, id);
        try {
            const result = await callAssistantConnection(owner.connectionPath, "wringer.list_jobs", {});
            expect(result.jobs).toEqual([]); expect((await inspectWorkspaceRecovery(root, id)).ownerState).toBe("live");
        } finally { await owner.stop(); }
    } finally { clearTimeout(timeout); child.kill("SIGKILL"); await child.exited; }
}, 15000);
