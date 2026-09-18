import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { probeAcpSession, runAcpTurn, type AcpTransport, type AcpTurnOptions } from "../src/index";

const adapter = "@agentclientprotocol/claude-agent-acp";
const designTools = ["get_design_context", "list_design_assets", "get_design_asset"];
const designServer = { name: "wringer-design", command: "/usr/bin/env", args: ["node", "/input/wringer-design/server.cjs"], env: [], controllerReadOnlyTools: designTools };
const call = (name = "get_design_context") => ({ toolCallId: "design-call", title: `mcp__wringer-design__${name}`, kind: "other", rawInput: {}, _meta: { claudeCode: { toolName: `mcp__wringer-design__${name}` } } });
const choices = [{ optionId: "persistent", kind: "allow_always" }, { optionId: "once", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }];

async function permission(toolCall: any, options: Partial<AcpTurnOptions> = {}, fixture: { adapter?: string; cancel?: boolean; probe?: boolean; initial?: any; updates?: any[]; requestMeta?: any; repeat?: boolean; preSessionCall?: any } = {}) {
    const input = new PassThrough(), output = new PassThrough(), seen: any[] = [], abort = new AbortController();
    let buffer = "", pending: any;
    const send = (packet: unknown) => output.write(JSON.stringify(packet) + "\n");
    const requestPermission = (id = "permission") => {
        const { _meta, ...requestCall } = toolCall;
        send({ jsonrpc: "2.0", id, method: "session/request_permission", params: { sessionId: "design-session", toolCall: { ...requestCall, ...(fixture.requestMeta !== undefined ? { _meta: fixture.requestMeta } : {}) }, options: choices } });
    };
    input.on("data", chunk => {
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
            const packet = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); seen.push(packet);
            if (packet.method === "initialize") send({ jsonrpc: "2.0", id: packet.id, result: { protocolVersion: 1, agentInfo: { name: fixture.adapter ?? adapter, version: "0.65.0" }, agentCapabilities: {}, authMethods: [] } });
            else if (packet.method === "session/new") {
                if (fixture.preSessionCall) send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: null, update: { ...fixture.preSessionCall, sessionUpdate: "tool_call" } } });
                send({ jsonrpc: "2.0", id: packet.id, result: { sessionId: "design-session", modes: { availableModes: [{ id: "fixture" }] } } });
            }
            else if (packet.method === "session/prompt" || packet.method === "session/set_mode") {
                pending = packet;
                if (fixture.initial !== null) send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "design-session", update: { ...(fixture.initial ?? toolCall), sessionUpdate: "tool_call" } } });
                for (const update of fixture.updates ?? []) send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "design-session", update } });
                if (fixture.cancel) abort.abort(); else requestPermission();
            }
            else if (packet.method === "session/cancel") requestPermission();
            else if (packet.id === "permission" && fixture.repeat) requestPermission("permission-repeat");
            else if (packet.id === "permission" || packet.id === "permission-repeat") send({ jsonrpc: "2.0", id: pending.id, result: fixture.probe ? {} : { stopReason: fixture.cancel ? "cancelled" : "end_turn" } });
        }
    });
    const transport: AcpTransport = { input, output, exited: new Promise(() => {}), async terminate() { input.destroy(); output.destroy(); } };
    const request: AcpTurnOptions = { role: "worker", cwd: "/workspace/repo", prompt: "Scripted permission fixture; no model is invoked.", timeoutMs: 1000, signal: abort.signal, mcpServers: [designServer], ...options, ...(fixture.probe ? { mode: "fixture" } : {}) };
    const result = await (fixture.probe ? probeAcpSession(transport, request) : runAcpTurn(transport, request));
    return { result, seen, outcome: seen.find(packet => packet.id === "permission")?.result.outcome };
}

test("Claude MCP kind=other reads require the controller's exact configured service/tool grant", async () => {
    for (const role of ["worker", "planner", "judge"] as const) for (const name of designTools) {
        // Claude 0.65.0 emits the name on the initial update; its normal
        // permission request has toolCallId/kind/title/rawInput, without _meta.
        const result = await permission(call(name), { role });
        expect(result.outcome).toEqual({ outcome: "selected", optionId: "once" });
        expect(result.result.events.find(event => event.type === "acp.permission")).toMatchObject({ kind: "other", effectiveKind: "read", policy: "controller-mcp-read" });
        expect(result.seen.find(packet => packet.method === "session/new").params.mcpServers).toEqual([{ name: designServer.name, command: designServer.command, args: designServer.args, env: [] }]);
    }
});

