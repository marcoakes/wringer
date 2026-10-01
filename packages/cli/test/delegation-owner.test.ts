import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, realpath, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileExecutionPlan } from "@wringer/plan";
import { createAssistantDirectory, writeAssistantRecord, initializeAssistant, createAssistantService, retainDelegationJob } from "@wringer/application";
import { createDelegationOwner } from "../src/delegation-owner";
import { readAssistantConnection, callAssistantConnection } from "../src/assistant-transport";
import { dispatch } from "../src/app";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
test("T07 T16 registered delegation joins CLI, versioned MCP and one operator origin without starting unapproved work", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-delegation-owner-"))); cleanup.push(() => rm(root, { recursive: true, force: true }));
    await createAssistantDirectory(root);
    const workspaceId = crypto.randomUUID(), contextId = crypto.randomUUID(), profileId = crypto.randomUUID();
    const plan = compileExecutionPlan(await Bun.file(new URL("../../plan/examples/contained.yaml", import.meta.url)).text(), { format: "yaml" });
    await writeAssistantRecord(root, `workspaces/${workspaceId}.json`, { schema_version: "wringer.workspace.v2", id: workspaceId, mode: "delegation", repo: join(root, "fixture-repo"), client: "generic", preferences: { destination: null, profileId, credentialReferences: [] }, boundary: { approval: "cooperative-local", execution: "contained" }, createdAt: new Date().toISOString() });
    const context = { schema_version: "wringer.delegation-context.v1" as const, id: contextId, workspaceId, profileId, intent: plan.intent, parentJobId: null, destination: null, createdAt: new Date().toISOString() };
    await writeAssistantRecord(root, `delegation-contexts/${workspaceId}/${contextId}.json`, context);
    const controllerRoot = join(root, "delegation-controllers", workspaceId, contextId), initialized = await initializeAssistant(controllerRoot, { plan, cooperativeLocal: true }), controller = await createAssistantService(controllerRoot);
    const first = await controller.recordProposal({ workspaceId: initialized.workspace.id, idempotencyKey: crypto.randomUUID(), proposal: { intent: plan.intent, title: "Pending fixture", questions: ["Which behavior?"] } });
    expect(first.jobId).toBeString(); await retainDelegationJob(root, context, first.jobId as string);
    // A crashed historical preparation must not make newer retained jobs disappear.
    const incomplete = { ...context, id: crypto.randomUUID(), createdAt: "2000-01-01T00:00:00.000Z" };
    await writeAssistantRecord(root, `delegation-contexts/${workspaceId}/${incomplete.id}.json`, incomplete);
    const owner = await createDelegationOwner(root, workspaceId); cleanup.push(() => owner.stop());
    const connection = await readAssistantConnection(owner.connectionPath); expect(connection.schema_version).toBe("wringer.assistant-connection.v3");
    const beforeValidation = (await readdir(root, { recursive: true })).sort();
    const validation = await callAssistantConnection(owner.connectionPath, "wringer.validate_proposal", { workspaceId, proposal: { intent: plan.intent, title: "Pending", questions: ["Which behavior?"] } });
    expect(validation.valid).toBeTrue(); expect((await readdir(root, { recursive: true })).sort()).toEqual(beforeValidation);
    const observed = await callAssistantConnection(owner.connectionPath, "wringer.get_status", { jobId: first.jobId });
    expect(observed.mode).toBe("delegation"); expect(observed.workspaceId).toBe(workspaceId); expect(observed.outcome).toBe("needs-decision");
    expect(JSON.stringify(observed)).not.toContain("#token=");
    const setup = await callAssistantConnection(owner.connectionPath, "wringer.inspect_setup", {}); expect(setup.workspaceId).toBe(workspaceId);
    const status: any = (await dispatch(["job", "status", "--app-dir", root, "--job", first.jobId as string])).value; expect(status.mode).toBe("delegation");
    const loop = await callAssistantConnection(owner.connectionPath, "wringer.inspect_loop", { jobId: first.jobId });
    expect(loop.outcome).toBe("refused"); // Questions are not a compiled job plan.
    await expect(dispatch(["job", "loop", "--app-dir", root, "--job", first.jobId as string])).rejects.toThrow("compiled job plan");
    const complete = await controller.recordProposal({ workspaceId: initialized.workspace.id, idempotencyKey: crypto.randomUUID(), proposal: { intent: plan.intent, title: plan.name, criteria: plan.acceptance.criteria, checks: plan.acceptance.checks.map(({ id, criteria }) => ({ id, criteria })) } });
    await retainDelegationJob(root, context, complete.jobId as string);
    const compiledLoop = await callAssistantConnection(owner.connectionPath, "wringer.inspect_loop", { jobId: complete.jobId });
    const cliLoop = (await dispatch(["job", "loop", "--app-dir", root, "--job", complete.jobId as string])).value;
    expect(compiledLoop.schema_version).toBe("wringer.loop-inspection.v1"); expect(cliLoop).toEqual(compiledLoop);
    const list: any = (await dispatch(["job", "list", "--app-dir", root, "--workspace", workspaceId])).value; expect(list.jobs.map((job: any) => job.jobId)).toContain(first.jobId);
    expect((await fetch(owner.page + "/api/jobs")).status).toBe(401);
    const shell = await (await fetch(owner.page)).text(); expect(shell).not.toContain(plan.intent); expect(shell).not.toContain(connection.token);
    expect(await controller.inspectApproval(first.jobId as string)).toBeNull(); expect(await controller.runner.list(first.jobId as string)).toEqual([]);
}, 15000);

