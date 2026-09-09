import { realpath } from "node:fs/promises";
import type { ExperimentControllerPurpose, ExperimentPlan, ExperimentTrialSlot } from "./experiment-types";
import { exclusiveJson, experimentPath, optionalJson, privateExperimentRoot, stamped, verifyStamp } from "./experiment-store";

/** Ordinary delivery must honour this marker too: research acceptance is never
 * portable production authority merely because its private workflow is ready. */
export async function ensureExperimentControllerPurpose(root: string, state: string, experiment: ExperimentPlan, registrationSha256: string, slot: ExperimentTrialSlot): Promise<ExperimentControllerPurpose> {
    await privateExperimentRoot(root);
    if (await realpath(state) !== await experimentPath(root, `journeys/${slot.id}`)) throw new Error("Research controller does not occupy its exact reserved private trial directory");
    const allowedPublications = await Promise.all(["", "reviewed-"].map(async prefix => ({ remote: await experimentPath(root, `private-deliveries/${prefix}${slot.id}/origin.git`), sourceBranch: `wringer/experiment-${slot.id}`, targetBranch: "main" as const })));
    const marker = stamped({ schema_version: "wringer.experiment-controller-purpose.v1" as const, experimentSha256: experiment.sha256, registrationSha256, slotId: slot.id, planSha256: slot.planSha256, purpose: "private-research-only" as const, allowedPublications, productionHumanApproval: "not-granted" as const });
    const previous = await optionalJson<ExperimentControllerPurpose>(state, "experiment-purpose.json");
    if (previous) {
        verifyStamp(previous);
        if (previous.sha256 !== marker.sha256) throw new Error("Immutable research purpose changed; no trial, human acceptance or publication is authorised");
        return previous;
    }
    await exclusiveJson(state, "experiment-purpose.json", marker); return marker;
}
