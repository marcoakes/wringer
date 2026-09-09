/// <reference lib="dom" />
import { randomBytes } from "node:crypto";
import { pmJobHeading, pmJobReviewSet, safeJobReviewLink, validatePmJob, type PmJob } from "./job-model";

/** One operator-owned page; no repository data or capability is embedded in
 * the public HTML shell. Model/report content is inserted as inert text. */
function jobClientRuntime() {
    const el = (id: string) => document.getElementById(id)!;
    const field = (id: string) => el(id) as HTMLInputElement;
    const button = (id: string) => el(id) as HTMLButtonElement;
    const node = (tag: string, text?: string, className?: string) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value; };
    const uuid = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
    let token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
    history.replaceState(null, "", location.pathname + location.search);
    let selected = new URLSearchParams(location.search).get("jobId") ?? "";
    if (selected && !uuid(selected)) selected = "";
    let job: PmJob | null = null, connected = false, lastRead = 0, busy = false, locked = false, unresolvedRevision: string | null = null;
    let refreshing: Promise<void> | null = null, exchange: Promise<void> | null = null, chooseCorrection = false;
    let lastList = 0, notifications = false;
    let imageGeneration = 0;
    const imageChecks = new Map<string, { displayId: string; state: "loading" | "loaded" | "failed" }>();
    const imageUrls: string[] = [], imageRequests: AbortController[] = [];
    let viewerFocus: HTMLElement | null = null;
    const closeViewer = (restoreFocus = true) => {
        const previous = viewerFocus; viewerFocus = null;
        const viewer = el("image-viewer") as HTMLDialogElement;
        if (viewer.open) viewer.close();
        el("image-viewer-image").removeAttribute("src"); el("image-viewer-title").textContent = "";
        if (restoreFocus && previous?.isConnected) previous.focus();
    };
    const clearVisuals = () => { imageGeneration++; closeViewer(false); for (const request of imageRequests.splice(0)) request.abort(); for (const url of imageUrls.splice(0)) URL.revokeObjectURL(url); imageChecks.clear(); };
    const notified = new Set<string>();
    const readyKey = (value: PmJob) => `${value.jobId}:${value.candidateTree ?? "no-candidate"}:${value.phase}`;
    const say = (text: string, error = false) => { el("job-message").textContent = text; el("job-message").classList.toggle("error", error); };
    const current = () => !locked && connected && Date.now() - lastRead < 6500;
    const usable = () => current() && !busy && unresolvedRevision === null;
    const actionButtons = ["approve-job", "accept-result", "request-correction", "submit-correction", "send-job", "retry-job"];
    const controls = () => {
        el("job-connection").textContent = locked ? "Locked" : current() ? busy ? "Saving your decision…" : "Connected" : "Connecting · decisions paused";
        el("job-workspace").setAttribute("aria-busy", String(busy));
        for (const id of actionButtons) button(id).disabled = true;
        if (!job) return;
        const allowed = usable();
        button("approve-job").disabled = !allowed || job.phase !== "approval" || !field("approval-actor").value.trim() || !!job.questions?.length;
        const review = pmJobReviewSet(job);
        const visualChecks = [...imageChecks.values()].filter(check => review.displayIds.includes(check.displayId));
        const expectedImages = job.displays.filter(display => review.displayIds.includes(display.displayId)).reduce((n, display) => n + (display.visuals ? display.visuals.referenceAssets.length + display.visuals.captures.length : 0), 0);
        const imagesReady = visualChecks.length === expectedImages && visualChecks.every(check => check.state === "loaded");
        const canReview = review.eligible && imagesReady;
        button("accept-result").disabled = !allowed || !canReview || chooseCorrection;
        button("request-correction").disabled = !allowed || !canReview;
        button("submit-correction").disabled = !allowed || !field("correction-note").value.trim() || !(job.phase === "correction" || job.phase === "review" && canReview && chooseCorrection);
        button("send-job").disabled = !allowed || job.phase !== "send" || !job.candidateTree || !job.preparedId || !job.destination?.remote.trim() || !job.requirements.some(r => r.required) || !job.requirements.filter(r => r.required).every(r => r.state === "met");
        button("retry-job").disabled = !allowed || job.phase !== "blocked" || job.retryable !== true;
        button("retry-job").hidden = job.phase !== "blocked" || job.retryable !== true;
        button("retry-job").textContent = job.retryLabel || "Retry the recorded local step";
        el("review-unavailable").textContent = review.reason || (!imagesReady ? visualChecks.some(check => check.state === "failed") ? "A required image could not be displayed. Refresh to load the recorded reference and captures before deciding." : "Loading the recorded reference and captures. Decisions are paused until every required image is visible." : "");
        button("job-picker").disabled = busy;
    };
    const clearDraft = () => { chooseCorrection = false; field("review-note").value = ""; field("correction-note").value = ""; };
    const addFact = (parent: HTMLElement, title: string, value: string) => { parent.append(node("dt", title), node("dd", value)); };
    const showDestination = (id: string, value: PmJob["destination"]) => {
        const target = el(id); target.replaceChildren();
        if (!value) { target.append(node("p", "No handover destination is registered. The assistant cannot invent one.")); return; }
        addFact(target, "Repository", value.remote); addFact(target, "Review branch", value.sourceBranch); addFact(target, "Into", value.targetBranch);
    };
    const renderReports = (value: PmJob) => {
        clearVisuals();
        const generation = imageGeneration;
        const reports = el("reports"); reports.replaceChildren();
        el("reports-panel").hidden = value.displays.length === 0;
        for (const display of value.displays) {
            const card = node("article", undefined, "report-card"); card.dataset.displayId = display.displayId; card.dataset.criterionId = display.criterionId;
            const requirement = value.requirements.find(r => r.id === display.criterionId);
            const title = display.title || requirement?.title || "Recorded result";
            card.append(node("h3", title));
            if (requirement && requirement.title.trim() !== title.trim()) card.append(node("p", requirement.title, "report-requirement"));
            if (!display.success || display.candidateTree !== value.candidateTree) card.append(node("p", display.error || "This display does not establish the current result. No human acceptance is available from it.", "error"));
            if (display.visuals) {
                card.append(node("p", "Compare the pinned reference with the actual result at each recorded screen size. Check the requirements below and describe any changes in your own words.", "report-requirement"));
                const comparison = node("div", undefined, "visual-comparison");
                for (const [kind, assets] of [["reference", display.visuals.referenceAssets], ["capture", display.visuals.captures]] as const) {
                    for (const asset of assets) {
                        const label = kind === "reference" ? "Pinned design reference" : `Actual result · ${asset.width <= 600 ? "Mobile" : "Desktop"}`;
                        const figure = node("figure", undefined, "visual-asset"), image = node("img") as HTMLImageElement;
                        const status = node("p", "Loading recorded image…", "image-status"); status.setAttribute("role", "status");
                        figure.append(node("h4", label), node("p", asset.title, "muted"));
                        image.alt = `${label}: ${asset.title}, ${asset.width} × ${asset.height} pixels`;
                        image.width = asset.width; image.height = asset.height; image.hidden = true;
                        const expand = node("button", "View full size", "secondary view-image") as HTMLButtonElement;
                        let assetUrl = "";
                        expand.type = "button"; expand.disabled = true; expand.setAttribute("aria-label", `View full size: ${label}, ${asset.title}`);
                        figure.append(image, status, node("figcaption", `${asset.width} × ${asset.height} pixels`), expand);
                        comparison.append(figure);
                        const key = `${display.displayId}:${kind}:${asset.id}`, check = { displayId: display.displayId, state: "loading" as "loading" | "loaded" | "failed" };
                        imageChecks.set(key, check);
                        const live = () => !locked && generation === imageGeneration && job?.jobId === value.jobId && job?.candidateTree === value.candidateTree;
                        const fail = () => { if (!live()) return; check.state = "failed"; image.hidden = true; expand.disabled = true; assetUrl = ""; closeViewer(false); status.textContent = "This recorded image could not be displayed. No visual decision is available."; status.className = "image-status error"; controls(); };
                        expand.addEventListener("click", () => {
                            if (!live() || check.state !== "loaded" || expand.disabled || !assetUrl || image.src !== assetUrl || !imageUrls.includes(assetUrl)) return;
                            closeViewer(false); viewerFocus = expand;
                            const full = el("image-viewer-image") as HTMLImageElement;
                            full.alt = image.alt; full.width = asset.width; full.height = asset.height; full.src = assetUrl;
                            el("image-viewer-title").textContent = `${label}: ${asset.title} · ${asset.width} × ${asset.height}`;
                            (el("image-viewer") as HTMLDialogElement).showModal(); button("close-image-viewer").focus();
                        });
                        image.addEventListener("error", fail);
                        image.addEventListener("load", () => {
                            if (!live()) return;
                            if (!assetUrl || image.src !== assetUrl || image.naturalWidth !== asset.width || image.naturalHeight !== asset.height) { fail(); return; }
                            check.state = "loaded"; image.hidden = false; expand.disabled = false; status.textContent = "Recorded image loaded"; controls();
                        });
                        const request = new AbortController(); imageRequests.push(request);
                        void (async () => {
                            if (!display.success || display.candidateTree !== value.candidateTree) throw new Error("Stale image");
                            const query = new URLSearchParams({ jobId: value.jobId, displayId: display.displayId, kind, assetId: asset.id });
                            const response = await fetch(`/api/job/asset?${query}`, { credentials: "same-origin", cache: "no-store", redirect: "error", headers: { "X-Wringer-Console": "1", Accept: "image/png" }, signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
                            if (!response.ok || response.headers.get("content-type") !== "image/png") throw new Error("Image unavailable");
                            const bytes = await response.arrayBuffer();
                            const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
                            if (bytes.byteLength !== asset.bytes || digest !== asset.sha256) throw new Error("Image changed");
                            if (!live()) return;
                            const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" })); imageUrls.push(url); assetUrl = url; image.src = url;
                        })().catch(fail);
                    }
                }
                card.append(comparison);
            }
            const outputParent = display.visuals ? node("details") : card;
            if (display.visuals) { outputParent.append(node("summary", "Recorded display notes")); card.append(outputParent); }
            if (display.parts?.length) {
                for (const part of display.parts) {
                    const panel = node("section", undefined, "report-part");
                    if (display.parts.length > 1 || part.title.trim() !== title.trim() && part.title.trim() !== requirement?.title.trim()) panel.append(node("h4", part.title));
                    panel.append(node("pre", part.text)); outputParent.append(panel);
                }
                // Structured views do not discard the original observed output.
                const raw = node("details"); raw.append(node("summary", "Original display output"), node("pre", display.output)); outputParent.append(raw);
            } else { const output = node("pre", display.output || "No report content was returned."); output.tabIndex = 0; outputParent.append(output); }
            const identity = node("details"); identity.append(node("summary", "Exact displayed source"), node("p", `Candidate ${display.candidateTree}`), node("p", `Display ${display.displayId}`)); card.append(identity);
            if (display.visuals) {
                identity.append(node("p", `Design snapshot ${display.visuals.snapshotSha256}`));
                for (const [label, assets] of [["Reference", display.visuals.referenceAssets], ["Capture", display.visuals.captures]] as const) for (const asset of assets) identity.append(node("p", `${label} ${asset.id} · SHA-256 ${asset.sha256}`));
            }
            reports.append(card);
        }
    };
    const render = () => {
        if (!job) { clearVisuals(); el("reports").replaceChildren(); for (const id of ["engineering-approach", "engineering-checks", "engineering-history", "engineering-limits"]) el(id).replaceChildren(); el("job-engineering").hidden = true; el("job-workspace").hidden = true; controls(); return; }
        const value = job;
        el("job-workspace").hidden = false; el("job-empty").hidden = true;
        document.title = `${value.name} · Wringer`;
        el("job-name").textContent = value.name; el("phase-title").textContent = pmJobHeading(value); el("job-next-action").textContent = value.nextAction;
        el("job-error").textContent = value.error ?? ""; el("job-error").hidden = !value.error;
        el("approval-panel").hidden = value.phase !== "approval";
        el("review-panel").hidden = value.phase !== "review" || chooseCorrection;
        el("correction-panel").hidden = value.phase !== "correction" && !chooseCorrection;
        el("report-review-layout").classList.toggle("has-decision", value.phase === "review" || value.phase === "correction");
        el("report-review-layout").classList.toggle("has-visuals", value.displays.some(display => !!display.visuals));
        button("cancel-correction").hidden = value.phase !== "review";
        el("send-panel").hidden = value.phase !== "send";
        el("handover-panel").hidden = value.phase !== "sent";
        el("progress-panel").hidden = !["working", "preparing"].includes(value.phase);
        el("blocked-panel").hidden = value.phase !== "blocked";
        el("approval-intent").textContent = value.intent;
        const approvalRequirements = el("approval-requirements"); approvalRequirements.replaceChildren();
        for (const requirement of value.requirements.filter(r => r.required)) approvalRequirements.append(node("li", requirement.title));
        const scope = el("approval-source"); scope.replaceChildren(); addFact(scope, "Source repository", value.scope.repository); addFact(scope, "Pinned source", value.scope.sourceCommit);
        el("approval-scope").textContent = `Allowed to change:\n${value.scope.writable.join("\n") || "No writable paths"}\n\nMust preserve:\n${value.scope.protected.join("\n") || "No separate protected paths declared"}`;
        for (const [id, rows] of [["job-questions", value.questions ?? []], ["job-assumptions", value.assumptions ?? []]] as const) { const list = el(id); list.replaceChildren(); for (const text of rows) list.append(node("li", text)); el(`${id}-panel`).hidden = rows.length === 0; }
        (el("job-assumptions-panel") as HTMLDetailsElement).open = value.phase === "approval";
        const minutes = value.budget.wallSeconds / 60;
        el("approval-budget").textContent = `Up to ${value.budget.sessions} agent sessions and ${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} minutes for this job. Session/time limits are not a cash cap.`;
        el("approval-expiry").textContent = value.budget.expiresAt ? `Approval ends ${new Date(value.budget.expiresAt).toLocaleString()}. Downtime counts.` : "The controller sets a finite approval deadline within this job's time limit; it is not an open-ended grant.";
        if (value.actor && !field("approval-actor").value) field("approval-actor").value = value.actor;
        el("review-as").textContent = value.actor ? `Recording your decision as ${value.actor}, the name previously supplied.` : "The recorded decision identity is unavailable.";
        const reviewItems = el("review-requirements"); reviewItems.replaceChildren();
        for (const requirement of value.requirements.filter(r => r.kind === "human" && r.required && r.state === "unknown")) reviewItems.append(node("li", requirement.title));
        showDestination("approval-destination", value.destination); showDestination("send-destination", value.destination);
        el("send-source").textContent = value.candidateTree ? `This sends the exact reviewed result: ${value.candidateTree}` : "No reviewed source is recorded.";
        renderReports(value);
        const engineering = value.engineering, approachFacts = el("engineering-approach"), checkFacts = el("engineering-checks"), historyFacts = el("engineering-history"), engineeringLimits = el("engineering-limits");
        el("job-engineering").hidden = !engineering;
        approachFacts.replaceChildren(); checkFacts.replaceChildren(); historyFacts.replaceChildren(); engineeringLimits.replaceChildren();
        if (engineering) {
            const approach = engineering.approach;
            if (!approach) approachFacts.append(node("p", "No extra worker playbook is selected. The approved plan and checks still govern the work."));
            else {
                approachFacts.append(node("h3", approach.title ?? "Pinned worker approach"), node("p", approach.sourceStatus === "validated" ? `The source was validated. Worker-use receipts recorded: ${approach.workerUses}. This does not prove that the advice improved the result.` : "Selected in the plan. The source has not yet been validated for a worker attempt."));
                const facts = node("dl"); addFact(facts, "Repository file", approach.path); addFact(facts, "Exact content", approach.sha256); addFact(facts, "Task family", approach.taskFamily); if (approach.revision) addFact(facts, "Declared revision", approach.revision); approachFacts.append(facts);
                if (approach.adoption) { const adoption = approach.adoption; approachFacts.append(node("p", `${adoption.action === "promote" ? "Selected" : "Restored"} for future plans by the recorded reviewer ${adoption.actor} on ${adoption.at}. This is provenance, not this job's approval.`), node("blockquote", adoption.note)); }
            }
            if (engineering.rollback) { const r = engineering.rollback; approachFacts.append(node("p", `Restored no extra playbook for future work by the recorded reviewer ${r.actor} on ${r.at}. This does not approve this job.`), node("blockquote", r.note)); }
            for (const check of engineering.checks) {
                const status = ({ "not-measured": "Not yet measured", passed: "Passed", failed: "Needs work", unknown: "Unknown" })[check.status];
                checkFacts.append(node("li", `${check.id} · ${status} · ${check.level === "command" ? "Command result only" : check.assertionStatus === "established" ? "Executed assertions recorded" : "Assertion evidence not established"}. ${check.reason}`));
            }
            if (!engineering.history.length) historyFacts.append(node("li", "No candidate progress observation is recorded yet."));
            for (const row of engineering.history) historyFacts.append(node("li", `${row.sequence}. ${row.phase === "checks" ? "Checks" : "Independent review"} · ${row.action === "stop" ? "Automatic repair stopped" : row.action === "warn" ? "Repeated outcome warning" : "Observation recorded"}. ${row.reason} Result: ${row.candidateTree}`));
            for (const limit of engineering.limits) engineeringLimits.append(node("li", limit));
        }
        const all = el("job-requirements"); all.replaceChildren();
        for (const requirement of value.requirements) {
            const item = node("article", undefined, "requirement-detail"); item.append(node("h3", requirement.title), node("p", `${requirement.required ? "Required" : "Optional"} · ${requirement.kind === "human" ? "A person decides" : "Checks and independent review"} · ${requirement.state === "met" ? "Met" : requirement.state === "not-met" ? "Needs work" : "Not evaluated"}`, "muted"));
            if (requirement.quote) item.append(node("blockquote", requirement.quote));
            if (requirement.note !== null && requirement.note !== undefined) { item.append(node("p", "Authored observation", "eyebrow"), node("blockquote", requirement.note)); if (requirement.by) item.append(node("p", `By ${requirement.by}`, "muted")); }
            all.append(item);
        }
        el("job-intent").textContent = value.intent; el("job-actor").textContent = value.actor ?? "No name recorded";
        el("job-record").textContent = `Job ${value.jobId}\nRecord ${value.revision}\nDecision ${value.readyRevision}\nCandidate ${value.candidateTree ?? "Not recorded"}`;
        const limits = el("job-limits"); limits.replaceChildren(); for (const limit of value.limits) limits.append(node("li", limit));
        const publication = value.publication, link = safeJobReviewLink(publication?.url), anchor = el("review-request-link") as HTMLAnchorElement;
        anchor.hidden = !link; if (link) anchor.href = link; else anchor.removeAttribute("href");
        el("publication-description").textContent = publication ? `Recorded status: ${publication.status}. Delivery: ${publication.deliveryId}. Sending a branch is not a merge or deployment.` : "No publication record is available. Do not infer a handover from this page alone.";
        el("audit-command").textContent = publication?.auditCommand || "No audit command is recorded.";
        el("clone-command").textContent = publication?.cloneCommand || "Use the delivery's own instructions to obtain the reviewed branch.";
        button("copy-audit").disabled = !publication?.auditCommand;
        button("copy-review-link").hidden = !link;
        controls();
    };
    const api = async (path: string, body?: unknown) => {
        // Admission validates source/evidence before recording authority. Its
        // finite network window is not the lifetime of the accepted operation.
        // Measured v4 design admission takes ~14s on a small Mac; leave headroom
        // without ever replaying a timed-out decision or extending job approval.
        const response = await fetch(path, { method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }), credentials: "same-origin", cache: "no-store", redirect: "error", headers: { Accept: "application/json", "X-Wringer-Console": "1", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, signal: AbortSignal.timeout(body === undefined ? 30000 : 45000) });
        const length = Number(response.headers.get("content-length") ?? "0"); if (length > 2 * 1024 * 1024) throw new Error("The controller response exceeds the bounded review size.");
        const text = await response.text(); if (text.length > 2 * 1024 * 1024) throw new Error("The controller response exceeds the bounded review size.");
        let value: any; try { value = JSON.parse(text); } catch { throw new Error("The controller returned an unreadable response. No decision was inferred."); }
        if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "The controller refused this request. No decision was inferred.");
        return value;
    };
    const establish = async () => {
        if (!token) { if (exchange) await exchange; return; }
        const credential = token; token = "";
        exchange = (async () => {
            const response = await fetch("/api/session", { method: "POST", body: "{}", credentials: "same-origin", cache: "no-store", redirect: "error", headers: { Accept: "application/json", "Content-Type": "application/json", "X-Wringer-Console": "1", Authorization: `Bearer ${credential}` }, signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw new Error("Open the current private operator link once to unlock this browser. Nothing was approved.");
        })();
        try { await exchange; } finally { exchange = null; }
    };
    const listJobs = async () => {
        const value = await api("/api/jobs");
        if (locked) return;
        if (!Array.isArray(value.jobs) || value.jobs.length > 1000 || !value.jobs.every((r: any) => r && uuid(r.jobId) && typeof r.name === "string" && r.name.length <= 1000) || new Set(value.jobs.map((r: any) => r.jobId)).size !== value.jobs.length) throw new Error("The controller returned an unreadable job list.");
        const picker = field("job-picker"); picker.replaceChildren();
        const prompt = node("option", "Choose your work") as HTMLOptionElement; prompt.value = ""; picker.append(prompt);
        for (const row of value.jobs) { const option = node("option", row.name) as HTMLOptionElement; option.value = row.jobId; picker.append(option); }
        if (!selected && value.jobs.length === 1) selected = value.jobs[0].jobId;
        picker.value = selected; el("job-selection").hidden = value.jobs.length < 2 && !!selected;
        el("job-empty").textContent = value.jobs.length ? "Choose the work you want to inspect. No job will start by opening it." : "Start with your coding app. Ask it to put your request through Wringer; your proposed work will appear here.";
        lastList = Date.now();
    };
    const notify = (value: PmJob) => {
        if (locked || !notifications || !["approval", "review", "send", "blocked", "correction"].includes(value.phase)) return;
        const key = readyKey(value); if (notified.has(key)) return; notified.add(key);
        if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
        const title = value.phase === "review" ? "Your result is ready" : value.phase === "send" ? "Your handover is ready for a decision" : "Wringer needs your attention";
        try { const notification = new Notification(title, { body: "Return to your open Wringer page to inspect the recorded result and next action." }); notification.onclick = () => { window.focus(); notification.close(); }; } catch { el("notification-note").textContent = "Browser notification failed. Follow progress on this page; no assistant notification is implied."; }
    };
    const refresh = (): Promise<void> => {
        if (locked) return Promise.resolve(); if (refreshing) return refreshing;
        refreshing = (async () => {
            try {
                await establish();
                if (locked) return;
                if (!selected || Date.now() - lastList > 10000) await listJobs();
                if (locked) return;
                if (selected) {
                    const selectedAtRead = selected, raw = await api(`/api/job?jobId=${encodeURIComponent(selected)}`);
                    if (locked) return;
                    const next = validatePmJob(raw);
                    if (next.jobId !== selectedAtRead || selectedAtRead !== selected) throw new Error("The controller returned a different job. No decision was accepted.");
                    if (job && (job.jobId !== next.jobId || job.readyRevision !== next.readyRevision || job.candidateTree !== next.candidateTree)) { clearDraft(); unresolvedRevision = null; }
                    const changed = JSON.stringify(next) !== JSON.stringify(job); job = next; connected = true; lastRead = Date.now();
                    if (changed) render(); else controls(); notify(next);
                } else { connected = true; lastRead = Date.now(); render(); }
            } catch (error) { connected = false; if (!locked) say(error instanceof Error ? error.message : "The controller could not be read. Decisions are paused.", true); controls(); }
        })().finally(() => { refreshing = null; });
        return refreshing;
    };
    const submit = async (path: string, body: Record<string, unknown>) => {
        if (!job || !usable()) return;
        const before = job.readyRevision;
        busy = true; unresolvedRevision = before; controls();
        try {
            await api(path, body);
            if (locked) return;
            say("The controller received your decision. Checking the recorded outcome…");
            await refresh();
        } catch (error) {
            if (locked) return;
            unresolvedRevision = before;
            say(`${error instanceof Error ? error.message : "The outcome could not be confirmed."} Read the current record before another decision; this request was not repeated.`, true);
            await refresh();
        } finally { busy = false; controls(); }
    };
    const guards = () => ({ jobId: job!.jobId, expectedRevision: job!.readyRevision, expectedCandidateTree: job!.candidateTree });
    const reviewDecision = (verdict: "met" | "not_met", note?: string) => {
        if (!job || !pmJobReviewSet(job).eligible) return;
        void submit("/api/job/decision", { ...guards(), verdict, ...(note?.trim() ? { note } : {}), displayIds: pmJobReviewSet(job).displayIds });
    };
    el("approve-job").addEventListener("click", () => { if (!job || button("approve-job").disabled) return; void submit("/api/job/approve", { jobId: job.jobId, expectedRevision: job.readyRevision, actor: field("approval-actor").value }); });
    el("accept-result").addEventListener("click", () => { if (!button("accept-result").disabled) reviewDecision("met", field("review-note").value); });
    el("request-correction").addEventListener("click", () => {
        if (!job || button("request-correction").disabled) return;
        if (field("review-note").value.trim()) { void submit("/api/job/correction", { ...guards(), note: field("review-note").value }); return; }
        chooseCorrection = true; render(); field("correction-note").focus();
    });
    el("submit-correction").addEventListener("click", () => {
        if (!job || button("submit-correction").disabled) return;
        const note = field("correction-note").value;
        if (job.phase === "review" || job.phase === "correction") void submit("/api/job/correction", { ...guards(), note });
    });
    el("cancel-correction").addEventListener("click", () => { chooseCorrection = false; field("correction-note").value = ""; render(); });
    el("send-job").addEventListener("click", () => { if (job && !button("send-job").disabled) void submit("/api/job/send", { ...guards(), preparedId: job.preparedId }); });
    el("retry-job").addEventListener("click", () => { if (job && !button("retry-job").disabled) void submit("/api/job/retry", guards()); });
    for (const id of ["approval-actor", "review-note", "correction-note"]) field(id).addEventListener("input", controls);
    el("refresh-job").addEventListener("click", () => { if (job && [...imageChecks.values()].some(check => check.state === "failed")) renderReports(job); void refresh(); });
    field("job-picker").addEventListener("change", () => {
        if (busy || !uuid(field("job-picker").value)) return;
        selected = field("job-picker").value; job = null; clearDraft(); unresolvedRevision = null; connected = false;
        history.replaceState(null, "", `${location.pathname}?jobId=${encodeURIComponent(selected)}`); render(); void refresh();
    });
    el("lock-job-page").addEventListener("click", () => {
        if (locked) return; locked = true; notifications = false; connected = false; job = null; clearDraft(); render();
        el("job-empty").hidden = false; el("job-empty").textContent = "This page is locked. Reopen your private operator link when you need it. Existing work is not cancelled.";
        void api("/api/logout", {}).catch(() => say("This page is locked, but server logout was not confirmed. Close the tab and ask the operator to lock access.", true));
    });
    el("notify-ready").addEventListener("click", () => {
        if (typeof Notification === "undefined") { el("notification-note").textContent = "This browser does not offer notifications. Follow the recorded state on this page."; return; }
        void Notification.requestPermission().then(permission => {
            if (locked) return;
            notifications = permission === "granted";
            if (job) notified.add(readyKey(job));
            button("notify-ready").disabled = notifications;
            el("notification-note").textContent = notifications ? "Browser notifications are on while this page is open. This does not notify your coding app or work after you close the page." : "Notifications were not enabled. Your work can continue; follow its state on this page.";
        }, () => { el("notification-note").textContent = "The browser did not enable notifications. Follow progress here."; });
    });
    const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); say("Copied the recorded handover information."); } catch { say("Copy was unavailable. Select and copy the recorded text below.", true); } };
    el("copy-audit").addEventListener("click", () => { if (job?.publication?.auditCommand) void copy([job.publication.cloneCommand, job.publication.auditCommand].filter(Boolean).join("\n\n")); });
    el("copy-review-link").addEventListener("click", () => { const link = safeJobReviewLink(job?.publication?.url); if (link) void copy(link); });
    el("close-image-viewer").addEventListener("click", () => closeViewer());
    el("image-viewer").addEventListener("cancel", event => { event.preventDefault(); closeViewer(); });
    window.addEventListener("pagehide", () => { token = ""; connected = false; clearVisuals(); });
    render(); void refresh(); setInterval(() => { if (!locked) { controls(); void refresh(); } }, 2000);
}

