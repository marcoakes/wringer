import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDeclaration, compileExecutionPlan, createExecutionAuthority, hashBytes, hashValue, type EnvironmentMap } from "@wringer/plan";
import { controllerStatus, immutableControllerFile, resumeController } from "@wringer/application";
import { runContainedJourney, type CandidateVerification } from "@wringer/workflow";
import type { RoleExecutionResult } from "@wringer/runtime";
import { containedWorkspace, createPmWorkspaceServer, readPmWorkspace } from "../src/workspace";

// Real loopback HTTP and the real durable controller reader. Role/check facts
// are explicitly synthetic; no provider, container, or repository code runs.
const roots: string[] = [];
const servers: Awaited<ReturnType<typeof createPmWorkspaceServer>>["server"][] = [];
afterEach(async () => {
    for (const server of servers.splice(0)) await server.stop(true);
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
async function fixture() {
    const state = await mkdtemp(join(tmpdir(), "wringer-workspace-http-"));
    roots.push(state);
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = compileExecutionPlan(template, { format: "yaml" });
    const declaration = structuredClone(raw);
    declaration.name = "PRIVATE_PROJECT_WORKSPACE_HTTP";
    declaration.intent += " PRIVATE_INTENT_WORKSPACE_HTTP: The display is readable.";
    declaration.repository = { url: "https://example.invalid/private/workspace.git", commit: "a".repeat(40) };
    declaration.runtime.env = [];
    declaration.agents.worker.env = [];
    declaration.agents.judge.env = [];
    declaration.acceptance.criteria.push({ id: "readable", title: "Private human criterion", quote: "The display is readable.", kind: "human", required: true, show: { id: "show-readable", argv: ["bun", "run", "demo"], cwd: ".", timeout_seconds: 30 } });
    const plan = compileDeclaration({ version: 1, ...declaration });
    const files = ["README.md", ...plan.acceptance.checks.flatMap(c => c.files)].map(path => ({ path, mode: "100644", blob: "f".repeat(40) }));
    const map: Omit<EnvironmentMap, "map_sha256"> = { schema_version: "wringer.environment-map.v1", repository: plan.repository, plan_sha256: plan.plan_sha256, source_tree: "a".repeat(40), inventory_sha256: hashValue(files), files, context: [{ path: "README.md", blob: "f".repeat(40), text: "Synthetic HTTP fixture", sha256: hashBytes("Synthetic HTTP fixture") }], components: [], tools: plan.environment.tools.map(t => ({ ...t, observation: null })), baseline: plan.environment.baseline.map(declaration => ({ declaration, observation: null })), protected_paths: plan.acceptance.protected_paths, writable_paths: plan.scope.writable, limits: ["Synthetic fixture; no live agent or containment measured"] };
    const environment = { ...map, map_sha256: hashValue(map) };
    const authority = createExecutionAuthority(plan, { actor: "PRIVATE_OPERATOR_WORKSPACE_HTTP", actions: ["plan", "build", "verify", "judge"], expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString() });
    await writeFile(join(state, "plan.json"), JSON.stringify(plan));
    await writeFile(join(state, "authority.json"), JSON.stringify(authority));
    await writeFile(join(state, "environment.json"), JSON.stringify(environment));
    await writeFile(join(state, "prepared-source.json"), JSON.stringify({ ...plan.repository, objectStore: join(state, "unused-synthetic.git"), bundlePath: join(state, "unused-synthetic.bundle") }));
    let roleCalls = 0;
    const candidate = { source: { ...plan.repository, commit: "b".repeat(40) }, tree: "c".repeat(40), changedPaths: ["src/private-value.ts"] };
    const result = await runContainedJourney({ controllerDir: state, plan, authority, environment,
        services: {
            prepareSource: async source => source,
            captureCandidate: async () => candidate,
            verifyCandidate: async request => ({ schema_version: "wringer.contained-verification.v1", status: request.phase === "baseline" ? "failed" : "passed", candidateCommit: request.source.commit, candidateTree: request.phase === "baseline" ? environment.source_tree : candidate.tree, acceptanceSha256: plan.acceptance_sha256, runtimeId: randomUUID(), image: plan.runtime.image, checks: plan.acceptance.checks.map(c => ({ id: c.id, status: request.phase === "baseline" ? "failed" : "passed", exitCode: request.phase === "baseline" ? 1 : 0, checkInputsSha256: "d".repeat(64), outputSha256: "e".repeat(64) })), regressions: plan.environment.baseline.map(c => ({ id: c.id, status: "passed", exitCode: 0, outputSha256: "e".repeat(64) })), evidenceRef: `synthetic-http-fixture/${request.effectId}` }) as CandidateVerification,
        },
        executeRole: async request => {
            roleCalls++;
            return { status: "completed", text: request.role === "worker" ? "PRIVATE_WORKER_NARRATIVE_HTTP" : JSON.stringify({ criteria: plan.acceptance.criteria.filter(c => c.kind === "check").map(c => ({ id: c.id, met: true, reason: "Synthetic independent review" })), note: "No real agent was exercised" }), sessionId: randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "workspace-http-fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, usage: { inputTokens: 10, outputTokens: 5 }, events: [], stderr: "", provenance: { schema_version: "wringer.runtime.v1", runtimeId: randomUUID(), role: request.role, kind: request.runtime.kind, image: request.runtime.image, repository: request.repo, clonedInside: true, hostMounts: [], repositoryAccess: request.role === "worker" ? "read-write" : "read-only", declared: request.runtime, observed: { fixture: true }, limits: ["Synthetic result; no live containment or provider"] } } as RoleExecutionResult;
        },
    });
    expect(result.status).toBe("human-hold");
    expect(roleCalls).toBe(2);
    const workspace = await createPmWorkspaceServer(state, { port: 0, executeRole: async () => { throw new Error("HTTP security tests must not invoke an agent"); }, runCommands: async () => { throw new Error("HTTP security tests must not execute repository code"); } });
    servers.push(workspace.server);
    const token = new URLSearchParams(new URL(workspace.url).hash.slice(1)).get("token")!;
    const auth = { authorization: `Bearer ${token}` };
    const events = () => readdir(join(state, ".wringer/contained/events"));
    return { ...workspace, state, plan, authority, result, token, auth, events, roleCalls: () => roleCalls };
}

describe("private PM workspace HTTP boundary", () => {
    test("the public bootstrap is generic, credential-free and protected by restrictive browser headers", async () => {
        const f = await fixture(), before = await f.events();
        const response = await fetch(f.origin + "/"), html = await response.text();
        expect(response.status).toBe(200);
        expect(html).toContain("Wringer delivery workspace");
        expect(html).toContain("connection-pending");
        for (const privateValue of [f.plan.name, "PRIVATE_INTENT_WORKSPACE_HTTP", "PRIVATE_OPERATOR_WORKSPACE_HTTP", "PRIVATE_WORKER_NARRATIVE_HTTP", f.plan.repository.url, f.result.journeyId, f.result.candidate!.source.commit, f.state, f.token]) expect(html).not.toContain(privateValue);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("x-frame-options")).toBe("DENY");
        const policy = response.headers.get("content-security-policy")!;
        expect(policy).toContain("default-src 'none'");
        expect(policy).toContain("connect-src 'self'");
        expect(policy).toContain("frame-ancestors 'none'");
        expect(policy).not.toContain("unsafe-inline");
        const nonce = /script-src 'nonce-([^']+)'/.exec(policy)![1]!;
        expect(html).toContain(`nonce="${nonce}"`);
        expect(new URL(f.url).search).toBe("");
        expect(new URL(f.url).hash).toBe(`#token=${f.token}`);
        expect((await fetch(`${f.origin}/?token=${f.token}`)).status).toBe(401);
        expect(await f.events()).toEqual(before);
    });

    test("only the exact current bearer unlocks private state, never a query parameter or cookie", async () => {
        const f = await fixture();
        const unauthorized: Record<string, string>[] = [{}, { authorization: `Bearer ${"0".repeat(64)}` }, { authorization: `Basic ${f.token}` }, { authorization: `Bearer ${f.token}x` }, { cookie: `token=${f.token}` }];
        for (const headers of unauthorized) {
            const response = await fetch(`${f.origin}/api/state?token=${f.token}`, { headers });
            expect(response.status).toBe(401);
            const body = await response.text();
            expect(body).not.toContain(f.plan.intent);
            expect(body).not.toContain(f.result.journeyId);
            expect(response.headers.get("access-control-allow-origin")).toBeNull();
        }
        const response = await fetch(`${f.origin}/api/state`, { headers: f.auth });
        expect(response.status).toBe(200);
        const body = await response.text();
        expect(JSON.parse(body).intent).toBe(f.plan.intent);
        expect(body).not.toContain(f.token);
        expect(body).not.toContain("PRIVATE_WORKER_NARRATIVE_HTTP");
        expect(f.roleCalls()).toBe(2);
    });

    test("host rebinding and foreign browser origins are denied even with a valid bearer", async () => {
        const f = await fixture();
        for (const headers of [
            { ...f.auth, host: "attacker.example" },
            { ...f.auth, host: `localhost:${new URL(f.origin).port}` },
            { ...f.auth, origin: "https://attacker.example" },
            { ...f.auth, origin: "null" },
            { ...f.auth, origin: f.origin, "sec-fetch-site": "cross-site" },
        ]) {
            const response = await fetch(`${f.origin}/api/state`, { headers });
            expect(response.status).toBe(403);
            expect(await response.text()).not.toContain(f.plan.intent);
        }
        expect((await fetch(f.origin + "/", { headers: { host: "attacker.example" } })).status).toBe(403);
        expect((await fetch(`${f.origin}/api/state`, { headers: { ...f.auth, origin: f.origin, "sec-fetch-site": "same-origin" } })).status).toBe(200);
    });

    test("POST requires bearer, exact Origin and explicit JSON before accepting any command", async () => {
        const f = await fixture(), before = await f.events();
        const post = (headers: Record<string, string>, body = "{}") => fetch(`${f.origin}/api/commands`, { method: "POST", headers, body });
        expect((await post({ origin: f.origin, "content-type": "application/json" })).status).toBe(401);
        const rejectedOrigins: Record<string, string>[] = [{}, { origin: "https://attacker.example" }, { origin: "null" }, { origin: f.origin, "sec-fetch-site": "cross-site" }];
        for (const extra of rejectedOrigins) expect((await post({ ...f.auth, "content-type": "application/json", ...extra })).status).toBe(403);
        const allowed = { ...f.auth, origin: f.origin };
        expect((await post({ ...allowed, "content-type": "text/plain" })).status).toBe(415);
        expect((await post({ ...allowed, "content-type": "application/jsonp" })).status).toBe(415);
        expect((await post({ ...allowed, "content-type": "application/json-invalid" })).status).toBe(415);
        expect((await post(allowed)).status).toBe(415);
        expect((await post({ ...allowed, "content-type": "application/json" }, "{invalid json")).status).toBe(409);
        expect((await post({ ...allowed, "content-type": "application/json; charset=utf-8" })).status).toBe(409);
        const unsafe = { idempotencyKey: randomUUID(), expectedRevision: (await controllerStatus(f.state)).revision, expectedCandidateTree: f.result.candidate!.tree, action: "resume", payload: { command: "unexpected executable" } };
        expect((await post({ ...allowed, "content-type": "application/json" }, JSON.stringify(unsafe))).status).toBe(409);
        expect((await fetch(`${f.origin}/api/unknown`, { headers: f.auth })).status).toBe(404);
        expect(await f.events()).toEqual(before);
        expect(f.roleCalls()).toBe(2);
    });

    test("read-only API and saved projection agree with the journal, not a substituted summary", async () => {
        const f = await fixture(), before = await f.events();
        const query = await controllerStatus(f.state), expected = await readPmWorkspace(f.state);
        const read = async () => {
            const response = await fetch(`${f.origin}/api/state`, { headers: f.auth });
            expect(response.status).toBe(200);
            return response.json();
        };
        expect(await read()).toEqual(expected);
        expect(expected.revision).toBe(query.revision);
        expect(expected.candidate?.tree).toBe(query.result.candidate?.tree);
        expect(expected.status).toBe("human-hold");
        expect(expected.criteria.find(c => c.id === "total")?.state).toBe("met");
        expect(expected.criteria.find(c => c.id === "readable")?.state).toBe("unknown");
        expect(expected.checks[0]).toEqual({ id: "total-check", before: { status: "failed", exitCode: 1 }, after: { status: "passed", exitCode: 0 } });
        expect(expected.usage).toEqual({ sessions: 2, ceiling: f.plan.budget.max_sessions, inputTokens: 20, outputTokens: 10, costUsd: null });
        expect(expected.actions.find(a => a.id === "publish")?.enabled).toBe(false);
        await writeFile(join(f.state, ".wringer/contained/result.json"), JSON.stringify({ ...f.result, status: "review-ready", sessions: 0, candidate: { ...f.result.candidate, tree: "9".repeat(40) } }));
        expect(await read()).toEqual(expected);
        const path = join(f.state, "readonly.html"), snapshot = await containedWorkspace(f.state, { port: 0, output: path });
        expect((snapshot.value as { view: unknown }).view).toEqual(expected);
        expect(snapshot.text).toContain("cannot approve, run or publish");
        const html = await readFile(path, "utf8");
        expect(html).toContain("PRIVATE_INTENT_WORKSPACE_HTTP");
        expect(html).toContain("connect-src 'none'");
        expect(html).not.toContain("<script");
        expect(html).not.toContain("data-action=");
        expect(await f.events()).toEqual(before);
        expect(f.roleCalls()).toBe(2);
    });

    test("controller resume accepts reordered JSON but refuses a changed approval without overwriting it", async () => {
        const f = await fixture();
        const reorder = (value: any): any => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
        for (const [name, value] of Object.entries({ "plan.json": f.plan, "authority.json": f.authority })) await writeFile(join(f.state, name), JSON.stringify(reorder(value)));
        const beforeAuthority = await readFile(join(f.state, "authority.json"), "utf8");
        const resumed = await resumeController(f.state, { executeRole: async () => { throw new Error("A parked human hold must not replay an agent"); }, runCommands: async () => { throw new Error("A parked human hold must not repeat checks"); } });
        expect(resumed.status).toBe("human-hold");
        expect(resumed.journeyId).toBe(f.result.journeyId);
        expect(resumed.sessions).toBe(2);
        expect(resumed.candidate).toEqual(f.result.candidate);
        await expect(immutableControllerFile(join(f.state, "authority.json"), { ...f.authority, actor: "Different operator" })).rejects.toThrow("retained approval");
        expect(await readFile(join(f.state, "authority.json"), "utf8")).toBe(beforeAuthority);
        expect((await controllerStatus(f.state)).result.sessions).toBe(2);
        expect((await readdir(f.state)).filter(name => name.endsWith(".tmp"))).toEqual([]);
    });
});
