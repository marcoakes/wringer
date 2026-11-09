/** A trusted-local job end to end through the real assistant service: MCP proposal,
 * operator approval, the real controller, environment discovery, worker and judge as
 * ordinary processes on this computer, real checks in fresh clones, and the human
 * hold. Only the agents are fixtures (no model); nothing is contained. */
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDeclaration, hashBytes } from "@wringer/plan";
import { createLocalSourceBundle, TRUSTED_LOCAL_SENTENCE } from "@wringer/runtime";
import { readValidatedContainedState, readLoopTrajectories } from "@wringer/workflow";
import { auditContained, deliverContained, falsifyContained } from "@wringer/delivery";
import { openReader } from "../../records/src/read";
import { approveAssistantProposal, assistantControllerState, createAssistantService, initializeAssistant, issueAssistantCapability } from "../src/assistant";
import { createMcpSession } from "../../mcp/src/server";
import { validateDelegationOutput } from "../../mcp/src/delegation-contract";
import { createDelegationProtocol } from "../src/delegation-protocol";
import { readPmWorkspace } from "../../cli/src/workspace";
import { createAssistantJobFlow } from "../../cli/src/assistant-job";
import { validatePmJob } from "../../board/src/job-model";

const roots: string[] = [], services: Awaited<ReturnType<typeof createAssistantService>>[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.runner.stop(100); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const agent = join(import.meta.dir, "../fixtures/host-acp-agent.ts"), reader = await openReader(new URL("../../../schema", import.meta.url).pathname);
function git(cwd: string, ...args: string[]) {
    const result = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } });
    if (result.exitCode) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
}
async function fixture(workerArgs: (scratch: string) => string[] = () => ["worker"], worker?: { command: string; args: string[] }) {
    const scratch = await realpath(await mkdtemp(join(tmpdir(), "wringer-tl-journey-"))); roots.push(scratch);
    const repo = join(scratch, "source"); await mkdir(join(repo, "src"), { recursive: true });
    git(scratch, "init", "--initial-branch=main", repo);
    await writeFile(join(repo, "README.md"), "A trusted-local fixture repository.\n");
    await writeFile(join(repo, "src/value.js"), "export const expected = false;\n");
    await writeFile(join(repo, "check.sh"), "test \"$(sed -n '1p' src/value.js)\" = 'export const expected = true;'\n");
    git(repo, "add", "."); git(repo, "commit", "-m", "Fixture baseline");
    const commit = git(repo, "rev-parse", "HEAD"), bundle = join(scratch, "profile.json.source.bundle");
    const source = await createLocalSourceBundle(repo, commit, bundle);
    const plan = compileDeclaration({ version: 5, name: "Make the value true", intent: "Set expected to true.", repository: { url: source.url, commit },
        runtime: { kind: "trusted-local", network: { policy: "unenforced" }, env: [] },
        agents: { worker: { protocol: "acp", ...(worker ?? { command: process.execPath, args: [agent, ...workerArgs(scratch)] }) }, judge: { protocol: "acp", command: process.execPath, args: [agent, "judge"] } },
        environment: { context: ["README.md"], tools: [{ name: "fixture-shell", version: "fixture-1.0", probe: ["sh", "-c", "echo fixture-1.0"] }], setup: [], baseline: [], writable_directories: [] },
        scope: { writable: ["src"] },
        acceptance: { criteria: [{ id: "value", title: "The value is true", quote: "Set expected to true.", kind: "check", required: true }], checks: [{ id: "value-check", argv: ["sh", "check.sh"], cwd: ".", timeout_seconds: 30, criteria: ["value"], files: ["check.sh"] }], protected_paths: ["check.sh"] },
        budget: { max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 600, session_timeout_seconds: 120 } } as any);
    const record = join(scratch, "profile.json.source.json");
    await writeFile(record, JSON.stringify({ schema_version: "wringer.local-source.v1", planSha256: plan.plan_sha256, url: source.url, commit, rootCommit: source.rootCommit, bundleSha256: source.bundleSha256, bundleBytes: source.bundleBytes }));
    const root = join(scratch, "controller");
    const workspace = (await initializeAssistant(root, { plan, cooperativeLocal: true, localSource: { record, bundle } })).workspace;
    const capability = await issueAssistantCapability(root, new Date(Date.now() + 600000).toISOString());
    const service = await createAssistantService(root); services.push(service);
    let sequence = 0;
    const session = createMcpSession({ version: "fixture", call: (name, args) => service.call(capability.token, name, args) });
    await session.receive(JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fixture-client", version: "fixture" } } }));
    await session.receive(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    const call = async (name: string, args: unknown): Promise<any> => {
        const result = await session.receive(JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method: "tools/call", params: { name: `wringer.${name}`, arguments: args } }));
        if (result && "error" in result) return { outcome: "refused", rpcError: result.error };
        return result!.result.structuredContent;
    };
    return { scratch, repo, root, plan, workspace, service, call, capability };
}

