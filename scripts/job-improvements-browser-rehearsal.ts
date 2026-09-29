/** Actual Chromium/owner routes with scripted observations only. */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ordinaryImprovementFixture } from "../packages/application/fixtures/ordinary-improvement";
import { retainDelegationJob } from "../packages/application/src";
import { dispatch } from "../packages/cli/src/app";
import { createDelegationOwner } from "../packages/cli/src/delegation-owner";
import { launchPmBrowser } from "./pm-browser";
export async function runJobImprovementsBrowserRehearsal() {
    const directory = join(resolve(import.meta.dir, ".."), "build", `job-improvements-browser-${crypto.randomUUID()}`); await mkdir(directory, { recursive: true });
    const f = await ordinaryImprovementFixture();
    await dispatch(["experiment", "connect", "--job", f.jobId, "--app-dir", f.root, "--task-family", "reports"]);
    const input = join(f.root, "comparison.json"); await writeFile(input, JSON.stringify(f.experiment));
    await dispatch(["experiment", "register", "--job", f.jobId, "--app-dir", f.root, "--experiment", f.experiment.id, "--input", input]);
    const second = await f.controller.recordProposal({ workspaceId: f.controller.workspace.id, idempotencyKey: crypto.randomUUID(), proposal: { intent: "Second scripted job", title: "Another question", questions: ["Which behavior?"] } });
    await retainDelegationJob(f.root, f.context, String(second.jobId));
    const owner = await createDelegationOwner(f.root, f.workspaceId), browser = await launchPmBrowser(directory, async () => {}), page = browser.page;
    const checks: { name: string; passed: boolean }[] = [], errors: string[] = [], writes: { path: string; jobId: unknown }[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() === "POST") writes.push({ path: new URL(request.url()).pathname, jobId: request.postDataJSON()?.jobId ?? null }); });
    const check = (name: string, passed: boolean) => { checks.push({ name, passed }); if (!passed) throw new Error(name); };
    let releaseRead: (() => void) | undefined, releaseDecision: (() => void) | undefined;
    try {
        const url = new URL(owner.operatorUrl); url.searchParams.set("jobId", f.jobId);
        await page.goto(url.href); await page.locator("#improvements-panel").waitFor({ state: "visible" });
        await page.locator("#improvements-panel > summary").click();
        check("ordinary job shows prediction, finite allowance and exact applicability", (await page.locator("#improvements-content").innerText()).includes("SCRIPTED hypothesis") && (await page.locator("#improvements-content").innerText()).includes("at most 2 fresh trials"));
        await page.getByText("Evidence and limits", { exact: true }).click();
        check("the registered source/runtime/model/check matches are visible", (await page.locator("#improvements-content").innerText()).includes("models matches"));
        check("reading leaves research and production decisions untouched", writes.every(row => row.path === "/api/session") && !await f.controller.inspectApproval(f.jobId));
        // Hold a genuine first-job response while switching to another job.
        const barrier = new Promise<void>(resolve => { releaseRead = resolve; }); let heldResolve!: () => void;
        const held = new Promise<void>(resolve => { heldResolve = resolve; }); let hold = true;
        await page.route(/\/api\/improvements\?jobId=/, async route => {
            if (hold && new URL(route.request().url()).searchParams.get("jobId") === f.jobId) {
                hold = false; const response = await route.fetch({ headers: { ...route.request().headers(), origin: owner.page } }), view = await response.json();
                if (!response.ok()) throw new Error("Scripted route fetch refused: " + response.status());
                view.experiments[0].prediction = "STALE-FIRST-JOB"; heldResolve(); await barrier; await route.fulfill({ response, json: view });
            } else await route.continue();
        });
        await page.locator("#refresh-improvements").click(); await held;
        const changed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/improvements" && new URL(response.url()).searchParams.get("jobId") === second.jobId);
        await page.locator("#job-picker").selectOption(String(second.jobId)); await changed;
        await page.locator("#improvements-panel").waitFor({ state: "visible" }); releaseRead!(); await page.waitForTimeout(100);
        check("a late first-job response cannot replace the selected job's comparison", !(await page.locator("#improvements-content").innerText()).includes("STALE-FIRST-JOB"));
        await page.unrouteAll({ behavior: "wait" });
        const decisionBarrier = new Promise<void>(resolve => { releaseDecision = resolve; }); let decisionHeld!: () => void;
        const pendingDecision = new Promise<void>(resolve => { decisionHeld = resolve; });
        await page.route(/\/api\/improvements\/collect$/, async route => {
            const response = await route.fetch({ headers: { ...route.request().headers(), origin: owner.page } }); decisionHeld(); await decisionBarrier; await route.fulfill({ response });
        });
        const form = page.locator("#improvements-content form").first(); await form.locator('input[type="text"]').fill("Scripted expired request"); await form.locator('input[type="datetime-local"]').fill("2020-01-01T00:00");
        const refused = page.waitForResponse(response => new URL(response.url()).pathname === "/api/improvements/collect");
        await page.getByRole("button", { name: "Test this improvement", exact: true }).click();
        await pendingDecision; await page.locator("#job-picker").selectOption(f.jobId); releaseDecision!();
        check("a research action binds the selected job and refuses an expired allowance", (await refused).status() === 409 && writes.at(-1)?.jobId === second.jobId);
        await page.locator("#improvements-panel").waitFor({ state: "visible" });
        check("a delayed decision reply cannot attach the prior job's message to another job", !(await page.locator("#improvements-message").innerText()).includes("expiry"));
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByText("Registered prediction and proposed approach", { exact: true }).click();
        check("the proposal and comparison fit a mobile job page", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: join(directory, "browser-job-improvements.png"), fullPage: true });
        await page.locator("#lock-job-page").click();
        check("locking clears research controls and no collection or product approval occurred", await page.locator("#improvements-panel").isHidden() && (await page.locator("#improvements-content button").count()) === 0 && !await f.controller.inspectApproval(f.jobId) && !await f.controller.inspectApproval(String(second.jobId)));
        check("Chromium reports no uncaught page error", errors.length === 0);
    } finally {
        releaseRead?.(); releaseDecision?.(); await browser.close(); await owner.stop();
        await writeFile(join(directory, "result.json"), JSON.stringify({ fixture: true, status: checks.length === 9 && checks.every(row => row.passed) ? "passed" : "failed", checks, providerCalls: 0, independentPmMeasured: false, limits: ["Scripted browser/HTTP observations, no live research or human acceptance."] }, null, 2) + "\n");
    }
    return { directory, checks };
}
if (import.meta.main) console.log(JSON.stringify(await runJobImprovementsBrowserRehearsal(), null, 2));
