import { validateAdoptionRecord } from "./adoption-records";
import { Database } from "bun:sqlite";
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hashBytes, hashValue } from "@wringer/plan";
import { Redactor } from "@wringer/engine";
import { assistantExists, assistantId, assistantPath, createAssistantDirectory, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
const sha = (id: string) => { if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Use the exact retained SHA-256 identity"); return id; };
export interface LockSelection { kind: "client" | "acceptance" | "profile" | "page-recovery" | "proposal" | "verification" | "verification-send" | "verification-prepare" | "runtime" | "delegation-preparation" | "runner-recovery"; id: string; workspaceId?: string; }
function lockName(selection: LockSelection) {
    switch (selection.kind) {
        case "client": return `client-transactions/${sha(selection.id)}.lock`;
        case "acceptance": return `acceptance-preparations/${assistantId(selection.id)}/preparation.lock`;
        case "profile": return `profiles/${assistantId(selection.id)}/preparation.lock`;
        case "page-recovery": return `recoveries/page-owners/${sha(selection.id)}/recovery.lock`;
        case "verification-send": return `verification-jobs/${assistantId(selection.id)}/send.lock`;
        case "verification-prepare": return `verification-jobs/${assistantId(selection.id)}/prepare.lock`;
        case "verification": return `verification-jobs/${assistantId(selection.id)}/execution.lock`;
        case "runtime": return `provisions/${assistantId(selection.id)}/operation.lock`;
        case "delegation-preparation": return `delegation-preparation/${assistantId(selection.id)}/proposal-decision.lock`;
        case "proposal": return `delegation-controllers/${assistantId(selection.workspaceId)}/${assistantId(selection.id)}/proposal-decision.lock`;
        case "runner-recovery": return `delegation-controllers/${assistantId(selection.workspaceId)}/${assistantId(selection.id)}/runner/recovery.json`;
        default: throw new Error("Select a declared coordination lock kind");
    }
}
function alive(pid: number) { try { process.kill(pid, 0); return "live"; } catch (error: any) { return error.code === "ESRCH" ? "dead" : "unknown"; } }
async function lockBytes(root: string, name: string) {
    const file = await open(await assistantPath(root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.mode & 0o077 || stat.size > 16384) throw new Error("Expected a private bounded owned coordination record without aliases");
        return await file.readFile();
    } finally { await file.close(); }
}
/** SQLite supplies a process-scoped OS write lock. A killed maintainer cannot
 * leave another stale application mutex that would itself need manual removal.
 * No execution state or authority is stored in this coordination database. */
export async function withMaintenanceLock<T>(root: string, action: () => Promise<T>): Promise<T> {
    await createAssistantDirectory(root);
    const directory = await assistantPath(root, "maintenance"); await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = await assistantPath(root, "maintenance/coordinator.sqlite");
    try { const file = await open(path, "wx", 0o600); await file.close(); } catch (error: any) { if (error.code !== "EEXIST") throw error; }
    for (const item of [path, path + "-journal", path + "-wal", path + "-shm"]) {
        await assistantPath(root, item);
        try { const info = await lstat(item); if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || info.mode & 0o077 || info.size > 1024 * 1024) throw new Error("Maintenance coordinator ownership changed"); }
        catch (error: any) { if (error.code !== "ENOENT") throw error; }
    }
    const db = new Database(path, { create: false, strict: true });
    try {
        db.exec("PRAGMA busy_timeout=0");
        db.exec("BEGIN IMMEDIATE");
        const identifier = (db.query("PRAGMA application_id").get() as any).application_id;
        if (identifier !== 0x57524d31 && (identifier !== 0 || (db.query("SELECT count(*) AS n FROM sqlite_master").get() as any).n !== 0)) throw new Error("This database is not the Wringer maintenance coordinator");
        db.exec("PRAGMA application_id=1465011505");
        const result = await action(); db.exec("COMMIT"); return result;
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
    finally { db.close(); }
}
export async function inspectLockRecovery(root: string, selection: LockSelection) {
    const path = lockName(selection), bytes = await lockBytes(root, path), owner = JSON.parse(bytes.toString());
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error("This older or incomplete lock has no confirmed owner PID; no automatic release is available");
    const ownerState = alive(owner.pid);
    const value = { schema_version: "wringer.lock-recovery-preview.v1", selection, path, pid: owner.pid as number, lockIdentity: hashBytes(bytes), ownerState, eligible: ownerState === "dead", action: "retain-dead-coordination-lock", dispatched: false, uncertaintyRetained: true, nextAction: "Only coordination ownership can be released. Reinspect the original transaction; uncertain checks, provider work and publication remain reserved. No setup, check, job or Send is replayed." };
    const preview = { ...value, identity: hashValue(value) };
    await validateAdoptionRecord(preview); return preview;
}
export async function applyLockRecovery(root: string, selection: LockSelection, expected: string, actor: string) {
    sha(expected); lockName(selection);
    if (!actor.trim() || actor.length > 200 || new Redactor().scrub(actor) !== actor) throw new Error("Record the bounded recovery actor without credentials");
    return withMaintenanceLock(root, async () => {
        const prefix = `maintenance/lock-recoveries/${expected}`, retainedLock = `${prefix}/private.lock`;
        if (await assistantExists(root, `${prefix}/result.json`)) {
            const result = await readAssistantRecord<any>(root, `${prefix}/result.json`), request = await readAssistantRecord<any>(root, `${prefix}/request.json`);
            if (hashValue(request.preview.selection) !== hashValue(selection) || result.identity !== expected || hashBytes(await lockBytes(root, retainedLock)) !== request.preview.lockIdentity) throw new Error("Retained recovery identity changed");
            return result;
        }
        let preview;
        if (await assistantExists(root, `${prefix}/request.json`)) {
            const request = await readAssistantRecord<any>(root, `${prefix}/request.json`); preview = request.preview;
            if (preview.identity !== expected || hashValue(preview.selection) !== hashValue(selection) || request.actor !== actor) throw new Error("Resume the exact retained recovery decision");
        } else {
            preview = await inspectLockRecovery(root, selection);
            if (preview.identity !== expected) throw new Error("Coordination lock preview changed");
            if (!preview.eligible) throw new Error("Only a confirmed dead owner can be released");
            await writeAssistantRecord(root, `${prefix}/request.json`, { schema_version: "wringer.lock-recovery-request.v1", preview, actor });
        }
        if (await assistantExists(root, preview.path)) {
            const current = await inspectLockRecovery(root, selection);
            if (current.identity !== expected || !current.eligible) throw new Error("Coordination ownership changed; retain the archive and inspect the current owner");
            const bytes = await lockBytes(root, preview.path);
            if (!await assistantExists(root, retainedLock)) {
                const output = await open(await assistantPath(root, retainedLock), "wx", 0o600); try { await output.writeFile(bytes); await output.sync(); } finally { await output.close(); }
            }
            if (hashBytes(await lockBytes(root, retainedLock)) !== preview.lockIdentity || (await inspectLockRecovery(root, selection)).identity !== expected) throw new Error("Coordination lock changed before release");
            await unlink(await assistantPath(root, preview.path));
            for (const path of [dirname(await assistantPath(root, preview.path)), await assistantPath(root, prefix)]) { const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } }
        } else if (!await assistantExists(root, retainedLock) || hashBytes(await lockBytes(root, retainedLock)) !== preview.lockIdentity) throw new Error("Missing original lock and retained recovery evidence; no completion can be inferred");
        const result = { schema_version: "wringer.lock-recovery-result.v1", identity: expected, selection, retainedLock, dispatched: false, uncertaintyRetained: true, nextAction: preview.nextAction };
        await writeAssistantRecord(root, `${prefix}/result.json`, result); return result;
    });
}
