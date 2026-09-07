import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { git, run, validateDigests } from "@wringer/engine";
import { runFleet, runGraph } from "@wringer/scheduler";
import { dispatch } from "../src/app";
import { number, parseArgs, quote } from "../src/args";
import { createServices } from "../src/services";
import { recordJudgement, showCriterion } from "../src/pen";
import { bench } from "../src/bench";
import { documentationHint } from "../src/help";
const scratch = await mkdtemp(join(tmpdir(), "wringer-recovery-tests-"));
let sequence = 0;
afterAll(async () => { await rm(scratch, { recursive: true, force: true }); });
async function fixture(extra: Record<string, unknown> = {}) {
    const repo = join(scratch, String(++sequence));
    await mkdir(repo);
    await git(repo, ["init", "-b", "main"]);
    for (const [key, value] of [["user.name", "Recovery fixture"], ["user.email", "fixture@example.invalid"], ["commit.gpgsign", "false"]])
        await git(repo, ["config", key!, value!]);
    await Bun.write(join(repo, ".gitignore"), ".wringer/\n");
    await Bun.write(join(repo, "brief.md"), "Create result.txt.\n");
    await Bun.write(join(repo, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "check", run: "test -f result.txt", timeout: 2 }], run: { worker: "printf done > result.txt", max_iterations: 1, worker_timeout: 30, wall_clock: 60 }, ...extra }));
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "fixture"]);
    return repo;
}
async function human(repo: string) {
    await Bun.write(join(repo, "wringer.spec.yaml"), JSON.stringify({ schema_version: "wringer.spec.v1", approved: true, title: "Result", intent: "A person can understand the result.", criteria: [{ id: "review", title: "A person can understand the result.", human: true, required: true }], tasks: [{ id: "build", brief: "brief.md", objective: "Create result.txt" }] }));
    await Bun.write(join(repo, "wringer.sources.yaml"), JSON.stringify({ schema_version: "wringer.sources.v1", sources: { review: "A person can understand the result." } }));
}
const compiled: any = { briefPaths: ["brief.md"], plan: { tasks: [{ brief: "brief.md", objective: "Create result.txt" }] }, gates: [], show: {} };
test("missing resume target, surplus operands and incompatible verification flags refuse before running", async () => {
    const repo = await fixture();
    for (const args of [["resume"], ["run", "ignored"], ["verify", "ignored"], ["get", "file:///tmp"], ["verify", "--delivery", "not-falsifying"], ["verify", "--falsify", "--delivery", "x", "--prove"]])
        await expect(dispatch([...args, "--repo", repo])).rejects.toThrow();
    expect(await Bun.file(join(repo, "result.txt")).exists()).toBe(false);
    expect(await Bun.file(join(repo, ".wringer/loops")).exists()).toBe(false);
});
test("repeated history roots are preserved and numeric ceilings cannot be fractional or blank", () => {
    expect(parseArgs(["health", "--from", "one", "--from", "two"]).flags.get("from")).toEqual(["one", "two"]);
    for (const value of ["0.5", "", "Infinity", "-1"])
        expect(() => number(parseArgs(["bench", "--repeats", value]), "repeats", 1)).toThrow("integer");
});
test("printed shell arguments remain literal even with quotes, substitutions and newlines", async () => {
    const value = "repo ' literal $(printf unsafe) `printf unsafe`\nend", child = Bun.spawn(["sh", "-c", `printf '%s' ${quote(value)}`], { stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stdout).text()).toBe(value);
});
test("setup documentation resolves outside the customer's working directory and retired agent settings cannot mutate policy", async () => {
    const repo = await fixture({ judge: { endpoint: "http://127.0.0.1:1", model: "old-model", api_key_env: "FIXTURE_KEY", timeout: 77, rubric: "rubric.yaml", max_tokens: 123 } });
    await expect(dispatch(["start", "--repo", repo, "--model", "explicit-model"])).rejects.toThrow();
    const result = await dispatch(["start", "--repo", repo]), config = await Bun.file(join(repo, ".wringer.yaml")).json();
    expect(config.judge).toMatchObject({ model: "old-model", timeout: 77, rubric: "rubric.yaml", max_tokens: 123 });
    const guide = await documentationHint();
    expect(guide.startsWith("/") || guide === "wring start --help").toBe(true);
    if (guide.startsWith("/"))
        expect(await Bun.file(guide).exists()).toBe(true);
    expect(result.text).toContain(`Guide: ${guide}`);
    expect(result.text).not.toContain("Guide: docs/native");
});
test("installing an approved gate preserves every existing execution and evidence policy", async () => {
    const gate = { id: "check", run: "test -f result.txt", proves: ["works"], timeout: 17, optional: true, concurrent: true, stability: { attempts: 2, require_consistent: true }, artifacts: { max_bytes: 1234, total_bytes: 2345 } }, repo = await fixture({ gates: [gate, { id: "placeholder", run: "test -f another.txt" }] });
    await createServices().installGates(repo, { ...compiled, gates: [{ id: "check", run: gate.run, proves: "works", timeout: 1 }] });
    const config = await Bun.file(join(repo, ".wringer.yaml")).json();
    expect(config.gates[0]).toEqual(gate);
    expect(config.gates[1]).toEqual({ id: "placeholder", run: "test -f another.txt" });
});
test("successful checks reach the human HOLD instead of becoming a permanently failed build", async () => {
    const repo = await fixture();
    await human(repo);
    const result = await createServices().build(repo, compiled, 1);
    expect(result.status).toBe("passed");
    expect(result.humanPending).toEqual(["review"]);
    expect(await Bun.file(join(repo, "wringer.judgements.yaml")).exists()).toBe(false);
});
test("missing requirement assessment cannot masquerade as a ready service result", async () => {
    const repo = await fixture({ gates: [{ id: "check", run: "true" }] });
    const result = await createServices().verify(repo);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("evidence-incomplete");
});
test("legacy graph history is readable but public resume cannot restart its host execution", async () => {
    const repo = await fixture(), value = await runGraph(repo, { version: 1, id: "review", inputs: {}, state: {}, budgets: { wall_clock: 30 }, nodes: { review: { kind: "human", prompt: "Inspect the actual result", then: "done" } } });
    for (const args of [["resume", value.graph_dir], ["graph", "resume", value.graph_dir]])
        await expect(dispatch([...args, "--repo", repo, "--json"])).rejects.toThrow();
    const result = await dispatch(["graph", "explain", value.graph_dir, "--repo", repo, "--json"]);
    expect((result.value as any).status).toBe("parked");
    expect(result.exit).toBe(5);
    expect(await Bun.file(join(repo, "result.txt")).exists()).toBe(false);
});
test("legacy fleet records remain intact when its public execution route is refused", async () => {
    const repo = await fixture({ gates: [{ id: "check", run: "true" }], fleet: { concurrency: 1, deadline: 30, worktree: true } }), fleet = await runFleet(repo, [{ id: "first", brief: "brief.md" }]);
    const before = await Bun.file(join(repo, fleet.fleet_dir, "manifest.json")).text();
    await expect(dispatch(["resume", fleet.fleet_dir, "--repo", repo, "--json"])).rejects.toThrow();
    await expect(dispatch(["fleet", "--resume", fleet.fleet_dir, "--repo", repo])).rejects.toThrow("retired");
    expect(await Bun.file(join(repo, fleet.fleet_dir, "manifest.json")).text()).toBe(before);
});
test("dispatch cancellation reaps a real gate and leaves an interrupted receipt", async () => {
    const repo = await fixture({ gates: [{ id: "check", run: "sleep 30; printf leaked > should-not-exist", timeout: 30 }] }), before = performance.now();
    const answer = await dispatch(["verify", "--repo", repo, "--json"], "wring", { signal: AbortSignal.timeout(250) });
    expect(answer.exit).toBe(4);
    expect(performance.now() - before).toBeLessThan(3000);
    expect((answer.value as any).status).toBe("interrupted");
    expect(await Bun.file(join(repo, "should-not-exist")).exists()).toBe(false);
});
test("SIGINT on the real CLI stops its trusted-local check process group and records exit 4", async () => {
    const repo = await fixture({ gates: [{ id: "check", run: "printf started > started; sleep 30; printf finished > finished", timeout: 40 }] }), cli = new URL("../src/cli.ts", import.meta.url).pathname;
    const child = Bun.spawn([process.execPath, cli, "verify", "--repo", repo, "--json"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    const started = performance.now();
    try {
        while (!await Bun.file(join(repo, "started")).exists() && performance.now() - started < 4000)
            await Bun.sleep(20);
        expect(await Bun.file(join(repo, "started")).exists()).toBe(true);
        child.kill("SIGINT");
        const exit = await Promise.race([child.exited, Bun.sleep(4000).then(() => -999)]);
        expect(exit).toBe(4);
        const output = await new Response(child.stdout).text();
        expect(JSON.parse(output).status).toBe("interrupted");
        expect(await Bun.file(join(repo, "finished")).exists()).toBe(false);
    }
    finally {
        if (child.exitCode === null)
            child.kill("SIGKILL");
    }
}, 10000);
test("failed-display recovery prints both show-again and explicitly labelled independent-inspection routes", async () => {
    const repo = await fixture({ show: { review: "exit 9" } });
    await human(repo);
    const result = await dispatch(["show", "--repo", repo, "--criterion", "review"], "wringer-board");
    expect(result.text).toContain("Next: wringer-board show");
    expect(result.text).toContain("Only if you independently inspected");
    expect(result.text).toContain("--without-display");
    expect(await Bun.file(join(repo, "wringer.judgements.yaml")).exists()).toBe(false);
});
test("the pen refuses malformed prior judgements without overwriting them", async () => {
    const repo = await fixture({ show: { review: "printf visible" } });
    await human(repo);
    const path = join(repo, "wringer.judgements.yaml"), malformed = JSON.stringify({ schema_version: "wringer.judgement.v2", judgements: [{ criterion: "someone-else", verdict: "met" }] });
    await Bun.write(path, malformed);
    const display = await showCriterion(repo, "review");
    await expect(recordJudgement(repo, { criterion: "review", display: display.id, verdict: "met", by: "Fixture person", note: "I saw the result." })).rejects.toThrow("malformed");
    expect(await readFile(path, "utf8")).toBe(malformed);
});
test("bench preparation preserves selected spend bounds, execution requires clean declarations, and receipts validate", async () => {
    const repo = await fixture({ bench: { contender_wall_clock: 10, attempts: 2, contenders: [{ id: "one", worker: "printf done > result.txt" }, { id: "two", worker: "true" }, { id: "three", worker: "true" }] } });
    const dry = await bench(repo, { repeats: 1, contenders: ["one", "two"] });
    expect((dry as any).next_move).toContain("--repeats 1");
    expect((dry as any).next_move).toContain("--contender 'one' --contender 'two'");
    expect((dry as any).next_move).not.toContain("three");
    await Bun.write(join(repo, "uncommitted.txt"), "unreviewed declaration");
    await expect(bench(repo, { send: true })).rejects.toThrow("clean committed");
    await rm(join(repo, "uncommitted.txt"));
    const result: any = await bench(repo, { send: true, repeats: 1, contenders: ["one", "two"] }), directory = result.directory, manifest = await Bun.file(join(directory, "manifest.json")).json(), events = (await Bun.file(join(directory, "bench.jsonl")).text()).trim().split("\n").map(line => JSON.parse(line));
    const schemas = new URL("../../../schema/", import.meta.url).pathname, ajv = addFormats(new Ajv2020({ strict: false }));
    expect(ajv.compile(await Bun.file(join(schemas, "bench-manifest.schema.json")).json())(manifest)).toBe(true);
    const valid = ajv.compile(await Bun.file(join(schemas, "bench-event.schema.json")).json());
    expect(events.every(e => valid(e))).toBe(true);
    expect((await validateDigests(directory)).ok).toBe(true);
    expect(await Bun.file(join(directory, "summary.md")).text()).toContain("Review: wringer-board render");
}, 15000);
