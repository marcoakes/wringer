import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalSourceBundle, prepareRepositorySource, processDriver, runtimeProvenanceVersion } from "@wringer/runtime";
import { assertEnvironmentFresh, compileDeclaration, compileExecutionPlan, createExecutionAuthority, createPlanningAuthority, discoverEnvironment, hashBytes, hashValue, planningRequestFromPlan, readPinnedPlaybook, recordVersion, validateExecutionAuthority, validatePlanningRequest, validatePlaybookSnapshot, type ExecutionPlan, type PlanDeclaration, type PlaybookManifest } from "../src";

// Writers and the family guard, below the two stops. Every refusal fixture keeps the
// repository, plan and digests equal, so only the record's version can refuse it.
const example = compileExecutionPlan(await readFile(new URL("../examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
const playbookPath = "wringer/playbooks/total.json", hosted = "https://example.com/operator/source.git";
const manifest: PlaybookManifest = { schema_version: "wringer.playbook.v1", id: "total-first", revision: "1", title: "Use the existing total interface", role: "worker", applicability: { taskFamily: "total", context: ["README.md"], tools: ["bun"], checks: ["total-check"], scope: ["src"], design: false }, guidanceMarkdown: "Inspect existing code; repair the named failure. This advice grants no authority.", limits: ["Unevaluated fixture, not evidence of benefit."], evaluationRefs: [] };
const at = new Date("2026-09-10T10:00:00.000Z"), expiresAt = "2026-09-10T11:00:00.000Z";
let dir = "", repo = "", objectStore = "", local: ExecutionPlan, hostedPlan: ExecutionPlan;
async function git(cwd: string, ...args: string[]) { const r = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-C", cwd, ...args]); if (r.code !== 0) throw new Error(r.stderr); return r.stdout.trim(); }
const family = (version: 3 | 4, url: string, commit: string) => {
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...data } = structuredClone(example);
    return compileDeclaration({ ...data, version, repository: { url, commit }, agents: { ...data.agents, planner: data.agents.judge }, budget: { ...data.budget, max_planner_turns: 1 }, environment: { ...data.environment, tools: [{ name: "bun", version: "1.4.2", probe: ["bun", "--version"] }] }, playbook: { path: playbookPath, sha256: hashBytes(JSON.stringify(manifest)), taskFamily: "total" } } as PlanDeclaration);
};
const authorityFor = (plan: ExecutionPlan, schema_version: string) => ({ schema_version, actor: "Family fixture operator", repository: plan.repository, plan_sha256: plan.plan_sha256, acceptance_sha256: plan.acceptance_sha256, actions: ["build"], budget: plan.budget, granted_at: at.toISOString(), expires_at: expiresAt });
const mix = (kind: string, found: string, source: "local-only" | "hosted", expected: string) => `This ${kind} is ${found}, but a ${source} source's ${kind} is ${expected}. Records from different source kinds are never mixed; nothing was accepted.`;
beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "wringer-local-identity-family-")); repo = join(dir, "repo");
    await git(dir, "init", "--initial-branch=main", repo); await git(repo, "config", "user.name", "Family fixture"); await git(repo, "config", "user.email", "fixture@example.invalid");
    for (const directory of ["wringer/playbooks", "tests", "src"]) await mkdir(join(repo, directory), { recursive: true });
    for (const path of ["README.md", "tests/acceptance.test.ts", "package.json", "bun.lock", "src/total.ts"]) await writeFile(join(repo, path), path.endsWith(".json") ? "{}\n" : "Fixture\n");
    await writeFile(join(repo, playbookPath), JSON.stringify(manifest)); await git(repo, "add", "."); await git(repo, "commit", "-qm", "Family fixture source");
    const commit = await git(repo, "rev-parse", "HEAD"), bundlePath = join(dir, "source.bundle"), made = await createLocalSourceBundle(repo, commit, bundlePath);
    local = family(4, made.url, commit); hostedPlan = family(3, hosted, commit);
    objectStore = (await prepareRepositorySource({ ...local.repository, bundlePath }, { controllerDir: join(dir, "controller") })).objectStore;
}, 60_000);
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

