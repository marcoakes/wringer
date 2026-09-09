import { hashValue, type ExecutionPlan, type PlaybookSnapshot, type PlaybookAdoptionReceipt } from "@wringer/plan";
import { analyzeLoop, validateEngineeringJournal, type LoopDecision } from "@wringer/workflow";

export interface PlaybookUse {
    effectId: string;
    requestSha256: string;
    snapshotSha256: string;
    playbookSha256: string;
    path: string;
    taskFamily: string;
}
export interface EngineeringEvidence {
    schema_version: "wringer.engineering-evidence.v1";
    planSha256: string;
    playbook: PlaybookSnapshot | null;
    adoption: PlaybookAdoptionReceipt | null;
    uses: PlaybookUse[];
    loopDecisions: LoopDecision[];
    checks: { id: string; level: "assertions" | "command" }[];
    limits: string[];
}
export interface EngineeringSummary {
    receipt: "engineering.json";
    sha256: string;
    playbook: { id: string; revision: string; title: string; path: string; sha256: string; taskFamily: string; workerUses: number } | null;
    adoption: PlaybookAdoptionReceipt | null;
    checks: EngineeringEvidence["checks"];
    decisions: { sequence: number; phase: string; action: string; reason: string; sha256: string }[];
}

/** Reconstructed from the same validated journal used for delivery, not a mutable status view. */
export function engineeringEvidence(plan: ExecutionPlan, environmentSha256: string, events: any[], snapshot: PlaybookSnapshot | null): EngineeringEvidence {
    if (plan.schema_version !== "wringer.execution-plan.v3") throw new Error("Engineering receipts require execution plan v3");
    validateEngineeringJournal(plan, environmentSha256, events);
    const decisions: LoopDecision[] = [], uses: PlaybookUse[] = [];
    for (const event of events) {
        const decision = event.loopDecision ?? event.details?.loopDecision;
        if (event.type === "loop-decision-recorded") {
            if (!decision || !event.state.verification) throw new Error("Loop decision lost its source observation");
            const expected = analyzeLoop(plan, environmentSha256, event.state.verification, decisions, decision.phase === "judge" ? event.state.judge?.criteria : undefined);
            if (hashValue(expected) !== hashValue(decision)) throw new Error("Loop decision contradicts the retained source/check history");
            decisions.push(expected);
        } else if (decision) throw new Error("Loop decision was attached to a different journal event");
        const use = event.playbookUse ?? event.details?.playbookUse;
        if (event.type === "playbook-used") {
            if (!snapshot || !use || Object.keys(use).sort().join(",") !== "effectId,path,playbookSha256,requestSha256,snapshotSha256,taskFamily") throw new Error("Playbook use has no exact selected snapshot");
            const effect = event.state.effects.find((e: any) => e.id === use.effectId);
            if (!effect || effect.role !== "worker" || effect.status !== "reserved" || effect.requestSha256 !== use.requestSha256 || use.snapshotSha256 !== snapshot.snapshot_sha256 || use.playbookSha256 !== snapshot.sha256 || use.path !== plan.playbook?.path || use.taskFamily !== plan.playbook?.taskFamily || uses.some(u => u.effectId === use.effectId)) throw new Error("Playbook use contradicts its approved worker request");
            uses.push(use);
        } else if (use) throw new Error("Playbook use was attached to a different journal event");
    }
    const workers = events.at(-1)?.state.effects.filter((e: any) => e.role === "worker") ?? [];
    if (snapshot && (workers.length !== uses.length || workers.some((e: any) => !uses.some(u => u.effectId === e.id)))) throw new Error("Selected playbook is missing a worker-use receipt");
    if (!snapshot && plan.playbook) throw new Error("Approved playbook snapshot was not carried");
    const checks = plan.acceptance.checks.map(c => ({ id: c.id, level: c.evidence?.kind === "assertions" ? "assertions" as const : "command" as const }));
    return { schema_version: "wringer.engineering-evidence.v1", planSha256: plan.plan_sha256, playbook: snapshot, adoption: plan.approachAdoption ?? plan.playbook?.adoption ?? null, uses, loopDecisions: decisions, checks,
        limits: ["Playbook use is a controller-recorded request, not proof of model understanding or measured improvement. Guidance is not injected into judge instructions, but tracked repository bytes remain readable.", "Repair excerpts are reconstructed from carried redacted outputs. The original observation digest is an opaque controller commitment: host-specific runtime provenance is projected for portability, not reconstructed byte for byte.", "Any carried adoption receipt records a future-selection decision and evidence revision, not a rerun of its private comparative trials or proof of live benefit.", "Command-red means the command failed before implementation. Assertion-red additionally binds executed protected-runner assertions; neither proves requirement completeness.", "Loop decisions are deterministic observations under one approved policy. Repeated outcomes are not a quality score."] };
}
export function summarizeEngineering(value: EngineeringEvidence): EngineeringSummary {
    return { receipt: "engineering.json", sha256: hashValue(value), playbook: value.playbook ? { id: value.playbook.manifest.id, revision: value.playbook.manifest.revision, title: value.playbook.manifest.title, path: value.playbook.source.path, sha256: value.playbook.sha256, taskFamily: value.playbook.manifest.applicability.taskFamily, workerUses: value.uses.length } : null,
        adoption: value.adoption, checks: value.checks, decisions: value.loopDecisions.map(d => ({ sequence: d.sequence, phase: d.phase, action: d.action, reason: d.reason, sha256: d.sha256 })) };
}
