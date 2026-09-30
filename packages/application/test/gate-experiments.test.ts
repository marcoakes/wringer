/** Gate and workflow proposals evaluated against a frozen oracle. Real Git corpus;
 * a fixture command runner that really runs each gate on the exported item tree
 * with the gate's pinned files overlaid. No container, model or network. */
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { compileContainedGraph, compileDeclaration, hashValue } from "@wringer/plan";
import type { ContainedCommandRequest, ContainedCommandResult } from "@wringer/runtime";
import { adoptGateSelection, createGateOracle, createGateProposal, evaluateGateExperiment, prepareGateChange, readGateExperiment, readGateSelections, registerGateExperiment, registerWorkflowExperiment, sendGateChange, undoGateSelection, type GateDeclaration } from "../src";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
import { corpus as makeCorpus, gates, git, runtime, variants } from "../fixtures/gate-corpus";
async function corpus() { const c = await makeCorpus(); directories.push(c.root); return c; }
type Corpus = Awaited<ReturnType<typeof corpus>>;
function proposal(c: Corpus, candidate: GateDeclaration[], developmentItems = ["correct-sum", "tautology-two-three"]) {
    return createGateProposal({ id: `propose-${candidate.map(g => g.id).join("-")}`, taskFamily: "totals", candidateGates: candidate, rationale: "Check the arithmetic property, not one example.", inputs: { developmentItems }, author: { actor: "Scripted engineering fixture", kind: "operator" } });
}
function experiment(c: Corpus, proposed: ReturnType<typeof proposal>, prediction: Partial<{ minimumAdditionalDefectsCaught: number; maximumAdditionalFalsePositives: number }> = {}) {
    return { id: `gate-${proposed.id}`, taskFamily: "totals", repository: { url: "https://fixture.invalid/totals.git", commit: c.base }, changedVariable: "acceptance-gates" as const, runtime,
        baselineGates: [gates.narrow], proposalSha256: proposed.sha256, corpus: { id: "totals", items: c.items, oracleSha256: c.oracle.sha256 },
        prediction: { statement: "The candidate catches more held-out defects without failing a correct control.", minimumAdditionalDefectsCaught: 1, maximumAdditionalFalsePositives: 0, minimumHeldOutDefects: 3, minimumHeldOutControls: 2, ...prediction },
        limits: { maxGateRuns: 32, wallClockSeconds: 600 }, holdout: { candidateIteration: 1, maximumCandidateIterations: 3, proposalSawHeldOut: false as const },
        order: "fixed-corpus-order" as const, stoppingRule: "fixed-sample-no-extension" as const, accounting: "all-planned-runs-including-unavailable" as const };
}
async function run(candidate: GateDeclaration[], prediction?: Parameters<typeof experiment>[2]) {
    const c = await corpus(), proposed = proposal(c, candidate), state = join(c.root, "experiment");
    await registerGateExperiment(state, experiment(c, proposed, prediction), proposed, c.bundle);
    return { c, state, proposed, result: await evaluateGateExperiment(state, c.oracle, { runCommands: c.runCommands, evidenceKind: "deterministic-fixture" }) };
}

