import { describe, expect, test, spyOn } from "bun:test";
import { mkdtemp, readFile, writeFile, mkdir, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDeclaration, compileExecutionPlan, hashValue, hashBytes } from "@wringer/plan";
import type { ExecutionPlan } from "@wringer/plan";
import { createExperimentPlan, createExperimentGrant, validateExperimentGrant, registerExperiment, experimentSchedule, evaluateRecordedExperiment as compareRecordedExperiment, evaluateExperiment, readExperiment, promoteExperiment, rollbackPlaybook, readPlaybookAdoptions, collectExperiment, failurePatternReport, listExperiments, recordExperimentReview, createPlaybookProposalRequest, proposePlaybookImprovement } from "../src/experiments";
import { prepareRepositorySource, type RoleExecutionRequest, type RoleExecutionResult } from "@wringer/runtime";
import { openReader } from "../../records/src/read";
import type { ExperimentPlanInput, ExperimentTrial, ExperimentTrialSlot } from "../src/experiment-types";
import { stamped, exclusiveJson, ZERO, readExperimentJson, atomicJson } from "../src/experiment-store";
import { parseArgs } from "../../cli/src/args";
import { experimentCommand } from "../../cli/src/experiment-cli";

const template = compileExecutionPlan(await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
const candidateDigest = "a".repeat(64);
function plans(i: number) {
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...base } = template;
    const declaration = { version: 3, ...base, repository: { ...base.repository, commit: String(i).padStart(40, "0") }, acceptance: { ...base.acceptance, protected_paths: [...base.acceptance.protected_paths, "wringer/playbooks/candidate.json"] } };
    const baseline = compileDeclaration(declaration), candidate = compileDeclaration({ ...declaration, playbook: { path: "wringer/playbooks/candidate.json", sha256: candidateDigest, taskFamily: "reports" } });
    return { baseline, candidate };
}
function input(taskCount = 5, repetitions = 1): ExperimentPlanInput {
    return { id: "reports-improvement", repository: template.repository.url, taskFamily: "reports", baselinePlaybook: null, candidatePlaybook: candidateDigest, changedVariable: "worker-playbook", tasks: Array.from({ length: taskCount }, (_, i) => ({ id: `report-${i}`, sourceTree: String(i + 1).padStart(40, "0"), split: "held-out" as const, ...plans(i) })), repetitions, order: "alternating-pairs", stratum: { platform: "darwin", modelSelection: "same image-pinned worker configuration", adapterSelection: "same image-pinned ACP adapter" }, prediction: { statement: "Reduce worker attempts by at least one, without a failed requirement or safety regression.", metric: "worker-attempts", minimumImprovement: 1, minimumHeldOutPairs: 4, maximumSignProbability: 0.05, visualQualityClaim: false }, limits: { maxTrials: taskCount * repetitions * 2, maxRoleSessions: taskCount * repetitions * 16, wallClockSeconds: 600 }, dataScope: "this-repository-only", holdout: { corpusId: "reports-unseen", candidateIteration: 1, maximumCandidateIterations: 2, candidateAuthorSawHeldOutSolutions: false }, accounting: "all-planned-trials-including-failures", stoppingRule: "fixed-sample-no-extension" };
}
const privateDir = () => mkdtemp(join(tmpdir(), "wringer-improvement-fixture-"));
async function registered(declaration = input()) {
    const root = await privateDir(); await registerExperiment(root, declaration); return { root, current: await readExperiment(root) };
}
/** Synthetic records exercise the comparator only. This test is NOT live model evidence. */
function syntheticTrials(current: Awaited<ReturnType<typeof readExperiment>>, benefit = 1, kind: ExperimentTrial["evidenceKind"] = "live-contained"): ExperimentTrial[] {
    return experimentSchedule(current.plan).map(slot => {
        const at = new Date().toISOString(), candidate = slot.arm === "candidate";
        return stamped({ schema_version: "wringer.experiment-trial.v1" as const, experimentSha256: current.plan.sha256, slot, registrationSha256: current.registration.sha256, startedAt: at, finishedAt: at, evidenceKind: kind, outcome: "completed" as const, workerAttempts: candidate ? 2 - benefit : 2, roleSessions: 3, functionalCompletion: true, requirements: [{ id: "total", kind: "check" as const, met: true }], safety: { authority: "passed" as const, acceptance: "passed" as const, containment: "passed" as const, secrets: "passed" as const, handoverAudit: "passed" as const, productionPublication: "not-attempted" as const }, safetyEvidence: { authority: "1".repeat(64), acceptance: "2".repeat(64), containment: "3".repeat(64), secrets: { scanner: "declared-credential-and-pattern-redactor" as const, inputsSha256: "4".repeat(64), inputCount: 1 }, handoverAudit: syntheticHandover(current, slot, at, kind).sha256 }, candidateCommit: "c".repeat(40), candidateTree: "d".repeat(40), journeyRevision: "e".repeat(64), runtimeIds: [`fixture-only-${slot.id}`], agentIdentitySha256: "f".repeat(64), stopReason: null, cost: null });
    });
}
function syntheticHandover(current: Awaited<ReturnType<typeof readExperiment>>, slot: ExperimentTrialSlot, at: string, evidenceKind: ExperimentTrial["evidenceKind"]) {
    const deliveryId = `contained-${"1".repeat(24)}`;
    return stamped({ schema_version: "wringer.experiment-handover.v1" as const, experimentSha256: current.plan.sha256, registrationSha256: current.registration.sha256, slotId: slot.id, planSha256: slot.planSha256, candidateCommit: "c".repeat(40), candidateTree: "d".repeat(40), journeyRevision: "e".repeat(64), evidenceKind, target: "generated-private-local-origin-only" as const, status: "passed" as const, measuredAt: at, delivery: { deliveryId, codeCommit: "c".repeat(40), evidenceCommit: "f".repeat(40), sourceBranch: `wringer/experiment-${slot.id}`, targetBranch: "main" as const, pushed: true as const }, freshClone: { headCommit: "f".repeat(40), audit: { schema_version: "wringer.contained-audit.v1" as const, status: "passed" as const, deliveryId, codeCommit: "c".repeat(40), checks: 1, human: 0, claims: [{ id: "synthetic-fixture-only", status: "checked" as const, reason: "Synthetic comparator input, not a real handover measurement." }], limits: ["Unit fixture only."] } }, productionPublication: "not-attempted" as const, productionHumanApproval: "not-granted" as const, reason: "Synthetic comparator probe only, never live research evidence." });
}
function evaluateRecordedExperiment(current: Awaited<ReturnType<typeof readExperiment>>) {
    return compareRecordedExperiment({ ...current, handovers: current.handovers.length ? current.handovers : current.trials.map(t => syntheticHandover(current, t.slot, t.startedAt, t.evidenceKind)) });
}
async function storeSynthetic(root: string, trials: ExperimentTrial[]) {
    const current = await readExperiment(root);
    for (const trial of trials) {
        await exclusiveJson(root, `trials/${trial.slot.id}.json`, trial);
        await exclusiveJson(root, `handovers/${trial.slot.id}.json`, syntheticHandover(current, trial.slot, trial.startedAt, trial.evidenceKind));
    }
}
function restamp<T extends { sha256: string }>(value: T, patch: Partial<T>): T { const { sha256, ...rest } = { ...value, ...patch }; return stamped(rest) as T; }

