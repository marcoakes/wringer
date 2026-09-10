import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { chromium, type Browser } from "playwright";
import { compileDeclaration, compileExecutionPlan } from "@wringer/plan";
import { importDesignFromFigmaRest, readDesignSnapshot } from "@wringer/design";
import { createLocalSourceBundle, prepareRepositoryArtifactSource } from "@wringer/runtime";
import { createAssistantService, initializeAssistant, issueAssistantCapability } from "../../application/src/assistant";
import { attachAssistantDesign } from "../../application/src/assistant-design-binding";
import type { AssistantDesignDependencies } from "../../application/src/assistant-design";
import type { FigmaConnectionStatus } from "../../figma-connect/src";
import { createAssistantConsole } from "../src/assistant-console";
import { openFigmaAuthorizationInBrowser } from "../src/figma-browser";
import { withFigmaCard } from "../src/figma-console";

// All OAuth/API responses are scripted fixture data. Real loopback HTTP, browser
// form controls and Git attachment run; no live account or human is claimed.
const dirs: string[] = [], servers: Awaited<ReturnType<typeof createAssistantConsole>>[] = [], services: Awaited<ReturnType<typeof createAssistantService>>[] = [], browsers: Browser[] = [];
afterEach(async () => { for (const browser of browsers.splice(0)) await browser.close(); for (const server of servers.splice(0)) await server.stop(); for (const service of services.splice(0)) await service.runner.stop(50); for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true }); });
const authUrl = "https://www.figma.com/oauth?client_id=fixture-client&redirect_uri=https%3A%2F%2Fconnection.example.org%2Foauth%2Ffigma%2Fcallback&scope=file_content%3Aread&state=" + "a".repeat(43) + "&response_type=code&code_challenge=" + "b".repeat(43) + "&code_challenge_method=S256";
const urls = ["https://www.figma.com/design/ReportsFixture/Reports?node-id=1-2", "https://www.figma.com/design/ReportsFixture/Reports?node-id=3-4"];
async function git(cwd: string, ...args: string[]) { const child = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd, stdout: "pipe", stderr: "pipe" }); const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); if (code) throw new Error(error); return out.trim(); }
function png(width: number, height: number) {
    const chunk = (name: string, bytes: Buffer) => { const value = Buffer.alloc(bytes.length + 12); value.writeUInt32BE(bytes.length); value.write(name, 4); bytes.copy(value, 8); let crc = 0xffffffff; for (const byte of value.subarray(4, value.length - 4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); } value.writeUInt32BE((crc ^ 0xffffffff) >>> 0, value.length - 4); return value; };
    const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.alloc(height * (width * 3 + 1)))), chunk("IEND", Buffer.alloc(0))]);
}
async function fixture() {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-figma-console-"))); dirs.push(root);
    const repo = join(root, "repo"), controller = join(root, "controller"); await mkdir(repo);
    await git(repo, "init", "-q"); await git(repo, "config", "user.name", "Scripted fixture"); await git(repo, "config", "user.email", "fixture@example.invalid");
    for (const name of ["tests", "scripts", "design"]) await mkdir(join(repo, name));
    for (const name of ["README.md", "tests/acceptance.test.ts", "scripts/capture.ts", "design/old.json", "bun.lock", "package.json"]) await writeFile(join(repo, name), "Fixture only\n");
    await git(repo, "add", "."); await git(repo, "commit", "-qm", "Scripted source"); const commit = await git(repo, "rev-parse", "HEAD");
    const original = compileExecutionPlan(await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
    const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...base } = original;
    const profile = compileDeclaration({ ...base, version: 2, intent: original.intent + " The display matches the design.", repository: { url: "https://example.invalid/reports.git", commit }, environment: { ...original.environment, writable_directories: ["node_modules", "preview"] }, acceptance: { ...original.acceptance, criteria: [...original.acceptance.criteria, { id: "design-fit", title: "Display matches design", quote: "The display matches the design.", kind: "human", required: true, show: { id: "preview", argv: ["bun", "scripts/capture.ts"], cwd: ".", timeout_seconds: 30 } }], protected_paths: [...original.acceptance.protected_paths, "scripts/capture.ts"] }, design: { snapshotPath: "design/old.json", snapshotSha256: "a".repeat(64), reviews: [{ criterionId: "design-fit", referenceIds: ["desktop", "mobile"], captures: [{ id: "desktop", path: "preview/desktop.png", mimeType: "image/png", width: 2, height: 1 }, { id: "mobile", path: "preview/mobile.png", mimeType: "image/png", width: 1, height: 2 }] }] } });
    const workspace = (await initializeAssistant(controller, { plan: profile, cooperativeLocal: true })).workspace;
    let connectionState: FigmaConnectionStatus = { state: "needs-connection", configured: true, message: "Scripted connection. No real Figma account." }, imports = 0, opened = 0;
    const connection: AssistantDesignDependencies["connection"] = {
        async status() { return connectionState; }, async begin() { connectionState = { ...connectionState, state: "connecting" }; return { authorizationUrl: authUrl, expiresAt: new Date(Date.now() + 60000).toISOString() }; }, async poll() { return connectionState = { ...connectionState, state: "connected" }; }, async disconnect() { return connectionState = { ...connectionState, state: "needs-connection" }; }, async requireReconnect() { return connectionState = { ...connectionState, state: "reconnect-required" }; }, async withAccessToken<T>(callback: (token: string) => Promise<T>) { return callback("fixture-private-credential"); },
    };
    const service = await createAssistantService(controller, { design: { connection, importSnapshot: input => { imports++; return importDesignFromFigmaRest(input, { testTransport: async request => { const url = new URL(request.url); const value = url.pathname.endsWith("/nodes") ? { version: "fixture-v1", nodes: { "1:2": { document: { id: "1:2", type: "FRAME", name: "Desktop Reports" } }, "3:4": { document: { id: "3:4", type: "FRAME", name: "Mobile Reports" } } } } : { images: { "1:2": "https://s3-alpha.figma.com/images/desktop", "3:4": "https://s3-alpha.figma.com/images/mobile" } }; return { status: 200, headers: { "content-type": url.hostname === "api.figma.com" ? "application/json" : "image/png" }, body: url.hostname === "api.figma.com" ? Buffer.from(JSON.stringify(value)) : png(url.pathname.endsWith("desktop") ? 2 : 1, url.pathname.endsWith("desktop") ? 1 : 2) }; } }); } } }); services.push(service);
    const console = await createAssistantConsole(service, { guided: true, openFigmaBrowser: async url => { expect(url).toBe(authUrl); if (++opened === 1) throw new Error("Fixture regular browser launch failed"); }, attachDesign: (root, workspace, input, confirmed) => attachAssistantDesign(root, workspace, input, confirmed, { prepareSource: async (source, artifact, options) => { const bundlePath = join(root, `hosted-${crypto.randomUUID()}.bundle`); await createLocalSourceBundle(repo, source.commit, bundlePath); return prepareRepositoryArtifactSource({ ...source, bundlePath }, artifact, options); } }) }); servers.push(console);
    const operator = new URL(console.url).hash.slice("#token=".length), capability = await issueAssistantCapability(controller, new Date(Date.now() + 60000).toISOString());
    const post = (action: string, body: unknown, token = operator) => fetch(console.origin + "/api/design/" + action, { method: "POST", headers: { origin: console.origin, authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { root, repo, controller, workspace, service, console, capability, post, counts: () => ({ imports, opened }) };
}

test("Figma launcher validates route and uses fixed argv without an embedded WebView or shell", async () => {
    const calls: string[][] = [];
    await openFigmaAuthorizationInBrowser(authUrl, { platform: "darwin", run: async argv => { calls.push(argv); return 0; } });
    expect(calls).toEqual([["/usr/bin/open", authUrl]]);
    for (const url of [authUrl.replace("www.figma.com", "evil.example.org"), authUrl + "&token=secret", "http://www.figma.com/oauth", "file:///tmp/test"]) await expect(openFigmaAuthorizationInBrowser(url, { run: async () => { throw new Error("Must not launch"); } })).rejects.toThrow();
    await expect(openFigmaAuthorizationInBrowser(authUrl, { platform: "other" })).rejects.toThrow("no supported");
    await expect(openFigmaAuthorizationInBrowser(authUrl, { platform: "linux", run: async () => 1 })).rejects.toThrow("regular browser");
    const html = withFigmaCard("<main></main></body>", "fixtureNonce"), script = /<script nonce="fixtureNonce">([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(() => new Function(script)).not.toThrow(); expect(html).not.toContain("innerHTML"); expect(html).not.toContain("target = new URL"); expect(html).not.toContain("localStorage");
});

test("Figma HTTP actions require operator session, not assistant authority; no token or sign-in URL response", async () => {
    const f = await fixture();
    expect((await fetch(f.console.origin + "/api/design")).status).toBe(401);
    for (const action of ["connect", "poll", "disconnect", "preview", "confirm", "attach"]) expect((await f.post(action, {}, f.capability.token)).status).toBe(401);
    expect((await f.post("connect", { token: "forbidden" })).status).toBe(409); expect(f.counts().opened).toBe(0);
    expect((await f.post("connect", {})).status).toBe(409);
    const response = await f.post("connect", {}); expect(response.status).toBe(200); const text = await response.text(); expect(text).toContain("browser-opened"); expect(text).not.toContain(authUrl); expect(text).not.toContain("authorizationUrl");
    expect(await f.service.list()).toEqual([]); expect(f.counts().imports).toBe(0);
});

test("real browser connects, recovers from refusal and failed display, retains exact references and attaches real Git source", async () => {
    const f = await fixture();
    const browser = await chromium.launch({ headless: true, env: Object.fromEntries(["PATH", "HOME", "TMPDIR", "SystemRoot"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])) }); browsers.push(browser);
    const context = await browser.newContext(), page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", route => { const url = new URL(route.request().url()); return url.protocol === "http:" && url.hostname === "127.0.0.1" ? route.continue() : route.abort(); });
    await page.goto(f.console.url); await page.getByText("Start with your coding app. Ask it to put your request through Wringer; your proposed work will appear here.", { exact: true }).waitFor();
    await page.locator("#figma-panel > summary").click(); await page.getByRole("button", { name: "Connect Figma", exact: true }).click();
    await page.getByText(/Fixture regular browser launch failed/).waitFor(); expect(await page.getByRole("button", { name: "Connect Figma", exact: true }).isEnabled()).toBe(true);
    await page.getByRole("button", { name: "Connect Figma", exact: true }).click(); await page.getByRole("button", { name: "Check Figma connection", exact: true }).click(); await page.getByRole("button", { name: "Disconnect Figma", exact: true }).waitFor();
    await page.getByLabel("Desktop Figma frame or layer link", { exact: true }).fill("https://www.figma.com/design/ReportsFixture/Reports"); await page.getByRole("button", { name: "Prepare these references", exact: true }).click();
    await page.getByText(/Use an HTTPS Figma design/).waitFor(); expect(await page.getByRole("button", { name: "Prepare these references", exact: true }).isEnabled()).toBe(true);
    await page.getByLabel("Desktop Figma frame or layer link", { exact: true }).fill(urls[0]!); await page.getByLabel("Mobile frame or layer link (optional)", { exact: true }).fill(urls[1]!); await page.getByRole("button", { name: "Prepare these references", exact: true }).click();
    for (const url of ["https://www.figma.com/design/ReportsFixture?node-id=1-2", "https://www.figma.com/design/ReportsFixture?node-id=3-4"]) await page.getByText(url, { exact: true }).waitFor();
    expect(f.counts().imports).toBe(0);
    const prepared = (await f.service.design.inspect()).imports[0]!;
    const modelView: any = await f.service.call(f.capability.token, "wringer.get_design_import", { importId: prepared.importId });
    expect(modelView.design.urls).toBeUndefined(); expect(JSON.stringify(modelView)).not.toContain("https://www.figma.com/design/ReportsFixture");
    let failImages = true;
    await page.route("**/api/design/asset?**", route => failImages ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" }) : route.continue());
    await page.getByRole("button", { name: "Preview these frames privately", exact: true }).click(); await page.getByText(/Reference display failed/).first().waitFor(); expect(await page.getByRole("button", { name: "Keep these references", exact: true }).isDisabled()).toBe(true);
    expect((await f.service.design.inspect()).imports[0]!.outcome).toBe("needs-retention-permission");
    failImages = false; await page.getByRole("button", { name: "Refresh design connection", exact: true }).click(); await page.waitForFunction(() => { const button = Array.from(document.querySelectorAll("button")).find(row => row.textContent === "Keep these references"); return button && !button.disabled; });
    expect(await page.locator("#figma-content img").count()).toBe(2); await page.locator("#figma-content").getByLabel("Your name", { exact: true }).fill("Scripted browser operator — not a PM blind result"); await page.getByRole("checkbox", { name: /permission to retain these exact/ }).check(); await page.getByRole("button", { name: "Keep these references", exact: true }).click();
    await page.getByRole("button", { name: "Use these references for new work", exact: true }).click(); await page.getByText(/exact reference is attached to a new immutable source profile/).waitFor();
    const view = (await f.service.design.inspect()).imports[0]!; expect(view.outcome).toBe("attached"); expect(view.attachment!.sourceCommit).not.toBe(f.workspace.profile.repository.commit);
    expect(await git(f.repo, "rev-parse", "HEAD")).toBe(f.workspace.profile.repository.commit); expect(await git(f.repo, "status", "--porcelain")).toBe("");
    const retained = await f.service.design.confirmedSnapshot(view.importId); expect((await readDesignSnapshot(retained.path)).disclosure).toBe("repository-permitted");
    expect(await f.service.list()).toEqual([]); expect(f.counts()).toEqual({ imports: 1, opened: 2 }); expect(errors).toEqual([]);
}, 30000);
