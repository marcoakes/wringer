import { boundedJson, equal, FigmaConnectionError, hash, httpsOrigin, isSecret, isToken, parseTokens, requestJson, secret, type FigmaTokens, type FigmaTransport } from "./shared";

export interface FigmaOAuthBrokerOptions {
  clientId: string;
  clientSecret: string;
  publicUrl: string;
  redirectUri: string;
  allowedOrigin?: string;
  /** Test seam, not configurable from an HTTP request. */
  testTransport?: FigmaTransport;
  now?: () => number;
  maxTransactions?: number;
  /** Coarse per-process backstop; the TLS ingress must also apply per-client rate limits. */
  maxRequestsPerMinute?: number;
}
interface Transaction {
  challenge: string; state: string; pkce: string; expiresAt: number;
  status: "waiting" | "exchanging" | "ready" | "failed";
  tokens?: FigmaTokens;
}
const TTL = 10 * 60_000;
const HEADERS = {
  "Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};
const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, "Content-Type": "application/json" } });
const page = (status: number, message: string) => new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Wringer — Connect Figma</title><h1>${message}</h1><p>Return to Wringer. You can close this browser tab.</p></html>`, { status, headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" } });

/** Single-instance OAuth broker. In-flight grants deliberately expire on restart; it never stores long-lived tokens. */
export function createFigmaOAuthBroker(options: FigmaOAuthBrokerOptions): (request: Request) => Promise<Response> {
  const publicUrl = httpsOrigin(options.publicUrl);
  const redirect = new URL(options.redirectUri);
  if (redirect.origin !== publicUrl || redirect.pathname !== "/oauth/figma/callback" || redirect.search || redirect.hash || redirect.username || redirect.password) {
    throw new FigmaConnectionError("Register the broker's exact HTTPS /oauth/figma/callback URL with Figma.");
  }
  if (!isToken(options.clientId) || !isToken(options.clientSecret) || options.clientId.includes(":")) throw new FigmaConnectionError("The Figma broker needs its registered app credentials in server-only configuration.");
  const allowedOrigin = options.allowedOrigin ? httpsOrigin(options.allowedOrigin) : publicUrl;
  const now = options.now ?? Date.now;
  const transport = options.testTransport ?? ((url, init) => fetch(url, init));
  const transactions = new Map<string, Transaction>();
  const stateHandles = new Map<string, string>();
  const remove = (handle: string, tx: Transaction) => { transactions.delete(handle); stateHandles.delete(tx.state); };
  const basic = `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`;
  const maxTransactions = options.maxTransactions ?? 1000;
  if (!Number.isInteger(maxTransactions) || maxTransactions < 1 || maxTransactions > 10_000) throw new FigmaConnectionError("Figma broker transaction limit is invalid.");
  const maxRequestsPerMinute = options.maxRequestsPerMinute ?? 600;
  if (!Number.isInteger(maxRequestsPerMinute) || maxRequestsPerMinute < 1 || maxRequestsPerMinute > 10_000) throw new FigmaConnectionError("Figma broker request limit is invalid.");
  let windowStart = now(); let requestsInWindow = 0;
  return async request => {
    try {
      for (const [handle, tx] of transactions) if (tx.expiresAt <= now()) remove(handle, tx);
      const url = new URL(request.url);
      if (url.origin !== publicUrl) return json(400, { error: "wrong-broker-origin" });
      if (request.method === "GET" && url.pathname === "/health" && !url.search) return json(200, { service: "wringer-figma-oauth", configured: true });
      if (now() - windowStart >= 60_000) { windowStart = now(); requestsInWindow = 0; }
      if (++requestsInWindow > maxRequestsPerMinute) return json(429, { error: "connection-rate-limit" });
      if (request.method === "GET" && url.pathname === redirect.pathname) {
        const states = url.searchParams.getAll("state"); const codes = url.searchParams.getAll("code");
        const state = states[0]; const handle = state ? stateHandles.get(state) : undefined;
        const tx = handle ? transactions.get(handle) : undefined;
        if (states.length !== 1 || !state || !tx || !handle || !equal(state, tx.state) || tx.status !== "waiting") return page(400, "This connection is invalid or has expired.");
        tx.status = "exchanging";
        if (url.searchParams.has("error") || codes.length !== 1 || !codes[0] || codes[0].length > 4096 || /[\x00-\x1f]/.test(codes[0])) {
          tx.status = "failed"; return page(400, "Figma was not connected.");
        }
        try {
          const result = await requestJson(transport, "https://api.figma.com/v1/oauth/token", new URLSearchParams({ redirect_uri: redirect.href, code: codes[0], grant_type: "authorization_code", code_verifier: tx.pkce }), { Authorization: basic });
          if (result.status !== 200 || tx.expiresAt <= now()) throw new Error();
          tx.tokens = parseTokens(result.body, now()); tx.status = "ready";
          return page(200, "Figma authorised. Return to Wringer to finish connecting.");
        } catch { tx.status = "failed"; return page(400, "Figma could not finish connecting. Start again in Wringer."); }
      }
      if (request.method !== "POST" || url.search || url.hash) return json(404, { error: "not-found" });
      const origin = request.headers.get("origin");
      if ((origin !== null && origin !== allowedOrigin) || request.headers.get("sec-fetch-site") === "cross-site") return json(403, { error: "origin-not-allowed" });
      if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return json(415, { error: "json-required" });
      const body = await boundedJson(request);
      if (url.pathname === "/v1/connect") {
        if (Object.keys(body).length !== 1 || !isSecret(body.challenge)) return json(400, { error: "invalid-proof-challenge" });
        if (transactions.size >= maxTransactions) return json(429, { error: "connection-capacity-reached" });
        const handle = secret(); const state = secret(); const pkce = secret(); const expiresAt = now() + TTL;
        transactions.set(handle, { challenge: body.challenge, state, pkce, expiresAt, status: "waiting" }); stateHandles.set(state, handle);
        const authorization = new URL("https://www.figma.com/oauth");
        for (const [key, value] of Object.entries({ client_id: options.clientId, redirect_uri: redirect.href, scope: "file_content:read", state, response_type: "code", code_challenge: hash(pkce), code_challenge_method: "S256" })) authorization.searchParams.set(key, value);
        return json(200, { handle, authorizationUrl: authorization.href, expiresAt });
      }
      if (url.pathname === "/v1/take") {
        if (Object.keys(body).length !== 2 || !isSecret(body.handle) || !isSecret(body.verifier)) return json(400, { error: "invalid-connection-proof" });
        const tx = transactions.get(body.handle);
        if (!tx || !equal(hash(body.verifier), tx.challenge)) return json(410, { error: "connection-unavailable" });
        if (tx.status === "waiting" || tx.status === "exchanging") return json(202, { pending: true });
        remove(body.handle, tx);
        if (tx.status !== "ready" || !tx.tokens) return json(410, { error: "connect-again" });
        return json(200, { tokens: tx.tokens });
      }
      if (url.pathname === "/v1/refresh") {
        if (Object.keys(body).length !== 1 || !isToken(body.refreshToken)) return json(400, { error: "invalid-refresh" });
        const result = await requestJson(transport, "https://api.figma.com/v1/oauth/refresh", new URLSearchParams({ refresh_token: body.refreshToken }), { Authorization: basic });
        if (result.status !== 200) return json(result.status === 429 ? 429 : result.status >= 500 ? 503 : 401, { error: "refresh-unavailable" });
        return json(200, { tokens: parseTokens(result.body, now(), body.refreshToken) });
      }
      return json(404, { error: "not-found" });
    } catch { return json(400, { error: "connection-request-could-not-be-completed" }); }
  };
}

export function figmaOAuthBrokerFromEnvironment(env: Record<string, string | undefined> = process.env): (request: Request) => Promise<Response> {
  const values = [env.WRINGER_FIGMA_CLIENT_ID, env.WRINGER_FIGMA_CLIENT_SECRET, env.WRINGER_FIGMA_BROKER_URL, env.WRINGER_FIGMA_REDIRECT_URI];
  if (values.some(value => !value)) throw new FigmaConnectionError("Figma broker needs WRINGER_FIGMA_CLIENT_ID, WRINGER_FIGMA_CLIENT_SECRET, WRINGER_FIGMA_BROKER_URL and WRINGER_FIGMA_REDIRECT_URI in server-only configuration.");
  return createFigmaOAuthBroker({ clientId: values[0]!, clientSecret: values[1]!, publicUrl: values[2]!, redirectUri: values[3]!, allowedOrigin: env.WRINGER_FIGMA_ALLOWED_ORIGIN });
}
