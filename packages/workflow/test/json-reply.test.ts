import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseAcpJsonReply } from "../src/json-reply";

test("the exact blind-run reply is accepted as a JSON fence without rewriting its contents", async () => {
    const text = (await readFile(new URL("fixtures/planner-reply-03.txt", import.meta.url), "utf8")).slice(0, -1);
    expect(Buffer.byteLength(text)).toBe(10698);
    expect(createHash("sha256").update(text).digest("hex")).toBe("3c34cd8be5d36d6be7387d07f565e454a513933151ee4f6c21849164e3402dc6");
    const parsed = parseAcpJsonReply(text);
    expect(parsed.evidence.path).toBe("json-fence");
    expect((parsed.value as any).questions).toHaveLength(5);
    expect(JSON.parse(text.slice(parsed.evidence.start, parsed.evidence.end))).toEqual(parsed.value);
});
test("strict JSON wins, explicit JSON fences and one balanced object preserve strings and nesting", () => {
    expect(parseAcpJsonReply('{"note":"```json", "nested":{"x":1}}').evidence.path).toBe("strict-json");
    expect(parseAcpJsonReply('Here is the result.\n```json\n{"questions":[]}\n```\nDone.').evidence.path).toBe("json-fence");
    const reply = 'Result: {"note":"a } and \\\" {", "items":[{"ok":true}]} End.';
    expect(parseAcpJsonReply(reply).evidence.path).toBe("balanced-object");
    expect((parseAcpJsonReply(reply).value as any).items).toEqual([{ ok: true }]);
});
test("no syntax repair, primitive coercion, or malformed selected-reply fallback", () => {
    for (const text of ["{bad:1}", '{"a":1,}', '```json\n{"a":1,}\n```\n```json\n{}\n```', 'Result {broken {"valid":true}} {"later":"valid"}', "null", "[]", "true", '"text"', '```json\n{}', '{}'.repeat(600000)])
        expect(() => parseAcpJsonReply(text)).toThrow();
});
test("select the first explicit JSON fence, otherwise the first balanced object, without trying later candidates", () => {
    expect(parseAcpJsonReply('```text\nexplanation\n```\n```json\n{"first":true}\n```\n```json\n{"second":true}\n```').value).toEqual({ first: true });
    expect(parseAcpJsonReply('First {"first":true} then {"second":true}').value).toEqual({ first: true });
});
