import { mkdir, readFile, writeFile, lstat, readdir, link } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { processDriver } from "./driver";
import { validateRepository } from "./policy";
import { runtimeRedactor } from "./redact";
import { RuntimeError, type RepositorySource, type RoleExecutionResult, type RuntimeDriver } from "./types";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export interface PreparedRepositorySource extends RepositorySource {
    objectStore: string;
}
export interface SourceOptions {
    controllerDir: string;
    localRepo?: string;
    driver?: RuntimeDriver;
}
const gitEnvironment = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "3", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null", GIT_CONFIG_KEY_1: "uploadpack.packObjectsHook", GIT_CONFIG_VALUE_1: "", GIT_CONFIG_KEY_2: "core.fsmonitor", GIT_CONFIG_VALUE_2: "false", GIT_AUTHOR_NAME: "Wringer source transport", GIT_AUTHOR_EMAIL: "wringer@localhost", GIT_COMMITTER_NAME: "Wringer source transport", GIT_COMMITTER_EMAIL: "wringer@localhost", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" };
const gitArgs = ["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "uploadpack.packObjectsHook=", "-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always", "-c", "protocol.ext.allow=never"];
async function storeDirectory(directory: string) { await mkdir(directory, { recursive: true, mode: 0o700 }); const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink())
    throw new RuntimeError("Controller source directory must not be a symlink"); }
async function git(driver: RuntimeDriver, store: string, args: string[], input?: string) { const result = await driver.command([...gitArgs, "--git-dir", store, ...args], { env: gitEnvironment, timeoutMs: 60000, input }); if (result.code !== 0)
    throw new RuntimeError(`Source transport Git operation failed: ${runtimeRedactor()(result.stderr || result.stdout)}`, "source-transport-failed"); return result.stdout; }
