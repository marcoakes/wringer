import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FigmaConnectionService, MacOSKeychainFigmaVault, PrivateFileFigmaVault, createFigmaOAuthBroker, figmaOAuthBrokerFromEnvironment, type FigmaSecretVault, type FigmaTransport } from "../src";
import { hash, secret } from "../src/shared";
import { figmaBrokerServerOptions } from "../src/serve";

const ORIGIN = "https://connect.wringer.example";
const CALLBACK = `${ORIGIN}/oauth/figma/callback`;
const ACCESS = "fixture-access-token-never-public";
const REFRESH = "fixture-refresh-token-never-public";
const CLIENT_SECRET = "fixture-server-secret-never-public";
class MemoryVault implements FigmaSecretVault {
  values = new Map<string, string>();
  async get(key: string) { return this.values.get(key); }
  async set(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
}
function fixture(options: { maxTransactions?: number; transport?: FigmaTransport } = {}) {
  let clock = Date.UTC(2026, 8, 9);
  const providerCalls: { url: string; init: RequestInit }[] = [];
  const broker = createFigmaOAuthBroker({ clientId: "fixture-client", clientSecret: CLIENT_SECRET, publicUrl: ORIGIN, redirectUri: CALLBACK, now: () => clock, maxTransactions: options.maxTransactions,
    testTransport: async (url, init) => {
      providerCalls.push({ url, init });
      if (options.transport) return options.transport(url, init);
      return Response.json(url.endsWith("/refresh") ? { access_token: "fixture-renewed-token", token_type: "bearer", expires_in: 3600 } : { access_token: ACCESS, refresh_token: REFRESH, token_type: "bearer", expires_in: 3600 });
    },
  });
  const vault = new MemoryVault();
  const local = (url: string, init: RequestInit) => broker(new Request(url, init));
  const service = new FigmaConnectionService({ brokerUrl: ORIGIN, vault, testTransport: local, now: () => clock });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => broker(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const authorise = async (authorizationUrl: string, code = "fixture-code") => {
    const state = new URL(authorizationUrl).searchParams.get("state");
    return broker(new Request(`${CALLBACK}?state=${state}&code=${code}`));
  };
  return { service, vault, broker, post, local, providerCalls, authorise, advance: (ms: number) => { clock += ms; }, now: () => clock };
}

describe("bounded Figma OAuth broker", () => {
  test("state, PKCE, server Basic auth, one-time delivery and safe browser callback", async () => {
    const f = fixture();
    expect((await f.service.status()).state).toBe("needs-connection");
    const begun = await f.service.begin();
    const authorization = new URL(begun.authorizationUrl);
    expect(authorization.origin).toBe("https://www.figma.com");
    expect(authorization.searchParams.get("scope")).toBe("file_content:read");
    expect((await f.service.poll()).state).toBe("connecting");
    const callback = await f.authorise(begun.authorizationUrl);
    expect(callback.status).toBe(200);
    const page = await callback.text();
    for (const value of [ACCESS, REFRESH, CLIENT_SECRET, authorization.searchParams.get("state")!]) expect(page).not.toContain(value);
    expect(callback.headers.get("referrer-policy")).toBe("no-referrer");
    expect(callback.headers.get("cache-control")).toBe("no-store");
    const call = f.providerCalls[0]!;
    expect(call.url).toBe("https://api.figma.com/v1/oauth/token");
    expect(call.init.redirect).toBe("error");
    expect(new Headers(call.init.headers).get("authorization")).toBe(`Basic ${Buffer.from(`fixture-client:${CLIENT_SECRET}`).toString("base64")}`);
    const body = new URLSearchParams(call.init.body as string);
    expect(body.get("redirect_uri")).toBe(CALLBACK);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(hash(body.get("code_verifier")!)).toBe(authorization.searchParams.get("code_challenge")!);
    expect(body.has("client_secret")).toBe(false);
    const pending = JSON.parse([...f.vault.values.entries()].find(([key]) => key.endsWith("-pending"))![1]);
    expect((await f.service.complete()).state).toBe("connected");
    expect(await f.service.withAccessToken(async token => token === ACCESS)).toBe(true);
    expect((await f.post("/v1/take", { handle: pending.handle, verifier: pending.verifier })).status).toBe(410);
    expect((await f.authorise(begun.authorizationUrl)).status).toBe(400);
    expect(f.providerCalls.length).toBe(1);
    const safe = JSON.stringify({ status: await f.service.status(), service: f.service });
    for (const value of [ACCESS, REFRESH, CLIENT_SECRET, pending.handle, pending.verifier, "authorizationUrl"]) expect(safe).not.toContain(value);
  });
  test("forged state, duplicate state, missing state and missing code never spend an exchange", async () => {
    const f = fixture(); const begin = await f.service.begin();
    const state = new URL(begin.authorizationUrl).searchParams.get("state")!;
    for (const query of ["code=x", `state=${secret()}&code=x`, `state=${state}&state=${state}&code=x`]) {
      expect((await f.broker(new Request(`${CALLBACK}?${query}`))).status).toBe(400);
    }
    expect(f.providerCalls.length).toBe(0);
    expect((await f.broker(new Request(`${CALLBACK}?state=${state}`))).status).toBe(400);
    expect((await f.service.complete()).state).toBe("reconnect-required");
  });
  test("a stolen handle cannot take credentials without the local verifier", async () => {
    const f = fixture(); const begin = await f.service.begin(); await f.authorise(begin.authorizationUrl);
    const pending = JSON.parse([...f.vault.values.values()][0]!);
    expect((await f.post("/v1/take", { handle: pending.handle, verifier: secret() })).status).toBe(410);
    expect((await f.service.complete()).state).toBe("connected");
  });
  test("expiry and broker restart fail closed", async () => {
    const f = fixture(); const begin = await f.service.begin(); f.advance(600_001);
    expect((await f.authorise(begin.authorizationUrl)).status).toBe(400);
    expect((await f.service.complete()).state).toBe("reconnect-required");
    expect(f.providerCalls.length).toBe(0);
    const a = fixture(); const first = await a.service.begin();
    const replacement = fixture();
    const state = new URL(first.authorizationUrl).searchParams.get("state");
    expect((await replacement.broker(new Request(`${CALLBACK}?state=${state}&code=x`))).status).toBe(400);
  });
  test("bounded transaction capacity is released by expiry", async () => {
    const f = fixture({ maxTransactions: 1 });
    expect((await f.post("/v1/connect", { challenge: hash(secret()) })).status).toBe(200);
    expect((await f.post("/v1/connect", { challenge: hash(secret()) })).status).toBe(429);
    f.advance(600_001);
    expect((await f.post("/v1/connect", { challenge: hash(secret()) })).status).toBe(200);
  });
  test("only fixed provider endpoints; cross-site requests, endpoint injection and redirected responses refused", async () => {
    const f = fixture();
    expect((await f.post("/v1/connect", { challenge: hash(secret()) }, { Origin: "https://attacker.example" })).status).toBe(403);
    expect((await f.post("/v1/connect", { challenge: hash(secret()) }, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect((await f.post("/v1/connect", { challenge: hash(secret()), endpoint: "http://127.0.0.1" })).status).toBe(400);
    expect((await f.post("/proxy", { endpoint: "http://127.0.0.1" })).status).toBe(404);
    expect((await f.broker(new Request("https://attacker.example/health"))).status).toBe(400);
    expect((await f.broker(new Request(`${ORIGIN}/v1/connect`, { method: "POST", body: "{}" }))).status).toBe(415);
    const redirected = fixture({ transport: async () => new Response(null, { status: 302, headers: { Location: "https://attacker.example" } }) });
    const begin = await redirected.service.begin();
    expect((await redirected.authorise(begin.authorizationUrl)).status).toBe(400);
    expect((await redirected.service.complete()).state).toBe("reconnect-required");
    expect(redirected.providerCalls.length).toBe(1);
  });
  test("bounded body and secret-bearing provider failures produce only fixed error messages", async () => {
    const f = fixture({ transport: async () => { throw new Error(`provider-error ${ACCESS} ${CLIENT_SECRET}`); } });
    expect((await f.post("/v1/connect", { challenge: "x".repeat(100_000) })).status).toBe(400);
    const begun = await f.service.begin();
    const response = await f.authorise(begun.authorizationUrl, "code-with-secret");
    expect(response.status).toBe(400);
    const text = await response.text();
    for (const value of [ACCESS, CLIENT_SECRET, "code-with-secret"]) expect(text).not.toContain(value);
  });
  test("provider must supply complete bearer credentials, not a shape-only success", async () => {
    const f = fixture({ transport: async () => Response.json({ access_token: ACCESS, expires_in: 3600 }) });
    const begin = await f.service.begin();
    expect((await f.authorise(begin.authorizationUrl)).status).toBe(400);
    expect((await f.service.complete()).state).toBe("reconnect-required");
  });
  test("simultaneous callbacks exchange a grant once", async () => {
    const f = fixture(); const begin = await f.service.begin();
    const responses = await Promise.all([f.authorise(begin.authorizationUrl), f.authorise(begin.authorizationUrl)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
    expect(f.providerCalls.length).toBe(1);
  });
  test("configuration requires public HTTPS, exact registered callback and server credentials", () => {
    for (const publicUrl of ["http://connect.example", "https://127.0.0.1", "https://[::1]", "https://localhost", "https://localhost.", "https://service.local", "https://service.internal", "https://intranet", "https://connect.example/path", "https://user:secret@connect.example", "https://connect.example?token=secret"]) {
      expect(() => new FigmaConnectionService({ brokerUrl: publicUrl })).toThrow("HTTPS");
    }
    expect(() => createFigmaOAuthBroker({ publicUrl: ORIGIN, redirectUri: "https://attacker.example/callback", clientId: "client", clientSecret: "secret" })).toThrow("exact HTTPS");
    expect(() => figmaOAuthBrokerFromEnvironment({})).toThrow("server-only configuration");
  });
  test("public refresh route has a coarse request budget without echoing supplied tokens", async () => {
    let now = 1000;
    const broker = createFigmaOAuthBroker({ clientId: "fixture-client", clientSecret: CLIENT_SECRET, publicUrl: ORIGIN, redirectUri: CALLBACK, maxRequestsPerMinute: 1, now: () => now, testTransport: async () => new Response("refused", { status: 401 }) });
    const refresh = () => broker(new Request(`${ORIGIN}/v1/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: REFRESH }) }));
    expect((await refresh()).status).toBe(401);
    const limited = await refresh(); expect(limited.status).toBe(429); expect(await limited.text()).not.toContain(REFRESH);
    now += 60_000; expect((await refresh()).status).toBe(401);
  });
});

describe("operator-side connection lifecycle", () => {
  test("unconfigured is honest and does not read credentials or call the network", async () => {
    const vault: FigmaSecretVault = { get: async () => { throw new Error("must not read"); }, set: async () => { throw new Error(); }, delete: async () => { throw new Error(); } };
    const service = new FigmaConnectionService({ brokerUrl: "", vault, testTransport: async () => { throw new Error("must not call"); } });
    expect((await service.status()).state).toBe("unconfigured");
    await expect(service.begin()).rejects.toThrow("administrator");
  });
  test("refresh preserves refresh token, rotates access, and concurrent callers share renewal", async () => {
    const f = fixture(); const begin = await f.service.begin(); await f.authorise(begin.authorizationUrl); await f.service.complete();
    f.advance(3_599_000);
    expect(await Promise.all([f.service.withAccessToken(async t => t), f.service.withAccessToken(async t => t)])).toEqual(["fixture-renewed-token", "fixture-renewed-token"]);
    expect(f.providerCalls.filter(c => c.url.endsWith("/refresh")).length).toBe(1);
    const call = f.providerCalls[1]!;
    expect(new URLSearchParams(call.init.body as string).get("refresh_token")).toBe(REFRESH);
    expect([...f.vault.values.values()].some(value => value.includes(REFRESH))).toBe(true);
    expect((await f.service.disconnect()).state).toBe("needs-connection");
    expect(f.vault.values.size).toBe(0);
    await expect(f.service.withAccessToken(async t => t)).rejects.toThrow("Connect Figma");
  });
  test("refresh refusal removes credentials and asks to reconnect", async () => {
    const f = fixture({ transport: async url => url.endsWith("/refresh") ? new Response(ACCESS, { status: 401 }) : Response.json({ access_token: ACCESS, refresh_token: REFRESH, token_type: "bearer", expires_in: 1 }) });
    const begin = await f.service.begin(); await f.authorise(begin.authorizationUrl); await f.service.complete();
    await expect(f.service.withAccessToken(async t => t)).rejects.toThrow("revoked");
    expect((await f.service.status()).state).toBe("reconnect-required");
    expect(JSON.stringify([...f.vault.values])).not.toContain(REFRESH);
  });
  test("transient renewal failures retain the connection", async () => {
    const f = fixture({ transport: async url => url.endsWith("/refresh") ? new Response("temporary", { status: 429 }) : Response.json({ access_token: ACCESS, refresh_token: REFRESH, token_type: "bearer", expires_in: 1 }) });
    const begin = await f.service.begin(); await f.authorise(begin.authorizationUrl); await f.service.complete();
    await expect(f.service.withAccessToken(async t => t)).rejects.toThrow("temporarily unavailable");
    expect((await f.service.status()).state).toBe("connected");
    expect(JSON.stringify([...f.vault.values])).toContain(REFRESH);
  });
  test("read refusal is explicit; no unparseable credential text is exposed", async () => {
    const f = fixture();
    const slot = `figma-${hash(ORIGIN)}`;
    await f.vault.set(slot, `not-json ${ACCESS}`);
    const result = await f.service.status();
    expect(result.state).toBe("reconnect-required");
    expect(JSON.stringify(result)).not.toContain(ACCESS);
    await f.service.disconnect();
    expect((await f.service.status()).state).toBe("needs-connection");
  });
  test("broker identity binds a saved credential; changing brokers does not export it", async () => {
    const f = fixture(); const begin = await f.service.begin(); await f.authorise(begin.authorizationUrl); await f.service.complete();
    const other = new FigmaConnectionService({ brokerUrl: "https://different.example", vault: f.vault, testTransport: async () => { throw new Error("must not send"); } });
    expect((await other.status()).state).toBe("needs-connection");
    await expect(other.withAccessToken(async t => t)).rejects.toThrow("Connect Figma");
  });
  test("a broker cannot hand the operator a hostile or over-scoped authorization URL", async () => {
    const f = fixture();
    for (const mutate of [(url: URL) => { url.hostname = "attacker.example"; }, (url: URL) => { url.searchParams.set("scope", "file_comments:write"); }, (url: URL) => { url.searchParams.set("redirect_uri", "https://attacker.example"); }]) {
      const service = new FigmaConnectionService({ brokerUrl: ORIGIN, vault: new MemoryVault(), now: f.now, testTransport: async (url, init) => {
        const data = await (await f.local(url, init)).json() as Record<string, unknown>;
        const authorization = new URL(data.authorizationUrl as string); mutate(authorization);
        return Response.json({ ...data, authorizationUrl: authorization.href });
      } });
      await expect(service.begin()).rejects.toThrow("unsafe or over-scoped");
    }
  });
  test("simultaneous finish clicks cannot consume and then erase a successful connection", async () => {
    const f = fixture(); const begin = await f.service.begin(); await f.authorise(begin.authorizationUrl);
    expect((await Promise.all([f.service.complete(), f.service.complete()])).map(s => s.state)).toEqual(["connected", "connected"]);
    expect((await f.service.status()).state).toBe("connected");
  });
  test("disconnect during a delayed renewal cannot resurrect credentials or start an import", async () => {
    let release!: () => void; let entered!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const f = fixture({ transport: async url => {
      if (url.endsWith("/refresh")) { entered(); await barrier; return Response.json({ access_token: "renewed", token_type: "bearer", expires_in: 3600 }); }
      return Response.json({ access_token: ACCESS, refresh_token: REFRESH, token_type: "bearer", expires_in: 1 });
    } });
    const begin = await f.service.begin(); await f.authorise(begin.authorizationUrl); await f.service.complete();
    let imported = false;
    const importing = f.service.withAccessToken(async () => { imported = true; });
    const rejection = importing.then(() => "unexpected-success", error => String(error));
    await started;
    const disconnected = f.service.disconnect(); release(); expect(await rejection).toContain("disconnected or changed");
    expect((await disconnected).state).toBe("needs-connection");
    expect(imported).toBe(false); expect(f.vault.values.size).toBe(0);
  });
});

describe("deployable broker entry point", () => {
  const env = { WRINGER_FIGMA_CLIENT_ID: "fixture-client", WRINGER_FIGMA_CLIENT_SECRET: CLIENT_SECRET, WRINGER_FIGMA_BROKER_URL: ORIGIN, WRINGER_FIGMA_REDIRECT_URI: CALLBACK };
  test("loopback reverse proxy reconstructs only the administrator-configured origin", async () => {
    const options = figmaBrokerServerOptions(env);
    expect(options.hostname).toBe("127.0.0.1"); expect(options.port).toBe(8787); expect(options.maxRequestBodySize).toBe(24_576); expect(options.idleTimeout).toBe(20);
    const response = await options.fetch(new Request("http://127.0.0.1:8787/v1/connect", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-Host": "attacker.example", "X-Forwarded-Proto": "http" }, body: JSON.stringify({ challenge: hash(secret()) }) }));
    expect(response.status).toBe(200);
    const data = await response.json() as { authorizationUrl: string };
    expect(new URL(data.authorizationUrl).searchParams.get("redirect_uri")).toBe(CALLBACK);
    expect(JSON.stringify(data)).not.toContain("attacker");
    for (const port of ["0", "80", "65536", "1e4", "8787secret"]) expect(() => figmaBrokerServerOptions({ ...env, WRINGER_FIGMA_BROKER_PORT: port })).toThrow("port");
  });
  test("help works without configuration and missing server settings refuse without secrets", async () => {
    const path = join(import.meta.dir, "../src/serve.ts");
    const help = Bun.spawn([process.execPath, path, "--help"], { env: { PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" });
    const helpText = await new Response(help.stdout).text();
    expect(await help.exited).toBe(0); expect(helpText).toContain("server component"); expect(helpText).toContain("127.0.0.1");
    const missing = Bun.spawn([process.execPath, path], { env: { PATH: "/usr/bin:/bin", WRINGER_FIGMA_CLIENT_SECRET: CLIENT_SECRET }, stdout: "pipe", stderr: "pipe" });
    const failure = await new Response(missing.stderr).text();
    expect(await missing.exited).toBe(1); expect(failure).toContain("could not start"); expect(failure).not.toContain(CLIENT_SECRET);
  });
});

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
describe("private operator credential storage", () => {
  test("private files are user-only, atomic, outside repositories and removed on disconnect", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wringer-figma-vault-test-")); directories.push(directory);
    const vault = new PrivateFileFigmaVault(join(directory, "operator"));
    await vault.set("slot", ACCESS);
    expect(await vault.get("slot")).toBe(ACCESS);
    expect((await stat(join(directory, "operator"))).mode & 0o077).toBe(0);
    expect((await stat(join(directory, "operator", "slot.json"))).mode & 0o077).toBe(0);
    await vault.set("slot", REFRESH); expect(await vault.get("slot")).toBe(REFRESH);
    await vault.delete("slot"); expect(await vault.get("slot")).toBeUndefined();
    await mkdir(join(directory, "repo", ".git"), { recursive: true });
    await expect(new PrivateFileFigmaVault(join(directory, "repo", "secrets")).set("slot", ACCESS)).rejects.toThrow("outside repositories");
  });
  test("symlinks, traversal and permissive credential files are refused", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wringer-figma-vault-test-")); directories.push(directory);
    const vault = new PrivateFileFigmaVault(join(directory, "operator"));
    await vault.set("slot", ACCESS);
    await expect(vault.get("../elsewhere")).rejects.toThrow("Invalid Figma credential slot");
    await chmod(join(directory, "operator", "slot.json"), 0o644);
    await expect(vault.get("slot")).rejects.toThrow("unsafe");
    await writeFile(join(directory, "target"), REFRESH);
    await symlink(join(directory, "target"), join(directory, "operator", "link.json"));
    await expect(vault.get("link")).rejects.toThrow("unsafe");
    await symlink(join(directory, "operator"), join(directory, "linked-operator"));
    await expect(new PrivateFileFigmaVault(join(directory, "linked-operator")).get("slot")).rejects.toThrow("unsafe");
    expect(await readFile(join(directory, "target"), "utf8")).toBe(REFRESH);
  });
  test("a FIFO cannot block credential inspection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wringer-figma-vault-test-")); directories.push(directory);
    const vault = new PrivateFileFigmaVault(join(directory, "operator"));
    await vault.set("slot", ACCESS);
    const child = Bun.spawn(["mkfifo", join(directory, "operator", "pipe.json")], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(0);
    await expect(vault.get("pipe")).rejects.toThrow("unsafe");
  });
  test("macOS Keychain writes secrets only on stdin, with a safe command alphabet", async () => {
    const stored = new Map<string, string>(); const calls: { args: readonly string[]; input?: string }[] = [];
    const vault = new MacOSKeychainFigmaVault(async (args, input) => {
      calls.push({ args, input });
      if (args[0] === "-i") {
        const parts = input!.trim().split(" "); stored.set(parts[parts.indexOf("-a") + 1]!, parts[parts.indexOf("-w") + 1]!);
        return { exitCode: 0, stdout: "" };
      }
      const key = args[args.indexOf("-a") + 1]!;
      if (args[0] === "delete-generic-password") { stored.delete(key); return { exitCode: 0, stdout: "" }; }
      return stored.has(key) ? { exitCode: 0, stdout: stored.get(key)! + "\n" } : { exitCode: 44, stdout: "" };
    });
    const value = JSON.stringify({ access: ACCESS, refresh: REFRESH, adversarial: "\n-w injected; $(secret)" });
    await vault.set("fixture-slot", value);
    expect(await vault.get("fixture-slot")).toBe(value);
    expect(calls[0]!.args).toEqual(["-i"]);
    for (const call of calls) { expect(JSON.stringify(call.args)).not.toContain(ACCESS); expect(JSON.stringify(call.args)).not.toContain(REFRESH); }
    expect(calls[0]!.input).toMatch(/^add-generic-password -U -s wringer-figma-oauth -a fixture-slot -w [A-Za-z0-9+/=]+\n$/);
    await vault.delete("fixture-slot"); expect(await vault.get("fixture-slot")).toBeUndefined();
  });
  test("keychain failures cannot echo credential-bearing tool output", async () => {
    const vault = new MacOSKeychainFigmaVault(async () => { throw new Error(ACCESS); });
    await expect(vault.set("fixture-slot", ACCESS)).rejects.toThrow("could not be saved");
    try { await vault.get("fixture-slot"); } catch (error) { expect(String(error)).not.toContain(ACCESS); }
  });
});
