import { lstat, readFile, realpath } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { hashValue, type ExecutionPlan } from "@wringer/plan";
import type { ContainedPublication } from "./contained";

export interface ResearchDeliveryPurpose {
    schema_version: "wringer.experiment-delivery-purpose.v1";
    experimentSha256: string;
    registrationSha256: string;
    slotId: string;
    planSha256: string;
    controllerPurposeSha256: string;
    sourceBranch: string;
    targetBranch: "main";
    purpose: "private-research-only";
    productionHumanApproval: "not-granted";
    sha256: string;
}
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function validateResearchDeliveryPurpose(value: ResearchDeliveryPurpose, plan: ExecutionPlan, publication: { sourceBranch: string; targetBranch: string }) {
    const { sha256, ...body } = value ?? {};
    if (!value || typeof value !== "object" || value.schema_version !== "wringer.experiment-delivery-purpose.v1" || Object.keys(value).sort().join(",") !== "controllerPurposeSha256,experimentSha256,planSha256,productionHumanApproval,purpose,registrationSha256,schema_version,sha256,slotId,sourceBranch,targetBranch" || !hash(value.experimentSha256) || !hash(value.registrationSha256) || !hash(value.controllerPurposeSha256) || !hash(sha256) || sha256 !== hashValue(body) || value.planSha256 !== plan.plan_sha256 || !/^[a-z][a-z0-9-]{0,159}$/.test(value.slotId) || value.purpose !== "private-research-only" || value.productionHumanApproval !== "not-granted" || value.sourceBranch !== publication.sourceBranch || value.targetBranch !== "main" || publication.targetBranch !== "main" || value.sourceBranch !== `wringer/experiment-${value.slotId}`) throw new Error("Experimental delivery purpose does not match the exact private trial and branch");
    return value;
}
/** Research Yes can never be reused by this public delivery entrypoint for a
 * different local destination or a forge. This is not hostile-owner protection. */
export async function assertResearchPublication(state: string, plan: ExecutionPlan, actor: string, publication: ContainedPublication): Promise<ResearchDeliveryPurpose | null> {
    const path = join(state, "experiment-purpose.json");
    let info;
    try { info = await lstat(path); } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
        if (actor.startsWith("Experiment:") || publication.sourceBranch.startsWith("wringer/experiment-")) throw new Error("Experimental work has no retained private-purpose boundary. It cannot become production handover authority.");
        return null;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16384 || (info.mode & 0o077) !== 0) throw new Error("Experimental controller purpose must be a bounded private regular record");
    const value = JSON.parse(await readFile(path, "utf8")), { sha256, ...body } = value;
    if (Object.keys(value).sort().join(",") !== "allowedPublications,experimentSha256,planSha256,productionHumanApproval,purpose,registrationSha256,schema_version,sha256,slotId" || value.schema_version !== "wringer.experiment-controller-purpose.v1" || !hash(sha256) || sha256 !== hashValue(body) || !hash(value.experimentSha256) || !hash(value.registrationSha256) || value.planSha256 !== plan.plan_sha256 || value.purpose !== "private-research-only" || value.productionHumanApproval !== "not-granted" || !/^[a-z][a-z0-9-]{0,159}$/.test(value.slotId) || !Array.isArray(value.allowedPublications) || value.allowedPublications.length !== 2) throw new Error("Experimental purpose was changed or belongs to another plan");
    if (plan.schema_version !== "wringer.execution-plan.v3" || publication.forge || !isAbsolute(publication.remote)) throw new Error("Research decisions permit only the pre-reserved private local ending, never a production destination or forge");
    const remote = await realpath(publication.remote);
    const allowed = value.allowedPublications.some((row: any) => row && Object.keys(row).sort().join(",") === "remote,sourceBranch,targetBranch" && isAbsolute(row.remote) && row.remote === remote && row.sourceBranch === publication.sourceBranch && row.targetBranch === publication.targetBranch && row.targetBranch === "main" && row.sourceBranch === `wringer/experiment-${value.slotId}`);
    if (!allowed) throw new Error("This destination is outside the exact private experiment reservation. Research acceptance is not production Send authority.");
    const portable = { schema_version: "wringer.experiment-delivery-purpose.v1" as const, experimentSha256: value.experimentSha256, registrationSha256: value.registrationSha256, slotId: value.slotId, planSha256: plan.plan_sha256, controllerPurposeSha256: sha256, sourceBranch: publication.sourceBranch, targetBranch: "main" as const, purpose: "private-research-only" as const, productionHumanApproval: "not-granted" as const };
    return validateResearchDeliveryPurpose({ ...portable, sha256: hashValue(portable) }, plan, publication);
}
