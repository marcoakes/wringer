/// <reference lib="dom" />
/** This card receives only the existing operator cookie. Assistant tools cannot
 * connect Figma, retrieve tokens, disclose pixels or click approval for a human. */
function figmaClient() {
    const panel = document.getElementById("figma-panel")!, content = document.getElementById("figma-content")!, message = document.getElementById("figma-message")!;
    let busy = false, locked = false, generation = 0;
    const blobs = new Set<string>();
    const node = (tag: string, text?: string) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
    const release = () => { for (const url of blobs) URL.revokeObjectURL(url); blobs.clear(); };
    async function api(path: string, body?: unknown) {
        const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", headers: { "X-Wringer-Console": "1", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90000) });
        const value = await response.json(); if (!response.ok) throw new Error(value.error || "This design action was refused."); return value;
    }
    async function action(run: () => Promise<void>) {
        if (busy || locked) return; busy = true; generation++;
        content.querySelectorAll("button,input").forEach(el => (el as HTMLInputElement).disabled = true);
        try { await run(); } catch (error) { if (!locked) message.textContent = (error as Error).message + " Nothing was automatically retried."; }
        finally { busy = false; if (!locked) await refresh(); }
    }
    const button = (label: string, run: () => Promise<void>) => { const el = node("button", label) as HTMLButtonElement; el.type = "button"; el.addEventListener("click", () => void action(run)); return el; };
    const field = (form: HTMLElement, label: string, required = true) => { const wrapper = node("label", label), input = node("input") as HTMLInputElement; input.required = required; input.maxLength = 2048; wrapper.append(input); form.append(wrapper); return input; };
    async function renderPreview(row: any, own: number) {
        const card = node("article"); card.className = "card panel";
        card.append(node("h3", row.outcome === "retained" ? "Design reference retained" : "Review your selected design"), node("p", row.nextAction));
        card.append(node("small", row.route));
        card.append(node("h4", "Selected Figma frames"));
        for (const url of row.urls) card.append(node("p", url));
        if (row.outcome === "needs-preview") card.append(button("Preview these frames privately", async () => { await api("/api/design/preview", { importId: row.importId, confirmPrivatePreview: true }); }));
        if (row.outcome === "retained") card.append(button("Use these references for new work", async () => { await api("/api/design/attach", { importId: row.importId, expectedSnapshotSha256: row.retainedSha256, confirmAttachment: true }); }));
        if (row.outcome === "needs-retention-permission") {
            let displayed = 0;
            const form = node("form") as HTMLFormElement, actor = field(form, "Your name"); actor.maxLength = 200; actor.autocomplete = "name";
            const confirmLabel = node("label"), confirm = node("input") as HTMLInputElement; confirm.type = "checkbox"; confirm.required = true;
            confirmLabel.append(confirm, node("span", "I have permission to retain these exact design bytes in the private test repository and its handover."));
            const submit = node("button", "Keep these references") as HTMLButtonElement; submit.type = "submit"; submit.disabled = true;
            form.append(confirmLabel, node("p", "This permits storing these references only. It does not approve a plan, say the implementation looks right or send work."), submit);
            for (const asset of row.assets) {
                const figure = node("figure"), image = node("img") as HTMLImageElement;
                image.alt = asset.title; image.width = asset.width; image.height = asset.height; image.style.maxWidth = "100%"; image.style.height = "auto";
                figure.append(image, node("figcaption", asset.title + " · " + asset.width + " × " + asset.height)); card.append(figure);
                void (async () => {
                    try {
                        const params = new URLSearchParams({ importId: row.importId, assetId: asset.id, expectedPreviewSha256: row.previewSha256 });
                        const response = await fetch("/api/design/asset?" + params, { credentials: "same-origin", cache: "no-store", redirect: "error", headers: { "X-Wringer-Console": "1", Accept: "image/png" }, signal: AbortSignal.timeout(15000) });
                        if (!response.ok || response.headers.get("content-type") !== "image/png") throw new Error("The actual design reference could not be displayed.");
                        const bytes = await response.blob(); if (bytes.size > 4 * 1024 * 1024 || locked || own !== generation) return;
                        const url = URL.createObjectURL(bytes); blobs.add(url); image.src = url; await image.decode();
                        if (locked || own !== generation) return;
                        displayed++; submit.disabled = displayed !== row.assets.length;
                    } catch { if (!locked && own === generation) { submit.disabled = true; figure.append(node("p", "Reference display failed. Retention is disabled; refresh to inspect the exact images.")); } }
                })();
            }
            form.addEventListener("submit", event => { event.preventDefault(); if (displayed !== row.assets.length || !displayed || !form.reportValidity()) return; void action(async () => { await api("/api/design/confirm", { importId: row.importId, expectedPreviewSha256: row.previewSha256, actor: actor.value, confirmRetention: confirm.checked }); }); });
            card.append(form);
        }
        const detail = node("details"); detail.append(node("summary", "Reference identity"), node("p", `Import ${row.importId}. Preview ${row.previewSha256 ?? "not captured"}. Retained ${row.retainedSha256 ?? "not permitted"}.`)); card.append(detail);
        content.append(card);
    }
    async function refresh() {
        if (locked || busy) return; const own = ++generation;
        release(); content.replaceChildren();
        try {
            const view = await api("/api/design"); if (locked || own !== generation) return;
            const state = view.connection;
            content.append(node("p", state.message), node("p", "Figma API import through Wringer. This is not Figma's official remote MCP service. Your coding app never receives the sign-in link or credentials."));
            content.append(node("p", view.attachmentReady ? "This workspace expects these reference sizes: " + view.expectedDisplays.map((display: any) => display.width + " × " + display.height).join(", ") + ". Select matching desktop/mobile frames." : "This workspace has no contained visual-review setup. You can preview a design, but attachment requires an operator-configured design-ready workspace; no renderer will be invented."));
            if (["needs-connection", "reconnect-required", "connecting"].includes(state.state)) content.append(button("Connect Figma", async () => {
                const result = await api("/api/design/connect", {}); if (!locked) message.textContent = result.nextAction;
            }));
            if (state.state === "connecting") content.append(button("Check Figma connection", async () => { await api("/api/design/poll", {}); }));
            if (state.state === "connected") content.append(button("Disconnect Figma", async () => { await api("/api/design/disconnect", {}); }));
            const form = node("form") as HTMLFormElement; form.append(node("h3", "Bring your desktop and mobile design"));
            const desktop = field(form, "Desktop Figma frame or layer link"), mobile = field(form, "Mobile frame or layer link (optional)", false); desktop.type = mobile.type = "url";
            const submit = node("button", "Prepare these references") as HTMLButtonElement; submit.type = "submit";
            form.append(node("p", "Use frame/layer links from the same Figma file. Preparing only records the links; Preview retrieves and keeps a private local copy. Permission to add it to the repository comes after you inspect it."), submit);
            const requestId = crypto.randomUUID();
            form.addEventListener("submit", event => { event.preventDefault(); if (!form.reportValidity()) return; void action(async () => { await api("/api/design/prepare", { workspaceId: view.workspaceId, idempotencyKey: requestId, urls: [desktop.value.trim(), mobile.value.trim()].filter(Boolean) }); }); }); content.append(form);
            for (const row of view.imports) await renderPreview(row, own);
        } catch (error) { if (!locked && own === generation) message.textContent = "Design decisions are unavailable. " + (error as Error).message; }
    }
    panel.addEventListener("toggle", () => { if ((panel as HTMLDetailsElement).open) void refresh(); });
    document.getElementById("refresh-figma")!.addEventListener("click", () => void refresh());
    for (const id of ["lock-console", "lock-job-page"]) document.getElementById(id)?.addEventListener("click", () => { locked = true; generation++; release(); content.replaceChildren(); message.textContent = ""; });
    window.addEventListener("pagehide", release);
}

export function withFigmaCard(html: string, nonce: string) {
    if (!/^[A-Za-z0-9+/_=-]{8,200}$/.test(nonce)) throw new Error("Use the existing safe console nonce.");
    return html.replace("<main>", `<main><details id="figma-panel" class="card panel"><summary>Bring a Figma design · desktop and mobile references</summary><p id="figma-message" role="status" aria-live="polite"></p><div id="figma-content"></div><button id="refresh-figma" type="button" class="secondary">Refresh design connection</button></details>`).replace("</body>", `<script nonce="${nonce}">(${figmaClient.toString()})();</script></body>`);
}
