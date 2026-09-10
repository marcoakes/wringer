import { measuredLoopPlan, hashValue, type ExecutionPlan } from "@wringer/plan";
import type { CandidateVerification, ContainedJudgeFinding } from "./contained-types";

export interface LoopDecision {
    schema_version: "wringer.loop-decision.v1";
    sequence: number;
    phase: "checks" | "judge";
    candidateCommit: string;
    candidateTree: string;
    acceptanceSha256: string;
    environmentSha256: string;
    verificationSha256: string;
    comparableSha256: string;
    outcomes: { id: string; kind: "check" | "regression" | "judge"; status: string }[];
    unsuccessful: boolean;
    action: "continue" | "warn" | "stop";
    repeatedCandidateSequence: number | null;
    repeatedOutcomes: number;
    reason: string;
    sha256: string;
}
/** No score, model inference or mutable policy: observations determine this bounded decision. */
export function analyzeLoop(plan: ExecutionPlan, environmentSha256: string, verification: CandidateVerification, previous: LoopDecision[], judge?: ContainedJudgeFinding[]): LoopDecision {
    if (!measuredLoopPlan(plan) || !plan.loop || !/^[a-f0-9]{64}$/.test(environmentSha256) || previous.length > 10000) throw new Error("Loop analysis requires the approved v3 policy and bounded source history");
    for (let index = 0; index < previous.length; index++) {
        const row = previous[index]!, { sha256, ...body } = row;
        if (row.schema_version !== "wringer.loop-decision.v1" || row.sequence !== index + 1 || sha256 !== hashValue(body)) throw new Error("Loop decision history changed or lost its ordering");
    }
    const phase = judge ? "judge" as const : "checks" as const;
    const outcomes = [...verification.checks.map(c => ({ id: c.id, kind: "check" as const, status: c.status })), ...(verification.regressions ?? []).map(c => ({ id: c.id, kind: "regression" as const, status: c.status })), ...(judge ?? []).map(c => ({ id: c.id, kind: "judge" as const, status: c.met === null ? "unknown" : c.met ? "met" : "not-met" }))].sort((a, b) => `${a.kind}/${a.id}`.localeCompare(`${b.kind}/${b.id}`));
    const unsuccessful = verification.status === "failed" || !!judge?.some(c => !c.met && c.met !== null && plan.acceptance.criteria.find(r => r.id === c.id)?.required);
    const comparableSha256 = hashValue({ acceptance: plan.acceptance_sha256, environment: environmentSha256, image: verification.image, checkInputs: verification.checks.map(c => ({ id: c.id, inputs: c.checkInputsSha256 })).sort((a, b) => a.id.localeCompare(b.id)), phase });
    const comparable = previous.filter(p => p.phase === phase && p.comparableSha256 === comparableSha256 && p.unsuccessful);
    const repeated = unsuccessful ? comparable.find(p => p.candidateTree === verification.candidateTree) : undefined;
    let repeatedOutcomes = unsuccessful ? 1 : 0;
    for (const row of [...previous].reverse()) {
        if (row.phase !== phase) continue;
        if (!unsuccessful || !row.unsuccessful || row.comparableSha256 !== comparableSha256 || hashValue(row.outcomes) !== hashValue(outcomes)) break;
        repeatedOutcomes++;
    }
    const action = repeated ? "stop" as const : repeatedOutcomes >= plan.loop.repeatedOutcomeWarning ? "warn" as const : "continue" as const;
    const reason = repeated ? `This repeats unsuccessful candidate ${repeated.sequence}; no additional worker attempt is automatically authorised.` : action === "warn" ? `The same ${phase === "judge" ? "agent findings" : "check outcomes"} remain after ${repeatedOutcomes} candidate observations. This is not proof that no progress occurred.` : unsuccessful ? "A new bounded repair may proceed under the original remaining allowance." : "This observation does not require a repair; readiness still depends on all remaining checks and human decisions.";
    const { evidenceRef: _transportPath, ...portableVerification } = verification;
    const body = { schema_version: "wringer.loop-decision.v1" as const, sequence: previous.length + 1, phase, candidateCommit: verification.candidateCommit, candidateTree: verification.candidateTree, acceptanceSha256: plan.acceptance_sha256, environmentSha256, verificationSha256: hashValue(portableVerification), comparableSha256, outcomes, unsuccessful, action, repeatedCandidateSequence: repeated?.sequence ?? null, repeatedOutcomes, reason };
    return { ...body, sha256: hashValue(body) };
}

