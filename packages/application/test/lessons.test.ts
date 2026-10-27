/** Lessons (D-5, R-C): a refuted or qualified comparison with its whole denominator
 * writes one evidence-derived record, with the exact playbook difference it tested; an
 * inconclusive one writes none. Real Git tree journeys, scripted agents. */
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDeclaration, discoverEnvironment, type ExecutionPlan } from "@wringer/plan";
import { buildProposerEvidence, collectExperiment, createExperimentGrant, DEFAULT_DENY_GLOBS, readExperiment, registerExperiment, type ExperimentPlanInput } from "../src";
import { experimentCommand } from "../../cli/src/experiment-cli";
import { parseArgs } from "../../cli/src/args";
import { lessonFiles, readImprovementLessons, recordImprovementLesson, validateImprovementLesson } from "../src/lessons";
import { optionalJson, stamped } from "../src/experiment-store";
import { runAndValidateTreeJourney, treeWorld } from "../../workflow/fixtures/playbook-tree-journey";
import { openReader } from "../../records/src/read";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const reader = await openReader(new URL("../../../schema", import.meta.url).pathname);
async function privateDir(prefix: string) { const path = await mkdtemp(join(tmpdir(), prefix)); await chmod(path, 0o700); roots.push(path); return path; }

/** One task, both arms at one commit; the candidate's checks fail `candidateFailures` times. */
async function comparison(candidateFailures: number) {
    const world = await treeWorld(); roots.push(world.root, world.repo);
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, playbook, ...raw } = world.plan;
    const baseline = compileDeclaration({ version: 6, ...raw } as any), candidate = world.plan;
    const environments = new Map([[baseline.plan_sha256, await discoverEnvironment(world.repo, baseline)], [candidate.plan_sha256, world.environment]]);
    const input: ExperimentPlanInput = { id: "repair-first-test", taskFamily: "total", repository: baseline.repository.url, baselinePlaybook: null, candidatePlaybook: candidate.playbook!.sha256, changedVariable: "worker-playbook", tasks: [{ id: "total-1", sourceTree: world.environment.source_tree, split: "held-out", baseline, candidate }], repetitions: 1, order: "alternating-pairs", stratum: { platform: "darwin", modelSelection: "Scripted fixture", adapterSelection: "Scripted fixture" }, prediction: { statement: "SCRIPTED: one fewer worker attempt without a lost requirement.", metric: "worker-attempts", minimumImprovement: 1, minimumHeldOutPairs: 4, maximumSignProbability: 0.05, visualQualityClaim: false }, limits: { maxTrials: 2, maxRoleSessions: 24, wallClockSeconds: 1800 }, dataScope: "this-repository-only", holdout: { corpusId: "total-unseen", candidateIteration: 1, maximumCandidateIterations: 2, candidateAuthorSawHeldOutSolutions: false }, accounting: "all-planned-trials-including-failures", stoppingRule: "fixed-sample-no-extension" };
    const research = await privateDir("wringer-lessons-research-"), state = join(research, "experiments", "repair-first-test");
    await mkdir(state, { recursive: true, mode: 0o700 });
    await registerExperiment(state, input);
    const grant = createExperimentGrant((await readExperiment(state)).plan, { actor: "Fixture operator", expiresAt: new Date(Date.now() + 3600000).toISOString(), credentialNames: [...(baseline.runtime.env ?? [])] });
    await collectExperiment(state, grant, { fixture: { run: (plan: ExecutionPlan, journey, g) => runAndValidateTreeJourney({ bundlePath: world.bundlePath, environment: environments.get(plan.plan_sha256)! }, plan, journey, { actor: `Experiment: ${g.actor}`, failures: plan.playbook ? candidateFailures : 0 }) } });
    return { research, state, repository: baseline.repository.url, baseline };
}

test("a refuted comparison writes one lesson with the tested difference; the next proposer reads it", async () => {
    const f = await comparison(99);
    // The public evaluate records it; the API then returns the same record, never a second one.
    const evaluated = await experimentCommand(parseArgs(["experiment", "evaluate", "--state", f.state]), f.state);
    expect(evaluated.text).toContain("Lesson recorded: refuted (deterministic-fixture)");
    const lesson = (await recordImprovementLesson(f.state))!;
    expect(lesson.outcome).toBe("refuted"); expect(lesson.evidenceKind).toBe("deterministic-fixture");
    expect(lesson.diff.map(change => [change.path, change.change])).toEqual([["CLAUDE.md", "added"], ["NOTES.md", "added"], ["manifest.json", "added"], ["scripts/inspect.sh", "added"], ["skills/repair-first/SKILL.md", "added"]]);
    expect(lesson.diff.find(change => change.path === "CLAUDE.md")!.diff).toContain("+Before editing, use the repair-first skill");
    expect((await reader.validate(lesson, "improvement-lesson-v1.schema.json")).ok).toBe(true);
    expect(await recordImprovementLesson(f.state)).toEqual(lesson);
    expect(await readImprovementLessons(f.research, { repository: f.repository, taskFamily: "total" })).toEqual([lesson]);
    expect(await readImprovementLessons(f.research, { repository: f.repository, taskFamily: "reports" })).toEqual([]);
    const files = lessonFiles([lesson]);
    expect(files[0]!.path).toBe("LESSONS/01-refuted.md"); expect(files[0]!.content).toContain("did not help, or regressed");
    // Findings name held-out tasks; a proposer never reads them.
    expect(lesson.findings.join(" ")).toContain("total-1"); expect(files[0]!.content).not.toContain("total-1");
    const journeys = [{ label: "journey-01", state: join(f.state, "journeys", "total-1-1-baseline") }], fence = { heldOutIds: [], oracleDigests: [], denyGlobs: [...DEFAULT_DENY_GLOBS] };
    const served = await buildProposerEvidence({ plan: f.baseline, taskFamily: "total", journeys, baseline: null, lessons: [lesson], fence });
    expect(served.record.lessons).toEqual([lesson.sha256]); expect(served.files.map(file => file.path)).toContain("wringer/evidence/LESSONS/01-refuted.md");
    await expect(buildProposerEvidence({ plan: f.baseline, taskFamily: "reports", journeys, baseline: null, lessons: [lesson], fence })).rejects.toThrow("all of this repository and task family");
    expect(lessonFiles([])[0]!.path).toBe("LESSONS/NONE.md");
    const { sha256, ...body } = lesson;
    expect(() => validateImprovementLesson(stamped({ ...body, evaluationSha256: "" }) as any)).toThrow("An exact SHA");
    expect(() => validateImprovementLesson(stamped({ ...body, outcome: "qualified" as const }))).toThrow("Only live trials can qualify");
}, 600000);

test("an inconclusive comparison writes no lesson", async () => {
    const f = await comparison(0);
    expect(await recordImprovementLesson(f.state)).toBeNull();
    expect(await optionalJson(f.state, "lesson.json")).toBeNull();
}, 600000);
