/** External A2A delegation through a version 4 graph: real Git, real source transport,
 * real HTTP JSON-RPC to a local reference peer, and a verifier that really runs the
 * delegate's pinned check on the exported tree. No container, model or remote peer
 * is measured; a local peer establishes fixture conformance only. */
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { compileContainedGraph, compileDeclaration, createGraphAuthority, hashBytes, hashValue } from "@wringer/plan";
import { processDriver, runtimeProvenanceVersion, type ContainedCommandRequest, type ContainedCommandResult, type PreparedRepositorySource } from "@wringer/runtime";
import { advanceContainedGraph, decideContainedGraph, initializeContainedGraph, readContainedGraph, sendContainedGraph, type GraphState } from "@wringer/scheduler";
import { attachGraphRootSource, containedGraphDriver, exportContainedGraph, graphStatusView, readControllerFile } from "../src";
import { startReferencePeer, type PeerOptions } from "../fixtures/a2a-peer";
import { inspectGraph } from "../../../examples/evidence/read-bundle.mjs";

const directories: string[] = [], peers: (() => void)[] = [];
afterEach(async () => { for (const stop of peers.splice(0)) stop(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function git(args: string[]) { const r = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Delegate fixture", "-c", "user.email=fixture@example.invalid", ...args], { timeoutMs: 20000 }); if (r.code) throw new Error(r.stderr); return r.stdout.trim(); }
const ajv = addFormats(new Ajv2020({ strict: false }));
const valid = async (name: string, value: unknown) => ajv.validate(await Bun.file(new URL(`../../../schema/${name}.schema.json`, import.meta.url)).json(), value);

async function fixture(peerOptions: PeerOptions & { body?: string; patchFile?: string } = {}, graphOptions: { pinnedCard?: string; timeoutSeconds?: number } = {}) {
    const root = await mkdtemp(join(tmpdir(), "wringer-delegate-adapter-")); directories.push(root);
    const repo = join(root, "source"), origin = join(root, "origin.git"), graphDir = join(root, "graph"), url = "https://fixture.invalid/totals.git";
    await git(["init", "--initial-branch=main", repo]); await git(["init", "--bare", "--initial-branch=main", origin]);
    await mkdir(join(repo, "src")); await writeFile(join(repo, "README.md"), "Delegation fixture.\n");
    await writeFile(join(repo, "src/total.sh"), "#!/bin/sh\necho $(( $1 + $2 + 1 ))\n"); await writeFile(join(repo, "check.sh"), "for a in 0 2 7; do for b in 0 3; do test \"$(sh src/total.sh $a $b)\" = $(( a + b )) || exit 1; done; done\n");
    await git(["-C", repo, "add", "."]); await git(["-C", repo, "commit", "-m", "Buggy base"]); await git(["-C", repo, "push", origin, "main"]);
    const commit = await git(["-C", repo, "rev-parse", "HEAD"]), bundle = join(root, "source.bundle"); await git(["-C", repo, "bundle", "create", bundle, "main"]);
    await writeFile(join(repo, peerOptions.patchFile ?? "src/total.sh"), `#!/bin/sh\n${peerOptions.body ?? "echo $(( $1 + $2 ))"}\n`);
    const patch = await git(["-C", repo, "diff", "--binary", "--full-index"]) + "\n"; await git(["-C", repo, "checkout", "--", "."]);
    const peer = await startReferencePeer({ patch, ...peerOptions }); peers.push(peer.stop);
    const runtime = { kind: "apple-container", image: `fixture.invalid/verifier@sha256:${"a".repeat(64)}`, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] };
    const verify = compileDeclaration({ version: 3, name: "Verify the returned total", intent: "Return the sum of two integers.", repository: { url, commit }, runtime,
        agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } },
        environment: { context: ["README.md"], tools: [], setup: [], baseline: [], writable_directories: [] }, scope: { writable: ["src"] },
        acceptance: { criteria: [{ id: "sum", title: "Sum", quote: "Return the sum of two integers", kind: "check", required: true }], checks: [{ id: "sum", argv: ["sh", "check.sh"], cwd: ".", timeout_seconds: 5, criteria: ["sum"], files: ["check.sh"] }], protected_paths: [] },
        budget: { max_sessions: 1, max_worker_turns: 1, max_judge_turns: 1, max_planner_turns: 0, wall_clock_seconds: 600, session_timeout_seconds: 300 } });
    const graph = compileContainedGraph({ version: 4, id: "delegate-fixture", repository: { url, commit }, entry: "ask", required: ["ask", "verify", "review", "ship"], parallelism: 1,
        budget: { maxRoleSessions: 1, maxVerificationAttempts: 1, wallClockSeconds: 1800 },
        nodes: { ask: { kind: "delegate", input: "root", peer: { url: peer.url, cardSha256: graphOptions.pinnedCard ?? peer.cardSha256, skill: "repair" }, instruction: "Make src/total.sh print the sum of its two arguments.", verify, timeoutSeconds: graphOptions.timeoutSeconds ?? 120, then: "verify" },
            verify: { kind: "check", input: "ask", then: "route" },
            route: { kind: "router", input: "verify", routes: [{ outcome: "passed", to: "review" }], otherwise: "fail" },
            review: { kind: "human-hold", input: "verify", prompt: "Inspect the externally returned candidate and its local verification.", then: "ship" },
            ship: { kind: "delivery", input: "review", publication: { remote: origin, sourceBranch: "wringer/delegated", targetBranch: "main" }, then: "done" } } });
    const at = new Date(); await initializeContainedGraph(graphDir, graph, createGraphAuthority(graph, { actor: "Scripted engineering fixture", at, expiresAt: new Date(at.getTime() + 1800000).toISOString() }));
    await attachGraphRootSource(graphDir, bundle);
    const runCommands = async (request: ContainedCommandRequest): Promise<ContainedCommandResult> => {
        const source = request.repo as PreparedRepositorySource, acceptance = request.acceptanceSource as PreparedRepositorySource;
        const tree = await git(["--git-dir", source.objectStore, "rev-parse", `${source.commit}^{tree}`]), work = await mkdtemp(join(root, "verify-"));
        await git(["--git-dir", source.objectStore, "--work-tree", work, "checkout", source.commit, "--", "."]);
        for (const path of request.protectedFiles ?? []) await writeFile(join(work, path), await git(["--git-dir", acceptance.objectStore, "show", `${acceptance.commit}:${path}`]) + "\n");
        const inputs = await git(["--git-dir", acceptance.objectStore, "--literal-pathspecs", "ls-tree", "-r", "-z", acceptance.commit, "--", "check.sh"]);
        return { provenance: { schema_version: runtimeProvenanceVersion(source.url), runtimeId: crypto.randomUUID(), role: "verifier", kind: request.runtime.kind, image: request.runtime.image, repository: { url: source.url, commit: source.commit }, clonedInside: true, hostMounts: [], repositoryAccess: "read-only", declared: request.runtime, observed: { fixture: true, writableDirectories: [] }, limits: ["Synthetic fixture receipt"] } as any,
            sourceChanged: false, sourceTree: tree, checkInputsSha256: hashBytes(inputs), results: request.commands.map(c => ({ id: c.id, code: c.id.startsWith("acceptance/") ? Bun.spawnSync(c.argv!, { cwd: work, stdout: "ignore", stderr: "ignore" }).exitCode : 0, stdout: "Ran on the exported tree\n", stderr: "", durationMs: 1 })) };
    };
    return { root, origin, graphDir, graph, commit, peer, driver: containedGraphDriver({ runCommands }) };
}
const delegation = (graphDir: string) => readControllerFile(join(graphDir, "children/ask/delegation.json"));
const decide = (state: GraphState, node = state.active[0]!) => ({ node, expectedRevision: state.revision, inputSha256: hashValue(state.nodes[node]!.reservation.input), choice: "continue" as const, actor: "Scripted engineering fixture", note: "Fixture checkpoint; not an independent acceptance." });

test("a peer's returned patch is a candidate only after a fresh local check, and is delivered with the graph's evidence", async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.graphDir, f.driver);
    expect(held.phase).toBe("human-hold"); expect(held.active).toEqual(["review"]);
    const record = await delegation(f.graphDir);
    expect(record).toMatchObject({ outcome: "returned", taskId: "task-1", states: ["TASK_STATE_WORKING", "TASK_STATE_COMPLETED"], cancelRequested: false, evidenceKind: "local-peer", artifact: { changedPaths: ["src/total.sh"], mediaType: "text/x-diff" } });
    expect(held.nodes.ask!.result!.candidate).toMatchObject({ owner: "ask", source: { commit: record.candidate.commit } });
    expect(held.nodes.verify!.result!.outcome).toBe("passed");
    expect(f.peer.sends()).toBe(1); expect(f.peer.calls.every(call => call.version === "1.0")).toBe(true);
    expect(f.peer.calls[0]!.params.message).toMatchObject({ role: "ROLE_USER", metadata: { skill: "repair" } });
    expect(await valid("contained-graph-delegation-v1", record)).toBe(true); expect(await valid("contained-graph-status-v4", graphStatusView(f.graphDir, held))).toBe(true);
    await decideContainedGraph(f.graphDir, decide(held));
    const ready = await advanceContainedGraph(f.graphDir, f.driver); expect(ready.phase).toBe("send-hold");
    const done = await sendContainedGraph(f.graphDir, { node: "ship", expectedRevision: ready.revision, preparedSha256: hashValue(ready.nodes.ship!.prepared), actor: "Scripted engineering fixture", note: "Fixture Send to a local bare origin." }, f.driver);
    expect(done.phase).toBe("complete");
    const sent = await readControllerFile(join(f.graphDir, "children/ship/sent.json"));
    expect(await git(["--git-dir", f.origin, "rev-parse", `${sent.evidenceCommit}^`])).toBe(record.candidate.commit);
    const clone = join(f.root, "clone"); await git(["clone", "--no-local", "--branch", "wringer/delegated", f.origin, clone]);
    const audit = Bun.spawnSync(["/bin/sh", "-c", sent.auditCommand.replace(/^node /, `${Bun.which("node")} `)], { cwd: clone, stdout: "pipe", stderr: "pipe" });
    expect(audit.exitCode).toBe(0); expect(JSON.parse(audit.stdout.toString()).nodes.map((row: any) => row.id)).toContain("ask");
    const output = join(f.root, "export"), index = await exportContainedGraph(f.graphDir, output);
    expect(index.schema_version).toBe("wringer.contained-graph-export.v4"); expect(await valid("contained-graph-export-v4", index)).toBe(true);
    expect((await inspectGraph(output)).finished).toBe("done");
    // A record rewritten to name another candidate no longer matches the recorded result.
    const forged = `${output}-forged`; await Bun.spawn(["cp", "-R", output, forged]).exited;
    const file = join(forged, "nodes/ask/delegation.json"), value = JSON.parse(await readFile(file, "utf8")); value.states = ["TASK_STATE_COMPLETED"]; const { sha256, ...body } = value; value.sha256 = hashValue(body); await writeFile(file, JSON.stringify(value));
    const graphIndex = JSON.parse(await readFile(join(forged, "graph.json"), "utf8")); graphIndex.files["nodes/ask/delegation.json"] = new Bun.CryptoHasher("sha256").update(await readFile(file)).digest("hex"); await writeFile(join(forged, "graph.json"), JSON.stringify(graphIndex));
    await expect(inspectGraph(forged)).rejects.toThrow("Delegate ask");
}, 240000);
test("a returned patch that fails the local check never reaches review", async () => {
    const f = await fixture({ body: "echo 5" }), state = await advanceContainedGraph(f.graphDir, f.driver);
    expect((await delegation(f.graphDir)).outcome).toBe("returned");
    expect(state.nodes.verify!.result!.outcome).toBe("failed"); expect(state.phase).toBe("failed"); expect(state.nodes.review).toBeUndefined();
}, 240000);
test("an unreachable peer or a changed Agent Card is refused before anything is sent", async () => {
    const down = await fixture(); down.peer.stop();
    await expect(advanceContainedGraph(down.graphDir, down.driver)).rejects.toThrow("is unavailable");
    expect((await readContainedGraph(down.graphDir)).nodes.ask!.dispatched).toBe(false);
    const changed = await fixture({}, { pinnedCard: "c".repeat(64) });
    await expect(advanceContainedGraph(changed.graphDir, changed.driver)).rejects.toThrow("Agent Card changed");
    expect((await readContainedGraph(changed.graphDir)).nodes.ask!.dispatched).toBe(false); expect(changed.peer.sends()).toBe(0);
}, 240000);
test("failed, rejected and interrupted tasks end the delegation without a candidate", async () => {
    for (const [mode, state] of [["fail", "TASK_STATE_FAILED"], ["reject", "TASK_STATE_REJECTED"], ["input-required", "TASK_STATE_INPUT_REQUIRED"]] as const) {
        const f = await fixture({ mode }), graph = await advanceContainedGraph(f.graphDir, f.driver), record = await delegation(f.graphDir);
        expect({ mode, outcome: record.outcome, last: record.states.at(-1), candidate: record.candidate }).toEqual({ mode, outcome: "failed", last: state, candidate: null });
        expect(graph.phase).toBe("failed"); expect(graph.nodes.ask!.result!.candidate).toBeNull();
    }
    const message = await fixture({ mode: "message-only" }); await advanceContainedGraph(message.graphDir, message.driver);
    expect(await delegation(message.graphDir)).toMatchObject({ outcome: "failed", taskId: null });
}, 240000);
test("a task past its deadline is cancelled once; a peer's own cancellation is recorded", async () => {
    const f = await fixture({ mode: "hang" }, { timeoutSeconds: 1 }); await advanceContainedGraph(f.graphDir, f.driver);
    expect(await delegation(f.graphDir)).toMatchObject({ outcome: "canceled", cancelRequested: true });
    expect(f.peer.calls.filter(call => call.method === "CancelTask")).toHaveLength(1);
    const self = await fixture({ mode: "cancel-self" }); await advanceContainedGraph(self.graphDir, self.driver);
    expect(await delegation(self.graphDir)).toMatchObject({ outcome: "canceled", cancelRequested: false });
}, 240000);
test("malformed artifacts are unavailable with a named reason and no candidate", async () => {
    const cases: [PeerOptions & { body?: string; patchFile?: string }, string][] = [[{ mode: "no-artifact" }, "exactly one patch"], [{ mode: "two-artifacts" }, "exactly one patch"], [{ mode: "wrong-type" }, "text/x-diff"], [{ mode: "not-a-patch" }, "not a bounded Git patch"], [{ patchFile: "check.sh", body: "exit 0" }, "outside the delegate's writable scope"]];
    for (const [options, reason] of cases) {
        const f = await fixture(options), state = await advanceContainedGraph(f.graphDir, f.driver), record = await delegation(f.graphDir);
        expect({ reason: record.reason.includes(reason), outcome: record.outcome, candidate: record.candidate }).toEqual({ reason: true, outcome: "unavailable", candidate: null });
        expect(state.phase).toBe("failed");
    }
}, 240000);
test("a card that changes during the task makes the outcome unavailable", async () => {
    const f = await fixture({ changeCardAfterSend: true }); await advanceContainedGraph(f.graphDir, f.driver);
    expect(await delegation(f.graphDir)).toMatchObject({ outcome: "unavailable", candidate: null }); expect((await delegation(f.graphDir)).reason).toContain("changed during the task");
}, 240000);
test("an interrupted delegation reconciles by reading the task, never by sending again", async () => {
    const f = await fixture({ completeAfterPolls: 3 }), abort = new AbortController();
    const interrupted = setInterval(() => { if (f.peer.sends() === 1) abort.abort("simulated crash after sending"); }, 5);
    await expect(advanceContainedGraph(f.graphDir, f.driver, { signal: abort.signal })).rejects.toThrow(); clearInterval(interrupted);
    const between = await readContainedGraph(f.graphDir);
    expect(between.nodes.ask!.dispatched).toBe(true); expect(between.nodes.ask!.result).toBeUndefined();
    expect(await Bun.file(join(f.graphDir, "children/ask/sent.json")).exists()).toBe(true);
    // Each resume reads the task once; while the peer still works, the node stays uncertain and nothing is re-sent.
    let resumed = await advanceContainedGraph(f.graphDir, f.driver);
    for (let attempt = 0; attempt < 5 && !resumed.nodes.ask!.result; attempt++) { expect(resumed.phase).toBe("uncertain"); expect(f.peer.sends()).toBe(1); resumed = await advanceContainedGraph(f.graphDir, f.driver); }
    expect(resumed.nodes.ask!.result!.outcome).toBe("returned"); expect(f.peer.sends()).toBe(1);
    // A repeated terminal response changes nothing: the record is written once.
    const again = await advanceContainedGraph(f.graphDir, f.driver);
    expect(again.nodes.ask!.result).toEqual(resumed.nodes.ask!.result); expect(f.peer.sends()).toBe(1);
}, 240000);
