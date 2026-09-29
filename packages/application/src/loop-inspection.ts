import { hashValue, validateExecutionPlan, type ExecutionPlan } from "@wringer/plan";
import { readValidatedContainedState, type LoopDecision, type ValidatedContainedState } from "@wringer/workflow";
import { projectPmEngineering } from "./engineering-view";
import { Redactor } from "@wringer/engine";

// This display diagnostic is not a hash-bearing retained record. Leave decision
// and repair bodies unchanged so their published identities remain auditable.
function publicStopMessage(message: string, controller: string): string {
    return new Redactor([], {}, []).scrub(message).replaceAll(controller, "[controller]")
        .replace(/\/(?:Users|home|private\/var|private\/tmp|var|tmp)\/[^\s"'<>]+/g, "[private path]");
}

/** A projection of one validated journal snapshot. No command, provider call,
 * approval or active-clock sampling is performed by this reader. */
export function projectLoopInspection(input: ExecutionPlan, history: ValidatedContainedState | null = null) {
    const plan = validateExecutionPlan(input);
    if (history && hashValue(history.plan) !== hashValue(plan)) throw new Error("Loop history belongs to a different approved plan");
    const state = history?.state, authority = history?.authority;
    const allowance = (reserved: number, ceiling: number) => ({ reserved, ceiling, remaining: Math.max(0, ceiling - reserved) });
    const decisions = history?.events.filter(event => event.type === "loop-decision-recorded").map(event => (event.details as { loopDecision: LoopDecision }).loopDecision) ?? [];
    const value = {
        schema_version: "wringer.loop-inspection.v1" as const,
        planSha256: plan.plan_sha256, acceptanceSha256: plan.acceptance_sha256,
        sourceCommit: plan.repository.commit, journalRevision: history?.events.at(-1)?.sha256 ?? null,
        journeyId: state?.id ?? null, startedAt: state?.startedAt ?? null,
        status: history?.result.status ?? "not-started", stage: state?.stage ?? "not-started",
        candidate: state?.candidate ? { commit: state.candidate.source.commit, tree: state.candidate.tree } : null,
        stop: history?.result.stop ? { reason: history.result.stop.reason, message: publicStopMessage(history.result.stop.message, history.result.stop.cwd) } : null,
        budget: state && authority ? {
            sessions: allowance(state.effects.length, authority.budget.max_sessions),
            roles: (["planner", "worker", "judge"] as const).map(role => ({ role, ...allowance(state.effects.filter(effect => effect.role === role).length, authority.budget[role === "worker" ? "max_worker_turns" : role === "judge" ? "max_judge_turns" : "max_planner_turns"]) })),
            verification: allowance((state.verificationAttempts ?? []).length, authority.budget.max_sessions),
            unresolvedSessions: state.effects.filter(effect => effect.status !== "completed").length,
            unresolvedVerifications: (state.verificationAttempts ?? []).filter(effect => effect.status !== "completed").length,
            expiresAt: authority.expires_at, wallSeconds: authority.budget.wall_clock_seconds,
            tokens: history!.result.tokens, monetaryCost: null,
        } : null,
        attempts: state?.effects.map(effect => ({ id: effect.id, role: effect.role, status: effect.status, disposition: effect.disposition ?? null })) ?? [],
        decisions, repair: state?.verification?.repair ?? null,
        engineering: projectPmEngineering(plan, history) ?? null,
        limits: ["Read-only snapshot of validated observations; it grants no execution, acceptance or Send.", "Reservations include uncertain attempts. Remaining sessions are not a cash allowance; absent billing remains unknown.", "A repeated outcome warning does not establish a plateau or authorise incomplete delivery.", "Private prompts, agent narrative, provider traces, credentials and controller paths are omitted. Use a carried delivery bundle for independent semantic audit."],
    };
    if (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024) throw new Error("Loop inspection exceeds its bounded view; inspect the retained delivery evidence");
    return value;
}
export type LoopInspection = ReturnType<typeof projectLoopInspection>;
/** A profile is a template, not the compiled plan for an unresolved request. */
export async function readJobLoopInspection(plan: ExecutionPlan | null, state?: string): Promise<LoopInspection> {
    if (!plan) throw new Error("This request has no compiled job plan yet; resolve its questions and inspect the resulting proposal first");
    return readLoopInspection(plan, state);
}
export async function readLoopInspection(plan: ExecutionPlan | string, state?: string): Promise<LoopInspection> {
    const controller = typeof plan === "string" ? plan : state;
    const history = controller ? await readValidatedContainedState(controller, { allowStaleView: true }) : null;
    const value = projectLoopInspection(typeof plan === "string" ? history!.plan : plan, history);
    return value;
}
