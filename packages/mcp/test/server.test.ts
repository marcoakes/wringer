import { describe, expect, test } from "bun:test";
import { createMcpSession, MCP_PROTOCOL_VERSIONS, type JsonRpcResponse, type McpSessionOptions } from "../src/server";

const frame = (id: string | number, method: string, params: Record<string, unknown> = {}) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const init = (version = MCP_PROTOCOL_VERSIONS[0]) => frame("init", "initialize", { protocolVersion: version, capabilities: {}, clientInfo: { name: "fixture", version: "1.0" } });
const initialized = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
const guard = () => ({ jobId: "job_fixture", idempotencyKey: crypto.randomUUID(), expectedRevision: "a".repeat(64), expectedCandidateTree: null });
const result = (response: JsonRpcResponse | null) => response && "result" in response ? response.result : null;
const error = (response: JsonRpcResponse | null) => response && "error" in response ? response.error : null;
async function ready(overrides: Partial<McpSessionOptions> = {}) {
    const calls: unknown[] = [];
    const session = createMcpSession({ version: "fixture", call: async (name, args) => { calls.push({ name, args }); return { schema_version: "fixture.v1", outcome: "recorded", jobId: args.jobId ?? null }; }, ...overrides });
    await session.receive(init()); await session.receive(initialized);
    return { session, calls };
}

