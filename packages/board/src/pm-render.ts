/// <reference lib="dom" />
import { randomBytes } from "node:crypto";
import { pmOutcome, validatePmWorkspace, type PmWorkspace } from "./pm-model";

function pmEscape(value: unknown): string { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)); }
function safePmLink(value: unknown): string | null {
    if (typeof value !== "string") return null;
    try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; } catch { return null; }
}
function pmEvidence(state: PmWorkspace): string {
    if (state.stage === "planning") return "<div class=empty>This is an unapproved planning record. No build, acceptance checks or human verdict have been recorded. The full questions and note are shown above.</div>";
    const label = (s: string) => ({ met: "Met", "not-met": "Not met", unknown: "Not evaluated yet", passed: "Passed", failed: "Failed", unavailable: "Unavailable", "not-recorded": "No check observation" }[s] ?? s);
    const criterionLabel = (c: PmWorkspace["criteria"][number]) => c.state === "unknown" && c.kind === "check" && !!state.candidate && c.checkIds.length > 0 && c.checkIds.every(id => state.checks.find(check => check.id === id)?.after.status === "passed") ? "Checks passed; independent review pending" : label(c.state);
    return state.criteria.length ? state.criteria.map((c, i) => `<article class="criterion"><details><summary><span class="row-number">${String(i + 1).padStart(2, "0")}</span><span class="criterion-heading"><strong>${pmEscape(c.title)}</strong><span class="secondary">${c.kind === "human" ? "A person decides" : "Check + independent review"} · ${c.required ? "Required" : "Optional"}</span></span><span class="state-tag ${c.state === "met" ? "good" : c.state === "not-met" ? "attention" : "quiet"}">${criterionLabel(c)}</span></summary><div class="criterion-body">${c.note === null ? "<p class=secondary>No judgement note is recorded.</p>" : `<blockquote>${pmEscape(c.note)}</blockquote>${c.by === null ? "" : `<p class=secondary>Recorded by ${pmEscape(c.by)}</p>`}`}${c.checkIds.length ? `<div class="check-list">${c.checkIds.map(id => { const check = state.checks.find(r => r.id === id); return check ? `<section class="check-pair"><h4>${pmEscape(id)}</h4><div><span>Before the change</span><strong>${pmEscape(label(check.before.status))}</strong><small>Exit ${check.before.exitCode ?? "not recorded"}</small></div><div><span>After the change</span><strong>${pmEscape(label(check.after.status))}</strong><small>Exit ${check.after.exitCode ?? "not recorded"}</small></div></section>` : `<p>Check ${pmEscape(id)} has no carried observation.</p>`; }).join("")}</div>` : ""}<p class="secondary">Requirement <code>${pmEscape(c.id)}</code>. A recorded judgement is not a claim that the specification captured every part of your intent.</p></div></details></article>`).join("") : "<div class=empty>No requirements have been recorded. Missing evidence is not a pass.</div>";
}
const actionLabels: Record<string, string> = { resume: "Continue work", "retry-verification": "Retry unavailable checks", "retry-judge": "Request another independent review", "retry-stopped": "Continue the stopped agent task", "retry-uncertain": "Resolve and retry uncertain work" };
function pmEvidenceCount(state: PmWorkspace): string {
    if (state.stage === "planning") return "Planning only · no execution approval";
    if (state.status === "unconnected") return "No run loaded";
    const required = state.criteria.filter(c => c.required);
    return `${required.filter(c => c.state === "met").length} of ${required.length} required criteria met`;
}

