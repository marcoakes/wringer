import { expect, test } from "bun:test";
import * as mcp from "../src";
test("T07 typed tools advertise strict mutable fields and output schemas without approval or publication", () => {
    const contract = (mcp as any).delegationContract; expect(contract).toBeDefined();
    const tools = contract.tools();
    expect(tools.every((row: any) => !!row.outputSchema && row.inputSchema.additionalProperties === false)).toBeTrue();
    expect(tools.some((row: any) => /approve|publish|send|judge/.test(row.name))).toBeFalse();
    const input = { workspaceId: crypto.randomUUID(), proposal: { intent: "Original words", title: "Question", questions: ["Which behavior?"] } };
    expect(contract.parse("wringer.validate_proposal", input).args).toEqual(input);
    for (const proposal of [{ ...input.proposal, runtime: {} }, { ...input.proposal, ceilings: { bogus: 100 } }, { ...input.proposal, criteria: [{ id: "x", title: "X", quote: "X", kind: "check", required: true, approval: true }] }]) expect(() => contract.parse("wringer.validate_proposal", { ...input, proposal })).toThrow();
    expect(() => contract.parse("wringer.propose", { ...input, idempotencyKey: crypto.randomUUID(), plan: {} })).toThrow();
});
