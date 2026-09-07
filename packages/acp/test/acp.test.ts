import { test, expect } from "bun:test";
import { PassThrough } from "node:stream";
import { runAcpTurn, probeAcpSession, type AcpTransport } from "../src/index";
function server(handler: (packet: any, send: (value: any) => void) => void) {
    const input = new PassThrough(), output = new PassThrough(), errors = new PassThrough(), seen: any[] = [];
    let stopped = 0, buffer = "";
    const send = (value: any) => { const data = JSON.stringify(value) + "\n"; output.write(data.slice(0, 3)); output.write(data.slice(3)); };
    input.on("data", chunk => { buffer += chunk; let line: number; while ((line = buffer.indexOf("\n")) >= 0) {
        const packet = JSON.parse(buffer.slice(0, line));
        buffer = buffer.slice(line + 1);
        seen.push(packet);
        handler(packet, send);
    } });
    const transport: AcpTransport = { input, output, errors, exited: new Promise(() => { }), async terminate() { stopped++; } };
    return { transport, seen, stopped: () => stopped, send };
}
const reply = (packet: any, result: any) => ({ jsonrpc: "2.0", id: packet.id, result });
function lifecycle(packet: any, send: (value: any) => void) { if (packet.method === "initialize")
    send(reply(packet, { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: "fixture" }, authMethods: [] }));
else if (packet.method === "session/new")
    send(reply(packet, { sessionId: "session-one" })); }