test("T08 T16 more than 128 retained contexts remain observable without acquiring runners or writing on reads", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-owner-history-"))); cleanup.push(() => rm(root, { recursive: true, force: true }));
    await createAssistantDirectory(root);
    const workspaceId = crypto.randomUUID(), profileId = crypto.randomUUID();
    const plan = compileExecutionPlan(await Bun.file(new URL("../../plan/examples/contained.yaml", import.meta.url)).text(), { format: "yaml" });
    await writeAssistantRecord(root, `workspaces/${workspaceId}.json`, { schema_version: "wringer.workspace.v2", id: workspaceId, mode: "delegation", repo: join(root, "fixture-repo"), client: "generic", preferences: { destination: null, profileId, credentialReferences: [] }, boundary: { approval: "cooperative-local", execution: "contained" }, createdAt: new Date().toISOString() });
    const contexts = [], jobs: string[] = [];
    for (let n = 0; n < 130; n++) {
        const context = { schema_version: "wringer.delegation-context.v1" as const, id: crypto.randomUUID(), workspaceId, profileId, intent: plan.intent, parentJobId: null, destination: null, createdAt: new Date().toISOString() };
        contexts.push(context);
        await writeAssistantRecord(root, `delegation-contexts/${workspaceId}/${context.id}.json`, context);
        const controllerRoot = join(root, "delegation-controllers", workspaceId, context.id), initialized = await initializeAssistant(controllerRoot, { plan, cooperativeLocal: true });
        const service = await createAssistantService(controllerRoot);
        const proposal = await service.recordProposal({ workspaceId: initialized.workspace.id, idempotencyKey: crypto.randomUUID(), proposal: { intent: plan.intent, title: "Retained question", questions: ["Which behavior?"] } });
        jobs.push(proposal.jobId as string); await retainDelegationJob(root, context, proposal.jobId as string);
    }
    const owner = await createDelegationOwner(root, workspaceId); cleanup.push(() => owner.stop());
    expect((await readdir(root, { recursive: true })).filter(name => name.endsWith("/runner/owner.json"))).toEqual([]);
    const before = (await readdir(root, { recursive: true })).sort();
    for (const jobId of [jobs[0], jobs[129]]) {
        const status = await callAssistantConnection(owner.connectionPath, "wringer.get_status", { jobId });
        expect(status.outcome).toBe("needs-decision");
    }
    const page = await callAssistantConnection(owner.connectionPath, "wringer.list_jobs", { offset: 125, limit: 5 });
    expect(page.jobs).toHaveLength(5); expect(page.nextOffset).toBeNull();
    expect((await readdir(root, { recursive: true })).sort()).toEqual(before);
}, 60000);

test("T16 a partial owned connection write is cleaned up without deleting a pre-existing file", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-owner-partial-"))); cleanup.push(() => rm(root, { recursive: true, force: true })); await createAssistantDirectory(root);
    const id = crypto.randomUUID(); await writeAssistantRecord(root, `workspaces/${id}.json`, { schema_version: "wringer.workspace.v2", id, mode: "delegation", repo: join(root, "inert-fixture"), client: "generic", preferences: { destination: null, profileId: crypto.randomUUID(), credentialReferences: [] }, boundary: { approval: "cooperative-local", execution: "contained" }, createdAt: new Date().toISOString() });
    const fs = await import("node:fs/promises"), original = fs.writeFile;
    const spy = spyOn(fs, "writeFile").mockImplementation((async (...args: any[]) => {
        await (original as any)(...args);
        if (typeof args[1] === "string" && args[1].includes('"schema_version":"wringer.assistant-connection.v3"')) throw new Error("Injected write failure after owned bytes reached disk");
    }) as typeof fs.writeFile);
    try {
        await expect(createDelegationOwner(root, id)).rejects.toThrow("Injected write failure");
        expect(await Bun.file(join(root, "owners", id, "connection.json")).exists()).toBeFalse();
        expect(await Bun.file(join(root, "owners", id, "owner.lock")).exists()).toBeFalse();
    } finally { spy.mockRestore(); }
    const path = join(root, "owners", id, "connection.json"); await fs.writeFile(path, "unrelated existing bytes", { mode: 0o600 });
    await expect(createDelegationOwner(root, id)).rejects.toThrow();
    expect(await Bun.file(path).text()).toBe("unrelated existing bytes");
});

