/** The person sees what a result changed before deciding: files and a bounded patch,
 * read from the candidate's bundle against the approved base. Real git; no model. */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "@wringer/engine";
import { CHANGE_PATCH_LIMIT, readCandidateChange } from "../src/candidate-change";

const roots: string[] = []; afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function repository() {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-change-test-"))); roots.push(root);
    const repo = join(root, "repo"); await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
    for (const [key, value] of [["user.name", "Fixture"], ["user.email", "fixture@example.invalid"], ["commit.gpgsign", "false"]]) await git(repo, ["config", key!, value!]);
    await writeFile(join(repo, "value.ts"), "export const value = 1;\n"); await writeFile(join(repo, "keep.txt"), "kept\n");
    await git(repo, ["add", "."]); await git(repo, ["commit", "--quiet", "-m", "base"]);
    return { root, repo, base: (await git(repo, ["rev-parse", "HEAD"])).stdout.trim() };
}
async function candidate(f: Awaited<ReturnType<typeof repository>>) {
    await git(f.repo, ["checkout", "--quiet", "-b", "candidate"]); await git(f.repo, ["add", "."]); await git(f.repo, ["commit", "--quiet", "-m", "candidate"]);
    const commit = (await git(f.repo, ["rev-parse", "HEAD"])).stdout.trim(), bundle = join(f.root, "candidate.bundle");
    await git(f.repo, ["bundle", "create", bundle, "candidate"]);
    return { commit, bundle };
}
test("lists changed files with line counts and the patch against the approved base", async () => {
    const f = await repository();
    await writeFile(join(f.repo, "value.ts"), "export const value = 5;\n"); await writeFile(join(f.repo, "new.bin"), Buffer.from([0, 1, 2, 0, 255]));
    const c = await candidate(f), change = await readCandidateChange(c.bundle, f.base, c.commit);
    expect(change.files).toEqual([{ path: "new.bin", added: null, removed: null }, { path: "value.ts", added: 1, removed: 1 }]);
    expect(change.patch).toContain("-export const value = 1;\n+export const value = 5;");
    expect(change.patch).toContain("diff --git a/value.ts b/value.ts");
    expect(change).toMatchObject({ baseCommit: f.base, candidateCommit: c.commit, truncated: false });
    await expect(readCandidateChange(c.bundle, "not-a-commit", c.commit)).rejects.toThrow("exact commits");
});
test("a long patch is cut at its bound and says so", async () => {
    const f = await repository();
    await writeFile(join(f.repo, "value.ts"), Array.from({ length: 6000 }, (_, n) => `export const line${n} = ${n};`).join("\n") + "\n");
    const c = await candidate(f), change = await readCandidateChange(c.bundle, f.base, c.commit);
    expect(change.truncated).toBe(true); expect(change.patch.length).toBe(CHANGE_PATCH_LIMIT);
});
