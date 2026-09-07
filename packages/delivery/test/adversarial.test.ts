import { test, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verify } from "@wringer/engine";
import { deliver, audit } from "../src";
import { git, json, seal, checkSeal, files } from "../src/io";
const roots: string[] = [];
afterEach(async () => {
    for (const root of roots.splice(0))
        await rm(root, { recursive: true, force: true });
});
async function fixture({ prove = false, artifacts = false } = {}) {
    const root = await mkdtemp(join(tmpdir(), "wringer-delivery-adversary-"));
    roots.push(root);
    const repo = join(root, "repo"), origin = join(root, "origin.git");
    await mkdir(repo);
    await git(root, ["init", "--bare", "--initial-branch=main", origin]);
    await git(repo, ["init", "--initial-branch=main"]);
    for (const [key, value] of [["user.name", "Test"], ["user.email", "test@example.invalid"], ["commit.gpgsign", "false"]])
        await git(repo, ["config", key!, value!]);
    await writeFile(join(repo, ".gitignore"), ".wringer/\n");
    await writeFile(join(repo, "product.txt"), "broken\n");
    await writeFile(join(repo, "check.sh"), "test \"$(cat product.txt)\" = fixed\n");
    const spec = { schema_version: "wringer.spec.v1", approved: true, title: "A fixed product", intent: "Make the product fixed.", criteria: [{ id: "fixed", title: "Product is fixed", required: true }], open_questions: [], tasks: [{ id: "fix", brief: "briefs/fix.md", objective: "Make the product fixed." }], gates: [] };
    await writeFile(join(repo, "wringer.spec.yaml"), JSON.stringify(spec));
    const config: any = { version: 1, gates: [{ id: "fixed", run: "sh check.sh", proves: "fixed" }], deliver: { base: "main", remote: "origin" } };
    if (prove)
        config.run = { worker: "true", prove: true };
    if (artifacts)
        config.gates.push({ id: "display", run: "printf 'local display bytes' > \"$WRINGER_ARTIFACTS_DIR/note.txt\"", artifacts: { max_bytes: 1024, total_bytes: 1024 } });
    await writeFile(join(repo, ".wringer.yaml"), JSON.stringify(config));
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "red baseline"]);
    await git(repo, ["remote", "add", "origin", origin]);
    await git(repo, ["push", "--set-upstream", "origin", "main"]);
    await git(repo, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
    if (!prove)
        await verify(repo);
    await writeFile(join(repo, "product.txt"), "fixed\n");
    const green = await verify(repo);
    return { root, repo, origin, green };
}
test("native sensitive proof audits from a fresh clone with no local run history", async () => {
    const { root, repo, origin, green } = await fixture({ prove: true });
    expect(green.acceptance.criteria[0].receipt.kind).toBe("sensitive");
    const delivery = await deliver(repo, { send: true });
    const clone = join(root, "fresh");
    await git(root, ["clone", "--branch", delivery.branch, origin, clone]);
    const report = await audit(clone, delivery.delivery_id);
    if (report.status !== "passed")
        throw new Error(JSON.stringify(report));
    expect(report.uncheckable).toBe(0);
    expect(report.claims.find(r => r.claim.startsWith("PROVED"))?.status).toBe("checked");
}, 20000);
test("source secrets are refused before branch creation and never written into the failure record", async () => {
    const { repo } = await fixture();
    const key = "sk-proj-AdversarialTestCredential01";
    process.env.DELIVERY_TEST_API_KEY = key;
    try {
        await writeFile(join(repo, "unsafe.txt"), key);
        await verify(repo);
        const refs = await git(repo, ["show-ref"]);
        await expect(deliver(repo, { send: true })).rejects.toThrow("secret redaction");
        expect(await git(repo, ["show-ref"])).toBe(refs);
        for (const path of await files(join(repo, ".wringer/deliveries")))
            expect(await Bun.file(join(repo, ".wringer/deliveries", path)).text()).not.toContain(key);
    }
    finally {
        delete process.env.DELIVERY_TEST_API_KEY;
    }
}, 20000);
test("binary source edits after verification cannot reuse the old passing record", async () => {
    const { repo } = await fixture();
    await writeFile(join(repo, "image.bin"), Buffer.from([0, 1, 2]));
    await verify(repo);
    await writeFile(join(repo, "image.bin"), Buffer.from([0, 2, 2]));
    const refs = await git(repo, ["show-ref"]);
    await expect(deliver(repo, { send: true })).rejects.toThrow("not the tree");
    expect(await git(repo, ["show-ref"])).toBe(refs);
}, 20000);
test("a check mutation record refuses delivery even after a forged passing summary", async () => {
    const { repo, green } = await fixture();
    const run = join(repo, green.evidence_dir);
    await writeFile(join(run, "check-mutations.json"), JSON.stringify({ schema_version: "wringer.native.check-mutations.v1", refuses: true, reason: "check changed" }));
    await seal(run);
    const refs = await git(repo, ["show-ref"]);
    await expect(deliver(repo, { send: true })).rejects.toThrow("changed while verification");
    expect(await git(repo, ["show-ref"])).toBe(refs);
}, 20000);
test("portable delivery omits display artifacts explicitly while keeping the original run sealed", async () => {
    const { repo, green } = await fixture({ artifacts: true });
    const result = await deliver(repo);
    const copied = join(result.directory, "run"), projection = await json(join(copied, "portable-projection.json"));
    expect(projection.omitted).toContain("gates/002_display/artifacts/note.txt");
    expect(await Bun.file(join(copied, "gates/002_display/artifacts/note.txt")).exists()).toBe(false);
    expect(await Bun.file(join(repo, green.evidence_dir, "gates/002_display/artifacts/note.txt")).exists()).toBe(true);
    await checkSeal(copied);
    await checkSeal(join(repo, green.evidence_dir));
    const report = await audit(repo, result.delivery_id);
    expect(report.failed).toBe(0);
}, 20000);
test("resealing a modified event does not repair its broken hash chain", async () => {
    const { repo } = await fixture();
    const result = await deliver(repo, { send: true }), ledger = join(result.directory, "run/evidence.jsonl");
    const lines = (await readFile(ledger, "utf8")).trimEnd().split("\n");
    const first = JSON.parse(lines[0]!);
    first.repo = "forged";
    lines[0] = JSON.stringify(first);
    await writeFile(ledger, lines.join("\n") + "\n");
    await seal(join(result.directory, "run"));
    await seal(result.directory);
    const report = await audit(repo, result.delivery_id);
    expect(report.status).toBe("failed");
    expect(report.claims.some(r => r.reason.includes("Broken event chain"))).toBe(true);
}, 20000);
