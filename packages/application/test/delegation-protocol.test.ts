import { afterEach, expect, test, spyOn } from "bun:test";
import { mkdtemp, realpath, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileExecutionPlan, hashBytes } from "@wringer/plan";
import * as application from "../src";
import { validateDelegationOutput } from "../../mcp/src/delegation-contract";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
test("T07 T08 typed delegation protocol validates, proposes and returns compact guarded observations", async () => {
    const factory = (application as any).createDelegationProtocol; expect(typeof factory).toBe("function");
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-delegation-protocol-"))); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const plan = compileExecutionPlan(await Bun.file(new URL("../../plan/examples/contained.yaml", import.meta.url)).text(), { format: "yaml" });
    const { workspace } = await application.initializeAssistant(root, { plan, cooperativeLocal: true });
    const cap = await application.issueAssistantCapability(root, new Date(Date.now() + 60000).toISOString()), service = await application.createAssistantService(root); cleanup.push(() => service.runner.stop(50));
    const protocol = factory(service), call = async (name: string, args: any) => { const result = await protocol.call(cap.token, `wringer.${name}`, args); validateDelegationOutput(`wringer.${name}`, result); return result; };
    const setup = await call("inspect_setup", {}); expect(setup.mode).toBe("delegation"); expect(setup.workspaceId).toBe(workspace.id); expect(setup.checks[0].id).toBe("total-check"); expect(setup.template).toBeUndefined();
    const proposal = { intent: "Return the total as 5.", title: "Correct total", criteria: [{ id: "total", title: "Total", quote: "Return the total as 5.", kind: "check", required: true }], checks: [{ id: "total-check", criteria: ["total"] }] };
    const before = (await readdir(root, { recursive: true })).sort();
    const validated = await call("validate_proposal", { workspaceId: workspace.id, proposal }); expect(validated.valid).toBeTrue();
    expect((await readdir(root, { recursive: true })).sort()).toEqual(before);
    const job = await call("propose", { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), proposal });
    expect(job.schema_version).toBe("wringer.assistant-response.v2"); expect(job.mode).toBe("delegation"); expect(job.phase).toBe("approval"); expect(job.nextAction.actor).toBe("operator"); expect(job.candidateIdentity).toBeNull(); expect(job.plan).toBeUndefined(); expect(job.remaining.monetaryCost).toBeNull();
    const loop = await call("inspect_loop", { jobId: job.jobId });
    expect(loop.schema_version).toBe("wringer.loop-inspection.v1");
    expect(loop.journalRevision).toBeNull(); expect(loop.candidate).toBeNull();
    expect(loop.decisions).toEqual([]); expect(loop.budget).toBeNull();
    expect(loop.planSha256).toBeDefined(); expect(loop).not.toHaveProperty("authority");
    expect(() => validateDelegationOutput("wringer.inspect_loop", { ...loop, authority: { send: true } })).toThrow();
    const improvements = await call("inspect_improvements", { jobId: job.jobId });
    expect(improvements.schema_version).toBe("wringer.job-improvements.v1"); expect(improvements.jobId).toBe(job.jobId); expect(improvements.connected).toBeFalse();
    expect(() => validateDelegationOutput("wringer.inspect_improvements", { ...improvements, authority: { collect: true } })).toThrow();
    expect(() => validateDelegationOutput("wringer.inspect_improvements", { ...improvements, future: { ...improvements.future, executionApproved: true } })).toThrow();
    const privateRead = spyOn(service, "inspectProposal");
    try {
        expect((await protocol.call("0".repeat(64), "wringer.inspect_loop", { jobId: job.jobId })).outcome).toBe("refused");
        expect(privateRead).not.toHaveBeenCalled();
        expect((await protocol.call("0".repeat(64), "wringer.inspect_improvements", { jobId: job.jobId })).outcome).toBe("refused");
        expect(privateRead).not.toHaveBeenCalled();
    } finally { privateRead.mockRestore(); }
    expect((await call("start", { jobId: job.jobId, idempotencyKey: crypto.randomUUID(), expectedRevision: job.revision, expectedCandidateIdentity: null })).outcome).toBe("refused");
    expect((await protocol.call("0".repeat(64), "wringer.get_status", { jobId: job.jobId })).outcome).toBe("refused");
    const evidence = job.evidence.find((row: any) => row.kind === "proposal"), first = await call("get_evidence", { jobId: job.jobId, evidenceId: evidence.id, contentIdentity: evidence.contentIdentity, limit: 100 });
    expect(first.content.length).toBeLessThanOrEqual(100); expect(first.untrustedContent).toBeTrue(); expect(first.nextOffset).toBe(100);
    const all = await call("get_evidence", { jobId: job.jobId, evidenceId: evidence.id, contentIdentity: evidence.contentIdentity, limit: 8192 });
    expect(hashBytes(new TextEncoder().encode(all.content))).toBe(evidence.contentIdentity);
    const report = job.evidence.find((row: any) => row.kind === "report");
    await application.approveAssistantProposal(root, { jobId: job.jobId, expectedRevision: job.revision, actor: "Automated engineering fixture", expiresAt: new Date(Date.now() + 30000).toISOString(), confirmExecution: true });
    expect((await call("get_evidence", { jobId: job.jobId, evidenceId: report.id, contentIdentity: report.contentIdentity })).outcome).toBe("refused");
    expect((await call("get_evidence", { jobId: job.jobId, evidenceId: evidence.id, contentIdentity: evidence.contentIdentity })).schema_version).toBe("wringer.evidence-page.v2");
});
test("T23 evidence paging is stable across elapsed-clock observation while its retained revision is unchanged", async () => {
    const factory = (application as any).createDelegationProtocol; expect(typeof factory).toBe("function");
    const plan = compileExecutionPlan(await Bun.file(new URL("../../plan/examples/contained.yaml", import.meta.url)).text(), { format: "yaml" });
    const jobId = crypto.randomUUID(), workspaceId = crypto.randomUUID(); let elapsed = 1;
    const view = () => ({ jobId, workspaceId, revision: "a".repeat(64), candidateTree: null, eventId: "b".repeat(64), stage: "worker", outcome: "stopped", uncertainty: false, nextAction: "Inspect", operations: [], actions: [], usage: { development: { limits: plan.budget, measured: { wallClock: { elapsedSeconds: elapsed++, ceilingSeconds: 600, expired: false } } } } });
    const protocol = factory({ root: "/private/fixture", workspace: { id: workspaceId, profile: plan }, call: async () => view(), inspectProposal: async () => ({ plan }) });
    const status = await protocol.call("fixture-token", "wringer.get_status", { jobId }), handle = status.evidence.find((row: any) => row.kind === "report");
    const page = await protocol.call("fixture-token", "wringer.get_evidence", { jobId, evidenceId: handle.id, contentIdentity: handle.contentIdentity, limit: 80 });
    expect(page.schema_version).toBe("wringer.evidence-page.v2"); expect(page.nextOffset).toBe(80);
});
test("T14 only the ready page phase invites review or separate Send; blocked and preparing phases do not", async () => {
    const plan = compileExecutionPlan(await Bun.file(new URL("../../plan/examples/contained.yaml", import.meta.url)).text(), { format: "yaml" });
    const jobId = crypto.randomUUID(), workspaceId = crypto.randomUUID(); let phase = "preparing";
    const view = () => ({ jobId, workspaceId, revision: "a".repeat(64), candidateTree: "b".repeat(40), eventId: "c".repeat(64), stage: "human", outcome: "human-hold", uncertainty: false, nextAction: "Inspect", decision: { phase, nextAction: "Page says " + phase, pageUrl: `http://127.0.0.1:3456/?jobId=${jobId}` }, operations: [], actions: [], usage: { development: { limits: plan.budget, measured: null } } });
    const protocol = (application as any).createDelegationProtocol({ root: "/private/fixture", workspace: { id: workspaceId, profile: plan }, call: async () => view(), inspectProposal: async () => ({ plan }) });
    for (const [selected, code, actor, eligible] of [["preparing", "wait", "assistant", true], ["review", "review", "operator", true], ["send", "send", "operator", true], ["correction", "correction", "operator", true], ["blocked", "inspect", "operator", false]]) {
        phase = selected as string; const result = await protocol.call("fixture", "wringer.get_status", { jobId });
        expect(result.nextAction).toEqual({ code, actor, eligible, reason: "Page says " + phase });
    }
});
