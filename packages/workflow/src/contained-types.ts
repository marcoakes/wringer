import type { EnvironmentMap, ExecutionAuthority, ExecutionPlan, RepositoryRef } from "@wringer/plan";
import type { RoleExecutor, RoleExecutionResult, RepositorySource } from "@wringer/runtime";
import type { CheckEvidenceObservation } from "./check-evidence";
import type { RepairPacket } from "./repair-packet";
export interface CandidateSource {
    source: RepositorySource;
    tree: string;
    changedPaths: string[];
}
export interface ContainedCheckResult {
    id: string;
    status: "passed" | "failed" | "unavailable";
    exitCode: number | null;
    /** Controller-pinned complete declared check-file/dependency input identity. */
    checkInputsSha256: string;
    outputSha256: string;
}
export interface CandidateVerification {
    schema_version: "wringer.contained-verification.v1" | "wringer.contained-verification.v2";
    status: "passed" | "failed" | "unavailable";
    candidateCommit: string;
    candidateTree: string;
    acceptanceSha256: string;
    runtimeId: string;
    image: string;
    checks: ContainedCheckResult[];
    regressions?: {
        id: string;
        status: "passed" | "failed" | "unavailable";
        exitCode: number | null;
        outputSha256: string;
    }[];
    evidenceRef: string;
    /** v2 only. Old command receipts are never retrospectively called assertion evidence. */
    checkEvidence?: CheckEvidenceObservation[];
    repair?: RepairPacket;
}
export interface ContainedJourneyServices {
    /** No agent program runs here; prepare an existing commit/bundle transport. */
    prepareSource: (source: RepositoryRef) => Promise<RepositorySource>;
    /** Idempotent for effectId. Apply runtime-captured patch, never worker narrative. */
    captureCandidate: (result: RoleExecutionResult, base: RepositorySource, effectId: string) => Promise<CandidateSource>;
    /** Pinned original acceptance inputs in a fresh independent runtime. */
    verifyCandidate: (request: ContainedVerificationRequest) => Promise<CandidateVerification>;
    /** Read retained observations only. Must never allocate or execute a runtime. */
    reconcileVerification?: (request: ContainedVerificationRequest) => Promise<CandidateVerification | null>;
}
export interface ContainedVerificationRequest {
    plan: ExecutionPlan;
    source: RepositorySource;
    phase: "baseline" | "candidate";
    effectId: string;
    signal?: AbortSignal;
}
export interface ContainedRevisionGuard {
    expectedRevision?: string;
    expectedCandidateTree?: string | null;
}
export interface LegacyCandidateHumanJudgement {
    criterionId: string;
    candidateTree: string;
    acceptanceSha256: string;
    verdict: "met" | "not_met";
    by: string;
    note: string;
    display: {
        candidateTree: string;
        status: "shown";
        receiptSha256: string;
    };
}
/** An explicit choice is evidence in its own right; absence of prose is not prose. */
export interface CandidateHumanDecision extends Omit<LegacyCandidateHumanJudgement, "note"> {
    schema_version: "wringer.contained-human-decision.v1";
    note: string | null;
    displayId: string;
    attribution: "initial-execution-approval";
    authoritySha256: string;
}
export type CandidateHumanJudgement = LegacyCandidateHumanJudgement | CandidateHumanDecision;
export interface ContainedJourneyOptions extends ContainedRevisionGuard {
    controllerDir: string;
    plan: ExecutionPlan;
    authority: ExecutionAuthority;
    environment: EnvironmentMap;
    services: ContainedJourneyServices;
    executeRole?: RoleExecutor;
    /** Acknowledges possible duplicate spend. Past uncertain reservations remain charged. */
    retryUncertain?: boolean;
    /** Explicitly permits a new bounded session after a known stopped/invalid role result. */
    retryStopped?: boolean;
    /** New independent attempt after a durably observed unavailable verifier. */
    retryVerification?: boolean;
    /** New judge session after a completed but explicitly unsettled task. */
    retryJudge?: boolean;
    humanJudgements?: CandidateHumanJudgement[];
    signal?: AbortSignal;
    onEvent?: (event: Record<string, unknown>) => void | Promise<void>;
}
export interface ContainedJourneyStop {
    reason: string;
    message: string;
    next_move: string;
    cwd: string;
}
export interface ContainedJudgeFinding {
    id: string;
    met: boolean | null;
    reason: string;
}
export interface ContainedJourneyResult {
    schema_version: "wringer.contained-journey-result.v1";
    journeyId: string;
    status: "review-ready" | "human-hold" | "stopped";
    candidate: CandidateSource | null;
    verification: CandidateVerification | null;
    judge: {
        criteria: ContainedJudgeFinding[];
        note: string;
        runtimeId: string;
        sessionId: string;
    } | null;
    stop: ContainedJourneyStop | null;
    recordDir: string;
    sessions: number;
    tokens: {
        input: number | null;
        output: number | null;
    };
    humanJudgements: CandidateHumanJudgement[];
}
