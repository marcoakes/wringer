import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalPlanJson, compileDeclaration, loadExecutionPlan, type ExecutionPlan } from "@wringer/plan";
import { localSourceSiblings } from "@wringer/application";
import type { AgentPreflightResult } from "@wringer/runtime";
import { prepareAssistantProfile } from "../src/assistant-setup";
import { containedDoctor, type ContainedDoctorDependencies } from "../src/preflight";

// S-A12 (alpha.13 blind test): a local-only plan had no pre-job probe route at
// all, because the doctor never read the pair `prepare --local` wrote beside the
// profile. The probe now reads and verifies exactly what `init` verifies.
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function scratch() { const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-preflight-local-"))); roots.push(root); return root; }
async function git(repo: string, args: string[]) {
    const child = Bun.spawn(["git", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-C", repo, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Preflight fixture", GIT_AUTHOR_EMAIL: "preflight@localhost", GIT_COMMITTER_NAME: "Preflight fixture", GIT_COMMITTER_EMAIL: "preflight@localhost" } });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(`Git fixture failed: ${err}`);
    return out.trim();
}

/** No declared role credentials and no real container client: the probe seam is
 * injected so this test measures the source route, never a provider or runtime. */
const probes: { role: string; repo: unknown }[] = [];
const dependencies = (): ContainedDoctorDependencies => ({
    which: () => "/trusted/container",
    preflight: async request => {
        probes.push({ role: request.role, repo: request.repo });
        return { status: "completed", stopReason: "session-opened", text: "", sessionId: "probe", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: { schema_version: "wringer.runtime.v2", runtimeId: "fixture", role: request.role, kind: request.runtime.kind, image: request.runtime.image, repository: { url: request.repo.url, commit: request.repo.commit }, clonedInside: true, hostMounts: [], repositoryAccess: request.role === "worker" ? "read-write" : "read-only", declared: request.runtime, observed: { fixture: true }, limits: ["Injected unit-test probe; no runtime measured"] }, promptSent: false, modelWorkRequested: false, providerCredentialValidated: false, effectiveCredential: "not-attested", credentialNames: [], authMethodReturned: false, authLine: `${request.role} ACP preflight: session opened. Injected unit-test probe.` } as unknown as AgentPreflightResult;
    },
});

async function localProfile() {
    const dir = await scratch(), repo = join(dir, "repo"), fromPlan = join(dir, "selected.json"), output = join(dir, "prepared.json"), root = join(dir, "controller");
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...declaration } = await loadExecutionPlan(new URL("../../plan/examples/contained.yaml", import.meta.url).pathname);
    // Declared role credentials and a real container client are separate readiness
    // rows; this fixture removes them so only the source route decides the outcome.
    const plan: ExecutionPlan = compileDeclaration({ ...declaration, version: 3, repository: { url: "https://example.com/operator/source.git", commit: "1".repeat(40) }, runtime: { ...declaration.runtime, image: `local.test/agents@sha256:${"2".repeat(64)}`, env: [] }, agents: { worker: { protocol: "acp", command: "codex-acp" }, judge: { protocol: "acp", command: "claude-agent-acp" } }, environment: { ...declaration.environment, tools: [{ name: "bun", version: "1.4.2", probe: ["bun", "--version"] }] } });
    await writeFile(fromPlan, canonicalPlanJson(plan));
    for (const name of ["README.md", "package.json", "bun.lock", "tests/acceptance.test.ts", "src/index.ts"]) await Bun.write(join(repo, name), "fixture\n");
    await git(repo, ["init"]); await git(repo, ["add", "."]); await git(repo, ["commit", "-m", "Committed local source fixture"]);
    await prepareAssistantProfile({ repo, fromPlan, output, root, local: true, image: `local.test/agents@sha256:${"3".repeat(64)}`, command: ["/reviewed/bun", "/reviewed/assistant-cli.ts"] });
    return { dir, repo, output, root };
}

test("a local-only plan is session-probed from the pair beside its profile, never fetched by name", async () => {
    probes.length = 0;
    const fixture = await localProfile(), plan = await loadExecutionPlan(fixture.output);
    const answer = await containedDoctor({ planPath: fixture.output, probeAgents: true }, dependencies());
    const value = answer.value as { status: string; checks: { name: string; status: string }[] };
    expect(answer.exit).toBe(0);
    expect(value.status).toBe("protocol-ready");
    expect(value.checks.filter(row => row.name.endsWith("authentication")).map(row => `${row.name}:${row.status}`)).toEqual(["worker authentication:ready", "judge authentication:ready"]);
    // The probed source is the profile's own local-only identity, read from the
    // bundle: no remote is named, and no hosted URL can appear in its place.
    expect(probes.map(row => row.role)).toEqual(["worker", "judge"]);
    expect(probes.every(row => (row.repo as { url: string }).url === plan.repository.url && (row.repo as { commit: string }).commit === plan.repository.commit)).toBeTrue();
    expect(plan.repository.url.startsWith("local://")).toBeTrue();
});

test("the probe refuses by sentence when the prepared pair is absent or no longer matches the profile", async () => {
    const missing = "This profile names a local-only source; its prepared bundle was not found beside the profile. Repeat prepare --local, or select a hosted source with --source-url.";
    const moved = await localProfile(), elsewhere = join(moved.dir, "moved-profile.json");
    await writeFile(elsewhere, await readFile(moved.output));
    await expect(containedDoctor({ planPath: elsewhere, probeAgents: true }, dependencies())).rejects.toThrow(missing);

    const tampered = await localProfile(), siblings = localSourceSiblings(tampered.output);
    const bundle = await readFile(siblings.bundle);
    await rm(siblings.bundle); await writeFile(siblings.bundle, Buffer.concat([bundle, Buffer.from("\n")]), { mode: 0o600 });
    await expect(containedDoctor({ planPath: tampered.output, probeAgents: true }, dependencies())).rejects.toThrow("changed after preparation: its bundle no longer matches the SHA-256 its record names");

    const relabelled = await localProfile(), record = JSON.parse(await readFile(localSourceSiblings(relabelled.output).record, "utf8"));
    await rm(localSourceSiblings(relabelled.output).record);
    await writeFile(localSourceSiblings(relabelled.output).record, JSON.stringify({ ...record, planSha256: "a".repeat(64) }), { mode: 0o600 });
    await expect(containedDoctor({ planPath: relabelled.output, probeAgents: true }, dependencies())).rejects.toThrow("was prepared for a different profile");
    // A refused probe leaves no session evidence behind for that plan.
    expect(await readdir(moved.dir)).not.toContain("preflight");
});
