import { describe, expect, test } from "bun:test";
import { ASSISTANT_TOOLS, ASSISTANT_TOOL_NAMES, AssistantToolValidationError, parseAssistantToolCall, type AssistantToolName } from "../src/contract";

const guard = () => ({ jobId: "job_123", idempotencyKey: crypto.randomUUID(), expectedRevision: "a".repeat(64), expectedCandidateTree: "b".repeat(40) });
const valid: Record<string, Record<string, unknown>> = {
    "wringer.inspect_design": {},
    "wringer.prepare_design_import": { workspaceId: "workspace_123", idempotencyKey: crypto.randomUUID(), urls: ["https://www.figma.com/design/ExampleFile/Reports?node-id=1-2"] },
    "wringer.get_design_import": { importId: "import_123" },
    "wringer.inspect_setup": {},
    "wringer.inspect_improvements": {},
    "wringer.propose": { workspaceId: "workspace_123", idempotencyKey: crypto.randomUUID(), intent: "Make the summary readable.", plan: null, assumptions: ["Keep the recorded format."], questions: ["Who will read this?"] },
    "wringer.get_approval_request": { jobId: "job_123" },
    "wringer.start": guard(),
    "wringer.get_status": {},
    "wringer.wait_for_update": { jobId: "job_123", afterEventId: "a".repeat(64), timeoutSeconds: 25 },
    "wringer.get_evidence": { jobId: "job_123", evidenceId: "summary", offset: 0, limit: 8192 },
    "wringer.request_revision": { ...guard(), note: "Please preserve my wording — exactly." },
    "wringer.continue": { ...guard(), action: "resume" },
    "wringer.cancel": guard(),
    "wringer.prepare_handover": guard(),
};

describe("narrow assistant tool contract", () => {
    test("exactly fifteen tools including bounded design requests; no human pen, publication, credentials, scope or arbitrary execution route", () => {
        expect(ASSISTANT_TOOLS.map(t => t.name)).toEqual([...ASSISTANT_TOOL_NAMES]);
        expect(ASSISTANT_TOOLS).toHaveLength(15);
        for (const name of ["wringer.approve", "wringer.record_human_verdict", "wringer.publish", "wringer.execute", "wringer.get_key", "wringer.grant_authority", "wringer.increase_budget", "wringer.read_file", "wringer.retry_uncertain", "constructor"]) {
            expect(() => parseAssistantToolCall(name, {})).toThrow(AssistantToolValidationError);
        }
    });
    test("every listed schema accepts its intended inert request without changing the person's words", () => {
        for (const [name, args] of Object.entries(valid)) expect(parseAssistantToolCall(name, args)).toEqual({ name: name as AssistantToolName, args });
        expect(parseAssistantToolCall("wringer.request_revision", valid["wringer.request_revision"]).args.note).toBe("Please preserve my wording — exactly.");
        expect(parseAssistantToolCall("wringer.propose", { workspaceId: "ws", idempotencyKey: crypto.randomUUID(), intent: "What should we build?" }).args.intent).toBe("What should we build?");
        expect(parseAssistantToolCall("wringer.start", { ...guard(), expectedCandidateTree: null }).args.expectedCandidateTree).toBeNull();
        expect(parseAssistantToolCall("wringer.start", { ...guard(), expectedCandidateTree: "a".repeat(64) }).args.expectedCandidateTree).toBe("a".repeat(64));
    });
    test("unknown arguments and null/array arguments fail closed for every tool", () => {
        for (const [name, args] of Object.entries(valid)) {
            for (const bad of [null, [], { ...args, approve: true }, { ...args, by: "Marc" }, { ...args, execute: "touch /tmp/unsafe" }, { ...args, destinationId: "elsewhere" }, { ...args, apiKey: "a-secret-value" }])
                expect(() => parseAssistantToolCall(name, bad)).toThrow(AssistantToolValidationError);
        }
    });
    test("handles cannot become files, URLs, flags or executable snippets", () => {
        for (const handle of ["..", "../outside", "/tmp/state", "C:\\state", "file:///tmp/state", "job;echo", "$(env)", "a%2fb", "", "a".repeat(129)]) {
            expect(() => parseAssistantToolCall("wringer.get_status", { jobId: handle })).toThrow();
            expect(() => parseAssistantToolCall("wringer.get_evidence", { jobId: "valid", evidenceId: handle })).toThrow();
            expect(() => parseAssistantToolCall("wringer.inspect_setup", { workspaceId: handle })).toThrow();
        }
    });
    test("every mutation requires idempotency and exact revision/candidate guards", () => {
        for (const name of ["wringer.start", "wringer.request_revision", "wringer.continue", "wringer.cancel", "wringer.prepare_handover"]) {
            for (const field of Object.keys(guard())) {
                const args = { ...valid[name] }; delete args[field];
                expect(() => parseAssistantToolCall(name, args)).toThrow();
            }
            for (const bad of [{ idempotencyKey: "repeat-me" }, { expectedRevision: "HEAD" }, { expectedRevision: "A".repeat(64) }, { expectedCandidateTree: "latest" }, { expectedCandidateTree: "abcd123" }])
                expect(() => parseAssistantToolCall(name, { ...valid[name], ...bad })).toThrow();
        }
    });
    test("uncertain effect replay is not an ordinary assistant recovery action", () => {
        for (const action of ["retry-uncertain", "approve", "publish", "change-authority", "new-grant"])
            expect(() => parseAssistantToolCall("wringer.continue", { ...guard(), action })).toThrow();
        for (const action of ["resume", "retry-verification", "retry-judge", "retry-stopped"])
            expect(parseAssistantToolCall("wringer.continue", { ...guard(), action }).args.action).toBe(action);
    });
    test("bounded evidence pages and proposal notes cannot request an unlimited dump", () => {
        for (const value of [-1, 1.5, 1048577, "1", null]) expect(() => parseAssistantToolCall("wringer.get_evidence", { jobId: "job", evidenceId: "summary", offset: value })).toThrow();
        for (const value of [0, -1, 8193, 1.5, "all", null]) expect(() => parseAssistantToolCall("wringer.get_evidence", { jobId: "job", evidenceId: "summary", limit: value })).toThrow();
        for (const bad of [{ questions: Array(33).fill("question") }, { assumptions: ["a".repeat(4097)] }, { intent: "a".repeat(16385) }, { intent: "🧭".repeat(5000) }, { questions: ["🧭".repeat(2000)] }, { plan: "(()=>process.exit())()" }])
            expect(() => parseAssistantToolCall("wringer.propose", { ...valid["wringer.propose"], ...bad })).toThrow();
    });
    test("any explicit cash-limit request is a named refusal, including zero, null and false", () => {
        for (const strictCashLimit of [0, null, false, 50, "GBP 50", { currency: "GBP", amount: 50 }]) {
            try { parseAssistantToolCall("wringer.propose", { ...valid["wringer.propose"], strictCashLimit }); throw new Error("Expected refusal"); }
            catch (error) { expect(error).toBeInstanceOf(AssistantToolValidationError); expect((error as AssistantToolValidationError).code).toBe("strict-cash-unavailable"); }
        }
    });
});
