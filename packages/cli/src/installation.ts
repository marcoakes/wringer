import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, readlink, realpath, rename, rmdir, statfs, symlink, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { withMaintenanceLock, createAssistantRunner } from "@wringer/application";
import { distributionHash as hash, RELEASE_REPOSITORY, releaseVersion, verifyDistributionManifest, type ReleaseManifest } from "./distribution-manifest";
import { extractReleaseArchive, verifyReleaseArchive } from "./release-archive";
import { DISTRIBUTION } from "./routes";

const digest = (value: unknown) => hash(JSON.stringify(value));
const names = ["wring", ...DISTRIBUTION.aliases.map(row => row.alias)];
const versionId = (id: string) => typeof id === "string" && /^[a-zA-Z0-9.-]+-[a-f0-9]{64}$/.test(id) && id.length <= 145;
interface InstalledVersion { id: string; version: string; archiveSha256: string; manifestSha256: string; }
interface InstallationState { schema_version: "wringer.installation.v1"; repository: typeof RELEASE_REPOSITORY; sequence: number; current: string | null; previous: string | null; versions: InstalledVersion[]; }
export interface InstallSelection { action: "install" | "rollback" | "uninstall"; prefix: string; appDir: string; archive?: string; sha256?: string; version?: string; }
export const installationDirectory = () => process.platform === "darwin" ? join(homedir(), "Library/Application Support/WringerInstall") : join(homedir(), ".local/share/wringer-install");
const emptyState = (): InstallationState => ({ schema_version: "wringer.installation.v1", repository: RELEASE_REPOSITORY, sequence: 0, current: null, previous: null, versions: [] });
async function exists(path: string) { try { await lstat(path); return true; } catch (error: any) { if (error.code === "ENOENT") return false; throw error; } }
async function safePath(path: string) {
    const absolute = resolve(path), parent = dirname(absolute);
    if (parent !== absolute) await safePath(parent);
    try { const s = await lstat(absolute); if (s.isSymbolicLink()) throw new Error("Installation path contains a symlink"); }
    catch (error: any) { if (error.code !== "ENOENT") throw error; }
    return absolute;
}
async function ownedFile(path: string, maxBytes = 2 * 1024 * 1024) {
    await safePath(path);
    const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { const s = await f.stat(); if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid?.() || s.mode & 0o022 || s.size > maxBytes) throw new Error("Expected an owned bounded regular installation file"); return await f.readFile(); }
    finally { await f.close(); }
}
async function syncDir(path: string) { const f = await open(path, "r"); try { await f.sync(); } finally { await f.close(); } }
async function atomicJson(path: string, value: unknown) {
    const temp = `${path}.${crypto.randomUUID()}.tmp`, f = await open(temp, "wx", 0o600);
    try { await f.writeFile(JSON.stringify(value, null, 2) + "\n"); await f.sync(); } finally { await f.close(); }
    await rename(temp, path); await syncDir(dirname(path));
}
async function stateAt(prefix: string): Promise<InstallationState> {
    await safePath(prefix);
    if (!await exists(prefix)) return emptyState();
    const info = await lstat(prefix); if (!info.isDirectory() || info.uid !== process.getuid?.() || info.mode & 0o077) throw new Error("Installation prefix must be a private user-owned directory");
    if (!await exists(join(prefix, "INSTALLATION.json"))) {
        if ((await readdir(prefix)).length) throw new Error("Refusing an unrelated nonempty installation prefix"); return emptyState();
    }
    const value = JSON.parse((await ownedFile(join(prefix, "INSTALLATION.json"))).toString()) as InstallationState;
    if (value.schema_version !== "wringer.installation.v1" || value.repository !== RELEASE_REPOSITORY || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !Array.isArray(value.versions) || value.versions.length > 32 || new Set(value.versions.map(v => v.id)).size !== value.versions.length || value.versions.some(v => !versionId(v.id) || !releaseVersion(v.version) || !/^[a-f0-9]{64}$/.test(v.archiveSha256) || !/^[a-f0-9]{64}$/.test(v.manifestSha256) || v.id !== `${v.version}-${v.archiveSha256}`) || [value.current, value.previous].some(id => id !== null && !value.versions.some(v => v.id === id))) throw new Error("Invalid installation ownership manifest");
    return value;
}
async function installedManifest(prefix: string, version: InstalledVersion) {
    const root = join(prefix, "versions", version.id); await safePath(root);
    if (hash(await ownedFile(join(root, "DISTRIBUTION.json"))) !== version.manifestSha256) throw new Error("Installed manifest identity changed");
    const m = await verifyDistributionManifest(root);
    if (m.version !== version.version || `${m.platform}-${m.arch}` !== `${process.platform}-${process.arch}`) throw new Error("Installed identity differs"); return m;
}
async function checkLink(path: string, target: string | null) {
    if (!await exists(path)) { if (target !== null) throw new Error(`Owned launcher is missing: ${path}`); return; }
    const info = await lstat(path);
    if (target === null || !info.isSymbolicLink() || await readlink(path) !== target) throw new Error("Refusing to replace an unrelated launcher or changed current link");
}
async function checkLaunchers(prefix: string, state: InstallationState) {
    await checkLink(join(prefix, "current"), state.current ? `versions/${state.current}` : null);
    await safePath(join(prefix, "bin"));
    if (await exists(join(prefix, "bin"))) for (const name of await readdir(join(prefix, "bin"))) if (!names.includes(name as any)) throw new Error("Unrelated file in launcher directory; it will not be removed");
    for (const name of names) await checkLink(join(prefix, "bin", name), state.current ? `../current/${name}` : null);
}
/** Metadata-only migration preflight: no source checkout traversal, credentials,
 * controller writes, renewal, dispatch or legacy record transformation. */
