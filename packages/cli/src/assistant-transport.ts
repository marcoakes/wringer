import { randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import { Redactor } from "@wringer/engine";
import { MCP_MAX_INPUT_BYTES, parseMcpJson, parseAssistantToolCall, AssistantToolValidationError } from "@wringer/mcp";

export interface AssistantTransportService { call(token: string, name: string, args: unknown): Promise<Record<string, unknown>> }
export interface AssistantConnection { schema_version: "wringer.assistant-connection.v1"; endpoint: string; token: string }
export const ASSISTANT_CONNECTION_SCHEMA = "wringer.assistant-connection.v1";
const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const equal = (left: string, right: string) => left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const tokenShape = /^[a-f0-9]{64}$/;
const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" };
const reply = (status: number, value: object) => new Response(JSON.stringify(value), { status, headers });
const refused = (status: number, code: string, message: string) => reply(status, { schema_version: "wringer.assistant-response.v1", outcome: "refused", code, message });

export function validateAssistantEndpoint(endpoint: unknown): string {
    if (typeof endpoint !== "string" || !/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/call$/.test(endpoint)) throw new Error("Connection must name the exact local assistant endpoint, without credentials, redirects, paths or query values.");
    const value = new URL(endpoint);
    if (!value.port || Number(value.port) > 65535 || value.href !== endpoint) throw new Error("Connection endpoint is not canonical loopback HTTP.");
    return endpoint;
}

export function parseAssistantConnection(value: unknown): AssistantConnection {
    if (!plain(value) || Object.keys(value).sort().join(",") !== "endpoint,schema_version,token" || value.schema_version !== ASSISTANT_CONNECTION_SCHEMA || typeof value.token !== "string" || !tokenShape.test(value.token)) throw new Error("Use a private scoped Wringer connection file; operator URLs or additional credentials are not accepted.");
    return { schema_version: ASSISTANT_CONNECTION_SCHEMA, endpoint: validateAssistantEndpoint(value.endpoint), token: value.token };
}

/** Only the scoped file is read by the MCP entrypoint. Never follow a symlink to controller or operator state. */
export async function readAssistantConnection(path: string): Promise<AssistantConnection> {
    if (!isAbsolute(path) || path.includes("\0")) throw new Error("Connection file must have an absolute path.");
    let current: string = sep;
    for (const part of path.split(sep).filter(Boolean)) {
        current = join(current, part);
        if ((await lstat(current)).isSymbolicLink()) throw new Error("Connection paths cannot traverse symbolic links.");
    }
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8192 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new Error("Connection must be a private operator-owned regular file (mode 0600), not a shared file or link.");
        return parseAssistantConnection(parseMcpJson(await file.readFile("utf8")));
    } finally { await file.close(); }
}

