import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { hashValue } from "@wringer/plan";
import { loadConfig, loadSpec, Redactor } from "@wringer/engine";
import { renderPmJobWorkspace, renderMarkdown, validatePmJob, pmJobReviewSet, type PmJob } from "@wringer/board";
import { approveVerificationJob, createVerificationJob, createVerificationOperations, readVerificationJob, verificationStatus, readWorkspace, safeWorkspaceSnapshot, assistantInventory, assistantId, assistantPath, prepareVerificationHandover, sendVerificationHandover, writeAssistantRecord } from "@wringer/application";
import { parseMcpJson, parseVerificationCall, validateVerificationOutput } from "@wringer/mcp";
import { createOperatorBrowserSessions } from "./operator-browser-session";
import { createAssistantTransport } from "./assistant-transport";
import { compactVerificationStatus } from "@wringer/application";

type Status = Omit<Awaited<ReturnType<typeof verificationStatus>>, "decision"> & { decision: { kind: string | null; page: string | null } };
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const compact = compactVerificationStatus;
export async function createVerificationOwner(root: string, workspaceId: string) {
    const workspace = await readWorkspace(root, workspaceId);
    if (workspace.mode !== "verification") throw new Error("This owner only runs the explicitly selected verification mode");
    const ownerRoot = await assistantPath(root, `owners/${assistantId(workspaceId)}`); await mkdir(ownerRoot, { recursive: true, mode: 0o700 });
    const lockPath = join(ownerRoot, "owner.lock"), lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("A retained owner exists. Inspect it and explicitly recover dead ownership; opening never replaces it."); });
    const ownedFiles: string[] = [];
    let ownedPage: ReturnType<typeof Bun.serve> | undefined, ownedTransport: ReturnType<typeof createAssistantTransport> | undefined;
    async function publishOwned(path: string, value: object) {
        const file = await open(path, "wx", 0o600); ownedFiles.push(path);
        try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    }
    try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, workspaceId, at: new Date().toISOString() })); await lock.sync();
    const token = randomBytes(32).toString("hex"), operatorToken = randomBytes(32).toString("hex"), nonce = randomBytes(16).toString("hex");
    const ops = createVerificationOperations(root), active = new Map<string, Promise<unknown>>();
    let closed = false, origin = "";
    const header = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` };
    const sessions = createOperatorBrowserSessions(operatorToken, header), json = (value: unknown, status = 200) => Response.json(value, { status, headers: header });
    const redact = new Redactor();
    const selected = async (id: string) => { const job = await readVerificationJob(root, assistantId(id)); if (job.workspaceId !== workspace.id) throw new Error("Job is outside this connection's workspace"); return job; };
    async function status(id: string) {
        // A read that began during owned work cannot borrow a later completion
        // while still carrying an earlier snapshot of its durable evidence.
        const observedActive = active.has(id);
        await selected(id); const view = await verificationStatus(root, id);
        return { ...view, decision: { ...view.decision, page: `${origin}/?jobId=${id}` }, ...(observedActive || active.has(id) ? { phase: "working", outcome: "working", uncertainty: false } : {}) };
    }
    async function prepare(id: string) {
        const before = await status(id);
        if (!before.preparationEligible) throw new Error("This exact source is not eligible for handover preparation");
        try { await prepareVerificationHandover(root, id); }
        catch (error) { await writeAssistantRecord(root, `verification-jobs/${id}/preparation-errors/${crypto.randomUUID()}.json`, { schema_version: "wringer.verification-preparation-error.v1", candidateIdentity: before.candidateIdentity, at: new Date().toISOString(), reason: redact.scrub(error instanceof Error ? error.message : "Handover preparation failed").slice(0, 8000) }); }
    }
    async function enqueue(id: string, input: { idempotencyKey: string; expectedRevision: string; expectedCandidateIdentity: string }) {
        await selected(id);
        if (closed) throw new Error("Owner is stopping; no new work accepted");
        if (active.has(id)) return compact(await status(id));
        // Application service checks idempotent replay before current eligibility,
        // and revalidates fresh requests under its filesystem lock.
        const reserved = Promise.withResolvers<void>();
        const promise = ops.execute(id, input, () => reserved.resolve()).then(async result => {
            if (result.fresh && result.board?.facts.readyToDeliver && result.job.destination) {
                await prepare(id);
            }
            return result;
        }).catch(error => { reserved.reject(error); throw error; }).finally(() => { active.delete(id); });
        active.set(id, promise);
        // Avoid unhandled asynchronous errors; retained reservation remains the authority.
        void promise.catch(() => {});
        await reserved.promise;
        const view = await status(id);
        return { ...compact(view), outcome: view.operation?.status === "completed" ? "completed" : "accepted" };
    }
    async function list() {
        const names = await assistantInventory(root, "verification-jobs"), jobs = [];
        for (const id of names) {
            const job = await readVerificationJob(root, id);
            if (job.workspaceId === workspace.id) jobs.push({ jobId: id, name: job.intent.slice(0, 1000) });
        }
        return jobs;
    }
    async function pm(id: string): Promise<PmJob> {
        const value = await status(id), job = value.job, config = await loadConfig(workspace.repo), working = value.phase === "working", spec = await loadSpec(workspace.repo);
        const source = await safeWorkspaceSnapshot(workspace.repo);
        if (source.fingerprint !== value.candidateIdentity) throw new Error("Source changed while its result was read; refresh before deciding");
        const phase: PmJob["phase"] = working ? "working" : value.phase === "approval" ? "approval" : ["review", "send", "sent"].includes(value.phase) ? value.phase as "review" | "send" | "sent" : "blocked";
        return validatePmJob({ schema_version: "wringer.pm-job.v3", mode: "verification", verification: { repetitions: job.ceilings.repetitions, remaining: value.remaining.repetitions, runSeconds: job.ceilings.runSeconds, checks: config.gates.filter(gate => job.selection.includes(gate.id)).map(gate => ({ id: gate.id, command: gate.run })) }, jobId: id, revision: value.revision, readyRevision: phase === "approval" ? hashValue(job) : value.revision, candidateTree: value.fresh ? value.candidateIdentity : null, phase, name: job.intent.slice(0, 1000), intent: job.intent,
            requirements: value.board?.requirements.map(row => ({ id: row.id, title: row.title, quote: row.source?.quote ?? row.title, kind: row.human ? "human" : "check", required: row.required, state: row.judgement?.verdict === "not_met" && !row.judgement.stale ? "not-met" : row.proved || row.judgement?.verdict === "met" && !row.judgement.stale ? "met" : "unknown", note: row.judgement?.note ?? null, by: row.judgement?.by ?? null })) ?? spec?.criteria.map((row: any) => ({ id: row.id, title: row.title, quote: row.quote ?? row.title, kind: row.human ? "human" : "check", required: row.required !== false, state: "unknown" })) ?? [],
            budget: { sessions: 0, wallSeconds: job.ceilings.elapsedSeconds, expiresAt: value.approval?.expiresAt ?? null }, scope: { repository: workspace.repo, sourceCommit: job.source.head_sha!, writable: ["Trusted-local checks execute under your account; this is not a filesystem sandbox."], protected: [] }, actor: value.approval?.actor ?? null,
            displays: [...value.displays.map(display => ({ criterionId: display.criterion, title: display.criterion, displayId: display.id, candidateTree: value.candidateIdentity, success: display.success && value.fresh, output: display.output, error: display.success ? null : display.reason })), ...(value.board ? [{ criterionId: "verification-report", title: "Recorded checks and current source change", displayId: job.id, candidateTree: value.candidateIdentity, success: value.fresh, output: redact.scrub(renderMarkdown(value.board) + "\n\n" + (value.fresh ? source.diff : "The current checkout differs from this recorded result. Inspect the carried handover patch.")).slice(0, 500000), error: null }] : [])], destination: job.destination ? { remote: value.publication?.expected.remoteURL ?? value.prepared?.expected.remoteURL ?? job.destination.remote, sourceBranch: job.destination.branch, targetBranch: job.destination.base } : null, preparedId: value.prepared?.id ?? null, publication: value.publication ? { status: value.publication.schema_version === "wringer.verification-publication.v2" ? "Exact remote branch and carried evidence audited; no PR, merge or deployment" : "Branch and evidence pushed; no PR, merge or deployment", deliveryId: value.publication.result.delivery_id, auditCommand: value.publication.result.audit_command, cloneCommand: `git clone --branch ${quote(job.destination!.branch)} ${quote(value.publication.expected.remoteURL)} reviewed-change` } : null,
            nextAction: value.nextAction.reason, error: phase === "blocked" ? value.nextAction.reason : null, retryable: phase === "blocked" && (value.checksEligible || value.preparationEligible), retryLabel: value.preparationEligible ? "Prepare handover" : "Run the reviewed checks", limits: ["Verification mode: trusted-local repository commands; no contained worker or provider account.", "Command exit, assertions, requirement proof and human acceptance remain separate.", "Checks can execute changing project source under your account. The grant pins definitions, declared inputs, repetitions and elapsed limits.", "The supervised-command bound is not an OS process or isolation guarantee.", "Cooperative-local identity: a recorded actor is not authenticated human presence.", ...(value.board?.limits ?? [])] });
    }
    const page = renderPmJobWorkspace({ nonce });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 16384, async fetch(request) {
        const url = new URL(request.url);
        if (url.origin !== origin || request.headers.get("host") !== new URL(origin).host) return json({ error: "Unexpected local origin" }, 403);
        if (request.method === "GET" && url.pathname === "/") return new Response(page, { headers: { ...header, "Content-Type": "text/html" } });
        const session = await sessions.handle(request, origin); if (session) return session;
        const authentication = sessions.authenticate(request, origin); if (authentication instanceof Response) return authentication;
        try {
            if (request.method === "GET" && url.pathname === "/api/jobs") return json({ jobs: await list() });
            if (request.method === "GET" && url.pathname === "/api/job") return json(await pm(assistantId(url.searchParams.get("jobId"))));
            if (request.method !== "POST" || !/^\/api\/job\/(approve|retry|decision|correction|stop|send)$/.test(url.pathname) || url.search) return json({ error: "Unknown operator action" }, 404);
            if (closed || request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") throw new Error("Use the current operator page");
            const raw = await request.text(); if (Buffer.byteLength(raw) > 16384) throw new Error("Decision is too large");
            const body = parseMcpJson(raw) as Record<string, any>, action = url.pathname.split("/").at(-1)!;
            if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Use an exact decision object");
            const allowed = action === "approve" ? ["jobId", "expectedRevision", "actor"] : ["jobId", "expectedRevision", "expectedCandidateTree", ...(action === "decision" ? ["verdict", "note", "displayIds"] : action === "correction" ? ["note"] : action === "send" ? ["preparedId"] : [])];
            if (Object.keys(body).some(key => !allowed.includes(key))) throw new Error("Unexpected decision fields");
            const id = assistantId(body.jobId); await selected(id);
            if (action === "approve") {
                await approveVerificationJob(root, id, { expectedRevision: body.expectedRevision, actor: body.actor, confirmLocalExecution: true });
                const current = await status(id);
                if (current.checksEligible) await enqueue(id, { idempotencyKey: crypto.randomUUID(), expectedRevision: current.revision, expectedCandidateIdentity: current.candidateIdentity });
                return json({ outcome: "approved" }, 202);
            }
            const current = await status(id);
            if (action === "stop" || action === "retry") {
                const shown = await pm(id);
                if (shown.readyRevision !== body.expectedRevision || shown.candidateTree !== body.expectedCandidateTree) throw new Error("This action is stale; refresh before acting");
                if (action === "stop") return json(compact(await ops.stop(id, current.approval?.actor ?? "Operator stop")));
                if (current.preparationEligible) { await prepare(id); return json(compact(await status(id))); }
                return json(await enqueue(id, { idempotencyKey: crypto.randomUUID(), expectedRevision: current.revision, expectedCandidateIdentity: current.candidateIdentity }), 202);
            }
            if (current.revision !== body.expectedRevision || current.candidateIdentity !== body.expectedCandidateTree) throw new Error("This decision is stale; refresh before acting");
            if (action === "send") return json(await sendVerificationHandover(root, id, { expectedRevision: body.expectedRevision, expectedCandidateIdentity: body.expectedCandidateTree, preparedId: body.preparedId }));
            const displayed = pmJobReviewSet(await pm(id));
            if (!displayed.eligible || action === "decision" && (!Array.isArray(body.displayIds) || body.displayIds.length !== displayed.displayIds.length || new Set(body.displayIds).size !== body.displayIds.length || body.displayIds.some((value: string) => !displayed.displayIds.includes(value)))) throw new Error("Review the exact complete display set before deciding");
            const reviewed = await ops.review(id, { expectedRevision: body.expectedRevision, expectedCandidateIdentity: body.expectedCandidateTree, verdict: action === "correction" ? "not_met" : body.verdict, note: body.note });
            if (action === "decision" && body.verdict === "met" && reviewed.checksEligible) {
                await enqueue(id, { idempotencyKey: crypto.randomUUID(), expectedRevision: reviewed.revision, expectedCandidateIdentity: reviewed.candidateIdentity });
                return json({ outcome: "accepted", note: "Your decision is recorded; checks are running within the remaining original grant." }, 202);
            }
            return json(compact({ ...reviewed, decision: { ...reviewed.decision, page: `${origin}/?jobId=${id}` } }));
        } catch (error) { return json({ error: redact.scrub(error instanceof Error ? error.message : "Decision refused") }, 409); }
    } });
    origin = `http://127.0.0.1:${server.port}`;
    ownedPage = server;
    const service = { async call(credential: string, name: string, raw: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
        if (credential.length !== token.length || !timingSafeEqual(Buffer.from(credential), Buffer.from(token))) throw new Error("Connection revoked");
        const { args } = parseVerificationCall(name, raw);
        if (name === "wringer.list_jobs") {
            const ids = [];
            for (const id of await assistantInventory(root, "verification-jobs")) if ((await readVerificationJob(root, id)).workspaceId === workspaceId) ids.push(id);
            const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 20), jobs = [];
            for (const id of ids.slice(offset, offset + limit)) { const value = await status(id); jobs.push({ jobId: id, outcome: value.outcome, revision: value.revision, supersededBy: null }); }
            return { schema_version: "wringer.job-list.v2", mode: "verification", workspaceId, jobs, nextOffset: offset + limit < ids.length ? offset + limit : null };
        }
        if (name === "wringer.inspect_setup") return { schema_version: "wringer.setup-observation.v1", mode: "verification", workspaceId, checks: (await loadConfig(workspace.repo)).gates, boundary: workspace.boundary, untrustedContent: true };
        if (name === "wringer.propose_verification") { const job = await createVerificationJob(root, workspace.id, args as any); return compact(await status(job.id)); }
        const id = assistantId(args.jobId); await selected(id);
        if (name === "wringer.get_status") return compact(await status(id));
        if (name === "wringer.run_checks") return enqueue(id, args as any);
        if (name === "wringer.cancel") return compact(await ops.stop(id, "Assistant-requested stop", args as any));
        if (name === "wringer.wait_for_update") {
            const deadline = Date.now() + Number(args.timeoutSeconds ?? 25) * 1000;
            while (true) { signal?.throwIfAborted(); const value = await status(id); if (value.eventId !== args.afterEventId || Date.now() >= deadline) return { ...compact(value), changed: value.eventId !== args.afterEventId }; await delay(Math.min(500, Math.max(1, deadline - Date.now())), undefined, { signal }); }
        }
        if (name === "wringer.get_evidence") {
            const value = await status(id), handle = value.evidence.find(row => row.id === args.evidenceId);
            if (!handle || handle.contentIdentity !== args.contentIdentity) throw new Error("Evidence cursor no longer names this observation");
            const content = value.evidenceContents.find(row => row.id === handle.id && row.contentIdentity === handle.contentIdentity)!.content, offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 4096);
            if (offset > content.length || offset > 0 && /[\uDC00-\uDFFF]/.test(content[offset] ?? "")) throw new Error("Use the returned evidence cursor without splitting a Unicode character");
            let end = Math.min(content.length, offset + limit);
            if (/[\uD800-\uDBFF]/.test(content[end - 1] ?? "") && end < content.length) end--;
            if (end === offset && end < content.length) throw new Error("Use a page limit of at least two for this Unicode character");
            return { schema_version: "wringer.evidence-page.v2", jobId: id, contentIdentity: handle.contentIdentity, content: content.slice(offset, end), nextOffset: end < content.length ? end : null, untrustedContent: true };
        }
        throw new Error("Unsupported verification tool");
    } };
    const transport = createAssistantTransport({ async call(token, name, args, signal) { const value = await service.call(token, name, args, signal); validateVerificationOutput(name, value); return value; } }, { instanceId: workspaceId, parseCall: parseVerificationCall, isStopping: () => closed });
    ownedTransport = transport;
    const connectionPath = join(ownerRoot, "connection.json"), privatePath = join(ownerRoot, "operator.json");
    await publishOwned(connectionPath, { schema_version: "wringer.assistant-connection.v2", mode: "verification", workspaceId, endpoint: transport.endpoint, token });
    await publishOwned(privatePath, { schema_version: "wringer.operator-location.v1", url: `${origin}/#token=${operatorToken}`, pid: process.pid });
    return { service, connectionPath, page: origin, operatorUrl: `${origin}/#token=${operatorToken}`, list, pm, async stop() {
        if (closed) return; closed = true;
        for (const id of active.keys()) await ops.stop(id, "Owner stopped");
        await Promise.allSettled(active.values()); sessions.clear(); server.stop(true); transport.stop(); await lock.close();
        for (const path of [...ownedFiles, lockPath]) await unlink(path);
    } };
    } catch (error) {
        ownedPage?.stop(true); ownedTransport?.stop();
        for (const path of ownedFiles) await unlink(path);
        await lock.close(); await unlink(lockPath);
        throw error;
    }
}
