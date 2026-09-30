/** Phase 6 measure-first (bun scripts/restoration-phase6-measure.ts OUTPUT): one
 * candidate against a fixed small number on the same task family, before any
 * tournament exists. Real Git candidates, real check and challenge commands on
 * exported trees, scripted prosecutor challenges, a frozen final evaluator. No
 * model, container or network. This measures selection rules on constructed
 * cases; it says nothing about how often live agents produce such candidates. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileContainedGraph, compileDeclaration } from "../packages/plan/src";

const output = resolve(process.argv[2] ?? "build/restoration/phase-6/measurements"), scratch = await mkdtemp(join(tmpdir(), "wringer-phase6-measure-"));
const run = (argv: string[], cwd?: string) => { const r = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe", env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }); return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() }; };
const git = (args: string[], cwd?: string) => { const r = run(["git", "-c", "user.name=Phase 6 measurement", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], cwd); if (r.code) throw new Error(r.err); return r.out; };
const record: Record<string, unknown> = { schema_version: "wringer.restoration-phase6-measurement.v1", kind: "deterministic: real Git candidates and real commands on exported trees; scripted prosecutor challenges; the final evaluator is the oracle", git: git(["--version"]) };

// 1. A version 2 graph can run alternatives, but its join integrates them all.
const repo = join(scratch, "tasks"); await mkdir(join(repo, "src"), { recursive: true }); git(["init", "-q", "-b", "main", repo]);
await writeFile(join(repo, "src/total.sh"), "#!/bin/sh\necho $(( $1 + $2 + 1 ))\n"); await writeFile(join(repo, "check.sh"), "test \"$(sh src/total.sh 2 3)\" = 5\n");
git(["add", "."], repo); git(["commit", "-q", "-m", "Buggy base: total is off by one"], repo);
const base = git(["rev-parse", "HEAD"], repo), url = "https://fixture.invalid/totals.git";
const runtime = { kind: "apple-container", image: `fixture.invalid/agent@sha256:${"a".repeat(64)}`, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] };
const leaf = compileDeclaration({ version: 3, name: "Fix the total", intent: "Return the sum of two integers.", repository: { url, commit: base }, runtime, agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } }, environment: { context: [], tools: [], setup: [], baseline: [], writable_directories: [] }, scope: { writable: ["src"] }, acceptance: { criteria: [{ id: "sum", title: "Sum", quote: "Return the sum of two integers.", kind: "check", required: true }], checks: [{ id: "sum", argv: ["sh", "check.sh"], cwd: ".", timeout_seconds: 10, criteria: ["sum"], files: ["check.sh"] }], protected_paths: [] }, budget: { max_sessions: 2, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 600, session_timeout_seconds: 300 } });
const alternatives = compileContainedGraph({ version: 2, id: "alternatives", repository: { url, commit: base }, entry: "split", required: ["merge"], parallelism: 3, budget: { maxRoleSessions: 6, maxVerificationAttempts: 12, wallClockSeconds: 1800 },
    nodes: { split: { kind: "fork", input: "root", branches: ["one", "two", "three"], join: "merge" }, one: { kind: "loop", input: "split", plan: leaf, then: "merge" }, two: { kind: "loop", input: "split", plan: leaf, then: "merge" }, three: { kind: "loop", input: "split", plan: leaf, then: "merge" }, merge: { kind: "join", fork: "split", then: "done" } } });

// 2. Four tasks, three candidates each, a trusted control and a hidden final evaluator.
type Candidate = { id: string; body: string; label: "correct" | "defect" };
const tasks: { id: string; reading: string; candidates: Candidate[]; challenges: { id: string; script: string }[] }[] = [
    { id: "persuasive-wrong", reading: "One candidate hard-codes the checked example; it passes its own check.", candidates: [
        { id: "a-hardcoded", body: "echo 5", label: "defect" }, { id: "a-arith", body: "echo $(( $1 + $2 ))", label: "correct" }, { id: "a-expr", body: "expr \"$1\" + \"$2\"", label: "correct" }],
      challenges: [{ id: "grid", script: "for a in 0 1 4; do for b in 0 2 9; do test \"$(sh src/total.sh $a $b)\" = $(( a + b )) || exit 1; done; done" }] },
    { id: "shared-defect", reading: "Every candidate drops the sign of its inputs, the same correlated mistake.", candidates: [
        { id: "b-strip", body: "echo $(( ${1#-} + ${2#-} ))", label: "defect" }, { id: "b-awk-abs", body: "awk -v a=\"$1\" -v b=\"$2\" 'BEGIN { if (a < 0) a = -a; if (b < 0) b = -b; print a + b }'", label: "defect" }, { id: "b-sed", body: "a=$(echo \"$1\" | sed 's/^-//'); b=$(echo \"$2\" | sed 's/^-//'); echo $(( a + b ))", label: "defect" }],
      challenges: [{ id: "negative", script: "test \"$(sh src/total.sh -1 1)\" = 0" }] },
    { id: "spurious-challenge", reading: "The prosecutor also writes a test that asserts the wrong answer.", candidates: [
        { id: "c-arith", body: "echo $(( $1 + $2 ))", label: "correct" }, { id: "c-hardcoded", body: "echo 5", label: "defect" }, { id: "c-awk", body: "awk -v a=\"$1\" -v b=\"$2\" 'BEGIN { print a + b }'", label: "correct" }],
      challenges: [{ id: "wrong-expectation", script: "test \"$(sh src/total.sh 2 2)\" = 5" }, { id: "grid", script: "for a in 0 1 4; do for b in 0 2 9; do test \"$(sh src/total.sh $a $b)\" = $(( a + b )) || exit 1; done; done" }] },
    { id: "no-valid-candidate", reading: "No candidate is correct; two fail differently and one hard-codes.", candidates: [
        { id: "d-hardcoded", body: "echo 5", label: "defect" }, { id: "d-off", body: "if [ \"$1\" = 2 ]; then echo 5; else echo $(( $1 + $2 + 1 )); fi", label: "defect" }, { id: "d-minus", body: "if [ \"$2\" = 3 ]; then echo $(( $1 + 3 )); else echo $(( $1 - $2 )); fi", label: "defect" }],
      challenges: [{ id: "grid", script: "for a in 0 1 4; do for b in 0 2 9; do test \"$(sh src/total.sh $a $b)\" = $(( a + b )) || exit 1; done; done" }] },
];
const control = "echo $(( $1 + $2 ))";
const evaluator = "for a in -3 0 2 7; do for b in -2 0 3 5; do test \"$(sh src/total.sh $a $b)\" = $(( a + b )) || exit 1; done; done";
const commit = async (body: string, label: string) => { git(["checkout", "-q", base], repo); await writeFile(join(repo, "src/total.sh"), `#!/bin/sh\n${body}\n`); git(["commit", "-q", "--allow-empty", "-am", label], repo); return git(["rev-parse", "HEAD"], repo); };
const commits: Record<string, string> = { control: await commit(control, "trusted control") };
for (const task of tasks) for (const candidate of task.candidates) commits[candidate.id] = await commit(candidate.body, candidate.id);
let runs = 0; const timings: number[] = [];
async function passes(commitId: string, script: string) {
    const work = await mkdtemp(join(scratch, "tree-")), exported = run(["/bin/sh", "-c", `git -C '${repo}' archive ${commitId} | tar -x -C '${work}'`]); if (exported.code) throw new Error(exported.err);
    const started = performance.now(), result = run(["/bin/sh", "-c", script], work); runs++; timings.push(performance.now() - started);
    return result.code === 0;
}
// The join's integration of three alternatives, measured with the same Git merge the adapter uses.
const [x, y] = [commits["a-arith"]!, commits["a-expr"]!];
const merged = run(["git", "-C", repo, "merge-tree", "--write-tree", "--name-only", "--no-messages", "--merge-base", base, x, y]);
record.currentContract = { graphCompiles: alternatives.schema_version, joinOutcomeForAlternatives: merged.code === 0 ? "integrated" : "conflict", conflictingPaths: merged.out.split("\n").slice(1).filter(Boolean),
    reading: "A version 2 join integrates every branch; alternatives that edit the same file conflict. A branch that stops ends the whole graph. Nothing selects one alternative or tries to falsify it." };

// 3. Three selection rules over every candidate order.
const orders = (items: Candidate[]): Candidate[][] => items.length <= 1 ? [items] : items.flatMap((item, index) => orders([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]));
const check = "test \"$(sh src/total.sh 2 3)\" = 5";
const perTask: any[] = [];
for (const task of tasks) {
    const ownCheck: Record<string, boolean> = {}, final: Record<string, boolean> = {};
    for (const candidate of task.candidates) { ownCheck[candidate.id] = await passes(commits[candidate.id]!, check); final[candidate.id] = await passes(commits[candidate.id]!, evaluator); }
    // Challenge validation: a challenge must pass the trusted control.
    const validated: string[] = []; for (const challenge of task.challenges) if (await passes(commits.control!, challenge.script)) validated.push(challenge.id);
    const reproduced: Record<string, string[]> = {};
    for (const candidate of task.candidates) { reproduced[candidate.id] = []; for (const challenge of task.challenges.filter(row => validated.includes(row.id))) if (!await passes(commits[candidate.id]!, challenge.script)) reproduced[candidate.id]!.push(challenge.id); }
    // Majority vote: the most common output over the challenge inputs among candidates passing their own check.
    const outputs: Record<string, string> = {};
    for (const candidate of task.candidates) { const work = await mkdtemp(join(scratch, "vote-")); run(["/bin/sh", "-c", `git -C '${repo}' archive ${commits[candidate.id]} | tar -x -C '${work}'`]); outputs[candidate.id] = ["-1 1", "2 2", "4 9"].map(args => run(["/bin/sh", "-c", `sh src/total.sh ${args}`], work).out).join(","); }
    const changed: Record<string, number> = {}, trees: Record<string, string> = {};
    for (const candidate of task.candidates) { changed[candidate.id] = git(["diff", "--numstat", base, commits[candidate.id]!], repo).split("\n").filter(Boolean).reduce((sum, line) => sum + Number(line.split("\t")[0]) + Number(line.split("\t")[1]), 0); trees[candidate.id] = git(["rev-parse", `${commits[candidate.id]}^{tree}`], repo); }
    const selections: Record<string, { selected: string | null; defect: boolean }[]> = { single: [], vote: [], tournament: [], "tournament-smallest-change": [], "tournament-tree-order": [] };
    for (const order of orders(task.candidates)) {
        const ready = order.filter(candidate => ownCheck[candidate.id]);
        const single = ready[0] ?? null;
        const tally = new Map<string, Candidate[]>(); for (const candidate of ready) tally.set(outputs[candidate.id]!, [...(tally.get(outputs[candidate.id]!) ?? []), candidate]);
        const top = [...tally.values()].sort((a, b) => b.length - a.length); const vote = top.length && (top.length === 1 || top[0]!.length > top[1]!.length) ? top[0]![0]! : null;
        const survivors = ready.filter(candidate => !reproduced[candidate.id]!.length).map(candidate => candidate.id).sort();
        const tournament = survivors.length === 1 ? survivors[0]! : null;
        const row = (selected: string | null) => ({ selected, defect: selected !== null && !final[selected] });
        const smallest = survivors.length ? Math.min(...survivors.map(id => changed[id]!)) : 0, least = survivors.filter(id => changed[id] === smallest);
        const byTree = [...survivors].sort((x, y) => trees[x]!.localeCompare(trees[y]!))[0] ?? null;
        selections.single!.push(row(single?.id ?? null)); selections.vote!.push(row(vote?.id ?? null)); selections.tournament!.push(row(tournament));
        selections["tournament-smallest-change"]!.push(row(least.length === 1 ? least[0]! : null)); selections["tournament-tree-order"]!.push(row(byTree));
    }
    const summarise = (rows: { selected: string | null; defect: boolean }[]) => ({ orders: rows.length, selectedDefect: rows.filter(row => row.defect).length, noWinner: rows.filter(row => row.selected === null).length, distinctSelections: new Set(rows.map(row => row.selected)).size });
    perTask.push({ task: task.id, reading: task.reading, ownCheck, finalEvaluator: final, challenges: task.challenges.map(row => ({ id: row.id, validAgainstControl: validated.includes(row.id) })), reproduced, survivors: task.candidates.filter(c => ownCheck[c.id] && !reproduced[c.id]!.length).map(c => c.id),
        changedLines: changed, single: summarise(selections.single!), vote: summarise(selections.vote!), tournament: summarise(selections.tournament!),
        tournamentSmallestChange: summarise(selections["tournament-smallest-change"]!), tournamentTreeOrder: summarise(selections["tournament-tree-order"]!) });
}
record.tasks = perTask;
const total = (policy: "single" | "vote" | "tournament" | "tournamentSmallestChange" | "tournamentTreeOrder") => perTask.reduce((sum, row) => ({ orders: sum.orders + row[policy].orders, selectedDefect: sum.selectedDefect + row[policy].selectedDefect, noWinner: sum.noWinner + row[policy].noWinner, orderSensitiveTasks: sum.orderSensitiveTasks + (row[policy].distinctSelections > 1 ? 1 : 0) }), { orders: 0, selectedDefect: 0, noWinner: 0, orderSensitiveTasks: 0 });
record.policies = { single: total("single"), vote: total("vote"), uniqueSurvivor: total("tournament"), smallestChangeThenNoWinner: total("tournamentSmallestChange"), smallestTreeId: total("tournamentTreeOrder") };
// 4. Resources per task, counted from the plan shape rather than guessed.
const candidates = 3, controls = 1;
record.resources = {
    single: { roleSessions: "1 worker + 1 judge per journey (max_sessions 2)", verificationRuns: 1 },
    tournament: { roleSessions: `${candidates} × (worker + judge) + 1 prosecutor = ${candidates * 2 + 1}`, verificationRuns: `${candidates} own checks + ${controls} control validation + ${candidates} challenge runs + 1 final evaluation = ${candidates + controls + candidates + 1}` },
    hostCommandRuns: runs, hostCommandMedianMs: Math.round(timings.sort((a, b) => a - b)[Math.floor(timings.length / 2)]! * 10) / 10,
    reading: "A three-candidate tournament costs about 3.5 times the role sessions and 8 times the verification runs of one candidate here. Contained verifiers add runtime start-up to every run.",
};
record.readings = [
    "Taking the first candidate that passes its own check ships the hard-coded answer whenever it comes first, so the result depends on branch order.",
    "A majority vote over outputs ships the shared defect: agreement between candidates is not evidence of correctness when their mistakes are correlated.",
    "A challenge validated against a trusted control and replayed on every exact candidate removes the hard-coded candidate and the shared defect. A spurious challenge fails the control and is dropped.",
    "Requiring a unique survivor never ships a defect here but never selects either: correct alternatives survive together and tie. Diff size does not separate them. Breaking a tie by tree id is arbitrary but independent of branch order, so the selection is the same for every ordering.",
    "With no survivor, selection must return no winner rather than the least-bad candidate.",
];
await mkdir(output, { recursive: true });
await writeFile(join(output, "phase6-baseline.json"), JSON.stringify(JSON.parse(JSON.stringify(record).replaceAll(scratch, "[scratch]")), null, 2) + "\n");
console.log(JSON.stringify({ currentContract: record.currentContract, policies: record.policies, resources: record.resources }, null, 2));
await rm(scratch, { recursive: true, force: true });
