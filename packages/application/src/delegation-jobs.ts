import { join } from "node:path";
import { hashValue, validateExecutionPlan } from "@wringer/plan";
import { git, Redactor } from "@wringer/engine";
import { assistantExists, assistantId, assistantInventory, assistantPath, createAssistantDirectory, readAssistantRecord, withAssistantProposalLock, writeAssistantRecord } from "./assistant-store";
import { readWorkspace } from "./workspaces";
import { applyDelegationProfile, inspectDelegationProfile, type DelegationSelection } from "./delegation-profile";
import { initializeAssistant, createAssistantService, assistantControllerState } from "./assistant";
import { readJobLoopInspection } from "./loop-inspection";
import { localSourceSiblings } from "./assistant-local-source";
import { inheritWorkspaceImprovements } from "./job-improvements";
interface Context {
    schema_version: "wringer.delegation-context.v1"; id: string; workspaceId: string; profileId: string; intent: string;
    parentJobId: string | null; createdAt: string; destination: { remote: string; sourceBranch: string; targetBranch: string } | null;
}
export interface DelegationJob {
    schema_version: "wringer.delegation-job.v1"; id: string; workspaceId: string; contextId: string; mode: "delegation";
    intent: string; source: { url: string; commit: string }; parentJobId: string | null; createdAt: string;
}
export async function delegationControllerRoot(root: string, workspaceId: string, contextId: string) { return assistantPath(root, `delegation-controllers/${assistantId(workspaceId)}/${assistantId(contextId)}`); }
export async function readDelegationContext(root: string, workspaceId: string, contextId: string): Promise<Context> {
    const value = await readAssistantRecord<Context>(root, `delegation-contexts/${assistantId(workspaceId)}/${assistantId(contextId)}.json`);
    if (value.schema_version !== "wringer.delegation-context.v1" || value.id !== contextId || value.workspaceId !== workspaceId) throw new Error("Delegation context identity changed");
    assistantId(value.profileId); return value;
}
async function deriveDelegationJob(root: string, context: Context, id: string): Promise<DelegationJob> {
    const controller = await delegationControllerRoot(root, context.workspaceId, context.id), service = await createAssistantService(controller);
    const proposal = await service.inspectProposal(assistantId(id)), status = await service.status(id);
    const value: DelegationJob = { schema_version: "wringer.delegation-job.v1", id, workspaceId: context.workspaceId, contextId: context.id, mode: "delegation", intent: proposal.intent, source: service.workspace.profile.repository, parentJobId: status.lineage?.parentJobId ?? context.parentJobId, createdAt: context.createdAt };
    return value;
}
export async function retainDelegationJob(root: string, context: Context, id: string): Promise<DelegationJob> {
    const value = await deriveDelegationJob(root, context, id);
    await writeAssistantRecord(root, `delegation-jobs/${id}.json`, value); return value;
}
export async function readDelegationJob(root: string, id: string): Promise<DelegationJob> {
    assistantId(id);
    if (!await assistantExists(root, `delegation-jobs/${id}.json`)) {
        // A lost response may occur after proposal commit but before the public
        // index. Recover only a retained proposal from an owned context.
        for (const workspace of await assistantInventory(root, "delegation-contexts")) for (const name of await assistantInventory(root, `delegation-contexts/${assistantId(workspace)}`)) {
            if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
            const context = await readDelegationContext(root, workspace, name.slice(0, -5)), controller = await delegationControllerRoot(root, workspace, context.id);
            if (await assistantExists(controller, `jobs/${id}/proposal.json`)) return deriveDelegationJob(root, context, id);
        }
    }
    const value = await readAssistantRecord<DelegationJob>(root, `delegation-jobs/${id}.json`);
    if (value.schema_version !== "wringer.delegation-job.v1" || value.id !== id || value.mode !== "delegation") throw new Error("Delegation job index identity changed");
    const context = await readDelegationContext(root, value.workspaceId, value.contextId), controller = await delegationControllerRoot(root, value.workspaceId, value.contextId);
    const proposal = await readAssistantRecord<any>(controller, `jobs/${id}/proposal.json`), workspace = await readAssistantRecord<any>(controller, "workspace.json");
    if (proposal.id !== id || proposal.workspaceId !== workspace.id || proposal.intent !== value.intent || hashValue(workspace.profile.repository) !== hashValue(value.source)) throw new Error("Delegation job index differs from its retained proposal/source");
    validateExecutionPlan(workspace.profile); if (context.parentJobId && value.parentJobId === null) throw new Error("Delegation job lost its parent identity");
    return value;
}
/** Explicit job preparation snapshots clean source under the reusable profile
 * choices. Git metadata/bundle operations only; no repository code or role runs. */
