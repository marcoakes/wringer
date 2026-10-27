/** Improvement release 3 (lessons, the job's research view, the pilot amendment): each
 * guard is removed alone in an isolated copy, watched red, restored and watched green.
 * Scripted roles, real Git, no model.
 *   bun scripts/improvement-phase3-reversions.ts [--check-targets] [--only NAME,NAME] */
import { runReversions, type Reversion } from "./rebuild-reversions";

const lessons = "packages/application/src/lessons.ts", lessonsTest = "packages/application/test/lessons.test.ts";
const evidence = "packages/application/src/proposer-evidence.ts", experimentCli = "packages/cli/src/experiment-cli.ts";
const proposalCli = "packages/cli/src/proposal-cli.ts", improvements = "packages/application/src/improvements.ts", jobTest = "packages/cli/test/proposal-job.test.ts";
const ledger = "scripts/capability-ledger.ts", ledgerTest = "packages/records/test/capability-ledger.test.ts";
const cases: Reversion[] = [
    // G. Lessons: only a decided, complete comparison writes one; evidence-derived, bounded, fenced.
    { name: "inconclusive-writes-no-lesson", file: lessons, before: 'if (result.eligibility === "inconclusive" || result.missingTrials.length || result.recordedTrials !== result.plannedTrials) return null;', after: "if (false) return null;", test: lessonsTest, pattern: "inconclusive comparison writes no lesson" },
    // Not probed: an incomplete denominator alone. A decided comparison with a missing trial cannot be
    // produced: a regression needs both arms of a pair, and a missing arm leaves it inconclusive (measured).
    { name: "lesson-binds-its-evaluation", file: lessons, before: "hash(lesson.experimentSha256); hash(lesson.evaluationSha256);", after: "hash(lesson.experimentSha256);", test: lessonsTest, pattern: "refuted comparison writes one lesson" },
    { name: "a-fixture-never-qualifies", file: lessons, before: 'if (lesson.outcome === "qualified" && lesson.evidenceKind !== "live") throw', after: "if (false) throw", test: lessonsTest, pattern: "refuted comparison writes one lesson" },
    { name: "served-lessons-omit-held-out-findings", file: lessons, before: '"Per-task findings stay in the operator\'s records: they name held-out tasks, which a proposer never reads.", ""].join("\\n")', after: '"## Findings", "", ...lesson.findings.map(f => `- ${f}`), ""].join("\\n")', test: lessonsTest, pattern: "refuted comparison writes one lesson" },
    { name: "evidence-reads-lessons-of-its-family", file: evidence, before: "if (lessons.length > 32 || lessons.some(l => l.repository !== plan.repository.url || l.taskFamily !== input.taskFamily)) throw", after: "if (false) throw", test: lessonsTest, pattern: "refuted comparison writes one lesson" },
    { name: "evaluate-records-the-lesson", file: experimentCli, before: 'const lesson = operation === "evaluate" ? await recordImprovementLesson(root()) : null;', after: "const lesson = null;", test: lessonsTest, pattern: "refuted comparison writes one lesson" },
    // H. The job form fences every held-out task and the view shows the research evidence.
    { name: "job-evidence-fences-held-out-tasks", file: proposalCli, before: "fence.heldOutIds.push(...(job.heldOut ?? []));", after: "", test: jobTest, pattern: "job form" },
    { name: "replicates-of-a-held-out-source-refused", file: proposalCli, before: "if (fence.heldOutIds.includes(retained.set.sourceTree)) throw", after: "if (false) throw", test: jobTest, pattern: "job form" },
    { name: "job-view-shows-research-evidence", file: improvements, before: "evidence: current ? await researchEvidence(current.link) :", after: "evidence: false ? await researchEvidence(current!.link) :", test: jobTest, pattern: "job form" },
    // Not probed here: the job page's rendering of that section, which the Chromium rehearsal checks.
    // I. The amendment is fixed by its digest and cites the registration it amends.
    { name: "amendment-fixed-by-its-digest", file: ledger, before: 'if (amendment.schema_version !== "wringer.pilot-amendment.v1" || hashValue(amendmentBody) !== amendmentSha256) problems.push(', after: "if (false) problems.push(", test: ledgerTest, pattern: "pilot amendment changed" },
    { name: "amendment-cites-the-registration", file: ledger, before: "if (amendment.amends?.sha256 !== registration.sha256) problems.push(", after: "if (false) problems.push(", test: ledgerTest, pattern: "pilot amendment changed" },
];
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1]!.split(",") : null;
if (only) for (const name of only) if (!cases.some(row => row.name === name)) throw new Error(`Unknown probe ${name}`);
const selected = only ? cases.filter(row => only.includes(row.name)) : cases;
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
if (revision.exitCode) throw new Error("Could not record source baseline");
for (const row of cases) if ((await Bun.file(row.file).text()).split(row.before).length !== 2) throw new Error(`Mutation target is absent or not unique: ${row.name}`);
if (process.argv.includes("--check-targets")) console.log(`${cases.length} improvement phase-3 isolated reversion targets`);
else await runReversions("improvement-phase3", [lessonsTest, jobTest, ledgerTest], selected, { baseline: revision.stdout.toString().trim(), evidenceDirectory: only ? "docs/improvement/evidence/phase-3/reversions-followup" : "docs/improvement/evidence/phase-3/reversions" });
