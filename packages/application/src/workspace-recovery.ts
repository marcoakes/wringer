import { constants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hashBytes, hashValue } from "@wringer/plan";
import { Redactor } from "@wringer/engine";
import { assistantExists, assistantId, assistantInventory, assistantPath, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
import { readWorkspace } from "./workspaces";

function alive(pid: number): "live" | "dead" | "unknown" {
    try { process.kill(pid, 0); return "live"; }
    catch (error: any) { return error.code === "ESRCH" ? "dead" : "unknown"; }
}
async function rawRecord(root: string, path: string) {
    const file = await open(await assistantPath(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const info = await file.stat();
        if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || info.size > 16384) throw new Error("Recovery requires bounded owned records without aliases");
        const bytes = await file.readFile(); return { value: JSON.parse(bytes.toString()), identity: hashBytes(bytes), bytes: bytes.length };
    } finally { await file.close(); }
}
async function observe(root: string, directory: string, workspaceId: string, mode: string) {
    const names = await assistantInventory(root, directory);
    if (names.some(name => !["owner.lock", "connection.json", "operator.json"].includes(name)) || !names.includes("owner.lock")) throw new Error("Owner directory contains an unknown or incomplete record; inspect it without deleting evidence");
    const files = [], owner = await rawRecord(root, `${directory}/owner.lock`);
    if (owner.value.workspaceId !== workspaceId || !Number.isSafeInteger(owner.value.pid) || owner.value.pid < 1) throw new Error("Owner identity changed or is incomplete; no ownership can be released");
    for (const name of names) {
        const row = name === "owner.lock" ? owner : await rawRecord(root, `${directory}/${name}`);
        if (name === "connection.json" && (row.value.workspaceId !== workspaceId || row.value.mode !== mode || row.value.schema_version !== (mode === "verification" ? "wringer.assistant-connection.v2" : "wringer.assistant-connection.v3"))) throw new Error("Connection names another workspace or mode");
        if (name === "operator.json" && (row.value.schema_version !== "wringer.operator-location.v1" || row.value.pid !== owner.value.pid)) throw new Error("Operator location names another owner");
        files.push({ name, identity: row.identity, bytes: row.bytes });
    }
    return { pid: owner.value.pid as number, files };
}
export async function inspectWorkspaceRecovery(root: string, workspaceId: string) {
    const workspace = await readWorkspace(root, workspaceId), directory = `owners/${assistantId(workspaceId)}`;
    const observed = await observe(root, directory, workspaceId, workspace.mode), ownerState = alive(observed.pid);
    const value = { schema_version: "wringer.workspace-recovery-preview.v1", workspaceId, mode: workspace.mode, ...observed, ownerState, eligible: ownerState === "dead", action: "retain-dead-page-owner", dispatched: false, reason: "Retain the exact private page/connection records and release only confirmed dead page ownership. Domain reservations, uncertain operations, grants, publication and runner locks remain unchanged. Opening again grants no authority; inspect any domain recovery hold separately." };
    return { ...value, identity: hashValue(value) };
}
async function verifyArchive(root: string, preview: Awaited<ReturnType<typeof inspectWorkspaceRecovery>>, archived: string) {
    const retained = await observe(root, archived, preview.workspaceId, preview.mode);
    if (retained.pid !== preview.pid || hashValue(retained.files) !== hashValue(preview.files)) throw new Error("Retained owner archive differs from the exact recovery decision");
}
export async function applyWorkspaceRecovery(root: string, workspaceId: string, decision: { expectedIdentity: string; actor: string }) {
    assistantId(workspaceId);
    if (!/^[a-f0-9]{64}$/.test(decision.expectedIdentity) || typeof decision.actor !== "string" || !decision.actor.trim() || decision.actor.length > 200 || new Redactor().scrub(decision.actor) !== decision.actor) throw new Error("Use the exact recovery preview identity and recorded actor");
    const prefix = `recoveries/page-owners/${decision.expectedIdentity}`, directory = await assistantPath(root, prefix);
    if (await assistantExists(root, `${prefix}/result.json`)) {
        const result = await readAssistantRecord<any>(root, `${prefix}/result.json`);
        const retained = await readAssistantRecord<any>(root, `${prefix}/request.json`);
        if (result.workspaceId !== workspaceId || result.identity !== decision.expectedIdentity || result.retainedDirectory !== `${prefix}/private-owner` || retained.preview.workspaceId !== workspaceId || retained.preview.identity !== decision.expectedIdentity) throw new Error("Recovery result belongs to different ownership");
        await verifyArchive(root, retained.preview, result.retainedDirectory);
        return result;
    }
    let preview: Awaited<ReturnType<typeof inspectWorkspaceRecovery>>;
    if (await assistantExists(root, `${prefix}/request.json`)) {
        const retained = await readAssistantRecord<any>(root, `${prefix}/request.json`); preview = retained.preview;
        if (preview.workspaceId !== workspaceId || preview.identity !== decision.expectedIdentity || retained.actor !== decision.actor) throw new Error("Recovery request changed; retain the original decision");
    } else {
        preview = await inspectWorkspaceRecovery(root, workspaceId);
        if (preview.identity !== decision.expectedIdentity) throw new Error("Owner recovery preview changed; inspect current ownership");
        if (preview.ownerState !== "dead") throw new Error("Only a confirmed dead page owner can be recovered");
        await writeAssistantRecord(root, `${prefix}/request.json`, { schema_version: "wringer.workspace-recovery-request.v1", preview, actor: decision.actor });
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lockPath = join(directory, "recovery.lock"), lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("Recovery has an owner or was interrupted. Inspect retained recovery state before another attempt"); });
    try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, workspaceId })); await lock.sync();
        const archived = `${prefix}/private-owner`;
        if (!await assistantExists(root, archived)) {
            const current = await inspectWorkspaceRecovery(root, workspaceId);
            if (current.identity !== preview.identity || current.ownerState !== "dead") throw new Error("Owner recovery changed before retention; no records were moved");
            await rename(await assistantPath(root, `owners/${workspaceId}`), await assistantPath(root, archived));
            for (const parent of [dirname(await assistantPath(root, `owners/${workspaceId}`)), directory]) {
                const handle = await open(parent, "r"); try { await handle.sync(); } finally { await handle.close(); }
            }
        }
        await verifyArchive(root, preview, archived);
        const result = { schema_version: "wringer.workspace-recovery-result.v1", workspaceId, identity: preview.identity, retainedDirectory: archived, dispatched: false, nextAction: "Open the retained workspace deliberately. Domain uncertainty and dead runner locks require their own evidence-based reconciliation; no job, check or Send was replayed." };
        await writeAssistantRecord(root, `${prefix}/result.json`, result); return result;
    } finally { await lock.close(); await unlink(lockPath); }
}