export function pmJobClientScript(): string {
    return `const validatePmJob=${validatePmJob.toString()};const pmJobReviewSet=${pmJobReviewSet.toString()};const pmJobHeading=${pmJobHeading.toString()};const safeJobReviewLink=${safeJobReviewLink.toString()};(${jobClientRuntime.toString()})();`;
}

const style = `
.view-image{margin-top:12px;width:100%}#image-viewer{padding:0;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);width:min(1440px,96vw);max-width:96vw;max-height:94vh;overflow:auto}#image-viewer::backdrop{background:#14251fbd}.image-viewer-toolbar{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px;background:var(--surface);border-bottom:1px solid var(--line)}.image-viewer-toolbar h2{font-size:18px;margin:0}.image-viewer-canvas{overflow:auto;padding:16px}#image-viewer-image{display:block;max-width:none;margin:auto;background:white}#image-viewer-help{margin:0;padding:12px 16px;font-size:14px}
.review-layout.has-decision.has-visuals{grid-template-columns:minmax(0,1fr)}.visual-comparison{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:20px;margin:22px 0}.visual-asset{min-width:0;margin:0;padding:16px;border:1px solid var(--line);border-radius:10px;background:white}.visual-asset h4{margin-bottom:6px}.visual-asset img{display:block;width:100%;height:auto;border:1px solid var(--line);background:#fff}.visual-asset figcaption,.image-status{font-size:13px;margin:10px 0 0;color:var(--muted)}
:root{color-scheme:light;--ink:#203a31;--muted:#596b61;--green:#285843;--line:#d5ddd3;--paper:#f4f4ed;--surface:#fffef9;--soft:#e8f0e5;--amber:#80521c}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere}main,header,footer{width:min(1120px,100%);margin:auto;padding:24px 36px}header{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line)}.brand{font-size:24px;font-weight:750;letter-spacing:-.04em}.top-actions,.buttons{display:flex;align-items:center;gap:12px;flex-wrap:wrap}h1,h2,h3,h4,p{margin-top:0}h1{font:450 clamp(32px,4.8vw,48px)/1.1 Georgia,serif;letter-spacing:-.035em;max-width:900px;margin:12px 0 16px}h2{font-size:23px;line-height:1.3}h3{font-size:19px;line-height:1.4}h4{font-size:16px}.eyebrow{text-transform:uppercase;letter-spacing:.11em;font-weight:700;font-size:14px;color:var(--green)}.muted,small{color:var(--muted)}button,input,textarea,select{font:inherit}button{border:1px solid var(--green);border-radius:9px;background:var(--green);color:white;padding:12px 19px;min-height:48px;font-weight:650;cursor:pointer}button.secondary{background:transparent;color:var(--green);border-color:var(--line)}button:disabled{background:#e1e5dc;color:#637166;border-color:#d2d9ce;cursor:not-allowed}input,textarea,select{width:100%;border:1px solid #96a794;border-radius:8px;background:white;color:var(--ink);padding:12px;min-height:48px}textarea{min-height:105px;resize:vertical}label{display:block;font-weight:600;margin:18px 0 7px}a{color:var(--green)}:focus-visible{outline:3px solid #b76325;outline-offset:4px}.panel{border:1px solid var(--line);border-radius:16px;background:var(--surface);padding:28px;margin:24px 0;box-shadow:0 5px 24px #203a3105}.decision-panel{border-top:4px solid var(--green)}.lead{font-size:18px;color:var(--muted);max-width:840px}.message{white-space:pre-wrap;min-height:1.5em}.error{color:#9b342a}.error:not(:empty){padding:12px 16px;border-left:3px solid #9b342a;background:#fff0e5}.review-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;align-items:start}.review-layout.has-decision{grid-template-columns:minmax(0,1.2fr) minmax(290px,.8fr)}.review-layout>section{min-width:0}.report-card{border:1px solid var(--line);border-radius:14px;background:var(--surface);padding:23px;margin:0 0 18px}.report-requirement{color:var(--muted);padding-bottom:12px;border-bottom:1px solid var(--line)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:15px/1.65 ui-monospace,SFMono-Regular,monospace;max-height:430px;overflow:auto;padding:18px;border-radius:9px;background:#edf1e7;color:var(--ink)}.report-part+ .report-part{margin-top:24px}.review-layout .decision-panel{margin-top:0}details{border-top:1px solid var(--line);padding-top:16px;margin-top:20px}summary{font-weight:650;cursor:pointer}details>summary+*{margin-top:16px}blockquote{white-space:pre-wrap;margin:14px 0;padding:14px 18px;border-left:3px solid #94ae85;background:var(--soft)}.request-quote{font-size:18px;max-height:380px;overflow:auto}dl{display:grid;grid-template-columns:150px minmax(0,1fr);gap:9px 16px}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}.requirement-detail{padding:18px 0;border-bottom:1px solid var(--line)}.requirement-detail h3{margin-bottom:7px}.note-help{font-size:14px;margin:9px 0 19px}.stage-note{display:flex;align-items:center;gap:14px}.activity{width:12px;height:12px;background:var(--green);border-radius:100%;flex-shrink:0}.job-selection{max-width:560px;margin-bottom:26px}.two-lanes{display:grid;grid-template-columns:1fr 1fr;gap:16px}.footer-note{font-size:14px;color:var(--muted)}footer{padding-top:12px;padding-bottom:38px}ul{padding-left:23px}li+li{margin-top:8px}[hidden]{display:none!important}.notification-note{font-size:14px;color:var(--muted);max-width:700px}.skip{position:absolute;left:16px;top:-100px;background:var(--green);color:white;padding:12px;z-index:10}.skip:focus{top:10px}@media(max-width:800px){main,header,footer{padding:22px}.review-layout,.review-layout.has-decision{grid-template-columns:1fr}.review-layout .decision-panel{margin-top:0}.panel{padding:23px}.report-card{padding:20px}header{align-items:flex-start}.top-actions{justify-content:flex-end}.top-actions button{font-size:14px;padding:9px 12px}.two-lanes{grid-template-columns:1fr}}@media(max-width:480px){main,header,footer{padding:18px}.brand{font-size:21px}.panel{padding:20px}dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:12px}.buttons{align-items:stretch;flex-direction:column}.buttons button{width:100%}.top-actions{gap:7px}.top-actions button{min-height:42px}.report-card{padding:16px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;

export function renderPmJobWorkspace(options: { nonce?: string } = {}): string {
    const nonce = options.nonce ?? randomBytes(18).toString("base64");
    if (!/^[A-Za-z0-9+/_=-]{8,160}$/.test(nonce)) throw new Error("Job workspace nonce must be a bounded CSP nonce");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src blob:; base-uri 'none'; form-action 'none'; object-src 'none'"><title>Your work · Wringer</title><style nonce="${nonce}">${style}</style></head><body>
<a class="skip" href="#job-workspace">Skip to your work</a>
<dialog id="image-viewer" aria-labelledby="image-viewer-title" aria-describedby="image-viewer-help"><div class="image-viewer-toolbar"><h2 id="image-viewer-title"></h2><button id="close-image-viewer" type="button" class="secondary">Close image</button></div><p id="image-viewer-help">Full-size recorded image. Scroll to inspect every part. Press Escape or Close image to return.</p><div class="image-viewer-canvas"><img id="image-viewer-image" alt=""></div></dialog>
<header><div class="brand">wringer <span class="muted">/ your work</span></div><div class="top-actions"><span id="job-connection" class="muted" role="status">Connecting…</span><button id="refresh-job" class="secondary" type="button">Refresh progress</button><button id="lock-job-page" class="secondary" type="button">Lock</button></div></header>
<main><div id="job-selection" class="job-selection"><label for="job-picker">Your work</label><select id="job-picker"><option value="">Loading…</option></select></div>
<p id="job-message" class="message" role="status" aria-live="polite" aria-atomic="true"></p><p id="job-empty">Connecting to your recorded work…</p>
<section id="job-workspace" tabindex="-1" hidden aria-busy="false"><p class="eyebrow" id="job-name"></p><h1 id="phase-title"></h1><p id="job-next-action" class="lead"></p><p id="job-error" class="error" hidden></p><section id="job-questions-panel" class="panel" hidden><h2>Questions to answer in your coding app</h2><ul id="job-questions"></ul></section><details id="job-assumptions-panel" class="panel" hidden><summary>Assumptions to check</summary><ul id="job-assumptions"></ul></details>
<section id="approval-panel" class="panel decision-panel" hidden><h2>The work you are approving</h2><blockquote id="approval-intent" class="request-quote"></blockquote><h3>Required outcomes</h3><ul id="approval-requirements"></ul><dl id="approval-source"></dl><details><summary>Exact allowed and protected file scope</summary><pre id="approval-scope"></pre></details><p id="approval-budget"></p><p id="approval-expiry" class="muted"></p><details><summary>Registered handover destination</summary><dl id="approval-destination"></dl></details><label for="approval-actor">Your name</label><input id="approval-actor" autocomplete="name" maxlength="200" required><p class="note-help">The button approves this exact request, requirements and finite limits. It does not accept the result or send a change.</p><button id="approve-job" type="button" disabled>Approve this bounded work</button></section>
<section id="progress-panel" class="panel stage-note" hidden><span class="activity" aria-hidden="true"></span><p>Your assistant and Wringer handle the next steps within the existing approval. You do not need to keep clicking Continue.</p></section>
<section id="send-panel" class="panel decision-panel" hidden><h2>Send the reviewed change</h2><dl id="send-destination"></dl><p id="send-source" class="muted"></p><p>This sends the prepared branch and its evidence to the registered destination. It does not merge or deploy.</p><button id="send-job" type="button" disabled>Send this reviewed change</button></section>
<div class="review-layout" id="report-review-layout"><section id="reports-panel" hidden aria-labelledby="reports-title"><h2 id="reports-title">The actual recorded result</h2><div id="reports"></div></section>
<section id="review-panel" class="panel decision-panel" hidden><h2>Does this meet these requirements?</h2><ul id="review-requirements"></ul><p id="review-as" class="muted"></p><label for="review-note">Anything you want to add? <span class="muted">Optional</span></label><textarea id="review-note" maxlength="16000"></textarea><p class="note-help">Your click records your decision. An empty comment stays empty; no one writes an observation for you.</p><div class="buttons"><button id="accept-result" type="button" disabled>Yes, this is right</button><button id="request-correction" type="button" class="secondary" disabled>Request a correction</button></div><p id="review-unavailable" class="muted"></p><p class="note-help">This decision covers only the listed requirements and exact reports shown. Sending remains separate.</p></section>
<section id="correction-panel" class="panel decision-panel" hidden><h2>What should change?</h2><label for="correction-note">Describe the correction in your own words</label><textarea id="correction-note" maxlength="16000" required></textarea><p class="note-help">The controller checks the remaining approval before more work. This cannot buy a larger allowance.</p><div class="buttons"><button id="submit-correction" type="button" disabled>Request this correction</button><button id="cancel-correction" type="button" class="secondary">Back to the result</button></div></section></div>
<section id="handover-panel" class="panel" hidden><h2>Give your reviewer the handover</h2><p id="publication-description"></p><div class="buttons"><a id="review-request-link" target="_blank" rel="noopener noreferrer" hidden>Open the recorded review request ↗</a><button id="copy-review-link" type="button" class="secondary" hidden>Copy review link</button></div><h3>Verify the carried evidence</h3><p>These are the recorded delivery instructions, not a claim that someone has run the audit.</p><pre id="clone-command"></pre><pre id="audit-command"></pre><button id="copy-audit" type="button" class="secondary" disabled>Copy audit instructions</button></section>
<section id="blocked-panel" class="panel" hidden><h2>No decision can bypass this stop</h2><p>Read the recorded next action above. Existing evidence stays available; refreshing does not repeat a paid operation or renew approval.</p><button id="retry-job" type="button" disabled hidden>Retry the recorded local step</button></section>
<details id="job-engineering" hidden><summary>Approach and progress evidence</summary><div id="engineering-approach"></div><h3>What the checks establish</h3><ul id="engineering-checks"></ul><h3>Recorded progress</h3><ul id="engineering-history"></ul><ul id="engineering-limits" class="muted"></ul></details>
<details id="job-evidence"><summary>Requirements, evidence and original request</summary><div id="job-requirements"></div><h3>Your original request</h3><blockquote id="job-intent"></blockquote></details>
<details><summary>Budget, identity and access limits</summary><p>Recorded decision name: <span id="job-actor"></span>. A supplied name is not authenticated human presence.</p><div class="two-lanes"><p>Coding-app usage and cost: unknown to this page.</p><p>Development and independent review cost: unknown. Session/time ceilings are not an invoice guarantee.</p></div><pre id="job-record"></pre><ul id="job-limits"></ul></details>
</section></main><footer><button id="notify-ready" type="button" class="secondary">Notify me when a decision is ready</button><p id="notification-note" class="notification-note">Optional browser notifications work only while this page is open. No notification inside your coding app is claimed.</p><details><summary>Cooperative-local engineering preview</summary><p class="footer-note">This page is separate from the assistant tools, but another unrestricted app under the same computer account can bypass that tool boundary. Protected human-presence enforcement is not established. Keep private links out of chat. Browser access is finite; Lock ends this browser session, not the job.</p></details></footer><script nonce="${nonce}">${pmJobClientScript()}</script></body></html>`;
}
