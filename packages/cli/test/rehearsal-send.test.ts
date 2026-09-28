import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { waitForSendAdmission } from "../../../scripts/rehearsal-send";

async function fixture() {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 60, async fetch(request) {
        if (new URL(request.url).pathname === "/api/job/send" && request.method === "POST") {
            requests++; await held;
            return Response.json({ status: "running", commandId: "scripted-retained-command" }, { status: 202 });
        }
        return new Response("<!doctype html><title>Scripted admission fixture</title>", { headers: { "content-type": "text/html" } });
    } });
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage(); await page.goto(server.url.toString());
    return { page, release, requests: () => requests, async close() { release(); await browser.close(); server.stop(true); } };
}

test("Send admission outlives the UI action timeout and observes exactly one POST", async () => {
    const f = await fixture();
    try {
        f.page.setDefaultTimeout(20);
        // Attach the rejection handler before dispatch so an early timeout is
        // observed as the test outcome, never an unhandled rejection.
        const observed = waitForSendAdmission(f.page).then(response => ({ response }), error => ({ error }));
        await f.page.evaluate(() => { void fetch("/api/job/send", { method: "POST" }); });
        await Bun.sleep(100); f.release();
        const result = await observed;
        expect("error" in result).toBe(false);
        if (!("response" in result)) throw result.error;
        expect(result.response.status()).toBe(202);
        expect(await result.response.json()).toEqual({ status: "running", commandId: "scripted-retained-command" });
        expect(f.requests()).toBe(1);
    } finally { await f.close(); }
}, 10000);

test("Send admission observation stops at its finite bound without retrying", async () => {
    const f = await fixture();
    try {
        f.page.setDefaultTimeout(0);
        const began = Date.now();
        const observed = waitForSendAdmission(f.page).then(() => null, error => error);
        await f.page.evaluate(() => { void fetch("/api/job/send", { method: "POST" }); });
        let deadline!: ReturnType<typeof setTimeout>;
        const watchdog = new Promise<Error>(resolve => { deadline = setTimeout(() => resolve(new Error("Observation remained unbounded")), 45000); });
        const error = await Promise.race([observed, watchdog]); clearTimeout(deadline);
        expect(error?.message).toContain("Timeout 40000ms");
        expect(Date.now() - began).toBeLessThan(45000);
        expect(f.requests()).toBe(1);
    } finally { await f.close(); }
}, 48000);
