import type { DraftRequest } from "../../src/types";
import { object, scrub, scrubValue } from "../../src/storage";
// Historical HTTP protocol fixture only. Not exported by the shipped workflow.
const MESSAGES = { path: /\/v1\/messages\/?$/, key: "x-api-key", versionHeader: "anthropic-version", version: "2023-06-01", stop: "end_turn" };
export function prepareRequest(endpoint: string, request: DraftRequest & {
    temperature?: number;
}): {
    body: unknown;
    headers: Record<string, string>;
    keyHeader: string;
    keyPrefix: string;
    protocol: "messages" | "chat-completions";
} {
    // Redaction precedes protocol conversion, hashing, disk capture and send.
    // A credential prefix can overlap ordinary system-prompt wording too.
    request = scrubValue(request);
    const url = new URL(endpoint);
    if (MESSAGES.path.test(url.pathname)) {
        return { protocol: "messages", body: { model: request.model, max_tokens: request.max_tokens, system: request.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n"), messages: request.messages.filter(m => m.role !== "system") }, headers: { "Content-Type": "application/json", [MESSAGES.versionHeader]: MESSAGES.version }, keyHeader: MESSAGES.key, keyPrefix: "" };
    }
    return { protocol: "chat-completions", body: request, headers: { "Content-Type": "application/json" }, keyHeader: "Authorization", keyPrefix: "Bearer " };
}
export function normalizeResponse(raw: unknown): unknown {
    const value = object(raw, "model response");
    if (!Array.isArray(value.content))
        return raw;
    const content = value.content.filter(v => v && typeof v === "object" && (v as any).type === "text").map(v => (v as any).text).join("\n");
    const usage = value.usage && typeof value.usage === "object" ? value.usage as Record<string, unknown> : {};
    const input = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
    const output = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
    return { choices: [{ finish_reason: value.stop_reason === MESSAGES.stop ? "stop" : value.stop_reason, message: { content } }], usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input !== undefined && output !== undefined ? input + output : undefined } };
}
export class HttpFailure extends Error {
    constructor(public status: number, public body: string) { super(`Model endpoint returned HTTP ${status}: ${scrub(body).slice(0, 2000)}`); }
}
export async function sendModel(request: DraftRequest & {
    temperature?: number;
}, init: {
    endpoint: string;
    apiKey?: string;
    signal: AbortSignal;
}): Promise<unknown> {
    init.signal.throwIfAborted();
    const prepared = prepareRequest(init.endpoint, request);
    const response = await fetch(init.endpoint, { method: "POST", headers: { ...prepared.headers, ...(init.apiKey ? { [prepared.keyHeader]: prepared.keyPrefix + init.apiKey } : {}) }, body: JSON.stringify(prepared.body, null, 2) + "\n", signal: init.signal, redirect: "error" });
    const reader = response.body?.getReader();
    if (!reader)
        throw new Error("Model endpoint returned no response body");
    const chunks: Uint8Array[] = [];
    let count = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        count += value.byteLength;
        if (count > 8000000) {
            await reader.cancel();
            throw new Error("Model response exceeded the 8 MB evidence limit; spend outcome is uncertain");
        }
        chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!response.ok)
        throw new HttpFailure(response.status, text);
    return JSON.parse(text);
}
