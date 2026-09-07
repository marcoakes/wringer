import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { compileExecutionPlan, compileDeclaration, createExecutionAuthority, hashBytes, hashValue } from "@wringer/plan";
import type { ExecutionPlan, EnvironmentMap } from "@wringer/plan";
import type { RoleExecutionRequest, RoleExecutionResult } from "@wringer/runtime";
import { runContainedJourney, readValidatedContainedState, draftSpec } from "../src";
import type { ContainedJourneyOptions, ContainedJourneyServices, CandidateVerification } from "../src";
const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
function planFixture(options: {
    human?: boolean;
    workerTurns?: number;
    planner?: boolean;
} = {}): ExecutionPlan {
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = compileExecutionPlan(template, { format: "yaml" });
    const d = structuredClone(raw);
    d.repository.commit = "a".repeat(40);
    d.budget.max_worker_turns = options.workerTurns ?? 3;
    if (options.planner) {
        d.agents.planner = d.agents.judge;
        d.budget.max_planner_turns = 1;
    }
    if (options.human) {
        d.intent += " The display is readable.";
        d.acceptance.criteria.push({ id: "readable", title: "Readable display", quote: "The display is readable.", kind: "human", required: true, show: { id: "show-readable", argv: ["bun", "run", "demo"], cwd: ".", timeout_seconds: 60 } });
    }
    return compileDeclaration({ version: 1, ...d });
}
function environment(plan: ExecutionPlan): EnvironmentMap {
    const files = ["README.md", ...plan.acceptance.checks.flatMap(c => c.files)].map(path => ({ path, mode: "100644", blob: "f".repeat(40) }));
    const data: Omit<EnvironmentMap, "map_sha256"> = { schema_version: "wringer.environment-map.v1", repository: plan.repository, plan_sha256: plan.plan_sha256, source_tree: "a".repeat(40), inventory_sha256: hashValue(files), files, context: [{ path: "README.md", blob: "f".repeat(40), text: "Fixture repository", sha256: hashBytes("Fixture repository") }], components: [], tools: plan.environment.tools.map(t => ({ ...t, observation: null })), baseline: plan.environment.baseline.map(declaration => ({ declaration, observation: null })), protected_paths: plan.acceptance.protected_paths, writable_paths: plan.scope.writable, limits: ["Synthetic unit-test map; no runtime or provider measured"] };
    return { ...data, map_sha256: hashValue(data) };
}
async function fixture(settings: {
    human?: boolean;
    workerTurns?: number;
    planner?: boolean;
    failedVerifications?: number;
    judgeFails?: number;
    changedPaths?: string[];
    unknownUsage?: boolean;
    sharedRuntime?: boolean;
    throwFirstWorker?: boolean;
} = {}) {
    const plan = planFixture(settings), controllerDir = await mkdtemp(join(tmpdir(), "wringer-contained-"));
    const requests: RoleExecutionRequest[] = [];
    let workerCount = 0, judgeCount = 0, candidateVerifications = 0, throwWorker = !!settings.throwFirstWorker;
    const serviceCalls: {
        kind: string;
        effectId: string;
    }[] = [];
    const authority = createExecutionAuthority(plan, { actor: "Fixture operator", actions: ["plan", "build", "verify", "judge"], expiresAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString() });
    const services: ContainedJourneyServices = {
        prepareSource: async (source) => source,
        captureCandidate: async (_result, _base, effectId) => { serviceCalls.push({ kind: "capture", effectId }); const source = { ...plan.repository, commit: workerCount.toString(16).padStart(40, "b") }; return { source, tree: workerCount.toString(16).padStart(40, "c"), changedPaths: settings.changedPaths ?? ["src/value.ts"] }; },
        verifyCandidate: async (request) => {
            serviceCalls.push({ kind: request.phase, effectId: request.effectId });
            const failed = request.phase === "baseline" || ++candidateVerifications <= (settings.failedVerifications ?? 0);
            return { schema_version: "wringer.contained-verification.v1", status: failed ? "failed" : "passed", candidateCommit: request.source.commit, candidateTree: request.phase === "baseline" ? "a".repeat(40) : workerCount.toString(16).padStart(40, "c"), acceptanceSha256: plan.acceptance_sha256, runtimeId: randomUUID(), image: plan.runtime.image, checks: plan.acceptance.checks.map(c => ({ id: c.id, status: failed ? "failed" : "passed", exitCode: failed ? 1 : 0, checkInputsSha256: "d".repeat(64), outputSha256: "e".repeat(64) })), regressions: plan.environment.baseline.map(c => ({ id: c.id, status: "passed", exitCode: 0, outputSha256: "e".repeat(64) })), evidenceRef: `fixture/${request.effectId}` } as CandidateVerification;
        },
    };
    const executeRole = async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => {
        requests.push(request);
        let answer: string;
        if (request.role === "worker") {
            workerCount++;
            if (throwWorker) {
                throwWorker = false;
                throw new Error("Connection lost after possible spend");
            }
            answer = "WORKER_PRIVATE_NARRATIVE_DO_NOT_SEND_TO_JUDGE";
        }
        else if (request.role === "planner")
            answer = JSON.stringify({ omissions: [], questions: [], note: "Fixture coverage review" });
        else {
            judgeCount++;
            answer = JSON.stringify({ criteria: plan.acceptance.criteria.filter(c => c.kind === "check").map(c => ({ id: c.id, met: judgeCount > (settings.judgeFails ?? 0), reason: "Fixture independent inspection" })), note: "Fixture only" });
        }
        return { status: "completed", text: answer, sessionId: randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, ...(settings.unknownUsage ? {} : { usage: { inputTokens: 10, outputTokens: 5 } }), events: [], stderr: "", provenance: { schema_version: "wringer.runtime.v1", runtimeId: settings.sharedRuntime ? "reused-role-runtime" : randomUUID(), role: request.role, kind: request.runtime.kind, image: request.runtime.image, repository: request.repo, clonedInside: true, hostMounts: [], repositoryAccess: request.role === "worker" ? "read-write" : "read-only", declared: request.runtime, observed: { fixture: true }, limits: ["No real runtime or provider"] } };
    };
    const options: ContainedJourneyOptions = { controllerDir, plan, authority, environment: environment(plan), services, executeRole };
    return { options, requests, serviceCalls };
}
describe("contained ACP production journey", () => {
    test("red → worker → independent verification → judge → ready, then zero model replay", async () => {
        const f = await fixture();
        const result = await runContainedJourney(f.options);
        expect(result.status).toBe("review-ready");
        expect(result.sessions).toBe(2);
        expect(result.tokens).toEqual({ input: 20, output: 10 });
        expect(f.requests.map(r => r.role)).toEqual(["worker", "judge"]);
        expect(f.requests[1]!.prompt).not.toContain("WORKER_PRIVATE_NARRATIVE");
        expect(f.requests[0]!.repo.commit).not.toBe(f.requests[1]!.repo.commit);
        const resumed = await runContainedJourney(f.options);
        expect(resumed.status).toBe("review-ready");
        expect(f.requests).toHaveLength(2);
        const events = await readdir(join(f.options.controllerDir, ".wringer/contained/events"));
        expect(events.length).toBeGreaterThan(8);
        const validated = await readValidatedContainedState(f.options.controllerDir);
        expect(validated.result).toEqual(resumed);
        expect(validated.state.stage).toBe("ready");
        expect(validated.state.effects.every(e => e.result)).toBe(true);
    });
    test("historical reader rejects a mutable ready view and role sidecar tampering", async () => {
        const f = await fixture();
        const result = await runContainedJourney(f.options);
        const viewPath = join(f.options.controllerDir, ".wringer/contained/result.json");
        await writeFile(viewPath, JSON.stringify({ ...result, sessions: 0, tokens: { input: 0, output: 0 } }));
        await expect(readValidatedContainedState(f.options.controllerDir)).rejects.toThrow("view disagrees");
        await runContainedJourney(f.options);
        const validated = await readValidatedContainedState(f.options.controllerDir);
        const effect = validated.state.effects[0]!;
        const replyPath = join(f.options.controllerDir, ".wringer/contained/effects", effect.id, "result.json");
        await writeFile(replyPath, JSON.stringify({ ...effect.result, text: "Altered evidence" }));
        await expect(readValidatedContainedState(f.options.controllerDir)).rejects.toThrow("completion digest");
        expect(f.requests).toHaveLength(2);
    });
    test("historical reader validates original execution authority without requiring it to be unexpired today", async () => {
        const f = await fixture();
        await runContainedJourney(f.options);
        const NativeDate = globalThis.Date, advanced = Date.now() + 24 * 3600 * 1000;
        const AuditDate = class extends NativeDate {
            constructor(value?: string | number) { super(value === undefined ? advanced : value); }
            static override now() { return advanced; }
        };
        try {
            globalThis.Date = AuditDate as DateConstructor;
            const validated = await readValidatedContainedState(f.options.controllerDir);
            expect(validated.result.status).toBe("review-ready");
        }
        finally {
            globalThis.Date = NativeDate;
        }
        expect(f.requests).toHaveLength(2);
    });
    test("human HOLD prints show, retains exact note and requires candidate-bound display", async () => {
        const f = await fixture({ human: true });
        const hold = await runContainedJourney(f.options);
        expect(hold.status).toBe("human-hold");
        expect(hold.stop!.next_move).toContain("wringer-drive show --state");
        const judgement = { criterionId: "readable", candidateTree: hold.candidate!.tree, acceptanceSha256: f.options.plan.acceptance_sha256, verdict: "met" as const, by: "Independent fixture operator", note: "Yes — this shows what I need, in my own words.", display: { candidateTree: hold.candidate!.tree, status: "shown" as const, receiptSha256: "a".repeat(64) } };
        const stale = await runContainedJourney({ ...f.options, humanJudgements: [{ ...judgement, candidateTree: "b".repeat(40) }] });
        expect(stale.status).toBe("human-hold");
        const ready = await runContainedJourney({ ...f.options, humanJudgements: [judgement] });
        expect(ready.status).toBe("review-ready");
        expect(ready.humanJudgements[0]!.note).toBe(judgement.note);
        expect(f.requests).toHaveLength(2);
    });
    test("verification and judge repairs share the whole worker/session ceiling", async () => {
        const f = await fixture({ workerTurns: 2, failedVerifications: 1, judgeFails: 1 });
        const result = await runContainedJourney(f.options);
        expect(result.status).toBe("stopped");
        expect(result.stop!.reason).toBe("agent-budget-exhausted");
        expect(f.requests.filter(r => r.role === "worker")).toHaveLength(2);
        const resumed = await runContainedJourney(f.options);
        expect(resumed.stop!.reason).toBe("agent-budget-exhausted");
        expect(f.requests.filter(r => r.role === "worker")).toHaveLength(2);
    });
    test("uncertain role is charged and never silently retried", async () => {
        const f = await fixture({ throwFirstWorker: true });
        const first = await runContainedJourney(f.options);
        expect(first.stop!.reason).toBe("effect-uncertain");
        expect(first.sessions).toBe(1);
        expect((await runContainedJourney(f.options)).stop!.reason).toBe("effect-uncertain");
        expect(f.requests).toHaveLength(1);
        const repaired = await runContainedJourney({ ...f.options, retryUncertain: true });
        expect(repaired.status).toBe("review-ready");
        expect(repaired.sessions).toBe(3);
        expect(repaired.tokens.input).toBeNull();
    });
    test("candidate capture failure resumes a known worker result without another paid turn", async () => {
        const f = await fixture();
        const capture = f.options.services.captureCandidate;
        let failed = false;
        f.options.services.captureCandidate = async (...args) => { if (!failed) {
            failed = true;
            throw new Error("Controller stopped during candidate materialization");
        } return capture(...args); };
        expect((await runContainedJourney(f.options)).stop!.reason).toBe("controller-error");
        expect(f.requests.filter(r => r.role === "worker")).toHaveLength(1);
        const ready = await runContainedJourney(f.options);
        expect(ready.status).toBe("review-ready");
        expect(f.requests.filter(r => r.role === "worker")).toHaveLength(1);
    });
    test("known stopped and invalid replies have an explicit bounded recovery route", async () => {
        const f = await fixture();
        const execute = f.options.executeRole!;
        let stopped = false, invalid = false;
        f.options.executeRole = async (request) => { const result = await execute(request); if (request.role === "worker" && !stopped) {
            stopped = true;
            return { ...result, status: "stopped", stopReason: "Fixture external precondition was missing" };
        } if (request.role === "judge" && !invalid) {
            invalid = true;
            return { ...result, text: "not valid JSON" };
        } return result; };
        const first = await runContainedJourney(f.options);
        expect(first.stop!.reason).toBe("worker-stopped");
        expect(first.stop!.next_move).toContain("--retry-stopped");
        await runContainedJourney(f.options);
        expect(f.requests).toHaveLength(1);
        const bad = await runContainedJourney({ ...f.options, retryStopped: true });
        expect(bad.stop!.reason).toBe("judge-invalid-reply");
        await runContainedJourney(f.options);
        expect(f.requests).toHaveLength(3);
        const ready = await runContainedJourney({ ...f.options, retryStopped: true });
        expect(ready.status).toBe("review-ready");
        expect(ready.sessions).toBe(4);
    });
    test("exact retained request/result identities are checked even after readiness", async () => {
        const f = await fixture();
        await runContainedJourney(f.options);
        const effects = await readdir(join(f.options.controllerDir, ".wringer/contained/effects"));
        const path = join(f.options.controllerDir, ".wringer/contained/effects", effects[0]!, "request.json");
        const request = JSON.parse(await readFile(path, "utf8"));
        request.prompt = "Tampered capture";
        await writeFile(path, JSON.stringify(request));
        await expect(runContainedJourney(f.options)).rejects.toThrow("pre-spend digest");
        expect(f.requests).toHaveLength(2);
    });
    test("protected acceptance edits and reused role runtimes refuse", async () => {
        const changed = await fixture({ changedPaths: ["tests/acceptance.test.ts"] });
        const result = await runContainedJourney(changed.options);
        expect(result.status).toBe("stopped");
        expect(["scope-violation", "acceptance-mutation"]).toContain(result.stop!.reason);
        expect(changed.requests).toHaveLength(1);
        const reused = await fixture({ sharedRuntime: true });
        expect((await runContainedJourney(reused.options)).stop!.reason).toBe("effect-uncertain");
    });
    test("planner is a separate contained session, usage unknown is not zero", async () => {
        const f = await fixture({ planner: true, unknownUsage: true });
        const result = await runContainedJourney(f.options);
        expect(result.status).toBe("review-ready");
        expect(f.requests.map(r => r.role)).toEqual(["planner", "worker", "judge"]);
        expect(result.tokens).toEqual({ input: null, output: null });
    });
    test("changed plan and damaged journal cannot inherit prior authority", async () => {
        const f = await fixture();
        await runContainedJourney(f.options);
        expect(runContainedJourney({ ...f.options, plan: { ...f.options.plan, name: "Changed" } })).rejects.toThrow();
        const path = join(f.options.controllerDir, ".wringer/contained/events/000001.json"), first = JSON.parse(await readFile(path, "utf8"));
        first.state.effects = [];
        first.type = "tampered";
        await writeFile(path, JSON.stringify(first));
        expect(runContainedJourney(f.options)).rejects.toThrow("damaged");
        expect(f.requests).toHaveLength(2);
    });
    test("cancellation and missing authority stop before agent spend", async () => {
        const f = await fixture();
        const abort = new AbortController();
        abort.abort();
        expect((await runContainedJourney({ ...f.options, signal: abort.signal })).stop!.reason).toBe("interrupted");
        expect(f.requests).toHaveLength(0);
        const ungranted = await fixture();
        ungranted.options.authority = { ...ungranted.options.authority, actions: [] };
        expect((await runContainedJourney(ungranted.options)).stop!.reason).toBe("authority-missing");
        expect(ungranted.requests).toHaveLength(0);
        expect(draftSpec({ endpoint: "https://provider.example.invalid" })).rejects.toThrow("retired");
    });
});
