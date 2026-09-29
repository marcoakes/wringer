import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { compileExecutionPlan, compileDeclaration, createExecutionAuthority, hashBytes, hashValue, type ExecutionPlan, type EnvironmentMap } from "@wringer/plan";
import type { RoleExecutionRequest, RoleExecutionResult, PreparedRepositorySource } from "@wringer/runtime";
import { containedServices } from "../../application/src/services";
import { runContainedJourney, readValidatedContainedState } from "../src/contained";
import { queryContainedJourney } from "../src/contained-query";
import { parseAssertionReport, observeAssertionReport, assertAssertionPair, type AssertionReport } from "../src/check-evidence";
import { analyzeLoop, validateEngineeringJournal } from "../src/loop-analysis";
import { buildRepairPacket, validateRepairPacket } from "../src/repair-packet";
import type { CandidateVerification, ContainedJourneyOptions } from "../src/contained-types";
import * as application from "../../application/src";

import { template, plan, environment, report, fixture } from "../fixtures/loop-engineering";

test("strict reports reject duplicate keys/IDs, foreign requirements and excessive output", () => {
    const good = report(["r"], true);
    expect(parseAssertionReport(JSON.stringify(good), ["r"])).toEqual(good);
    for (const input of ['{"schema_version":"wringer-check.v1","assertions":[],"assertions":[],"errors":[]}', JSON.stringify({ ...good, assertions: [good.assertions[0], good.assertions[0]] }), JSON.stringify(report(["foreign"], true)), "x".repeat(300000)]) expect(() => parseAssertionReport(input, ["r"])).toThrow();
});
test("Reports default pins the exact advisory playbook and strict assertion contract", async () => {
    const profile = compileExecutionPlan(await readFile(new URL("../../../examples/reports-design/profile.yaml", import.meta.url), "utf8"), { format: "yaml" });
    const content = await readFile(new URL("../../../examples/reports-design/wringer/playbooks/reports-component-first.json", import.meta.url));
    expect(profile.schema_version).toBe("wringer.execution-plan.v3");
    expect(profile.playbook?.sha256).toBe(hashBytes(content));
    expect(profile.acceptance.checks[0]?.evidence).toEqual({ kind: "assertions", format: "wringer-check.v1" });
    expect(profile.acceptance.protected_paths).toContain(profile.playbook!.path);
});
test("syntax errors, empty/skipped tests, runner errors and contradictory exit never establish assertion evidence", () => {
    const good = report(["r"], true);
    for (const [value, exit] of [["SyntaxError: import failed", 1], [JSON.stringify({ ...good, assertions: [] }), 0], [JSON.stringify({ ...good, assertions: [{ ...good.assertions[0], status: "skipped" }] }), 0], [JSON.stringify({ ...good, errors: ["could not discover tests"] }), 1], [JSON.stringify(good), 0], [JSON.stringify(report(["r"], false)), 1]] as const) expect(observeAssertionReport("c", value, exit, ["r"]).status).toBe("unavailable");
});
test("strict red/repair/green reaches ready and preserves actionable observations without worker narrative in judge", async () => {
    const f = await fixture({ failedCandidates: 1 });
    const result = await runContainedJourney(f.options);
    expect(result.status).toBe("review-ready"); expect(f.counts().workers).toBe(2);
    const history = await readValidatedContainedState(f.options.controllerDir);
    expect(history.state.baseline?.schema_version).toBe("wringer.contained-verification.v2");
    expect(history.state.baseline?.checkEvidence?.[0]?.status).toBe("established");
    expect(f.requests[1]!.prompt).toContain("assertion-one");
    expect(f.requests[1]!.prompt).not.toContain(f.options.controllerDir);
    expect(f.requests.at(-1)!.prompt).not.toContain("Private worker report");
    expect(history.events.filter(e => e.type === "loop-decision-recorded")).toHaveLength(2);
    expect(result.tokens.input).toBeNull();
});
test("strict missing report stops before worker spend while generic command-red remains supported", async () => {
    const strict = await fixture({ baselineText: "SyntaxError: module unavailable" });
    expect((await runContainedJourney(strict.options)).stop?.reason).toBe("baseline-unavailable"); expect(strict.counts().workers).toBe(0);
    const generic = await fixture({ generic: true });
    expect((await runContainedJourney(generic.options)).status).toBe("review-ready");
    const first = generic.requests[0]!.prompt;
    expect(first).toContain("expected reports to contain six records"); expect(first).not.toContain("/Users/operator");
});
test("formerly red assertion disappearing, skipped, or remapped cannot become green", async () => {
    for (const candidateReport of [(v: AssertionReport) => ({ ...v, assertions: [] }), (v: AssertionReport) => ({ ...v, assertions: v.assertions.map(a => ({ ...a, status: "skipped" as const })) }), (v: AssertionReport) => ({ ...v, assertions: v.assertions.map(a => ({ ...a, id: "replacement" })) })]) {
        const f = await fixture({ candidateReport }); const outcome = await runContainedJourney(f.options);
        expect(outcome.status).toBe("stopped"); expect(["verification-unavailable", "assertion-identities-changed"]).toContain(outcome.stop!.reason); expect(f.counts().workers).toBe(1);
        expect(f.requests.some(r => r.role === "judge")).toBe(false);
        await readValidatedContainedState(f.options.controllerDir);
    }
});
test("A to B to A stops before a fourth worker and ordinary resume preserves reservations", async () => {
    const f = await fixture({ failedCandidates: 8, trees: ["b".repeat(40), "c".repeat(40), "b".repeat(40)] });
    const first = await runContainedJourney(f.options); expect(first.stop?.reason).toBe("repeated-candidate"); expect(f.counts().workers).toBe(3);
    const before = f.counts(); const second = await runContainedJourney(f.options);
    expect(second.stop?.reason).toBe("repeated-candidate"); expect(f.counts()).toEqual(before);
    expect((await queryContainedJourney(f.options.controllerDir)).actions.find(a => a.id === "resume")?.enabled).toBe(false);
    const events = (await readValidatedContainedState(f.options.controllerDir)).events;
    expect(events.filter(e => e.type === "loop-decision-recorded")).toHaveLength(3);
});

