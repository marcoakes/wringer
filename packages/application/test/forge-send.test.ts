/** alpha.47: a trusted-local job's Send pushes the branch and opens a pull request whose description is
 * the delivery's mr.md, and the page links it. Real assistant service, controller, checks and job-page
 * flow; the agents are fixtures (no model). GitHub is a local fake on 127.0.0.1, and the repository's
 * SSH remote reaches a local bare origin through a stand-in `ssh` on PATH. No network or real token. */
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDeclaration } from "@wringer/plan";
import { createLocalSourceBundle } from "@wringer/runtime";
import { auditContained, deliverContained } from "@wringer/delivery";
import { approveAssistantProposal, assistantControllerState, createAssistantService, initializeAssistant, issueAssistantCapability } from "../src/assistant";
import { queueWorkspaceCommand, readWorkspaceCommand } from "../src/commands";
import { createMcpSession } from "../../mcp/src/server";
import { createAssistantJobFlow } from "../../cli/src/assistant-job";
import { validatePmJob } from "../../board/src/job-model";

// Shaped like a GitHub fine-grained token, whose public "github_pat_" prefix once made every record naming github read as a credential.
const TOKEN = "WRINGER_FORGE_SEND_FIXTURE_TOKEN", SECRET = "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0Vw4Xy8";
const roots: string[] = [], services: Awaited<ReturnType<typeof createAssistantService>>[] = [], servers: { stop(force?: boolean): void }[] = [];
const path = process.env.PATH;
afterEach(async () => {
    process.env.PATH = path; delete process.env[TOKEN];
    for (const server of servers.splice(0)) server.stop(true);
    for (const service of services.splice(0)) await service.runner.stop(100);
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const agent = join(import.meta.dir, "../fixtures/host-acp-agent.ts");
function git(cwd: string, ...args: string[]) {
    const result = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } });
    if (result.exitCode) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
}
/** A GitHub that keeps what it is asked: the lookup Wringer sends first, then the creation. */
function fakeGitHub(origin: string, rejectCreates = 0) {
    const requests: { method: string; path: string; search: URLSearchParams; authorization: string | null; body: any }[] = [], pulls: any[] = [];
    let port = 0;
    const server: { port?: number; stop(force?: boolean): void } = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request): Promise<Response> {
        const url = new URL(request.url), body = request.method === "POST" ? await request.json() : null;
        requests.push({ method: request.method, path: url.pathname, search: url.searchParams, authorization: request.headers.get("authorization"), body });
        if (url.pathname !== "/repos/acme/example/pulls") return Response.json({ message: "Not Found" }, { status: 404 });
        if (request.method === "GET") return Response.json(pulls);
        if (rejectCreates-- > 0) return Response.json({ message: "Resource not accessible by personal access token" }, { status: 403 });
        // GitHub reports the head the branch has on the server, so the pushed branch must exist.
        const sha = git(origin, "rev-parse", `refs/heads/${body.head}`), number = pulls.length + 7;
        const row: Record<string, unknown> = { number, html_url: `http://127.0.0.1:${port}/acme/example/pull/${number}`, title: body.title, body: body.body, state: "open", merged: false, head: { ref: body.head, sha, repo: { full_name: "acme/example" } }, base: { ref: body.base, repo: { full_name: "acme/example" } } };
        pulls.push(row);
        return Response.json(row, { status: 201 });
    } });
    servers.push(server); port = server.port!;
    return { endpoint: `http://127.0.0.1:${port}`, requests };
}
async function fixture(rejectCreates = 0) {
    const scratch = await realpath(await mkdtemp(join(tmpdir(), "wringer-forge-send-"))); roots.push(scratch);
    const repo = join(scratch, "source"); await mkdir(join(repo, "src"), { recursive: true });
    git(scratch, "init", "--initial-branch=main", repo);
    await writeFile(join(repo, "README.md"), "A trusted-local fixture repository.\n");
    await writeFile(join(repo, "src/value.js"), "export const expected = false;\n");
    await writeFile(join(repo, "check.sh"), "test \"$(sed -n '1p' src/value.js)\" = 'export const expected = true;'\n");
    git(repo, "add", "."); git(repo, "commit", "-m", "Fixture baseline");
    const origin = join(scratch, "origin.git"); git(scratch, "init", "--bare", "--initial-branch=main", origin); git(repo, "push", origin, "main");
    // ssh://git@127.0.0.1/acme/example.git reaches the bare origin; anything else is refused.
    const bin = join(scratch, "bin"); await mkdir(bin);
    await writeFile(join(bin, "ssh"), `#!/bin/sh\nfor last; do :; done\necho "$last" >> '${join(scratch, "ssh.log")}'\ncase "$last" in\n  "git-upload-pack '/acme/example.git'") exec git upload-pack '${origin}' ;;\n  "git-receive-pack '/acme/example.git'") exec git receive-pack '${origin}' ;;\nesac\necho "fixture ssh refused: $last" >&2; exit 1\n`);
    await chmod(join(bin, "ssh"), 0o755);
    process.env.PATH = `${bin}:${path}`;
    const forgeServer = fakeGitHub(origin, rejectCreates);
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
    // The destination a v3 workspace's job carries (packages/cli/test/alpha47.test.ts records it from wring setup).
    const forge = { kind: "github", endpoint: forgeServer.endpoint, repo: "acme/example", token_env: TOKEN };
    const destination = { remote: "ssh://git@127.0.0.1/acme/example.git", sourceBranch: "wringer/job/forge-fixture", targetBranch: "main", forge };
    const root = join(scratch, "controller");
    const workspace = (await initializeAssistant(root, { plan, cooperativeLocal: true, destination, localSource: { record, bundle } })).workspace;
    const capability = await issueAssistantCapability(root, new Date(Date.now() + 600000).toISOString());
    const service = await createAssistantService(root); services.push(service);
    let sequence = 0;
    const session = createMcpSession({ version: "fixture", call: (name, args) => service.call(capability.token, name, args) });
    await session.receive(JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fixture-client", version: "fixture" } } }));
    await session.receive(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    const call = async (name: string, args: unknown): Promise<any> => ((await session.receive(JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method: "tools/call", params: { name: `wringer.${name}`, arguments: args } }))) as any).result.structuredContent;
    // Proposal, approval and the approved work, to a result ready for Send.
    const proposed = await call("propose", { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), intent: plan.intent, plan });
    const approval = await call("get_approval_request", { jobId: proposed.jobId });
    await approveAssistantProposal(root, { jobId: proposed.jobId, expectedRevision: approval.revision, actor: "Scripted engineering fixture (not a human verdict)", expiresAt: new Date(Date.now() + 600000).toISOString(), confirmExecution: true });
    const view = await call("get_status", { jobId: proposed.jobId }), operationId = crypto.randomUUID();
    expect((await call("start", { jobId: proposed.jobId, idempotencyKey: operationId, expectedRevision: view.revision, expectedCandidateTree: view.candidateTree })).outcome).toBe("accepted");
    await service.runner.start();
    for (let n = 0; n < 1200; n++) { const operation = await service.runner.read(operationId); if (["completed", "failed", "uncertain"].includes(operation.status)) break; await Bun.sleep(50); }
    expect((await call("get_status", { jobId: proposed.jobId })).outcome).toBe("review-ready");
    const flow = createAssistantJobFlow(service, { autoAdvance: false });
    await flow.tick(); // Prepares the handover: builds the evidence branch here, sends nothing.
    return { scratch, root, origin, service, flow, jobId: proposed.jobId as string, state: assistantControllerState(root, proposed.jobId), destination, requests: forgeServer.requests, endpoint: forgeServer.endpoint };
}
const remoteBranches = (origin: string) => git(origin, "for-each-ref", "--format=%(refname)", "refs/heads/wringer");