/** Runs only in the served workspace. There is no storage of credentials or automatic command retry. */
function pmClientRuntime() {
    const byId = (id: string) => document.getElementById(id) as HTMLElement;
    const input = (id: string) => byId(id) as HTMLInputElement;
    let token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
    // Remove the fragment before the first request or event handler; keep the credential only in this closure.
    history.replaceState(null, "", location.pathname + location.search);
    let state = validatePmWorkspace(JSON.parse(byId("pm-initial").textContent!)), connected = false, lastRead = 0, busy = false;
    let shown: { id: string; criterionId: string; candidateTree: string; revision: string } | null = null;
    let prepared: { id: string; revision: string; tree: string | null } | null = null;
    let pending: { idempotencyKey: string; expectedRevision: string; expectedCandidateTree: string | null; action: string; payload: any } | null = null;
    let commandId: string | null = null, lastRefresh: Promise<boolean> | null = null;
    const allowed = (action: string) => state.actions.find(a => a.id === action)?.enabled === true;
    const fresh = () => connected && Date.now() - lastRead < 6500;
    const say = (text: string, bad = false) => { byId("command-message").textContent = text; byId("command-message").classList.toggle("attention-text", bad); };
    const clearDisplay = () => { shown = null; byId("display-shell").hidden = true; input("review-verdict").value = ""; };
    const clearPrepared = () => { prepared = null; byId("publication-confirm").hidden = true; input("publication-consent").checked = false; };
    const updateControls = () => {
        byId("connection").textContent = !token ? "Read-only · access token missing" : fresh() ? busy ? "Connected · action in progress" : "Connected · current record" : "Disconnected · actions paused";
        byId("connection").className = `connection ${fresh() ? "good" : "attention"}`;
        document.querySelectorAll<HTMLButtonElement>("[data-command]").forEach(button => {
            const action = button.dataset.command!, reason = state.actions.find(a => a.id === action)?.reason ?? "Not available in this state.";
            let ready = !!token && fresh() && !busy && !pending && allowed(action);
            if (action === "show") ready = ready && !!input("criterion").value;
            if (action === "review") ready = ready && !!shown && shown.candidateTree === state.candidate?.tree && shown.revision === state.revision;
            if (action === "publish") ready = ready && !!prepared && prepared.revision === state.revision && prepared.tree === (state.candidate?.tree ?? null) && input("publication-consent").checked;
            const unavailable = !token ? "Open the private workspace link to act." : !fresh() ? "Waiting for a current controller connection." : busy || pending ? "Another action is still being resolved." : !allowed(action) ? reason : action === "review" && !ready ? "Show this exact candidate successfully before recording your own judgement." : action === "publish" && !ready ? "Prepare the delivery and confirm its exact destination before publishing." : action === "show" && !ready ? "Select a declared human requirement to display." : "";
            button.disabled = !ready;
            button.setAttribute("aria-describedby", `reason-${action}`);
            const explanation = byId(`reason-${action}`); if (explanation) explanation.textContent = unavailable;
            if (["resume", "retry-verification", "retry-judge", "retry-stopped", "retry-uncertain"].includes(action)) {
                // Keep an exhausted ordinary Continue visible with its reason;
                // it must not disappear or pretend another click buys a grant.
                button.hidden = action !== "resume" && !allowed(action);
                if (explanation) explanation.hidden = button.hidden;
            }
        });
        byId("review-form").hidden = !shown;
        byId("decision").setAttribute("aria-busy", String(busy));
        (byId("recover-command") as HTMLButtonElement).disabled = !fresh() || !pending || !!commandId;
        byId("recover-command").hidden = !pending || !!commandId || busy;
    };
    const renderState = () => {
        const outcome = pmOutcome(state);
        byId("workspace-name").textContent = state.name; byId("outcome-title").textContent = outcome.title; byId("outcome-description").textContent = outcome.description;
        document.title = `${state.name} · Wringer workspace`;
        byId("journey-id").textContent = state.status === "unconnected" ? "No run loaded" : state.journeyId;
        byId("outcome-label").textContent = outcome.label; byId("outcome-label").className = `state-tag ${outcome.tone}`;
        byId("brief").textContent = state.intent;
        byId("execution-controls").hidden = state.stage === "planning";
        byId("planning-controls-notice").hidden = state.stage !== "planning";
        byId("stop-evidence").hidden = !state.stop;
        if (state.stage === "planning") (byId("stop-evidence") as HTMLDetailsElement).open = true;
        byId("stop-evidence-title").textContent = state.stage === "planning" ? "Planning questions and proposal" : "Recorded stop evidence";
        byId("stop-reason").textContent = state.stop?.reason ?? "";
        byId("stop-message").textContent = state.stop?.message ?? "";
        const expanded = new Set(Array.from(document.querySelectorAll<HTMLElement>("#requirements article")).filter(el => el.querySelector("details")?.open).map(el => el.querySelector("code")?.textContent));
        byId("requirements").innerHTML = pmEvidence(state);
        document.querySelectorAll<HTMLElement>("#requirements article").forEach(el => { const details = el.querySelector("details"); if (details && expanded.has(el.querySelector("code")?.textContent)) details.open = true; });
        const required = state.criteria.filter(c => c.required), met = required.filter(c => c.state === "met").length;
        byId("evidence-count").textContent = pmEvidenceCount(state);
        byId("evidence-title").textContent = state.stage === "planning" ? "The planning record" : "What the evidence says";
        byId("usage-kind").textContent = state.stage === "planning" ? "planning sessions reserved / approved ceiling" : "agent sessions used / approved ceiling";
        byId("source-commit").textContent = state.candidate?.commit ?? "No candidate recorded";
        byId("source-tree").textContent = state.candidate?.tree ?? "Not recorded";
        byId("changed-paths").textContent = state.candidate?.changedPaths.join("\n") || "No changed files are recorded yet.";
        byId("usage-sessions").textContent = state.status === "unconnected" ? "Not loaded" : `${state.usage.sessions} / ${state.usage.ceiling}`;
        byId("usage-input").textContent = state.usage.inputTokens === null ? "Not reported" : state.usage.inputTokens.toLocaleString();
        byId("usage-output").textContent = state.usage.outputTokens === null ? "Not reported" : state.usage.outputTokens.toLocaleString();
        byId("updated-at").textContent = state.status === "unconnected" ? "No record loaded" : state.updatedAt; byId("record-revision").textContent = state.status === "unconnected" ? "No record loaded" : state.revision;
        byId("limits").innerHTML = state.limits.map(l => `<li>${pmEscape(l)}</li>`).join("");
        const select = input("criterion"), selected = select.value;
        select.innerHTML = state.criteria.filter(c => c.kind === "human").map(c => `<option value="${pmEscape(c.id)}">${pmEscape(c.title)}${c.state === "met" ? " — judgement recorded" : ""}</option>`).join("");
        if (state.criteria.some(c => c.kind === "human" && c.id === selected)) select.value = selected;
        byId("human-controls").hidden = !state.criteria.some(c => c.kind === "human") || !allowed("show") && !allowed("review");
        const link = safePmLink(state.publication?.url), anchor = byId("published-link") as HTMLAnchorElement;
        anchor.hidden = !link; if (link) anchor.href = link;
        byId("publication-state").textContent = state.publication ? `Recorded publication: ${state.publication.status} · ${state.publication.deliveryId}` : "Nothing has been published from this workspace.";
        updateControls();
    };
    const request = async (path: string, options: RequestInit = {}) => {
        const response = await fetch(path, { ...options, credentials: "omit", cache: "no-store", redirect: "error", headers: { "Accept": "application/json", "Authorization": `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}) }, signal: AbortSignal.timeout(15000) });
        const text = await response.text(); if (text.length > 2 * 1024 * 1024) throw new Error("The controller response exceeded the display limit.");
        let value: any; try { value = JSON.parse(text); } catch { throw new Error("The controller did not return a readable response."); }
        if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : value.error?.message ?? `Controller request failed (${response.status}).`);
        return value;
    };
    const refresh = (): Promise<boolean> => {
        if (lastRefresh) return lastRefresh;
        lastRefresh = (async () => {
            if (!token) { updateControls(); return false; }
            try {
                const next = validatePmWorkspace(await request("/api/state"));
                if (state.journeyId !== "connection-pending" && next.journeyId !== state.journeyId) throw new Error("The controller is serving a different journey. Reopen the workspace.");
                if (next.revision !== state.revision || next.candidate?.tree !== state.candidate?.tree) { clearDisplay(); clearPrepared(); }
                const changed = JSON.stringify(next) !== JSON.stringify(state);
                state = next; connected = true; lastRead = Date.now(); if (changed) renderState(); else updateControls();
                return true;
            } catch (error) { connected = false; say(String(error instanceof Error ? error.message : error), true); updateControls(); return false; }
        })().finally(() => { lastRefresh = null; });
        return lastRefresh;
    };
    const acceptResult = (action: string, result: any) => {
        if (action === "show") {
            const receipt = result?.receipt;
            byId("display-output").textContent = typeof result?.output === "string" ? result.output : "No display output was returned.";
            byId("display-shell").hidden = false;
            byId("shown-candidate").textContent = `Recorded candidate: ${receipt?.candidateTree ?? "not established"}`;
            if (receipt?.success === true && typeof receipt.id === "string" && /^[a-f0-9-]{36}$/.test(receipt.id) && receipt.criterionId === pending?.payload.criterionId && receipt.candidateTree === state.candidate?.tree && pending?.expectedRevision === state.revision) {
                shown = { id: receipt.id, candidateTree: receipt.candidateTree, criterionId: pending.payload.criterionId, revision: state.revision };
                say("The display succeeded. Read the result, then record your own judgement.");
            } else { shown = null; say("The display did not establish the current candidate. No judgement can be recorded against it.", true); }
        } else if (action === "prepare-delivery") {
            clearPrepared();
            if (typeof result?.preparedId !== "string" || !/^[a-f0-9-]{36}$/.test(result.preparedId) || result.preparedId !== pending?.idempotencyKey) throw new Error("Preparation returned no durable publication identity matching this action. Nothing can be published from this view.");
            if (!pending || pending.expectedRevision !== state.revision || pending.expectedCandidateTree !== (state.candidate?.tree ?? null)) throw new Error("The candidate changed while preparing delivery. Inspect the current record and prepare it again.");
            const delivery = result.delivery, destination = pending.payload;
            if (!state.candidate || result.remote !== destination.remote || result.sourceBranch !== destination.sourceBranch || result.targetBranch !== destination.targetBranch || !delivery || delivery.sourceBranch !== destination.sourceBranch || delivery.targetBranch !== destination.targetBranch || delivery.codeCommit !== state.candidate.commit || delivery.status !== "prepared" || delivery.pushed !== false || typeof result.evidenceCommit !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(result.evidenceCommit) || delivery.evidenceCommit !== result.evidenceCommit || result.evidenceCommit === delivery.codeCommit) throw new Error("The prepared destination or source identity does not match this request and reviewed candidate. Nothing can be published from this view.");
            prepared = { id: result.preparedId, revision: state.revision, tree: state.candidate?.tree ?? null };
            byId("prepared-destination").textContent = result.remote;
            byId("prepared-branches").textContent = `${result.sourceBranch} → ${result.targetBranch}`;
            byId("prepared-candidate").textContent = `${delivery.codeCommit.slice(0, 12)} · ${state.candidate.changedPaths.length} changed ${state.candidate.changedPaths.length === 1 ? "file" : "files"}`;
            const required = state.criteria.filter(c => c.required), passing = state.checks.filter(c => c.after.status === "passed").length, red = state.checks.filter(c => c.before.status === "failed" && c.after.status === "passed").length;
            byId("prepared-evidence").textContent = `${required.filter(c => c.state === "met").length} of ${required.length} required criteria met. ${passing} of ${state.checks.length} checks passing; ${red} recorded failing before the change.`;
            byId("prepared-notes").textContent = state.criteria.filter(c => c.kind === "human" && c.note !== null).map(c => `${c.title}${c.by ? ` — ${c.by}` : ""}\n${c.note}`).join("\n\n") || "No human review note is recorded.";
            byId("prepared-details").textContent = JSON.stringify(result, null, 2); byId("publication-confirm").hidden = false; input("publication-consent").checked = false;
            say("Delivery prepared. Review its destination and exact result before the separate publication confirmation.");
        } else { if (action === "review") clearDisplay(); if (action === "publish") clearPrepared(); const outcome = pmOutcome(state); say(`${action === "review" ? "Your judgement was recorded. " : "The action returned. "}${outcome.title} ${outcome.description}`, !!state.stop || outcome.tone === "attention"); }
    };
    const pollCommand = async () => {
        if (!commandId || !pending) return;
        let terminal = false;
        try {
            const response = await request(`/api/commands/${encodeURIComponent(commandId)}`);
            if (response.commandId !== commandId) throw new Error("The controller returned another action's identity. No result was accepted.");
            if (response.status === "running") { setTimeout(pollCommand, 1500); return; }
            if (!["completed", "failed", "uncertain"].includes(response.status)) throw new Error("Command state is unreadable; no action has been repeated.");
            terminal = true;
            if (!await refresh()) throw new Error("The latest controller record could not be loaded; the result is not accepted against stale state.");
            if (response.status === "completed") acceptResult(pending.action, response.result);
            else say(response.status === "uncertain" ? `The outcome is uncertain. ${response.error ?? "Inspect the current record before authorizing a retry."}` : String(response.error ?? "The action failed. Inspect the recorded next step."), true);
            pending = null; commandId = null; busy = false; updateControls();
        } catch (error) {
            if (terminal) { pending = null; commandId = null; busy = false; say(`The recorded action ended, but its result could not be displayed. ${String(error instanceof Error ? error.message : error)} No command was repeated.`, true); updateControls(); }
            else { connected = false; say(`The action may still be running. ${String(error instanceof Error ? error.message : error)} No command was repeated.`, true); updateControls(); setTimeout(pollCommand, 2000); }
        }
    };
    const sendPending = async () => {
        if (!pending || !fresh()) return;
        busy = true; updateControls();
        try {
            const response = await request("/api/commands", { method: "POST", body: JSON.stringify(pending) });
            if (typeof response.commandId !== "string" || !/^[a-f0-9-]{36}$/i.test(response.commandId) || response.commandId !== pending.idempotencyKey) throw new Error("No matching durable command identity was returned.");
            commandId = response.commandId; say("The controller accepted this action. You can follow its result here."); await pollCommand();
        } catch (error) { busy = false; connected = false; say(`Could not confirm this request. ${String(error instanceof Error ? error.message : error)} Recover the same action after reconnection; it will keep its original identity.`, true); updateControls(); }
    };
    const run = async (action: string, payload: any) => {
        if (!fresh() || busy || pending || !allowed(action)) { say("This action is not available against the current connected record.", true); return; }
        pending = { idempotencyKey: crypto.randomUUID(), expectedRevision: state.revision, expectedCandidateTree: state.candidate?.tree ?? null, action, payload };
        await sendPending();
    };
    document.addEventListener("click", event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-command]"); if (!button || button.disabled || button.type === "submit") return;
        const action = button.dataset.command!;
        if (action === "show") { clearDisplay(); void run(action, { criterionId: input("criterion").value }); }
        else if (action === "publish") { if (prepared && input("publication-consent").checked) void run(action, { preparedId: prepared.id }); }
        else void run(action, {});
    });
    document.addEventListener("submit", event => {
        const form = event.target as HTMLFormElement; if (!form.matches("form[data-action]")) return; event.preventDefault(); if (!form.checkValidity()) return;
        const data = new FormData(form), field = (name: string) => String(data.get(name) ?? ""), action = form.dataset.action!;
        if (action === "review") {
            if (!shown || shown.candidateTree !== state.candidate?.tree || shown.revision !== state.revision || !["met", "not_met"].includes(field("verdict"))) return;
            void run(action, { criterionId: shown.criterionId, displayId: shown.id, verdict: field("verdict"), by: field("by"), note: field("note") });
        } else if (action === "request-revision") void run(action, { by: field("by"), note: field("note") });
        else if (action === "prepare-delivery") {
            clearPrepared(); updateControls();
            const payload: any = { remote: field("remote"), sourceBranch: field("sourceBranch"), targetBranch: field("targetBranch") };
            if (field("forgeKind")) {
                if (!["github", "gitlab"].includes(field("forgeKind")) || !field("forgeEndpoint") || !field("forgeRepo") || !field("forgeTokenEnv")) { say("For a hosted review request, declare its service, repository and credential variable name. Never paste a key here.", true); return; }
                payload.forge = { kind: field("forgeKind"), endpoint: field("forgeEndpoint"), repo: field("forgeRepo"), token_env: field("forgeTokenEnv") };
            }
            void run(action, payload);
        }
    });
    input("criterion").addEventListener("change", () => { clearDisplay(); updateControls(); });
    input("publication-consent").addEventListener("change", updateControls);
    byId("recover-command").addEventListener("click", () => { if (pending && !commandId) void sendPending(); });
    byId("refresh-state").addEventListener("click", () => { void refresh(); });
    window.addEventListener("pagehide", () => { token = ""; connected = false; });
    renderState(); void refresh(); setInterval(() => { updateControls(); void refresh(); }, 2000);
}

export function pmClientScript(): string {
    return `const pmEscape=${pmEscape.toString()};const safePmLink=${safePmLink.toString()};const pmEvidence=${pmEvidence.toString()};const pmEvidenceCount=${pmEvidenceCount.toString()};const pmOutcome=${pmOutcome.toString()};const validatePmWorkspace=${validatePmWorkspace.toString()};(${pmClientRuntime.toString()})();`;
}

const css = `
body{overflow-wrap:anywhere}.decision{min-width:0}.criterion-heading strong{overflow-wrap:anywhere}.connection{border-radius:6px;padding:2px 5px}
:root{color-scheme:light;--paper:#f3f1e8;--surface:#fffdf6;--ink:#23382e;--muted:#566359;--line:#d8ddd1;--forest:#264f3b;--soft:#e4eee1;--amber:#805215;--amber-bg:#fff0d2;--danger:#a13d31}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select,textarea{font:inherit}button,a,summary{-webkit-tap-highlight-color:transparent}button,input,select,textarea{border-radius:9px}button{min-height:46px;border:1px solid var(--forest);background:var(--forest);color:white;padding:.7rem 1rem;font-weight:650;cursor:pointer}button.secondary-button{background:transparent;color:var(--forest);border-color:var(--line)}button:disabled{cursor:not-allowed;background:#e8e9df;color:#657164;border-color:#d7dbce}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid #b65d20;outline-offset:4px}a{color:var(--forest)}input,select,textarea{width:100%;padding:.7rem .8rem;border:1px solid #97a692;background:#fffef9;color:var(--ink);min-height:46px}textarea{min-height:96px;resize:vertical}label{display:block;margin:1rem 0 .35rem;font-weight:600}h1,h2,h3,h4,p{margin-top:0}h1{font-family:Georgia,serif;font-size:clamp(36px,4vw,58px);font-weight:450;line-height:1.1;letter-spacing:-1.6px;margin-bottom:1rem}h2{font-size:23px;line-height:1.25;letter-spacing:-.4px}h3{font-size:18px;line-height:1.3}h4{font-size:16px;margin:0}small,.secondary,.eyebrow,.state-tag,.connection,code{font-size:14px}.secondary{color:var(--muted)}.eyebrow{font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted)}.page{max-width:1320px;margin:auto;padding:0 40px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:24px 0;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:12px;font-size:22px;font-weight:750;letter-spacing:-.8px}.brand-mark{display:grid;place-items:center;width:35px;height:35px;border:2px solid var(--forest);border-radius:12px;transform:rotate(-6deg)}.top-right{display:flex;align-items:center;gap:12px}.connection{color:var(--muted)}.top-right button{padding:.4rem .8rem;min-height:42px;font-size:14px}.hero{padding:36px 0 28px;max-width:980px}.hero .eyebrow{margin-bottom:14px}.hero-description{font-size:18px;color:var(--muted);max-width:800px;margin-bottom:20px}.state-tag{display:inline-flex;align-items:center;gap:6px;border-radius:100px;padding:5px 11px;font-weight:600;white-space:normal}.good{background:var(--soft);color:var(--forest)}.attention{background:var(--amber-bg);color:var(--amber)}.quiet{background:#e7e9e1;color:var(--muted)}.workspace-grid{display:grid;grid-template-columns:minmax(0,1fr) 370px;gap:26px;align-items:start;grid-template-areas:"evidence decision" "context decision"}.decision{grid-area:decision;background:var(--surface);border:1px solid #b8c7b0;border-top:4px solid var(--forest);border-radius:16px;padding:25px;box-shadow:0 12px 32px #223f2410}.evidence{grid-area:evidence;min-width:0}.context{grid-area:context}.decision>h2{margin:12px 0}.decision details{border-top:1px solid var(--line);padding-top:17px;margin-top:20px}.decision summary{cursor:pointer;font-weight:650}.decision form p{margin-top:10px}.decision button{width:100%;margin-top:12px}.decision .action-reason:empty{display:none}.action-reason{font-size:14px;color:var(--muted);margin:6px 0 0}.field-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.checkbox{display:flex;gap:10px;align-items:flex-start;font-weight:450}.checkbox input{width:20px;min-height:20px;margin-top:3px;accent-color:var(--forest)}.command-message{font-size:15px;white-space:pre-wrap;margin:15px 0 0}.attention-text{color:var(--danger)}.display-shell{margin-top:20px;padding-top:20px;border-top:1px solid var(--line)}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font:14px/1.65 ui-monospace,SFMono-Regular,monospace;background:#eef0e7;padding:15px;border-radius:10px;max-height:420px;overflow:auto}.display-shell pre{max-height:520px;background:#213e2f;color:#f3f6eb}code{overflow-wrap:anywhere;word-break:break-word}blockquote{margin:12px 0;padding:10px 17px;border-left:3px solid #8ca67a;white-space:pre-wrap;background:#f1f3e9}.section-heading{display:flex;justify-content:space-between;align-items:baseline;gap:18px;margin:0 0 18px}.section-heading h2{margin:0}.section-heading p{margin:0}.criterion{background:var(--surface);border:1px solid var(--line);border-radius:13px;margin-bottom:10px;overflow:hidden}.criterion summary{padding:20px;display:flex;gap:14px;align-items:center;list-style:none;cursor:pointer}.criterion summary::-webkit-details-marker{display:none}.row-number{align-self:flex-start;color:var(--muted);font-size:14px}.criterion-heading{display:flex;flex-direction:column;gap:5px;flex:1;min-width:0}.criterion-heading strong{font-size:17px;font-weight:600;line-height:1.4}.criterion-body{padding:0 22px 18px;border-top:1px solid var(--line)}.criterion-body>p{margin-top:12px}.check-pair{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:18px 0}.check-pair h4{grid-column:1/-1}.check-pair>div{padding:12px;background:#edf1e5;border-radius:8px;display:flex;flex-direction:column}.check-pair strong{font-size:18px}.check-pair small{color:var(--muted)}.context-cards{display:grid;grid-template-columns:1fr 1fr;gap:18px}.context-card{border:1px solid var(--line);border-radius:14px;padding:22px;background:#f8f7f0;min-width:0}.context-card h2{font-size:19px;margin-bottom:15px}.usage-number{font-size:34px;font-family:Georgia,serif;line-height:1.2;margin:0 0 3px}.usage-facts{display:grid;grid-template-columns:1fr auto;gap:7px;margin:20px 0 0}.usage-facts dt{color:var(--muted)}.usage-facts dd{margin:0}.footer{margin-top:32px;padding:24px 0 40px;border-top:1px solid var(--line);color:var(--muted)}.footer summary{cursor:pointer;font-weight:600}.footer li{margin:8px 0}.metadata{margin-top:20px}.metadata dt{font-weight:600;margin-top:10px}.metadata dd{margin:0;overflow-wrap:anywhere}.skip{position:absolute;left:20px;top:-100px;background:var(--forest);color:white;padding:12px;z-index:5}.skip:focus{top:10px}.empty{border:1px dashed var(--line);padding:26px;border-radius:12px;background:var(--surface)}[hidden]{display:none!important}@media(max-width:1050px){.page{padding:0 26px}.workspace-grid{grid-template-columns:minmax(0,1fr) 335px;gap:18px}.criterion summary{flex-wrap:wrap}.criterion summary>.state-tag{margin-left:28px}.context-cards{grid-template-columns:1fr}}@media(max-width:780px){.page{padding:0 18px}.topbar{padding:18px 0;align-items:flex-start}.top-right{align-items:flex-end;flex-direction:column;gap:5px}.brand{font-size:20px}.hero{padding-top:28px}.hero-description{font-size:17px}.workspace-grid{grid-template-columns:1fr;grid-template-areas:"decision" "evidence" "context";gap:24px}.decision{padding:22px}.section-heading{align-items:flex-start;flex-direction:column;gap:5px}.criterion summary{padding:18px}.context-cards{grid-template-columns:1fr 1fr}.field-pair{grid-template-columns:1fr}}@media(max-width:480px){.context-cards{grid-template-columns:1fr}.check-pair{grid-template-columns:1fr}.check-pair h4{grid-column:1}.connection{max-width:180px;text-align:right}.brand-mark{width:30px;height:30px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}@media print{.page{padding:0}.top-right,.decision form,.decision button{display:none}.workspace-grid{display:block}.decision,.context-card,.criterion{break-inside:avoid;box-shadow:none}.decision{margin-bottom:20px}.context-cards{margin-top:24px}body{background:white}}
`;

export function renderPmWorkspace(initial: PmWorkspace, options: { live: boolean; nonce?: string }): string {
    const state = validatePmWorkspace(initial), outcome = pmOutcome(state), nonce = options.nonce ?? randomBytes(18).toString("base64");
    if (!/^[A-Za-z0-9+/_=-]{8,160}$/.test(nonce)) throw new Error("Workspace nonce must be a bounded CSP nonce");
    const e = pmEscape, required = state.criteria.filter(c => c.required), link = safePmLink(state.publication?.url);
    const button = (action: string, title: string, submit = false) => `<button type="${submit ? "submit" : "button"}" data-command="${action}" aria-label="${e(title)}" aria-describedby="reason-${action}" disabled>${e(title)}</button><p class="action-reason" id="reason-${action}">${e(state.actions.find(a => a.id === action && !a.enabled)?.reason ?? "")}</p>`;
    const stopEvidence = `<details id="stop-evidence"${state.stage === "planning" ? " open" : ""}${state.stop ? "" : " hidden"}><summary id="stop-evidence-title">${state.stage === "planning" ? "Planning questions and proposal" : "Recorded stop evidence"}</summary><p class="secondary" id="stop-reason">${e(state.stop?.reason ?? "")}</p><pre id="stop-message" tabindex="0" aria-label="Original recorded planning or stop evidence">${e(state.stop?.message ?? "")}</pre></details>`;
    const executionControls = options.live ? `<div id="human-controls"${state.criteria.some(c => c.kind === "human") ? "" : " hidden"}><label for="criterion">What would you like to review?</label><select id="criterion">${state.criteria.filter(c => c.kind === "human").map(c => `<option value="${e(c.id)}">${e(c.title)}</option>`).join("")}</select>${button("show", "Show the recorded result")}<div class="display-shell" id="display-shell" hidden><h3>The recorded result</h3><p class="secondary" id="shown-candidate"></p><pre id="display-output" tabindex="0" aria-label="Inert recorded display output"></pre></div><form data-action="review" id="review-form" hidden><label for="review-verdict">Does this meet the requirement?</label><select id="review-verdict" name="verdict" required><option value="">Make your own judgement…</option value="met">Yes, this meets it</option><option value="not_met">No, it needs more work</option></select><label for="review-by">Your name</label><input id="review-by" name="by" autocomplete="name" required maxlength="200"><label for="review-note">Your note, in your own words</label><textarea id="review-note" name="note" required maxlength="16000"></textarea>${button("review", "Record my judgement", true)}<p class="secondary">This records your decision against the exact result shown. Nothing answers for you.</p></form></div><div id="continue-actions">${Object.entries(actionLabels).map(([action, title]) => button(action, title)).join("")}</div><p class="secondary">Continuing or retrying work may start agent sessions within the approved budget.</p><details><summary>Ask for a revision</summary><form data-action="request-revision"><label for="revision-by">Your name</label><input id="revision-by" name="by" required maxlength="200"><label for="revision-note">What needs to change?</label><textarea id="revision-note" name="note" required maxlength="16000"></textarea>${button("request-revision", "Request this revision", true)}</form></details><details><summary>Prepare a delivery</summary><p class="secondary">Preparation does not publish. Choose the destination; the next step is a separate confirmation.</p><form data-action="prepare-delivery"><label for="delivery-remote">Repository URL</label><input id="delivery-remote" name="remote" placeholder="https://…/team/project.git" required spellcheck="false"><label for="delivery-source">Review branch</label><input id="delivery-source" name="sourceBranch" placeholder="wringer/your-change" required spellcheck="false"><label for="delivery-target">Target branch</label><input id="delivery-target" name="targetBranch" placeholder="The repository's base branch" required spellcheck="false"><label for="forge-kind">Hosted review request</label><select id="forge-kind" name="forgeKind"><option value="">Git branch only</option><option value="github">GitHub</option><option value="gitlab">GitLab</option></select><details><summary>Hosted review settings</summary><label for="forge-endpoint">API endpoint</label><input id="forge-endpoint" name="forgeEndpoint" placeholder="https://…" spellcheck="false"><label for="forge-repo">Repository name</label><input id="forge-repo" name="forgeRepo" placeholder="team/project" spellcheck="false"><label for="forge-token">Credential variable name — never the key</label><input id="forge-token" name="forgeTokenEnv" placeholder="The already-provisioned variable name" autocomplete="off" spellcheck="false"></details>${button("prepare-delivery", "Prepare for handover", true)}</form></details><section id="publication-confirm" hidden><h3>Ready to publish this delivery?</h3><p>Nothing has been published. Confirm where this reviewed change should go.</p><dl class="metadata"><dt>Destination</dt><dd id="prepared-destination"></dd><dt>Review branch → target</dt><dd id="prepared-branches"></dd><dt>Reviewed change</dt><dd id="prepared-candidate"></dd></dl><p id="prepared-evidence"></p><h4>Your recorded review</h4><blockquote id="prepared-notes"></blockquote><details><summary>Exact delivery record</summary><pre id="prepared-details"></pre></details><label class="checkbox"><input type="checkbox" id="publication-consent"><span>I have reviewed this destination and prepared result. Publish this delivery.</span></label>${button("publish", "Publish this prepared delivery")}</section><p id="command-message" class="command-message" role="status" aria-live="polite" aria-atomic="true"></p><button id="recover-command" type="button" class="secondary-button" hidden disabled>Recover the same action</button>` : `<p>This is a saved, read-only record. It cannot run work, record a judgement or publish anything.</p>`;
    const controls = options.live ? `<p id="planning-controls-notice"${state.stage === "planning" ? "" : " hidden"}>This planning workspace is read-only. Use the recorded routes above to inspect status or preview a separately approved grant. No human verdict or execution command is available here.</p><div id="execution-controls"${state.stage === "planning" ? " hidden" : ""}>${executionControls}</div>` : executionControls;
    const boot = JSON.stringify(state).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${e(nonce)}'; script-src 'nonce-${e(nonce)}'; connect-src ${options.live ? "'self'" : "'none'"}; base-uri 'none'; form-action 'none'; object-src 'none'"><title>${e(state.name)} · Wringer workspace</title><style nonce="${e(nonce)}">${css}</style></head><body><a class="skip" href="#decision">Skip to the next decision</a><div class="page"><header class="topbar"><div class="brand"><span class="brand-mark" aria-hidden="true">w</span>wringer</div><div class="top-right"><span id="connection" class="connection" role="status" aria-live="polite">${options.live ? "Connecting to your controller…" : "Saved record · read-only"}</span>${options.live ? '<button id="refresh-state" type="button" class="secondary-button">Refresh record</button>' : ""}</div></header><main><section class="hero"><p class="eyebrow" id="workspace-name">${e(state.name)}</p><h1 id="outcome-title">${e(outcome.title)}</h1><p class="hero-description" id="outcome-description">${e(outcome.description)}</p><span id="outcome-label" class="state-tag ${outcome.tone}">${e(outcome.label)}</span></section>${stopEvidence}<div class="workspace-grid"><aside class="decision" id="decision" tabindex="-1" aria-labelledby="decision-title"><span class="eyebrow">The next useful step</span><h2 id="decision-title">${options.live ? "Decide with the result in front of you." : "The recorded outcome."}</h2>${controls}<p class="secondary" id="publication-state">${state.publication ? `Recorded publication: ${e(state.publication.status)} · ${e(state.publication.deliveryId)}` : "Nothing has been published from this workspace."}</p><a id="published-link"${link ? ` href="${e(link)}"` : " hidden"} target="_blank" rel="noopener noreferrer">Open the recorded review request ↗</a></aside><section class="evidence" aria-labelledby="evidence-title"><div class="section-heading"><h2 id="evidence-title">${state.stage === "planning" ? "The planning record" : "What the evidence says"}</h2><p class="secondary" id="evidence-count">${e(pmEvidenceCount(state))}</p></div><div id="requirements">${pmEvidence(state)}</div></section><section class="context context-cards" aria-label="Change and working budget"><article class="context-card"><h2>The change, in context</h2><details open><summary>Your original brief</summary><blockquote id="brief">${e(state.intent)}</blockquote></details><details><summary>Changed files</summary><pre id="changed-paths">${e(state.candidate?.changedPaths.join("\n") || "No changed files are recorded yet.")}</pre></details></article><article class="context-card"><h2>The working budget</h2><p class="usage-number" id="usage-sessions">${state.status === "unconnected" ? "Not loaded" : `${state.usage.sessions} / ${state.usage.ceiling}`}</p><p class="secondary" id="usage-kind">${state.stage === "planning" ? "planning sessions reserved / approved ceiling" : "agent sessions used / approved ceiling"}</p><dl class="usage-facts"><dt>Input tokens</dt><dd id="usage-input">${state.usage.inputTokens ?? "Not reported"}</dd><dt>Output tokens</dt><dd id="usage-output">${state.usage.outputTokens ?? "Not reported"}</dd><dt>Cost</dt><dd>Not reported</dd></dl><p class="secondary">Unknown usage is not free usage. These are recorded observations, not a billing statement.</p></article></section></div></main><footer class="footer"><details><summary>What this record does and does not claim</summary><ul id="limits">${state.limits.map(l => `<li>${e(l)}</li>`).join("")}</ul></details><details class="metadata"><summary>Exact record identities</summary><dl><dt>Journey</dt><dd id="journey-id">${e(state.status === "unconnected" ? "No run loaded" : state.journeyId)}</dd><dt>Candidate commit</dt><dd><code id="source-commit">${e(state.candidate?.commit ?? "No candidate recorded")}</code></dd><dt>Candidate tree</dt><dd><code id="source-tree">${e(state.candidate?.tree ?? "Not recorded")}</code></dd><dt>Journal revision</dt><dd><code id="record-revision">${e(state.status === "unconnected" ? "No record loaded" : state.revision)}</code></dd><dt>Record updated</dt><dd id="updated-at">${e(state.status === "unconnected" ? "No record loaded" : state.updatedAt)}</dd></dl></details></footer></div>${options.live ? `<script type="application/json" id="pm-initial" nonce="${e(nonce)}">${boot}</script><script nonce="${e(nonce)}">${pmClientScript()}</script>` : ""}</body></html>`;
}
