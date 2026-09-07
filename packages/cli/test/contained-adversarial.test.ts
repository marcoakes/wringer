import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDeclaration, compileExecutionPlan, createExecutionAuthority, hashBytes, hashValue, type EnvironmentMap } from "@wringer/plan";
import { runContainedJourney, readValidatedContainedState, type ContainedJourneyOptions, type ContainedJourneyResult } from "@wringer/workflow";
import type { ContainedCommandResult, PreparedRepositorySource, RoleExecutionResult } from "@wringer/runtime";
import { dispatch } from "../src/app";
import { containedServices, showContainedCandidate } from "../src/contained-services";
// Synthetic role/runtime replies only. The real journal, cached-verifier service,
// public review command and resume dispatch are exercised without live spend.
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true }); });
const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
async function fixture(human = false) {
    const state = await mkdtemp(join(tmpdir(), "wringer-adversarial-"));
    roots.push(state);
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = compileExecutionPlan(template, { format: "yaml" });
    const declaration = structuredClone(raw);
    declaration.repository = { url: "https://example.invalid/synthetic/repository.git", commit: "a".repeat(40) };
    declaration.runtime.env = [];
    declaration.agents.worker.env = [];
    declaration.agents.judge.env = [];
    if (human) {
        declaration.intent += " The display is readable.";
        declaration.acceptance.criteria.push({ id: "readable", title: "Readable display", quote: "The display is readable.", kind: "human", required: true, show: { id: "show-readable", argv: ["bun", "run", "demo"], cwd: ".", timeout_seconds: 30 } });
    }
    const plan = compileDeclaration({ version: 1, ...declaration });
    const files = ["README.md", ...plan.acceptance.checks.flatMap(c => c.files)].map(path => ({ path, mode: "100644", blob: "f".repeat(40) }));
    const context = "Synthetic adversarial fixture; no live agent or runtime.";
    const data: Omit<EnvironmentMap, "map_sha256"> = { schema_version: "wringer.environment-map.v1", repository: plan.repository, plan_sha256: plan.plan_sha256, source_tree: "a".repeat(40), inventory_sha256: hashValue(files), files, context: [{ path: "README.md", blob: "f".repeat(40), text: context, sha256: hashBytes(context) }], components: [], tools: plan.environment.tools.map(t => ({ ...t, observation: null })), baseline: plan.environment.baseline.map(declaration => ({ declaration, observation: null })), protected_paths: plan.acceptance.protected_paths, writable_paths: plan.scope.writable, limits: [context] };
    const environment = { ...data, map_sha256: hashValue(data) };
    const authority = createExecutionAuthority(plan, { actor: "Fixture operator", actions: ["plan", "build", "verify", "judge"], expiresAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString() });
    const prepared: PreparedRepositorySource = { ...plan.repository, objectStore: join(state, "synthetic-objects.git") };
    for (const [name, value] of Object.entries({ "plan.json": plan, "authority.json": authority, "prepared-source.json": prepared, "environment.json": environment }))
        await writeFile(join(state, name), JSON.stringify(value, null, 2) + "\n");
    const counters = { verifier: 0, role: 0 };
    const services = containedServices(state, prepared, { runCommands: async (request) => {
            counters.verifier++;
            const baseline = request.repo.commit === plan.repository.commit;
            return { provenance: { schema_version: "wringer.runtime.v1", runtimeId: randomUUID(), role: "verifier", kind: plan.runtime.kind, image: plan.runtime.image, repository: { url: request.repo.url, commit: request.repo.commit }, clonedInside: true, hostMounts: [], repositoryAccess: "read-write", declared: plan.runtime, observed: { fixture: true, writableDirectories: request.writableDirectories }, limits: [context] }, sourceTree: baseline ? "a".repeat(40) : "c".repeat(40), sourceChanged: false, checkInputsSha256: "d".repeat(64), results: request.commands.map(c => ({ id: c.id, code: baseline && c.id.startsWith("acceptance/") ? 1 : 0, stdout: "Synthetic observed result", stderr: "", durationMs: 1 })) } as ContainedCommandResult;
        } });
    services.captureCandidate = async () => ({ source: { ...prepared, commit: "b".repeat(40) }, tree: "c".repeat(40), changedPaths: ["src/value.ts"] });
    const options: ContainedJourneyOptions = { controllerDir: state, plan, authority, environment, services, executeRole: async (request) => {
            counters.role++;
            return { status: "completed", text: request.role === "worker" ? "Synthetic worker reply" : JSON.stringify({ criteria: plan.acceptance.criteria.filter(c => c.kind === "check").map(c => ({ id: c.id, met: true, reason: "Synthetic independent review" })), note: context }), sessionId: randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "synthetic-adversarial-fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, usage: { inputTokens: 10, outputTokens: 5 }, events: [], stderr: "", provenance: { schema_version: "wringer.runtime.v1", runtimeId: randomUUID(), role: request.role, kind: plan.runtime.kind, image: plan.runtime.image, repository: request.repo, clonedInside: true, hostMounts: [], repositoryAccess: request.role === "worker" ? "read-write" : "read-only", declared: plan.runtime, observed: { fixture: true }, limits: [context] } } as RoleExecutionResult;
        } };
    return { state, plan, authority, options, counters };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const call = (f: Fixture, ...args: string[]) => dispatch([...args, "--repo", f.state, "--json"], "wringer-drive");
async function display(f: Fixture, hold: ContainedJourneyResult) {
    const id = randomUUID(), body = { schema_version: "wringer.contained-display.v1", id, criterionId: "readable", candidateTree: hold.candidate!.tree, acceptanceSha256: f.plan.acceptance_sha256, at: new Date().toISOString(), success: true, measured: { sourceTree: hold.candidate!.tree, sourceChanged: false, results: [...f.plan.environment.setup.map(c => ({ id: `setup/${c.id}`, code: 0, stdout: "Synthetic setup", stderr: "", durationMs: 1 })), { id: "show-readable", code: 0, stdout: "Synthetic display", stderr: "", durationMs: 1 }], provenance: { schema_version: "wringer.runtime.v1", runtimeId: randomUUID(), role: "verifier", kind: f.plan.runtime.kind, image: f.plan.runtime.image, repository: { url: f.plan.repository.url, commit: hold.candidate!.source.commit }, clonedInside: true, hostMounts: [], repositoryAccess: "read-write", declared: f.plan.runtime, observed: { fixture: true, writableDirectories: f.plan.environment.writable_directories }, limits: ["Synthetic display"] } } };
    await mkdir(join(f.state, "displays"));
    await writeFile(join(f.state, "displays", `${id}.json`), JSON.stringify({ ...body, sha256: hashValue(body) }));
    return id;
}
describe("adversarial contained lifecycle", () => {
    test("withdrawing a human verdict after readiness cannot preserve a green delivery story", async () => {
        const f = await fixture(true), hold = await runContainedJourney(f.options), id = await display(f, hold);
        await call(f, "review", "--state", f.state, "--criterion", "readable", "--display", id, "--verdict", "met", "--by", "Fixture person", "--note", "I accept this display.");
        expect(((await call(f, "resume", "--state", f.state)).value as ContainedJourneyResult).status).toBe("review-ready");
        const oldCache = await readFile(join(f.state, "human-judgements.json"), "utf8");
        const note = "I withdraw approval: this display is not acceptable.";
        await call(f, "review", "--state", f.state, "--criterion", "readable", "--display", id, "--verdict", "not_met", "--by", "Fixture person", "--note", note);
        // No intervening resume is required to revoke delivery readiness.
        expect(((await call(f, "status", "--state", f.state)).value as ContainedJourneyResult).status).toBe("human-hold");
        await expect(call(f, "deliver", "--state", f.state, "--remote", "https://example.invalid/synthetic/repository.git", "--source-branch", "review/withdrawn", "--target-branch", "main")).rejects.toThrow("review-ready");
        // Simulate a stale derived compatibility cache after a partial write.
        await writeFile(join(f.state, "human-judgements.json"), oldCache);
        const resumed = (await call(f, "resume", "--state", f.state)).value as ContainedJourneyResult;
        expect(resumed.status).toBe("human-hold");
        const history = await readValidatedContainedState(f.state);
        expect(history.result.status).not.toBe("review-ready");
        expect(history.result.humanJudgements[0]!.note).toBe(note);
        expect((history.events.findLast(e => e.type === "human-review-recorded")!.details as any).previousReadinessWithdrawn).toBe(true);
        expect(f.counters.role).toBe(2);
    });
    test("a crash after the human journal event cannot resurrect an old met summary or cache", async () => {
        const f = await fixture(true), hold = await runContainedJourney(f.options), id = await display(f, hold);
        await call(f, "review", "--state", f.state, "--criterion", "readable", "--display", id, "--verdict", "met", "--by", "Fixture person", "--note", "Initially accepted.");
        await call(f, "resume", "--state", f.state);
        const viewPath = join(f.state, ".wringer/contained/result.json"), oldView = await readFile(viewPath, "utf8"), cachePath = join(f.state, "human-judgements.json"), oldCache = await readFile(cachePath, "utf8");
        await call(f, "review", "--state", f.state, "--criterion", "readable", "--display", id, "--verdict", "not_met", "--by", "Fixture person", "--note", "The later observation rejects it.");
        const events = join(f.state, ".wringer/contained/events"), names = (await readdir(events)).sort();
        await rm(join(events, names.at(-1)!)); // keep the first durable human-review-recorded event
        await writeFile(viewPath, oldView);
        await writeFile(cachePath, oldCache);
        await expect(call(f, "status", "--state", f.state)).rejects.toThrow("view disagrees");
        const resumed = (await call(f, "resume", "--state", f.state)).value as ContainedJourneyResult;
        expect(resumed.status).toBe("human-hold");
        expect(resumed.humanJudgements[0]!.verdict).toBe("not_met");
        expect(f.counters.role).toBe(2);
    });
    test("crash after journaled green verification reuses that exact verifier receipt and continues", async () => {
        const f = await fixture();
        expect((await runContainedJourney(f.options)).status).toBe("review-ready");
        const directory = join(f.state, ".wringer/contained/events"), names = (await readdir(directory)).sort();
        let checkpoint = -1;
        for (let index = 0; index < names.length; index++) {
            const event = JSON.parse(await readFile(join(directory, names[index]!), "utf8"));
            if (event.type === "candidate-verified") {
                checkpoint = index;
                break;
            }
        }
        expect(checkpoint).toBeGreaterThan(0);
        // Simulate process loss at this durable prefix. Later records are fixture-
        // generated only; no corresponding real model spend ever happened.
        for (const name of names.slice(checkpoint + 1))
            await rm(join(directory, name));
        const resumed = await runContainedJourney(f.options);
        expect(resumed.status).toBe("review-ready");
        expect(f.counters.verifier).toBe(2);
        expect((await readValidatedContainedState(f.state)).result.status).toBe("review-ready");
    });
    test("cached verifier phase/source mismatch and truncated envelope fail without another runtime", async () => {
        const f = await fixture();
        await runContainedJourney(f.options);
        const verified = await readValidatedContainedState(f.state), baseline = verified.state.baseline!;
        const effectId = baseline.evidenceRef.split("/").at(-1)!;
        await expect(f.options.services.verifyCandidate({ plan: f.plan, source: f.options.plan.repository, phase: "candidate", effectId })).rejects.toThrow("different inputs");
        await writeFile(join(baseline.evidenceRef, "observation-record.json"), '{"schema_version":');
        await expect(f.options.services.verifyCandidate({ plan: f.plan, source: f.options.plan.repository, phase: "baseline", effectId })).rejects.toThrow();
        expect(f.counters.verifier).toBe(2);
    });
    test("public contained falsify refuses bad bounds or an unauditable bundle before runtime work", async () => {
        const f = await fixture();
        await expect(call(f, "falsify", "--bundle", "missing", "--max-attempts", "0")).rejects.toThrow("1–500 attempts");
        const invalid = join(f.state, "invalid-bundle");
        await mkdir(invalid);
        await expect(call(f, "falsify", "--bundle", invalid, "--output", join(f.state, "mutation-records"))).rejects.toThrow("must audit before falsification");
        expect(f.counters.verifier).toBe(0);
        expect(f.counters.role).toBe(0);
    });
    test("expired authority remains auditable but cannot authorize a new human review or resume", async () => {
        const f = await fixture(true), hold = await runContainedJourney(f.options), id = await display(f, hold);
        const NativeDate = globalThis.Date, tomorrow = Date.now() + 24 * 3600 * 1000;
        const FutureDate = class extends NativeDate {
            constructor(value?: string | number) { super(value === undefined ? tomorrow : value); }
            static override now() { return tomorrow; }
        };
        try {
            globalThis.Date = FutureDate as DateConstructor;
            expect(((await call(f, "status", "--state", f.state)).value as ContainedJourneyResult).status).toBe("human-hold");
            await expect(call(f, "review", "--state", f.state, "--criterion", "readable", "--display", id, "--verdict", "met", "--by", "Fixture person", "--note", "A new observation")).rejects.toThrow("not currently valid");
            await expect(call(f, "resume", "--state", f.state)).rejects.toThrow("not currently valid");
        }
        finally {
            globalThis.Date = NativeDate;
        }
        expect(f.counters.role).toBe(2);
        expect(f.counters.verifier).toBe(2);
    });
    test("fresh display includes declared setup and fails closed on failed setup or wrong source", async () => {
        const f = await fixture(true), source = { ...f.plan.repository, commit: "b".repeat(40) };
        let setupFails = false, wrongSource = false;
        const runCommands: NonNullable<Parameters<typeof showContainedCandidate>[4]>["runCommands"] = async (request) => {
            expect(request.writableDirectories).toEqual(f.plan.environment.writable_directories);
            expect(request.acceptanceSource!.commit).toBe(f.plan.repository.commit);
            expect(request.commands.map(c => c.id)).toEqual([...f.plan.environment.setup.map(c => `setup/${c.id}`), "show-readable"]);
            return { sourceTree: "c".repeat(40), sourceChanged: false, checkInputsSha256: "d".repeat(64), results: request.commands.map(c => ({ id: c.id, code: setupFails && c.id.startsWith("setup/") ? 1 : 0, stdout: c.id.startsWith("setup/") ? "Setup output is preserved" : "Readable display", stderr: "", durationMs: 1 })), provenance: { schema_version: "wringer.runtime.v1", runtimeId: randomUUID(), role: "verifier", kind: f.plan.runtime.kind, image: f.plan.runtime.image, repository: { ...source, commit: wrongSource ? "9".repeat(40) : source.commit }, clonedInside: true, hostMounts: [], repositoryAccess: "read-write", declared: f.plan.runtime, observed: { fixture: true, writableDirectories: request.writableDirectories }, limits: ["Synthetic display"] } } as ContainedCommandResult;
        };
        const successful = await showContainedCandidate(f.plan, source, "readable", undefined, { runCommands });
        expect(successful.success).toBe(true);
        expect(successful.measured.results[0]!.stdout).toBe("Setup output is preserved");
        setupFails = true;
        expect((await showContainedCandidate(f.plan, source, "readable", undefined, { runCommands })).success).toBe(false);
        wrongSource = true;
        await expect(showContainedCandidate(f.plan, source, "readable", undefined, { runCommands })).rejects.toThrow("exact source");
        expect(f.counters.role).toBe(0);
    });
});
