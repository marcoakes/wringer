import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { compileExecutionPlan, compileDeclaration, createExecutionAuthority, hashBytes, hashValue, type ExecutionPlan, type EnvironmentMap } from "@wringer/plan";
import type { RoleExecutionRequest, RoleExecutionResult, PreparedRepositorySource } from "@wringer/runtime";
import { containedServices } from "../../application/src/services";
import type { ContainedJourneyOptions } from "../src/contained-types";
import type { AssertionReport } from "../src/check-evidence";

// Deterministic test services only: never starts a sandbox, agent or provider.
export const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
export function plan(strict = true): ExecutionPlan {
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = compileExecutionPlan(template, { format: "yaml" });
    const value = structuredClone(raw); value.repository.commit = "a".repeat(40);
    value.budget = { ...value.budget, max_worker_turns: 8, max_judge_turns: 8, max_sessions: 20 };
    if (strict) for (const check of value.acceptance.checks) check.evidence = { kind: "assertions", format: "wringer-check.v1" };
    return compileDeclaration({ version: 3, ...value });
}
export function environment(p: ExecutionPlan): EnvironmentMap {
    const files = [...new Set([...p.environment.context, ...p.acceptance.checks.flatMap(c => c.files)])].map(path => ({ path, mode: "100644", blob: "f".repeat(40) }));
    const body = { schema_version: "wringer.environment-map.v1" as const, repository: p.repository, plan_sha256: p.plan_sha256, source_tree: "a".repeat(40), inventory_sha256: hashValue(files), files, context: p.environment.context.map(path => ({ path, blob: "f".repeat(40), text: "Synthetic bounded repository", sha256: hashBytes("Synthetic bounded repository") })), components: [], tools: p.environment.tools.map(t => ({ ...t, observation: null })), baseline: p.environment.baseline.map(declaration => ({ declaration, observation: null })), protected_paths: p.acceptance.protected_paths, writable_paths: p.scope.writable, limits: ["Synthetic observations only; no real runtime, human or provider"] };
    return { ...body, map_sha256: hashValue(body) };
}
export function report(requirements: string[], failed: boolean, id = "assertion-one"): AssertionReport { return { schema_version: "wringer-check.v1", assertions: [{ id, requirements, status: failed ? "failed" : "passed" }], errors: [] }; }
export async function fixture(settings: { failedCandidates?: number; trees?: string[]; baselineText?: string; candidateReport?: (value: AssertionReport) => AssertionReport; generic?: boolean; playbook?: boolean; design?: boolean; judgeOutcomes?: (boolean | null)[] } = {}) {
    let p = plan(!settings.generic); const controllerDir = await mkdtemp(join(tmpdir(), "wringer-loop-v3-"));
    if (settings.design) {
        const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = p;
        p = compileDeclaration({ version: 3, ...raw, intent: p.intent + " Match the approved image.", environment: { ...p.environment, writable_directories: ["preview"] }, acceptance: { ...p.acceptance, criteria: [...p.acceptance.criteria, { id: "design-fit", title: "Match the approved image", quote: "Match the approved image.", kind: "human", required: true, show: { id: "show-design", argv: ["bun", "show.ts"], cwd: ".", timeout_seconds: 30 } }] }, design: { snapshotPath: "design/reference.json", snapshotSha256: "e".repeat(64), reviews: [{ criterionId: "design-fit", referenceIds: ["reference"], captures: [{ id: "actual", path: "preview/actual.png", mimeType: "image/png", width: 10, height: 10 }] }] } });
    }
    let objectStore = controllerDir;
    if (settings.playbook) {
        objectStore = join(controllerDir, "source"); await mkdir(join(objectStore, "wringer/playbooks"), { recursive: true });
        const text = JSON.stringify({ schema_version: "wringer.playbook.v1", id: "fixture-playbook", revision: "one", title: "Synthetic advisory guidance", role: "worker", applicability: { taskFamily: "fixture", context: [], tools: [], checks: p.acceptance.checks.map(c => c.id), scope: p.scope.writable, design: !!settings.design }, guidanceMarkdown: "WORKER_ONLY_ADVISORY_GUIDANCE. Inspect the named check before editing.", limits: ["Fixture only; no efficacy measured"], evaluationRefs: [] });
        await writeFile(join(objectStore, "wringer/playbooks/fixture.json"), text);
        const git = async (...args: string[]) => { const process = Bun.spawn(["git", ...args], { cwd: objectStore, stdout: "pipe", stderr: "pipe", env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } }); const out = await new Response(process.stdout).text(); if (await process.exited) throw new Error(await new Response(process.stderr).text()); return out.trim(); };
        await git("init"); await git("add", "wringer/playbooks/fixture.json"); await git("-c", "commit.gpgsign=false", "commit", "-m", "Synthetic playbook source");
        const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = p;
        p = compileDeclaration({ version: 3, ...raw, repository: { ...p.repository, commit: await git("rev-parse", "HEAD") }, playbook: { path: "wringer/playbooks/fixture.json", sha256: hashBytes(text), taskFamily: "fixture" } });
    }
    const source = { ...p.repository, objectStore, bundlePath: join(controllerDir, "fixture.bundle"), sourceTree: "a".repeat(40) } as unknown as PreparedRepositorySource;
    let workers = 0, measured = 0;
    const requests: RoleExecutionRequest[] = [];
    const tree = () => settings.trees?.[workers - 1] ?? workers.toString(16).padStart(40, "b");
    const services = containedServices(controllerDir, source, { runCommands: async request => {
        measured++;
        const baseline = request.repo.commit === p.repository.commit, failed = baseline || workers <= (settings.failedCandidates ?? 0);
        const results = request.commands.map(command => {
            const check = p.acceptance.checks.find(c => `acceptance/${c.id}` === command.id);
            let assertion = check ? report(check.criteria, failed) : null;
            if (assertion && !baseline && settings.candidateReport) assertion = settings.candidateReport(assertion);
            return { id: command.id, code: check && failed ? 1 : 0, stdout: check ? baseline && settings.baselineText !== undefined ? settings.baselineText : settings.generic ? failed ? "Assertion failed: expected reports to contain six records; /Users/operator/private/run" : "All declared checks passed" : JSON.stringify(assertion) : "baseline passed", stderr: "", durationMs: 1 };
        });
        return { sourceChanged: false, sourceTree: baseline ? "a".repeat(40) : tree(), checkInputsSha256: "d".repeat(64), results, provenance: { schema_version: "wringer.runtime.v1", role: "verifier", runtimeId: randomUUID(), kind: p.runtime.kind, image: p.runtime.image, repository: request.repo, clonedInside: true, hostMounts: [], repositoryAccess: "read-only", declared: p.runtime, observed: { writableDirectories: p.environment.writable_directories, fixture: true }, limits: ["Synthetic fixture; no runtime execution"] } };
    } });
    services.captureCandidate = async () => ({ source: { ...source, commit: workers.toString(16).padStart(40, "c") }, tree: tree(), changedPaths: ["src/value.ts"] });
    const options: ContainedJourneyOptions = { plan: p, controllerDir, environment: environment(p), authority: createExecutionAuthority(p, { actor: "Fixture operator", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 3600000).toISOString() }), services, executeRole: async request => {
        requests.push(request); if (request.role === "worker") workers++;
        const judgeIndex = requests.filter(r => r.role === "judge").length - 1, met = settings.judgeOutcomes && judgeIndex < settings.judgeOutcomes.length ? settings.judgeOutcomes[judgeIndex]! : true;
        return { status: "completed", text: request.role === "worker" ? "Private worker report" : JSON.stringify({ criteria: p.acceptance.criteria.filter(c => c.kind === "check").map(c => ({ id: c.id, met, reason: "Synthetic independent review" })), note: "No live provider" }), sessionId: randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: { schema_version: "wringer.runtime.v1", runtimeId: randomUUID(), role: request.role, kind: p.runtime.kind, image: p.runtime.image, repository: request.repo, clonedInside: true, hostMounts: [], repositoryAccess: request.role === "worker" ? "read-write" : "read-only", declared: p.runtime, observed: { fixture: true }, limits: ["No runtime or model measured"] } } as RoleExecutionResult;
    } };
    return { options, requests, counts: () => ({ workers, measured }) };
}
