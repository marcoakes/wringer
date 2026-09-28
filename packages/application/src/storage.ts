import { validateAdoptionRecord } from "./adoption-records";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readdir, rename, rmdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hashValue } from "@wringer/plan";
import { Redactor } from "@wringer/engine";
import { assistantExists, assistantId, assistantInventory, assistantPath, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
import { withMaintenanceLock } from "./maintenance";
export interface PreparationSelection { kind: "acceptance" | "profile"; id: string; }
type Entry = { path: string; kind: "file" | "directory"; bytes: number; inode: string; modified: string; mode: number; sha256: string | null };
function location(selected: PreparationSelection) {
    assistantId(selected.id);
    if (!["acceptance", "profile"].includes(selected.kind)) throw new Error("Select acceptance or profile preparation; job, provider and publication evidence is never removed here");
    return `${selected.kind === "acceptance" ? "acceptance-preparations" : "profiles"}/${selected.id}`;
}
function identity(value: string) { if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Use an exact SHA-256 preview identity"); return value; }
function actor(value: string) { if (!value.trim() || value.length > 200 || new Redactor().scrub(value) !== value) throw new Error("Use a bounded recorded actor without credentials"); }
async function syncParent(path: string) { const file = await open(dirname(path), "r"); try { await file.sync(); } finally { await file.close(); } }
async function tree(root: string, prefix: string): Promise<Entry[]> {
    const rows: Entry[] = [];
    async function visit(relative: string) {
        if (rows.length >= 100000) throw new Error("Owned storage exceeds the bounded inventory; no partial archive is selected");
        const path = await assistantPath(root, relative ? `${prefix}/${relative}` : prefix), info = await lstat(path, { bigint: true });
        if (Number(info.uid) !== process.getuid?.() || info.isSymbolicLink() || !info.isFile() && !info.isDirectory() || info.isFile() && info.nlink !== 1n) throw new Error("Owned archive inventory contains a foreign owner, link or special entry");
        let sha256: string | null = null;
        if (info.isFile()) {
            const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            try {
                const current = await handle.stat({ bigint: true });
                if (current.ino !== info.ino || current.size !== info.size || current.mtimeNs !== info.mtimeNs) throw new Error("Preparation bytes changed while inspecting");
                const hash = createHash("sha256"); for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
                const after = await handle.stat({ bigint: true }); if (after.size !== current.size || after.mtimeNs !== current.mtimeNs) throw new Error("Preparation bytes changed while inspecting");
                sha256 = hash.digest("hex");
            } finally { await handle.close(); }
        }
        rows.push({ path: relative, kind: info.isDirectory() ? "directory" : "file", bytes: info.isFile() ? Number(info.size) : 0, inode: String(info.ino), modified: String(info.mtimeNs), mode: Number(info.mode) & 0o777, sha256 });
        if (info.isDirectory()) for (const name of (await readdir(path)).sort()) await visit(relative ? `${relative}/${name}` : name);
    }
    await visit("");
    if (Buffer.byteLength(JSON.stringify(rows)) > 1024 * 1024) throw new Error("Owned archive manifest exceeds its retained byte bound");
    return rows;
}
/** Inspection is read-only and never follows a link into a source/home tree. */
export async function inspectOwnedStorage(root: string) {
    const categories = [];
    let entries = 0, bytes = 0, links = 0;
    async function size(path: string): Promise<number> {
        if (++entries > 100000) throw new Error("Storage inventory exceeds 100000 entries; no partial total is reported");
        const info = await lstat(path);
        if (info.isSymbolicLink()) { links++; return info.size; }
        if (!info.isDirectory()) return info.size;
        let total = 0; for (const name of await readdir(path)) total += await size(join(path, name)); return total;
    }
    for (const name of await assistantInventory(root, ".")) { const measured = await size(join(root, name)); categories.push({ name, bytes: measured }); bytes += measured; }
    const result = { schema_version: "wringer.storage-use.v1", bytes, entries, linksNotFollowed: links, categories, removable: "Only separately previewed archives of incomplete owned local preparations. Jobs, uncertainty, publication lineage, credentials and client backups are retained." };
    await validateAdoptionRecord(result); return result;
}
async function preparation(root: string, selected: PreparationSelection) {
    const path = location(selected), indexRoot = selected.kind === "acceptance" ? "acceptance-index" : "profile-index";
    const registrations = [];
    for (const name of await assistantInventory(root, indexRoot)) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error("Preparation registry is unreadable");
        const value = await readAssistantRecord<any>(root, `${indexRoot}/${name}`);
        if (value.id === selected.id) { if (value.identity !== name.slice(0, -5)) throw new Error("Preparation registration changed"); registrations.push({ name, identity: hashValue(value) }); }
    }
    if (registrations.length !== 1) throw new Error("Select exactly one registered owned preparation");
    if (await assistantExists(root, `${path}/${selected.kind === "acceptance" ? "result.json" : "profile-record.json"}`)) throw new Error("A completed preparation must be retained for its jobs; only incomplete local preparation outputs can be archived");
    if (await assistantExists(root, `${path}/preparation.lock`)) {
        const file = await open(await assistantPath(root, `${path}/preparation.lock`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        let owner;
        try { if ((await file.stat()).size > 16384) throw new Error("Preparation lock exceeds its bound"); owner = JSON.parse(await file.readFile("utf8")); } finally { await file.close(); }
        if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error("Preparation ownership is unknown; it cannot be archived");
        try { process.kill(owner.pid, 0); throw new Error("Preparation owner is live; no active outputs can be archived"); }
        catch (error: any) { if (error.code !== "ESRCH") throw error; }
    }
    const files = await tree(root, path), value = { schema_version: "wringer.preparation-archive-preview.v1", selected, registrations, dataIdentity: hashValue(files), bytes: files.reduce((n, row) => n + row.bytes, 0), entries: files.length, action: "retain-incomplete-local-preparation", discardedAuthority: false, note: "Retain this private incomplete source copy, leaving its registration and original repository intact. Repeating the original exact setup decision may then rebuild the local preparation. No runtime, job, provider call or publication is resumed." };
    const preview = { ...value, identity: hashValue(value) }; await validateAdoptionRecord(preview);
    return { preview, files, path };
}
export async function previewPreparationArchive(root: string, selected: PreparationSelection) { return (await preparation(root, selected)).preview; }
export async function archivePreparation(root: string, selected: PreparationSelection, expected: string, actorName: string) {
    identity(expected); actor(actorName); location(selected);
    return withMaintenanceLock(root, async () => {
        const prefix = `maintenance/preparation-archives/${expected}`, retainedDirectory = `${prefix}/data`;
        const requestPath = `${prefix}/request.json`, resultPath = `${prefix}/result.json`;
        let request: any;
        if (await assistantExists(root, requestPath)) {
            request = await readAssistantRecord<any>(root, requestPath);
            if (request.preview.identity !== expected || hashValue(request.preview.selected) !== hashValue(selected)) throw new Error("Archive decision belongs to different preparation");
        } else {
            const current = await preparation(root, selected);
            if (current.preview.identity !== expected) throw new Error("Preparation archive preview changed");
            request = { schema_version: "wringer.preparation-archive-request.v1", preview: current.preview, files: current.files, actor: actorName };
            await writeAssistantRecord(root, requestPath, request);
        }
        if (await assistantExists(root, resultPath)) {
            const result = await readAssistantRecord<any>(root, resultPath);
            if (await assistantExists(root, retainedDirectory) && hashValue(await tree(root, retainedDirectory)) !== request.preview.dataIdentity) throw new Error("Retained preparation archive changed");
            if (!await assistantExists(root, retainedDirectory) && !await assistantExists(root, `${prefix}/removal-result.json`)) throw new Error("Retained archive is missing without a removal receipt");
            return result;
        }
        if (!await assistantExists(root, retainedDirectory)) {
            const current = await preparation(root, selected);
            if (current.preview.identity !== expected) throw new Error("Preparation changed before archive retention");
            await rename(await assistantPath(root, current.path), await assistantPath(root, retainedDirectory));
            await syncParent(await assistantPath(root, current.path)); await syncParent(await assistantPath(root, retainedDirectory));
        }
        if (hashValue(await tree(root, retainedDirectory)) !== request.preview.dataIdentity) throw new Error("Retained archive differs from the reviewed preparation");
        const result = { schema_version: "wringer.preparation-archive-result.v1", identity: expected, selected, retainedDirectory, dispatched: false, registrationRetained: true };
        await writeAssistantRecord(root, resultPath, result); return result;
    });
}
export async function previewArchiveRemoval(root: string, archiveId: string) {
    identity(archiveId);
    const prefix = `maintenance/preparation-archives/${archiveId}`, request = await readAssistantRecord<any>(root, `${prefix}/request.json`), result = await readAssistantRecord<any>(root, `${prefix}/result.json`);
    if (result.identity !== archiveId || request.preview.identity !== archiveId || result.retainedDirectory !== `${prefix}/data`) throw new Error("Owned archive identity changed");
    const files = await tree(root, `${prefix}/data`);
    if (hashValue(files) !== request.preview.dataIdentity) throw new Error("Archive changed; no removal is proposed");
    const value = { schema_version: "wringer.archive-removal-preview.v1", archiveId, archiveIdentity: request.preview.dataIdentity, bytes: request.preview.bytes, entries: files.length, action: "remove-selected-private-preparation-copy", retained: ["archive decision and manifest", "removal receipt", "preparation registration", "all jobs, uncertainty and publication lineage"] };
    const preview = { ...value, identity: hashValue(value) }; await validateAdoptionRecord(preview); return preview;
}
export async function removePreparationArchive(root: string, archiveId: string, expected: string, actorName: string) {
    identity(archiveId); identity(expected); actor(actorName);
    return withMaintenanceLock(root, async () => {
        const prefix = `maintenance/preparation-archives/${archiveId}`, decisionPath = `${prefix}/removal-decision.json`, resultPath = `${prefix}/removal-result.json`;
        let decision: any;
        if (await assistantExists(root, decisionPath)) {
            decision = await readAssistantRecord<any>(root, decisionPath);
            if (decision.preview.identity !== expected || decision.preview.archiveId !== archiveId) throw new Error("Removal decision changed");
        } else {
            const preview = await previewArchiveRemoval(root, archiveId);
            if (preview.identity !== expected) throw new Error("Removal preview changed");
            decision = { schema_version: "wringer.archive-removal-decision.v1", preview, actor: actorName };
            await writeAssistantRecord(root, decisionPath, decision);
        }
        if (await assistantExists(root, resultPath)) return readAssistantRecord<any>(root, resultPath);
        const request = await readAssistantRecord<any>(root, `${prefix}/request.json`);
        if (hashValue(request.files) !== request.preview.dataIdentity || request.preview.dataIdentity !== decision.preview.archiveIdentity || request.files.some((row: Entry) => row.path !== "" && (row.path.startsWith("/") || row.path.includes("\\") || row.path.split("/").some(part => !part || part === "." || part === "..")))) throw new Error("Archive manifest changed or escapes its retained directory");
        // Only manifest-listed entries may be removed, deepest first. Missing
        // entries can be an interrupted removal; unknown additions are preserved.
        const rows = [...request.files as Entry[]].sort((a, b) => b.path.split("/").length - a.path.split("/").length || b.path.localeCompare(a.path));
        for (const row of rows) {
            const path = await assistantPath(root, row.path ? `${prefix}/data/${row.path}` : `${prefix}/data`);
            let info; try { info = await lstat(path, { bigint: true }); } catch (error: any) { if (error.code === "ENOENT") continue; throw error; }
            if (String(info.ino) !== row.inode || Number(info.uid) !== process.getuid?.() || info.isSymbolicLink()) throw new Error("Selected archive entry changed during removal; remaining bytes retained");
            if (row.kind === "directory") { if (!info.isDirectory()) throw new Error("Archive entry type changed"); await rmdir(path); }
            else {
                const actual = await tree(root, row.path ? `${prefix}/data/${row.path}` : `${prefix}/data`);
                if (actual.length !== 1 || actual[0]!.sha256 !== row.sha256 || actual[0]!.modified !== row.modified) throw new Error("Archive file changed during removal");
                await unlink(path);
            }
        }
        await syncParent(await assistantPath(root, `${prefix}/data`));
        const result = { schema_version: "wringer.archive-removal-result.v1", archiveId, identity: expected, removed: true, retainedLineage: true };
        await writeAssistantRecord(root, resultPath, result); return result;
    });
}
