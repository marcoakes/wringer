/** Phase A baselines, $0 and no model:
 *  1. what today's playbook proposer is given: prompt bytes, failure-pattern bytes and
 *     groups, and trajectory bytes (zero), captured from the real prompt builder with a
 *     capturing fixture executor;
 *  2. the cost of an evaluator-owned overlay commit plus bundle and fresh clone (the
 *     trusted-local route) for a 200-file tree with an 8-file overlay.
 *   bun scripts/improvement-phase-a-baselines.ts OUTPUT.json */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDeclaration, compileExecutionPlan, hashBytes, hashValue } from "../packages/plan/src";
import { createLocalSourceBundle, prepareRepositorySource, type RoleExecutionRequest, type RoleExecutionResult } from "../packages/runtime/src";
import { createPlaybookProposalRequest, proposePlaybookImprovement } from "../packages/application/src/experiment-collect";
import { stamped } from "../packages/application/src/experiment-store";

const output = process.argv[2];
if (!output) throw new Error("Usage: bun scripts/improvement-phase-a-baselines.ts OUTPUT.json");
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
function git(cwd: string, args: string[], input?: string, env: Record<string, string | undefined> = {}) {
    const run = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd, env: { ...ENV, ...env }, stdin: input === undefined ? "ignore" : Buffer.from(input) });
    if (run.exitCode) throw new Error(`git ${args[0]}: ${run.stderr.toString()}`);
    return run.stdout.toString().trim();
}
const scratch = await mkdtemp(join(tmpdir(), "wringer-phase-a-"));
const privateDir = async (name: string) => { const path = join(scratch, name); await mkdir(path, { recursive: true, mode: 0o700 }); return path; };
try {
    // 1. Today's proposer input, from the real request builder and prompt.
    const template = compileExecutionPlan(await readFile(new URL("../packages/plan/examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
    const source = await privateDir("source"); git(source, ["init", "-q"]);
    await mkdir(join(source, "wringer/playbooks"), { recursive: true }); await mkdir(join(source, "wringer/proposals"), { recursive: true }); await mkdir(join(source, "tests"));
    const manifest = { schema_version: "wringer.playbook.v1" as const, id: "reports", revision: "one", title: "Reports fixture", role: "worker" as const, applicability: { taskFamily: "reports", context: [], tools: [], checks: [], scope: ["src"], design: false }, guidanceMarkdown: "Inspect the retained failure before changing code. Keep the change inside the approved scope.", limits: ["Advisory worker guidance only."], evaluationRefs: [] };
    const content = JSON.stringify(manifest) + "\n", path = "wringer/playbooks/baseline.json", outputPath = "wringer/proposals/reports-next.json";
    await writeFile(join(source, path), content); await writeFile(join(source, outputPath), "{}\n"); await writeFile(join(source, "README.md"), "Fixture only\n");
    for (const file of template.acceptance.checks.flatMap(c => c.files)) { await mkdir(join(source, file, ".."), { recursive: true }); await writeFile(join(source, file), "fixture\n"); }
    git(source, ["add", "."]); git(source, ["commit", "-qm", "fixture baseline"]);
    const commit = git(source, ["rev-parse", "HEAD"]), blob = git(source, ["rev-parse", `${commit}:${path}`]);
    const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...base } = template;
    const plan = compileDeclaration({ version: 3, ...base, repository: { ...base.repository, commit }, scope: { writable: [outputPath] } } as any);
    const snapshotBase = { schema_version: "wringer.playbook-snapshot.v1" as const, source: { repository: plan.repository, path, blob }, content, manifest, sha256: hashBytes(content) }, baseline = { ...snapshotBase, snapshot_sha256: hashValue(snapshotBase) };
    const prediction = { statement: "Fewer worker attempts on held-out report tasks.", metric: "worker-attempts" as const, minimumImprovement: 1, minimumHeldOutPairs: 4, maximumSignProbability: 0.05, visualQualityClaim: false };
    const measures = [];
    for (const groupCount of [1, 8, 32]) {
        const groups = Array.from({ length: groupCount }, (_, i) => ({ comparisonKey: hashValue({ i, k: "key" }), kind: (["product-check", "agent-finding", "environment"] as const)[i % 3]!, requirementIds: [`requirement-${i % 5}`], count: 1 + (i % 4), observations: Array.from({ length: 1 + (i % 4) }, (_, j) => hashValue({ i, j })) }));
        const patterns = stamped({ schema_version: "wringer.failure-pattern-report.v1" as const, repository: plan.repository.url, taskFamily: "reports", sources: [hashValue({ source: 1 })], groups, limits: ["Structured outcomes only."] });
        const request = createPlaybookProposalRequest({ plan, baseline: baseline as any, patterns, outputPath, prediction, actor: "Phase A measurement", grantedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), maxSessions: 1, maxTurns: 1, wallClockSeconds: 30, credentialNames: plan.agents.worker.env ?? [], dataScope: "this-repository-only", action: "propose-one-worker-playbook" });
        let prompt = "";
        const executor = async (r: RoleExecutionRequest): Promise<RoleExecutionResult> => { prompt = r.prompt; throw new Error("Measurement captures the prompt only; no model was called"); };
        const state = await privateDir(`state-${groupCount}`);
        await proposePlaybookImprovement(state, request, { fixtureExecutor: executor, fixtureSource: async (p, controllerDir) => { const bundlePath = join(await privateDir(`bundle-${groupCount}`), "source.bundle"); await createLocalSourceBundle(source, p.repository.commit, bundlePath); return prepareRepositorySource({ ...p.repository, bundlePath }, { controllerDir }); } });
        measures.push({ groups: groupCount, promptBytes: Buffer.byteLength(prompt), manifestBytes: Buffer.byteLength(JSON.stringify(manifest)), patternsBytes: Buffer.byteLength(JSON.stringify(patterns)), predictionBytes: Buffer.byteLength(JSON.stringify(prediction)), trajectoryBytes: 0, producedOutputBytes: 0, priorProposalBytes: 0, fileOutputs: 1 });
    }
    // 2. Overlay commit + bundle + fresh clone, 200 tracked files, 8 overlay files.
    const repo = await privateDir("overlay-repo"); git(repo, ["init", "-q", "--initial-branch=main"]);
    for (let i = 0; i < 200; i++) { const dir = join(repo, "src", `module-${i % 20}`); await mkdir(dir, { recursive: true }); await writeFile(join(dir, `file-${i}.ts`), `export const value${i} = ${i};\n`.repeat(20)); }
    git(repo, ["add", "."]); git(repo, ["commit", "-qm", "base"]);
    const baseCommit = git(repo, ["rev-parse", "HEAD"]), store = join(repo, ".git");
    const overlay = Array.from({ length: 8 }, (_, i) => ({ path: i === 0 ? "CLAUDE.md" : `.claude/skills/skill-${i}/SKILL.md`, content: `---\ndescription: measurement skill ${i}\n---\n${"Guidance line.\n".repeat(40)}` }));
    const timings: { overlayMs: number; bundleMs: number; cloneMs: number }[] = [];
    for (let run = 0; run < 7; run++) {
        const index = join(scratch, `index-${run}`), t0 = performance.now();
        git(repo, ["--git-dir", store, "read-tree", baseCommit], undefined, { GIT_INDEX_FILE: index });
        for (const file of overlay) { const object = git(repo, ["--git-dir", store, "hash-object", "-w", "--stdin"], file.content); git(repo, ["--git-dir", store, "update-index", "--add", "--cacheinfo", `100644,${object},${file.path}`], undefined, { GIT_INDEX_FILE: index }); }
        const tree = git(repo, ["--git-dir", store, "write-tree"], undefined, { GIT_INDEX_FILE: index }), overlayCommit = git(repo, ["--git-dir", store, "commit-tree", tree, "-p", baseCommit, "-m", "overlay"]);
        git(repo, ["--git-dir", store, "update-ref", `refs/heads/overlay-${run}`, overlayCommit]);
        const t1 = performance.now(), bundle = join(scratch, `overlay-${run}.bundle`);
        git(repo, ["--git-dir", store, "bundle", "create", bundle, `refs/heads/overlay-${run}`]);
        const t2 = performance.now(), clone = join(scratch, `clone-${run}`);
        git(scratch, ["clone", "-q", "--no-hardlinks", bundle, clone]); git(clone, ["checkout", "-q", overlayCommit]);
        timings.push({ overlayMs: t1 - t0, bundleMs: t2 - t1, cloneMs: performance.now() - t2 });
    }
    const median = (key: keyof (typeof timings)[number]) => [...timings.map(t => t[key])].sort((a, b) => a - b)[Math.floor(timings.length / 2)]!;
    const record = { schema_version: "wringer.phase-a-baselines.v1", measuredAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, proposerInput: measures,
        overlay: { trackedFiles: 200, overlayFiles: 8, runs: timings.length, medianMs: { overlay: Math.round(median("overlayMs")), bundle: Math.round(median("bundleMs")), clone: Math.round(median("cloneMs")) } },
        limits: ["Proposer figures come from the real request builder and prompt with synthetic failure-pattern reports; no model was called.", "Overlay timings are local wall-clock medians on this machine, git subprocess per step as the tournament helper does; not a contained-runtime measurement."] };
    await writeFile(output, JSON.stringify(record, null, 2) + "\n");
    console.log(JSON.stringify(record, null, 1));
} finally { await rm(scratch, { recursive: true, force: true }); }
