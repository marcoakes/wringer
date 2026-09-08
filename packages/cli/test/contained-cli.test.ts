import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileDeclaration, compileExecutionPlan, createExecutionAuthority, discoverEnvironment, hashValue, type ExecutionPlan } from "@wringer/plan";
import { runContainedJourney, readValidatedContainedState, queryContainedJourney, type ContainedJourneyResult, type CandidateVerification } from "@wringer/workflow";
import type { PreparedRepositorySource, RoleExecutionRequest, RoleExecutionResult, ContainedCommandResult } from "@wringer/runtime";
import { dispatch } from "../src/app";
import { containedServices } from "../src/contained-services";
// Real command dispatch and real scratch Git objects. Agent/display results below
// are explicitly synthetic fixtures: these tests never start a live container.
const roots: string[] = [];
afterEach(async () => {
    for (const root of roots.splice(0))
        await rm(root, { recursive: true, force: true });
});
const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
const entry = fileURLToPath(new URL("../src/drive-cli.ts", import.meta.url));
function git(cwd: string, args: string[]): string {
    const result = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", ...args], {
        cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" }, stdout: "pipe", stderr: "pipe",
    });
    if (result.exitCode)
        throw new Error(`Scratch Git fixture failed: ${result.stderr.toString()}`);
    return result.stdout.toString().trim();
}
async function fixture(human = false) {
    const root = await mkdtemp(join(tmpdir(), "wringer-contained-cli-"));
    roots.push(root);
    const source = join(root, "fixture-source"), state = join(root, "controller"), objectStore = join(root, "source.git");
    await mkdir(join(source, "tests"), { recursive: true });
    await mkdir(join(source, "src"));
    for (const [path, content] of Object.entries({ "README.md": "Synthetic CLI integration fixture; no live runtime or provider.\n", "package.json": '{"name":"contained-cli-fixture"}\n', "bun.lock": "fixture pinned input\n", "tests/acceptance.test.ts": "// acceptance input fixture\n", "src/value.ts": "export const value = 0;\n" }))
        await writeFile(join(source, path), content);
    git(source, ["init", "-b", "main"]);
    git(source, ["config", "user.name", "CLI fixture"]);
    git(source, ["config", "user.email", "fixture@example.invalid"]);
    git(source, ["add", "."]);
    git(source, ["commit", "-m", "Fixture source"]);
    const commit = git(source, ["rev-parse", "HEAD"]), tree = git(source, ["rev-parse", "HEAD^{tree}"]);
    git(root, ["clone", "--bare", source, objectStore]);
    const bundlePath = join(root, "source.bundle");
    git(root, ["--git-dir", objectStore, "bundle", "create", bundlePath, "main"]);
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = compileExecutionPlan(template, { format: "yaml" });
    const declaration = structuredClone(raw);
    declaration.repository = { url: "https://example.invalid/fixture/repository.git", commit };
    declaration.runtime.env = [];
    declaration.agents.worker.env = [];
    declaration.agents.judge.env = [];
    if (human) {
        declaration.intent += " The display is readable.";
        declaration.acceptance.criteria.push({ id: "readable", title: "Readable display", quote: "The display is readable.", kind: "human", required: true, show: { id: "show-readable", argv: ["bun", "run", "demo"], cwd: ".", timeout_seconds: 30 } });
    }
    const plan = compileDeclaration({ version: 1, ...declaration }), planPath = join(root, "plan.yaml");
    await writeFile(planPath, JSON.stringify({ version: 1, ...declaration }, null, 2));
    const prepared: PreparedRepositorySource = { ...plan.repository, objectStore, bundlePath };
    const environment = await discoverEnvironment(objectStore, plan);
    const authority = createExecutionAuthority(plan, { actor: "CLI fixture operator", expiresAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(), actions: ["plan", "build", "verify", "judge"] });
    const authorityPath = join(root, "authority.json");
    await writeFile(authorityPath, JSON.stringify(authority));
    const seed = async () => {
        await mkdir(state, { mode: 0o700 });
        for (const [name, value] of Object.entries({ "plan.json": plan, "authority.json": authority, "prepared-source.json": prepared, "environment.json": environment }))
            await writeFile(join(state, name), JSON.stringify(value, null, 2) + "\n");
    };
    return { root, state, source, plan, planPath, authority, authorityPath, prepared, environment, tree, seed };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const call = (f: Fixture, ...args: string[]) => dispatch([...args, "--repo", f.root, "--json"], "wringer-drive");
async function noRuntime(f: Fixture, ...args: string[]) {
    // Child-local PATH guarantees no installed runtime can be launched even if
    // the developer's host has Apple container or kubectl available.
    const child = Bun.spawn([process.execPath, entry, ...args, "--repo", f.root, "--json"], { cwd: f.root, env: { ...process.env, PATH: "/wringer-fixture-no-executables" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { value: JSON.parse(stdout), stderr, code };
}
async function seededHold(f: Fixture, invalidJudge = false): Promise<ContainedJourneyResult> {
    await f.seed();
    const candidate = { source: { ...f.prepared, commit: "b".repeat(40) }, tree: "c".repeat(40), changedPaths: ["src/value.ts"] };
    return runContainedJourney({
        controllerDir: f.state, plan: f.plan, authority: f.authority, environment: f.environment,
        services: {
            prepareSource: async () => f.prepared,
            captureCandidate: async () => candidate,
            verifyCandidate: async (request) => ({ schema_version: "wringer.contained-verification.v1", status: request.phase === "baseline" ? "failed" : "passed", candidateCommit: request.source.commit, candidateTree: request.phase === "baseline" ? f.tree : candidate.tree, acceptanceSha256: f.plan.acceptance_sha256, runtimeId: randomUUID(), image: f.plan.runtime.image, checks: f.plan.acceptance.checks.map(c => ({ id: c.id, status: request.phase === "baseline" ? "failed" : "passed", exitCode: request.phase === "baseline" ? 1 : 0, checkInputsSha256: "d".repeat(64), outputSha256: "e".repeat(64) })), regressions: f.plan.environment.baseline.map(c => ({ id: c.id, status: "passed", exitCode: 0, outputSha256: "e".repeat(64) })), evidenceRef: `synthetic-fixture/${request.effectId}` }) as CandidateVerification,
        },
        executeRole: async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => ({ status: "completed", text: request.role === "worker" ? "Synthetic worker response" : invalidJudge ? "Invalid fixture reply" : JSON.stringify({ criteria: f.plan.acceptance.criteria.filter(c => c.kind === "check").map(c => ({ id: c.id, met: true, reason: "Synthetic independent review" })), note: "No live agent was exercised" }), sessionId: randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "contained-cli-fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, usage: { inputTokens: 10, outputTokens: 5 }, events: [], stderr: "", provenance: { schema_version: "wringer.runtime.v1", runtimeId: randomUUID(), role: request.role, kind: request.runtime.kind, image: request.runtime.image, repository: request.repo, clonedInside: true, hostMounts: [], repositoryAccess: request.role === "worker" ? "read-write" : "read-only", declared: request.runtime, observed: { fixture: true }, limits: ["Synthetic result; no live containment or provider"] } }),
    });
}
async function displayReceipt(f: Fixture, hold: ContainedJourneyResult, overrides: Record<string, unknown> = {}) {
    const id = randomUUID();
    const body = { schema_version: "wringer.contained-display.v1", id, criterionId: "readable", candidateTree: hold.candidate!.tree, acceptanceSha256: f.plan.acceptance_sha256, at: new Date().toISOString(), success: true, measured: { sourceTree: hold.candidate!.tree, sourceChanged: false, results: [...f.plan.environment.setup.map(c => ({ id: `setup/${c.id}`, code: 0, stdout: "Synthetic setup", stderr: "", durationMs: 1 })), { id: "show-readable", code: 0, stdout: "Synthetic readable display", stderr: "", durationMs: 1 }], provenance: { schema_version: "wringer.runtime.v1", runtimeId: randomUUID(), role: "verifier", kind: f.plan.runtime.kind, image: f.plan.runtime.image, repository: { url: f.plan.repository.url, commit: hold.candidate!.source.commit }, clonedInside: true, hostMounts: [], repositoryAccess: "read-write", declared: f.plan.runtime, observed: { fixture: true, writableDirectories: f.plan.environment.writable_directories }, limits: ["Synthetic display; no live runtime"] } }, ...overrides };
    const value = { ...body, sha256: hashValue(body) };
    await mkdir(join(f.state, "displays"), { recursive: true });
    await writeFile(join(f.state, "displays", `${id}.json`), JSON.stringify(value));
    return value;
}
describe("contained public CLI integration (no live runtime)", () => {
    test("blind regression: CLI show and board refuse a judge-stopped fixture before any display", async () => {
        const f = await fixture(true), stopped = await seededHold(f, true);
        expect(stopped.stop?.reason).toBe("judge-invalid-reply");
        const query = await queryContainedJourney(f.state);
        expect(query.actions.find(a => a.id === "show")?.enabled).toBe(false);
        await expect(call(f, "show", "--state", f.state, "--criterion", "readable")).rejects.toThrow("at its human hold");
        expect(await Bun.file(join(f.state, "displays")).exists()).toBe(false);
        expect((await readValidatedContainedState(f.state)).result.sessions).toBe(stopped.sessions);
    });
    test("blind regression: public new-grant route previews then creates only a separate bounded grant", async () => {
        const f = await fixture(), stopped = await seededHold(f, true);
        const prior = await readFile(join(f.state, ".wringer/contained/result.json"), "utf8");
        const preview = await call(f, "new-grant", "--state", f.state);
        expect((preview.value as any).status).toBe("preview");
        expect(preview.exit ?? 0).toBe(0);
        const fresh = join(f.root, "fresh-grant");
        const created = await call(f, "new-grant", "--state", f.state, "--confirm-new-grant", "--actor", "Fixture PM", "--expires", new Date(Date.now() + 3600000).toISOString(), "--output", fresh);
        expect((created.value as any).authority.budget).toEqual(f.authority.budget);
        expect((await readdir(fresh)).sort()).toEqual(["authority.json", "plan.json"]);
        expect(await readFile(join(f.state, ".wringer/contained/result.json"), "utf8")).toBe(prior);
        expect((await readValidatedContainedState(f.state)).result.sessions).toBe(stopped.sessions);
    });
    test("plan compiles against a bare source map without agents, auth or host repository execution", async () => {
        const f = await fixture(), answer = await call(f, "plan", "plan.yaml");
        expect((answer.value as ExecutionPlan).plan_sha256).toBe(f.plan.plan_sha256);
        expect(answer.text).toContain("no agent or repository command ran");
        expect(f.environment.repository.commit).toBe(f.plan.repository.commit);
        expect(f.environment.tools.every(t => t.observation === null)).toBe(true);
        expect(await Bun.file(join(f.state, "plan.json")).exists()).toBe(false);
    });
    test("authority records one frozen bounded grant and refuses overwrite, stale expiry and unknown flags", async () => {
        const f = await fixture(), expires = new Date(Date.now() + 3600 * 1000).toISOString();
        const answer = await call(f, "authority", "plan.yaml", "--actor", "Fixture PM", "--expires", expires, "--output", "new-authority.json");
        const value = (answer.value as any).authority;
        expect(value.actor).toBe("Fixture PM");
        expect(value.plan_sha256).toBe(f.plan.plan_sha256);
        expect(value.budget).toEqual(f.plan.budget);
        expect(value.actions).not.toContain("deliver");
        expect(answer.text).toContain("No human verdict");
        await expect(call(f, "authority", "plan.yaml", "--actor", "Different PM", "--expires", expires, "--output", "new-authority.json")).rejects.toThrow();
        expect(JSON.parse(await readFile(join(f.root, "new-authority.json"), "utf8")).actor).toBe("Fixture PM");
        await expect(call(f, "authority", "plan.yaml", "--actor", "Fixture PM", "--expires", "2000-01-01T00:00:00Z", "--output", "expired.json")).rejects.toThrow("valid");
        await expect(call(f, "plan", "plan.yaml", "--trust-everything")).rejects.toThrow();
    });
    test("missing or mismatched authority refuses before source preparation or any session reservation", async () => {
        const f = await fixture();
        await expect(call(f, "run", "plan.yaml", "--authority", "missing.json", "--state", f.state)).rejects.toThrow();
        expect(await Bun.file(join(f.state, "plan.json")).exists()).toBe(false);
        await writeFile(f.authorityPath, JSON.stringify({ ...f.authority, plan_sha256: "f".repeat(64) }));
        await expect(call(f, "run", "plan.yaml", "--authority", f.authorityPath, "--state", f.state)).rejects.toThrow();
        expect(await Bun.file(join(f.state, "plan.json")).exists()).toBe(false);
    });
    test("missing runtime persists a recoverable stop before model spend; resume does not reset evidence", async () => {
        const f = await fixture();
        await f.seed();
        const first = await noRuntime(f, "run", "plan.yaml", "--authority", f.authorityPath, "--state", f.state);
        expect(first.code).toBe(3);
        expect(first.value.status).toBe("stopped");
        expect(first.value.sessions).toBe(0);
        expect(first.value.stop.next_move).toContain("wringer-drive resume --state");
        expect(first.value.stop.cwd).toBe(f.state);
        const second = await noRuntime(f, "resume", "--state", f.state);
        expect(second.code).toBe(3);
        expect(second.value.journeyId).toBe(first.value.journeyId);
        expect(second.value.sessions).toBe(0);
        expect((await readdir(join(f.state, ".wringer/contained/events"))).length).toBeGreaterThan(2);
        const checked = await readValidatedContainedState(f.state);
        expect(checked.result.status).toBe("stopped");
        expect(checked.state.effects).toHaveLength(0);
    });
    test("saved display ids are validated before filesystem lookup, even on resume", async () => {
        const f = await fixture(true);
        await seededHold(f);
        await writeFile(join(f.state, "human-judgements.json"), JSON.stringify([{ criterionId: "readable", displayId: "../../outside" }]));
        await expect(call(f, "resume", "--state", f.state)).rejects.toThrow("invalid display receipt id");
        await expect(call(f, "review", "--state", f.state, "--criterion", "readable", "--display", "../../outside", "--verdict", "met", "--by", "Person", "--note", "My own note")).rejects.toThrow("Invalid display receipt id");
    });
    test("human review refuses failed/stale displays, retains a person's note, and resumes without paid replay", async () => {
        const f = await fixture(true), hold = await seededHold(f);
        expect(hold.status).toBe("human-hold");
        const failed = await displayReceipt(f, hold, { success: false });
        const stale = await displayReceipt(f, hold, { candidateTree: "9".repeat(40) });
        for (const receipt of [failed, stale])
            await expect(call(f, "review", "--state", f.state, "--criterion", "readable", "--display", receipt.id, "--verdict", "met", "--by", "Fixture person", "--note", "Own observation")).rejects.toThrow("no judgement recorded");
        const valid = await displayReceipt(f, hold), note = "I inspected this display; the labels are clear — in my own words.";
        const reviewed = await call(f, "review", "--state", f.state, "--criterion", "readable", "--display", valid.id, "--verdict", "met", "--by", "Fixture person", "--note", note);
        expect((reviewed.value as any).note).toBe(note);
        const resumed = await noRuntime(f, "resume", "--state", f.state);
        expect(resumed.code).toBe(0);
        expect(resumed.value.status).toBe("review-ready");
        expect(resumed.value.sessions).toBe(hold.sessions);
        expect(resumed.value.humanJudgements[0].note).toBe(note);
        expect((await readValidatedContainedState(f.state)).result.tokens).toEqual({ input: 20, output: 10 });
    });
    test("a mutable ready summary cannot redirect the display or claim successful status", async () => {
        const f = await fixture(true), hold = await seededHold(f);
        await writeFile(join(f.state, ".wringer/contained/result.json"), JSON.stringify({ ...hold, status: "review-ready", candidate: { ...hold.candidate, source: { ...hold.candidate!.source, commit: "8".repeat(40) } } }));
        await expect(call(f, "status", "--state", f.state)).rejects.toThrow("view disagrees");
        await expect(call(f, "show", "--state", f.state, "--criterion", "readable")).rejects.toThrow("view disagrees");
    });
    test("outer authority cannot be substituted and only declared human criteria can be reviewed", async () => {
        const f = await fixture(true);
        await seededHold(f);
        await expect(call(f, "review", "--state", f.state, "--criterion", "total", "--display", randomUUID(), "--verdict", "met", "--by", "Fixture", "--note", "Not a human criterion")).rejects.toThrow("declared human");
        await writeFile(join(f.state, "authority.json"), JSON.stringify({ ...f.authority, actor: "Substituted operator" }));
        await expect(call(f, "status", "--state", f.state)).rejects.toThrow("outer plan or authority");
        await expect(call(f, "show", "--state", f.state, "--criterion", "readable")).rejects.toThrow("outer plan or authority");
    });
    test("verification recovers derived files from an identity-bound observation without running another runtime", async () => {
        const f = await fixture();
        await f.seed();
        let calls = 0;
        const services = containedServices(f.state, f.prepared, { runCommands: async (request) => {
                calls++;
                return { provenance: { schema_version: "wringer.runtime.v1", runtimeId: randomUUID(), role: "verifier", kind: f.plan.runtime.kind, image: f.plan.runtime.image, repository: f.plan.repository, clonedInside: true, hostMounts: [], repositoryAccess: "read-write", declared: f.plan.runtime, observed: { fixture: true, writableDirectories: request.writableDirectories }, limits: ["Synthetic verifier"] }, sourceTree: f.tree, sourceChanged: false, checkInputsSha256: "d".repeat(64), results: request.commands.map(c => ({ id: c.id, code: c.id.startsWith("acceptance/") ? 1 : 0, stdout: "Synthetic check result", stderr: "", durationMs: 1 })) } as ContainedCommandResult;
            } });
        const request = { plan: f.plan, source: f.prepared, phase: "baseline" as const, effectId: "fixture-crash-reconciliation" };
        const first = await services.verifyCandidate(request), directory = join(f.state, "verification", request.effectId);
        await rm(join(directory, "result.json")); // crash after observations, before summary
        expect(await services.verifyCandidate(request)).toEqual(first);
        expect(calls).toBe(1);
        await rm(join(directory, "result.json"));
        await rm(join(directory, "observations.json")); // crash immediately after envelope
        expect(await services.verifyCandidate(request)).toEqual(first);
        expect(calls).toBe(1);
        const path = join(directory, "observation-record.json"), envelope = JSON.parse(await readFile(path, "utf8"));
        envelope.requestIdentity = "0".repeat(64);
        await writeFile(path, JSON.stringify(envelope));
        await expect(services.verifyCandidate(request)).rejects.toThrow("identity or digest changed");
        expect(calls).toBe(1);
    });
    test("unbound old observations refuse precisely without executing or replacing them", async () => {
        const f = await fixture();
        await f.seed();
        let calls = 0;
        const services = containedServices(f.state, f.prepared, { runCommands: async () => { calls++; throw new Error("Must not execute"); } });
        const directory = join(f.state, "verification", "unbound"), path = join(directory, "observations.json");
        await mkdir(directory, { recursive: true });
        await writeFile(path, '{"sourceTree":"unknown origin"}');
        await expect(services.verifyCandidate({ plan: f.plan, source: f.prepared, phase: "baseline", effectId: "unbound" })).rejects.toThrow("no verifier was replayed");
        expect(calls).toBe(0);
        expect(await readFile(path, "utf8")).toBe('{"sourceTree":"unknown origin"}');
    });
    test("audit routes offline failure honestly and delivery needs a complete journal before publication", async () => {
        const f = await fixture(true), hold = await seededHold(f);
        const audit = await call(f, "audit", "--bundle", "missing-bundle");
        expect(audit.exit).toBe(3);
        expect((audit.value as any).status).toBe("failed");
        await expect(call(f, "deliver", "--state", f.state, "--remote", "https://example.invalid/fixture/repository.git", "--source-branch", "review/fixture", "--target-branch", "main")).rejects.toThrow("review-ready");
        try {
            await call(f, "deliver", "--state", f.state, "--remote", "https://example.invalid/fixture/repository.git", "--source-branch", "review/fixture", "--target-branch", "main");
            throw new Error("Delivery unexpectedly returned");
        } catch (error: any) {
            expect(error.next_move).toBe(`wringer-drive status --state '${f.state}'`);
            expect(error.message).toContain("Retained evidence has not been discarded");
            expect(error.next_move).not.toContain("--send");
        }
        expect((await readValidatedContainedState(f.state)).result.sessions).toBe(hold.sessions);
    });
    test("cancellation refuses before creating controller state", async () => {
        const f = await fixture(), controller = new AbortController();
        controller.abort(new Error("Fixture interrupted"));
        await expect(dispatch(["run", f.planPath, "--authority", f.authorityPath, "--state", f.state, "--repo", f.root], "wringer-drive", { signal: controller.signal })).rejects.toThrow("Fixture interrupted");
        expect(await Bun.file(join(f.state, "plan.json")).exists()).toBe(false);
    });
});
