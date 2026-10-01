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
import { readValidatedContainedState } from "@wringer/workflow";
import { auditContained, deliverContained, falsifyContained } from "@wringer/delivery";
import { openReader } from "../../records/src/read";
import { approveAssistantProposal, assistantControllerState, createAssistantService, initializeAssistant, issueAssistantCapability } from "../src/assistant";
import { createMcpSession } from "../../mcp/src/server";
import { readPmWorkspace } from "../../cli/src/workspace";

const roots: string[] = [], services: Awaited<ReturnType<typeof createAssistantService>>[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.runner.stop(100); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const agent = join(import.meta.dir, "../fixtures/host-acp-agent.ts"), reader = await openReader(new URL("../../../schema", import.meta.url).pathname);
function git(cwd: string, ...args: string[]) {
    const result = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } });
    if (result.exitCode) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
}
async function fixture() {
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
        agents: { worker: { protocol: "acp", command: process.execPath, args: [agent, "worker"] }, judge: { protocol: "acp", command: process.execPath, args: [agent, "judge"] } },
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
    return { scratch, repo, root, plan, workspace, service, call };
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

test("protected mode refuses a trusted-local plan; only the labelled cooperative-local lane admits it", async () => {
    const f = await fixture();
    const record = join(f.scratch, "profile.json.source.json"), bundle = join(f.scratch, "profile.json.source.bundle");
    await expect(initializeAssistant(join(f.scratch, "protected"), { plan: f.plan, cooperativeLocal: false, localSource: { record, bundle } } as any)).rejects.toMatchObject({ code: "trusted-local-refused" });
}, 60000);
