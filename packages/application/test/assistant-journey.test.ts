import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDeclaration, compileExecutionPlan, hashBytes, hashValue, type EnvironmentMap } from "@wringer/plan";
import { runContainedJourney, requestContainedRevision, readValidatedContainedState, queryContainedJourney, type CandidateVerification, type ContainedJourneyOptions } from "@wringer/workflow";
import type { RoleExecutionResult } from "@wringer/runtime";
import { initializeAssistant, issueAssistantCapability, approveAssistantProposal, createAssistantService, assistantControllerState } from "../src/assistant";
import { queueWorkspaceCommand } from "../src/commands";
import { readPmWorkspace } from "../../cli/src/workspace";
import { createMcpSession } from "../../mcp/src/server";

// Integration proof is the real MCP contract/application queue/domain journal
// and PM readers. Role, source and verifier observations are synthetic fixtures;
// this is not a live provider, container, client-app or genuine PM blind test.
const roots: string[] = [], services: Awaited<ReturnType<typeof createAssistantService>>[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.runner.stop(100); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
async function fixture(settings: { authRejected?: boolean; plannerQuestion?: boolean; loseStartResponse?: boolean; uncertainWorker?: boolean } = {}) {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-assistant-journal-"))); roots.push(root);
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = structuredClone(compileExecutionPlan(template, { format: "yaml" }));
    raw.intent += " The display is readable.";
    raw.repository = { url: "https://example.invalid/assistant-journal-fixture.git", commit: "a".repeat(40) };
    raw.runtime.env = []; raw.agents.worker.env = []; raw.agents.judge.env = [];
    raw.budget.max_worker_turns = 2; raw.budget.max_judge_turns = 2;
    if (settings.plannerQuestion) { raw.agents.planner = raw.agents.judge; raw.budget.max_planner_turns = 1; }
    raw.acceptance.criteria.push({ id: "readable", title: "Readable result", quote: "The display is readable.", kind: "human", required: true, show: { id: "show-readable", argv: ["bun", "run", "demo"], cwd: ".", timeout_seconds: 30 } });
    const plan = compileDeclaration({ version: 1, ...raw }), files = ["README.md", ...plan.acceptance.checks.flatMap(c => c.files)].map(path => ({ path, mode: "100644", blob: "f".repeat(40) }));
    const data: Omit<EnvironmentMap, "map_sha256"> = { schema_version: "wringer.environment-map.v1", repository: plan.repository, plan_sha256: plan.plan_sha256, source_tree: "a".repeat(40), inventory_sha256: hashValue(files), files, context: [{ path: "README.md", blob: "f".repeat(40), text: "Synthetic fixture", sha256: hashBytes("Synthetic fixture") }], components: [], tools: plan.environment.tools.map(t => ({ ...t, observation: null })), baseline: plan.environment.baseline.map(declaration => ({ declaration, observation: null })), protected_paths: plan.acceptance.protected_paths, writable_paths: plan.scope.writable, limits: ["Synthetic roles/checks/source; no real model or containment observation"] };
    const environment = { ...data, map_sha256: hashValue(data) }, turns: { role: string; runtimeId: string }[] = [];
    let worker = 0, journey: ContainedJourneyOptions;
    const candidate = () => settings.authRejected ? { source: plan.repository, tree: environment.source_tree, changedPaths: [] } : { source: { ...plan.repository, commit: worker.toString().padStart(40, "b") }, tree: worker.toString().padStart(40, "c"), changedPaths: ["src/value.ts"] };
    const workspace = (await initializeAssistant(root, { plan, cooperativeLocal: true })).workspace;
    const capability = await issueAssistantCapability(root, new Date(Date.now() + 60000).toISOString());
    const service = await createAssistantService(root, { dependencies: {
        start: async (state, accepted, authority, options) => {
            await mkdir(state, { recursive: true }); await writeFile(join(state, "plan.json"), JSON.stringify(accepted)); await writeFile(join(state, "authority.json"), JSON.stringify(authority));
            journey = { controllerDir: state, plan: accepted, authority, environment, signal: options?.signal,
                services: {
                    prepareSource: async source => source,
                    captureCandidate: async () => candidate(),
                    verifyCandidate: async request => {
                        const status = request.phase === "baseline" ? "failed" : "passed";
                        return { schema_version: "wringer.contained-verification.v1", status, candidateCommit: request.source.commit, candidateTree: request.phase === "baseline" ? environment.source_tree : candidate().tree, acceptanceSha256: accepted.acceptance_sha256, runtimeId: crypto.randomUUID(), image: accepted.runtime.image, checks: accepted.acceptance.checks.map(c => ({ id: c.id, status, exitCode: status === "failed" ? 1 : 0, checkInputsSha256: "d".repeat(64), outputSha256: "e".repeat(64) })), regressions: accepted.environment.baseline.map(c => ({ id: c.id, status: "passed", exitCode: 0, outputSha256: "e".repeat(64) })), evidenceRef: `synthetic-fixture/${request.effectId}` } as CandidateVerification;
                    },
                },
                executeRole: async request => {
                    const runtimeId = crypto.randomUUID(); turns.push({ role: request.role, runtimeId }); if (request.role === "worker") worker++;
                    if (request.role === "worker" && settings.uncertainWorker) throw new Error("Fixture lost worker response after possible spend");
                    const reply = request.role === "worker" ? settings.authRejected ? 'unexpected status 401 Unauthorized: {"error":{"message":"Incorrect API key provided: [REDACTED]","type":"invalid_request_error","code":"invalid_api_key"}}, url: https://api.openai.com/v1/responses' : "Synthetic changed source" : request.role === "planner" ? JSON.stringify({ omissions: [], questions: ["Which exact result should be displayed?"], note: "I cannot decide this product choice for you." }) : JSON.stringify({ criteria: accepted.acceptance.criteria.filter(c => c.kind === "check").map(c => ({ id: c.id, met: true, reason: "Synthetic independent review" })), note: "Synthetic fixture only" });
                    return { status: "completed", text: request.role === "worker" ? reply : `Fixture preface.\n\n\`\`\`json\n${reply}\n\`\`\``, sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: { schema_version: "wringer.runtime.v1", runtimeId, role: request.role, kind: request.runtime.kind, image: request.runtime.image, repository: request.repo, clonedInside: true, hostMounts: [], repositoryAccess: request.role === "worker" ? "read-write" : "read-only", declared: request.runtime, observed: { fixture: true }, limits: ["Synthetic only"] } } as RoleExecutionResult;
                },
            };
            const result = await runContainedJourney(journey);
            if (settings.loseStartResponse) throw new Error("Fixture lost start response after durable domain stop");
            return result;
        },
        queueCommand: (state, input, options) => queueWorkspaceCommand(state, input, options, { execute: async (_state, command) => {
            if (command.action !== "request-revision") throw new Error("Fixture accepts correction only");
            await requestContainedRevision(state, { expectedRevision: command.expectedRevision, expectedCandidateTree: command.expectedCandidateTree, by: String(command.payload.by), feedback: String(command.payload.note) });
            return runContainedJourney({ ...journey, signal: options?.signal });
        } }),
    } }); services.push(service);
    let sequence = 0;
    async function connection() {
        const session = createMcpSession({ version: "fixture", call: (name, args) => service.call(capability.token, name, args) });
        await session.receive(JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fixture-client-not-Codex", version: "fixture" } } }));
        await session.receive(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
        return async (name: string, args: unknown): Promise<any> => {
            const result = await session.receive(JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method: "tools/call", params: { name: `wringer.${name}`, arguments: args } }));
            if (result && "error" in result) return { outcome: "refused", rpcError: result.error };
            if (!result) throw new Error("Fixture MCP returned no response");
            return result.result.structuredContent;
        };
    }
    const call = await connection(), proposed = await call("propose", { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), intent: plan.intent, plan });
    expect(proposed.outcome).toBe("awaiting-approval");
    const approval = await call("get_approval_request", { jobId: proposed.jobId });
    await approveAssistantProposal(root, { jobId: proposed.jobId, expectedRevision: approval.revision, actor: "Synthetic fixture operator (not a human verdict)", expiresAt: new Date(Date.now() + 60000).toISOString(), confirmExecution: true });
    const view = await call("get_status", { jobId: proposed.jobId }), operationId = crypto.randomUUID(), request = { jobId: proposed.jobId, idempotencyKey: operationId, expectedRevision: view.revision, expectedCandidateTree: view.candidateTree };
    expect((await call("start", request)).outcome).toBe("accepted");
    await service.runner.start();
    const settle = async (id: string) => { for (let n = 0; n < 500; n++) { const operation = await service.runner.read(id); if (["completed", "failed", "uncertain"].includes(operation.status)) return operation; await Bun.sleep(5); } throw new Error("Fixture journal did not settle"); };
    expect((await settle(operationId)).status).toBe(settings.loseStartResponse ? "uncertain" : "completed");
    return { root, service, connection, call, plan, jobId: proposed.jobId as string, request, operationId, turns, state: assistantControllerState(root, proposed.jobId), settle };
}

