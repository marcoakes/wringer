import type { ExecutionPlan } from "@wringer/plan";
import type { ContainedJourneyResult } from "@wringer/workflow";

/** Shared requirement facts for the PM board and assistant. Neither view owns
 * acceptance policy; observations must bind the same verified candidate. */
export function projectRequirements(plan: ExecutionPlan, result: ContainedJourneyResult) {
    return plan.acceptance.criteria.map(criterion => {
        const checkIds = plan.acceptance.checks.filter(check => check.criteria.includes(criterion.id)).map(check => check.id);
        const human = result.humanJudgements.find(row => row.criterionId === criterion.id && row.candidateTree === result.candidate?.tree && row.acceptanceSha256 === plan.acceptance_sha256);
        const judgement = result.judge?.criteria.find(row => row.id === criterion.id);
        const checks = checkIds.map(id => result.verification?.checks.find(c => c.id === id));
        const valid = !!result.candidate && result.verification?.candidateTree === result.candidate.tree;
        const state = criterion.kind === "human" ? human?.verdict === "met" ? "met" : human?.verdict === "not_met" ? "not-met" : "unknown" : valid && checks.length > 0 && checks.every(c => c?.status === "passed") && judgement?.met === true ? "met" : valid && (checks.some(c => c?.status === "failed") || judgement?.met === false) ? "not-met" : "unknown";
        return { id: criterion.id, title: criterion.title, kind: criterion.kind, required: criterion.required, state: state as "met" | "not-met" | "unknown", checkIds, note: criterion.kind === "human" ? human?.note ?? null : judgement?.reason ?? null, by: criterion.kind === "human" ? human?.by ?? null : judgement ? "Independent agent review" : null };
    });
}
