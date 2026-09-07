import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDeclaration, compileExecutionPlan, canonicalPlanJson, compilePlanningRequest, createExecutionAuthority, validateExecutionAuthority, validateExecutionPlan, loadExecutionPlan, discoverEnvironment, assertEnvironmentFresh, hashValue } from "../src";
import { parseYaml } from "@wringer/engine";
const source = await readFile(new URL("../examples/contained.yaml", import.meta.url), "utf8");
const declaration = () => { const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...rest } = compileExecutionPlan(source, { format: "yaml" }); return { version: 1, ...rest }; };
async function git(repo: string, ...args: string[]) {
    const p = Bun.spawn(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    const [output, error, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (code)
        throw new Error(error);
    return output.trim();
}
describe("canonical production plans", () => {
    test("YAML and literal TypeScript resolve to byte-identical canonical plans", () => {
        const yaml = compileExecutionPlan(source, { format: "yaml" });
        const ts = compileExecutionPlan(`import { definePlan } from '@wringer/plan';\nexport default definePlan(${JSON.stringify(declaration())});`, { format: "typescript" });
        expect(canonicalPlanJson(ts)).toBe(canonicalPlanJson(yaml));
        expect(Object.isFrozen(ts.acceptance.criteria)).toBe(true);
    });
    test("canonical planner output loads directly without weakening digest or schema validation", async () => {
        const plan = compileExecutionPlan(source, { format: "yaml" }), wire = canonicalPlanJson(plan), directory = await mkdtemp(join(tmpdir(), "wringer-canonical-plan-")), path = join(directory, "proposed-plan.json");
        await writeFile(path, wire);
        expect(await loadExecutionPlan(path)).toEqual(plan);
        expect(compileExecutionPlan(wire, { format: "yaml" })).toEqual(plan);
        expect(Object.isFrozen((await loadExecutionPlan(path)).acceptance)).toBe(true);
        const reordered = Object.fromEntries(Object.entries(JSON.parse(wire)).reverse());
        expect(compileExecutionPlan(JSON.stringify(reordered), { format: "yaml" })).toEqual(plan);
        for (const mutated of [
            { ...plan, intent: "A substituted requirement." },
            { ...plan, plan_sha256: "f".repeat(64) },
            { ...plan, acceptance_sha256: "f".repeat(64) },
            { ...plan, runtime: { ...plan.runtime, network: { policy: "allowlist", allow: [{ cidr: "1.2.3.4/32", ports: [443] }] } } },
            { ...plan, schema_version: "wringer.execution-plan.v999" },
            { ...plan, version: 1 },
        ]) {
            await writeFile(path, JSON.stringify(mutated));
            await expect(loadExecutionPlan(path)).rejects.toThrow();
        }
        expect(() => compileExecutionPlan(wire.replace('"schema_version":', '"schema_version":"wringer.execution-plan.v1","schema_version":'), { format: "yaml" })).toThrow();
    });
    test("the planning starter declares a bounded planner and no pretend acceptance", async () => {
        const text = await readFile(new URL("../examples/planning.yaml", import.meta.url), "utf8"), request = compilePlanningRequest(parseYaml(text));
        expect(request.agents.planner?.protocol).toBe("acp");
        expect(request.budget.max_planner_turns).toBeGreaterThan(0);
        expect(request).not.toHaveProperty("acceptance");
        expect(request.runtime.network.policy).toBe("deny");
        expect(() => compileExecutionPlan(text, { format: "yaml" })).toThrow();
    });
    test("executable TS, imports, callbacks, aliases and prototype keys are never evaluated", () => {
        for (const malicious of [
            `import {definePlan} from '@wringer/plan'; Bun.write('/tmp/wringer-should-never-exist','bad'); export default definePlan({});`,
            `import {definePlan} from '@wringer/plan'; export default definePlan({intent:process.env.SECRET});`,
            `import {definePlan} from '@wringer/plan'; export default definePlan({...JSON.parse('{}')});`,
            `import {definePlan} from '@wringer/plan'; export default definePlan({get version(){return 1}});`,
            `import {definePlan} from '@wringer/plan'; export default definePlan({__proto__:{}});`,
            `import {definePlan} from '/tmp/evil.ts'; export default definePlan({});`,
            `import {definePlan as x} from '@wringer/plan'; export default x({});`,
            `import {definePlan} from '@wringer/plan'; export default definePlan({version:1,version:2});`,
        ])
            expect(() => compileExecutionPlan(malicious, { format: "typescript" })).toThrow();
    });
    test("strict YAML rejects duplicate keys, tags and unknown policy", () => {
        expect(() => compileExecutionPlan(source + "\nversion: 1\n", { format: "yaml" })).toThrow();
        expect(() => compileExecutionPlan(source.replace("name: A bounded total", "name: !secret A bounded total"), { format: "yaml" })).toThrow();
        expect(() => compileDeclaration({ ...declaration(), bypass: true })).toThrow("unknown");
    });
    test("host code, local clone paths, floating images and missing proof are refused", () => {
        const original = declaration();
        for (const changed of [
            { ...original, runtime: { ...original.runtime, kind: "local" } },
            { ...original, runtime: { ...original.runtime, binary: "/bin/sh" } },
            { ...original, runtime: { ...original.runtime, image: "latest" } },
            { ...original, repository: { ...original.repository, url: "file:///Users/marc/private" } },
            { ...original, repository: { ...original.repository, commit: "main" } },
            { ...original, agents: { ...original.agents, worker: { protocol: "shell", command: "true" } } },
            { ...original, acceptance: { ...original.acceptance, checks: [] } },
            { ...original, scope: { writable: ["../escape"] } },
            { ...original, scope: { writable: [".git"] } },
        ])
            expect(() => compileDeclaration(changed)).toThrow();
    });
    test("authority pins original intent acceptance plan and ceilings", () => {
        const plan = compileDeclaration(declaration());
        const at = new Date("2026-09-06T10:00:00Z");
        const authority = createExecutionAuthority(plan, { actor: "Fixture operator", actions: ["build", "verify", "judge"], expiresAt: "2026-09-06T11:00:00Z", at });
        expect(validateExecutionAuthority(authority, plan, at).plan_sha256).toBe(plan.plan_sha256);
        expect(() => validateExecutionAuthority({ ...authority, budget: { ...authority.budget, max_sessions: 999 } }, plan, at)).toThrow("ceiling");
        expect(() => validateExecutionAuthority({ ...authority, actions: ["human-judge"] }, plan, at)).toThrow();
        expect(() => validateExecutionAuthority(authority, plan, new Date("2026-09-06T12:00:00Z"))).toThrow();
        expect(() => validateExecutionAuthority(authority, plan, new Date("not-a-time"))).toThrow("finite observation time");
        expect(() => validateExecutionAuthority(authority, plan, new Date(NaN))).toThrow("finite observation time");
        expect(() => validateExecutionPlan({ ...plan, intent: "Changed source" })).toThrow();
    });
    test("verifier output policy is canonical, budget-owned and disjoint from protected input", () => {
        const original = declaration(), { writable_directories, ...withoutOutputs } = original.environment, empty = compileDeclaration({ ...original, environment: withoutOutputs });
        expect(empty.environment.writable_directories).toEqual([]);
        for (const directory of [".", "../cache", ".git/cache", ".wringer/state", ".github", "tests/cache", "package.json", "node_modules/../tests"])
            expect(() => compileDeclaration({ ...original, environment: { ...original.environment, writable_directories: [directory] } })).toThrow();
        const allowed = compileDeclaration({ ...original, environment: { ...original.environment, writable_directories: ["node_modules", ".cache/build"] } });
        expect(allowed.environment.writable_directories).toEqual([".cache/build", "node_modules"]);
        expect(allowed.plan_sha256).not.toBe(empty.plan_sha256);
    });
    test("environment inventory links exact source, leaves tools unknown and detects stale work", async () => {
        const repo = await mkdtemp(join(tmpdir(), "wringer-plan-map-"));
        await git(repo, "init", "-q");
        await git(repo, "config", "user.name", "Fixture");
        await git(repo, "config", "user.email", "fixture@example.invalid");
        await writeFile(join(repo, "README.md"), "A documented total.\n");
        await mkdir(join(repo, "tests"));
        await writeFile(join(repo, "tests/acceptance.test.ts"), "// Fixture acceptance\n");
        await writeFile(join(repo, "package.json"), "{}\n");
        await writeFile(join(repo, "bun.lock"), "{}\n");
        await git(repo, "add", ".");
        await git(repo, "commit", "-qm", "fixture");
        const commit = await git(repo, "rev-parse", "HEAD");
        const d = declaration(), plan = compileDeclaration({ ...d, repository: { ...d.repository, commit } });
        const map = await discoverEnvironment(repo, plan);
        expect(map.context[0]!.text).toBe("A documented total.\n");
        expect(map.tools[0]!.observation).toBeNull();
        expect(map.baseline[0]!.observation).toBeNull();
        await assertEnvironmentFresh(repo, map);
        expect(map.inventory_sha256).toBe(hashValue(map.files));
        await writeFile(join(repo, "README.md"), "Changed source.\n");
        expect(assertEnvironmentFresh(repo, map)).rejects.toThrow("clean");
    });
});
