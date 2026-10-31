import { expect, test } from "bun:test";
import { hashBytes, hashValue } from "@wringer/plan";
import { assertStoppedEditsReceipt, attemptFacts, describeKeptEdits, earlierAttemptsSection, KEPT_PATCH_PROMPT_BYTES, stoppedEditsReceipt, type StoppedEditsReceipt } from "../src/attempt-history";

const BASE = "a".repeat(40), ROOM = 256 * 1024;
const worker = (id: string, result: Record<string, unknown> | null = { status: "completed", stopReason: "end_turn" }, extra = {}) => ({ id, role: "worker", status: result ? "completed" : "uncertain", ...(result ? { result: result as any } : {}), ...extra });
const kept = (id: string, patch: string | null, baseCommit = BASE, omitted: StoppedEditsReceipt["omitted"] = null) => stoppedEditsReceipt(id, "b".repeat(64), "timeout", { baseCommit, paths: ["src/a.js"], bytes: patch === null ? 0 : Buffer.byteLength(patch), patch, sha256: patch === null ? null : hashBytes(patch), omitted });
const section = (prior: any[], receipts: StoppedEditsReceipt[] = [], facts = new Map(), room = ROOM) => earlierAttemptsSection(prior, facts, new Map(receipts.map(row => [row.effectId, row])), BASE, room);
const rows = (text: string) => JSON.parse(text.split("\n")[1]!);

