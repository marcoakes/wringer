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

test("each check says how it ran on the approved source before the work", () => {
    // Beta gate run 1 (F5): the page showed only the passing run; the red-first run was only in the audit.
    const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...data } = original;
    const plan = compileDeclaration({ version: 3, ...data }), id = plan.acceptance.checks[0]!.id;
    const check = (before: string | null) => projectPmEngineering(plan, { plan, playbook: null, events: [], state: { verification: { checks: [{ id, status: "passed" }] }, baseline: before ? { checks: [{ id, status: before }] } : null } } as any)!.checks[0]!;
    expect(check("failed").status).toBe("passed"); expect(check("failed").reason).toEndWith(" Before the work, on the approved source, it failed.");
    expect(check("passed").reason).toEndWith(" Before the work, on the approved source, it already passed.");
    expect(check("unavailable").reason).toEndWith(" Its result on the approved source before the work is unknown.");
    expect(check(null).reason).toBe("Command results alone do not establish executed assertions or complete requirement coverage.");
});
