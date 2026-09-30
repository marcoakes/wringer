/** Deterministic graph adapter fixtures. Synthetic ACP replies and command
 * observations; real Git, real source transport, real local bare-origin Send.
 * No container, provider, model or human decision is measured here. */
import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { inspectGraph } from "../../../examples/evidence/read-bundle.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileContainedGraph, compileDeclaration, createGraphAuthority, hashBytes, hashValue, type ExecutionPlan } from "@wringer/plan";
import { createLocalSourceBundle, processDriver, runtimeProvenanceVersion, type ContainedCommandRequest, type ContainedCommandResult, type PreparedRepositorySource, type RoleExecutionRequest, type RoleExecutionResult } from "@wringer/runtime";
import { advanceContainedGraph, decideContainedGraph, initializeContainedGraph, readContainedGraph, sendContainedGraph, type GraphState } from "@wringer/scheduler";
import { assertAcceptanceInputsUnchanged, attachGraphRootSource, containedGraphDriver, exportContainedGraph, readControllerFile } from "../src";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function git(args: string[]) { const result = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { timeoutMs: 20000 }); if (result.code !== 0) throw new Error(result.stderr); return result.stdout.trim(); }

async function fixture(options: { remote?: "origin" | "source"; targetBranch?: string } = {}) {
    const root = await mkdtemp(join(tmpdir(), "wringer-graph-adapter-")); directories.push(root);
    const repo = join(root, "source"), origin = join(root, "origin.git"), graphDir = join(root, "graph");
    await git(["init", "--initial-branch=main", repo]); await git(["init", "--bare", "--initial-branch=main", origin]);
    await git(["-C", repo, "config", "user.name", "Graph adapter fixture"]); await git(["-C", repo, "config", "user.email", "fixture@example.invalid"]);
    await mkdir(join(repo, "src"));
    await writeFile(join(repo, "README.md"), "Deterministic graph fixture. Synthetic receipts do not measure containers or providers.\n");
    await writeFile(join(repo, "src/value.js"), "export const expected = false;\n");
    await writeFile(join(repo, "check.sh"), "test \"$(sed -n '1p' src/value.js)\" = 'export const expected = true;'\n");
    await git(["-C", repo, "add", "."]); await git(["-C", repo, "commit", "-m", "Fixture baseline"]); await git(["-C", repo, "push", origin, "main"]);
    const commit = await git(["-C", repo, "rev-parse", "HEAD"]);
    await writeFile(join(repo, "src/value.js"), "export const expected = true;\n");
    const patch = await git(["-C", repo, "diff", "--binary", "--full-index"]) + "\n";
    await git(["-C", repo, "checkout", "--", "src/value.js"]);
    const bundle = join(root, "source.bundle"); await createLocalSourceBundle(repo, commit, bundle);
    const template = compileDeclaration({ version: 3, name: "Graph adapter fixture", intent: "Return the expected value.", repository: { url: "https://fixture.invalid/graph.git", commit },
        runtime: { kind: "apple-container", image: `fixture.invalid/agent@sha256:${"a".repeat(64)}`, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] },
        agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } },
        environment: { context: ["README.md"], tools: [], setup: [], baseline: [], writable_directories: [] }, scope: { writable: ["src"] },
        acceptance: { criteria: [{ id: "expected", title: "Expected value", quote: "Return the expected value.", kind: "check", required: true }], checks: [{ id: "expected", argv: ["sh", "check.sh"], cwd: ".", timeout_seconds: 5, criteria: ["expected"], files: ["check.sh"] }], protected_paths: ["check.sh"] },
        budget: { max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 3600, session_timeout_seconds: 900 } });
    const remote = options.remote === "source" ? repo : origin;
    const graph = compileContainedGraph({ version: 1, id: "adapter-fixture", repository: template.repository, entry: "build", required: ["build", "verify", "review", "ship"],
        budget: { maxRoleSessions: 4, maxVerificationAttempts: 6, wallClockSeconds: 600 },
        nodes: { build: { kind: "loop", input: "root", plan: template, then: "verify" }, verify: { kind: "check", input: "build", then: "review" },
            review: { kind: "human-hold", input: "verify", prompt: "Inspect the exact candidate.", then: "ship" },
            ship: { kind: "delivery", input: "review", publication: { remote, sourceBranch: "wringer/graph-fixture", targetBranch: options.targetBranch ?? "main" }, then: "done" } } });
    const at = new Date(), authority = createGraphAuthority(graph, { actor: "Scripted engineering fixture", at, expiresAt: new Date(at.getTime() + 1800000).toISOString() });
    await initializeContainedGraph(graphDir, graph, authority); await attachGraphRootSource(graphDir, bundle);
    const provenance = (role: "worker" | "judge" | "verifier", source: { url: string; commit: string }, runtime: ExecutionPlan["runtime"]) => ({ schema_version: runtimeProvenanceVersion(source.url), runtimeId: crypto.randomUUID(), role, kind: runtime.kind, image: runtime.image, repository: { url: source.url, commit: source.commit }, clonedInside: true as const, hostMounts: [] as [], repositoryAccess: role === "worker" ? "read-write" as const : "read-only" as const, declared: runtime, observed: { fixture: true, writableDirectories: [] }, limits: ["Synthetic fixture receipt"] });
    const runCommands = async (request: ContainedCommandRequest): Promise<ContainedCommandResult> => {
        const source = request.repo as PreparedRepositorySource, acceptance = request.acceptanceSource as PreparedRepositorySource;
        const tree = await git(["--git-dir", source.objectStore, "rev-parse", `${source.commit}^{tree}`]), contents = await git(["--git-dir", source.objectStore, "show", `${source.commit}:src/value.js`]);
        const inputs = await git(["--git-dir", acceptance.objectStore, "--literal-pathspecs", "ls-tree", "-r", "-z", acceptance.commit, "--", "check.sh"]);
        return { provenance: provenance("verifier", source, request.runtime), sourceChanged: false, sourceTree: tree, checkInputsSha256: hashBytes(inputs), results: request.commands.map(c => ({ id: c.id, code: c.id.startsWith("acceptance/") && !contents.includes("expected = true;") ? 1 : 0, stdout: "Synthetic observation of the pinned source blob\n", stderr: "", durationMs: 1 })) };
    };
    const roles: string[] = [];
    const executeRole = async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => { roles.push(request.role); return ({ status: "completed", text: request.role === "worker" ? "Synthetic worker" : JSON.stringify({ criteria: [{ id: "expected", met: true, reason: "Synthetic finding" }], note: "Fixture only" }), sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "synthetic-graph-fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: provenance(request.role as "worker" | "judge", request.repo, request.runtime), ...(request.role === "worker" ? { change: { baseCommit: request.repo.commit, patch, sha256: hashBytes(patch) } } : {}) }) as RoleExecutionResult; };
    const driver = containedGraphDriver({ executeRole, runCommands });
    return { root, repo, origin, graphDir, graph, authority, commit, template, driver, roles };
}
const decide = (state: GraphState) => ({ node: state.cursor, expectedRevision: state.revision, inputSha256: hashValue(state.nodes[state.cursor]!.reservation.input), choice: "continue" as const, actor: "Scripted engineering fixture", note: "Fixture checkpoint, not independent human acceptance." });
const send = (state: GraphState) => ({ node: state.cursor, expectedRevision: state.revision, preparedSha256: hashValue(state.nodes[state.cursor]!.prepared), actor: "Scripted engineering fixture", note: "Fixture Send to a local bare origin." });
async function toReview(f: Awaited<ReturnType<typeof fixture>>) { const held = await advanceContainedGraph(f.graphDir, f.driver); expect(held.phase).toBe("human-hold"); expect(held.cursor).toBe("review"); return held; }

test("a serial graph runs contained children, a fresh check, an exact review and a separate Send", async () => {
    const f = await fixture(), held = await toReview(f);
    expect(held.nodes.build!.result!.outcome).toBe("ready"); expect(held.nodes.verify!.result!.outcome).toBe("passed");
    expect(held.nodes.verify!.result!.candidate).toEqual(held.nodes.build!.result!.candidate);
    const derivation = await readControllerFile(join(f.graphDir, "children/build/derivation.json")), childPlan = await readControllerFile(join(f.graphDir, "children/build/state/plan.json")), childAuthority = await readControllerFile(join(f.graphDir, "children/build/state/authority.json"));
    expect(derivation.sourceCommit).toBe(f.commit); expect(derivation.wallClockSeconds).toBeLessThanOrEqual(600); expect(childPlan.budget.wall_clock_seconds).toBe(derivation.wallClockSeconds);
    expect(Date.parse(childAuthority.expires_at)).toBeLessThanOrEqual(Date.parse(held.deadline));
    expect(childPlan.repository).toEqual(f.template.repository); expect(childPlan.acceptance).toEqual(f.template.acceptance);
    await decideContainedGraph(f.graphDir, decide(held));
    const ready = await advanceContainedGraph(f.graphDir, f.driver); expect(ready.phase).toBe("send-hold");
    expect(await git(["--git-dir", f.origin, "branch", "--list", "wringer/graph-fixture"])).toBe("");
    const done = await sendContainedGraph(f.graphDir, send(ready), f.driver); expect(done.phase).toBe("complete");
    const sent = await readControllerFile(join(f.graphDir, "children/ship/sent.json"));
    expect(await git(["--git-dir", f.origin, "rev-parse", "wringer/graph-fixture"])).toBe(sent.evidenceCommit);
    expect(await git(["--git-dir", f.origin, "rev-parse", "main"])).toBe(f.commit);
    expect(f.roles).toEqual(["worker", "judge"]);
    await exportedEvidence(f, done);
}, 180000);
async function files(root: string, prefix = ""): Promise<string[]> { const rows: string[] = []; for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) { const name = prefix ? `${prefix}/${entry.name}` : entry.name; if (entry.isDirectory()) rows.push(...await files(root, name)); else rows.push(name); } return rows; }
const sha = (bytes: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
/** Forge inside a copy, then re-seal the index so only the targeted guard can notice. */
async function forged(source: string, edit: (dir: string, index: any) => Promise<void>, rechainFrom?: number) {
    const dir = `${source}-${crypto.randomUUID()}`; await cp(source, dir, { recursive: true });
    const index = JSON.parse(await readFile(join(dir, "graph.json"), "utf8")); await edit(dir, index);
    if (rechainFrom !== undefined) {
        let previous: string | null = rechainFrom ? JSON.parse(await readFile(join(dir, `graph/events/${String(rechainFrom - 1).padStart(4, "0")}.json`), "utf8")).sha256 : null;
        const decisions = new Map<string, string>();
        for (let sequence = rechainFrom; sequence < index.eventCount; sequence++) {
            const name = `graph/events/${String(sequence).padStart(4, "0")}.json`, event = JSON.parse(await readFile(join(dir, name), "utf8"));
            // A hold's result names its decision event; keep that link valid so only the targeted guard can notice.
            if (event.kind === "result" && decisions.has(event.node)) event.data.evidenceSha256 = decisions.get(event.node);
            const { sha256, ...body } = { ...event, previousSha256: previous }; const next = { ...body, sha256: hashValue(body) };
            if (event.kind === "decision") decisions.set(event.node, next.sha256);
            await writeFile(join(dir, name), JSON.stringify(next, null, 2) + "\n"); previous = next.sha256;
        }
        index.revision = previous;
    }
    for (const name of Object.keys(index.files)) index.files[name] = sha(await readFile(join(dir, name)));
    await writeFile(join(dir, "graph.json"), JSON.stringify(index, null, 2) + "\n");
    return dir;
}
async function exportedEvidence(f: Awaited<ReturnType<typeof fixture>>, done: GraphState) {
    const output = join(f.root, "graph-export"), index = await exportContainedGraph(f.graphDir, output);
    await expect(exportContainedGraph(f.graphDir, output)).rejects.toThrow();
    const ajv = addFormats(new Ajv2020({ strict: false })), schema = await Bun.file(new URL("../../../schema/contained-graph-export-v1.schema.json", import.meta.url)).json();
    expect(ajv.validate(schema, index)).toBe(true);
    expect(index.revision).toBe(done.revision); expect(index.nodes.find(row => row.id === "ship")!.delivery).toBe("deliveries/ship");
    const inspected = await inspectGraph(output);
    expect(inspected.finished).toBe("done"); expect(inspected.nodes.map(row => row.id)).toEqual(["build", "verify", "review", "ship"]);
    const node = Bun.spawnSync(["node", join(output, "read-bundle.mjs"), output], { stdout: "pipe", stderr: "pipe" });
    expect(node.exitCode).toBe(0); expect(JSON.parse(node.stdout.toString()).graph.sha256).toBe(f.graph.sha256);
    const leaks: string[] = [];
    // The pinned plan carries its declared local bare origin verbatim (disclosed in the index); nothing else may name a local path.
    for (const name of await files(output)) { const text = (await readFile(join(output, name), "utf8").catch(() => "")).replaceAll(f.origin, "<declared-publication-origin>"); if (text.includes(f.root) || /(?:^|["'\s])\/(?:Users|private|tmp|home|var\/folders)\//.test(text)) leaks.push(name); }
    expect(leaks).toEqual([]); expect(index.limits.some(limit => limit.includes("local bare origin"))).toBe(true);
    const events = index.eventCount, verifyResult = done.events.find(event => event.node === "verify" && event.kind === "result")!.sequence;
    const cases: [string, Promise<string>, string][] = [
        ["changed carried bytes", forged(output, async dir => writeFile(join(dir, "summary.md"), "forged\n")).then(async dir => { const index = JSON.parse(await readFile(join(dir, "graph.json"), "utf8")); index.files["summary.md"] = "0".repeat(64); await writeFile(join(dir, "graph.json"), JSON.stringify(index)); return dir; }), "changed"],
        ["unrehashed event", forged(output, async dir => { const name = join(dir, "graph/events/0001.json"), event = JSON.parse(await readFile(name, "utf8")); event.at = "2026-01-01T00:00:00.000Z"; await writeFile(name, JSON.stringify(event)); }), "Graph event 1"],
        ["rehashed event without its successors", forged(output, async dir => { const name = join(dir, "graph/events/0001.json"), event = JSON.parse(await readFile(name, "utf8")); event.at = "2026-01-01T00:00:00.000Z"; const { sha256, ...body } = event; await writeFile(name, JSON.stringify({ ...body, sha256: hashValue(body) })); }), "Graph event 2"],
        ["event from another graph", forged(output, async dir => { const name = join(dir, `graph/events/${String(events - 1).padStart(4, "0")}.json`), event = JSON.parse(await readFile(name, "utf8")); event.graphSha256 = "a".repeat(64); await writeFile(name, JSON.stringify(event)); }, events - 1), "another graph"],
        ["check evidence swapped", forged(output, async dir => { const name = join(dir, "nodes/verify/verification.json"), value = JSON.parse(await readFile(name, "utf8")); value.status = "failed"; await writeFile(name, JSON.stringify(value)); }), "Check verify"],
        ["loop derivation rebound", forged(output, async dir => { const name = join(dir, "nodes/build/derivation.json"), value = JSON.parse(await readFile(name, "utf8")); value.inputSha256 = "b".repeat(64); await writeFile(name, JSON.stringify(value)); }), "Loop build"],
        ["loop result not the delivered journal", forged(output, async dir => { const name = join(dir, "graph/events/0003.json"), event = JSON.parse(await readFile(name, "utf8")); expect(event.kind).toBe("result"); event.data.evidenceSha256 = "c".repeat(64); await writeFile(name, JSON.stringify(event)); }, 3), "journal state"],
        ["missing delivery envelope", forged(output, async dir => rm(join(dir, "deliveries/ship"), { recursive: true })), "ENOENT"],
    ];
    expect(verifyResult).toBeGreaterThan(3);
    for (const [name, dir, reason] of cases) await expect(inspectGraph(await dir), name).rejects.toThrow(reason);
}
test("observing an unstarted loop is uncertain and never starts its child", async () => {
    const f = await fixture(), state = await readContainedGraph(f.graphDir);
    const reservation = { roleSessions: 4, verificationAttempts: 5, deadline: state.deadline, input: { node: "root", source: f.graph.repository, candidate: null, evidenceSha256: f.graph.sha256 } };
    expect(await f.driver.observe({ directory: f.graphDir, plan: f.graph, authority: f.authority, node: "build", reservation })).toBeNull();
    expect(await Bun.file(join(f.graphDir, "children/build/state/plan.json")).exists()).toBe(false); expect(f.roles).toEqual([]);
}, 60000);
test("a missing container runtime refuses before dispatch and leaves the loop reserved", async () => {
    const f = await fixture(), live = containedGraphDriver(), path = process.env.PATH;
    process.env.PATH = "/nonexistent-wringer-runtime-path";
    let refused: Error | null = null;
    try { refused = await advanceContainedGraph(f.graphDir, live).then(() => null, (error: Error) => error); } finally { process.env.PATH = path; }
    const state = await readContainedGraph(f.graphDir); expect(state.nodes.build!.dispatched).toBe(false); expect(state.phase).toBe("pending");
    expect(refused?.message).toContain("Containment unavailable");
    expect(await Bun.file(join(f.graphDir, "children/build/state/plan.json")).exists()).toBe(false);
}, 60000);
test("a check refuses a candidate its owner journal does not hold", async () => {
    const f = await fixture(), held = await toReview(f), reservation = structuredClone(held.nodes.verify!.reservation);
    reservation.input.candidate!.tree = "e".repeat(40);
    await expect(f.driver.preflight!({ directory: f.graphDir, plan: f.graph, authority: f.authority, node: "verify", reservation }, "dispatch")).rejects.toThrow("exact candidate");
}, 120000);
test("a candidate that changed an acceptance input cannot seed a derived child", async () => {
    const f = await fixture(), store = join(f.root, "store.git");
    await git(["clone", "--bare", "--no-local", f.repo, store]);
    await writeFile(join(f.repo, "check.sh"), "true\n"); await git(["-C", f.repo, "commit", "-am", "Weaken the check"]);
    const weakened = await git(["-C", f.repo, "rev-parse", "HEAD"]);
    await writeFile(join(f.repo, "src/value.js"), "export const expected = true;\n"); await git(["-C", f.repo, "commit", "-am", "Change product only"]);
    const product = await git(["-C", f.repo, "rev-parse", "HEAD"]);
    await git(["--git-dir", store, "fetch", f.repo, "main:refs/heads/main"]);
    await expect(assertAcceptanceInputsUnchanged(store, f.graph, weakened)).rejects.toThrow("acceptance input");
    await git(["-C", f.repo, "reset", "--hard", f.commit]); await writeFile(join(f.repo, "src/value.js"), "export const expected = true;\n"); await git(["-C", f.repo, "commit", "-am", "Product only"]);
    await git(["--git-dir", store, "fetch", "--force", f.repo, "main:refs/heads/main"]);
    await assertAcceptanceInputsUnchanged(store, f.graph, await git(["-C", f.repo, "rev-parse", "HEAD"]));
    expect(product).not.toBe(weakened);
}, 60000);
test("delivery to a non-bare local origin is refused before preparation is recorded", async () => {
    const f = await fixture({ remote: "source" }), held = await toReview(f); await decideContainedGraph(f.graphDir, decide(held));
    await expect(advanceContainedGraph(f.graphDir, f.driver)).rejects.toThrow("bare repository");
    const state = await readContainedGraph(f.graphDir); expect(state.cursor).toBe("ship"); expect(state.nodes.ship!.dispatched).toBe(false);
}, 120000);
test("a Send to an absent target branch is refused before the Send is recorded", async () => {
    const f = await fixture({ targetBranch: "release" }), held = await toReview(f); await decideContainedGraph(f.graphDir, decide(held));
    const ready = await advanceContainedGraph(f.graphDir, f.driver); expect(ready.phase).toBe("send-hold");
    await expect(sendContainedGraph(f.graphDir, send(ready), f.driver)).rejects.toThrow("target branch");
    const after = await readContainedGraph(f.graphDir); expect(after.revision).toBe(ready.revision); expect(after.phase).toBe("send-hold");
    expect(await git(["--git-dir", f.origin, "branch", "--list", "wringer/graph-fixture"])).toBe("");
}, 120000);
test("a Send over an existing different review branch is refused before the Send is recorded", async () => {
    const f = await fixture(), held = await toReview(f); await decideContainedGraph(f.graphDir, decide(held));
    const ready = await advanceContainedGraph(f.graphDir, f.driver);
    await git(["--git-dir", f.origin, "branch", "wringer/graph-fixture", "main"]);
    await expect(sendContainedGraph(f.graphDir, send(ready), f.driver)).rejects.toThrow("already exists");
    const after = await readContainedGraph(f.graphDir); expect(after.revision).toBe(ready.revision); expect(after.phase).toBe("send-hold");
}, 120000);
test("a lost Send confirmation reconciles from the remote branch without a second push", async () => {
    const f = await fixture(), held = await toReview(f); await decideContainedGraph(f.graphDir, decide(held));
    const ready = await advanceContainedGraph(f.graphDir, f.driver), request = { directory: f.graphDir, plan: f.graph, authority: f.authority, node: "ship", reservation: ready.nodes.ship!.reservation };
    await f.driver.send(request, ready.nodes.ship!.prepared!);
    const confirmation = join(f.graphDir, "children/ship/sent.json"), evidenceCommit = (await readControllerFile(confirmation)).evidenceCommit;
    await rm(confirmation);
    const observed = await f.driver.observe(request);
    expect(observed).toMatchObject({ kind: "complete", outcome: "delivered" });
    expect(await git(["--git-dir", f.origin, "rev-parse", "wringer/graph-fixture"])).toBe(evidenceCommit);
}, 120000);
