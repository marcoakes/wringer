/** The trajectory view renders what a role did from retained ACP updates, with the
 * field shapes measured on the pinned adapters (docs/improvement/PHASE_A_MEASUREMENTS.md).
 * Pure projection; no agent, runtime or model. */
import { afterEach, expect, test } from "bun:test";
import { projectLoopTrajectory, renderLoopTrajectory, TRAJECTORY_ITEM_LIMIT } from "../src/trajectory";

afterEach(() => { delete process.env.WRINGER_FIXTURE_API_KEY; });
const update = (u: Record<string, unknown>) => ({ type: "acp.update", at: "2026-10-20T00:00:00.000Z", sessionId: "s", update: u });
const input = (events: Record<string, unknown>[], extra: Partial<Parameters<typeof projectLoopTrajectory>[0]> = {}) => ({
    plan: { plan_sha256: "a".repeat(64) }, journalRevision: "b".repeat(64),
    effect: { id: "worker-1", role: "worker" as const, status: "completed" as const, requestSha256: "c".repeat(64), resultSha256: "d".repeat(64) },
    request: { prompt: "Implement the original intent." },
    result: { status: "completed" as const, stopReason: "end_turn", agentInfo: { name: "@agentclientprotocol/claude-agent-acp", version: "0.65.0" }, usage: { inputTokens: 100, outputTokens: 20 }, events },
    ...extra,
});
const kinds = (t: ReturnType<typeof projectLoopTrajectory>) => t.lines.map(l => l.kind);

test("Claude-shaped updates: refined titles, text content and diffs, merged assistant text, omitted command listing", () => {
    const t = projectLoopTrajectory(input([
        update({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "review" }] }),
        update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "I'll read the " } }),
        update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "README first." } }),
        update({ sessionUpdate: "tool_call", toolCallId: "t1", kind: "read", title: "Read", status: "pending", content: [], rawInput: {} }),
        update({ sessionUpdate: "tool_call_update", toolCallId: "t1", title: "Read README.md", rawInput: { file_path: "README.md" } }),
        { type: "acp.permission", toolCallId: "t1", kind: "read", policy: "declared-effect", outcome: { outcome: "selected", optionId: "allow" } },
        update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", content: [{ type: "content", content: { type: "text", text: "1\tA measurement fixture." } }], rawOutput: "1\tA measurement fixture." }),
        update({ sessionUpdate: "tool_call", toolCallId: "t2", kind: "execute", title: "Run the check", status: "pending", rawInput: { command: "sh check.sh" } }),
        update({ sessionUpdate: "tool_call_update", toolCallId: "t2", status: "failed", content: [{ type: "content", content: { type: "text", text: "value is still false" } }] }),
        update({ sessionUpdate: "tool_call", toolCallId: "t3", kind: "edit", title: "Edit src/value.js", status: "pending" }),
        update({ sessionUpdate: "tool_call_update", toolCallId: "t3", status: "completed", content: [{ type: "diff", path: "src/value.js", oldText: "export const expected = false;", newText: "export const expected = true;" }] }),
        update({ sessionUpdate: "usage_update", used: 1200, size: 200000 }),
        update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } }),
        { type: "acp.turn.finished", status: "completed" },
    ]));
    expect(kinds(t)).toEqual(["HARNESS", "HARNESS", "ASSISTANT", "PERMISSION", "ACTION", "OBSERVATION", "ACTION", "OBSERVATION ERROR", "ACTION", "OBSERVATION", "ASSISTANT", "USAGE", "HARNESS"]);
    expect(t.lines.map(l => l.n)).toEqual(t.lines.map((_, i) => i + 1));
    expect(t.lines[2]!.text).toBe("I'll read the README first.");
    expect(t.lines[4]!.text).toBe("read: Read README.md");
    expect(t.lines[5]!.text).toBe("1\tA measurement fixture."); // content preferred; rawOutput's duplicate is not repeated
    expect(t.lines[6]!.text).toBe("execute: Run the check — $ sh check.sh");
    expect(t.lines[7]!.text).toBe("value is still false");
    expect(t.lines[9]!.text).toBe("edited src/value.js (1 → 1 lines)");
    expect(t.lines[11]!.text).toBe("context 1200 of 200000; tokens 100 input, 20 output");
    expect(t.omitted.commandListings).toBe(1);
    expect(renderLoopTrajectory(t)).toContain("   6 [OBSERVATION] 1\tA measurement fixture.");
});

