import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, readFile, writeFile, mkdir, rm, chmod, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileExecutionPlan, compileDeclaration, hashValue, type ExecutionPlan } from "@wringer/plan";
import type { ContainedJourneyResult } from "@wringer/workflow";
import { initializeAssistant, issueAssistantCapability, revokeAssistantCapabilities, createAssistantService, approveAssistantProposal, type AssistantDependencies } from "../src/assistant";
import { createAssistantDirectory, writeAssistantRecord, readAssistantRecord } from "../src/assistant-store";
import { parseWorkspaceCommand } from "../src/commands";

const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
const directories: string[] = [], services: Awaited<ReturnType<typeof createAssistantService>>[] = [];
afterEach(async () => {
    for (const service of services.splice(0)) { try { await service.runner.stop(50); } catch {} }
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function scratch() { const directory = await realpath(await mkdtemp(join(tmpdir(), "wringer-assistant-service-"))); directories.push(directory); return directory; }
function plan() { return compileExecutionPlan(template, { format: "yaml" }); }
function declaration(profile: ExecutionPlan) {
    const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...value } = structuredClone(profile);
    return { version: 1, ...value };
}
async function until<T>(read: () => Promise<T>, test: (value: T) => boolean): Promise<T> {
    for (let n = 0; n < 500; n++) { const value = await read(); if (test(value)) return value; await Bun.sleep(5); }
    throw new Error("Synthetic application fixture did not settle");
}
async function fixture(settings: { profile?: ExecutionPlan; startJournal?: boolean; expiresAt?: string; destination?: Record<string, unknown> } = {}) {
    const root = await scratch(), profile = settings.profile ?? plan();
    const workspace = (await initializeAssistant(root, { plan: profile, cooperativeLocal: true, destination: settings.destination })).workspace;
    const capability = await issueAssistantCapability(root, settings.expiresAt ?? new Date(Date.now() + 60000).toISOString());
    const counters = { starts: 0, commands: 0, status: 0, publications: 0 };
    const result: ContainedJourneyResult = { schema_version: "wringer.contained-journey-result.v1", journeyId: "synthetic-fixture", status: "stopped", candidate: null, verification: null, judge: null, stop: null, recordDir: "synthetic-fixture-only", sessions: 0, tokens: { input: null, output: null }, humanJudgements: [] };
    const query: any = { revision: "b".repeat(64), candidateTree: null, status: "stopped", stage: "worker", stop: { reason: "worker-auth-rejected", message: "Fixture provider rejected authentication. No repeated attempt was made." }, effects: [], actions: [ { id: "resume", enabled: false, reason: "A provider rejected authentication." }, { id: "request-revision", enabled: true, reason: "A correction is available under existing limits." }, { id: "deliver", enabled: true, reason: "Fixture handover can be prepared." } ], budget: { reserved: 1, remaining: 7 }, result };
    const dependencies: AssistantDependencies = {
        start: async state => {
            counters.starts++;
            if (settings.startJournal) {
                // Synthetic seam only. Real workflow readers are intentionally
                // replaced by the construction-time status dependency below.
                const sentinel = join(state, ".wringer/contained/plan.json"); await mkdir(dirname(sentinel), { recursive: true }); await writeFile(sentinel, "{}");
            }
            return { status: "stopped", candidate: null } as any;
        },
        status: async () => { counters.status++; return structuredClone(query); },
        queueCommand: async (_state, command) => { counters.commands++; query.revision = "d".repeat(64); return { commandId: parseWorkspaceCommand(command).idempotencyKey, status: "completed", result: { fixture: true } }; },
        readCommand: async (_state, id) => ({ commandId: id, status: "completed", result: { fixture: true } }),
        publication: async () => { counters.publications++; return null; },
    };
    const service = await createAssistantService(root, { dependencies }); services.push(service);
    const call = (name: string, args: unknown, token = capability.token) => service.call(token, `wringer.${name}`, args) as Promise<any>;
    const propose = (overrides: Record<string, unknown> = {}) => call("propose", { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), intent: profile.intent, plan: profile, ...overrides });
    const approve = async (jobId: string, expiresAt = new Date(Date.now() + 60000).toISOString()) => {
        const request = await call("get_approval_request", { jobId });
        return approveAssistantProposal(root, { jobId, expectedRevision: request.revision, actor: "Fixture operator", expiresAt, confirmExecution: true });
    };
    const mutation = async (jobId: string, extra: Record<string, unknown> = {}) => {
        const view = await call("get_status", { jobId });
        return { jobId, idempotencyKey: crypto.randomUUID(), expectedRevision: view.revision, expectedCandidateTree: view.candidateTree, ...extra };
    };
    return { root, profile, workspace, capability, service, counters, query, call, propose, approve, mutation };
}

