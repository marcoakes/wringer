import { expect, test } from "bun:test";
import { diagnoseWorkerOutcome } from "../src/worker-outcome";
import { withSecrets } from "../src/storage";

const base = "1".repeat(40), changed = "2".repeat(40);
const result = (extra: Record<string, unknown> = {}) => ({
    status: "completed" as const, stopReason: "end_turn", text: "", stderr: "", events: [] as Record<string, unknown>[],
    agentInfo: { name: "@agentclientprotocol/codex-acp", version: "1.10.0" }, ...extra,
});
// Safe synthetic envelope matching the failed alpha.3 run; no real key or request ID.
const providerReply = "unexpected status 401 Unauthorized: Incorrect API key provided: sk-proj-FAKE****************FAKE. You can find your API key at https://platform.openai.com/account/api-keys., url: https://api.openai.com/v1/responses, auth error: 401, auth error code: invalid_api_key";
const codexError = { type: "acp.update", update: { sessionUpdate: "session_info_update", _meta: { codex: { error: {
    message: "Reconnecting... 5/5", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 401 } },
    additionalDetails: providerReply, willRetry: true,
} } } } };

test("a completed Codex turn retaining a structured 401 stops before candidate capture", () => {
    const outcome = diagnoseWorkerOutcome({ result: result({ events: [codexError] }) });
    expect(outcome?.code).toBe("worker-auth-rejected");
    expect(outcome?.details).toMatchObject({ role: "worker", provider: "openai", basis: "structured-provider-error", sourceChanged: null, providerCredentialAttested: false });
    expect(outcome?.details.diagnostic).toContain("401 Unauthorized");
    expect(outcome?.details.diagnostic).toContain("invalid_api_key");
    expect(outcome?.details.diagnostic).not.toContain("FAKE");
    expect(outcome?.message).toContain("No automatic worker retry");
    expect(outcome?.message).toContain("OpenAI");
    expect(outcome?.message).toContain("invalid_api_key");
    expect(outcome?.message).not.toContain("FAKE");
});

test("authentication rejection takes priority over unchanged source and tool absence", () => {
    const outcome = diagnoseWorkerOutcome({ result: result({ events: [codexError] }), beforeTree: base, afterTree: base });
    expect(outcome?.code).toBe("worker-auth-rejected");
    expect(outcome?.details.sourceChanged).toBe(false);
    expect(outcome?.details.tools).toEqual({ source: "acp-updates", observedCalls: 0, complete: false });
    expect(outcome?.message).toContain("actual tool use is unknown");
});

test("a provider-shaped final reply diagnoses a reported failure only after unchanged capture", () => {
    const run = result({ text: providerReply });
    expect(diagnoseWorkerOutcome({ result: run })).toBeNull();
    const outcome = diagnoseWorkerOutcome({ result: run, beforeTree: base, afterTree: base });
    expect(outcome?.code).toBe("worker-auth-rejected");
    expect(outcome?.details.basis).toBe("reported-provider-error");
    expect(outcome?.details.providerCredentialAttested).toBe(false);
    expect(outcome?.details.diagnostic).not.toContain("FAKE");
});

test("quoted authentication examples cannot stop a changed candidate through prose", () => {
    expect(diagnoseWorkerOutcome({ result: result({ text: `Added a regression for this example: ${providerReply}` }), beforeTree: base, afterTree: changed })).toBeNull();
});

test("a tool result or session title containing a 401 is not a provider-auth report", () => {
    for (const update of [
        { sessionUpdate: "tool_call_update", toolCallId: "test", content: [{ type: "text", text: providerReply }] },
        { sessionUpdate: "session_info_update", title: providerReply },
    ]) {
        expect(diagnoseWorkerOutcome({ result: result({ events: [{ type: "acp.update", update }] }), beforeTree: base, afterTree: changed })).toBeNull();
    }
});

test("ordinary no-change with no telemetry is a progress stop, not an auth/security error", () => {
    const outcome = diagnoseWorkerOutcome({ result: result({ text: "I inspected the code but made no edits." }), beforeTree: base, afterTree: base });
    expect(outcome?.code).toBe("worker-no-change");
    expect(outcome?.details.tools).toEqual({ source: "unavailable", observedCalls: null, complete: false });
    expect(outcome?.details.provider).toBeNull();
    expect(outcome?.message).toContain("actual tool use is unknown");
    expect(outcome?.message).not.toContain("zero tool calls");
    expect(outcome?.details.diagnostic).toBe("I inspected the code but made no edits.");
});

