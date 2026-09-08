import { expect, test } from "bun:test";
import { pmOutcome, type PmWorkspace } from "../src/pm-model";
import { renderPmWorkspace } from "../src/pm-render";

const fixture = (): PmWorkspace => ({ schema_version: "wringer.pm-workspace.v1", name: "Synthetic paused run", intent: "A readable result", journeyId: "fixture", revision: "a".repeat(64), status: "stopped", stage: "worker", candidate: null, criteria: [], checks: [], usage: { sessions: 1, ceiling: 8, inputTokens: null, outputTokens: null, costUsd: null }, actions: [{ id: "resume", enabled: false, reason: "The worker attempt budget is exhausted." }], stop: { reason: "agent-budget-exhausted", message: "The worker attempt budget is exhausted." }, updatedAt: "2026-09-08T09:00:00.000Z", limits: ["Synthetic only"] });

test("every action has a stable accessible name and a linked visible explanation, including disabled actions", () => {
    const html = renderPmWorkspace(fixture(), { live: true, nonce: "fixtureNonce123" });
    const buttons = [...html.matchAll(/<button ([^>]*data-command="([^"]+)"[^>]*)>([^<]+)<\/button>/g)];
    expect(buttons.length).toBeGreaterThan(5);
    for (const button of buttons) {
        expect(button[1]?.includes(`aria-label="${button[3]}"`)).toBe(true);
        expect(button[1]?.includes(`aria-describedby="reason-${button[2]}"`)).toBe(true);
    }
    expect(html.includes('id="reason-resume">The worker attempt budget is exhausted.</p>')).toBe(true);
});
test("old raw parser stops remain inspectable without becoming the PM headline or HTML", () => {
    const state = fixture();
    state.stop = { reason: "judge-invalid-reply", message: 'Malformed reply: {"criteria":["<script>untrusted</script>"]}; retained reply: effects/fixture/result.json' };
    const outcome = pmOutcome(state), html = renderPmWorkspace(state, { live: false });
    expect(outcome.description.includes('{"criteria"')).toBe(false);
    expect(html.includes("Recorded stop evidence")).toBe(true);
    expect(html.includes("effects/fixture/result.json")).toBe(true);
    expect(html.includes("&lt;script&gt;untrusted&lt;/script&gt;")).toBe(true);
    expect(html.includes("<script>untrusted</script>")).toBe(false);
});
test("born-green stops render check IDs and the original baseline receipt without manufacturing failure after the change", () => {
    const state = fixture();
    state.stage = "baseline";
    state.stop = { reason: "acceptance-born-green", message: "Already passing: check-a, check-b. Baseline evidence: checks/baseline/receipt.json" };
    state.checks = [{ id: "check-a", before: { status: "passed", exitCode: 0 }, after: { status: "not-recorded", exitCode: null } }];
    state.criteria = [{ id: "required", title: "The intended result", kind: "check", required: true, state: "unknown", checkIds: ["check-a"], note: null, by: null }];
    const html = renderPmWorkspace(state, { live: false });
    expect(pmOutcome(state).title).toContain("already passed");
    expect(html.includes("checks/baseline/receipt.json")).toBe(true);
    expect(html.includes("check-b")).toBe(true);
    expect(html.includes("Not evaluated yet")).toBe(true);
    expect(html.includes("No check observation")).toBe(true);
});
