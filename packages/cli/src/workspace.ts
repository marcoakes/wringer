import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { renderPmWorkspace, validatePmWorkspace, type PmWorkspace } from "@wringer/board";
import { readController, readControllerFile, controllerStatus, queueWorkspaceCommand, readWorkspaceCommand, latestWorkspacePublication, workspacePublicationBlocksHandover, WORKSPACE_HANDOVER_RECORDED, activeWorkspaceCommand, projectRequirements, type ApplicationOptions } from "@wringer/application";
import { inspectContainedPlanning } from "@wringer/workflow";
import { Redactor } from "@wringer/engine";
import type { Answer } from "./app";

async function planningOnly(state: string): Promise<boolean> {
    const exists = async (path: string) => lstat(path).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
    // A damaged execution record must fail its own reader, not fall back to a
    // more permissive planning view.
    return !await exists(join(state, ".wringer/contained/plan.json")) && await exists(join(state, ".wringer/planning/request.json"));
}
/** Planning views expose recorded questions, never execution command authority. */
export async function assertPmWorkspaceCommandAccess(state: string): Promise<void> {
    if (await planningOnly(state)) throw new Error("This is a read-only planning workspace. Execution commands and command records are unavailable; use the printed planning status or new-grant preview route.");
}
async function readPlanningWorkspace(state: string): Promise<PmWorkspace> {
    const view = await inspectContainedPlanning(state), { request, proposal, budget } = view;
    const names = await readdir(join(state, ".wringer/planning/events")), last = names.sort().at(-1);
    const event = last ? await readControllerFile(join(state, ".wringer/planning/events", last)) : null;
    if (event && (event.sha256 !== view.revision || !Number.isFinite(Date.parse(event.at)))) throw new Error("Planning advanced during this read. Refresh the recorded proposal.");
    const quoted = `'${resolve(state).replaceAll("'", "'\\''")}'`;
    const routes = [`Read-only status: wringer-drive planning-status --state ${quoted}`, ...(view.recovery.newGrantRequired ? [`Separate new-grant preview (does not approve or spend): wringer-drive planning-new-grant --state ${quoted}`] : [])];
    const message = [proposal.questions.length ? `Questions requiring a decision:\n${proposal.questions.map((question, index) => `${index + 1}. ${question}`).join("\n")}` : "No planning questions are recorded.", `Original planner note:\n${proposal.note}`, ...(proposal.stopReason ? [`Recorded planning stop:\n${proposal.stopReason}`] : []), ...(proposal.plan ? [`Proposed execution plan (unapproved):\n${JSON.stringify(proposal.plan, null, 2)}`] : []), ...routes].join("\n\n");
    return validatePmWorkspace(new Redactor(request.runtime.env).deep({
        schema_version: "wringer.pm-workspace.v1", name: request.name, intent: request.intent, journeyId: `planning-${request.request_sha256}`, revision: view.revision,
        status: view.activity === "running" ? "planning-running" : view.activity === "unknown" ? "planning-uncertain" : `planning-${proposal.status}`, stage: "planning", candidate: null, criteria: [], checks: [], actions: [],
        usage: { sessions: budget.reserved, ceiling: budget.ceiling, inputTokens: null, outputTokens: null, costUsd: null },
        stop: { reason: `planning-${proposal.status}`, message }, updatedAt: event?.at ?? view.authority.granted_at,
        limits: ["Read-only planning record. No execution plan or human verdict is approved by this page.", `Planning sessions reserved: ${budget.reserved}/${budget.ceiling}; remaining: ${budget.remaining}.`, `Planning approval expired: ${budget.authorityExpired ? "yes" : "no"}; original planning clock exhausted: ${budget.wallClockExpired ? "yes" : "no"}.`, "Reading these questions does not start a model, reset a budget or create a new grant. Unknown token usage and cost remain unknown."],
    }));
}
/** Derive presentation from validated controller facts; no UI record can grant readiness. */
export async function readPmWorkspace(state: string): Promise<PmWorkspace> {
    if (await planningOnly(state)) return readPlanningWorkspace(state);
    const history = await readController(state, false, true), query = await controllerStatus(state), { plan } = history;
    // A concurrent transition is retried by the next polling read, never merged into a hybrid view.
    if (history.events.at(-1)?.sha256 !== query.revision) throw new Error("The run advanced during this read. Refreshing the current record is safe.");
    const result = query.result, publication = await latestWorkspacePublication(state), operation = await activeWorkspaceCommand(state);
    if ((await controllerStatus(state)).revision !== query.revision) throw new Error("The run advanced while its delivery was audited. Refresh before acting.");
    const criteria: PmWorkspace["criteria"] = projectRequirements(plan, result);
    const outcome = (row: { status: string; exitCode: number | null } | undefined) => ({ status: row?.status ?? "not-recorded", exitCode: row?.exitCode ?? null });
    const deliveryAction = query.actions.find(a => a.id === "deliver")!;
    const currentPublication = publication && publication.codeCommit === result.candidate?.source.commit ? publication : null;
    const handoverRecorded = workspacePublicationBlocksHandover(currentPublication);
    const value: PmWorkspace = {
        schema_version: "wringer.pm-workspace.v1", name: plan.name, intent: plan.intent, journeyId: query.journeyId, revision: query.revision, status: operation ? operation.status === "running" ? "running" : "stopped" : query.status, stage: query.stage,
        candidate: result.candidate ? { commit: result.candidate.source.commit, tree: result.candidate.tree, changedPaths: result.candidate.changedPaths } : null,
        criteria, checks: plan.acceptance.checks.map(check => ({ id: check.id, before: outcome(history.state.baseline?.checks.find(c => c.id === check.id)), after: outcome(result.verification?.checks.find(c => c.id === check.id)) })),
        usage: { sessions: query.budget.sessions.reserved, ceiling: query.budget.sessions.ceiling, inputTokens: query.budget.tokens.input, outputTokens: query.budget.tokens.output, costUsd: null },
        actions: [...query.actions.filter(a => a.id !== "deliver"), { ...deliveryAction, id: "prepare-delivery" }, { ...deliveryAction, id: "publish" }].map(a => operation ? { ...a, enabled: false, reason: operation.message } : handoverRecorded && ["prepare-delivery", "publish"].includes(a.id) ? { ...a, enabled: false, reason: WORKSPACE_HANDOVER_RECORDED } : a),
        stop: operation?.status === "uncertain" ? { reason: "operation-uncertain", message: operation.message } : query.stop ? { reason: query.stop.reason, message: `${query.stop.message}\n\nRecorded next route:\n${query.stop.next_move}` } : null,
        updatedAt: history.events.at(-1)!.at,
        limits: ["This workspace derives the validated controller journal. A button is not additional authority.", "A check and an independent agent judgement support a declared requirement; neither guarantees that every intended behaviour was specified.", `Verifier attempts: ${query.budget.verificationAttempts.reserved}/${query.budget.verificationAttempts.ceiling}; unresolved: ${query.budget.verificationAttempts.unknown}.`, `Whole-journey wall-clock ceiling: ${query.budget.wallClock.ceilingSeconds} seconds${query.budget.wallClock.expired ? " (expired)" : ""}.`, "Host login directories are not shared with agents. Provider cost is not inferred from absent billing observations."],
        ...(currentPublication ? { publication: { status: currentPublication.forge?.status ?? (currentPublication.pushed ? "branch-pushed" : "prepared"), ...(currentPublication.forge?.url ? { url: currentPublication.forge.url } : {}), deliveryId: currentPublication.deliveryId, bundleDir: currentPublication.bundleDir } } : {}),
    };
    return validatePmWorkspace(new Redactor(plan.runtime.env).deep(value));
}
/** Public HTML contains no repository facts. The fragment credential unlocks the API only. */
function bootstrap(): PmWorkspace {
    return { schema_version: "wringer.pm-workspace.v1", name: "Wringer delivery workspace", intent: "Connect with the private link printed by your controller.", journeyId: "connection-pending", revision: "connection-pending", status: "unconnected", stage: "unconnected", candidate: null, criteria: [], checks: [], usage: { sessions: 0, ceiling: 0, inputTokens: null, outputTokens: null, costUsd: null }, actions: [], stop: null, updatedAt: new Date(0).toISOString(), limits: ["No run data has been loaded. This public shell cannot authorize any action."] };
}
export async function createPmWorkspaceServer(stateDirectory: string, options: ApplicationOptions & { port?: number; beforeCommand?: () => Promise<void> } = {}) {
    const state = resolve(stateDirectory);
    await readPmWorkspace(state);
    const token = randomBytes(32).toString("hex"), secret = Buffer.from(`Bearer ${token}`), nonce = randomBytes(20).toString("base64");
    const shell = renderPmWorkspace(bootstrap(), { live: true, nonce });
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'` };
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    let origin = "";
    const server = Bun.serve({ hostname: "127.0.0.1", port: options.port ?? 0, development: false, maxRequestBodySize: 64 * 1024, async fetch(request) {
        const url = new URL(request.url);
        if (!origin || url.origin !== origin || request.headers.get("host") !== new URL(origin).host) return json({ error: "Unrecognized local controller origin" }, 403);
        if (request.method === "GET" && url.pathname === "/" && !url.search) return new Response(shell, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
        const supplied = Buffer.from(request.headers.get("authorization") ?? "");
        if (supplied.length !== secret.length || !timingSafeEqual(supplied, secret)) return json({ error: "This private controller requires its current access token" }, 401);
        const requestOrigin = request.headers.get("origin");
        if (requestOrigin && requestOrigin !== origin || request.method !== "GET" && requestOrigin !== origin) return json({ error: "Cross-origin actions are not allowed" }, 403);
        if (request.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Cross-site access is not allowed" }, 403);
        try {
            if (request.method === "GET" && url.pathname === "/api/state") return json(await readPmWorkspace(state));
            if (request.method === "GET" && /^\/api\/commands\/[a-f0-9-]{36}$/.test(url.pathname)) {
                await assertPmWorkspaceCommandAccess(state);
                return json(await readWorkspaceCommand(state, url.pathname.split("/").at(-1)!));
            }
            if (request.method === "POST" && url.pathname === "/api/commands") {
                await assertPmWorkspaceCommandAccess(state);
                if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return json({ error: "Use an explicit JSON command" }, 415);
                const text = await request.text();
                if (Buffer.byteLength(text) > 64 * 1024) return json({ error: "Command exceeds its size limit" }, 413);
                await options.beforeCommand?.();
                return json(await queueWorkspaceCommand(state, JSON.parse(text), options), 202);
            }
            return json({ error: "Not found" }, 404);
        } catch (error) {
            return json({ error: new Redactor().scrub(error instanceof Error ? error.message : String(error)) }, 409);
        }
    } });
    origin = server.url.origin;
    options.signal?.addEventListener("abort", () => { void server.stop(true); }, { once: true });
    return { server, url: `${origin}/#token=${token}`, origin };
}
export async function containedWorkspace(state: string, options: { port: number; output?: string; signal?: AbortSignal }): Promise<Answer> {
    if (options.port > 65535) throw new Error("Invalid local workspace port");
    if (options.output) {
        const view = await readPmWorkspace(state);
        await mkdir(dirname(options.output), { recursive: true });
        await writeFile(options.output, renderPmWorkspace(view, { live: false }), { flag: "wx", mode: 0o600 });
        return { value: { path: options.output, view }, text: `Saved read-only workspace: ${options.output}\nJourney: ${view.journeyId}\nThis snapshot cannot approve, run or publish anything.` };
    }
    const workspace = await createPmWorkspaceServer(state, options);
    return { value: { url: workspace.url }, text: `Private PM workspace: ${workspace.url}\nKeep this link private. It can act only on this controller's bounded run.\nKeys stay in the controller; nothing is published without a separate confirmation.\nKeep this process running. Press Ctrl-C to stop the workspace and cancel its active work.` };
}
