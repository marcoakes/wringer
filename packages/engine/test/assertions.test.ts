/**
 * Structured results on the standalone route, and layered evidence.
 *
 * The runner fixtures below are REAL output, captured on 19 September 2026:
 *
 *   node --test --test-reporter=tap  over two skipped tests -> exit 0, "# pass 0 / # skipped 2"
 *   playwright test --reporter=json  with PLAYWRIGHT_BROWSERS_PATH pointing at an empty
 *                                    directory -> exit 1, stats.unexpected 2, two specs
 *                                    "failed", top-level errors []
 *
 * Every red-watch here was observed failing with its guard removed.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { assertionId, assertionReport, translate } from "../src/adapters";
import { parseConfig } from "../src/config";
import { git } from "../src/git";
import { schemaDirectory, validateDigests } from "../src/io";
import { verify } from "../src/verify";
const roots: string[] = [];
afterAll(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
const validators = new Map<string, any>();
async function schema(value: unknown, file: string) {
    let check = validators.get(file);
    if (!check) {
        check = ajv.compile(await Bun.file(join(schemaDirectory(), file)).json());
        validators.set(file, check);
    }
    if (!check(value))
        throw new Error(`${file}: ${JSON.stringify(check.errors)}`);
    expect(true).toBeTrue();
}
async function repo() {
    const root = await mkdtemp(join(tmpdir(), "wringer-assertions-"));
    roots.push(root);
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", "Assertion Test"]);
    await git(root, ["config", "user.email", "test@example.invalid"]);
    await git(root, ["config", "commit.gpgsign", "false"]);
    await writeFile(join(root, ".gitignore"), ".wringer/\n");
    await writeFile(join(root, "source.txt"), "fixture\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "fixture"]);
    return root;
}
/** Verbatim shape of node --test --test-reporter=tap over two skipped tests. */
const TAP_ALL_SKIPPED = `TAP version 13
# Subtest: SW-01: the whole suite is skipped
ok 1 - SW-01: the whole suite is skipped # SKIP
  ---
  duration_ms: 0.919834
  type: 'test'
  ...
# Subtest: SW-02: also skipped
ok 2 - SW-02: also skipped # SKIP not today
  ---
  duration_ms: 0.110417
  type: 'test'
  ...
1..2
# tests 2
# suites 0
# pass 0
# fail 0
# cancelled 0
# skipped 2
# todo 0
# duration_ms 61.941625
`;
const TAP_MIXED = `TAP version 13
# Subtest: one passes
ok 1 - one passes
  ---
  duration_ms: 0.542
  type: 'test'
  ...
# Subtest: two fails
not ok 2 - two fails
  ---
  duration_ms: 1.541917
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
  ...
1..2
# tests 2
# pass 1
# fail 1
# cancelled 0
# skipped 0
# todo 0
`;
/** Verbatim shape of playwright --reporter=json with an absent browser binary. */
const playwrightMissingBrowser = () => JSON.stringify({
    config: { version: "1.63.0" },
    suites: [{
            title: "a.spec.mjs", file: "a.spec.mjs",
            specs: [
                { title: "ZJ-04: the app serves the image offline", ok: false, tests: [{ status: "unexpected", results: [{ status: "failed", error: { message: "Error: browserType.launch: Executable doesn't exist at /empty/chrome" } }] }] },
                { title: "ZJ-05: the branded UI is operational", ok: false, tests: [{ status: "unexpected", results: [{ status: "failed", error: { message: "Error: browserType.launch: Executable doesn't exist at /empty/chrome" } }] }] },
            ],
        }],
    errors: [],
    stats: { startTime: "2026-09-19T22:02:08.086Z", duration: 596.28, expected: 0, skipped: 0, unexpected: 2, flaky: 0 },
});
const vitestReport = (statuses: string[]) => JSON.stringify({
    numTotalTests: statuses.length, success: statuses.every(s => s === "passed"),
    testResults: [{ name: "/repo/tests/backend.test.ts", status: statuses.some(s => s === "failed") ? "failed" : "passed", assertionResults: statuses.map((status, i) => ({ fullName: `backend > case ${i + 1}`, title: `case ${i + 1}`, ancestorTitles: ["backend"], status, failureMessages: [] })) }],
});
test("a runner's test name becomes a conforming, unique, traceable assertion id", () => {
    const id = assertionId("SW-01: fresh offline setup (migrations & seed)");
    expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/);
    expect(id).toContain("SW-01");
    expect(assertionId("a b")).not.toBe(assertionId("a  b"));
    expect(assertionId("!!!")).toMatch(/^assertion\./);
});
test("the node:test TAP trailer and its rows are translated, and a spec report is refused", () => {
    const skipped = translate("node-test", TAP_ALL_SKIPPED);
    expect(skipped.counts).toEqual({ total: 2, passed: 0, failed: 0, skipped: 2, executed: 0 });
    expect(skipped.errors).toEqual([]);
    const mixed = translate("node-test", TAP_MIXED);
    expect(mixed.counts).toEqual({ total: 2, passed: 1, failed: 1, skipped: 0, executed: 2 });
    // Node's default reporter on a pipe is `spec`, which this adapter must refuse rather than guess at.
    expect(() => translate("node-test", "﹣ SW-01 (0.39ms) # SKIP\nℹ tests 2\nℹ pass 0\n")).toThrow("Node's default reporter on a pipe is `spec`");
    // The trailer is a second description of the same run; disagreement is recorded as an error.
    expect(translate("node-test", TAP_MIXED.replace("# pass 1", "# pass 2")).errors[0]).toContain("disagrees with its 2 recorded results");
});
test("playwright specs and their own stats are translated; disagreement is an error", () => {
    const missing = translate("playwright", playwrightMissingBrowser());
    expect(missing.counts).toEqual({ total: 2, passed: 0, failed: 2, skipped: 0, executed: 2 });
    expect(missing.errors).toEqual([]);
    const lying = translate("playwright", playwrightMissingBrowser().replace('"unexpected":2', '"unexpected":1'));
    expect(lying.errors[0]).toContain("disagree with its 2 recorded specs");
    expect(() => translate("playwright", '{"suites":"no"}')).toThrow("no suites array");
});
test("vitest assertion results are translated and a file with no assertions becomes an error", () => {
    expect(translate("vitest", vitestReport(["passed", "failed", "skipped"])).counts).toEqual({ total: 3, passed: 1, failed: 1, skipped: 1, executed: 2 });
    const broken = JSON.stringify({ testResults: [{ name: "/repo/tests/a.test.ts", status: "failed", message: "Cannot find module './missing'", assertionResults: [] }] });
    expect(translate("vitest", broken).errors[0]).toContain("produced no assertions");
    expect(() => translate("vitest", "not json at all")).toThrow("no JSON report");
});
test("a report with no requirement to be evidence of, or too many assertions, is refused by sentence", () => {
    const translation = translate("node-test", TAP_MIXED);
    expect(() => assertionReport(translation, [])).toThrow("no proves: binding has no requirement for its assertions to be evidence of");
    const huge = { ...translation, assertions: Array.from({ length: 1025 }, (_, i) => ({ id: `a${i}`, name: `a${i}`, status: "passed" as const })) };
    expect(() => assertionReport(huge, ["R"])).toThrow("Split the gate rather than recording part of a run as the whole");
    expect(assertionReport(translation, ["R"]).assertions.every(a => a.requirements.includes("R"))).toBeTrue();
});
// RED-WATCH: an adapter accepting an empty or all-skipped assertion list as a pass.
test("an entirely skipped suite exits 0 and the gate still cannot pass", async () => {
    const root = await repo();
    await writeFile(join(root, "tap.txt"), TAP_ALL_SKIPPED);
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "unit", run: "cat tap.txt", proves: ["SW-01"], evidence: { kind: "assertions", adapter: "node-test" } }] }));
    const out = await verify(root);
    // The gate result stays derivable from the process: exit 0, status passed. The RUN fails.
    expect(out.results[0]!.exit_code).toBe(0);
    expect(out.results[0]!.status).toBe("passed");
    expect(out.status).toBe("failed");
    expect(out.failed_gate).toBe("unit");
    expect(out.exit_code).toBe(1);
    expect(await readFile(join(root, out.evidence_dir, "summary.md"), "utf8")).toContain("Assertion evidence established nothing for unit");
    const rows = await Bun.file(join(root, out.evidence_dir, "gate-assertions.json")).json();
    await schema(rows, "gate-assertions-v1.schema.json");
    expect(rows.gates[0]).toMatchObject({ gate_id: "unit", adapter: "node-test", status: "unavailable", classification: "assertions", counts: { executed: 0, skipped: 2 } });
    expect(rows.gates[0].reason).toContain("An empty or all-skipped suite is not established");
    const observation = await Bun.file(join(root, out.evidence_dir, rows.gates[0].observation)).json();
    await schema(observation, "check-observation-v1.schema.json");
    // The report is retained even when the rules reject it: the operator needs to see the two skips.
    expect(observation).toMatchObject({ schema_version: "wringer.check-observation.v1", status: "unavailable" });
    expect(observation.report.assertions.map((a: any) => a.status)).toEqual(["skipped", "skipped"]);
    expect((await validateDigests(join(root, out.evidence_dir))).ok).toBeTrue();
});
test("a passing suite establishes its assertions and the gate passes", async () => {
    const root = await repo();
    await writeFile(join(root, "report.json"), vitestReport(["passed", "passed"]));
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "unit", run: "true", proves: ["SW-01"], evidence: { kind: "assertions", adapter: "vitest", report: "report.json" } }] }));
    const out = await verify(root);
    expect(out.results[0]!.status).toBe("passed");
    const rows = await Bun.file(join(root, out.evidence_dir, "gate-assertions.json")).json();
    expect(rows.gates[0]).toMatchObject({ status: "established", classification: "assertions", source: "report.json", counts: { executed: 2, passed: 2 } });
    const observation = await Bun.file(join(root, out.evidence_dir, rows.gates[0].observation)).json();
    expect(observation.report.assertions).toHaveLength(2);
    expect(observation.report.assertions.every((a: any) => a.requirements).toString()).toBe("true");
});
// RED-WATCH: the contradiction check removed.
test("a runner report that contradicts the observed exit code is refused", async () => {
    const root = await repo();
    await writeFile(join(root, "report.json"), vitestReport(["passed", "passed"]));
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "unit", run: "exit 1", proves: ["SW-01"], evidence: { kind: "assertions", adapter: "vitest", report: "report.json" } }] }));
    const out = await verify(root);
    expect(out.results[0]!.status).toBe("failed");
    expect(out.status).toBe("failed");
    const rows = await Bun.file(join(root, out.evidence_dir, "gate-assertions.json")).json();
    expect(rows.gates[0].reason).toContain("The assertion report contradicts the observed process exit");
    expect(rows.gates[0].status).toBe("unavailable");
});
// RED-WATCH: a browser startup failure read as a failing product assertion.
test("a browser that cannot launch is an environment classification from the probe, not from log text", async () => {
    const root = await repo();
    await writeFile(join(root, "report.json"), playwrightMissingBrowser());
    const gate = { id: "browser", run: "cat report.json; exit 1", proves: ["ZJ-04"], evidence: { kind: "assertions", adapter: "playwright", report: "report.json" } };
    // Without a declared browser requirement nothing measured this host, and the record says so.
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [gate] }));
    const unmeasured = await verify(root);
    const withoutProbe = (await Bun.file(join(root, unmeasured.evidence_dir, "gate-assertions.json")).json()).gates[0];
    expect(withoutProbe.classification).toBe("assertions");
    expect(withoutProbe.reason).toContain("No browser requirement is declared");
    // With one declared, the probe measures that the engine is absent and classifies it.
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, requires: [{ kind: "browser", module: "not-installed-here" }], gates: [gate] }));
    const measured = await verify(root);
    const row = (await Bun.file(join(root, measured.evidence_dir, "gate-assertions.json")).json()).gates[0];
    expect(row.classification).toBe("environment");
    expect(row.reason).toContain("A browser that does not start cannot produce a product assertion");
    expect(row.reason).not.toContain("Executable doesn't exist");
});
test("a shell that could not execute the command is environment, whatever the runner said", async () => {
    const root = await repo();
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "unit", run: "./definitely-not-executable", proves: ["SW-01"], evidence: { kind: "assertions", adapter: "node-test" } }] }));
    const out = await verify(root);
    const row = (await Bun.file(join(root, out.evidence_dir, "gate-assertions.json")).json()).gates[0];
    expect([126, 127]).toContain(out.results[0]!.exit_code);
    expect(row.classification).toBe("environment");
    expect(row.reason).toContain("it could not execute the gate's command");
});
// RED-WATCH: the old single-owner refusal restored -> the ZenJev fixture cannot compile.
test("ZenJev's original SW-01 mapping compiles, and an unproved corroboration is refused by name", () => {
    const zenjev = {
        version: 1,
        gates: [
            { id: "fresh-offline-setup", run: "node scripts/check-fresh-setup.mjs", proves: ["SW-01"] },
            { id: "persistence-workflow", run: "node scripts/check.mjs test tests/backend.test.ts", proves: ["SW-01", "SW-03"] },
            { id: "browser", run: "node scripts/check.mjs browser tests/browser/workbench.spec.ts", proves: ["SW-01", "SW-02"] },
        ],
    };
    const config = parseConfig(zenjev);
    expect(config.gates.filter(g => g.proves.includes("SW-01")).map(g => g.id)).toEqual(["fresh-offline-setup", "persistence-workflow", "browser"]);
    const supported = parseConfig({ version: 1, gates: [{ id: "a", run: "true", proves: ["R"] }, { id: "b", run: "true", corroborates: ["R"] }] });
    expect(supported.gates[1]!.corroborates).toEqual(["R"]);
    expect(() => parseConfig({ version: 1, gates: [{ id: "a", run: "true", corroborates: ["R"] }] })).toThrow("corroborated by a and required by no gate");
    expect(() => parseConfig({ version: 1, gates: [{ id: "a", run: "true", proves: ["R"], corroborates: ["R"] }] })).toThrow("both proves and corroborates R");
    expect(() => parseConfig({ version: 1, gates: [{ id: "a", run: "true", evidence: { kind: "coverage", adapter: "vitest" } }] })).toThrow("must be assertions");
    expect(() => parseConfig({ version: 1, gates: [{ id: "a", run: "true", evidence: { kind: "assertions", adapter: "jest" } }] })).toThrow("vitest, playwright or node-test");
    expect(() => parseConfig({ version: 1, gates: [{ id: "a", run: "true", evidence: { kind: "assertions", adapter: "vitest", report: "../escape.json" } }] })).toThrow("repository-relative path");
});

