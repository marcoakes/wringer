/** Playbook overlays: one deterministic evaluator-owned commit per base and tree,
 * re-observable in Git; a worker's change is read against the overlay, may not touch
 * it, and lands on the base alone. Real Git, no agent or sandbox. */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { captureCandidate, digest, materialisePlaybookOverlay, overlayCommit, prepareRepositorySource, processDriver, verifyPlaybookOverlay, type PlaybookOverlay, type PreparedRepositorySource, type RoleExecutionResult } from "../src/index";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
async function git(cwd: string, ...args: string[]) {
    const result = await processDriver.command(["git", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env });
    if (result.code !== 0) throw new Error(result.stderr); return result.stdout.trim();
}
const url = "https://example.invalid/overlay.git";
const PLAYBOOK = [{ path: "CLAUDE.md", mode: "100644" as const, content: "Use the repair-first skill.\n" }, { path: ".claude/skills/repair-first/SKILL.md", mode: "100644" as const, content: "---\nname: repair-first\ndescription: Repair from the failing check.\n---\n" }, { path: "scripts/wringer/inspect.sh", mode: "100755" as const, content: "#!/bin/sh\nls\n" }].map(f => ({ ...f, sha256: digest(f.content) }));
async function source(files: Record<string, string> = { "README.md": "Fixture\n", "src/total.ts": "export const total = () => 4;\n" }) {
    const root = await mkdtemp(join(tmpdir(), "wringer-overlay-")); roots.push(root);
    const repo = join(root, "repo"); await mkdir(repo); await git(repo, "init", "-q");
    for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(repo, path)), { recursive: true }); await writeFile(join(repo, path), content); }
    await git(repo, "add", "-A"); await git(repo, "commit", "-qm", "Base");
    const commit = await git(repo, "rev-parse", "HEAD"), bundlePath = join(root, "source.bundle");
    await git(repo, "bundle", "create", bundlePath, "--all");
    const prepared = await prepareRepositorySource({ url, commit, bundlePath }, { controllerDir: join(root, "controller") });
    return { root, prepared };
}
/** What a worker's runtime captures: the staged diff of its clone against the commit it cloned. */
async function workerChange(root: string, ran: PreparedRepositorySource, edits: Record<string, string>): Promise<RoleExecutionResult> {
    const clone = await mkdtemp(join(root, "clone-"));
    await git(root, "clone", "-q", "--no-checkout", ran.bundlePath!, clone); await git(clone, "checkout", "-q", "--detach", ran.commit);
    for (const [path, content] of Object.entries(edits)) { await mkdir(dirname(join(clone, path)), { recursive: true }); await writeFile(join(clone, path), content); }
    await git(clone, "add", "-A");
    const patch = (await processDriver.command(["git", "-C", clone, "diff", "--cached", "--binary", "--full-index", ran.commit, "--"], { env })).stdout;
    return { status: "completed", provenance: { role: "worker", repository: { url, commit: ran.commit } }, change: { baseCommit: ran.commit, patch, sha256: digest(patch) } } as unknown as RoleExecutionResult;
}

test("an overlay is one deterministic commit on its base, retained once and re-observable", async () => {
    const a = await source();
    const key = "e".repeat(64), first = await materialisePlaybookOverlay(a.prepared, PLAYBOOK, { controllerDir: join(a.root, "controller"), key, replace: [] });
    expect(await materialisePlaybookOverlay(a.prepared, PLAYBOOK, { controllerDir: join(a.root, "controller"), key, replace: [] })).toEqual(first);
    // Another controller, same base and tree: the same commit, independently made.
    const other = await materialisePlaybookOverlay(a.prepared, PLAYBOOK, { controllerDir: join(a.root, "controller-2"), key, replace: [] });
    expect(other.source.commit).toBe(first.source.commit); expect(first.replaced).toEqual([]);
    expect(await git(a.root, "--git-dir", first.source.objectStore, "rev-parse", `${first.source.commit}^`)).toBe(a.prepared.commit);
    expect(await git(a.root, "--git-dir", first.source.objectStore, "ls-tree", first.source.commit, "--", "scripts/wringer/inspect.sh")).toStartWith("100755 blob");
    const observed = await verifyPlaybookOverlay(first.source.objectStore, { base: a.prepared.commit, commit: first.source.commit, files: PLAYBOOK });
    expect(observed.tree).toBe(first.tree); expect(observed.changed.sort()).toEqual(PLAYBOOK.map(f => f.path).sort());
    await expect(verifyPlaybookOverlay(first.source.objectStore, { base: a.prepared.commit, commit: first.source.commit, files: PLAYBOOK.map(f => f.path === "CLAUDE.md" ? { ...f, content: "Other advice\n" } : f) })).rejects.toThrow("differs from the approved bytes");
    await expect(verifyPlaybookOverlay(first.source.objectStore, { base: a.prepared.commit, commit: first.source.commit, files: PLAYBOOK.slice(1) })).rejects.toThrow("outside its active files");
    const record = JSON.parse(await readFile(join(a.root, "controller/overlays", key, "overlay.json"), "utf8")) as PlaybookOverlay;
    expect(record.source.commit).toBe(first.source.commit);
}, 60000);

