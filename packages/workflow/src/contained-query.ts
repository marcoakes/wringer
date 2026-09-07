import { resolve } from "node:path";
import { validateExecutionAuthority } from "@wringer/plan";
import { readValidatedContainedState } from "./contained";
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

/** One read-only projection for every frontend. No view or command string grants authority. */
export async function queryContainedJourney(stateDir: string): Promise<ContainedJourneyProjection> {
    const { state, result, plan, authority, events } = await readValidatedContainedState(resolve(stateDir), { allowStaleView: true });
    const last = events.at(-1)!, elapsedSeconds = Math.max(0, (Date.now() - Date.parse(state.startedAt)) / 1000);
    const expired = elapsedSeconds >= authority.budget.wall_clock_seconds;
    let authorityError = "";
    try { validateExecutionAuthority(authority, plan); } catch (error) { authorityError = String(error); }
    const reason = result.stop?.reason, lock = await workflowLockStatus(resolve(stateDir), "contained-journey"), running = lock === "held" || lock === "unknown";
    const roleRemaining = (role: "worker" | "judge") => state.effects.length < authority.budget.max_sessions && state.effects.filter(e => e.role === role).length < authority.budget[role === "worker" ? "max_worker_turns" : "max_judge_turns"];
    const attempts = state.verificationAttempts ?? [];
    const eligible: Record<ContainedActionId, boolean> = {
        resume: state.stage !== "ready" && !["baseline-unavailable", "verification-unavailable", "judge-unsettled", "effect-uncertain", "verification-uncertain", "worker-stopped", "judge-stopped", "planner-stopped", "judge-invalid-reply", "planner-invalid-reply"].includes(reason ?? ""),
        "retry-verification": ["baseline-unavailable", "verification-unavailable"].includes(reason ?? "") && attempts.length < authority.budget.max_sessions,
        "retry-judge": reason === "judge-unsettled" && roleRemaining("judge"),
        "retry-stopped": ["worker-stopped", "judge-stopped", "planner-stopped", "judge-invalid-reply", "planner-invalid-reply"].includes(reason ?? "") && state.effects.length < authority.budget.max_sessions,
        "retry-uncertain": ["effect-uncertain", "verification-uncertain"].includes(reason ?? "") && (reason === "verification-uncertain" ? attempts.length < authority.budget.max_sessions : state.effects.length < authority.budget.max_sessions),
        show: !!state.candidate && ["human", "ready"].includes(state.stage) && plan.acceptance.criteria.some(c => c.kind === "human"),
        review: !!state.candidate && ["human", "ready"].includes(state.stage) && plan.acceptance.criteria.some(c => c.kind === "human"),
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
        actions: (Object.keys(eligible) as ContainedActionId[]).map(id => ({ id, enabled: eligible[id] && !running && !expired && !authorityError, reason: running ? "Journey is active; wait for a stable revision" : authorityError || (expired ? "Whole-journey wall clock exhausted" : eligible[id] ? "Available under the current recorded authority; command revalidates under lock" : "Not applicable to this state or the remaining budget") })),
        result,
    };
}
