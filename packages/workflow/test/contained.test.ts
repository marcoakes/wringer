import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { runAcpTurn } from "../../acp/src";
import { compileExecutionPlan, compileDeclaration, createExecutionAuthority, hashBytes, hashValue, planningRequestFromPlan, createPlanningAuthority, validatePlanningAuthority, environmentReadiness, ingestEnvironmentObservations } from "@wringer/plan";
import type { ExecutionPlan, EnvironmentMap } from "@wringer/plan";
import { runtimeProvenanceVersion, type RoleExecutionRequest, type RoleExecutionResult } from "@wringer/runtime";
import { runContainedJourney, readValidatedContainedState, queryContainedJourney, requestContainedRevision, proposeContainedPlan, runContainedDiscovery, draftSpec, recordContainedHumanDecisions, recordContainedHumanJudgement, validContainedHumanAttribution, type CandidateHumanDecision } from "../src";
import type { ContainedJourneyOptions, ContainedJourneyServices, CandidateVerification } from "../src";
const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
function planFixture(options: {
    human?: boolean;
    secondHuman?: boolean;
    workerTurns?: number;
    planner?: boolean;
    local?: boolean;
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
        if (options.secondHuman) d.acceptance.criteria.push({ id: "readable-again", title: "Another explicit observation", quote: "The display is readable.", kind: "human", required: true, show: { id: "show-readable-again", argv: ["bun", "run", "demo"], cwd: ".", timeout_seconds: 60 } });
    }
    // A local-only plan names its source by its history's root; nothing else about the fixture differs.
    if (options.local) d.repository.url = `local://${"a".repeat(40)}`;
    return compileDeclaration({ version: options.local ? 4 : 1, ...d });
}
function environment(plan: ExecutionPlan): EnvironmentMap {
    const files = ["README.md", ...plan.acceptance.checks.flatMap(c => c.files)].map(path => ({ path, mode: "100644", blob: "f".repeat(40) }));
    const data: Omit<EnvironmentMap, "map_sha256"> = { schema_version: "wringer.environment-map.v1", repository: plan.repository, plan_sha256: plan.plan_sha256, source_tree: "a".repeat(40), inventory_sha256: hashValue(files), files, context: [{ path: "README.md", blob: "f".repeat(40), text: "Fixture repository", sha256: hashBytes("Fixture repository") }], components: [], tools: plan.environment.tools.map(t => ({ ...t, observation: null })), baseline: plan.environment.baseline.map(declaration => ({ declaration, observation: null })), protected_paths: plan.acceptance.protected_paths, writable_paths: plan.scope.writable, limits: ["Synthetic unit-test map; no runtime or provider measured"] };
    return { ...data, map_sha256: hashValue(data) };
}
async function fixture(settings: {
    human?: boolean;
    secondHuman?: boolean;
    workerTurns?: number;
    planner?: boolean;
    failedVerifications?: number;
    judgeFails?: number;
    changedPaths?: string[];
    unknownUsage?: boolean;
    sharedRuntime?: boolean;
    throwFirstWorker?: boolean;
    local?: boolean;
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
        return { status: "completed", text: answer, sessionId: randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, ...(settings.unknownUsage ? {} : { usage: { inputTokens: 10, outputTokens: 5 } }), events: [], stderr: "", provenance: { schema_version: runtimeProvenanceVersion(request.repo.url), runtimeId: settings.sharedRuntime ? "reused-role-runtime" : randomUUID(), role: request.role, kind: request.runtime.kind, image: request.runtime.image, repository: request.repo, clonedInside: true, hostMounts: [], repositoryAccess: request.role === "worker" ? "read-write" : "read-only", declared: request.runtime, observed: { fixture: true }, limits: ["No real runtime or provider"] } };
    };
    const options: ContainedJourneyOptions = { controllerDir, plan, authority, environment: environment(plan), services, executeRole };
    return { options, requests, serviceCalls };
}
describe("contained ACP production journey", () => {
    async function decision(f: Awaited<ReturnType<typeof fixture>>, criterionId = "readable", success = true): Promise<CandidateHumanDecision> {
        const history = await readValidatedContainedState(f.options.controllerDir), { plan, authority, state } = history, candidate = state.candidate!, criterion = plan.acceptance.criteria.find(c => c.id === criterionId)!;
        const id = randomUUID(), body = { schema_version: "wringer.contained-display.v1", id, criterionId, candidateTree: candidate.tree, acceptanceSha256: plan.acceptance_sha256, at: new Date().toISOString(), success,
            measured: { sourceChanged: false, sourceTree: candidate.tree, results: [...plan.environment.setup.map(c => `setup/${c.id}`), criterion.show!.id].map(id => ({ id, code: success ? 0 : 1, stdout: "Synthetic display", stderr: "" })), provenance: { role: "verifier", kind: plan.runtime.kind, image: plan.runtime.image, repository: candidate.source, clonedInside: true, hostMounts: [], observed: { writableDirectories: plan.environment.writable_directories } } } };
        const sha256 = hashValue(body);
        await mkdir(join(f.options.controllerDir, "displays"), { recursive: true });
        await writeFile(join(f.options.controllerDir, "displays", `${id}.json`), JSON.stringify({ ...body, sha256 }));
        return { schema_version: "wringer.contained-human-decision.v1", criterionId, candidateTree: candidate.tree, acceptanceSha256: plan.acceptance_sha256, verdict: "met", by: authority.actor, note: null, displayId: id, display: { candidateTree: candidate.tree, status: "shown", receiptSha256: sha256 }, attribution: "initial-execution-approval", authoritySha256: hashValue(authority) };
    }
    test("one explicit batch accepts exactly the displayed requirements without inventing notes or more spend", async () => {
        const f = await fixture({ human: true, secondHuman: true }); await runContainedJourney(f.options);
        const first = await decision(f), second = await decision(f, "readable-again"), original = "  My own observation.\nNothing added.  "; second.note = original;
        const before = await readValidatedContainedState(f.options.controllerDir), calls = f.requests.length;
        const recorded = await recordContainedHumanDecisions(f.options.controllerDir, [first, second], { expectedRevision: before.events.at(-1)!.sha256, expectedCandidateTree: first.candidateTree });
        expect(recorded.judgements.map(j => j.note)).toEqual([null, original]);
        const after = await readValidatedContainedState(f.options.controllerDir);
        expect(after.events.length - before.events.length).toBe(2);
        expect(after.events.at(-2)?.type).toBe("human-decisions-recorded");
        expect(after.result.status).toBe("human-hold");
        const ready = await runContainedJourney(f.options);
        expect(ready.status).toBe("review-ready"); expect(ready.humanJudgements[0]?.note).toBeNull(); expect(f.requests.length).toBe(calls);
        expect((await readValidatedContainedState(f.options.controllerDir)).result.humanJudgements).toEqual(recorded.judgements);
    });
    test("a missing, failed, stale or forged member rejects every decision in a batch", async () => {
        const f = await fixture({ human: true, secondHuman: true }); await runContainedJourney(f.options);
        const first = await decision(f), second = await decision(f, "readable-again"), failed = await decision(f, "readable-again", false), before = await readValidatedContainedState(f.options.controllerDir);
        const copiedId = randomUUID();
        await writeFile(join(f.options.controllerDir, "displays", `${copiedId}.json`), await readFile(join(f.options.controllerDir, "displays", `${second.displayId}.json`)));
        for (const wrong of [{ ...second, displayId: randomUUID() }, { ...second, displayId: copiedId }, failed, { ...second, candidateTree: "d".repeat(40) }, { ...second, by: "Somebody else" }, { ...second, authoritySha256: "a".repeat(64) }, { ...second, note: "" }, { ...second, schema_version: "future" }]) {
            await expect(recordContainedHumanDecisions(f.options.controllerDir, [first, wrong as CandidateHumanDecision])).rejects.toThrow();
            const after = await readValidatedContainedState(f.options.controllerDir);
            expect(after.events.at(-1)?.sha256).toBe(before.events.at(-1)?.sha256); expect(after.result.humanJudgements).toEqual([]);
        }
        await expect(recordContainedHumanDecisions(f.options.controllerDir, [first, first])).rejects.toThrow("distinct");
        await expect(recordContainedHumanDecisions(f.options.controllerDir, [first, second], { expectedRevision: "a".repeat(64) })).rejects.toThrow();
        const prior = process.env.WRINGER_TEST_DECISION_SECRET;
        process.env.WRINGER_TEST_DECISION_SECRET = "synthetic-review-credential-1592653589";
        try {
            await expect(recordContainedHumanDecisions(f.options.controllerDir, [first, { ...second, note: process.env.WRINGER_TEST_DECISION_SECRET }])).rejects.toThrow("credential");
            expect((await readValidatedContainedState(f.options.controllerDir)).events.at(-1)?.sha256).toBe(before.events.at(-1)?.sha256);
        } finally { if (prior === undefined) delete process.env.WRINGER_TEST_DECISION_SECRET; else process.env.WRINGER_TEST_DECISION_SECRET = prior; }
    });
    test("a negative decision without a comment stays a genuine refusal; legacy noted observations still work", async () => {
        const f = await fixture({ human: true }); await runContainedJourney(f.options);
        const row = await decision(f); row.verdict = "not_met";
        const rejected = await recordContainedHumanDecisions(f.options.controllerDir, [row]);
        expect(rejected.result.stop?.reason).toBe("human-said-no"); expect(rejected.judgements[0]?.note).toBeNull();
        expect((await runContainedJourney(f.options)).status).toBe("human-hold");
        const { schema_version, attribution, authoritySha256, ...legacy } = row;
        const noted = { ...legacy, verdict: "met" as const, by: "Legacy named reviewer", note: "My historical original note" };
        expect(validContainedHumanAttribution(noted, f.options.authority)).toBe(true);
        await recordContainedHumanJudgement(f.options.controllerDir, noted);
        expect((await runContainedJourney(f.options)).status).toBe("review-ready");
    });
    test("blind regression: prose-wrapped execution planner and judge replies retain parse evidence", async () => {
        const f = await fixture({ planner: true, human: true }), execute = f.options.executeRole!;
        f.options.executeRole = async request => {
            const result = await execute(request);
            return request.role === "worker" ? result : { ...result, text: `Here is my review.\n\n\`\`\`json\n${result.text}\n\`\`\`\nReview complete.` };
        };
        const result = await runContainedJourney(f.options);
        expect(result.status).toBe("human-hold");
        expect(result.sessions).toBe(3);
        const history = await readValidatedContainedState(f.options.controllerDir);
        const parsed = history.events.filter(e => e.type === "agent-reply-parsed");
        expect(parsed).toHaveLength(2);
        for (const event of parsed) {
            const details = event.details as { effectId: string; receiptSha256: string };
            const receipt = JSON.parse(await readFile(join(f.options.controllerDir, ".wringer/contained/effects", details.effectId, "parsing.json"), "utf8"));
            expect(receipt.parsing.path).toBe("json-fence");
            expect(hashValue(receipt)).toBe(details.receiptSha256);
        }
    });
    test("blind regression: a completed worker reporting HTTP 401 reserves one turn, never four", async () => {
        const f = await fixture({ workerTurns: 4, failedVerifications: 4 }), execute = f.options.executeRole!;
        f.options.executeRole = async request => ({ ...await execute(request), text: 'unexpected status 401 Unauthorized: {"error":{"message":"Incorrect API key provided: [REDACTED]","type":"invalid_request_error","code":"invalid_api_key"}}, url: https://api.openai.com/v1/responses' });
        f.options.services.captureCandidate = async (_result, source) => ({ source, tree: f.options.environment.source_tree, changedPaths: [] });
        const stopped = await runContainedJourney(f.options);
        expect(stopped.stop?.reason).toBe("worker-auth-rejected");
        expect(stopped.stop?.message).toContain("401");
        expect(stopped.sessions).toBe(1);
        expect(f.serviceCalls.filter(c => c.kind === "candidate")).toHaveLength(0);
        expect((await runContainedJourney(f.options)).sessions).toBe(1);
        expect((await readValidatedContainedState(f.options.controllerDir)).events.some(e => e.type === "worker-outcome-stopped")).toBe(true);
    });
    test("blind regression: unchanged worker source stops before verification and explicit retry alone spends again", async () => {
        const f = await fixture();
        f.options.services.captureCandidate = async (_result, source) => ({ source, tree: f.options.environment.source_tree, changedPaths: [] });
        const first = await runContainedJourney(f.options);
        expect(first.stop?.reason).toBe("worker-no-change");
        expect(first.sessions).toBe(1);
        expect(first.candidate).toBeNull();
        expect((await runContainedJourney(f.options)).sessions).toBe(1);
        expect((await runContainedJourney({ ...f.options, retryStopped: true })).sessions).toBe(2);
        expect(f.serviceCalls.filter(c => c.kind === "candidate")).toHaveLength(0);
    });
    test("blind regression: exhausted retries offer a new grant, not a knowingly impossible retry", async () => {
        const f = await fixture({ planner: true }), execute = f.options.executeRole!;
        f.options.executeRole = async request => ({ ...await execute(request), text: "No JSON reply" });
        const first = await runContainedJourney(f.options);
        expect(first.stop?.reason).toBe("planner-invalid-reply");
        expect(first.stop?.message).toContain("grant");
        expect(first.stop?.next_move).toContain("new-grant --state");
        expect(first.stop?.next_move).not.toContain("--retry-stopped");
        const retry = await runContainedJourney({ ...f.options, retryUncertain: true });
        expect(retry.stop?.reason).toBe("retry-not-applicable");
        expect(retry.stop?.next_move).toContain("new-grant --state");
        expect(retry.sessions).toBe(1);
    });
    test("blind regression: a mistyped uncertain retry cannot hide an active stopped task from the board", async () => {
        const f = await fixture(), execute = f.options.executeRole!;
        f.options.executeRole = async request => ({ ...await execute(request), ...(request.role === "judge" ? { text: "Bad review fixture" } : {}) });
        await runContainedJourney(f.options);
        const result = await runContainedJourney({ ...f.options, retryUncertain: true });
        expect(result.stop?.reason).toBe("retry-not-applicable");
        const query = await queryContainedJourney(f.options.controllerDir);
        expect(query.actions.find(a => a.id === "resume")?.enabled).toBe(false);
        expect(query.actions.find(a => a.id === "retry-uncertain")?.enabled).toBe(false);
        expect(query.actions.find(a => a.id === "retry-stopped")?.enabled).toBe(true);
        expect(result.sessions).toBe(2);
    });
    test("blind regression: a planner's real questions cannot be answered by Continue", async () => {
        const f = await fixture({ planner: true }), execute = f.options.executeRole!;
        f.options.executeRole = async request => ({ ...await execute(request), text: JSON.stringify({ omissions: [], questions: ["Which value should a skipped step carry?"], note: "A product choice remains." }) });
        const result = await runContainedJourney(f.options);
        expect(result.stop?.reason).toBe("intent-needs-decision");
        expect(result.stop?.message).toContain("Which value");
        expect((await queryContainedJourney(f.options.controllerDir)).actions.find(a => a.id === "resume")?.enabled).toBe(false);
        expect((await runContainedJourney(f.options)).sessions).toBe(1);
    });
    test("blind regression: born-green names the passing check and retained receipt", async () => {
        const f = await fixture(), verify = f.options.services.verifyCandidate;
        f.options.services.verifyCandidate = async request => {
            const result = await verify(request);
            return { ...result, status: "passed", checks: result.checks.map(c => ({ ...c, status: "passed", exitCode: 0 })) };
        };
        const result = await runContainedJourney(f.options);
        expect(result.stop?.reason).toBe("acceptance-born-green");
        expect(result.stop?.message).toContain(f.options.plan.acceptance.checks[0]!.id);
        expect(result.stop?.message).toContain("fixture/");
        expect(result.stop?.next_move).toContain("new-grant --state");
        expect(result.sessions).toBe(0);
    });
    function controlledClock() {
        const NativeDate = globalThis.Date;
        let instant = NativeDate.now();
        globalThis.Date = class extends NativeDate {
            constructor(value?: string | number) { super(value === undefined ? instant : value); }
            static override now() { return instant; }
        } as DateConstructor;
        return { advanceTo: (time: number) => { instant = time; }, restore: () => { globalThis.Date = NativeDate; } };
    }
    /** Actual ACP client; only the agent byte stream is an in-memory fixture. */
    function delayedAcp(opened: () => void) {
        const input = new PassThrough(), output = new PassThrough(), errors = new PassThrough();
        let buffer = "", prompts = 0;
        input.on("data", chunk => {
            buffer += chunk;
            let end: number;
            while ((end = buffer.indexOf("\n")) >= 0) {
                const packet = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
                const reply = (result: unknown) => output.write(JSON.stringify({ jsonrpc: "2.0", id: packet.id, result }) + "\n");
                if (packet.method === "initialize") reply({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] });
                if (packet.method === "session/new") { opened(); reply({ sessionId: randomUUID() }); }
                if (packet.method === "session/prompt") { prompts++; reply({ stopReason: "end_turn" }); }
            }
        });
        return { prompts: () => prompts, execute: (request: RoleExecutionRequest) => runAcpTurn({ input, output, errors, exited: new Promise(() => {}), async terminate() { input.destroy(); output.destroy(); errors.destroy(); } }, { role: request.role, cwd: "/workspace/repo", prompt: request.prompt, timeoutMs: request.budget.timeoutMs, signal: request.signal, onEvent: request.onEvent }) };
    }
    test("authority expiry during ACP startup or preflight persistence prevents the actual prompt and keeps the reservation", async () => {
        for (const delayAt of ["session", "observer"] as const) {
            const clock = controlledClock();
            try {
                const f = await fixture(), expires = Date.now() + 10000;
                f.options.authority = { ...f.options.authority, expires_at: new Date(expires).toISOString() };
                const acp = delayedAcp(() => { if (delayAt === "session") clock.advanceTo(expires + 1); });
                let offeredTimeout = Infinity;
                f.options.executeRole = async request => { offeredTimeout = request.budget.timeoutMs; await acp.execute(request); throw new Error("Fixture has no completed role result"); };
                if (delayAt === "observer") f.options.onEvent = async event => { if (event.type === "agent-progress" && (event.event as any)?.type === "acp.prompt.preflight") clock.advanceTo(expires + 1); };
                const result = await runContainedJourney(f.options);
                expect(acp.prompts()).toBe(0); expect(offeredTimeout).toBeLessThanOrEqual(10000);
                expect(result.stop?.reason).toBe("effect-uncertain"); expect(result.sessions).toBe(1);
                const history = await readValidatedContainedState(f.options.controllerDir);
                expect(history.state.effects).toHaveLength(1); expect(history.state.effects[0]!.status).toBe("uncertain");
                await expect(runContainedJourney(f.options)).rejects.toThrow("Authority is not currently valid");
                expect(acp.prompts()).toBe(0);
            } finally { clock.restore(); }
        }
    });
    test("planning expiry during session opening prevents the actual ACP prompt and retains its charged attempt", async () => {
        const clock = controlledClock();
        try {
            const f = await fixture({ planner: true }), request = planningRequestFromPlan(f.options.plan, f.options.plan.intent), expires = Date.now() + 10000;
            const authority = createPlanningAuthority(request, { actor: "Expiry fixture", expiresAt: new Date(expires).toISOString() });
            const acp = delayedAcp(() => clock.advanceTo(expires + 1)); let offeredTimeout = Infinity;
            const options = { controllerDir: f.options.controllerDir, request, authority, source: request.repository, executeRole: async (r: RoleExecutionRequest): Promise<RoleExecutionResult> => { offeredTimeout = r.budget.timeoutMs; await acp.execute(r); throw new Error("Fixture has no completed planning result"); } };
            const result = await proposeContainedPlan(options);
            expect(acp.prompts()).toBe(0); expect(offeredTimeout).toBeLessThanOrEqual(10000);
            expect(result.status).toBe("stopped"); expect(result.attempts).toBe(1); expect(result.stopReason).toContain("planner-uncertain");
            const names = await readdir(join(f.options.controllerDir, ".wringer/planning/events")), last = JSON.parse(await readFile(join(f.options.controllerDir, ".wringer/planning/events", names.sort().at(-1)!), "utf8"));
            expect(last.state.attempts).toHaveLength(1); expect(last.state.attempts[0].status).toBe("uncertain");
            await expect(proposeContainedPlan(options)).rejects.toThrow("authority is invalid"); expect(acp.prompts()).toBe(0);
        } finally { clock.restore(); }
    });
    test("authority expiry actively cancels independent verification and discovery without releasing their reservations", async () => {
        for (const phase of ["verification", "discovery"] as const) {
            const clock = controlledClock();
            try {
                const f = await fixture(), expires = Date.now() + 80;
                f.options.authority = { ...f.options.authority, expires_at: new Date(expires).toISOString() };
                let expired = false;
                const waitForExpiry = async (signal?: AbortSignal): Promise<never> => {
                    await new Promise<void>((done, reject) => {
                        const fail = setTimeout(() => reject(new Error("Fixture: expiry did not cancel active work")), 600);
                        const stop = () => { clearTimeout(fail); expired = true; done(); };
                        if (signal?.aborted) stop(); else signal?.addEventListener("abort", stop, { once: true });
                    });
                    clock.advanceTo(expires + 1);
                    throw new Error("Fixture observed authority-expiry interruption");
                };
                if (phase === "verification") {
                    f.options.services.verifyCandidate = ({ signal }) => waitForExpiry(signal);
                    const result = await runContainedJourney(f.options);
                    expect(expired).toBe(true); expect(result.stop?.reason).toBe("verification-uncertain"); expect(f.requests).toHaveLength(0);
                    const history = await readValidatedContainedState(f.options.controllerDir);
                    expect(history.state.verificationAttempts).toHaveLength(1); expect(history.state.verificationAttempts![0]!.status).toBe("uncertain");
                } else {
                    const result = await runContainedDiscovery({ controllerDir: f.options.controllerDir, plan: f.options.plan, authority: f.options.authority, environment: f.options.environment, measure: ({ signal }) => waitForExpiry(signal) });
                    expect(expired).toBe(true); expect(result.status).toBe("uncertain"); expect(result.attempts).toBe(1);
                    expect(await readdir(join(f.options.controllerDir, ".wringer/discovery/attempts"))).toEqual(["000001"]);
                }
            } finally { clock.restore(); }
        }
    });
    const preflightEvent = (request: RoleExecutionRequest) => ({ type: "acp.prompt.preflight", at: new Date().toISOString(), role: request.role, sessionId: randomUUID(), credentialNames: ["FIXTURE_API_KEY"], methodAttempted: null, providerCredentialValidated: false, effectiveCredential: "not-attested", promptSent: false, words: `${request.role}-auth: ACP session opened. Effective provider credential and key validity remain unverified. No model prompt has yet been sent.` });
    const effectDirectory = async (controller: string, request: RoleExecutionRequest) => {
        const { signal: _signal, onEvent: _onEvent, ...retained } = request, root = join(controller, ".wringer/contained/effects");
        for (const id of await readdir(root)) if (hashValue(JSON.parse(await readFile(join(root, id, "request.json"), "utf8"))) === hashValue(retained)) return join(root, id);
        throw new Error("Fixture could not resolve the already reserved request");
    };
    test("before-prompt authentication observations are durable without a UI and bound to the effect", async () => {
        const f = await fixture(), execute = f.options.executeRole!; let simulatedPrompts = 0;
        f.options.executeRole = async request => {
            const event = preflightEvent(request), directory = await effectDirectory(f.options.controllerDir, request);
            await request.onEvent!(event);
            const receipt = JSON.parse(await readFile(join(directory, "preflight.json"), "utf8")), { sha256, ...body } = receipt;
            expect(receipt.event).toEqual(event); expect(receipt.sha256).toBe(hashValue(body));
            expect(receipt.effectId).toBe(directory.split("/").at(-1)); expect(receipt.event.providerCredentialValidated).toBe(false); expect(receipt.event.promptSent).toBe(false);
            const names = await readdir(join(f.options.controllerDir, ".wringer/contained/events")), anchor = JSON.parse(await readFile(join(f.options.controllerDir, ".wringer/contained/events", names.sort().at(-1)!), "utf8"));
            expect(anchor.type).toBe("agent-preflight-recorded"); expect(anchor.details.receiptSha256).toBe(sha256);
            simulatedPrompts++;
            return { ...await execute(request), sessionId: event.sessionId };
        };
        expect((await runContainedJourney(f.options)).status).toBe("review-ready"); expect(simulatedPrompts).toBe(2);
        const history = await readValidatedContainedState(f.options.controllerDir);
        expect(history.events.filter(e => e.type === "agent-preflight-recorded")).toHaveLength(2);
        const path = join(f.options.controllerDir, ".wringer/contained/effects", history.state.effects[0]!.id, "preflight.json"), receipt = JSON.parse(await readFile(path, "utf8"));
        receipt.event.words = "Altered claim"; await writeFile(path, JSON.stringify(receipt));
        await expect(readValidatedContainedState(f.options.controllerDir)).rejects.toThrow("preflight receipt");
    });
    test("preflight persistence failures stop before a simulated prompt rather than being swallowed as observer errors", async () => {
        const f = await fixture(); let simulatedPrompts = 0;
        f.options.executeRole = async request => {
            const directory = await effectDirectory(f.options.controllerDir, request);
            await mkdir(join(directory, "preflight.json")); // A precise local persistence failure, not a live agent.
            await request.onEvent!(preflightEvent(request));
            simulatedPrompts++;
            throw new Error("Unreachable simulated prompt");
        };
        const result = await runContainedJourney(f.options);
        expect(result.stop?.reason).toBe("effect-uncertain"); expect(simulatedPrompts).toBe(0); expect(result.sessions).toBe(1);
        expect((await readValidatedContainedState(f.options.controllerDir)).events.some(e => e.type === "agent-preflight-recorded")).toBe(false);
    });
    test("a preflight receipt survives interrupted execution and resuming never invents a successful prompt", async () => {
        const f = await fixture(); let starts = 0;
        f.options.executeRole = async request => { starts++; await request.onEvent!(preflightEvent(request)); throw new Error("Fixture interrupted before final reply"); };
        expect((await runContainedJourney(f.options)).stop?.reason).toBe("effect-uncertain");
        const history = await readValidatedContainedState(f.options.controllerDir), effect = history.state.effects[0]!;
        expect(effect.status).toBe("uncertain");
        const path = join(f.options.controllerDir, ".wringer/contained/effects", effect.id, "preflight.json"), before = await readFile(path, "utf8");
        expect((await runContainedJourney(f.options)).stop?.reason).toBe("effect-uncertain"); expect(starts).toBe(1); expect(await readFile(path, "utf8")).toBe(before);
    });
    test("optional progress-view failure cannot prevent an already retained preflight from reaching its prompt", async () => {
        const f = await fixture(), execute = f.options.executeRole!;
        f.options.onEvent = async () => { throw new Error("Disconnected optional view"); };
        f.options.executeRole = async request => { const event = preflightEvent(request); await request.onEvent!(event); return { ...await execute(request), sessionId: event.sessionId }; };
        expect((await runContainedJourney(f.options)).status).toBe("review-ready");
        expect((await readValidatedContainedState(f.options.controllerDir)).events.filter(e => e.type === "agent-preflight-recorded")).toHaveLength(2);
    });
    test("synthetic executors that emit no authentication observation receive no fabricated preflight receipt", async () => {
        const f = await fixture(); await runContainedJourney(f.options);
        const history = await readValidatedContainedState(f.options.controllerDir);
        expect(history.events.some(e => e.type === "agent-preflight-recorded")).toBe(false);
        for (const effect of history.state.effects) expect(await readdir(join(f.options.controllerDir, ".wringer/contained/effects", effect.id))).not.toContain("preflight.json");
    });
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
    test("known unavailable verification requires explicit new attempt and keeps both receipts", async () => {
        for (const phase of ["baseline", "candidate"] as const) {
            const f = await fixture(), verify = f.options.services.verifyCandidate;
            let unavailable = true;
            f.options.services.verifyCandidate = async request => {
                const result = await verify(request);
                if (request.phase !== phase || !unavailable) return result;
                unavailable = false;
                return { ...result, status: "unavailable", checks: result.checks.map(c => ({ ...c, status: "unavailable", exitCode: null })) };
            };
            const first = await runContainedJourney(f.options);
            expect(first.stop?.reason).toBe(phase === "baseline" ? "baseline-unavailable" : "verification-unavailable");
            expect(first.stop?.next_move).toContain("--retry-verification");
            const calls = f.serviceCalls.filter(c => c.kind === phase).length;
            await runContainedJourney(f.options);
            expect(f.serviceCalls.filter(c => c.kind === phase)).toHaveLength(calls);
            expect((await runContainedJourney({ ...f.options, retryVerification: true })).status).toBe("review-ready");
            const history = await readValidatedContainedState(f.options.controllerDir);
            const attempts = history.state.verificationAttempts!.filter(a => a.phase === phase);
            expect(attempts.map(a => a.disposition)).toEqual(["unavailable", phase === "baseline" ? "failed" : "passed"]);
            expect(attempts[0]!.id).not.toBe(attempts[1]!.id);
            expect(f.requests.filter(r => r.role === "worker")).toHaveLength(1);
        }
    });
    test("uncertain verifier is reserved before execution and ordinary resume reconciles only", async () => {
        const f = await fixture(), verify = f.options.services.verifyCandidate;
        let carried: CandidateVerification | null = null, fail = true;
        f.options.services.verifyCandidate = async request => {
            const history = await queryContainedJourney(f.options.controllerDir);
            expect(history.budget.verificationAttempts.unknown).toBe(1);
            const result = await verify(request);
            if (fail) { fail = false; carried = result; throw new Error("Lost response after durable supervisor observation"); }
            return result;
        };
        expect((await runContainedJourney(f.options)).stop?.reason).toBe("verification-uncertain");
        expect((await runContainedJourney(f.options)).stop?.reason).toBe("verification-uncertain");
        expect(f.serviceCalls.filter(c => c.kind === "baseline")).toHaveLength(1);
        f.options.services.reconcileVerification = async () => carried;
        expect((await runContainedJourney(f.options)).status).toBe("review-ready");
        expect(f.serviceCalls.filter(c => c.kind === "baseline")).toHaveLength(1);
        expect((await readValidatedContainedState(f.options.controllerDir)).state.verificationAttempts).toHaveLength(2);
    });
    test("verification retry ceiling includes previous failures and uncertainty", async () => {
        const f = await fixture(), verify = f.options.services.verifyCandidate;
        f.options.authority = { ...f.options.authority, budget: { ...f.options.authority.budget, max_sessions: 1 } };
        f.options.services.verifyCandidate = async request => {
            const result = await verify(request);
            return { ...result, status: "unavailable", checks: result.checks.map(c => ({ ...c, status: "unavailable", exitCode: null })) };
        };
        await runContainedJourney(f.options);
        expect((await runContainedJourney({ ...f.options, retryVerification: true })).stop?.reason).toBe("verification-budget-exhausted");
        expect(f.requests).toHaveLength(0);
        expect(f.serviceCalls.filter(c => c.kind === "baseline")).toHaveLength(1);
        expect((await queryContainedJourney(f.options.controllerDir)).budget.verificationAttempts).toEqual({ reserved: 1, ceiling: 1, unknown: 0 });
    });
    test("completed judge with null criterion is unsettled and retry is bounded and explicit", async () => {
        const f = await fixture(), execute = f.options.executeRole!;
        let unsettled = true;
        f.options.executeRole = async request => {
            const result = await execute(request);
            if (request.role === "judge" && unsettled) {
                unsettled = false;
                const reply = JSON.parse(result.text);
                reply.criteria[0].met = null;
                return { ...result, text: JSON.stringify(reply) };
            }
            return result;
        };
        expect((await runContainedJourney(f.options)).stop?.reason).toBe("judge-unsettled");
        const query = await queryContainedJourney(f.options.controllerDir);
        expect(query.effects.at(-1)).toMatchObject({ role: "judge", transport: "completed", disposition: "unsettled" });
        expect(query.actions.find(a => a.id === "retry-judge")?.enabled).toBe(true);
        await runContainedJourney({ ...f.options, retryStopped: true });
        expect(f.requests).toHaveLength(2);
        expect((await runContainedJourney({ ...f.options, retryJudge: true })).status).toBe("review-ready");
        const state = await readValidatedContainedState(f.options.controllerDir);
        expect(state.state.effects.filter(e => e.role === "judge").map(e => e.disposition)).toEqual(["unsettled", "accepted"]);
        expect(f.requests.filter(r => r.role === "worker")).toHaveLength(1);
    });
    test("review revision binds current state, preserves feedback and uses a new bounded worker", async () => {
        const f = await fixture();
        const first = await runContainedJourney(f.options), query = await queryContainedJourney(f.options.controllerDir);
        await expect(requestContainedRevision(f.options.controllerDir, { feedback: "The result misses this case", by: "Reviewer", expectedRevision: "0".repeat(64), expectedCandidateTree: first.candidate!.tree })).rejects.toThrow("revision changed");
        expect((await queryContainedJourney(f.options.controllerDir)).revision).toBe(query.revision);
        const revised = await requestContainedRevision(f.options.controllerDir, { feedback: "Keep the first result but make the error useful", by: "Reviewer", expectedRevision: query.revision, expectedCandidateTree: first.candidate!.tree });
        expect(revised.stop?.reason).toBe("revision-requested");
        expect(revised.verification).toBeNull();
        await expect(runContainedJourney({ ...f.options, expectedRevision: query.revision })).rejects.toThrow("revision changed");
        expect(f.requests).toHaveLength(2);
        const ready = await runContainedJourney(f.options);
        expect(ready.status).toBe("review-ready");
        expect(ready.candidate!.tree).not.toBe(first.candidate!.tree);
        expect(f.requests.filter(r => r.role === "worker")[1]!.prompt).toContain("make the error useful");
        const history = await readValidatedContainedState(f.options.controllerDir);
        expect(history.events.some(e => e.type === "revision-requested")).toBe(true);
        expect(history.state.verificationAttempts).toHaveLength(3);
    });
    test("command infrastructure exits cannot be accepted as red receipts", async () => {
        for (const exitCode of [124, 126, 127, 137, 143]) {
            const f = await fixture(), verify = f.options.services.verifyCandidate;
            f.options.services.verifyCandidate = async request => {
                const result = await verify(request);
                return { ...result, checks: result.checks.map(c => ({ ...c, exitCode })) };
            };
            expect((await runContainedJourney(f.options)).stop?.message).toContain("cannot establish a red");
            expect(f.requests).toHaveLength(0);
        }
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
    test("ACP planning returns an unapproved source-linked proposal and never starts workers", async () => {
        const f = await fixture({ planner: true }), request = planningRequestFromPlan(f.options.plan, f.options.plan.intent);
        const authority = createPlanningAuthority(request, { actor: "Planning operator", expiresAt: new Date(Date.now() + 3600000).toISOString() });
        expect(() => validatePlanningAuthority(authority, request, new Date(NaN))).toThrow("authority is invalid");
        const options = { controllerDir: f.options.controllerDir, request, authority, source: request.repository, executeRole: async (r: RoleExecutionRequest) => ({ ...await f.options.executeRole!(r), text: JSON.stringify({ acceptance: f.options.plan.acceptance, questions: [], note: "Existing check sources inspected by fixture planner" }) }) };
        const proposal = await proposeContainedPlan(options);
        expect(proposal.status).toBe("proposal");
        expect(proposal.approved).toBe(false);
        expect(proposal.plan!.intent).toBe(request.intent);
        expect(proposal.plan!.runtime).toEqual(request.runtime);
        expect(proposal.plan!.scope).toEqual(request.scope);
        expect(f.requests.map(r => r.role)).toEqual(["planner"]);
        expect((await proposeContainedPlan(options)).plan!.plan_sha256).toBe(proposal.plan!.plan_sha256);
        expect(f.requests).toHaveLength(1);
        await expect(proposeContainedPlan({ ...options, authority: { ...authority, actions: ["build"] as any } })).rejects.toThrow();
    });
    test("a local-only planning request proposes a v4 plan through a contained planner turn and refuses a hosted runtime receipt", async () => {
        const f = await fixture({ planner: true, local: true }), request = planningRequestFromPlan(f.options.plan, f.options.plan.intent);
        const authority = createPlanningAuthority(request, { actor: "Planning operator", expiresAt: new Date(Date.now() + 3600000).toISOString() });
        const reply = async (r: RoleExecutionRequest) => ({ ...await f.options.executeRole!(r), text: JSON.stringify({ acceptance: f.options.plan.acceptance, questions: [], note: "Local-only source inspected by fixture planner" }) });
        const proposal = await proposeContainedPlan({ controllerDir: f.options.controllerDir, request, authority, source: request.repository, executeRole: reply });
        expect(request.schema_version).toBe("wringer.planning-request.v4");
        expect(proposal.status).toBe("proposal");
        expect(proposal.approved).toBe(false);
        expect(proposal.plan!.schema_version).toBe("wringer.execution-plan.v4");
        expect(proposal.plan!.repository).toEqual(request.repository);
        expect(f.requests.map(r => [r.role, r.repo.url])).toEqual([["planner", `local://${"a".repeat(40)}`]]);
        // The same turn with a hosted runtime receipt: the planner boundary refuses to mix source kinds, and nothing is proposed.
        const hostedReceipt = await proposeContainedPlan({ controllerDir: await mkdtemp(join(tmpdir(), "wringer-contained-")), request, authority, source: request.repository, executeRole: async r => { const result = await reply(r); return { ...result, provenance: { ...result.provenance!, schema_version: "wringer.runtime.v1" } }; } });
        expect(hostedReceipt.status).toBe("stopped");
        expect(hostedReceipt.plan).toBeNull();
        expect(hostedReceipt.stopReason).toBe("planner-boundary-unestablished: no accepted contained ACP result");
    });
    test("planning rejects self-approval/policy changes and does not replay uncertain sessions", async () => {
        for (const failure of ["policy", "uncertain"] as const) {
            const f = await fixture({ planner: true }), request = planningRequestFromPlan(f.options.plan, f.options.plan.intent), authority = createPlanningAuthority(request, { actor: "Fixture", expiresAt: new Date(Date.now() + 3600000).toISOString() });
            let calls = 0;
            const options = { controllerDir: f.options.controllerDir, request, authority, source: request.repository, executeRole: async (r: RoleExecutionRequest) => {
                calls++;
                if (failure === "uncertain") throw new Error("Connection lost after possible spend");
                return { ...await f.options.executeRole!(r), text: JSON.stringify({ acceptance: f.options.plan.acceptance, questions: [], note: "self-approved", approved: true, runtime: { kind: "local" } }) };
            } };
            const stopped = await proposeContainedPlan(options);
            expect(stopped.status).toBe("stopped");
            expect(stopped.plan).toBeNull();
            expect(stopped.stopReason).toContain(failure === "policy" ? "invalid-reply" : "uncertain");
            await proposeContainedPlan(options);
            expect(calls).toBe(1);
            await expect(proposeContainedPlan({ ...options, retryUncertain: true, retryStopped: true })).rejects.toThrow("Choose one eligible retry flag");
            expect((await proposeContainedPlan({ ...options, ...(failure === "uncertain" ? { retryUncertain: true } : { retryStopped: true }) })).stopReason).toContain("budget-exhausted");
            expect(calls).toBe(1);
        }
    });
    test("planning questions remain a genuine decision, not an invented acceptance contract", async () => {
        const f = await fixture({ planner: true }), request = planningRequestFromPlan(f.options.plan, f.options.plan.intent), authority = createPlanningAuthority(request, { actor: "Fixture", expiresAt: new Date(Date.now() + 3600000).toISOString() });
        const result = await proposeContainedPlan({ controllerDir: f.options.controllerDir, request, authority, source: request.repository, executeRole: async r => ({ ...await f.options.executeRole!(r), text: JSON.stringify({ questions: ["The acceptance check file is absent; approve its creation first."], note: "No imaginary check path was proposed" }) }) });
        expect(result.status).toBe("needs-decision");
        expect(result.questions).toHaveLength(1);
        expect(result.plan).toBeNull();
        expect(result.approved).toBe(false);
    });
    test("discovery measures declared versions once and charges its preparation wall clock", async () => {
        const f = await fixture();
        let calls = 0;
        const observations = f.options.plan.environment.tools.map(t => ({ kind: "tool" as const, id: t.name, status: "passed" as const, exit_code: 0, output: t.version + "\n", source_commit: f.options.plan.repository.commit, runtime_id: "fixture-discovery", image: f.options.plan.runtime.image, command_sha256: hashValue(t.probe) }));
        const options = { controllerDir: f.options.controllerDir, plan: f.options.plan, authority: f.options.authority, environment: f.options.environment, measure: async () => { calls++; return { observations, preparation: { status: "passed" as const } }; } };
        expect(environmentReadiness(options.environment, options.plan).ready).toBe(false);
        const first = await runContainedDiscovery(options);
        expect(first.status).toBe("measured");
        expect(environmentReadiness(first.environment, options.plan).ready).toBe(true);
        expect((await runContainedDiscovery(options)).environment.map_sha256).toBe(first.environment.map_sha256);
        expect(calls).toBe(1);
        expect((await runContainedJourney({ ...f.options, environment: first.environment })).status).toBe("review-ready");
        expect((await readValidatedContainedState(f.options.controllerDir)).state.startedAt).toBe(first.startedAt);
        expect(() => ingestEnvironmentObservations(options.environment, options.plan, [{ ...observations[0]!, source_commit: "0".repeat(40) }])).toThrow("exact source");
    });
    test("discovery retains unavailable and uncertain attempts and never silently retries", async () => {
        const f = await fixture();
        let calls = 0;
        const rows = f.options.plan.environment.tools.map(t => ({ kind: "tool" as const, id: t.name, status: "passed" as const, exit_code: 0, output: "wrong version", source_commit: f.options.plan.repository.commit, runtime_id: "fixture-discovery", image: f.options.plan.runtime.image, command_sha256: hashValue(t.probe) }));
        const options = { controllerDir: f.options.controllerDir, plan: f.options.plan, authority: f.options.authority, environment: f.options.environment, measure: async () => { calls++; return { observations: rows, preparation: { status: "passed" as const } }; } };
        expect((await runContainedDiscovery(options)).status).toBe("unavailable");
        await runContainedDiscovery(options);
        expect(calls).toBe(1);
        options.measure = async () => { calls++; throw new Error("Lost verifier transport"); };
        expect((await runContainedDiscovery({ ...options, retryUnavailable: true })).status).toBe("uncertain");
        expect((await runContainedDiscovery(options)).status).toBe("uncertain");
        expect(calls).toBe(2);
        const result = await runContainedDiscovery({ ...options, reconcile: async () => ({ observations: rows.map(r => ({ ...r, output: f.options.plan.environment.tools.find(t => t.name === r.id)!.version })), preparation: { status: "passed" } }) });
        expect(result.status).toBe("measured");
        expect(result.attempts).toBe(2);
        expect(calls).toBe(2);
    });
});