test("a trusted-local job runs on this computer from proposal to review, stamped at every step", async () => {
    const f = await fixture();
    const proposed = await f.call("propose", { workspaceId: f.workspace.id, idempotencyKey: crypto.randomUUID(), intent: f.plan.intent, plan: f.plan });
    expect(proposed.outcome).toBe("awaiting-approval");
    const approval = await f.call("get_approval_request", { jobId: proposed.jobId });
    await approveAssistantProposal(f.root, { jobId: proposed.jobId, expectedRevision: approval.revision, actor: "Scripted engineering fixture (not a human verdict)", expiresAt: new Date(Date.now() + 600000).toISOString(), confirmExecution: true });
    const view = await f.call("get_status", { jobId: proposed.jobId }), operationId = crypto.randomUUID();
    expect((await f.call("start", { jobId: proposed.jobId, idempotencyKey: operationId, expectedRevision: view.revision, expectedCandidateTree: view.candidateTree })).outcome).toBe("accepted");
    await f.service.runner.start();
    let operation: any;
    for (let n = 0; n < 1200; n++) { operation = await f.service.runner.read(operationId); if (["completed", "failed", "uncertain"].includes(operation.status)) break; await Bun.sleep(50); }
    expect(operation.status).toBe("completed");
    const status = await f.call("get_status", { jobId: proposed.jobId }), state = assistantControllerState(f.root, proposed.jobId);
    expect(status.outcome).toBe("review-ready");
    const history = await readValidatedContainedState(state), board = await readPmWorkspace(state);
    expect(board.checks.every(c => c.before.status === "failed" && c.after.status === "passed")).toBe(true);
    expect(board.criteria.find(c => c.id === "value")?.state).toBe("met");
    // Every role and check record is the trusted-local sibling, schema-valid and stamped.
    const roles = history.state.effects.filter(effect => effect.result).map(effect => effect.result!.provenance);
    expect(roles.map(p => p.role).sort()).toEqual(["judge", "worker"]);
    for (const p of roles) {
        expect(p.schema_version).toBe("wringer.runtime.v3");
        expect((await reader.validate(p, "runtime-v3.schema.json")).ok).toBe(true);
        expect(p.limits).toContain(TRUSTED_LOCAL_SENTENCE);
    }
    expect(await readFile(join(f.repo, "src/value.js"), "utf8")).toBe("export const expected = false;\n");
    // What each role did, as numbered lines: the CLI's projection and the assistant's paged view agree.
    const trajectories = await readLoopTrajectories(state);
    expect(trajectories.map(t => t.role).sort()).toEqual(["judge", "worker"]);
    for (const t of trajectories) expect((await reader.validate(t, "loop-trajectory-v1.schema.json")).ok).toBe(true);
    const worker = trajectories.find(t => t.role === "worker")!;
    expect(worker.lines.some(l => l.kind === "ASSISTANT" && l.text === "Set the value. Fixture worker; no model was used.")).toBe(true);
    expect(worker.lines[1]!.text.startsWith("Controller prompt: ")).toBe(true); expect(worker.lines[1]!.text).toContain("Implement the original intent");
    const protocol = createDelegationProtocol(f.service), inspect = async (args: Record<string, unknown>) => { const value = await protocol.call(f.capability.token, "wringer.inspect_loop", { jobId: proposed.jobId, ...args }); validateDelegationOutput("wringer.inspect_loop", value); return value as any; };
    const index = await inspect({ trajectory: true });
    expect(index.sessions.map((s: any) => s.effectId).sort()).toEqual(trajectories.map(t => t.effectId).sort()); expect(index.lines).toEqual([]);
    const page = await inspect({ trajectory: true, effectId: worker.effectId, offset: 0, limit: 2 });
    expect(page.lines).toEqual(worker.lines.slice(0, 2)); expect(page.nextOffset).toBe(2); expect(page.trajectorySha256).toBe(worker.sha256);
    expect((await reader.validate(page, "loop-trajectory-page-v1.schema.json")).ok).toBe(true);
    expect((await inspect({ effectId: worker.effectId })).outcome).toBe("refused");
    expect((await inspect({ trajectory: true, effectId: "no-such-session" })).outcome).toBe("refused");
    // Prepare, Send to a new local bare origin, and audit a fresh clone of the review branch offline.
    const origin = join(f.scratch, "origin.git"); git(f.scratch, "init", "--bare", "--initial-branch=main", origin); git(f.repo, "push", origin, "main");
    const publication = { remote: origin, sourceBranch: "wringer/trusted-local", targetBranch: "main" };
    const prepared = await deliverContained({ stateDir: state, publication });
    const sent = await deliverContained({ stateDir: state, publication, send: true });
    expect(sent.pushed).toBe(true); expect(sent.evidenceCommit).toBe(prepared.evidenceCommit);
    const clone = join(f.scratch, "review"); git(f.scratch, "clone", "--no-local", "--branch", "wringer/trusted-local", origin, clone);
    const bundle = join(clone, sent.auditCommand.split("--bundle ")[1]!.trim());
    const audit = await auditContained(bundle);
    expect(audit.status).toBe("passed"); expect(audit.codeCommit).toBe(status.candidate.commit);
    const manifest = JSON.parse(await readFile(join(bundle, "manifest.json"), "utf8")), summary = await readFile(join(bundle, "summary.md"), "utf8"), mr = await readFile(join(bundle, "mr.md"), "utf8");
    for (const text of [summary, mr]) expect(text).toContain(TRUSTED_LOCAL_SENTENCE);
    expect(JSON.stringify(manifest)).toContain(TRUSTED_LOCAL_SENTENCE);
    // The frozen contract keeps the falsify route "available"; its reason and the limits say it refuses this delivery.
    expect(manifest.falsify.reason).toContain("this command refuses it");
    for (const text of [summary, mr, JSON.stringify(audit.limits)]) expect(text).not.toContain("The separate contained falsification command challenges");
    expect(audit.limits).toContain("Falsification is not available for this delivery: it needs an isolated verifier, and nothing was contained.");
    expect(hashBytes(JSON.stringify(history.result))).toMatch(/^[a-f0-9]{64}$/);
    // Falsification needs an isolated verifier; a trusted-local delivery is refused, not reproduced.
    await expect(falsifyContained({ bundleDir: bundle, outputDir: join(f.scratch, "falsify") })).rejects.toThrow("Falsification needs an isolated verifier");
}, 120000);

