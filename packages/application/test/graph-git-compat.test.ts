/** Integration must not depend on the newest Git. Git 2.40 added
 * `merge-tree --merge-base`; macOS 14's Apple Git is 2.39. Both modes run here on
 * real repositories and must write the same tree, or refuse. */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitMergeMode, mergeBranchCandidates } from "../src/graph";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
function git(args: string[], cwd?: string) { const r = Bun.spawnSync(["git", "-c", "user.name=Merge fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" }); if (r.exitCode) throw new Error(r.stderr.toString()); return r.stdout.toString().trim(); }
async function history() {
    const root = await mkdtemp(join(tmpdir(), "wringer-merge-modes-")); directories.push(root);
    const repo = join(root, "repo"); git(["init", "-q", "-b", "main", repo]);
    const commit = async (from: string | null, files: Record<string, string>, message: string) => { if (from) git(["checkout", "-q", from], repo); for (const [path, text] of Object.entries(files)) await writeFile(join(repo, path), text); git(["add", "."], repo); git(["commit", "-q", "-m", message], repo); return git(["rev-parse", "HEAD"], repo); };
    const base = await commit(null, { "a.txt": "a\n", "b.txt": "b\n" }, "base");
    const left = await commit(base, { "a.txt": "a left\n" }, "left"), right = await commit(base, { "b.txt": "b right\n" }, "right");
    const clash = await commit(base, { "a.txt": "a clash\n" }, "clash"), stacked = await commit(left, { "b.txt": "b stacked\n" }, "stacked on left");
    return { store: join(repo, ".git"), base, left, right, clash, stacked };
}

test("the installed Git version selects how a join merges", () => {
    expect(gitMergeMode("git version 2.50.1 (Apple Git-155)")).toBe("explicit-base");
    expect(gitMergeMode("git version 2.40.0")).toBe("explicit-base");
    expect(gitMergeMode("git version 3.0.0")).toBe("explicit-base");
    expect(gitMergeMode("git version 2.39.5 (Apple Git-154)")).toBe("computed-base");
    expect(gitMergeMode("git version 2.38.0")).toBe("computed-base");
    expect(gitMergeMode("git version 2.37.3")).toBeNull();
    expect(gitMergeMode("not git")).toBeNull();
});
test("both merge modes write the same tree and report the same conflict", async () => {
    const h = await history();
    const explicit = await mergeBranchCandidates(h.store, h.base, h.left, h.right, "explicit-base"), computed = await mergeBranchCandidates(h.store, h.base, h.left, h.right, "computed-base");
    expect(explicit.tree).toMatch(/^[a-f0-9]{40}$/); expect(computed).toEqual(explicit);
    const conflict = await mergeBranchCandidates(h.store, h.base, h.left, h.clash, "explicit-base");
    expect(conflict).toEqual({ tree: null, conflicts: ["a.txt"] }); expect(await mergeBranchCandidates(h.store, h.base, h.left, h.clash, "computed-base")).toEqual(conflict);
});
test("older Git refuses candidates that do not meet exactly at the fork's source", async () => {
    const h = await history();
    expect((await mergeBranchCandidates(h.store, h.base, h.left, h.stacked, "explicit-base")).tree).toMatch(/^[a-f0-9]{40}$/);
    await expect(mergeBranchCandidates(h.store, h.base, h.left, h.stacked, "computed-base")).rejects.toThrow("needs Git 2.40 or later");
});
