import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { compileExecutionPlan, hashValue } from "@wringer/plan";
import { assistantControllerState, createAssistantService, initializeAssistant, issueAssistantCapability } from "../../application/src/assistant";
import { createAssistantJobFlow } from "../src/assistant-job";

const roots: string[] = [], flows: ReturnType<typeof createAssistantJobFlow>[] = [], services: Awaited<ReturnType<typeof createAssistantService>>[] = [];
afterEach(async () => { for (const flow of flows.splice(0)) flow.stop(); for (const service of services.splice(0)) await service.runner.stop(50); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const profile = compileExecutionPlan(await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
const scratch = async () => { const path = await realpath(await mkdtemp(join(tmpdir(), "wringer-pm-job-"))); roots.push(path); return path; };
async function fixture() {
    const root = await scratch(), { workspace } = await initializeAssistant(root, { cooperativeLocal: true, plan: profile });
    const capability = await issueAssistantCapability(root, new Date(Date.now() + 60000).toISOString()); let starts = 0;
    const service = await createAssistantService(root, { dependencies: { start: async () => { starts++; throw new Error("No model or runtime belongs in this fixture"); } } }); services.push(service);
    const proposed = await service.call(capability.token, "wringer.propose", { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), plan: profile, intent: profile.intent });
    const jobId = proposed.jobId as string, flow = createAssistantJobFlow(service); flows.push(flow);
    return { root, service, jobId, flow, starts: () => starts };
}
test("automatic coordination cannot start an unapproved job, and reading never answers for a person", async () => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) { await f.flow.tick(); expect((await f.flow.read(f.jobId)).phase).toBe("approval"); }
    expect(await f.service.inspectApproval(f.jobId)).toBeNull(); expect(await f.service.runner.list()).toEqual([]); expect(f.starts()).toBe(0);
});
test("job decisions reject stale revisions, foreign handles and unexpected fields before any approval", async () => {
    const f = await fixture(), current = await f.flow.read(f.jobId);
    const approved = { jobId: f.jobId, expectedRevision: current.readyRevision, actor: "Explicit fixture person" };
    for (const wrong of [{ ...approved, expectedRevision: "0".repeat(64) }, { ...approved, jobId: crypto.randomUUID() }, { ...approved, grantMoreSpend: true }, { ...approved, actor: "" }]) await expect(f.flow.post("approve", wrong)).rejects.toThrow();
    await expect(f.flow.post("decision", { jobId: f.jobId, expectedRevision: current.readyRevision, expectedCandidateTree: null, verdict: "met", displayIds: [crypto.randomUUID()] })).rejects.toThrow();
    expect(await f.service.inspectApproval(f.jobId)).toBeNull(); expect(await f.service.runner.list()).toEqual([]);
    expect((await f.flow.post("approve", approved)) as any).toMatchObject({ outcome: "approved" });
    expect((await f.service.inspectApproval(f.jobId))?.authority.actor).toBe(approved.actor);
    expect(f.starts()).toBe(0); f.flow.stop(); await f.flow.tick(); expect(await f.service.runner.list()).toEqual([]);
    await expect(f.flow.post("approve", approved)).rejects.toThrow();
});
for (const operation of ["approve", "start"]) test(`shutdown during an awaited read cannot ${operation === "approve" ? "grant approval" : "automatically enqueue a start"}`, async () => {
        const f = await fixture(), before = await f.flow.read(f.jobId);
        const body = { jobId: f.jobId, expectedRevision: before.readyRevision, actor: "Explicit fixture person" };
        if (operation === "start") await f.flow.post("approve", body);
        f.flow.stop();
        let release!: () => void, entered!: () => void;
        const waiting = new Promise<void>(resolve => { release = resolve; }), reached = new Promise<void>(resolve => { entered = resolve; });
        const service = { ...f.service, inspectProposal: async (jobId: string) => { entered(); await waiting; return f.service.inspectProposal(jobId); } };
        const flow = createAssistantJobFlow(service); flows.push(flow);
        const pending = operation === "start" ? flow.tick() : flow.post("approve", body);
        await reached; flow.stop(); release();
        if (operation === "approve") { await expect(pending).rejects.toThrow(); expect(await f.service.inspectApproval(f.jobId)).toBeNull(); }
        else { await pending; expect(await f.service.runner.list()).toEqual([]); }
        expect(f.starts()).toBe(0);
});
const purposeId = (jobId: string, candidate: string | null, purpose: string) => { const h = hashValue({ schema: "wringer.pm-convenience.v1", jobId, candidate, purpose, attempt: 0 }); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`; };
async function recordCommand(state: string, commandId: string, action: "show" | "prepare-delivery" | "publish", status: "failed" | "uncertain" | "completed", revision: string, candidate: string, preparedId?: string) {
    const command = { idempotencyKey: commandId, expectedRevision: revision, expectedCandidateTree: candidate, action, payload: action === "show" ? { criterionId: "readable" } : action === "publish" ? { preparedId } : { remote: "/tmp/fixture-origin.git", sourceBranch: "review/example", targetBranch: "main" } };
    const owner = { schema_version: "wringer.workspace-operation.v1", commandId, requestSha256: hashValue(command), pid: process.pid, token: crypto.randomUUID(), at: new Date().toISOString() };
    const base = join(state, ".wringer/application/commands", commandId);
    await mkdir(base, { recursive: true });
    await writeFile(join(base, "request.json"), JSON.stringify({ schema_version: "wringer.workspace-command.v2", command, sha256: hashValue(command), owner, at: owner.at }));
    const body = { schema_version: "wringer.workspace-command-result.v2", requestSha256: hashValue(command), at: owner.at, commandId, status, ...(status === "completed" ? { result: {} } : { error: "Explicit synthetic failed/uncertain observation" }) };
    await writeFile(join(base, "result.json"), JSON.stringify({ ...body, sha256: hashValue(body) }));
}
test("automatic showing and preparation observe failed or uncertain attempts without retrying them", async () => {
    // Construction-only service fixture with real immutable command readers.
    // It has no controller, executable dependency or network transport.
    for (const purpose of ["show/readable", "prepare"]) for (const status of ["failed", "uncertain"] as const) {
        const root = await scratch(), jobId = crypto.randomUUID(), state = assistantControllerState(root, jobId), candidate = "b".repeat(40), revision = "c".repeat(64), commandId = purposeId(jobId, candidate, purpose);
        const plan = structuredClone(profile);
        if (purpose.startsWith("show")) plan.acceptance.criteria.push({ id: "readable", title: "Synthetic display", quote: plan.intent, kind: "human", required: true, show: { id: "show", argv: ["true"], cwd: ".", timeout_seconds: 5 } });
        await recordCommand(state, commandId, purpose === "prepare" ? "prepare-delivery" : "show", status, revision, candidate);
        let admission = 0, routines = 0;
        const view = { jobId, stage: "intake", revision, candidateTree: candidate, outcome: purpose === "prepare" ? "review-ready" : "human-hold", uncertainty: false, requirements: [], operations: [], publication: null };
        const service = { root, workspace: { profile: plan }, inspectProposal: async () => ({ plan, intent: plan.intent, questions: [], assumptions: [] }), status: async () => view, inspectApproval: async () => ({ authority: { actor: "Fixture person", expires_at: new Date(Date.now() + 60000).toISOString() }, destination: { remote: "/tmp/fixture-origin.git", sourceBranch: "review/example", targetBranch: "main" } }), assertJobActive: async () => { admission++; }, list: async () => [view], requestRoutine: async () => { routines++; throw new Error("No routine should be replayed"); } } as unknown as Awaited<ReturnType<typeof createAssistantService>>;
        const flow = createAssistantJobFlow(service); flows.push(flow);
        for (let i = 0; i < 3; i++) await flow.tick();
        expect((await flow.read(jobId)).phase).toBe("blocked"); expect(admission).toBe(0); expect(routines).toBe(0);
        expect(await readdir(dirname(join(state, ".wringer/application/commands", commandId)))).toEqual([commandId]);
        flow.stop();
    }
});
test("reopening a job preserves an uncertain send as a stop, not another handover invitation", async () => {
    const root = await scratch(), jobId = crypto.randomUUID(), state = assistantControllerState(root, jobId), candidate = "b".repeat(40), revision = "c".repeat(64), preparedId = purposeId(jobId, candidate, "prepare");
    await recordCommand(state, preparedId, "prepare-delivery", "completed", revision, candidate);
    const view = { jobId, stage: "intake", revision, candidateTree: candidate, outcome: "review-ready", uncertainty: false, requirements: [], operations: [], publication: null };
    const service = { root, workspace: { profile }, inspectProposal: async () => ({ plan: profile, intent: profile.intent, questions: [], assumptions: [] }), status: async () => view, inspectApproval: async () => ({ authority: { actor: "Fixture person", expires_at: new Date(Date.now() + 60000).toISOString() }, destination: { remote: "/tmp/fixture-origin.git", sourceBranch: "review/example", targetBranch: "main" } }), list: async () => [view] } as unknown as Awaited<ReturnType<typeof createAssistantService>>;
    const first = createAssistantJobFlow(service); flows.push(first);
    const shown = await first.read(jobId); expect(shown.phase).toBe("send"); first.stop();
    const commandId = purposeId(jobId, candidate, `send/${preparedId}`);
    await recordCommand(state, commandId, "publish", "uncertain", revision, candidate, preparedId);
    const reopened = createAssistantJobFlow(service); flows.push(reopened);
    const observed = await reopened.read(jobId);
    expect(observed.phase).toBe("blocked"); expect(observed.retryable).toBe(false); expect(observed.nextAction.toLowerCase()).toContain("uncertain");
});
