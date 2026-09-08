import type { RoleExecutionResult } from "@wringer/runtime";
import { scrub } from "./storage";

type WorkerResult = Pick<RoleExecutionResult, "status" | "stopReason" | "text" | "stderr" | "events" | "agentInfo">;
export interface WorkerToolTelemetry {
    source: "supervisor" | "acp-updates" | "unavailable";
    /** A lower bound unless the supervisor explicitly establishes complete coverage. */
    observedCalls: number | null;
    complete: boolean;
}
export interface WorkerOutcomeStop {
    code: "worker-auth-rejected" | "worker-no-change";
    message: string;
    details: {
        role: "worker";
        agent: string | null;
        provider: "openai" | "anthropic" | null;
        basis: "structured-provider-error" | "reported-provider-error" | "unchanged-source" | "zero-tools";
        diagnostic: string | null;
        sourceChanged: boolean | null;
        tools: WorkerToolTelemetry;
        /** No provider identity/key validity is inferred from an adapter's account. */
        providerCredentialAttested: false;
    };
}
interface WorkerOutcomeInput {
    result: WorkerResult;
    /** Omit for the early structured-auth check before candidate capture. */
    beforeTree?: string | null;
    afterTree?: string | null;
    toolTelemetry?: WorkerToolTelemetry;
}
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const tree = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value);

