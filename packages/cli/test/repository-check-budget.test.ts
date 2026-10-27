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

test("the release jobs allow at least as long as the test jobs running the same validation groups", async () => {
    const workflow = async (name: string) => Bun.YAML.parse(await readFile(new URL(`../../../.github/workflows/${name}`, import.meta.url), "utf8")) as any;
    const tests = await workflow("tests.yml"), release = await workflow("release.yml");
    const group = (job: any) => job.steps.map((step: any) => String(step.run ?? "").match(/validate --group (\w+)/)?.[1]).find(Boolean);
    // At 984c29c (alpha.38) the release build's core validation took 2,452 s on macos-14
    // and was cancelled at the 40-minute limit tests.yml had already outgrown.
    for (const id of ["build", "rehearsals"]) {
        const groupName = group(release.jobs[id]);
        const matching = Object.values(tests.jobs).filter((job: any) => group(job) === groupName) as any[];
        expect(matching.length, `${id} runs validate --group ${groupName}`).toBeGreaterThan(0);
        for (const job of matching) expect(release.jobs[id]["timeout-minutes"], id).toBeGreaterThanOrEqual(job["timeout-minutes"]);
    }
});