async function boundedJson(request: Request): Promise<unknown> {
    const length = request.headers.get("content-length"), encoding = request.headers.get("content-encoding");
    if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > MCP_MAX_INPUT_BYTES) || encoding !== null && encoding !== "identity") throw new Error("Oversized or encoded request");
    if (!request.body) throw new Error("Missing JSON request");
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read(); if (done) break;
            bytes += value.length;
            if (bytes > MCP_MAX_INPUT_BYTES) { await reader.cancel(); throw new Error("Oversized request"); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const buffer = new Uint8Array(bytes); let at = 0;
    for (const chunk of chunks) { buffer.set(chunk, at); at += chunk.length; }
    return parseMcpJson(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
}

export function createAssistantRequestHandler(service: AssistantTransportService, options: { host: () => string; adminToken: string; instanceId: string; onStop?: () => Promise<unknown> | unknown; isStopping?: () => boolean }) {
    let active = 0, windowAt = Date.now(), requests = 0;
    return async (request: Request): Promise<Response> => {
        const url = new URL(request.url), host = options.host();
        if (url.protocol !== "http:" || url.host !== host || request.headers.get("host") !== host || url.username || url.password || url.search || url.hash || request.headers.has("origin") || request.headers.has("sec-fetch-site")) return refused(403, "local-boundary-refused", "This endpoint only accepts direct local client requests.");
        if (url.pathname === "/health") return request.method === "GET" ? reply(200, { schema_version: "wringer.assistant-health.v1", status: options.isStopping?.() ? "stopping" : "ready", instanceId: options.instanceId }) : refused(405, "method-refused", "Use GET for local readiness.");
        if (!["/call", "/stop"].includes(url.pathname)) return refused(404, "route-refused", "No assistant operation exists at this route.");
        if (request.method !== "POST") return refused(405, "method-refused", "Assistant operations require an authenticated JSON POST.");
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return refused(415, "content-type-refused", "Send a JSON request.");
        const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("authorization") ?? ""), token = match?.[1];
        if (!token || url.pathname === "/stop" && !equal(token, options.adminToken) || url.pathname === "/call" && equal(token, options.adminToken)) return refused(403, "capability-refused", "This operation requires its separate current capability.");
        if (active >= 32) return refused(429, "transport-busy", "Too many requests are active. Inspect the retained job before retrying a mutation.");
        if (Date.now() - windowAt >= 60000) { windowAt = Date.now(); requests = 0; }
        if (url.pathname === "/call" && ++requests > 240) return refused(429, "polling-limit", "Read status only when useful; this connection's request window is full.");
        active++;
        try {
            let input: unknown;
            try { input = await boundedJson(request); } catch { return refused(400, "invalid-request", "The JSON request is malformed, ambiguous or exceeds its bound."); }
            if (url.pathname === "/stop") {
                if (!plain(input) || Object.keys(input).length) return refused(400, "invalid-request", "Stop accepts only an empty object.");
                // Let the authenticated acknowledgement leave the socket before closing listeners.
                setTimeout(() => { void Promise.resolve(options.onStop?.()).catch(() => {}); }, 50);
                return reply(202, { schema_version: "wringer.assistant-response.v1", outcome: "stop-requested", note: "New dispatch is stopping. Active effects or charges may remain uncertain; retained evidence is preserved." });
            }
            if (!plain(input) || Object.keys(input).sort().join(",") !== "args,name") return refused(400, "invalid-request", "Provide only an allowed tool name and its arguments.");
            let call;
            try { call = parseAssistantToolCall(input.name, input.args); }
            catch (error) { return refused(400, error instanceof AssistantToolValidationError ? error.code : "invalid-request", error instanceof AssistantToolValidationError ? error.message : "The operation shape is invalid."); }
            if (options.isStopping?.() && ["wringer.propose", "wringer.start", "wringer.continue", "wringer.request_revision", "wringer.prepare_handover"].includes(call.name)) return refused(409, "owner-stopping", "The owner is stopping. Status, evidence and cancellation remain available; no new work was accepted.");
            const result = await service.call(token, call.name, call.args);
            const text = new Redactor(undefined, process.env, [token, options.adminToken]).scrub(JSON.stringify(result));
            if (Buffer.byteLength(text) > MCP_MAX_INPUT_BYTES) return refused(502, "response-too-large", "The response exceeds the transport bound. Request a single job or smaller evidence page.");
            return new Response(text, { status: 200, headers });
        } catch { return refused(503, "response-unconfirmed", "The local response could not be confirmed. An operation may already be recorded; preserve its idempotency key and read retained status."); }
        finally { active--; }
    };
}

export function createAssistantTransport(service: AssistantTransportService, options: { instanceId: string; onStop?: () => Promise<unknown> | unknown; isStopping?: () => boolean }) {
    const adminToken = randomBytes(32).toString("hex");
    let host = "";
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: MCP_MAX_INPUT_BYTES, idleTimeout: 15, fetch: createAssistantRequestHandler(service, { host: () => host, adminToken, instanceId: options.instanceId, onStop: options.onStop, isStopping: options.isStopping }) });
    host = `127.0.0.1:${server.port}`;
    return { server, endpoint: `http://${host}/call`, adminToken, stop: () => server.stop(true) };
}

/** No automatic retry and no daemon spawn: losing a response cannot replay work. */
export async function callAssistantConnection(path: string, name: string, args: unknown): Promise<Record<string, unknown>> {
    const connection = await readAssistantConnection(path);
    const response = await fetch(connection.endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${connection.token}` }, body: JSON.stringify({ name, args }), redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.body) throw new Error("The local service returned no response");
    // Read the already-bounded response using the same fatal Unicode/duplicate-key reader.
    const value = await boundedJson(new Request("http://127.0.0.1/result", { method: "POST", body: response.body, duplex: "half" } as RequestInit));
    if (!plain(value)) throw new Error("The local service returned an invalid response");
    return value;
}