test("a useful gate qualifies: it catches more held-out defects than the baseline without failing a control", async () => {
    const { result, c } = await run([gates.property]);
    expect(result.summary.candidate.heldOut).toMatchObject({ caught: 4, missed: 0, falsePositives: 0 });
    expect(result.summary.baseline.heldOut).toMatchObject({ caught: 2, missed: 2, falsePositives: 0 });
    expect(result.qualification).toEqual({ qualified: true, reasons: [] });
    expect(c.runs).toHaveLength(2 * variants.length);
    // Latency is the gate commands' reported durations (the fixture reports 1 ms per command).
    expect(result.summary.candidate).toMatchObject({ gateRuns: variants.length, durationMs: variants.length }); expect(result.runs.every(run => run.durationMs === 1)).toBe(true);
    const ajv = addFormats(new Ajv2020({ strict: false }));
    expect(ajv.validate(await Bun.file(new URL("../../../schema/gate-evaluation-v1.schema.json", import.meta.url)).json(), result)).toBe(true);
}, 120000);
test("a weakened gate looks greener but fails the independent comparison", async () => {
    const { result } = await run([gates.weakened]);
    expect(result.summary.candidate.all.passRate).toBeGreaterThan(result.summary.baseline.all.passRate);
    expect(result.qualification.qualified).toBe(false); expect(result.qualification.reasons.join(" ")).toContain("fewer held-out defects");
}, 120000);
test("a noisy gate exposes false positives on correct controls", async () => {
    const { result } = await run([gates.noisy]);
    expect(result.summary.candidate.heldOut.falsePositives).toBe(2);
    expect(result.qualification.qualified).toBe(false); expect(result.qualification.reasons.join(" ")).toContain("false positives");
}, 120000);
test("an item cannot rewrite the gate that judges it", async () => {
    const { result } = await run([gates.property]);
    expect(result.runs.find(row => row.itemId === "rewrites-its-gate" && row.arm === "candidate")!.outcome).toBe("failed");
}, 120000);
test("a missed prediction does not qualify", async () => {
    const { result } = await run([gates.property], { minimumAdditionalDefectsCaught: 3 });
    expect(result.qualification.qualified).toBe(false); expect(result.qualification.reasons.join(" ")).toContain("prediction");
}, 120000);
test("an oracle that differs from the registered commitment is refused before any run", async () => {
    const c = await corpus(), proposed = proposal(c, [gates.property]), state = join(c.root, "experiment");
    await registerGateExperiment(state, experiment(c, proposed), proposed, c.bundle);
    const swapped = createGateOracle("totals", variants.map(v => ({ itemId: v.id, label: v.id === "sign-flip" ? "control" : v.label })));
    await expect(evaluateGateExperiment(state, swapped, { runCommands: c.runCommands, evidenceKind: "deterministic-fixture" })).rejects.toThrow("oracle");
    expect(c.runs).toEqual([]);
}, 120000);
test("a proposal built from a held-out item cannot be registered", async () => {
    const c = await corpus(), proposed = proposal(c, [gates.property], ["correct-sum", "sign-flip"]);
    await expect(registerGateExperiment(join(c.root, "experiment"), experiment(c, proposed), proposed, c.bundle)).rejects.toThrow("held-out");
}, 120000);
test("a proposal that differs from the registered digest is refused", async () => {
    const c = await corpus(), proposed = proposal(c, [gates.property]), other = proposal(c, [gates.weakened]);
    await expect(registerGateExperiment(join(c.root, "experiment"), experiment(c, proposed), other, c.bundle)).rejects.toThrow("proposal");
}, 120000);
test("a plan larger than its run budget is refused at registration", async () => {
    const c = await corpus(), proposed = proposal(c, [gates.property]), input = experiment(c, proposed);
    await expect(registerGateExperiment(join(c.root, "experiment"), { ...input, limits: { ...input.limits, maxGateRuns: 10 } }, proposed, c.bundle)).rejects.toThrow("budget");
}, 120000);
test("an unavailable held-out run makes evidence incomplete and is never rerun", async () => {
    const c = await corpus(), proposed = proposal(c, [gates.property]), state = join(c.root, "experiment");
    await registerGateExperiment(state, experiment(c, proposed), proposed, c.bundle);
    const flaky = async (request: ContainedCommandRequest) => { const r = await c.runCommands(request); if (request.repo.commit === c.items.find(i => i.id === "sign-flip")!.commit && request.commands[0]!.id === "candidate/property") r.results[0]!.code = 127; return r; };
    const result = await evaluateGateExperiment(state, c.oracle, { runCommands: flaky, evidenceKind: "deterministic-fixture" });
    expect(result.qualification.qualified).toBe(false); expect(result.qualification.reasons.join(" ")).toContain("incomplete");
    const count = c.runs.length, again = await evaluateGateExperiment(state, c.oracle, { runCommands: c.runCommands, evidenceKind: "deterministic-fixture" });
    expect(c.runs.length).toBe(count); expect(again.sha256).toBe(result.sha256);
}, 120000);
test("proposal, evaluation, change preparation, Send and future-only adoption are separate recorded actions", async () => {
    const { c, state, result } = await run([gates.property]);
    const registry = join(c.root, "registry"), origin = join(c.root, "origin.git"); git(["init", "-q", "--bare", "-b", "main", origin]); git(["-C", c.repo, "push", "-q", origin, "HEAD:refs/heads/main"]);
    await expect(sendGateChange(state, { remote: origin, sourceBranch: "wringer/gate-property", actor: "Scripted engineering fixture" })).rejects.toThrow(/prepare/i);
    const change = await prepareGateChange(state, join(c.root, "change"));
    expect(await readFile(join(c.root, "change/PROPOSAL.md"), "utf8")).toContain("Rollback");
    expect(await readFile(join(c.root, "change/change.patch"), "utf8")).toContain("gates/property.sh");
    await expect(prepareGateChange(state, join(c.root, "change-again"))).rejects.toThrow("already prepared");
    expect(git(["--git-dir", origin, "branch", "--list", "wringer/gate-property"])).toBe("");
    const actor = "Scripted engineering fixture";
    await expect(sendGateChange(state, { remote: origin, sourceBranch: "main", actor })).rejects.toThrow("non-default review branch");
    const trunk = join(c.root, "trunk.git"); git(["init", "-q", "--bare", "-b", "trunk", trunk]); git(["-C", c.repo, "push", "-q", trunk, "HEAD:refs/heads/trunk"]);
    await expect(sendGateChange(state, { remote: trunk, sourceBranch: "trunk", actor })).rejects.toThrow("remote default branch");
    git(["-C", c.repo, "push", "-q", origin, "HEAD:refs/heads/wringer/taken"]);
    await expect(sendGateChange(state, { remote: origin, sourceBranch: "wringer/taken", actor })).rejects.toThrow("already exists with different content");
    expect(git(["--git-dir", trunk, "rev-parse", "trunk"])).toBe(c.base); expect(git(["--git-dir", origin, "rev-parse", "wringer/taken"])).toBe(c.base);
    const sent = await sendGateChange(state, { remote: origin, sourceBranch: "wringer/gate-property", actor });
    expect(git(["--git-dir", origin, "rev-parse", "wringer/gate-property"])).toBe(change.commit); expect(sent.commit).toBe(change.commit);
    expect(git(["--git-dir", origin, "rev-parse", "main"])).toBe(c.base);
    await expect(sendGateChange(state, { remote: origin, sourceBranch: "wringer/gate-property", actor })).rejects.toThrow("already sent");
    const adopted = await adoptGateSelection(state, registry, { actor, expectedRevision: null });
    expect(adopted.evaluationSha256).toBe(result.sha256); expect((await readGateSelections(registry)).current?.gates.map(g => g.id)).toEqual(["property"]);
    await expect(adoptGateSelection(state, registry, { actor, expectedRevision: null })).rejects.toThrow("revision");
    const again = await adoptGateSelection(state, registry, { actor, expectedRevision: adopted.sha256 });
    const undone = await undoGateSelection(registry, { actor, expectedRevision: again.sha256 });
    expect(undone.action).toBe("undo"); expect((await readGateSelections(registry)).current?.sha256).toBe(adopted.sha256);
    await undoGateSelection(registry, { actor, expectedRevision: undone.sha256 });
    expect((await readGateSelections(registry)).current).toBeNull();
}, 120000);
test("a gate selection history with a missing or re-linked record is refused", async () => {
    const root = await mkdtemp(join(tmpdir(), "wringer-gate-selections-")); directories.push(root);
    const record = (index: number, previousSha256: string | null) => { const body = { schema_version: "wringer.gate-adoption.v1", action: "adopt", taskFamily: "totals", repository: URL_, gates: [gates.property], experimentSha256: "b".repeat(64), evaluationSha256: "c".repeat(64), previousSha256, actor: "Fixture", at: `2026-09-30T00:00:0${index}.000Z`, futureOnly: true }; return { ...body, sha256: hashValue(body) }; };
    const write = async (registry: string, rows: [number, ReturnType<typeof record>][]) => { await mkdir(join(registry, "selections"), { recursive: true, mode: 0o700 }); for (const [index, row] of rows) await writeFile(join(registry, "selections", `${String(index).padStart(4, "0")}.json`), JSON.stringify(row), { mode: 0o600 }); };
    const first = record(0, null), second = record(1, first.sha256);
    await write(join(root, "good"), [[0, first], [1, second]]); expect((await readGateSelections(join(root, "good"))).current?.sha256).toBe(second.sha256);
    await write(join(root, "gap"), [[0, first], [2, record(2, first.sha256)]]);
    await expect(readGateSelections(join(root, "gap"))).rejects.toThrow("contiguous");
    await write(join(root, "relinked"), [[0, first], [1, record(1, null)]]);
    await expect(readGateSelections(join(root, "relinked"))).rejects.toThrow("broken");
});
test("an unqualified proposal cannot prepare a change or be adopted", async () => {
    const { c, state } = await run([gates.weakened]);
    await expect(prepareGateChange(state, join(c.root, "change"))).rejects.toThrow("qualified");
    await expect(adoptGateSelection(state, join(c.root, "registry"), { actor: "Scripted engineering fixture", expectedRevision: null })).rejects.toThrow("qualified");
}, 120000);
const URL_ = "https://fixture.invalid/totals.git";
function workflowGraph(c: Corpus, checks: GateDeclaration[], holds: number, commit = c.base) {
    const leaf = compileDeclaration({ version: 3, name: "Fix the total", intent: "Return the sum.", repository: { url: URL_, commit }, runtime, agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } }, environment: { context: [], tools: [], setup: [], baseline: [], writable_directories: [] }, scope: { writable: ["src"] }, acceptance: { criteria: [{ id: "sum", title: "Sum", quote: "Return the sum.", kind: "check", required: true }], checks: checks.map(g => ({ id: g.id, argv: g.argv, cwd: g.cwd, timeout_seconds: g.timeout_seconds, criteria: ["sum"], files: g.files.map(f => f.path) })), protected_paths: ["gates"] }, budget: { max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 600, session_timeout_seconds: 300 } });
    return compileContainedGraph({ version: 1, id: "fix-total", repository: { url: URL_, commit }, entry: "build", required: ["build", ...(holds ? ["review"] : [])], budget: { maxRoleSessions: 4, maxVerificationAttempts: 5, wallClockSeconds: 600 },
        nodes: { build: { kind: "loop", input: "root", plan: leaf, then: holds ? "review" : "done" }, ...(holds ? { review: { kind: "human-hold", input: "build", prompt: "Inspect.", then: "done" } } : {}) } });
}
function workflowProposal(candidate: GateDeclaration[]) {
    return createGateProposal({ id: "workflow-property", taskFamily: "totals", candidateGates: candidate, rationale: "Add the property check to the loop's acceptance.", inputs: { developmentItems: ["correct-sum"] }, author: { actor: "Scripted engineering fixture", kind: "operator" } });
}
function workflowInput(c: Corpus, proposed: ReturnType<typeof workflowProposal>, baselineGraph: ReturnType<typeof workflowGraph>, candidateGraph: ReturnType<typeof workflowGraph>) {
    return { ...experiment(c, proposed), id: "workflow-property", changedVariable: "workflow" as const, baselineGraph, candidateGraph, gateFiles: [...gates.narrow.files, ...gates.property.files], maximumAdditionalHolds: 0 };
}
test("a workflow proposal is compared through the gates and holds its graph requires", async () => {
    const c = await corpus(), state = join(c.root, "workflow"), proposed = workflowProposal([gates.narrow, gates.property]);
    await registerWorkflowExperiment(state, workflowInput(c, proposed, workflowGraph(c, [gates.narrow], 1), workflowGraph(c, [gates.narrow, gates.property], 1)), proposed, c.bundle);
    const result = await evaluateGateExperiment(state, c.oracle, { runCommands: c.runCommands, evidenceKind: "deterministic-fixture" });
    expect(result.summary.candidate.heldOut.caught).toBe(4); expect(result.summary.candidate.requiredHolds).toBe(1);
    expect(result.qualification.qualified).toBe(true);
    expect((await readGateExperiment(state)).registration.changedVariable).toBe("workflow");
}, 120000);
test("a workflow that adds a required human hold does not qualify, however many defects it catches", async () => {
    const c = await corpus(), state = join(c.root, "workflow"), proposed = workflowProposal([gates.narrow, gates.property]);
    await registerWorkflowExperiment(state, workflowInput(c, proposed, workflowGraph(c, [gates.narrow], 0), workflowGraph(c, [gates.narrow, gates.property], 1)), proposed, c.bundle);
    const result = await evaluateGateExperiment(state, c.oracle, { runCommands: c.runCommands, evidenceKind: "deterministic-fixture" });
    expect(result.summary.candidate.heldOut.caught).toBe(4);
    expect(result.qualification.qualified).toBe(false); expect(result.qualification.reasons.join(" ")).toContain("required human holds");
}, 120000);
test("a workflow comparison refuses a proposal naming other gates and a graph on another base", async () => {
    const c = await corpus(), proposed = workflowProposal([gates.property]);
    await expect(registerWorkflowExperiment(join(c.root, "a"), workflowInput(c, proposed, workflowGraph(c, [gates.narrow], 0), workflowGraph(c, [gates.narrow, gates.property], 0)), proposed, c.bundle)).rejects.toThrow("differ from the gates the candidate workflow requires");
    const exact = workflowProposal([gates.narrow, gates.property]);
    await expect(registerWorkflowExperiment(join(c.root, "b"), workflowInput(c, exact, workflowGraph(c, [gates.narrow], 0), workflowGraph(c, [gates.narrow, gates.property], 0, c.items[0]!.commit)), exact, c.bundle)).rejects.toThrow("pin the corpus base");
}, 120000);
test("registration refuses an unpinned or networked verifier, a wrong item tree and an exhausted holdout", async () => {
    const c = await corpus(), proposed = proposal(c, [gates.property]), input = experiment(c, proposed), at = (name: string) => join(c.root, name);
    await expect(registerGateExperiment(at("a"), { ...input, runtime: { ...runtime, image: "fixture.invalid/verifier:latest" } }, proposed, c.bundle)).rejects.toThrow("pinned by digest");
    await expect(registerGateExperiment(at("b"), { ...input, runtime: { ...runtime, network: { policy: "allow" } } as any }, proposed, c.bundle)).rejects.toThrow("deny the network");
    await expect(registerGateExperiment(at("c"), { ...input, runtime: { ...runtime, env: ["TOKEN"] } }, proposed, c.bundle)).rejects.toThrow("no credentials");
    await expect(registerGateExperiment(at("d"), { ...input, corpus: { ...input.corpus, items: input.corpus.items.map((item, index) => index === 3 ? { ...item, tree: input.corpus.items[0]!.tree } : item) } }, proposed, c.bundle)).rejects.toThrow("registered tree");
    await expect(registerGateExperiment(at("e"), { ...input, holdout: { ...input.holdout, candidateIteration: 4 } }, proposed, c.bundle)).rejects.toThrow("exhausted");
    await expect(registerGateExperiment(at("f"), { ...input, holdout: { ...input.holdout, proposalSawHeldOut: true } } as any, proposed, c.bundle)).rejects.toThrow("saw held-out");
}, 120000);
test("a proposal cannot pin one gate path two ways or claim a human verdict", () => {
    const clash = { ...gates.property, id: "other", files: [{ path: "gates/property.sh", content: "exit 0\n" }] };
    expect(() => createGateProposal({ id: "clash", taskFamily: "totals", candidateGates: [gates.property, clash], rationale: "Two contents.", inputs: { developmentItems: [] }, author: { actor: "Fixture", kind: "operator" } })).toThrow("two different contents");
    expect(() => createGateProposal({ id: "verdict", taskFamily: "totals", candidateGates: [gates.property], rationale: "A person accepted it.", inputs: { developmentItems: [] }, author: { actor: "Fixture", kind: "human" as any } })).toThrow("never a human verdict");
});
test("a run reserved before a crash is recorded uncertain and never rerun", async () => {
    const c = await corpus(), proposed = proposal(c, [gates.property]), state = join(c.root, "experiment");
    await registerGateExperiment(state, experiment(c, proposed), proposed, c.bundle);
    const index = variants.findIndex(v => v.id === "sign-flip") * 2 + 1, signFlip = c.items.find(i => i.id === "sign-flip")!.commit;
    await mkdir(join(state, "runs"), { mode: 0o700 });
    await writeFile(join(state, "runs", `${String(index).padStart(4, "0")}.reserved.json`), JSON.stringify({ index, itemId: "sign-flip", arm: "candidate", reservedAt: "2026-09-30T00:00:00.000Z" }), { mode: 0o600 });
    const result = await evaluateGateExperiment(state, c.oracle, { runCommands: c.runCommands, evidenceKind: "deterministic-fixture" });
    expect(result.runs[index]!.outcome).toBe("uncertain"); expect(c.runs).not.toContain(`candidate/property@${signFlip.slice(0, 7)}`);
    expect(c.runs).toHaveLength(2 * variants.length - 1);
    expect(result.qualification.qualified).toBe(false); expect(result.qualification.reasons.join(" ")).toContain("incomplete");
}, 120000);
test("a run that cannot establish its exact item in a contained verifier is unavailable", async () => {
    const c = await corpus(), proposed = proposal(c, [gates.property]), last = c.items.at(-1)!;
    const tampers: Record<string, (r: ContainedCommandResult) => void> = {
        "another-commit": r => { r.provenance!.repository!.commit = c.base; },
        "host-mount": r => { (r.provenance as any).hostMounts = ["/Users"]; },
        "not-a-verifier": r => { (r.provenance as any).role = "worker"; },
        "cloned-outside": r => { (r.provenance as any).clonedInside = false; },
        "missing-gate": r => { r.results = []; },
        "another-tree": r => { r.sourceTree = c.items[0]!.tree; },
    };
    for (const [name, tamper] of Object.entries(tampers)) {
        const state = join(c.root, name);
        await registerGateExperiment(state, experiment(c, proposed), proposed, c.bundle);
        const runner = async (request: ContainedCommandRequest) => { const r = await c.runCommands(request); if (request.repo.commit === last.commit && request.commands[0]!.id === "candidate/property") tamper(r); return r; };
        const result = await evaluateGateExperiment(state, c.oracle, { runCommands: runner, evidenceKind: "deterministic-fixture" });
        expect({ name, outcome: result.runs.at(-1)!.outcome }).toEqual({ name, outcome: "unavailable" });
        expect(result.qualification.qualified).toBe(false);
    }
}, 120000);
test("an infrastructure failure stops collection and keeps every remaining run in the denominator", async () => {
    const c = await corpus(), proposed = proposal(c, [gates.property]), state = join(c.root, "experiment");
    await registerGateExperiment(state, experiment(c, proposed), proposed, c.bundle);
    let calls = 0; const broken = async (request: ContainedCommandRequest) => { if (++calls === 4) throw new Error("runtime lost"); return c.runCommands(request); };
    const result = await evaluateGateExperiment(state, c.oracle, { runCommands: broken, evidenceKind: "deterministic-fixture" });
    expect(calls).toBe(4); expect(result.runs[3]!.outcome).toBe("unavailable");
    expect(result.runs.slice(4).every(run => run.outcome === "not-started")).toBe(true); expect(result.runs).toHaveLength(2 * variants.length);
    expect(result.qualification.reasons.join(" ")).toContain("incomplete");
}, 120000);
test("a run started after the registered wall clock is not started and still counts", async () => {
    const c = await corpus(), proposed = proposal(c, [gates.property]), state = join(c.root, "experiment");
    await registerGateExperiment(state, experiment(c, proposed), proposed, c.bundle);
    let tick = 0; const clock = () => new Date(Date.UTC(2026, 8, 30) + (tick++ ? 601000 : 0));
    const result = await evaluateGateExperiment(state, c.oracle, { runCommands: c.runCommands, evidenceKind: "deterministic-fixture", at: clock });
    expect(c.runs).toEqual([]); expect(result.runs.every(run => run.outcome === "not-started")).toBe(true);
    expect(result.qualification.reasons.join(" ")).toContain("incomplete");
}, 120000);