test("a worker that stops leaves its edits for the retry, and none of them reach the delivery", async () => {
    const f = await fixture(scratch => ["worker-stops-once", join(scratch, "stopped-once")]);
    const proposed = await f.call("propose", { workspaceId: f.workspace.id, idempotencyKey: crypto.randomUUID(), intent: f.plan.intent, plan: f.plan });
    const approval = await f.call("get_approval_request", { jobId: proposed.jobId });
    await approveAssistantProposal(f.root, { jobId: proposed.jobId, expectedRevision: approval.revision, actor: "Scripted engineering fixture (not a human verdict)", expiresAt: new Date(Date.now() + 600000).toISOString(), confirmExecution: true });
    const settled = async (id: string) => { let operation: any; for (let n = 0; n < 1200; n++) { operation = await f.service.runner.read(id); if (["completed", "failed", "uncertain"].includes(operation.status)) return operation; await Bun.sleep(50); } throw new Error("Operation did not settle"); };
    const guard = (view: any) => ({ jobId: proposed.jobId, idempotencyKey: crypto.randomUUID(), expectedRevision: view.revision, expectedCandidateTree: view.candidateTree });
    const start = guard(await f.call("get_status", { jobId: proposed.jobId }));
    expect((await f.call("start", start)).outcome).toBe("accepted");
    await f.service.runner.start();
    await settled(start.idempotencyKey);
    const state = assistantControllerState(f.root, proposed.jobId);
    const stopped = await f.call("get_status", { jobId: proposed.jobId });
    expect(stopped.outcome).toBe("stopped");
    expect(JSON.stringify(stopped.stop ?? stopped.nextAction)).toContain("Its unfinished edits to 1 file are kept");
    expect(stopped.candidateTree).toBeNull();
    // The operator's own checkout was never touched, and nothing was captured as a candidate.
    expect(await readFile(join(f.repo, "src/value.js"), "utf8")).toBe("export const expected = false;\n");
    const first = (await readValidatedContainedState(state)).state.effects[0]!;
    const receipt = JSON.parse(await readFile(join(state, ".wringer/contained/effects", first.id, "stopped-edits.json"), "utf8"));
    expect(receipt.paths).toEqual(["src/value.js"]); expect(receipt.patch).toContain("KEPT_EDIT_MARKER");
    // The next session, a real process in a fresh clone, is offered the patch.
    const retry = { ...guard(stopped), action: "retry-stopped" };
    expect((await f.call("continue", retry)).outcome).toBe("accepted");
    expect((await settled(retry.idempotencyKey)).status).toBe("completed");
    const prompt = await readFile(join(f.scratch, "stopped-once.prompt"), "utf8");
    expect(prompt).toContain('"ended":"stopped (max_tokens)"'); expect(prompt).toContain("KEPT_EDIT_MARKER"); expect(prompt).toContain("git apply");
    const ready = await f.call("get_status", { jobId: proposed.jobId });
    expect(ready.outcome).toBe("review-ready");
    // Sent and audited from a fresh clone: the journal mentions the kept edits, their bytes go nowhere.
    const origin = join(f.scratch, "origin.git"); git(f.scratch, "init", "--bare", "--initial-branch=main", origin); git(f.repo, "push", origin, "main");
    const publication = { remote: origin, sourceBranch: "wringer/kept-edits", targetBranch: "main" };
    await deliverContained({ stateDir: state, publication });
    const sent = await deliverContained({ stateDir: state, publication, send: true });
    const clone = join(f.scratch, "review"); git(f.scratch, "clone", "--no-local", "--branch", "wringer/kept-edits", origin, clone);
    const bundle = join(clone, sent.auditCommand.split("--bundle ")[1]!.trim());
    expect((await auditContained(bundle)).status).toBe("passed");
    expect(await readFile(join(clone, "src/value.js"), "utf8")).toBe("export const expected = true;\n");
    const carried = Bun.spawnSync(["grep", "-r", "-l", "KEPT_EDIT_MARKER", clone, "--exclude-dir=.git"]);
    expect(carried.stdout.toString()).toBe("");
    expect(git(clone, "log", "--all", "-S", "KEPT_EDIT_MARKER", "--oneline")).toBe("");
}, 120000);

