/** Release 2 chain through the CLI: evidence -> proposal (fixture agent) -> export ->
 * commit -> select-tree -> a registered v6 comparison where only the playbook differs ->
 * fixture collection (real Git journeys, real private handover) -> evaluation. */
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileDeclaration, discoverEnvironment, hashBytes, type ExecutionPlan } from "@wringer/plan";
import { digest, prepareRepositorySource, processDriver, runtimeProvenanceVersion, type RoleExecutionRequest, type RoleExecutionResult } from "@wringer/runtime";
import { collectExperiment, collectReplicateSet, proposePlaybookTree, REPLICATE_ACTOR_PREFIX } from "@wringer/application";
import { readExperimentJson } from "../../application/src/experiment-store";
import { runAndValidateTreeJourney, treeWorld } from "../../workflow/fixtures/playbook-tree-journey";
import { openReader } from "../../records/src/read";
import { dispatch } from "../src/app";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Operator", GIT_AUTHOR_EMAIL: "operator@example.invalid", GIT_COMMITTER_NAME: "Operator", GIT_COMMITTER_EMAIL: "operator@example.invalid" };
async function git(cwd: string, ...args: string[]) { const r = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd, env }); if (r.code !== 0) throw new Error(r.stderr); return r.stdout.trim(); }
async function privateDir(prefix: string) { const path = await mkdtemp(join(tmpdir(), prefix)); await chmod(path, 0o700); roots.push(path); return path; }
const reader = await openReader(new URL("../../../schema", import.meta.url).pathname);
const prediction = { statement: "SCRIPTED: one fewer worker attempt without a lost requirement.", metric: "worker-attempts", minimumImprovement: 1, minimumHeldOutPairs: 4, maximumSignProbability: 0.05, visualQualityClaim: false };