// RED-WATCH: an environment failure counted as a red-first receipt.
test("a browser that never started cannot become the recorded failure a requirement rests on", async () => {
    const root = await repo();
    await writeFile(join(root, "browser.sh"), 'test "$(cat browser.state)" = ready\n');
    await writeFile(join(root, "wringer.spec.yaml"), JSON.stringify({ schema_version: "wringer.spec.v1", approved: true, title: "Fixture", intent: "Build it.", criteria: [{ id: "ZJ-04", title: "The app serves the image offline", required: true }], open_questions: [], tasks: [{ id: "build", brief: "briefs/build.md", objective: "Build it." }] }));
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, requires: [{ kind: "browser", module: "not-installed-here" }], gates: [{ id: "browser", run: "sh browser.sh", proves: ["ZJ-04"], evidence: { kind: "assertions", adapter: "playwright", report: "report.json" } }] }));
    // Red, but red because the browser binary is absent: an environment classification.
    await writeFile(join(root, "browser.state"), "broken\n");
    await writeFile(join(root, "report.json"), playwrightMissingBrowser());
    const red = await verify(root);
    expect(red.results[0]!.status).toBe("failed");
    expect((await Bun.file(join(root, red.evidence_dir, "gate-assertions.json")).json()).gates[0].classification).toBe("environment");
    // Now green. The earlier failure is not evidence that this check can fail.
    await writeFile(join(root, "browser.state"), "ready\n");
    await writeFile(join(root, "report.json"), JSON.stringify({ suites: [{ title: "a.spec.mjs", file: "a.spec.mjs", specs: [{ title: "ZJ-04: the app serves the image offline", ok: true, tests: [{ status: "expected", results: [{ status: "passed" }] }] }] }], errors: [], stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 } }));
    const green = await verify(root);
    expect(green.results[0]!.status).toBe("passed");
    expect(green.status).toBe("passed");
    expect(green.acceptance.criteria[0].state).toBe("unevidenced");
    expect(green.acceptance.criteria[0].cause).toBe("born-green");
    expect(green.acceptance.criteria[0].receipt).toBeNull();
});

