import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { parseConfig } from "../../engine/src/config";

const workflows = new URL("../../../.github/workflows/", import.meta.url);
const workflow = async (name: string) => Bun.YAML.parse(await readFile(new URL(name, workflows), "utf8")) as any;
const group = (job: any) => job.steps?.map((step: any) => String(step.run ?? "").match(/validate --group (\w+)/)?.[1]).find(Boolean);
/** The runner images a job asks for: its matrix rows, its matrix list or its one label. */
const images = (job: any): string[] => { const matrix = job.strategy?.matrix; return (matrix?.include?.map((row: any) => row.os) ?? matrix?.os ?? [job["runs-on"]]).filter(Boolean); };

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
    const tests = await workflow("tests.yml"), release = await workflow("release.yml");
    // At 984c29c (alpha.38) the release build's core validation took 2,452 s on macos-14
    // and was cancelled at the 40-minute limit tests.yml had already outgrown.
    for (const id of ["build", "rehearsals"]) {
        const groupName = group(release.jobs[id]);
        const matching = Object.values(tests.jobs).filter((job: any) => group(job) === groupName) as any[];
        expect(matching.length, `${id} runs validate --group ${groupName}`).toBeGreaterThan(0);
        for (const job of matching) expect(release.jobs[id]["timeout-minutes"], id).toBeGreaterThanOrEqual(job["timeout-minutes"]);
    }
});

test("a release runs each validation group only on images the test jobs run it on, and never on a retired image", async () => {
    const tests = await workflow("tests.yml"), release = await workflow("release.yml");
    // v1.0.0-alpha.27 failed on the release's macOS 14 image, where the tests had never run: its Apple Git was 2.39.
    for (const id of ["build", "rehearsals"]) {
        const tested = Object.values(tests.jobs).filter((job: any) => group(job) === group(release.jobs[id])).flatMap(images);
        for (const image of images(release.jobs[id])) expect(tested, `release ${id} on ${image}`).toContain(image);
    }
    // GitHub retired its macOS 14 images on 2 November 2026: https://github.com/actions/runner-images/issues/13518
    for (const name of (await readdir(workflows)).filter(name => name.endsWith(".yml")))
        for (const [id, job] of Object.entries((await workflow(name)).jobs) as [string, any][])
            for (const image of images(job)) expect(image, `${name} ${id}`).not.toBe("macos-14");
});
