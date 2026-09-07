import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { compileExecutionPlan, createExecutionAuthority, hashBytes, hashValue } from "../../plan/src";
import { openReader } from "../src/read";
const root = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const plan = compileExecutionPlan(await readFile(`${root}/packages/plan/examples/contained.yaml`, "utf8"), { format: "yaml" });
test("native plan and authority shapes are frozen without changing their semantic compiler", async () => {
    const reader = await openReader(`${root}/schema`), at = new Date("2026-09-07T12:00:00.000Z"), authority = createExecutionAuthority(plan, { actor: "Contract fixture", actions: ["verify", "build"], expiresAt: "2026-09-07T13:00:00.000Z", at });
    expect((await reader.validate(plan, "execution-plan-v1.schema.json")).ok).toBe(true);
    expect((await reader.validate(authority, "execution-authority-v1.schema.json")).ok).toBe(true);
    for (const mutate of [(p: any) => { p.runtime.kind = "local"; }, (p: any) => { p.budget.max_sessions = 0; }, (p: any) => { p.agents.worker.protocol = "shell"; }, (p: any) => { p.approved = true; }, (p: any) => { p.scope.writable = ["../escape"]; }]) {
        const changed = structuredClone(plan); mutate(changed);
        expect((await reader.validate(changed, "execution-plan-v1.schema.json")).ok).toBe(false);
    }
    for (const changed of [{ ...authority, expires_at: "not-a-date" }, { ...authority, actions: ["merge"] }, { ...authority, budget: { ...authority.budget, money: "unlimited" } }])
        expect((await reader.validate(changed, "execution-authority-v1.schema.json")).ok).toBe(false);
});
test("environment unknowns and runtime containment claims keep exact structural meanings", async () => {
    const reader = await openReader(`${root}/schema`), files = [{ path: "app/[slug]/page.tsx", mode: "100644", blob: "a".repeat(40) }];
    const map = { schema_version: "wringer.environment-map.v1", repository: plan.repository, plan_sha256: plan.plan_sha256, source_tree: "a".repeat(40), inventory_sha256: hashValue(files), files, context: [{ path: "README.md", text: "Fixture", sha256: hashBytes("Fixture"), blob: "b".repeat(40) }], components: [{ path: "app", files: 1 }], tools: plan.environment.tools.map(t => ({ ...t, observation: null })), baseline: plan.environment.baseline.map(declaration => ({ declaration, observation: null })), protected_paths: plan.acceptance.protected_paths, writable_paths: plan.scope.writable, limits: ["Synthetic records, not runtime proof"], map_sha256: "c".repeat(64) };
    expect((await reader.validate(map, "environment-map-v1.schema.json")).ok).toBe(true);
    const changed: any = structuredClone(map); changed.tools[0].observation = { kind: "tool", id: "bun", status: "passed", exit_code: null, output: "unmeasured", source_commit: plan.repository.commit, runtime_id: "fixture", image: plan.runtime.image, command_sha256: "d".repeat(64) };
    expect((await reader.validate(changed, "environment-map-v1.schema.json")).ok).toBe(false);
    const runtime = { schema_version: "wringer.runtime.v1", runtimeId: "fixture-runtime", role: "worker", kind: plan.runtime.kind, image: plan.runtime.image, repository: plan.repository, clonedInside: true, hostMounts: [], repositoryAccess: "read-write", declared: plan.runtime, observed: { synthetic: true }, limits: ["Not a real containment measurement"] };
    expect((await reader.validate(runtime, "runtime-v1.schema.json")).ok).toBe(true);
    for (const altered of [{ ...runtime, hostMounts: ["/Users/operator"] }, { ...runtime, clonedInside: false }, { ...runtime, role: "judge" }, { ...runtime, trustAgent: true }])
        expect((await reader.validate(altered, "runtime-v1.schema.json")).ok).toBe(false);
});
