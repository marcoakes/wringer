import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDeclaration, compileExecutionPlan, createExecutionAuthority, hashValue, validateExecutionAuthority, type EnvironmentMap } from "@wringer/plan";
import { runContainedJourney, type CandidateVerification, type ContainedJourneyOptions } from "@wringer/workflow";
import type { RoleExecutionResult } from "@wringer/runtime";
import type { Args } from "../src/args";
import { newGrantCommand } from "../src/new-grant";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
async function fixture(stop: "budget" | "born-green" | "intent" | "ready" | "human" = "budget", expiresInMs = 3600000) {
    const root = await mkdtemp(join(tmpdir(), "wringer-new-grant-")); roots.push(root);
    const state = join(root, "old-state"); await mkdir(state);
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = compileExecutionPlan(template, { format: "yaml" });
    const declaration = structuredClone(raw);
    declaration.runtime.env = []; declaration.agents.worker.env = []; declaration.agents.judge.env = [];
    if (stop === "intent") { declaration.agents.planner = declaration.agents.judge; declaration.budget.max_planner_turns = 1; }
    if (stop === "human") {
        declaration.intent += " The display is readable.";
        declaration.acceptance.criteria.push({ id: "readable", title: "Readable display", quote: "The display is readable.", kind: "human", required: true, show: { id: "display", argv: ["bun", "run", "demo"], cwd: ".", timeout_seconds: 30 } });
    }
    const plan = compileDeclaration({ version: 1, ...declaration });
    const authority = createExecutionAuthority(plan, { actor: "Original fixture PM", expiresAt: new Date(Date.now() + expiresInMs).toISOString(), actions: ["plan", "build", "verify", "judge", "deliver"], budget: { ...plan.budget, max_sessions: 3, max_worker_turns: 1, max_judge_turns: 1 } });
    await writeFile(join(state, "plan.json"), JSON.stringify(plan));
    await writeFile(join(state, "authority.json"), JSON.stringify(authority));
    const files = ["README.md", ...plan.acceptance.checks.flatMap(c => c.files)].map(path => ({ path, mode: "100644", blob: "f".repeat(40) }));
    const body: Omit<EnvironmentMap, "map_sha256"> = { schema_version: "wringer.environment-map.v1", repository: plan.repository, plan_sha256: plan.plan_sha256, source_tree: "a".repeat(40), inventory_sha256: hashValue(files), files, context: [{ path: "README.md", blob: "f".repeat(40), text: "Fixture", sha256: hashValue("Fixture") }], components: [], tools: plan.environment.tools.map(t => ({ ...t, observation: null })), baseline: plan.environment.baseline.map(declaration => ({ declaration, observation: null })), protected_paths: plan.acceptance.protected_paths, writable_paths: plan.scope.writable, limits: ["Synthetic new-grant fixture; no provider/runtime/source commands"] };
    // Environment content digests hash the text bytes, not canonical JSON strings.
    body.context[0]!.sha256 = new Bun.CryptoHasher("sha256").update("Fixture").digest("hex");
    const environment: EnvironmentMap = { ...body, map_sha256: hashValue(body) };
    let roleCalls = 0, sourceCalls = 0;
    const options: ContainedJourneyOptions = {
        controllerDir: state, plan, authority, environment,
        services: {
            prepareSource: async source => { sourceCalls++; return source; },
            captureCandidate: async () => ({ source: { ...plan.repository, commit: "b".repeat(40) }, tree: "c".repeat(40), changedPaths: ["src/value.ts"] }),
            verifyCandidate: async request => {
                const passed = stop === "born-green" || ["ready", "human"].includes(stop) && request.phase === "candidate";
                return { schema_version: "wringer.contained-verification.v1", status: passed ? "passed" : "failed", candidateCommit: request.source.commit, candidateTree: request.phase === "baseline" ? "a".repeat(40) : "c".repeat(40), acceptanceSha256: plan.acceptance_sha256, runtimeId: randomUUID(), image: plan.runtime.image, checks: plan.acceptance.checks.map(c => ({ id: c.id, status: passed ? "passed" : "failed", exitCode: passed ? 0 : 1, checkInputsSha256: "d".repeat(64), outputSha256: "e".repeat(64) })), regressions: plan.environment.baseline.map(c => ({ id: c.id, status: "passed", exitCode: 0, outputSha256: "e".repeat(64) })), evidenceRef: `synthetic-fixture/${request.effectId}` } as CandidateVerification;
            },
        },
        executeRole: async request => {
            roleCalls++;
            const text = request.role === "planner" ? JSON.stringify({ questions: ["Which total should this requirement use?"], omissions: [], note: "Explicit PM decision required" }) : request.role === "judge" ? JSON.stringify({ criteria: plan.acceptance.criteria.filter(c => c.kind === "check").map(c => ({ id: c.id, met: true, reason: "Synthetic review" })), note: "Synthetic review only" }) : "Synthetic changed worker output";
            return { status: "completed", text, sessionId: randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "new-grant-fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: { schema_version: "wringer.runtime.v1", runtimeId: randomUUID(), role: request.role, kind: request.runtime.kind, image: request.runtime.image, repository: request.repo, clonedInside: true, hostMounts: [], repositoryAccess: request.role === "worker" ? "read-write" : "read-only", declared: request.runtime, observed: { fixture: true }, limits: ["No live provider/runtime"] } } satisfies RoleExecutionResult;
        },
    };
    const result = await runContainedJourney(options);
    return { root, state, plan, authority, result, options, calls: () => ({ roleCalls, sourceCalls }) };
}
const args = (state: string, extra: Record<string, string | boolean> = {}): Args => ({ command: "new-grant", words: [], flags: new Map(Object.entries({ state, ...extra })) });
const confirm = (state: string, output: string, extra: Record<string, string | boolean> = {}) => args(state, { "confirm-new-grant": true, actor: "New fixture PM", expires: new Date(Date.now() + 3600000).toISOString(), output, ...extra });
async function snapshot(directory: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) for (const [path, hash] of Object.entries(await snapshot(join(directory, entry.name)))) result[`${entry.name}/${path}`] = hash;
        else result[entry.name] = new Bun.CryptoHasher("sha256").update(await readFile(join(directory, entry.name))).digest("hex");
    }
    return result;
}

