import { compileDeclaration, type ExecutionPlan } from "@wringer/plan";
import type { ExperimentPlanInput } from "../src/experiments";

/** Compile-only fixture configuration, not runtime discovery or provisioning.
 * Both arms use the same platform/runtime. No runtime is launched by this
 * rehearsal and the Linux Kubernetes identifiers are explicitly synthetic. */
export function createImprovementsBrowserFixture(template: ExecutionPlan, platform: NodeJS.Platform) {
    if (platform !== "darwin" && platform !== "linux") throw new Error("The browser fixture supports only darwin and linux; do not invent a measured platform");
    const { schema_version, plan_sha256, acceptance_sha256, intent_sha256, ...data } = template;
    const { image, cpus, memoryMiB, network } = data.runtime;
    const runtime = { image, cpus, memoryMiB, network, env: [], ...(platform === "darwin" ? { kind: "apple-container" } : { kind: "gvisor-kubernetes", context: "scripted-browser-fixture", namespace: "wringer-browser-fixture", runtimeClass: "gvisor" }) };
    const declaration = { version: 3, ...data, runtime, agents: { worker: { ...data.agents.worker, env: [] }, judge: { ...data.agents.judge, env: [] } }, acceptance: { ...data.acceptance, protected_paths: [...data.acceptance.protected_paths, "wringer/playbooks/candidate.json"] } };
    const baseline = compileDeclaration(declaration), candidate = compileDeclaration({ ...declaration, playbook: { path: "wringer/playbooks/candidate.json", sha256: "a".repeat(64), taskFamily: "reports" } });
    const experiment: ExperimentPlanInput = { id: "reports-browser", repository: baseline.repository.url, taskFamily: "reports", baselinePlaybook: null, candidatePlaybook: candidate.playbook!.sha256, changedVariable: "worker-playbook", tasks: [{ id: "reports-1", sourceTree: "c".repeat(40), split: "held-out", baseline, candidate }], repetitions: 1, order: "alternating-pairs", stratum: { platform, modelSelection: "Scripted configuration only", adapterSelection: "Scripted configuration only" }, prediction: { statement: "SCRIPTED hypothesis: reduce worker attempts by one without lost requirements.", metric: "worker-attempts", minimumImprovement: 1, minimumHeldOutPairs: 4, maximumSignProbability: 0.05, visualQualityClaim: false }, limits: { maxTrials: 2, maxRoleSessions: baseline.budget.max_sessions * 2, wallClockSeconds: 600 }, dataScope: "this-repository-only", holdout: { corpusId: "scripted-reports", candidateIteration: 1, maximumCandidateIterations: 1, candidateAuthorSawHeldOutSolutions: false }, accounting: "all-planned-trials-including-failures", stoppingRule: "fixed-sample-no-extension" };
    return { baseline, candidate, experiment };
}
