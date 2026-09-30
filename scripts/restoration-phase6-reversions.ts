/** Phase 6: every tournament guard is removed alone in an isolated copy, watched red,
 * restored and watched green. Effects are classified; layered guards are listed with
 * the guard that masks them rather than claimed as caught. */
import { runReversions, type Reversion } from "./rebuild-reversions";
const compilerTest = "packages/plan/test/contained-graph-v3.test.ts", kernelTest = "packages/scheduler/test/contained-tournament.test.ts", adapterTest = "packages/application/test/graph-tournament.test.ts";
const compiler = "packages/plan/src/graph.ts", kernel = "packages/scheduler/src/contained.ts", tournament = "packages/application/src/tournament.ts", adapter = "packages/application/src/graph.ts", reader = "examples/evidence/read-bundle.mjs";
const cases: Reversion[] = [];
const probe = (name: string, file: string, before: string, after: string, test: string, pattern: string) => cases.push({ name, file, before, after, test, pattern });

// Compiler: version, prosecutor scope and source, bounded policy, allowance, branch rules.
probe("compiler-tournament-needs-version-3", compiler, "if (TOURNAMENT_KINDS.includes(kind) && version !== 3) fail(", "if (false) fail(", compilerTest, "a tournament needs version 3");
probe("compiler-prosecutor-writes-one-file", compiler, "if (plan.scope.writable.length !== 1 || plan.scope.writable[0] !== PROSECUTOR_ARTIFACT) fail(", "if (false) fail(", compilerTest, "may write a candidate file");
probe("compiler-prosecutor-same-source", compiler, "fail('A prosecutor needs a measured v3/v4 plan');\n    if (hashValue(plan.repository) !== hashValue(repository)) fail(", "fail('A prosecutor needs a measured v3/v4 plan');\n    if (false) fail(", compilerTest, "pinned to another source");
probe("compiler-challenge-limit", compiler, "if (maxChallenges > 16) fail(", "if (false) fail(", compilerTest, "too many challenges");
probe("compiler-control-limit", compiler, "if (!Array.isArray(row.controls) || row.controls.length > 4) fail(", "if (!Array.isArray(row.controls)) fail(", compilerTest, "too many controls");
probe("compiler-control-exact-commit", compiler, "if (typeof entry.commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(entry.commit)) fail(", "if (typeof entry.commit !== 'string') fail(", compilerTest, "not an exact commit");
probe("compiler-evaluator-required", compiler, "if (!Array.isArray(row.evaluator) || !row.evaluator.length || row.evaluator.length > 8) fail(", "if (!Array.isArray(row.evaluator)) fail(", compilerTest, "no final evaluator");
probe("compiler-evaluator-one-content-per-path", compiler, "if (pinned.has(file.path) && pinned.get(file.path) !== file.content) fail(`Evaluator pins", "if (false) fail(`Evaluator pins", compilerTest, "pinned two ways");
probe("compiler-gate-safe-path", compiler, "return { path: relative(entry.path, `${label} file path`), content: entry.content as string };", "return { path: entry.path as string, content: entry.content as string };", compilerTest, "outside the tree");
probe("compiler-gate-timeout-bound", compiler, "if (seconds > 3600) fail(", "if (false) fail(", compilerTest, "unbounded evaluator timeout");
probe("compiler-tie-declared", compiler, "if (!['no-winner', 'tree-order'].includes(row.tie)) fail(", "if (false) fail(", compilerTest, "undeclared tie");
probe("compiler-no-required-branch", compiler, "if (fork?.kind === 'fork' && nodes[fork.join]?.kind === 'tournament') fail(", "if (false) fail(", compilerTest, "required tournament branch");
probe("compiler-no-check-after-tournament", compiler, "if (node.kind === 'check' && nodes[graphCandidateOwner({ nodes }, read)!]?.kind === 'tournament') fail(", "if (false) fail(", compilerTest, "check after a tournament");
probe("compiler-tournament-reservation", compiler, "return { roleSessions: 1, verificationAttempts: node.controls.length + 2 * candidates }; }", "return { roleSessions: 0, verificationAttempts: 0 }; }", compilerTest, "allowance");
probe("compiler-tournament-owns-candidate", compiler, "if (node.kind === 'loop' || closesFork(node)) return cursor;", "if (node.kind === 'loop' || node.kind === 'join') return cursor;", compilerTest, "owns the selected candidate");

