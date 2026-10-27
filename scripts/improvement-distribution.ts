/** Compiled public improvement route, Release 2: a replicate set, the proposer's evidence
 * tree, one proposal, its export and commit, the exact tree selection, a registered v6
 * comparison where only the playbook differs, and its evaluation. A separate fixture-only
 * driver, run by Bun from source, does the three steps that would spend (replicate and
 * comparison collection, the proposer session); every other step is the public binary.
 * Not a live-agent, containment or benefit measurement. */
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runProcess } from "../packages/engine/src/process";

const root = resolve(import.meta.dir, ".."), directory = join(root, ".wringer", `improvement-distribution-${crypto.randomUUID()}`), bin = join(directory, "bin"), home = join(directory, "isolated-home");
await mkdir(bin, { recursive: true }); await mkdir(home);
// Research directories must live outside Git and every controller: private state goes here.
const work = await realpath(await mkdtemp(join(tmpdir(), "wringer-improvement-distribution-")));
await copyFile(join(root, "dist/wring"), join(bin, "wring")); await chmod(join(bin, "wring"), 0o755);
const environment = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LANG: "C.UTF-8", GIT_AUTHOR_NAME: "Fixture operator", GIT_AUTHOR_EMAIL: "operator@example.invalid", GIT_COMMITTER_NAME: "Fixture operator", GIT_COMMITTER_EMAIL: "operator@example.invalid" };
const transcript: { label: string; exit: number }[] = [], startedAt = new Date().toISOString();
async function execute(label: string, argv: string[], options: { expected?: number | "nonzero"; cwd?: string } = {}) {
    const result = await runProcess(argv, { cwd: options.cwd ?? directory, env: label.startsWith("fixture-") ? { ...process.env, ...environment, PATH: process.env.PATH ?? "/usr/bin:/bin" } : environment, timeout: 600, maxBytes: 8 * 1024 * 1024 });
    transcript.push({ label, exit: result.exit_code });
    await writeFile(join(directory, "transcript.json"), JSON.stringify(transcript, null, 2) + "\n");
    const expected = options.expected ?? 0;
    if (result.timed_out || (expected === "nonzero" ? result.exit_code === 0 : result.exit_code !== expected)) throw new Error(`${label}: unexpected exit ${result.exit_code}\n${result.stdout}\n${result.stderr}`);
    return result;
}
const json = (text: string) => JSON.parse(text), wring = join(bin, "wring"), driver = (action: string, ...args: string[]) => [process.execPath, join(root, "scripts/fixtures/improvement-driver.ts"), action, work, ...args];
const privateDirectory = async (name: string) => { const path = join(work, name); await mkdir(path, { mode: 0o700 }); await chmod(path, 0o700); return path; };
const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

