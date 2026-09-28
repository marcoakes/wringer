import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { parseConfig } from "../../engine/src/config";

test("the repository Action keeps the full test gate within its measured finite envelope", async () => {
    const config = parseConfig(await readFile(new URL("../../../.wringer.yaml", import.meta.url), "utf8"));
    const gate = config.gates.find(gate => gate.id === "tests")!;
    expect(gate.run).toBe("bun test ./packages");
    expect(gate.optional).toBe(false);
    // The complete local native suite measured730s; the Action's600s cap
    // killed its process. Keep at least25% headroom, within the native1200s
    // hang guard. This is a repository budget, never a default for user gates.
    expect(gate.timeout).toBeGreaterThanOrEqual(Math.ceil(730 * 1.25));
    expect(gate.timeout).toBeLessThanOrEqual(1200);
});
