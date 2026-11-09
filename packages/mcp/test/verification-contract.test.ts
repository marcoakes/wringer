import { expect, test } from "bun:test";
import { verificationContract } from "../src";
test("T19 verification tools keep strict response and page schemas for the selected operating mode, server-side", () => {
    const tools = verificationContract.tools() as any[];
    // W3 (alpha.44): the listing carries no output schema; each result is still validated against one.
    expect(tools.some(row => "outputSchema" in row)).toBeFalse();
    expect(tools.every(row => (verificationContract.outputSchema(row.name) as any)?.type === "object")).toBeTrue();
    const status: any = verificationContract.outputSchema("wringer.get_status");
    expect(status.additionalProperties).toBeFalse(); expect(status.properties.mode.const).toBe("verification");
    expect(status.properties.boundary.properties.execution.const).toBe("trusted-local");
});