// 1. A repository and the no-playbook v6 plan its replicates repeat.
const prepared = json((await execute("fixture-prepare-repository", driver("prepare"))).stdout);
const world = json(await readFile(join(work, "world.json"), "utf8"));
// 2. A replicate set: public register and grant, fixture collection, public status.
const replicates = await privateDirectory("replicates");
await execute("public-replicate-register", [wring, "experiment", "replicate", "register", "--state", replicates, "--input", join(work, "replicate-set.json")]);
await execute("public-replicate-grant", [wring, "experiment", "replicate", "grant", "--state", replicates, "--actor", "Fixture operator", "--expires", new Date(Date.now() + 3600000).toISOString(), "--output", "grant.json"]);
const replicated = json((await execute("fixture-collect-replicates", driver("collect-replicates", replicates))).stdout);
check(replicated.outcomes.join() === "completed,completed" && replicated.divergence.includes("first failure"), `Replicates did not diverge where scripted: ${JSON.stringify(replicated)}`);
check((await execute("public-replicate-status", [wring, "experiment", "replicate", "status", "--state", replicates])).stdout.includes("first failure"), "Public status does not show where the attempts disagreed");
// 3. The proposer's evidence tree, offline, and the proposal allowance.
const proposal = await privateDirectory("proposal");
const evidence = json((await execute("public-evidence", [wring, "experiment", "evidence", "--state", proposal, "--replicates", replicates, "--json"])).stdout);
check(evidence.journeys.length === 2 && evidence.files.some((f: { path: string }) => f.path === "wringer/evidence/DIVERGENCE.md"), "Evidence lacks its replicates or divergence");
await writeFile(join(directory, "fence.json"), JSON.stringify({ heldOutIds: [], oracleDigests: [evidence.journeys[0].journalRevision], denyGlobs: [] }));
const fenced = await execute("public-evidence-refuses-a-planted-oracle-digest", [wring, "experiment", "evidence", "--state", await privateDirectory("fenced"), "--replicates", replicates, "--fence", join(directory, "fence.json")], { expected: "nonzero" });
check(/An oracle digest appears in wringer\/evidence\/REPLICATES\/replicate-01\/trajectory\.md/.test(fenced.stdout + fenced.stderr), "The fence did not refuse a planted digest by content");
const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = world.plan;
const proposerPlan = { version: 6, ...raw, scope: { writable: ["wringer/proposals/check-first"] } };
await writeFile(join(directory, "proposal-grant.json"), JSON.stringify({ plan: proposerPlan, proposalId: "check-first", surface: "claude-code", dimension: "procedure", prediction: { statement: "SCRIPTED: one fewer worker attempt without a lost requirement.", metric: "worker-attempts", minimumImprovement: 1, minimumHeldOutPairs: 4, maximumSignProbability: 0.05, visualQualityClaim: false }, actor: "Fixture operator", expiresAt: new Date(Date.now() + 3600000).toISOString(), maxTurns: 1, wallClockSeconds: 600 }));
await execute("public-prepare-proposal", [wring, "experiment", "prepare-proposal", "--state", proposal, "--input", join(directory, "proposal-grant.json"), "--output", "proposal-request.json"]);
await execute("public-propose-needs-yes", [wring, "experiment", "propose", "--state", proposal, "--request", "proposal-request.json"], { expected: "nonzero" });
// 4. One proposer session (fixture), then the public result.
const proposed = json((await execute("fixture-propose", driver("propose", proposal))).stdout);
check(proposed.status === "proposed" && proposed.citations >= 2, `The proposal was not a cited tree: ${JSON.stringify(proposed)}`);
check((await execute("public-proposal-result", [wring, "experiment", "proposal-result", "--state", proposal])).stdout.includes("Proposed claude-code playbook check-first"), "Public result does not show the proposal");
// 5. The operator exports, reviews and commits; the public selection is exact.
await execute("public-export-proposal", [wring, "experiment", "export-proposal", "--state", proposal, "--into", world.repo]);
await execute("operator-commit", ["git", "-c", "commit.gpgsign=false", "-C", world.repo, "add", "wringer/playbooks/check-first"]);
await execute("operator-commit-record", ["git", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-C", world.repo, "commit", "-qm", "Proposed check-first playbook, for comparison only"]);
const selected = json((await execute("public-select-tree", [wring, "experiment", "select-tree", "--source", world.repo, "--manifest", "wringer/playbooks/check-first/manifest.json", "--json"])).stdout);
// 6. A registered comparison: v6 arms identical except the playbook.
const arm = (playbook: boolean) => ({ version: 6, ...raw, repository: { ...raw.repository, commit: selected.commit }, acceptance: { ...raw.acceptance, protected_paths: [...raw.acceptance.protected_paths, ...selected.protect] }, ...(playbook ? { playbook: selected.selection } : {}) });
const compiled: Record<string, unknown> = {};
for (const name of ["baseline", "candidate"]) {
    await writeFile(join(directory, `${name}.json`), JSON.stringify(arm(name === "candidate")));
    compiled[name] = json((await execute(`public-compile-${name}-arm`, [wring, "plan", join(directory, `${name}.json`), "--json"])).stdout);
}
const tree = (await execute("operator-source-tree", ["git", "-C", world.repo, "rev-parse", `${selected.commit}^{tree}`])).stdout.trim();
const experiment = await privateDirectory("experiment");
await writeFile(join(directory, "comparison.json"), JSON.stringify({ id: "check-first-test", taskFamily: "total", repository: world.plan.repository.url, baselinePlaybook: null, candidatePlaybook: selected.selection.sha256, changedVariable: "worker-playbook", tasks: [{ id: "total-1", sourceTree: tree, split: "held-out", baseline: compiled.baseline, candidate: compiled.candidate }], repetitions: 1, order: "alternating-pairs", stratum: { platform: "darwin", modelSelection: "Scripted fixture", adapterSelection: "Scripted fixture" }, prediction: { statement: "SCRIPTED: one fewer worker attempt without a lost requirement.", metric: "worker-attempts", minimumImprovement: 1, minimumHeldOutPairs: 4, maximumSignProbability: 0.05, visualQualityClaim: false }, limits: { maxTrials: 2, maxRoleSessions: 24, wallClockSeconds: 1800 }, dataScope: "this-repository-only", holdout: { corpusId: "total-unseen", candidateIteration: 1, maximumCandidateIterations: 2, candidateAuthorSawHeldOutSolutions: false }, accounting: "all-planned-trials-including-failures", stoppingRule: "fixed-sample-no-extension" }));
const registered = json((await execute("public-register-v6-comparison", [wring, "experiment", "register", "--state", experiment, "--input", join(directory, "comparison.json"), "--json"])).stdout);
check(registered.schema_version === "wringer.experiment-registration.v2", "A v6 comparison was not registered by its v2 sibling");
await execute("public-comparison-grant", [wring, "experiment", "grant", "--state", experiment, "--actor", "Fixture operator", "--expires", new Date(Date.now() + 3600000).toISOString(), "--output", "grant.json"]);
const collected = json((await execute("fixture-collect-comparison", driver("collect-experiment", experiment))).stdout);
check(collected.outcomes.join() === "completed,completed" && collected.handovers.join() === "passed,passed", `Comparison trials or their private handovers failed: ${JSON.stringify(collected)}`);
const evaluated = json((await execute("public-evaluate", [wring, "experiment", "evaluate", "--state", experiment, "--json"])).stdout);
check(evaluated.eligibility === "inconclusive" && evaluated.recordedTrials === 2 && evaluated.findings.some((f: string) => f.includes("Deterministic fixtures")), "Fixture evaluation claimed more than the mechanism");
const binary = await readFile(join(root, "dist/wring"));
check(!binary.includes(Buffer.from("scriptedTreeProposer")) && !binary.includes(Buffer.from("runAndValidateTreeJourney")), "The public binary contains fixture code");
const result = { status: "passed", work, startedAt, finishedAt: new Date().toISOString(), repository: prepared.commit, publicCommandStages: transcript.filter(row => row.label.startsWith("public-")).length, fixtureStages: transcript.filter(row => row.label.startsWith("fixture-")).length, proposal: proposed, evaluation: { eligibility: evaluated.eligibility, sha256: evaluated.sha256 }, liveProviderMeasured: false, realContainmentMeasured: false, limits: ["Replicates, trials and the proposer used scripted agents and checks on real Git journeys, captures and private handovers.", "No model wrote the proposal; no benefit is measured or claimed."] };
await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`Compiled improvement route passed: ${directory}\n${result.publicCommandStages} public stages, ${result.fixtureStages} fixture stages. No live agent or benefit measured.`);