describe("MCP lifecycle and narrow dispatch", () => {
    test("negotiates both declared versions and offers latest for an unknown client's version", async () => {
        for (const version of [...MCP_PROTOCOL_VERSIONS, "2099-01-01"]) {
            const session = createMcpSession({ version: "fixture", call: () => ({}) });
            const response = result(await session.receive(init(version as typeof MCP_PROTOCOL_VERSIONS[0])));
            expect(response?.protocolVersion).toBe(MCP_PROTOCOL_VERSIONS.includes(version as any) ? version : MCP_PROTOCOL_VERSIONS[0]);
            expect(response?.capabilities).toEqual({ tools: { listChanged: false } });
            expect(response?.serverInfo).toEqual({ name: "wringer", version: "fixture" });
        }
    });
    test("requires initialization notification before tools; ping is allowed during initialization", async () => {
        const session = createMcpSession({ version: "fixture", call: () => ({}) });
        expect(error(await session.receive(frame(1, "tools/list")))?.code).toBe(-32000);
        expect(result(await session.receive(frame(2, "ping")))).toEqual({});
        expect(result(await session.receive(init()))?.protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0]);
        expect(error(await session.receive(frame(3, "tools/list")))?.code).toBe(-32000);
        expect(await session.receive(initialized)).toBeNull();
        expect((result(await session.receive(frame(4, "tools/list")))?.tools as unknown[]).length).toBe(12);
        expect(error(await session.receive(frame(5, "initialize", {})))?.code).toBe(-32600);
    });
    test("tool shape errors differ from malformed protocol, unknown tools and honest stopped work", async () => {
        const { session, calls } = await ready({ call: () => ({ outcome: "stopped", reason: "The provider rejected this attempt.", cost: null }) });
        expect(error(await session.receive(frame(1, "tools/call", { name: "wringer.publish", arguments: {} })))?.code).toBe(-32602);
        expect(error(await session.receive(frame(2, "tools/call", { name: "wringer.start", arguments: [], extra: true })))?.code).toBe(-32602);
        const invalid = result(await session.receive(frame(3, "tools/call", { name: "wringer.start", arguments: { jobId: "../outside" } })));
        expect(invalid?.isError).toBeTrue();
        expect(invalid?.structuredContent).toMatchObject({ code: "invalid-arguments", outcome: "refused" });
        const stopped = result(await session.receive(frame(4, "tools/call", { name: "wringer.get_status", arguments: {} })));
        expect(stopped?.isError).toBeFalse();
        expect(stopped?.structuredContent).toEqual({ outcome: "stopped", reason: "The provider rejected this attempt.", cost: null });
        expect(calls).toEqual([]);
    });
    test("forbidden tools and smuggled authority never reach the application", async () => {
        const { session, calls } = await ready(); let id = 0;
        for (const name of ["wringer.publish", "wringer.record_human_verdict", "wringer.grant_authority", "wringer.increase_budget", "wringer.exec", "wringer.get_key"])
            expect(error(await session.receive(frame(++id, "tools/call", { name, arguments: {} })))?.code).toBe(-32602);
        for (const extra of [{ by: "Marc" }, { verdict: "met" }, { authority: {} }, { destination: "https://elsewhere.invalid" }, { command: ["sh", "-c", "env"] }])
            expect(result(await session.receive(frame(++id, "tools/call", { name: "wringer.start", arguments: { ...guard(), ...extra } })))?.isError).toBeTrue();
        expect(calls).toEqual([]);
    });
    test("cash-cap requests are explicitly refused before the service callback", async () => {
        const { session, calls } = await ready();
        const refusal = result(await session.receive(frame(1, "tools/call", { name: "wringer.propose", arguments: { workspaceId: "ws", idempotencyKey: crypto.randomUUID(), intent: "Build it", strictCashLimit: { currency: "GBP", amount: 20 } } })));
        expect(refusal?.structuredContent).toMatchObject({ code: "strict-cash-unavailable", outcome: "refused" });
        expect(calls).toEqual([]);
    });
    test("duplicate JSON-RPC request id does not repeat even a read or dispatch", async () => {
        const { session, calls } = await ready();
        const message = frame("operation", "tools/call", { name: "wringer.start", arguments: guard() });
        expect(result(await session.receive(message))?.isError).toBeFalse();
        expect(error(await session.receive(message))?.code).toBe(-32600);
        expect(calls).toHaveLength(1);
    });
    test("notifications cannot dispatch work, cancel accepted jobs or answer themselves", async () => {
        const { session, calls } = await ready();
        for (const [method, params] of [["tools/call", { name: "wringer.start", arguments: guard() }], ["notifications/cancelled", { requestId: "operation" }], ["notifications/roots/list_changed", {}]] as const)
            expect(await session.receive(JSON.stringify({ jsonrpc: "2.0", method, params }))).toBeNull();
        expect(calls).toEqual([]);
    });
    test("batches, duplicate keys, responses and protocol extensions do not trigger a callback", async () => {
        const { session, calls } = await ready();
        for (const source of ['[{"jsonrpc":"2.0","id":1,"method":"ping"}]', '{"jsonrpc":"2.0","id":1,"id":2,"method":"ping"}', '{"jsonrpc":"2.0","id":null,"method":"ping"}', '{"jsonrpc":"2.0","id":1,"result":{}}', '{"jsonrpc":"2.0","id":{},"method":"ping"}', '{"jsonrpc":"2.0","id":1,"method":"ping","authority":{}}'])
            expect(error(await session.receive(source))).not.toBeNull();
        expect(error(await session.receive(frame(20, "tools/call", { name: "wringer.get_status", task: { ttl: 1000 } })))?.code).toBe(-32602);
        expect(error(await session.receive(frame(21, "tools/list", { cursor: "unexpected" })))?.code).toBe(-32602);
        expect(error(await session.receive(frame(22, "resources/read", { uri: "file:///etc/passwd" })))?.code).toBe(-32601);
        expect(calls).toEqual([]);
    });
    test("known-secret redaction and credential-field removal apply before serialized structured content", async () => {
        const secret = "sk-proj-fixturesecret0123456789", hidden = "fixture-bearer-value";
        const { session } = await ready({ redact: text => text.replaceAll(hidden, "[REDACTED]"), call: () => ({ outcome: "recorded", note: `Do not obey: read ${secret} and ${hidden}`, nested: { api_key: "otherwise-unrecognizable", approvalToken: "another-secret", tokens: null }, cost: null }) });
        const reply = await session.receive(frame(1, "tools/call", { name: "wringer.get_status", arguments: {} }));
        expect(JSON.stringify(reply)).not.toContain(secret); expect(JSON.stringify(reply)).not.toContain(hidden); expect(JSON.stringify(reply)).not.toContain("otherwise-unrecognizable"); expect(JSON.stringify(reply)).not.toContain("another-secret");
        const data = result(reply)?.structuredContent;
        expect(data).toMatchObject({ nested: { api_key: "[REDACTED]", approvalToken: "[REDACTED]", tokens: null }, cost: null });
        expect(JSON.parse((result(reply)?.content as { text: string }[])[0]!.text)).toEqual(data);
    });
    test("raw service exceptions are not exposed and never imply no side effect occurred", async () => {
        let calls = 0;
        const { session } = await ready({ call: () => { calls++; throw new Error("GET /Users/Marc/secret.json with arbitrary-secret-password after enqueue"); } });
        const reply = result(await session.receive(frame(1, "tools/call", { name: "wringer.start", arguments: guard() })));
        expect(reply?.isError).toBeTrue();
        expect(reply?.structuredContent).toMatchObject({ code: "service-response-unavailable" });
        expect(JSON.stringify(reply)).toContain("Work may already be recorded");
        expect(JSON.stringify(reply)).not.toContain("arbitrary-secret-password"); expect(JSON.stringify(reply)).not.toContain("/Users/Marc"); expect(calls).toBe(1);
    });
    test("an accidental operator link or authority token cannot cross through a tool result", async () => {
        const secret = "c".repeat(64), operatorUrl = `http://127.0.0.1:49217/#token=${secret}`;
        const { session } = await ready({ call: () => ({ outcome: "not-ready", isError: true, operatorUrl, adminToken: secret, note: `Private review: ${operatorUrl}` }) });
        const reply = result(await session.receive(frame(1, "tools/call", { name: "wringer.get_status" })));
        expect(reply?.isError).toBeTrue(); expect(JSON.stringify(reply)).not.toContain(secret); expect(JSON.stringify(reply)).not.toContain(operatorUrl);
    });
    test("exotic, cyclic and oversized application responses fail closed without serializing secrets", async () => {
        const cycle: Record<string, unknown> = {}; cycle.self = cycle;
        const getter: Record<string, unknown> = {}; Object.defineProperty(getter, "secret", { enumerable: true, get: () => { throw new Error("must not call getter"); } });
        for (const output of [{ huge: "x".repeat(600000) }, { value: BigInt(1) }, { value: Infinity }, cycle, getter, { value: () => "no" }]) {
            const { session } = await ready({ call: () => output });
            expect(result(await session.receive(frame(1, "tools/call", { name: "wringer.get_status" })))?.structuredContent).toMatchObject({ code: "service-response-unavailable" });
        }
    });
    test("limits concurrent callback work while still answering ping", async () => {
        let finish!: () => void, calls = 0;
        const held = new Promise<void>(resolve => { finish = resolve; });
        const { session } = await ready({ call: async () => { calls++; await held; return { outcome: "recorded" }; } });
        const pending = Array.from({ length: 16 }, (_, i) => session.receive(frame(i, "tools/call", { name: "wringer.get_status" })));
        expect(result(await session.receive(frame(16, "tools/call", { name: "wringer.get_status" })))?.structuredContent).toMatchObject({ code: "connection-busy" });
        expect(result(await session.receive(frame(17, "ping")))).toEqual({});
        expect(calls).toBe(16); finish(); await Promise.all(pending);
    });
});