test("MCP read permission requires an unambiguous prior call identity and cannot be replayed", async () => {
    const denied = [
        { initial: null, preSessionCall: call() },
        { initial: null, requestMeta: call()._meta },
        { initial: { ...call(), toolCallId: "different-call" } },
        { initial: call("write_design"), requestMeta: call()._meta },
        { updates: [{ ...call("write_design"), sessionUpdate: "tool_call_update" }] },
        { updates: [{ toolCallId: "design-call", sessionUpdate: "tool_call_update", kind: "execute" }] },
        { updates: [{ ...call(), sessionUpdate: "tool_call" }] },
        { updates: [{ toolCallId: "design-call", sessionUpdate: "tool_call_update", status: "completed" }] },
        { requestMeta: call("write_design")._meta },
    ];
    for (const fixture of denied) expect((await permission(call(), {}, fixture)).outcome).toEqual({ outcome: "selected", optionId: "no" });
    const repeated = await permission(call(), {}, { repeat: true });
    expect(repeated.outcome).toEqual({ outcome: "selected", optionId: "once" });
    expect(repeated.seen.find(packet => packet.id === "permission-repeat").result.outcome).toEqual({ outcome: "selected", optionId: "no" });
});

test("design-name lookalikes and untrusted hints cannot grant arbitrary MCP or judge effects", async () => {
    const denied = [
        { ...call(), _meta: undefined, annotations: { readOnlyHint: true } },
        { ...call(), _meta: { claudeCode: { toolName: "mcp__untrusted__get_design_context" } } },
        call("write_design"), call("get_design_context_extra"),
        { ...call(), _meta: { claudeCode: { toolName: "mcp__wringer-design__get_design_context;execute" } } },
        { ...call(), kind: "edit" }, { ...call(), kind: "execute" },
    ];
    for (const tool of denied) expect((await permission(tool, { role: "judge" })).outcome).toEqual({ outcome: "selected", optionId: "no" });
    for (const mcpServers of [[], [{ name: designServer.name, command: designServer.command, args: designServer.args, env: [] }]]) {
        expect((await permission(call(), { mcpServers })).outcome).toEqual({ outcome: "selected", optionId: "no" });
    }
    expect((await permission(call(), { allowedToolKinds: ["search"] })).outcome).toEqual({ outcome: "selected", optionId: "no" });
    expect((await permission(call(), {}, { adapter: "unknown-adapter" })).outcome).toEqual({ outcome: "selected", optionId: "no" });
});

test("controller design reads never bypass cancellation or protocol-only preflight", async () => {
    const cancelled = await permission(call(), {}, { cancel: true });
    expect(cancelled.result.stopReason).toBe("cancelled");
    expect(cancelled.outcome).toEqual({ outcome: "cancelled" });
    const preflight = await permission(call(), {}, { probe: true });
    expect(preflight.result.stopReason).toBe("session-opened");
    expect(preflight.outcome).toEqual({ outcome: "selected", optionId: "no" });
    expect(preflight.seen.some(packet => packet.method === "session/prompt")).toBe(false);
});

test("controller read grants reject ambiguous service identities and wildcard names", async () => {
    for (const mcpServers of [
        [designServer, { ...designServer, command: "/untrusted/server" }],
        [{ ...designServer, name: "wringer-design__get" }],
        [{ ...designServer, controllerReadOnlyTools: ["*"] }],
        [{ ...designServer, controllerReadOnlyTools: ["get__design_context"] }],
    ]) await expect(permission(call(), { mcpServers })).rejects.toThrow(/unique|exact service/);
});

test("controller service grants match the full session namespace, never the design prefix", async () => {
    const name="wringer-design-4cfb80d8-e9d1-46b3-85ec-5a2c1e927705",mcpServers=[{...designServer,name}];
    const named=(service:string)=>({...call(),_meta:{claudeCode:{toolName:`mcp__${service}__get_design_context`}}});
    expect((await permission(named(name),{mcpServers})).outcome).toEqual({outcome:"selected",optionId:"once"});
    for(const wrong of ["wringer-design",`${name}-other`,"wringer-design-5285e5f7-97b1-4475-9801-81a8f9e9ae2f"])
        expect((await permission(named(wrong),{mcpServers})).outcome).toEqual({outcome:"selected",optionId:"no"});
});