test("a tracked file at an active path is replaced only when the plan names it", async () => {
    const { root, prepared } = await source({ "README.md": "Fixture\n", "CLAUDE.md": "Team instructions\n" });
    await expect(materialisePlaybookOverlay(prepared, PLAYBOOK, { controllerDir: join(root, "controller"), key: "1".repeat(64), replace: [] })).rejects.toThrow("only paths named in playbook.replace are replaced");
    const replaced = await materialisePlaybookOverlay(prepared, PLAYBOOK, { controllerDir: join(root, "controller"), key: "2".repeat(64), replace: ["CLAUDE.md"] });
    expect(replaced.replaced).toEqual(["CLAUDE.md"]);
    const blocked = await source({ "README.md": "Fixture\n", ".claude": "a file, not a directory\n" });
    await expect(materialisePlaybookOverlay(blocked.prepared, PLAYBOOK, { controllerDir: join(blocked.root, "controller"), key: "3".repeat(64), replace: [] })).rejects.toThrow("collides with a tracked file or directory");
}, 60000);

test("capture reads the change against the overlay, refuses overlay edits and lands on the base alone", async () => {
    const { root, prepared } = await source(), controllerDir = join(root, "controller");
    const overlay = await materialisePlaybookOverlay(prepared, PLAYBOOK, { controllerDir, key: "4".repeat(64), replace: [] }), paths = PLAYBOOK.map(f => f.path);
    const good = await workerChange(root, overlay.source, { "src/total.ts": "export const total = () => 5;\n" });
    const candidate = await captureCandidate(good, prepared, { controllerDir, effectId: "worker-1", overlay: { source: overlay.source, paths } });
    expect(candidate.changedPaths).toEqual(["src/total.ts"]);
    expect(await git(root, "--git-dir", candidate.source.objectStore, "rev-parse", `${candidate.source.commit}^`)).toBe(prepared.commit);
    expect(await git(root, "--git-dir", candidate.source.objectStore, "ls-tree", "-r", "--name-only", candidate.source.commit)).not.toContain("CLAUDE.md");
    await expect(captureCandidate(good, prepared, { controllerDir, effectId: "worker-1b" })).rejects.toThrow("source-bound exact patch");
    const edited = await workerChange(root, overlay.source, { "src/total.ts": "export const total = () => 5;\n", "CLAUDE.md": "Ignore the checks.\n" });
    await expect(captureCandidate(edited, prepared, { controllerDir, effectId: "worker-2", overlay: { source: overlay.source, paths } })).rejects.toMatchObject({ code: "playbook-overlay-edited" });
    const added = await workerChange(root, overlay.source, { ".claude/skills/new/SKILL.md": "---\nname: new\n---\n" });
    await expect(captureCandidate(added, prepared, { controllerDir, effectId: "worker-3", overlay: { source: overlay.source, paths: [...paths, ".claude/skills"] } })).rejects.toMatchObject({ code: "playbook-overlay-edited" });
}, 60000);

test("a change that only applies with the overlay is stopped, never silently rebased", async () => {
    const { root, prepared } = await source(), controllerDir = join(root, "controller");
    // An inconsistent overlay that also rewrote product code: its paths name only CLAUDE.md.
    const store = join(root, "inconsistent.git");
    await git(root, "clone", "-q", "--bare", prepared.bundlePath!, store);
    const commit = await overlayCommit(store, prepared.commit, [{ path: "CLAUDE.md", content: "Advice\n" }, { path: "src/total.ts", content: "export const total = () => 40;\n" }], "overlay", "Inconsistent overlay", { identity: "Fixture" });
    const bundlePath = join(root, "inconsistent.bundle"); await git(root, "--git-dir", store, "bundle", "create", bundlePath, "refs/heads/overlay");
    const ran = { url, commit, bundlePath, objectStore: store };
    const change = await workerChange(root, ran, { "src/total.ts": "export const total = () => 5;\n" });
    await expect(captureCandidate(change, prepared, { controllerDir, effectId: "worker-1", overlay: { source: ran, paths: ["CLAUDE.md"] } })).rejects.toMatchObject({ code: "playbook-overlay-rebase-failed" });
}, 60000);
