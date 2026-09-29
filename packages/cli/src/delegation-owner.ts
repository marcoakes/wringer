import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Redactor } from "@wringer/engine";
import { renderPmJobWorkspace } from "@wringer/board";
import { assistantId, assistantInventory, assistantPath, createAssistantService, createDelegationProtocol, delegationControllerRoot, issueAssistantCapability, readDelegationContext, readDelegationJob, readWorkspace, retainDelegationJob } from "@wringer/application";
import { parseDelegationCall, parseMcpJson, validateDelegationOutput } from "@wringer/mcp";
import { createAssistantTransport } from "./assistant-transport";
import { createOperatorBrowserSessions } from "./operator-browser-session";
import { createAssistantJobFlow } from "./assistant-job";
import { withImprovementCard } from "../../board/src/improvements-render";
import { inspectJobImprovements, decideImprovement } from "@wringer/application";
import { improvementCollections } from "./improvement-collections";
type Context = Awaited<ReturnType<typeof readDelegationContext>>;
/** One operator origin and scoped connection; each source context retains its
 * original controller, approval, destination and runner reservations. */
export async function createDelegationOwner(root: string, workspaceId: string) {
    const workspace = await readWorkspace(root, workspaceId);
    if (workspace.mode !== "delegation") throw new Error("This owner requires the selected contained delegation mode");
    const ownerRoot = await assistantPath(root, `owners/${assistantId(workspaceId)}`); await mkdir(ownerRoot, { recursive: true, mode: 0o700 });
    const lockPath = join(ownerRoot, "owner.lock"), lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("An owner is active or needs explicit recovery; opening does not replace it"); });
    const token = randomBytes(32).toString("hex"), operatorToken = randomBytes(32).toString("hex"), nonce = randomBytes(16).toString("hex"), redactor = new Redactor();
    const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` };
    const sessions = createOperatorBrowserSessions(operatorToken, headers), json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    let origin = "", closed = false, stopped = false, refreshTimer: ReturnType<typeof setInterval> | undefined, refreshing = false;
    let server: ReturnType<typeof Bun.serve> | undefined, transport: ReturnType<typeof createAssistantTransport> | undefined;
    const created: string[] = [], active = new Map<string, Promise<Loaded>>(), observations = new Map<string, Promise<Loaded>>();
    const capabilities = new Map<string, Awaited<ReturnType<typeof issueAssistantCapability>>>(), activationErrors = new Map<string, string>();
    const collections = improvementCollections(() => { if (closed) throw new Error("Owner is stopping; no new research is accepted"); });
    type Loaded = Awaited<ReturnType<typeof observeContext>>;
    async function observeContext(context: Context) {
        if (closed) throw new Error("Owner is stopping");
        const capability = capabilities.get(context.id);
        if (!capability) throw new Error("This prepared context is still connecting. Retry observation shortly; reads never start a runner");
        const controller = await createAssistantService(await delegationControllerRoot(root, workspaceId, context.id));
        const flow = createAssistantJobFlow(controller, { isStopping: () => closed, autoAdvance: false });
        controller.setPresentation(async jobId => { const shown = await flow.read(jobId); return { phase: shown.phase, nextAction: shown.nextAction, eventId: shown.readyRevision, observedRevision: shown.revision, observedCandidateTree: shown.candidateTree, pageUrl: `${origin}/?jobId=${jobId}` }; });
        return { context, controller, flow, capability, protocol: createDelegationProtocol(controller) };
    }
    function load(context: Context) {
        const running = active.get(context.id); if (running) return running;
        let value = observations.get(context.id);
        if (!value) {
            // Passive history has no runner or timer. Eviction cannot cancel work.
            if (observations.size >= 64) observations.delete(observations.keys().next().value!);
            value = observeContext(context); observations.set(context.id, value);
            void value.catch(() => { if (observations.get(context.id) === value) observations.delete(context.id); });
        }
        return value;
    }
    async function activate(context: Context) {
        const running = active.get(context.id); if (running) return running;
        if (active.size >= 128) throw new Error("128 execution contexts are active; retained history remains readable. Stop completed work before admitting another context");
        const value = (async () => {
            const current = await load(context);
            await current.controller.runner.start();
            current.flow.start(); activationErrors.delete(context.id);
            return current;
        })();
        active.set(context.id, value);
        try { return await value; }
        catch (error) { active.delete(context.id); activationErrors.set(context.id, "runner-admission-refused-inspect-recovery"); throw error; }
    }
    async function activatePreparedContexts() {
        if (refreshing || closed) return;
        refreshing = true;
        try {
            for (const name of await assistantInventory(root, `delegation-contexts/${workspaceId}`)) {
                if (closed) break;
                if (!/^[a-f0-9-]{36}\.json$/.test(name) || capabilities.has(name.slice(0, -5))) continue;
                try {
                const context = await readDelegationContext(root, workspaceId, name.slice(0, -5));
                const controllerRoot = await delegationControllerRoot(root, workspaceId, context.id);
                capabilities.set(context.id, await issueAssistantCapability(controllerRoot, new Date(Date.now() + 7 * 86400000).toISOString()));
                const current = await load(context);
                // Only an existing unexpired grant can enter the convenience
                // scheduler. Uncertain operations remain visible for reconciliation.
                for (const job of await current.controller.list()) {
                    const approval = await current.controller.inspectApproval(job.jobId);
                    if (approval && Date.parse(approval.authority.expires_at) > Date.now() && !job.uncertainty && !["cancelled", "superseded", "branch-pushed", "published", "merged", "closed"].includes(job.outcome)) {
                        try { await activate(context); } catch { /* Retained in activationErrors; reads remain available. */ }
                        break;
                    }
                }
                } catch { activationErrors.set(name.slice(0, -5), "context-preparation-incomplete-inspect-retained-records"); }
            }
        } finally { refreshing = false; }
    }
    async function selected(jobId: string) {
        const job = await readDelegationJob(root, assistantId(jobId));
        if (job.workspaceId !== workspaceId) throw new Error("Job belongs to another workspace");
        return load(await readDelegationContext(root, workspaceId, job.contextId));
    }
    async function latest() {
        const all: Context[] = [];
        for (const name of await assistantInventory(root, `delegation-contexts/${workspaceId}`)) if (/^[a-f0-9-]{36}\.json$/.test(name)) all.push(await readDelegationContext(root, workspaceId, name.slice(0, -5)));
        all.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        if (!all.length) throw new Error("Prepare a delegation job with wring job new before connecting; setup alone grants no job");
        return load(all.at(-1)!);
    }
    async function list() {
        const jobs = [];
        for (const id of await assistantInventory(root, "delegation-jobs")) {
            if (!/^[a-f0-9-]{36}\.json$/.test(id)) continue;
            const job = await readDelegationJob(root, id.slice(0, -5)); if (job.workspaceId === workspaceId) jobs.push({ jobId: job.id, name: job.intent.slice(0, 200), contextId: job.contextId });
        }
        return jobs;
    }
    const service = { async call(credential: string, name: string, raw: unknown, signal?: AbortSignal): Promise<Record<string, any>> {
        if (typeof credential !== "string" || credential.length !== token.length || !timingSafeEqual(Buffer.from(credential), Buffer.from(token))) throw new Error("Connection revoked");
        const { args } = parseDelegationCall(name, raw);
        if (args.workspaceId !== undefined && args.workspaceId !== workspaceId) throw new Error("Only this connection's workspace is available");
        if (name === "wringer.list_jobs") {
            const rows = await list(), offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 20), jobs = [];
            for (const row of rows.slice(offset, offset + limit)) {
                const current = await selected(row.jobId), status = await current.controller.status(row.jobId);
                jobs.push({ jobId: row.jobId, outcome: status.outcome, revision: status.revision, supersededBy: status.supersededBy ?? null });
            }
            return { schema_version: "wringer.job-list.v2", mode: "delegation", workspaceId, jobs, nextOffset: offset + limit < rows.length ? offset + limit : null };
        }
        let current = typeof args.jobId === "string" ? await selected(args.jobId) : await latest();
        if (["wringer.start", "wringer.continue", "wringer.request_revision", "wringer.prepare_handover"].includes(name)) current = await activate(current.context);
        const mapped = { ...args, ...(args.workspaceId ? { workspaceId: current.controller.workspace.id } : {}) };
        const result = await current.protocol.call(current.capability.token, name, mapped, signal);
        if (typeof result.jobId === "string" && !result.isError && ["wringer.propose", "wringer.revise_proposal"].includes(name)) await retainDelegationJob(root, current.context, result.jobId);
        const value = { ...result, ...(result.workspaceId ? { workspaceId } : {}) };
        validateDelegationOutput(name, value); return value;
    } };
    async function writeOwnedFile(path: string, contents: string) {
        const file = await open(path, "wx", 0o600);
        created.push(path);
        try { await writeFile(file, contents); await file.sync(); } finally { await file.close(); }
    }
    async function stop() {
        if (stopped) return; closed = true; clearInterval(refreshTimer);
        await collections.stop();
        const loaded = await Promise.allSettled(active.values());
        for (const result of loaded) if (result.status === "fulfilled") result.value.flow.stop();
        const results = await Promise.all(loaded.flatMap(result => result.status === "fulfilled" ? [result.value.controller.runner.stop(5000)] : []));
        if (results.some(result => result.owner)) throw new Error("An operation remains owned or uncertain. Keep the owner record and inspect it before recovery");
        sessions.clear(); server?.stop(true); transport?.stop();
        for (const path of created) await unlink(path);
        await lock.close(); await unlink(lockPath); stopped = true;
    }
    try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, workspaceId, at: new Date().toISOString() })); await lock.sync();
        const page = withImprovementCard(renderPmJobWorkspace({ nonce }), nonce, { jobScoped: true });
        server = Bun.serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 16384, async fetch(request) {
            const url = new URL(request.url);
            if (url.origin !== origin || request.headers.get("host") !== new URL(origin).host) return json({ error: "Unexpected local origin" }, 403);
            if (request.method === "GET" && url.pathname === "/") return new Response(page, { headers: { ...headers, "Content-Type": "text/html" } });
            const session = await sessions.handle(request, origin); if (session) return session;
            const authentication = sessions.authenticate(request, origin); if (authentication instanceof Response) return authentication;
            try {
                if (request.method === "GET" && url.pathname === "/api/jobs") return json({ jobs: await list(), ownerStops: [...activationErrors].map(([contextId, code]) => ({ contextId, code })) });
                if (request.method === "GET" && url.pathname === "/api/job") { const jobId = assistantId(url.searchParams.get("jobId")); return json(await (await selected(jobId)).flow.read(jobId)); }
                if (request.method === "GET" && url.pathname === "/api/improvements") {
                    if ([...url.searchParams.keys()].join(",") !== "jobId") throw new Error("Select exactly one job for improvement evidence");
                    const jobId = assistantId(url.searchParams.get("jobId")), current = await selected(jobId), proposal = await current.controller.inspectProposal(jobId);
                    return json({ ...await inspectJobImprovements(current.controller.root, proposal.plan ?? current.controller.workspace.profile, jobId), collection: collections.messages(current.controller.root) });
                }
                if (request.method === "POST" && /^\/api\/improvements\/(collect|promote|rollback)$/.test(url.pathname)) {
                    if (closed || url.search || request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") throw new Error("Use the displayed separate improvement decision");
                    const text = await request.text(); if (Buffer.byteLength(text) > 16384) throw new Error("Improvement decision too large");
                    const input = parseMcpJson(text) as Record<string, any>, jobId = assistantId(input?.jobId), current = await selected(jobId), proposal = await current.controller.inspectProposal(jobId);
                    const { jobId: ignored, ...decision } = input, action = url.pathname.split("/").at(-1)!, profile = proposal.plan ?? current.controller.workspace.profile;
                    if (closed) throw new Error("Owner is stopping");
                    if (action === "collect") return json(await collections.collect(current.controller.root, profile, decision as any), 202);
                    return json(await decideImprovement(current.controller.root, profile, action as "promote" | "rollback", decision as any));
                }
                if (closed || request.method !== "POST" || url.search || !/^\/api\/job\/(approve|retry|decision|correction|stop|send)$/.test(url.pathname) || request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") throw new Error("Use the current operator page action");
                const text = await request.text(); if (Buffer.byteLength(text) > 16384) throw new Error("Decision too large");
                const input = parseMcpJson(text) as Record<string, unknown>, jobId = assistantId(input?.jobId);
                const action = url.pathname.split("/").at(-1)!, current = await selected(jobId);
                if (action !== "stop") await activate(current.context);
                return json(await current.flow.post(action, input));
            } catch (error) { return json({ error: redactor.scrub(error instanceof Error ? error.message : "Decision refused") }, 409); }
        } });
        origin = `http://127.0.0.1:${server.port}`;
        // Explicit startup discovers scoped contexts and admits only prior grants.
        // Read-only requests use passive, bounded history views.
        await activatePreparedContexts();
        refreshTimer = setInterval(() => { void activatePreparedContexts().catch(() => { activationErrors.set(workspaceId, "context-discovery-refused-inspect-retained-records"); }); }, 1000); refreshTimer.unref();
        transport = createAssistantTransport(service, { instanceId: workspaceId, parseCall: parseDelegationCall, isStopping: () => closed });
        const connectionPath = join(ownerRoot, "connection.json"), operatorPath = join(ownerRoot, "operator.json");
        await writeOwnedFile(connectionPath, JSON.stringify({ schema_version: "wringer.assistant-connection.v3", mode: "delegation", workspaceId, endpoint: transport.endpoint, token }));
        await writeOwnedFile(operatorPath, JSON.stringify({ schema_version: "wringer.operator-location.v1", url: `${origin}/#token=${operatorToken}`, pid: process.pid }));
        return { service, connectionPath, page: origin, operatorUrl: `${origin}/#token=${operatorToken}`, list, stop };
    } catch (error) { await stop(); throw error; }
}