// Kernel: arrivals, selection among delivered candidates, ownership, event version.
probe("kernel-stopped-branch-arrives", kernel, "    if (outcome !== SUCCESS[node.kind] && plan.nodes[node.then]?.kind === 'tournament') return { outcome, to: node.then, via, reason: null };\n", "", kernelTest, "stopped one included");
probe("kernel-tournament-waits-for-every-branch", kernel, "else if (closesFork(plan.nodes[expected.to])) {", "else if (plan.nodes[expected.to]?.kind === 'join') {", kernelTest, "stopped one included");
probe("kernel-selects-only-a-delivered-candidate", kernel, "if (!(state.reservation.input.branches ?? []).some(row => row.candidate && row.candidate.source.commit === chosen.source.commit && row.candidate.tree === chosen.tree && row.candidate.source.url === chosen.source.url)) fail(", "if (false) fail(", kernelTest, "no branch delivered");
probe("kernel-tournament-owns-selection", kernel, "if (!result.candidate || result.candidate.owner !== id) fail(`Tournament ${id} must own", "if (!result.candidate) fail(`Tournament ${id} must own", kernelTest, "must own");
probe("kernel-no-winner-has-no-candidate", kernel, "if (result.outcome !== 'selected' && result.candidate) fail(", "if (false) fail(", kernelTest, "no winner carries no candidate");
probe("kernel-version-3-events", kernel, "plan.schema_version === 'wringer.contained-graph-plan.v3' ? 'wringer.contained-graph-event.v3' : ", "", kernelTest, "version 3 events");

// Tournament: eligibility, content labels, prosecutor scope, challenge contract, validation, replay, selection.
probe("tournament-eligible-needs-own-checks", tournament, "if (!row.candidate || !ELIGIBLE.includes(row.outcome ?? \"\"))", "if (!row.candidate)", adapterTest, "branch that stops");
probe("tournament-labels-follow-content", tournament, "[...candidates].filter(row => row.eligible).sort((a, b) => a.tree!.localeCompare(b.tree!) || a.commit!.localeCompare(b.commit!)).forEach(", "[...candidates].filter(row => row.eligible).forEach(", adapterTest, "branch order");
probe("tournament-prosecutor-one-file", tournament, "if (captured.changedPaths.length !== 1 || captured.changedPaths[0] !== PROSECUTOR_ARTIFACT) fail(", "if (false) fail(", adapterTest, "edits anything but");
probe("tournament-challenge-limit", tournament, "if (value.length > node.prosecutor.maxChallenges) fail(", "if (false) fail(", adapterTest, "beyond the declared limit");
probe("tournament-challenge-cites-requirement", tournament, "if (typeof raw.criterion !== \"string\" || !criteria.includes(raw.criterion)) fail(", "if (typeof raw.criterion !== \"string\") fail(", adapterTest, "beyond the declared limit");
probe("tournament-challenge-files-own-prefix", tournament, "if (checked.files.some(file => !file.path.startsWith(CHALLENGE_PREFIX))) fail(", "if (false) fail(", adapterTest, "beyond the declared limit");
probe("tournament-challenge-must-pass-controls", tournament, "controls.every(control => control.code === 0) ? \"valid\" : \"spurious\"", "\"valid\"", adapterTest, "spurious challenge");
probe("tournament-no-control-is-advisory", tournament, "!controls.length ? \"advisory\" : ", "", adapterTest, "without a trusted control");
probe("tournament-spurious-not-replayed", tournament, "const replayed = record.challenges.filter(row => row.validation === \"valid\" || row.validation === \"advisory\");", "const replayed = record.challenges;", adapterTest, "spurious challenge");
probe("tournament-only-valid-disqualifies", tournament, " && replayed[index]!.validation === \"valid\"", "", adapterTest, "without a trusted control");
probe("tournament-contained-provenance", tournament, "if (!p || p.role !== \"verifier\" || p.repository?.commit !== commit || p.repository?.url !== url || p.image !== runtime.image || p.clonedInside !== true || !Array.isArray(p.hostMounts) || p.hostMounts.length) return commands.map(() => null);", "", adapterTest, "cannot show its exact candidate");
probe("tournament-tie-rule-no-winner", tournament, "if (tie === \"no-winner\") return {", "if (false) return {", adapterTest, "spurious challenge");
probe("tournament-selection-by-tree", tournament, "outcome !== \"disqualified\").sort((a, b) => a.tree!.localeCompare(b.tree!) || a.commit!.localeCompare(b.commit!));", "outcome !== \"disqualified\");", adapterTest, "persuasive but wrong|branch order");
probe("tournament-unavailable-run-blocks-selection", tournament, "if (record.runs.some(row => row.outcome === \"unavailable\")) return {", "if (false) return {", adapterTest, "cannot show its exact candidate");