test("public loop inspection carries exact decisions, budgets and source without another effect", async () => {
    const read = (application as any).readLoopInspection;
    expect(typeof read).toBe("function");
    const f = await fixture({ failedCandidates: 8, trees: ["b".repeat(40), "c".repeat(40), "b".repeat(40)] });
    await runContainedJourney(f.options);
    const before = f.counts(), history = await readValidatedContainedState(f.options.controllerDir);
    const loop = await read(f.options.plan, f.options.controllerDir);
    expect(f.counts()).toEqual(before);
    expect(loop.schema_version).toBe("wringer.loop-inspection.v1");
    expect(loop.journalRevision).toBe(history.events.at(-1)!.sha256);
    expect(loop.stop.reason).toBe("repeated-candidate");
    expect(loop.decisions.map((row: any) => row.action)).toEqual(["continue", "continue", "stop"]);
    expect(loop.decisions.at(-1).repeatedCandidateSequence).toBe(1);
    expect(loop.decisions.at(-1).outcomes[0].status).toBe("failed");
    expect(loop.budget.sessions.reserved).toBe(3);
    expect(loop.budget.sessions.remaining).toBe(f.options.authority.budget.max_sessions - 3);
    expect(loop.candidate.tree).toBe("b".repeat(40));
    expect(JSON.stringify(loop)).not.toContain("Private worker report");
    expect(JSON.stringify(loop)).not.toContain(f.options.controllerDir);
    const other = compileExecutionPlan(template, { format: "yaml" });
    await expect(read(other, f.options.controllerDir)).rejects.toThrow();
});

test("public loop inspection distinguishes warning, success and unstarted observations", async () => {
    const read = (application as any).readLoopInspection;
    expect(typeof read).toBe("function");
    const f = await fixture({ failedCandidates: 3 });
    const pending = await read(f.options.plan);
    expect(pending.journalRevision).toBeNull(); expect(pending.budget).toBeNull();
    expect(pending.decisions).toEqual([]); expect(pending.status).toBe("not-started");
    await runContainedJourney(f.options);
    const loop = await read(f.options.plan, f.options.controllerDir);
    expect(loop.decisions.map((row: any) => row.action)).toEqual(["continue", "continue", "warn", "continue"]);
    expect(loop.status).toBe("review-ready"); expect(loop.budget.monetaryCost).toBeNull();
    expect(loop.engineering.history.map((row: any) => row.sha256)).toEqual(loop.decisions.map((row: any) => row.sha256));
    const { validateDelegationOutput } = await import("../../mcp/src/delegation-contract");
    expect(() => validateDelegationOutput("wringer.inspect_loop", loop)).not.toThrow();
    const { dispatch } = await import("../../cli/src/app");
    expect((await dispatch(["loop", "--state", f.options.controllerDir], "wringer-drive")).value).toEqual(loop);
});

