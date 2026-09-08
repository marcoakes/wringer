import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDeclaration, compileExecutionPlan, createExecutionAuthority, hashBytes, hashValue, type EnvironmentMap } from "@wringer/plan";
import { containedHumanReviewEligibility, queryContainedJourney, readValidatedContainedState, runContainedJourney, type CandidateVerification } from "@wringer/workflow";
import type { RoleExecutionResult } from "@wringer/runtime";
import { showControllerCandidate, reviewControllerCandidate } from "../src/controller";
import { readPmWorkspace } from "../../cli/src/workspace";
import { pmOutcome } from "../../board/src/pm-model";
import { renderPmWorkspace } from "../../board/src/pm-render";

// Real durable readers with explicitly synthetic role/check observations.
// No provider, contained runtime, credentials or target repository is used.
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
async function fixture(settings: { judgeStopped?: boolean; judgeFalse?: boolean; candidateFailed?: boolean; bornGreen?: boolean; workerTurns?: number; judgeTurns?: number } = {}) {
    const directory = await mkdtemp(join(tmpdir(), "wringer-pm-blind-regression-")); roots.push(directory);
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = compileExecutionPlan(template, { format: "yaml" });
    const declaration = structuredClone(raw);
    declaration.intent += " The display is readable.";
    declaration.repository = { url: "https://example.invalid/pm-regression.git", commit: "a".repeat(40) };
    declaration.runtime.env = []; declaration.agents.worker.env = []; declaration.agents.judge.env = [];
    declaration.budget.max_worker_turns = settings.workerTurns ?? 1;
    declaration.budget.max_judge_turns = settings.judgeTurns ?? 1;
    declaration.acceptance.criteria.push({ id: "readable", title: "The display is readable", quote: "The display is readable.", kind: "human", required: true, show: { id: "show-readable", argv: ["bun", "run", "demo"], cwd: ".", timeout_seconds: 30 } });
    const plan = compileDeclaration({ version: 1, ...declaration });
    const files = ["README.md", ...plan.acceptance.checks.flatMap(c => c.files)].map(path => ({ path, mode: "100644", blob: "f".repeat(40) }));
    const map: Omit<EnvironmentMap, "map_sha256"> = { schema_version: "wringer.environment-map.v1", repository: plan.repository, plan_sha256: plan.plan_sha256, source_tree: "a".repeat(40), inventory_sha256: hashValue(files), files, context: [{ path: "README.md", blob: "f".repeat(40), text: "Synthetic fixture", sha256: hashBytes("Synthetic fixture") }], components: [], tools: plan.environment.tools.map(t => ({ ...t, observation: null })), baseline: plan.environment.baseline.map(declaration => ({ declaration, observation: null })), protected_paths: plan.acceptance.protected_paths, writable_paths: plan.scope.writable, limits: ["Synthetic only"] };
    const environment = { ...map, map_sha256: hashValue(map) };
    const authority = createExecutionAuthority(plan, { actor: "Regression fixture", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString() });
    await writeFile(join(directory, "plan.json"), JSON.stringify(plan)); await writeFile(join(directory, "authority.json"), JSON.stringify(authority));
    const candidate = { source: { ...plan.repository, commit: "b".repeat(40) }, tree: "c".repeat(40), changedPaths: ["src/value.ts"] };
    const during: { stage: string; description: string }[] = [];
    const result = await runContainedJourney({ controllerDir: directory, plan, authority, environment,
        services: {
            prepareSource: async source => source, captureCandidate: async () => candidate,
            verifyCandidate: async request => {
                const status = request.phase === "baseline" ? settings.bornGreen ? "passed" : "failed" : settings.candidateFailed ? "failed" : "passed";
                return { schema_version: "wringer.contained-verification.v1", status, candidateCommit: request.source.commit, candidateTree: request.phase === "baseline" ? environment.source_tree : candidate.tree, acceptanceSha256: plan.acceptance_sha256, runtimeId: randomUUID(), image: plan.runtime.image, checks: plan.acceptance.checks.map(c => ({ id: c.id, status, exitCode: status === "passed" ? 0 : 1, checkInputsSha256: "d".repeat(64), outputSha256: "e".repeat(64) })), regressions: plan.environment.baseline.map(c => ({ id: c.id, status: "passed", exitCode: 0, outputSha256: "e".repeat(64) })), evidenceRef: `synthetic-evidence/${request.phase}` } as CandidateVerification;
            },
        },
        executeRole: async request => {
            const live = await readPmWorkspace(directory); during.push({ stage: live.stage, description: pmOutcome(live).description });
            return { status: request.role === "judge" && settings.judgeStopped ? "stopped" : "completed", text: request.role === "worker" ? "Synthetic changed source" : JSON.stringify({ criteria: plan.acceptance.criteria.filter(c => c.kind === "check").map(c => ({ id: c.id, met: !settings.judgeFalse, reason: settings.judgeFalse ? "The check does not establish the requested result" : "Synthetic independent review" })), note: "Synthetic only" }), sessionId: randomUUID(), stopReason: request.role === "judge" && settings.judgeStopped ? "Fixture review interrupted" : "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: { schema_version: "wringer.runtime.v1", runtimeId: randomUUID(), role: request.role, kind: request.runtime.kind, image: request.runtime.image, repository: request.repo, clonedInside: true, hostMounts: [], repositoryAccess: request.role === "worker" ? "read-write" : "read-only", declared: request.runtime, observed: { fixture: true }, limits: ["Synthetic only"] } } as RoleExecutionResult;
        },
    });
    return { directory, result, during, query: await queryContainedJourney(directory), workspace: await readPmWorkspace(directory) };
}

test("judge-stopped cannot display or solicit an unrecordable human verdict", async () => {
    const f = await fixture({ judgeStopped: true }); let displays = 0;
    expect(f.result.stop?.reason).toBe("judge-stopped");
    await expect(showControllerCandidate(f.directory, "readable", { runCommands: async () => { displays++; throw new Error("Display must not run at judge stop"); } })).rejects.toThrow("human hold");
    await expect(reviewControllerCandidate(f.directory, { criterionId: "readable", displayId: randomUUID(), verdict: "met", by: "Fixture person", note: "No real observation" })).rejects.toThrow("human hold");
    expect(displays).toBe(0); expect(await readdir(f.directory)).not.toContain("displays");
    expect(f.query.actions.find(a => a.id === "show")?.enabled).toBe(false);
    expect(f.query.actions.find(a => a.id === "review")?.enabled).toBe(false);
});
test("exhausted worker and judge role ceilings disable ineffective continuation even with total sessions left", async () => {
    const worker = await fixture({ candidateFailed: true });
    expect(worker.query.budget.sessions.reserved).toBeLessThan(worker.query.budget.sessions.ceiling);
    expect(worker.query.actions.find(a => a.id === "resume")).toMatchObject({ enabled: false });
    expect(worker.query.actions.find(a => a.id === "resume")?.reason).toContain("worker");
    const judge = await fixture({ judgeStopped: true });
    expect(judge.query.actions.find(a => a.id === "retry-stopped")).toMatchObject({ enabled: false });
    expect(judge.query.actions.find(a => a.id === "retry-stopped")?.reason).toContain("judge");
});
test("checks passing with interrupted independent review is pending, not a proved requirement or human hold", async () => {
    const f = await fixture({ judgeStopped: true });
    expect(f.workspace.checks.every(c => c.after.status === "passed")).toBe(true);
    expect(f.workspace.criteria.find(c => c.id === "total")?.state).toBe("unknown");
    expect(pmOutcome(f.workspace).title).toContain("Checks passed");
    expect(pmOutcome(f.workspace).description).toContain("Independent review");
    const html = renderPmWorkspace(f.workspace, { live: false });
    expect(html).toContain("Checks passed; independent review pending");
});
test("an active worker or judge names the actual recorded stage", async () => {
    const f = await fixture();
    expect(f.during.find(r => r.stage === "worker")?.description).toContain("Building");
    expect(f.during.find(r => r.stage === "judge")?.description).toContain("Independent review");
});
test("a recorded negative result stays not met while untouched human criteria stay not evaluated", async () => {
    const f = await fixture({ candidateFailed: true });
    expect(f.workspace.criteria.find(c => c.id === "total")?.state).toBe("not-met");
    expect(f.workspace.criteria.find(c => c.id === "readable")?.state).toBe("unknown");
    const html = renderPmWorkspace(f.workspace, { live: false });
    expect(html).toContain("Not met"); expect(html).toContain("Not evaluated yet");
});
test("a real human hold remains reviewable after role ceilings are spent, but source mismatch and expired approval refuse", async () => {
    const f = await fixture(), history = await readValidatedContainedState(f.directory);
    expect(history.state.stage).toBe("human");
    expect(f.query.actions.find(a => a.id === "show")?.enabled).toBe(true);
    expect(f.query.actions.find(a => a.id === "review")?.enabled).toBe(true);
    expect(f.query.actions.find(a => a.id === "resume")?.enabled).toBe(false);
    expect(containedHumanReviewEligibility(history, "readable").enabled).toBe(true);
    expect(containedHumanReviewEligibility(history, "undeclared").enabled).toBe(false);
    const mismatched = structuredClone(history); mismatched.state.verification!.candidateTree = "9".repeat(40);
    expect(containedHumanReviewEligibility(mismatched, "readable").enabled).toBe(false);
    const expired = structuredClone(history); expired.authority.expires_at = new Date(Date.now() - 1).toISOString();
    expect(containedHumanReviewEligibility(expired, "readable")).toMatchObject({ enabled: false });
    const elapsed = structuredClone(history); elapsed.state.startedAt = new Date(Date.now() - elapsed.authority.budget.wall_clock_seconds * 1000 - 1).toISOString();
    expect(containedHumanReviewEligibility(elapsed, "readable").reason).toContain("wall clock");
});
test("a stopped judge has one explicit retry only when its own remaining grant permits it", async () => {
    const f = await fixture({ judgeStopped: true, judgeTurns: 2 });
    expect(f.query.actions.find(a => a.id === "retry-stopped")?.enabled).toBe(true);
    expect(f.query.actions.find(a => a.id === "resume")?.enabled).toBe(false);
    expect(f.query.actions.find(a => a.id === "show")?.enabled).toBe(false);
    expect(f.query.actions.find(a => a.id === "review")?.enabled).toBe(false);
});
