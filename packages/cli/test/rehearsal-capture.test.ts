import { expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import type { Browser } from "playwright";
import { captureFixtureHtml } from "../../../scripts/rehearsal-capture";

const crc = (b: Buffer) => { let c = 0xffffffff; for (const byte of b) { c ^= byte; for (let i = 0; i < 8; i++) c = c >>> 1 ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data = Buffer.alloc(0)) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, b.length - 4)), b.length - 4); return b; };
function png() {
    const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0,255,0,0,255]))), chunk("IEND")]);
}
const steps = ["newContext", "route", "newPage", "setContent", "screenshot", "close"] as const;
type Step = (typeof steps)[number];
/** A scripted Playwright stand-in. A hung step never settles and ignores any
 * timeout it is given, as the observed context hang did. */
function fixture(hung?: Step) {
    const calls: Partial<Record<Step, number>> = {}, options: Partial<Record<Step, unknown>> = {};
    const act = <T>(name: Step, value: T, option?: unknown) => {
        calls[name] = (calls[name] ?? 0) + 1; if (option !== undefined) options[name] = option;
        return name === hung ? new Promise<T>(() => {}) : Promise.resolve(value);
    };
    const page = { setContent: (_html: string, option: unknown) => act("setContent", undefined, option), screenshot: (option: unknown) => act("screenshot", png(), option) };
    const context = { route: () => act("route", undefined), newPage: () => act("newPage", page), close: () => act("close", undefined) };
    return { browser: { newContext: (option: unknown) => act("newContext", context, option) } as unknown as Pick<Browser, "newContext">, calls, options };
}

test.each<Step>([...steps])("a hung %s stops with its named step, a transcript entry and no retry", async hung => {
    const f = fixture(hung), transcript: any[] = [], began = Date.now();
    // Attach the outcome handler first so a bounded stop is the test's observation.
    const observed = captureFixtureHtml(f.browser, "<p>fixture</p>", { width: 1, height: 1 }, "candidate/mobile", async entry => { transcript.push(entry); }, 50)
        .then(() => new Error("A hung capture reported success"), (error: Error) => error);
    let timer!: ReturnType<typeof setTimeout>;
    const watchdog = new Promise<Error>(resolve => { timer = setTimeout(() => resolve(new Error("Capture remained unbounded")), 2000); });
    const error = await Promise.race([observed, watchdog]); clearTimeout(timer);
    expect(error.message).toBe(`Design capture candidate/mobile stopped at ${hung}: no result within 50 ms`);
    expect(Date.now() - began).toBeLessThan(2000);
    expect(transcript.at(-1)).toMatchObject({ capture: "candidate/mobile", failedStep: hung, stepBoundMs: 50, error: "no result within 50 ms" });
    // Each reached step ran once; an abandoned context is closed once, never retried.
    const reached = [...steps.slice(0, steps.indexOf(hung) + 1), ...(hung === "newContext" ? [] : ["close" as const])];
    expect(f.calls).toEqual(Object.fromEntries(reached.map(name => [name, 1])));
}, 5000);

test("setContent and screenshot carry the explicit step bound to Playwright", async () => {
    const f = fixture(), transcript: any[] = [];
    const captured = await captureFixtureHtml(f.browser, "<p>fixture</p>", { width: 1, height: 1 }, "reference/desktop", async entry => { transcript.push(entry); }, 1234);
    expect(captured).toMatchObject({ base64: png().toString("base64"), width: 1, height: 1 });
    expect(f.options.newContext).toEqual({ viewport: { width: 1, height: 1 }, javaScriptEnabled: false, serviceWorkers: "block", acceptDownloads: false });
    expect(f.options.setContent).toEqual({ waitUntil: "load", timeout: 1234 });
    expect(f.options.screenshot).toEqual({ type: "png", animations: "disabled", timeout: 1234 });
    expect(f.calls).toEqual({ newContext: 1, route: 1, newPage: 1, setContent: 1, screenshot: 1, close: 1 });
    expect(transcript).toEqual([expect.objectContaining({ capture: "reference/desktop", width: 1, height: 1, realChromium: true, isolatedBrowserContext: true, realContainmentMeasured: false })]);
}, 5000);
