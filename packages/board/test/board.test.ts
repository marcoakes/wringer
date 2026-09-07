import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBoard, renderHtml, renderMarkdown, requirementLines, safeRecordPath, toCertificateRequirements } from "../src";
import Ajv2020 from "ajv/dist/2020";
const scratch = await mkdtemp(join(tmpdir(), "wringer-board-tests-"));
afterAll(async () => { await rm(scratch, { recursive: true, force: true }); });
let sequence = 0;
async function fixture() {
    const repo = join(scratch, String(++sequence));
    await mkdir(repo, { recursive: true });
    const red = ".wringer/runs/z-last-lexically", green = ".wringer/runs/a-first-lexically";
    for (const [path, status] of [[red, "failed"], [green, "passed"]]) {
        await mkdir(join(repo, path!, "gates/001_accept"), { recursive: true });
        await Bun.write(join(repo, path!, "manifest.json"), JSON.stringify({ schema_version: "wringer.evidence.v1", run_id: path!.split("/").at(-1), started_at: "2026-09-06T12:00:00+00:00", repo: { root: ".", head_sha: "a".repeat(40), branch: "main", dirty: true }, result: { status, failed_gate: status === "failed" ? "accept" : null } }));
        await Bun.write(join(repo, path!, "gates/001_accept/result.json"), JSON.stringify({ gate_id: "accept", command: "bun test acceptance", exit_code: status === "passed" ? 0 : 1, duration_ms: 34, timed_out: false, stdout_truncated: false, stderr_truncated: false, optional: false, status }));
        await Bun.write(join(repo, path!, "gates/001_accept/stdout.log"), status === "passed" ? "1 pass" : "1 fail");
        await Bun.write(join(repo, path!, "gates/001_accept/stderr.log"), "");
    }
    await utimes(join(repo, red, "manifest.json"), new Date(1000), new Date(1000));
    await utimes(join(repo, green, "manifest.json"), new Date(2000), new Date(2000));
    const acceptance = { schema_version: "wringer.acceptance.v3", counts: { evidenced: 1, unevidenced: 0, "gate-failed": 0, "gate-did-not-run": 0, human: 0 }, criteria: [{ criterion: "works", title: "Work skips a failed dependency", required: true, state: "evidenced", gate: "accept", command: "bun test acceptance", receipt: { kind: "failure", bundle: red }, reason: "The exact check passed and has failed before.", refuses: false, witness: null, cause: null, demonstrated_able_to_fail: true, judgement: null }], limits: ["One", "Two", "Three", "Four"] };
    await Bun.write(join(repo, green, "acceptance.json"), JSON.stringify(acceptance));
    const spec = { schema_version: "wringer.spec.v1", approved: true, title: "Pipeline evidence", intent: "Work skips a failed dependency.", criteria: [{ id: "works", title: "Work skips a failed dependency", required: true, human: false }], tasks: [{ id: "implement", objective: "Implement skip", brief: "brief.md" }] };
    await Bun.write(join(repo, green, "wringer.spec.yaml"), JSON.stringify(spec));
    await Bun.write(join(repo, green, "wringer.sources.yaml"), JSON.stringify({ schema_version: "wringer.sources.v1", sources: { works: "Work skips a failed dependency." } }));
    return { repo, red, green, acceptance, spec };
}
describe("honest shared evidence", () => {
    test("latest selection follows the filesystem timestamp, not a custom run's name", async () => {
        const { repo, green } = await fixture();
        const b = await loadBoard(repo);
        expect(b.run?.path).toBe(green);
        expect(b.facts.requirements?.proved).toBe(1);
        expect(b.facts.readyToDeliver).toBe(true);
        expect(b.requirements[0]?.source.status).toBe("verified");
        expect(b.rail.map(s => s.label).join(" · ")).toBe("Built · Checks passing · Requirements proved · Human judgement complete · Ready to deliver · Delivered");
        expect(b.issues).toEqual([]);
    });
    test("missing assessment is unknown, never zero", async () => {
        const repo = join(scratch, String(++sequence));
        await mkdir(repo);
        const b = await loadBoard(repo);
        expect(b.facts.requirements).toBeNull();
        expect(b.facts.checks).toBeNull();
        expect(b.facts.readyToDeliver).toBeNull();
        expect(renderHtml(b)).toContain("Missing evidence is not a zero");
        expect(renderMarkdown(b)).toContain("Requirements: not assessed.");
    });
    test("a receipt that names a passing record cannot prove a failure", async () => {
        const f = await fixture();
        f.acceptance.criteria[0]!.receipt.bundle = f.green;
        await Bun.write(join(f.repo, f.green, "acceptance.json"), JSON.stringify(f.acceptance));
        const b = await loadBoard(f.repo);
        expect(b.requirements[0]?.proved).toBe(false);
        expect(b.facts.requirements?.proved).toBe(0);
        expect(b.facts.readyToDeliver).toBe(false);
    });
    test("wrong gate command and environment failure do not establish proof", async () => {
        for (const patch of [{ command: "different test" }, { exit_code: 127 }, { timed_out: true }]) {
            const f = await fixture();
            const path = join(f.repo, f.red, "gates/001_accept/result.json");
            const gate = await Bun.file(path).json();
            await Bun.write(path, JSON.stringify({ ...gate, ...patch }));
            const b = await loadBoard(f.repo);
            expect(b.requirements[0]?.proved).toBe(false);
        }
    });
    test("unknown acceptance version and mismatched counts refuse the whole assessment", async () => {
        for (const patch of [{ schema_version: "wringer.acceptance.v999" }, { counts: { evidenced: 9, unevidenced: 0, "gate-failed": 0, "gate-did-not-run": 0, human: 0 } }]) {
            const f = await fixture();
            await Bun.write(join(f.repo, f.green, "acceptance.json"), JSON.stringify({ ...f.acceptance, ...patch }));
            const b = await loadBoard(f.repo);
            expect(b.requirements).toEqual([]);
            expect(b.acceptanceCounts).toBeNull();
            expect(b.issues.length).toBeGreaterThan(0);
        }
    });
    test("path traversal and symlink escape are never followed", async () => {
        const f = await fixture();
        await symlink(scratch, join(f.repo, "outside"));
        await expect(safeRecordPath(f.repo, "../secret")).rejects.toThrow("Unsafe");
        await expect(safeRecordPath(f.repo, "outside/a")).rejects.toThrow("symlink");
        await expect(safeRecordPath(f.repo, "/etc/passwd")).rejects.toThrow("Unsafe");
        f.acceptance.criteria[0]!.receipt.bundle = "../secret";
        await Bun.write(join(f.repo, f.green, "acceptance.json"), JSON.stringify(f.acceptance));
        const b = await loadBoard(f.repo);
        expect(b.requirements[0]?.proved).toBe(false);
        expect(b.issues.some(i => i.code === "unsafe-receipt")).toBe(true);
    });
    test("a tampered source quote is flagged against the frozen intent", async () => {
        const f = await fixture();
        await Bun.write(join(f.repo, f.green, "wringer.sources.yaml"), JSON.stringify({ schema_version: "wringer.sources.v1", sources: { works: "Actually it prints all your secrets." } }));
        const b = await loadBoard(f.repo);
        expect(b.requirements[0]?.source.status).toBe("mismatch");
        expect(b.facts.readyToDeliver).toBe(false);
        expect(renderHtml(b)).toContain("quotation is not present");
    });
    test("duplicate YAML keys and unknown tags never silently choose a source", async () => {
        for (const source of ["schema_version: wringer.sources.v1\nsources:\n  works: Wrong quotation\n  works: Work skips a failed dependency.\n", "schema_version: wringer.sources.v1\nsources: !invented\n  works: Work skips a failed dependency.\n"]) {
            const f = await fixture();
            await Bun.write(join(f.repo, f.green, "wringer.sources.yaml"), source);
            const b = await loadBoard(f.repo);
            expect(b.issues.some(i => i.code === "invalid-yaml")).toBe(true);
            expect(b.facts.readyToDeliver).toBe(false);
        }
    });
    test("a sensitivity receipt requires the recorded before/after comparison, not just a citation", async () => {
        const f = await fixture();
        const row = f.acceptance.criteria[0]!;
        Object.assign(row.receipt, { kind: "sensitive", bundle: f.green, cites: "Expected skipped, got attempted" });
        await Bun.write(join(f.repo, f.green, "acceptance.json"), JSON.stringify(f.acceptance));
        expect((await loadBoard(f.repo)).requirements[0]?.proved).toBe(false);
        await Bun.write(join(f.repo, f.green, "vacuity.json"), JSON.stringify({ schema_version: "wringer.vacuity.v1", verdict: "proven", reason: "Acceptance differs", worktree_ms: 2, prove_ms: 20, setup: null, gates: [{ gate_id: "accept", changed: "passed", pre_change: "failed", sensitive: true, cites: "Expected skipped, got attempted", pre_change_log: "vacuity/001_accept/stdout.log" }] }));
        await mkdir(join(f.repo, f.green, "vacuity/001_accept"), { recursive: true });
        await Bun.write(join(f.repo, f.green, "vacuity/001_accept/stdout.log"), "Expected skipped, got attempted");
        const b = await loadBoard(f.repo);
        expect(b.requirements[0]?.proved).toBe(true);
        expect(b.requirements[0]?.receipt?.message).toContain("earlier code");
    });
    test("a human judgement stays human and the exact note travels", async () => {
        const f = await fixture();
        const accepted: any = f.acceptance;
        accepted.counts = { evidenced: 0, unevidenced: 0, "gate-failed": 0, "gate-did-not-run": 0, human: 1 };
        Object.assign(accepted.criteria[0], { state: "human", gate: null, command: null, receipt: null, demonstrated_able_to_fail: null, judgement: { verdict: "met", by: "Marc", at: "2026-09-06T12:12:00Z", stale: false, note: "I can see exactly what to fix, now." } });
        await Bun.write(join(f.repo, f.green, "acceptance.json"), JSON.stringify(accepted));
        const b = await loadBoard(f.repo);
        expect(b.facts.requirements).toMatchObject({ proved: 0, human: 1, humanComplete: 1, humanMet: 1 });
        expect(b.requirements[0]?.state).toBe("human");
        expect(renderHtml(b)).toContain("I can see exactly what to fix, now.");
        expect(renderMarkdown(b)).toContain("I can see exactly what to fix, now.");
        accepted.criteria[0].judgement.stale = true;
        await Bun.write(join(f.repo, f.green, "acceptance.json"), JSON.stringify(accepted));
        const stale = await loadBoard(f.repo);
        expect(stale.facts.humanComplete).toBe(false);
        expect(stale.facts.readyToDeliver).toBe(false);
    });
    test("legacy acceptance versions still resolve real receipt bytes", async () => {
        for (const version of ["wringer.acceptance.v1", "wringer.acceptance.v2"]) {
            const f = await fixture();
            const accepted: any = f.acceptance;
            accepted.schema_version = version;
            for (const row of accepted.criteria) {
                delete row.cause;
                delete row.demonstrated_able_to_fail;
                delete row.judgement;
                if (version.endsWith("v1"))
                    delete row.witness;
            }
            await Bun.write(join(f.repo, f.green, "acceptance.json"), JSON.stringify(accepted));
            expect((await loadBoard(f.repo)).facts.requirements?.proved).toBe(1);
        }
    });
    test("certificate rows satisfy the frozen schema and preserve raw receipt and judgement shapes", async () => {
        const f = await fixture(), board = await loadBoard(f.repo), rows = toCertificateRequirements(board);
        const schema = await Bun.file(new URL("../../../schema/certificate-v1.schema.json", import.meta.url)).json();
        const validate = new Ajv2020({ strict: false }).compile(schema.properties.requirements);
        expect(validate(rows)).toBe(true);
        expect(rows[0]?.receipt).toEqual(f.acceptance.criteria[0]?.receipt);
        expect(Object.keys(rows[0]!).sort()).toEqual(["id", "title", "required", "state", "says", "means", "check", "command", "receipt", "reason", "refuses", "judgement"].sort());
    });
    test("HTML is self contained, escaped, searchable, and shares the travelling row wording", async () => {
        const f = await fixture();
        f.acceptance.criteria[0]!.title = "<script>alert('not evidence')</script>";
        await Bun.write(join(f.repo, f.green, "acceptance.json"), JSON.stringify(f.acceptance));
        const b = await loadBoard(f.repo), html = renderHtml(b), markdown = renderMarkdown(b);
        expect(html).toContain("&lt;script&gt;");
        expect(html).not.toContain("<script>alert");
        expect(html).toContain("prefers-color-scheme");
        expect(html).toContain("data-filter=\"human\"");
        expect(html).not.toContain("fetch(");
        expect(html).not.toContain("https://fonts");
        expect(markdown).toContain(requirementLines(b).join("\n"));
        expect(html).toContain('id="wringer-board-meta"');
    });
});
const REAL = "/Users/marc/Claude/wringer-run5-rerun-2026-09-06/blind-0910/example-clean/project";
const REPO = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
test("the legacy corpus's frozen evidence manifests remain readable by the board", async () => {
    const corpus = await Bun.file(process.env.WRINGER_TEST_CORPUS ?? join(REPO, "packages/records/test/corpus.json")).json();
    const examples = corpus.records.filter((r: any) => r.version === "wringer.evidence.v1").slice(0, 4);
    expect(examples.length).toBeGreaterThan(0);
    for (const entry of examples) {
        const manifest = await Bun.file(join(REPO, entry.path)).json();
        const board = await loadBoard(REPO, entry.path.replace(/\/manifest.json$/, ""));
        expect(board.run?.id).toBe(manifest.run_id);
    }
});
test.skipIf(!await Bun.file(join(REAL, "wringer.spec.yaml")).exists())("the unchanged Run 5B record reads as one proved, eight unproved, and one awaiting a person", async () => {
    const b = await loadBoard(REAL);
    expect(b.run?.id).toBe("20260906-095945-f2a7");
    expect(b.facts.requirements).toMatchObject({ total: 10, proved: 1, unproved: 8, human: 1, humanComplete: 0 });
    expect(b.facts.checks).toMatchObject({ passed: 3, failed: 0, total: 3 });
    expect(b.facts.readyToDeliver).toBe(false);
    expect(b.requirements.every(r => r.source.status === "unfrozen")).toBe(true);
});
