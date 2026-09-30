/** Compiled public gate-experiment journey. A separately compiled fixture binary
 * prepares a labelled corpus and runs gates on exported trees; every other step
 * uses the public binary. Not a containment or live-agent measurement. */
import { chmod, copyFile, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProcess } from "../packages/engine/src/process";

const root = resolve(import.meta.dir, ".."), directory = join(root, ".wringer", `gate-experiment-distribution-${crypto.randomUUID()}`), bin = join(directory, "bin"), home = join(directory, "isolated-home");
await mkdir(bin, { recursive: true }); await mkdir(home);
await copyFile(join(root, "dist/wring"), join(bin, "wring")); await chmod(join(bin, "wring"), 0o755);
const environment = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LANG: "C.UTF-8" };
const transcript: { label: string; exit: number }[] = [], startedAt = new Date().toISOString();
async function execute(label: string, argv: string[], options: { expected?: number | "nonzero"; build?: boolean } = {}) {
    const result = await runProcess(argv, { cwd: options.build ? root : directory, env: options.build ? process.env : environment, timeout: 180, maxBytes: 8 * 1024 * 1024 });
    transcript.push({ label, exit: result.exit_code });
    await writeFile(join(directory, "transcript.json"), JSON.stringify(transcript, null, 2) + "\n");
    const expected = options.expected ?? 0;
    if (result.timed_out || (expected === "nonzero" ? result.exit_code === 0 : result.exit_code !== expected)) throw new Error(`${label}: unexpected exit ${result.exit_code}\n${result.stdout}\n${result.stderr}`);
    return result;
}
const json = (text: string) => JSON.parse(text), wring = join(bin, "wring"), fixture = join(bin, "gate-fixture-driver");
await execute("compile-fixture-only-driver", [process.execPath, "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "--asset", "schema", "scripts/fixtures/gate-driver.ts", "--outfile", fixture], { build: true });
const prepared = json((await execute("synthetic-labelled-corpus", [fixture, "prepare", directory])).stdout);
const oracle = join(directory, "oracle.json");
const sealed = json((await execute("public-seal-oracle", [wring, "experiment", "gate", "oracle", "--corpus", "totals", "--labels", join(directory, "labels.json"), "--output", oracle, "--json"])).stdout);
async function register(name: string) {
    const proposal = json((await execute(`public-${name}-proposal`, [wring, "experiment", "gate", "propose", "--input", join(directory, `${name}-proposal-input.json`), "--output", join(directory, `${name}-proposal.json`), "--json"])).stdout);
    await writeFile(join(directory, `${name}-experiment.json`), JSON.stringify({ id: `${name}-gate`, taskFamily: "totals", repository: { url: "https://fixture.invalid/totals.git", commit: prepared.base }, changedVariable: "acceptance-gates",
        runtime: { kind: "apple-container", image: `fixture.invalid/verifier@sha256:${"a".repeat(64)}`, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] }, baselineGates: JSON.parse(await readFile(join(directory, "baseline-gates.json"), "utf8")), proposalSha256: proposal.sha256,
        corpus: { id: "totals", items: prepared.items, oracleSha256: sealed.sha256 }, prediction: { statement: "The candidate catches more held-out defects without failing a correct control.", minimumAdditionalDefectsCaught: 1, maximumAdditionalFalsePositives: 0, minimumHeldOutDefects: 3, minimumHeldOutControls: 2 },
        limits: { maxGateRuns: 32, wallClockSeconds: 600 }, holdout: { candidateIteration: 1, maximumCandidateIterations: 3, proposalSawHeldOut: false }, order: "fixed-corpus-order", stoppingRule: "fixed-sample-no-extension", accounting: "all-planned-runs-including-unavailable" }, null, 2));
    const state = join(directory, `${name}-state`);
    await execute(`public-${name}-register`, [wring, "experiment", "gate", "register", "--input", join(directory, `${name}-experiment.json`), "--proposal", join(directory, `${name}-proposal.json`), "--source-bundle", prepared.bundle, "--state", state]);
    return state;
}
const useful = await register("property");
const noRuntime = await execute("public-evaluate-refuses-missing-runtime", [wring, "experiment", "gate", "evaluate", "--state", useful, "--oracle", oracle, "--yes"], { expected: "nonzero" });
if (!/fixed sample is intact/.test(noRuntime.stdout + noRuntime.stderr)) throw new Error("Missing runtime was not refused before reserving a run");
const evaluated = json((await execute("fixture-evaluate-useful-gate", [fixture, "evaluate", prepared.root, useful, oracle])).stdout);
if (!evaluated.qualified) throw new Error(`The useful gate did not qualify: ${evaluated.reasons.join("; ")}`);
const status = json((await execute("public-status-qualified", [wring, "experiment", "gate", "status", "--state", useful, "--json"])).stdout);
if (status.evaluation.sha256 !== evaluated.sha256) throw new Error("Public status disagrees with the evaluation");
await execute("public-prepare-change", [wring, "experiment", "gate", "change", "--state", useful, "--output", join(directory, "change")]);
if (!(await readFile(join(directory, "change/PROPOSAL.md"), "utf8")).includes("Rollback")) throw new Error("The source change lacks its rollback");
const sent = json((await execute("public-explicit-send", [wring, "experiment", "gate", "send", "--state", useful, "--remote", prepared.origin, "--source-branch", "wringer/gate-property", "--by", "Gate fixture operator", "--yes", "--json"])).stdout);
const branch = (await execute("sent-branch-is-exact-change", ["git", "--git-dir", prepared.origin, "rev-parse", "wringer/gate-property"])).stdout.trim();
if (branch !== sent.commit) throw new Error("The review branch is not the prepared change");
if ((await execute("unchanged-default-branch", ["git", "--git-dir", prepared.origin, "rev-parse", "main"])).stdout.trim() !== prepared.base) throw new Error("Send changed the default branch");
const registry = join(directory, "registry");
const adopted = json((await execute("public-future-only-adoption", [wring, "experiment", "gate", "adopt", "--state", useful, "--registry", registry, "--by", "Gate fixture operator", "--yes", "--json"])).stdout);
const selections = json((await execute("public-selections", [wring, "experiment", "gate", "selections", "--registry", registry, "--json"])).stdout);
if (selections.current?.sha256 !== adopted.sha256) throw new Error("The adoption is not the current future selection");
const weakened = await register("weakened");
const rejected = json((await execute("fixture-evaluate-weakened-gate", [fixture, "evaluate", prepared.root, weakened, oracle])).stdout);
if (rejected.qualified || !rejected.reasons.join(" ").includes("fewer held-out defects") || rejected.candidate.passRate <= rejected.baseline.passRate) throw new Error("The weakened gate was not caught by the independent comparison");
await execute("public-weakened-status-not-qualified", [wring, "experiment", "gate", "status", "--state", weakened], { expected: 3 });
await execute("public-weakened-change-refused", [wring, "experiment", "gate", "change", "--state", weakened, "--output", join(directory, "weakened-change")], { expected: "nonzero" });
const binary = await readFile(join(root, "dist/wring"));
if (binary.includes(Buffer.from("gateRunner("))) throw new Error("The public binary contains the fixture gate runner");
const result = { status: "passed", startedAt, finishedAt: new Date().toISOString(), publicCommandStages: transcript.filter(row => row.label.startsWith("public-")).length, fixtureStages: transcript.filter(row => row.label.startsWith("fixture-")).length, usefulEvaluation: evaluated.sha256, weakenedReasons: rejected.reasons, sentCommit: sent.commit, gateRunsOnExportedTrees: true, realContainmentMeasured: false, liveProviderMeasured: false, limits: ["Gate runs used a separately compiled fixture runner on exported trees, not a contained verifier.", "Publication used only a new local bare fixture origin."] };
await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`Compiled gate-experiment fixture passed: ${directory}\n${result.publicCommandStages} public stages, ${result.fixtureStages} fixture stages. Real containment remains unmeasured.`);
