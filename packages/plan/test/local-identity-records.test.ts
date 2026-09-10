import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalSourceBundle, prepareRepositorySource, processDriver } from "@wringer/runtime";
import { openReader } from "../../records/src/read";
import { compileDeclaration, compileExecutionPlan, createExecutionAuthority, discoverEnvironment, hashBytes, planningRequestFromPlan, readPinnedPlaybook, type PlanDeclaration, type PlaybookManifest } from "../src";

// Schema contract only. Every hosted record below is real writer output (the runtime
// provenance is shaped exactly as the fixtures write it); each local-only sibling
// is that record with its repository renamed, so only the url grammar differs.
const reader = await openReader(new URL("../../../schema", import.meta.url).pathname);
const example = compileExecutionPlan(await readFile(new URL("../examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
const local = `local://${"d".repeat(40)}`, hosted = "https://example.com/operator/source.git", playbookPath = "wringer/playbooks/total.json";
const manifest: PlaybookManifest = { schema_version: "wringer.playbook.v1", id: "total-first", revision: "1", title: "Use the existing total interface", role: "worker", applicability: { taskFamily: "total", context: ["README.md"], tools: ["bun"], checks: ["total-check"], scope: ["src"], design: false }, guidanceMarkdown: "Inspect existing code; repair the named failure. This advice grants no authority.", limits: ["Unevaluated fixture, not evidence of benefit."], evaluationRefs: [] };
type Row = Record<string, any>;
const repositoryUrl = (record: Row, url: string) => ({ ...record, repository: { ...record.repository, url } });
const families = [
    { name: "execution authority", hosted: "execution-authority-v1", local: "execution-authority-v2", version: "wringer.execution-authority.v2", key: "authority", rename: repositoryUrl },
    { name: "environment map", hosted: "environment-map-v1", local: "environment-map-v2", version: "wringer.environment-map.v2", key: "environment", rename: repositoryUrl },
    { name: "runtime provenance", hosted: "runtime-v1", local: "runtime-v2", version: "wringer.runtime.v2", key: "runtime", rename: repositoryUrl },
    { name: "playbook snapshot", hosted: "playbook-snapshot-v1", local: "playbook-snapshot-v2", version: "wringer.playbook-snapshot.v2", key: "playbook", rename: (record: Row, url: string) => ({ ...record, source: { ...record.source, repository: { ...record.source.repository, url } } }) },
    { name: "planning request", hosted: "planning-request-v3", local: "planning-request-v4", version: "wringer.planning-request.v4", key: "planning", rename: repositoryUrl },
] as const;
let dir = "", written: Record<string, Row> = {};
async function git(cwd: string, ...args: string[]) {
    const result = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-C", cwd, ...args]);
    if (result.code !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
}
beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "wringer-local-identity-records-"));
    const repo = join(dir, "repo");
    await git(dir, "init", "--initial-branch=main", repo); await git(repo, "config", "user.name", "Records fixture"); await git(repo, "config", "user.email", "fixture@example.invalid");
    for (const directory of ["wringer/playbooks", "tests", "src"]) await mkdir(join(repo, directory), { recursive: true });
    for (const path of ["README.md", "tests/acceptance.test.ts", "package.json", "bun.lock", "src/total.ts"]) await writeFile(join(repo, path), path.endsWith(".json") ? "{}\n" : "Fixture\n");
    await writeFile(join(repo, playbookPath), JSON.stringify(manifest)); await git(repo, "add", "."); await git(repo, "commit", "-qm", "Records fixture source");
    const commit = await git(repo, "rev-parse", "HEAD"), { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...data } = structuredClone(example);
    const plan = compileDeclaration({ ...data, version: 3, repository: { url: hosted, commit }, agents: { ...data.agents, planner: data.agents.judge }, budget: { ...data.budget, max_planner_turns: 1 }, environment: { ...data.environment, tools: [{ name: "bun", version: "1.4.2", probe: ["bun", "--version"] }] }, playbook: { path: playbookPath, sha256: hashBytes(JSON.stringify(manifest)), taskFamily: "total" } } as PlanDeclaration);
    const bundlePath = join(dir, "source.bundle"); await createLocalSourceBundle(repo, commit, bundlePath);
    const prepared = await prepareRepositorySource({ ...plan.repository, bundlePath }, { controllerDir: join(dir, "controller") });
    const at = new Date("2026-09-10T10:00:00.000Z");
    written = {
        authority: createExecutionAuthority(plan, { actor: "Records fixture operator", actions: ["build"], expiresAt: "2026-09-10T11:00:00.000Z", at }),
        environment: await discoverEnvironment(prepared.objectStore, plan),
        runtime: { schema_version: "wringer.runtime.v1", runtimeId: crypto.randomUUID(), role: "worker", kind: plan.runtime.kind, image: plan.runtime.image, repository: { url: plan.repository.url, commit }, clonedInside: true, hostMounts: [], repositoryAccess: "read-write", declared: plan.runtime, observed: { fixture: true }, limits: ["Synthetic provenance; no container measured."] },
        playbook: (await readPinnedPlaybook(repo, plan))!,
        planning: planningRequestFromPlan(plan, plan.intent),
    };
}, 60_000);
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

test("every hosted record in this corpus is real writer output that satisfies its original schema", async () => {
    for (const family of families) {
        const result = await reader.validate(written[family.key], `${family.hosted}.schema.json`);
        expect(result.ok, `${family.name}: ${result.ok ? "" : result.said}`).toBe(true);
    }
});

// One test per sibling, so each positive and negative is red or green on its own.
for (const family of families) {
    test(`${family.local} admits the ${family.name} named local://<root>, by file and by declared version`, async () => {
        const sibling = { ...family.rename(written[family.key]!, local), schema_version: family.version }, path = join(dir, `${family.local}.json`);
        const direct = await reader.validate(sibling, `${family.local}.schema.json`);
        expect(direct.ok, direct.ok ? "" : direct.said).toBe(true);
        await writeFile(path, JSON.stringify(sibling));
        const declared = await reader.read(path);
        expect(declared.ok && declared.schema).toBe(`${family.local}.schema.json`);
    });
    test(`${family.local} refuses a hosted url, and ${family.hosted} still refuses local://`, async () => {
        const siblingWithHostedUrl = { ...family.rename(written[family.key]!, hosted), schema_version: family.version };
        expect((await reader.validate(siblingWithHostedUrl, `${family.local}.schema.json`)).ok).toBe(false);
        expect((await reader.validate(family.rename(written[family.key]!, local), `${family.hosted}.schema.json`)).ok).toBe(false);
    });
}
