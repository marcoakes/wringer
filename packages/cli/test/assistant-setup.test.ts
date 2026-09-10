import { afterEach, describe, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalPlanJson, compileDeclaration, hashBytes, loadExecutionPlan, type ExecutionPlan } from "@wringer/plan";
import { initializeAssistant, localSourceSiblings, readAssistantLocalSource, verifyLocalSource } from "@wringer/application";
import { assistantCommand, readCodexConnection } from "../src/assistant-cli";
import { assistantMaintenanceRecipe, inspectAssistantCredentials, inspectAssistantSetup, inspectKeychainEntry, prepareAssistantProfile, renderAssistantSetup, type AssistantSetupDependencies } from "../src/assistant-setup";

const roots: string[] = [], command = ["/reviewed/bun", "--no-env-file", "/reviewed/assistant-cli.ts"];
const example = new URL("../../plan/examples/contained.yaml", import.meta.url).pathname;
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function scratch() { const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-assistant-setup-"))); roots.push(root); return root; }
const dependencies = (override: Partial<AssistantSetupDependencies> = {}): AssistantSetupDependencies => ({ platform: "darwin", environmentNames: new Set(), which: () => "/trusted/tool", keychainEntry: async () => { throw new Error("No Keychain query was authorized by this fixture"); }, ...override });
async function measuredPlan(): Promise<ExecutionPlan> {
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...declaration } = await loadExecutionPlan(example);
    return compileDeclaration({ version: 1, ...declaration, repository: { url: "https://example.com/operator/source.git", commit: "1".repeat(40) }, runtime: { ...declaration.runtime, image: `local.test/agents@sha256:${"2".repeat(64)}` }, environment: { ...declaration.environment, tools: [{ name: "bun", version: "1.4.2", probe: ["bun", "--version"] }] } });
}

