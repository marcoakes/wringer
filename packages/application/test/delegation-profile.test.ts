import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { git } from "@wringer/engine";
import { hashValue } from "@wringer/plan";
import * as application from "../src";
import { dispatch } from "../../cli/src/app";
const roots: string[] = []; afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-guided-profile-"))); roots.push(root);
    const repo = join(root, "repo"), app = join(root, "app"); await mkdir(join(repo, "src"), { recursive: true }); await mkdir(join(repo, "tests"));
    await git(repo, ["init", "--initial-branch=main"]);
    await git(repo, ["config", "user.name", "Automated fixture"]); await git(repo, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(join(repo, "src/value.ts"), "export const value = 1;\n"); await writeFile(join(repo, "tests/check.ts"), 'throw new Error("Inspection must not run me");\n');
    await writeFile(join(repo, "package.json"), JSON.stringify({ packageManager: "bun@1.4.2", scripts: { test: "bun tests/check.ts" } }));
    await writeFile(join(repo, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "test", run: "bun tests/check.ts", inputs: ["tests/check.ts", "package.json"] }] }));
    await git(repo, ["add", "."]); await git(repo, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    const provisionId = crypto.randomUUID(); await application.createAssistantDirectory(app);
    await application.writeAssistantRecord(app, `provisions/${provisionId}/result.json`, { schema_version: "wringer.runtime-provisioned.v1", id: provisionId, image: `fixture/image@sha256:${"a".repeat(64)}`, platform: "linux/arm64", inventory: { node: "24.19.0", bun: "1.4.2", packages: {} }, containment: "unmeasured" });
    const selection = { provisionId, worker: { provider: "openai", model: "fixture-worker" }, judge: { provider: "anthropic", model: "fixture-judge" }, source: { kind: "local" }, dependencies: "none", network: { policy: "deny" } };
    return { root, repo, app, selection };
}
test("T07 guided contained profile discovers narrow source and protected check bytes without executing repository code", async () => {
    const f = await fixture(), inspect = (application as any).inspectDelegationProfile; expect(typeof inspect).toBe("function");
    const preview = await inspect(f.app, f.repo, f.selection);
    expect(preview.plan.scope.writable).toEqual(["src"]); expect(preview.plan.acceptance.protected_paths).toContain("tests/check.ts");
    expect(preview.plan.agents.worker.args).toEqual(["/opt/wringer-agents/model-launch.ts", "openai", "fixture-worker"]);
    expect(preview.plan.agents.judge.env).toEqual(["ANTHROPIC_API_KEY"]); expect(preview.plan.repository.url).toMatch(/^local:\/\/[a-f0-9]{40}$/);
    expect(preview.authority).toBe("none"); expect(preview.readiness.containment).toBe("unmeasured");
    expect(preview.eligibility.productAcceptance).toBe("needs-job-requirements");
    expect(await Bun.file(join(f.app, "profiles", preview.id + ".json")).exists()).toBeFalse();
});
test("T07 profile inspection refuses dirty source, implicit models and writable acceptance inputs", async () => {
    const f = await fixture(), inspect = (application as any).inspectDelegationProfile; expect(typeof inspect).toBe("function");
    await expect(inspect(f.app, f.repo, { ...f.selection, worker: { provider: "openai" } })).rejects.toThrow("model");
    await expect(inspect(join(f.repo, ".wringer", "app"), f.repo, f.selection)).rejects.toThrow("outside");
    await expect(inspect(f.app, f.repo, { ...f.selection, writable: ["tests/check.ts"] })).rejects.toThrow("protected");
    await writeFile(join(f.repo, "src/value.ts"), "export const value = 2;\n");
    await expect(inspect(f.app, f.repo, f.selection)).rejects.toThrow("uncommitted");
});
test("T07 applying a reviewed profile keeps a verified local-only bundle, is idempotent and grants no work", async () => {
    const f = await fixture(), inspect = application.inspectDelegationProfile, apply = (application as any).applyDelegationProfile;
    expect(typeof apply).toBe("function");
    const preview = await inspect(f.app, f.repo, f.selection as any);
    const decision = { expectedIdentity: preview.identity, actor: "Automated setup fixture", cooperativeLocal: true };
    const profile = await apply(f.app, preview, decision);
    expect(profile.plan.repository).toEqual(preview.plan.repository); expect(profile.executionApproved).toBeFalse();
    const kept = await application.verifyLocalSource(profile.plan, application.localSourceSiblings(join(f.app, "profiles", profile.id, "profile.json")));
    expect(kept.record.commit).toBe(preview.source.commit); expect(kept.bundle.length).toBeGreaterThan(0);
    expect((await apply(f.app, preview, decision)).id).toBe(profile.id);
    await writeFile(join(f.repo, "src/value.ts"), "export const value = 22;\n");
    await expect(apply(f.app, preview, decision)).rejects.toThrow("uncommitted");
});
test("T07 canonical setup applies the displayed contained profile without hand-written policy or source changes", async () => {
    const f = await fixture();
    const args = ["setup", "--repo", f.repo, "--app-dir", f.app, "--mode", "delegation", "--client", "generic", "--provision", f.selection.provisionId, "--worker-provider", "openai", "--worker-model", "fixture-worker", "--judge-provider", "anthropic", "--judge-model", "fixture-judge", "--source", "local", "--dependencies", "none", "--network", "deny"];
    const preview: any = (await dispatch([...args, "--dry-run", "--json"])).value;
    expect(preview.authority).toBe("none");
    const applied: any = (await dispatch([...args, "--apply", "--expected", preview.identity, "--actor", "Automated setup fixture", "--cooperative-local"])).value;
    expect(applied.workspace.mode).toBe("delegation"); expect(applied.workspace.preferences.profileId).toBe(applied.profile.id);
    expect((await application.safeWorkspaceSnapshot(f.repo)).dirty).toBeFalse();
    expect(applied.profile.executionApproved).toBeFalse();
});
test("T18 delegation job preparation preserves a first source and gives a second job its new clean source without any approval", async () => {
    const create = (application as any).createDelegationJob; expect(typeof create).toBe("function");
    const f = await fixture(), preview = await application.inspectDelegationProfile(f.app, f.repo, f.selection as any);
    const profile = await application.applyDelegationProfile(f.app, preview, { expectedIdentity: preview.identity, actor: "Automated setup fixture", cooperativeLocal: true });
    const workspace = await application.registerWorkspace(f.app, { repo: f.repo, mode: "delegation", client: "generic", profileId: profile.id });
    const request = { intent: "Return the value as 5.", idempotencyKey: crypto.randomUUID() };
    const first = await create(f.app, workspace.id, request);
    expect(first.mode).toBe("delegation"); expect(first.workspaceId).toBe(workspace.id); expect(first.source.commit).toBe(preview.source.commit);
    const status = await (application as any).delegationJobStatus(f.app, first.id); expect(status.outcome).toBe("needs-decision"); expect(status.remaining.monetaryCost).toBeNull();
    await writeFile(join(f.repo, "src/value.ts"), "export const value = 2;\n"); await git(f.repo, ["add", "."]); await git(f.repo, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "second source"]);
    expect((await create(f.app, workspace.id, request)).id).toBe(first.id);
    await expect(create(f.app, workspace.id, { ...request, intent: "Changed request" })).rejects.toThrow();
    const second = await create(f.app, workspace.id, { intent: "Return the value as 8.", idempotencyKey: crypto.randomUUID(), parentJobId: first.id });
    expect(second.source.commit).not.toBe(first.source.commit); expect(second.parentJobId).toBe(first.id);
    expect((await (application as any).readDelegationJob(f.app, first.id)).source.commit).toBe(first.source.commit);
    expect((await (application as any).delegationJobStatus(f.app, second.id)).outcome).toBe("needs-decision");
}, 20000);

