import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileExecutionPlan, compileDeclaration, planningRequestFromPlan, createPlanningAuthority } from "../../plan/src";
import { inspectContainedPlanning, proposeContainedPlan } from "../../workflow/src";
import type { RoleExecutionRequest, RoleExecutionResult } from "../../runtime/src";
import * as workspace from "../../cli/src/workspace";
import { pmOutcome } from "../src/pm-model";
import { renderPmWorkspace } from "../src/pm-render";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
const questions = ["Which output is preferred?", "Which failures should be visible?", "Should skipped work stay listed?", "What is the expected ordering?", "Who reviews the display?"];
async function fixture(mode: "questions" | "invalid" | "proposal" = "questions") {
    const base = compileExecutionPlan(template, { format: "yaml" }), { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...declaration } = base;
    const plan = compileDeclaration({ version: 1, ...declaration, name: "Private planning fixture", runtime: { ...base.runtime, env: [] }, agents: { worker: { ...base.agents.worker, env: [] }, judge: { ...base.agents.judge, env: [] }, planner: { ...base.agents.judge, env: [] } }, budget: { ...base.budget, max_planner_turns: 1 } });
    const request = planningRequestFromPlan(plan, plan.intent), controllerDir = await mkdtemp(join(tmpdir(), "wringer-planning-board-")); roots.push(controllerDir);
    const authority = createPlanningAuthority(request, { actor: "Synthetic operator", expiresAt: new Date(Date.now() + 3600000).toISOString() });
    let calls = 0;
    const text = mode === "invalid" ? "Not a valid planning reply" : JSON.stringify({ questions: mode === "questions" ? questions : [], note: "This is the complete original planner note.", ...(mode === "proposal" ? { acceptance: plan.acceptance } : {}) });
    const executeRole = async (r: RoleExecutionRequest): Promise<RoleExecutionResult> => {
        calls++;
        return { status: "completed", text, sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "synthetic" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: { schema_version: "wringer.runtime.v1", runtimeId: crypto.randomUUID(), role: "planner", kind: r.runtime.kind, image: r.runtime.image, repository: r.repo, clonedInside: true, hostMounts: [], repositoryAccess: "read-only", declared: r.runtime, observed: {}, limits: ["Synthetic observation; no runtime, key or model used"] } };
    };
    await proposeContainedPlan({ controllerDir, request, authority, source: request.repository, executeRole });
    return { controllerDir, request, authority, calls: () => calls };
}

test("planning-only projection carries all five questions and note without inventing build or human acceptance", async () => {
    const f = await fixture(), before = await readdir(join(f.controllerDir, ".wringer/planning/events"));
    const view = await workspace.readPmWorkspace(f.controllerDir), planning = await inspectContainedPlanning(f.controllerDir);
    expect(view).toMatchObject({ name: f.request.name, intent: f.request.intent, revision: planning.revision, stage: "planning", status: "planning-needs-decision", candidate: null, criteria: [], checks: [], actions: [], usage: { sessions: 1, ceiling: 1, inputTokens: null, outputTokens: null, costUsd: null } });
    for (const question of questions) expect(view.stop?.message).toContain(question);
    expect(view.stop?.message).toContain("This is the complete original planner note.");
    expect(view.stop?.message).toContain("wringer-drive planning-status --state");
    expect(view.stop?.message).toContain("wringer-drive planning-new-grant --state");
    expect(pmOutcome(view).title).toContain("questions");
    const html = renderPmWorkspace(view, { live: false });
    expect(html.includes("Planning only · no execution approval")).toBe(true);
    expect(html.includes("0 of 0")).toBe(false);
    expect(html.includes("Planning questions and proposal")).toBe(true);
    expect(html.includes("What would you like to review?")).toBe(false);
    expect(await readdir(join(f.controllerDir, ".wringer/planning/events"))).toEqual(before); expect(f.calls()).toBe(1);
});
test("expired planning still exposes questions read-only and refuses command access", async () => {
    const f = await fixture(), originalNow = Date.now;
    try {
        Date.now = () => Date.parse(f.authority.expires_at) + 1;
        const view = await workspace.readPmWorkspace(f.controllerDir);
        expect(view.actions).toEqual([]); expect(view.stop?.message).toContain(questions[4]!);
        const guard = (workspace as any).assertPmWorkspaceCommandAccess;
        expect(typeof guard).toBe("function");
        await expect(guard(f.controllerDir)).rejects.toThrow("read-only planning");
    } finally { Date.now = originalNow; }
    expect(f.calls()).toBe(1);
});
test("planning stopped and an unapproved proposal have distinct truthful headings", async () => {
    const stopped = await fixture("invalid"), proposed = await fixture("proposal");
    expect(pmOutcome(await workspace.readPmWorkspace(stopped.controllerDir)).title).toBe("Planning stopped before a usable proposal.");
    const view = await workspace.readPmWorkspace(proposed.controllerDir);
    expect(view.status).toBe("planning-proposal"); expect(pmOutcome(view).title).toBe("Review the unapproved proposal.");
    expect(view.stop?.message).toContain("Proposed execution plan (unapproved):");
    expect(view.actions).toEqual([]); expect(view.criteria).toEqual([]);
});