describe("assistant application narrow authority and inert intake", () => {
    test("protected mode refuses; local preview must be explicit and private", async () => {
        const root = await scratch();
        await expect(initializeAssistant(root, { plan: plan(), cooperativeLocal: false })).rejects.toThrow("Protected assistant mode is not available");
        expect(await readdir(root)).toEqual([]);
        await chmod(root, 0o755); await expect(createAssistantDirectory(root)).rejects.toThrow("private directory");
    });
    test("wrong, revoked, expired and another workspace's capabilities fail closed", async () => {
        const a = await fixture(), b = await fixture();
        for (const token of ["", "../outside", "f".repeat(64), b.capability.token]) expect((await a.call("inspect_setup", {}, token)).code).toBe("capability-refused");
        expect((await a.call("inspect_setup", { workspaceId: b.workspace.id })).code).toBe("workspace-refused");
        const digest = hashValue(a.capability.token);
        await mkdir(join(b.root, "capabilities"), { recursive: true });
        await writeFile(join(b.root, "capabilities", `${digest}.json`), await readFile(join(a.root, "capabilities", `${digest}.json`)));
        expect((await b.call("inspect_setup", {}, a.capability.token)).code).toBe("capability-refused");
        await revokeAssistantCapabilities(a.root);
        expect((await a.call("inspect_setup", {})).code).toBe("capability-refused");
        const expiring = await issueAssistantCapability(b.root, new Date(Date.now() + 200).toISOString());
        expect((await b.call("inspect_setup", {}, expiring.token)).outcome).toBe("inspected");
        await Bun.sleep(220);
        expect((await b.call("inspect_setup", {}, expiring.token)).code).toBe("capability-refused");
        expect(a.counters.starts + b.counters.starts).toBe(0);
    });
    test("proposal questions, assumptions and original words survive repeated reads without a planner", async () => {
        const f = await fixture(), requestId = crypto.randomUUID(), intent = "Keep my words.\n  Including this spacing and my negative observation: this did not work.", questions = ["Which outcome do you want?", "Is \"not ready\" acceptable?"], assumptions = ["This is still a proposal, not approval."];
        const proposed = await f.propose({ idempotencyKey: requestId, intent, plan: null, questions, assumptions });
        expect(proposed.outcome).toBe("needs-decision"); expect(proposed.questions).toEqual(questions); expect(proposed.assumptions).toEqual(assumptions);
        const record = await f.call("get_approval_request", { jobId: proposed.jobId });
        expect(record.intent).toBe(intent); expect(record.plan).toBeNull();
        const evidence = await f.call("get_evidence", { jobId: proposed.jobId, evidenceId: "request" });
        expect(JSON.parse(evidence.content)).toEqual({ intent, questions, assumptions }); expect(evidence.untrustedContent).toBe(true);
        expect((await f.propose({ idempotencyKey: requestId, intent, plan: null, questions, assumptions })).jobId).toBe(proposed.jobId);
        expect((await f.propose({ idempotencyKey: requestId, intent: "Changed request", plan: null, questions, assumptions })).outcome).toBe("refused");
        await expect(f.approve(proposed.jobId)).rejects.toThrow("Resolve the proposal's questions");
        expect(f.counters).toEqual({ starts: 0, commands: 0, status: 0, publications: 0 });
    });
    test("profile pins source, runtime, agents, environment, budgets, scope and protected files", async () => {
        const f = await fixture();
        const changes: { alter: (p: ReturnType<typeof declaration>) => void; code: string }[] = [
            { alter: p => { p.repository.commit = "a".repeat(40); }, code: "profile-changed" },
            { alter: p => { p.repository.url = "https://example.org/other/repository.git"; }, code: "profile-changed" },
            { alter: p => { p.runtime.cpus++; }, code: "profile-changed" },
            { alter: p => { p.agents.worker.command = "other-agent"; }, code: "profile-changed" },
            { alter: p => { p.environment.context = []; }, code: "profile-changed" },
            { alter: p => { p.budget.max_sessions++; }, code: "budget-increase-refused" },
            { alter: p => { p.scope.writable = ["lib"]; }, code: "scope-increase-refused" },
            { alter: p => { p.acceptance.protected_paths = p.acceptance.protected_paths.filter(path => path !== "tests"); }, code: "protection-change-refused" },
        ];
        for (const row of changes) { const raw = declaration(f.profile); row.alter(raw); const result = await f.propose({ plan: compileDeclaration(raw) }); expect(result.code).toBe(row.code); }
        const reduced = declaration(f.profile); reduced.budget.max_sessions--; reduced.scope.writable = ["src/feature"];
        expect((await f.propose({ plan: reduced })).outcome).toBe("awaiting-approval");
        const intentChanged = declaration(f.profile); intentChanged.intent += " Also perform extra work.";
        expect((await f.propose({ plan: compileDeclaration(intentChanged) })).code).toBe("intent-mismatch");
        expect(f.counters.starts).toBe(0);
    });
    test("strict cash, arbitrary paths/commands and human/publication powers are not assistant tools", async () => {
        const f = await fixture(), proposed = await f.propose();
        expect((await f.call("propose", { workspaceId: f.workspace.id, strictCashLimit: { amount: 10, currency: "GBP" } })).code).toBe("strict-cash-unavailable");
        for (const name of ["publish", "record_human_verdict", "grant_authority", "increase_budget", "execute", "credentials"]) expect((await f.call(name, {})).code).toBe("forbidden-tool");
        for (const args of [{ jobId: proposed.jobId, controller: "/tmp/elsewhere" }, { jobId: proposed.jobId, execute: "touch /tmp/injected" }, { jobId: proposed.jobId, actor: "Marc", verdict: "met" }]) expect((await f.call("get_status", args)).code).toBe("unexpected-input");
        for (const args of [{ evidenceId: "../../keys" }, { evidenceId: "request", offset: -1 }, { evidenceId: "request", limit: 8193 }]) expect((await f.call("get_evidence", { jobId: proposed.jobId, ...args })).outcome).toBe("refused");
        expect(f.counters.starts).toBe(0); expect(f.counters.commands).toBe(0);
    });
    test("approval binds the exact revision, cannot answer questions, and does not itself start work", async () => {
        const f = await fixture(), proposed = await f.propose(), args = await f.mutation(proposed.jobId);
        expect((await f.call("start", args)).code).toBe("not-approved");
        await expect(approveAssistantProposal(f.root, { jobId: proposed.jobId, expectedRevision: "a".repeat(64), actor: "Fixture operator", expiresAt: new Date(Date.now() + 60000).toISOString(), confirmExecution: true })).rejects.toThrow("exact proposal revision");
        await expect(approveAssistantProposal(f.root, { jobId: proposed.jobId, expectedRevision: proposed.revision, actor: "Fixture operator", expiresAt: new Date(Date.now() + 60000).toISOString(), confirmExecution: false })).rejects.toThrow("exact proposal revision");
        const approved = await f.approve(proposed.jobId);
        expect(approved.authority.plan_sha256).toBe(f.profile.plan_sha256); expect(f.counters.starts).toBe(0);
        const repeated = await f.approve(proposed.jobId, new Date(Date.now() + 24 * 3600 * 1000).toISOString());
        expect(repeated.authority).toEqual(approved.authority);
        const request = await f.call("get_approval_request", { jobId: proposed.jobId });
        expect(request.outcome).toBe("already-approved"); expect(JSON.stringify(request)).not.toContain(f.capability.token);
    });
    test("read-only inspection and evidence consume no execution and preserve both unknown cost lanes", async () => {
        const f = await fixture(), proposed = await f.propose(); await f.approve(proposed.jobId);
        const before = await f.service.inspectProposal(proposed.jobId);
        for (let n = 0; n < 5; n++) {
            const status = await f.call("get_status", { jobId: proposed.jobId });
            expect(status.usage.codingApp.cost).toBeNull(); expect(status.usage.codingApp.tokens).toBeNull();
            expect(status.usage.development.cost).toBeNull(); expect(status.usage.development.measured).toBeNull();
            expect(status.usage.development.note).toContain("not a cash ceiling");
            await f.call("get_evidence", { jobId: proposed.jobId, evidenceId: "proposal", limit: 100 });
            await f.call("inspect_setup", {});
        }
        expect(await f.service.inspectProposal(proposed.jobId)).toEqual(before);
        expect(f.counters.starts).toBe(0); expect(f.counters.commands).toBe(0); expect(await f.service.runner.list()).toEqual([]);
    });
    test("a duplicate start after lost response and advanced revision observes the same operation", async () => {
        const f = await fixture({ startJournal: true }), proposed = await f.propose(); await f.approve(proposed.jobId);
        const input = await f.mutation(proposed.jobId);
        expect((await f.call("start", input)).outcome).toBe("accepted");
        await f.service.runner.start();
        await until(() => f.service.runner.read(input.idempotencyKey), x => x.status === "completed");
        const current = await f.call("get_status", { jobId: proposed.jobId }); expect(current.revision).not.toBe(input.expectedRevision);
        const retried = await f.call("start", input);
        expect(retried.outcome).toBe("completed"); expect(retried.operationId).toBe(input.idempotencyKey); expect(f.counters.starts).toBe(1);
        expect((await f.call("start", { ...input, expectedCandidateTree: "e".repeat(40) })).outcome).toBe("refused");
    });
    test("approval expiry while accepted but unclaimed refuses before effects, not as unknown spend", async () => {
        const f = await fixture(), proposed = await f.propose(); await f.approve(proposed.jobId, new Date(Date.now() + 200).toISOString());
        const input = await f.mutation(proposed.jobId); expect((await f.call("start", input)).outcome).toBe("accepted");
        await Bun.sleep(220); await f.service.runner.start();
        const operation = await until(() => f.service.runner.read(input.idempotencyKey), value => ["completed", "failed", "uncertain"].includes(value.status));
        expect(operation.status).toBe("failed"); expect(f.counters.starts).toBe(0);
        const status = await f.call("get_status", { jobId: proposed.jobId }); expect(status.actions.every((x: any) => !x.enabled)).toBe(true);
    });
    test("cancellation prevents accepted future dispatch and cannot mint another job approval", async () => {
        const f = await fixture(), proposed = await f.propose(); await f.approve(proposed.jobId);
        const start = await f.mutation(proposed.jobId); expect((await f.call("start", start)).outcome).toBe("accepted");
        const cancelled = await f.call("cancel", await f.mutation(proposed.jobId)); expect(cancelled.outcome).toBe("cancelled");
        await f.service.runner.start(); await Bun.sleep(30);
        expect((await f.service.runner.read(start.idempotencyKey)).status).toBe("cancelled"); expect(f.counters.starts).toBe(0);
        expect((await f.call("start", await f.mutation(proposed.jobId))).code).toBe("cancelled");
        const other = await f.propose(); expect((await f.call("start", await f.mutation(other.jobId))).code).toBe("not-approved");
    });
    test("questions/evidence from another job cannot cross a workspace capability", async () => {
        const a = await fixture(), b = await fixture(), p = await a.propose();
        expect((await b.call("get_status", { jobId: p.jobId })).outcome).toBe("refused");
        await mkdir(join(b.root, "jobs", p.jobId), { recursive: true });
        await writeFile(join(b.root, "jobs", p.jobId, "proposal.json"), await readFile(join(a.root, "jobs", p.jobId, "proposal.json")));
        expect((await b.call("get_approval_request", { jobId: p.jobId })).code).toBe("job-refused");
    });
    test("record corruption and symlink escapes are refused without writing outside the service", async () => {
        const f = await fixture(), proposed = await f.propose(), path = join(f.root, "jobs", proposed.jobId, "proposal.json"), stored = JSON.parse(await readFile(path, "utf8"));
        stored.intent = "Changed outside approval"; await writeFile(path, JSON.stringify(stored));
        expect((await f.call("get_status", { jobId: proposed.jobId })).outcome).toBe("refused");
        const root = await scratch(), outside = await scratch(); await symlink(outside, join(root, "records"));
        await expect(writeAssistantRecord(root, "records/escape.json", { value: "outside" })).rejects.toThrow("symlinks"); expect(await readdir(outside)).toEqual([]);
        await writeAssistantRecord(root, "valid.json", { value: "inside" }); expect(await readAssistantRecord<{ value: string }>(root, "valid.json")).toEqual({ value: "inside" });
    });
    test("corrupt start and cancellation markers are not narrated as recorded lifecycle facts", async () => {
        for (const marker of ["started", "cancelled"]) {
            const f = await fixture(), proposed = await f.propose();
            await writeFile(join(f.root, "jobs", proposed.jobId, `${marker}.json`), "{}");
            expect((await f.call("get_status", { jobId: proposed.jobId })).outcome).toBe("refused");
            expect(f.counters.starts).toBe(0);
        }
    });
});
