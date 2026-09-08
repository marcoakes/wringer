import { randomBytes } from "node:crypto";
import { hashValue } from "@wringer/plan";
import { Redactor } from "@wringer/engine";
import { ASSISTANT_WARNING, AssistantRefusal, approveAssistantProposal, assistantControllerState, type createAssistantService } from "../../application/src/assistant";
import { createPmWorkspaceServer } from "./workspace";
import { createOperatorBrowserSessions, OPERATOR_BROWSER_SESSION_LIMIT } from "./operator-browser-session";
import type { ApplicationOptions } from "@wringer/application";

type Service = Awaited<ReturnType<typeof createAssistantService>>;
type ReviewServer = Awaited<ReturnType<typeof createPmWorkspaceServer>>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Construction-only supervision. Cancellation reaches commands already past
 * their admission guard; the signal does not assert that remote work was undone. */
export function superviseAssistantReview(service: Pick<Service, "assertJobActive">, jobId: string, isStopping: () => boolean) {
    const controller = new AbortController();
    let checking = false;
    const abort = () => { clearInterval(timer); if (!controller.signal.aborted) controller.abort(new Error("Review work is cancelled or its owner is stopping/unreadable. Retain pending effects and unknown charges.")); };
    const check = async () => {
        if (checking || controller.signal.aborted) return;
        checking = true;
        try { if (isStopping()) throw new Error("Owner stopping"); await service.assertJobActive(jobId); if (isStopping()) throw new Error("Owner stopping"); }
        catch { abort(); }
        finally { checking = false; }
    };
    const timer = setInterval(() => { void check(); }, 250); timer.unref();
    void check();
    return { signal: controller.signal, stop: abort };
}

function parseBody(value: unknown, fields: string[]) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error("Use only the fields shown for this decision.");
    const body = value as Record<string, unknown>;
    if (typeof body.jobId !== "string" || !uuid.test(body.jobId)) throw new Error("Use a job from this operator console.");
    return body as Record<string, any>;
}

