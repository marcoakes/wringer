import type { ExecutionPlan } from "@wringer/plan";
import type { DesignSnapshot } from "@wringer/design";
import type { ContainedCommandResult } from "@wringer/runtime";
import type { ContainedDisplayVisuals } from "@wringer/workflow";
import type { ContainedAudit } from "@wringer/delivery";

/** Research contracts are separate from execution approval and publication authority. */
export type ExperimentArm = "baseline" | "candidate";
export interface ExperimentTask {
    id: string;
    /** Declared before collection; each fresh source observation must match. */
    sourceTree: string;
    split: "development" | "held-out";
    baseline: ExecutionPlan;
    candidate: ExecutionPlan;
}
export interface ImprovementPrediction {
    statement: string;
    metric: "worker-attempts" | "functional-completion";
    minimumImprovement: number;
    minimumHeldOutPairs: number;
    maximumSignProbability: number;
    visualQualityClaim: boolean;
}
export interface ExperimentPlanInput {
    id: string;
    taskFamily: string;
    repository: string;
    baselinePlaybook: string | null;
    candidatePlaybook: string;
    changedVariable: "worker-playbook";
    tasks: ExperimentTask[];
    repetitions: number;
    order: "alternating-pairs";
    stratum: { platform: "darwin" | "linux"; modelSelection: string; adapterSelection: string };
    prediction: ImprovementPrediction;
    limits: { maxTrials: number; maxRoleSessions: number; wallClockSeconds: number };
    dataScope: "this-repository-only";
    holdout: { corpusId: string; candidateIteration: number; maximumCandidateIterations: number; candidateAuthorSawHeldOutSolutions: false };
    accounting: "all-planned-trials-including-failures";
    stoppingRule: "fixed-sample-no-extension";
}
export interface ExperimentPlan extends ExperimentPlanInput {
    schema_version: "wringer.experiment-plan.v1";
    sha256: string;
}
export interface ExperimentGrant {
    schema_version: "wringer.experiment-grant.v1";
    experimentSha256: string;
    actor: string;
    grantedAt: string;
    expiresAt: string;
    limits: ExperimentPlan["limits"];
    credentialNames: string[];
    dataScope: "this-repository-only";
    actions: ["collect-private-trials", "measure-private-handover"];
    noProductionPublication: true;
    sha256: string;
}
export interface ExperimentTrialSlot { id: string; taskId: string; repetition: number; arm: ExperimentArm; planSha256: string; reservedSessions: number; }
export interface ExperimentControllerPurpose {
    schema_version: "wringer.experiment-controller-purpose.v1";
    experimentSha256: string;
    registrationSha256: string;
    slotId: string;
    planSha256: string;
    purpose: "private-research-only";
    allowedPublications: { remote: string; sourceBranch: string; targetBranch: "main" }[];
    productionHumanApproval: "not-granted";
    sha256: string;
}
export interface ExperimentTrial {
    schema_version: "wringer.experiment-trial.v1";
    experimentSha256: string;
    slot: ExperimentTrialSlot;
    registrationSha256: string;
    startedAt: string;
    finishedAt: string;
    evidenceKind: "live-contained" | "deterministic-fixture";
    outcome: "completed" | "human-hold" | "stopped" | "infrastructure-failed" | "uncertain" | "not-started";
    workerAttempts: number | null;
    roleSessions: number | null;
    functionalCompletion: boolean;
    requirements: { id: string; kind: "check" | "human"; met: boolean | null }[];
    safety: { authority: "passed" | "failed" | "unknown"; acceptance: "passed" | "failed" | "unknown"; containment: "passed" | "failed" | "unknown"; secrets: "passed" | "failed" | "unknown"; handoverAudit: "passed" | "failed" | "unknown"; productionPublication: "not-attempted" };
    safetyEvidence: {
        authority: string | null;
        acceptance: string | null;
        containment: string | null;
        secrets: { scanner: "declared-credential-and-pattern-redactor"; inputsSha256: string; inputCount: number } | null;
        handoverAudit: string | null;
    };
    candidateCommit: string | null;
    candidateTree: string | null;
    journeyRevision: string | null;
    runtimeIds: string[];
    agentIdentitySha256: string | null;
    stopReason: string | null;
    cost: null;
    sha256: string;
}
export interface ExperimentHandover {
    schema_version: "wringer.experiment-handover.v1";
    experimentSha256: string;
    registrationSha256: string;
    slotId: string;
    planSha256: string;
    candidateCommit: string | null;
    candidateTree: string | null;
    journeyRevision: string | null;
    evidenceKind: "live-contained" | "deterministic-fixture";
    target: "generated-private-local-origin-only";
    status: "passed" | "failed" | "unknown";
    measuredAt: string;
    delivery: { deliveryId: string; codeCommit: string; evidenceCommit: string; sourceBranch: string; targetBranch: "main"; pushed: true } | null;
    freshClone: { headCommit: string; audit: ContainedAudit } | null;
    productionPublication: "not-attempted";
    productionHumanApproval: "not-granted";
    reason: string;
    sha256: string;
}
export interface ExperimentResearchReview {
    schema_version: "wringer.experiment-research-review.v1";
    experimentSha256: string;
    trialSha256: string;
    candidateTree: string;
    actor: string;
    at: string;
    independent: boolean;
    blinded: boolean;
    kind: "real-research-observation" | "deterministic-fixture";
    criteria: { id: string; met: boolean; note: string }[];
    displayReceiptSha256: string;
    noProductionAuthority: true;
    sha256: string;
}
export interface ExperimentResearchDisplay {
    schema_version: "wringer.experiment-research-display.v1";
    experimentSha256: string;
    trialSha256: string;
    candidateCommit: string;
    candidateTree: string;
    snapshot: DesignSnapshot | null;
    displays: { criterionId: string; success: boolean; measured: ContainedCommandResult; visuals?: ContainedDisplayVisuals }[];
    sha256: string;
}
/** A separate zero-agent allowance; it never renews the original journey clock. */
export interface ExperimentResearchFinishReservation {
    schema_version: "wringer.experiment-research-finish-reservation.v1";
    experimentSha256: string;
    registrationSha256: string;
    trialSha256: string;
    reviewSha256: string;
    displaySha256: string;
    actor: string;
    startedAt: string;
    deadline: string;
    wallClockSeconds: number;
    roleSessions: 0;
    action: "finish-private-research-only";
    noProductionAuthority: true;
    sha256: string;
}
export interface ExperimentResearchCompletion {
    schema_version: "wringer.experiment-research-completion.v1";
    reservation: ExperimentResearchFinishReservation;
    evidenceKind: ExperimentTrial["evidenceKind"];
    originalJourneyRevision: string;
    handover: ExperimentHandover | null;
    status: "passed" | "failed" | "unknown";
    completedAt: string;
    reason: string;
    productionHumanApproval: "not-granted";
    sha256: string;
}
export interface ExperimentResult {
    schema_version: "wringer.experiment-result.v1";
    experimentSha256: string;
    evidenceRevision: string;
    eligibility: "eligible" | "ineligible" | "inconclusive";
    findings: string[];
    plannedTrials: number;
    recordedTrials: number;
    liveTrials: number;
    fixtureTrials: number;
    missingTrials: string[];
    pairs: { taskId: string; repetition: number; split: ExperimentTask["split"]; baseline: string | null; candidate: string | null; improvement: number | null; regressions: string[] }[];
    heldOut: { pairs: number; independentTasks: number; improvements: number; regressions: number; ties: number; meanImprovement: number | null; signProbability: number | null };
    cost: null;
    limits: string[];
    sha256: string;
}
export interface PlaybookAdoption {
    schema_version: "wringer.playbook-adoption.v1";
    repository: string;
    taskFamily: string;
    action: "promote" | "rollback";
    actor: string;
    note: string;
    at: string;
    previousRevision: string;
    previousDigest: string | null;
    selectedDigest: string | null;
    experimentSha256: string;
    evidenceRevision: string;
    appliesTo: "future-plans-only";
    executionApproved: false;
    sha256: string;
}
export interface FailurePatternReport {
    schema_version: "wringer.failure-pattern-report.v1";
    repository: string;
    taskFamily: string;
    sources: string[];
    groups: { comparisonKey: string; kind: "environment" | "product-check" | "agent-finding" | "human-preference"; requirementIds: string[]; count: number; observations: string[] }[];
    limits: string[];
    sha256: string;
}
