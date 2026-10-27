import { join } from "node:path";
import { assistantExists, assistantId, assistantPath, createAssistantDirectory, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
import { readDelegationJob, delegationControllerRoot } from "./delegation-jobs";
import { createAssistantService, assistantControllerState } from "./assistant";
import { connectImprovements, improvementConnection, inspectJobImprovements } from "./improvements";
import { experimentPath, id, privateExperimentRoot } from "./experiment-store";
import { createExperimentPlan, listExperiments, readExperiment } from "./experiments";
import { failurePatternsFromJourneys } from "./journey-patterns";
import type { ExecutionPlan } from "@wringer/plan";
import { readJobLoopInspection } from "./loop-inspection";
import { readReplicateSet, type ReplicateSetInput } from "./replicates";
import { readValidatedContainedState } from "@wringer/workflow";

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

/** A replicate set beside the job's connected comparisons. Registration takes the job's
 * approved plan and the source tree its own journey measured; nothing is inferred. */
export async function jobReplicateLocation(root: string, jobId: string, setId: string, register?: { taskFamily: string; k: number; wallClockSeconds: number }) {
    id(setId);
    const current = await jobImprovementContext(root, jobId), link = await improvementConnection(current.controller, current.profile.repository.url);
    if (!link) throw new Error("Connect this job's future improvements first with experiment connect --job and --task-family");
    const state = await experimentPath(link.researchRoot, `replicate-sets/${setId}`);
    if (!register) {
        const retained = await readReplicateSet(state);
        if (retained.set.id !== setId || retained.set.repository !== link.repository || retained.set.taskFamily !== link.taskFamily) throw new Error("The retained replicate set belongs to another repository or task family");
        return { state };
    }
    if (register.taskFamily !== link.taskFamily) throw new Error("The replicate set must use this workspace's connected task family");
    if (!current.plan) throw new Error("This request has no approved plan yet; a replicate set repeats an approved plan");
    let sourceTree: string;
    try { sourceTree = (await readValidatedContainedState(assistantControllerState(current.controller, jobId), { allowStaleView: true })).environment.source_tree; }
    catch { throw new Error("Run the job first: a replicate set pins the source tree its journey measured, before any attempt"); }
    await createAssistantDirectory(state);
    const input: ReplicateSetInput = { id: setId, taskFamily: register.taskFamily, plan: current.plan, k: register.k, sourceTree, wallClockSeconds: register.wallClockSeconds };
    return { state, input };
}
/** A proposal's private directory beside the job's comparisons and replicate sets. */
export async function jobProposalLocation(root: string, jobId: string, proposalId: string, create = false) {
    id(proposalId);
    const current = await jobImprovementContext(root, jobId), link = await improvementConnection(current.controller, current.profile.repository.url);
    if (!link) throw new Error("Connect this job's future improvements first with experiment connect --job and --task-family");
    const state = await experimentPath(link.researchRoot, `proposals/${proposalId}`);
    if (create) await createAssistantDirectory(state);
    else await privateExperimentRoot(state);
    return { state, researchRoot: link.researchRoot, repository: link.repository, taskFamily: link.taskFamily };
}
/** Every held-out task identity and source tree of the job's connected comparisons:
 * a job-form evidence build fences them all, never a hand-picked list. */
export async function jobEvidenceFence(researchRoot: string, repository: string) {
    const rows = await listExperiments(researchRoot, { repository });
    return rows.flatMap(row => row.plan.tasks.filter(task => task.split === "held-out").flatMap(task => [task.id, task.sourceTree]));
}