describe("assistant setup inspects names and declarations, never invents live readiness", () => {
    test("the default creates no controller and names the missing protected boundary/profile", async () => {
        const root = join(await scratch(), "not-created"), result = await inspectAssistantSetup({ root, command, cooperativeLocal: false }, dependencies());
        expect(result.outcome).toBe("needs-attention"); expect(result.effects).toEqual({ modelPrompts: 0, keychainPasswordsRead: false, configurationChanged: false, controllerCreated: false });
        expect(result.checks.find(check => check.id === "authority-boundary")?.status).toBe("needs-attention");
        expect(result.checks.find(check => check.id === "profile")?.status).toBe("needs-attention");
        await expect(lstat(root)).rejects.toThrow(); expect(renderAssistantSetup(result)).toContain("What to do next");
    });
    test("compile-only placeholders cannot become a ready-to-run setup verdict", async () => {
        const root = join(await scratch(), "controller");
        const result = await inspectAssistantSetup({ root, planPath: example, command, cooperativeLocal: true }, dependencies());
        expect(result.checks.find(check => check.id === "source-and-image")?.status).toBe("needs-attention");
        expect(result.credentials.map(row => row.source)).toEqual(["not-inspected", "not-inspected"]);
        expect(result.nextActions.find(action => action.id === "credential-metadata")?.command).toContain("--check-keychain");
        expect(renderAssistantSetup(result)).toContain("denies network"); await expect(lstat(root)).rejects.toThrow();
    });
    test("setup rejects a shared controller using the same metadata policy as init without repairing it", async () => {
        const dir = await scratch(), root = join(dir, "controller"), plan = await measuredPlan(), planPath = join(dir, "plan.json");
        await writeFile(planPath, canonicalPlanJson(plan)); await mkdir(root, { mode: 0o755 }); await chmod(root, 0o755);
        const options = { root, planPath, command, cooperativeLocal: true }, before = await lstat(root), blocked = await inspectAssistantSetup(options, dependencies());
        expect(blocked.outcome).toBe("needs-attention"); expect(blocked.checks.find(check => check.id === "controller-directory")?.status).toBe("needs-attention");
        expect(blocked.nextActions.find(action => action.id === "controller-permissions")?.command).toBe(`chmod 700 '${root}'`);
        expect((await lstat(root)).mode).toBe(before.mode); await expect(lstat(join(root, "workspace.json"))).rejects.toThrow();
        await expect(initializeAssistant(root, { plan, cooperativeLocal: true })).rejects.toThrow("private directory");
        await chmod(root, 0o700);
        const ready = await inspectAssistantSetup(options, dependencies()); expect(ready.checks.find(check => check.id === "controller-directory")?.status).toBe("observed");
        expect((await initializeAssistant(root, { plan, cooperativeLocal: true })).created).toBeTrue();
    });
    test("setup reports file and symlink controller paths without modifying their targets", async () => {
        const dir = await scratch(), file = join(dir, "not-a-directory"), alias = join(dir, "alias");
        await writeFile(file, "KEEP"); await symlink(file, alias);
        for (const root of [file, alias]) {
            const report = await inspectAssistantSetup({ root, command, cooperativeLocal: true }, dependencies());
            expect(report.checks.find(check => check.id === "controller-directory")?.status).toBe("needs-attention");
            expect(report.nextActions.some(action => action.id === "controller-permissions")).toBeFalse();
        }
        expect(await readFile(file, "utf8")).toBe("KEEP"); expect((await lstat(alias)).isSymbolicLink()).toBeTrue();
    });
    test("environment names and existing Keychain entry metadata remain unvalidated, with no value reads", async () => {
        const calls: string[] = [], plan = await measuredPlan();
        const rows = await inspectAssistantCredentials(plan, true, dependencies({ environmentNames: new Set(["CODEX_API_KEY"]), keychainEntry: async service => { calls.push(service); return "present"; } }));
        expect(calls).toEqual(["anthropic-api-key"]);
        expect(rows).toEqual([{ name: "ANTHROPIC_API_KEY", source: "keychain-entry", providerValidity: "not-validated" }, { name: "CODEX_API_KEY", source: "environment-name", providerValidity: "not-validated" }]);
        expect(await inspectAssistantCredentials(plan, true, dependencies({ keychainEntry: async () => "unavailable" }))).toMatchObject([{ source: "unavailable" }, { source: "unavailable" }]);
        expect(await inspectAssistantCredentials(plan, true, dependencies({ keychainEntry: async () => "absent" }))).toMatchObject([{ source: "not-found" }, { source: "not-found" }]);
        await expect(inspectKeychainEntry("unrelated-account-service")).rejects.toThrow("Only the declared");
    });
    test("runtime Secret references are not mistaken for missing host Keychain credentials", async () => {
        const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...declaration } = await measuredPlan();
        const plan = compileDeclaration({ version: 1, ...declaration, runtime: { kind: "gvisor-kubernetes", image: declaration.runtime.image, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, context: "fixture", namespace: "fixture", runtimeClass: "gvisor", env: ["CODEX_API_KEY", "ANTHROPIC_API_KEY"], secretRefs: { CODEX_API_KEY: { name: "worker", key: "api-key" }, ANTHROPIC_API_KEY: { name: "judge", key: "api-key" } } } });
        expect((await inspectAssistantCredentials(plan, true, dependencies({ platform: "linux" }))).map(row => row.source)).toEqual(["runtime-secret-reference", "runtime-secret-reference"]);
    });
    test("retained setup is read-only and warns on mismatched profiles without disclosing parser inputs", async () => {
        const dir = await scratch(), root = join(dir, "controller"), plan = await measuredPlan();
        await initializeAssistant(root, { plan, cooperativeLocal: true }); const before = await readFile(join(root, "workspace.json"), "utf8");
        const matching = await inspectAssistantSetup({ root, command, cooperativeLocal: true }, dependencies());
        expect(matching.existingWorkspace).toBeTrue(); expect(matching.planSha256).toBe(plan.plan_sha256); expect(matching.outcome).toBe("inspection-complete");
        expect(matching.nextActions[0]?.id).toBe("status"); expect(await readFile(join(root, "workspace.json"), "utf8")).toBe(before);
        const mismatch = await inspectAssistantSetup({ root, planPath: example, command, cooperativeLocal: true }, dependencies());
        expect(mismatch.outcome).toBe("needs-attention"); expect(mismatch.planSha256).toBeNull();
        const malformed = join(dir, "bad.json"); await writeFile(malformed, '{"secret":"NEVER_ECHO_SETUP_INPUT",');
        expect(JSON.stringify(await inspectAssistantSetup({ root, planPath: malformed, command, cooperativeLocal: true }, dependencies()))).not.toContain("NEVER_ECHO_SETUP_INPUT");
    });
    test("upgrade and uninstall are truthful instructions-only and preserve all controller bytes", async () => {
        const root = join(await scratch(), "controller"); await initializeAssistant(root, { plan: await measuredPlan(), cooperativeLocal: true });
        const before = await readFile(join(root, "workspace.json"), "utf8");
        for (const action of ["upgrade", "uninstall"] as const) {
            const answer = await assistantCommand([action, "--root", root]);
            expect(answer.value).toMatchObject({ executed: false, evidencePreserved: true }); expect(answer.text).toContain("instructions only");
            expect(answer.text).not.toContain("rm -"); expect(await readFile(join(root, "workspace.json"), "utf8")).toBe(before);
            expect(assistantMaintenanceRecipe(root, command, action).steps[1]?.id).toBe("revoke");
        }
    });
    test("instructions-only maintenance never creates an absent controller", async () => {
        for (const action of ["upgrade", "uninstall"]) {
            const root = join(await scratch(), "must-not-be-created");
            await expect(assistantCommand([action, "--root", root])).rejects.toThrow();
            await expect(lstat(root)).rejects.toThrow();
        }
    });
    test("CLI setup never silently chooses cooperative mode and rejects invalid options", async () => {
        const root = join(await scratch(), "controller"), result = await assistantCommand(["setup", "--root", root]);
        expect(result.exit).toBe(3); expect(result.text).toContain("Protected delegation is not established");
        await expect(assistantCommand(["setup", "--root", root, "--check-keychain=true"])).rejects.toThrow("takes no value");
        await expect(assistantCommand(["setup", "--root", root, "--approve"])).rejects.toThrow();
    });
    test("Codex matching command cannot conceal symlinks, injected environment or disabled tools", async () => {
        const dir = await scratch(), path = join(dir, "config.toml"), alias = join(dir, "alias.toml"), base = '[mcp_servers.wringer]\ncommand = "/safe/wringer"\nargs = []\n';
        await writeFile(path, base); await symlink(path, alias);
        expect((await readCodexConnection(alias, ["/safe/wringer"])).state).toBe("unreadable");
        for (const extra of ['env_vars = ["PRIVATE_KEY"]', 'disabled_tools = ["wringer.get_status"]', 'enabled_tools = ["wringer.get_status"]', 'cwd = "/untrusted/repo"', '[mcp_servers.wringer.env]\nPRIVATE_KEY = "NEVER_ECHO_CLIENT_SECRET"']) {
            await writeFile(path, base + extra + "\n"); const state = await readCodexConnection(path, ["/safe/wringer"]);
            expect(state.state).toBe("different"); expect(JSON.stringify(state)).not.toContain("NEVER_ECHO_CLIENT_SECRET");
        }
    });
});

