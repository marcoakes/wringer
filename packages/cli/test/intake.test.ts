import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileExecutionPlan, validateExecutionPlan, loadExecutionPlan } from "@wringer/plan";
import { proposeContainedPlan } from "@wringer/workflow";
import { parseArgs } from "../src/args";
import { proposalCommand } from "../src/intake";
import { dispatch } from "../src/app";

const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
test("PM intent command produces an unapproved plan without worker execution or extra authority prompts", async () => {
    const repo = await mkdtemp(join(tmpdir(), "wringer-intake-cli-"));
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, acceptance, ...raw } = structuredClone(compileExecutionPlan(template, { format: "yaml" }));
    raw.agents.planner = raw.agents.judge;
    raw.runtime.env = [];
    raw.agents.worker.env = [];
    raw.agents.judge.env = [];
    raw.budget.max_planner_turns = 1;
    await writeFile(join(repo, "template.yaml"), JSON.stringify({ version: 1, ...raw }));
    await writeFile(join(repo, "intent.md"), "Return the total as 5.");
    const expires = new Date(Date.now() + 3600000).toISOString(), args = parseArgs(["propose", "template.yaml", "--intent", "intent.md", "--actor", "PM", "--expires", expires, "--state", "state", "--output", "plan.json"]);
    let calls = 0;
    const dependencies = {
        prepareSource: async (source: any) => ({ ...source, objectStore: join(repo, "fixture.git") }),
        propose: (options: Parameters<typeof proposeContainedPlan>[0]) => proposeContainedPlan({ ...options, executeRole: async request => {
            calls++;
            expect(request.role).toBe("planner");
            return { status: "completed", text: JSON.stringify({ acceptance, questions: [], note: "Fixture inspected existing checks" }), sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: { schema_version: "wringer.runtime.v1", runtimeId: crypto.randomUUID(), role: "planner", kind: request.runtime.kind, image: request.runtime.image, repository: request.repo, clonedInside: true, hostMounts: [], repositoryAccess: "read-only", declared: request.runtime, observed: {}, limits: ["No live provider"] } };
        } }),
    };
    const first = await proposalCommand(args, repo, {}, dependencies);
    expect(first.text).toContain("Unapproved plan proposed");
    expect(first.text).toContain("wringer-drive authority");
    expect((first.value as any).approved).toBe(false);
    expect(validateExecutionPlan(JSON.parse(await readFile(join(repo, "plan.json"), "utf8"))).intent).toBe("Return the total as 5.");
    const proposed = await loadExecutionPlan(join(repo, "plan.json"));
    const approval = await dispatch(["authority", "plan.json", "--actor", "PM", "--expires", expires, "--output", "execution-authority.json", "--repo", repo], "wringer-drive");
    expect((approval.value as any).authority.plan_sha256).toBe(proposed.plan_sha256);
    expect((approval.value as any).authority.actions).not.toContain("deliver");
    expect(calls).toBe(1);
    await proposalCommand(args, repo, {}, dependencies);
    expect(calls).toBe(1);
});
test("missing planner is an actionable pre-spend failure", async () => {
    const repo = await mkdtemp(join(tmpdir(), "wringer-intake-refuse-"));
    await writeFile(join(repo, "template.yaml"), template);
    await writeFile(join(repo, "intent.md"), "Return the total as 5.");
    const args = parseArgs(["propose", "template.yaml", "--intent", "intent.md", "--actor", "PM", "--expires", new Date(Date.now() + 3600000).toISOString(), "--state", "state", "--output", "plan.json"]);
    let prepared = false;
    await expect(proposalCommand(args, repo, {}, { prepareSource: async source => { prepared = true; return { ...source, objectStore: "unused" }; } })).rejects.toThrow("agents.planner");
    expect(prepared).toBe(false);
});
