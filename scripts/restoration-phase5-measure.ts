/** Phase 5 measure-first (bun scripts/restoration-phase5-measure.ts OUTPUT): what gate and workflow proposals need that the current
 * playbook-only comparison cannot express. Real Git corpus, real gate commands on
 * exported trees, a frozen label oracle. No model, container or network. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileExecutionPlan, compileDeclaration } from "../packages/plan/src";
import { createExperimentPlan } from "../packages/application/src";

const output = resolve(process.argv[2] ?? "build/restoration/phase-5/measurements"), scratch = await mkdtemp(join(tmpdir(), "wringer-phase5-measure-"));
const run = (argv: string[], cwd?: string) => { const r = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe", env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }); return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString() }; };
const git = (args: string[], cwd?: string) => { const r = run(["git", "-c", "user.name=Phase 5 measurement", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], cwd); if (r.code) throw new Error(r.err); return r.out; };
const record: Record<string, unknown> = { schema_version: "wringer.restoration-phase5-measurement.v1", kind: "deterministic: real Git corpus and real gate commands on exported trees; labels are the frozen oracle", git: git(["--version"]) };

// 1. The current comparison contract refuses any change to checks or grader.
const template = compileExecutionPlan(await Bun.file("packages/plan/examples/contained.yaml").text(), { format: "yaml" });
const { schema_version, plan_sha256, acceptance_sha256, intent_sha256, ...raw } = template;
const baseline = compileDeclaration({ version: 3, ...raw, acceptance: { ...raw.acceptance, criteria: raw.acceptance.criteria.filter(row => row.kind === "check") } });
const stricter = compileDeclaration({ version: 3, ...raw, acceptance: { ...raw.acceptance, criteria: raw.acceptance.criteria.filter(row => row.kind === "check"), checks: [...raw.acceptance.checks, { id: "property", argv: ["bun", "test", "tests/property.test.ts"], cwd: ".", timeout_seconds: 120, criteria: ["total"], files: ["tests/property.test.ts"] }] } });
const declaration = (candidate: typeof baseline) => ({ id: "gate-change", taskFamily: "totals", repository: baseline.repository.url, baselinePlaybook: null, candidatePlaybook: "a".repeat(64), changedVariable: "worker-playbook", tasks: [{ id: "task", sourceTree: "b".repeat(40), split: "held-out", baseline, candidate }], repetitions: 1, order: "alternating-pairs", stratum: { platform: "darwin", modelSelection: "pinned", adapterSelection: "pinned" }, prediction: { statement: "A stricter gate improves completion", metric: "functional-completion", minimumImprovement: 1, minimumHeldOutPairs: 1, maximumSignProbability: 0.5, visualQualityClaim: false }, limits: { maxTrials: 2, maxRoleSessions: 32, wallClockSeconds: 3600 }, dataScope: "this-repository-only", holdout: { corpusId: "corpus", candidateIteration: 1, maximumCandidateIterations: 1, candidateAuthorSawHeldOutSolutions: false }, accounting: "all-planned-trials-including-failures", stoppingRule: "fixed-sample-no-extension" });
const refusal = (input: unknown) => { try { createExperimentPlan(input as any); return "accepted"; } catch (error) { return (error as Error).message; } };
record.playbookContract = { gateChange: refusal(declaration(stricter)), variableNamed: refusal({ ...declaration(stricter), changedVariable: "acceptance-gate" }), reading: "The only comparable variable is the worker playbook; check, grader and plan structure must be identical, so a gate or workflow proposal cannot be registered or evaluated today." };

// 2. A labelled corpus: a buggy base, seeded defects and correct controls, each a commit.
const repo = join(scratch, "corpus"); await mkdir(join(repo, "src"), { recursive: true }); git(["init", "-q", "-b", "main", repo]);
const write = (path: string, text: string) => writeFile(join(repo, path), text);
await write("src/total.sh", "#!/bin/sh\necho $(( $1 + $2 + 1 ))\n"); git(["add", "."], repo); git(["commit", "-q", "-m", "Buggy base: total is off by one"], repo);
const base = git(["rev-parse", "HEAD"], repo);
const variants: { id: string; label: "defect" | "control"; split: "development" | "held-out"; body: string }[] = [
    { id: "correct-sum", label: "control", split: "development", body: "echo $(( $1 + $2 ))" },
    { id: "correct-expr", label: "control", split: "held-out", body: "expr \"$1\" + \"$2\"" },
    { id: "correct-awk", label: "control", split: "held-out", body: "awk -v a=\"$1\" -v b=\"$2\" 'BEGIN { print a + b }'" },
    { id: "tautology-two-three", label: "defect", split: "development", body: "echo 5" },
    { id: "tautology-held-out", label: "defect", split: "held-out", body: "if [ \"$1\" = 2 ]; then echo 5; else echo $(( $1 + $2 + 1 )); fi" },
    { id: "sign-flip", label: "defect", split: "held-out", body: "echo $(( $1 - $2 ))" },
    { id: "unchanged-bug", label: "defect", split: "held-out", body: "echo $(( $1 + $2 + 1 ))" },
];
const commits: Record<string, string> = {};
for (const variant of variants) { git(["checkout", "-q", base], repo); await write("src/total.sh", `#!/bin/sh\n${variant.body}\n`); git(["commit", "-q", "--allow-empty", "-am", variant.id], repo); commits[variant.id] = git(["rev-parse", "HEAD"], repo); }
// 3. Gates: the narrow existing check, a weakened check, a noisy check and a useful property check.
const gates: Record<string, string> = {
    narrow: "test \"$(sh src/total.sh 2 3)\" = 5",
    weakened: "sh src/total.sh 2 3 >/dev/null",
    noisy: "test \"$(sh src/total.sh 2 3)\" = 5 && grep -q '\\$((' src/total.sh",
    property: "for a in 0 2 7 11; do for b in 0 3 5; do test \"$(sh src/total.sh $a $b)\" = $(( a + b )) || exit 1; done; done",
};
const results: Record<string, Record<string, { passed: boolean; ms: number }>> = {};
for (const [gate, script] of Object.entries(gates)) {
    results[gate] = {};
    for (const variant of variants) {
        const work = await mkdtemp(join(scratch, "tree-")); const exported = run(["/bin/sh", "-c", `git -C '${repo}' archive ${commits[variant.id]} | tar -x -C '${work}'`]); if (exported.code) throw new Error(exported.err);
        const started = performance.now(), r = run(["/bin/sh", "-c", script], work);
        results[gate]![variant.id] = { passed: r.code === 0, ms: Math.round((performance.now() - started) * 10) / 10 };
    }
}
const score = (gate: string, split?: string) => { const rows = variants.filter(v => !split || v.split === split); return { caught: rows.filter(v => v.label === "defect" && !results[gate]![v.id]!.passed).length, missed: rows.filter(v => v.label === "defect" && results[gate]![v.id]!.passed).length, falsePositives: rows.filter(v => v.label === "control" && !results[gate]![v.id]!.passed).length, passRate: rows.filter(v => results[gate]![v.id]!.passed).length / rows.length }; };
record.corpus = { items: variants.map(v => ({ id: v.id, label: v.label, split: v.split })), defects: variants.filter(v => v.label === "defect").length, controls: variants.filter(v => v.label === "control").length };
record.gates = Object.fromEntries(Object.keys(gates).map(gate => [gate, { all: score(gate), heldOut: score(gate, "held-out"), perItem: results[gate] }]));
record.readings = [
    "The weakened gate passes every item: the highest pass rate and the fewest caught defects. A pass rate cannot judge a gate; the oracle's labels can.",
    "The noisy gate catches defects but fails correct controls that use another valid implementation; false positives only show on controls.",
    "The property gate catches every seeded defect without failing a control on the held-out split.",
    "The narrow existing gate passes the tautology written for its one example; its own pass rate would call that change correct.",
];
await mkdir(output, { recursive: true });
await writeFile(join(output, "phase5-baseline.json"), JSON.stringify(JSON.parse(JSON.stringify(record).replaceAll(scratch, "[scratch]")), null, 2) + "\n");
console.log(JSON.stringify({ playbookContract: record.playbookContract, gates: Object.fromEntries(Object.entries(record.gates as any).map(([k, v]: any) => [k, { all: v.all, heldOut: v.heldOut }])) }, null, 2));
await rm(scratch, { recursive: true, force: true });