test("Send pushes the branch and opens a pull request whose description is the delivery's mr.md; the page links it", async () => {
    const f = await fixture();
    const ready = validatePmJob(await f.flow.read(f.jobId));
    expect(ready.phase).toBe("send");
    expect(ready.destination).toEqual({ remote: f.destination.remote, sourceBranch: f.destination.sourceBranch, targetBranch: "main", opens: { request: "GitHub pull request", repository: "acme/example", tokenEnv: TOKEN } });
    // Without the token the page says so before the click, and Send is refused before anything is recorded or pushed.
    expect(ready.nextAction).toContain(`Send opens a GitHub pull request with the token in ${TOKEN}, and ${TOKEN} is not set`);
    const send = { jobId: f.jobId, expectedRevision: ready.readyRevision, expectedCandidateTree: ready.candidateTree, preparedId: ready.preparedId };
    const refused = await f.flow.post("send", send).then(() => null, error => error as Error);
    expect(refused?.message).toBe(`Send opens a GitHub pull request with the token in ${TOKEN}, and ${TOKEN} is not set in the environment of the process that sends. Nothing was pushed or sent. Set ${TOKEN} in a terminal, restart this page from it (wring job close, then wring job open, for this workspace), and Send again.`);
    expect(f.requests).toEqual([]); expect(remoteBranches(f.origin)).toBe("");
    // The same refusal holds below the page: the recorded command layer and the delivery itself.
    const publishId = crypto.randomUUID();
    const queued = await queueWorkspaceCommand(f.state, { idempotencyKey: publishId, expectedRevision: ready.revision, expectedCandidateTree: ready.candidateTree, action: "publish", payload: { preparedId: ready.preparedId } }).then(() => null, error => error as Error);
    expect(queued?.message).toContain(`${TOKEN} is not set`);
    expect(await readWorkspaceCommand(f.state, publishId).then(() => "recorded", (error: any) => error.code)).toBe("ENOENT");
    const delivered = await deliverContained({ stateDir: f.state, publication: f.destination as any, send: true }).then(() => null, error => error as Error);
    expect(delivered?.message).toContain("Nothing was pushed or sent.");
    expect(f.requests).toEqual([]); expect(remoteBranches(f.origin)).toBe("");
    // With the token, the same Send pushes and opens the request.
    process.env[TOKEN] = SECRET;
    const again = validatePmJob(await f.flow.read(f.jobId));
    expect(again.phase).toBe("send"); expect(again.nextAction).toContain("Send this exact prepared change to the destination below and open its GitHub pull request?");
    await f.flow.post("send", { ...send, expectedRevision: again.readyRevision });
    let sent = again;
    for (let n = 0; n < 600 && sent.phase !== "sent"; n++) { await Bun.sleep(50); sent = validatePmJob(await f.flow.read(f.jobId)); }
    expect(sent.phase).toBe("sent");
    expect(sent.publication?.status).toBe("published");
    expect(sent.publication?.url).toBe(`${f.endpoint}/acme/example/pull/7`);
    expect(sent.nextAction).toContain("its pull request is open, its description this job's evidence");
    // GitHub was asked once for an existing request, then once to create it, with the token as its credential.
    expect(f.requests.map(r => `${r.method} ${r.path}`)).toEqual(["GET /repos/acme/example/pulls", "POST /repos/acme/example/pulls"]);
    expect(f.requests[0]!.search.get("head")).toBe(`acme:${f.destination.sourceBranch}`); expect(f.requests[0]!.search.get("base")).toBe("main");
    for (const r of f.requests) expect(r.authorization).toBe(`Bearer ${SECRET}`);
    const created = f.requests[1]!.body;
    expect({ head: created.head, base: created.base, title: created.title }).toEqual({ head: f.destination.sourceBranch, base: "main", title: "Make the value true" });
    // The pull request's description is the mr.md a fresh clone of the pushed branch carries, and that clone audits.
    const clone = join(f.scratch, "review"); git(f.scratch, "clone", "--no-local", "--branch", f.destination.sourceBranch, f.origin, clone);
    const bundleDir = join(clone, ".wringer/deliveries", sent.publication!.deliveryId);
    expect(created.body).toBe(await readFile(join(bundleDir, "mr.md"), "utf8"));
    expect(created.body).toContain("Make the value true");
    expect((await auditContained(bundleDir)).status).toBe("passed");
    // The token is in no record, on this computer or in what was sent.
    for (const where of [f.root, clone]) expect(Bun.spawnSync(["grep", "-r", "-l", SECRET, where]).stdout.toString()).toBe("");
    expect(JSON.stringify(f.requests.map(r => r.body))).not.toContain(SECRET);
    await f.flow.stop();
}, 180000);

