import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileExecutionPlan, compileDeclaration, planningRequestFromPlan, createPlanningAuthority } from "@wringer/plan";
import * as proposal from "../src/proposal";
const { proposeContainedPlan } = proposal;
const inspectContainedPlanning = (proposal as any).inspectContainedPlanning as (directory: string) => Promise<any>;
import type { RoleExecutionRequest, RoleExecutionResult } from "@wringer/runtime";

const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
export async function planningFixture(reply: string, ceiling = 1) {
    const base = compileExecutionPlan(template, { format: "yaml" });
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...declaration } = base;
    const plan = compileDeclaration({ version: 1, ...declaration, agents: { ...base.agents, planner: base.agents.judge }, budget: { ...base.budget, max_sessions: ceiling, max_planner_turns: ceiling } });
    const request = planningRequestFromPlan(plan, plan.intent), controllerDir = await mkdtemp(join(tmpdir(), "wringer-proposal-regression-"));
    const authority = createPlanningAuthority(request, { actor: "Fixture PM", expiresAt: new Date(Date.now() + 3600000).toISOString() });
    let calls = 0;
    const executeRole = async (r: RoleExecutionRequest): Promise<RoleExecutionResult> => {
        calls++;
        return { status: "completed", text: reply, sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: { schema_version: "wringer.runtime.v1", runtimeId: crypto.randomUUID(), role: "planner", kind: r.runtime.kind, image: r.runtime.image, repository: r.repo, clonedInside: true, hostMounts: [], repositoryAccess: "read-only", declared: r.runtime, observed: {}, limits: ["Synthetic result; no model or runtime was called"] } };
    };
    return { options: { controllerDir, request, authority, source: request.repository, executeRole }, plan, calls: () => calls };
}
test("fenced planning questions are retained, inspectable without another role, and parsed evidence is additive", async () => {
    const f = await planningFixture('I inspected the tree.\n```json\n{"questions":["Which output is preferred?"],"note":"A product decision is needed"}\n```');
    const reply = await proposeContainedPlan(f.options);
    expect(reply.status).toBe("needs-decision");
    const view = await inspectContainedPlanning(f.options.controllerDir);
    expect(view.proposal.questions).toEqual(["Which output is preferred?"]);
    expect(view.recovery.retryUncertain).toBe(false);
    expect(view.recovery.retryStopped).toBe(false);
    const dirs = await readdir(join(f.options.controllerDir, ".wringer/planning/attempts"));
    const evidence = JSON.parse(await readFile(join(f.options.controllerDir, ".wringer/planning/attempts", dirs[0]!, "json-reply.json"), "utf8"));
    expect(evidence.path).toBe("json-fence");
    expect(f.calls()).toBe(1);
});
test("retry-uncertain requires an actual unresolved reservation, not a first call or known invalid reply", async () => {
    const f = await planningFixture("not JSON", 2);
    await expect(proposeContainedPlan({ ...f.options, retryUncertain: true })).rejects.toThrow("retry-uncertain");
    expect(f.calls()).toBe(0);
    await proposeContainedPlan(f.options);
    await expect(proposeContainedPlan({ ...f.options, retryUncertain: true })).rejects.toThrow("retry-uncertain");
    expect(f.calls()).toBe(1);
});
test("read-only planning rejects changed extraction evidence instead of silently replacing it", async () => {
    const f = await planningFixture('```json\n{"questions":["Which option?"],"note":"Decision"}\n```');
    await proposeContainedPlan(f.options);
    const attempts = join(f.options.controllerDir, ".wringer/planning/attempts"), [id] = await readdir(attempts);
    const path = join(attempts, id!, "json-reply.json"), receipt = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...receipt, path: "strict-json" }));
    await expect(inspectContainedPlanning(f.options.controllerDir)).rejects.toThrow("parsing receipt");
    expect(f.calls()).toBe(1);
});
test("known invalid reply cannot produce an eligible retry once its grant is spent", async () => {
    const f = await planningFixture("not JSON");
    await proposeContainedPlan(f.options);
    const view = await inspectContainedPlanning(f.options.controllerDir);
    expect(view.recovery.retryStopped).toBe(false);
    expect(view.recovery.newGrantRequired).toBe(true);
    expect(view.budget.remaining).toBe(0);
    expect((await proposeContainedPlan({ ...f.options, retryStopped: true })).stopReason).toContain("budget-exhausted");
    expect(f.calls()).toBe(1);
});
test("remaining bounded grant permits one known-stopped retry, preserving both reservations", async () => {
    const f = await planningFixture("not JSON", 2);
    await proposeContainedPlan(f.options);
    expect((await inspectContainedPlanning(f.options.controllerDir)).recovery.retryStopped).toBe(true);
    await proposeContainedPlan({ ...f.options, retryStopped: true });
    expect((await inspectContainedPlanning(f.options.controllerDir)).budget).toMatchObject({ reserved: 2, remaining: 0 });
    expect(f.calls()).toBe(2);
});
test("a valid fenced object cannot bypass acceptance schema validation", async () => {
    const f = await planningFixture('```json\n{"acceptance":{"criteria":[]},"questions":[],"note":"invalid acceptance"}\n```');
    expect((await proposeContainedPlan(f.options)).stopReason).toContain("invalid-reply");
    expect((await inspectContainedPlanning(f.options.controllerDir)).recovery.retryStopped).toBe(false);
    const dirs = await readdir(join(f.options.controllerDir, ".wringer/planning/attempts"));
    expect(JSON.parse(await readFile(join(f.options.controllerDir, ".wringer/planning/attempts", dirs[0]!, "json-reply.json"), "utf8")).path).toBe("json-fence");
});
test("the captured blind reply's five real questions and note survive without paid reinterpretation", async () => {
    const text = (await readFile(new URL("fixtures/planner-reply-03.txt", import.meta.url), "utf8")).slice(0, -1), f = await planningFixture(text);
    const first = await proposeContainedPlan(f.options);
    expect(first.status).toBe("needs-decision");
    expect(first.questions).toHaveLength(5);
    expect(first.note).toContain("permission was declined");
    const dir = join(f.options.controllerDir, ".wringer/planning");
    await writeFile(join(dir, "proposal.json"), JSON.stringify({ status: "proposal", questions: [], approved: true }));
    expect((await inspectContainedPlanning(f.options.controllerDir)).proposal).toEqual(first);
    expect(f.calls()).toBe(1);
});
test("expired grants still permit read-only questions and never offer a paid retry", async () => {
    const f = await planningFixture('{"questions":["Which option?"],"note":"Needs a decision"}', 2);
    await proposeContainedPlan(f.options);
    const realNow = Date.now;
    try {
        Date.now = () => Date.parse(f.options.authority.expires_at) + 1;
        const view = await inspectContainedPlanning(f.options.controllerDir);
        expect(view.proposal.questions).toEqual(["Which option?"]);
        expect(view.budget.authorityExpired).toBe(true);
        expect(view.recovery).toEqual({ retryUncertain: false, retryStopped: false, newGrantRequired: true });
    } finally { Date.now = realNow; }
    expect(f.calls()).toBe(1);
});
test("genuine uncertain retry retains its original reservation and cannot exceed the grant", async () => {
    const f = await planningFixture("unused", 2);
    let calls = 0;
    const options = { ...f.options, executeRole: async () => { calls++; throw new Error("Fixture lost the response after dispatch"); } };
    await proposeContainedPlan(options);
    expect((await inspectContainedPlanning(options.controllerDir)).recovery.retryUncertain).toBe(true);
    await proposeContainedPlan({ ...options, retryUncertain: true });
    const view = await inspectContainedPlanning(options.controllerDir);
    expect(view.budget).toMatchObject({ reserved: 2, remaining: 0 });
    expect(view.recovery.retryUncertain).toBe(false);
    expect((await proposeContainedPlan({ ...options, retryUncertain: true })).stopReason).toContain("budget-exhausted");
    expect(calls).toBe(2);
});
test("a live reserved planner is not offered an uncertain retry or a replacement grant", async () => {
    const f = await planningFixture('{"questions":["Which option?"],"note":"Decision"}', 2);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
    const pending = proposeContainedPlan({ ...f.options, executeRole: async request => { entered(); await gate; return f.options.executeRole(request); } });
    await ready;
    try {
        const view = await inspectContainedPlanning(f.options.controllerDir);
        expect(view.recovery).toEqual({ retryStopped: false, retryUncertain: false, newGrantRequired: false });
    } finally { release(); await pending; }
});