async function git(repo: string, args: string[]) {
    const child = Bun.spawn(["git", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-C", repo, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Setup fixture", GIT_AUTHOR_EMAIL: "setup@localhost", GIT_COMMITTER_NAME: "Setup fixture", GIT_COMMITTER_EMAIL: "setup@localhost" } });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(`Git fixture failed: ${err}`); return out.trim();
}
async function profileFixture() {
    const dir = await scratch(), repo = join(dir, "repo"), fromPlan = join(dir, "selected.json"), output = join(dir, "prepared.json"), root = join(dir, "controller"), plan = await measuredPlan();
    await mkdir(repo); await mkdir(join(repo, "tests")); await mkdir(join(repo, "src"));
    for (const name of ["README.md", "package.json", "bun.lock", "tests/acceptance.test.ts", "src/index.ts"]) await writeFile(join(repo, name), "fixture\n");
    await git(repo, ["init"]); await git(repo, ["add", "."]); await git(repo, ["commit", "-m", "Committed source fixture"]);
    await writeFile(fromPlan, canonicalPlanJson(plan));
    return { dir, repo, fromPlan, output, root, command, image: `local.test/agents@sha256:${"3".repeat(64)}` };
}
describe("explicit profile preparation pins actual Git without running repository code", () => {
    test("prepares once, preserves selected policy and is idempotent without authority or key access", async () => {
        const fixture = await profileFixture(), original = await loadExecutionPlan(fixture.fromPlan), result = await prepareAssistantProfile(fixture), plan = await loadExecutionPlan(fixture.output);
        expect(result.created).toBeTrue(); expect(plan.repository).toEqual({ url: original.repository.url, commit: await git(fixture.repo, ["rev-parse", "HEAD"]) });
        expect(plan.runtime.image).toBe(fixture.image); expect(plan.acceptance).toEqual(original.acceptance); expect(plan.agents).toEqual(original.agents); expect(plan.budget).toEqual(original.budget);
        expect(result.executed).toMatchObject({ modelPrompts: 0, keychainPasswordsRead: false, controllerCreated: false, approvalCreated: false });
        const before = await readFile(fixture.output, "utf8"); expect((await prepareAssistantProfile(fixture)).created).toBeFalse(); expect(await readFile(fixture.output, "utf8")).toBe(before);
        await expect(lstat(fixture.root)).rejects.toThrow(); expect((await lstat(fixture.output)).mode & 0o777).toBe(0o600);
    });
    test("dirty sources, placeholders, missing check inputs and in-repository output refuse", async () => {
        const fixture = await profileFixture();
        await writeFile(join(fixture.repo, "uncommitted.txt"), "Do not omit my change");
        await expect(prepareAssistantProfile(fixture)).rejects.toThrow("uncommitted or untracked"); await expect(lstat(fixture.output)).rejects.toThrow();
        await git(fixture.repo, ["add", "."]); await git(fixture.repo, ["commit", "-m", "Include intended source"]);
        await expect(prepareAssistantProfile({ ...fixture, image: "mutable:latest" })).rejects.toThrow("digest-qualified");
        await expect(prepareAssistantProfile({ ...fixture, fromPlan: example })).rejects.toThrow("placeholder tool versions");
        await expect(prepareAssistantProfile({ ...fixture, output: join(fixture.repo, "plan.json") })).rejects.toThrow("outside");
        await git(fixture.repo, ["rm", "tests/acceptance.test.ts"]); await git(fixture.repo, ["commit", "-m", "Absent acceptance input"]);
        await expect(prepareAssistantProfile(fixture)).rejects.toThrow("absent from this committed source");
    });
    test("existing different outputs and symlink output paths are never overwritten", async () => {
        const fixture = await profileFixture(); await writeFile(fixture.output, "Keep this user file");
        await expect(prepareAssistantProfile(fixture)).rejects.toThrow("not overwritten"); expect(await readFile(fixture.output, "utf8")).toBe("Keep this user file");
        const alias = join(fixture.dir, "alias.json"); await symlink(fixture.output, alias);
        await expect(prepareAssistantProfile({ ...fixture, output: alias })).rejects.toThrow("symlinks");
    });
    test("configured repository fsmonitor hook is never executed by source inspection", async () => {
        const fixture = await profileFixture(), marker = join(fixture.dir, "hook-was-run"), hook = join(fixture.dir, "hook.sh");
        await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
        await git(fixture.repo, ["config", "core.fsmonitor", hook]);
        expect((await prepareAssistantProfile(fixture)).created).toBeTrue(); await expect(lstat(marker)).rejects.toThrow();
    });
    test("committed and newly staged submodule sources refuse without recursive status", async () => {
        for (const committed of [false, true]) {
            const fixture = await profileFixture(), commit = await git(fixture.repo, ["rev-parse", "HEAD"]);
            await git(fixture.repo, ["update-index", "--add", "--cacheinfo", `160000,${commit},nested`]);
            if (committed) await git(fixture.repo, ["commit", "-m", "Gitlink fixture"]);
            await expect(prepareAssistantProfile(fixture)).rejects.toThrow("contains submodules");
            await expect(lstat(fixture.output)).rejects.toThrow();
        }
    });
    test("repository clean/process filters, including included config, refuse before status can execute them", async () => {
        for (const included of [false, true]) {
            const fixture = await profileFixture(), marker = join(fixture.dir, "filter-was-run"), filter = join(fixture.dir, "filter.sh");
            await writeFile(filter, `#!/bin/sh\ntouch '${marker}'\ncat\n`, { mode: 0o700 });
            await writeFile(join(fixture.repo, ".gitattributes"), "src/index.ts filter=unsafe\n");
            await git(fixture.repo, ["add", ".gitattributes"]); await git(fixture.repo, ["commit", "-m", "Filter attribute without command"]);
            if (included) {
                const config = join(fixture.dir, "included.gitconfig"); await writeFile(config, `[filter "unsafe"]\n\tprocess = ${JSON.stringify(filter)}\n`);
                await git(fixture.repo, ["config", "include.path", config]);
            } else await git(fixture.repo, ["config", "filter.unsafe.clean", filter]);
            await writeFile(join(fixture.repo, "src/index.ts"), "changed content to force a hash refresh\n");
            await expect(prepareAssistantProfile(fixture)).rejects.toThrow("Git content filter");
            await expect(lstat(marker)).rejects.toThrow(); await expect(lstat(fixture.output)).rejects.toThrow();
        }
    });
});

