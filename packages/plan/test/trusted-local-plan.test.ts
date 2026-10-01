/** Plan v5 exists only to name a trusted-local runtime: an explicit operator choice,
 * recorded in its own sibling records, never accepted as or in place of a contained one. */
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { openReader } from "../../records/src/read";
import { assertRecordFamily, canonicalPlanJson, compileDeclaration, compileExecutionPlan, recordVersion, sourceFamily, validateExecutionPlan, type PlanDeclaration } from "../src";

const reader = await openReader(new URL("../../../schema", import.meta.url).pathname);
const example = compileExecutionPlan(await readFile(new URL("../examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
const root = "d".repeat(40), commit = "e".repeat(40), local = `local://${root}`, hosted = "https://example.com/operator/source.git";
const trusted = { kind: "trusted-local", network: { policy: "unenforced" }, env: example.runtime.env };
function declaration(version: 3 | 4 | 5, url: string, runtime: unknown = trusted): PlanDeclaration {
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...data } = structuredClone(example);
    return { ...data, version, repository: { url, commit }, runtime } as PlanDeclaration;
}

test("a v5 plan names a trusted-local runtime from either source kind and validates only as v5", async () => {
    for (const url of [hosted, local]) {
        const plan = compileDeclaration(declaration(5, url));
        expect(plan.schema_version).toBe("wringer.execution-plan.v5");
        expect(plan.runtime).toEqual({ kind: "trusted-local", network: { policy: "unenforced" }, env: example.runtime.env });
        expect(validateExecutionPlan(plan)).toEqual(plan);
        expect(compileExecutionPlan(canonicalPlanJson(plan), { format: "yaml" })).toEqual(plan);
        expect((await reader.validate(plan, "execution-plan-v5.schema.json")).ok).toBe(true);
        for (const older of ["execution-plan-v3.schema.json", "execution-plan-v4.schema.json"]) expect((await reader.validate(plan, older)).ok).toBe(false);
        expect(sourceFamily(plan)).toBe(url === local ? "local" : "hosted");
        expect(recordVersion(plan, "authority")).toBe(url === local ? "wringer.execution-authority.v2" : "wringer.execution-authority.v1");
        expect(recordVersion(plan, "runtime")).toBe("wringer.runtime.v3");
        expect(recordVersion(plan, "environment")).toBe("wringer.environment-map.v3");
    }
});
test("no older plan can name trusted-local, and v5 can name nothing else", () => {
    for (const version of [3, 4] as const) expect(() => compileDeclaration(declaration(version, version === 4 ? local : hosted))).toThrow("A trusted-local runtime needs a version 5 plan");
    expect(() => compileDeclaration(declaration(5, hosted, example.runtime))).toThrow("A version 5 plan names a trusted-local runtime");
    expect(() => compileDeclaration(declaration(5, hosted, { ...trusted, network: { policy: "deny" } }))).toThrow("cannot be enforced on a trusted-local runtime");
    expect(() => compileDeclaration(declaration(5, hosted, { ...trusted, image: example.runtime.image }))).toThrow("A trusted-local runtime has no image");
    expect(() => compileDeclaration(declaration(5, "file:///Users/operator/source"))).toThrow("Repository clone URLs cannot embed credentials or use local/file transports");
});
test("a trusted-local record is never accepted for a contained plan, nor a contained record for a trusted-local one", () => {
    const plan = compileDeclaration(declaration(5, hosted)), contained = compileDeclaration(declaration(3, hosted, example.runtime));
    expect(() => assertRecordFamily(plan, "runtime", "wringer.runtime.v1")).toThrow("A trusted-local run is never recorded as contained");
    expect(() => assertRecordFamily(contained, "runtime", "wringer.runtime.v3")).toThrow("A trusted-local run is never recorded as contained");
    expect(() => assertRecordFamily(plan, "environment", "wringer.environment-map.v1")).toThrow("A trusted-local run is never recorded as contained");
    expect(() => assertRecordFamily(plan, "runtime", "wringer.runtime.v3")).not.toThrow();
});
