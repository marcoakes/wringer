/** Paging a trajectory for a connected assistant: an index without a session, numbered
 * lines from an offset with one, never more than 64 KiB, never a session that is not there. */
import { expect, test } from "bun:test";
import { projectLoopTrajectory } from "@wringer/workflow";
import { trajectoryPage, TRAJECTORY_PAGE_BYTES } from "../src/loop-inspection";

const trajectory = (id: string, items: number, size = 100) => projectLoopTrajectory({ plan: { plan_sha256: "a".repeat(64) }, journalRevision: "b".repeat(64), effect: { id, role: "worker", status: "completed", requestSha256: "c".repeat(64) }, request: null,
    result: { status: "completed", stopReason: "end_turn", agentInfo: null, events: Array.from({ length: items }, (_, i) => ({ type: "acp.update", update: { sessionUpdate: "tool_call", toolCallId: `t${i}`, kind: "read", title: `Read ${"r".repeat(size)}`, status: "completed" } })) } as any });
test("an index without a session, then lines by offset with a next offset", () => {
    const t = [trajectory("one", 5), trajectory("two", 1)];
    const index = trajectoryPage(t, "f".repeat(64));
    expect(index.sessions).toEqual([{ effectId: "one", role: "worker", status: "completed", lines: t[0]!.lines.length }, { effectId: "two", role: "worker", status: "completed", lines: t[1]!.lines.length }]);
    expect(index.lines).toEqual([]); expect(index.effectId).toBeNull();
    const first = trajectoryPage(t, "f".repeat(64), { effectId: "one", offset: 0, limit: 3 }), rest = trajectoryPage(t, "f".repeat(64), { effectId: "one", offset: first.nextOffset! });
    expect([...first.lines, ...rest.lines]).toEqual(t[0]!.lines); expect(rest.nextOffset).toBeNull(); expect(first.trajectorySha256).toBe(t[0]!.sha256);
    expect(() => trajectoryPage(t, "f".repeat(64), { effectId: "three" })).toThrow("No such role session");
    expect(() => trajectoryPage(t, "f".repeat(64), { effectId: "one", limit: 0 })).toThrow("limit of 1 to 1000");
});
test("a page stops at 64 KiB but always carries at least one line", () => {
    const big = [trajectory("big", 40, 4000)], page = trajectoryPage(big, "f".repeat(64), { effectId: "big" });
    expect(Buffer.byteLength(JSON.stringify(page.lines))).toBeLessThanOrEqual(TRAJECTORY_PAGE_BYTES + 4096);
    expect(page.lines.length).toBeGreaterThan(0); expect(page.nextOffset).toBe(page.lines.length);
});
