import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileDeclaration, compileExecutionPlan, hashBytes, hashValue, type EnvironmentMap } from "@wringer/plan";
import { runContainedJourney, readValidatedContainedState, type CandidateVerification } from "@wringer/workflow";
import type { RoleExecutionResult } from "@wringer/runtime";
import { initializeAssistant, issueAssistantCapability, createAssistantService, approveAssistantProposal, assistantControllerState } from "../../application/src/assistant";
import { hasActiveWorkspaceCommand } from "../../application/src/commands";
import { controllerStatus } from "../../application/src/controller";
import { createAssistantJobFlow } from "../src/assistant-job";

const roots: string[] = [], flows: ReturnType<typeof createAssistantJobFlow>[] = [], services: Awaited<ReturnType<typeof createAssistantService>>[] = [];
afterEach(async () => { for (const flow of flows.splice(0)) flow.stop(); for (const service of services.splice(0)) await service.runner.stop(50); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const template = compileExecutionPlan(await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
async function until<T>(read: () => Promise<T>, test: (value: T) => boolean): Promise<T> {
    for (let i = 0; i < 400; i++) { const value = await read(); if (test(value)) return value; await Bun.sleep(10); }
    throw new Error("Synthetic job observation did not settle");
}
async function fixture(waitForCancellation = false) {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-job-correction-"))); roots.push(root);
    const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...raw } = structuredClone(template);
    raw.intent += " The display is readable."; raw.repository = { url: "https://fixture.invalid/job-correction.git", commit: "a".repeat(40) };
    raw.runtime.env = []; raw.agents.worker.env = []; raw.agents.judge.env = [];
    raw.acceptance.criteria.push({ id: "readable", title: "Readable display", quote: "The display is readable.", kind: "human", required: true, show: { id: "show-readable", argv: ["true"], cwd: ".", timeout_seconds: 5 } });
    const plan = compileDeclaration({ version: 1, ...raw }), { workspace } = await initializeAssistant(root, { plan, cooperativeLocal: true });
    const capability = await issueAssistantCapability(root, new Date(Date.now() + 60000).toISOString());
    // Construction-time seam over the real validated query. An armed read sees
    // the journal move under it once, so the two reads of one observation disagree.
    let advanceNextRead = false;
    const service = await createAssistantService(root, { dependencies: { status: async controller => { const view = await controllerStatus(controller); if (!advanceNextRead) return view; advanceNextRead = false; return { ...view, revision: `${view.revision}-advanced` }; } } }); services.push(service);
    const proposed = await service.call(capability.token, "wringer.propose", { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), intent: plan.intent, plan }), jobId = proposed.jobId as string;
    const approved = await approveAssistantProposal(root, { jobId, expectedRevision: hashValue(await service.inspectProposal(jobId)), actor: "SCRIPTED correction fixture", expiresAt: new Date(Date.now() + 60000).toISOString(), confirmExecution: true });
    const state = assistantControllerState(root, jobId); await mkdir(state, { recursive: true });
    const files = ["README.md", ...plan.acceptance.checks.flatMap(c => c.files)].map(path => ({ path, mode: "100644", blob: "f".repeat(40) }));
    const map: Omit<EnvironmentMap, "map_sha256"> = { schema_version: "wringer.environment-map.v1", repository: plan.repository, plan_sha256: plan.plan_sha256, source_tree: "a".repeat(40), inventory_sha256: hashValue(files), files, context: [{ path: "README.md", blob: "f".repeat(40), text: "Synthetic fixture", sha256: hashBytes("Synthetic fixture") }], components: [], tools: plan.environment.tools.map(t => ({ ...t, observation: null })), baseline: plan.environment.baseline.map(declaration => ({ declaration, observation: null })), protected_paths: plan.acceptance.protected_paths, writable_paths: plan.scope.writable, limits: ["Synthetic observations; no provider, containment or repository commands"] };
    const environment = { ...map, map_sha256: hashValue(map) }, candidate = { source: { ...plan.repository, commit: "b".repeat(40) }, tree: "c".repeat(40), changedPaths: ["src/value.ts"] };
    for (const [name, value] of Object.entries({ "plan.json": plan, "authority.json": approved.authority, "environment.json": environment, "prepared-source.json": { ...plan.repository, objectStore: join(state, "unused-synthetic.git"), bundlePath: join(state, "unused-synthetic.bundle") } })) await writeFile(join(state, name), JSON.stringify(value));
    const provenance = (role: "worker" | "judge" | "verifier", repository: typeof plan.repository) => ({ schema_version: "wringer.runtime.v1" as const, runtimeId: crypto.randomUUID(), role, kind: plan.runtime.kind, image: plan.runtime.image, repository, clonedInside: true as const, hostMounts: [] as [], repositoryAccess: role === "worker" ? "read-write" as const : "read-only" as const, declared: plan.runtime, observed: { fixture: true, writableDirectories: plan.environment.writable_directories }, limits: ["Synthetic only"] });
    await runContainedJourney({ controllerDir: state, plan, authority: approved.authority, environment, services: {
        prepareSource: async source => source, captureCandidate: async () => candidate,
        verifyCandidate: async request => { const status = request.phase === "baseline" ? "failed" : "passed"; return { schema_version: "wringer.contained-verification.v1", status, candidateCommit: request.source.commit, candidateTree: request.phase === "baseline" ? environment.source_tree : candidate.tree, acceptanceSha256: plan.acceptance_sha256, runtimeId: crypto.randomUUID(), image: plan.runtime.image, checks: plan.acceptance.checks.map(c => ({ id: c.id, status, exitCode: status === "passed" ? 0 : 1, checkInputsSha256: "d".repeat(64), outputSha256: "e".repeat(64) })), regressions: plan.environment.baseline.map(c => ({ id: c.id, status: "passed", exitCode: 0, outputSha256: "e".repeat(64) })), evidenceRef: "synthetic" } as CandidateVerification; },
    }, executeRole: async request => ({ status: "completed", text: request.role === "worker" ? "Synthetic change" : JSON.stringify({ criteria: plan.acceptance.criteria.filter(c => c.kind === "check").map(c => ({ id: c.id, met: true, reason: "Synthetic" })), note: "Synthetic" }), sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: provenance(request.role as "worker" | "judge", request.repo) }) as RoleExecutionResult });
    let correctionCalls = 0, correctionSignal: AbortSignal | undefined;
    const flow = createAssistantJobFlow(service, {
        runCommands: async request => ({ provenance: provenance("verifier", request.repo), sourceChanged: false, sourceTree: candidate.tree, results: request.commands.map(c => ({ id: c.id, code: 0, stdout: "Synthetic result to inspect", stderr: "", durationMs: 1 })) }),
        executeRole: async request => { correctionCalls++; correctionSignal = request.signal; if (waitForCancellation) await new Promise<void>(resolve => { if (request.signal?.aborted) resolve(); else request.signal?.addEventListener("abort", () => resolve(), { once: true }); }); throw new Error("Synthetic correction transport failed; no actual model ran"); },
    }); flows.push(flow); await flow.tick();
    const current = await until(() => flow.read(jobId), view => view.phase === "review");
    return { root, service, capability, state, jobId, flow, current, correctionCalls: () => correctionCalls, correctionSignal: () => correctionSignal, advanceNextRead: () => { advanceNextRead = true; } };
}
test("one correction request retains the source-bound No and exact words; failed correction is never silently replayed", async () => {
    const f = await fixture(), note = "  My original request: make the result easier to read.\nKeep these exact words.  ";
    const input = { jobId: f.jobId, expectedRevision: f.current.readyRevision, expectedCandidateTree: f.current.candidateTree, note };
    await f.flow.post("correction", input);
    await until(async () => ({ history: await readValidatedContainedState(f.state, { allowStaleView: true }), active: await hasActiveWorkspaceCommand(f.state) }), value => value.history.events.some(e => e.type === "revision-requested") && !value.active);
    const history = await readValidatedContainedState(f.state), decline = history.events.find(e => e.type === "human-decisions-recorded")!;
    expect((decline.details as any).judgements).toHaveLength(1); expect((decline.details as any).judgements[0]).toMatchObject({ verdict: "not_met", note, candidateTree: f.current.candidateTree });
    expect(history.events.filter(e => e.type === "revision-requested")).toHaveLength(1); expect((history.events.find(e => e.type === "revision-requested")!.details as any).feedback).toBe(note);
    expect(f.correctionCalls()).toBe(1); expect(history.result.stop?.reason).toBe("effect-uncertain");
    await expect(f.flow.post("correction", input)).rejects.toThrow();
    for (let i = 0; i < 3; i++) await f.flow.tick();
    expect(f.correctionCalls()).toBe(1); expect((await readValidatedContainedState(f.state)).events.length).toBe(history.events.length);
}, 15000);
for (const cancellation of ["owner-stop", "assistant-cancel"]) test(`${cancellation} reaches an already running correction without another dispatch`, async () => {
    const f = await fixture(true), input = { jobId: f.jobId, expectedRevision: f.current.readyRevision, expectedCandidateTree: f.current.candidateTree, note: "SCRIPTED correction for cancellation test" };
    const pending = f.flow.post("correction", input);
    try {
        await until(async () => f.correctionSignal(), signal => !!signal);
        if (cancellation === "owner-stop") f.flow.stop();
        else { const current = await f.service.status(f.jobId); const result = await f.service.call(f.capability.token, "wringer.cancel", { jobId: f.jobId, idempotencyKey: crypto.randomUUID(), expectedRevision: current.revision, expectedCandidateTree: current.candidateTree }); expect(result).toMatchObject({ outcome: "cancelled" }); await f.flow.tick(); }
        await until(async () => f.correctionSignal()?.aborted, aborted => aborted === true);
        await pending; await until(() => hasActiveWorkspaceCommand(f.state), active => !active);
        expect(f.correctionCalls()).toBe(1);
    } finally { f.flow.stop(); await pending.catch(() => {}); }
}, 15000);
const ADVANCED = "The run advanced while it was read; read again before acting.";
test("a status read that sees the run advance reports it, never refuses and offers no action", async () => {
    // The page owner's periodic tick also reads status; stop it so the armed read is ours.
    const f = await fixture(); f.flow.stop();
    const fresh = await f.service.status(f.jobId);
    expect(fresh.actions.some((a: any) => a.enabled)).toBe(true);
    const reads: [string, () => Promise<any>][] = [["status", () => f.service.status(f.jobId)], ["PM page", async () => (await f.service.inspectForPm(f.jobId)).status], ["wringer.get_status", () => f.service.call(f.capability.token, "wringer.get_status", { jobId: f.jobId })]];
    for (const [name, read] of reads) {
        f.advanceNextRead();
        const view = await read();
        expect(view, name).toMatchObject({ revisionAdvanced: true, outcome: fresh.outcome, nextAction: ADVANCED });
        expect(view.actions, name).toHaveLength(fresh.actions.length);
        for (const action of view.actions) expect(action, name).toMatchObject({ enabled: false, reason: ADVANCED });
    }
    f.advanceNextRead();
    const inventory = await f.service.call(f.capability.token, "wringer.get_status", {}) as any;
    expect(inventory.jobs).toHaveLength(1); expect(inventory.jobs[0]).toMatchObject({ jobId: f.jobId, revisionAdvanced: true, nextAction: ADVANCED });
    expect(await f.service.status(f.jobId)).toMatchObject({ revisionAdvanced: false, nextAction: fresh.nextAction });
});
test("every act refuses the revision an advancing read reported; nothing is recorded or dispatched", async () => {
    const f = await fixture(); f.flow.stop();
    f.advanceNextRead();
    const observed = await f.service.status(f.jobId);
    expect(observed.revisionAdvanced).toBe(true);
    const guard = { jobId: f.jobId, expectedRevision: observed.revision, expectedCandidateTree: observed.candidateTree };
    for (const [name, extra] of [["wringer.cancel", {}], ["wringer.request_revision", { note: "SCRIPTED correction on a stale read" }]] as const)
        expect(await f.service.call(f.capability.token, name, { ...guard, idempotencyKey: crypto.randomUUID(), ...extra }), name).toMatchObject({ outcome: "refused", code: "stale-request" });
    expect(await f.service.runner.list(f.jobId)).toEqual([]);
    await f.service.assertJobActive(f.jobId);
    expect(await f.service.status(f.jobId)).toMatchObject({ revisionAdvanced: false, outcome: observed.outcome });
    expect(f.correctionCalls()).toBe(0);
});
