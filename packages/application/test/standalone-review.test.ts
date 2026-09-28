import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "@wringer/engine";
import * as review from "../src/standalone-review";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
    const repo = await mkdtemp(join(tmpdir(), "wringer-review-batch-")); roots.push(repo);
    await git(repo, ["init", "-b", "main"]);
    await git(repo, ["config", "user.name", "Automated review fixture"]); await git(repo, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(join(repo, ".gitignore"), ".wringer/\n"); await writeFile(join(repo, "source.txt"), "actual result\n");
    await writeFile(join(repo, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "check", run: "test -f source.txt" }], show: { one: "cat source.txt", two: "cat source.txt" } }));
    await writeFile(join(repo, "wringer.spec.yaml"), JSON.stringify({ schema_version: "wringer.spec.v1", approved: true, title: "Fixture", intent: "Inspect two views", criteria: ["one", "two"].map(id => ({ id, title: id, human: true })), tasks: [{ id: "review", brief: "brief.md", objective: "Inspect the views" }] }));
    await git(repo, ["add", "."]); await git(repo, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    return repo;
}
test("T09 acceptance records no invented note and multiple criteria share the exact shown source", async () => {
    const repo = await fixture(), displays = await Promise.all(["one", "two"].map(id => review.showCriterion(repo, id)));
    const batch = (review as any).recordJudgements;
    expect(typeof batch).toBe("function");
    const result = await batch(repo, displays.map(row => ({ criterion: row.criterion, display: row.id, verdict: "met", by: "Automated fixture decision" })));
    expect(result.entries).toHaveLength(2);
    expect(result.entries.every((entry: any) => !Object.hasOwn(entry, "note"))).toBeTrue();
    expect(JSON.parse(await readFile(join(repo, "wringer.judgements.yaml"), "utf8")).judgements).toHaveLength(2);
});
test("T09 a stale second display makes a whole review batch refuse without a partial judgement", async () => {
    const repo = await fixture(), first = await review.showCriterion(repo, "one");
    await writeFile(join(repo, "source.txt"), "moved\n"); const second = await review.showCriterion(repo, "two");
    const batch = (review as any).recordJudgements; expect(typeof batch).toBe("function");
    await expect(batch(repo, [first, second].map(row => ({ criterion: row.criterion, display: row.id, verdict: "met", by: "Automated fixture decision" })))).rejects.toThrow("working tree changed");
    expect(await Bun.file(join(repo, "wringer.judgements.yaml")).exists()).toBeFalse();
});
test("T09 a correction can be replaced by acceptance after renewed inspection", async () => {
    const repo = await fixture(), first = await review.showCriterion(repo, "one");
    await review.recordJudgement(repo, { criterion: "one", display: first.id, verdict: "not_met", by: "Automated fixture decision", note: "Include the corrected total" });
    await writeFile(join(repo, "source.txt"), "corrected total: 12\n");
    const next = await review.showCriterion(repo, "one");
    const accepted = await review.recordJudgement(repo, { criterion: "one", display: next.id, verdict: "met", by: "Automated fixture decision" });
    expect(accepted.entry.verdict).toBe("met"); expect(accepted.entry.note).toBeUndefined();
    const retained = JSON.parse(await readFile(join(repo, "wringer.judgements.yaml"), "utf8"));
    expect(retained.judgements).toHaveLength(1); expect(retained.judgements[0].display.output_digest).not.toBe(first.output_digest);
});
