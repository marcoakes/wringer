import { readFile } from "node:fs/promises";
import type { Step } from "../src/pipeline";

export async function fixture(name: "chain" | "two-failures"): Promise<Step[]> {
    return JSON.parse(await readFile(new URL(`../testdata/${name}.json`, import.meta.url), "utf8"));
}
export async function checkAll(checks: Record<string, () => void | Promise<void>>, selected?: string) {
    if (selected && !Object.hasOwn(checks, selected)) throw new Error(`Unknown check ${selected}. Choose ${Object.keys(checks).join(", ")}`);
    let failures = 0, count = 0;
    for (const [name, check] of Object.entries(checks)) {
        if (selected && name !== selected) continue;
        count++;
        try { await check(); console.log(`PASS ${name}`); }
        catch (error) { failures++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    console.log(`${count - failures}/${count} checks passed`);
    process.exitCode = failures ? 1 : 0;
}