test("protected mode refuses a trusted-local plan; only the labelled cooperative-local lane admits it", async () => {
    const f = await fixture();
    const record = join(f.scratch, "profile.json.source.json"), bundle = join(f.scratch, "profile.json.source.bundle");
    await expect(initializeAssistant(join(f.scratch, "protected"), { plan: f.plan, cooperativeLocal: false, localSource: { record, bundle } } as any)).rejects.toMatchObject({ code: "trusted-local-refused" });
}, 60000);

test("a worker that cannot start: the assistant is told to retry with wringer.continue, and the page says who retries (W4)", async () => {
    // The 2026-11-09 review walk: the page said "retry the stopped step" with no one to do it, and
    // get_status said inspect, for the operator, not eligible, while START_AGENT said to continue.
    const f = await fixture(undefined, { command: "/bin/sh", args: ["-c", "echo 'stub npx: no model spent' >&2; exit 86"] });
    const flow = createAssistantJobFlow(f.service, { autoAdvance: false });
    f.service.setPresentation(async jobId => { const shown = await flow.read(jobId); return { phase: shown.phase, nextAction: shown.nextAction, eventId: shown.readyRevision, observedRevision: shown.revision, observedCandidateTree: shown.candidateTree, pageUrl: `http://127.0.0.1:1/?jobId=${jobId}` }; });
    const protocol = createDelegationProtocol(f.service), status = async (jobId: string) => validateDelegationOutput("wringer.get_status", await protocol.call(f.capability.token, "wringer.get_status", { jobId })) as any;
    const proposed = await f.call("propose", { workspaceId: f.workspace.id, idempotencyKey: crypto.randomUUID(), intent: f.plan.intent, plan: f.plan });
    const approval = await f.call("get_approval_request", { jobId: proposed.jobId });
    await approveAssistantProposal(f.root, { jobId: proposed.jobId, expectedRevision: approval.revision, actor: "Scripted engineering fixture (not a human verdict)", expiresAt: new Date(Date.now() + 600000).toISOString(), confirmExecution: true });
    const settled = async (id: string) => { for (let n = 0; n < 1200; n++) { const operation = await f.service.runner.read(id); if (["completed", "failed", "uncertain"].includes(operation.status)) return operation; await Bun.sleep(50); } throw new Error("Operation did not settle"); };
    const guard = (view: any) => ({ jobId: proposed.jobId, idempotencyKey: crypto.randomUUID(), expectedRevision: view.revision, expectedCandidateIdentity: view.candidateIdentity });
    const begin = guard(await status(proposed.jobId));
    expect(["accepted", "running"]).toContain((await protocol.call(f.capability.token, "wringer.start", begin)).outcome);
    await f.service.runner.start(); await settled(begin.idempotencyKey);
    const stopped = await status(proposed.jobId);
    expect(stopped.phase).toBe("blocked");
    expect(stopped.nextAction.code).toBe("continue"); expect(stopped.nextAction.actor).toBe("assistant"); expect(stopped.nextAction.eligible).toBe(true);
    expect(stopped.nextAction.reason).toContain("could not start: stub npx: no model spent");
    expect(stopped.nextAction.reason).toContain('call wringer.continue with action "retry-stopped"');
    const page = validatePmJob(await flow.read(proposed.jobId));
    expect(page.phase).toBe("blocked");
    expect(page.stop).toEqual({ by: "assistant", text: expect.stringContaining("Ask your coding assistant to retry the stopped step") });
    // What the status names is what wringer.continue accepts.
    const retry = { ...guard(stopped), action: "retry-stopped" };
    expect(["accepted", "running"]).toContain((await protocol.call(f.capability.token, "wringer.continue", retry)).outcome);
    await settled(retry.idempotencyKey);
    // The worker's two turns are spent: nothing can retry it now, and neither the status nor the page says otherwise.
    const spent = await status(proposed.jobId);
    expect(spent.phase).toBe("blocked"); expect(spent.nextAction.code).not.toBe("continue"); expect(spent.nextAction.actor).toBe("operator");
    expect((await flow.read(proposed.jobId)).stop).toBeUndefined();
    await flow.stop();
}, 120000);

