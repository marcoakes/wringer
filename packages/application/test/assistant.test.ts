import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
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
    const publicationState: { value: Awaited<ReturnType<AssistantDependencies["publication"]>>; beforeRead?: () => Promise<void> } = { value: null };
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
        publication: async () => { counters.publications++; await publicationState.beforeRead?.(); return publicationState.value; },
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
    return { root, profile, workspace, capability, service, counters, query, publicationState, call, propose, approve, mutation };
}

describe("assistant application narrow authority and inert intake", () => {
    test("PM inspection coalesces only overlapping publication reads and keeps public status unchanged", async () => {
        const f = await fixture(), proposed = await f.propose();
        const sentinel = join(f.root, "jobs", proposed.jobId, "controller/.wringer/contained/plan.json");
        // Status dependency is a synthetic validated-query seam, not a live run.
        await mkdir(dirname(sentinel), { recursive: true }); await writeFile(sentinel, "{}");
        const publicBefore = await f.call("get_status", { jobId: proposed.jobId });
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        f.publicationState.beforeRead = () => gate;
        const baseline = f.counters.publications, status = f.service.status(proposed.jobId), first = f.service.inspectForPm(proposed.jobId), second = f.service.inspectForPm(proposed.jobId);
        try {
            await until(async () => f.counters.publications, count => count > baseline);
            expect(f.counters.publications).toBe(baseline + 1);
        } finally { release(); }
        const [visible, a, b] = await Promise.all([status, first, second]);
        expect(a.status).toEqual(visible); expect(b.status).toEqual(visible); expect(a.query).toEqual(f.query);
        const { eventId: _eventId, ...publicBody } = publicBefore;
        expect(visible).toEqual(publicBody); expect(visible).not.toHaveProperty("query");
        expect(visible).not.toHaveProperty("status");
        // A UI consumer cannot alter another overlapping caller's observations.
        a.query!.revision = "e".repeat(64); a.status.nextAction = "Mutated consumer copy";
        expect(b.query!.revision).toBe(f.query.revision); expect(b.status.nextAction).toBe(visible.nextAction);
        f.publicationState.beforeRead = undefined;
        f.query.revision = "f".repeat(64);
        const later = await f.service.inspectForPm(proposed.jobId);
        expect(f.counters.publications).toBe(baseline + 2); expect(later.status.revision).toBe(f.query.revision); expect(later.query!.revision).toBe(f.query.revision);
        expect(f.counters.starts).toBe(0); expect(f.counters.commands).toBe(0);
    });
    test("overlapping PM inspections report an invalidated query as advanced and later reads recompute", async () => {
        const f = await fixture(), proposed = await f.propose();
        const sentinel = join(f.root, "jobs", proposed.jobId, "controller/.wringer/contained/plan.json");
        await mkdir(dirname(sentinel), { recursive: true }); await writeFile(sentinel, "{}");
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        f.publicationState.beforeRead = () => gate;
        const status = f.service.status(proposed.jobId), inspection = f.service.inspectForPm(proposed.jobId);
        try {
            await until(async () => f.counters.publications, count => count === 1);
            f.query.revision = "e".repeat(64);
        } finally { release(); }
        // The observation reports the advance instead of refusing; acting on it is refused at the act.
        const [visible, inspected] = await Promise.all([status, inspection]);
        for (const view of [visible, inspected.status]) {
            expect(view.revisionAdvanced).toBe(true); expect(view.revision).toBe("b".repeat(64));
            expect(view.actions.length).toBeGreaterThan(0); expect(view.actions.every((a: any) => !a.enabled)).toBe(true);
        }
        expect(f.counters.publications).toBe(1);
        f.publicationState.beforeRead = undefined;
        const current = await f.service.inspectForPm(proposed.jobId);
        expect(current.query!.revision).toBe(f.query.revision); expect(current.status.revision).toBe(f.query.revision); expect(current.status.revisionAdvanced).toBe(false); expect(f.counters.publications).toBe(2);
        // A newly invalid publication cannot be concealed by a completed cache.
        f.publicationState.beforeRead = async () => { throw new Error("Altered retained publication"); };
        await expect(f.service.inspectForPm(proposed.jobId)).rejects.toThrow("Altered retained publication");
        expect(f.counters.publications).toBe(3); expect(f.counters.starts).toBe(0); expect(f.counters.commands).toBe(0);
    });
    test("the construction-only routine coordinator still requires exact approval and restricts runtime tool names", async () => {
        const f = await fixture(), proposed = await f.propose(), input = await f.mutation(proposed.jobId);
        expect((await f.service.requestRoutine("wringer.start", input)).code).toBe("not-approved");
        for (const tool of ["wringer.propose", "wringer.cancel", "wringer.get_status", "wringer.publish"]) expect((await f.service.requestRoutine(tool as any, input)).outcome).toBe("refused");
        expect(f.counters.starts).toBe(0); expect(f.counters.commands).toBe(0); expect(await f.service.runner.list()).toEqual([]);
        await f.approve(proposed.jobId);
        expect((await f.service.requestRoutine("wringer.start", input)).code).toBe("stale-request");
        const accepted = await f.service.requestRoutine("wringer.start", await f.mutation(proposed.jobId));
        expect(accepted.outcome).toBe("accepted"); expect(f.counters.starts).toBe(0);
    });
    test("bounded waiting observes unchanged state without execution and rejects non-string cursors or extra powers", async () => {
        const f = await fixture(), proposed = await f.propose(), current = await f.call("get_status", { jobId: proposed.jobId });
        const before = await readdir(f.root), began = Date.now();
        const timed = await f.call("wait_for_update", { jobId: proposed.jobId, afterEventId: current.eventId, timeoutSeconds: 1 });
        expect(timed.changed).toBe(false); expect(timed.eventId).toBe(current.eventId); expect(Date.now() - began).toBeGreaterThanOrEqual(950); expect(Date.now() - began).toBeLessThan(3000);
        expect(timed.note).toContain("Read-only"); expect(await readdir(f.root)).toEqual(before);
        for (const extra of [{ timeoutSeconds: -1 }, { timeoutSeconds: 26 }, { timeoutSeconds: 0.5 }, { afterEventId: [current.eventId] }, { afterEventId: null }, { execute: true }]) expect((await f.call("wait_for_update", { jobId: proposed.jobId, afterEventId: current.eventId, timeoutSeconds: 0, ...extra })).outcome).toBe("refused");
        expect(f.counters.starts).toBe(0); expect(f.counters.commands).toBe(0); expect(await f.service.runner.list()).toEqual([]);
    });
    test("a pending wait rechecks revoked credentials and only the changed presentation is returned", async () => {
        const f = await fixture(), proposed = await f.propose(); let eventId = "d".repeat(64);
        f.service.setPresentation(async () => ({ phase: "approval", nextAction: "Review the request", eventId, pageUrl: `http://127.0.0.1:4321/job/${proposed.jobId}` }));
        const current = await f.call("get_status", { jobId: proposed.jobId });
        expect(current.eventId).toBe(eventId); expect(current.decision.pageUrl).not.toContain(f.capability.token);
        const updated = f.call("wait_for_update", { jobId: proposed.jobId, afterEventId: eventId, timeoutSeconds: 2 });
        await Bun.sleep(30); eventId = "e".repeat(64);
        expect((await updated).changed).toBe(true);
        const revoked = f.call("wait_for_update", { jobId: proposed.jobId, afterEventId: eventId, timeoutSeconds: 2 });
        await Bun.sleep(30); await revokeAssistantCapabilities(f.root);
        expect((await revoked).code).toBe("capability-refused");
        expect(f.counters.starts).toBe(0); expect(f.counters.commands).toBe(0); expect(await f.service.runner.list()).toEqual([]);
    });
    test("current audited publication drives next action; fresh handover refuses but duplicate observation survives", async () => {
        const f = await fixture({ startJournal: true, destination: { remote: "https://example.com/team/test.git", sourceBranch: "delivery/test", targetBranch: "main" } }), proposed = await f.propose(); await f.approve(proposed.jobId);
        const input = await f.mutation(proposed.jobId); await f.call("start", input); await f.service.runner.start(); await until(() => f.service.runner.read(input.idempotencyKey), x => x.status === "completed");
        f.query.result.candidate = { source: { commit: "c".repeat(40) }, tree: "e".repeat(40), changedPaths: ["src/example.ts"] };
        f.query.candidateTree = "e".repeat(40); f.query.status = "review-ready"; f.query.stage = "complete"; f.query.stop = null;
        f.publicationState.value = { schema_version: "wringer.contained-publication.v1", status: "delivered", deliveryId: "contained-" + "f".repeat(24), bundleDir: "deliveries/test/bundle", codeCommit: "c".repeat(40), evidenceCommit: "d".repeat(40), sourceBranch: "delivery/test", targetBranch: "main", auditCommand: "wringer-drive audit --bundle deliveries/test/bundle", pushed: true, falsify: { status: "available", command: "fixture", reason: "not run" } };
        let view = await f.call("get_status", { jobId: proposed.jobId });
        expect(view.outcome).toBe("branch-pushed"); expect(view.nextAction).toContain("fresh clone"); expect(view.nextAction).toContain("No hosted"); expect(view.publication.deliveryId).toBe(f.publicationState.value.deliveryId); expect(view.uncertainty).toBe(false);
        expect(view.actions.find((x: any) => x.action === "prepare_handover").enabled).toBe(false);
        const before = (await f.service.runner.list()).length;
        expect((await f.call("prepare_handover", await f.mutation(proposed.jobId))).code).toBe("handover-already-recorded"); expect((await f.service.runner.list()).length).toBe(before);
        expect((await f.call("start", input)).outcome).toBe("completed"); expect(f.counters.starts).toBe(1);
        f.publicationState.value.forge = { status: "uncertain" } as any;
        view = await f.call("get_status", { jobId: proposed.jobId }); expect(view.outcome).toBe("uncertain"); expect(view.uncertainty).toBe(true); expect(view.nextAction).toContain("do not send");
        f.publicationState.value.forge = { status: "published", url: "https://example.com/team/test/pull/1" } as any;
        view = await f.call("get_status", { jobId: proposed.jobId }); expect(view.outcome).toBe("published"); expect(view.publication.url).toBe("https://example.com/team/test/pull/1");
        f.publicationState.value.codeCommit = "1".repeat(40);
        view = await f.call("get_status", { jobId: proposed.jobId }); expect(view.publication).toBeNull(); expect(view.outcome).toBe("review-ready"); expect(view.actions.find((x: any) => x.action === "prepare_handover").enabled).toBe(true);
    });
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
        const issuedAt = Date.now(), expiresAt = issuedAt + 200;
        setSystemTime(issuedAt);
        try {
            const expiring = await issueAssistantCapability(b.root, new Date(expiresAt).toISOString());
            setSystemTime(expiresAt - 1);
            expect((await b.call("inspect_setup", {}, expiring.token)).outcome).toBe("inspected");
            setSystemTime(expiresAt);
            expect((await b.call("inspect_setup", {}, expiring.token)).code).toBe("capability-refused");
        } finally { setSystemTime(); }
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
        // Freeze Date and Date.now, not the queue's timers. Filesystem latency
        // cannot consume the admission window before we advance it ourselves.
        const grantedAt = Date.now();
        let f: Awaited<ReturnType<typeof fixture>> | undefined;
        setSystemTime(grantedAt);
        try {
            f = await fixture();
            const proposed = await f.propose(), approved = await f.approve(proposed.jobId, new Date(grantedAt + 200).toISOString());
            const expiresAt = Date.parse(approved.authority.expires_at);
            setSystemTime(expiresAt - 1);
            const input = await f.mutation(proposed.jobId); expect((await f.call("start", input)).outcome).toBe("accepted");
            const queued = await f.service.runner.read(input.idempotencyKey);
            expect(queued.status).toBe("accepted"); expect(Date.parse(queued.acceptedAt)).toBe(expiresAt - 1);
            expect(f.counters.starts).toBe(0);
            setSystemTime(expiresAt);
            expect(Date.now()).toBeLessThan(Date.parse(f.capability.expiresAt));
            await f.service.runner.start();
            const service = f.service;
            const operation = await until(() => service.runner.read(input.idempotencyKey), value => ["completed", "failed", "uncertain"].includes(value.status));
            expect(operation.status).toBe("failed"); expect(operation.error).toContain("no effect was dispatched");
            expect(f.counters.starts).toBe(0); expect(f.counters.commands).toBe(0);
            const status = await f.call("get_status", { jobId: proposed.jobId });
            expect(status.outcome).toBe("approval-out-of-date"); expect(status.actions.every((x: any) => !x.enabled)).toBe(true);
            expect((await f.call("inspect_setup", {})).outcome).toBe("inspected");
        } finally {
            try { await f?.service.runner.stop(50); } finally { setSystemTime(); }
        }
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
    test("durable cancellation acknowledgement survives an immediately advancing correction journal", async () => {
        const f = await fixture(), proposed = await f.propose(); await f.approve(proposed.jobId);
        const sentinel = join(f.root, "jobs", proposed.jobId, "controller/.wringer/contained/plan.json");
        await mkdir(dirname(sentinel), { recursive: true }); await writeFile(sentinel, "{}");
        const input = await f.mutation(proposed.jobId), before = f.counters.publications;
        // Deterministically simulate the correction finishing after it observes
        // cancellation: a post-effect audit sees its journal advance. This must
        // not turn the already-durable cancellation into a false refusal.
        f.publicationState.beforeRead = async () => {
            const marker = await readAssistantRecord(f.root, `jobs/${proposed.jobId}/cancelled.json`);
            expect(marker.jobId).toBe(proposed.jobId);
            f.query.revision = "e".repeat(64);
        };
        const result = await f.call("cancel", input);
        const marker = await readAssistantRecord(f.root, `jobs/${proposed.jobId}/cancelled.json`);
        expect(marker.requestId).toBe(input.idempotencyKey);
        expect(await Bun.file(join(f.root, "runner/jobs", proposed.jobId, "cancel.json")).exists()).toBe(true);
        expect(result).toMatchObject({ outcome: "cancelled", cancellationRequested: true, activeEffects: "unknown" });
        expect(f.counters.publications).toBe(before);
        expect(result).not.toHaveProperty("revision");
        expect(f.counters.starts).toBe(0); expect(f.counters.commands).toBe(0);
        f.publicationState.beforeRead = undefined;
        expect((await f.call("get_status", { jobId: proposed.jobId })).outcome).toBe("cancelled");
    });
    test("a cancellation naming an older revision is recorded with it and stops future work; a malformed revision is refused", async () => {
        const f = await fixture(), proposed = await f.propose(); await f.approve(proposed.jobId);
        expect(await f.call("cancel", { ...await f.mutation(proposed.jobId), expectedRevision: "not-a-revision" })).toMatchObject({ outcome: "refused", code: "invalid-input" });
        expect(await Bun.file(join(f.root, "jobs", proposed.jobId, "cancelled.json")).exists()).toBe(false);
        const result = await f.call("cancel", { ...await f.mutation(proposed.jobId), expectedRevision: "f".repeat(64) });
        expect(result).toMatchObject({ outcome: "cancelled" });
        expect(await readAssistantRecord(f.root, `jobs/${proposed.jobId}/cancelled.json`)).toMatchObject({ requestedAtRevision: "f".repeat(64) });
        expect(await Bun.file(join(f.root, "runner/jobs", proposed.jobId, "cancel.json")).exists()).toBe(true);
        expect((await f.call("start", await f.mutation(proposed.jobId))).code).toBe("cancelled");
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
