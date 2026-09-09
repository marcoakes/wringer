import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { compileExecutionPlan, hashValue, validateExecutionPlan } from "@wringer/plan";
import { createExperimentPlan, experimentSchedule, validateExperimentPlan } from "../../application/src/experiments";
import { createImprovementsBrowserFixture } from "../../../scripts/improvements-browser-rehearsal";

const template = compileExecutionPlan(await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });

for (const [platform, kind] of [["darwin", "apple-container"], ["linux", "gvisor-kubernetes"]] as const) {
    test(`the browser experiment fixture compiles and validates its ${platform} stratum without a browser or runtime`, () => {
        const before = hashValue(template), fixture = createImprovementsBrowserFixture(template, platform);
        const experiment = createExperimentPlan(fixture.experiment);
        expect(validateExperimentPlan(experiment)).toEqual(experiment);
        expect(experiment.stratum.platform).toBe(platform);
        expect(experimentSchedule(experiment)).toHaveLength(2);
        for (const arm of [fixture.baseline, fixture.candidate]) {
            expect(validateExecutionPlan(arm, { credentialEnvironment: {} })).toEqual(arm);
            expect(arm.runtime.kind).toBe(kind);
            expect(arm.runtime.env).toEqual([]);
            expect(arm.agents.worker.env).toEqual([]);
            expect(arm.agents.judge.env).toEqual([]);
            expect(arm.runtime.network.policy).toBe("deny");
        }
        expect(fixture.baseline.runtime).toEqual(fixture.candidate.runtime);
        if (fixture.baseline.runtime.kind === "gvisor-kubernetes") {
            expect(fixture.baseline.runtime.context).toBe("scripted-browser-fixture");
            expect(fixture.baseline.runtime.namespace).toBe("wringer-browser-fixture");
            expect(fixture.baseline.runtime.runtimeClass).toBe("gvisor");
        } else expect(fixture.baseline.runtime).not.toHaveProperty("context");
        expect(hashValue(template)).toBe(before);
        // Preserve the production guard: a label cannot disguise the other
        // runtime. This reproduces the mismatched Linux CI declaration.
        expect(() => createExperimentPlan({ ...fixture.experiment, stratum: { ...fixture.experiment.stratum, platform: platform === "linux" ? "darwin" : "linux" } })).toThrow("Runtime does not match the fixed platform stratum");
    });
}

test("unsupported hosts are not silently relabelled as a Linux browser fixture", () => {
    expect(() => createImprovementsBrowserFixture(template, "win32")).toThrow("supports only darwin and linux");
});
