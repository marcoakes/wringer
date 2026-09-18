/** Construction-only test extension. No production entrypoint accepts this interface. */
import type { DesignSnapshot } from "../packages/design/src";
import type { ExecutionPlan } from "../packages/plan/src";
import type { executeAgentRole, runContainedCommands } from "../packages/runtime/src";

export interface GuidedScenario {
    correction: string;
    firstResultText: string;
    snapshotPath: string;
    sourcePath: string;
    correctedSourceText: string;
    designCriterionId: string;
    requirementText: string;
    requiredHumanCount: number;
    referenceWidth: number;
    referenceHeight: number;
    phaseTimeoutMs: number;
    realVerifier: boolean;
    realRoleContainment: boolean;
    skipBreakage: boolean;
}
export interface RehearsalScenario {
    title: string;
    sourceFixtureKind: string;
    limits: string[];
    snapshot: DesignSnapshot;
    captures: NonNullable<ExecutionPlan["design"]>["reviews"][number]["captures"];
    manifest: { path: string; sha256: string; bytes: number }[];
    prepareSource(destination: string): Promise<void>;
    plan(commit: string): ExecutionPlan;
    playbookId: string;
    playbookSha256: string;
    runCommands: typeof runContainedCommands;
    executeRole: typeof executeAgentRole;
    guided: GuidedScenario;
    verifyClone(directory: string): Promise<void>;
}
