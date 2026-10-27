/** Evaluator-owned overlay commits: a base commit plus pinned files, written with a
 * fixed identity and date so the same inputs always name the same commit. A
 * tournament pins challenges this way; a worker playbook tree is materialised this
 * way for the worker alone. Git objects only: no checkout, hook or agent. */
import { lstat, readFile, writeFile, link } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { processDriver } from "./driver";
import { validateRepository } from "./policy";
import { SOURCE_TRANSPORT, type PreparedRepositorySource } from "./source";
import { RuntimeError, type RepositorySource, type RuntimeDriver } from "./types";

export interface OverlayFile { path: string; content: string; mode?: "100644" | "100755"; }
const OVERLAY_ENV = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
async function overlayGit(driver: RuntimeDriver, args: string[], label: string, env: Record<string, string>, input?: string) {
    const result = await driver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { env, timeoutMs: 60000, input });
    if (result.code !== 0) throw new RuntimeError(`${label} failed`, "overlay-failed");
    return result.stdout.trim();
}
/** One commit on `base` adding or replacing `files`, recorded at refs/heads/<ref>. */
export async function overlayCommit(store: string, base: string, files: OverlayFile[], ref: string, message: string, options: { identity: string; driver?: RuntimeDriver }): Promise<string> {
    const driver = options.driver ?? processDriver;
    const env = { ...OVERLAY_ENV, GIT_AUTHOR_NAME: options.identity, GIT_AUTHOR_EMAIL: "wringer@localhost", GIT_COMMITTER_NAME: options.identity, GIT_COMMITTER_EMAIL: "wringer@localhost", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z", GIT_INDEX_FILE: join(store, `index-${ref}`) };
    await overlayGit(driver, ["--git-dir", store, "read-tree", base], "Reading the overlay base", env);
    for (const file of files) {
        const blob = await overlayGit(driver, ["--git-dir", store, "hash-object", "-w", "--stdin"], "Storing an overlay file", env, file.content);
        await overlayGit(driver, ["--git-dir", store, "update-index", "--add", "--cacheinfo", `${file.mode ?? "100644"},${blob},${file.path}`], "Placing an overlay file", env);
    }
    const tree = await overlayGit(driver, ["--git-dir", store, "write-tree"], "Writing the overlay tree", env);
    const commit = await overlayGit(driver, ["--git-dir", store, "commit-tree", tree, "-p", base, "-m", message], "Recording the overlay commit", env);
    await overlayGit(driver, ["--git-dir", store, "update-ref", `refs/heads/${ref}`, commit], "Recording the overlay reference", OVERLAY_ENV);
    return commit;
}

export interface PlaybookOverlayFile { path: string; mode: "100644" | "100755"; sha256: string; content: string; }
export interface PlaybookOverlay {
    source: PreparedRepositorySource;
    base: RepositorySource;
    tree: string;
    /** Active paths that replaced a tracked base file, by explicit declaration. */
    replaced: string[];
    files: { path: string; mode: "100644" | "100755"; sha256: string; blob: string }[];
}
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
/** Materialise a worker playbook on `base` once per (base, key): the same directory
 * and commit on every resume, so a retained request never changes identity. A tracked
 * file at an active path is refused unless `replace` names it. */
export async function materialisePlaybookOverlay(base: PreparedRepositorySource, files: PlaybookOverlayFile[], options: { controllerDir: string; key: string; replace: string[]; driver?: RuntimeDriver }): Promise<PlaybookOverlay> {
    validateRepository(base);
    if (!base.bundlePath || !/^[a-f0-9]{64}$/.test(options.key)) throw new RuntimeError("A playbook overlay needs a prepared source bundle and an exact identity");
    const { git, seed, bundle, storeDirectory } = SOURCE_TRANSPORT, driver = options.driver ?? processDriver;
    const directory = join(resolve(options.controllerDir, "overlays"), options.key), recordPath = join(directory, "overlay.json");
    await storeDirectory(resolve(options.controllerDir, "overlays")); await storeDirectory(directory);
    const saved = async (): Promise<PlaybookOverlay> => {
        const info = await lstat(recordPath);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new RuntimeError("Playbook overlay record is not a bounded regular file");
        const value = JSON.parse(await readFile(recordPath, "utf8")) as PlaybookOverlay;
        if (value.base?.commit !== base.commit || value.base.url !== base.url || ![value.source?.objectStore, value.source?.bundlePath].every(path => typeof path === "string" && resolve(path).startsWith(directory + "/")) || !SHA.test(value.source.commit) || !SHA.test(value.tree)) throw new RuntimeError("Playbook overlay record names another base or escapes its reservation");
        return value;
    };
    try { return await saved(); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    const attempt = join(directory, `attempt-${randomUUID()}`);
    await storeDirectory(attempt);
    const objectStore = join(attempt, "objects.git"), bundlePath = join(attempt, "overlay.bundle");
    await seed(base, objectStore, driver);
    const tracked = (await git(driver, objectStore, ["ls-tree", "-r", "-z", "--name-only", base.commit])).split("\0").filter(Boolean);
    const replaced: string[] = [];
    for (const file of files) {
        if (tracked.includes(file.path)) {
            if (!options.replace.includes(file.path)) throw new RuntimeError(`The playbook would replace the tracked file ${file.path}; only paths named in playbook.replace are replaced`, "playbook-overlay-collision");
            replaced.push(file.path);
        }
        if (tracked.some(path => file.path.startsWith(path + "/") || path.startsWith(file.path + "/"))) throw new RuntimeError(`The playbook path ${file.path} collides with a tracked file or directory`, "playbook-overlay-collision");
    }
    const commit = await overlayCommit(objectStore, base.commit, files.map(f => ({ path: f.path, content: f.content, mode: f.mode })), "overlay", `Worker playbook overlay ${options.key}`, { identity: "Wringer playbook", driver });
    const tree = (await git(driver, objectStore, ["rev-parse", `${commit}^{tree}`])).trim();
    const rows = [];
    for (const file of files) rows.push({ path: file.path, mode: file.mode, sha256: file.sha256, blob: (await git(driver, objectStore, ["rev-parse", `${commit}:${file.path}`])).trim() });
    await bundle(objectStore, bundlePath, driver, "refs/heads/overlay");
    const overlay: PlaybookOverlay = { source: { url: base.url, commit, bundlePath, objectStore }, base: { url: base.url, commit: base.commit }, tree, replaced: replaced.sort(), files: rows };
    const pending = join(attempt, "overlay.pending.json");
    await writeFile(pending, JSON.stringify(overlay), { flag: "wx", mode: 0o600 });
    try { await link(pending, recordPath); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
    return saved();
}
/** Independent re-observation of a retained overlay: its one parent is the base, it
 * differs from the base only at the active paths, and each holds the exact bytes. */
export async function verifyPlaybookOverlay(store: string, input: { base: string; commit: string; files: { path: string; mode: string; content: string }[] }, options: { driver?: RuntimeDriver } = {}): Promise<{ tree: string; changed: string[] }> {
    const { git } = SOURCE_TRANSPORT, driver = options.driver ?? processDriver;
    const parents = (await git(driver, store, ["rev-list", "--parents", "-n", "1", input.commit])).trim().split(" ");
    if (parents[0] !== input.commit || parents.length !== 2 || parents[1] !== input.base) throw new RuntimeError("Playbook overlay is not one commit on its recorded base");
    const changed = (await git(driver, store, ["diff", "--name-only", "-z", input.base, input.commit, "--"])).split("\0").filter(Boolean);
    if (changed.some(path => !input.files.some(f => f.path === path))) throw new RuntimeError("Playbook overlay changed a path outside its active files");
    for (const file of input.files) {
        const listed = (await git(driver, store, ["ls-tree", input.commit, "--", file.path])).trim();
        const expected = (await git(driver, store, ["hash-object", "--stdin"], file.content)).trim();
        if (listed !== `${file.mode} blob ${expected}\t${file.path}`) throw new RuntimeError(`Playbook overlay ${file.path} differs from the approved bytes`);
    }
    return { tree: (await git(driver, store, ["rev-parse", `${input.commit}^{tree}`])).trim(), changed };
}
