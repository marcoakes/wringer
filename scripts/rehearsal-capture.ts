import type { Browser } from "playwright";
import { hashBytes } from "../packages/plan/src";
import { inspectPng } from "../packages/design/src";

/** Playwright gives creating and closing a browser context no bound. A Linux
 * design rehearsal once hung in a capture until the guided page's 90 s phase
 * wait gave up (504543d, 24 earlier Linux runs passed). Every step of one fixture
 * capture is bounded here; a stop is recorded and names its step and capture.
 * A hang stays a failure: never retry a step. */
export const CAPTURE_STEP_MS = 10000;
export async function captureFixtureHtml(browser: Pick<Browser, "newContext">, html: string, viewport: { width: number; height: number }, label: string, record: (entry: unknown) => Promise<void>, stepMs = CAPTURE_STEP_MS) {
    const began = Date.now();
    const step = async <T>(name: string, work: (timeout: number) => Promise<T>): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no result within ${stepMs} ms`)), stepMs); });
        try { return await Promise.race([work(stepMs), deadline]); } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            await record({ capture: label, failedStep: name, stepBoundMs: stepMs, elapsedMs: Date.now() - began, error: reason, realChromium: true });
            throw new Error(`Design capture ${label} stopped at ${name}: ${reason.split("\n")[0]}`, { cause: error });
        } finally { clearTimeout(timer); }
    };
    // Separate context: fixture HTML never receives the operator session or
    // privileged console origin. Scripts and all network access are disabled.
    const context = await step("newContext", () => browser.newContext({ viewport, javaScriptEnabled: false, serviceWorkers: "block", acceptDownloads: false }));
    let closing: Promise<void> | undefined;
    const close = () => closing ??= context.close();
    try {
        await step("route", () => context.route("**/*", route => route.abort()));
        const page = await step("newPage", () => context.newPage());
        await step("setContent", timeout => page.setContent(html, { waitUntil: "load", timeout }));
        const bytes = await step("screenshot", timeout => page.screenshot({ type: "png", animations: "disabled", timeout })), base64 = bytes.toString("base64"), image = inspectPng(base64);
        await record({ capture: label, htmlSha256: hashBytes(html), ...image, elapsedMs: Date.now() - began, realChromium: true, isolatedBrowserContext: true, realContainmentMeasured: false });
        await step("close", close);
        return { base64, ...image };
    } catch (error) {
        // A hung context can only be abandoned; its owner closes the browser.
        void close().catch(() => {});
        throw error;
    }
}
