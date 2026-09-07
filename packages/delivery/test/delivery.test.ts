import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verify, snapshot } from "@wringer/engine";
import { loadBoard } from "@wringer/board";
import { deliver, audit, falsify, mutationPlan } from "../src";
import { checkSeal, git, inside, json, seal } from "../src/io";
const scratch: string[] = [];
afterEach(async () => {
    for (const root of scratch.splice(0))
        await rm(root, { recursive: true, force: true });
});
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "wringer-delivery-test-"));
    scratch.push(root);
    const repo = join(root, "work"), origin = join(root, "origin.git");
    await mkdir(repo);
    await git(root, ["init", "--bare", "--initial-branch=main", origin]);
    await git(repo, ["init", "--initial-branch=main"]);
    for (const [key, value] of [["user.name", "Wringer fixture"], ["user.email", "fixture@example.invalid"], ["commit.gpgsign", "false"]])
        await git(repo, ["config", key!, value!]);
    await writeFile(join(repo, ".gitignore"), ".wringer/\n");
    await writeFile(join(repo, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(join(repo, "product.js"), "export function enabled() { return false; }\nexport function unused() { return false; }\n");
    await writeFile(join(repo, "check.mjs"), "import {enabled} from './product.js'; import assert from 'node:assert/strict'; assert.equal(enabled(), true, 'feature must be enabled');\n");
    await writeFile(join(repo, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "enabled", run: "node check.mjs", proves: "enabled" }], deliver: { base: "main", remote: "origin" } }));
    await writeFile(join(repo, "wringer.spec.yaml"), JSON.stringify({ schema_version: "wringer.spec.v1", approved: true, title: "An enabled feature", intent: "Enable the feature.", criteria: [{ id: "enabled", title: "Feature is enabled", required: true, human: false }], open_questions: [], tasks: [{ id: "enable", brief: "brief.md", objective: "Enable the feature" }], gates: [] }));
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "red baseline"]);
    await git(repo, ["remote", "add", "origin", origin]);
    await git(repo, ["push", "-u", "origin", "main"]);
    await git(repo, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
    const red = await verify(repo);
    expect(red.status).toBe("failed");
    await writeFile(join(repo, "product.js"), "export function enabled() { return true; }\nexport function unused() { return true; }\n");
    const green = await verify(repo);
    expect(green.status).toBe("passed");
    expect(green.acceptance.criteria[0].state).toBe("evidenced");
    const model = await loadBoard(repo, green.evidence_dir);
    if (!model.facts.readyToDeliver)
        throw new Error(JSON.stringify({ issues: model.issues, requirements: model.requirements }));
    return { root, repo, origin, red, green };
}
test("dry delivery carries every red receipt and leaves index, checkout and refs unchanged", async () => {
    const { repo } = await fixture(), before = await snapshot(repo), index = await git(repo, ["diff", "--cached"]), refs = await git(repo, ["show-ref"]);
    const result = await deliver(repo);
    expect(result.mode).toBe("dry_run");
    expect(result.commit).toBeNull();
    expect(await git(repo, ["show-ref"])).toBe(refs);
    expect(await git(repo, ["diff", "--cached"])).toBe(index);
    expect((await snapshot(repo)).fingerprint).toBe(before.fingerprint);
    expect(await checkSeal(result.directory)).toBeGreaterThan(20);
    const report = await audit(repo, result.delivery_id);
    expect(report.uncheckable).toBe(1);
    expect(report.failed).toBe(0);
}, 20000);
test("committed delivery audits in a fresh clone without original .wringer history", async () => {
    const { repo, origin, root, green } = await fixture(), before = await snapshot(repo);
    const delivered = await deliver(repo, { send: true });
    expect(delivered.pushed).toBe(true);
    expect(delivered.evidence_commit).not.toBe(delivered.commit);
    expect((await snapshot(repo)).fingerprint).toBe(before.fingerprint);
    expect(await git(repo, ["branch", "--show-current"])).toBe("main");
    const clone = join(root, "fresh");
    await git(root, ["clone", "--branch", delivered.branch, origin, clone]);
    expect(await Bun.file(join(clone, green.evidence_dir, "manifest.json")).exists()).toBe(false);
    const report = await audit(clone, delivered.delivery_id);
    if (report.status !== "passed")
        throw new Error(JSON.stringify(report, null, 2));
    expect(report.uncheckable).toBe(0);
    expect(report.claims.find(c => c.claim.startsWith("PROVED"))?.status).toBe("checked");
    const mr = await Bun.file(join(delivered.directory, "mr.md")).text();
    expect(mr).toContain("ROOT of that clone");
    expect(mr).toContain(delivered.falsify_command);
}, 20000);
test("tampered receipts and inflated counts fail the independent audit", async () => {
    const { repo } = await fixture();
    const delivered = await deliver(repo, { send: true });
    const certPath = join(delivered.directory, "certificate.json"), original = await Bun.file(certPath).text(), cert = JSON.parse(original);
    cert.acceptance.counts.evidenced = 999;
    await writeFile(certPath, JSON.stringify(cert));
    await seal(delivered.directory);
    const forged = await audit(repo, delivered.delivery_id);
    expect(forged.status).toBe("failed");
    expect(forged.claims.some(c => c.reason.includes("count"))).toBe(true);
    await writeFile(certPath, original);
    await seal(delivered.directory);
    const anchor = await json(join(delivered.directory, "anchor.json")), receipt = Object.values(anchor.receipts)[0] as string;
    await writeFile(join(delivered.directory, receipt, "gates/001_enabled/stdout.log"), "changed output");
    const tampered = await audit(repo, delivered.delivery_id);
    expect(tampered.status).toBe("failed");
}, 20000);
test("changed verified bytes refuse before creating a branch", async () => {
    const { repo } = await fixture();
    await writeFile(join(repo, "product.js"), "export function enabled(){return false}\n");
    const refs = await git(repo, ["show-ref"]);
    await expect(deliver(repo, { send: true })).rejects.toThrow("not the tree");
    expect(await git(repo, ["show-ref"])).toBe(refs);
}, 20000);
test("falsification measures the real committed range and both caught and survivor", async () => {
    const { repo } = await fixture(), before = await snapshot(repo);
    const delivered = await deliver(repo, { send: true });
    const result = await falsify(repo, delivered.delivery_id, { maxAttempts: 8, wallSeconds: 15 });
    expect(result.record.verdict).toBe("measured");
    expect(result.record.counts).toEqual({ attempted: 2, caught: 1, survived: 1 });
    expect(result.anchor.code_commit).toBe(delivered.commit);
    expect(result.table).toContain("Committed range:");
    expect(result.table).toContain("findings about the checks");
    expect((await snapshot(repo)).fingerprint).toBe(before.fingerprint);
}, 30000);
test("portable paths reject parent traversal and symlinks before read", async () => {
    const root = await mkdtemp(join(tmpdir(), "wringer-path-test-"));
    scratch.push(root);
    await mkdir(join(root, "bundle"));
    await symlink(root, join(root, "bundle", "escape"));
    await expect(inside(join(root, "bundle"), "../secret")).rejects.toThrow();
    await expect(inside(join(root, "bundle"), "escape/file")).rejects.toThrow("Symlink");
});
test("mutation planning only touches added source lines and spreads across files", () => {
    const plan = mutationPlan("+++ b/a.js\n@@ -1 +1,2 @@\n+const x = true;\n+const y = true;\n+++ b/b.js\n@@ -1 +1 @@\n+const z = true;\n+++ b/readme.md\n@@ -1 +1 @@\n+true\n");
    expect(plan.map(p => p.path)).toEqual(["a.js", "b.js", "a.js"]);
    expect(plan[0]?.became).toBe("const x = false;");
});