test("MCP->application->real journal reaches human hold and agrees with the PM workspace", async () => {
    const f = await fixture(), assistant = await f.call("get_status", { jobId: f.jobId }), board = await readPmWorkspace(f.state), history = await readValidatedContainedState(f.state);
    expect(assistant.outcome).toBe("human-hold"); expect(assistant.stage).toBe(board.stage); expect(assistant.revision).toBe(board.revision); expect(assistant.candidateTree).toBe(board.candidate!.tree);
    expect(board.checks.every(c => c.before.status === "failed" && c.after.status === "passed")).toBe(true);
    expect(board.criteria.find(c => c.id === "total")?.state).toBe("met"); expect(board.criteria.find(c => c.id === "readable")?.state).toBe("unknown");
    expect(history.result.humanJudgements).toEqual([]); expect(f.turns.map(t => t.role)).toEqual(["worker", "judge"]); expect(new Set(f.turns.map(t => t.runtimeId)).size).toBe(2);
    expect(assistant.usage.development.measured.sessions.reserved).toBe(board.usage.sessions); expect(assistant.usage.development.measured.tokens.input).toBeNull(); expect(board.usage.inputTokens).toBeNull();
    expect(assistant.usage.codingApp.cost).toBeNull(); expect(assistant.usage.development.cost).toBeNull(); expect(board.usage.costUsd).toBeNull();
    for (const name of ["record_human_verdict", "publish", "increase_budget"]) expect((await f.call(name, { jobId: f.jobId })).outcome).toBe("refused");
    const reconnected = await f.connection(); expect((await reconnected("start", f.request)).outcome).toBe("completed");
    expect(f.turns).toHaveLength(2); expect((await readValidatedContainedState(f.state)).result.humanJudgements).toEqual([]);
});
test("assistant correction uses real command/journal records and the original aggregate ceilings", async () => {
    const f = await fixture(), before = await f.call("get_status", { jobId: f.jobId }), note = "The result is still hard to understand.\nKeep this exact feedback; I have not accepted it.", id = crypto.randomUUID();
    expect(before.actions.find((a: any) => a.action === "request-revision")?.enabled).toBe(true);
    const input = { jobId: f.jobId, idempotencyKey: id, expectedRevision: before.revision, expectedCandidateTree: before.candidateTree, note };
    expect((await f.call("request_revision", input)).outcome).toBe("accepted"); expect((await f.settle(id)).status).toBe("completed");
    const after = await f.call("get_status", { jobId: f.jobId }), history = await readValidatedContainedState(f.state), board = await readPmWorkspace(f.state);
    expect(after.outcome).toBe("human-hold"); expect(after.candidateTree).not.toBe(before.candidateTree); expect(after.revision).toBe(board.revision);
    expect(after.usage.development.measured.sessions.reserved).toBe(4); expect(after.usage.development.limits).toEqual(before.usage.development.limits);
    expect((history.events.find(e => e.type === "revision-requested")?.details as any).feedback).toBe(note);
    expect(history.result.humanJudgements).toEqual([]); expect(f.turns.map(t => t.role)).toEqual(["worker", "judge", "worker", "judge"]);
    expect((await f.call("request_revision", input)).outcome).toBe("completed"); expect(f.turns).toHaveLength(4);
    expect(after.actions.find((a: any) => a.action === "request-revision")?.enabled).toBe(false);
});
test("provider rejection is one paid-role reservation, not successful work or automatic retry", async () => {
    const f = await fixture({ authRejected: true }), assistant = await f.call("get_status", { jobId: f.jobId }), board = await readPmWorkspace(f.state);
    expect(assistant.outcome).toBe("stopped"); expect(assistant.stop.reason).toBe("worker-auth-rejected"); expect(board.stop?.reason).toBe(assistant.stop.reason);
    expect(assistant.usage.development.measured.sessions.reserved).toBe(1); expect(f.turns.map(t => t.role)).toEqual(["worker"]);
    expect(assistant.actions.find((a: any) => a.action === "resume")?.enabled).toBe(false);
    const refusal = await f.call("continue", { jobId: f.jobId, idempotencyKey: crypto.randomUUID(), expectedRevision: assistant.revision, expectedCandidateTree: assistant.candidateTree, action: "resume" });
    expect(refusal.outcome).toBe("refused"); expect(f.turns).toHaveLength(1); expect((await queryContainedJourney(f.state)).budget.sessions.reserved).toBe(1);
});
test("contained planner questions and original note reach the assistant without inventing a PM decision", async () => {
    const f = await fixture({ plannerQuestion: true }), view = await f.call("get_status", { jobId: f.jobId });
    expect(view.outcome).toBe("stopped"); expect(view.stop.reason).toBe("intent-needs-decision");
    expect(view.stop.message).toContain("Which exact result should be displayed?"); expect(view.stop.message).toContain("I cannot decide this product choice for you.");
    expect(f.turns.map(t => t.role)).toEqual(["planner"]); expect(view.actions.every((a: any) => !a.enabled)).toBe(true);
    expect((await readValidatedContainedState(f.state)).result.humanJudgements).toEqual([]);
});
test("operator reconciliation derives a completed domain outcome without replaying the lost response", async () => {
    const f = await fixture({ loseStartResponse: true }), before = await queryContainedJourney(f.state);
    expect((await f.call("get_status", { jobId: f.jobId })).outcome).toBe("uncertain");
    expect((await f.call("reconcile", { jobId: f.jobId, operationId: f.operationId, acknowledgeUncertain: true })).outcome).toBe("refused");
    await expect(f.service.reconcile(f.jobId, f.operationId, false)).rejects.toThrow("Acknowledge");
    const original = await readFile(join(f.root, "runner", "requests", f.operationId, "outcome.json"), "utf8");
    const reconciled = await f.service.reconcile(f.jobId, f.operationId, true);
    expect(reconciled.status).toBe("completed"); expect(reconciled.reconciliation?.priorStatus).toBe("uncertain");
    expect(await readFile(join(f.root, "runner", "requests", f.operationId, "outcome.json"), "utf8")).toBe(original);
    const status = await f.call("get_status", { jobId: f.jobId });
    expect(status.outcome).toBe("human-hold"); expect(status.usage.development.measured.sessions.reserved).toBe(before.budget.sessions.reserved);
    expect(status.usage.development.cost).toBeNull(); expect((await f.call("start", f.request)).outcome).toBe("completed"); expect(f.turns).toHaveLength(2);
});
test("unknown domain spend prevents operator reconciliation and keeps the original reservation", async () => {
    const f = await fixture({ loseStartResponse: true, uncertainWorker: true });
    await expect(f.service.reconcile(f.jobId, f.operationId, true)).rejects.toThrow("unknown or unfinished effect");
    expect((await f.service.runner.read(f.operationId)).status).toBe("uncertain");
    const status = await f.call("get_status", { jobId: f.jobId });
    expect(status.uncertainty).toBe(true); expect(status.usage.development.measured.sessions.reserved).toBe(1); expect(f.turns).toHaveLength(1);
});
