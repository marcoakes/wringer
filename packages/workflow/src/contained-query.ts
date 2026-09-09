import { resolve } from "node:path";
import { validateExecutionAuthority } from "@wringer/plan";
import { readValidatedContainedState, type ValidatedContainedState } from "./contained";
import type { ContainedJourneyResult } from "./contained-types";
import { workflowLockStatus } from "./storage";

export type ContainedActionId = "resume" | "retry-verification" | "retry-judge" | "retry-stopped" | "retry-uncertain" | "show" | "review" | "request-revision" | "deliver";
export interface ContainedJourneyProjection {
    schema_version: "wringer.contained-query.v1";
    revision: string;
    journeyId: string;
    status: "running" | ContainedJourneyResult["status"];
    stage: string;
    candidateTree: string | null;
    stop: ContainedJourneyResult["stop"];
    budget: {
        sessions: { reserved: number; ceiling: number };
        roles: { role: "planner" | "worker" | "judge"; reserved: number; ceiling: number }[];
        verificationAttempts: { reserved: number; ceiling: number; unknown: number };
        wallClock: { elapsedSeconds: number; ceilingSeconds: number; expired: boolean };
        tokens: ContainedJourneyResult["tokens"];
    };
    effects: { id: string; role: string; transport: string; disposition: string }[];
    actions: { id: ContainedActionId; enabled: boolean; reason: string }[];
    result: ContainedJourneyResult;
}

type ReviewHistory = Pick<ValidatedContainedState, "plan" | "authority" | "state">;
/** Source eligibility shared by every display/review surface. It grants no verdict. */
export function containedHumanReviewEligibility({ plan, authority, state }: ReviewHistory, criterionId?: string): { enabled: boolean; reason: string } {
    if (!["human", "ready"].includes(state.stage))
        return { enabled: false, reason: "A human review requires the current independently verified candidate at its human hold. Independent review must finish before a display can invite your judgement." };
    const candidate = state.candidate, verification = state.verification;
    if (!candidate || verification?.status !== "passed" || verification.candidateTree !== candidate.tree || verification.candidateCommit !== candidate.source.commit || verification.acceptanceSha256 !== plan.acceptance_sha256)
        return { enabled: false, reason: "There is no exact verified candidate to show or judge." };
    if (plan.acceptance.criteria.some(c => c.kind === "check" && c.required && state.judge?.criteria.find(finding => finding.id === c.id)?.met !== true))
        return { enabled: false, reason: "Independent review has not established every required checked requirement. No human judgement can be invited yet." };
    const criteria = plan.acceptance.criteria.filter(c => c.kind === "human" && (criterionId === undefined || c.id === criterionId));
    if (!criteria.some(c => c.show)) return { enabled: false, reason: "Name a declared human criterion with a display command." };
    try { validateExecutionAuthority(authority, plan); }
    catch { return { enabled: false, reason: "The execution approval is out of date; no display or human judgement is authorized." }; }
    if (Date.now() - Date.parse(state.startedAt) >= authority.budget.wall_clock_seconds * 1000)
        return { enabled: false, reason: "The whole-journey wall clock is exhausted; no display or human judgement is authorized." };
    return { enabled: true, reason: "Review the exact candidate at its human hold; a successful display and your own observation are still required." };
}
export function assertContainedHumanReviewEligible(history: ReviewHistory, criterionId?: string): void {
    const eligibility = containedHumanReviewEligibility(history, criterionId);
    if (!eligibility.enabled) throw new Error(eligibility.reason);
}

