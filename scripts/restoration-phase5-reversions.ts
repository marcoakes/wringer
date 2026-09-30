/** Phase 5: every gate- and workflow-experiment guard is removed alone in an
 * isolated copy, watched red, restored and watched green. Effects are classified;
 * layered guards are listed with the guard that masks them rather than claimed. */
import { runReversions, type Reversion } from "./rebuild-reversions";
const appTest = "packages/application/test/gate-experiments.test.ts", cliTest = "packages/cli/test/gate-experiment-cli.test.ts";
const evaluator = "packages/application/src/gate-experiments.ts", cli = "packages/cli/src/gate-experiment-cli.ts";
const cases: Reversion[] = [];
const probe = (name: string, file: string, before: string, after: string, test: string, pattern: string) => cases.push({ name, file, before, after, test, pattern });

// Proposal: pinned files are unambiguous; an author is never a human verdict.
probe("proposal-one-content-per-path", evaluator, "if (paths.has(file.path) && paths.get(file.path) !== file.content) fail(", "if (false) fail(", appTest, "pin one gate path");
probe("proposal-author-is-not-a-verdict", evaluator, "if (![\"operator\", \"delegated-agent\"].includes(author.kind)) fail(", "if (false) fail(", appTest, "pin one gate path");

// Registration: exact corpus, oracle commitment, holdout, budget, contained runtime.
probe("register-proposal-digest", evaluator, "if (input.proposalSha256 !== proposal.sha256) fail(", "if (false) fail(", appTest, "differs from the registered digest");
probe("register-no-held-out-inputs", evaluator, "if (item.split === \"held-out\") fail(`A proposal built from held-out item", "if (false) fail(`A proposal built from held-out item", appTest, "held-out item cannot be registered");
probe("register-proposal-never-saw-held-out", evaluator, "if (holdout.proposalSawHeldOut !== false) fail(", "if (false) fail(", appTest, "registration refuses");
probe("register-holdout-iteration-ceiling", evaluator, ") fail(\"The held-out corpus is exhausted", " && false) fail(\"The held-out corpus is exhausted", appTest, "registration refuses");
probe("register-run-budget", evaluator, "if (base.corpus.items.length * 2 > base.limits.maxGateRuns) fail(", "if (false) fail(", appTest, "run budget");
probe("register-item-tree", evaluator, "\"Reading an item tree\")).out !== item.tree)", "\"Reading an item tree\")).out === \"\")", appTest, "registration refuses");
probe("register-verifier-image-digest", evaluator, "if (typeof row.image !== \"string\" || !/@sha256:[a-f0-9]{64}$/.test(row.image)) fail(", "if (typeof row.image !== \"string\") fail(", appTest, "registration refuses");
probe("register-network-denied", evaluator, "if (row.network?.policy !== \"deny\") fail(", "if (false) fail(", appTest, "registration refuses");
probe("register-no-credentials", evaluator, "if (!Array.isArray(row.env) || row.env.length) fail(", "if (!Array.isArray(row.env)) fail(", appTest, "registration refuses");
probe("workflow-candidate-gates-match-proposal", evaluator, "if (!sameGates(candidate.gates, proposal.candidateGates)) fail(", "if (false) fail(", appTest, "proposal naming other gates");
probe("workflow-graph-pins-corpus-base", evaluator, "if (plan.repository.url !== repository.url || plan.repository.commit !== repository.commit) fail(", "if (false) fail(", appTest, "proposal naming other gates");
probe("workflow-counts-required-holds", evaluator, "requiredHolds: plan.required.filter(name => plan.nodes[name]?.kind === \"human-hold\").length", "requiredHolds: 0", appTest, "holds its graph requires");

