import { join } from "node:path";
import { assistantExists, assistantId, assistantPath, createAssistantDirectory, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
import { readDelegationJob, delegationControllerRoot } from "./delegation-jobs";
import { createAssistantService, assistantControllerState } from "./assistant";
import { connectImprovements, improvementConnection, inspectJobImprovements } from "./improvements";
import { experimentPath, id, privateExperimentRoot } from "./experiment-store";
import { createExperimentPlan, readExperiment } from "./experiments";
import { failurePatternsFromJourneys } from "./journey-patterns";
import type { ExecutionPlan } from "@wringer/plan";
import { readJobLoopInspection } from "./loop-inspection";

export async function jobImprovementContext(root: string, jobId: string) {
    const job = await readDelegationJob(root, assistantId(jobId)), controller = await delegationControllerRoot(root, job.workspaceId, job.contextId);
    const service = await createAssistantService(controller), proposal = await service.inspectProposal(jobId);
    return { job, controller, plan: proposal.plan, profile: proposal.plan ?? service.workspace.profile };
}
export async function inspectDelegationImprovements(root: string, jobId: string) {
    const current = await jobImprovementContext(root, jobId);
    return inspectJobImprovements(current.controller, current.profile, jobId);
}
/** Explicit setup allocates owned paths; no grant, role session or credential read. */
export async function connectDelegationImprovements(root: string, jobId: string, taskFamily: string) {
    id(taskFamily);
    const current = await jobImprovementContext(root, jobId);
    await privateExperimentRoot(root);
    const store = await createAssistantDirectory(await assistantPath(root, `improvement-stores/${current.job.workspaceId}/${taskFamily}`));
    const researchRoot = await createAssistantDirectory(join(store, "research")), registryRoot = await createAssistantDirectory(join(store, "registry"));
    const selected = { researchRoot, registryRoot, taskFamily };
    const destination = `workspace-improvements/${current.job.workspaceId}.json`;
    // Immutable workspace selection is installed first; a lost response can only
    // finish connecting the same family. Another family never replaces it.
    await writeAssistantRecord(root, destination, { schema_version: "wringer.improvement-connection.v1", ...selected, repository: current.profile.repository.url });
    return connectImprovements(current.controller, selected);
}
export async function inheritWorkspaceImprovements(root: string, workspaceId: string, controller: string, profile: ExecutionPlan) {
    const file = `workspace-improvements/${assistantId(workspaceId)}.json`;
    if (!await assistantExists(root, file)) return;
    const selected = await readAssistantRecord<any>(root, file);
    if (selected.repository !== profile.repository.url) throw new Error("The workspace comparison belongs to another repository");
    await connectImprovements(controller, { researchRoot: selected.researchRoot, registryRoot: selected.registryRoot, taskFamily: selected.taskFamily });
}
export async function jobExperimentLocation(root: string, jobId: string, experimentId?: string, registration?: unknown) {
    const current = await jobImprovementContext(root, jobId), link = await improvementConnection(current.controller, current.profile.repository.url);
    if (!link) throw new Error("Connect this job's future improvements first with experiment connect --job and --task-family");
    if (registration !== undefined) {
        const plan = createExperimentPlan(registration as any);
        if (plan.id !== experimentId || plan.repository !== link.repository || plan.taskFamily !== link.taskFamily) throw new Error("The comparison must match the selected identity, repository and task family");
    }
    if (experimentId !== undefined) id(experimentId);
    const state = experimentId ? await experimentPath(link.researchRoot, `experiments/${experimentId}`) : undefined;
    if (state && registration !== undefined) await createAssistantDirectory(state);
    if (state && registration === undefined) {
        const current = await readExperiment(state);
        if (current.plan.id !== experimentId || current.plan.repository !== link.repository || current.plan.taskFamily !== link.taskFamily) throw new Error("The retained comparison belongs to another repository or task family");
    }
    return { state, registry: link.registryRoot, taskFamily: link.taskFamily };
}
export async function jobFailurePatterns(root: string, jobId: string, taskFamily: string) {
    const current = await jobImprovementContext(root, jobId);
    const state = assistantControllerState(current.controller, jobId);
    await readJobLoopInspection(current.plan, state);
    return failurePatternsFromJourneys([state], taskFamily);
}
