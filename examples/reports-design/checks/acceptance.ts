// Protected runner: stdout is one bounded wringer-check.v1 assertion report.
// Imports, browser startup and runner errors are never described as failed assertions.
import { openReports } from "./browser";
import { readFile } from "node:fs/promises";
class AssertionFailure extends Error {}
const assert = (value: unknown, message: string) => { if (!value) throw new AssertionFailure(message); };
let page: any;
const checks: { id: string; run: () => Promise<void> }[] = [
    { id: "existing-components", run: async () => assert(/from\s*["'](?:\.\.\/ui\/components\.ts)["']/.test(await readFile(new URL("../src/app.ts", import.meta.url), "utf8")), "Reuse the existing components") },
    { id: "all-six-reports", run: async () => assert(await page.locator(".report-card").count() === 6, "All six supplied reports must be shown") },
    { id: "report-information", run: async () => { for (const text of ["Quarterly growth", "Avery Chen", "Published", "2026"]) assert((await page.locator("main").innerText()).includes(text), `Missing report information: ${text}`); } },
    { id: "title-search", run: async () => { const search = page.getByRole("textbox", { name: /search reports/i }); assert(await search.count() === 1, "A labelled report-search control is required"); await search.fill("research"); assert(await page.locator(".report-card").count() === 1, "Search must filter titles"); } },
    { id: "combined-filters", run: async () => { const status = page.getByRole("combobox", { name: /status/i }); assert(await status.count() === 1, "A labelled status control is required"); await status.selectOption({ label: "Draft" }); assert(await page.locator(".report-card").count() === 0, "Search and status must combine"); } },
    { id: "empty-explanation", run: async () => assert((await page.locator("main").innerText()).includes("No reports"), "Explain the empty state") },
    { id: "empty-reset", run: async () => { const reset = page.getByRole("button", { name: /reset/i }); assert(await reset.count() === 1, "The empty state needs a reset button"); await reset.click(); assert(await page.locator(".report-card").count() === 6, "Reset must restore reports"); } },
    { id: "keyboard-detail", run: async () => { const open = page.locator(".report-card").filter({ hasText: "Quarterly growth" }).getByRole("button", { name: /open|view/i }); assert(await open.count() === 1, "The report needs an open button"); await open.focus(); await page.keyboard.press("Enter"); assert((await page.locator("main").innerText()).includes("Customer retention improved"), "Keyboard opening must show the real summary"); } },
    { id: "detail-back", run: async () => { const back = page.getByRole("button", { name: /back/i }); assert(await back.count() === 1, "Detail needs a back button"); await back.click(); assert(await page.locator(".report-card").count() === 6, "Back must restore the report list"); } },
    { id: "phone-overflow", run: async () => { await page.setViewportSize({ width: 390, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Phone layout must not scroll sideways"); } },
];
const assertions = checks.map(c => ({ id: c.id, requirements: ["reports-work"], status: "skipped" as "passed" | "failed" | "skipped" }));
const errors: string[] = [];
let close: (() => Promise<void>) | undefined;
try {
    ({ page, close } = await openReports());
    for (let i = 0; i < checks.length; i++) {
        try { await checks[i]!.run(); assertions[i]!.status = "passed"; }
        catch (error) {
            if (error instanceof AssertionFailure) { assertions[i]!.status = "failed"; console.error(`${checks[i]!.id}: ${error.message}`); }
            else errors.push(String(error).slice(0, 1500));
            break;
        }
    }
} catch (error) { errors.push(String(error).slice(0, 1500)); }
finally { try { await close?.(); } catch (error) { errors.push(String(error).slice(0, 1500)); } }
console.log(JSON.stringify({ schema_version: "wringer-check.v1", assertions, errors }));
process.exitCode = errors.length || assertions.some(a => a.status !== "passed") ? 1 : 0;