// RED-WATCH: the pages that teach this reverted.
test("the operator pages carry the structured-evidence and layering sentences", async () => {
    const root = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
    const setup = await Bun.file(join(root, "SETUP.md")).text();
    expect(setup).toContain("adapter: vitest");
    expect(setup).toContain("zero executed assertions cannot pass");
    expect(setup).toContain("never from log text");
    expect(setup).toContain("corroborates: [SW-01]");
    expect(setup).toContain("all required");
    const headless = await Bun.file(join(root, "docs/native/HEADLESS.md")).text();
    expect(headless).toContain("Zero executed assertions cannot pass");
    expect(headless).toContain("evidence: { kind: assertions, adapter: playwright }");
    const schemas = await Bun.file(join(root, "schema/README.md")).text();
    for (const file of ["gate-assertions-v1.schema.json", "evidence-layers-v1.schema.json"])
        expect(schemas, file).toContain(`[\`${file}\`](${file})`);
});

// RED-WATCH: a gate result whose status cannot be derived from what the process did.
// The board refuses such a record outright (`Gate status contradicts exit code or timeout`) and
// drops the gate from its model, so a run that established nothing would show as having no gate.
test("every recorded gate status stays derivable from its own exit code and timeout", async () => {
    const root = await repo();
    await writeFile(join(root, "tap.txt"), TAP_ALL_SKIPPED);
    await writeFile(join(root, "mixed.txt"), TAP_MIXED);
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [
        { id: "skipped", run: "cat tap.txt", proves: ["R1"], evidence: { kind: "assertions", adapter: "node-test" } },
        { id: "mixed", run: "cat mixed.txt; exit 1", proves: ["R2"], evidence: { kind: "assertions", adapter: "node-test" } },
        { id: "plain", run: "true" },
    ] }));
    const out = await verify(root);
    for (const row of out.results)
        expect(row.status === "passed", `${row.gate_id} exit ${row.exit_code}`).toBe(row.exit_code === 0 && !row.timed_out);
    expect(out.status).toBe("failed");
});