// Evaluation: oracle commitment, fixed sample, reservation, containment, overlay.
probe("evaluate-oracle-commitment", evaluator, "if (oracle.sha256 !== experiment.corpus.oracleSha256 || oracle.corpusId !== experiment.corpus.id) fail(", "if (false) fail(", appTest, "registered commitment");
probe("evaluate-once", evaluator, "        if (evaluation) return evaluation;\n", "", appTest, "incomplete and is never rerun");
probe("evaluate-reserved-run-is-uncertain", evaluator, "if (await present(reservedPath)) {", "if (false) {", appTest, "reserved before a crash");
probe("evaluate-wall-clock", evaluator, "if (stopped || clock().getTime() > deadline || !gates.length) {", "if (stopped || !gates.length) {", appTest, "registered wall clock");
probe("evaluate-stop-after-infrastructure-failure", evaluator, "row = { ...blank, outcome: \"unavailable\" }; stopped = true;", "row = { ...blank, outcome: \"unavailable\" };", appTest, "infrastructure failure stops");
probe("evaluate-gate-overlay", evaluator, "protectedFiles: [...new Set(gates.flatMap(gate => gate.files.map(file => file.path)))]", "protectedFiles: []", appTest, "cannot rewrite the gate");
probe("evaluate-arm-uses-its-own-gates", evaluator, "commit: experiment.arms[arm].commit, bundlePath: join(root, \"gates.bundle\")", "commit: experiment.arms.baseline.commit, bundlePath: join(root, \"gates.bundle\")", appTest, "useful gate qualifies");
probe("evaluate-provenance-exact-commit", evaluator, "p.repository?.commit !== item.commit || ", "", appTest, "cannot establish its exact item");
probe("evaluate-provenance-verifier-role", evaluator, "p.role !== \"verifier\" || ", "", appTest, "cannot establish its exact item");
probe("evaluate-provenance-cloned-inside", evaluator, "p.clonedInside !== true || ", "", appTest, "cannot establish its exact item");
probe("evaluate-provenance-no-host-mounts", evaluator, "|| p.hostMounts.length) fail(\"A gate run", ") fail(\"A gate run", appTest, "cannot establish its exact item");
probe("evaluate-every-planned-gate-reported", evaluator, "if (hashValue(measured.results.map(result => result.id)) !== hashValue(request.commands.map(command => command.id))) fail(", "if (false) fail(", appTest, "cannot establish its exact item");
probe("evaluate-source-tree-matches-item", evaluator, "if (row.sourceTree !== null && row.sourceTree !== item.tree) row = { ...row, outcome: \"unavailable\" };", "", appTest, "cannot establish its exact item");
probe("evaluate-records-latency", evaluator, "durationMs: runs.filter(run => run.arm === arm).reduce((sum, run) => sum + (run.durationMs ?? 0), 0) };", "durationMs: 0 };", appTest, "useful gate qualifies");
probe("evaluate-unavailable-exit-is-not-a-verdict", evaluator, "codes.some(code => !Number.isInteger(code) || unavailableExit(code))", "codes.some(code => !Number.isInteger(code))", appTest, "incomplete and is never rerun");

// Qualification: held-out split against the oracle, never the gate's own pass rate.
probe("qualify-incomplete-evidence", evaluator, "if (incomplete) reasons.push(", "if (false) reasons.push(", appTest, "incomplete and is never rerun");
probe("qualify-fewer-defects", evaluator, "if (gained < 0) reasons.push(", "if (false) reasons.push(", appTest, "weakened gate");
probe("qualify-registered-prediction", evaluator, "else if (gained < prediction.minimumAdditionalDefectsCaught) reasons.push(", "else if (false) reasons.push(", appTest, "missed prediction");
probe("qualify-false-positives", evaluator, "if (noise > prediction.maximumAdditionalFalsePositives) reasons.push(", "if (false) reasons.push(", appTest, "noisy gate");
probe("qualify-added-holds", evaluator, "if (holds > experiment.maximumAdditionalHolds) reasons.push(", "if (false) reasons.push(", appTest, "adds a required human hold");

