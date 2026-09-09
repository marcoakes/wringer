import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { DesignError, type DesignMcpInput, type DesignImportOptions, type DesignHttpRequest, type DesignHttpResponse, type DesignSnapshotV1, type DesignAsset } from "./types";
import { assertNoDesignSecrets, designCanonicalJson, designPngAsset, hashDesignBytes, sealDesignSnapshot } from "./snapshot";

const FIGMA_TOOLS = new Set(["get_design_context", "get_screenshot", "get_metadata", "get_variable_defs", "get_code_connect_map"]);
const FORBIDDEN_TOOL = /(?:^|[_-])(?:write|create|update|delete|remove|set|add|publish|post|send|execute|exec|run|install|upload|save|apply|generate|capture|connect|authorize|authenticate|login)(?:[_-]|$)/i;
const mapping = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const hashJson = (v: unknown) => hashDesignBytes(designCanonicalJson(v));
/** IPv4-only pinned routes. Private, local, link-local, documentation, multicast and reserved ranges are refused. */
export function isPublicDesignAddress(address: string): boolean {
    if (isIP(address) !== 4) return false;
    const [a, b, c] = address.split(".").map(Number) as [number, number, number, number];
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}
export function validateDesignEndpoint(raw: string, provider: "figma" | "generic-mcp"): URL {
    let u: URL; try { u = new URL(raw); } catch { throw new DesignError("Design MCP endpoint must be an explicit public HTTPS URL.", "design-endpoint-refused"); }
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.port && u.port !== "443" || isIP(u.hostname) || !u.hostname.includes(".") || u.hostname.endsWith(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(u.hostname) || !/^[a-z0-9.-]+$/.test(u.hostname)) throw new DesignError("Design MCP needs public HTTPS on port 443, without credentials, query, redirects or local addresses.", "design-endpoint-refused");
    if (provider === "figma" && u.href !== "https://mcp.figma.com/mcp") throw new DesignError("Figma imports use the official remote endpoint https://mcp.figma.com/mcp. Desktop localhost forwarding is not enabled.", "design-endpoint-refused");
    return u;
}
async function pinnedHttps(input: DesignHttpRequest): Promise<DesignHttpResponse> {
    const u = validateDesignEndpoint(input.url, "generic-mcp");
    const addresses = await lookup(u.hostname, { all: true, family: 4 });
    if (!addresses.length || addresses.some(a => !isPublicDesignAddress(a.address))) throw new DesignError("Design endpoint resolves to a non-public address; no connection was made.", "design-endpoint-refused");
    const address = addresses[0]!.address;
    if (input.signal.aborted) throw new DesignError("Design import deadline expired.", "design-timeout");
    return await new Promise((resolve, reject) => {
        const req = httpsRequest(u, { method: "POST", headers: input.headers, signal: input.signal, maxHeaderSize: 8192, lookup: (_hostname, options: any, callback: any) => { if (options.all) callback(null, [{ address, family: 4 }]); else callback(null, address, 4); } }, res => {
            const chunks: Buffer[] = []; let length = 0;
            const headers = Object.fromEntries(Object.entries(res.headers).flatMap(([k,v]) => typeof v === "string" ? [[k.toLowerCase(), v]] : []));
            const finish = () => resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString("utf8") });
            res.on("data", (chunk: Buffer) => {
                length += chunk.length;
                if (length > input.maxBytes) { const error = new DesignError("Design MCP response exceeded its byte ceiling.", "design-response-limit"); res.destroy(error); req.destroy(error); }
                else {
                    chunks.push(chunk);
                    // Streamable HTTP can keep SSE open after the matching reply.
                    // Stop at a complete matching event instead of waiting for EOF.
                    if (headers["content-type"]?.includes("text/event-stream")) {
                        const text = Buffer.concat(chunks).toString("utf8").replaceAll("\r\n", "\n"), last = text.lastIndexOf("\n\n");
                        if (last >= 0) {
                            const complete = text.slice(0, last + 2), id = JSON.parse(input.body).id;
                            try { rpcPacket({ status: res.statusCode ?? 0, headers, body: complete }, id); chunks.length = 0; chunks.push(Buffer.from(complete)); finish(); res.destroy(); }
                            catch (error) { if (error instanceof DesignError && error.code === "design-service-refused") { finish(); res.destroy(); } }
                        }
                    }
                }
            });
            res.on("error", reject);
            res.on("end", finish);
        });
        req.on("error", error => reject(error instanceof DesignError ? error : new DesignError(input.signal.aborted ? "Design import deadline expired; no incomplete snapshot was retained." : "Could not reach the approved design endpoint. Check service access and connectivity; no incomplete snapshot was retained.", input.signal.aborted ? "design-timeout" : "design-connection-failed")));
        req.end(input.body);
    });
}
function rpcPacket(response: DesignHttpResponse, id: number) {
    const contentType = response.headers["content-type"] ?? "";
    let packets: unknown[];
    try {
        if (contentType.includes("text/event-stream")) {
            packets = response.body.replaceAll("\r\n", "\n").split("\n\n").filter(block => block.split("\n").some(line => line.startsWith("data:"))).map(block => JSON.parse(block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n")));
        } else if (contentType.includes("application/json")) packets = [JSON.parse(response.body)];
        else throw new Error();
    } catch { throw new DesignError("Design MCP returned malformed JSON/SSE, not a measured result.", "design-protocol-error"); }
    const matching = packets.filter((p: any) => mapping(p) && p.jsonrpc === "2.0" && p.id === id);
    if (matching.length !== 1 || packets.some((p: any) => !mapping(p) || p.jsonrpc !== "2.0" || p.id !== undefined && p.id !== id)) throw new DesignError("Design MCP response identity is missing, duplicated or unexpected.", "design-protocol-error");
    const p = matching[0] as Record<string, any>;
    if (("result" in p) === ("error" in p)) throw new DesignError("Design MCP response needs exactly one result or error.", "design-protocol-error");
    if ("error" in p) throw new DesignError("The design service refused this request. Check approved-client eligibility, account permissions and tool arguments. No success or snapshot was inferred.", "design-service-refused");
    return p.result;
}
function validateInput(input: DesignMcpInput) {
    if (!mapping(input) || Object.keys(input).some(k => !["provider","endpoint","title","source","disclosure","recipe","componentRules","token","limits"].includes(k)) || !["figma","generic-mcp"].includes(input.provider) || !mapping(input.source) || Object.keys(input.source).some(k => !["label","fileKey","nodeId","version"].includes(k)) || typeof input.source.label !== "string" || !input.source.label.trim() || input.source.label.length > 500 || !["private","repository-permitted"].includes(input.disclosure)) throw new DesignError("An explicit design provider, source and disclosure decision are required; unknown settings are refused.");
    if (input.limits !== undefined && (!mapping(input.limits) || Object.keys(input.limits).some(k => !["timeoutMs","maxCalls","maxResponseBytes"].includes(k)))) throw new DesignError("Unknown design import limit.");
    const endpoint = validateDesignEndpoint(input.endpoint, input.provider);
    if (!Array.isArray(input.recipe) || !input.recipe.length || input.recipe.length > 12) throw new DesignError("Declare one to twelve exact read-tool calls.");
    for (const step of input.recipe) {
        if (!mapping(step) || Object.keys(step).some(k => !["tool","arguments"].includes(k)) || typeof step.tool !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/.test(step.tool) || !mapping(step.arguments) || FORBIDDEN_TOOL.test(step.tool) || input.provider === "figma" && !FIGMA_TOOLS.has(step.tool) || input.provider === "generic-mcp" && !/^(?:get|read|list|search|inspect|fetch)[_.-]/i.test(step.tool)) throw new DesignError("Only explicitly named read tools are accepted; write, code-generation and unknown Figma tools are refused.", "design-write-refused");
        if (Buffer.byteLength(designCanonicalJson(step.arguments)) > 32 * 1024) throw new DesignError("Design tool arguments exceed their byte ceiling.");
        if (input.provider === "figma" && (!input.source.fileKey || !input.source.nodeId || step.arguments.fileKey !== input.source.fileKey || step.arguments.nodeId !== input.source.nodeId)) throw new DesignError("Every Figma read must name exactly the approved fileKey and nodeId.", "design-source-mismatch");
        if (input.provider === "figma" && step.tool === "get_screenshot" && step.arguments.enableBase64Response !== true) throw new DesignError("Declare enableBase64Response: true for Figma get_screenshot. This importer retains inline PNG evidence and does not follow screenshot URLs.", "design-inline-image-required");
    }
    if (input.token !== undefined && (typeof input.token !== "string" || !input.token.trim() || input.token.length > 16384 || /[\r\n\0]/.test(input.token))) throw new DesignError("The design token must be supplied through the explicit secret channel.");
    const { token: _token, ...nonsecret } = input; assertNoDesignSecrets(nonsecret, input.token ? [input.token] : []);
    const bounded = (value: number | undefined, fallback: number, low: number, high: number) => { const v = value ?? fallback; if (!Number.isInteger(v) || v < low || v > high) throw new DesignError("Design import limits must be explicit bounded integers."); return v; };
    return { endpoint: endpoint.href, timeoutMs: bounded(input.limits?.timeoutMs, 30000, 1, 60000), maxCalls: bounded(input.limits?.maxCalls, 12, 1, 12), maxResponseBytes: bounded(input.limits?.maxResponseBytes, 8 * 1024 * 1024, 1024, 12 * 1024 * 1024) };
}
/** Fixed, explicitly approved read recipe; never an agent/model execution loop. */
export async function importDesignFromMcp(input: DesignMcpInput, options: DesignImportOptions = {}): Promise<DesignSnapshotV1> {
    const limits = validateInput(input);
    if (input.recipe.length > limits.maxCalls) throw new DesignError("The read recipe exceeds its approved call budget.", "design-call-limit");
    const signal = AbortSignal.timeout(limits.timeoutMs), transport = options.testTransport ?? pinnedHttps;
    let serial = 0, session: string | undefined, total = 0;
    async function request(method: string, params: unknown, notification = false) {
        if (signal.aborted) throw new DesignError("Design import deadline expired.", "design-timeout");
        const id = ++serial, body = JSON.stringify({ jsonrpc: "2.0", ...(!notification ? { id } : {}), method, params });
        const headers: Record<string,string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26", ...(session ? { "Mcp-Session-Id": session } : {}), ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}) };
        let response: DesignHttpResponse, abortListener: (() => void) | undefined;
        try {
            response = await Promise.race([transport({ url: limits.endpoint, headers, body, maxBytes: limits.maxResponseBytes, signal }), new Promise<never>((_resolve, reject) => { abortListener = () => reject(new DesignError("Design import deadline expired.", "design-timeout")); signal.addEventListener("abort", abortListener, { once: true }); })]);
        } catch (error) { if (error instanceof DesignError) throw error; throw new DesignError("Design endpoint request failed; no response or credentials were retained.", "design-connection-failed"); }
        finally { if (abortListener) signal.removeEventListener("abort", abortListener); }
        total += Buffer.byteLength(response.body);
        if (Buffer.byteLength(response.body) > limits.maxResponseBytes || total > 24 * 1024 * 1024) throw new DesignError("Design response or whole-import byte ceiling exceeded.", "design-response-limit");
        if (response.status >= 300 && response.status < 400) throw new DesignError("Design endpoint redirects are refused; approve the exact public endpoint instead.", "design-redirect-refused");
        if (response.status === 401 || response.status === 403) throw new DesignError(input.provider === "figma" ? "Figma access was refused. An OAuth token alone does not establish approved-client eligibility or file access. Use Figma's supported authorization flow; Wringer did not log in, substitute a client identity or retain a snapshot." : "Design service access was refused. Supply an explicitly authorized read credential; Wringer did not log in or retain a snapshot.", "design-access-refused");
        if (response.status < 200 || response.status >= 300) throw new DesignError(`Design service returned HTTP ${response.status}; no snapshot was retained.`, "design-service-refused");
        if (notification) { if (response.body.trim()) throw new DesignError("MCP notification unexpectedly returned content.", "design-protocol-error"); return undefined; }
        const receivedSession = response.headers["mcp-session-id"];
        if (receivedSession !== undefined) { if (!/^[A-Za-z0-9._~-]{1,256}$/.test(receivedSession) || session && session !== receivedSession) throw new DesignError("MCP session identity changed or is invalid.", "design-protocol-error"); session = receivedSession; }
        const result = rpcPacket(response, id); assertNoDesignSecrets(result, input.token ? [input.token] : []); return result;
    }
    const initialized = await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "wringer-design-import", version: "1.0.0" } });
    if (!mapping(initialized) || initialized.protocolVersion !== "2025-03-26" || !mapping(initialized.capabilities) || !mapping(initialized.capabilities.tools)) throw new DesignError("Design server did not negotiate the supported MCP tools protocol.", "design-protocol-error");
    await request("notifications/initialized", {}, true);
    const listing = await request("tools/list", {});
    if (!mapping(listing) || !Array.isArray(listing.tools) || listing.tools.length > 256 || listing.nextCursor) throw new DesignError("Design tools listing is incomplete or oversized; no read was attempted.", "design-protocol-error");
    for (const step of input.recipe) {
        const matches = listing.tools.filter((t: any) => mapping(t) && t.name === step.tool);
        if (matches.length !== 1 || matches[0].annotations?.readOnlyHint !== true || matches[0].annotations?.destructiveHint === true) throw new DesignError(`The server did not advertise ${step.tool} as an unambiguous read-only tool. No tool was called.`, "design-read-policy-refused");
    }
    const context: string[] = [], assets: DesignAsset[] = [], calls: DesignSnapshotV1["provenance"]["calls"] = [];
    let reportedVersion: string | null = null;
    for (const step of input.recipe) {
        const result = await request("tools/call", { name: step.tool, arguments: step.arguments });
        if (!mapping(result) || result.isError === true || !Array.isArray(result.content) || result.content.length > 64) throw new DesignError(`The design read ${step.tool} did not return successful bounded content. No snapshot was retained.`, "design-tool-failed");
        calls.push({ tool: step.tool, arguments_sha256: hashJson(step.arguments), response_sha256: hashJson(result) });
        for (const block of result.content) {
            if (!mapping(block)) throw new DesignError("Malformed MCP content block.", "design-protocol-error");
            if (block.type === "text" && typeof block.text === "string") { if (block.text.trim()) context.push(`[${step.tool}]\n${block.text}`); }
            else if (block.type === "image" && block.mimeType === "image/png" && typeof block.data === "string") { if (assets.length >= 8) throw new DesignError("Design import exceeded eight reference images."); assets.push(designPngAsset({ id: `reference-${assets.length + 1}`, title: `${input.source.label} — ${step.tool}`, pngBase64: block.data })); }
            else throw new DesignError("Design import accepts text and inline static PNG only. External resource links, executable HTML, SVG, audio and image downloads are not followed.", "design-content-refused");
        }
        if (result.structuredContent !== undefined) {
            if (!mapping(result.structuredContent)) throw new DesignError("Design structured content must be a JSON object.");
            if (Object.keys(result.structuredContent).length) context.push(`[${step.tool}: structured data]\n${designCanonicalJson(result.structuredContent)}`);
            const s = result.structuredContent.source;
            if (mapping(s) && input.source.fileKey && s.fileKey === input.source.fileKey && s.nodeId === input.source.nodeId && typeof s.version === "string" && s.version.trim()) {
                if (reportedVersion && reportedVersion !== s.version || input.source.version && input.source.version !== s.version) throw new DesignError("Design reads returned inconsistent or unexpected source versions.", "design-source-mismatch");
                reportedVersion = s.version;
            }
        }
    }
    return sealDesignSnapshot({ schema_version: "wringer.design-snapshot.v1", title: input.title ?? input.source.label, source: { provider: input.provider, label: input.source.label, endpoint: limits.endpoint, file_key: input.source.fileKey ?? null, node_id: input.source.nodeId ?? null, version: reportedVersion ?? input.source.version ?? null, version_basis: reportedVersion ? "reported" : input.source.version ? "operator-declared" : "capture-only" }, captured_at: (options.now?.() ?? new Date()).toISOString(), disclosure: input.disclosure, context: context.join("\n\n"), component_rules: input.componentRules ?? [], assets, provenance: { method: "mcp-read", calls, limits: ["A fixed read recipe was executed; no agent/model prompt was sent by the importer.", "Read-only tool annotations are server assertions, not independent proof that a remote server performed no side effects.", "Imported design text is untrusted reference data, never execution instructions or approval authority.", "The snapshot pins captured bytes. Without a reported immutable version, the remote design may subsequently change.", "Access success does not attest OAuth client approval, ownership, design correctness or image privacy.", "Inline PNGs may contain private information. Repository disclosure is an explicit operator decision."] } });
}