test("missing or invalid tree identities cannot establish no change", () => {
    for (const afterTree of [undefined, null, "", "not-a-tree"]) {
        expect(diagnoseWorkerOutcome({ result: result(), beforeTree: afterTree, afterTree })).toBeNull();
    }
});

test("observed ACP tool IDs are deduplicated and never claimed exhaustive", () => {
    const events = [
        { type: "acp.update", update: { sessionUpdate: "tool_call", toolCallId: "one" } },
        { type: "acp.update", update: { sessionUpdate: "tool_call_update", toolCallId: "one" } },
        { type: "acp.update", update: { sessionUpdate: "tool_call_update", toolCallId: "two" } },
        { type: "acp.permission", toolCallId: "three" },
    ];
    const outcome = diagnoseWorkerOutcome({ result: result({ events }), beforeTree: base, afterTree: base });
    expect(outcome?.details.tools).toEqual({ source: "acp-updates", observedCalls: 2, complete: false });
    expect(outcome?.message).toContain("At least 2 distinct tool calls");
});

test("only complete supervisor instrumentation can establish exact zero tool calls", () => {
    const outcome = diagnoseWorkerOutcome({ result: result(), beforeTree: base, afterTree: base, toolTelemetry: { source: "supervisor", observedCalls: 0, complete: true } });
    expect(outcome?.message).toContain("recorded 0 tool calls with complete coverage");
    expect(() => diagnoseWorkerOutcome({ result: result(), beforeTree: base, afterTree: base, toolTelemetry: { source: "acp-updates", observedCalls: 0, complete: true } })).toThrow("Invalid worker tool telemetry");
});

test("complete observed zero tools stops even when source changed or was not captured", () => {
    for (const afterTree of [changed, undefined]) {
        const outcome = diagnoseWorkerOutcome({ result: result(), beforeTree: base, afterTree, toolTelemetry: { source: "supervisor", observedCalls: 0, complete: true } });
        expect(outcome?.code).toBe("worker-no-change");
        expect(outcome?.details.basis).toBe("zero-tools");
        expect(outcome?.details.sourceChanged).toBe(afterTree ? true : null);
        expect(outcome?.message).not.toContain("without a source change");
        expect(outcome?.message).toContain(afterTree ? "source changed" : "Source change was not established");
        expect(diagnoseWorkerOutcome({ result: result(), beforeTree: base, afterTree, toolTelemetry: { source: "acp-updates", observedCalls: 0, complete: false } })).toBeNull();
    }
});

test("existing stopped/failed ACP results retain their existing dispatch path", () => {
    for (const status of ["stopped", "failed"] as const)
        expect(diagnoseWorkerOutcome({ result: { ...result({ text: providerReply, events: [codexError] }), status }, beforeTree: base, afterTree: base })).toBeNull();
});

test("generic JSON-RPC failure or unrelated HTTP rejection is not called provider authentication", () => {
    for (const error of [
        { code: -32000, message: "The test endpoint responded 401 Unauthorized." },
        { code: -32000, message: "Repository permission denied", data: { status: 403 } },
    ]) {
        const outcome = diagnoseWorkerOutcome({ result: result({ events: [{ type: "acp.response.error", error }] }), beforeTree: base, afterTree: base });
        expect(outcome?.code).toBe("worker-no-change");
    }
});

test("structured provider error data can identify Anthropic without treating prose as attestation", () => {
    const outcome = diagnoseWorkerOutcome({ result: result({ events: [{ type: "acp.response.error", error: {
        code: -32603, message: "authentication_error at https://api.anthropic.com/v1/messages", data: { httpStatusCode: 401, type: "authentication_error" },
    } }] }) });
    expect(outcome?.code).toBe("worker-auth-rejected");
    expect(outcome?.details.provider).toBe("anthropic");
});

test("diagnostics redact secret values and provider-masked fragments before truncation", async () => {
    const secret = "a-safe-fake-opaque-secret-used-only-by-this-test";
    await withSecrets([secret], async () => {
        const run = result({ text: `${secret} ${providerReply} Authorization: Bearer another-fake-token https://user:fakepass@api.openai.com/v1/responses?api_key=QUERY_FAKE#FRAGMENT_FAKE ${"x".repeat(1800)}` });
        const outcome = diagnoseWorkerOutcome({ result: run, beforeTree: base, afterTree: base });
        const retained = JSON.stringify(outcome);
        for (const hidden of [secret, "FAKE", "fakepass", "another-fake-token"])
            expect(retained).not.toContain(hidden);
        expect(outcome?.details.diagnostic).toContain("[diagnostic truncated]");
        expect(outcome?.details.diagnostic?.length).toBeLessThan(1250);
    });
});
