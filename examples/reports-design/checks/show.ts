import { mkdir } from "node:fs/promises";
import { openReports } from "./browser";
const { page, close } = await openReports();
try {
    await mkdir(".evidence", { recursive: true });
    await page.screenshot({ path: ".evidence/desktop.png", fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: ".evidence/mobile.png", fullPage: false });
    console.log("Captured the actual Reports output at desktop 1280×900 and mobile 390×844. Screenshots are display evidence, not a visual-quality verdict.");
} finally { await close(); }