test("Codex-shaped updates: output and exit code from rawOutput, terminal deltas only as a fallback", () => {
    const codex = projectLoopTrajectory(input([
        update({ sessionUpdate: "tool_call", toolCallId: "c1", kind: "execute", title: "Run sh check.sh", status: "in_progress", rawInput: { command: ["bash", "-lc", "sh check.sh"] }, content: [{ type: "terminal", terminalId: "c1" }] }),
        update({ sessionUpdate: "tool_call_update", toolCallId: "c1", _meta: { terminal_output_delta: { data: "value is", terminal_id: "c1" } } }),
        update({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "failed", rawOutput: { formatted_output: "value is still false\n", exit_code: 1 }, _meta: { terminal_exit: { exit_code: 1, signal: null, terminal_id: "c1" } } }),
        update({ sessionUpdate: "tool_call", toolCallId: "c2", kind: "execute", title: "Run tests", status: "in_progress", rawInput: { command: ["bash", "-lc", "bun test"] } }),
        update({ sessionUpdate: "tool_call_update", toolCallId: "c2", _meta: { terminal_output_delta: { data: "4 pass\n", terminal_id: "c2" } } }),
        update({ sessionUpdate: "tool_call_update", toolCallId: "c2", status: "completed", _meta: { terminal_exit: { exit_code: 0, signal: null, terminal_id: "c2" } } }),
        update({ sessionUpdate: "agent_thought_chunk", contentOmitted: true }),
        update({ sessionUpdate: "session_info_update", title: "Fix the check" }),
    ]));
    const lines = codex.lines.filter(l => ["ACTION", "OBSERVATION", "OBSERVATION ERROR"].includes(l.kind)).map(l => `[${l.kind}] ${l.text}`);
    expect(lines).toEqual(["[ACTION] execute: Run sh check.sh — $ bash -lc sh check.sh", "[OBSERVATION ERROR] exit 1\nvalue is still false", "[ACTION] execute: Run tests — $ bash -lc bun test", "[OBSERVATION] exit 0\n4 pass"]);
    expect(codex.omitted).toMatchObject({ thoughtChunks: 1, otherUpdates: 1 });
});

test("a call with no output field says so, an unfinished call says it never completed, and nothing is invented", () => {
    const t = projectLoopTrajectory(input([
        update({ sessionUpdate: "tool_call", toolCallId: "x", kind: "search", title: "Search for value", status: "pending" }),
        update({ sessionUpdate: "tool_call_update", toolCallId: "x", status: "completed" }),
        update({ sessionUpdate: "tool_call", toolCallId: "y", kind: "execute", title: "Long command", status: "in_progress" }),
    ]));
    const body = t.lines.map(l => l.text);
    expect(body).toContain("(output not carried by this adapter for this call)");
    expect(body).toContain("(no completion was observed for this call)");
    const none = projectLoopTrajectory(input([], { effect: { id: "w2", role: "worker", status: "uncertain", requestSha256: "c".repeat(64) }, result: null }));
    expect(none.lines.map(l => l.text)).toContain("No retained result: this session's outcome is uncertain and was never replayed.");
});

test("render-time redaction: a credential shape and a declared credential's value never reach a line", () => {
    process.env.WRINGER_FIXTURE_API_KEY = "fixture-secret-value-0123456789";
    const t = projectLoopTrajectory(input([
        update({ sessionUpdate: "tool_call", toolCallId: "k", kind: "execute", title: "env", status: "pending" }),
        update({ sessionUpdate: "tool_call_update", toolCallId: "k", status: "completed", rawOutput: "ANTHROPIC=sk-ant-abcdefghijklmnopqrstuvwx0123 KEY=fixture-secret-value-0123456789" }),
    ], { credentialNames: ["WRINGER_FIXTURE_API_KEY"] }));
    const text = JSON.stringify(t.lines);
    expect(text).not.toContain("sk-ant-abcdefghijklmnopqrstuvwx0123");
    expect(text).not.toContain("fixture-secret-value-0123456789");
    expect(text).toContain("[REDACTED]");
});

test("items are cut at 4 KiB with a marked, counted truncation; clone and home paths are generalised; output is deterministic", () => {
    const long = "x".repeat(TRAJECTORY_ITEM_LIMIT + 500);
    const events = [
        update({ sessionUpdate: "tool_call", toolCallId: "l", kind: "read", title: "Read /private/var/folders/n8/abc/T/wringer-worker-AbC123/repo/src/value.js and /Users/someone/notes", status: "pending" }),
        update({ sessionUpdate: "tool_call_update", toolCallId: "l", status: "completed", rawOutput: long }),
    ];
    const t = projectLoopTrajectory(input(events));
    const observation = t.lines.find(l => l.kind === "OBSERVATION")!.text;
    expect(observation.endsWith(" …(+500 chars, render truncation)")).toBe(true);
    expect(t.omitted).toMatchObject({ truncatedItems: 1, truncatedChars: 500 });
    expect(t.lines.find(l => l.kind === "ACTION")!.text).toBe("read: Read [clone]/src/value.js and [home]/notes");
    expect(projectLoopTrajectory(input(events)).sha256).toBe(t.sha256);
});

test("the whole trajectory stops at its bound and counts what it dropped", () => {
    const events = Array.from({ length: 200 }, (_, i) => [
        update({ sessionUpdate: "tool_call", toolCallId: `b${i}`, kind: "read", title: `Read ${i}`, status: "pending" }),
        update({ sessionUpdate: "tool_call_update", toolCallId: `b${i}`, status: "completed", rawOutput: "y".repeat(TRAJECTORY_ITEM_LIMIT) }),
    ]).flat();
    const t = projectLoopTrajectory(input(events));
    expect(t.omitted.droppedLines).toBeGreaterThan(0);
    expect(t.lines.reduce((sum, l) => sum + l.text.length, 0)).toBeLessThanOrEqual(512 * 1024);
});
