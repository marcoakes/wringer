import { hashValue, validateExecutionPlan, type ExecutionPlan } from "@wringer/plan";
import { readValidatedContainedState, type LoopDecision, type ValidatedContainedState } from "@wringer/workflow";

/** An explanatory read model, never authority, a worker prompt or a quality score. */
export function projectPmEngineering(planInput: ExecutionPlan, history: ValidatedContainedState | null = null) {
    const plan = validateExecutionPlan(planInput);
    if (plan.schema_version !== "wringer.execution-plan.v3") return undefined;
    if (history && hashValue(history.plan) !== hashValue(plan)) throw new Error("Progress evidence belongs to a different approved plan. Refresh before deciding.");
    const selection = plan.playbook, snapshot = history?.playbook ?? null;
    const verification = history?.state.verification ?? null;
    const decisions = history?.events.filter(event => event.type === "loop-decision-recorded").map(event => (event.details as { loopDecision: LoopDecision }).loopDecision) ?? [];
    const uses = history?.events.filter(event => event.type === "playbook-used").length ?? 0;
    const adoption = selection?.adoption;
    return {
        schema_version: "wringer.pm-engineering.v1" as const,
        planSha256: plan.plan_sha256,
        ...(plan.approachAdoption ? { rollback: { action: "rollback" as const, actor: plan.approachAdoption.actor, note: plan.approachAdoption.note, at: plan.approachAdoption.at, receiptSha256: plan.approachAdoption.sha256 } } : {}),
        approach: selection ? { path: selection.path, sha256: selection.sha256, taskFamily: selection.taskFamily, title: snapshot?.manifest.title ?? null, revision: snapshot?.manifest.revision ?? null, sourceStatus: snapshot ? "validated" as const : "awaiting-validation" as const, workerUses: uses,
            adoption: adoption ? { action: adoption.action, actor: adoption.actor, note: adoption.note, at: adoption.at, receiptSha256: adoption.sha256 } : null } : null,
        checks: plan.acceptance.checks.map(check => {
            const result = verification?.checks.find(row => row.id === check.id), evidence = verification?.checkEvidence?.find(row => row.checkId === check.id);
            return { id: check.id, level: check.evidence ? "assertions" as const : "command" as const, status: !result ? "not-measured" as const : result.status === "unavailable" ? "unknown" as const : result.status,
                assertionStatus: !check.evidence ? "not-requested" as const : evidence?.status ?? "not-measured" as const,
                reason: evidence?.reason ?? (check.evidence ? "Executed assertion evidence has not been recorded for the current result." : "Command results alone do not establish executed assertions or complete requirement coverage.") };
        }),
        history: decisions.map(row => ({ sequence: row.sequence, phase: row.phase, action: row.action, reason: row.reason, candidateTree: row.candidateTree, sha256: row.sha256 })),
        limits: ["This is a read-only explanation of the selected approach and retained observations, not an approval or an instruction to an agent.", "A selected playbook is worker advice, not proof of improvement. It is not injected into the judge's instructions, but tracked source can remain readable through the repository.", "Recorded adoption is future-selection provenance, not execution permission or an independent rerun of the private comparison.", "Executed assertions are stronger evidence than command exits; neither establishes complete requirements or honest, sufficient tests.", "Repeated outcomes are observations, not a quality score. Your result decision and permission to send remain separate."]
    };
}

/** No provider calls or new operations: history is validated by the same reader
 * that governs resume and human decisions. A missing/corrupt run is not hidden. */
export async function readPmEngineering(plan: ExecutionPlan, controller?: string) {
    if (plan.schema_version !== "wringer.execution-plan.v3") return undefined;
    return projectPmEngineering(plan, controller ? await readValidatedContainedState(controller, { allowStaleView: true }) : null);
}