// Adapter and reader: delivery of the selected candidate; selection recomputed from the record.
probe("adapter-control-preflight", adapter, "if ((await git([\"--git-dir\", join(scratch, \"store\"), \"cat-file\", \"-e\", `${control.commit}^{commit}`], \"Checking a trusted control\", { allowed: [0, 1, 128] })).split(\"\\n\")[0] !== \"0\") fail(", "if (false) fail(", adapterTest, "missing from the root bundle");
probe("adapter-tournament-owner", adapter, "    if (plan?.nodes[candidate.owner]?.kind === \"tournament\") return tournamentOwner(directory, candidate);\n", "", adapterTest, "persuasive but wrong");
probe("reader-recomputes-selection", reader, "insist(JSON.stringify(tournamentSelection(t)) === JSON.stringify(t.selection), ", "insist(true, ", adapterTest, "dishonest record");
probe("reader-binds-tournament-evidence", reader, "insist(carried && hashJson(carried) === result.data.evidenceSha256, `Tournament", "insist(carried, `Tournament", adapterTest, "persuasive but wrong");
probe("reader-tournament-delivery-carries-export", reader, "![\"join\", \"tournament\"].includes(", "![\"join\"].includes(", adapterTest, "persuasive but wrong");

export const layered = [
    { guard: "fork names its own tournament; tournament names its fork", maskedBy: "each other, as in phase 4: the fork-side check refuses a mismatched pair first" },
    { guard: "a candidate that does not descend from the fork's source is ineligible", maskedBy: "every branch child is derived from the fork's input; no fixture can produce another base" },
    { guard: "the selection is recorded before the final evaluator runs", maskedBy: "structural order in one function; the test checks that challenge runs precede evaluator runs and that a candidate the evaluator fails stays selected" },
    { guard: "the reader re-derives each run's outcome and each challenge's validation", maskedBy: "the reader's selection recomputation refuses the same forgeries, because a rescued run changes the survivors" },
    { guard: "the selected candidate's owner record matches the kernel result", maskedBy: "the kernel accepts only a delivered branch candidate owned by the tournament" },
    { guard: "trusted controls are re-checked when the tournament runs", maskedBy: "the preflight refuses a missing control before the dispatch marker" },
];
const selected = (() => { const at = process.argv.indexOf("--only"); if (at === -1) return cases; const names = process.argv[at + 1]!.split(","); return cases.filter(row => names.some(name => row.name.startsWith(name))); })();
const evidenceAt = process.argv.indexOf("--evidence"), evidenceDirectory = evidenceAt === -1 ? "docs/restoration/evidence/phase-6" : process.argv[evidenceAt + 1]!;
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
if (revision.exitCode) throw new Error("Could not record source baseline");
for (const row of cases) if ((await Bun.file(row.file).text()).split(row.before).length !== 2) throw new Error(`Mutation target is absent or not unique: ${row.name}`);
if (process.argv.includes("--check-targets")) console.log(`${cases.length} phase-6 isolated reversion targets`);
else {
    try { await runReversions("restoration-phase6", [compilerTest, kernelTest, adapterTest], selected, { baseline: revision.stdout.toString().trim(), evidenceDirectory, restoreEach: true }); }
    finally {
        const effects = [];
        for (const row of selected) {
            const log = await Bun.file(`${evidenceDirectory}/revert-${row.name}.log`).text().catch(() => "");
            const effect = !log ? "not-run" : /Received promise that resolved|did not throw/.test(log) ? "refusal-vanished"
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
