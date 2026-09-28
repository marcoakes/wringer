import { expect, test } from "bun:test";
import { compileExecutionPlan, hashValue } from "@wringer/plan";
import * as application from "../src";
const profile = compileExecutionPlan(await Bun.file(new URL("../../plan/examples/contained.yaml", import.meta.url)).text(), { format: "yaml" });
const draft = () => ({ intent: "Return the total as 5.", title: "Correct the total", criteria: [{ id: "total", title: "Total is five", quote: "Return the total as 5.", kind: "check", required: true }], checks: [{ id: "total-check", criteria: ["total"] }], assumptions: [], questions: [] });
test("T08 authorable proposal composes pinned policy without echoing it and omissions never expand scope or ceilings", () => {
    const compose = (application as any).composeAuthorableProposal; expect(typeof compose).toBe("function");
    const before = hashValue(profile), result = compose(profile, draft());
    expect(result.valid).toBeTrue(); expect(result.plan.repository).toEqual(profile.repository); expect(result.plan.runtime).toEqual(profile.runtime);
    expect(result.plan.agents).toEqual(profile.agents); expect(result.plan.acceptance.checks[0].argv).toEqual(profile.acceptance.checks[0]!.argv);
    expect(result.plan.scope).toEqual(profile.scope); expect(result.plan.budget).toEqual(profile.budget); expect(hashValue(profile)).toBe(before);
    expect(compose(profile, { ...draft(), scope: { writable: ["src/total.ts"] }, ceilings: { max_sessions: 4 } }).plan.budget.max_sessions).toBe(4);
});
test("T08 useful field errors reject policy substitution, wider scope, raised ceilings and missing protected acceptance", () => {
    const compose = (application as any).composeAuthorableProposal; expect(typeof compose).toBe("function");
    for (const [patch, field] of [[{ runtime: { kind: "host" } }, "runtime"], [{ scope: { writable: ["."] } }, "scope.writable"], [{ ceilings: { max_sessions: 999 } }, "ceilings.max_sessions"], [{ checks: [{ id: "total-check", argv: ["true"], criteria: ["total"] }] }, "checks"], [{ criteria: [] }, "criteria"]] as const) {
        const result = compose(profile, { ...draft(), ...patch }); expect(result.valid).toBeFalse(); expect(result.errors.some((row: any) => row.field.startsWith(field))).toBeTrue(); expect(result.plan).toBeNull();
    }
});
test("T08 a question-only draft remains unapproved and preserves authored questions without inventing acceptance", () => {
    const compose = (application as any).composeAuthorableProposal; expect(typeof compose).toBe("function");
    const value = { intent: "Improve the report", title: "Report work", questions: ["Which report format should be accepted?"], assumptions: [] };
    const result = compose(profile, value); expect(result.valid).toBeTrue(); expect(result.plan).toBeNull(); expect(result.questions).toEqual(value.questions); expect(result.approvalEligible).toBeFalse();
    expect(compose(profile, { ...value, title: "Changed title" }).canonicalIdentity).not.toBe(result.canonicalIdentity);
    expect(compose(profile, { ...value, ceilings: { max_sessions: 999 } }).valid).toBeFalse();
});