test("a hosted plan keeps every original record; a local-only plan's writers emit the siblings", async () => {
    for (const kind of ["authority", "environment", "runtime", "playbook"] as const) { expect(recordVersion(hostedPlan, kind)).toMatch(/\.v1$/); expect(recordVersion(local, kind)).toMatch(/\.v2$/); }
    expect(runtimeProvenanceVersion(local.repository.url)).toBe("wringer.runtime.v2"); expect(runtimeProvenanceVersion(hosted)).toBe("wringer.runtime.v1");
    expect((await discoverEnvironment(objectStore, local)).schema_version).toBe("wringer.environment-map.v2");
    expect((await readPinnedPlaybook(repo, local))!.schema_version).toBe("wringer.playbook-snapshot.v2");
    expect((await readPinnedPlaybook(repo, hostedPlan))!.schema_version).toBe("wringer.playbook-snapshot.v1");
    expect(planningRequestFromPlan(local, local.intent).schema_version).toBe("wringer.planning-request.v4");
    expect(planningRequestFromPlan(hostedPlan, hostedPlan.intent).schema_version).toBe("wringer.planning-request.v3");
    const authority = validateExecutionAuthority(authorityFor(local, "wringer.execution-authority.v2"), local, at);
    expect(authority.schema_version).toBe("wringer.execution-authority.v2"); expect(authority.repository).toEqual(local.repository);
}, 30_000);

test("the family guard refuses a record of the other source kind even when every other identity matches", async () => {
    expect(() => validateExecutionAuthority(authorityFor(local, "wringer.execution-authority.v1"), local, at)).toThrow(mix("execution authority", "wringer.execution-authority.v1", "local-only", "wringer.execution-authority.v2"));
    expect(() => validateExecutionAuthority(authorityFor(hostedPlan, "wringer.execution-authority.v2"), hostedPlan, at)).toThrow(mix("execution authority", "wringer.execution-authority.v2", "hosted", "wringer.execution-authority.v1"));
    const map = await discoverEnvironment(objectStore, local), { map_sha256: _m, ...body } = map, relabelled = { ...body, schema_version: "wringer.environment-map.v1" };
    await expect(assertEnvironmentFresh(objectStore, { ...relabelled, map_sha256: hashValue(relabelled) } as never)).rejects.toThrow(mix("environment map", "wringer.environment-map.v1", "local-only", "wringer.environment-map.v2"));
    const snapshot = (await readPinnedPlaybook(repo, local))!, { snapshot_sha256: _s, ...snapshotBody } = snapshot, v1 = { ...snapshotBody, schema_version: "wringer.playbook-snapshot.v1" };
    expect(() => validatePlaybookSnapshot({ ...v1, snapshot_sha256: hashValue(v1) })).toThrow(mix("playbook snapshot", "wringer.playbook-snapshot.v1", "local-only", "wringer.playbook-snapshot.v2"));
    const request = planningRequestFromPlan(local, local.intent), { request_sha256: _r, ...requestBody } = request, asV3 = { ...requestBody, schema_version: "wringer.planning-request.v3" };
    expect(() => validatePlanningRequest({ ...asV3, request_sha256: hashValue(asV3) })).toThrow("Repository clone URLs cannot embed credentials or use local/file transports");
}, 30_000);

test("until the journey is proven, minting authority for a local-only source still stops", () => {
    expect(() => createExecutionAuthority(local, { actor: "Family fixture operator", actions: ["build"], expiresAt, at })).toThrow("Approval of a local-only source is not open yet");
    expect(() => createPlanningAuthority(planningRequestFromPlan(local, local.intent), { actor: "Family fixture operator", expiresAt, at })).toThrow("Planning for a local-only source is not open yet");
});