test("public loop inspection removes private paths from runtime stop diagnostics", async () => {
    const f = await fixture();
    f.options.executeRole = async () => { throw new Error(`Missing ${f.options.controllerDir}/private-session and /Users/operator/private/credential-file`); };
    await runContainedJourney(f.options);
    const history = await readValidatedContainedState(f.options.controllerDir);
    expect(history.result.stop?.message).toContain(f.options.controllerDir);
    const view = application.projectLoopInspection(f.options.plan, history);
    expect(view.stop?.reason).toBe("effect-uncertain");
    expect(view.stop?.message).toContain("Missing");
    expect(JSON.stringify(view)).not.toContain(f.options.controllerDir);
    expect(JSON.stringify(view)).not.toContain("/Users/operator");
    expect(view.budget?.unresolvedSessions).toBe(1);
});

test("public loop projection refuses an oversized display instead of truncating away decisions", async () => {
    const f = await fixture({ failedCandidates: 1 }); await runContainedJourney(f.options);
    const history = await readValidatedContainedState(f.options.controllerDir), event = history.events.find(row => row.type === "loop-decision-recorded")!;
    // Synthetic projection pressure only; no forged history is written or read.
    const oversized = { ...history, events: Array.from({ length: 4096 }, () => event) };
    expect(() => { application.projectLoopInspection(f.options.plan, oversized); }).toThrow("bounded view");
});
test("three changed failing candidates warn, then a legitimate fourth attempt can complete", async () => {
    const f = await fixture({ failedCandidates: 3 }); expect((await runContainedJourney(f.options)).status).toBe("review-ready");
    const events = (await readValidatedContainedState(f.options.controllerDir)).events;
    const decisions = events.filter(e => e.type === "loop-decision-recorded").map(e => (e.details as any).loopDecision);
    expect(decisions.map(d => d.action)).toEqual(["continue", "continue", "warn", "continue"]);
    expect(decisions[2].reason).toContain("not proof"); expect(f.counts().workers).toBe(4);
});
test("repair packet truncation is explicit, complete output is hashed and altered packet refuses", async () => {
    const f = await fixture({ generic: true }); await runContainedJourney(f.options);
    const value = structuredClone((await readValidatedContainedState(f.options.controllerDir)).state.baseline!);
    const text = "x".repeat(3000) + " /Users/secret/private/file";
    value.checks[0]!.outputSha256 = hashBytes(text);
    const rows = [...f.options.plan.acceptance.checks.map((c, i) => ({ id: `acceptance/${c.id}`, code: 1, stdout: i ? "" : text, stderr: "" })), ...f.options.plan.environment.baseline.map(c => ({ id: `baseline/${c.id}`, code: 0, stdout: "baseline passed", stderr: "" }))];
    value.repair = buildRepairPacket(f.options.plan, value, "baseline", "e".repeat(64), rows);
    expect(value.repair.checks[0]!.omittedBytes).toBeGreaterThan(0); expect(JSON.stringify(value.repair)).not.toContain("/Users/secret"); validateRepairPacket(f.options.plan, value);
    value.repair.checks[0]!.stdout = "forged"; expect(() => validateRepairPacket(f.options.plan, value)).toThrow();
});
test("decision fingerprints ignore transport paths and raw output noise, never ignore environment identity", async () => {
    const f = await fixture({ failedCandidates: 1 }); await runContainedJourney(f.options);
    const history = await readValidatedContainedState(f.options.controllerDir);
    const verification = history.state.verificationAttempts!.find(a => a.phase === "candidate")!.result!;
    const one = analyzeLoop(f.options.plan, history.environment.map_sha256, verification, []);
    expect(analyzeLoop(f.options.plan, history.environment.map_sha256, { ...verification, evidenceRef: "receipts/portable" }, []).sha256).toBe(one.sha256);
    const changed = analyzeLoop(f.options.plan, "9".repeat(64), verification, [one]); expect(changed.action).toBe("continue");
});
test("a secret-shaped value crossing an excerpt boundary is redacted before truncation and retention", async () => {
    const secret = "sk-proj-" + "s".repeat(40), text = "x".repeat(2040) + " " + secret + " assertion failure";
    const f = await fixture({ generic: true, baselineText: text });
    await runContainedJourney(f.options);
    const history = await readValidatedContainedState(f.options.controllerDir), packet = history.state.baseline!.repair!;
    expect(JSON.stringify(packet)).not.toContain(secret); expect(packet.checks[0]!.omittedBytes).toBeGreaterThan(0);
    expect(f.requests[0]!.prompt).not.toContain(secret);
});
test("uncertain repaired attempt preserves recorded loop history and charged reservation across resume", async () => {
    const f = await fixture({ failedCandidates: 1 }), execute = f.options.executeRole!; let workerReservations = 0;
    f.options.executeRole = async request => { if (request.role === "worker" && ++workerReservations === 2) throw new Error("Lost response after possible spend"); return execute(request); };
    expect((await runContainedJourney(f.options)).stop?.reason).toBe("effect-uncertain");
    const before = await readValidatedContainedState(f.options.controllerDir); expect(before.state.effects).toHaveLength(2);
    const inspection = await application.readLoopInspection(f.options.plan, f.options.controllerDir);
    expect(inspection.budget?.sessions.reserved).toBe(2); expect(inspection.budget?.unresolvedSessions).toBe(1);
    expect((await runContainedJourney(f.options)).stop?.reason).toBe("effect-uncertain"); expect(workerReservations).toBe(2);
    const ready = await runContainedJourney({ ...f.options, retryUncertain: true }); expect(ready.status).toBe("review-ready"); expect(ready.sessions).toBe(4); expect(ready.tokens.input).toBeNull();
    expect((await readValidatedContainedState(f.options.controllerDir)).events.filter(e => e.type === "loop-decision-recorded")).toHaveLength(2);
});
test("rehashed loop advice cannot replace the deterministic observation-derived decision", async () => {
    const f = await fixture({ failedCandidates: 1 }); await runContainedJourney(f.options);
    const history = await readValidatedContainedState(f.options.controllerDir), index = history.events.findIndex(e => e.type === "loop-decision-recorded");
    const decision = (history.events[index]!.details as any).loopDecision; decision.reason = "Pretend improvement";
    const { sha256: ignored, ...body } = decision; decision.sha256 = hashValue(body);
    for (let i = index; i < history.events.length; i++) {
        const event = history.events[i]!; if (i) event.previous = history.events[i - 1]!.sha256;
        const { sha256, ...data } = event; event.sha256 = hashValue(data);
        await writeFile(join(f.options.controllerDir, ".wringer/contained/events", `${String(event.sequence).padStart(6, "0")}.json`), JSON.stringify(event));
    }
    await expect(readValidatedContainedState(f.options.controllerDir, { allowStaleView: true })).rejects.toThrow("Loop decision differs");
});
test("only the worker receives the pinned playbook and durable use binds its exact request", async () => {
    const f = await fixture({ playbook: true }); expect((await runContainedJourney(f.options)).status).toBe("review-ready");
    expect(f.requests.find(r => r.role === "worker")!.prompt).toContain("WORKER_ONLY_ADVISORY_GUIDANCE");
    expect(f.requests.find(r => r.role === "judge")!.prompt).not.toContain("WORKER_ONLY_ADVISORY_GUIDANCE");
    const history = await readValidatedContainedState(f.options.controllerDir), anchors = history.events.filter(e => e.type === "playbook-used");
    expect(anchors).toHaveLength(1);
    const use = (anchors[0]!.details as any).playbookUse, effect = history.state.effects.find(e => e.role === "worker")!;
    expect(use.requestSha256).toBe(effect.requestSha256); expect(use.playbookSha256).toBe(f.options.plan.playbook!.sha256);
    const count = f.requests.length; await runContainedJourney(f.options); expect(f.requests).toHaveLength(count);
    const before = process.env; let credentialReads = 0;
    process.env = new Proxy(before, { get(target, name) { if (typeof name === "string" && /(?:KEY|TOKEN|SECRET)/.test(name)) { credentialReads++; throw new Error("Offline reader consulted credentials"); } return Reflect.get(target, name); } });
    try { await readValidatedContainedState(f.options.controllerDir, { credentialEnvironment: {} }); expect(credentialReads).toBe(0); }
    finally { process.env = before; }
    const path = join(f.options.controllerDir, ".wringer/contained/playbook.json"), snapshot = JSON.parse(await readFile(path, "utf8")); snapshot.manifest.guidanceMarkdown = "Changed after approval"; await writeFile(path, JSON.stringify(snapshot));
    await expect(readValidatedContainedState(f.options.controllerDir)).rejects.toThrow("source bytes");
});
test("combined design and playbook context replays after worker completion before the next role", async () => {
    const f = await fixture({ playbook: true, design: true }), abort = new AbortController();
    const first = await runContainedJourney({ ...f.options, signal: abort.signal, onEvent: event => { if (event.type === "agent-completed" && (event.details as any)?.role === "worker") abort.abort(); } });
    expect(first.stop?.reason).toBe("interrupted");
    expect(f.requests.map(r => r.role)).toEqual(["worker"]);
    const before = await readValidatedContainedState(f.options.controllerDir);
    expect(before.state.effects).toHaveLength(1); expect(before.state.effects[0]!.status).toBe("completed");
    expect(before.playbook?.manifest.applicability.design).toBe(true);
    const worker = f.requests[0]!;
    expect(worker.prompt.indexOf("WORKER_ONLY_ADVISORY_GUIDANCE")).toBeLessThan(worker.prompt.lastIndexOf("\nApproved design:"));
    expect(worker.design?.snapshotSha256).toBe(f.options.plan.design!.snapshotSha256);
    const resumed = await runContainedJourney(f.options);
    expect(resumed.status).toBe("human-hold"); expect(f.requests.map(r => r.role)).toEqual(["worker", "judge"]);
    expect(f.requests[1]!.prompt).toContain("\nApproved design:"); expect(f.requests[1]!.prompt).not.toContain("WORKER_ONLY_ADVISORY_GUIDANCE");
    const after = await readValidatedContainedState(f.options.controllerDir);
    expect(after.events.filter(e => e.type === "playbook-used")).toHaveLength(1);
    await runContainedJourney(f.options); expect(f.requests).toHaveLength(2);
});
test("local and portable coverage require decisions before later spend or readiness", async () => {
    const f = await fixture({ failedCandidates: 1 }); await runContainedJourney(f.options);
    const history = await readValidatedContainedState(f.options.controllerDir);
    const validate = (events: any[]) => validateEngineeringJournal(f.options.plan, history.environment.map_sha256, events);
    const portable = history.events.map(e => ({ type: e.type, state: e.state, ...(e.type === "loop-decision-recorded" ? { loopDecision: (e.details as any).loopDecision } : {}) }));
    expect(validate(portable)).toHaveLength(2);
    expect(() => validate(portable.filter(e => e.type !== "loop-decision-recorded"))).toThrow("missing");
    const first = portable.findIndex(e => e.type === "loop-decision-recorded"), last = portable.findLastIndex(e => e.type === "loop-decision-recorded");
    expect(() => validate(portable.filter((_e, i) => i !== first))).toThrow();
    expect(() => validate(portable.filter((_e, i) => i !== last))).toThrow();
    const renamed = portable.filter(e => e.type !== "loop-decision-recorded").map(e => ({ ...e, type: e.type === "candidate-verified" ? "unrelated-note" : e.type }));
    expect(() => validate(renamed)).toThrow("missing");
    expect(() => validate(portable.map(e => ({ ...e, type: e.type === "candidate-judged" ? "unrelated-note" : e.type })))).toThrow("Judge findings changed");
    expect(() => validate(portable.filter(e => e.type !== "candidate-verified"))).toThrow("anchor");
    // A crash immediately after a decision is valid partial history, not a new allowance.
    expect(validate(portable.slice(0, first + 1))).toHaveLength(1);
});
test("judge repairs have separate evidence and an unknown judgement stays an explicit bounded retry", async () => {
    const negative = await fixture({ judgeOutcomes: [false, true] });
    expect((await runContainedJourney(negative.options)).status).toBe("review-ready");
    const history = await readValidatedContainedState(negative.options.controllerDir), decisions = validateEngineeringJournal(negative.options.plan, history.environment.map_sha256, history.events);
    expect(decisions.map(d => d.phase)).toEqual(["checks", "judge", "checks"]);
    expect(decisions[1]!.outcomes.some(o => o.kind === "judge" && o.status === "not-met")).toBe(true);
    expect(() => validateEngineeringJournal(negative.options.plan, history.environment.map_sha256, history.events.filter(e => e.type !== "loop-decision-recorded" || (e.details as any).loopDecision.phase !== "judge"))).toThrow("missing");
    const unsettled = await fixture({ judgeOutcomes: [null, true] });
    expect((await runContainedJourney(unsettled.options)).stop?.reason).toBe("judge-unsettled");
    expect((await runContainedJourney(unsettled.options)).stop?.reason).toBe("judge-unsettled"); expect(unsettled.requests).toHaveLength(2);
    expect((await runContainedJourney({ ...unsettled.options, retryJudge: true })).status).toBe("review-ready"); expect(unsettled.counts().workers).toBe(1);
    expect((await readValidatedContainedState(unsettled.options.controllerDir)).events.filter(e => e.type === "loop-decision-recorded")).toHaveLength(1);
});
