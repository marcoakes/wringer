/** Improvement lessons (D-5, R-C): records, not prose. A lesson is written only when a
 * registered comparison reaches eligibility or refutation with its whole denominator
 * recorded; an inconclusive comparison writes none. It carries the prediction, the
 * held-out counts and the exact playbook difference that was tested, so the next
 * proposer can read what was tried and refuted. No model writes or edits one. */
import { lstat, readdir } from "node:fs/promises";
import { canonicalJson, hashBytes, playbookTreeDirectory } from "@wringer/plan";
import { readValidatedContainedState } from "@wringer/workflow";
import { evaluateRecordedExperiment, readExperiment, validateImprovementPrediction } from "./experiments";
import type { ExperimentResult, ImprovementPrediction } from "./experiment-types";
import { boundedText, exclusiveJson, experimentPath, hash, optionalJson, privateExperimentRoot, shape, stamped, verifyStamp } from "./experiment-store";

export interface LessonFileChange { path: string; change: "added" | "removed" | "changed"; before: string | null; after: string | null; diff: string; }
export interface ImprovementLesson {
    schema_version: "wringer.improvement-lesson.v1";
    repository: string;
    taskFamily: string;
    outcome: "qualified" | "refuted";
    experimentSha256: string;
    evaluationSha256: string;
    evidenceRevision: string;
    evidenceKind: "live" | "deterministic-fixture" | "mixed";
    prediction: ImprovementPrediction;
    heldOut: ExperimentResult["heldOut"];
    baselinePlaybook: string | null;
    candidatePlaybook: string;
    /** The tested difference, file by file, from the snapshots the trials actually used. */
    diff: LessonFileChange[];
    findings: string[];
    at: string;
    sha256: string;
}
const DIFF_BYTES = 16 * 1024;
/** A bounded line diff: unchanged lines as context, removals and additions marked. */
export function lineDiff(before: string, after: string): string {
    const a = before.split("\n"), b = after.split("\n");
    if (a.length * b.length > 4_000_000) return `(${a.length} lines before, ${b.length} after: too large to show line by line)`;
    const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    const out: string[] = []; let i = 0, j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) { out.push(` ${a[i]}`); i++; j++; }
        else if (j < b.length && (i === a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) out.push(`+${b[j++]}`);
        else out.push(`-${a[i++]}`);
    }
    const text = out.join("\n");
    return Buffer.byteLength(text) <= DIFF_BYTES ? text : `${Buffer.from(text).subarray(0, DIFF_BYTES).toString("utf8").replace(/�+$/, "")}\n…(diff truncated at 16 KiB)`;
}
type TreeFiles = Map<string, string>;
/** The playbook a trial's worker actually used, by path relative to its tree. */
async function trialPlaybook(root: string, slotId: string): Promise<TreeFiles | null> {
    try {
        const playbook = (await readValidatedContainedState(await experimentPath(root, `journeys/${slotId}`), { allowStaleView: true })).playbook;
        if (!playbook) return null;
        if (playbook.schema_version === "wringer.playbook-snapshot.v3") { const directory = playbookTreeDirectory(playbook.source.path); return new Map([["manifest.json", playbook.content], ...playbook.files.map(f => [f.path.slice(directory.length), f.content] as [string, string])]); }
        return new Map([[playbook.source.path, playbook.content]]);
    } catch { return null; }
}
function treeDiff(before: TreeFiles | null, after: TreeFiles | null): LessonFileChange[] {
    const paths = [...new Set([...(before?.keys() ?? []), ...(after?.keys() ?? [])])].sort();
    return paths.flatMap(path => {
        const a = before?.get(path) ?? null, b = after?.get(path) ?? null;
        if (a === b) return [];
        return [{ path, change: a === null ? "added" as const : b === null ? "removed" as const : "changed" as const, before: a === null ? null : hashBytes(a), after: b === null ? null : hashBytes(b), diff: lineDiff(a ?? "", b ?? "") }];
    });
}
/** Record the lesson of an evaluated comparison, once. Inconclusive or incomplete: none. */
export async function recordImprovementLesson(root: string, at = new Date().toISOString()): Promise<ImprovementLesson | null> {
    const current = await readExperiment(root), result = evaluateRecordedExperiment(current);
    if (result.eligibility === "inconclusive" || result.missingTrials.length || result.recordedTrials !== result.plannedTrials) return null;
    const retained = await optionalJson<ImprovementLesson>(root, "lesson.json");
    if (retained) {
        validateImprovementLesson(retained);
        if (retained.evaluationSha256 !== result.sha256) throw new Error("A lesson is written once; the retained one names another evaluation");
        return retained;
    }
    const slot = (arm: "baseline" | "candidate") => current.trials.find(t => t.slot.arm === arm && t.outcome !== "not-started")?.slot.id;
    const baselineSlot = slot("baseline"), candidateSlot = slot("candidate");
    const diff = treeDiff(baselineSlot ? await trialPlaybook(root, baselineSlot) : null, candidateSlot ? await trialPlaybook(root, candidateSlot) : null);
    const kinds = new Set(current.trials.map(t => t.evidenceKind));
    const lesson = stamped({ schema_version: "wringer.improvement-lesson.v1" as const, repository: current.plan.repository, taskFamily: current.plan.taskFamily, outcome: result.eligibility === "eligible" ? "qualified" as const : "refuted" as const, experimentSha256: current.plan.sha256, evaluationSha256: result.sha256, evidenceRevision: result.evidenceRevision, evidenceKind: kinds.size > 1 ? "mixed" as const : kinds.has("live-contained") ? "live" as const : "deterministic-fixture" as const, prediction: current.plan.prediction, heldOut: result.heldOut, baselinePlaybook: current.plan.baselinePlaybook, candidatePlaybook: current.plan.candidatePlaybook, diff, findings: result.findings.slice(0, 32).map(f => f.slice(0, 2000)), at });
    validateImprovementLesson(lesson);
    await exclusiveJson(root, "lesson.json", lesson);
    return lesson;
}
export function validateImprovementLesson(lesson: ImprovementLesson): ImprovementLesson {
    verifyStamp(lesson);
    shape(lesson, ["schema_version", "repository", "taskFamily", "outcome", "experimentSha256", "evaluationSha256", "evidenceRevision", "evidenceKind", "prediction", "heldOut", "baselinePlaybook", "candidatePlaybook", "diff", "findings", "at", "sha256"], "Improvement lesson");
    if (lesson.schema_version !== "wringer.improvement-lesson.v1" || !["qualified", "refuted"].includes(lesson.outcome) || !["live", "deterministic-fixture", "mixed"].includes(lesson.evidenceKind)) throw new Error("Unsupported improvement lesson");
    hash(lesson.experimentSha256); hash(lesson.evaluationSha256); hash(lesson.evidenceRevision); hash(lesson.candidatePlaybook);
    if (lesson.baselinePlaybook !== null) hash(lesson.baselinePlaybook);
    if (lesson.outcome === "qualified" && lesson.evidenceKind !== "live") throw new Error("Only live trials can qualify; a fixture lesson is a refutation or nothing");
    boundedText(lesson.repository, "Lesson repository", 2048); boundedText(lesson.taskFamily, "Lesson task family", 64);
    validateImprovementPrediction(lesson.prediction);
    if (!Array.isArray(lesson.diff) || lesson.diff.length > 128 || !Array.isArray(lesson.findings) || lesson.findings.length > 32 || !Number.isFinite(Date.parse(lesson.at))) throw new Error("A lesson is bounded and dated");
    return lesson;
}
/** Lessons of every connected comparison for one repository and task family, oldest first, at most 32. */
export async function readImprovementLessons(researchRoot: string, scope: { repository: string; taskFamily: string }): Promise<ImprovementLesson[]> {
    await privateExperimentRoot(researchRoot);
    const directory = await experimentPath(researchRoot, "experiments");
    let names: string[];
    try { names = await readdir(directory); } catch (error: any) { if (error.code === "ENOENT") return []; throw error; }
    const lessons: ImprovementLesson[] = [];
    for (const name of names.sort().slice(0, 64)) {
        const path = await experimentPath(researchRoot, `experiments/${name}`);
        if (!(await lstat(path)).isDirectory()) continue;
        const lesson = await optionalJson<ImprovementLesson>(path, "lesson.json");
        if (lesson && validateImprovementLesson(lesson).repository === scope.repository && lesson.taskFamily === scope.taskFamily) lessons.push(lesson);
    }
    return lessons.sort((a, b) => a.at.localeCompare(b.at) || a.sha256.localeCompare(b.sha256)).slice(0, 32);
}
/** The evidence tree's LESSONS/ files: qualified and refuted, oldest first. */
export function lessonFiles(lessons: ImprovementLesson[]): { path: string; content: string }[] {
    if (!lessons.length) return [{ path: "LESSONS/NONE.md", content: "No qualified or refuted improvement lessons are recorded for this task family yet.\n" }];
    return lessons.map((lesson, index) => ({ path: `LESSONS/${String(index + 1).padStart(2, "0")}-${lesson.outcome}.md`, content: [`# Lesson ${index + 1}: ${lesson.outcome}`, "", `A registered comparison (${lesson.evidenceKind}) tested this change and found it ${lesson.outcome === "qualified" ? "helped by its predeclared rule" : "did not help, or regressed"}.`, "", `Prediction: ${lesson.prediction.statement} (${lesson.prediction.metric}, at least ${lesson.prediction.minimumImprovement}).`, `Held-out: ${lesson.heldOut.pairs} pairs over ${lesson.heldOut.independentTasks} tasks; ${lesson.heldOut.improvements} better, ${lesson.heldOut.regressions} worse, ${lesson.heldOut.ties} tied; sign probability ${lesson.heldOut.signProbability ?? "unknown"}.`, `Baseline playbook ${lesson.baselinePlaybook ?? "none"}; candidate ${lesson.candidatePlaybook}.`, "", "## What was tested", "", ...(lesson.diff.length ? lesson.diff.flatMap(change => [`### ${change.path} (${change.change})`, "", "```diff", change.diff, "```", ""]) : ["The trials' playbook bytes were not retained; only the digests above are known.", ""]), "Per-task findings stay in the operator's records: they name held-out tasks, which a proposer never reads.", ""].join("\n") }));
}
export const lessonDigest = (lessons: ImprovementLesson[]) => hashBytes(canonicalJson(lessons.map(l => l.sha256)));