test("from replicate evidence to a registered v6 comparison where only the playbook differs", async () => {
    const world = await treeWorld({ select: false }); roots.push(world.root, world.repo);
    const replicates = await privateDir("wringer-chain-replicates-"), proposal = await privateDir("wringer-chain-proposal-"), inputs = await privateDir("wringer-chain-inputs-");
    // 1. A replicate set of the no-playbook v6 plan.
    await writeFile(join(inputs, "set.json"), JSON.stringify({ id: "total-replicates", taskFamily: "total", plan: world.plan, k: 2, sourceTree: world.environment.source_tree, wallClockSeconds: 900 }));
    await dispatch(["experiment", "replicate", "register", "--state", replicates, "--input", join(inputs, "set.json")]);
    await dispatch(["experiment", "replicate", "grant", "--state", replicates, "--actor", "Operator", "--expires", new Date(Date.now() + 3600000).toISOString(), "--output", "grant.json"]);
    await collectReplicateSet(replicates, await readExperimentJson(join(replicates, "grant.json")), { fixture: { run: (plan, state, slot) => runAndValidateTreeJourney(world, plan, state, { actor: `${REPLICATE_ACTOR_PREFIX} Operator`, failures: slot.index - 1 }) } });
    // 2. Evidence, offline, through the public command.
    const evidence: any = await dispatch(["experiment", "evidence", "--state", proposal, "--replicates", replicates]);
    expect(evidence.text).toContain("from 2 attempts"); expect(evidence.value.journeys).toHaveLength(2);
    await expect(dispatch(["experiment", "evidence", "--state", proposal, "--replicates", replicates])).rejects.toThrow("already holds proposer evidence");
    // 3. A tree proposal allowance, then one fixture proposer session.
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = world.plan;
    const proposerPlan = compileDeclaration({ version: 6, ...raw, scope: { writable: ["wringer/proposals/check-first"] } } as any);
    await writeFile(join(inputs, "grant.json"), JSON.stringify({ plan: proposerPlan, proposalId: "check-first", surface: "claude-code", dimension: "procedure", prediction, actor: "Operator", expiresAt: new Date(Date.now() + 3600000).toISOString(), maxTurns: 1, wallClockSeconds: 600 }));
    const prepared: any = await dispatch(["experiment", "prepare-proposal", "--state", proposal, "--input", join(inputs, "grant.json"), "--output", "proposal-request.json"]);
    expect(prepared.text).toContain("Only writable output: wringer/proposals/check-first/");
    await expect(dispatch(["experiment", "propose", "--state", proposal, "--request", "proposal-request.json"])).rejects.toThrow("needs --yes");
    const executor = async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => {
        const clone = await mkdtemp(join(tmpdir(), "wringer-chain-clone-")); roots.push(clone);
        await git(tmpdir(), "clone", "-q", "--no-checkout", request.repo.bundlePath!, clone); await git(clone, "checkout", "-q", "--detach", request.repo.commit);
        const lines = (await readFile(join(clone, "wringer/evidence/REPLICATES/replicate-02/trajectory.md"), "utf8")).split("\n"), line = lines.findIndex(text => text.includes("[ACTION]")) + 1;
        const files: Record<string, string> = { "CLAUDE.md": "# Worker\nRun scripts/wringer/run-check.sh before editing.\n", "scripts/run-check.sh": "#!/bin/sh\nset -eu\nbun test tests/acceptance.test.ts\n", "NOTES.md": `- CLAUDE.md: replicate-02 line ${line}\n- scripts/run-check.sh: replicate-02 line ${line}\n` };
        const manifest = { schema_version: "wringer.playbook.v2", id: "check-first", revision: "one", title: "Run the check first", role: "worker", taskFamily: "total", surface: "claude-code", files: Object.keys(files).sort().map(path => ({ path, sha256: hashBytes(files[path]!), kind: path === "CLAUDE.md" ? "always-on" : path === "NOTES.md" ? "notes" : "script" })), limits: ["Fixture proposal."], evaluationRefs: [] };
        for (const [path, content] of [...Object.entries(files), ["manifest.json", JSON.stringify(manifest)]]) { await mkdir(dirname(join(clone, "wringer/proposals/check-first", path!)), { recursive: true }); await writeFile(join(clone, "wringer/proposals/check-first", path!), content!); }
        await git(clone, "add", "-A"); const patch = (await processDriver.command(["git", "-C", clone, "diff", "--cached", "--binary", "--full-index", request.repo.commit, "--"], { env })).stdout;
        return { status: "completed", text: "Proposed.", sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", change: { baseCommit: request.repo.commit, patch, sha256: digest(patch) }, provenance: { schema_version: runtimeProvenanceVersion(request.repo.url), runtimeId: crypto.randomUUID(), role: "worker", kind: request.runtime.kind, image: request.runtime.image, repository: { url: request.repo.url, commit: request.repo.commit }, clonedInside: true, hostMounts: [], repositoryAccess: "read-write", declared: request.runtime, observed: { fixture: true }, limits: ["Fixture"] } } as unknown as RoleExecutionResult;
    };
    const result = await proposePlaybookTree(proposal, await readExperimentJson(join(proposal, "proposal-request.json")), { fixtureExecutor: executor, fixtureSource: (plan, state) => prepareRepositorySource({ ...plan.repository, bundlePath: world.bundlePath }, { controllerDir: state }) });
    expect(result.status).toBe("proposed");
    expect((await dispatch(["experiment", "proposal-result", "--state", proposal])).text).toContain("Proposed claude-code playbook check-first");
    // 4. The operator exports, reviews and commits; select-tree prints the exact selection.
    const exported: any = await dispatch(["experiment", "export-proposal", "--state", proposal, "--into", world.repo]);
    expect([...exported.value.files].sort()).toEqual(["CLAUDE.md", "NOTES.md", "manifest.json", "scripts/run-check.sh"]);
    await expect(dispatch(["experiment", "export-proposal", "--state", proposal, "--into", world.repo])).rejects.toThrow("never overwrites a playbook");
    await git(world.repo, "add", "wringer/playbooks/check-first"); await git(world.repo, "commit", "-qm", "Adopt nothing yet: the proposed check-first playbook, for comparison");
    const commit = await git(world.repo, "rev-parse", "HEAD");
    const selected: any = await dispatch(["experiment", "select-tree", "--source", world.repo, "--manifest", "wringer/playbooks/check-first/manifest.json"]);
    expect(selected.value.commit).toBe(commit); expect(selected.value.selection.surface).toBe("claude-code");
    // 5. A comparison: v6 arms identical except the playbook.
    const arm = (playbook: boolean): ExecutionPlan => compileDeclaration({ version: 6, ...raw, repository: { ...raw.repository, commit }, acceptance: { ...raw.acceptance, protected_paths: [...raw.acceptance.protected_paths, ...selected.value.protect] }, ...(playbook ? { playbook: selected.value.selection } : {}) } as any);
    const baseline = arm(false), candidate = arm(true);
    const bundlePath = join(world.root, "chain.bundle"); await git(world.repo, "bundle", "create", bundlePath, "--all");
    const environments = new Map([[baseline.plan_sha256, await discoverEnvironment(world.repo, baseline)], [candidate.plan_sha256, await discoverEnvironment(world.repo, candidate)]]);
    const experiment = await privateDir("wringer-chain-experiment-");
    await writeFile(join(inputs, "comparison.json"), JSON.stringify({ id: "check-first-test", taskFamily: "total", repository: baseline.repository.url, baselinePlaybook: null, candidatePlaybook: candidate.playbook!.sha256, changedVariable: "worker-playbook", tasks: [{ id: "total-1", sourceTree: environments.get(baseline.plan_sha256)!.source_tree, split: "held-out", baseline, candidate }], repetitions: 1, order: "alternating-pairs", stratum: { platform: "darwin", modelSelection: "Scripted fixture", adapterSelection: "Scripted fixture" }, prediction, limits: { maxTrials: 2, maxRoleSessions: baseline.budget.max_sessions * 2, wallClockSeconds: 1800 }, dataScope: "this-repository-only", holdout: { corpusId: "total-unseen", candidateIteration: 1, maximumCandidateIterations: 2, candidateAuthorSawHeldOutSolutions: false }, accounting: "all-planned-trials-including-failures", stoppingRule: "fixed-sample-no-extension" }));
    const registered: any = await dispatch(["experiment", "register", "--state", experiment, "--input", join(inputs, "comparison.json")]);
    expect(registered.value.schema_version).toBe("wringer.experiment-registration.v2"); expect(registered.value.plan.schema_version).toBe("wringer.experiment-plan.v2");
    expect((await reader.validate(registered.value, "experiment-registration-v2.schema.json")).ok).toBe(true);
    await dispatch(["experiment", "grant", "--state", experiment, "--actor", "Operator", "--expires", new Date(Date.now() + 3600000).toISOString(), "--output", "grant.json"]);
    const collected = await collectExperiment(experiment, await readExperimentJson(join(experiment, "grant.json")), { fixture: { run: async (plan, state, grant) => runAndValidateTreeJourney({ bundlePath, environment: environments.get(plan.plan_sha256)! }, plan, state, { actor: `Experiment: ${grant.actor}` }) } });
    expect(collected.trials.map(t => t.outcome)).toEqual(["completed", "completed"]);
    expect(collected.handovers.map(h => [h.status, h.reason])).toEqual([["passed", expect.any(String)], ["passed", expect.any(String)]]);
    const evaluated: any = await dispatch(["experiment", "evaluate", "--state", experiment]);
    expect(evaluated.value.eligibility).toBe("inconclusive"); expect(evaluated.value.recordedTrials).toBe(2);
    expect(evaluated.value.findings).toContain("Deterministic fixtures test the mechanism, not real agent-performance benefit; they cannot make a candidate eligible");
}, 900000);
