import { describe, test, expect, spyOn } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, lstat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { compileDeclaration, discoverEnvironment, createExecutionAuthority, hashBytes, type ExecutionPlan } from "@wringer/plan";
import { createLocalSourceBundle, prepareRepositorySource, type RoleExecutionRequest, type RoleExecutionResult, type ContainedCommandRequest, type RuntimeProvenance } from "@wringer/runtime";
import { runContainedJourney, readValidatedContainedState } from "@wringer/workflow";
import { containedServices, showContainedCandidate } from "../src/services";
import { measureExperimentHandover } from "../src/experiment-handover";
import { ensureExperimentControllerPurpose } from "../src/experiment-purpose";
import { deliverContained, auditContained } from "@wringer/delivery";
import { registerExperiment, experimentSchedule, readExperiment, recordExperimentReview, finishExperimentResearch, evaluateExperiment } from "../src/experiments";
import { stamped, exclusiveJson } from "../src/experiment-store";
import type { ExperimentTrial } from "../src/experiment-types";
import { openReader } from "../../records/src/read";

async function git(repo: string, args: string[]): Promise<string> {
    const child = Bun.spawn(["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", ...args], { cwd: repo, env: { PATH: process.env.PATH, HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code) throw new Error(stderr); return stdout;
}
async function fixture(human = false) {
    const root = await mkdtemp(join(tmpdir(), "wringer-private-handover-")), source = join(root, "source"), state = join(root, "journeys", "fixture-1-baseline");
    await mkdir(source, { mode: 0o700 }); await mkdir(state, { mode: 0o700, recursive: true });
    await git(source, ["init", "--initial-branch=main"]); await git(source, ["config", "--local", "user.name", "Private experiment fixture"]); await git(source, ["config", "--local", "user.email", "experiment@example.invalid"]);
    const playbook = JSON.stringify({ schema_version: "wringer.playbook.v1", id: "fixture", revision: "one", role: "worker", title: "Fixture", applicability: { taskFamily: "fixture", context: [], tools: [], checks: [], scope: ["product.txt"], design: false }, guidanceMarkdown: "Use measured check feedback.", limits: ["Fixture only, no efficacy claim."], evaluationRefs: [] });
    await writeFile(join(source, "README.md"), "Synthetic role observations; real Git and portable handover measurement.\n"); await writeFile(join(source, "product.txt"), "before\n"); await writeFile(join(source, "check.sh"), "test \"$(cat product.txt)\" = after\n"); await writeFile(join(source, "playbook.json"), playbook);
    await git(source, ["add", "."]); await git(source, ["commit", "-m", "Frozen fixture source"]);
    const commit = (await git(source, ["rev-parse", "HEAD"])).trim(), sourceTree = (await git(source, ["rev-parse", "HEAD^{tree}"])).trim();
    const declaration = { version: 3, name: "Private experimental handover fixture", intent: "Return after.", repository: { url: "https://example.invalid/research.git", commit }, runtime: { kind: "apple-container", image: `fixture.invalid/runtime@sha256:${"a".repeat(64)}`, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] }, agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } }, environment: { context: ["README.md"], tools: [], setup: [], baseline: [] }, scope: { writable: ["product.txt"] }, acceptance: { criteria: [{ id: "after", title: "Return after", quote: "Return after.", kind: "check", required: true }, ...(human ? [{ id: "readable", title: "Readable", quote: "Return after.", kind: "human", required: true, show: { id: "show", argv: ["cat", "product.txt"], cwd: ".", timeout_seconds: 10 } }] : [])], checks: [{ id: "after", argv: ["sh", "check.sh"], cwd: ".", timeout_seconds: 10, criteria: ["after"], files: ["check.sh"] }], protected_paths: ["check.sh", "playbook.json"] }, budget: { max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 300, session_timeout_seconds: 30 } };
    const plan = compileDeclaration(declaration), candidate = compileDeclaration({ ...declaration, playbook: { path: "playbook.json", sha256: hashBytes(playbook), taskFamily: "fixture" } });
    const registration = await registerExperiment(root, { id: "handover-fixture", repository: plan.repository.url, taskFamily: "fixture", baselinePlaybook: null, candidatePlaybook: candidate.playbook!.sha256, changedVariable: "worker-playbook", tasks: [{ id: "fixture", sourceTree, split: "held-out", baseline: plan, candidate }], repetitions: 1, order: "alternating-pairs", stratum: { platform: "darwin", modelSelection: "scripted fixture", adapterSelection: "scripted fixture" }, prediction: { statement: "Fixture comparison, no live claim.", metric: "worker-attempts", minimumImprovement: 1, minimumHeldOutPairs: 4, maximumSignProbability: 0.05, visualQualityClaim: false }, limits: { maxTrials: 2, maxRoleSessions: 8, wallClockSeconds: 300 }, dataScope: "this-repository-only", holdout: { corpusId: "fixture", candidateIteration: 1, maximumCandidateIterations: 1, candidateAuthorSawHeldOutSolutions: false }, accounting: "all-planned-trials-including-failures", stoppingRule: "fixed-sample-no-extension" });
    const slot = experimentSchedule(registration.plan).find(s => s.arm === "baseline")!;
    await ensureExperimentControllerPurpose(root, state, registration.plan, registration.sha256, slot);
    const sourceBundle = join(root, "source.bundle"); await createLocalSourceBundle(source, commit, sourceBundle);
    const prepared = await prepareRepositorySource({ ...plan.repository, bundlePath: sourceBundle }, { controllerDir: state }), environment = await discoverEnvironment(prepared.objectStore, plan), authority = createExecutionAuthority(plan, { actor: "Experiment: scripted fixture operator", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 300000).toISOString() });
    await writeFile(join(source, "product.txt"), "after\n"); const patch = await git(source, ["diff", "--binary", "--full-index"]); await writeFile(join(source, "product.txt"), "before\n");
    const protectedBytes = await git(prepared.objectStore, ["--literal-pathspecs", "ls-tree", "-r", "-z", commit, "--", ...plan.acceptance.protected_paths]);
    function provenance(role: RuntimeProvenance["role"], repo: { url: string; commit: string }): RuntimeProvenance { return { schema_version: "wringer.runtime.v1", runtimeId: randomUUID(), role, kind: plan.runtime.kind, image: plan.runtime.image, repository: { url: repo.url, commit: repo.commit }, clonedInside: true, hostMounts: [], repositoryAccess: role === "worker" ? "read-write" : "read-only", declared: plan.runtime, observed: { fixture: true, writableDirectories: [] }, limits: ["Synthetic runtime, not proof of live containment."] }; }
    const runCommands = async (request: ContainedCommandRequest) => {
        const store = (request.repo as unknown as { objectStore: string }).objectStore, tree = (await git(store, ["rev-parse", `${request.repo.commit}^{tree}`])).trim(), baseline = request.repo.commit === commit;
        return { provenance: provenance("verifier", request.repo), sourceChanged: false, sourceTree: tree, checkInputsSha256: hashBytes(protectedBytes), results: request.commands.map(c => ({ id: c.id, code: baseline ? 1 : 0, stdout: baseline ? "before\n" : "after\n", stderr: "", durationMs: 1 })) };
    };
    const services = containedServices(state, prepared, { runCommands });
    const executor = async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => ({ status: "completed", text: request.role === "worker" ? "Scripted change." : JSON.stringify({ criteria: [{ id: "after", met: true, reason: "Synthetic independent fixture finding." }], note: "Fixture only." }), sessionId: randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: provenance(request.role, request.repo), ...(request.role === "worker" ? { change: { baseCommit: request.repo.commit, patch, sha256: hashBytes(patch) } } : {}) });
    const result = await runContainedJourney({ controllerDir: state, plan, authority, environment, services, executeRole: executor }), validated = await readValidatedContainedState(state);
    return { root, state, source, result, validated, plan, registration, slot, runCommands };
}
async function researchFixture(accepted = true) {
    const f = await fixture(true), candidate = f.result.candidate!, at = new Date().toISOString();
    const ending = await measureExperimentHandover({ root: f.root, state: f.state, experiment: f.registration.plan, registrationSha256: f.registration.sha256, slot: f.slot, plan: f.plan, result: f.result, validated: f.validated, fixture: true });
    const trial: ExperimentTrial = stamped({ schema_version: "wringer.experiment-trial.v1", experimentSha256: f.registration.plan.sha256, registrationSha256: f.registration.sha256, slot: f.slot, startedAt: at, finishedAt: at, evidenceKind: "deterministic-fixture", outcome: "human-hold", workerAttempts: 1, roleSessions: f.result.sessions, functionalCompletion: true, requirements: [{ id: "after", kind: "check", met: true }, { id: "readable", kind: "human", met: null }], safety: { authority: "unknown", acceptance: "unknown", containment: "unknown", secrets: "unknown", handoverAudit: "unknown", productionPublication: "not-attempted" }, safetyEvidence: { authority: null, acceptance: null, containment: null, secrets: null, handoverAudit: ending.sha256 }, candidateCommit: candidate.source.commit, candidateTree: candidate.tree, journeyRevision: f.validated.events.at(-1)!.sha256, runtimeIds: f.validated.state.runtimeIds, agentIdentitySha256: null, stopReason: "Fixture observer has not reviewed it.", cost: null });
    await exclusiveJson(f.root, `trials/${f.slot.id}.json`, trial);
    const shown = await showContainedCandidate(f.plan, candidate.source, "readable", undefined, { runCommands: f.runCommands });
    const display = stamped({ schema_version: "wringer.experiment-research-display.v1", experimentSha256: f.registration.plan.sha256, trialSha256: trial.sha256, candidateCommit: candidate.source.commit, candidateTree: candidate.tree, snapshot: null, displays: [{ criterionId: "readable", ...shown }] });
    await exclusiveJson(f.root, `displays/${f.slot.id}.json`, display);
    const review = await recordExperimentReview(f.root, { experimentSha256: f.registration.plan.sha256, trialSha256: trial.sha256, candidateTree: candidate.tree, actor: "Scripted fixture reviewer", independent: true, blinded: true, kind: "deterministic-fixture", criteria: [{ id: "readable", met: accepted, note: "Synthetic observation of the shown after value; not a real PM judgement." }], displayReceiptSha256: display.sha256 });
    return { ...f, trial, review, ending };
}
describe("actual private experimental ending, scripted role work", () => {
    test("normal delivery pushes only generated local origin and literal fresh clone audits exact v4 receipts", async () => {
        const f = await fixture(); expect(f.result.status).toBe("review-ready");
        const purpose = JSON.parse(await readFile(join(f.state, "experiment-purpose.json"), "utf8"));
        expect(purpose.purpose).toBe("private-research-only"); expect(purpose.planSha256).toBe(f.plan.plan_sha256);
        for (const send of [false, true]) await expect(deliverContained({ stateDir: f.state, publication: { remote: f.source, sourceBranch: "wringer/product-review", targetBranch: "main" }, send })).rejects.toThrow(/research|experiment/i);
        const network = spyOn(globalThis, "fetch").mockImplementation((() => { throw new Error("An experimental forge request must never reach network activity"); }) as unknown as typeof globalThis.fetch);
        try {
            await expect(deliverContained({ stateDir: f.state, publication: { ...purpose.allowedPublications[0], forge: { kind: "github", endpoint: "https://api.github.com", repo: "fixture/not-a-real-publication", token_env: "FIXTURE_MUST_NOT_BE_READ" } }, send: true })).rejects.toThrow(/research|forge/i);
            expect(network).not.toHaveBeenCalled();
        } finally { network.mockRestore(); }
        await unlink(join(f.state, "experiment-purpose.json"));
        await expect(deliverContained({ stateDir: f.state, publication: { remote: f.source, sourceBranch: "wringer/product-review", targetBranch: "main" }, send: true })).rejects.toThrow(/no retained private-purpose/i);
        await ensureExperimentControllerPurpose(f.root, f.state, f.registration.plan, f.registration.sha256, f.slot);
        const options = { root: f.root, state: f.state, experiment: f.registration.plan, registrationSha256: f.registration.sha256, slot: f.slot, plan: f.plan, result: f.result, validated: f.validated, fixture: true };
        const measured = await measureExperimentHandover(options);
        if (measured.status !== "passed") throw new Error(measured.reason);
        expect(measured.evidenceKind).toBe("deterministic-fixture"); expect(measured.productionPublication).toBe("not-attempted"); expect(measured.freshClone?.audit.claims.every(c => c.status === "checked")).toBe(true);
        const local = join(f.root, "private-deliveries", f.slot.id), clone = join(local, "fresh-clone"), origin = join(local, "origin.git");
        expect((await git(clone, ["rev-parse", "HEAD"])).trim()).toBe(measured.delivery!.evidenceCommit);
        expect((await git(origin, ["config", "--local", "wringer.researchOnly"])).trim()).toBe(f.registration.plan.sha256);
        expect(await readFile(join(f.source, "product.txt"), "utf8")).toBe("before\n");
        expect(await measureExperimentHandover(options)).toEqual(measured);
        const reader = await openReader(new URL("../../../schema", import.meta.url).pathname); expect((await reader.validate(measured, "experiment-handover-v1.schema.json")).ok).toBe(true);
        const reservation = JSON.parse(await readFile(join(f.root, "handover-reservations", `${f.slot.id}.json`), "utf8")); expect((await reader.validate(reservation, "experiment-handover-reservation-v1.schema.json")).ok).toBe(true);
        expect((await reader.validate(purpose, "experiment-controller-purpose-v1.schema.json")).ok).toBe(true);
        const portable = join(clone, ".wringer/deliveries", measured.delivery!.deliveryId), purposePath = join(portable, "research-purpose.json"), publicPurpose = JSON.parse(await readFile(purposePath, "utf8"));
        expect(publicPurpose.controllerPurposeSha256).toBe(purpose.sha256); expect(JSON.stringify(publicPurpose)).not.toContain(f.root); expect(publicPurpose.purpose).toBe("private-research-only");
        expect(await readFile(join(portable, "mr.md"), "utf8")).toContain("PRIVATE EXPERIMENTAL HANDOVER");
        expect(await readFile(join(portable, "summary.md"), "utf8")).toContain("PRIVATE EXPERIMENTAL HANDOVER");
        await writeFile(purposePath, JSON.stringify({ ...publicPurpose, purpose: "production" }));
        expect((await auditContained(portable)).status).toBe("failed");
    }, 30000);
    test("corrupt portable observation records fail the ending and cannot become handover passed", async () => {
        const f = await fixture(), observation = join(f.result.verification!.evidenceRef, "observations.json"), data = JSON.parse(await readFile(observation, "utf8")); data.results[0].stdout = "Substituted receipt"; await writeFile(observation, JSON.stringify(data));
        const measured = await measureExperimentHandover({ root: f.root, state: f.state, experiment: f.registration.plan, registrationSha256: f.registration.sha256, slot: f.slot, plan: f.plan, result: f.result, validated: f.validated, fixture: true });
        expect(measured.status).toBe("failed"); expect(measured.freshClone).toBeNull(); expect(measured.reason).toMatch(/observation|output|receipt|digest|differs/i);
    }, 30000);
    test("human hold stays unknown and does not receive a synthetic Yes or private publication", async () => {
        const f = await fixture(true); expect(f.result.status).toBe("human-hold");
        const measured = await measureExperimentHandover({ root: f.root, state: f.state, experiment: f.registration.plan, registrationSha256: f.registration.sha256, slot: f.slot, plan: f.plan, result: f.result, validated: f.validated, fixture: true });
        expect(measured.status).toBe("unknown"); expect(measured.productionHumanApproval).toBe("not-granted"); expect(measured.delivery).toBeNull(); expect(measured.reason).toContain("research observation cannot become production Yes");
        expect(await lstat(join(f.root, "private-deliveries")).then(() => true, () => false)).toBe(false); expect((await readValidatedContainedState(f.state)).state.humanJudgements).toEqual([]);
    }, 30000);
    test("separate fixture-labelled human research ending preserves original trial and audits the private branch with zero extra roles", async () => {
        const f = await researchFixture(), input = { trialSha256: f.trial.sha256, expectedReviewSha256: f.review.sha256, actor: "Fixture research operator", wallClockSeconds: 120 };
        const completion = await finishExperimentResearch(f.root, input);
        if (completion.status !== "passed") throw new Error(completion.reason);
        expect(completion.evidenceKind).toBe("deterministic-fixture"); expect(completion.reservation.roleSessions).toBe(0); expect(completion.productionHumanApproval).toBe("not-granted"); expect(completion.handover!.freshClone!.audit.human).toBe(1);
        const current = await readExperiment(f.root); expect(current.trials[0]!.sha256).toBe(f.trial.sha256); expect(current.handovers[0]!.status).toBe("unknown"); expect(current.completions[0]).toEqual(completion);
        expect((await readValidatedContainedState(f.state)).result.sessions).toBe(f.result.sessions); expect((await evaluateExperiment(f.root)).eligibility).toBe("inconclusive");
        await expect(deliverContained({ stateDir: f.state, publication: { remote: f.source, sourceBranch: "wringer/product-review", targetBranch: "main" }, send: true })).rejects.toThrow(/research|experiment/i);
        expect(await finishExperimentResearch(f.root, input)).toEqual(completion);
        const reader = await openReader(new URL("../../../schema", import.meta.url).pathname);
        expect((await reader.validate(completion, "experiment-research-completion-v1.schema.json")).ok).toBe(true); expect((await reader.validate(completion.reservation, "experiment-research-finish-reservation-v1.schema.json")).ok).toBe(true);
    }, 60000);
    test("negative research review and expired original approval cannot be turned into an ending or fresh worker grant", async () => {
        const rejected = await researchFixture(false);
        await expect(finishExperimentResearch(rejected.root, { trialSha256: rejected.trial.sha256, expectedReviewSha256: rejected.review.sha256, actor: "Fixture operator", wallClockSeconds: 120 })).rejects.toThrow("negative");
        const f = await researchFixture(), now = spyOn(Date, "now").mockReturnValue(Date.now() + 86400000);
        try { await expect(finishExperimentResearch(f.root, { trialSha256: f.trial.sha256, expectedReviewSha256: f.review.sha256, actor: "Fixture operator", wallClockSeconds: 120 })).rejects.toThrow(/out of date|expired/); }
        finally { now.mockRestore(); }
        expect((await readValidatedContainedState(f.state)).result.status).toBe("human-hold"); expect((await readExperiment(f.root)).completions).toEqual([]);
    }, 30000);
});