test("R-1 a trusted-local workspace answers through the owner in the sibling versions that admit its boundary", async () => {
    const { applyDelegationProfile, createDelegationJob, inspectDelegationProfile, registerWorkspace } = await import("@wringer/application");
    const { git } = await import("@wringer/engine");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-owner-trusted-local-"))); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const repo = join(root, "repo"), app = join(root, "app"); await mkdir(join(repo, "src"), { recursive: true }); await mkdir(join(repo, "tests"));
    await git(repo, ["init", "--initial-branch=main"]); await git(repo, ["config", "user.name", "Automated fixture"]); await git(repo, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(join(repo, "src/value.ts"), "export const value = 1;\n"); await writeFile(join(repo, "tests/check.ts"), 'throw new Error("Inspection must not run me");\n');
    await writeFile(join(repo, "package.json"), JSON.stringify({ packageManager: "bun@1.4.2", scripts: { test: "bun tests/check.ts" } }));
    await git(repo, ["add", "."]); await git(repo, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    await createAssistantDirectory(app);
    const preview = await inspectDelegationProfile(app, repo, { runtime: "trusted-local", worker: { adapter: "claude-agent-acp" }, judge: { adapter: "codex-acp" }, source: { kind: "local" }, dependencies: "none" } as any);
    const profile = await applyDelegationProfile(app, preview, { expectedIdentity: preview.identity, actor: "Automated fixture operator", cooperativeLocal: true });
    const workspace = await registerWorkspace(app, { repo, mode: "delegation", client: "claude-code", execution: "trusted-local", profileId: profile.id });
    const job = await createDelegationJob(app, workspace.id, { intent: "Return the value as 5.", idempotencyKey: crypto.randomUUID() });
    const owner = await createDelegationOwner(app, workspace.id); cleanup.push(() => owner.stop());
    // Each answer passes the owner's own output validation; none is refused for its boundary.
    const setup = await callAssistantConnection(owner.connectionPath, "wringer.inspect_setup", {});
    expect(setup.schema_version).toBe("wringer.delegation-setup.v2"); expect(setup.boundary).toEqual({ approval: "cooperative-local", execution: "trusted-local" });
    const status: any = await callAssistantConnection(owner.connectionPath, "wringer.get_status", { jobId: job.id });
    expect(status.schema_version).toBe("wringer.assistant-response.v3"); expect(status.outcome).toBe("needs-decision"); expect(status.boundary.execution).toBe("trusted-local");
    const listed: any = await callAssistantConnection(owner.connectionPath, "wringer.list_jobs", {}); expect(listed.jobs.map((row: any) => row.jobId)).toContain(job.id);
    const validation = await callAssistantConnection(owner.connectionPath, "wringer.validate_proposal", { workspaceId: workspace.id, proposal: { intent: "Return the value as 5.", title: "Return five", criteria: [{ id: "test", title: "The existing test passes", quote: "Return the value as 5.", kind: "check", required: true }], checks: [{ id: "test", criteria: ["test"] }], scope: { writable: ["src"] } } });
    expect(validation.valid).toBeTrue();
    // Answering the job's questions supersedes its proposal with a v5 plan: the transition is the v2 sibling.
    const revised = await callAssistantConnection(owner.connectionPath, "wringer.revise_proposal", { jobId: job.id, idempotencyKey: crypto.randomUUID(), expectedRevision: status.revision, proposal: { intent: "Return the value as 5.", title: "Return five", criteria: [{ id: "test", title: "The existing test passes", quote: "Return the value as 5.", kind: "check", required: true }], checks: [{ id: "test", criteria: ["test"] }], scope: { writable: ["src"] } } });
    expect(revised.outcome).toBe("awaiting-approval"); expect(revised.schema_version).toBe("wringer.assistant-response.v3");
    const request = await callAssistantConnection(owner.connectionPath, "wringer.get_approval_request", { jobId: revised.jobId });
    expect(request.outcome).toBe("awaiting-approval");
    expect(JSON.stringify(await callAssistantConnection(owner.connectionPath, "wringer.get_status", { jobId: job.id }))).toContain("superseded");
}, 30000);
