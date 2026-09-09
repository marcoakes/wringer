// This executes INSIDE the approved browser image, not in Wringer's controller.
import { resolve } from "node:path";
export async function openReports() {
    const browserModule = "/opt/wringer-design/node_modules/playwright/index.mjs";
    const { chromium } = await import(browserModule);
    const root = resolve(import.meta.dir, ".."), transpiler = new Bun.Transpiler({ loader: "ts" });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
        const path = new URL(request.url).pathname;
        if (!["/", "/data/reports.json"].includes(path) && !/^\/(?:src|ui)\/[A-Za-z0-9_/-]+\.(?:ts|css)$/.test(path)) return new Response("Not found", { status: 404 });
        const file = Bun.file(root + (path === "/" ? "/index.html" : path));
        if (!await file.exists()) return new Response("Not found", { status: 404 });
        return path.endsWith(".ts") ? new Response(transpiler.transformSync(await file.text()), { headers: { "Content-Type": "application/javascript" } }) : new Response(file);
    } });
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    // Network is already contained by the runtime. This also refuses remote page requests.
    await context.route("**/*", (route: any) => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    await page.goto(server.url.href); await page.waitForLoadState("networkidle");
    return { page, close: async () => { await browser.close(); server.stop(true); } };
}
