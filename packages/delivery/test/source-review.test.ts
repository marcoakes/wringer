import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashBytes, hashValue } from "@wringer/plan";
import { Redactor } from "@wringer/engine";
import { processDriver } from "@wringer/runtime";
import { SourceFindingInspector, SOURCE_FINDING_RULES, type SourceFinding } from "../src/source-findings";
import { inspectCandidateHistory } from "../src/source-inspection";
import { approveSourceFinding, approveSourceFindings, readSourceDecisionBatch, readSourceApprovals, sourceReviewReceipt, validateSourceReviewReceipt, type SourceFindingInventory } from "../src/source-review";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const redactor = () => new Redactor([], {}), oid = "a".repeat(40);
function findings(text: string, width: number) {
    const values = new Map<string, SourceFinding>(), inspector = new SourceFindingInspector(oid, "blob", finding => values.set(finding.id, finding)), bytes = Buffer.from(text, "latin1");
    for (let offset = 0; offset < bytes.length; offset += width) inspector.write(bytes.subarray(offset, offset + width)); inspector.finish();
    return [...values.values()].sort((a, b) => a.id.localeCompare(b.id));
}
const patterns = [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}\b/g, /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, /\bAKIA[A-Z0-9]{16}\b/g, /-----BEGIN [^-]*PRIVATE KEY-----/g];
function expected(text: string) {
    const values = new Map<string, SourceFinding>();
    for (let index = 0; index < patterns.length; index++) for (const match of text.matchAll(patterns[index]!)) {
        const body = { objectId: oid, objectType: "blob", rule: SOURCE_FINDING_RULES[index]!, matchSha256: hashBytes(Buffer.from(match[0], "latin1")) }, value = { id: hashValue(body), ...body }; values.set(value.id, value);
    }
    return [...values.values()].sort((a, b) => a.id.localeCompare(b.id));
}
test("safe finding inventory matches complete-byte regexes at every boundary without leaking values", () => {
    const tokens = ["sk-" + "a".repeat(18), "sk-ant-" + "z".repeat(12), "ghp_" + "Q".repeat(24), "AKIA" + "A".repeat(16), "-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN \xff\x00 PRIVATE KEY-----"];
    for (const left of ["", " ", "X", "_", "-", "\n"]) for (const right of ["", " ", "X", "_", "-", "\n"]) for (const token of tokens) {
        const text = left + token + right;
        for (const width of [1, 3, 11, 16, 64]) expect(findings(text, width)).toEqual(expected(text));
    }
    for (const text of [tokens.join(" | "), "sk-" + "a".repeat(120000) + "--- end", "ghu_" + "a".repeat(120000) + "_", "-----BEGIN " + "Z".repeat(90000) + "PRIVATE KEY-----", "-----BEGIN " + tokens[3] + " PRIVATE KEY-----", "a".repeat(70000) + "sk-" + "z".repeat(30)]) {
        expect(findings(text, 511)).toEqual(expected(text));
        for (const token of tokens) expect(JSON.stringify(findings(text, 65536))).not.toContain(token);
    }
    expect(() => findings("sk-" + "A".repeat(1024 * 1024 + 1), 65536)).toThrow("1 MiB");
});
async function scratch() { const root = await mkdtemp(join(tmpdir(), "wringer-source-review-test-")); roots.push(root); return root; }
async function git(repo: string, args: string[]) {
    const r = await processDriver.command(["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-C", repo, ...args], { env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } });
    if (r.code) throw new Error("Fixture Git command failed"); return r.stdout.trim();
}
async function sourceFixture() {
    const root = await scratch(), repo = join(root, "source"), state = join(root, "controller"), operator = join(root, "operator"), dummy = "sk-" + "fixture-never-a-real-key";
    await mkdir(repo); await mkdir(state, { mode: 0o700 }); await git(repo, ["init", "--initial-branch=main"]);
    await writeFile(join(repo, "old-example.txt"), dummy); await git(repo, ["add", "."]); await git(repo, ["commit", "-m", "Historical dummy fixture"]);
    await git(repo, ["rm", "old-example.txt"]); await writeFile(join(repo, "current.txt"), "AKIA" + "A".repeat(16)); await git(repo, ["add", "."]); await git(repo, ["commit", "-m", "Different current fixture"]);
    const candidate = await git(repo, ["rev-parse", "HEAD"]), measured = await inspectCandidateHistory(join(repo, ".git"), candidate, redactor(), { collectFindings: true });
    return { root, repo, state, operator, candidate, dummy, inventory: measured.inventory! };
}
function decision(inventory: SourceFindingInventory, index = 0) { return { findingId: inventory.findings[index]!.id, inventorySha256: inventory.sha256, actor: "Codex / delegated PM fixture", actorKind: "delegated-agent" as const, reason: "Explicit synthetic credential in an isolated test fixture; not an actual provider credential." }; }
test("all current and deleted historical findings need exact immutable operator decisions; candidate changes invalidate reuse", async () => {
    const f = await sourceFixture(); expect(f.inventory.findings).toHaveLength(2);
    const options = { directory: f.operator, sourceUrl: f.repo, sourcePaths: [f.repo], redactor: redactor() };
    await expect(sourceReviewReceipt(f.state, f.inventory)).rejects.toThrow("2 of 2");
    const first = await approveSourceFinding(f.state, f.inventory, { ...options, decision: decision(f.inventory) });
    expect(await approveSourceFinding(f.state, f.inventory, { ...options, decision: decision(f.inventory) })).toEqual(first);
    await expect(sourceReviewReceipt(f.state, f.inventory)).rejects.toThrow("1 of 2");
    await expect(approveSourceFinding(f.state, f.inventory, { ...options, decision: { ...decision(f.inventory), findingId: "*" } })).rejects.toThrow("stale or unknown");
    await expect(approveSourceFinding(f.state, f.inventory, { ...options, decision: { ...decision(f.inventory), reason: "Rewritten decision reason cannot replace the first decision." } })).rejects.toThrow("immutable decision");
    await approveSourceFinding(f.state, f.inventory, { ...options, decision: decision(f.inventory, 1) });
    const receipt = (await sourceReviewReceipt(f.state, f.inventory))!; validateSourceReviewReceipt(receipt, f.inventory);
    expect(receipt.approvals.every(a => a.actorKind === "delegated-agent")).toBe(true); expect(receipt.limitations.join(" ")).toContain("NOT a secret-free");
    expect(JSON.stringify(receipt)).not.toContain(f.dummy);
    for (const mutate of [(r: any) => { r.approvals[0].reason = "Tampered without a valid seal"; }, (r: any) => { r.approvals.pop(); }, (r: any) => { r.inventory.findings[0].rule = "*"; }, (r: any) => { r.approvals[0].finding.objectId = "b".repeat(40); }]) { const altered = structuredClone(receipt); mutate(altered); expect(() => validateSourceReviewReceipt(altered, f.inventory)).toThrow(); }
    await writeFile(join(f.repo, "current.txt"), "ghp_" + "B".repeat(25)); await git(f.repo, ["add", "."]); await git(f.repo, ["commit", "-m", "Changed candidate"]);
    const later = await inspectCandidateHistory(join(f.repo, ".git"), await git(f.repo, ["rev-parse", "HEAD"]), redactor(), { collectFindings: true });
    expect(later.inventory!.findings).toHaveLength(3); expect(await readSourceApprovals(f.state, later.inventory!)).toEqual([]);
    expect(() => validateSourceReviewReceipt(receipt, later.inventory!)).toThrow();
    await expect(inspectCandidateHistory(join(f.repo, ".git"), f.candidate, new Redactor(["ACTUAL_KEY"], { ACTUAL_KEY: f.dummy }), { collectFindings: true })).rejects.toThrow("detected credential");
}, 30000);
test("source-carried directories, exposed policy files and changed approval bytes cannot authorize exceptions", async () => {
    const f = await sourceFixture(), options = { directory: f.operator, sourceUrl: f.repo, sourcePaths: [f.repo], redactor: redactor(), decision: decision(f.inventory) };
    await expect(approveSourceFinding(f.state, f.inventory, { ...options, directory: join(f.repo, "policy") })).rejects.toThrow("outside the target");
    const alias = join(f.root, "controller-alias"); await symlink(f.state, alias);
    await expect(approveSourceFinding(f.state, f.inventory, { ...options, directory: join(alias, "review-policy") })).rejects.toThrow("outside controller state");
    expect(await readSourceApprovals(f.state, f.inventory)).toEqual([]);
    await approveSourceFinding(f.state, f.inventory, options);
    const path = join(f.operator, f.candidate, f.inventory.findings[0]!.id + ".json"), saved = await readFile(path, "utf8");
    const changed = JSON.parse(saved); changed.reason = "Tampered policy must fail without resetting the decision"; await writeFile(path, JSON.stringify(changed));
    await expect(readSourceApprovals(f.state, f.inventory)).rejects.toThrow("stale, changed");
    await writeFile(path, saved); await chmod(path, 0o644);
    await expect(readSourceApprovals(f.state, f.inventory)).rejects.toThrow("private operator-owned");
}, 30000);
test("finite batch rejects duplicate, stale or unknown IDs before any decision; retry is immutable and external input is bounded", async () => {
    const f = await sourceFixture(), options = { directory: f.operator, sourceUrl: f.repo, sourcePaths: [f.repo], redactor: redactor() }, one = decision(f.inventory), two = decision(f.inventory, 1);
    for (const decisions of [[one, one], [one, { ...two, findingId: "*" }], [one, { ...two, inventorySha256: "0".repeat(64) }], [one, { ...two, rule: "*" }]]) {
        await expect(approveSourceFindings(f.state, f.inventory, { ...options, decisions })).rejects.toThrow();
        expect(await readSourceApprovals(f.state, f.inventory)).toEqual([]);
    }
    await mkdir(f.operator, { mode: 0o700 });
    const file = join(f.operator, "decisions.json"), batch = { schema_version: "wringer.source-review-decisions.v1", candidateCommit: f.candidate, inventorySha256: f.inventory.sha256, decisions: [one, two] };
    await writeFile(file, JSON.stringify(batch), { mode: 0o600 });
    const decisions = await readSourceDecisionBatch(file, f.state, f.operator, f.inventory);
    const first = await approveSourceFindings(f.state, f.inventory, { ...options, decisions });
    expect(await approveSourceFindings(f.state, f.inventory, { ...options, decisions })).toEqual(first);
    expect((await sourceReviewReceipt(f.state, f.inventory))!.approvals).toHaveLength(2);
    await writeFile(file, JSON.stringify({ ...batch, candidateCommit: "b".repeat(40) }));
    await expect(readSourceDecisionBatch(file, f.state, f.operator, f.inventory)).rejects.toThrow("stale or malformed");
    await writeFile(join(f.state, "decisions.json"), JSON.stringify(batch), { mode: 0o600 });
    await expect(readSourceDecisionBatch(join(f.state, "decisions.json"), f.state, f.operator, f.inventory)).rejects.toThrow("outside controller state");
}, 30000);
