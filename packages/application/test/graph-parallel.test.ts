/** Deterministic parallel graph adapter fixtures: real Git, real source transport,
 * real controller journals, real merges and a real local bare origin; synthetic
 * ACP replies and a verifier that really runs each plan's check on the exported
 * tree. No container, provider, model or human decision is measured. */
import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { compileContainedGraph, compileDeclaration, createGraphAuthority, hashBytes, hashValue } from "@wringer/plan";
import { createLocalSourceBundle, processDriver, runtimeProvenanceVersion, type ContainedCommandRequest, type ContainedCommandResult, type PreparedRepositorySource, type RoleExecutionRequest, type RoleExecutionResult } from "@wringer/runtime";
import { advanceContainedGraph, decideContainedGraph, initializeContainedGraph, readContainedGraph, sendContainedGraph, type GraphState } from "@wringer/scheduler";
import { attachGraphRootSource, containedGraphDriver, exportContainedGraph, graphStatusView, readControllerFile } from "../src";
import { inspectGraph } from "../../../examples/evidence/read-bundle.mjs";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function git(args: string[], allowed = [0]) { const r = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Parallel fixture", "-c", "user.email=fixture@example.invalid", ...args], { timeoutMs: 20000 }); if (!allowed.includes(r.code)) throw new Error(r.stderr); return r.stdout.trim(); }
type Scenario = "independent" | "semantic" | "conflict";

/** Branch A must finish src/a.js and branch B src/b.js; each plan checks its own file.
 * "semantic" adds a shared rule that each branch satisfies alone and the merge breaks.
 * "conflict" makes both branches rewrite the same line. */
async function fixture(scenario: Scenario = "independent", options: { parallelism?: number } = {}) {
    const root = await mkdtemp(join(tmpdir(), "wringer-parallel-adapter-")); directories.push(root);
    const repo = join(root, "source"), origin = join(root, "origin.git"), graphDir = join(root, "graph");
    await git(["init", "--initial-branch=main", repo]); await git(["init", "--bare", "--initial-branch=main", origin]);
    await mkdir(join(repo, "src/items"), { recursive: true });
    await writeFile(join(repo, "README.md"), "Parallel graph fixture.\n");
    await writeFile(join(repo, "src/a.js"), "export const a = 'todo';\n"); await writeFile(join(repo, "src/b.js"), "export const b = 'todo';\n");
    await writeFile(join(repo, "src/count.txt"), "1\n"); await writeFile(join(repo, "src/items/.keep"), "");
    const shared = scenario === "semantic" ? ` && test "$(cat src/count.txt)" = "$(ls src/items | wc -l | tr -d ' ')"` : "";
    // The shared rule lives in branch B's plan only: the join must verify against every branch plan to see it break.
    await writeFile(join(repo, "check-a.sh"), `grep -q "'done'" src/a.js\n`); await writeFile(join(repo, "check-b.sh"), `grep -q "'done'" src/b.js${shared}\n`);
    await git(["-C", repo, "add", "."]); await git(["-C", repo, "commit", "-m", "Fixture baseline"]); await git(["-C", repo, "push", origin, "main"]);
    const commit = await git(["-C", repo, "rev-parse", "HEAD"]), bundle = join(root, "source.bundle");
    await createLocalSourceBundle(repo, commit, bundle);
    const edit = async (change: () => Promise<void>) => { await change(); await git(["-C", repo, "add", "-A"]); const diff = await git(["-C", repo, "diff", "--cached", "--binary", "--full-index"]) + "\n"; await git(["-C", repo, "reset", "-q", "--hard", "HEAD"]); await git(["-C", repo, "clean", "-q", "-fd"]); return diff; };
    const line = scenario === "conflict" ? "src/a.js" : undefined;
    const patches = {
        a: await edit(async () => { await writeFile(join(repo, "src/a.js"), "export const a = 'done';\n"); if (scenario === "semantic") await writeFile(join(repo, "src/items/a"), "a\n"); }),
        b: await edit(async () => { await writeFile(join(repo, line ?? "src/b.js"), line ? "export const a = 'other';\nexport const b = 'done';\n" : "export const b = 'done';\n"); if (line) await writeFile(join(repo, "src/b.js"), "export const b = 'done';\n"); if (scenario === "semantic") await writeFile(join(repo, "src/items/b"), "b\n"); }),
    };
    const leaf = (name: "a" | "b") => compileDeclaration({ version: 3, name: `Finish ${name}`, intent: `Finish ${name}.`, repository: { url: "https://fixture.invalid/parallel.git", commit },
        runtime: { kind: "apple-container", image: `fixture.invalid/agent@sha256:${"a".repeat(64)}`, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] },
        agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } },
        environment: { context: ["README.md"], tools: [], setup: [], baseline: [], writable_directories: [] }, scope: { writable: ["src"] },
        acceptance: { criteria: [{ id: "done", title: `Finish ${name}`, quote: `Finish ${name}.`, kind: "check", required: true }], checks: [{ id: "done", argv: ["sh", `check-${name}.sh`], cwd: ".", timeout_seconds: 5, criteria: ["done"], files: ["check-a.sh", "check-b.sh"] }], protected_paths: ["check-a.sh", "check-b.sh"] },
        budget: { max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 3600, session_timeout_seconds: 900 } });
    const graph = compileContainedGraph({ version: 2, id: `parallel-${scenario}`, repository: { url: "https://fixture.invalid/parallel.git", commit }, entry: "split", required: ["build-a", "build-b", "review", "ship"], parallelism: options.parallelism ?? 2,
        budget: { maxRoleSessions: 8, maxVerificationAttempts: 12, wallClockSeconds: 1800 },
        nodes: { split: { kind: "fork", input: "root", branches: ["build-a", "build-b"], join: "merge" },
            "build-a": { kind: "loop", input: "split", plan: leaf("a"), then: "merge" }, "build-b": { kind: "loop", input: "split", plan: leaf("b"), then: "merge" },
            merge: { kind: "join", fork: "split", then: "after" },
            after: { kind: "router", input: "merge", routes: [{ outcome: "integrated", to: "review" }, { outcome: "failed", to: "resolve" }, { outcome: "conflict", to: "resolve" }], otherwise: "fail" },
            resolve: { kind: "human-hold", input: "root", prompt: "The branches do not integrate. Decide how to proceed.", then: "fail" },
            review: { kind: "human-hold", input: "merge", prompt: "Inspect the integrated candidate.", then: "ship" },
            ship: { kind: "delivery", input: "review", publication: { remote: origin, sourceBranch: "wringer/parallel", targetBranch: "main" }, then: "done" } } });
    const at = new Date(), authority = createGraphAuthority(graph, { actor: "Scripted engineering fixture", at, expiresAt: new Date(at.getTime() + 1800000).toISOString() });
    await initializeContainedGraph(graphDir, graph, authority); await attachGraphRootSource(graphDir, bundle);
    const provenance = (role: "worker" | "judge" | "verifier", source: { url: string; commit: string }, runtime: any) => ({ schema_version: runtimeProvenanceVersion(source.url), runtimeId: crypto.randomUUID(), role, kind: runtime.kind, image: runtime.image, repository: { url: source.url, commit: source.commit }, clonedInside: true as const, hostMounts: [] as [], repositoryAccess: role === "worker" ? "read-write" as const : "read-only" as const, declared: runtime, observed: { fixture: true, writableDirectories: [] }, limits: ["Synthetic fixture receipt"] });
    const runCommands = async (request: ContainedCommandRequest): Promise<ContainedCommandResult> => {
        const source = request.repo as PreparedRepositorySource, acceptance = request.acceptanceSource as PreparedRepositorySource;
        const tree = await git(["--git-dir", source.objectStore, "rev-parse", `${source.commit}^{tree}`]), work = await mkdtemp(join(root, "verify-"));
        await git(["--git-dir", source.objectStore, "--work-tree", work, "checkout", source.commit, "--", "."]);
        const inputs = await git(["--git-dir", acceptance.objectStore, "--literal-pathspecs", "ls-tree", "-r", "-z", acceptance.commit, "--", "check-a.sh", "check-b.sh"]);
        return { provenance: provenance("verifier", source, request.runtime), sourceChanged: false, sourceTree: tree, checkInputsSha256: hashBytes(inputs), results: request.commands.map(c => ({ id: c.id, code: c.id.startsWith("acceptance/") ? Bun.spawnSync(c.argv!, { cwd: work, stdout: "ignore", stderr: "ignore" }).exitCode : 0, stdout: "Ran the pinned check on the exported tree\n", stderr: "", durationMs: 1 })) };
    };
    const roles: string[] = [];
    const executeRole = async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => { roles.push(request.role); const change = request.prompt.includes("Finish a.") ? patches.a : patches.b; return ({ status: "completed", text: request.role === "worker" ? "Synthetic worker" : JSON.stringify({ criteria: [{ id: "done", met: true, reason: "Synthetic finding" }], note: "Fixture only" }), sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "synthetic-parallel-fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: provenance(request.role as "worker" | "judge", request.repo, request.runtime), ...(request.role === "worker" ? { change: { baseCommit: request.repo.commit, patch: change, sha256: hashBytes(change) } } : {}) }) as RoleExecutionResult; };
    return { root, origin, graphDir, graph, commit, roles, driver: containedGraphDriver({ executeRole, runCommands }) };
}
const decide = (state: GraphState, node = state.active[0]!) => ({ node, expectedRevision: state.revision, inputSha256: hashValue(state.nodes[node]!.reservation.input), choice: "continue" as const, actor: "Scripted engineering fixture", note: "Fixture checkpoint, not human acceptance." });

test("two independent branches integrate, pass fresh checks against both plans and publish the graph's own evidence", async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.graphDir, f.driver);
    expect(held.phase).toBe("human-hold"); expect(held.active).toEqual(["review"]);
    expect(held.nodes.merge!.result!.outcome).toBe("integrated"); expect(held.nodes.merge!.result!.candidate!.owner).toBe("merge");
    const integration = await readControllerFile(join(f.graphDir, "children/merge/integration.json"));
    expect(integration.status).toBe("merged"); expect(integration.branches.map((row: any) => row.branch)).toEqual(["build-a", "build-b"]);
    const store = join(f.graphDir, "children/merge/integration.git");
    expect(await git(["--git-dir", store, "show", `${integration.commit}:src/a.js`])).toContain("'done'");
    expect(await git(["--git-dir", store, "show", `${integration.commit}:src/b.js`])).toContain("'done'");
    expect(await git(["--git-dir", store, "rev-list", "--parents", "-n", "1", integration.commit])).toBe(`${integration.commit} ${integration.branches[0].commit} ${integration.branches[1].commit}`);
    expect(f.roles.filter(role => role === "worker")).toHaveLength(2);
    const view: any = graphStatusView(f.graphDir, held), ajv = addFormats(new Ajv2020({ strict: false }));
    expect(ajv.validate(await Bun.file(new URL("../../../schema/contained-graph-status-v2.schema.json", import.meta.url)).json(), view)).toBe(true);
    expect(view.actions.map((row: any) => row.action)).toEqual(["decide"]);
    await decideContainedGraph(f.graphDir, decide(held));
    const ready = await advanceContainedGraph(f.graphDir, f.driver); expect(ready.phase).toBe("send-hold");
    const done = await sendContainedGraph(f.graphDir, { node: "ship", expectedRevision: ready.revision, preparedSha256: hashValue(ready.nodes.ship!.prepared), actor: "Scripted engineering fixture", note: "Fixture Send to a local bare origin." }, f.driver);
    expect(done.phase).toBe("complete");
    const sent = await readControllerFile(join(f.graphDir, "children/ship/sent.json"));
    expect(await git(["--git-dir", f.origin, "rev-parse", "wringer/parallel"])).toBe(sent.evidenceCommit);
    expect(await git(["--git-dir", f.origin, "rev-parse", `${sent.evidenceCommit}^`])).toBe(integration.commit);
    expect(await git(["--git-dir", f.origin, "rev-parse", "main"])).toBe(f.commit);
    const clone = join(f.root, "clone"); await git(["clone", "--no-local", "--branch", "wringer/parallel", f.origin, clone]);
    const audit = Bun.spawnSync(["/bin/sh", "-c", sent.auditCommand.replace(/^node /, `${Bun.which("node")} `)], { cwd: clone, stdout: "pipe", stderr: "pipe" });
    expect(audit.exitCode).toBe(0); expect(JSON.parse(audit.stdout.toString()).nodes.map((row: any) => row.id)).toContain("merge");
    const output = join(f.root, "export"), index = await exportContainedGraph(f.graphDir, output);
    expect(index.schema_version).toBe("wringer.contained-graph-export.v2");
    expect(ajv.validate(await Bun.file(new URL("../../../schema/contained-graph-export-v2.schema.json", import.meta.url)).json(), index)).toBe(true);
    expect((await inspectGraph(output)).finished).toBe("done");
    const forged = `${output}-forged`; await cp(output, forged, { recursive: true });
    const evidence = join(forged, "nodes/merge/integration.json"), value = JSON.parse(await readFile(evidence, "utf8")); value.verifications[1].status = "passed-by-hand"; await writeFile(evidence, JSON.stringify(value));
    const graphIndex = JSON.parse(await readFile(join(forged, "graph.json"), "utf8")); graphIndex.files["nodes/merge/integration.json"] = new Bun.CryptoHasher("sha256").update(await readFile(evidence)).digest("hex"); await writeFile(join(forged, "graph.json"), JSON.stringify(graphIndex));
    await expect(inspectGraph(forged)).rejects.toThrow("Join merge");
}, 240000);
test("a clean merge that breaks a shared rule is a failed join, routed to a hold, never delivered", async () => {
    const f = await fixture("semantic"), state = await advanceContainedGraph(f.graphDir, f.driver);
    expect(state.nodes["build-a"]!.result!.outcome).toBe("ready"); expect(state.nodes["build-b"]!.result!.outcome).toBe("ready");
    expect((await readControllerFile(join(f.graphDir, "children/merge/integration.json"))).status).toBe("merged");
    expect(state.nodes.merge!.result!.outcome).toBe("failed"); expect(state.active).toEqual(["resolve"]); expect(state.nodes.ship).toBeUndefined();
}, 240000);
test("overlapping edits are a conflict with no merged candidate", async () => {
    const f = await fixture("conflict"), state = await advanceContainedGraph(f.graphDir, f.driver);
    const integration = await readControllerFile(join(f.graphDir, "children/merge/integration.json"));
    expect(integration.status).toBe("conflict"); expect(integration.conflicts).toEqual(["src/a.js"]); expect(integration.commit).toBeUndefined();
    expect(state.nodes.merge!.result).toMatchObject({ outcome: "conflict", candidate: null }); expect(state.active).toEqual(["resolve"]);
}, 240000);
test("a join refuses Git older than 2.38 before dispatch and stays reserved", async () => {
    const f = await fixture(), shim = join(f.root, "old-git"), real = Bun.which("git")!;
    await mkdir(shim); await writeFile(join(shim, "git"), `#!/bin/sh\nfor a in "$@"; do [ "$a" = --version ] && { echo "git version 2.37.0"; exit 0; }; done\nexec '${real}' "$@"\n`, { mode: 0o755 });
    const path = process.env.PATH; process.env.PATH = `${shim}:${path}`;
    let refusal: any; try { await advanceContainedGraph(f.graphDir, f.driver).catch(error => { refusal = error; }); } finally { process.env.PATH = path; }
    expect(refusal?.message).toContain("Joins need Git 2.38 or later");
    const state = await readContainedGraph(f.graphDir);
    expect(state.nodes.merge!.reservation).toBeDefined(); expect(state.nodes.merge!.dispatched).toBe(false);
    expect(await Bun.file(join(f.graphDir, "children/merge/integration.json")).exists()).toBe(false);
    const resumed = await advanceContainedGraph(f.graphDir, f.driver);
    expect(resumed.nodes.merge!.result!.outcome).toBe("integrated");
}, 240000);
test("integration is deterministic whatever the branch ceiling", async () => {
    const f = await fixture("independent", { parallelism: 2 });
    const { schema_version, sha256, ...declaration } = f.graph;
    const serial = compileContainedGraph({ version: 2, ...declaration, parallelism: 1 }), at = new Date();
    const second = join(f.root, "graph-serial");
    await initializeContainedGraph(second, serial, createGraphAuthority(serial, { actor: "Scripted engineering fixture", at, expiresAt: new Date(at.getTime() + 1800000).toISOString() }));
    await attachGraphRootSource(second, join(f.root, "source.bundle"));
    await advanceContainedGraph(f.graphDir, f.driver); await advanceContainedGraph(second, f.driver);
    const left = await readControllerFile(join(f.graphDir, "children/merge/integration.json")), right = await readControllerFile(join(second, "children/merge/integration.json"));
    expect(left.branches.map((row: any) => row.commit)).toEqual(right.branches.map((row: any) => row.commit));
    expect(left.commit).toBe(right.commit); expect(left.tree).toBe(right.tree);
}, 240000);
test("a branch's child starts from the fork's source and never holds the other branch's candidate", async () => {
    const f = await fixture(); const state = await advanceContainedGraph(f.graphDir, f.driver);
    const a = await readControllerFile(join(f.graphDir, "children/build-a/derivation.json")), b = await readControllerFile(join(f.graphDir, "children/build-b/derivation.json"));
    expect(a.sourceCommit).toBe(f.commit); expect(b.sourceCommit).toBe(f.commit);
    const aCommit = state.nodes["build-a"]!.result!.candidate!.source.commit, bCommit = state.nodes["build-b"]!.result!.candidate!.source.commit;
    expect(aCommit).not.toBe(bCommit);
    const { readController } = await import("../src");
    const bStore = ((await readController(join(f.graphDir, "children/build-b/state"))).state.candidate!.source as PreparedRepositorySource).objectStore;
    expect(Bun.spawnSync(["git", "--git-dir", bStore, "cat-file", "-e", `${aCommit}^{commit}`]).exitCode).not.toBe(0);
    expect(Bun.spawnSync(["git", "--git-dir", bStore, "cat-file", "-e", `${bCommit}^{commit}`]).exitCode).toBe(0);
}, 240000);
