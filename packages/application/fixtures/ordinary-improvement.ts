import { mkdtemp, realpath, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileExecutionPlan } from "@wringer/plan";
import { createAssistantDirectory, writeAssistantRecord, initializeAssistant, createAssistantService, retainDelegationJob } from "../src";
import { createImprovementsBrowserFixture } from "./improvement-comparison";
export async function ordinaryImprovementFixture(existingRoot?: string) {
    const root = existingRoot ?? await realpath(await mkdtemp(join(tmpdir(), "wringer-job-improvements-")));
    await createAssistantDirectory(root);
    const workspaceId = crypto.randomUUID(), contextId = crypto.randomUUID(), profileId = crypto.randomUUID();
    const template = compileExecutionPlan(await Bun.file(new URL("../../plan/examples/contained.yaml", import.meta.url)).text(), { format: "yaml" });
    const { baseline: plan, experiment } = createImprovementsBrowserFixture(template, process.platform);
    await writeAssistantRecord(root, `workspaces/${workspaceId}.json`, { schema_version: "wringer.workspace.v2", id: workspaceId, mode: "delegation", repo: join(root, "fixture-repo"), client: "generic", preferences: { destination: null, profileId, credentialReferences: [] }, boundary: { approval: "cooperative-local", execution: "contained" }, createdAt: new Date().toISOString() });
    const context = { schema_version: "wringer.delegation-context.v1" as const, id: contextId, workspaceId, profileId, intent: plan.intent, parentJobId: null, destination: null, createdAt: new Date().toISOString() };
    await writeAssistantRecord(root, `delegation-contexts/${workspaceId}/${contextId}.json`, context);
    const controllerRoot = join(root, "delegation-controllers", workspaceId, contextId), initialized = await initializeAssistant(controllerRoot, { plan, cooperativeLocal: true }), controller = await createAssistantService(controllerRoot);
    const first = await controller.recordProposal({ workspaceId: initialized.workspace.id, idempotencyKey: crypto.randomUUID(), proposal: { intent: plan.intent, title: "Pending fixture", questions: ["Which behavior?"] } });
    await retainDelegationJob(root, context, first.jobId as string);
    return { root, workspaceId, context, controllerRoot, controller, jobId: first.jobId as string, plan, experiment };
}
