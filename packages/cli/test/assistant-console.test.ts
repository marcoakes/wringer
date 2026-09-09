import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDeclaration, compileExecutionPlan, hashValue } from "@wringer/plan";
import { createAssistantService, initializeAssistant, issueAssistantCapability } from "../../application/src/assistant";
import { createAssistantConsole, renderAssistantConsole, superviseAssistantReview } from "../src/assistant-console";
import { connectImprovements } from "../../application/src/improvements";
import { withImprovementCard } from "../../board/src/improvements-render";

const roots: string[] = [];
const consoles: Awaited<ReturnType<typeof createAssistantConsole>>[] = [];
afterEach(async () => {
    for (const console of consoles.splice(0)) await console.stop();
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const template = compileExecutionPlan(await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });

async function fixture(questions: string[] = [], options: Parameters<typeof createAssistantConsole>[1] = {}) {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-assistant-console-"))); roots.push(root);
    const { schema_version, plan_sha256, acceptance_sha256, intent_sha256, ...base } = template;
    const declaration = { version: 1, ...base, name: "PRIVATE_CONSOLE_PROJECT", intent: "Return the total as 5. Preserve <script>private-request</script> literally." };
    const plan = compileDeclaration(declaration);
    const { workspace } = await initializeAssistant(root, { cooperativeLocal: true, plan });
    const capability = await issueAssistantCapability(root, new Date(Date.now() + 3600000).toISOString());
    let dispatches = 0;
    const service = await createAssistantService(root, { dependencies: { start: async () => { dispatches++; throw new Error("This HTTP fixture must never invoke an agent"); } } });
    const submitted = await service.call(capability.token, "wringer.propose", { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), intent: plan.intent, plan: questions.length ? null : declaration, questions, assumptions: ["PRIVATE_ASSUMPTION: the existing check captures the requested total"] });
    expect(submitted.outcome).toBe(questions.length ? "needs-decision" : "awaiting-approval");
    const jobId = submitted.jobId as string, proposal = await service.inspectProposal(jobId);
    const console = await createAssistantConsole(service, options); consoles.push(console);
    const token = new URLSearchParams(new URL(console.url).hash.slice(1)).get("token")!;
    const auth = { authorization: `Bearer ${token}` };
    const body = { jobId, expectedRevision: hashValue(proposal), actor: "Human fixture operator", expiresAt: new Date(Date.now() + 1800000).toISOString(), confirmExecution: true };
    const post = (path: string, value: unknown, extra: Record<string, string> = {}) => fetch(console.origin + path, { method: "POST", headers: { ...auth, origin: console.origin, "content-type": "application/json", ...extra }, body: JSON.stringify(value) });
    return { root, service, capability, plan, proposal, console, token, auth, jobId, body, post, dispatches: () => dispatches };
}

describe("assistant operator console rendering", () => {
    test("static shell is generic, parses as JavaScript, and never interpolates evidence into HTML", () => {
        const html = renderAssistantConsole("fixtureNonce");
        expect(html).toContain("What should I do now?");
        expect(html).toContain("Cooperative-local engineering preview");
        expect(html).toContain("history.replaceState(null, '', location.pathname)");
        expect(html).toContain("node.textContent = text");
        expect(html).not.toContain("innerHTML");
        expect(html).not.toContain("localStorage");
        expect(html).not.toContain("sessionStorage");
        expect(html).not.toContain("eval(");
        expect(html).not.toContain("record_human_verdict");
        expect(html).not.toContain("PRIVATE_CONSOLE_PROJECT");
        const script = /<script nonce="fixtureNonce">([\s\S]*?)<\/script>/.exec(html)![1]!;
        expect(() => new Function(script)).not.toThrow();
        expect(() => renderAssistantConsole('bad" nonce')).toThrow("nonce");
    });

    test("review supervision cancels admitted work after cancellation, unreadable ownership or shutdown", async () => {
        for (const reason of ["cancelled", "unreadable", "stopping", "close"]) {
            let stopping = false, refused = false, cancelled = 0;
            const supervision = superviseAssistantReview({ assertJobActive: async () => { if (refused) throw new Error(reason); } }, crypto.randomUUID(), () => stopping);
            supervision.signal.addEventListener("abort", () => { cancelled++; }, { once: true });
            // Simulate a command that already passed admission and is observing
            // its real owning signal. No provider or repository code executes.
            expect(supervision.signal.aborted).toBe(false);
            if (reason === "stopping") stopping = true;
            else if (reason === "close") supervision.stop();
            else refused = true;
            const deadline = Date.now() + 1500;
            while (!supervision.signal.aborted && Date.now() < deadline) await Bun.sleep(10);
            expect(supervision.signal.aborted).toBe(true);
            expect(cancelled).toBe(1);
            supervision.stop();
            expect(cancelled).toBe(1);
        }
    });
});