async function seed(source: RepositorySource, store: string, driver: RuntimeDriver, localRepo?: string) {
    await git(driver, store, ["init", "--bare", store]);
    const origin = source.bundlePath ?? localRepo ?? source.url;
    if (source.bundlePath) {
        const file = await lstat(source.bundlePath);
        if (!file.isFile() || file.isSymbolicLink() || file.size > 64 * 1024 * 1024)
            throw new RuntimeError("Source Git bundle must be regular, non-symlink, and <=64 MiB");
    }
    await git(driver, store, ["fetch", "--no-tags", "--", origin, `${source.commit}:refs/heads/base`]);
    const actual = (await git(driver, store, ["rev-parse", "--verify", `${source.commit}^{commit}`])).trim();
    if (actual !== source.commit)
        throw new RuntimeError("Source transport resolved a different commit");
    await git(driver, store, ["symbolic-ref", "HEAD", "refs/heads/base"]);
}
async function bundle(store: string, path: string, driver: RuntimeDriver, ref = "refs/heads/base") {
    await git(driver, store, ["bundle", "create", path, ref]);
    const info = await lstat(path);
    if (info.size > 64 * 1024 * 1024)
        throw new RuntimeError("Source Git bundle exceeds the 64 MiB transport ceiling", "source-size-limit");
}
/** Host work is limited to immutable Git objects and bundle transport; no checkout or agent. */
export async function prepareRepositorySource(source: RepositorySource, options: SourceOptions): Promise<PreparedRepositorySource> {
    validateRepository({ ...source, ...(options.localRepo ? { bundlePath: resolve(options.localRepo) } : {}) });
    const driver = options.driver ?? processDriver, root = resolve(options.controllerDir, "sources");
    await storeDirectory(root);
    const directory = join(root, `source-${randomUUID()}`);
    await storeDirectory(directory);
    const objectStore = join(directory, "objects.git"), bundlePath = join(directory, "source.bundle");
    await seed(source, objectStore, driver, options.localRepo);
    await bundle(objectStore, bundlePath, driver);
    return { url: source.url, commit: source.commit, bundlePath, objectStore };
}
export interface CapturedCandidate {
    source: PreparedRepositorySource;
    tree: string;
    changedPaths: string[];
}
/** Apply an agent-captured binary patch to a bare Git index, never generate product code. */
export async function captureCandidate(result: RoleExecutionResult, base: RepositorySource, options: {
    controllerDir: string;
    effectId: string;
    driver?: RuntimeDriver;
}): Promise<CapturedCandidate> {
    validateRepository(base);
    if (!result.change || result.provenance.role !== "worker" || result.provenance.repository.url !== base.url || result.provenance.repository.commit !== base.commit || result.change.baseCommit !== base.commit || hash(result.change.patch) !== result.change.sha256)
        throw new RuntimeError("Candidate capture requires the isolated worker's source-bound exact patch", "candidate-identity-mismatch");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,180}$/.test(options.effectId))
        throw new RuntimeError("Candidate capture effect id is unsafe");
    const root = resolve(options.controllerDir, "candidates");
    await storeDirectory(root);
    const directory = join(root, options.effectId), recordPath = join(directory, "capture.json"), identity = hash(JSON.stringify({ url: base.url, commit: base.commit, patch: result.change.sha256 }));
    await storeDirectory(directory);
    const previousIdentity = hash(JSON.stringify({ commit: base.commit, patch: result.change.sha256 }));
    const readSaved = async (): Promise<CapturedCandidate> => {
        const info = await lstat(recordPath);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new RuntimeError("Candidate capture record is not a bounded regular file");
        const saved = JSON.parse(await readFile(recordPath, "utf8"));
        if (saved.identity !== identity && saved.identity !== previousIdentity || saved.candidate?.source?.url !== base.url)
            throw new RuntimeError("Candidate effect id already names a different source/patch");
        const candidate = saved.candidate;
        if (!/^[a-f0-9]{40,64}$/.test(candidate?.source?.commit) || !/^[a-f0-9]{40,64}$/.test(candidate?.tree) || !Array.isArray(candidate.changedPaths) || candidate.changedPaths.some((path: unknown) => typeof path !== "string") || ![candidate.source.objectStore, candidate.source.bundlePath].every(path => typeof path === "string" && resolve(path).startsWith(directory + "/"))) throw new RuntimeError("Candidate capture record does not resolve inside its controller reservation");
        return candidate;
    };
    try {
        return await readSaved();
    }
    catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
            throw error;
    }
    await storeDirectory(directory);
    const reservationPath = join(directory, "reservation.json");
    try {
        // A directory alone is not a frozen request. Do not reinterpret older partial captures.
        const existing = await readdir(directory);
        if (!existing.includes("reservation.json") && existing.length) throw new RuntimeError("Legacy partial candidate capture has no frozen request identity; automatic replay is unsafe", "uncertain-candidate-capture");
        await writeFile(reservationPath, JSON.stringify({ schema_version: "wringer.candidate-reservation.v1", identity, url: base.url, commit: base.commit, patch_sha256: result.change.sha256 }), { flag: "wx", mode: 0o600 });
    } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        const info = await lstat(reservationPath);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new RuntimeError("Candidate reservation is not a bounded regular file");
        const saved = JSON.parse(await readFile(reservationPath, "utf8"));
        if (saved.identity !== identity) throw new RuntimeError("Candidate effect id already reserves a different source/patch");
    }
    // This is deterministic local Git work, not another agent call. Preserve interrupted attempts
    // and recompute in fresh storage from the same immutable request. Never reuse a partial index.
    const attempt = join(directory, `attempt-${randomUUID()}`);
    await storeDirectory(attempt);
    const driver = options.driver ?? processDriver, objectStore = join(attempt, "objects.git"), bundlePath = join(attempt, "source.bundle");
    await seed(base, objectStore, driver);
    await git(driver, objectStore, ["read-tree", base.commit]);
    if (result.change.patch)
        await git(driver, objectStore, ["apply", "--cached", "--binary", "--whitespace=nowarn", "-"], result.change.patch);
    const tree = (await git(driver, objectStore, ["write-tree"])).trim();
    const changedPaths = (await git(driver, objectStore, ["diff", "--name-only", "-z", base.commit, tree, "--"])).split("\0").filter(Boolean);
    const commit = changedPaths.length ? (await git(driver, objectStore, ["commit-tree", tree, "-p", base.commit, "-m", `Agent candidate ${result.change.sha256}`])).trim() : base.commit;
    await git(driver, objectStore, ["update-ref", "refs/heads/candidate", commit]);
    await bundle(objectStore, bundlePath, driver, "refs/heads/candidate");
    const candidate: CapturedCandidate = { source: { url: base.url, commit, bundlePath, objectStore }, tree, changedPaths };
    const pending = join(attempt, "capture.pending.json");
    await writeFile(pending, JSON.stringify({ identity, candidate }), { flag: "wx", mode: 0o600 });
    try { await link(pending, recordPath); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
    return await readSaved();
}