export async function inspectInstallationState(appDir: string) {
    await safePath(appDir); const root = resolve(appDir), held: string[] = [], queues = new Set<string>(); let records = 0, entries = 0;
    if (!await exists(root)) return { records, holds: held, migrated: false, policy: "retain-records-and-read-original-semantics" };
    const info = await lstat(root); if (!info.isDirectory() || info.uid !== process.getuid?.() || info.mode & 0o077) throw new Error("Application state directory ownership differs");
    async function walk(path: string, depth: number) {
        if (depth > 12) throw new Error("State inspection depth exceeded; select a bounded application root");
        for (const entry of await readdir(path, { withFileTypes: true })) {
            if (++entries > 100000) throw new Error("State inspection exceeds its entry limit");
            const full = join(path, entry.name);
            // Project clones, provider transcripts, exports and large evidence stay opaque.
            if (["maintenance", "bundles", "source", "checkout", "repository", "repo", "worktrees", ".git", "private-audit", "runtime", "provisions", "profiles", "acceptance-preparations"].includes(entry.name)) continue;
            if (entry.isSymbolicLink()) { held.push("state-symlink-requires-inspection"); continue; }
            if (entry.isDirectory()) { await walk(full, depth + 1); continue; }
            if (!entry.isFile()) { held.push("state-special-entry-requires-inspection"); continue; }
            if (!/\.(json|lock)$/.test(entry.name)) continue;
            const s = await lstat(full); if (s.size > 2 * 1024 * 1024) { held.push("state-record-exceeds-inspection-limit"); continue; }
            let record: any; try { record = JSON.parse((await ownedFile(full)).toString()); } catch { held.push("unreadable-state-record"); continue; } records++;
            if (/\.lock$/.test(entry.name) || ["owner.json", "operator.json"].includes(entry.name)) {
                if (!Number.isSafeInteger(record.pid) || record.pid < 1) { held.push("unresolved-owner-record"); continue; }
                try { process.kill(record.pid, 0); held.push("owner-running-close-before-switch"); }
                catch (error: any) { if (error.code !== "ESRCH") held.push("owner-status-unknown"); }
            }
            if (["wringer.verification-operation.v1", "wringer.verification-operation.v2"].includes(record.schema_version)) {
                const { readVerificationObservation } = await import("@wringer/application");
                const value = await readVerificationObservation(root, record.jobId, record.id);
                if (!value || value.schema_version !== "wringer.verification-observation.v1" || value.operationId !== record.id || value.jobId !== record.jobId || !["completed", "interrupted"].includes(value.outcome)) held.push("verification-outcome-unconfirmed");
            }
            if (record.schema_version === "wringer.verification-send.v1" && !await exists(join(path, "publication.json"))) held.push("verification-publication-unconfirmed");
            if (record.schema_version === "wringer.assistant-runner-request.v1") queues.add(dirname(dirname(path)));
            if (!String(record.schema_version).startsWith("wringer.assistant-runner-") && (record.uncertain === true || record.status === "uncertain" || record.state === "uncertain")) held.push("uncertain-operation-reconcile-before-switch");
        }
    }
    await walk(root, 0);
    for (const directory of queues) {
        const runner = await createAssistantRunner(directory, { createStorage: false, execute: async () => { throw new Error("Migration inspection cannot dispatch"); } });
        if ((await runner.list()).some(operation => ["accepted", "running", "cancel-requested", "uncertain"].includes(operation.status))) held.push("delegation-operation-unfinished");
    }
    return { records, holds: [...new Set(held)].sort(), migrated: false, policy: "retain-records-and-read-original-semantics" };
}
function compatibility(current: ReleaseManifest | null, target: ReleaseManifest | null) {
    if (!current || !target) return [];
    const files = new Map(target.files.map(file => [file.path, file]));
    return current.files.filter(f => f.path.startsWith("schema/") && f.kind === "file" && (files.get(f.path)?.kind !== "file" || (files.get(f.path) as any).sha256 !== f.sha256)).map(f => `target-lacks-compatible-record:${f.path}`);
}
async function archiveFor(selection: InstallSelection) {
    if (!selection.archive || !selection.sha256 || !selection.version || !releaseVersion(selection.version)) throw new Error("Select --archive PATH --sha256 HASH --release VERSION");
    const file = await open(resolve(selection.archive), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { const s = await file.stat(); if (!s.isFile() || s.size > 256 * 1024 * 1024) throw new Error("Use a bounded regular release archive"); return verifyReleaseArchive(await file.readFile(), { sha256: selection.sha256, version: selection.version }); }
    finally { await file.close(); }
}
export async function previewInstallation(selection: InstallSelection) {
    const prefix = resolve(selection.prefix), appDir = resolve(selection.appDir);
    if (prefix === appDir || prefix.startsWith(appDir + "/") || appDir.startsWith(prefix + "/")) throw new Error("Keep installation and application state in separate directories");
    const state = await stateAt(prefix);
    if (await exists(join(prefix, "pending.json"))) throw new Error("An installation transition is pending. Resume the exact retained selection and --expected identity; no fresh migration was started");
    await checkLaunchers(prefix, state);
    const current = state.current ? await installedManifest(prefix, state.versions.find(v => v.id === state.current)!) : null;
    const candidate = selection.action === "install" ? await archiveFor(selection) : null;
    const rollback = selection.action === "rollback" ? state.versions.find(v => v.id === state.previous) : null;
    if (selection.action === "rollback" && !rollback) throw new Error("No retained previous installation is available");
    const target = candidate?.manifest ?? (rollback ? await installedManifest(prefix, rollback) : null);
    if (selection.action === "install" && state.versions.some(v => v.version === selection.version && v.archiveSha256 !== selection.sha256)) throw new Error("An installed version cannot be overwritten with different artifact bytes; select a new version");
    if (selection.action === "install" && state.versions.length >= 32 && !state.versions.some(v => v.archiveSha256 === selection.sha256)) throw new Error("Installation version limit reached; explicitly uninstall or select a separate prefix");
    const migration = await inspectInstallationState(appDir), holds = [...migration.holds, ...compatibility(current, target)];
    // A registered client is removed through its own exact scoped transaction.
    if (selection.action === "uninstall" && await exists(join(appDir, "client-bindings"))) {
        for (const id of await readdir(join(appDir, "client-bindings"))) {
            if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid retained client binding");
            const directory = join(appDir, "client-bindings", id); await safePath(directory);
            const files = (await readdir(directory)).filter(name => /^\d{8}\.json$/.test(name)).sort();
            if (!files.length) continue;
            const last = JSON.parse((await ownedFile(join(directory, files.at(-1)!))).toString());
            if (last.schema_version !== "wringer.client-binding.v1" || last.id !== id || !["install", "remove"].includes(last.action)) throw new Error("Invalid retained client ownership");
            if (last.action === "install") holds.push(`disconnect-client:${last.client}:${last.scope}:${last.workspaceId}`);
        }
    }
    const version = candidate ? { id: `${selection.version}-${selection.sha256}`, version: selection.version!, archiveSha256: selection.sha256!, manifestSha256: candidate.manifestSha256 } : rollback ?? null;
    const remove: { path: string; sha256: string | null; target: string | null }[] = [];
    if (selection.action === "uninstall") for (const installed of state.versions) {
        const manifest = await installedManifest(prefix, installed);
        remove.push({ path: `versions/${installed.id}/DISTRIBUTION.json`, sha256: installed.manifestSha256, target: null });
        for (const file of manifest.files) remove.push({ path: `versions/${installed.id}/${file.path}`, sha256: file.kind === "file" ? file.sha256 : null, target: file.kind === "symlink" ? file.target : null });
    }
    const value = { schema_version: "wringer.install-preview.v1", selection: { ...selection, prefix, appDir, ...(selection.archive ? { archive: resolve(selection.archive) } : {}) }, state, target: version, source: target?.source ?? null, migration, holds, eligible: holds.length === 0, remove, stateChanges: "none", backup: state.current ? `versions/${state.current}` : null, checksumPolicy: "Exact selected SHA-256 plus repository/version/platform declaration; same-origin checksums are not independent origin proof", nextAction: "Review exact changes and apply with --expected identity. State, evidence, grants and unrelated client settings are retained. No job is started." };
    return { ...value, identity: digest(value) };
}
export type InstallationPreview = Awaited<ReturnType<typeof previewInstallation>>;
async function validateRemoval(prefix: string, rows: InstallationPreview["remove"]) {
    const wanted = new Map(rows.map(row => [row.path, row]));
    if (!await exists(join(prefix, "versions"))) return;
    async function walk(directory: string, relative: string) {
        for (const name of await readdir(directory)) {
            const path = join(directory, name), rel = `${relative}/${name}`, info = await lstat(path);
            if (info.isDirectory()) { if (![...wanted.keys()].some(p => p.startsWith(rel + "/"))) throw new Error("Unknown installation directory; removal refused"); await walk(path, rel); continue; }
            const row = wanted.get(rel); if (!row || (row.target !== null ? !info.isSymbolicLink() || await readlink(path) !== row.target : !info.isFile() || info.nlink !== 1 || hash(await ownedFile(path, 256 * 1024 * 1024)) !== row.sha256)) throw new Error("Owned removal entry changed; unrelated data was retained");
        }
    }
    await walk(join(prefix, "versions"), "versions");
}
export async function applyInstallation(selection: InstallSelection, expected: string) {
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("Use the exact installation preview identity");
    const prefix = resolve(selection.prefix); let initial = await stateAt(prefix);
    const selected = { ...selection, prefix, appDir: resolve(selection.appDir), ...(selection.archive ? { archive: resolve(selection.archive) } : {}) };
    const receipt = join(prefix, "transactions", `${expected}.json`);
    if (await exists(receipt)) {
        const result = JSON.parse((await ownedFile(receipt)).toString());
        if (result.schema_version !== "wringer.install-result.v1" || result.identity !== expected || digest(result.selection) !== digest(selected)) throw new Error("Retained installation receipt names a different selection");
        const pending = join(prefix, "pending.json");
        if (await exists(pending)) await withMaintenanceLock(prefix, async () => {
            if (!await exists(pending)) return;
            const transaction = JSON.parse((await ownedFile(pending)).toString());
            if (transaction.preview?.identity === expected) { await unlink(pending); await syncDir(prefix); }
        });
        return result;
    }
    const pendingPath = join(prefix, "pending.json"), pendingExists = await exists(pendingPath);
    const preview: InstallationPreview = pendingExists ? JSON.parse((await ownedFile(pendingPath)).toString()).preview : await previewInstallation(selection);
    if (preview.identity !== expected || digest({ ...preview, identity: undefined }) !== expected || digest(preview.selection) !== digest({ ...selection, prefix, appDir: resolve(selection.appDir), ...(selection.archive ? { archive: resolve(selection.archive) } : {}) })) throw new Error("Installation preview changed; no selected action applied");
    if (!preview.eligible) throw new Error(`Installation is held: ${preview.holds.join(", ")}`);
    if (!await exists(join(prefix, "INSTALLATION.json"))) {
        await mkdir(dirname(prefix), { recursive: true, mode: 0o700 });
        const stage = await mkdtemp(join(dirname(prefix), ".wringer-install-initial-"));
        const f = await open(join(stage, "INSTALLATION.json"), "wx", 0o600);
        try { await f.writeFile(JSON.stringify(initial) + "\n"); await f.sync(); } finally { await f.close(); }
        await syncDir(stage); await rename(stage, prefix); await syncDir(dirname(prefix));
    }
    return withMaintenanceLock(prefix, async () => {
        initial = await stateAt(prefix);
        const completed = join(prefix, "transactions", `${expected}.json`);
        if (await exists(completed)) return JSON.parse((await ownedFile(completed)).toString());
        const migration = await inspectInstallationState(resolve(selection.appDir));
        if (migration.holds.length) throw new Error(`Application state acquired a hold: ${migration.holds.join(", ")}`);
        if (!await exists(pendingPath)) {
            if (digest(initial) !== digest(preview.state)) throw new Error("Installation changed before commit");
            await atomicJson(pendingPath, { schema_version: "wringer.install-transaction.v1", preview, attempts: [] });
        }
        const pending = JSON.parse((await ownedFile(pendingPath)).toString());
        if (pending.preview.identity !== expected || digest(pending.preview) !== digest(preview)) throw new Error("Another installation transaction is pending");
        await safePath(join(prefix, "versions")); await safePath(join(prefix, "staging")); await safePath(join(prefix, "bin")); await safePath(join(prefix, "transactions"));
        await mkdir(join(prefix, "versions"), { recursive: true, mode: 0o700 }); await mkdir(join(prefix, "bin"), { recursive: true, mode: 0o700 });
        if (selection.action === "install") {
            const verified = await archiveFor(selection), target = preview.target!;
            if (verified.manifestSha256 !== target.manifestSha256) throw new Error("Candidate manifest changed");
            const destination = join(prefix, "versions", target.id);
            if (!await exists(destination)) {
                if (!Array.isArray(pending.attempts) || pending.attempts.length >= 3) throw new Error("Three retained extraction attempts reached; inspect the owned staging directories");
                const disk = await statfs(prefix); if (Number(disk.bavail) * Number(disk.bsize) < verified.entries.reduce((sum, f) => sum + f.data.length, 0) + 256 * 1024 * 1024) throw new Error("Insufficient free space for candidate and reserve");
                await mkdir(join(prefix, "staging"), { recursive: true, mode: 0o700 });
                const staging = await mkdtemp(join(prefix, "staging", "install-")); pending.attempts.push(staging); await atomicJson(pendingPath, pending);
                await extractReleaseArchive(staging, verified); await rename(staging, destination); await syncDir(join(prefix, "versions"));
            }
            await installedManifest(prefix, target);
        }
        const targetId = selection.action === "uninstall" ? null : preview.target!.id;
        // An interrupted switch accepts only the reviewed old or selected new link.
        const currentPath = join(prefix, "current");
        if (await exists(currentPath)) {
            const info = await lstat(currentPath), actual = info.isSymbolicLink() ? await readlink(currentPath) : null;
            if (!actual || ![preview.state.current && `versions/${preview.state.current}`, targetId && `versions/${targetId}`].includes(actual)) throw new Error("Current launcher changed during transition");
        } else if (preview.state.current && selection.action !== "uninstall") throw new Error("Current launcher disappeared during transition");
        for (const name of names) if (await exists(join(prefix, "bin", name))) await checkLink(join(prefix, "bin", name), `../current/${name}`);
        for (const name of await readdir(join(prefix, "bin"))) if (!names.includes(name as any)) throw new Error("Unrelated launcher directory entry appeared during transition");
        if (selection.action === "uninstall") {
            await validateRemoval(prefix, preview.remove);
            for (const name of names) if (await exists(join(prefix, "bin", name))) await unlink(join(prefix, "bin", name));
            if (await exists(currentPath)) await unlink(currentPath);
            for (const row of preview.remove) if (await exists(join(prefix, row.path))) await unlink(join(prefix, row.path));
            const directories = new Set<string>(); for (const row of preview.remove) { let dir = dirname(row.path); while (dir !== ".") { directories.add(dir); dir = dirname(dir); } }
            for (const dir of [...directories].sort((a, b) => b.length - a.length)) if (await exists(join(prefix, dir))) await rmdir(join(prefix, dir));
        } else {
            const link = join(prefix, `.current-${expected}`);
            if (await exists(link)) await checkLink(link, `versions/${targetId}`); else await symlink(`versions/${targetId}`, link);
            await rename(link, currentPath); await syncDir(prefix);
            for (const name of names) if (!await exists(join(prefix, "bin", name))) await symlink(`../current/${name}`, join(prefix, "bin", name));
        }
        const next: InstallationState = { ...preview.state, sequence: preview.state.sequence + 1, current: targetId, previous: selection.action === "uninstall" ? null : targetId === preview.state.current ? preview.state.previous : preview.state.current, versions: selection.action === "uninstall" ? [] : preview.state.versions.some(v => v.id === targetId) ? preview.state.versions : [...preview.state.versions, preview.target!] };
        await atomicJson(join(prefix, "INSTALLATION.json"), next);
        await mkdir(join(prefix, "transactions"), { recursive: true, mode: 0o700 });
        const result = { schema_version: "wringer.install-result.v1", identity: expected, selection: selected, action: selection.action, current: targetId, bin: join(prefix, "bin"), statePreserved: true, recordMigration: false, retainedStaging: pending.attempts, message: selection.action === "uninstall" ? "Owned installed binaries and launchers removed; application evidence and private installation receipts retained." : "Installation selected atomically. Add bin to PATH explicitly if wanted; no shell profile was edited. Existing records retain their original semantics." };
        await atomicJson(completed, result); await unlink(pendingPath); await syncDir(prefix); return result;
    });
}