// Real loopback boundary with deterministic application records; no providers,
// runtime containers, source commands, or genuine human observations are used.
describe("assistant operator console HTTP boundary", () => {
    test("optional improvement view is private, offline, repository-scoped and cannot impersonate approval", async () => {
        const f = await fixture([], { guided: true });
        const outside = await realpath(await mkdtemp(join(tmpdir(), "wringer-research-connection-"))); roots.push(outside);
        const registry = join(outside, "adoption-registry"); await mkdir(registry, { mode: 0o700 });
        expect((await fetch(f.console.origin + "/api/improvements")).status).toBe(401);
        const before = await fetch(f.console.origin + "/api/improvements", { headers: f.auth }).then(r => r.json());
        expect(before.connected).toBe(false);
        await connectImprovements(f.root, { researchRoot: outside, registryRoot: registry, taskFamily: "reports" });
        const response = await fetch(f.console.origin + "/api/improvements", { headers: f.auth });
        const view = await response.json(); expect(view.connected).toBe(true); expect(view.experiments).toEqual([]);
        expect(JSON.stringify(view)).not.toContain(outside); expect(JSON.stringify(view)).not.toContain(f.token);
        const tool = await f.service.call(f.capability.token, "wringer.inspect_improvements", {});
        expect(tool.outcome).toBe("observed");
        for (const name of ["wringer.promote", "wringer.collect", "wringer.rollback", "wringer.approve"]) expect((await f.service.call(f.capability.token, name, {})).outcome).toBe("refused");
        expect((await f.post("/api/improvements/collect", { experimentId: "../outside", expectedPlanSha256: "a".repeat(64), actor: "Fixture", expiresAt: new Date(Date.now() + 60000).toISOString() })).status).toBe(409);
        expect((await f.post("/api/improvements/promote", { experimentId: "missing", actor: "Fixture", note: "No evidence", expectedRevision: view.revision, expectedCurrentDigest: null, expectedEvidenceRevision: "a".repeat(64) })).status).toBe(409);
        expect((await f.post("/api/improvements/rollback", { expectedRevision: view.revision, path: outside })).status).toBe(409);
        expect(await f.service.inspectApproval(f.jobId)).toBeNull(); expect(f.dispatches()).toBe(0);
    });
    test("improvement script parses, uses inert text and keeps production action routes absent", () => {
        const html = withImprovementCard("<main></main></body>", "fixtureNonce");
        const script = /<script nonce="fixtureNonce">([\s\S]*?)<\/script>/.exec(html)![1]!;
        expect(() => new Function(script)).not.toThrow();
        expect(html).toContain("Use for future work"); expect(html).toContain("Test this improvement");
        expect(html).not.toContain("innerHTML"); expect(html).not.toContain("/api/job/send"); expect(html).not.toContain("localStorage");
    });
    test("shutdown closes new operator decisions while retained jobs remain readable", async () => {
        let stopping = false;
        const f = await fixture([], { isStopping: () => stopping });
        const before = await fetch(f.console.origin + "/api/jobs", { headers: f.auth }).then(response => response.json());
        expect(before.jobs[0].canApprove).toBe(true);
        stopping = true;
        const after = await fetch(f.console.origin + "/api/jobs", { headers: f.auth }).then(response => response.json());
        expect(after.jobs[0].canApprove).toBe(false);
        expect(after.jobs[0].canReview).toBe(false);
        expect(after.jobs[0].proposal.intent).toBe(f.plan.intent);
        expect(after.jobs[0].status.nextAction).toContain("owner is stopping");
        expect((await f.post("/api/approve", f.body)).status).toBe(409);
        expect((await f.post("/api/review", { jobId: f.jobId })).status).toBe(409);
        expect((await f.service.status(f.jobId)).outcome).toBe("awaiting-approval");
        expect(f.dispatches()).toBe(0);
    });

    test("public shell contains no job facts or token and uses restrictive browser headers", async () => {
        const f = await fixture();
        const response = await fetch(f.console.origin), html = await response.text();
        expect(response.status).toBe(200);
        for (const privateValue of [f.plan.name, f.plan.intent, f.jobId, f.token, f.capability.token, f.root]) expect(html).not.toContain(privateValue);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.get("x-frame-options")).toBe("DENY");
        const policy = response.headers.get("content-security-policy")!;
        expect(policy).toContain("default-src 'none'");
        expect(policy).toContain("frame-ancestors 'none'");
        expect(policy).not.toContain("unsafe-inline");
        expect((await fetch(f.console.origin + "/?token=" + f.token)).status).toBe(401);
        expect(f.dispatches()).toBe(0);
    });

    test("assistant capability, cookies, alternate host and foreign origins cannot use operator endpoints", async () => {
        const f = await fixture();
        const unauthorized: Record<string, string>[] = [{}, { authorization: `Bearer ${f.capability.token}` }, { cookie: `token=${f.token}` }];
        for (const headers of unauthorized) {
            const response = await fetch(f.console.origin + "/api/jobs", { headers });
            expect(response.status).toBe(401);
            expect(await response.text()).not.toContain(f.plan.name);
        }
        const foreign: Record<string, string>[] = [{ host: "attacker.example" }, { origin: "https://attacker.example" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }];
        for (const extra of foreign) {
            expect((await fetch(f.console.origin + "/api/jobs", { headers: { ...f.auth, ...extra } })).status).toBe(403);
        }
        expect((await f.post("/api/approve", f.body, { authorization: `Bearer ${f.capability.token}` })).status).toBe(401);
        expect((await f.post("/api/approve", f.body, { origin: "" })).status).toBe(403);
        expect((await f.post("/api/approve", f.body, { "content-type": "text/plain" })).status).toBe(415);
        expect((await f.post("/api/publish", f.body)).status).toBe(404);
        expect((await f.post("/api/human-verdict", f.body)).status).toBe(404);
        expect(f.dispatches()).toBe(0);
    });

    test("a private-link exchange survives refresh without a bearer and logout revokes only that browser", async () => {
        const f = await fixture();
        const exchange = await f.post("/api/session", {}, { "x-wringer-console": "1" });
        expect(exchange.status).toBe(200);
        const setCookie = exchange.headers.get("set-cookie")!, cookie = setCookie.split(";", 1)[0]!;
        expect(setCookie).toContain("HttpOnly"); expect(setCookie).not.toContain(f.token);
        expect(JSON.stringify(await exchange.json())).not.toContain(f.token);
        const browser = { cookie, "x-wringer-console": "1", "sec-fetch-site": "same-origin" };
        for (let refresh = 0; refresh < 2; refresh++) {
            const response = await fetch(f.console.origin + "/api/jobs", { headers: browser });
            expect(response.status).toBe(200); expect((await response.json()).jobs[0].proposal.intent).toBe(f.plan.intent);
        }
        expect((await fetch(f.console.origin + "/api/jobs", { headers: { cookie } })).status).toBe(403);
        expect((await fetch(f.console.origin + "/api/jobs", { headers: { ...browser, origin: "https://attacker.example" } })).status).toBe(403);
        expect((await fetch(f.console.origin + "/api/approve", { method: "POST", headers: { ...browser, "content-type": "application/json" }, body: JSON.stringify(f.body) })).status).toBe(403);
        expect((await fetch(f.console.origin + "/api/session", { method: "POST", headers: { ...browser, origin: f.console.origin, "content-type": "application/json" }, body: "{}" })).status).toBe(403);
        const lock = await fetch(f.console.origin + "/api/logout", { method: "POST", headers: { ...browser, origin: f.console.origin, "content-type": "application/json" }, body: "{}" });
        expect(lock.status).toBe(200); expect(lock.headers.get("set-cookie")).toContain("Max-Age=0");
        expect((await fetch(f.console.origin + "/api/jobs", { headers: browser })).status).toBe(401);
        expect((await fetch(f.console.origin + "/api/jobs", { headers: f.auth })).status).toBe(200);
        expect((await f.service.status(f.jobId)).outcome).toBe("awaiting-approval"); expect(f.dispatches()).toBe(0);
    });

    test("private jobs show original words, exact proposal revision, two usage lanes and no approval token", async () => {
        const f = await fixture(["Should the total include the archived rows?"]);
        const response = await fetch(f.console.origin + "/api/jobs", { headers: f.auth });
        expect(response.status).toBe(200);
        const value = await response.json(), row = value.jobs[0];
        expect(row.proposal.intent).toBe(f.plan.intent);
        expect(row.proposal.questions).toEqual(["Should the total include the archived rows?"]);
        expect(row.proposal.assumptions).toEqual(f.proposal.assumptions);
        expect(row.proposalRevision).toBe(hashValue(f.proposal));
        expect(row.status.usage.codingApp.cost).toBeNull();
        expect(row.status.usage.development.cost).toBeNull();
        expect(row.canApprove).toBe(false);
        expect(row.canReview).toBe(false);
        expect(JSON.stringify(value)).not.toContain(f.token);
        expect(JSON.stringify(value)).not.toContain(f.capability.token);
        expect((await f.post("/api/approve", f.body)).status).toBe(409);
        expect(f.dispatches()).toBe(0);
    });

    test("approval requires exact revision, name, future expiry and explicit confirmation, and does not start work", async () => {
        const f = await fixture();
        for (const change of [{ confirmExecution: false }, { expectedRevision: "0".repeat(64) }, { actor: "" }, { expiresAt: "2001-01-01T00:00:00.000Z" }, { publish: true }]) {
            expect((await f.post("/api/approve", { ...f.body, ...change })).status).toBe(409);
        }
        expect((await f.service.status(f.jobId)).outcome).toBe("awaiting-approval");
        const approved = await f.post("/api/approve", f.body);
        expect(approved.status).toBe(200);
        expect((await approved.json()).outcome).toBe("approved");
        const status = await f.service.status(f.jobId);
        expect(status.outcome).toBe("approved");
        expect(status.operations).toEqual([]);
        expect(f.dispatches()).toBe(0);
        expect((await f.post("/api/review", { jobId: f.jobId })).status).toBe(409);
    });

    test("cancelled proposals cannot be approved or reopened as an execution workspace", async () => {
        const f = await fixture(), before = await f.service.status(f.jobId);
        const result = await f.service.call(f.capability.token, "wringer.cancel", { jobId: f.jobId, idempotencyKey: crypto.randomUUID(), expectedRevision: before.revision, expectedCandidateTree: before.candidateTree });
        expect(result.outcome).toBe("cancelled");
        expect((await f.post("/api/approve", f.body)).status).toBe(409);
        expect((await f.post("/api/review", { jobId: f.jobId })).status).toBe(409);
        expect(f.dispatches()).toBe(0);
    });
});
