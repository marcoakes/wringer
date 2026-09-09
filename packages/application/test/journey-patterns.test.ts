import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, mkdir, writeFile, symlink, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { compileExecutionPlan, createExecutionAuthority, hashBytes, hashValue, type EnvironmentMap } from "@wringer/plan";
import { runContainedJourney, type ValidatedContainedState } from "@wringer/workflow";
import { failurePatternsFromJourneys, projectJourneyFailurePatterns } from "../src/journey-patterns";
import { validateFailurePatternReport } from "../src/experiments";

const plan = compileExecutionPlan(await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
function environment(): EnvironmentMap {
    const files = [...new Set([...plan.environment.context, ...plan.acceptance.checks.flatMap(c => c.files)])].map(path => ({ path, mode: "100644", blob: "f".repeat(40) }));
    const body = { schema_version: "wringer.environment-map.v1" as const, repository: plan.repository, plan_sha256: plan.plan_sha256, source_tree: "a".repeat(40), inventory_sha256: hashValue(files), files, context: plan.environment.context.map(path => ({ path, blob: "f".repeat(40), text: "Fixture", sha256: hashBytes("Fixture") })), components: [], tools: plan.environment.tools.map(t => ({ ...t, observation: null })), baseline: plan.environment.baseline.map(declaration => ({ declaration, observation: null })), protected_paths: plan.acceptance.protected_paths, writable_paths: plan.scope.writable, limits: ["Fixture only"] };
    return { ...body, map_sha256: hashValue(body) };
}
function history(): ValidatedContainedState {
    const id = randomUUID(), check = plan.acceptance.checks[0]!, requirement = check.criteria[0]!;
    const verification = (status: string, runtimeId: string) => ({ candidateCommit: "c".repeat(40), candidateTree: "d".repeat(40), runtimeId, checks: [{ id: check.id, status, outputSha256: hashValue("PRIVATE_RAW_OUTPUT") }], regressions: [] });
    const initial = { id, baseline: verification("failed", "baseline"), verification: null, judge: null, humanJudgements: [], effects: [], verificationAttempts: [], stage: "verify" };
    const failure = { ...initial, verification: verification("failed", "one") }, repaired = { ...initial, verification: verification("passed", "two"), judge: { runtimeId: "judge", criteria: [{ id: requirement, met: null, reason: "PRIVATE_JUDGE_TEXT" }] } };
    const human = { ...repaired, humanJudgements: [{ criterionId: "human-fit", candidateTree: "d".repeat(40), acceptanceSha256: plan.acceptance_sha256, verdict: "not_met", note: "PRIVATE_HUMAN_NOTE", by: "PRIVATE_PERSON", display: { receiptSha256: "8".repeat(64) } }] };
    const events = [initial, failure, failure, repaired, human, human].map((state, i) => ({ sequence: i + 1, sha256: hashValue({ id, i }), type: i === 0 ? "acceptance-red" : "observed", state }));
    return { plan, environment: environment(), state: human, events, authority: {}, result: {} } as unknown as ValidatedContainedState;
}
test("ordinary histories retain repaired failures once and omit private narratives and expected baseline red", () => {
    const input = history(), report = projectJourneyFailurePatterns([input], "total"), wire = JSON.stringify(report);
    expect(validateFailurePatternReport(report)).toEqual(report);
    expect(report.groups.map(g => [g.kind, g.count]).sort()).toEqual([["agent-finding", 1], ["human-preference", 1], ["product-check", 1]]);
    expect(wire).not.toContain("PRIVATE_"); expect(report.sources).toEqual([input.events.at(-1)!.sha256]);
    expect(report.limits.join(" ")).toContain("unknown judgement is not an observed product defect");
});
test("comparable normal jobs group across distinct journal revisions while source and repository changes do not mix", () => {
    const one = history(), two = history();
    expect(projectJourneyFailurePatterns([one, two], "total").groups.map(g => g.count)).toEqual([2, 2, 2]);
    two.plan = { ...two.plan, repository: { ...two.plan.repository, commit: "5".repeat(40) } };
    expect(projectJourneyFailurePatterns([one, two], "total").groups).toHaveLength(6);
    two.plan = { ...two.plan, repository: { ...two.plan.repository, url: "https://other.invalid/repo" } };
    expect(() => projectJourneyFailurePatterns([one, two], "total")).toThrow("cross repository");
    expect(() => projectJourneyFailurePatterns([one, one], "total")).toThrow("distinct");
    expect(() => projectJourneyFailurePatterns([one], "bad family")).toThrow();
});
test("empty human hold is not negative feedback and uncertain reservations remain observed", () => {
    const input = history(), state = { ...input.events[0]!.state, effects: [{ id: "uncertain", role: "worker", status: "uncertain" }] };
    input.events = [{ ...input.events[0]!, type: "journey-stopped", details: { reason: "human-judgement", message: "PRIVATE" }, state }, { ...input.events[1]!, type: "journey-stopped", details: { reason: "human-judgement" }, state }] as any;
    const report = projectJourneyFailurePatterns([input], "total"); expect(report.groups).toHaveLength(1); expect(report.groups[0]!.kind).toBe("environment"); expect(report.groups[0]!.count).toBe(1);
});
test("explicit directory selection rejects research ancestors, duplicate paths and nonprivate/symlink states", async () => {
    const root = await mkdtemp(join(tmpdir(), "wringer-pattern-paths-")), state = join(root, "trial"); await mkdir(state, { mode: 0o700 });
    await writeFile(join(root, "registration.json"), "{}"); await expect(failurePatternsFromJourneys([state], "total")).rejects.toThrow("Research/experiment");
    const other = await mkdtemp(join(tmpdir(), "wringer-pattern-ordinary-"));
    await expect(failurePatternsFromJourneys([other, other], "total")).rejects.toThrow("twice");
    const link = join(root, "link"); await symlink(other, link); await expect(failurePatternsFromJourneys([link], "total")).rejects.toThrow("symlink");
    await chmod(other, 0o755); await expect(failurePatternsFromJourneys([other], "total")).rejects.toThrow("private");
    await expect(failurePatternsFromJourneys([], "total")).rejects.toThrow("1-32");
});
test("actual retained stopped job reads offline without provider/runtime calls or current credential lookup", async () => {
    const state = await mkdtemp(join(tmpdir(), "wringer-pattern-read-")), abort = new AbortController(); abort.abort(); let calls = 0;
    const fail = async () => { calls++; throw new Error("No runtime or provider is permitted"); };
    const result = await runContainedJourney({ controllerDir: state, plan, authority: createExecutionAuthority(plan, { actor: "Fixture", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 60000).toISOString() }), environment: environment(), signal: abort.signal, services: { prepareSource: fail, captureCandidate: fail, verifyCandidate: fail }, executeRole: fail });
    expect(result.status).toBe("stopped"); expect(calls).toBe(0);
    const before = process.env, fetchBefore = globalThis.fetch; let lookups = 0;
    process.env = new Proxy(before, { get(target, key) { if (typeof key === "string" && /(?:KEY|TOKEN|SECRET)/.test(key)) { lookups++; throw new Error("Credential lookup forbidden"); } return Reflect.get(target, key); } });
    globalThis.fetch = (() => { calls++; throw new Error("Network forbidden"); }) as unknown as typeof fetch;
    try { const report = await failurePatternsFromJourneys([state], "total"); expect(report.sources).toHaveLength(1); expect(report.groups).toHaveLength(1); expect(calls).toBe(0); expect(lookups).toBe(0); }
    finally { process.env = before; globalThis.fetch = fetchBefore; }
});
test("moved research controller refuses by retained purpose and independently by experiment authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "wringer-pattern-moved-research-")), research = join(root, "research"), original = join(research, "trial"), moved = join(root, "moved-trial");
    await mkdir(research, { mode: 0o700 }); await mkdir(original, { mode: 0o700 });
    await writeFile(join(research, "registration.json"), "{}", { mode: 0o600 });
    // The ordinary route refuses the presence of a research-purpose marker;
    // it must not reinterpret or downgrade malformed markers as ordinary work.
    await writeFile(join(original, "experiment-purpose.json"), "{}", { mode: 0o600 });
    const abort = new AbortController(); abort.abort(); let calls = 0;
    const fail = async () => { calls++; throw new Error("No runtime or provider is permitted"); };
    await runContainedJourney({ controllerDir: original, plan, authority: createExecutionAuthority(plan, { actor: "Experiment: Fixture researcher", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 60000).toISOString() }), environment: environment(), signal: abort.signal, services: { prepareSource: fail, captureCandidate: fail, verifyCandidate: fail }, executeRole: fail });
    await rename(original, moved);
    await expect(failurePatternsFromJourneys([moved], "total")).rejects.toThrow("Research/experiment/proposal");
    // Even without the marker, validated experiment authority survives a move.
    await rename(join(moved, "experiment-purpose.json"), join(root, "saved-purpose.json"));
    await expect(failurePatternsFromJourneys([moved], "total")).rejects.toThrow("Experiment authority");
    const projected = history(); projected.authority = { ...projected.authority, actor: "Experiment: Fixture researcher" };
    expect(() => projectJourneyFailurePatterns([projected], "total")).toThrow("Experiment authority");
    expect(calls).toBe(0);
});