/** The same coverage/ordering rules apply to local and portable journal projections.
 * Stopped partial histories may end before a decision; they may not spend or become ready past it. */
export function validateEngineeringJournal(plan: ExecutionPlan, environmentSha256: string, events: { type: string; state: any; details?: any; loopDecision?: LoopDecision }[]): LoopDecision[] {
    if (!measuredLoopPlan(plan)) return [];
    const decisions: LoopDecision[] = [], effects = new Set<string>();
    let pendingChecks: string | null = null, pendingJudge: string | null = null, stopped = false;
    let previousVerification: string | null = null, previousJudge: string | null = null, checksAnchored = false;
    const identity = (verification: CandidateVerification) => { const { evidenceRef: _path, ...portable } = verification; return hashValue(portable); };
    for (const event of events) {
        const verification: CandidateVerification | null = event.state?.verification ?? null, judge: ContainedJudgeFinding[] | undefined = event.state?.judge?.criteria;
        const verificationIdentity = verification ? identity(verification) : null, judgeIdentity = event.state?.judge ? hashValue(event.state.judge) : null;
        // Coverage follows retained observations, not optional event labels. A
        // renamed/deleted anchor cannot hide a completed verification or judge.
        if (verificationIdentity && verificationIdentity !== previousVerification) {
            if (!["verification-observed", "verification-reconciled", "candidate-verified"].includes(event.type)) throw new Error("Candidate verification changed without its observation event");
            pendingChecks = verificationIdentity; checksAnchored = false;
        }
        if (judgeIdentity && judgeIdentity !== previousJudge && event.type !== "candidate-judged") throw new Error("Judge findings changed without their exact candidate event");
        if (event.type === "candidate-verified") {
            if (!verification || pendingChecks !== verificationIdentity) throw new Error("Candidate verification event omitted its pending observation");
            checksAnchored = true;
        }
        if (event.type === "candidate-judged") {
            if (!verification || !judge) throw new Error("Judge event omitted its exact candidate findings");
            pendingJudge = judge.some(c => c.met !== true && plan.acceptance.criteria.find(r => r.id === c.id)?.required) ? identity(verification) : null;
        }
        const decision = event.loopDecision ?? event.details?.loopDecision;
        if (event.type === "loop-decision-recorded") {
            if (!decision || !verification || (decision.phase === "checks" ? pendingChecks : pendingJudge) !== identity(verification) || decision.phase === "checks" && !checksAnchored) throw new Error("Loop decision has no pending exact candidate observation and anchor");
            if (decision.phase === "judge" && (!judge || judge.some(c => c.met === null && plan.acceptance.criteria.find(r => r.id === c.id)?.required))) throw new Error("Unknown judge findings cannot authorize a repair decision");
            const expected = analyzeLoop(plan, environmentSha256, verification, decisions, decision.phase === "judge" ? judge : undefined);
            if (hashValue(decision) !== hashValue(expected)) throw new Error("Loop decision differs from its retained observations or earlier history");
            decisions.push(expected);
            if (decision.phase === "checks") pendingChecks = null; else pendingJudge = null;
            if (expected.action === "stop") stopped = true;
        } else if (decision) throw new Error("Loop decision is attached to an unrelated journal event");
        for (const effect of event.state?.effects ?? []) {
            if (!effects.has(effect.id) && effect.role === "worker" && (pendingChecks || pendingJudge || stopped)) throw new Error("Worker dispatch crossed a missing or stopping loop decision");
            effects.add(effect.id);
        }
        if (["repair-required", "checks-passed", "judge-requested-repair", "independent-review-passed"].includes(event.type) || ["human", "ready"].includes(event.state?.stage)) {
            if (pendingChecks || pendingJudge || stopped) throw new Error("Journey advanced past a missing or stopping loop decision");
        }
        previousVerification = verificationIdentity; previousJudge = judgeIdentity;
    }
    return decisions;
}
