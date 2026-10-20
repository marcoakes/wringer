/** TEST SUPPORT ONLY: real contained journeys (journal, reservations, loop decisions,
 * validation) with scripted roles and checks; no runtime, model or Git. A journey
 * fails its checks a chosen number of times before passing. */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { compileDeclaration, compileExecutionPlan, createExecutionAuthority, hashBytes, hashValue, type EnvironmentMap, type ExecutionPlan } from "@wringer/plan";
import { runtimeProvenanceVersion, type RoleExecutionRequest, type RoleExecutionResult } from "@wringer/runtime";
import { runContainedJourney, readValidatedContainedState, type CandidateVerification, type ContainedJourneyServices } from "@wringer/workflow";

const template = await readFile(new URL("../../../plan/examples/contained.yaml", import.meta.url), "utf8");
/** The example plan with a bounded number of worker turns. */
export function fixturePlan(workerTurns = 2): ExecutionPlan {
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = compileExecutionPlan(template, { format: "yaml" });
    const d = structuredClone(raw); d.repository.commit = "a".repeat(40); d.budget.max_worker_turns = workerTurns;
    return compileDeclaration({ version: 1, ...d } as any);
}
export function fixtureEnvironment(plan: ExecutionPlan): EnvironmentMap {
    const files = ["README.md", ...plan.acceptance.checks.flatMap(c => c.files)].map(path => ({ path, mode: "100644", blob: "f".repeat(40) }));
    const data: Omit<EnvironmentMap, "map_sha256"> = { schema_version: "wringer.environment-map.v1", repository: plan.repository, plan_sha256: plan.plan_sha256, source_tree: "a".repeat(40), inventory_sha256: hashValue(files), files, context: [{ path: "README.md", blob: "f".repeat(40), text: "Fixture repository", sha256: hashBytes("Fixture repository") }], components: [], tools: plan.environment.tools.map(t => ({ ...t, observation: null })), baseline: plan.environment.baseline.map(declaration => ({ declaration, observation: null })), protected_paths: plan.acceptance.protected_paths, writable_paths: plan.scope.writable, limits: ["Synthetic unit-test map; no runtime or provider measured"] };
    return { ...data, map_sha256: hashValue(data) };
}
/** Run one journey in `state` under `actor`; its candidate checks fail `failures` times first. */
export async function runFixtureJourney(plan: ExecutionPlan, state: string, options: { actor: string; failures: number; events?: (role: string, attempt: number) => Record<string, unknown>[] }) {
    let workers = 0, verifications = 0;
    const authority = createExecutionAuthority(plan, { actor: options.actor, actions: ["plan", "build", "verify", "judge"], expiresAt: new Date(Date.now() + 3600 * 1000).toISOString() });
    const tree = () => workers.toString(16).padStart(40, "c");
    const services: ContainedJourneyServices = {
        prepareSource: async source => source,
        captureCandidate: async () => ({ source: { ...plan.repository, commit: workers.toString(16).padStart(40, "b") }, tree: tree(), changedPaths: ["src/value.ts"] }),
        verifyCandidate: async request => {
            const failed = request.phase === "baseline" || ++verifications <= options.failures;
            return { schema_version: "wringer.contained-verification.v1", status: failed ? "failed" : "passed", candidateCommit: request.source.commit, candidateTree: request.phase === "baseline" ? "a".repeat(40) : tree(), acceptanceSha256: plan.acceptance_sha256, runtimeId: randomUUID(), image: plan.runtime.image!, checks: plan.acceptance.checks.map(c => ({ id: c.id, status: failed ? "failed" : "passed", exitCode: failed ? 1 : 0, checkInputsSha256: "d".repeat(64), outputSha256: "e".repeat(64) })), regressions: plan.environment.baseline.map(c => ({ id: c.id, status: "passed", exitCode: 0, outputSha256: "e".repeat(64) })), evidenceRef: `fixture/${request.effectId}` } as CandidateVerification;
        },
    };
    const executeRole = async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => {
        if (request.role === "worker") workers++;
        const text = request.role === "worker" ? "Fixture worker narrative." : JSON.stringify({ criteria: plan.acceptance.criteria.filter(c => c.kind === "check").map(c => ({ id: c.id, met: true, reason: "Fixture inspection" })), note: "Fixture only" });
        return { status: "completed", text, sessionId: randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, usage: { inputTokens: 10, outputTokens: 5 }, events: options.events?.(request.role, workers) ?? [], stderr: "", provenance: { schema_version: runtimeProvenanceVersion(request.repo.url), runtimeId: randomUUID(), role: request.role, kind: request.runtime.kind, image: request.runtime.image!, repository: request.repo, clonedInside: true, hostMounts: [], repositoryAccess: request.role === "worker" ? "read-write" : "read-only", declared: request.runtime, observed: { fixture: true }, limits: ["No real runtime or provider"] } } as RoleExecutionResult;
    };
    await runContainedJourney({ controllerDir: state, plan, authority, environment: fixtureEnvironment(plan), services, executeRole });
    return { validated: await readValidatedContainedState(state) };
}
