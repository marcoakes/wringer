import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { git } from "@wringer/engine";
import { observeAssertions } from "@wringer/records";
import { dispatch } from "../../cli/src/app";
import * as application from "../src";
const api = application as any;
async function fixture() {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-acceptance-"))), repo = join(root, "repo"), app = join(root, "app");
    await mkdir(join(repo, "src"), { recursive: true }); await git(repo, ["init", "-b", "main"]);
    await git(repo, ["config", "user.name", "Automated fixture"]); await git(repo, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(join(repo, "src/value.js"), "export const value = 1;\n"); await git(repo, ["add", "."]);
    await git(repo, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "source"]);
    const input = { schema_version: "wringer.acceptance-input.v1", requirements: [{ id: "value", title: "Return two", quote: "Return the value as two" }], files: [{ path: "wringer-acceptance/value.test.js", contents: 'import { test } from "node:test"; import { strictEqual } from "node:assert"; import { value } from "../src/value.js"; test("value is two", () => strictEqual(value, 2));\n' }], checks: [{ id: "value", run: "node --test --test-reporter=./wringer-acceptance/node-reporter.mjs wringer-acceptance/value.test.js", inputs: ["wringer-acceptance/value.test.js"], requirements: ["value"], adapter: "node-test" }] };
    return { root, repo, app, input };
}
test("reviewed inert acceptance preparation freezes new tests without running them or editing the user's source", async () => {
    expect(typeof api.inspectAcceptancePreparation).toBe("function"); const f = await fixture();
    const head = (await git(f.repo, ["rev-parse", "HEAD"])).stdout.trim(), preview = await api.inspectAcceptancePreparation(f.app, f.repo, f.input);
    expect(preview.authority).toBe("none"); expect(preview.files[0].contents).toContain("strictEqual(value, 2)");
    expect(await Bun.file(join(f.repo, "wringer-acceptance/value.test.js")).exists()).toBe(false);
    const prepared = await api.applyAcceptancePreparation(f.app, preview, { expectedIdentity: preview.identity, actor: "Automated preparation fixture" });
    expect(prepared.baseCommit).toBe(head); expect(prepared.commit).not.toBe(head); expect(prepared.executionApproved).toBe(false);
    expect((await git(f.repo, ["rev-parse", "HEAD"])).stdout.trim()).toBe(head); expect((await git(f.repo, ["status", "--porcelain"])).stdout).toBe("");
    expect((await api.applyAcceptancePreparation(f.app, preview, { expectedIdentity: preview.identity, actor: "Automated preparation fixture" })).id).toBe(prepared.id);
    const inputFile = join(f.root, "input.json"); await writeFile(inputFile, JSON.stringify(f.input));
    const command = ["setup", "--repo", f.repo, "--app-dir", f.app, "--prepare-acceptance", inputFile];
    expect(((await dispatch([...command, "--dry-run", "--json"])).value as any).identity).toBe(preview.identity);
    const provisionId = crypto.randomUUID(); await application.writeAssistantRecord(f.app, `provisions/${provisionId}/result.json`, { schema_version: "wringer.runtime-provisioned.v1", id: provisionId, image: `fixture/image@sha256:${"a".repeat(64)}`, inventory: { node: "24.19.0", bun: "1.4.2" } });
    const selection = { provisionId, acceptanceId: prepared.id, worker: { provider: "openai", model: "fixture" }, judge: { provider: "anthropic", model: "fixture" }, source: { kind: "local" }, dependencies: "none", network: { policy: "deny" } };
    const profile = await application.inspectDelegationProfile(f.app, f.repo, selection as any);
    expect(profile.plan.acceptance.checks[0]!.evidence).toEqual({ kind: "assertions", format: "wringer-check.v1" });
    expect(profile.plan.acceptance.protected_paths).toContain("wringer-acceptance/value.test.js"); expect(profile.plan.scope.writable).toEqual(["src"]);
    const remapped = application.composeAuthorableProposal(profile.plan, { intent: "Return the value as two", title: "Prepared requirement", criteria: [{ id: "renamed", title: "Two", quote: "Return the value as two", kind: "check", required: true }], checks: [{ id: "value", criteria: ["renamed"] }] });
    expect(remapped.valid).toBe(false); expect(remapped.errors[0]?.code).toBe("assertion-mapping-pinned");
    // Real runner measurement in a scratch checkout, labelled trusted-local.
    // This does not establish container execution or a model's implementation.
    const argv = [...profile.plan.acceptance.checks[0]!.argv]; argv[0] = process.execPath;
    async function run() { const child = Bun.spawn(argv, { cwd: prepared.sourceRepo, stdout: "pipe", stderr: "pipe" }); const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); expect(err).toBe(""); const report = JSON.parse(out); return { report, observed: observeAssertions("value", () => report, exit, ["value"]) }; }
    const red = await run(); expect(red.observed.status).toBe("established"); expect(red.report.assertions[0].status).toBe("failed");
    await writeFile(join(prepared.sourceRepo, "src/value.js"), "export const value = 2;\n");
    const green = await run(); expect(green.observed.status).toBe("established"); expect(green.report.assertions[0].status).toBe("passed");
    await writeFile(join(prepared.sourceRepo, "src/value.js"), "export const value = 1;\n");
    const applied = await application.applyDelegationProfile(f.app, profile, { expectedIdentity: profile.identity, actor: "Automated profile fixture", cooperativeLocal: true });
    expect(applied.repo).toBe(f.repo); expect(applied.plan.repository.commit).toBe(prepared.commit);
    await application.verifyLocalSource(applied.plan, application.localSourceSiblings(join(f.app, "profiles", applied.id, "profile.json")));
    await writeFile(join(f.repo, "src/value.js"), "export const value = 9;\n");
    await expect(application.inspectDelegationProfile(f.app, f.repo, selection as any)).rejects.toThrow("committed");
}, 20000);
test("acceptance preparation refuses traversal, overwrite, changed preview and source without execution", async () => {
    expect(typeof api.inspectAcceptancePreparation).toBe("function"); const f = await fixture();
    for (const path of ["../outside", "src/value.js", "wringer-acceptance/../src/value.js", "wringer-acceptance/.git/config"]) {
        await expect(api.inspectAcceptancePreparation(f.app, f.repo, { ...f.input, files: [{ path, contents: "no execution" }], checks: [{ ...f.input.checks[0], inputs: [path] }] })).rejects.toThrow();
    }
    const preview = await api.inspectAcceptancePreparation(f.app, f.repo, f.input);
    await expect(api.applyAcceptancePreparation(f.app, preview, { expectedIdentity: "a".repeat(64), actor: "Automated fixture" })).rejects.toThrow("exact");
    await expect(api.applyAcceptancePreparation(f.app, { ...preview, files: [{ ...preview.files[0], contents: "changed" }] }, { expectedIdentity: preview.identity, actor: "Automated fixture" })).rejects.toThrow("changed");
    await writeFile(join(f.repo, "src/value.js"), "uncommitted\n");
    await expect(api.applyAcceptancePreparation(f.app, preview, { expectedIdentity: preview.identity, actor: "Automated fixture" })).rejects.toThrow("committed");
});
