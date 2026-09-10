import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { compileExecutionPlan, hashValue } from "@wringer/plan";
import { assistantControllerState, createAssistantService, initializeAssistant, issueAssistantCapability } from "../../application/src/assistant";
import { createAssistantJobFlow } from "../src/assistant-job";

const roots: string[] = [], flows: ReturnType<typeof createAssistantJobFlow>[] = [], services: Awaited<ReturnType<typeof createAssistantService>>[] = [];
afterEach(async () => { for (const flow of flows.splice(0)) flow.stop(); for (const service of services.splice(0)) await service.runner.stop(50); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const profile = compileExecutionPlan(await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
const scratch = async () => { const path = await realpath(await mkdtemp(join(tmpdir(), "wringer-pm-job-"))); roots.push(path); return path; };
// Construction-only intake fixtures have no controller query. The production
// service supplies its validated query alongside the same public status.
const fixtureService = (value: Record<string, any>) => ({ ...value, inspectForPm: async (jobId: string) => ({ status: await value.status(jobId), query: null }) }) as Awaited<ReturnType<typeof createAssistantService>>;
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
test("one transient observation error cannot poison a later complete snapshot or replay work", async () => {
    const root = await scratch(), jobId = crypto.randomUUID(); let unreadableOnce = true, dispatches = 0;
    const view = { jobId, stage: "intake", revision: "a".repeat(64), candidateTree: null, outcome: "running", uncertainty: false, requirements: [], operations: [], publication: null };
    const service = fixtureService({ root, workspace: { profile }, inspectProposal: async () => ({ plan: profile, intent: profile.intent, questions: [], assumptions: [] }), status: async () => { if (unreadableOnce) { unreadableOnce = false; throw new Error("Synthetic transient controller initialization read"); } return view; }, inspectApproval: async () => ({ authority: { actor: "Synthetic fixture", expires_at: new Date(Date.now() + 60000).toISOString() }, destination: null }), list: async () => [view], requestRoutine: async () => { dispatches++; return { outcome: "accepted" }; } });
    const flow = createAssistantJobFlow(service); flows.push(flow);
    await flow.tick();
    expect((await flow.read(jobId)).phase).toBe("blocked");
    await flow.tick();
    const recovered = await flow.read(jobId);
    expect(recovered.phase).toBe("working"); expect(recovered.error).toBeNull(); expect(dispatches).toBe(0);
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
async function recordCommand(state: string, commandId: string, action: "show" | "prepare-delivery" | "publish", status: "running" | "failed" | "uncertain" | "completed", revision: string, candidate: string, preparedId?: string) {
    const command = { idempotencyKey: commandId, expectedRevision: revision, expectedCandidateTree: candidate, action, payload: action === "show" ? { criterionId: "readable" } : action === "publish" ? { preparedId } : { remote: "/tmp/fixture-origin.git", sourceBranch: "review/example", targetBranch: "main" } };
    const owner = { schema_version: "wringer.workspace-operation.v1", commandId, requestSha256: hashValue(command), pid: process.pid, token: crypto.randomUUID(), at: new Date().toISOString() };
    const base = join(state, ".wringer/application/commands", commandId);
    await mkdir(base, { recursive: true });
    await writeFile(join(base, "request.json"), JSON.stringify({ schema_version: "wringer.workspace-command.v2", command, sha256: hashValue(command), owner, at: owner.at }));
    if (status === "running") {
        await writeFile(join(state, ".wringer/application/operation.lock"), JSON.stringify(owner));
        return;
    }
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
        const service = fixtureService({ root, workspace: { profile: plan }, inspectProposal: async () => ({ plan, intent: plan.intent, questions: [], assumptions: [] }), status: async () => view, inspectApproval: async () => ({ authority: { actor: "Fixture person", expires_at: new Date(Date.now() + 60000).toISOString() }, destination: { remote: "/tmp/fixture-origin.git", sourceBranch: "review/example", targetBranch: "main" } }), assertJobActive: async () => { admission++; }, list: async () => [view], requestRoutine: async () => { routines++; throw new Error("No routine should be replayed"); } });
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
    const service = fixtureService({ root, workspace: { profile }, inspectProposal: async () => ({ plan: profile, intent: profile.intent, questions: [], assumptions: [] }), status: async () => view, inspectApproval: async () => ({ authority: { actor: "Fixture person", expires_at: new Date(Date.now() + 60000).toISOString() }, destination: { remote: "/tmp/fixture-origin.git", sourceBranch: "review/example", targetBranch: "main" } }), list: async () => [view] });
    const first = createAssistantJobFlow(service); flows.push(first);
    const shown = await first.read(jobId); expect(shown.phase).toBe("send"); first.stop();
    const commandId = purposeId(jobId, candidate, `send/${preparedId}`);
    await recordCommand(state, commandId, "publish", "uncertain", revision, candidate, preparedId);
    const reopened = createAssistantJobFlow(service); flows.push(reopened);
    const observed = await reopened.read(jobId);
    expect(observed.phase).toBe("blocked"); expect(observed.retryable).toBe(false); expect(observed.nextAction.toLowerCase()).toContain("uncertain");
});
test("a durable running Send remains observation-only after reopen and cannot be posted again", async () => {
    const root = await scratch(), jobId = crypto.randomUUID(), state = assistantControllerState(root, jobId), candidate = "b".repeat(40), revision = "c".repeat(64), preparedId = purposeId(jobId, candidate, "prepare");
    await recordCommand(state, preparedId, "prepare-delivery", "completed", revision, candidate);
    const view = { jobId, stage: "intake", revision, candidateTree: candidate, outcome: "review-ready", uncertainty: false, requirements: [], operations: [], publication: null };
    let routines = 0;
    const service = fixtureService({ root, workspace: { profile }, inspectProposal: async () => ({ plan: profile, intent: profile.intent, questions: [], assumptions: [] }), status: async () => view, inspectApproval: async () => ({ authority: { actor: "Fixture person", expires_at: new Date(Date.now() + 60000).toISOString() }, destination: { remote: "/tmp/fixture-origin.git", sourceBranch: "review/example", targetBranch: "main" } }), assertJobActive: async () => {}, list: async () => [view], requestRoutine: async () => { routines++; throw new Error("No routine should be dispatched"); } });
    const first = createAssistantJobFlow(service); flows.push(first);
    const offered = await first.read(jobId); expect(offered.phase).toBe("send"); first.stop();
    const commandId = purposeId(jobId, candidate, `send/${preparedId}`);
    await recordCommand(state, commandId, "publish", "running", revision, candidate, preparedId);
    const reopened = createAssistantJobFlow(service); flows.push(reopened);
    const observed = await reopened.read(jobId);
    expect(observed.phase).toBe("working"); expect(observed.preparedId).toBeNull(); expect(observed.retryable).toBe(false);
    await expect(reopened.post("send", { jobId, expectedRevision: offered.readyRevision, expectedCandidateTree: candidate, preparedId })).rejects.toThrow();
    await expect(reopened.post("send", { jobId, expectedRevision: observed.readyRevision, expectedCandidateTree: candidate, preparedId })).rejects.toThrow();
    await reopened.tick(); expect(routines).toBe(0);
    expect((await readdir(join(state, ".wringer/application/commands"))).sort()).toEqual([preparedId, commandId].sort());
    expect(await readdir(join(state, ".wringer/application/commands", commandId))).toEqual(["request.json"]);
    // Losing the owner without an outcome is uncertainty, not permission to
    // retry the handover. Only this construction fixture's own lock is removed.
    await unlink(join(state, ".wringer/application/operation.lock"));
    const orphaned = await reopened.read(jobId);
    expect(orphaned.phase).toBe("blocked"); expect(orphaned.retryable).toBe(false); expect(orphaned.nextAction.toLowerCase()).toContain("no durable outcome");
});
test("cancellation during the slow Send guard refuses before reserving a publication command", async () => {
    const root = await scratch(), jobId = crypto.randomUUID(), state = assistantControllerState(root, jobId), candidate = "b".repeat(40), revision = "c".repeat(64), preparedId = purposeId(jobId, candidate, "prepare");
    await recordCommand(state, preparedId, "prepare-delivery", "completed", revision, candidate);
    const view = { jobId, stage: "intake", revision, candidateTree: candidate, outcome: "review-ready", uncertainty: false, requirements: [], operations: [], publication: null };
    let cancelled = false, release!: () => void, entered!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; }), reached = new Promise<void>(resolve => { entered = resolve; });
    const service = fixtureService({ root, workspace: { profile }, inspectProposal: async () => ({ plan: profile, intent: profile.intent, questions: [], assumptions: [] }),
        status: async () => { entered(); await waiting; return { ...view, outcome: "cancelled", nextAction: "Cancellation was recorded while the handover was read." }; },
        inspectApproval: async () => ({ authority: { actor: "Fixture person", expires_at: new Date(Date.now() + 60000).toISOString() }, destination: { remote: "/tmp/fixture-origin.git", sourceBranch: "review/example", targetBranch: "main" } }),
        assertJobActive: async () => { if (cancelled) throw new Error("This job was cancelled"); }, list: async () => [] });
    // The displayed inspection is already complete; only the later admission
    // guard is held. This models cancellation during a slow validated read.
    service.inspectForPm = async () => ({ status: view, query: null }) as any;
    const flow = createAssistantJobFlow(service); flows.push(flow);
    const offered = await flow.read(jobId); expect(offered.phase).toBe("send");
    const pending = flow.post("send", { jobId, expectedRevision: offered.readyRevision, expectedCandidateTree: candidate, preparedId });
    await reached; cancelled = true; release();
    await expect(pending).rejects.toThrow(/cancel/i);
    expect(await readdir(join(state, ".wringer/application/commands"))).toEqual([preparedId]);
    expect(await readdir(join(state, ".wringer/application"))).not.toContain("operation.lock");
});
test("handover clone instructions quote the recorded branch and remote and name the reviewer folder", async () => {
    const root = await scratch(), jobId = crypto.randomUUID(), remote = "/tmp/fixture's origin.git", sourceBranch = "review/person's-result";
    const view = { jobId, stage: "intake", revision: "a".repeat(64), candidateTree: null, outcome: "branch-pushed", uncertainty: false, requirements: [], operations: [], publication: { status: "branch-pushed", deliveryId: "contained-fixture", sourceBranch, auditCommand: "wringer-drive audit --bundle .wringer/deliveries/contained-fixture" } };
    const service = fixtureService({ root, workspace: { profile, destination: { remote, sourceBranch, targetBranch: "main" } }, inspectProposal: async () => ({ plan: profile, intent: profile.intent, questions: [], assumptions: [] }), status: async () => view, inspectApproval: async () => null, list: async () => [] });
    const flow = createAssistantJobFlow(service); flows.push(flow);
    const job = await flow.read(jobId);
    expect(job.phase).toBe("sent");
    expect(job.publication?.cloneCommand).toBe("git clone --no-local --branch 'review/person'\\''s-result' -- '/tmp/fixture'\\''s origin.git' 'reviewed-change'");
});