test("a branch sent whose pull request was refused can be sent again once the cause is fixed: nothing new is pushed, one request is opened", async () => {
    const f = await fixture(1);
    process.env[TOKEN] = SECRET;
    const ready = validatePmJob(await f.flow.read(f.jobId));
    await f.flow.post("send", { jobId: f.jobId, expectedRevision: ready.readyRevision, expectedCandidateTree: ready.candidateTree, preparedId: ready.preparedId });
    let page = ready;
    for (let n = 0; n < 600; n++) { await Bun.sleep(50); page = validatePmJob(await f.flow.read(f.jobId)); if (page.phase !== "working" && page.readyRevision !== ready.readyRevision) break; }
    // The branch went; GitHub refused the request. The page says why and offers Send again.
    expect(page.phase).toBe("send");
    expect(page.nextAction).toBe("The branch was sent, but its GitHub pull request was not opened: Forge create returned HTTP 403. Fix that (for example the token's permissions), then Send again: nothing new is pushed, and Wringer looks for an existing request before it opens one.");
    const tip = git(f.origin, "rev-parse", `refs/heads/${f.destination.sourceBranch}`);
    expect(f.requests.map(r => r.method)).toEqual(["GET", "POST"]);
    await f.flow.post("send", { jobId: f.jobId, expectedRevision: page.readyRevision, expectedCandidateTree: page.candidateTree, preparedId: page.preparedId });
    for (let n = 0; n < 600 && page.phase !== "sent"; n++) { await Bun.sleep(50); page = validatePmJob(await f.flow.read(f.jobId)); }
    expect(page.phase).toBe("sent"); expect(page.publication?.url).toBe(`${f.endpoint}/acme/example/pull/7`);
    // One push in all: the second Send found the branch already at the evidence commit. The forge was searched again first.
    expect(git(f.origin, "rev-parse", `refs/heads/${f.destination.sourceBranch}`)).toBe(tip);
    expect((await readFile(join(f.scratch, "ssh.log"), "utf8")).split("\n").filter(line => line.startsWith("git-receive-pack")).length).toBe(1);
    expect(f.requests.map(r => r.method)).toEqual(["GET", "POST", "GET", "POST"]);
    // Once open, Send is not offered again, and a further publish is refused.
    const queued = await queueWorkspaceCommand(f.state, { idempotencyKey: crypto.randomUUID(), expectedRevision: page.revision, expectedCandidateTree: page.candidateTree, action: "publish", payload: { preparedId: ready.preparedId } }).then(() => null, error => error as Error);
    expect(queued?.message).toContain("already been sent");
    await f.flow.stop();
}, 180000);