test("new-grant --state previews exhausted validated history without changing any byte or launching work", async () => {
    const f = await fixture(); expect(f.result.stop?.reason).toBe("agent-budget-exhausted");
    const before = await snapshot(f.root), calls = f.calls();
    const answer = await newGrantCommand(args(f.state), f.root), value = answer.value as any;
    expect(answer.exit).toBe(0); expect(value.status).toBe("preview");
    expect(value.old.limits).toEqual(f.authority.budget);
    expect(value.old.usage.sessions.reserved).toBe(1);
    expect(value.old.cost).toEqual({ status: "unknown", amount: null, currency: null });
    expect(value.old.usage.tokens).toEqual({ input: null, output: null });
    expect(value.policy).toMatchObject({ allowed: true, previousSpendReset: false, candidateReused: false, publicationGranted: false });
    expect(answer.text).toContain("NEW WHOLE JOURNEY");
    expect(answer.text).toContain("Cost: unknown, not zero");
    expect(answer.text).toContain("--confirm-new-grant");
    expect(await snapshot(f.root)).toEqual(before); expect(f.calls()).toEqual(calls);
});

test("confirmation creates only a fresh original plan and bounded authority, never old candidate or history", async () => {
    const f = await fixture(), output = join(f.root, "fresh state");
    const before = await snapshot(f.state), calls = f.calls();
    const answer = await newGrantCommand(confirm(f.state, output), f.root), value = answer.value as any;
    expect(value.status).toBe("created"); expect(answer.exit).toBe(0);
    expect((await readdir(output)).sort()).toEqual(["authority.json", "plan.json"]);
    const plan = JSON.parse(await readFile(join(output, "plan.json"), "utf8"));
    const authority = JSON.parse(await readFile(join(output, "authority.json"), "utf8"));
    expect(plan).toEqual(f.plan); expect(plan.repository.commit).not.toBe(f.result.candidate?.source.commit);
    expect(authority.actor).toBe("New fixture PM");
    expect(authority.budget).toEqual(f.authority.budget); expect(authority.budget.max_sessions).toBeLessThan(f.plan.budget.max_sessions);
    expect(authority.actions).toEqual(f.authority.actions.filter(action => action !== "deliver"));
    expect(validateExecutionAuthority(authority, plan)).toEqual(authority);
    expect((await lstat(output)).mode & 0o777).toBe(0o700);
    expect((await lstat(join(output, "authority.json"))).mode & 0o777).toBe(0o600);
    expect(answer.text).toContain("wringer-drive doctor --plan"); expect(answer.text).toContain("wringer-drive run"); expect(answer.text).toContain("wringer-drive board --state");
    expect(await snapshot(f.state)).toEqual(before); expect(f.calls()).toEqual(calls);
});

