import { afterEach, describe, expect, test } from "bun:test";
import { chmod, link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantRequestHandler, parseAssistantConnection, readAssistantConnection, validateAssistantEndpoint, type AssistantConnection } from "../src/assistant-transport";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function scratch() { const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-assistant-transport-"))); roots.push(root); return root; }
const host = "127.0.0.1:34127", endpoint = `http://${host}/call`, token = "a".repeat(64), admin = "b".repeat(64);
const connection = (): AssistantConnection => ({ schema_version: "wringer.assistant-connection.v1", endpoint, token });
function fixture() {
    const calls: unknown[] = []; let stops = 0;
    const handler = createAssistantRequestHandler({ call: async (credential, name, args) => { calls.push({ credential, name, args }); return { outcome: "observed", cost: null, private: credential }; } }, { host: () => host, adminToken: admin, instanceId: "fixture", onStop: () => { stops++; } });
    const request = (path = "/call", body: string = JSON.stringify({ name: "wringer.get_status", args: {} }), overrides: RequestInit = {}) => new Request(`http://${host}${path}`, { method: "POST", body, ...overrides, headers: { Host: host, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...overrides.headers } });
    return { calls, handler, request, stops: () => stops };
}

describe("local assistant request boundary without a listener", () => {
    test("scoped calls return bounded facts and scrub the supplied bearer", async () => {
        const f = fixture(), response = await f.handler(f.request()), result = await response.json();
        expect(response.status).toBe(200); expect(result).toEqual({ outcome: "observed", cost: null, private: "[REDACTED]" });
        expect(f.calls).toEqual([{ credential: token, name: "wringer.get_status", args: {} }]);
        expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.has("access-control-allow-origin")).toBeFalse();
    });
    test("browser Origin, fetch metadata, wrong Host and query authentication fail before callback", async () => {
        const f = fixture();
        for (const headers of [{ Origin: "https://evil.invalid" }, { Origin: `http://${host}` }, { Origin: "null" }, { "Sec-Fetch-Site": "same-origin" }, { Host: "evil.invalid" }, { Host: "localhost:34127" }, { Authorization: "" }, { Authorization: `Bearer ${admin}` }] as Record<string, string>[])
            expect((await f.handler(f.request("/call", undefined, { headers }))).status).toBe(403);
        expect((await f.handler(f.request(`/call?token=${token}`))).status).toBe(403);
        expect(f.calls).toEqual([]);
    });
    test("GET is readiness-only, with no job data or side effects", async () => {
        const f = fixture();
        const health = await f.handler(f.request("/health", undefined, { method: "GET", body: undefined }));
        expect(await health.json()).toEqual({ schema_version: "wringer.assistant-health.v1", status: "ready", instanceId: "fixture" });
        expect((await f.handler(f.request("/call", undefined, { method: "GET", body: undefined }))).status).toBe(405);
        expect((await f.handler(f.request("/stop", undefined, { method: "GET", body: undefined }))).status).toBe(405);
        expect(f.calls).toEqual([]); expect(f.stops()).toBe(0);
    });
    test("extra authority, forbidden tools, cash guarantees and malformed bodies never dispatch", async () => {
        const f = fixture();
        for (const body of [
            '{"name":"wringer.get_status","name":"wringer.start","args":{}}', "[]", "null", "not-json",
            JSON.stringify({ name: "wringer.get_status", args: {}, operatorToken: admin }),
            JSON.stringify({ name: "wringer.publish", args: {} }),
            JSON.stringify({ name: "wringer.get_status", args: { root: "/tmp/elsewhere" } }),
            JSON.stringify({ name: "wringer.propose", args: { workspaceId: "ws", idempotencyKey: crypto.randomUUID(), intent: "Build", strictCashLimit: 50 } }),
        ]) expect((await f.handler(f.request("/call", body))).status).toBe(400);
        expect(f.calls).toEqual([]);
    });
    test("body encoding, content type and oversized content are refused", async () => {
        const f = fixture();
        expect((await f.handler(f.request("/call", "{}", { headers: { "Content-Type": "text/plain" } }))).status).toBe(415);
        for (const headers of [{ "Content-Encoding": "gzip" }, { "Content-Length": "900000" }] as Record<string, string>[]) expect((await f.handler(f.request("/call", "{}", { headers }))).status).toBe(400);
        expect((await f.handler(f.request("/call", "x".repeat(262145)))).status).toBe(400);
        expect(f.calls).toEqual([]);
    });
    test("only the separate operator token can request shutdown", async () => {
        const f = fixture();
        expect((await f.handler(f.request("/stop", "{}"))).status).toBe(403);
        expect((await f.handler(f.request("/stop", '{"yes":true}', { headers: { Authorization: `Bearer ${admin}` } }))).status).toBe(400);
        expect((await f.handler(f.request("/stop", "{}", { headers: { Authorization: `Bearer ${admin}` } }))).status).toBe(202);
        await Bun.sleep(80); expect(f.stops()).toBe(1); expect(f.calls).toEqual([]);
    });
    test("a stopping owner retains status and cancellation but refuses new work", async () => {
        const f = fixture(), calls: string[] = [], handler = createAssistantRequestHandler({ call: async (_token, name) => { calls.push(name); return { outcome: "observed" }; } }, { host: () => host, adminToken: admin, instanceId: "fixture", isStopping: () => true });
        const guard = { jobId: "job", idempotencyKey: crypto.randomUUID(), expectedRevision: "a".repeat(64), expectedCandidateTree: null };
        expect((await handler(f.request("/health", undefined, { method: "GET", body: undefined }))).status).toBe(200);
        expect((await handler(f.request())).status).toBe(200);
        expect((await handler(f.request("/call", JSON.stringify({ name: "wringer.start", args: guard })))).status).toBe(409);
        expect((await handler(f.request("/call", JSON.stringify({ name: "wringer.cancel", args: guard })))).status).toBe(200);
        expect(calls).toEqual(["wringer.get_status", "wringer.cancel"]);
    });
    test("raw service errors are secret-safe and never claim an accepted operation did not happen", async () => {
        const f = fixture(), handler = createAssistantRequestHandler({ call: async () => { throw new Error("after enqueue: arbitrary-password /Users/private"); } }, { host: () => host, adminToken: admin, instanceId: "fixture" });
        const response = await handler(f.request()), raw = await response.text();
        expect(response.status).toBe(503); expect(raw).toContain("may already be recorded"); expect(raw).not.toContain("arbitrary-password"); expect(raw).not.toContain("/Users/private");
    });
});

