import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileExecutionPlan, compileDeclaration, createExecutionAuthority, hashBytes, hashValue, type EnvironmentMap } from "@wringer/plan";
import type { ContainedCommandRequest, ContainedCommandResult } from "@wringer/runtime";
import { measureControllerEnvironment } from "../src/discovery";

const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
async function fixture(options: { noDiscoveryCommands?: boolean } = {}) {
    let plan = compileExecutionPlan(template, { format: "yaml" });
    if (options.noDiscoveryCommands) {
        const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = structuredClone(plan);
        plan = compileDeclaration({ version: 1, ...raw, environment: { ...raw.environment, tools: [], setup: [], baseline: [] } });
    }
    const state = await mkdtemp(join(tmpdir(), "wringer-discovery-app-"));
    const files = plan.acceptance.checks.flatMap(c => c.files).map(path => ({ path, mode: "100644", blob: "f".repeat(40) }));
    const data: Omit<EnvironmentMap, "map_sha256"> = { schema_version: "wringer.environment-map.v1", repository: plan.repository, plan_sha256: plan.plan_sha256, source_tree: "a".repeat(40), inventory_sha256: hashValue(files), files, context: [{ path: "README.md", text: "Fixture", sha256: hashBytes("Fixture"), blob: "f".repeat(40) }], components: [], tools: plan.environment.tools.map(t => ({ ...t, observation: null })), baseline: plan.environment.baseline.map(declaration => ({ declaration, observation: null })), protected_paths: plan.acceptance.protected_paths, writable_paths: plan.scope.writable, limits: ["Synthetic supervisor fixture, not containment proof"] };
    const map = { ...data, map_sha256: hashValue(data) }, source = { ...plan.repository, objectStore: join(state, "fixture.git") }, authority = createExecutionAuthority(plan, { actor: "Fixture", actions: ["verify", "build", "judge"], expiresAt: new Date(Date.now() + 3600000).toISOString() });
    const requests: ContainedCommandRequest[] = [];
    const runCommands = async (request: ContainedCommandRequest): Promise<ContainedCommandResult> => {
        requests.push(request);
        return { provenance: { schema_version: "wringer.runtime.v1", runtimeId: crypto.randomUUID(), role: "verifier", kind: request.runtime.kind, image: request.runtime.image, repository: request.repo, clonedInside: true, hostMounts: [], repositoryAccess: "read-only", declared: request.runtime, observed: { writableDirectories: request.writableDirectories }, limits: ["Fixture only"] }, sourceChanged: false, sourceTree: map.source_tree, results: request.commands.map(c => ({ id: c.id, code: 0, stdout: c.id.startsWith("tool/") ? plan.environment.tools.find(t => `tool/${t.name}` === c.id)!.version + "\n" : "fixture observation", stderr: "", durationMs: 1 })) };
    };
    return { state, plan, authority, source, map, requests, runCommands };
}
test("controller discovery uses credential-free pinned commands and resumes without reallocation", async () => {
    const f = await fixture();
    const result = await measureControllerEnvironment(f.state, f.plan, f.authority, f.source, f.map, { runCommands: f.runCommands });
    expect(result.status).toBe("measured");
    expect(f.requests[0]!.runtime.env).toEqual([]);
    expect(f.requests[0]!.commands.map(c => c.id)).toEqual(["tool/bun", "setup/dependencies", "baseline/baseline"]);
    expect(result.environment.baseline[0]!.observation?.status).toBe("passed");
    await measureControllerEnvironment(f.state, f.plan, f.authority, f.source, f.map, { runCommands: async () => { throw new Error("Must not execute twice"); } });
    expect(f.requests).toHaveLength(1);
    // Simulate crash before the workflow derives observations: the supervisor
    // envelope restores them without allocating another runtime.
    const attempts = await readdir(join(f.state, ".wringer/discovery/attempts"));
    await unlink(join(f.state, ".wringer/discovery/attempts", attempts[0]!, "observations.json"));
    const recovered = await measureControllerEnvironment(f.state, f.plan, f.authority, f.source, f.map, { runCommands: async () => { throw new Error("Reconciliation must stay read-only"); } });
    expect(recovered.status).toBe("measured");
    expect(recovered.attempts).toBe(1);
});
test("wrong runtime and command execution failures never become environment success", async () => {
    const f = await fixture();
    const result = await measureControllerEnvironment(f.state, f.plan, f.authority, f.source, f.map, { runCommands: async request => { const result = await f.runCommands(request); result.results[0]!.code = 127; return result; } });
    expect(result.status).toBe("unavailable");
    expect(result.environment.tools[0]!.observation?.exit_code).toBeNull();
    const bad = await fixture();
    const rejected = await measureControllerEnvironment(bad.state, bad.plan, bad.authority, bad.source, bad.map, { runCommands: async request => { const result = await bad.runCommands(request); result.provenance.declared = { ...request.runtime, env: ["CODEX_API_KEY"] }; return result; } });
    expect(rejected.status).toBe("uncertain");
    expect(rejected.reason).toContain("credential-free");
});
test("failed setup remains unavailable even when no tool or baseline rows exist", async () => {
    const f = await fixture(), { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = structuredClone(f.plan);
    raw.environment.tools = [];
    raw.environment.baseline = [];
    const plan = compileDeclaration({ version: 1, ...raw }), authority = createExecutionAuthority(plan, { actor: "Fixture", actions: ["verify"], expiresAt: new Date(Date.now() + 3600000).toISOString() });
    const { map_sha256, ...data } = f.map, revised = { ...data, plan_sha256: plan.plan_sha256, tools: [], baseline: [] }, map = { ...revised, map_sha256: hashValue(revised) };
    const result = await measureControllerEnvironment(f.state, plan, authority, f.source, map, { runCommands: async request => { const result = await f.runCommands(request); result.results[0]!.code = 1; return result; } });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("setup failed");
    expect(result.environment.tools).toEqual([]);
    expect(result.environment.baseline).toEqual([]);
});
test("empty discovery retains an explicit no-op and reconciles without allocating or claiming a runtime", async () => {
    const f = await fixture({ noDiscoveryCommands: true });
    let calls = 0;
    const options = { runCommands: async (): Promise<ContainedCommandResult> => { calls++; throw new Error("No runtime is needed for an empty declaration"); } };
    const first = await measureControllerEnvironment(f.state, f.plan, f.authority, f.source, f.map, options);
    expect(first.status).toBe("measured");
    expect(first.environment).toEqual(f.map);
    expect(first.attempts).toBe(1);
    expect(calls).toBe(0);
    const root = join(f.state, ".wringer/discovery"), observedPath = join(root, "attempts/000001/observations.json");
    const observed = JSON.parse(await readFile(observedPath, "utf8"));
    expect(observed.observations).toEqual([]);
    expect(observed.preparation).toEqual({ status: "passed", reason: "No discovery commands were declared; no runtime was allocated and no tool, setup or baseline execution was observed." });
    expect(await readdir(root)).not.toContain("runtime");
    const resumed = await measureControllerEnvironment(f.state, f.plan, f.authority, f.source, f.map, options);
    expect(resumed).toEqual(first);
    // An interrupted no-op can be derived from the same frozen empty request;
    // there is no uncertain runtime effect to replay or a new attempt to charge.
    await unlink(observedPath);
    const recovered = await measureControllerEnvironment(f.state, f.plan, f.authority, f.source, f.map, options);
    expect(recovered).toEqual(first);
    expect(await readdir(join(root, "attempts"))).toEqual(["000001"]);
    expect(await readdir(root)).not.toContain("runtime");
    expect(calls).toBe(0);
});
test("empty discovery still refuses missing verification authority and changed source or map", async () => {
    const f = await fixture({ noDiscoveryCommands: true });
    const noVerify = createExecutionAuthority(f.plan, { actor: "Fixture", actions: ["build", "judge"], expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await expect(measureControllerEnvironment(f.state, f.plan, noVerify, f.source, f.map)).rejects.toThrow("verify authority");
    await expect(measureControllerEnvironment(f.state, f.plan, f.authority, { ...f.source, commit: "1".repeat(40) }, f.map)).rejects.toThrow("pinned plan");
    await expect(measureControllerEnvironment(f.state, f.plan, f.authority, f.source, { ...f.map, source_tree: "1".repeat(40) })).rejects.toThrow("altered or stale");
    expect(await readdir(f.state)).toEqual([]);
});
