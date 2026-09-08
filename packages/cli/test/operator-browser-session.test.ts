import { describe, expect, test } from "bun:test";
import { createOperatorBrowserSessions, OPERATOR_BROWSER_SESSION_SECONDS } from "../src/operator-browser-session";

const origin = "http://127.0.0.1:43123", token = "a".repeat(64), headers = { "Cache-Control": "no-store" };
const request = (path: string, options: { cookie?: string; bearer?: string; body?: unknown; extra?: Record<string, string>; method?: string } = {}) => new Request(origin + path, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: { origin, "x-wringer-console": "1", ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}), ...(options.body === undefined ? {} : { "content-type": "application/json" }), ...options.extra },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
});
async function unlock(sessions: ReturnType<typeof createOperatorBrowserSessions>, options: Parameters<typeof request>[1] = {}) {
    const response = await sessions.handle(request("/api/session", { bearer: token, body: {}, ...options }), origin);
    expect(response?.status).toBe(200);
    const cookie = response!.headers.get("set-cookie")?.split(";", 1)[0]; expect(cookie).toBeDefined();
    return { response: response!, cookie: cookie! };
}
describe("bounded owner-specific operator browser sessions", () => {
    test("fragment exchange yields a different HttpOnly strict cookie, never the private bearer", async () => {
        const sessions = createOperatorBrowserSessions(token, headers), { response, cookie } = await unlock(sessions), set = response.headers.get("set-cookie")!;
        expect(set).toContain("HttpOnly"); expect(set).toContain("SameSite=Strict"); expect(set).toContain("Path=/api"); expect(set).toContain(`Max-Age=${OPERATOR_BROWSER_SESSION_SECONDS}`); expect(set).not.toContain(token);
        expect(await response.text()).not.toContain(token); expect(response.headers.get("cache-control")).toBe("no-store");
        expect(sessions.authenticate(request("/api/jobs", { cookie }), origin)).toMatchObject({ mode: "session" });
        // A navigation/refresh starts a new JS context, not a new execution grant.
        expect(sessions.authenticate(request("/api/jobs", { cookie }), origin)).toMatchObject({ mode: "session" });
    });
    test("cookies need a same-origin custom request; foreign origins, forms and preflights gain no access", async () => {
        const sessions = createOperatorBrowserSessions(token, headers), { cookie } = await unlock(sessions);
        const headersToRefuse: Record<string, string>[] = [{ "x-wringer-console": "" }, { origin: "https://attacker.example" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }, { origin: "", "sec-fetch-site": "same-site" }];
        for (const extra of headersToRefuse) {
            const result = sessions.authenticate(request("/api/jobs", { cookie, extra }), origin); expect(result).toBeInstanceOf(Response); expect((result as Response).status).toBe(403);
        }
        expect(sessions.authenticate(request("/api/jobs", { cookie, extra: { origin: "", "sec-fetch-site": "same-origin" } }), origin)).toMatchObject({ mode: "session" });
        expect((await sessions.handle(request("/api/logout", { cookie, body: {}, extra: { origin: "" } }), origin))?.status).toBe(403);
        expect(await sessions.handle(request("/api/session", { method: "OPTIONS", extra: { origin: "https://attacker.example" } }), origin)).toBeNull();
        expect((await sessions.handle(request("/api/session", { bearer: token, body: { confirmExecution: true } }), origin))?.status).toBe(400);
    });
    test("an assistant/incorrect bearer cannot exchange, use, or fall back to an operator cookie", async () => {
        const sessions = createOperatorBrowserSessions(token, headers), { cookie } = await unlock(sessions);
        const wrong = "b".repeat(64);
        expect((await sessions.handle(request("/api/session", { bearer: wrong, body: {} }), origin))?.status).toBe(401);
        expect((sessions.authenticate(request("/api/jobs", { cookie, bearer: wrong }), origin) as Response).status).toBe(401);
        expect((sessions.authenticate(request("/api/jobs", { cookie: `token=${token}` }), origin) as Response).status).toBe(401);
        expect((sessions.authenticate(request("/api/jobs", { cookie: `${cookie}; ${cookie}` }), origin) as Response).status).toBe(401);
    });
    test("sessions expire without polling renewal and cannot extend their own lifetime", async () => {
        let now = 1000;
        const sessions = createOperatorBrowserSessions(token, headers, { now: () => now, ttlSeconds: 10 }), { cookie, response } = await unlock(sessions);
        expect((await response.json()).expiresAt).toBe(new Date(11000).toISOString());
        now = 10999; expect(sessions.authenticate(request("/api/jobs", { cookie }), origin)).toMatchObject({ mode: "session" });
        expect((await sessions.handle(request("/api/session", { cookie, body: {} }), origin))?.status).toBe(403);
        now = 11000; expect((sessions.authenticate(request("/api/jobs", { cookie }), origin) as Response).status).toBe(401);
    });
    test("session count is bounded, existing bearer exchange does not extend it, and lock revokes it", async () => {
        let now = 1000;
        const sessions = createOperatorBrowserSessions(token, headers, { now: () => now, ttlSeconds: 10, maxSessions: 1 }), { cookie } = await unlock(sessions);
        expect((await sessions.handle(request("/api/session", { bearer: token, body: {} }), origin))?.status).toBe(409);
        now = 2000;
        const repeated = await sessions.handle(request("/api/session", { bearer: token, cookie, body: {} }), origin);
        expect(repeated?.status).toBe(200); expect(repeated?.headers.get("set-cookie")).toBeNull(); expect((await repeated!.json()).expiresAt).toBe(new Date(11000).toISOString());
        const locked = await sessions.handle(request("/api/logout", { cookie, body: {} }), origin);
        expect(locked?.status).toBe(200); expect(locked?.headers.get("set-cookie")).toContain("Max-Age=0");
        expect((sessions.authenticate(request("/api/jobs", { cookie }), origin) as Response).status).toBe(401);
    });
    test("different owner instances never share a cookie and clearing sessions revokes access", async () => {
        const first = createOperatorBrowserSessions(token, headers), second = createOperatorBrowserSessions(token, headers), one = await unlock(first), two = await unlock(second);
        expect(one.cookie.split("=")[0]).not.toBe(two.cookie.split("=")[0]);
        expect((second.authenticate(request("/api/jobs", { cookie: one.cookie }), origin) as Response).status).toBe(401);
        first.clear(); expect((first.authenticate(request("/api/jobs", { cookie: one.cookie }), origin) as Response).status).toBe(401);
        expect(() => createOperatorBrowserSessions(token, headers, { ttlSeconds: OPERATOR_BROWSER_SESSION_SECONDS + 1 })).toThrow();
        expect(() => createOperatorBrowserSessions(token, headers, { maxSessions: 1000 })).toThrow();
    });
});