describe("private scoped connection files", () => {
    test("accepts only canonical loopback assistant URLs, no extra fields or full operator link", () => {
        expect(parseAssistantConnection(connection())).toEqual(connection());
        for (const bad of ["https://127.0.0.1:1234/call", "http://localhost:1234/call", "http://127.1:1234/call", "http://example.invalid:1234/call", "http://127.0.0.1/call", "http://127.0.0.1:65536/call", "http://127.0.0.1:1234/x/../call", "http://127.0.0.1:1234/call?key=x", "http://127.0.0.1:1234/call#token=x", "http://user:pass@127.0.0.1:1234/call"])
            expect(() => validateAssistantEndpoint(bad)).toThrow();
        expect(() => parseAssistantConnection({ ...connection(), operatorUrl: `http://${host}/#token=${admin}` })).toThrow();
        expect(() => parseAssistantConnection({ ...connection(), root: "/private/controller" })).toThrow();
    });
    test("only a private ordinary file is readable; links, shared modes and duplicate keys fail closed", async () => {
        const root = await scratch(), path = join(root, "connection.json");
        await writeFile(path, JSON.stringify(connection()), { mode: 0o600 }); expect(await readAssistantConnection(path)).toEqual(connection());
        await chmod(path, 0o644); await expect(readAssistantConnection(path)).rejects.toThrow("private"); await chmod(path, 0o600);
        const linked = join(root, "linked"); await link(path, linked); await expect(readAssistantConnection(path)).rejects.toThrow("private");
        const other = join(root, "other.json"); await writeFile(other, JSON.stringify(connection()), { mode: 0o600 }); const symbolic = join(root, "symbolic"); await symlink(other, symbolic); await expect(readAssistantConnection(symbolic)).rejects.toThrow("symbolic");
        const directory = join(root, "directory"); await mkdir(directory); await writeFile(join(directory, "connection.json"), JSON.stringify(connection()), { mode: 0o600 }); await symlink(directory, join(root, "parent-link")); await expect(readAssistantConnection(join(root, "parent-link/connection.json"))).rejects.toThrow("symbolic");
        await writeFile(other, JSON.stringify(connection()).replace('"token":', '"token":"c","token":')); await expect(readAssistantConnection(other)).rejects.toThrow();
        await expect(readAssistantConnection("relative.json")).rejects.toThrow("absolute");
    });
});