test("gVisor profile binds the measured cluster boundary and references without reading provider secrets", async () => {
    const f = await fixture(), provisionId = crypto.randomUUID(), readinessId = crypto.randomUUID();
    const plan = application.previewGvisorProvision({ id: provisionId, context: "fixture-cluster", runtimeClass: "gvisor", image: `fixture/image@sha256:${"b".repeat(64)}`, secretRefs: { CODEX_API_KEY: { name: "worker", key: "api-key" }, ANTHROPIC_API_KEY: { name: "judge", key: "api-key" } } });
    await application.writeAssistantRecord(f.app, `provisions/${provisionId}/plan.json`, { plan });
    await application.writeAssistantRecord(f.app, `provisions/${provisionId}/result.json`, { schema_version: "wringer.gvisor-provisioned.v1", id: provisionId, planSha256: plan.sha256, context: plan.context, namespace: plan.namespace, runtimeClass: plan.runtimeClass, image: plan.image });
    const inventory = { node: "24.19.0", bun: "1.4.2", lock: "c".repeat(64), modelLauncher: "d".repeat(64), packages: { "@agentclientprotocol/codex-acp": "1.10.0", "@agentclientprotocol/claude-agent-acp": "0.65.0", "@openai/codex": "0.153.4", "@anthropic-ai/claude-agent-sdk": "0.3.220" } };
    const rows: any[] = application.REQUIRED_RUNTIME_MEASUREMENTS.map(id => ({ id, status: "pass", detail: id === "runtime-inventory" ? inventory : {} }));
    for (let n = 0; n < 5; n++) rows.push({ id: `cleanup-fixture-${n}`, status: "pass", detail: { runtimeId: `fixture-${n}`, absentFromSuccessfulPlatformListing: true } });
    const report = { schema_version: "wringer.live-runtime-smoke.v1", status: "pass", runtime: { kind: "gvisor-kubernetes", context: plan.context, namespace: plan.namespace, runtimeClass: plan.runtimeClass, image: plan.image }, modelPromptsSent: 0, providerCredentialsForwarded: false, providerAuthenticationMeasured: false, rows };
    const reportPath = `readiness-${readinessId}/report.json`;
    await mkdir(join(f.app, "provisions", provisionId, `readiness-${readinessId}`)); await writeFile(join(f.app, "provisions", provisionId, reportPath), JSON.stringify(report));
    await application.writeAssistantRecord(f.app, `provisions/${provisionId}/readiness/${readinessId}.json`, { schema_version: "wringer.runtime-readiness.v1", provisionId, id: readinessId, image: plan.image, reportPath, reportSha256: hashValue(report), inventory, measuredAt: "2026-09-27T00:00:00Z" });
    const preview = await application.inspectDelegationProfile(f.app, f.repo, { ...f.selection, provisionId, readinessId } as any);
    expect(preview.plan.runtime).toMatchObject({ kind: "gvisor-kubernetes", context: plan.context, namespace: plan.namespace, runtimeClass: "gvisor", secretRefs: plan.secretReferences });
    expect(preview.readiness.providerAcceptance).toBe("unmeasured"); expect(preview.plan.runtime.env).toEqual(["ANTHROPIC_API_KEY", "CODEX_API_KEY"]);
    await expect(application.inspectDelegationProfile(f.app, f.repo, { ...f.selection, provisionId } as any)).rejects.toThrow("inventory");
});
