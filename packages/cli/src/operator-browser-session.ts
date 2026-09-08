import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const OPERATOR_BROWSER_SESSION_SECONDS = 8 * 60 * 60;
export const OPERATOR_BROWSER_SESSION_LIMIT = "Browser access lasts up to eight hours for this running owner. Lock this page on a shared browser. Loopback cookies are not an OS-user or port isolation boundary; cooperative-local trust still applies.";
type Authentication = { mode: "bearer" | "session"; session?: string };

/** A fragment is exchanged once, not saved in JavaScript storage. This is
 * browser continuity under the existing cooperative-local trust model, never
 * human-presence proof or protection from another local process. HTTP cookies
 * have no port boundary; each owner gets an unguessable, distinct cookie name.
 * Cookie-authenticated requests additionally need the same-origin custom header
 * and origin/fetch metadata. Browser cross-origin scripts cannot send these
 * without a preflight, which the servers do not authorize. */
export function createOperatorBrowserSessions(bearer: string, headers: Record<string, string>, options: { now?: () => number; ttlSeconds?: number; maxSessions?: number } = {}) {
    const now = options.now ?? Date.now, ttl = options.ttlSeconds ?? OPERATOR_BROWSER_SESSION_SECONDS, maximum = options.maxSessions ?? 32;
    if (!/^[a-f0-9]{64}$/.test(bearer) || !Number.isInteger(ttl) || ttl < 1 || ttl > OPERATOR_BROWSER_SESSION_SECONDS || !Number.isInteger(maximum) || maximum < 1 || maximum > 32) throw new Error("Invalid bounded operator browser session policy");
    const cookieName = `wringer_operator_${randomBytes(16).toString("hex")}`, expected = Buffer.from(`Bearer ${bearer}`), sessions = new Map<string, number>();
    const digest = (token: string) => createHash("sha256").update(token).digest("hex");
    const json = (value: unknown, status: number, cookie?: string) => Response.json(value, { status, headers: { ...headers, ...(cookie ? { "Set-Cookie": cookie } : {}) } });
    const cookie = (value: string, seconds: number) => `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${seconds}`;
    const prune = () => { for (const [key, expiry] of sessions) if (now() >= expiry) sessions.delete(key); };
    function sessionKey(request: Request): string | undefined {
        const raw = request.headers.get("cookie") ?? "";
        if (raw.length > 8192) return;
        const values = raw.split(";").map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
        if (values.length !== 1) return;
        const value = values[0]!.slice(cookieName.length + 1);
        if (!/^[a-f0-9]{64}$/.test(value)) return;
        const key = digest(value); return sessions.has(key) ? key : undefined;
    }
    function authenticate(request: Request, origin: string): Authentication | Response {
        prune();
        let auth: Authentication;
        if (request.headers.has("authorization")) {
            const supplied = Buffer.from(request.headers.get("authorization") ?? "");
            if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json({ error: "This page is locked. Open the current private operator link once to unlock this browser; never use the assistant connection token." }, 401);
            auth = { mode: "bearer" };
        } else {
            const session = sessionKey(request);
            if (!session) return json({ error: "This page is locked or its browser access expired. Open the current private operator link once; refresh and reopen will then work while this owner is running." }, 401);
            if (request.headers.get("x-wringer-console") !== "1" || request.headers.get("origin") !== origin && request.headers.get("sec-fetch-site") !== "same-origin") return json({ error: "Browser session access needs a same-origin request from this page" }, 403);
            auth = { mode: "session", session };
        }
        const requestOrigin = request.headers.get("origin");
        if (requestOrigin && requestOrigin !== origin || request.method !== "GET" && requestOrigin !== origin || request.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Cross-origin operator access is not allowed" }, 403);
        return auth;
    }
    async function handle(request: Request, origin: string): Promise<Response | null> {
        const url = new URL(request.url);
        if (request.method !== "POST" || url.search || !["/api/session", "/api/logout"].includes(url.pathname)) return null;
        const auth = authenticate(request, origin); if (auth instanceof Response) return auth;
        if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return json({ error: "Use an explicit JSON browser-session request" }, 415);
        if (request.headers.get("x-wringer-console") !== "1") return json({ error: "Use the same-origin browser session exchange" }, 403);
        if ((await request.text()).trim() !== "{}") return json({ error: "Browser-session requests take no decision or authority fields" }, 400);
        if (url.pathname === "/api/logout") {
            if (auth.session) sessions.delete(auth.session);
            else { const key = sessionKey(request); if (key) sessions.delete(key); }
            return json({ outcome: "locked", note: "Only this browser session was locked. Work, approvals, spending reservations and evidence were not changed." }, 200, cookie("", 0));
        }
        if (auth.mode !== "bearer") return json({ error: "Only the private operator link can establish browser access. An existing session cannot extend its own lifetime." }, 403);
        const existing = sessionKey(request);
        if (existing) return json({ outcome: "connected", expiresAt: new Date(sessions.get(existing)!).toISOString(), limitation: OPERATOR_BROWSER_SESSION_LIMIT }, 200);
        if (sessions.size >= maximum) return json({ error: "The bounded browser-session limit has been reached. Lock an existing browser session or wait for it to expire; no session or approval was replaced." }, 409);
        const value = randomBytes(32).toString("hex"), expiresAt = now() + ttl * 1000;
        sessions.set(digest(value), expiresAt);
        return json({ outcome: "connected", expiresAt: new Date(expiresAt).toISOString(), limitation: OPERATOR_BROWSER_SESSION_LIMIT }, 200, cookie(value, ttl));
    }
    return { authenticate, handle, clear: () => sessions.clear() };
}