describe("separate prediction-gated research contracts", () => {
    test("pins exactly one variable and reserves the aggregate ceiling before trials", () => {
        const plan = createExperimentPlan(input()); expect(experimentSchedule(plan)).toHaveLength(10);
        expect(experimentSchedule(plan).slice(0, 4).map(s => s.arm)).toEqual(["baseline", "candidate", "candidate", "baseline"]);
        expect(() => createExperimentPlan({ ...input(), limits: { ...input().limits, maxRoleSessions: 79 } })).toThrow("aggregate");
        const changed = input(); const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...candidate } = changed.tasks[0]!.candidate;
        changed.tasks[0]!.candidate = compileDeclaration({ version: 3, ...candidate, budget: { ...candidate.budget, max_sessions: 7 } });
        expect(() => createExperimentPlan(changed)).toThrow("Only the worker playbook");
        const weakened = input(); const { schema_version: s, plan_sha256: p, intent_sha256: i, acceptance_sha256: a, ...c } = weakened.tasks[0]!.candidate;
        weakened.tasks[0]!.candidate = compileDeclaration({ version: 3, ...c, acceptance: { ...c.acceptance, criteria: [{ ...c.acceptance.criteria[0]!, title: "Changed grader" }] } });
        expect(() => createExperimentPlan(weakened)).toThrow("Only the worker playbook");
    });
    test("a build grant, expired grant, changed credentials and extra loops cannot authorise collection", () => {
        const plan = createExperimentPlan(input()), at = new Date("2026-09-01T10:00:00Z"), grant = createExperimentGrant(plan, { actor: "Fixture operator", credentialNames: template.runtime.env!, at, expiresAt: "2026-09-01T11:00:00Z" });
        expect(validateExperimentGrant(grant, plan, at)).toEqual(grant);
        expect(() => validateExperimentGrant(grant, plan, new Date("2026-09-01T12:00:00Z"))).toThrow("expired");
        expect(() => validateExperimentGrant(restamp(grant, { actions: ["build"] as any }), plan, at)).toThrow("separate");
        expect(() => createExperimentGrant(plan, { actor: "Fixture", credentialNames: ["GH_TOKEN"], expiresAt: "2030-01-01T00:00:00Z" })).toThrow("exactly");
        expect(() => createExperimentPlan({ ...input(), stoppingRule: "until-it-works" as any })).toThrow();
    });
    test("a rollback-to-none baseline can compare advisory selection without dropping any execution controls", () => {
        const declaration = input(1), task = declaration.tasks[0]!;
        const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...baseline } = task.baseline;
        const rollback = stamped({ schema_version: "wringer.playbook-adoption.v1" as const, repository: baseline.repository.url, taskFamily: "reports", action: "rollback" as const, actor: "Research operator", note: "Return future work to the baseline.", at: new Date().toISOString(), previousRevision: "c".repeat(64), previousDigest: "d".repeat(64), selectedDigest: null, experimentSha256: "e".repeat(64), evidenceRevision: "f".repeat(64), appliesTo: "future-plans-only" as const, executionApproved: false as const });
        task.baseline = compileDeclaration({ version: 3, ...baseline, approachAdoption: rollback });
        const frozen = createExperimentPlan(declaration);
        expect(frozen.tasks[0]!.baseline.approachAdoption).toEqual(rollback); expect(frozen.tasks[0]!.candidate.playbook?.sha256).toBe(candidateDigest);
        expect(frozen.tasks[0]!.baseline.acceptance_sha256).toBe(frozen.tasks[0]!.candidate.acceptance_sha256);
        const { schema_version: s, plan_sha256: p, intent_sha256: i, acceptance_sha256: a, ...candidate } = task.candidate;
        task.candidate = compileDeclaration({ version: 3, ...candidate, loop: { repeatCandidate: "stop", repeatedOutcomeWarning: 4 } });
        expect(() => createExperimentPlan(declaration)).toThrow("Only the worker playbook");
        const tampered = structuredClone(frozen.tasks[0]!.baseline); tampered.approachAdoption!.note = "Changed provenance without its stamp";
        expect(() => createExperimentPlan({ ...declaration, tasks: [{ ...task, baseline: tampered, candidate: frozen.tasks[0]!.candidate }] })).toThrow();
    });
    test("rejects prediction after results, symlinks and source-contained experiment storage", async () => {
        const { root } = await registered(); await expect(registerExperiment(root, input())).rejects.toThrow("fresh");
        const late = await privateDir(); await mkdir(join(late, "trials")); await writeFile(join(late, "trials/existing.json"), JSON.stringify(stamped({ proof: "already measured" })));
        await expect(registerExperiment(late, input())).rejects.toThrow("after its trials");
        const privateRoot = await privateDir(); await mkdir(join(privateRoot, ".git")); await expect(registerExperiment(privateRoot, input())).rejects.toThrow("outside Git");
        const linked = await privateDir(); await symlink(join(root, "registration.json"), join(linked, "registration.json")); await expect(readExperiment(linked)).rejects.toThrow("symbolic");
    });
});
describe("zero-spend offline evaluation", () => {
    test("distinguishes beneficial, no-op and harmful seeded observations without runtime or provider activity", async () => {
        const { root, current } = await registered(); const trials = syntheticTrials(current); await storeSynthetic(root, trials);
        const spawn = spyOn(Bun, "spawn").mockImplementation(() => { throw new Error("Offline comparison must not spawn a runtime or credential utility"); });
        const fetch = spyOn(globalThis, "fetch").mockImplementation((() => { throw new Error("Offline comparison must not call a provider"); }) as unknown as typeof globalThis.fetch);
        try {
            const benefit = await evaluateExperiment(root); expect(benefit.eligibility).toBe("eligible"); expect(benefit.heldOut.meanImprovement).toBe(1); expect(benefit.heldOut.signProbability).toBe(0.03125); expect(benefit.cost).toBeNull();
            expect(evaluateRecordedExperiment({ ...current, trials: syntheticTrials(current, 0) }).eligibility).toBe("inconclusive");
            const harmful = trials.map(t => t.slot.arm === "candidate" ? restamp(t, { functionalCompletion: false, outcome: "stopped", requirements: [{ id: "total", kind: "check", met: false }] }) : t);
            expect(evaluateRecordedExperiment({ ...current, trials: harmful }).eligibility).toBe("ineligible");
            expect(spawn).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
        } finally { spawn.mockRestore(); fetch.mockRestore(); }
    });
    test("fixtures, missing trials, unknown adapter, duplicate slots and late prediction never qualify", async () => {
        const { current } = await registered(); const trials = syntheticTrials(current);
        expect(evaluateRecordedExperiment({ ...current, trials: syntheticTrials(current, 1, "deterministic-fixture") }).eligibility).toBe("inconclusive");
        const missing = evaluateRecordedExperiment({ ...current, trials: trials.slice(1) }); expect(missing.plannedTrials).toBe(10); expect(missing.missingTrials).toHaveLength(1); expect(missing.eligibility).toBe("inconclusive");
        expect(evaluateRecordedExperiment({ ...current, trials: trials.map(t => restamp(t, { agentIdentitySha256: null })) }).eligibility).toBe("inconclusive");
        expect(() => evaluateRecordedExperiment({ ...current, trials: [...trials, trials[0]!] })).toThrow("Duplicate");
        expect(() => evaluateRecordedExperiment({ ...current, trials: trials.map(t => restamp(t, { startedAt: "2000-01-01T00:00:00Z" })) })).toThrow("chronology");
    });
    test("repetition cannot launder one task into independent evidence; four-task pilot remains inconclusive", async () => {
        const repeated = await registered(input(1, 8)); const result = evaluateRecordedExperiment({ ...repeated.current, trials: syntheticTrials(repeated.current) });
        expect(result.heldOut.pairs).toBe(8); expect(result.heldOut.independentTasks).toBe(1); expect(result.heldOut.signProbability).toBe(0.5); expect(result.eligibility).toBe("inconclusive");
        const pilot = await registered(input(4, 2)); expect(evaluateRecordedExperiment({ ...pilot.current, trials: syntheticTrials(pilot.current) }).eligibility).toBe("inconclusive");
        const duplicate = input(); duplicate.tasks[1] = { ...duplicate.tasks[0]!, id: "a-renamed-copy" };
        expect(() => createExperimentPlan(duplicate)).toThrow("Renaming an identical");
    });
    test("every requirement remains visible and apparent greens cannot suppress regression or safety gaps", async () => {
        const { current } = await registered(); const trials = syntheticTrials(current);
        expect(() => evaluateRecordedExperiment({ ...current, trials: trials.map(t => restamp(t, { requirements: [] })) })).toThrow("every pinned");
        const failed = trials.map(t => restamp(t, { safety: { ...t.safety, authority: t.slot.arm === "candidate" ? "failed" : "passed" } }));
        expect(evaluateRecordedExperiment({ ...current, trials: failed }).eligibility).toBe("ineligible");
        const unknown = trials.map(t => restamp(t, { safety: { ...t.safety, secrets: "unknown" } }));
        expect(evaluateRecordedExperiment({ ...current, trials: unknown }).eligibility).toBe("inconclusive");
        const invented = trials.map(t => restamp(t, { safetyEvidence: { ...t.safetyEvidence, secrets: null } }));
        expect(() => evaluateRecordedExperiment({ ...current, trials: invented })).toThrow("No secret scan");
        const warmed = trials.map(t => restamp(t, { runtimeIds: ["shared-warm-runtime"] }));
        expect(evaluateRecordedExperiment({ ...current, trials: warmed }).eligibility).toBe("ineligible");
    });
    test("human research review cannot qualify an invented display hash", async () => {
        const { root, current } = await registered(); const trials = syntheticTrials(current); await storeSynthetic(root, trials);
        await expect(recordExperimentReview(root, { experimentSha256: current.plan.sha256, trialSha256: trials[0]!.sha256, candidateTree: trials[0]!.candidateTree!, actor: "Synthetic independent observer", independent: true, blinded: true, kind: "real-research-observation", criteria: [], displayReceiptSha256: "a".repeat(64) })).rejects.toThrow("actual retained");
    });
    test("missing, failed, duplicated and source-substituted private endings cannot masquerade as proved handover", async () => {
        const { current } = await registered(), trials = syntheticTrials(current);
        const handovers = trials.map(t => syntheticHandover(current, t.slot, t.startedAt, t.evidenceKind));
        const missing = compareRecordedExperiment({ ...current, trials, handovers: [] });
        expect(missing.eligibility).toBe("inconclusive"); expect(missing.findings.some(f => f.includes("fresh-clone audit not measured"))).toBe(true);
        const candidateIndex = trials.findIndex(t => t.slot.arm === "candidate"), original = handovers[candidateIndex]!;
        const failed = restamp(original, { status: "failed", delivery: null, freshClone: null, reason: "Synthetic corrupted receipt probe." } as any);
        const failedTrial = restamp(trials[candidateIndex]!, { safety: { ...trials[candidateIndex]!.safety, handoverAudit: "failed" }, safetyEvidence: { ...trials[candidateIndex]!.safetyEvidence, handoverAudit: failed.sha256 } });
        expect(compareRecordedExperiment({ ...current, trials: trials.map((t, i) => i === candidateIndex ? failedTrial : t), handovers: handovers.map((h, i) => i === candidateIndex ? failed : h) }).eligibility).toBe("ineligible");
        expect(() => compareRecordedExperiment({ ...current, trials, handovers: [...handovers, original] })).toThrow("Duplicate");
        expect(() => compareRecordedExperiment({ ...current, trials, handovers: handovers.map((h, i) => i === candidateIndex ? restamp(h, { candidateTree: "9".repeat(40) }) : h) })).toThrow("does not match");
        expect(() => compareRecordedExperiment({ ...current, trials, handovers: handovers.map((h, i) => i === candidateIndex ? restamp(h, { freshClone: { ...h.freshClone, audit: { ...h.freshClone.audit, claims: [{ id: "fake", status: "unavailable", reason: "Could not check" }] } } } as any) : h) })).toThrow();
    });
    test("new schema readers accept their emitted contracts and reject unversioned privilege additions", async () => {
        const { current } = await registered(), reader = await openReader(new URL("../../../schema", import.meta.url).pathname), trials = syntheticTrials(current);
        const grant = createExperimentGrant(current.plan, { actor: "Fixture operator", credentialNames: template.runtime.env!, expiresAt: "2030-01-01T00:00:00Z" }), result = evaluateRecordedExperiment({ ...current, trials });
        for (const [record, name] of [[current.plan, "experiment-plan-v1"], [current.registration, "experiment-registration-v1"], [trials[0], "experiment-trial-v1"], [grant, "experiment-grant-v1"], [result, "experiment-result-v1"]] as const) {
            expect((await reader.validate(record, `${name}.schema.json`)).ok).toBe(true);
            expect((await reader.validate({ ...record, approveProduction: true }, `${name}.schema.json`)).ok).toBe(false);
        }
    });
});

