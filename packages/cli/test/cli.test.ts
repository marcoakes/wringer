import { test, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "../src/app";
import { parseArgs } from "../src/args";
import { recordJudgement, showCriterion } from "../src/pen";
import { git } from "@wringer/engine";
import { getRepository, safeURL, issue } from "../src/remote";
import { bench } from "../src/bench";
const roots: string[] = [];
afterEach(async () => {
    for (const root of roots.splice(0))
        await rm(root, { recursive: true, force: true });
});
async function fixture() {
    const repo = await mkdtemp(join(tmpdir(), "wringer-cli-test-"));
    roots.push(repo);
    await git(repo, ["init", "-b", "main"]);
    for (const [k, v] of [["user.name", "Fixture"], ["user.email", "fixture@example.invalid"], ["commit.gpgsign", "false"]])
        await git(repo, ["config", k!, v!]);
    await writeFile(join(repo, ".gitignore"), ".wringer/\n");
    await writeFile(join(repo, "source.txt"), "broken\n");
    await writeFile(join(repo, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "check", run: "test $(cat source.txt) = fixed" }], show: { human: "echo 'A clear display'" }, run: { worker: "sh fix.sh", max_iterations: 2, worker_timeout: 3 } }));
    await writeFile(join(repo, "fix.sh"), "printf 'fixed\\n' > source.txt\n");
    await writeFile(join(repo, "wringer.spec.yaml"), JSON.stringify({ schema_version: "wringer.spec.v1", approved: true, title: "Fixture", intent: "Build it", criteria: [{ id: "human", title: "A person judges it", human: true }], tasks: [{ id: "build", brief: "brief.md", objective: "Build it" }] }));
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "fixture"]);
    return repo;
}
test("argument parsing refuses duplicates and preserves quoted values", () => { expect(parseArgs(["verify", "--gate", "one", "--gate", "two"]).flags.get("gate")).toEqual(["one", "two"]); expect(() => parseArgs(["run", "--task", "a", "--task", "b"])).toThrow("more than once"); expect(parseArgs(["graph", "run", "--resume", "a/b"]).flags.get("resume")).toBe("a/b"); });
test("all three front doors have usable help without a project or agent", async () => {
    for (const surface of ["wring", "wringer-board", "wringer-drive"]) {
        const result = await dispatch(["--help"], surface);
        expect(result.text!.length).toBeGreaterThan(100);
    }
    await expect(dispatch(["verify", "--misspelled"])).rejects.toThrow();
});
test("pen needs a successful exact display, keeps person's note and refuses source movement", async () => { const repo = await fixture(), display = await showCriterion(repo, "human"); expect(display.success).toBe(true); const note = "I saw it: # clear, not a model verdict."; const result = await recordJudgement(repo, { criterion: "human", display: display.id, by: "Fixture person", verdict: "met", note }); expect(result.entry.note).toBe(note); const second = await showCriterion(repo, "human"); await writeFile(join(repo, "source.txt"), "changed\n"); await expect(recordJudgement(repo, { criterion: "human", display: second.id, by: "Fixture person", verdict: "met", note })).rejects.toThrow("working tree changed"); });
test("failed display cannot silently record a met verdict", async () => { const repo = await fixture(), path = join(repo, ".wringer.yaml"), config = JSON.parse(await readFile(path, "utf8")); config.show.human = "echo 'display failed' >&2; exit 7"; await writeFile(path, JSON.stringify(config)); const display = await showCriterion(repo, "human"); expect(display.success).toBe(false); const options = { criterion: "human", display: display.id, by: "Fixture person", verdict: "met" as const, note: "I independently inspected the actual result." }; await expect(recordJudgement(repo, options)).rejects.toThrow("No judgement was recorded"); const recorded = await recordJudgement(repo, { ...options, withoutDisplay: true }); expect(recorded.entry.show_failure).toContain("display failed"); expect(recorded.entry.judged_without_display).toBe(true); });
test("URL rules reject embedded tokens and allow declared loopback endpoints", () => {
    for (const url of ["https://user:password@example.test/api", "http://example.test/api", "https://example.test/api?token=secret"])
        expect(() => safeURL(url)).toThrow();
    expect(safeURL("http://127.0.0.1:1234/api").hostname).toBe("127.0.0.1");
});
test("get clones a local origin, runs no cloned command, and refuses overwrite", async () => { const repo = await fixture(), target = join(repo, "acquired"); const result = await getRepository(`file://${repo}`, target); expect(result.head_sha).toBeTruthy(); expect(await Bun.file(join(target, ".wringer.yaml")).exists()).toBe(true); expect(await readFile(join(target, "source.txt"), "utf8")).toBe("broken\n"); await expect(getRepository(`file://${repo}`, target)).rejects.toThrow("not empty"); });
test("issue importer maps declared forge and refuses to overwrite a person's document", async () => { const repo = await fixture(), path = join(repo, ".wringer.yaml"), config = JSON.parse(await readFile(path, "utf8")); config.forge = { kind: "github", endpoint: "http://127.0.0.1:1", repo: "owner/project", token_env: "FIXTURE_TOKEN" }; await writeFile(path, JSON.stringify(config)); let called = ""; const transport: typeof fetch = (async (url: any) => { called = String(url); return Response.json({ title: "A requirement", body: "Preserve these exact words." }); }) as typeof fetch; const imported = await issue(repo, "12", { transport }); expect(called).toContain("/repos/owner/project/issues/12"); await writeFile(imported.path, "A person's file"); await expect(issue(repo, "12", { transport })).rejects.toThrow("not owned"); });
test("two-worker bench keeps real outcomes and uses the same committed baseline", async () => { const repo = await fixture(), path = join(repo, ".wringer.yaml"), config = JSON.parse(await readFile(path, "utf8")); delete config.show; await rm(join(repo, "wringer.spec.yaml")); config.bench = { contender_wall_clock: 10, contenders: [{ id: "repair", worker: "sh fix.sh" }, { id: "no-change", worker: "true" }] }; await writeFile(path, JSON.stringify(config)); await git(repo, ["add", "."]); await git(repo, ["commit", "-m", "benchmark setup"]); const dry = await bench(repo); expect(dry.status).toBe("prepared"); const result = await bench(repo, { send: true }); expect(result.status).toBe("completed"); expect((result as any).contenders.map((r: any) => r.contender)).toEqual(["repair", "no-change"]); expect((result as any).contenders[0].outcome).toBe("converged"); expect((result as any).contenders[1].reason).toBe("no_progress"); }, 20000);
