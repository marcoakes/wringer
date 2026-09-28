import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileExecutionPlan, hashValue } from "@wringer/plan";
import { initializeAssistant, createAssistantService, issueAssistantCapability, approveAssistantProposal } from "../src/assistant";
import { withAssistantProposalLock, writeAssistantRecord } from "../src/assistant-store";
const roots: string[] = [], services: Awaited<ReturnType<typeof createAssistantService>>[] = [];
afterEach(async () => { for (const s of services.splice(0)) await s.runner.stop(50); for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
const profile = compileExecutionPlan(await Bun.file(new URL("../../plan/examples/contained.yaml", import.meta.url)).text(), { format: "yaml" });
const draft = () => ({ intent: "Return the total as 5.", title: "Correct the total", criteria: [{ id: "total", title: "Total is five", quote: "Return the total as 5.", kind: "check", required: true }], checks: [{ id: "total-check", criteria: ["total"] }], assumptions: [], questions: [] });
async function fixture() {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-proposal-revision-"))); roots.push(root);
    const { workspace } = await initializeAssistant(root, { plan: profile, cooperativeLocal: true });
    const cap = await issueAssistantCapability(root, new Date(Date.now() + 60000).toISOString());
    const service = await createAssistantService(root, { dependencies: { start: async () => { throw new Error("No model or repository execution is permitted in this fixture"); } } }); services.push(service);
    const call = (name: string, args: Record<string, unknown>) => service.call(cap.token, `wringer.${name}`, args) as Promise<any>;
    const propose = (proposal: unknown, idempotencyKey = crypto.randomUUID()) => call("propose", { workspaceId: workspace.id, idempotencyKey, proposal });
    const approve = async (jobId: string) => approveAssistantProposal(root, { jobId, expectedRevision: (await call("get_approval_request", { jobId })).revision, actor: "Automated fixture operator", expiresAt: new Date(Date.now() + 60000).toISOString(), confirmExecution: true });
    return { root, workspace, service, call, propose, approve };
}
test("T08 validation is read-only and reports useful fields without allocating jobs or runner effects", async () => {
    const f = await fixture(), before = (await readdir(f.root, { recursive: true })).sort();
    const result = await f.call("validate_proposal", { workspaceId: f.workspace.id, proposal: draft() });
    expect(result.valid).toBeTrue(); expect(result.approvalEligible).toBeTrue();
    expect(result.plan.repository).toEqual(profile.repository);
    const bad = await f.call("validate_proposal", { workspaceId: f.workspace.id, proposal: { ...draft(), runtime: { kind: "host" } } });
    expect(bad.valid).toBeFalse(); expect(bad.errors[0].field).toBe("runtime");
    expect((await readdir(f.root, { recursive: true })).sort()).toEqual(before);
});
test("T09 question revision keeps original bytes, fixed lineage, idempotent identity and no transferred authority", async () => {
    const f = await fixture(), first = await f.propose({ intent: draft().intent, title: draft().title, questions: ["Should the total equal five?"] });
    expect(first.outcome).toBe("needs-decision");
    const retained = await readFile(join(f.root, "jobs", first.jobId, "proposal.json"), "utf8");
    const key = crypto.randomUUID(), args = { jobId: first.jobId, expectedRevision: first.revision, idempotencyKey: key, proposal: draft() };
    const next = await f.call("revise_proposal", args); expect(next.outcome).toBe("awaiting-approval"); expect(next.jobId).not.toBe(first.jobId);
    expect((await f.call("revise_proposal", args)).jobId).toBe(next.jobId);
    expect((await f.call("revise_proposal", { ...args, proposal: { ...draft(), title: "Different" } })).isError).toBeTrue();
    expect(await readFile(join(f.root, "jobs", first.jobId, "proposal.json"), "utf8")).toBe(retained);
    const old = await f.call("get_status", { jobId: first.jobId }); expect(old.outcome).toBe("superseded"); expect(old.actions.every((a: any) => !a.enabled)).toBeTrue();
    await expect(f.approve(first.jobId)).rejects.toThrow("superseded");
    expect(await f.service.inspectApproval(next.jobId)).toBeNull();
    expect((await f.call("get_approval_request", { jobId: next.jobId })).lineage.parentJobId).toBe(first.jobId);
    await f.approve(next.jobId);
    expect((await f.call("revise_proposal", { jobId: next.jobId, expectedRevision: next.revision, idempotencyKey: crypto.randomUUID(), proposal: draft() })).isError).toBeTrue();
});
test("T09 stale revisions and rewritten original intent cannot create successor proposals", async () => {
    const f = await fixture(), first = await f.propose(draft());
    expect(first.outcome).toBe("awaiting-approval");
    for (const override of [{ expectedRevision: "0".repeat(64) }, { proposal: { title: "Different", intent: "A different request", questions: ["Which behavior?"] } }]) {
        const next = await f.call("revise_proposal", { jobId: first.jobId, expectedRevision: first.revision, idempotencyKey: crypto.randomUUID(), proposal: draft(), ...override });
        expect(next.isError).toBeTrue();
    }
    expect(await readdir(join(f.root, "jobs"))).toEqual([first.jobId]);
});
test("T09 simultaneous approval and supersession cannot both grant competing authority", async () => {
    const f = await fixture(), first = await f.propose(draft()); expect(first.jobId).toBeString();
    const [approved, revised] = await Promise.allSettled([f.approve(first.jobId), f.call("revise_proposal", { jobId: first.jobId, expectedRevision: first.revision, idempotencyKey: crypto.randomUUID(), proposal: draft() })]);
    const didApprove = approved.status === "fulfilled", didRevise = revised.status === "fulfilled" && !revised.value.isError;
    expect(Number(didApprove) + Number(didRevise)).toBe(1);
});
test("T09 a held decision lock prevents both approval and supersession", async () => {
    const f = await fixture(), first = await f.propose(draft());
    await withAssistantProposalLock(f.root, async () => {
        await expect(f.approve(first.jobId)).rejects.toThrow("proposal decision");
        expect((await f.call("revise_proposal", { jobId: first.jobId, expectedRevision: first.revision, idempotencyKey: crypto.randomUUID(), proposal: draft() })).isError).toBeTrue();
        expect(await readdir(join(f.root, "jobs"))).toEqual([first.jobId]);
    });
});
test("T09 interrupted transition repairs only the exact reserved successor", async () => {
    const f = await fixture(), first = await f.propose(draft()), args = { jobId: first.jobId, expectedRevision: first.revision, idempotencyKey: crypto.randomUUID(), proposal: { ...draft(), title: "Updated title" } };
    const next = await f.call("revise_proposal", args); expect(next.jobId).toBeString();
    await rm(join(f.root, "jobs", next.jobId), { recursive: true }); // controlled loss after the durable parent reservation
    await expect(f.approve(first.jobId)).rejects.toThrow("superseded");
    expect((await f.call("revise_proposal", { ...args, idempotencyKey: crypto.randomUUID() })).isError).toBeTrue();
    expect((await f.call("revise_proposal", args)).jobId).toBe(next.jobId);
    expect(await f.service.inspectApproval(next.jobId)).toBeNull();
});
test("T09 identical mutable replay observes one job but a changed question title refuses", async () => {
    const f = await fixture(), key = crypto.randomUUID(), value = { intent: draft().intent, title: "Question", questions: ["Which behavior?"] };
    const first = await f.propose(value, key); expect(first.jobId).toBeString();
    expect((await f.propose(value, key)).jobId).toBe(first.jobId);
    expect((await f.propose({ ...value, title: "Changed" }, key)).isError).toBeTrue();
});
test("T18 independent jobs get distinct reviewed branches while proposal supersession retains its original destination", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-job-destination-"))); roots.push(root);
    const destination = { remote: "https://example.invalid/repo.git", sourceBranch: "wringer/fixture", targetBranch: "main" };
    const { workspace } = await initializeAssistant(root, { plan: profile, cooperativeLocal: true, destination });
    await writeAssistantRecord(root, "destination-policy.json", { schema_version: "wringer.proposal-destination-policy.v1", workspaceId: workspace.id, uniqueProposalBranches: true });
    const service = await createAssistantService(root); services.push(service);
    const first: any = await service.recordProposal({ workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), proposal: draft() });
    const second: any = await service.recordProposal({ workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), proposal: draft() });
    const capability = await issueAssistantCapability(root, new Date(Date.now() + 60000).toISOString()), call = (name: string, args: any) => service.call(capability.token, `wringer.${name}`, args) as Promise<any>;
    const a = await call("get_approval_request", { jobId: first.jobId }), b = await call("get_approval_request", { jobId: second.jobId });
    expect(a.destination.sourceBranch).not.toBe(b.destination.sourceBranch);
    const revised = await call("revise_proposal", { jobId: first.jobId, expectedRevision: first.revision, idempotencyKey: crypto.randomUUID(), proposal: { ...draft(), title: "Answered" } });
    const next = await call("get_approval_request", { jobId: revised.jobId }); expect(next.destination).toEqual(a.destination);
    const approval = await approveAssistantProposal(root, { jobId: revised.jobId, expectedRevision: next.revision, actor: "Automated destination fixture", expiresAt: new Date(Date.now() + 60000).toISOString(), confirmExecution: true });
    expect(approval.destination).toEqual(a.destination); expect((service as any).destination).toBeFunction(); expect(await (service as any).destination(revised.jobId)).toEqual(a.destination);
});
