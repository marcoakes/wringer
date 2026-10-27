import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { parseConfig } from "../../engine/src/config";

test("the repository Action keeps the full test gate within its measured finite envelope", async () => {
    const config = parseConfig(await readFile(new URL("../../../.wringer.yaml", import.meta.url), "utf8"));
    const gate = config.gates.find(gate => gate.id === "tests")!;
    expect(gate.run).toBe("bun test ./packages");
    expect(gate.optional).toBe(false);
    // The complete local native suite measured 730 s at first; at the alpha.37
    // candidate hosted Ubuntu ran 1,195 s of passing tests into a 1,200 s cap.
    // Keep at least 25% headroom over that, within native-check's 2,400 s hang
    // guard in scripts/validate.ts. A repository budget, never a default for user gates.
    expect(gate.timeout).toBeGreaterThanOrEqual(Math.ceil(1195 * 1.25));
    expect(gate.timeout).toBeLessThanOrEqual(2400);
});