describe("a local-only source is prepared through the one bundle door the rehearsals use", () => {
    async function localFixture() {
        const fixture = await profileFixture(), { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...declaration } = await loadExecutionPlan(fixture.fromPlan);
        await writeFile(fixture.fromPlan, canonicalPlanJson(compileDeclaration({ ...declaration, version: 3 })));
        return { ...fixture, local: true as const };
    }
    const trio = (output: string) => [output, localSourceSiblings(output).record, localSourceSiblings(output).bundle];
    const pending = async (output: string) => (await readdir(dirname(output))).filter(name => name.endsWith(".pending"));
    test("prepare --local names the history's root, writes the pair beside the profile once, and setup and init verify it", async () => {
        const fixture = await localFixture(), result = await prepareAssistantProfile(fixture), plan = await loadExecutionPlan(fixture.output);
        const root = await git(fixture.repo, ["rev-list", "--max-parents=0", "HEAD"]), head = await git(fixture.repo, ["rev-parse", "HEAD"]);
        expect(plan.schema_version).toBe("wringer.execution-plan.v4"); expect(plan.repository).toEqual({ url: `local://${root}`, commit: head });
        const verified = await verifyLocalSource(plan, localSourceSiblings(fixture.output));
        expect(verified.record).toEqual({ schema_version: "wringer.local-source.v1", planSha256: plan.plan_sha256, url: `local://${root}`, commit: head, rootCommit: root, bundleSha256: hashBytes(verified.bundle), bundleBytes: verified.bundle.length });
        expect(result.localSource).toEqual({ ...localSourceSiblings(fixture.output), rootCommit: root }); expect(result.remoteCommitAvailable).toBe("not-applicable");
        for (const path of trio(fixture.output)) expect((await lstat(path)).mode & 0o777).toBe(0o600);
        expect(await pending(fixture.output)).toEqual([]);
        const before = await Promise.all(trio(fixture.output).map(path => readFile(path)));
        expect((await prepareAssistantProfile(fixture)).created).toBeFalse();
        expect(await Promise.all(trio(fixture.output).map(path => readFile(path)))).toEqual(before);
        await expect(lstat(fixture.root)).rejects.toThrow();
        const setup = await inspectAssistantSetup({ root: fixture.root, planPath: fixture.output, command, cooperativeLocal: true }, dependencies());
        expect(setup.checks.find(check => check.id === "local-source")?.status).toBe("observed");
        expect((await assistantCommand(["init", "--root", fixture.root, "--plan", fixture.output, "--cooperative-local"])).value).toMatchObject({ created: true });
        expect((await readAssistantLocalSource(fixture.root, plan)).record).toEqual(verified.record);
    });
    test("--local refuses beside --source-url, from a v1 profile and on a two-root history; the placeholder names both doors", async () => {
        const fixture = await localFixture();
        await expect(prepareAssistantProfile({ ...fixture, sourceUrl: "https://example.com/operator/source.git" })).rejects.toThrow("Choose one source: --local names a local-only source from this checkout, --source-url names a hosted one. Nothing was written.");
        await expect(prepareAssistantProfile({ ...await profileFixture(), local: true })).rejects.toThrow("A local-only source needs a version 3 profile, which carries the loop policy and evidence contract it keeps; this profile is version 1. Nothing was written.");
        const placeholder = await profileFixture(), { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...selected } = await loadExecutionPlan(placeholder.fromPlan);
        await writeFile(placeholder.fromPlan, canonicalPlanJson(compileDeclaration({ ...selected, version: 1, repository: { ...selected.repository, url: "https://example.invalid/OWNER/REPOSITORY.git" } })));
        await expect(prepareAssistantProfile(placeholder)).rejects.toThrow("This profile's repository is a compile-only placeholder. Select the actual hosted HTTPS/SSH source with --source-url, or name a local-only source from this checkout with --local. No network request was made.");
        const branch = await git(fixture.repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
        await git(fixture.repo, ["checkout", "--quiet", "--orphan", "other"]); await git(fixture.repo, ["rm", "-rf", "--quiet", "."]);
        await writeFile(join(fixture.repo, "other.txt"), "second root\n"); await git(fixture.repo, ["add", "."]); await git(fixture.repo, ["commit", "-m", "Second root"]);
        await git(fixture.repo, ["checkout", "--quiet", branch]); await git(fixture.repo, ["merge", "--quiet", "--allow-unrelated-histories", "-m", "Join histories", "other"]);
        await expect(prepareAssistantProfile(fixture)).rejects.toThrow("This history has 2 root commits, and local identity needs one root; name the remote instead with --source-url. No bundle was written.");
        for (const path of trio(fixture.output)) await expect(lstat(path)).rejects.toThrow();
        expect(await pending(fixture.output)).toEqual([]);
    });
    test("after the source moves on, repeating prepare into the same output replaces nothing, and the pinned pair still initialises", async () => {
        const fixture = await localFixture(); await prepareAssistantProfile(fixture);
        const before = await Promise.all(trio(fixture.output).map(path => readFile(path)));
        await writeFile(join(fixture.repo, "src/index.ts"), "moved on\n"); await git(fixture.repo, ["commit", "-am", "Source moved after preparation"]);
        await expect(prepareAssistantProfile(fixture)).rejects.toThrow("The output already exists with different or unreadable data. It was not overwritten; choose a separate reviewed output.");
        expect(await Promise.all(trio(fixture.output).map(path => readFile(path)))).toEqual(before);
        const other = join(fixture.dir, "other-output.json"); await writeFile(localSourceSiblings(other).record, "{}\n");
        await expect(prepareAssistantProfile({ ...fixture, output: other })).rejects.toThrow("A different prepared source already exists beside this output. It was not overwritten; choose a separate reviewed output.");
        await expect(lstat(other)).rejects.toThrow(); expect(await pending(other)).toEqual([]);
        expect((await assistantCommand(["init", "--root", fixture.root, "--plan", fixture.output, "--cooperative-local"])).value).toMatchObject({ created: true });
    });
    test("init and setup name both doors when the pair is not beside the profile, and no controller is created", async () => {
        const fixture = await localFixture(); await prepareAssistantProfile(fixture);
        const moved = join(fixture.dir, "moved-profile.json"); await writeFile(moved, await readFile(fixture.output));
        const missing = "This profile names a local-only source; its prepared bundle was not found beside the profile. Repeat prepare --local, or select a hosted source with --source-url.";
        await expect(assistantCommand(["init", "--root", fixture.root, "--plan", moved, "--cooperative-local"])).rejects.toThrow(missing);
        await expect(lstat(fixture.root)).rejects.toThrow();
        const setup = await inspectAssistantSetup({ root: fixture.root, planPath: moved, command, cooperativeLocal: true }, dependencies());
        expect(setup.checks.find(check => check.id === "local-source")).toEqual({ id: "local-source", status: "needs-attention", detail: missing });
    });
});
