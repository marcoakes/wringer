/** Public gate-experiment routes. The container runtime is kept off PATH, so no
 * gate can run here; evaluation must refuse before reserving anything. */
import { afterEach, expect, test } from "bun:test";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dispatch } from "../src/app";
import { corpus, gates, runtime, variants } from "../../application/fixtures/gate-corpus";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function refused(action: Promise<unknown>) { return action.then(() => { throw new Error("expected a refusal"); }, (error: any) => error); }
async function registered() {
    const c = await corpus(); directories.push(c.root);
    await writeFile(join(c.root, "proposal-input.json"), JSON.stringify({ id: "property", taskFamily: "totals", candidateGates: [gates.property], rationale: "Check the arithmetic property.", inputs: { developmentItems: ["correct-sum"] }, author: { actor: "Scripted engineering fixture", kind: "operator" } }));
    await writeFile(join(c.root, "labels.json"), JSON.stringify(variants.map(v => ({ itemId: v.id, label: v.label }))));
    const proposal: any = (await dispatch(["experiment", "gate", "propose", "--input", join(c.root, "proposal-input.json"), "--output", join(c.root, "proposal.json")])).value;
    const oracle: any = (await dispatch(["experiment", "gate", "oracle", "--corpus", "totals", "--labels", join(c.root, "labels.json"), "--output", join(c.root, "oracle.json")])).value;
    await writeFile(join(c.root, "experiment.json"), JSON.stringify({ id: "property-gate", taskFamily: "totals", repository: { url: "https://fixture.invalid/totals.git", commit: c.base }, changedVariable: "acceptance-gates", runtime, baselineGates: [gates.narrow], proposalSha256: proposal.sha256, corpus: { id: "totals", items: c.items, oracleSha256: oracle.sha256 },
        prediction: { statement: "More held-out defects caught, no added false positives.", minimumAdditionalDefectsCaught: 1, maximumAdditionalFalsePositives: 0, minimumHeldOutDefects: 3, minimumHeldOutControls: 2 }, limits: { maxGateRuns: 32, wallClockSeconds: 600 }, holdout: { candidateIteration: 1, maximumCandidateIterations: 3, proposalSawHeldOut: false }, order: "fixed-corpus-order", stoppingRule: "fixed-sample-no-extension", accounting: "all-planned-runs-including-unavailable" }));
    const state = join(c.root, "state"), register: any = await dispatch(["experiment", "gate", "register", "--input", join(c.root, "experiment.json"), "--proposal", join(c.root, "proposal.json"), "--source-bundle", c.bundle, "--state", state]);
    return { c, state, register, oracle: join(c.root, "oracle.json") };
}

test("gate help is routed under wring experiment", async () => {
    const gate = ((await dispatch(["experiment", "gate", "--help"])) as any).text;
    expect(gate).toContain("wring experiment gate register --input"); expect(gate).not.toContain("Ordinary jobs");
    expect(((await dispatch(["experiment", "workflow", "--help"])) as any).text).toContain("wring experiment workflow register");
    expect(((await dispatch(["experiment", "--help"])) as any).text).toContain("wring experiment gate --help");
});
test("propose, seal an oracle and register freeze the comparison before any run", async () => {
    const f = await registered();
    expect(f.register.text).toContain("16 planned runs"); expect(f.register.value.arms.candidate.gates[0].id).toBe("property");
    const status: any = await dispatch(["experiment", "gate", "status", "--state", f.state]);
    expect(status.exit).toBe(3); expect(status.text).toContain("not evaluated");
    expect(JSON.parse(await readFile(f.oracle, "utf8")).labels).toHaveLength(variants.length);
}, 120000);
test("evaluation needs --yes and refuses a missing runtime before reserving any run", async () => {
    const f = await registered(), path = process.env.PATH; process.env.PATH = "/usr/bin:/bin";
    let unconfirmed: any, error: any;
    try {
        unconfirmed = await refused(dispatch(["experiment", "gate", "evaluate", "--state", f.state, "--oracle", f.oracle]));
        error = await refused(dispatch(["experiment", "gate", "evaluate", "--state", f.state, "--oracle", f.oracle, "--yes"]));
    } finally { process.env.PATH = path; }
    expect(unconfirmed.message).toContain("--yes");
    expect(error.message).toContain("Containment unavailable"); expect(error.message).toContain("fixed sample is intact");
    expect((await readdir(f.state)).includes("runs")).toBe(false);
}, 120000);
test("an unevaluated comparison cannot prepare a change, be sent or be adopted", async () => {
    const f = await registered();
    expect((await refused(dispatch(["experiment", "gate", "change", "--state", f.state, "--output", join(f.c.root, "change")]))).message).toContain("qualified");
    expect((await refused(dispatch(["experiment", "gate", "send", "--state", f.state, "--remote", "/nonexistent.git", "--source-branch", "wringer/gate", "--by", "Fixture", "--yes"]))).message).toMatch(/prepare/i);
    expect((await refused(dispatch(["experiment", "gate", "adopt", "--state", f.state, "--registry", join(f.c.root, "registry"), "--by", "Fixture", "--yes"]))).message).toContain("qualified");
}, 120000);
test("the public gate route exposes no fixture runner or evidence override", async () => {
    const source = await readFile(resolve(import.meta.dir, "../src/gate-experiment-cli.ts"), "utf8");
    for (const hook of ["runCommands", "deterministic-fixture", "fixtures/"]) expect(source.includes(hook)).toBe(false);
});