const options = { role: "worker" as const, cwd: "/workspace/repo", prompt: "Fix the declared requirement.", timeoutMs: 1000 };
test("ACP negotiates v1, streams final text, never exposes host fs/terminal", async () => {
    const fixture = server((packet, send) => { lifecycle(packet, send); if (packet.method === "session/prompt") {
        send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "session-one", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "private-thought" } } } });
        send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "session-one", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } } } });
        send(reply(packet, { stopReason: "end_turn" }));
    } });
    const result = await runAcpTurn(fixture.transport, options);
    expect(result.status).toBe("completed");
    expect(result.text).toBe("Done.");
    expect(JSON.stringify(result)).not.toContain("private-thought");
    expect(result.authentication).toEqual({ methodAttempted: null, sessionOpened: true });
    expect(fixture.stopped()).toBe(1);
    expect(fixture.seen[0].params.clientCapabilities).toEqual({});
    expect(fixture.seen[1].params).toEqual({ cwd: "/workspace/repo", mcpServers: [] });
});
test("a truthful credential observation reaches the controller before any model prompt", async () => {
    let observed = false, preflight: any;
    const fixture = server((packet, send) => { lifecycle(packet, send); if (packet.method === "session/prompt") { expect(observed).toBe(true); send(reply(packet, { stopReason: "end_turn" })); } });
    const result = await runAcpTurn(fixture.transport, { ...options, credentialNames: ["CODEX_API_KEY"], onEvent: async event => {
        if (event.type === "acp.prompt.preflight") { await new Promise(resolve => setTimeout(resolve, 5)); preflight = event; observed = true; }
    } });
    expect(result.status).toBe("completed");
    expect(preflight.credentialNames).toEqual(["CODEX_API_KEY"]);
    expect(preflight.providerCredentialValidated).toBe(false);
    expect(preflight.effectiveCredential).toBe("not-attested");
    expect(preflight.promptSent).toBe(false);
    expect(preflight.words).toContain("worker-auth: ACP session opened");
    expect(preflight.words).toContain("key validity remain unverified");
    const abort = new AbortController(), cancelled = server(lifecycle);
    const stop = await runAcpTurn(cancelled.transport, { ...options, signal: abort.signal, onEvent: event => { if (event.type === "acp.prompt.preflight") abort.abort(); } });
    expect(stop.stopReason).toBe("cancelled");
    expect(cancelled.seen.some(packet => packet.method === "session/prompt")).toBe(false);
});
test("ACP headless permissions select declared allow_once only, judge edits denied", async () => {
    let prompt: any;
    const fixture = server((packet, send) => { lifecycle(packet, send); if (packet.method === "session/prompt") {
        prompt = packet;
        send({ jsonrpc: "2.0", id: "ask", method: "session/request_permission", params: { sessionId: "session-one", toolCall: { toolCallId: "tool", kind: "edit" }, options: [{ optionId: "persist", kind: "allow_always" }, { optionId: "once", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }] } });
    }
    else if (packet.id === "ask")
        send(reply(prompt, { stopReason: "end_turn" })); });
    const result = await runAcpTurn(fixture.transport, { ...options, role: "judge" });
    expect(result.status).toBe("completed");
    expect(fixture.seen.find(packet => packet.id === "ask").result).toEqual({ outcome: { outcome: "selected", optionId: "no" } });
});
test("agent filesystem callback is refused rather than executed", async () => {
    let prompt: any;
    const fixture = server((packet, send) => { lifecycle(packet, send); if (packet.method === "session/prompt") {
        prompt = packet;
        send({ jsonrpc: "2.0", id: "fs", method: "fs/write_text_file", params: { sessionId: "session-one", path: "/tmp/product.txt", content: "unauthorized" } });
    }
    else if (packet.id === "fs")
        send(reply(prompt, { stopReason: "end_turn" })); });
    await runAcpTurn(fixture.transport, options);
    expect(fixture.seen.find(packet => packet.id === "fs").error.code).toBe(-32601);
});
test("malformed response error fails without leaving request hung", async () => {
    const fixture = server((packet, send) => send({ jsonrpc: "2.0", id: packet.id, error: { message: "no numeric code" } }));
    const start = Date.now();
    const result = await runAcpTurn(fixture.transport, options);
    expect(result.status).toBe("failed");
    expect(result.stopReason).toBe("protocol-error");
    expect(Date.now() - start).toBeLessThan(500);
});
test("cross-session update fails, timeout sends cancel and kills transport", async () => {
    const bad = server((packet, send) => { lifecycle(packet, send); if (packet.method === "session/prompt")
        send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "wrong", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "wrong" } } } }); });
    expect((await runAcpTurn(bad.transport, options)).status).toBe("failed");
    const quiet = server(lifecycle);
    const result = await runAcpTurn(quiet.transport, { ...options, timeoutMs: 20 });
    expect(result.stopReason).toBe("timeout");
    expect(quiet.seen.some(packet => packet.method === "session/cancel")).toBe(true);
    expect(quiet.stopped()).toBe(1);
});
test("authenticate return never becomes a green when session/new still refuses", async () => {
    const fixture = server((packet, send) => { if (packet.method === "initialize")
        send(reply(packet, { protocolVersion: 1, agentCapabilities: {}, authMethods: [{ id: "key", name: "Key" }] }));
    else if (packet.method === "authenticate")
        send(reply(packet, {}));
    else if (packet.method === "session/new")
        send({ jsonrpc: "2.0", id: packet.id, error: { code: -32000, message: "Authentication required" } }); });
    const result = await runAcpTurn(fixture.transport, { ...options, authMethod: "key" });
    expect(result.status).toBe("stopped");
    expect(result.authentication).toEqual({ methodAttempted: "key", sessionOpened: false });
    expect(fixture.seen.some(packet => packet.method === "session/prompt")).toBe(false);
});
test("interactive auth metadata never runs and auth metadata redacts before return", async () => {
    const secret = "fixture-secret-value";
    const fixture = server((packet, send) => send(reply(packet, { protocolVersion: 1, agentCapabilities: {}, authMethods: [{ id: "browser", name: secret, type: "terminal", _meta: { command: "steal-home" } }] })));
    const result = await runAcpTurn(fixture.transport, { ...options, authMethod: "browser", redact: text => text.replaceAll(secret, "[REDACTED]") });
    expect(result.stopReason).toBe("interactive-auth-required");
    expect(fixture.seen).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(secret);
});
test("oversized unterminated messages stop before spending a prompt", async () => { const fixture = server(() => fixture.transport.output.emit("data", Buffer.from("a".repeat(300)))); const result = await runAcpTurn(fixture.transport, { ...options, maxMessageBytes: 100 }); expect(result.stopReason).toBe("message-limit"); expect(fixture.seen).toHaveLength(1); });

