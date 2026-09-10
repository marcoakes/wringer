import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processDriver } from "../src/driver";
import { createLocalSourceBundle, inspectLocalSourceBundle } from "../src/source";

// Real Git in scratch repositories with repo-local identity and signing off.
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function git(cwd: string, ...args: string[]) {
    const result = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-C", cwd, ...args]);
    if (result.code !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
}
async function repository() {
    const dir = await mkdtemp(join(tmpdir(), "wringer-local-bundle-")); dirs.push(dir);
    const repo = join(dir, "repo");
    await git(dir, "init", "--initial-branch=main", repo);
    await git(repo, "config", "user.name", "Local bundle fixture"); await git(repo, "config", "user.email", "fixture@example.invalid");
    await writeFile(join(repo, "a.txt"), "one\n"); await git(repo, "add", "."); await git(repo, "commit", "-m", "root");
    await writeFile(join(repo, "a.txt"), "two\n"); await git(repo, "commit", "-am", "child");
    return { dir, repo, root: await git(repo, "rev-list", "--max-parents=0", "HEAD"), head: await git(repo, "rev-parse", "HEAD") };
}

test("one product function bundles a commit's history once and names it by its single root", async () => {
    const f = await repository(), path = join(f.dir, "source.bundle");
    const made = await createLocalSourceBundle(f.repo, f.head, path), bytes = await readFile(path);
    expect(made).toEqual({ url: `local://${f.root}`, commit: f.head, rootCommit: f.root, bundleSha256: createHash("sha256").update(bytes).digest("hex"), bundleBytes: bytes.length });
    expect(JSON.stringify(made)).not.toContain(f.dir);
    expect(await inspectLocalSourceBundle(path)).toEqual({ head: f.head, roots: [f.root] });
    await expect(createLocalSourceBundle(f.repo, f.head, path)).rejects.toThrow("A local source bundle is written once; its path already exists");
    expect(await readFile(path)).toEqual(bytes);
});

test("a history with two roots has no local identity and no bundle is written", async () => {
    const f = await repository(), path = join(f.dir, "two-roots.bundle");
    await git(f.repo, "checkout", "--orphan", "other"); await git(f.repo, "rm", "-rf", "--quiet", ".");
    await writeFile(join(f.repo, "b.txt"), "b\n"); await git(f.repo, "add", "."); await git(f.repo, "commit", "-m", "second root");
    await git(f.repo, "checkout", "main"); await git(f.repo, "merge", "--allow-unrelated-histories", "-m", "join histories", "other");
    await expect(createLocalSourceBundle(f.repo, await git(f.repo, "rev-parse", "HEAD"), path)).rejects.toThrow("This history has 2 root commits, and local identity needs one root; name the remote instead with --source-url. No bundle was written.");
    expect(await Bun.file(path).exists()).toBe(false);
});
