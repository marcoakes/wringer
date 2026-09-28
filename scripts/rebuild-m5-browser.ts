/** Actual Chromium and local Git, scripted engineering decisions only.
 * No model, provider, real user verdict, public push or browser profile. */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { git } from "../packages/engine/src";
import { audit } from "../packages/delivery/src";
import { registerWorkspace, createVerificationJob } from "../packages/application/src";
import { createVerificationOwner } from "../packages/cli/src/verification-owner";
import { callAssistantConnection } from "../packages/cli/src/assistant-transport";

const root = resolve(import.meta.dir, ".."), run = crypto.randomUUID(), directory = join(root, "build/rebuild-browser", run), repo = join(directory, "repo"), app = join(directory, "application"), origin = join(directory, "origin.git");
await mkdir(repo, { recursive: true });
await git(repo, ["init", "-b", "main"]); await git(repo, ["config", "user.name", "Automated browser fixture"]); await git(repo, ["config", "user.email", "fixture@example.invalid"]);
await writeFile(join(repo, ".gitignore"), ".wringer/\n"); await writeFile(join(repo, "result.txt"), "Original result\n");
await writeFile(join(repo, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "result", run: "test -s result.txt" }], show: { content: "cat result.txt" }, deliver: { remote: "origin", base: "main" } }));
await writeFile(join(repo, "wringer.spec.yaml"), JSON.stringify({ schema_version: "wringer.spec.v1", approved: true, title: "Scripted review", intent: "Inspect the actual text", criteria: [{ id: "content", title: "The result text meets the request", human: true }], tasks: [{ id: "content", brief: "brief.md", objective: "Inspect actual text" }] }));
await git(repo, ["add", "."]); await git(repo, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "Scripted baseline"]);
await git(directory, ["init", "--bare", "--initial-branch=main", origin]); await git(repo, ["remote", "add", "origin", origin]); await git(repo, ["push", "origin", "main"]);
await writeFile(join(repo, "result.txt"), "First actual fixture result\n");
const workspace = await registerWorkspace(app, { repo, mode: "verification", client: "generic", destination: { remote: "origin", base: "main" } });
const job = await createVerificationJob(app, workspace.id, { intent: "Inspect the actual text and request a correction before accepting", repetitions: 4, idempotencyKey: crypto.randomUUID() });
let owner = await createVerificationOwner(app, workspace.id);
const browser = await chromium.launch({ headless: true, env: Object.fromEntries(["PATH", "HOME", "TMPDIR"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])) });
const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
const page = await context.newPage(); page.setDefaultTimeout(15000);
const rows: { check: string; passed: boolean }[] = [], errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
const check = (name: string, value: unknown) => { rows.push({ check: name, passed: !!value }); console.log(`${value ? "PASS" : "FAIL"} ${name}`); };
const privatePage = (id: string) => { const url = new URL(owner.operatorUrl); url.searchParams.set("jobId", id); return url.href; };
const connected = () => page.waitForFunction(() => document.getElementById("job-connection")?.textContent === "Connected");
const state = () => callAssistantConnection(owner.connectionPath, "wringer.get_status", { jobId: job.id });
async function clickAction(selector: string, route: string) { const response = page.waitForResponse(row => new URL(row.url()).pathname === route && row.request().method() === "POST"); await page.locator(selector).click(); const observed = await response; if (!observed.ok()) console.log(`REFUSAL ${route} ${observed.status()}: ${(await observed.text()).replaceAll(directory, "[fixture]")}`); return observed.status(); }
try {
    await page.goto(privatePage(job.id)); await connected(); check("bootstrap fragment removed", new URL(page.url()).hash === "");
    await page.reload(); await connected(); check("reload retains bounded session", await page.locator("#approval-panel").isVisible());
    check("approval declares trusted-local mode", (await page.locator("#approval-budget").innerText()).includes("trusted-local"));
    await page.locator("#approval-actor").fill("Automated engineering browser fixture");
    check("approval accepted once", await clickAction("#approve-job", "/api/job/approve") === 202);
    await page.waitForFunction(() => !(document.getElementById("accept-result") as HTMLButtonElement)?.disabled);
    check("review shows actual result", (await page.locator("#reports").innerText()).includes("First actual fixture result"));
    check("operating mode remains visible during review", await page.locator("#job-mode").isVisible());
    check("phase transition focuses current decision", await page.evaluate(() => document.activeElement?.id === "job-workspace"));
    await page.screenshot({ path: join(directory, "review-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    check("narrow layout has no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check("decision has a screen-reader status region", await page.locator('[role="status"][aria-live="polite"]').count() > 0);
    await page.screenshot({ path: join(directory, "review-mobile.png"), fullPage: true }); await page.setViewportSize({ width: 1360, height: 1000 });
    const old = await owner.pm(job.id), stale = await context.newPage();
    await stale.route("**/api/job?*", route => route.fulfill({ status: 200, json: old })); await stale.goto(page.url());
    await stale.waitForFunction(() => !(document.getElementById("accept-result") as HTMLButtonElement)?.disabled);
    await page.locator("#request-correction").click(); check("correction keyboard focus", await page.locator("#correction-note").evaluate(element => document.activeElement === element));
    await page.locator("#correction-note").fill("Use the corrected fixture text.");
    check("correction recorded", await clickAction("#submit-correction", "/api/job/correction") === 200);
    const refusal = stale.waitForResponse(row => new URL(row.url()).pathname === "/api/job/decision"); await stale.locator("#accept-result").click(); check("stale tab cannot accept old candidate", (await refusal).status() === 409); await stale.close();
    // Models are forbidden in this measurement. This labelled fixture stands
    // in for the user's existing coding agent editing its own checkout.
    await writeFile(join(repo, "result.txt"), "Corrected fixture text\n");
    const before = await state(); await callAssistantConnection(owner.connectionPath, "wringer.run_checks", { jobId: job.id, idempotencyKey: crypto.randomUUID(), expectedRevision: before.revision, expectedCandidateIdentity: before.candidateIdentity });
    await page.waitForFunction(() => document.getElementById("reports")?.textContent?.includes("Corrected fixture text") && !(document.getElementById("accept-result") as HTMLButtonElement)?.disabled);
    check("acceptance comment remains empty", await page.locator("#review-note").inputValue() === "");
    check("empty-note acceptance recorded", await clickAction("#accept-result", "/api/job/decision") === 202);
    await page.waitForFunction(() => !(document.getElementById("send-job") as HTMLButtonElement)?.disabled);
    check("Send previews exact destination and branch", (await page.locator("#send-destination").innerText()).includes(job.destination!.branch));
    check("declining Send leaves remote untouched", (await git(repo, ["ls-remote", "--heads", "origin", job.destination!.branch])).stdout === "");
    await page.reload(); await connected(); await page.waitForFunction(() => !(document.getElementById("send-job") as HTMLButtonElement)?.disabled);
    check("explicit separate Send", await clickAction("#send-job", "/api/job/send") === 200);
    await page.locator("#handover-panel").waitFor({ state: "visible" });
    check("carried audit instructions visible", (await page.locator("#audit-command").innerText()).includes("audit"));
    const sent = await owner.pm(job.id), clone = join(directory, "fresh-clone"); await git(directory, ["clone", "--branch", job.destination!.branch, origin, clone]);
    check("fresh clone audits carried evidence", (await audit(clone, sent.publication!.deliveryId)).status === "passed");
    await page.screenshot({ path: join(directory, "sent.png"), fullPage: true });
    const retained = (await state()).revision;
    await page.locator("#lock-job-page").click(); await page.reload(); await page.waitForFunction(() => /locked|expired/i.test(document.getElementById("job-message")?.textContent ?? ""));
    check("locking retains completed state", (await state()).revision === retained);
    await owner.stop(); owner = await createVerificationOwner(app, workspace.id);
    await page.goto(privatePage(job.id)); await connected(); await page.locator("#handover-panel").waitFor({ state: "visible" });
    check("owner restart retains publication without rerunning", (await state()).phase === "sent");
    const stopped = await createVerificationJob(app, workspace.id, { intent: "Scripted Stop before approval", idempotencyKey: crypto.randomUUID() });
    await page.goto(privatePage(stopped.id)); await connected();
    check("visible Stop works before approval", await clickAction("#stop-job", "/api/job/stop") === 200);
    check("Stop does not spend or renew", ((await callAssistantConnection(owner.connectionPath, "wringer.get_status", { jobId: stopped.id })).remaining as { repetitions: number }).repetitions === 3);
    check("no page script errors", errors.length === 0);
} finally {
    await browser.close(); await owner.stop();
    const evidence = join(root, "docs/rebuild/evidence/m5"); await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, `browser-${run}.json`), JSON.stringify({ fixture: "Automated engineering; no real human decision, containment or model acceptance", browser: browser.version(), at: new Date().toISOString(), artifacts: `build/rebuild-browser/${run}`, rows, pageErrors: errors, modelCalls: 0 }, null, 2) + "\n");
}
if (rows.some(row => !row.passed)) throw new Error("Browser observations failed; inspect retained engineering evidence");