test("preflight negotiates auth/session/mode and denies all tool effects without a prompt", async () => {
    let modePacket: any;
    const fixture = server((packet, send) => {
        if (packet.method === "initialize") send(reply(packet, { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { close: true } }, authMethods: [{ id: "key", name: "Environment key" }] }));
        else if (packet.method === "authenticate") send(reply(packet, {}));
        else if (packet.method === "session/new") send(reply(packet, { sessionId: "session-one", modes: { availableModes: [{ id: "headless" }] } }));
        else if (packet.method === "session/set_mode") {
            modePacket = packet;
            send({ jsonrpc: "2.0", id: "probe-tool", method: "session/request_permission", params: { sessionId: "session-one", toolCall: { toolCallId: "tool", kind: "read" }, options: [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }] } });
        } else if (packet.id === "probe-tool") send(reply(modePacket, {}));
        else if (packet.method === "session/close") send(reply(packet, {}));
        else if (packet.method === "session/prompt") throw new Error("Preflight must never send a model prompt");
    });
    const result = await probeAcpSession(fixture.transport, { ...options, authMethod: "key", mode: "headless" });
    expect(result.status).toBe("completed");
    expect(result.stopReason).toBe("session-opened");
    expect(result.promptSent).toBe(false);
    expect(result.modelWorkRequested).toBe(false);
    expect(result.providerCredentialValidated).toBe(false);
    expect(result.usage).toBeUndefined();
    expect(result.authentication).toEqual({ methodAttempted: "key", sessionOpened: true });
    expect(fixture.seen.find(packet => packet.id === "probe-tool").result.outcome.optionId).toBe("no");
    expect(fixture.seen.filter(packet => packet.method).map(packet => packet.method)).toEqual(["initialize", "authenticate", "session/new", "session/set_mode", "session/close"]);
    expect(fixture.stopped()).toBe(1);
});

test("preflight reports invalid key, interactive auth and unsupported protocol without task prompts", async () => {
    for (const mode of ["invalid-key", "interactive", "unsupported"]) {
        const fixture = server((packet, send) => {
            if (packet.method === "initialize") send(reply(packet, { protocolVersion: mode === "unsupported" ? 999 : 1, agentCapabilities: {}, authMethods: [{ id: "key", ...(mode === "interactive" ? { type: "terminal", _meta: { command: "must-not-run" } } : {}) }] }));
            else if (packet.method === "authenticate") send(reply(packet, {}));
            else if (packet.method === "session/new") send({ jsonrpc: "2.0", id: packet.id, error: { code: -32000, message: "Authentication required" } });
        });
        const result = await probeAcpSession(fixture.transport, { ...options, authMethod: "key" });
        expect(result.authentication.sessionOpened).toBe(false);
        expect(result.providerCredentialValidated).toBe(false);
        expect(result.stopReason).toBe(mode === "invalid-key" ? "authentication-required" : mode === "interactive" ? "interactive-auth-required" : "unsupported-protocol");
        expect(fixture.seen.some(packet => packet.method === "session/prompt")).toBe(false);
        expect(fixture.stopped()).toBe(1);
    }
});

test("preflight cancellation has a deadline and decoded metadata redaction precedes persistence", async () => {
    const quiet = server(() => {}), start = Date.now();
    const stopped = await probeAcpSession(quiet.transport, { ...options, timeoutMs: 20 });
    expect(stopped.stopReason).toBe("timeout");
    expect(Date.now() - start).toBeLessThan(1000);
    expect(quiet.stopped()).toBe(1);
    const secret = 'synthetic-"quote"-\\-value', events: any[] = [];
    const fixture = server((packet, send) => { if (packet.method === "initialize") send(reply(packet, { protocolVersion: 1, agentCapabilities: {}, authMethods: [{ id: "key", name: secret }] })); else if (packet.method === "session/new") send(reply(packet, { sessionId: "session-one" })); });
    const result = await probeAcpSession(fixture.transport, { ...options, redact: text => text.replaceAll(secret, "[REDACTED]"), onEvent: event => { events.push(event); } });
    expect(result.authMethods[0]!.name).toBe("[REDACTED]");
    expect(events.find(event => event.type === "acp.initialized").authMethods[0].name).toBe("[REDACTED]");
});