/** One read-only projection for every frontend. No view or command string grants authority. */
export async function queryContainedJourney(stateDir: string): Promise<ContainedJourneyProjection> {
    const { state, result, plan, authority, events } = await readValidatedContainedState(resolve(stateDir), { allowStaleView: true });
    const last = events.at(-1)!, elapsedSeconds = Math.max(0, (Date.now() - Date.parse(state.startedAt)) / 1000);
    const expired = elapsedSeconds >= authority.budget.wall_clock_seconds;
    let authorityError = "";
    try { validateExecutionAuthority(authority, plan); } catch (error) { authorityError = String(error); }
    const reason = result.stop?.reason, lock = await workflowLockStatus(resolve(stateDir), "contained-journey"), running = lock === "held" || lock === "unknown";
    const roleLimit = (role: "worker" | "judge" | "planner") => authority.budget[role === "worker" ? "max_worker_turns" : role === "judge" ? "max_judge_turns" : "max_planner_turns"];
    const roleProblem = (role: "worker" | "judge" | "planner") => !authority.actions.includes(role === "worker" ? "build" : role === "planner" ? "plan" : "judge") ? `The current approval does not allow ${role} work.` : state.effects.length >= authority.budget.max_sessions ? "The total agent-session budget is exhausted; continuing cannot grant more sessions." : state.effects.filter(e => e.role === role).length >= roleLimit(role) ? `The ${role} attempt budget is exhausted; continuing cannot grant another attempt.` : "";
    const roleRemaining = (role: "worker" | "judge" | "planner") => !roleProblem(role);
    const attempts = state.verificationAttempts ?? [];
    const verificationProblem = !authority.actions.includes("verify") ? "The current approval does not allow verification." : attempts.length >= authority.budget.max_sessions ? "The verification-attempt budget is exhausted; continuing cannot grant another attempt." : "";
    const stoppedRole = state.stage === "judge" ? "judge" : state.stage === "planner" ? "planner" : "worker";
    const effect = state.stage === "planner" ? state.effects.findLast(e => e.role === "planner") : ["worker", "capture", "judge"].includes(state.stage) ? state.effects.find(e => e.id === (state.stage === "judge" ? state.judgeEffect : state.workerEffect)) : undefined;
    const phase = state.stage === "baseline" ? "baseline" : state.stage === "verify" ? "candidate" : null;
    const sourceCommit = phase === "baseline" ? state.source?.commit : state.candidate?.source.commit;
    const verification = attempts.findLast(a => a.phase === phase && a.sourceCommit === sourceCommit);
    const verificationUncertain = !!verification && verification.status !== "completed";
    const effectUncertain = !!effect && effect.status !== "completed";
    const authRejected = effect?.invalidReason === "worker-auth-rejected";
    const knownStopped = !!effect && effect.status === "completed" && (!!effect.invalidReason || effect.result?.status !== "completed");
    const unsettled = effect?.disposition === "unsettled";
    const plannerDecision = state.stage === "planner" && !state.plannerComplete && events.some(e => e.type === "planner-decisions-requested");
    const explicitRetryStops = ["baseline-unavailable", "verification-unavailable", "judge-unsettled", "effect-uncertain", "verification-uncertain", "worker-stopped", "worker-no-change", "worker-auth-rejected", "judge-stopped", "planner-stopped", "judge-invalid-reply", "planner-invalid-reply"];
    const terminalStops = ["acceptance-born-green", "intent-needs-decision", "acceptance-mutation", "scope-violation", "wall-clock-exhausted", "authority-missing", "legacy-verification-retry", "repeated-candidate", "assertion-red-not-established", "assertion-identities-changed"];
    let resumeProblem = "";
    if (["worker", "judge", "planner"].includes(state.stage)) {
        const role = state.stage as "worker" | "judge" | "planner";
        // A carried completed effect may advance without buying a new session.
        if (!effect || effectUncertain || knownStopped || unsettled) resumeProblem = roleProblem(role) || (effect ? "This attempt requires an explicit eligible recovery action; ordinary Continue cannot repeat it." : "");
    } else if (["baseline", "capture", "verify"].includes(state.stage)) {
        const retained = state.stage === "baseline" ? state.baseline : state.verification;
        if (!retained || retained.status === "unavailable") resumeProblem = verificationProblem;
    }
    if (reason === "verification-budget-exhausted") resumeProblem = verificationProblem;
    if (authRejected || reason === "worker-auth-rejected") resumeProblem = "The coding agent reported rejected credentials. Check the existing authentication setup before an explicit retry; ordinary Continue will not retry it.";
    if (plannerDecision) resumeProblem = "The planner's questions or uncovered intent require a revised contract and separate approval. Continue cannot answer them.";
    if (state.stage === "baseline" && state.baseline?.checks.some(c => c.status === "passed")) resumeProblem = "Some acceptance checks already passed at the starting point. Revise the contract; another Continue cannot produce red-first evidence.";
    if (verificationUncertain || verification?.disposition === "unavailable") resumeProblem = verificationProblem || "The current check attempt needs an explicit eligible recovery action; Continue cannot repeat it.";
    const humanReady = plan.acceptance.criteria.filter(c => c.kind === "human" && c.required).every(c => state.humanJudgements.some(j => j.criterionId === c.id && j.candidateTree === state.candidate?.tree && j.acceptanceSha256 === plan.acceptance_sha256 && j.verdict === "met"));
    if (state.stage === "human" && !humanReady) resumeProblem = "Record your own review of the displayed candidate, or request a revision. Continue cannot supply a human judgement.";
    const humanReview = containedHumanReviewEligibility({ state, plan, authority });
    const eligible: Record<ContainedActionId, boolean> = {
        resume: state.stage !== "ready" && !resumeProblem && !explicitRetryStops.includes(reason ?? "") && !terminalStops.includes(reason ?? ""),
        "retry-verification": (verification?.status === "completed" && verification.disposition === "unavailable" || ["baseline-unavailable", "verification-unavailable"].includes(reason ?? "")) && !verificationProblem,
        "retry-judge": state.stage === "judge" && unsettled && roleRemaining("judge"),
        "retry-stopped": knownStopped && !authRejected && !plannerDecision && roleRemaining(stoppedRole),
        "retry-uncertain": verificationUncertain ? !verificationProblem : effectUncertain && roleRemaining(stoppedRole),
        show: humanReview.enabled,
        review: humanReview.enabled,
        "request-revision": !!state.candidate && ["human", "ready", "judge"].includes(state.stage) && state.verification?.status === "passed" && roleRemaining("worker") && authority.actions.includes("build"),
        deliver: result.status === "review-ready" && state.stage === "ready",
    };
    return {
        schema_version: "wringer.contained-query.v1", revision: last.sha256, journeyId: state.id,
        status: running ? "running" : result.status, stage: state.stage, candidateTree: state.candidate?.tree ?? null, stop: result.stop,
        budget: {
            sessions: { reserved: state.effects.length, ceiling: authority.budget.max_sessions },
            roles: (["planner", "worker", "judge"] as const).map(role => ({ role, reserved: state.effects.filter(e => e.role === role).length, ceiling: authority.budget[role === "worker" ? "max_worker_turns" : role === "judge" ? "max_judge_turns" : "max_planner_turns"] })),
            verificationAttempts: { reserved: attempts.length, ceiling: authority.budget.max_sessions, unknown: attempts.filter(a => a.status !== "completed").length },
            wallClock: { elapsedSeconds, ceilingSeconds: authority.budget.wall_clock_seconds, expired }, tokens: result.tokens,
        },
        effects: state.effects.map(e => ({ id: e.id, role: e.role, transport: e.result?.status ?? e.status, disposition: e.disposition ?? (e.status === "completed" ? "not-recorded" : "unknown") })),
        actions: (Object.keys(eligible) as ContainedActionId[]).map(id => {
            const problem = id === "resume" ? resumeProblem : id === "show" || id === "review" ? humanReview.reason : id === "retry-verification" ? verificationProblem : id === "retry-judge" ? roleProblem("judge") : id === "retry-stopped" || id === "retry-uncertain" ? verificationUncertain ? verificationProblem : authRejected ? resumeProblem : roleProblem(stoppedRole) : id === "request-revision" ? roleProblem("worker") : "";
            return { id, enabled: eligible[id] && !running && !expired && !authorityError, reason: running ? "Journey is active; wait for a stable revision" : authorityError ? "The execution approval is out of date. Inspect the existing grant; refreshing this page cannot renew it." : expired ? "Whole-journey wall clock exhausted" : eligible[id] ? "Available under the current recorded authority; command revalidates under lock" : problem || (id === "resume" && explicitRetryStops.includes(reason ?? "") ? "This stopped step requires its explicit recovery action; ordinary Continue will not replay it." : "Not applicable to this recorded state. Inspect the stop evidence; no new authority is supplied here.") };
        }),
        result,
    };
}
