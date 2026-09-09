import { expect, test, spyOn } from "bun:test";
import { readFile } from "node:fs/promises";
import { compileDeclaration, compileExecutionPlan } from "@wringer/plan";
import { projectPmEngineering, readPmEngineering } from "../src/engineering-view";

const original = compileExecutionPlan(await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
function template() { const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...data } = original; return compileDeclaration({ version: 3, ...data, playbook: { path: "wringer/playbooks/report.json", sha256: "a".repeat(64), taskFamily: "reports" }, acceptance: { ...data.acceptance, checks: data.acceptance.checks.map(check => ({ ...check, evidence: { kind: "assertions", format: "wringer-check.v1" } })) } }); }

test("PM selection is visible before work but source validity, check evidence and benefit are not invented", async () => {
    const plan = template();
    const spawn = spyOn(Bun, "spawn").mockImplementation(() => { throw new Error("A read-only pending view must not dispatch a runtime"); });
    const fetch = spyOn(globalThis, "fetch").mockImplementation((() => { throw new Error("A read-only view must not call a provider"); }) as unknown as typeof globalThis.fetch);
    try {
        const summary = await readPmEngineering(plan);
        expect(summary?.approach).toMatchObject({ path: plan.playbook!.path, sha256: plan.playbook!.sha256, sourceStatus: "awaiting-validation", title: null, revision: null, workerUses: 0 });
        expect(summary?.checks[0]).toMatchObject({ level: "assertions", status: "not-measured", assertionStatus: "not-measured" });
        expect(summary?.history).toEqual([]); expect(summary).not.toHaveProperty("authority"); expect(JSON.stringify(summary)).not.toContain("guidanceMarkdown");
        expect(summary?.limits.join(" ")).toContain("tracked source can remain readable"); expect(summary?.limits.join(" ")).toContain("not proof of improvement");
        expect(spawn).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
        expect(await readPmEngineering(original)).toBeUndefined();
    } finally { spawn.mockRestore(); fetch.mockRestore(); }
});

test("no selected approach and command-only evidence remain honest, while mismatched or unreadable state refuses", async () => {
    const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...data } = original;
    const plan = compileDeclaration({ version: 3, ...data });
    const summary = projectPmEngineering(plan); expect(summary?.approach).toBeNull(); expect(summary?.checks[0]?.assertionStatus).toBe("not-requested");
    expect(() => projectPmEngineering(plan, { plan: template() } as any)).toThrow("different approved plan");
    await expect(readPmEngineering(plan, "/nonexistent/wringer-pm-view-fixture")).rejects.toThrow();
});
