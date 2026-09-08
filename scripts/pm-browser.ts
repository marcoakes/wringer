/** Real HTML + Chromium against the loopback product servers. Every decision
 * here is a SCRIPTED TEST FIXTURE, never evidence of independent human use. */
import { chromium, type Page } from "playwright";
import { join } from "node:path";
import type { WorkspaceCommand } from "../packages/application/src/commands";

export async function launchPmBrowser(directory: string, record: (entry: unknown) => Promise<void>) {
    // A test browser gets no worker credentials or inherited browser profile.
    const browser = await chromium.launch({ headless: true, env: Object.fromEntries(
        ["PATH", "HOME", "TMPDIR", "SystemRoot"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])),
    });
    const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
    await context.route("**/*", route => {
        const url = new URL(route.request().url());
        return url.protocol === "http:" && url.hostname === "127.0.0.1" ? route.continue() : route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(`Browser: ${message}`); };
    const connected = async () => { await page.waitForFunction(() => /Connected · current record|Recorded state refreshed/.test(document.getElementById("connection")?.textContent ?? "")); };
    async function screenshot(name: string) {
        await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
        await record({ surface: "real Chromium, scripted operator", screenshot: `${name}.png` });
    }
    return {
        page,
        async approve(url: string, actor: string) {
            await page.goto(url); await connected();
            assert(!new URL(page.url()).hash, "private fragment was not removed");
            await page.reload(); await connected();
            await page.goto(page.url()); await connected();
            await record({ browser: "console reload and reopening without a fragment retained the bounded session" });
            await page.locator('input[name="actor"]').fill(actor);
            const expires = new Date(Date.now() + 600000);
            const local = new Date(expires.getTime() - expires.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
            await page.locator('input[name="expiry"]').fill(local);
            await page.getByRole("checkbox").check();
            const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/approve");
            await page.getByRole("button", { name: "Approve bounded work", exact: true }).click();
            assert((await response).ok(), "bounded approval failed");
            await page.getByText(/Bounded approval recorded until/).waitFor();
            await screenshot("browser-approval");
        },
        async openReview(consoleUrl: string) {
            await page.goto(consoleUrl); await connected();
            await page.getByRole("button", { name: "Review the result", exact: true }).click();
            await page.locator("#decision").waitFor(); await connected();
            assert(!new URL(page.url()).hash, "review private fragment was not removed");
            await page.reload(); await connected();
            assert(await page.locator("#review-form").isHidden(), "review form appeared without a current display");
            assert(await page.locator("#criterion-picker").isHidden(), "single requirement asks for a redundant choice");
            await record({ browser: "one console click opened review; review reload reconnected without granting a verdict" });
        },
        async command(action: WorkspaceCommand["action"], click: (page: Page) => Promise<unknown>) {
            const request = page.waitForRequest(r => new URL(r.url()).pathname === "/api/commands" && r.method() === "POST");
            await click(page);
            const input = (await request).postDataJSON() as WorkspaceCommand;
            assert(input.action === action, `expected ${action}, actual ${input.action}`);
            await record({ surface: "real Chromium form submission, scripted operator", input });
            await page.waitForFunction(() => document.getElementById("decision")?.getAttribute("aria-busy") === "false", { }, { timeout: 60000 });
            return input;
        },
        async reviewForm(verdict: "met" | "not_met", actor: string, note: string) {
            await page.locator("#review-form").waitFor({ state: "visible" });
            assert(!await page.locator("#review-yes").isChecked() && !await page.locator("#review-no").isChecked(), "a verdict was selected on the person's behalf");
            assert(await page.locator('[data-command="review"]').isDisabled(), "review saves without a decision and original note");
            await page.locator(verdict === "met" ? "#review-yes" : "#review-no").check();
            await page.locator("#review-by").fill(actor);
            await page.locator("#review-note").fill(note);
            assert(await page.locator(verdict === "met" ? "#review-no" : "#review-yes").isChecked() === false, "verdict choices are not mutually exclusive");
            await screenshot(`browser-${verdict}-desktop`);
            await page.setViewportSize({ width: 390, height: 844 });
            assert(await page.locator(verdict === "met" ? "#review-yes" : "#review-no").isVisible(), "decision is not visible on mobile");
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "page overflows the mobile viewport");
            await screenshot(`browser-${verdict}-mobile`);
            await page.setViewportSize({ width: 1360, height: 1000 });
        },
        async assertFailedDisplay() {
            assert(await page.locator("#review-form").isHidden(), "failed showing exposed a verdict form");
            assert(await page.locator('[data-command="review"]').isDisabled(), "failed showing enabled a verdict");
            await record({ browser: "failed display kept both verdict routes unavailable" });
        },
        async refresh() { await page.locator("#refresh-state").click(); await connected(); },
        async finish(consoleUrl: string) {
            await screenshot("browser-delivered");
            await page.goto(consoleUrl); await connected();
            await page.getByRole("button", { name: "Lock this console", exact: true }).click();
            await page.getByText("Console locked", { exact: true }).waitFor();
            await page.reload();
            await page.getByText("Not connected — decisions are disabled", { exact: true }).waitFor();
            assert(await page.getByRole("button", { name: "Approve bounded work", exact: true }).count() === 0, "locked console still has approval controls");
            assert(errors.length === 0, `page script errors: ${errors.join("; ")}`);
            await record({ browser: "explicit logout survives reload; no page script errors", browserVersion: browser.version(), fixture: true });
        },
        close: () => browser.close(),
    };
}
