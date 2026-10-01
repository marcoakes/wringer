/** A stopped role tells the person what happened and what to do, in the agent's own
 * reported words. The authentication case is the measured one: the 2026-10-01
 * pre-release rehearsal stopped with only "agent-error" shown twice on the page. */
import { expect, test } from "bun:test";
import { describeRoleStop } from "../src/worker-outcome";

const authFailure = {
    stopReason: "agent-error", text: "PRIVATE_NARRATIVE",
    agentInfo: { name: "@agentclientprotocol/claude-agent-acp", version: "0.65.0" },
    events: [{ type: "acp.response.error", id: 3, error: { code: -32603, message: "Internal error: Failed to authenticate: OAuth session expired and could not be refreshed", data: { errorKind: "authentication_failed" } } }],
};
test("a sign-in failure names the agent, its reported reason and how to sign in", () => {
    const message = describeRoleStop("worker", authFailure as any);
    expect(message).toBe("The worker's coding agent (@agentclientprotocol/claude-agent-acp) could not sign in: Failed to authenticate: OAuth session expired and could not be refreshed. Sign in with that agent's own login on this computer (Claude Code: run claude and use /login; Codex: run codex login), then retry the stopped step. No change was made.");
    // The structured kind alone is enough, whatever the wording.
    expect(describeRoleStop("judge", { ...authFailure, events: [{ type: "acp.response.error", error: { message: "denied", data: { errorKind: "authentication_failed" } } }] } as any)).toContain("The judge's coding agent (@agentclientprotocol/claude-agent-acp) could not sign in: denied.");
    expect(describeRoleStop("worker", authFailure as any)).not.toContain("PRIVATE_NARRATIVE");
});
test("any other stop gives its reason and the adapter's structured error, redacted, never the agent's own words", () => {
    expect(describeRoleStop("worker", { stopReason: "timeout", text: "" } as any)).toBe("The worker stopped (timeout).");
    expect(describeRoleStop("planner", { stopReason: "agent-error", events: [{ type: "acp.response.error", error: { message: "Internal error: Rate limited; Bearer abc.def retry later" } }] } as any)).toBe("The planner stopped (agent-error): Rate limited; Bearer [REDACTED] retry later");
    // The reply text is private narrative: a stop message never carries it, even when it is all there is.
    expect(describeRoleStop("worker", { stopReason: "agent-error", text: "PRIVATE_NARRATIVE Failed to authenticate" } as any)).toBe("The worker stopped (agent-error).");
});
