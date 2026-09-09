/** Optional, same-page research card. It cannot operate production Yes or Send. */
function improvementClient() {
    const panel = document.getElementById("improvements-panel")!, content = document.getElementById("improvements-content")!, message = document.getElementById("improvements-message")!;
    let busy = false, locked = false, generation = 0, readFailed = false;
    const node = (tag: string, text?: string) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
    const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    async function api(path: string, body?: unknown) {
        const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", headers: { "X-Wringer-Console": "1", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
        const text = await response.text(); if (text.length > 2 * 1024 * 1024) throw new Error("Comparison evidence is too large to review here");
        const value = JSON.parse(text); if (!response.ok) throw new Error(value.error || "This comparison decision was refused"); return value;
    }
    async function act(action: string, body: unknown) {
        if (busy || locked) return; busy = true; generation++;
        content.querySelectorAll("button,input").forEach(element => (element as HTMLInputElement).disabled = true);
        try { await api(`/api/improvements/${action}`, body); if (!locked) message.textContent = action === "collect" ? "Separate comparison started within the displayed allowance. Current work is unchanged." : "Future approach decision recorded. Current work and approvals are unchanged."; }
        catch (error) { if (!locked) message.textContent = (error as Error).message + " Nothing was automatically repeated."; }
        finally { busy = false; await refresh(); }
    }
    const input = (form: HTMLElement, label: string, type = "text") => { const field = node("input") as HTMLInputElement; field.type = type; field.required = true; field.maxLength = type === "text" ? 200 : 100; const wrapper = node("label", label); wrapper.append(field); form.append(wrapper); return field; };
    async function refresh() {
        if (busy || locked) return; const own = ++generation;
        try {
            const view = await api("/api/improvements");
            if (busy || locked || own !== generation) return;
            if (view.schema_version !== "wringer.improvement-view.v1" || typeof view.connected !== "boolean" || !hash(view.revision) || !(view.selectedDigest === null || hash(view.selectedDigest)) || !Array.isArray(view.experiments) || view.experiments.length > 16) throw new Error("Unreadable comparison record: adoption remains disabled");
            panel.hidden = !view.connected; content.replaceChildren(); if (!view.connected) return;
            content.append(node("p", "Optional improvements for future work. Reviewing costs no model calls. Your current job, Yes and Send remain separate."));
            if (view.adoption) {
                if (!hash(view.adoption.evidenceRevision) || view.adoption.sha256 !== view.revision) throw new Error("Adoption identity changed");
                content.append(node("p", `Current future approach: ${view.selectedDigest ?? "no playbook"}. ${view.adoption.note}`));
                const form = node("form"), actor = input(form, "Your name"), reason = input(form, "Why restore the previous approach?");
                const button = node("button", "Restore previous approach") as HTMLButtonElement; button.type = "submit"; button.className = "secondary"; form.append(button);
                form.addEventListener("submit", event => { event.preventDefault(); if ((form as HTMLFormElement).reportValidity()) void act("rollback", { actor: actor.value, note: reason.value, expectedRevision: view.revision, expectedCurrentDigest: view.selectedDigest, expectedEvidenceRevision: view.adoption.evidenceRevision }); });
                content.append(form);
            }
            if (!view.experiments.length) content.append(node("p", "No comparison has been registered. Nothing will be tested automatically."));
            for (const experiment of view.experiments) {
                const result = experiment.result, limits = experiment.limits;
                if (!["plannedTrials", "recordedTrials", "liveTrials", "fixtureTrials"].every(key => Number.isSafeInteger(result?.[key]) && result[key] >= 0 && result[key] <= 128) || result.plannedTrials < 2 || result.recordedTrials > result.plannedTrials || result.liveTrials + result.fixtureTrials !== result.recordedTrials) throw new Error("Comparison trial counts are inconsistent: no action is available");
                if (!/^[a-z][a-z0-9-]{0,79}$/.test(experiment.id) || !hash(experiment.planSha256) || !hash(result?.evidenceRevision) || !["eligible", "ineligible", "inconclusive"].includes(result.eligibility) || !["maxTrials", "maxRoleSessions", "wallClockSeconds"].every(key => Number.isSafeInteger(limits?.[key]) && limits[key] > 0) || !Array.isArray(result.findings) || result.findings.length > 1000) throw new Error("Incomplete comparison facts: no action is available");
                const card = node("section"); card.className = "panel";
                card.append(node("h3", experiment.prediction), node("p", `${result.eligibility === "eligible" ? "Benefit met the registered comparison rules" : result.eligibility === "ineligible" ? "Do not adopt this approach" : "Not enough evidence to adopt"}. ${result.recordedTrials}/${result.plannedTrials} trial records; ${result.liveTrials} live, ${result.fixtureTrials} scripted.`));
                const details = node("details"), list = node("ul"); details.append(node("summary", "Evidence and limits")); for (const finding of result.findings) list.append(node("li", String(finding))); details.append(list, node("p", `Evidence revision ${result.evidenceRevision}. Costs remain unknown.`)); card.append(details);
                const activity = view.collection?.[experiment.id]; if (activity) card.append(node("p", activity));
                if (result.recordedTrials === 0 && !activity) {
                    const form = node("form"); form.append(node("p", `Separate research allowance: at most ${limits.maxTrials} fresh trials, ${limits.maxRoleSessions} agent sessions and ${limits.wallClockSeconds} seconds. This may spend. It cannot send production work.`));
                    const actor = input(form, "Who authorises this separate comparison?"), expires = input(form, "Approval ends (your local time)", "datetime-local");
                    const button = node("button", "Test this improvement") as HTMLButtonElement; button.type = "submit"; form.append(button);
                    form.addEventListener("submit", event => { event.preventDefault(); if ((form as HTMLFormElement).reportValidity()) void act("collect", { experimentId: experiment.id, expectedPlanSha256: experiment.planSha256, actor: actor.value, expiresAt: new Date(expires.value).toISOString() }); }); card.append(form);
                }
                if (result.eligibility === "eligible") {
                    const form = node("form"), actor = input(form, "Who is adopting this approach?"), note = input(form, "Why use this for future work?");
                    const button = node("button", "Use for future work") as HTMLButtonElement; button.type = "submit"; form.append(button);
                    form.addEventListener("submit", event => { event.preventDefault(); if ((form as HTMLFormElement).reportValidity()) void act("promote", { experimentId: experiment.id, actor: actor.value, note: note.value, expectedRevision: view.revision, expectedCurrentDigest: view.selectedDigest, expectedEvidenceRevision: result.evidenceRevision }); }); card.append(form);
                }
                content.append(card);
            }
            if (readFailed) { message.textContent = ""; readFailed = false; }
        } catch (error) { if (own !== generation || busy || locked) return; content.replaceChildren(); readFailed = true; message.textContent = "Improvement review unavailable; no research or adoption decision is enabled. " + (error as Error).message; }
    }
    document.getElementById("refresh-improvements")!.addEventListener("click", () => void refresh());
    for (const id of ["lock-console", "lock-job-page"]) document.getElementById(id)?.addEventListener("click", () => { locked = true; generation++; content.replaceChildren(); message.textContent = ""; panel.hidden = true; });
    // The existing page establishes its private cookie; this card never receives the bearer.
    setTimeout(() => void refresh(), 1000); setInterval(() => { if (!locked && !content.contains(document.activeElement)) void refresh(); }, 10000);
}
export function withImprovementCard(html: string, nonce: string): string {
    if (!/^[A-Za-z0-9+/_=-]{8,200}$/.test(nonce)) throw new Error("Use the existing safe script nonce");
    return html.replace("</main>", `<details id="improvements-panel" class="panel" hidden><summary>Optional · improve future work</summary><p id="improvements-message" aria-live="polite"></p><div id="improvements-content"></div><button id="refresh-improvements" type="button" class="secondary">Refresh improvement evidence</button></details></main>`).replace("</body>", `<script nonce="${nonce}">(${improvementClient.toString()})();</script></body>`);
}
