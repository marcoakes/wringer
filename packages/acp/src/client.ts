import { AcpError, type AcpTransport, type AcpTurnOptions, type AcpTurnResult, type AcpProbeOptions, type AcpSessionProbeResult } from "./types";
import packageInfo from "../../../package.json";
const mapping = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const validId = (id: unknown) => typeof id === "string" || typeof id === "number" && Number.isSafeInteger(id);
const interactive = (method: Record<string, any>) => method.type === "terminal" || method.type === "terminal-auth" || JSON.stringify(method._meta ?? {}).match(/terminal.auth|"command"|"args"/i) !== null;
/** ACP v1 JSON-RPC over a runtime-owned byte stream. This client never implements an agent. */
export async function runAcpTurn(transport: AcpTransport, options: AcpTurnOptions): Promise<AcpTurnResult> {
    return runSession(transport, options, false);
}
/** No task prompt and no approved tool effects. ACP session creation does not validate a provider key. */
export async function probeAcpSession(transport: AcpTransport, options: AcpProbeOptions): Promise<AcpSessionProbeResult> {
    const result = await runSession(transport, { ...options, prompt: "", allowedToolKinds: [] }, true);
    return { ...result, promptSent: false, modelWorkRequested: false, providerCredentialValidated: false };
}
async function runSession(transport: AcpTransport, options: AcpTurnOptions, probeOnly: boolean): Promise<AcpTurnResult> {
    if (!options.cwd.startsWith("/") || !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
        throw new AcpError("ACP needs an absolute sandbox cwd and a positive timeout", "invalid-options");
    const redact = options.redact ?? ((text: string) => text), maxMessage = options.maxMessageBytes ?? 2 * 1024 * 1024, maxOutput = options.maxOutputBytes ?? 4 * 1024 * 1024;
    let serial = 0, sessionId: string | null = null, protocolVersion: number | null = null, agentInfo: Record<string, unknown> | null = null, capabilities: Record<string, any> = {}, authMethods: Record<string, any>[] = [], methodAttempted: string | null = null;
    let output = "", stderr = "", cancelled = false, timedOut = false, finished = false, failure: AcpError | undefined, totalBytes = 0;
    let receive = Promise.resolve(), eventQueue = Promise.resolve(), buffer = Buffer.alloc(0);
    const events: Record<string, unknown>[] = [], pending = new Map<number, {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
    }>();
    const scrub = (value: any): any => typeof value === "string" ? redact(value) : Array.isArray(value) ? value.map(scrub) : mapping(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), scrub(item)])) : value;
    const event = (type: string, fields: Record<string, unknown> = {}) => { const row = scrub({ type, at: new Date().toISOString(), ...fields }); events.push(row); eventQueue = eventQueue.then(async () => { await options.onEvent?.(row); }); };
    function fail(error: AcpError) { if (failure || finished)
        return; failure = error; for (const request of pending.values())
        request.reject(error); pending.clear(); }
    function send(value: unknown) { if (failure)
        throw failure; const text = JSON.stringify(value) + "\n"; transport.input.write(text, error => { if (error)
        fail(new AcpError(`ACP input closed: ${redact(error.message)}`, "transport-closed")); }); }
    function notify(method: string, params: unknown) { send({ jsonrpc: "2.0", method, params }); event("acp.notification.sent", { method }); }
    function request(method: string, params: unknown): Promise<any> {
        if (failure)
            return Promise.reject(failure);
        const id = ++serial;
        event("acp.request", { id, method });
        return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); try {
            send({ jsonrpc: "2.0", id, method, params });
        }
        catch (error) {
            pending.delete(id);
            reject(error);
        } });
    }
    function respond(id: string | number, result: unknown) { send({ jsonrpc: "2.0", id, result }); }
    function rejectRequest(id: string | number, code: number, message: string) { send({ jsonrpc: "2.0", id, error: { code, message } }); }
    async function message(raw: string) {
        let packet: any;
        try {
            packet = JSON.parse(raw);
        }
        catch {
            throw new AcpError("Agent emitted malformed JSON on ACP stdout", "malformed-json");
        }
        if (!mapping(packet) || packet.jsonrpc !== "2.0")
            throw new AcpError("Agent emitted an invalid JSON-RPC envelope");
        if (typeof packet.method === "string") {
            if (packet.id !== undefined && !validId(packet.id))
                throw new AcpError("Agent request has an invalid id");
            const params = packet.params ?? {};
            if (packet.method === "session/update") {
                if (packet.id !== undefined || !mapping(params) || params.sessionId !== sessionId || !mapping(params.update) || typeof params.update.sessionUpdate !== "string")
                    throw new AcpError("Malformed or cross-session ACP update");
                const update = params.update;
                if (update.sessionUpdate === "agent_message_chunk" && mapping(update.content) && update.content.type === "text") {
                    if (typeof update.content.text !== "string")
                        throw new AcpError("Malformed agent text chunk");
                    output += update.content.text;
                    if (Buffer.byteLength(output) > maxOutput)
                        throw new AcpError("Agent output exceeded its declared byte ceiling", "output-limit");
                }
                // Thought streams are not a deliverable and are not retained as private reasoning logs.
                event("acp.update", update.sessionUpdate === "agent_thought_chunk" ? { sessionId, update: { sessionUpdate: "agent_thought_chunk", contentOmitted: true } } : { sessionId, update });
                return;
            }
            if (packet.id === undefined) {
                event("acp.unknown-notification", { method: packet.method });
                return;
            }
            if (packet.method === "session/request_permission") {
                if (!mapping(params) || params.sessionId !== sessionId || !Array.isArray(params.options) || !mapping(params.toolCall)) {
                    rejectRequest(packet.id, -32602, "Invalid permission request/session");
                    return;
                }
                const allowed = new Set(options.allowedToolKinds ?? (options.role === "worker" ? ["read", "search", "edit", "execute"] : ["read", "search"]));
                const kind = params.toolCall.kind, accepted = !cancelled && typeof kind === "string" && allowed.has(kind), desired = accepted ? "allow_once" : "reject_once";
                const choice = params.options.find((candidate: any) => mapping(candidate) && candidate.kind === desired && typeof candidate.optionId === "string");
                const outcome = choice && !cancelled ? { outcome: "selected", optionId: choice.optionId } : { outcome: "cancelled" };
                event("acp.permission", { sessionId, toolCallId: params.toolCall.toolCallId ?? null, kind: kind ?? null, policy: accepted ? "declared-effect" : "denied", outcome });
                respond(packet.id, { outcome });
                return;
            }
            // No filesystem or terminal capability is advertised. Agent-side tools run in its sandbox.
            event("acp.request.refused", { method: packet.method });
            rejectRequest(packet.id, -32601, "Client capability not declared; host filesystem and terminal are unavailable");
            return;
        }
        if (!Number.isSafeInteger(packet.id) || !pending.has(packet.id))
            throw new AcpError("Unsolicited or duplicate ACP response id");
        if (("result" in packet) === ("error" in packet))
            throw new AcpError("ACP response must contain exactly one result or error");
        if ("error" in packet && (!mapping(packet.error) || !Number.isInteger(packet.error.code) || typeof packet.error.message !== "string"))
            throw new AcpError("Malformed ACP error");
        const waiting = pending.get(packet.id)!;
        pending.delete(packet.id);
        if ("error" in packet) {
            event("acp.response.error", { id: packet.id, error: packet.error });
            waiting.reject(new AcpError(redact(packet.error.message), packet.error.code === -32000 ? "authentication-required" : "agent-error", packet.error));
        }
        else {
            event("acp.response", { id: packet.id });
            waiting.resolve(packet.result);
        }
    }
    const data = (chunk: Buffer) => {
        if (finished || failure)
            return;
        totalBytes += chunk.length;
        if (totalBytes > maxOutput * 8) {
            fail(new AcpError("ACP stream exceeded its total byte ceiling", "output-limit"));
            return;
        }
        buffer = Buffer.concat([buffer, chunk]);
        let newline: number;
        while ((newline = buffer.indexOf(10)) >= 0) {
            const line = buffer.subarray(0, newline);
            buffer = buffer.subarray(newline + 1);
            if (line.length > maxMessage) {
                fail(new AcpError("ACP message exceeded its byte ceiling", "message-limit"));
                return;
            }
            if (!line.length)
                continue;
            receive = receive.then(() => message(line.toString("utf8"))).catch(error => fail(error instanceof AcpError ? error : new AcpError(redact(String(error)))));
        }
        if (buffer.length > maxMessage)
            fail(new AcpError("Unterminated ACP message exceeded its byte ceiling", "message-limit"));
    };
    const errors = (chunk: Buffer) => { if (Buffer.byteLength(stderr) + chunk.length > maxOutput) {
        stderr = "[stderr omitted: output ceiling exceeded before safe redaction]";
        fail(new AcpError("Agent stderr exceeded its byte ceiling", "output-limit"));
        return;
    } stderr += chunk.toString("utf8"); };
    transport.output.on("data", data);
    transport.errors?.on("data", errors);
    transport.exited.then(result => { receive.then(() => { if (!finished)
        fail(new AcpError(`Agent transport exited before the turn completed (${result.code ?? result.signal ?? "unknown"})`, "transport-closed")); }); }, error => fail(new AcpError(redact(String(error)), "transport-closed")));
    let cancellation: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => { if (cancelled || finished)
        return; cancelled = true; event("acp.cancel", { sessionId, reason: timedOut ? "timeout" : "cancelled" }); if (sessionId)
        try {
            notify("session/cancel", { sessionId });
        }
        catch { } cancellation = setTimeout(() => fail(new AcpError(timedOut ? "Agent deadline expired" : "Agent turn cancelled", timedOut ? "timeout" : "cancelled")), 300); };
    options.signal?.addEventListener("abort", cancel, { once: true });
    const deadline = setTimeout(() => { timedOut = true; cancel(); }, options.timeoutMs);
    let status: AcpTurnResult["status"] = "failed", stopReason = "protocol-error";
    try {
        if (options.signal?.aborted) {
            cancel();
            throw new AcpError("Agent turn cancelled before initialize", "cancelled");
        }
        const initialized = await request("initialize", { protocolVersion: 1, clientInfo: { name: "wringer", version: packageInfo.version }, clientCapabilities: {} });
        if (!mapping(initialized) || initialized.protocolVersion !== 1)
            throw new AcpError("Agent did not negotiate supported ACP protocol version 1", "unsupported-protocol");
        protocolVersion = initialized.protocolVersion;
        agentInfo = mapping(initialized.agentInfo) ? initialized.agentInfo : null;
        capabilities = mapping(initialized.agentCapabilities) ? initialized.agentCapabilities : {};
        if (initialized.authMethods !== undefined && (!Array.isArray(initialized.authMethods) || initialized.authMethods.some((method: any) => !mapping(method) || typeof method.id !== "string")))
            throw new AcpError("Malformed advertised authentication methods");
        authMethods = initialized.authMethods ?? [];
        event("acp.initialized", { protocolVersion, agentInfo, capabilities, authMethods });
        if (options.authMethod) {
            const method = authMethods.find(method => method.id === options.authMethod);
            if (!method)
                throw new AcpError("Declared authentication method was not advertised by the agent", "auth-method-unavailable");
            if (interactive(method))
                throw new AcpError("The agent's authentication method requires interactive account access. Its instructions are recorded; no supplied command was executed.", "interactive-auth-required", method);
            methodAttempted = method.id;
            await request("authenticate", { methodId: method.id });
            event("acp.auth-method-returned", { methodId: method.id, authenticatedClaim: false });
        }
        const session = await request("session/new", { cwd: options.cwd, mcpServers: [] });
        if (!mapping(session) || typeof session.sessionId !== "string" || !session.sessionId)
            throw new AcpError("Agent returned no usable session id");
        sessionId = session.sessionId;
        event("acp.session.opened", { sessionId });
        if (options.mode) {
            const available = session.modes?.availableModes;
            if (!Array.isArray(available) || !available.some((mode: any) => mode?.id === options.mode))
                throw new AcpError("Requested session mode was not advertised", "mode-unavailable");
            await request("session/set_mode", { sessionId, modeId: options.mode });
        }
        if (cancelled)
            throw new AcpError("Agent turn cancelled before prompt", timedOut ? "timeout" : "cancelled");
        if (probeOnly) {
            stopReason = "session-opened";
            status = "completed";
            event("acp.preflight.finished", { sessionId, promptSent: false, modelWorkRequested: false, providerCredentialValidated: false });
        } else {
            const names = options.credentialNames ?? [];
            if (!Array.isArray(names) || names.some(name => typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw new AcpError("Credential observations must contain environment names only");
            event("acp.prompt.preflight", { role: options.role, sessionId, credentialNames: names, methodAttempted, providerCredentialValidated: false, effectiveCredential: "not-attested", promptSent: false,
                words: `${options.role}-auth: ACP session opened. ${names.length ? `Runtime-selected credential/environment names: ${names.join(", ")}.` : "No role credential/environment variables were selected."} ${methodAttempted ? `Explicit authentication method ${methodAttempted} returned.` : "No successful explicit authentication method was observed."} Effective provider credential and key validity remain unverified; session creation is not provider authorization. No model prompt has yet been sent.` });
            // The pre-spend observation must reach the controller before the
            // side effect, including when its recorder is asynchronous.
            await eventQueue;
            if (cancelled) throw new AcpError("Agent turn cancelled after preflight", timedOut ? "timeout" : "cancelled");
            const response = await request("session/prompt", { sessionId, prompt: [{ type: "text", text: options.prompt }] });
            if (!mapping(response) || !["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"].includes(response.stopReason))
                throw new AcpError("Agent prompt returned no supported stop reason");
            stopReason = cancelled ? (timedOut ? "timeout" : "cancelled") : response.stopReason;
            status = cancelled || ["cancelled", "refusal", "max_tokens", "max_turn_requests"].includes(stopReason) ? "stopped" : "completed";
            event("acp.turn.finished", { sessionId, stopReason, status });
        }
        if (capabilities.sessionCapabilities?.close)
            await request("session/close", { sessionId });
    }
    catch (error) {
        const cause = error instanceof AcpError ? error : new AcpError(redact(String(error)));
        stopReason = cause.code;
        status = ["cancelled", "timeout", "authentication-required", "interactive-auth-required", "auth-method-unavailable"].includes(cause.code) ? "stopped" : "failed";
        event("acp.turn.stopped", { sessionId, reason: cause.code, message: cause.message, ...(cause.data ? { detail: cause.data } : {}) });
    }
    finally {
        finished = true;
        clearTimeout(deadline);
        if (cancellation)
            clearTimeout(cancellation);
        options.signal?.removeEventListener("abort", cancel);
        transport.output.off("data", data);
        transport.errors?.off("data", errors);
        await transport.terminate();
        await eventQueue;
    }
    return scrub({ status, text: output, sessionId, stopReason, protocolVersion, agentInfo, capabilities, authMethods, authentication: { methodAttempted, sessionOpened: sessionId !== null }, events, stderr });
}
