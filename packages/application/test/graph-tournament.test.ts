/** Deterministic tournament adapter fixtures: real Git, real source transport, real
 * controller journals and a real local bare origin; synthetic ACP replies, and a
 * verifier that really runs each check, challenge and evaluator gate on the exported
 * tree with pinned files overlaid. No container, provider, model or human decision
 * is measured. */
import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { compileContainedGraph, compileDeclaration, createGraphAuthority, hashBytes, hashValue } from "@wringer/plan";
import { processDriver, runtimeProvenanceVersion, type ContainedCommandRequest, type ContainedCommandResult, type PreparedRepositorySource, type RoleExecutionRequest, type RoleExecutionResult } from "@wringer/runtime";
import { advanceContainedGraph, decideContainedGraph, initializeContainedGraph, readContainedGraph, sendContainedGraph, type GraphState } from "@wringer/scheduler";
import { attachGraphRootSource, containedGraphDriver, exportContainedGraph, graphStatusView, readControllerFile, tournamentSelection } from "../src";
import { inspectGraph } from "../../../examples/evidence/read-bundle.mjs";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function git(args: string[], allowed = [0]) { const r = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Tournament fixture", "-c", "user.email=fixture@example.invalid", ...args], { timeoutMs: 20000 }); if (!allowed.includes(r.code)) throw new Error(r.stderr); return r.stdout.trim(); }

const bodies = { arith: "echo $(( $1 + $2 ))", expr: "expr \"$1\" + \"$2\"", awk: "awk -v a=\"$1\" -v b=\"$2\" 'BEGIN { print a + b }'", hardcoded: "echo 5", strip: "echo $(( ${1#-} + ${2#-} ))", awkAbs: "awk -v a=\"$1\" -v b=\"$2\" 'BEGIN { if (a < 0) a = -a; if (b < 0) b = -b; print a + b }'", sed: "a=$(echo \"$1\" | sed 's/^-//'); b=$(echo \"$2\" | sed 's/^-//'); echo $(( a + b ))", wrong: "echo 6" };
const grid = { id: "grid", criterion: "sum", argv: ["sh", "wringer/challenges/grid.sh"], timeout_seconds: 10, files: [{ path: "wringer/challenges/grid.sh", content: "for a in 0 1 4; do for b in 0 2 9; do test \"$(sh src/total.sh $a $b)\" = $(( a + b )) || exit 1; done; done\n" }] };
const negative = { id: "negative", criterion: "sum", argv: ["sh", "wringer/challenges/negative.sh"], timeout_seconds: 10, files: [{ path: "wringer/challenges/negative.sh", content: "test \"$(sh src/total.sh -1 1)\" = 0\n" }] };
const wrongExpectation = { id: "wrong-expectation", criterion: "sum", argv: ["sh", "wringer/challenges/wrong.sh"], timeout_seconds: 10, files: [{ path: "wringer/challenges/wrong.sh", content: "test \"$(sh src/total.sh 2 2)\" = 5\n" }] };
type Options = { branches: Record<string, keyof typeof bodies>; challenges?: unknown; tie?: "no-winner" | "tree-order"; order?: string[]; controls?: "reference" | "missing" | "none"; prosecutorPatch?: (write: (path: string, content: string) => Promise<string>, modify: (body: string) => Promise<string>) => Promise<string>; evaluatorBreaks?: boolean; sessions?: Record<string, number>; tamperChallengeRuns?: boolean };

async function fixture(options: Options) {
    const root = await mkdtemp(join(tmpdir(), "wringer-tournament-adapter-")); directories.push(root);
    const repo = join(root, "source"), origin = join(root, "origin.git"), graphDir = join(root, "graph"), url = "https://fixture.invalid/totals.git";
    await git(["init", "--initial-branch=main", repo]); await git(["init", "--bare", "--initial-branch=main", origin]);
    await mkdir(join(repo, "src"));
    await writeFile(join(repo, "README.md"), "Tournament fixture.\n"); await writeFile(join(repo, "src/total.sh"), "#!/bin/sh\necho $(( $1 + $2 + 1 ))\n");
    await writeFile(join(repo, "check.sh"), "test \"$(sh src/total.sh 2 3)\" = 5\n");
    await git(["-C", repo, "add", "."]); await git(["-C", repo, "commit", "-m", "Buggy base"]); await git(["-C", repo, "push", origin, "main"]);
    const commit = await git(["-C", repo, "rev-parse", "HEAD"]);
    const patch = async (body: string) => { await writeFile(join(repo, "src/total.sh"), `#!/bin/sh\n${body}\n`); await git(["-C", repo, "add", "-A"]); const diff = await git(["-C", repo, "diff", "--cached", "--binary", "--full-index"]) + "\n"; await git(["-C", repo, "reset", "-q", "--hard", "HEAD"]); return diff; };
    const patches: Record<string, string> = {};
    for (const [branch, body] of Object.entries(options.branches)) patches[branch] = await patch(bodies[body]);
    // A trusted control on its own branch, carried by the root bundle beside the base.
    await git(["-C", repo, "checkout", "-q", "-b", "reference"]); await writeFile(join(repo, "src/total.sh"), `#!/bin/sh\n${bodies.arith}\n`); await git(["-C", repo, "commit", "-qam", "Trusted reference"]);
    const control = await git(["-C", repo, "rev-parse", "HEAD"]); await git(["-C", repo, "checkout", "-q", "main"]);
    const bundle = join(root, "source.bundle"); await git(["-C", repo, "bundle", "create", bundle, "main", "reference"]);
    const artifact = async (path: string, content: string) => { const scratch = join(root, `artifact-${crypto.randomUUID()}`); await git(["init", "-q", scratch]); await mkdir(join(scratch, path, ".."), { recursive: true }); await writeFile(join(scratch, path), content); await git(["-C", scratch, "add", "-A"]); return await git(["-C", scratch, "diff", "--cached", "--binary", "--full-index"]) + "\n"; };
    const prosecution = options.prosecutorPatch ? await options.prosecutorPatch(artifact, patch) : await artifact("wringer/challenges.json", JSON.stringify(options.challenges ?? [grid]));
    const runtime = { kind: "apple-container", image: `fixture.invalid/agent@sha256:${"a".repeat(64)}`, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] };
    const declaration = (intent: string, writable: string[], sessions = 2) => compileDeclaration({ version: 3, name: "Fix the total", intent, repository: { url, commit }, runtime,
        agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } },
        environment: { context: ["README.md"], tools: [], setup: [], baseline: [], writable_directories: [] }, scope: { writable },
        acceptance: { criteria: [{ id: "sum", title: "Sum", quote: "Return the sum of two integers", kind: "check", required: true }], checks: [{ id: "sum", argv: ["sh", "check.sh"], cwd: ".", timeout_seconds: 5, criteria: ["sum"], files: ["check.sh"] }], protected_paths: [] },
        budget: { max_sessions: sessions, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 3600, session_timeout_seconds: 900 } });
    const order = options.order ?? Object.keys(options.branches);
    const graph = compileContainedGraph({ version: 3, id: "tournament-fixture", repository: { url, commit }, entry: "split", required: ["pick", "review", "ship"], parallelism: 3,
        budget: { maxRoleSessions: order.length * 2 + 1, maxVerificationAttempts: order.length * 3 + 1 + 2 * order.length, wallClockSeconds: 1800 },
        nodes: { split: { kind: "fork", input: "root", branches: order, join: "pick" },
            ...Object.fromEntries(order.map(branch => [branch, { kind: "loop", input: "split", plan: declaration(`Return the sum of two integers (attempt ${branch}).`, ["src"], options.sessions?.[branch] ?? 2), then: "pick" }])),
            pick: { kind: "tournament", fork: "split", prosecutor: { plan: declaration("Return the sum of two integers; try to falsify every candidate.", ["wringer/challenges.json"]), maxChallenges: 4 },
                controls: options.controls === "none" ? [] : [{ id: "reference", commit: options.controls === "missing" ? "e".repeat(40) : control }],
                evaluator: [{ id: "hidden", argv: ["sh", "evaluator/hidden.sh"], cwd: ".", timeout_seconds: 10, files: [{ path: "evaluator/hidden.sh", content: options.evaluatorBreaks ? "exit 1\n" : "for a in -3 0 2 7; do for b in -2 0 3 5; do test \"$(sh src/total.sh $a $b)\" = $(( a + b )) || exit 1; done; done\n" }] }],
                tie: options.tie ?? "tree-order", then: "review" },
            review: { kind: "human-hold", input: "pick", prompt: "Inspect the selected candidate and the tournament record.", then: "ship" },
            ship: { kind: "delivery", input: "review", publication: { remote: origin, sourceBranch: "wringer/tournament", targetBranch: "main" }, then: "done" } } });
    const at = new Date(); await initializeContainedGraph(graphDir, graph, createGraphAuthority(graph, { actor: "Scripted engineering fixture", at, expiresAt: new Date(at.getTime() + 1800000).toISOString() }));
    await attachGraphRootSource(graphDir, bundle);
    const provenance = (role: "worker" | "judge" | "verifier", source: { url: string; commit: string }, rt: any) => ({ schema_version: runtimeProvenanceVersion(source.url), runtimeId: crypto.randomUUID(), role, kind: rt.kind, image: rt.image, repository: { url: source.url, commit: source.commit }, clonedInside: true as const, hostMounts: [] as [], repositoryAccess: role === "worker" ? "read-write" as const : "read-only" as const, declared: rt, observed: { fixture: true, writableDirectories: [] }, limits: ["Synthetic fixture receipt"] });
    const commands: string[] = [];
    const runCommands = async (request: ContainedCommandRequest): Promise<ContainedCommandResult> => {
        const source = request.repo as PreparedRepositorySource, acceptance = request.acceptanceSource as PreparedRepositorySource;
        const tree = await git(["--git-dir", source.objectStore, "rev-parse", `${source.commit}^{tree}`]), work = await mkdtemp(join(root, "verify-"));
        await git(["--git-dir", source.objectStore, "--work-tree", work, "checkout", source.commit, "--", "."]);
        for (const path of request.protectedFiles ?? []) { await mkdir(join(work, path, ".."), { recursive: true }); await writeFile(join(work, path), await git(["--git-dir", acceptance.objectStore, "show", `${acceptance.commit}:${path}`]) + "\n"); }
        const inputs = await git(["--git-dir", acceptance.objectStore, "--literal-pathspecs", "ls-tree", "-r", "-z", acceptance.commit, "--", "check.sh"]);
        const tampered = options.tamperChallengeRuns && request.commands.some(c => c.id.startsWith("challenge/")) && request.repo.commit !== control;
        return { provenance: { ...provenance("verifier", source, request.runtime), ...(tampered ? { hostMounts: ["/Users"] as any } : {}) }, sourceChanged: false, sourceTree: tree, checkInputsSha256: hashBytes(inputs), results: request.commands.map(c => { commands.push(`${c.id}@${source.commit.slice(0, 7)}`); return { id: c.id, code: /^(acceptance|challenge|evaluator)\//.test(c.id) ? Bun.spawnSync(c.argv!, { cwd: work, stdout: "ignore", stderr: "ignore" }).exitCode : 0, stdout: "Ran on the exported tree\n", stderr: "", durationMs: 1 }; }) };
    };
    const roles: string[] = [];
    const executeRole = async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => {
        const prosecutor = request.prompt.includes("You are the prosecutor"); roles.push(prosecutor ? "prosecutor" : request.role);
        const branch = /\(attempt ([a-z0-9-]+)\)/.exec(request.prompt)?.[1], change = prosecutor ? prosecution : patches[branch!]!;
        return ({ status: "completed", text: request.role === "worker" ? "Synthetic worker" : JSON.stringify({ criteria: [{ id: "sum", met: true, reason: "Synthetic finding" }], note: "Fixture only" }), sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "synthetic-tournament-fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: provenance(request.role as "worker" | "judge", request.repo, request.runtime), ...(request.role === "worker" ? { change: { baseCommit: request.repo.commit, patch: change, sha256: hashBytes(change) } } : {}) }) as RoleExecutionResult;
    };
    return { root, origin, graphDir, graph, commit, control, roles, commands, driver: containedGraphDriver({ executeRole, runCommands }) };
}
const record = async (graphDir: string) => readControllerFile(join(graphDir, "children/pick/tournament.json"));
const assessment = async (graphDir: string) => readControllerFile(join(graphDir, "children/pick/assessment.json"));
const decide = (state: GraphState, node = state.active[0]!) => ({ node, expectedRevision: state.revision, inputSha256: hashValue(state.nodes[node]!.reservation.input), choice: "continue" as const, actor: "Scripted engineering fixture", note: "Fixture checkpoint; not an independent acceptance." });

test("a persuasive but wrong candidate is disqualified by a validated challenge; the survivor tie is broken by tree id and delivered", async () => {
    const f = await fixture({ branches: { "build-a": "hardcoded", "build-b": "arith", "build-c": "expr" } }), held = await advanceContainedGraph(f.graphDir, f.driver);
    expect(held.phase).toBe("human-hold"); expect(held.active).toEqual(["review"]);
    const t = await record(f.graphDir);
    expect(t.candidates.every((row: any) => row.eligible)).toBe(true);
    expect(t.challenges.map((row: any) => [row.id, row.validation])).toEqual([["grid", "valid"]]);
    expect(t.runs.find((row: any) => row.branch === "build-a")).toMatchObject({ outcome: "disqualified", reproduced: ["grid"] });
    const survivors = t.candidates.filter((row: any) => row.branch !== "build-a").sort((x: any, y: any) => x.tree.localeCompare(y.tree));
    expect(t.selection).toMatchObject({ outcome: "selected", selected: survivors[0].branch, survivors: survivors.map((row: any) => row.branch) });
    expect(held.nodes.pick!.result!.candidate).toMatchObject({ owner: "pick", tree: survivors[0].tree });
    expect(tournamentSelection(t, "tree-order")).toEqual(t.selection);
    const a = await assessment(f.graphDir); expect(a.tournamentSha256).toBe(t.sha256);
    expect(a.candidates.find((row: any) => row.branch === "build-a").outcome).toBe("failed"); expect(a.candidates.filter((row: any) => row.outcome === "passed")).toHaveLength(2);
    expect(f.roles.filter(role => role === "prosecutor")).toHaveLength(1);
    const ajv = addFormats(new Ajv2020({ strict: false }));
    for (const [name, value] of [["contained-graph-tournament-v1", t], ["contained-graph-tournament-assessment-v1", a], ["contained-graph-status-v3", graphStatusView(f.graphDir, held)]] as const) expect(ajv.validate(await Bun.file(new URL(`../../../schema/${name}.schema.json`, import.meta.url)).json(), value)).toBe(true);
    await decideContainedGraph(f.graphDir, decide(held));
    const ready = await advanceContainedGraph(f.graphDir, f.driver); expect(ready.phase).toBe("send-hold");
    const done = await sendContainedGraph(f.graphDir, { node: "ship", expectedRevision: ready.revision, preparedSha256: hashValue(ready.nodes.ship!.prepared), actor: "Scripted engineering fixture", note: "Fixture Send to a local bare origin." }, f.driver);
    expect(done.phase).toBe("complete");
    const sent = await readControllerFile(join(f.graphDir, "children/ship/sent.json"));
    expect(await git(["--git-dir", f.origin, "rev-parse", `${sent.evidenceCommit}^`])).toBe(survivors[0].commit);
    const clone = join(f.root, "clone"); await git(["clone", "--no-local", "--branch", "wringer/tournament", f.origin, clone]);
    const audit = Bun.spawnSync(["/bin/sh", "-c", sent.auditCommand.replace(/^node /, `${Bun.which("node")} `)], { cwd: clone, stdout: "pipe", stderr: "pipe" });
    expect(audit.exitCode).toBe(0); expect(JSON.parse(audit.stdout.toString()).nodes.map((row: any) => row.id)).toContain("pick");
    const output = join(f.root, "export"), index = await exportContainedGraph(f.graphDir, output);
    expect(index.schema_version).toBe("wringer.contained-graph-export.v3");
    expect(ajv.validate(await Bun.file(new URL("../../../schema/contained-graph-export-v3.schema.json", import.meta.url)).json(), index)).toBe(true);
    expect((await inspectGraph(output)).finished).toBe("done");
    // A forged run that hides the reproduced challenge no longer matches the recorded selection.
    const forged = `${output}-forged`; await cp(output, forged, { recursive: true });
    const evidence = join(forged, "nodes/pick/tournament.json"), value = JSON.parse(await readFile(evidence, "utf8"));
    const run = value.tournament.runs.find((row: any) => row.branch === "build-a"); run.outcome = "survived"; run.reproduced = []; run.results[0].code = 0;
    const { sha256, ...body } = value.tournament; value.tournament.sha256 = hashValue(body); value.assessment.tournamentSha256 = value.tournament.sha256; const { sha256: _, ...assessed } = value.assessment; value.assessment.sha256 = hashValue(assessed);
    await writeFile(evidence, JSON.stringify(value));
    const graphIndex = JSON.parse(await readFile(join(forged, "graph.json"), "utf8")); graphIndex.files["nodes/pick/tournament.json"] = new Bun.CryptoHasher("sha256").update(await readFile(evidence)).digest("hex"); await writeFile(join(forged, "graph.json"), JSON.stringify(graphIndex));
    await expect(inspectGraph(forged)).rejects.toThrow("Tournament pick");
    // An assessment rewritten after the fact no longer matches the digest the graph recorded.
    const rewritten = `${output}-assessment`; await cp(output, rewritten, { recursive: true });
    const carried = join(rewritten, "nodes/pick/tournament.json"), changed = JSON.parse(await readFile(carried, "utf8"));
    changed.assessment.candidates.find((row: any) => row.branch === "build-a").outcome = "passed"; const { sha256: __, ...rest } = changed.assessment; changed.assessment.sha256 = hashValue(rest);
    await writeFile(carried, JSON.stringify(changed));
    const rewrittenIndex = JSON.parse(await readFile(join(rewritten, "graph.json"), "utf8")); rewrittenIndex.files["nodes/pick/tournament.json"] = new Bun.CryptoHasher("sha256").update(await readFile(carried)).digest("hex"); await writeFile(join(rewritten, "graph.json"), JSON.stringify(rewrittenIndex));
    await expect(inspectGraph(rewritten)).rejects.toThrow("evidence does not match its recorded result");
}, 240000);
test("a challenge run that cannot show its exact candidate in a contained verifier makes the tournament unavailable", async () => {
    const f = await fixture({ branches: { "build-a": "hardcoded", "build-b": "arith" }, tamperChallengeRuns: true }), state = await advanceContainedGraph(f.graphDir, f.driver);
    const t = await record(f.graphDir);
    expect(t.challenges[0].validation).toBe("valid"); expect(t.runs.every((row: any) => row.outcome === "unavailable")).toBe(true);
    expect(t.selection.outcome).toBe("unavailable"); expect(state.phase).toBe("failed");
}, 240000);
test("a dishonest record whose selection does not follow from its own runs is refused by the Node reader", async () => {
    const f = await fixture({ branches: { "build-a": "hardcoded", "build-b": "arith", "build-c": "expr" } }), honest = f.driver.dispatch.bind(f.driver);
    // A dishonest adapter: every digest is restamped, but the disqualified attempt is "selected".
    f.driver.dispatch = async request => {
        await honest(request);
        if (request.node !== "pick") return;
        const directory = join(f.graphDir, "children/pick"), t = await record(f.graphDir), a = await assessment(f.graphDir);
        t.selection = { ...t.selection, survivors: ["build-a"], selected: "build-a", outcome: "selected", reason: "Forged" };
        const { sha256, ...body } = t; t.sha256 = hashValue(body); a.tournamentSha256 = t.sha256; const { sha256: _, ...rest } = a; a.sha256 = hashValue(rest);
        for (const [name, value] of [["tournament.json", t], ["assessment.json", a]] as const) { await rm(join(directory, name)); await writeFile(join(directory, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }); }
    };
    const held = await advanceContainedGraph(f.graphDir, f.driver);
    expect(held.nodes.pick!.result!.candidate!.tree).toBe((await record(f.graphDir)).candidates.find((row: any) => row.branch === "build-a").tree);
    const output = join(f.root, "export"); await expect(exportContainedGraph(f.graphDir, output)).rejects.toThrow("selection does not follow from its recorded runs");
}, 240000);
test("a shared defect reproduced on every candidate leaves no winner, never a vote", async () => {
    const f = await fixture({ branches: { "build-a": "strip", "build-b": "awkAbs", "build-c": "sed" }, challenges: [negative] }), state = await advanceContainedGraph(f.graphDir, f.driver);
    const t = await record(f.graphDir);
    expect(t.runs.map((row: any) => row.outcome)).toEqual(["disqualified", "disqualified", "disqualified"]);
    expect(t.selection).toMatchObject({ outcome: "no-winner", selected: null, survivors: [] });
    expect(state.phase).toBe("failed"); expect(state.nodes.pick!.result).toMatchObject({ outcome: "no-winner", candidate: null }); expect(state.nodes.review).toBeUndefined();
    expect((await assessment(f.graphDir)).candidates.map((row: any) => row.outcome)).toEqual(["failed", "failed", "failed"]);
}, 240000);
test("a spurious challenge fails the trusted control and disqualifies nobody; a declared no-winner tie holds", async () => {
    const f = await fixture({ branches: { "build-a": "arith", "build-b": "hardcoded", "build-c": "awk" }, challenges: [wrongExpectation, grid], tie: "no-winner" }), state = await advanceContainedGraph(f.graphDir, f.driver);
    const t = await record(f.graphDir);
    expect(t.challenges.map((row: any) => [row.id, row.validation])).toEqual([["wrong-expectation", "spurious"], ["grid", "valid"]]);
    expect(t.runs.every((row: any) => row.results.every((result: any) => result.challenge === "grid"))).toBe(true);
    expect(f.commands.some(row => row.startsWith("challenge/wrong-expectation") && !row.endsWith(f.control.slice(0, 7)))).toBe(false);
    expect(t.selection).toMatchObject({ outcome: "no-winner", survivors: expect.arrayContaining(["build-a", "build-c"]) }); expect(t.selection.reason).toContain("tie");
    expect(state.phase).toBe("failed");
}, 240000);
test("a branch that stops arrives disqualified and the graph still selects among the rest", async () => {
    const f = await fixture({ branches: { "build-a": "arith", "build-b": "wrong", "build-c": "hardcoded" }, sessions: { "build-b": 1 } }), state = await advanceContainedGraph(f.graphDir, f.driver);
    const t = await record(f.graphDir);
    expect(t.candidates.find((row: any) => row.branch === "build-b")).toMatchObject({ eligible: false, outcome: "stopped" });
    expect(t.selection).toMatchObject({ outcome: "selected", selected: "build-a" }); expect(state.active).toEqual(["review"]);
}, 240000);
test("the selection does not depend on branch order", async () => {
    const first = await fixture({ branches: { "build-a": "hardcoded", "build-b": "arith", "build-c": "expr" } });
    const second = await fixture({ branches: { "build-a": "hardcoded", "build-b": "arith", "build-c": "expr" }, order: ["build-c", "build-a", "build-b"] });
    const left = await advanceContainedGraph(first.graphDir, first.driver), right = await advanceContainedGraph(second.graphDir, second.driver);
    expect(left.nodes.pick!.result!.candidate!.tree).toBe(right.nodes.pick!.result!.candidate!.tree);
    const [x, y] = [await record(first.graphDir), await record(second.graphDir)];
    expect(x.selection.selected).toBe(y.selection.selected);
    const labels = (row: any) => Object.fromEntries(row.candidates.map((c: any) => [c.tree, c.label]));
    expect(labels(x)).toEqual(labels(y));
}, 240000);
test("the final evaluator is recorded after the selection and never changes it", async () => {
    const f = await fixture({ branches: { "build-a": "strip", "build-b": "hardcoded", "build-c": "wrong" }, sessions: { "build-c": 1 } }), state = await advanceContainedGraph(f.graphDir, f.driver);
    const t = await record(f.graphDir), a = await assessment(f.graphDir);
    expect(t.selection).toMatchObject({ outcome: "selected", selected: "build-a" });
    expect(a.candidates.find((row: any) => row.branch === "build-a").outcome).toBe("failed");
    expect(state.nodes.pick!.result!.outcome).toBe("selected");
    const order = f.commands.map(row => row.split("/")[0]);
    expect(order.lastIndexOf("challenge")).toBeLessThan(order.indexOf("evaluator"));
}, 240000);
test("a prosecutor that edits anything but its challenge file makes the tournament unavailable", async () => {
    const f = await fixture({ branches: { "build-a": "arith", "build-b": "hardcoded" }, prosecutorPatch: async (write, modify) => (await write("wringer/challenges.json", JSON.stringify([grid]))) + (await modify("echo 5")) });
    const state = await advanceContainedGraph(f.graphDir, f.driver), t = await record(f.graphDir);
    expect(t.prosecutor.status).toBe("stopped"); expect(t.prosecutor.reason).toContain("other than");
    expect(t.selection.outcome).toBe("unavailable"); expect(state.phase).toBe("failed");
}, 240000);
test("challenges beyond the declared limit or citing no requirement are refused", async () => {
    const tooMany = await fixture({ branches: { "build-a": "arith", "build-b": "expr" }, challenges: [1, 2, 3, 4, 5].map(n => ({ ...grid, id: `grid-${n}`, files: [{ ...grid.files[0]!, path: `wringer/challenges/grid-${n}.sh` }], argv: ["sh", `wringer/challenges/grid-${n}.sh`] })) });
    await advanceContainedGraph(tooMany.graphDir, tooMany.driver); expect((await record(tooMany.graphDir)).prosecutor.reason).toContain("at most 4");
    const uncited = await fixture({ branches: { "build-a": "arith", "build-b": "expr" }, challenges: [{ ...grid, criterion: "speed" }] });
    await advanceContainedGraph(uncited.graphDir, uncited.driver); expect((await record(uncited.graphDir)).prosecutor.reason).toContain("cites no requirement");
    const outside = await fixture({ branches: { "build-a": "arith", "build-b": "expr" }, challenges: [{ ...grid, files: [{ path: "src/total.sh", content: "echo 5\n" }] }] });
    await advanceContainedGraph(outside.graphDir, outside.driver); expect((await record(outside.graphDir)).prosecutor.reason).toContain("never replaces candidate files");
}, 240000);
test("without a trusted control, challenges are advisory and disqualify nobody", async () => {
    const f = await fixture({ branches: { "build-a": "hardcoded", "build-b": "arith" }, controls: "none", tie: "no-winner" }); await advanceContainedGraph(f.graphDir, f.driver);
    const t = await record(f.graphDir);
    expect(t.challenges[0].validation).toBe("advisory"); expect(t.runs.find((row: any) => row.branch === "build-a")).toMatchObject({ outcome: "survived", reproduced: [] });
    expect(t.runs.find((row: any) => row.branch === "build-a").results[0].code).not.toBe(0);
    expect(t.selection.outcome).toBe("no-winner");
}, 240000);
test("a trusted control missing from the root bundle is refused before the tournament dispatches", async () => {
    const f = await fixture({ branches: { "build-a": "arith", "build-b": "expr" }, controls: "missing" });
    await expect(advanceContainedGraph(f.graphDir, f.driver)).rejects.toThrow("is not in the graph's root source bundle");
    const state = await readContainedGraph(f.graphDir);
    expect(state.nodes.pick!.dispatched).toBe(false); expect(f.roles).not.toContain("prosecutor");
}, 240000);