test("a worker whose change Git cannot keep is a known stop the assistant retries, not an uncertain effect", async () => {
    // ZenJev, 2026-11-09: capture failed after a completed, charged session; the effect became uncertain,
    // and nothing could retry it, recover it or close its owner.
    const f = await fixture(scratch => ["worker-unstageable-once", join(scratch, "unstageable-once")]);
    const flow = createAssistantJobFlow(f.service, { autoAdvance: false });
    f.service.setPresentation(async jobId => { const shown = await flow.read(jobId); return { phase: shown.phase, nextAction: shown.nextAction, eventId: shown.readyRevision, observedRevision: shown.revision, observedCandidateTree: shown.candidateTree, pageUrl: `http://127.0.0.1:1/?jobId=${jobId}` }; });
    const protocol = createDelegationProtocol(f.service), status = async (jobId: string) => validateDelegationOutput("wringer.get_status", await protocol.call(f.capability.token, "wringer.get_status", { jobId })) as any;
    const proposed = await f.call("propose", { workspaceId: f.workspace.id, idempotencyKey: crypto.randomUUID(), intent: f.plan.intent, plan: f.plan });
    const approval = await f.call("get_approval_request", { jobId: proposed.jobId });
    await approveAssistantProposal(f.root, { jobId: proposed.jobId, expectedRevision: approval.revision, actor: "Scripted engineering fixture (not a human verdict)", expiresAt: new Date(Date.now() + 600000).toISOString(), confirmExecution: true });
    const settled = async (id: string) => { for (let n = 0; n < 1200; n++) { const operation = await f.service.runner.read(id); if (["completed", "failed", "uncertain"].includes(operation.status)) return operation; await Bun.sleep(50); } throw new Error("Operation did not settle"); };
    const guard = (view: any) => ({ jobId: proposed.jobId, idempotencyKey: crypto.randomUUID(), expectedRevision: view.revision, expectedCandidateIdentity: view.candidateIdentity });
    const begin = guard(await status(proposed.jobId));
    expect(["accepted", "running"]).toContain((await protocol.call(f.capability.token, "wringer.start", begin)).outcome);
    await f.service.runner.start(); await settled(begin.idempotencyKey);
    const stopped = await status(proposed.jobId);
    expect(stopped.uncertainty).toBe(false);
    expect(stopped.nextAction.code).toBe("continue"); expect(stopped.nextAction.actor).toBe("assistant");
    expect(stopped.nextAction.reason).toContain("The worker finished, but Wringer could not keep its change");
    expect(stopped.nextAction.reason).toContain("unreadable.txt");
    expect(validatePmJob(await flow.read(proposed.jobId)).stop?.by).toBe("assistant");
    const retry = { ...guard(stopped), action: "retry-stopped" };
    expect(["accepted", "running"]).toContain((await protocol.call(f.capability.token, "wringer.continue", retry)).outcome);
    await settled(retry.idempotencyKey);
    expect((await status(proposed.jobId)).outcome).toBe("review-ready");
    await flow.stop();
}, 120000);
