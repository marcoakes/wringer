import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { openReader } from "../../records/src/read";
import { canonicalPlanJson, compileDeclaration, compileExecutionPlan, createExecutionAuthority, planningRequestFromPlan, validateExecutionPlan, type ExecutionPlan, type PlanDeclaration } from "../src";

// Contract only: no Git, bundle or runtime. The route through the public entry
// is proved by the compiled local-source-route validation stage.
const reader = await openReader(new URL("../../../schema", import.meta.url).pathname);
const example = compileExecutionPlan(await readFile(new URL("../examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
const root = "d".repeat(40), commit = "e".repeat(40), local = `local://${root}`;
function declaration(version: 3 | 4, url: string): PlanDeclaration {
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...data } = structuredClone(example);
    return { ...data, version, repository: { url, commit } } as PlanDeclaration;
}
const tamper = (plan: ExecutionPlan, url: string) => ({ ...structuredClone(plan), repository: { url, commit } });

test("plan v4 names a local-only source by its root commit and is v3 in every other contract", async () => {
    const plan = compileDeclaration(declaration(4, local)), hosted = compileDeclaration(declaration(3, "https://example.com/operator/source.git"));
    expect(plan.schema_version).toBe("wringer.execution-plan.v4");
    expect(plan.repository).toEqual({ url: local, commit });
    expect(compileExecutionPlan(canonicalPlanJson(plan), { format: "yaml" })).toEqual(plan);
    expect(validateExecutionPlan(plan)).toEqual(plan);
    const { schema_version: _v4, repository: _r4, plan_sha256: _p4, ...v4 } = plan, { schema_version: _v3, repository: _r3, plan_sha256: _p3, ...v3 } = hosted;
    expect(v4).toEqual(v3);
    expect((await reader.validate(plan, "execution-plan-v4.schema.json")).ok).toBe(true);
    expect((await reader.validate(plan, "execution-plan-v3.schema.json")).ok).toBe(false);
});

test("a local identity is refused outside v4, and v4 refuses every other source name", async () => {
    expect(() => compileDeclaration(declaration(3, local))).toThrow("Repository clone URLs cannot embed credentials or use local/file transports");
    const hosted = compileDeclaration(declaration(3, "https://example.com/operator/source.git"));
    expect((await reader.validate(tamper(hosted, local), "execution-plan-v3.schema.json")).ok).toBe(false);
    for (const url of ["https://example.com/operator/source.git", "ssh://git@example.com/operator/source.git", "file:///Users/operator/source", "/Users/operator/source", `local://${root.toUpperCase()}`, `local://${root.slice(1)}`, `local://${"d".repeat(64)}`, `${local}/extra`, `${local}?ref=main`, `local://${root} `])
        expect(() => compileDeclaration(declaration(4, url)), url).toThrow("A version 4 plan names a local-only source: repository.url must be local:// followed by the 40-character root commit of its history. Hosted sources use plan version 1, 2 or 3.");
    const plan = compileDeclaration(declaration(4, local));
    expect((await reader.validate(tamper(plan, "https://example.com/operator/source.git"), "execution-plan-v4.schema.json")).ok).toBe(false);
    expect(() => compileDeclaration({ ...declaration(4, local), version: 5 } as unknown as PlanDeclaration)).toThrow("Plan version must be 1, 2, 3 or 4");
});

test("a local-only source stops before minting a frozen record that cannot name it", () => {
    const plan = compileDeclaration(declaration(4, local));
    expect(() => createExecutionAuthority(plan, { actor: "Fixture operator", actions: ["build"], expiresAt: new Date(Date.now() + 60000).toISOString() })).toThrow("This profile names a local-only source, and execution approval cannot record one yet: the frozen authority record names hosted sources only. Nothing was approved or started.");
    // A planner is declared, so only the local-source stop stands between this plan and a request.
    const d = declaration(4, local), planned = compileDeclaration({ ...d, agents: { ...d.agents, planner: d.agents.judge }, budget: { ...d.budget, max_planner_turns: 1 } });
    expect(() => planningRequestFromPlan(planned, planned.intent)).toThrow("A planning request cannot carry a local-only source yet: no frozen planning-request version names one. Nothing was planned.");
});