test("a first attempt is told nothing, so its request stays as it was", () => {
    expect(section([])).toBe("");
    expect(section([{ id: "j", role: "judge", status: "completed" }])).toBe("");
});
test("attempts read from the journal: a candidate's paths, then its failed checks and findings", () => {
    const facts = attemptFacts([
        { type: "agent-completed", state: { workerEffect: "w1" } },
        { type: "candidate-captured", details: { changedPaths: ["src/a.js"] }, state: { workerEffect: "w1" } },
        { type: "candidate-verified", state: { workerEffect: "w1", verification: { checks: [{ id: "unit", status: "failed" }, { id: "lint", status: "passed" }], regressions: [{ id: "old", status: "failed" }] } } },
        { type: "candidate-captured", details: { changedPaths: ["src/b.js"] }, state: { workerEffect: "w2" } },
        { type: "candidate-verified", state: { workerEffect: "w2", verification: { checks: [{ id: "unit", status: "passed" }] } } },
        { type: "candidate-judged", state: { workerEffect: "w2", judge: { criteria: [{ id: "req-1", met: false }, { id: "req-2", met: true }, { id: "req-3", met: null }] } } },
        { type: "candidate-verified", state: { workerEffect: null, verification: { checks: [{ id: "ignored", status: "failed" }] } } },
    ]);
    expect(facts.get("w1")).toEqual({ changedPaths: ["src/a.js"], failedChecks: ["unit", "old"], judgeNotMet: [] });
    expect(facts.get("w2")).toEqual({ changedPaths: ["src/b.js"], failedChecks: [], judgeNotMet: ["req-1"] });
    expect(facts.size).toBe(2);
});
test("how a session ended comes from its record, in the order the record decides", () => {
    const facts = new Map([["done", { changedPaths: ["x"], failedChecks: [], judgeNotMet: [] }]]);
    const ended = rows(section([worker("lost", null), worker("cut", { status: "stopped", stopReason: "timeout" }), worker("refused", { status: "completed", stopReason: "end_turn" }, { invalidReason: "worker-no-change" }), worker("idle"), worker("done")], [], facts)).map((row: any) => row.ended);
    expect(ended).toEqual(["no recorded result", "stopped (timeout)", "worker-no-change", "no candidate", "candidate"]);
});
test("only the most recent kept patch against this attempt's source is offered, and only if it fits", () => {
    const small = "diff small\n", older = kept("w1", "diff older\n"), newer = kept("w2", small), elsewhere = kept("w3", "diff elsewhere\n", "c".repeat(40));
    const text = section([worker("w1", { status: "stopped", stopReason: "timeout" }), worker("w2", { status: "stopped", stopReason: "timeout" }), worker("w3", { status: "stopped", stopReason: "timeout" })], [older, newer, elsewhere]);
    const [first, second, third] = rows(text);
    expect(first.keptEdits.patch).toBeUndefined(); expect(second.keptEdits.patch).toBe(small); expect(third.keptEdits.patch).toBeUndefined();
    expect(text).toContain("git apply");
    // Too large for a prompt: its paths still say what existed, and it says why there is no patch.
    const large = "x".repeat(KEPT_PATCH_PROMPT_BYTES + 1), big = rows(section([worker("w1", { status: "stopped", stopReason: "timeout" })], [kept("w1", large)]))[0];
    expect(big.keptEdits).toEqual({ changedPaths: ["src/a.js"], bytes: Buffer.byteLength(large), omitted: "too-large-for-this-prompt" });
    // A patch that fits the limit but not what is left of this prompt is dropped the same way.
    const tight = rows(section([worker("w1", { status: "stopped", stopReason: "timeout" })], [kept("w1", "y".repeat(4096))], new Map(), 2048))[0];
    expect(tight.keptEdits.patch).toBeUndefined(); expect(tight.keptEdits.omitted).toBe("too-large-for-this-prompt");
    // With hardly any room, how each attempt ended still fits.
    const bare = rows(section([worker("w1", { status: "stopped", stopReason: "timeout" })], [kept("w1", "y".repeat(4096))], new Map(), 420))[0];
    expect(bare).toEqual({ attempt: 1, ended: "stopped (timeout)" });
    // With none, the attempt record gives way rather than turning into a refused request.
    expect(section([worker("w1", { status: "stopped", stopReason: "timeout" })], [], new Map(), 16)).toBe("");
});
test("long histories and path lists are cut, and say so", () => {
    const workers = Array.from({ length: 11 }, (_, index) => worker(`w${index}`)), paths = Array.from({ length: 45 }, (_, index) => `src/${index}.js`);
    const text = section(workers, [], new Map([["w10", { changedPaths: paths, failedChecks: [], judgeNotMet: [] }]]));
    expect(text).toContain("The 3 oldest are not shown.");
    const shown = rows(text);
    expect(shown.map((row: any) => row.attempt)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(shown.at(-1).changedPaths).toHaveLength(40); expect(shown.at(-1).morePaths).toBe(5);
});
test("a receipt is bound to its result and journal, and a changed patch is refused", () => {
    const receipt = kept("w1", "diff\n"), effect = { id: "w1", resultSha256: "b".repeat(64) }, journal = hashValue(receipt);
    expect(assertStoppedEditsReceipt(receipt, effect, journal)).toBe(receipt);
    expect(() => assertStoppedEditsReceipt({ ...receipt, patch: "other\n" }, effect, journal)).toThrow("Kept worker edits differ");
    expect(() => assertStoppedEditsReceipt({ ...receipt, patch: "other\n" }, effect, hashValue({ ...receipt, patch: "other\n" }))).toThrow("Kept worker edits differ");
    expect(() => assertStoppedEditsReceipt(receipt, { ...effect, resultSha256: "c".repeat(64) }, journal)).toThrow("Kept worker edits differ");
    expect(() => assertStoppedEditsReceipt(receipt, { ...effect, id: "w2" }, journal)).toThrow("Kept worker edits differ");
});
test("the stop names what became of the edits, in each case", () => {
    const path = "effects/w1/stopped-edits.json";
    expect(describeKeptEdits(kept("w1", "diff\n"), path)).toBe(`Its unfinished edits to 1 file are kept at ${path} and offered to the next attempt. They were not checked and are not a candidate.`);
    const wide = kept("w1", "z".repeat(KEPT_PATCH_PROMPT_BYTES + 1));
    expect(describeKeptEdits(wide, path)).toContain(`are kept at ${path}. They are too large to offer to the next attempt`);
    expect(describeKeptEdits(wide, path)).not.toContain("and offered");
    expect(describeKeptEdits(kept("w1", null, BASE, "too-large"), path)).toContain("too large to keep");
    expect(describeKeptEdits(kept("w1", null, BASE, "credential-detected"), path)).toContain("looks like a credential");
    expect(describeKeptEdits(kept("w1", null, BASE, "capture-failed"), path)).toBe("What it left in its clone could not be read, so nothing was kept.");
});
