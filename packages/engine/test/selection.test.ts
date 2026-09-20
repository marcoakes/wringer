/**
 * Completeness you cannot mistake for a pass.
 *
 * The shapes here are the 19 September 2026 ZenJev fixture's: ten declared
 * gates, five of them with no `proves:`, verified across four subset bundles of
 * 3, 1, 5 and 1 gates, every bundle reporting `passed`. Every red-watch in this
 * file was observed failing with the guard removed before it was reinstated.
 */
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bundle, sha256 } from "../src/io";
import { combineSet, COMBINABLE_CHECKS, COMBINABLE_SELECTIONS, completenessSentence, selectionRecord } from "../src/selection";
import { renderHandoff, verificationSetReceipt } from "../src/handoff";
import { EngineError } from "../src/types";
const GATES = ["fresh-offline-setup", "branding", "domain-provider-contracts", "persistence-workflow", "browser", "lint", "typecheck", "production-build", "native-concurrency", "browser-auth"];
/** Only the first five carry `proves:`, exactly as the fixture's configuration does. */
const CONFIG = `version: 1\nexecution:\n  backend: local\ngates:\n${GATES.map((id, i) => `  - id: ${id}\n    run: node run-${id}.mjs\n${i < 5 ? `    proves: [C${i + 1}]\n` : ""}`).join("")}`;
const declaredGates = GATES.map(id => ({ id, optional: false }));
async function scratch() { return await mkdtemp(join(tmpdir(), "wringer-selection-")); }
async function bundle(root: string, name: string, options: {
    gates: string[];
    head?: string;
    status?: string;
    failing?: string[];
    config?: string;
    commands?: Record<string, string>;
    acceptance?: unknown;
    spec?: string;
    selection?: boolean;
}) {
    const directory = join(root, name);
    const b = await new Bundle(directory).prepare();
    const head = options.head ?? "a".repeat(40);
    const failing = new Set(options.failing ?? []);
    await b.json("manifest.json", { schema_version: "wringer.evidence.v1", run_id: name, started_at: "2026-09-19T18:57:22.591Z", repo: { root: ".", head_sha: head, branch: "main", dirty: false }, result: { status: options.status ?? (failing.size ? "failed" : "passed"), failed_gate: options.failing?.[0] ?? null } });
    await b.write(".wringer.yaml", options.config ?? CONFIG);
    await b.json("checks.json", { schema_version: "wringer.checks.v1", checks: GATES.map(id => { const run = options.commands?.[id] ?? `node run-${id}.mjs`; return { gate_id: id, run, run_sha256: sha256(run), files: {}, coverage: "command-only" }; }), limits: ["synthetic"] });
    await b.json("execution.json", { schema_version: "wringer.execution.v1", backend: "local", execution_mode: "trusted_local", gates: options.gates, worker_execution: null, limits: ["synthetic"] });
    for (const id of options.gates) {
        const index = GATES.indexOf(id) + 1;
        await b.json(`gates/${String(index).padStart(3, "0")}_${id}/result.json`, { gate_id: id, command: options.commands?.[id] ?? `node run-${id}.mjs`, exit_code: failing.has(id) ? 1 : 0, duration_ms: 5, timed_out: false, stdout_truncated: false, stderr_truncated: false, optional: false, status: failing.has(id) ? "failed" : "passed" });
    }
    if (options.selection !== false)
        await b.json("selection.json", selectionRecord({ run_id: name, head_sha: head, config_sha256: sha256(options.config ?? CONFIG), gates: declaredGates, selected: options.gates, results: options.gates.map(id => ({ gate_id: id, status: failing.has(id) ? "failed" as const : "passed" as const })) }));
    if (options.acceptance)
        await b.json("acceptance.json", options.acceptance);
    if (options.spec)
        await b.write("wringer.spec.yaml", options.spec);
    await b.seal();
    return directory;
}
/** The four-bundle fixture: 3 + 1 + 5 + 1 gates over one revision. */
async function fixture(root: string, over = {}) {
    return [
        await bundle(root, "run-a", { gates: ["lint", "typecheck", "production-build"], ...over }),
        await bundle(root, "run-b", { gates: ["native-concurrency"], ...over }),
        await bundle(root, "run-c", { gates: ["fresh-offline-setup", "branding", "domain-provider-contracts", "persistence-workflow", "browser"], ...over }),
        await bundle(root, "run-d", { gates: ["browser-auth"], ...over }),
    ];
}
async function refusal(action: () => Promise<unknown>): Promise<string> {
    try {
        await action();
    }
    catch (error) {
        expect(error).toBeInstanceOf(EngineError);
        return (error as EngineError).message;
    }
    throw new Error("The set was combined where a refusal was required.");
}
test("a selected subset passes for its selection and reports the rest as not run", () => {
    const record = selectionRecord({ run_id: "r", head_sha: "a".repeat(40), config_sha256: "0".repeat(64), gates: declaredGates, selected: ["branding"], results: [{ gate_id: "branding", status: "passed" }] });
    expect(record.passed).toEqual(["branding"]);
    expect(record.complete).toBe(false);
    expect(record.missing_required).toEqual(GATES.filter(id => id !== "branding"));
    expect(record.reason).toBe("Incomplete: 9 required checks were not run (fresh-offline-setup, domain-provider-contracts, persistence-workflow, browser, lint, typecheck, production-build, native-concurrency, browser-auth).");
    expect(record.selected).toEqual(["branding"]);
});
test("naming no gate selects everything declared, and is distinguishable from listing them all", () => {
    const all = (selected: string[] | null) => selectionRecord({ run_id: "r", head_sha: null, config_sha256: "0".repeat(64), gates: declaredGates, selected, results: GATES.map(id => ({ gate_id: id, status: "passed" as const })) });
    expect(all(null).selected).toBeNull();
    expect(all(GATES).selected).toEqual(GATES);
    expect(all(null).complete).toBe(true);
    expect(all(null).reason).toBe("Complete: all 10 required checks ran.");
});
// RED-WATCH: `complete` computed without `missing_required`.
test("complete is exactly the emptiness of missing_required, never the run's outcome", () => {
    const failed = selectionRecord({ run_id: "r", head_sha: null, config_sha256: "0".repeat(64), gates: declaredGates, selected: null, results: GATES.map(id => ({ gate_id: id, status: id === "lint" ? "failed" as const : "passed" as const })) });
    expect(failed.failed).toEqual(["lint"]);
    expect(failed.missing_required).toEqual([]);
    expect(failed.complete).toBe(true);
    for (const results of [[], [{ gate_id: "lint", status: "passed" as const }], GATES.slice(0, 9).map(id => ({ gate_id: id, status: "passed" as const }))]) {
        const record = selectionRecord({ run_id: "r", head_sha: null, config_sha256: "0".repeat(64), gates: declaredGates, selected: null, results });
        expect(record.complete).toBe(record.missing_required.length === 0);
    }
    expect(completenessSentence(["one"], 3)).toBe("Incomplete: 1 required check was not run (one).");
});
test("an optional gate is outside the completeness denominator", () => {
    const record = selectionRecord({ run_id: "r", head_sha: null, config_sha256: "0".repeat(64), gates: [{ id: "a", optional: false }, { id: "b", optional: true }], selected: ["a"], results: [{ gate_id: "a", status: "passed" }] });
    expect(record.required).toEqual(["a"]);
    expect(record.complete).toBe(true);
});
test("four subset bundles of one revision combine into one complete ten-gate result", async () => {
    const root = await scratch();
    try {
        const { set } = await combineSet(await fixture(root));
        expect(set.complete).toBe(true);
        expect(set.declared).toEqual(GATES);
        expect(set.passed).toEqual(GATES);
        expect(set.missing_required).toEqual([]);
        expect(set.executions).toHaveLength(10);
        expect(set.executions.map(e => e.gate_id)).toEqual(GATES);
        expect(set.reason).toBe("Complete: all 10 required checks passed exactly once across 4 bundles.");
        expect(set.bundles.map(b => b.selection_record)).toEqual(["wringer.selection.v1", "wringer.selection.v1", "wringer.selection.v1", "wringer.selection.v1"]);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("bundles written before the selection record existed still combine, and say so", async () => {
    const root = await scratch();
    try {
        const { set } = await combineSet(await fixture(root, { selection: false }));
        expect(set.complete).toBe(true);
        expect(new Set(set.bundles.map(b => b.selection_record))).toEqual(new Set(["absent"]));
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
// RED-WATCH: an omitted required gate with no `proves:` must still block completion.
test("omitting required gates that prove nothing still blocks completion", async () => {
    const root = await scratch();
    try {
        const all = await fixture(root);
        const { set } = await combineSet(all.slice(1));
        expect(set.complete).toBe(false);
        expect(set.missing_required).toEqual(["lint", "typecheck", "production-build"]);
        expect(set.reason).toContain("Incomplete: 3 required checks were not run (lint, typecheck, production-build).");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("a required gate that ran and failed is a failure, not a gap, and breaks the set", async () => {
    const root = await scratch();
    try {
        const dirs = [await bundle(root, "run-a", { gates: ["lint", "typecheck", "production-build"], failing: ["lint"] }), await bundle(root, "run-b", { gates: ["native-concurrency"] }), await bundle(root, "run-c", { gates: ["fresh-offline-setup", "branding", "domain-provider-contracts", "persistence-workflow", "browser"] }), await bundle(root, "run-d", { gates: ["browser-auth"] })];
        const { set } = await combineSet(dirs);
        expect(set.complete).toBe(false);
        expect(set.failed).toEqual(["lint"]);
        expect(set.missing_required).toEqual([]);
        expect(set.reason).toContain("Failed: 1 required check ran and did not pass (lint).");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
// RED-WATCH: a set combining two head shas.
test("two revisions are refused by a sentence naming the offending bundle", async () => {
    const root = await scratch();
    try {
        const a = await bundle(root, "run-a", { gates: ["lint"] });
        const b = await bundle(root, "run-b", { gates: ["typecheck"], head: "b".repeat(40) });
        const said = await refusal(() => combineSet([a, b]));
        expect(said).toContain(b);
        expect(said).toContain("b".repeat(40));
        expect(said).toContain("not one verification");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("two configurations are refused, because two populations cannot be added up", async () => {
    const root = await scratch();
    try {
        const a = await bundle(root, "run-a", { gates: ["lint"] });
        const b = await bundle(root, "run-b", { gates: ["typecheck"], config: CONFIG + "  - id: extra\n    run: echo extra\n" });
        const said = await refusal(() => combineSet([a, b]));
        expect(said).toContain(b);
        expect(said).toContain("different .wringer.yaml");
        const unreadable = await bundle(root, "run-c", { gates: ["browser"], config: "version: 1\ngates: []\n" });
        expect(await refusal(() => combineSet([unreadable]))).toContain("cannot read, so its declared checks are unknown");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("one gate with two definitions is refused", async () => {
    const root = await scratch();
    try {
        const a = await bundle(root, "run-a", { gates: ["lint"] });
        const b = await bundle(root, "run-b", { gates: ["typecheck"], commands: { lint: "node run-lint.mjs --changed" } });
        const said = await refusal(() => combineSet([a, b]));
        expect(said).toContain("Gate lint is a different check");
        expect(said).toContain(b);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("a damaged bundle is refused by name", async () => {
    const root = await scratch();
    try {
        const a = await bundle(root, "run-a", { gates: ["lint"] });
        await writeFile(join(a, "status.txt"), "tampered");
        const said = await refusal(() => combineSet([a]));
        expect(said).toContain(a);
        expect(said).toContain("damaged");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("two outcomes for one gate are refused rather than resolved", async () => {
    const root = await scratch();
    try {
        const a = await bundle(root, "run-a", { gates: ["lint"] });
        const b = await bundle(root, "run-b", { gates: ["lint"] });
        const said = await refusal(() => combineSet([a, b]));
        expect(said).toContain("Gate lint has an outcome in both");
        expect(said).toContain(a);
        expect(said).toContain(b);
        expect(await refusal(() => combineSet([a, a]))).toContain("same directory");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("a set of nothing, an interrupted run and a configuration-free bundle are all refused", async () => {
    const root = await scratch();
    try {
        expect(await refusal(() => combineSet([]))).toContain("A set of nothing is not a complete verification");
        const stopped = await bundle(root, "run-stopped", { gates: ["lint"], status: "interrupted" });
        expect(await refusal(() => combineSet([stopped]))).toContain("interrupted");
        const bare = join(root, "bare");
        await mkdir(join(bare, "gates"), { recursive: true });
        expect(await refusal(() => combineSet([bare]))).toContain("damaged");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
// RED-WATCH: a generated handoff manufacturing a human verdict.
test("the generated handoff never manufactures an owner judgment", async () => {
    const root = await scratch();
    try {
        const spec = "schema_version: wringer.spec.v1\napproved: true\ntitle: A build\nintent: |\n  Build it.\nopen_questions: []\ncriteria:\n  - id: HUMAN-ONE\n    title: The owner finds it useful\n    required: true\n    human: true\n";
        const acceptance = { schema_version: "wringer.acceptance.v3", counts: { evidenced: 0, unevidenced: 0, "gate-failed": 0, "gate-did-not-run": 0, human: 1 }, criteria: [{ criterion: "HUMAN-ONE", title: "The owner finds it useful", required: true, state: "human", judgement: null }], limits: ["synthetic"] };
        const dirs = await fixture(root);
        const withSpec = await bundle(root, "run-e", { gates: [], acceptance, spec });
        void withSpec;
        const { set, bundles } = await combineSet(dirs);
        bundles[0]!.acceptance = acceptance;
        bundles[0]!.spec = { approved: true, title: "A build" };
        const handoff = renderHandoff({ title: "A build", set, bundles, evidence_commit: "not committed: synthetic", repository: "none", preview: "none", liveChecks: [], supersedes: [], today: "2026-09-19", receipt: ".wringer/sets/x" });
        expect(handoff).toContain("0 of 1 human criteria carry a current recorded judgement");
        expect(handoff).toContain("no machine result substitutes for one");
        expect(handoff).not.toContain("HUMAN-ONE: met");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("with no acceptance record the handoff records the absence rather than a verdict", async () => {
    const root = await scratch();
    try {
        const { set, bundles } = await combineSet(await fixture(root));
        const handoff = renderHandoff({ title: "A build", set, bundles, evidence_commit: "not committed: synthetic", repository: "https://example.invalid/r", preview: "none declared.", liveChecks: ["browser-auth"], supersedes: ["docs/execution-decision.md"], today: "2026-09-19", receipt: ".wringer/sets/x" });
        expect(handoff).toContain("Owner judgment: **none recorded.**");
        expect(handoff).toContain("Declared as live integration checks: `browser-auth`");
        expect(handoff).toContain("2026-09-19: `docs/execution-decision.md` is superseded by verification set");
        expect(handoff).toContain("Execution mode recorded by the bundles: `trusted_local`.");
        expect(handoff).toContain("| lint | passed | yes |");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
// RED-WATCH: the incomplete sentence dropped from the pages a new operator reads.
test("the operator pages carry the incomplete sentence and the set verb", async () => {
    const root = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
    for (const page of ["SETUP.md", "docs/native/HEADLESS.md"]) {
        const text = await Bun.file(join(root, page)).text();
        expect(text, page).toContain("Incomplete: 9 required checks were not run");
        expect(text, page).toContain("wring audit --set");
        expect(text, page).toContain("wringer.verification-set.v1");
    }
    const schemas = await Bun.file(join(root, "schema/README.md")).text();
    for (const file of ["selection-v1.schema.json", "verification-set-v1.schema.json"])
        expect(schemas, file).toContain(`[\`${file}\`](${file})`);
});
test("the receipt is written, sealed and exits by completeness", async () => {
    const root = await scratch();
    try {
        const dirs = await fixture(root);
        const complete = await verificationSetReceipt(root, dirs, { output: "receipt-complete" });
        expect(complete.exit_code).toBe(0);
        expect(await Bun.file(join(complete.directory, "HANDOFF.md")).text()).toContain("## Completeness");
        const digests = await Bun.file(join(complete.directory, "digests.json")).json();
        expect(Object.keys(digests.files).sort()).toEqual(["HANDOFF.md", "set.json"]);
        const partial = await verificationSetReceipt(root, dirs.slice(1), { output: "receipt-partial" });
        expect(partial.exit_code).toBe(1);
        expect(partial.set.complete).toBe(false);
        expect(partial.text).toContain("INCOMPLETE");
        await expect(verificationSetReceipt(root, dirs, { output: "receipt-live", liveChecks: ["not-a-gate"] })).rejects.toThrow("names no gate the carried .wringer.yaml declares");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});

// RED-WATCH: a record version shipped in `schema/` and not added to the combiner's reader.
test("combiner-reads-every-version: every selection and checks schema is one the set reads", async () => {
    const { readdir } = await import("node:fs/promises");
    const schemas = new URL("../../../schema/", import.meta.url).pathname;
    for (const [pattern, known] of [[/^selection(-v\d+)?\.schema\.json$/, COMBINABLE_SELECTIONS], [/^checks(-v\d+)?\.schema\.json$/, COMBINABLE_CHECKS]] as const) {
        const published = (await readdir(schemas)).filter(name => pattern.test(name));
        expect(published.length).toBeGreaterThan(0);
        const versions = await Promise.all(published.map(async name => (await Bun.file(join(schemas, name)).json()).properties.schema_version.const as string));
        expect([...versions].sort(), pattern.source).toEqual([...known].sort());
    }
});
