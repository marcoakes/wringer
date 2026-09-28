import { expect, test } from "bun:test";
import { verificationContract } from "../src";
test("T19 verification tools publish strict response and page schemas for the selected operating mode", () => {
    const tools = verificationContract.tools() as any[];
    expect(tools.every(row => row.outputSchema?.type === "object")).toBeTrue();
    const status = tools.find(row => row.name === "wringer.get_status").outputSchema;
    expect(status.additionalProperties).toBeFalse(); expect(status.properties.mode.const).toBe("verification");
    expect(status.properties.boundary.properties.execution.const).toBe("trusted-local");
});