/** Runtime secret redaction runs first; scrub common provider-masked key echoes too. */
function diagnostic(text: string): string {
    const clean = scrub(text)
        .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
        .replace(/(\b(?:api[-_ ]?key|x-api-key|access[-_ ]?token|authorization)\s*(?:provided|value)?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, (_match, prefix: string) => `${prefix}[REDACTED]`)
        .replace(/\bsk-[A-Za-z0-9_*-]+/g, "[REDACTED]")
        .replace(/(?:https?|wss?):\/\/[^\s<>()]+/g, value => {
            try { const url = new URL(value); return `${url.protocol}//${url.host}${url.pathname}`; }
            catch { return "[URL omitted]"; }
        })
        .replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    // Redact the entire string before limiting the retained diagnostic.
    return clean.length <= 1200 ? clean : `${clean.slice(0, 1200)} [diagnostic truncated]`;
}
function providerOf(text: string): WorkerOutcomeStop["details"]["provider"] {
    if (/(?:https?|wss?):\/\/api\.openai\.com\//i.test(text)) return "openai";
    if (/https?:\/\/api\.anthropic\.com\//i.test(text)) return "anthropic";
    return null;
}
function errorText(error: Record<string, any>): string {
    return [error.message, error.additionalDetails, object(error.data) ? error.data.message : null]
        .filter((value): value is string => typeof value === "string").join("\n");
}
function structuredAuth(result: WorkerResult): { provider: WorkerOutcomeStop["details"]["provider"]; text: string } | null {
    for (const event of result.events) {
        // Do not scan arbitrary tool contents, session titles, thoughts or task prose.
        const codexError = event.type === "acp.update" && object(event.update) && event.update.sessionUpdate === "session_info_update"
            ? event.update._meta?.codex?.error : null;
        if (object(codexError) && codexError.codexErrorInfo?.responseStreamDisconnected?.httpStatusCode === 401)
            return { provider: "openai", text: errorText(codexError) || "Codex ACP reported HTTP 401 in its provider response stream." };
        if (event.type !== "acp.response.error" || !object(event.error)) continue;
        const error = event.error, data = object(error.data) ? error.data : {};
        const text = errorText(error), status = data.httpStatusCode ?? data.statusCode ?? data.status;
        // JSON-RPC -32000 alone is not a provider-authentication diagnosis.
        if (status === 401 && /invalid_api_key|authentication_error|incorrect api key|invalid (?:api|x-api)[- ]key/i.test(`${data.code ?? ""} ${data.type ?? ""} ${text}`))
            return { provider: providerOf(text), text: text || "The ACP error reported HTTP 401 and a provider authentication error." };
    }
    return null;
}
function observedTools(result: WorkerResult, supplied?: WorkerToolTelemetry): WorkerToolTelemetry {
    if (supplied) {
        if (!["supervisor", "acp-updates", "unavailable"].includes(supplied.source)
            || supplied.observedCalls !== null && (!Number.isSafeInteger(supplied.observedCalls) || supplied.observedCalls < 0)
            || typeof supplied.complete !== "boolean"
            || supplied.complete && (supplied.source !== "supervisor" || supplied.observedCalls === null)
            || supplied.source === "unavailable" && (supplied.observedCalls !== null || supplied.complete))
            throw new Error("Invalid worker tool telemetry; missing coverage cannot establish zero tool calls.");
        return { ...supplied };
    }
    if (!result.events.length) return { source: "unavailable", observedCalls: null, complete: false };
    const ids = new Set<string>();
    let anonymous = false;
    for (const event of result.events) {
        if (event.type !== "acp.update" || !object(event.update) || !["tool_call", "tool_call_update"].includes(event.update.sessionUpdate)) continue;
        if (typeof event.update.toolCallId === "string" && event.update.toolCallId) ids.add(event.update.toolCallId);
        else anonymous = true;
    }
    // ACP updates report observations, not exhaustive instrumentation of internal tools.
    return { source: "acp-updates", observedCalls: Math.max(ids.size, anonymous ? 1 : 0), complete: false };
}
function toolWords(tools: WorkerToolTelemetry): string {
    if (tools.complete) return `The supervisor recorded ${tools.observedCalls} tool calls with complete coverage.`;
    if (tools.observedCalls === null) return "Tool telemetry is unavailable; actual tool use is unknown.";
    if (tools.observedCalls === 0) return "No tool-call updates were recorded; actual tool use is unknown.";
    return `At least ${tools.observedCalls} distinct tool calls were observed; unreported tool use is unknown.`;
}

/**
 * Diagnose a completed transport turn without treating it as completed work.
 * The caller retains the result and this diagnostic, then stops automatic dispatch.
 * This helper does not mutate the frozen ACP result or attest provider credentials.
 * Production ACP updates do not currently establish complete supervisor tool coverage.
 */
export function diagnoseWorkerOutcome({ result, beforeTree, afterTree, toolTelemetry }: WorkerOutcomeInput): WorkerOutcomeStop | null {
    if (result.status !== "completed") return null;
    const sourceChanged = tree(beforeTree) && tree(afterTree) ? beforeTree !== afterTree : null;
    const tools = observedTools(result, toolTelemetry);
    const common = {
        role: "worker" as const,
        agent: typeof result.agentInfo?.name === "string" ? diagnostic(result.agentInfo.name).slice(0, 160) : null,
        sourceChanged, tools, providerCredentialAttested: false as const,
    };
    const structured = structuredAuth(result);
    // Some adapters put a final provider failure in their reply yet return end_turn.
    // Text alone is only a reported diagnostic, and only stops an unchanged candidate.
    const reported = sourceChanged === false ? [result.text, result.stderr].find(text =>
        /(?:unexpected\s+status\s+401\s+Unauthorized|(?:HTTP|status(?:\s+code)?)\s*[:=]?\s*401\b)/i.test(text)
        && /invalid_api_key|authentication_error|incorrect api key|invalid (?:api|x-api)[- ]key/i.test(text)
        && providerOf(text) !== null) : undefined;
    if (structured || reported) {
        const text = structured?.text ?? reported!;
        const provider = structured?.provider ?? providerOf(text), retainedDiagnostic = diagnostic(text);
        const providerName = provider === "openai" ? "an OpenAI" : provider === "anthropic" ? "an Anthropic" : "a provider";
        return {
            code: "worker-auth-rejected",
            message: `The worker reported ${providerName} authentication rejection (HTTP 401). Reported diagnostic: ${retainedDiagnostic} No automatic worker retry is allowed. Check the worker provider credential before an explicit retry. ${toolWords(tools)} This records the runtime's report, not independent proof of which credential was used.`,
            details: { ...common, provider, basis: structured ? "structured-provider-error" : "reported-provider-error", diagnostic: retainedDiagnostic },
        };
    }
    const zeroTools = tools.complete && tools.observedCalls === 0;
    if (sourceChanged !== false && !zeroTools) return null;
    const sourceWords = sourceChanged === false ? "The worker turn ended without a source change." : sourceChanged === true ? "The source changed, but the completed worker turn has no tool use under complete supervisor coverage. Reconcile the change before another attempt." : "The worker turn ended with no tool use under complete supervisor coverage. Source change was not established.";
    return {
        code: "worker-no-change",
        message: `${sourceWords} ${toolWords(tools)} No automatic worker retry is allowed. Inspect the recorded worker reply and environment before authorizing another attempt; this is not a claim of an authentication or security failure.`,
        details: { ...common, provider: null, basis: sourceChanged === false ? "unchanged-source" : "zero-tools", diagnostic: diagnostic(result.text || result.stderr) || null },
    };
}