test("expired authority remains readable for preview and does not invalidate historical observations", async () => {
    const f = await fixture("budget", 1800);
    await Bun.sleep(Math.max(0, Date.parse(f.authority.expires_at) - Date.now() + 10));
    const before = await snapshot(f.state);
    const answer = await newGrantCommand(args(f.state), f.root), value = answer.value as any;
    expect(value.status).toBe("preview"); expect(value.old.authorityExpired).toBe(true);
    expect(answer.text).toContain("out of date");
    expect(await snapshot(f.state)).toEqual(before);
});

test("live human/ready states preview without allocation; expired ones can explicitly start from original baseline", async () => {
    for (const status of ["human", "ready"] as const) {
        const f = await fixture(status, 1200), output = join(f.root, "fresh-after-expiry");
        expect(f.result.status).toBe(status === "human" ? "human-hold" : "review-ready");
        const live = await newGrantCommand(args(f.state), f.root);
        expect((live.value as any).policy.allowed).toBe(false);
        await expect(newGrantCommand(confirm(f.state, output), f.root)).rejects.toThrow("neither stopped nor exhausted");
        await Bun.sleep(Math.max(0, Date.parse(f.authority.expires_at) - Date.now() + 10));
        const expired = await newGrantCommand(args(f.state), f.root);
        expect((expired.value as any).policy.allowed).toBe(true);
        expect((expired.value as any).policy.candidateReused).toBe(false);
        const created = await newGrantCommand(confirm(f.state, output), f.root);
        expect((created.value as any).status).toBe("created");
        expect(JSON.parse(await readFile(join(output, "plan.json"), "utf8")).repository.commit).toBe(f.plan.repository.commit);
    }
});

test("born-green and unanswered intent require a revised contract, not an unchanged new approval", async () => {
    for (const stop of ["born-green", "intent"] as const) {
        const f = await fixture(stop), output = join(f.root, "must-not-exist"), before = await snapshot(f.root);
        expect(f.result.stop?.reason).toBe(stop === "born-green" ? "acceptance-born-green" : "intent-needs-decision");
        const preview = await newGrantCommand(args(f.state), f.root), value = preview.value as any;
        expect(preview.exit).toBe(0); expect(value.policy.allowed).toBe(false); expect(value.policy.contractRevisionRequired).toBe(true);
        expect(preview.text).toContain("wringer-drive plan 'REVISED-CONFIG.yaml'");
        expect(preview.text).toContain("Approve its NEW digest");
        await expect(newGrantCommand(confirm(f.state, output), f.root)).rejects.toThrow("unchanged contract cannot receive a new grant");
        expect(await snapshot(f.root)).toEqual(before);
    }
});