export async function createDelegationJob(root: string, workspaceId: string, input: { intent: string; idempotencyKey: string; parentJobId?: string }) {
    const workspace = await readWorkspace(root, workspaceId), id = assistantId(input.idempotencyKey), redactor = new Redactor();
    if (workspace.mode !== "delegation" || !workspace.preferences.profileId) throw new Error("This workspace has no reviewed contained profile");
    if (typeof input.intent !== "string" || !input.intent.trim() || Buffer.byteLength(input.intent) > 16384 || input.intent.includes("\0") || redactor.scrub(input.intent) !== input.intent) throw new Error("Supply bounded original request words without credentials");
    if (input.parentJobId && (await readDelegationJob(root, input.parentJobId)).workspaceId !== workspaceId) throw new Error("The parent job belongs to another workspace");
    const lockRoot = await createAssistantDirectory(await assistantPath(root, `delegation-preparation/${workspaceId}`));
    return withAssistantProposalLock(lockRoot, async () => {
        const contextFile = `delegation-contexts/${workspaceId}/${id}.json`;
        let context: Context;
        if (await assistantExists(root, contextFile)) {
            context = await readDelegationContext(root, workspaceId, id);
            if (context.intent !== input.intent || context.parentJobId !== (input.parentJobId ?? null)) throw new Error("This idempotency key names a different original request or parent");
        } else {
            const selected = await readAssistantRecord<any>(root, `profiles/${assistantId(workspace.preferences.profileId)}/profile-record.json`);
            if (selected.schema_version !== "wringer.delegation-profile.v1" || selected.id !== workspace.preferences.profileId || selected.repo !== workspace.repo || selected.boundary.approval !== "cooperative-local") throw new Error("The workspace profile binding changed");
            const preview = await inspectDelegationProfile(root, workspace.repo, selected.selection as DelegationSelection);
            const profile = await applyDelegationProfile(root, preview, { expectedIdentity: preview.identity, actor: "Automated source preparation under registered workspace choices", cooperativeLocal: true });
            let destination: Context["destination"] = null;
            if (workspace.preferences.destination) {
                const selectedDestination = workspace.preferences.destination, remote = (await git(workspace.repo, ["remote", "get-url", selectedDestination.remote])).stdout.trim();
                if (redactor.scrub(remote) !== remote) throw new Error("The destination contains a credential");
                destination = { remote, sourceBranch: `wringer/job-${id}`, targetBranch: selectedDestination.base };
            }
            context = { schema_version: "wringer.delegation-context.v1", id, workspaceId, profileId: profile.id, intent: input.intent, parentJobId: input.parentJobId ?? null, createdAt: new Date().toISOString(), destination };
            await writeAssistantRecord(root, contextFile, context);
        }
        const controller = await delegationControllerRoot(root, workspaceId, id), profile = await readAssistantRecord<any>(root, `profiles/${context.profileId}/profile-record.json`);
        if (workspace.boundary.execution !== (profile.plan.runtime.kind === "trusted-local" ? "trusted-local" : "contained")) throw new Error("The workspace's recorded execution boundary differs from its profile's runtime; nothing was prepared");
        const initialized = await initializeAssistant(controller, { plan: profile.plan, cooperativeLocal: true, ...(context.destination ? { destination: context.destination } : {}), ...(profile.selection.source.kind === "local" ? { localSource: localSourceSiblings(join(root, "profiles", context.profileId, "profile.json")) } : {}) });
        if (context.destination) await writeAssistantRecord(controller, "destination-policy.json", { schema_version: "wringer.proposal-destination-policy.v1", workspaceId: initialized.workspace.id, uniqueProposalBranches: true });
        const service = await createAssistantService(controller);
        await inheritWorkspaceImprovements(root, workspaceId, controller, profile.plan);
        const proposed = await service.recordProposal({ workspaceId: initialized.workspace.id, idempotencyKey: id, proposal: { intent: input.intent, title: "Prepare the requested work", questions: ["Which requirement criteria, measured checks and result displays will establish this request? Ask the coding assistant to validate and revise this proposal before approval."] } });
        if (proposed.isError) throw new Error(String(proposed.message));
        return retainDelegationJob(root, context, String(proposed.jobId));
    });
}
export async function delegationJobStatus(root: string, jobId: string) {
    const job = await readDelegationJob(root, jobId), service = await createAssistantService(await delegationControllerRoot(root, job.workspaceId, job.contextId));
    const view = await service.status(jobId), workspace = await readWorkspace(root, job.workspaceId);
    // The local CLI is an operator-owned observation, not a minted MCP session.
    return { schema_version: "wringer.delegation-job-status.v1", jobId, workspaceId: job.workspaceId, mode: "delegation", revision: view.revision, outcome: view.outcome, phase: view.stage, uncertainty: view.uncertainty, operationIds: view.operations.map((operation: any) => operation.operationId), stopCodes: view.stop ? [view.stop.reason] : [], approvalExpiresAt: (await service.inspectApproval(jobId))?.authority.expires_at ?? null, candidateIdentity: view.candidateTree, nextAction: view.nextAction, remaining: { ceilings: view.usage.development.limits, measured: view.usage.development.measured, monetaryCost: null }, parentJobId: job.parentJobId, source: job.source, boundary: { approval: "cooperative-local", execution: workspace.boundary.execution } };
}
export async function inspectDelegationLoop(root: string, jobId: string) {
    const job = await readDelegationJob(root, jobId), controller = await delegationControllerRoot(root, job.workspaceId, job.contextId);
    const service = await createAssistantService(controller), proposal = await service.inspectProposal(jobId), status = await service.status(jobId);
    return readJobLoopInspection(proposal.plan, status.stage === "intake" ? undefined : assistantControllerState(controller, jobId));
}