describe("one bounded contained proposal artifact", () => {
    async function git(repo: string, ...args: string[]) {
        const child = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        if (code) throw new Error(stderr); return stdout.trim();
    }
    async function proposalFixture() {
        const source = await privateDir(), state = await privateDir(); await git(source, "init", "-q"); await git(source, "config", "user.name", "Fixture"); await git(source, "config", "user.email", "fixture@example.invalid");
        await mkdir(join(source, "wringer/playbooks"), { recursive: true }); await mkdir(join(source, "wringer/proposals"), { recursive: true }); await mkdir(join(source, "tests"));
        const manifest = { schema_version: "wringer.playbook.v1" as const, id: "reports", revision: "one", title: "Reports fixture", role: "worker" as const, applicability: { taskFamily: "reports", context: [], tools: [], checks: [], scope: ["src"], design: false }, guidanceMarkdown: "Inspect the retained failure before changing the candidate.", limits: ["Advisory only."], evaluationRefs: [] };
        const content = JSON.stringify(manifest) + "\n", path = "wringer/playbooks/baseline.json", outputPath = "wringer/proposals/reports-next.json";
        await writeFile(join(source, path), content); await writeFile(join(source, outputPath), "{}\n"); await writeFile(join(source, "README.md"), "Fixture only\n"); await writeFile(join(source, "package.json"), "{}\n"); await writeFile(join(source, "bun.lock"), "fixture\n"); await writeFile(join(source, "tests/acceptance.test.ts"), "// immutable fixture check\n");
        await git(source, "add", "."); await git(source, "commit", "-qm", "fixture baseline"); const commit = await git(source, "rev-parse", "HEAD"), blob = await git(source, "rev-parse", `${commit}:${path}`);
        const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...base } = template;
        const plan = compileDeclaration({ version: 3, ...base, repository: { ...base.repository, commit }, scope: { writable: [outputPath] } });
        const snapshotBase = { schema_version: "wringer.playbook-snapshot.v1" as const, source: { repository: plan.repository, path, blob }, content, manifest, sha256: hashBytes(content) }, baseline = { ...snapshotBase, snapshot_sha256: hashValue(snapshotBase) };
        const patterns = stamped({ schema_version: "wringer.failure-pattern-report.v1" as const, repository: plan.repository.url, taskFamily: "reports", sources: ["a".repeat(64)], groups: [{ comparisonKey: "b".repeat(64), kind: "product-check" as const, requirementIds: ["total"], count: 1, observations: ["c".repeat(64)] }], limits: ["Synthetic development observation only."] });
        const request = createPlaybookProposalRequest({ plan, baseline, patterns, outputPath, prediction: input().prediction, actor: "Fixture operator", grantedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), maxSessions: 1, maxTurns: 1, wallClockSeconds: 30, credentialNames: plan.agents.worker.env!, dataScope: "this-repository-only", action: "propose-one-worker-playbook" });
        return { source, state, manifest, outputPath, request };
    }
    test("CLI prepare then fixture-backed propose reuses the exact request and captures one Git artifact without automatic experiment", async () => {
        const { source, state, manifest, outputPath, request } = await proposalFixture();
        const { schema_version, sha256, ...declaration } = request;
        await writeFile(join(state, "proposal-input.json"), JSON.stringify(declaration));
        const prepared = await experimentCommand(parseArgs(["experiment", "prepare-proposal", "--state", state, "--input", "proposal-input.json", "--output", "proposal-request.json"]), state);
        expect(prepared.value).toEqual(request);
        const retained = await readExperimentJson<typeof request>(join(state, "proposal-request.json"));
        const proposed = { manifest: { ...manifest, revision: "two", guidanceMarkdown: "Repair the named functional failure first, then rerun the same protected check." }, prediction: request.prediction };
        await writeFile(join(source, outputPath), JSON.stringify(proposed) + "\n"); const patch = await git(source, "diff", "--binary", "--full-index") + "\n"; await writeFile(join(source, outputPath), "{}\n");
        let calls = 0;
        const executor = async (r: RoleExecutionRequest): Promise<RoleExecutionResult> => {
            calls++; expect(r.role).toBe("worker"); expect(r.scope?.writable).toEqual([outputPath]); expect(r.scope?.protected).toContain("wringer/playbooks/baseline.json"); expect(r.prompt).toContain("SANITISED DEVELOPMENT"); expect(r.prompt).not.toContain("PRIVATE_HELDOUT_ANSWER");
            return { status: "completed", text: "One inactive artifact proposed.", stopReason: "end_turn", sessionId: "fixture-proposer", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: { schema_version: "wringer.runtime.v1", runtimeId: "fixture-proposal-runtime", role: "worker", kind: r.runtime.kind, image: r.runtime.image, repository: r.repo, clonedInside: true, hostMounts: [], repositoryAccess: "read-write", declared: r.runtime, observed: {}, limits: ["Scripted fixture, not live containment."] }, change: { baseCommit: r.repo.commit, patch, sha256: hashBytes(patch) } };
        };
        const options = { fixtureExecutor: executor, fixtureSource: (plan: ExecutionPlan, state: string) => prepareRepositorySource(plan.repository, { controllerDir: state, localRepo: source }) };
        const result = await proposePlaybookImprovement(state, retained, options);
        if (result.status !== "proposed") throw new Error(String(result.reason));
        expect(result.status).toBe("proposed"); expect(result.evidenceKind).toBe("deterministic-fixture"); expect(result.adoption).toBe("not-granted"); expect(result.executionApproval).toBe("not-granted");
        expect(await proposePlaybookImprovement(state, request, options)).toEqual(result); expect(calls).toBe(1);
        expect(await readFile(join(source, outputPath), "utf8")).toBe("{}\n"); expect(await readFile(join(source, "wringer/playbooks/baseline.json"), "utf8")).toBe(JSON.stringify(manifest) + "\n");
        expect(await readExperimentJson<typeof request>(join(state, "proposal-request.json"))).toEqual(retained);
    });
    test("a different request cannot replace the prepared proposal or reserve source/model activity", async () => {
        const { state, request } = await proposalFixture(), { schema_version, sha256, ...declaration } = request;
        await writeFile(join(state, "proposal-input.json"), JSON.stringify(declaration));
        await experimentCommand(parseArgs(["experiment", "prepare-proposal", "--state", state, "--input", "proposal-input.json", "--output", "proposal-request.json"]), state);
        const changed = createPlaybookProposalRequest({ ...declaration, actor: "Another operator and different request" });
        let calls = 0;
        await expect(proposePlaybookImprovement(state, changed, { fixtureSource: async () => { calls++; throw new Error("Must refuse before preparing source"); }, fixtureExecutor: async () => { calls++; throw new Error("Must refuse before model work"); } })).rejects.toThrow("immutable prepared proposal");
        expect(calls).toBe(0); expect(await readExperimentJson<typeof request>(join(state, "proposal-request.json"))).toEqual(request);
        expect(await readFile(join(state, "proposal-reservation.json"), "utf8").then(() => true, () => false)).toBe(false);
    });
    test("proposal scope and report shape reject policy changes and raw transcripts before any model", async () => {
        const { request } = await proposalFixture(), { schema_version, sha256, ...raw } = request;
        expect(() => createPlaybookProposalRequest({ ...raw, outputPath: ".wringer/authority.json" })).toThrow("controller record");
        expect(() => createPlaybookProposalRequest({ ...raw, maxSessions: 2 as any })).toThrow("authority");
        expect(() => createPlaybookProposalRequest({ ...raw, patterns: stamped({ ...raw.patterns, rawConversation: "Private transcript" }) as any })).toThrow();
    });
});
describe("finite collection and future-only adoption", () => {
    test("real collector defaults exist; injected fixtures stay fixtures and failures retain every planned slot", async () => {
        const { root, current } = await registered(input(1)); let calls = 0;
        const grant = createExperimentGrant(current.plan, { actor: "Fixture operator", credentialNames: template.runtime.env!, expiresAt: new Date(Date.now() + 60000).toISOString() });
        const options = { fixture: { run: async (plan: ExecutionPlan, state: string) => { calls++; const purpose = JSON.parse(await readFile(join(state, "experiment-purpose.json"), "utf8")); expect(purpose.purpose).toBe("private-research-only"); expect(purpose.planSha256).toBe(plan.plan_sha256); throw new Error("Deliberate fixture runtime unavailable"); } } };
        const collected = await collectExperiment(root, grant, options); expect(calls).toBe(1); expect(collected.trials).toHaveLength(2);
        expect(collected.trials.map(t => t.outcome).sort()).toEqual(["infrastructure-failed", "not-started"]); expect(collected.trials.every(t => t.evidenceKind === "deterministic-fixture")).toBe(true);
        const ledger = await readExperimentJson<any>(join(root, "collection.json")); expect(ledger.reservations.reduce((n: number, s: any) => n + s.reservedSessions, 0)).toBe(16);
        await collectExperiment(root, grant, options); expect(calls).toBe(1);
        await expect(collectExperiment(root, grant)).rejects.toThrow("cannot change on resume");
        await expect(collectExperiment(root, restamp(grant, { actor: "Different grant" }), options)).rejects.toThrow();
        const result = await evaluateExperiment(root); expect(result.plannedTrials).toBe(2); expect(result.recordedTrials).toBe(2); expect(result.eligibility).toBe("inconclusive");
    });
    test("restart retains uncertain reservation rather than replaying it; missing completed records refuse", async () => {
        const { root, current } = await registered(input(1)); let calls = 0;
        const grant = createExperimentGrant(current.plan, { actor: "Fixture operator", credentialNames: template.runtime.env!, expiresAt: new Date(Date.now() + 60000).toISOString() });
        await collectExperiment(root, grant, { fixture: { run: async () => { calls++; throw new Error("fixture"); } } });
        let collection = await readExperimentJson<any>(join(root, "collection.json"));
        const first = collection.slots[0]; first.status = "dispatched"; collection = restamp(collection, {}); await atomicJson(root, "collection.json", collection);
        await unlink(join(root, "trials", `${first.id}.json`));
        const resumed = await collectExperiment(root, grant, { fixture: { run: async () => { calls++; throw new Error("must not replay"); } } });
        expect(calls).toBe(1); expect(resumed.trials.find(t => t.slot.id === first.id)?.outcome).toBe("uncertain");
        await unlink(join(root, "trials", `${first.id}.json`));
        await expect(collectExperiment(root, grant, { fixture: { run: async () => { throw new Error("must not replay"); } } })).rejects.toThrow("previously recorded trial is missing");
    });
    test("promotion and rollback use CAS, keep active files unchanged and never start a run", async () => {
        const { root, current } = await registered(), registry = await privateDir(); await storeSynthetic(root, syntheticTrials(current));
        const evidence = await evaluateExperiment(root), before = await readFile(join(root, "registration.json"), "utf8");
        const options = { actor: "Synthetic operator", note: "Comparator fixture only; not a live benefit claim", expectedRevision: ZERO, expectedCurrentDigest: null, expectedEvidenceRevision: evidence.evidenceRevision };
        const decision = await promoteExperiment(root, registry, options);
        expect(decision.appliesTo).toBe("future-plans-only"); expect(decision.executionApproved).toBe(false); expect(decision.selectedDigest).toBe(candidateDigest);
        await expect(promoteExperiment(root, registry, options)).rejects.toThrow("current approach changed");
        const rollback = await rollbackPlaybook(registry, { ...options, expectedRevision: decision.sha256, expectedCurrentDigest: candidateDigest });
        expect(rollback.selectedDigest).toBeNull(); expect((await readPlaybookAdoptions(registry)).length).toBe(2);
        expect(await readFile(join(root, "registration.json"), "utf8")).toBe(before);
        await expect(rollbackPlaybook(registry, { ...options, expectedRevision: rollback.sha256 })).rejects.toThrow("already a rollback");
    });
    test("fixture benefit cannot be promoted; stale evidence and concurrent adoption are rejected", async () => {
        const { root, current } = await registered(), registry = await privateDir(); await storeSynthetic(root, syntheticTrials(current, 1, "deterministic-fixture"));
        const result = await evaluateExperiment(root);
        await expect(promoteExperiment(root, registry, { actor: "Fixture", note: "No actual adoption", expectedRevision: ZERO, expectedCurrentDigest: null, expectedEvidenceRevision: result.evidenceRevision })).rejects.toThrow("inconclusive");
    });
});
describe("narrow failure patterns and operator entry", () => {
    test("patterns exclude held-out feedback and never carry raw prompts or exception text", async () => {
        const declaration = input(); declaration.tasks[0]!.split = "development";
        const { current } = await registered(declaration); const trials = syntheticTrials(current).map(t => restamp(t, { functionalCompletion: false, outcome: "stopped", requirements: [{ id: "total", kind: "check", met: false }], stopReason: "Private failure prose must not enter the pattern report" }));
        const report = failurePatternReport([{ ...current, trials }]); expect(report.groups.reduce((n, g) => n + g.count, 0)).toBe(2);
        expect(JSON.stringify(report)).not.toContain("Private failure prose"); expect(report.sources).toEqual([current.registration.sha256]);
        const other = { ...current, plan: { ...current.plan, repository: "https://example.invalid/other.git" } }; expect(() => failurePatternReport([{ ...current, trials }, other])).toThrow();
    });
    test("inventory confines operator paths and CLI guarded operations refuse before effects without yes", async () => {
        const parent = await privateDir(); await mkdir(join(parent, "experiments"), { mode: 0o700 }); const child = join(parent, "experiments", "reports"); await mkdir(child, { mode: 0o700 }); await registerExperiment(child, input());
        expect((await listExperiments(parent))[0]?.id).toBe("reports"); expect(await listExperiments(parent, { repository: "other" })).toEqual([]);
        await expect(experimentCommand(parseArgs(["experiment", "collect", "--state", child, "--grant", "missing.json"]), parent)).rejects.toThrow("--yes");
        const evaluated = await experimentCommand(parseArgs(["experiment", "evaluate", "--state", child]), parent); expect(evaluated.text).toContain("No provider or credential calls");
        await symlink(child, join(parent, "experiments", "linked")); await expect(listExperiments(parent)).rejects.toThrow("symbolic");
    });
});
