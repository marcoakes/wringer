import { openReports } from "./browser";
import { readFile } from "node:fs/promises";
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const { page, close } = await openReports();
try {
    const source = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
    assert(/from\s*["'](?:\.\.\/ui\/components\.ts)["']/.test(source), "Reuse the existing components");
    assert(await page.locator(".report-card").count() === 6, "All six supplied reports must be shown");
    for (const text of ["Quarterly growth", "Avery Chen", "Published", "2026"]) assert((await page.locator("main").innerText()).includes(text), `Missing report information: ${text}`);
    const search = page.getByRole("textbox", { name: /search reports/i }), status = page.getByRole("combobox", { name: /status/i });
    await search.fill("research"); assert(await page.locator(".report-card").count() === 1, "Search must filter titles");
    await status.selectOption({ label: "Draft" }); assert(await page.locator(".report-card").count() === 0, "Search and status must combine");
    assert((await page.locator("main").innerText()).includes("No reports"), "Explain the empty state");
    await page.getByRole("button", { name: /reset/i }).click(); assert(await page.locator(".report-card").count() === 6, "Reset must restore reports");
    await page.locator(".report-card").filter({ hasText: "Quarterly growth" }).getByRole("button", { name: /open|view/i }).focus();
    await page.keyboard.press("Enter"); assert((await page.locator("main").innerText()).includes("Customer retention improved"), "Keyboard opening must show the real summary");
    await page.getByRole("button", { name: /back/i }).click(); assert(await page.locator(".report-card").count() === 6, "Back must restore the report list");
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Phone layout must not scroll sideways");
    console.log("PASS: report data, combined filters, empty reset, keyboard detail/back and phone overflow. Visual quality and full accessibility remain human/unmeasured.");
} finally { await close(); }
