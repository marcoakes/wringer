/** Browser-operated fixture: real product forms, Git and audit, synthetic
 * worker/judge/check/display observations. Never a genuine person's verdict. */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page, Route } from "playwright";
import { hashValue } from "../packages/plan/src";
import { latestWorkspacePublication } from "../packages/application/src/commands";
import { readController } from "../packages/application/src/controller";
import { readPmWorkspace } from "../packages/cli/src/workspace";
import { readContainedDeliveryProjection } from "../packages/delivery/src";
import type { PmJob } from "../packages/board/src/job-model";

export async function runGuidedPmJourney(input: {
    page: Page; url: string; root: string; state: string; jobId: string; actor: string; origin: string; baseCommit: string;
    roleCount: () => number; call: (name: string, args: unknown) => Promise<any>;
    record: (entry: unknown) => Promise<void>; check: (name: string, value: unknown) => Promise<void>;
    git: (args: string[]) => Promise<string>;
    command: (label: string, argv: string[], cwd?: string, expected?: number) => Promise<any>;
    design?: { snapshotSha256: string; expectedImages: number };
}) {
    const { page, record, check, root, state, jobId, actor, call, git, command } = input;
    const began = Date.now(), errors: string[] = [], decisions: { action: string; body: unknown }[] = [];
    let adversarialProbe = false;
    page.setDefaultTimeout(20000);
    page.on("pageerror", e => errors.push(e.message));
    page.on("response", response => {
        if (new URL(response.url()).pathname.startsWith("/api/job/") && !response.ok()) void response.json().then(body => record({ browserDecisionRefusal: body, status: response.status() })).catch(() => {});
    });
    page.on("request", request => {
        const path = new URL(request.url()).pathname;
        if (!adversarialProbe && request.method() === "POST" && path.startsWith("/api/job/")) decisions.push({ action: path.split("/").at(-1)!, body: request.postDataJSON() });
    });
    const waitPhase = (phase: string) => page.locator(`#${phase}-panel`).waitFor({ state: "visible", timeout: 90000 });
    const shot = async (name: string) => { await page.screenshot({ path: join(root, `browser-guided-${name}.png`), fullPage: true }); await record({ browserScreenshot: `browser-guided-${name}.png`, fixture: true }); };
    const heldImages: Route[] = [];
    let holdImages = !!input.design;
    const imageRoute = /\/api\/job\/asset\?/;
    if (input.design) await page.route(imageRoute, route => { if (holdImages) heldImages.push(route); else void route.continue(); });
    const loadedImages = async () => {
        if (!input.design) return;
        await page.waitForFunction(expected => {
            const images = Array.from(document.querySelectorAll<HTMLImageElement>("#reports img"));
            return images.length === expected && images.every(image => !image.hidden && image.complete && image.naturalWidth === Number(image.getAttribute("width")) && image.naturalHeight === Number(image.getAttribute("height"))) && !(document.getElementById("accept-result") as HTMLButtonElement).disabled;
        }, input.design.expectedImages);
    };
    const visualModel = () => page.evaluate(async jobId => {
        const response = await fetch(`/api/job?jobId=${encodeURIComponent(jobId)}`, { credentials: "same-origin", cache: "no-store", headers: { "X-Wringer-Console": "1" } });
        if (!response.ok) throw new Error("The browser could not reread its current visual source record");
        const job = await response.json() as PmJob;
        return { candidateTree: job.candidateTree, readyRevision: job.readyRevision, displays: job.displays.filter(display => display.visuals).map(display => ({ criterionId: display.criterionId, displayId: display.displayId, candidateTree: display.candidateTree, visuals: display.visuals })), imageUrls: Array.from(document.querySelectorAll<HTMLImageElement>("#reports img"), image => image.src) };
    }, jobId);
    let firstVisual: Awaited<ReturnType<typeof visualModel>> | undefined;
    await page.goto(input.url);
    await waitPhase("approval");
    const route = new URL(page.url());
    await check("guided page removes private fragment", !route.hash);
    await page.reload(); await waitPhase("approval");
    const waiting = await call("get_status", { jobId });
    const noChange = await call("wait_for_update", { jobId, afterEventId: waiting.eventId, timeoutSeconds: 0 });
    await check("bounded assistant wait observes without approving or spending", noChange.changed === false && input.roleCount() === 0);
    await page.locator("#approval-actor").fill(actor);
    await shot("approval");
    await page.locator("#approve-job").click();
    await waitPhase("review");
    if (input.design) {
        await page.waitForFunction(expected => document.querySelectorAll("#reports img").length === expected, input.design.expectedImages);
        await check("real Chromium keeps decisions disabled while required PNG requests are held", await page.locator("#accept-result").isDisabled() && await page.locator("#request-correction").isDisabled());
        await shot("design-images-loading");
        for (let i = 0; heldImages.length < input.design.expectedImages && i < 200; i++) await Bun.sleep(10);
        holdImages = false;
        const pending = heldImages.splice(0);
        assertImagesWereRequested(pending.length);
        await pending[0]!.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "SCRIPTED unavailable required PNG" }) });
        await Promise.all(pending.slice(1).map(route => route.continue()));
        await page.locator("#review-unavailable").filter({ hasText: "could not be displayed" }).waitFor();
        await check("real browser image failure does not permit visual acceptance or correction", await page.locator("#accept-result").isDisabled() && await page.locator("#request-correction").isDisabled());
        await shot("design-image-failure");
        await page.locator("#refresh-job").click(); await loadedImages();
        await page.unroute(imageRoute);
        await check("authenticated reference and actual desktop/mobile PNGs really decode before decisions", await page.locator("#reports img").count() === input.design.expectedImages);
        const identitySummaries = page.locator("#reports summary").filter({ hasText: "Exact displayed source" });
        for (const summary of await identitySummaries.all()) await summary.click();
        await check("opening source details exposes the exact approved design snapshot", (await page.locator("#reports").innerText()).includes(input.design.snapshotSha256));
        for (const summary of await identitySummaries.all()) await summary.click();
        firstVisual = await visualModel();
        await check("the design display is bound to the pinned snapshot without duplicating PM review images", firstVisual.displays.length === 1 && firstVisual.displays[0]!.criterionId === "design-match" && firstVisual.displays.every(display => display.candidateTree === firstVisual!.candidateTree && display.visuals?.snapshotSha256 === input.design!.snapshotSha256));
        const fullSize = page.getByRole("button", { name: /^View full size: Pinned design reference/ }).first();
        await fullSize.focus(); await fullSize.press("Enter");
        await page.locator("#image-viewer[open]").waitFor();
        await page.waitForFunction(() => { const image = document.getElementById("image-viewer-image") as HTMLImageElement; return image.complete && image.naturalWidth === 1280 && image.naturalHeight === 800; });
        await check("full-size viewer displays the exact verified reference without new requests", await page.locator("#image-viewer-image").getAttribute("src") === firstVisual.imageUrls[0] && await page.locator("#close-image-viewer").evaluate(element => document.activeElement === element));
        await shot("design-full-size-reference");
        await page.keyboard.press("Escape");
        await check("Escape closes full-size pixels and restores keyboard focus", await page.locator("#image-viewer").isHidden() && await page.locator("#image-viewer-image").getAttribute("src") === null && await fullSize.evaluate(element => document.activeElement === element));
        await fullSize.click(); await page.locator("#close-image-viewer").click();
        await check("Close image returns to the same verified reference button", await page.locator("#image-viewer").isHidden() && await fullSize.evaluate(element => document.activeElement === element));
        await check("visual display notes remain available in collapsed details", await page.locator('[data-criterion-id="design-match"] details').filter({ has: page.getByText("Recorded display notes", { exact: true }) }).evaluate(element => !(element as HTMLDetailsElement).open));
        await check("product and design requirements are visible without invented separate reviewers", (await page.locator("#review-requirements").innerText()).includes("PM review") && (await page.locator("#review-requirements").innerText()).includes("Design review") && (await page.locator("#review-as").innerText()).includes(actor));
        await shot("design-first-result");
    }
    const first = await readPmWorkspace(state), before = await call("get_status", { jobId });
    await check("one approval automatically reaches the actual displayed human hold", input.roleCount() === 2 && first.checks.every(c => c.before.status === "failed" && c.after.status === "passed") && first.criteria.some(c => c.kind === "human" && c.state === "unknown"));
    await check("coding app receives a credential-free ready pointer", before.decision?.phase === "review" && before.decision?.pageUrl?.startsWith(route.origin) && !before.decision.pageUrl.includes("token") && before.decision.eventId === before.eventId);
    await check("the PM stayed on one origin and sees actual fixture output", new URL(page.url()).origin === route.origin && (await page.locator("#reports").innerText()).includes("export const expected = true"));
    await check("legacy terminal-style review mechanics are absent", await page.locator("#review-by, #criterion, #delivery-remote, #publication-consent, [data-command=show]").count() === 0);
    adversarialProbe = true;
    const rejected = await page.evaluate(async jobId => {
        const headers = { "X-Wringer-Console": "1", "Content-Type": "application/json" };
        const view = await (await fetch(`/api/job?jobId=${jobId}`, { headers })).json();
        const response = await fetch("/api/job/decision", { method: "POST", headers, body: JSON.stringify({ jobId, expectedRevision: view.readyRevision, expectedCandidateTree: view.candidateTree, verdict: "met", displayIds: ["11111111-1111-1111-1111-111111111111"] }) });
        return response.status;
    }, jobId);
    adversarialProbe = false;
    await check("actual HTTP review refuses an invented display without recording Yes", rejected === 409 && (await readPmWorkspace(state)).criteria.filter(c => c.kind === "human").every(c => c.state === "unknown"));
    await shot("first-result");
    await page.locator("#request-correction").click();
    const correction = "SCRIPTED correction: keep the correct value and replace the cryptic label with Expected value is ready.";
    await page.locator("#correction-note").fill(correction);
    await page.locator("#submit-correction").click();
    await page.waitForFunction(() => document.getElementById("reports")?.textContent?.includes("Expected value is ready"), {}, { timeout: 90000 });
    await waitPhase("review");
    const history = await readController(state), corrected = await readPmWorkspace(state);
    await loadedImages();
    if (input.design) {
        const current = await visualModel();
        await check("correction loads fresh captures of the changed source and preserves the original design reference", !!firstVisual && current.candidateTree !== firstVisual.candidateTree && current.readyRevision !== firstVisual.readyRevision && current.displays.length === firstVisual.displays.length && current.displays.every(display => {
            const previous = firstVisual!.displays.find(row => row.criterionId === display.criterionId);
            return !!previous && display.displayId !== previous.displayId && display.candidateTree === current.candidateTree && !!display.visuals && !!previous.visuals && display.visuals.snapshotSha256 === input.design!.snapshotSha256 && hashValue(display.visuals.referenceAssets) === hashValue(previous.visuals.referenceAssets) && display.visuals.captures.length === previous.visuals.captures.length && display.visuals.captures.every(asset => { const old = previous.visuals!.captures.find(row => row.id === asset.id); return !!old && asset.sha256 !== old.sha256 && asset.width === old.width && asset.height === old.height; });
        }) && current.imageUrls.length === input.design.expectedImages && current.imageUrls.every(url => url.startsWith("blob:") && !firstVisual!.imageUrls.includes(url)));
        await record({ visualCorrection: { previous: firstVisual, current }, fixture: true, note: "Real Chromium decoded newly hashed candidate PNGs. The correction and later verdict are scripted test inputs." });
    }
    await check("one correction preserves original words and uses only the remaining allowance", input.roleCount() === 4 && history.events.some(e => e.type === "revision-requested" && (e.details as any).feedback === correction) && corrected.candidate?.tree !== first.candidate?.tree);
    await check("new result has no prefilled approval or comment", (await page.locator("#review-note").inputValue()) === "" && corrected.criteria.find(c => c.kind === "human")?.state !== "met");
    await page.setViewportSize({ width: 390, height: 844 });
    await check("guided page fits mobile without horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await shot("review-mobile");
    await page.setViewportSize({ width: 1360, height: 1000 });
    await shot("review-desktop");
    await page.locator("#accept-result").click();
    await waitPhase("send");
    const ready = await readPmWorkspace(state), prepared = await latestWorkspacePublication(state);
    await check("one Yes records a decision without inventing a personal note", ready.criteria.filter(c => c.kind === "human" && c.required).every(c => c.state === "met" && c.note === null && c.by === actor));
    await check("acceptance automatically prepares but never sends", prepared?.pushed === false && (await git(["--git-dir", input.origin, "for-each-ref", "--format=%(refname)", "refs/heads"])).trim() === "refs/heads/main");
    await page.reload(); await waitPhase("send");
    await check("reopening send preserves its decision and does not publish", (await latestWorkspacePublication(state))?.pushed === false);
    await shot("send");
    await page.locator("#send-job").click();
    await waitPhase("handover");
    const delivered = await latestWorkspacePublication(state);
    if (!delivered) throw new Error("No carried publication was recorded");
    await check("one separate Send publishes only the intended review branch", delivered.pushed === true && (await git(["--git-dir", input.origin, "rev-parse", "main"])).trim() === input.baseCommit);
    await check("PM-visible happy-path post-build decisions are Yes then Send", decisions.filter(d => ["decision", "send"].includes(d.action)).length === 2 && decisions.filter(d => d.action === "approve").length === 1 && decisions.filter(d => d.action === "correction").length === 1);
    const clone = join(root, "guided-fresh-clone"); await git(["clone", "--branch", delivered.sourceBranch, input.origin, clone]);
    const audit = await command("guided literal carried audit in fresh clone", ["/bin/sh", "-c", delivered.auditCommand], clone);
    const bundle = join(clone, ".wringer/deliveries", delivered.deliveryId), view = await readContainedDeliveryProjection(bundle);
    if (input.design) {
        const snapshot = JSON.parse(await readFile(join(clone, "design/reference.json"), "utf8"));
        await check("fresh clone carries the originally pinned design snapshot and rendered corrected source", snapshot.snapshot_sha256 === input.design.snapshotSha256 && (await readFile(join(clone, "src/reports.html"), "utf8")).includes("Expected value is ready"));
        await check("both source-bound PM and design requirements survive the fresh-clone audit", view.criteria.filter(c => c.kind === "human" && c.required).length === 2 && view.criteria.filter(c => c.kind === "human").every(c => c.state === "met") && audit.exit_code === 0);
    }
    const certificate = JSON.parse(await readFile(join(bundle, "certificate.json"), "utf8"));
    const documents = await Promise.all(["mr.md", "summary.md", "board.html"].map(name => readFile(join(bundle, name), "utf8")));
    await check("carried views and certificate preserve decision identity and no-comment truth", hashValue(certificate.view) === hashValue(view) && view.criteria.filter(c => c.kind === "human").every(c => c.note === null && c.by === actor) && documents.every(text => text.includes(delivered.deliveryId) && !text.includes("null —") && !text.includes("PRIVATE_FIXTURE")));
    await check("handover page offers the real carried audit command", (await page.locator("#audit-command").innerText()).trim() === delivered.auditCommand);
    const falsify = await command("guided literal breakage command without fixture runtime", ["/bin/sh", "-c", delivered.falsify.command], clone, 3);
    await check("unavailable live breakage remains inconclusive", /inconclusive|unavailable/i.test(falsify.stdout));
    await shot("handover");
    await page.locator("#lock-job-page").click(); await page.reload();
    await page.waitForFunction(() => /locked|private.*link|connect/i.test(document.getElementById("job-message")?.textContent ?? ""));
    await check("guided browser has no script errors", errors.length === 0);
    await record({ surface: "guided Chromium SCRIPTED operator journey", decisions, routeStayedOnOneOrigin: true, roleSessions: input.roleCount(), wallMs: Date.now() - began, providerCalls: 0, credentialReads: 0 });
    const result = { schema_version: "wringer.guided-pm-rehearsal.v1", status: "passed", fixture: true, jobId, deliveryId: delivered.deliveryId, candidateCommit: delivered.codeCommit, evidenceCommit: delivered.evidenceCommit, browserDecisions: decisions.map(d => d.action), browserInteractionMs: Date.now() - began, providerCalls: 0, credentialReads: 0, independentPmMeasured: false, realContainmentMeasured: false, realClientMeasured: false, freshCloneAuditExit: audit.exit_code, breakageTest: "inconclusive-runtime-unavailable", ...(input.design ? { design: { snapshotSha256: input.design.snapshotSha256, realChromiumReferenceAndCaptures: true, requiredImagesPerCandidate: input.design.expectedImages, imageLoadAndFailureGatesMeasured: true, realFigmaMeasured: false, humanDecisions: "SCRIPTED TEST FIXTURE ONLY" } } : {}) };
    await writeFile(join(root, "guided-result.json"), JSON.stringify(result, null, 2) + "\n");
    return result;
}

function assertImagesWereRequested(count: number) { if (count < 1) throw new Error("The real browser did not request any of the required visual evidence"); }