// Change, Send and future-only adoption are separate, qualified, recorded actions.
probe("change-needs-qualification", evaluator, "if (!current.evaluation?.qualification.qualified) fail(", "if (!current.evaluation) fail(", appTest, "unqualified proposal cannot prepare");
probe("change-prepared-once", evaluator, "if (current.change) fail(", "if (false) fail(", appTest, "separate recorded actions");
probe("send-needs-prepared-change", evaluator, "if (!current.change) fail(\"Prepare the source change", "if (false) fail(\"Prepare the source change", appTest, "separate recorded actions");
probe("send-once", evaluator, "if (current.sent) fail(", "if (false) fail(", appTest, "separate recorded actions");
probe("send-not-main-or-master", evaluator, "if ([\"main\", \"master\"].includes(branch) || ", "if (", appTest, "separate recorded actions");
probe("send-not-remote-default", evaluator, ".test(heads)) fail(\"The review branch is the remote default branch", ".test(\"\")) fail(\"The review branch is the remote default branch", appTest, "separate recorded actions");
probe("send-no-overwrite", evaluator, "if (existing && existing !== current.change.commit) fail(", "if (false) fail(", appTest, "separate recorded actions");
probe("adopt-expected-revision", evaluator, "if (history.revision !== expectedRevision) fail(", "if (false) fail(", appTest, "separate recorded actions");
probe("undo-restores-previous-selection", evaluator, "if (row.action === \"adopt\") stack.push(row); else stack.pop();", "if (row.action === \"adopt\") stack.push(row); else stack.length = 0;", appTest, "separate recorded actions");
probe("selections-contiguous", evaluator, "if (name !== `${String(index).padStart(4, \"0\")}.json`) fail(", "if (false) fail(", appTest, "missing or re-linked");
probe("selections-chained", evaluator, "if (row.previousSha256 !== previous) fail(", "if (false) fail(", appTest, "missing or re-linked");

// Public route: explicit confirmation, and no reservation on a missing runtime.
probe("cli-evaluate-needs-yes", cli, "allowed(a, [\"state\", \"oracle\", \"yes\"]); confirm(a);", "allowed(a, [\"state\", \"oracle\", \"yes\"]);", cliTest, "evaluation needs --yes");
probe("cli-gate-help-routed", "packages/cli/src/app.ts", "    if (a.command === \"experiment\" && [\"gate\", \"workflow\"].includes(a.words[0] ?? \"\")) return experimentCommand(a, repo);\n", "", cliTest, "gate help");
probe("cli-runtime-preflight", cli, "if (!current.evaluation) requireRuntime(current.registration.runtime.kind);", "", cliTest, "evaluation needs --yes");

export const layered = [
    { guard: "the oracle labels exactly the registered corpus", maskedBy: "the registered oracle commitment: any other label set has another digest" },
    { guard: "an oracle's and a proposal's own digests", maskedBy: "the registration commitments: a rebuilt record with another digest never matches what was registered" },
    { guard: "holdout leakage reason at qualification", maskedBy: "registration refuses a proposal whose inputs name a held-out item, so a leaked proposal never reaches evaluation" },
    { guard: "the remote confirms the exact sent commit", maskedBy: "unmeasured: no fixture remote accepts a push and then reports another commit" },
];
const selected = (() => { const at = process.argv.indexOf("--only"); return at === -1 ? cases : cases.filter(row => row.name.startsWith(process.argv[at + 1]!)); })();
const evidenceAt = process.argv.indexOf("--evidence"), evidenceDirectory = evidenceAt === -1 ? "docs/restoration/evidence/phase-5" : process.argv[evidenceAt + 1]!;
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
if (revision.exitCode) throw new Error("Could not record source baseline");
for (const row of cases) if ((await Bun.file(row.file).text()).split(row.before).length !== 2) throw new Error(`Mutation target is absent or not unique: ${row.name}`);
if (process.argv.includes("--check-targets")) console.log(`${cases.length} phase-5 isolated reversion targets`);
else {
    try { await runReversions("restoration-phase5", [appTest, cliTest], selected, { baseline: revision.stdout.toString().trim(), evidenceDirectory, restoreEach: true }); }
    finally {
        const effects = [];
        for (const row of selected) {
            const log = await Bun.file(`${evidenceDirectory}/revert-${row.name}.log`).text().catch(() => "");
            const effect = !log ? "not-run" : /Received promise that resolved|did not throw|expected a refusal/.test(log) ? "refusal-vanished"
                : /Received message: "expect\(received\)/.test(log) ? "recorded-state-changed"
                : /Received message:/.test(log) ? /undefined is not|is not a function|is not iterable|Cannot read/.test(log) ? "named-refusal-became-crash" : "different-guard-refused"
                : /\(fail\)/.test(log) ? "recorded-state-changed" : "not-red";
            effects.push({ name: row.name, effect });
        }
        await Bun.write(`${evidenceDirectory}/effects.json`, JSON.stringify({ layered, effects }, null, 2) + "\n");
        const counts: Record<string, number> = {};
        for (const row of effects) counts[row.effect] = (counts[row.effect] ?? 0) + 1;
        console.log(JSON.stringify(counts));
    }
}