test("a retry-not-applicable stop cannot mask immutable contract defects when requesting a new grant", async () => {
    for (const stop of ["born-green", "intent"] as const) {
        const f = await fixture(stop), output = join(f.root, "must-not-approve-masked-defect"), calls = f.calls();
        const defect = stop === "born-green" ? "acceptance-born-green" : "intent-needs-decision";
        expect(f.result.stop?.reason).toBe(defect);
        const masked = await runContainedJourney({ ...f.options, retryUncertain: true });
        expect(masked.stop?.reason).toBe("retry-not-applicable"); expect(f.calls()).toEqual(calls);
        const before = await snapshot(f.root), preview = await newGrantCommand(args(f.state), f.root), value = preview.value as any;
        expect(preview.exit).toBe(0); expect(value.old.stop.reason).toBe("retry-not-applicable");
        expect(value.policy.allowed).toBe(false); expect(value.policy.contractRevisionRequired).toBe(true);
        expect(value.policy.contractBlockers.some((blocker: any) => blocker.code === defect)).toBe(true);
        await expect(newGrantCommand(confirm(f.state, output), f.root)).rejects.toThrow("unchanged contract cannot receive a new grant");
        expect(await snapshot(f.root)).toEqual(before);
    }
});

test("existing files and directories are never overwritten, even if empty or matching", async () => {
    const f = await fixture(), occupied = join(f.root, "occupied"), empty = join(f.root, "empty");
    await writeFile(occupied, "Keep this user file."); await mkdir(empty);
    for (const output of [occupied, empty]) await expect(newGrantCommand(confirm(f.state, output), f.root)).rejects.toThrow("already exists");
    expect(await readFile(occupied, "utf8")).toBe("Keep this user file."); expect(await readdir(empty)).toEqual([]);
});

test("confirmation rejects old-state nesting, aliases, and symlink targets before writes", async () => {
    const f = await fixture(), alias = join(f.root, "alias"), external = join(f.root, "outside"); await mkdir(external);
    await symlink(f.state, alias);
    await expect(newGrantCommand(confirm(f.state, f.state), f.root)).rejects.toThrow("separate");
    await expect(newGrantCommand(confirm(f.state, join(f.state, "new")), f.root)).rejects.toThrow("separate");
    await expect(newGrantCommand(confirm(f.state, join(alias, "new")), f.root)).rejects.toThrow("symlink");
    const target = join(f.root, "symlink-output"); await symlink(external, target);
    await expect(newGrantCommand(confirm(f.state, target), f.root)).rejects.toThrow("already exists");
    expect(await readdir(external)).toEqual([]);
});

test("tampered outer authority, unknown flags, and incomplete confirmation refuse before creating a state", async () => {
    const f = await fixture(), output = join(f.root, "forbidden");
    await expect(newGrantCommand(args(f.state, { "more-money": true }), f.root)).rejects.toThrow("Unknown option");
    await expect(newGrantCommand(args(f.state, { output }), f.root)).rejects.toThrow("Preview takes only");
    await expect(newGrantCommand(args(f.state, { "confirm-new-grant": true, output }), f.root)).rejects.toThrow("--actor is required");
    await expect(newGrantCommand(confirm(f.state, output, { expires: "2000-01-01T00:00:00Z" }), f.root)).rejects.toThrow("valid");
    await writeFile(join(f.state, "authority.json"), JSON.stringify({ ...f.authority, actor: "Tampered" }));
    await expect(newGrantCommand(confirm(f.state, output), f.root)).rejects.toThrow("differs");
    expect(await Bun.file(join(output, "authority.json")).exists()).toBe(false);
});

test("an active controller has a read-only explanatory preview but cannot allocate a fresh grant", async () => {
    const f = await fixture();
    await writeFile(join(f.state, ".wringer/workflow/contained-journey.lock"), JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    const before = await snapshot(f.root), preview = await newGrantCommand(args(f.state), f.root);
    expect(preview.exit).toBe(0); expect((preview.value as any).policy.allowed).toBe(false);
    expect(preview.text).toContain("active or its ownership is uncertain");
    await expect(newGrantCommand(confirm(f.state, join(f.root, "not-created")), f.root)).rejects.toThrow("active or its ownership is uncertain");
    expect(await snapshot(f.root)).toEqual(before);
});
