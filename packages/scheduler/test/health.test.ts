import { afterAll, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { git, verify, validateDigests } from "@wringer/engine";
import { health, healthExitCode, renderHealth } from "../src/health";
const scratch = await mkdtemp(join(tmpdir(), "wringer-health-tests-"));
let sequence = 0;
afterAll(async () => { await rm(scratch, { recursive: true, force: true }); });
async function fixture(command = "test -f result", optional = false) { const root = join(scratch, String(++sequence)); await mkdir(join(root, ".wringer/runs"), { recursive: true }); await Bun.write(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "test", run: command, optional, timeout: 2 }] })); return root; }
async function record(root: string, n: number, patch: Record<string, unknown> = {}, prefix = ".wringer/runs", id = `run-${n}`, time?: string) {
    const path = join(root, prefix, id);
    await mkdir(join(path, "gates/001_test"), { recursive: true });
    const gate = { gate_id: "test", command: "test -f result", status: "passed", exit_code: 0, timed_out: false, optional: false, duration_ms: 10, stdout_truncated: false, stderr_truncated: false, ...patch };
    await Bun.write(join(path, "manifest.json"), JSON.stringify({ schema_version: "wringer.evidence.v1", run_id: id, started_at: time ?? new Date(Date.UTC(2026, 8, 6, 0, n)).toISOString(), repo: { root: ".", head_sha: "a".repeat(40), branch: "main", dirty: false }, result: { status: gate.status, failed_gate: gate.status === "failed" ? "test" : null } }));
    await Bun.write(join(path, "gates/001_test/result.json"), JSON.stringify(gate));
    return path;
}
async function sensitive(path: string) { await Bun.write(join(path, "vacuity.json"), JSON.stringify({ schema_version: "wringer.vacuity.v1", verdict: "proven", reason: "The check differs", worktree_ms: 1, prove_ms: 2, setup: null, gates: [{ gate_id: "test", changed: "passed", pre_change: "failed", sensitive: true, cites: "Expected result", pre_change_log: "vacuity/001_test/stdout.log" }] })); }
async function flaky(path: string) { await Bun.write(join(path, "stability.json"), JSON.stringify({ schema_version: "wringer.stability.v1", gates: [{ gate_id: "test", optional: false, attempts_requested: 2, attempts_run: 2, require_consistent: true, classification: "flaky", tolerated: false, verdict: "failed", routing: "no_repair", reason: "Mixed observations", deciding_attempt: 1, attempts: [{ attempt: 1, status: "failed", exit_code: 1, duration_ms: 1, timed_out: false, result: "gates/001_test/attempts/001/result.json" }, { attempt: 2, status: "passed", exit_code: 0, duration_ms: 1, timed_out: false, result: "gates/001_test/attempts/002/result.json" }] }] })); }
test("one genuine failure is alive; its removal from the newest 25 genuinely decays to zombie", async () => {
    const root = await fixture();
    await record(root, 0, { status: "failed", exit_code: 1 });
    expect((await health(root)).gates[0]?.verdict).toBe("alive");
    for (let n = 1; n <= 25; n++)
        await record(root, n);
    const report = await health(root);
    expect(report.gates[0]).toMatchObject({ verdict: "zombie", qualifying_runs: 25, last_failure: null });
    expect(healthExitCode(report, true)).toBe(1);
    expect(report.gates[0]?.receipts).not.toContain(".wringer/runs/run-0");
    const schema = await Bun.file(new URL("../../../schema/health-report.schema.json", import.meta.url)).json();
    expect(new Ajv2020({ strict: false }).compile(schema)(report)).toBe(true);
});
test("thin history and a declared but unrun check remain untested, without rendering raw command secrets", async () => {
    const root = await fixture("printf RAW_CONFIG_SECRET");
    const report = await health(root);
    expect(report.gates[0]).toMatchObject({ command: "—", verdict: "untested", qualifying_runs: 0 });
    expect(JSON.stringify(report)).not.toContain("RAW_CONFIG_SECRET");
    await record(root, 1);
    const changed = await health(root);
    expect(changed.retired[0]?.command).toBe("test -f result");
    expect(changed.gates[0]?.qualifying_runs).toBe(0);
});
test("sensitivity belongs only to its sibling result command and cannot keep an edited check alive", async () => {
    const root = await fixture(), path = await record(root, 1);
    await sensitive(path);
    expect((await health(root)).gates[0]).toMatchObject({ verdict: "alive", last_sensitive: ".wringer/runs/run-1" });
    await Bun.write(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "test", run: "test -f narrower" }] }));
    await record(root, 2, { command: "test -f narrower" });
    const report = await health(root);
    expect(report.gates[0]).toMatchObject({ verdict: "untested", qualifying_runs: 1, last_sensitive: null });
    expect(report.retired[0]?.last_sensitive).toBe(".wringer/runs/run-1");
});
test("timeouts, missing commands and flaky failures or sensitivity never demonstrate discrimination", async () => {
    const root = await fixture();
    for (let n = 0; n < 10; n++)
        await record(root, n, { status: "failed", exit_code: n % 2 ? 127 : -15, timed_out: n % 2 === 0 });
    const flaked = await record(root, 10, { status: "failed", exit_code: 1 });
    await flaky(flaked);
    const sensitiveFlake = await record(root, 11);
    await flaky(sensitiveFlake);
    await sensitive(sensitiveFlake);
    const report = await health(root);
    expect(report.gates[0]).toMatchObject({ verdict: "zombie", last_failure: null, last_sensitive: null, drift: { timeouts: 5 } });
    expect(report.limits.join(" ")).toContain("flaky in 2 of 2 measured runs");
});
test("bench, worktree and committed examples are itemized but neither rescue nor displace real history", async () => {
    const root = await fixture();
    for (let n = 0; n < 10; n++)
        await record(root, n);
    for (const prefix of [".wringer/benches/exercise/runs", ".wringer/worktrees/task/.wringer/runs", ".wringer.example/runs"]) {
        for (let n = 0; n < 26; n++)
            await record(root, n, { status: "failed", exit_code: 1 }, prefix, `${prefix.includes("example") ? "example" : prefix.includes("worktrees") ? "tree" : "bench"}-${n}`);
    }
    const report = await health(root);
    expect(report.coverage.read).toBe(88);
    expect(report.gates[0]).toMatchObject({ qualifying_runs: 10, verdict: "zombie" });
    expect(report.limits.filter(l => l.startsWith("Read but non-qualifying:")).length).toBe(78);
});
test("coverage balances malformed, unknown and duplicated manifests, including extra roots outside Git", async () => {
    const root = await fixture(), path = await record(root, 1), external = join(scratch, `history-${++sequence}`);
    await mkdir(external);
    await cp(path, join(external, "restored"), { recursive: true });
    for (const [name, contents] of [["broken", "{"], ["future", JSON.stringify({ schema_version: "wringer.evidence.v100", run_id: "future" })]]) {
        await mkdir(join(root, ".wringer/runs", name!));
        await Bun.write(join(root, ".wringer/runs", name!, "manifest.json"), contents!);
    }
    const report = await health(root, { from: [external] });
    expect(report.coverage).toMatchObject({ read: 1, discovered: 4 });
    expect(report.coverage.skipped.length).toBe(2);
    expect(report.coverage.duplicates).toEqual([{ receipt: `${external}:restored`, already_read_as: ".wringer/runs/run-1" }]);
    expect(report.coverage.discovered).toBe(report.coverage.read + report.coverage.skipped.length + report.coverage.duplicates.length);
    expect((await health(null, { from: [external] })).gates[0]?.receipts).toEqual([`${external}:restored`]);
    expect(healthExitCode(await health(null, { from: [external] }), true)).toBe(0);
});
test("current config requiredness decides strict, never the historic optional flag", async () => {
    const root = await fixture(undefined, true);
    for (let n = 0; n < 10; n++)
        await record(root, n, { optional: false });
    const optional = await health(root);
    expect(optional.gates[0]?.optional).toBe(true);
    expect(healthExitCode(optional, true)).toBe(0);
    await Bun.write(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "test", run: "test -f result", required: true }] }));
    expect(healthExitCode(await health(root), true)).toBe(1);
});
test("without a config, a removed pair retires when it leaves the newest 25 bundles overall", async () => {
    const root = await fixture();
    await record(root, 0, { status: "failed", exit_code: 1 });
    await rm(join(root, ".wringer.yaml"));
    for (let n = 1; n <= 25; n++)
        await record(root, n, { command: "test -f different" });
    const report = await health(root);
    expect(report.retired[0]).toMatchObject({ command: "test -f result", verdict: "retired", last_failure: ".wringer/runs/run-0" });
    expect(report.gates[0]?.command).toBe("test -f different");
    expect(healthExitCode(report, true)).toBe(0);
});
test("legacy loop and bench versions count as coverage without chasing their run pointers", async () => {
    const root = await fixture(), repository = new URL("../../../", import.meta.url).pathname;
    const corpus = await Bun.file(process.env.WRINGER_TEST_CORPUS ?? join(repository, "packages/records/test/corpus.json")).json();
    const old = corpus.records.find((r: any) => r.version === "wringer.loop.v1"), legacy = await Bun.file(join(repository, old.path)).json();
    const bench = { schema_version: "wringer.bench.v1", bench_id: "bench-v1", started_at: "2026-09-06T00:00:00Z", baseline: { sha: "a".repeat(40), run_dir: "/do-not-follow/baseline", failing_gates: ["test"] }, contender_wall_clock: 10, contenders: [], limits: ["Synthetic repairs", "No ranking", "No quality claim"] };
    const records = [legacy, { ...legacy, schema_version: "wringer.loop.v2", loop_id: "native-v2", result: { ...legacy.result, final_run: "/do-not-follow/anywhere", reason: "new_reason" } }, bench, { ...bench, schema_version: "wringer.bench.v2", bench_id: "bench-v2" }];
    for (const [i, value] of records.entries()) {
        const target = join(root, value.schema_version.includes("bench") ? ".wringer/benches" : ".wringer/loops", String(i));
        await mkdir(target, { recursive: true });
        await Bun.write(join(target, "manifest.json"), JSON.stringify(value));
    }
    const report = await health(root);
    expect(report.coverage.read).toBe(4);
    expect(report.coverage.counts).toEqual({ run: 0, loop: 2, bench: 2 });
    expect(report.coverage.skipped).toEqual([]);
    expect(report.gates[0]?.qualifying_runs).toBe(0);
});
test("UTC chronology, not names or offset strings, selects the window; duration excludes contention", async () => {
    const root = await fixture();
    for (let n = 0; n < 10; n++)
        await record(root, n, { duration_ms: n < 5 ? 10 : 20 }, undefined, `reverse-${30 - n}`);
    let report = await health(root);
    expect(report.gates[0]?.drift).toMatchObject({ duration_trend: 2, slow: true });
    const path = await record(root, 30, { duration_ms: 9999 }, undefined, "a-late-lexically", "2026-09-05T23:30:00-02:00");
    await Bun.write(join(path, "concurrency.json"), JSON.stringify({ schema_version: "wringer.concurrency.v1", gates: [{ gate_id: "test", group: 1, beside: ["other"] }] }));
    report = await health(root);
    expect(report.gates[0]?.receipts.at(-1)).toBe(".wringer/runs/a-late-lexically");
    expect(report.gates[0]?.drift.duration_trend).toBe(2);
    expect(report.limits.join(" ")).toContain("1 contended duration excluded");
});
test("same inputs produce identical bytes with mutated environment and no writes", async () => {
    const root = await fixture();
    await record(root, 1);
    const before = await readdir(join(root, ".wringer"));
    const a = JSON.stringify(await health(root));
    const prior = process.env.WRINGER_HEALTH_PROBE;
    try {
        process.env.WRINGER_HEALTH_PROBE = "different-shell-state";
        expect(JSON.stringify(await health(root))).toBe(a);
    }
    finally {
        if (prior === undefined)
            delete process.env.WRINGER_HEALTH_PROBE;
        else
            process.env.WRINGER_HEALTH_PROBE = prior;
    }
    expect(await readdir(join(root, ".wringer"))).toEqual(before);
    const source = await Bun.file(new URL("../src/health.ts", import.meta.url)).text();
    expect(source).not.toMatch(/process\.env|Bun\.env|Date\.now|new Date|Bun\.spawn|\bfetch\(/);
});
test("duplicate YAML, unsafe evidence links and unreadable gate results are explicit, not green", async () => {
    const root = await fixture(), path = await record(root, 1);
    await Bun.write(join(path, "gates/001_test/result.json"), "{");
    let report = await health(root);
    expect(report.gates[0]?.qualifying_runs).toBe(0);
    expect(report.limits.join(" ")).toContain("Unreadable gate result");
    const outside = await record(await fixture(), 2, { status: "failed", exit_code: 1 });
    await rm(join(path, "gates/001_test/result.json"));
    await symlink(join(outside, "gates/001_test/result.json"), join(path, "gates/001_test/result.json"));
    report = await health(root);
    expect(report.gates[0]?.qualifying_runs).toBe(0);
    expect(report.limits.join(" ")).toContain("symbolic link leaves");
    await Bun.write(join(root, ".wringer.yaml"), "version: 1\ngates: []\ngates: []\n");
    await expect(health(root)).rejects.toThrow("Unreadable .wringer.yaml");
});
test("real verify processes yield alive then 25 green receipts yield zombie, all digests valid", async () => {
    const root = await fixture();
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", "Health fixture"]);
    await git(root, ["config", "user.email", "health@example.invalid"]);
    await git(root, ["config", "commit.gpgsign", "false"]);
    await Bun.write(join(root, ".gitignore"), ".wringer/\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "fixture"]);
    expect((await verify(root)).exit_code).toBe(1);
    expect((await health(root)).gates[0]?.verdict).toBe("alive");
    await Bun.write(join(root, "result"), "passes now\n");
    for (let n = 0; n < 25; n++) {
        const run = await verify(root);
        expect(run.exit_code).toBe(0);
        expect((await validateDigests(join(root, run.evidence_dir))).ok).toBe(true);
    }
    const report = await health(root);
    expect(report.gates[0]).toMatchObject({ verdict: "zombie", qualifying_runs: 25 });
    expect(renderHealth(report)).toContain("wring verify --prove");
}, 30000);