/** The public shell deliberately embeds no job facts, controller path or bearer. */
export function renderAssistantConsole(nonce: string) {
    if (!/^[A-Za-z0-9+/=]+$/.test(nonce)) throw new Error("Invalid console nonce");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wringer · Your next decision</title><style nonce="${nonce}">
:root{color-scheme:light;--ink:#20302c;--muted:#5a6760;--line:#dbe2d8;--green:#234f43;--paper:#f7f8f3}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,-apple-system,sans-serif}main{max-width:1060px;margin:auto;padding:36px 24px 80px}.eyebrow{letter-spacing:.12em;text-transform:uppercase;font-size:12px;font-weight:750;color:var(--green)}h1{font-size:clamp(28px,5vw,46px);line-height:1.12;letter-spacing:-.035em;margin:12px 0 16px}h2{font-size:24px;line-height:1.25;margin:0 0 12px}h3{font-size:16px;margin:22px 0 8px}p{margin:8px 0}.muted,small{color:var(--muted)}.notice{border-left:4px solid #cba348;background:#fff5d9;padding:14px 18px;margin:24px 0}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:24px 0}.card{border:1px solid var(--line);background:#fff;border-radius:18px;padding:26px;margin:22px 0;box-shadow:0 4px 18px #20302c05}.next{background:#edf4ee;border-radius:10px;padding:16px;margin:16px 0}.costs{display:grid;grid-template-columns:1fr 1fr;gap:12px}.costs p{background:var(--paper);padding:14px;border-radius:10px}button,.review-link{font:inherit;font-weight:650;padding:10px 17px;border:1px solid var(--green);border-radius:8px;background:var(--green);color:#fff;cursor:pointer;text-decoration:none;display:inline-block}button.secondary{background:#fff;color:var(--green)}button:disabled{opacity:.5;cursor:not-allowed}input{display:block;width:100%;padding:11px;margin:5px 0 16px;border:1px solid #a4b3a9;border-radius:7px;font:inherit}input[type=checkbox]{display:inline-block;width:auto;margin:0 10px 0 0}.confirm{display:flex;align-items:flex-start;margin:20px 0}.confirm input{margin-top:6px}form{border-top:1px solid var(--line);margin-top:22px;padding-top:18px;max-width:680px}label{display:block;font-weight:600}details{margin:18px 0;border-top:1px solid var(--line);padding-top:14px}summary{cursor:pointer;font-weight:650}pre,.verbatim{white-space:pre-wrap;overflow-wrap:anywhere}pre{font:12px/1.55 ui-monospace,monospace;background:var(--paper);padding:16px;border-radius:8px;max-height:440px;overflow:auto}.status{font-size:12px;color:var(--green);text-transform:uppercase;letter-spacing:.06em}.message{min-height:24px;white-space:pre-wrap}.error{color:#962f23}.list{padding-left:22px}a{color:var(--green)}:focus-visible{outline:3px solid #d59839;outline-offset:3px}@media(max-width:620px){main{padding:24px 16px}.card{padding:20px}.costs{grid-template-columns:1fr}}
</style></head><body><main><div class="eyebrow">Wringer · your work</div><h1>What should I do now?</h1><p class="muted">Your assistant handles the mechanics. You review the result and decide what happens next.</p><div class="toolbar"><button id="refresh" class="secondary" type="button">Refresh progress</button><button id="lock-console" class="secondary" type="button">Lock this console</button><span id="connection" class="muted">Connecting to your work…</span></div><p id="message" class="message" role="status" aria-live="polite"></p><section id="jobs" aria-label="Your work"></section><details><summary>Cooperative-local engineering preview · access and limits</summary><p>The assistant tools cannot approve for you, but an app with this computer account's access can bypass that tool boundary. This console does not authenticate human presence. Protected mode is unavailable.</p><p>${OPERATOR_BROWSER_SESSION_LIMIT}</p><p>Keep your private operator link out of the assistant's chat. A review or a recorded name is not a new spending allowance. Handover is a separate decision.</p></details></main><script nonce="${nonce}">
(() => {
  let token = new URLSearchParams(location.hash.slice(1)).get('token');
  history.replaceState(null, '', location.pathname);
  const jobs = document.getElementById('jobs'), message = document.getElementById('message'), connection = document.getElementById('connection');
  let pending = false, locked = false;
  const element = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const showMessage = (text, error = false) => { message.textContent = text; message.className = 'message' + (error ? ' error' : ''); };
  const disableDecisions = () => { jobs.querySelectorAll('button,input').forEach(node => { node.disabled = true; }); };
  const session = token ? fetch('/api/session', { method: 'POST', credentials: 'same-origin', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Wringer-Console': '1' }, body: '{}', cache: 'no-store' }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error || 'This browser could not be connected.'); }).finally(() => { token = null; }) : Promise.resolve();
  async function api(path, body) {
    await session;
    if (locked) throw new Error('This console is locked. Open your private operator link once to unlock this browser.');
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { 'X-Wringer-Console': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store' });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'The recorded state could not be read. Refresh before deciding.');
    return value;
  }
  function section(card, title, lines) { if (!lines.length) return; card.append(element('h3', title)); const list = element('ul', undefined, 'list'); lines.forEach(line => list.append(element('li', line))); card.append(list); }
  function detail(card, title, value) { const node = element('details'); node.append(element('summary', title), element('pre', JSON.stringify(value, null, 2))); card.append(node); }
  async function action(run) {
    if (pending) return;
    pending = true; disableDecisions();
    try { await run(); } catch (error) { showMessage(error.message + ' A lost response is not permission to repeat paid work.', true); }
    finally { pending = false; }
  }
  function render(row) {
    const view = row.status, p = row.proposal, card = element('article', undefined, 'card');
    card.append(element('p', String(view.outcome).replaceAll('-', ' '), 'status'), element('h2', p.plan ? p.plan.name : 'A question before work starts'));
    const next = element('div', undefined, 'next'); next.append(element('strong', 'Your next step'), element('p', view.nextAction)); card.append(next);
    if (row.canReview) {
      const open = element('button', 'Review the result'); open.type = 'button'; open.dataset.action = 'review-result';
      next.append(open, element('p', 'Open the actual result, record your own observation, or request a correction. Sending remains a separate decision.', 'muted'));
      open.addEventListener('click', () => { void action(async () => { const result = await api('/api/review', { jobId: view.jobId }); const target = new URL(result.url); if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port || target.username || target.password || target.pathname !== '/' || target.search || !/^#token=[a-f0-9]{64}$/.test(target.hash)) throw new Error('The review link did not match the local controller format.'); location.assign(target.href); }); });
    }
    if (view.uncertainty) next.append(element('p', 'An outcome is uncertain. Read the retained operation before any separate operator recovery. Do not start over.', 'notice'));
    section(next, 'Questions to answer', p.questions);
    const context = element('details'); context.open = row.canApprove; context.append(element('summary', 'Your request, requirements and limits'));
    context.append(element('h3', 'Your original request'), element('p', p.intent, 'verbatim')); section(context, 'Assumptions to check', p.assumptions);
    if (p.plan) {
      section(context, 'Requirements', p.plan.acceptance.criteria.map(item => item.title + ': ' + item.quote + (item.kind === 'human' ? ' — needs your observation' : ' — needs check evidence') + (item.required ? ' (required)' : ' (optional)')));
      context.append(element('p', 'Execution ceiling: ' + p.plan.budget.max_sessions + ' agent sessions across this job; ' + p.plan.budget.wall_clock_seconds + ' seconds of whole-job time. Queuing, retries and downtime do not reset it.'));
      detail(context, 'Exact approved scope, source and execution limits', { repository: p.plan.repository, writable: p.plan.scope.writable, protected: p.plan.acceptance.protected_paths, limits: p.plan.budget, sourceBoundPlan: p.plan.plan_sha256, proposalRevision: row.proposalRevision });
      detail(context, 'Complete plan and declared checks', p.plan);
    }
    card.append(context);
    if (row.canApprove) {
      const form = element('form'); form.append(element('h3', 'Approve this exact bounded work'));
      const byLabel = element('label', 'Your name'), by = element('input'); by.name = 'actor'; by.required = true; by.maxLength = 200; by.autocomplete = 'name'; byLabel.append(by);
      const expiryLabel = element('label', 'Approval expires (your local time)'), expires = element('input'); expires.type = 'datetime-local'; expires.name = 'expiry'; expires.required = true; expiryLabel.append(expires);
      const confirmLabel = element('label', undefined, 'confirm'), confirm = element('input'); confirm.type = 'checkbox'; confirm.required = true; confirmLabel.append(confirm, element('span', 'I approve this exact request, requirements, source, scope and finite session/time limits. This does not approve human acceptance or publication.'));
      const submit = element('button', 'Approve bounded work'); submit.type = 'submit'; form.append(byLabel, expiryLabel, element('small', 'The recorded expiry is also capped by the whole-job time limit. Downtime counts. Your name is recorded, not authenticated.'), confirmLabel, submit);
      form.addEventListener('submit', event => { event.preventDefault(); if (!form.reportValidity()) return; void action(async () => { const result = await api('/api/approve', { jobId: view.jobId, expectedRevision: row.proposalRevision, actor: by.value, expiresAt: new Date(expires.value).toISOString(), confirmExecution: confirm.checked }); await refresh(); showMessage('Bounded approval recorded until ' + result.expiresAt + '. Your assistant can start only this approved job.'); }); });
      card.append(form);
    }
    const costs = element('div', undefined, 'costs'); costs.append(element('p', 'Coding app: usage and cost are not available to Wringer.'), element('p', 'Development and review: cost unknown. Session/time limits are not a cash ceiling.')); card.append(costs);
    if (view.usage.development.measured) detail(card, 'Recorded development usage and remaining limits', view.usage.development.measured);
    detail(card, 'Handover destination — sending needs a separate decision', row.destination || 'No handover destination selected. The assistant cannot invent one.');
    card.append(element('small', 'Job ' + view.jobId)); return card;
  }
  async function refresh() {
    disableDecisions();
    try { const value = await api('/api/jobs'); const cards = value.jobs.map(render); jobs.replaceChildren(...cards); if (!cards.length) jobs.append(element('article', 'No proposal yet. Ask the connected assistant to inspect setup and propose your request. No model call is made by refreshing.', 'card')); connection.textContent = 'Recorded state refreshed · ' + new Date().toLocaleTimeString(); }
    catch (error) { connection.textContent = 'Not connected — decisions are disabled'; showMessage(error.message + ' If the owner is still running, try Refresh progress. Reopening this page does not start work or renew approval.', true); throw error; }
  }
  document.getElementById('refresh').addEventListener('click', () => { if (!pending) void refresh().catch(() => {}); });
  document.getElementById('lock-console').addEventListener('click', () => { void action(async () => { await api('/api/logout', {}); locked = true; jobs.replaceChildren(); connection.textContent = 'Console locked'; showMessage('This browser session is locked. Work and approvals are unchanged. Open your private operator link to unlock it again.'); }); });
  window.addEventListener('pageshow', event => { if (event.persisted && !pending) void refresh().catch(() => {}); });
  void refresh().catch(() => {});
})();
</script></body></html>`;
}

/** Separate operator bearer. Never expose this URL through service.call/MCP. */
export async function createAssistantConsole(service: Service, options: { port?: number; isStopping?: () => boolean; application?: ApplicationOptions } = {}) {
    const token = randomBytes(32).toString("hex"), nonce = randomBytes(20).toString("base64");
    let stopped = false;
    const isStopping = () => stopped || options.isStopping?.() === true;
    const assertAccepting = () => { if (isStopping()) throw new Error("The local owner is stopping. No new approval or review action is accepted; retained evidence remains readable."); };
    const shell = renderAssistantConsole(nonce), reviews = new Map<string, { work: Promise<ReviewServer>; supervision: ReturnType<typeof superviseAssistantReview> }>();
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'` };
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    const sessions = createOperatorBrowserSessions(token, headers);
    let origin = "";
    async function beforeReviewCommand(jobId: string) {
        assertAccepting();
        await service.assertJobActive(jobId);
        const view = await service.status(jobId);
        if (view.operations.some((op: { status: string }) => ["accepted", "running", "cancel-requested", "uncertain"].includes(op.status))) throw new Error("An operation is active or uncertain. Inspect it before another decision; no overlapping work was started.");
        assertAccepting();
    }
    const server = Bun.serve({ hostname: "127.0.0.1", port: options.port ?? 0, development: false, maxRequestBodySize: 16 * 1024, async fetch(request) {
        const url = new URL(request.url);
        if (!origin || url.origin !== origin || request.headers.get("host") !== new URL(origin).host) return json({ error: "Unrecognized local operator origin" }, 403);
        if (request.method === "GET" && url.pathname === "/" && !url.search) return new Response(shell, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
        const sessionResponse = await sessions.handle(request, origin); if (sessionResponse) return sessionResponse;
        const authentication = sessions.authenticate(request, origin); if (authentication instanceof Response) return authentication;
        try {
            if (request.method === "GET" && url.pathname === "/api/jobs" && !url.search) {
                const jobs = await Promise.all((await service.list()).map(async status => {
                    const proposal = await service.inspectProposal(status.jobId);
                    return { status: isStopping() ? { ...status, nextAction: "The local owner is stopping. Read retained evidence; no new decision or execution is accepted." } : status, proposal, proposalRevision: hashValue(proposal), destination: service.workspace.destination, canApprove: !isStopping() && status.outcome === "awaiting-approval" && !!proposal.plan && !proposal.questions.length, canReview: !isStopping() && status.stage !== "intake" && status.outcome !== "cancelled" };
                }));
                return json({ schema_version: "wringer.assistant-console.v1", jobs, limitation: ASSISTANT_WARNING });
            }
            if (request.method === "POST" && ["/api/approve", "/api/review"].includes(url.pathname) && !url.search) {
                assertAccepting();
                if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return json({ error: "Use an explicit JSON decision" }, 415);
                const raw = await request.text();
                if (Buffer.byteLength(raw) > 16 * 1024) return json({ error: "Decision exceeds its size limit" }, 413);
                if (url.pathname === "/api/approve") {
                    const body = parseBody(JSON.parse(raw), ["jobId", "expectedRevision", "actor", "expiresAt", "confirmExecution"]);
                    await service.assertJobActive(body.jobId);
                    if (typeof body.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedRevision) || typeof body.actor !== "string" || typeof body.expiresAt !== "string" || body.confirmExecution !== true) throw new Error("Review the exact proposal, enter your name and a future expiry, then explicitly confirm bounded execution.");
                    assertAccepting();
                    const result = await approveAssistantProposal(service.root, { jobId: body.jobId, expectedRevision: body.expectedRevision, actor: body.actor, expiresAt: body.expiresAt, confirmExecution: body.confirmExecution });
                    return json({ outcome: "approved", jobId: body.jobId, expiresAt: result.authority.expires_at, limitation: ASSISTANT_WARNING });
                }
                const body = parseBody(JSON.parse(raw), ["jobId"]);
                await service.assertJobActive(body.jobId);
                assertAccepting();
                if (!reviews.has(body.jobId)) {
                    const supervision = superviseAssistantReview(service, body.jobId, isStopping);
                    const pending = createPmWorkspaceServer(assistantControllerState(service.root, body.jobId), { ...options.application, signal: supervision.signal, beforeCommand: () => beforeReviewCommand(body.jobId), returnToConsole: `${origin}/` });
                    reviews.set(body.jobId, { work: pending, supervision });
                    void pending.then(board => { if (supervision.signal.aborted) void board.server.stop(true); }, () => { supervision.stop(); reviews.delete(body.jobId); });
                }
                const review = reviews.get(body.jobId)!;
                const board = await review.work;
                review.supervision.signal.throwIfAborted(); assertAccepting();
                return json({ url: board.url, note: "Private operator review link. Do not share it with the assistant." });
            }
            return json({ error: "Not found" }, 404);
        } catch (error) {
            return json({ error: error instanceof AssistantRefusal ? error.message : new Redactor().scrub(error instanceof Error ? error.message : "The retained state could not be read. Refresh before deciding.") }, 409);
        }
    } });
    origin = server.url.origin;
    return { server, origin, url: `${origin}/#token=${token}`, async stop() {
        stopped = true;
        sessions.clear();
        for (const review of reviews.values()) review.supervision.stop();
        await server.stop(true);
        await Promise.all([...reviews.values()].map(async review => { try { await (await review.work).server.stop(true); } catch { /* A refused workspace did not create a server. */ } }));
    } };
}
