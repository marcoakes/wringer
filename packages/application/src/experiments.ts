import { readdir, lstat } from "node:fs/promises";
import { hashValue, validateExecutionPlan } from "@wringer/plan";
import { assertContainedDisplayVisuals } from "@wringer/workflow";
import { parseDesignSnapshot } from "@wringer/design";
import type { ExecutionPlan } from "@wringer/plan";
import type { ExperimentPlanInput, ExperimentPlan, ExperimentGrant, ExperimentTrialSlot, ExperimentTrial, ExperimentResearchReview, ExperimentResearchDisplay, ExperimentHandover, ExperimentResearchCompletion, ExperimentResult, ImprovementPrediction, PlaybookAdoption, FailurePatternReport } from "./experiment-types";
import { boundedText, id, hash, integer, shape, stamped, verifyStamp, privateExperimentRoot, optionalJson, records, exclusiveJson, experimentLock, experimentPath, ZERO, clean } from "./experiment-store";

export * from "./experiment-types";
export { collectExperiment, proposePlaybookImprovement, createPlaybookProposalRequest } from "./experiment-collect";
export type { ExperimentCollectionOptions, PlaybookProposalRequest, PlaybookProposalOptions } from "./experiment-collect";
export { finishExperimentResearch } from "./experiment-research-finish";
export type { ExperimentResearchFinishInput } from "./experiment-research-finish";

export function validateImprovementPrediction(value: unknown): ImprovementPrediction {
    shape(value, ["statement", "metric", "minimumImprovement", "minimumHeldOutPairs", "maximumSignProbability", "visualQualityClaim"], "Prediction");
    boundedText(value.statement, "Falsifiable prediction");
    if (!["worker-attempts", "functional-completion"].includes(value.metric) || !Number.isFinite(value.minimumImprovement) || value.minimumImprovement <= 0 || value.minimumImprovement > (value.metric === "functional-completion" ? 1 : 1000)) throw new Error("Prediction needs one supported measured benefit and a positive minimum useful change");
    integer(value.minimumHeldOutPairs, "Minimum held-out pairs", 4, 128);
    if (!Number.isFinite(value.maximumSignProbability) || value.maximumSignProbability <= 0 || value.maximumSignProbability > 0.05 || typeof value.visualQualityClaim !== "boolean") throw new Error("Prediction needs a conservative predeclared uncertainty threshold (at most 0.05)");
    return clean(value as ImprovementPrediction);
}
function playbook(plan: ExecutionPlan): { path: string; sha256: string; taskFamily: string } | undefined { return (plan as ExecutionPlan & { playbook?: { path: string; sha256: string; taskFamily: string } }).playbook; }
function withoutApproach(plan: ExecutionPlan) {
    // Selection includes its provenance: rollback-to-none lives alongside the
    // absent playbook. Every source, grader, loop and authority control stays pinned.
    const { plan_sha256, playbook, approachAdoption, ...rest } = plan;
    return rest;
}
export function createExperimentPlan(input: ExperimentPlanInput): ExperimentPlan {
    shape(input, ["id", "taskFamily", "repository", "baselinePlaybook", "candidatePlaybook", "changedVariable", "tasks", "repetitions", "order", "stratum", "prediction", "limits", "dataScope", "holdout", "accounting", "stoppingRule"], "Experiment declaration");
    id(input.id); id(input.taskFamily); boundedText(input.repository, "Repository", 2048);
    if (input.baselinePlaybook !== null) hash(input.baselinePlaybook); hash(input.candidatePlaybook);
    if (input.baselinePlaybook === input.candidatePlaybook) throw new Error("Candidate must identify different playbook bytes; a no-op is not an improvement experiment");
    if (input.changedVariable !== "worker-playbook" || input.order !== "alternating-pairs" || input.dataScope !== "this-repository-only" || input.accounting !== "all-planned-trials-including-failures" || input.stoppingRule !== "fixed-sample-no-extension") throw new Error("Experiments permit one worker-playbook variable, a fixed alternating sample and repository-only data");
    integer(input.repetitions, "Repetitions", 1, 8);
    shape(input.limits, ["maxTrials", "maxRoleSessions", "wallClockSeconds"], "Experiment limits");
    integer(input.limits.maxTrials, "Maximum trials", 2, 128); integer(input.limits.maxRoleSessions, "Maximum role sessions", 2, 4096); integer(input.limits.wallClockSeconds, "Experiment wall clock", 1, 604800);
    shape(input.stratum, ["platform", "modelSelection", "adapterSelection"], "Experiment stratum");
    if (!["darwin", "linux"].includes(input.stratum.platform)) throw new Error("Choose one measured platform stratum");
    boundedText(input.stratum.modelSelection, "Pinned model selection", 1000); boundedText(input.stratum.adapterSelection, "Pinned adapter selection", 1000);
    shape(input.holdout, ["corpusId", "candidateIteration", "maximumCandidateIterations", "candidateAuthorSawHeldOutSolutions"], "Holdout policy");
    id(input.holdout.corpusId); integer(input.holdout.candidateIteration, "Candidate iteration", 1, 100); integer(input.holdout.maximumCandidateIterations, "Candidate iteration ceiling", 1, 100);
    if (input.holdout.candidateIteration > input.holdout.maximumCandidateIterations || input.holdout.candidateAuthorSawHeldOutSolutions !== false) throw new Error("Contaminated or exhausted held-out evaluation cannot authorise an improvement claim");
    if (!Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > 32 || new Set(input.tasks.map(t => t.id)).size !== input.tasks.length) throw new Error("Supply 1-32 distinct frozen tasks");
    for (const task of input.tasks) {
        shape(task, ["id", "sourceTree", "split", "baseline", "candidate"], "Experiment task"); id(task.id);
        if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(task.sourceTree)) throw new Error("Every task must pin its observed Git source tree before trials");
        if (!["development", "held-out"].includes(task.split)) throw new Error("Every task must declare its development or held-out split before collection");
        const baseline = validateExecutionPlan(task.baseline, { credentialEnvironment: {} }), candidate = validateExecutionPlan(task.candidate, { credentialEnvironment: {} });
        if (baseline.repository.url !== input.repository || candidate.repository.url !== input.repository) throw new Error("Experiment tasks cannot export repository-specific material to another repository");
        if (hashValue(withoutApproach(baseline)) !== hashValue(withoutApproach(candidate))) throw new Error("Only the worker playbook may differ: source, intent, tests, grader, runtime, agents, scope, authority ceilings and protected paths must remain identical");
        if ((playbook(baseline)?.sha256 ?? null) !== input.baselinePlaybook || playbook(candidate)?.sha256 !== input.candidatePlaybook || playbook(candidate)?.taskFamily !== input.taskFamily || playbook(baseline) && playbook(baseline)?.taskFamily !== input.taskFamily) throw new Error("Each arm must pin exactly the declared playbook digest and task family");
        const names = [...new Set([...(baseline.runtime.env ?? []), ...Object.values(baseline.agents).flatMap(agent => agent?.env ?? [])])];
        if (names.some(name => /(?:GITHUB|GH_TOKEN|GITLAB|FORGE|PUBLICATION|DEPLOY|WRINGER_.*(?:TOKEN|KEY))/i.test(name))) throw new Error("Experiment role environments cannot contain forge, controller or publication credential names");
        if (input.stratum.platform === "darwin" ? baseline.runtime.kind !== "apple-container" : baseline.runtime.kind !== "gvisor-kubernetes") throw new Error("Runtime does not match the fixed platform stratum");
    }
    const identities = input.tasks.map(task => hashValue({ sourceTree: task.sourceTree, intent: task.baseline.intent_sha256, acceptance: task.baseline.acceptance_sha256 }));
    if (new Set(identities).size !== identities.length) throw new Error("Renaming an identical source/intent/acceptance task cannot manufacture independent held-out evidence");
    validateImprovementPrediction(input.prediction);
    const plan = stamped({ schema_version: "wringer.experiment-plan.v1" as const, ...structuredClone(input) });
    const schedule = experimentSchedule(plan);
    if (schedule.length > plan.limits.maxTrials || schedule.reduce((sum, slot) => sum + slot.reservedSessions, 0) > plan.limits.maxRoleSessions) throw new Error("The whole planned comparison must fit its finite aggregate trial/session ceiling before any side effect");
    return plan;
}
export function validateExperimentPlan(value: ExperimentPlan): ExperimentPlan {
    verifyStamp(value); const { schema_version, sha256, ...input } = value;
    if (schema_version !== "wringer.experiment-plan.v1") throw new Error("Unsupported experiment plan version");
    const normalized = createExperimentPlan(input);
    if (normalized.sha256 !== sha256) throw new Error("Experiment plan is not canonical");
    return normalized;
}
export function experimentSchedule(plan: ExperimentPlan): ExperimentTrialSlot[] {
    const slots: ExperimentTrialSlot[] = [];
    for (let repetition = 1; repetition <= plan.repetitions; repetition++) for (const [taskIndex, task] of plan.tasks.entries()) {
        const arms = (repetition + taskIndex) % 2 ? ["baseline", "candidate"] as const : ["candidate", "baseline"] as const;
        for (const arm of arms) slots.push({ id: `${task.id}-${repetition}-${arm}`, taskId: task.id, repetition, arm, planSha256: task[arm].plan_sha256, reservedSessions: task[arm].budget.max_sessions });
    }
    return slots;
}
export function createExperimentGrant(plan: ExperimentPlan, options: { actor: string; expiresAt: string; credentialNames: string[]; at?: Date }): ExperimentGrant {
    validateExperimentPlan(plan); boundedText(options.actor, "Experiment authorising actor", 200);
    const at = options.at ?? new Date();
    if (!Number.isFinite(at.getTime()) || !Number.isFinite(Date.parse(options.expiresAt)) || Date.parse(options.expiresAt) <= at.getTime()) throw new Error("Experiment allowance must have a finite future expiry");
    const expected = [...new Set(plan.tasks.flatMap(t => [...(t.baseline.runtime.env ?? [])]))].sort();
    if (!Array.isArray(options.credentialNames) || hashValue([...options.credentialNames].sort()) !== hashValue(expected)) throw new Error("Separate experiment grant must name exactly its pinned runtime credential variables; no credential values are read");
    return stamped({ schema_version: "wringer.experiment-grant.v1" as const, experimentSha256: plan.sha256, actor: options.actor, grantedAt: at.toISOString(), expiresAt: options.expiresAt, limits: plan.limits, credentialNames: expected, dataScope: "this-repository-only" as const, actions: ["collect-private-trials", "measure-private-handover"] as ["collect-private-trials", "measure-private-handover"], noProductionPublication: true as const });
}
export function validateExperimentGrant(grant: ExperimentGrant, plan: ExperimentPlan, at = new Date()): ExperimentGrant {
    verifyStamp(grant);
    if (grant.schema_version !== "wringer.experiment-grant.v1" || grant.experimentSha256 !== plan.sha256 || grant.noProductionPublication !== true || hashValue(grant.actions) !== hashValue(["collect-private-trials", "measure-private-handover"]) || grant.dataScope !== plan.dataScope || hashValue(grant.limits) !== hashValue(plan.limits)) throw new Error("Product-build authority is not a separate, exact experiment allowance");
    const expected = createExperimentGrant(plan, { actor: grant.actor, expiresAt: grant.expiresAt, credentialNames: grant.credentialNames, at: new Date(grant.grantedAt) });
    if (expected.sha256 !== grant.sha256 || !Number.isFinite(at.getTime()) || Date.parse(grant.grantedAt) > at.getTime() || Date.parse(grant.expiresAt) <= at.getTime()) throw new Error("Experiment allowance is altered, future-dated or expired");
    return grant;
}
interface Registration { schema_version: "wringer.experiment-registration.v1"; plan: ExperimentPlan; registeredAt: string; sha256: string; }
export async function registerExperiment(root: string, input: ExperimentPlanInput): Promise<Registration> {
    return experimentLock(root, async () => {
        if (await optionalJson(root, "registration.json") || (await records(root, "trials", 128)).length || await optionalJson(root, "collection.json")) throw new Error("Use a fresh private experiment directory: a prediction cannot be registered after its trials");
        const registration = stamped({ schema_version: "wringer.experiment-registration.v1" as const, plan: createExperimentPlan(input), registeredAt: new Date().toISOString() });
        await exclusiveJson(root, "registration.json", registration); return registration;
    });
}
export async function readExperiment(root: string) {
    await privateExperimentRoot(root);
    const registration = verifyStamp((await optionalJson<Registration>(root, "registration.json"))!);
    if (registration.schema_version !== "wringer.experiment-registration.v1" || !Number.isFinite(Date.parse(registration.registeredAt))) throw new Error("Experiment has no valid preregistration");
    const plan = validateExperimentPlan(registration.plan), trials = await records<ExperimentTrial>(root, "trials", 128), reviews = await records<ExperimentResearchReview>(root, "reviews", 128), displays = await records<ExperimentResearchDisplay>(root, "displays", 128), handovers = await records<ExperimentHandover>(root, "handovers", 128), completions = await records<ExperimentResearchCompletion>(root, "research-completions", 128);
    for (const trial of trials) validateTrial(trial, registration);
    if (new Set(trials.map(t => t.slot.id)).size !== trials.length) throw new Error("Duplicate trial cannot enter the denominator twice");
    for (const display of displays) validateResearchDisplay(display, plan, trials);
    for (const handover of handovers) validateExperimentHandover(handover, plan, trials, registration.sha256);
    for (const review of reviews) validateReview(review, plan, trials, displays);
    if (new Set(reviews.map(r => r.trialSha256)).size !== reviews.length || new Set(handovers.map(h => h.slotId)).size !== handovers.length || new Set(completions.map(c => c.reservation.trialSha256)).size !== completions.length) throw new Error("Duplicate research reviews or endings cannot be selected after the fact or overwritten");
    completions.forEach(c => validateResearchCompletion(c, { registration, plan, trials, reviews, displays }));
    return { registration, plan, trials, reviews, displays, handovers, completions };
}
function validateTrial(trial: ExperimentTrial, registration: Registration): void {
    verifyStamp(trial);
    shape(trial, ["schema_version", "experimentSha256", "slot", "registrationSha256", "startedAt", "finishedAt", "evidenceKind", "outcome", "workerAttempts", "roleSessions", "functionalCompletion", "requirements", "safety", "safetyEvidence", "candidateCommit", "candidateTree", "journeyRevision", "runtimeIds", "agentIdentitySha256", "stopReason", "cost", "sha256"], "Trial record");
    const plan = registration.plan, slot = experimentSchedule(plan).find(s => s.id === trial.slot?.id);
    if (trial.schema_version !== "wringer.experiment-trial.v1" || !slot || hashValue(slot) !== hashValue(trial.slot) || trial.experimentSha256 !== plan.sha256 || trial.registrationSha256 !== registration.sha256 || !Number.isFinite(Date.parse(trial.startedAt)) || !Number.isFinite(Date.parse(trial.finishedAt)) || Date.parse(trial.startedAt) < Date.parse(registration.registeredAt) || Date.parse(trial.finishedAt) < Date.parse(trial.startedAt)) throw new Error("Trial does not match its pre-existing frozen prediction, slot or chronology");
    if (!["live-contained", "deterministic-fixture"].includes(trial.evidenceKind) || !["completed", "human-hold", "stopped", "infrastructure-failed", "uncertain", "not-started"].includes(trial.outcome) || typeof trial.functionalCompletion !== "boolean" || trial.cost !== null) throw new Error("Invalid trial facts or invented billing");
    for (const [value, label] of [[trial.workerAttempts, "worker attempts"], [trial.roleSessions, "role sessions"]] as const) if (value !== null) integer(value, label, 0, slot.reservedSessions);
    if (trial.workerAttempts !== null && trial.roleSessions !== null && trial.workerAttempts > trial.roleSessions) throw new Error("Worker attempts exceed retained role sessions");
    const taskPlan = plan.tasks.find(t => t.id === slot.taskId)![slot.arm];
    if (!Array.isArray(trial.requirements) || hashValue(trial.requirements.map(r => [r.id, r.kind]).sort()) !== hashValue(taskPlan.acceptance.criteria.map(r => [r.id, r.kind]).sort()) || trial.requirements.some(r => ![true, false, null].includes(r.met))) throw new Error("Trial must account for every pinned requirement");
    const machine = trial.requirements.filter(r => r.kind === "check");
    if (trial.functionalCompletion !== (machine.length > 0 && machine.every(r => r.met === true)) || trial.outcome === "completed" && trial.requirements.some(r => r.met !== true)) throw new Error("Trial completion contradicts requirement observations");
    for (const key of ["authority", "acceptance", "containment", "secrets", "handoverAudit"] as const) if (!["passed", "failed", "unknown"].includes(trial.safety?.[key])) throw new Error("Safety evidence must retain unknowns");
    shape(trial.safetyEvidence, ["authority", "acceptance", "containment", "secrets", "handoverAudit"], "Bounded safety observations");
    for (const key of ["authority", "acceptance", "containment", "handoverAudit"] as const) {
        if (trial.safetyEvidence[key] !== null) hash(trial.safetyEvidence[key]);
        if (trial.safety[key] === "passed" && trial.safetyEvidence[key] === null) throw new Error("Safety passed needs its explicit bounded observation, not absence of a stop");
    }
    if (trial.safetyEvidence.secrets !== null) {
        shape(trial.safetyEvidence.secrets, ["scanner", "inputsSha256", "inputCount"], "Secret scan evidence");
        if (trial.safetyEvidence.secrets.scanner !== "declared-credential-and-pattern-redactor") throw new Error("Unknown bounded secret scanner");
        hash(trial.safetyEvidence.secrets.inputsSha256); integer(trial.safetyEvidence.secrets.inputCount, "Secret scan input count", 1, 4096);
    }
    if (trial.safety.secrets === "passed" && trial.safetyEvidence.secrets === null) throw new Error("No secret scan observation; candidate presence does not prove safety");
    if (trial.safety.productionPublication !== "not-attempted" || !Array.isArray(trial.runtimeIds) || trial.runtimeIds.length > slot.reservedSessions * 4 + 16 || new Set(trial.runtimeIds).size !== trial.runtimeIds.length) throw new Error("Experiment records cannot authorise production publication or reuse runtime identities");
    for (const value of [trial.candidateCommit, trial.candidateTree]) if (value !== null && !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value)) throw new Error("Trial source identity is invalid");
    for (const value of [trial.journeyRevision, trial.agentIdentitySha256]) if (value !== null) hash(value);
    if (trial.stopReason !== null) boundedText(trial.stopReason, "Trial stop", 4000);
}
function validateExperimentHandover(record: ExperimentHandover, experiment: ExperimentPlan, trials: ExperimentTrial[], registrationSha256: string) {
    verifyStamp(record);
    shape(record, ["schema_version", "experimentSha256", "registrationSha256", "slotId", "planSha256", "candidateCommit", "candidateTree", "journeyRevision", "evidenceKind", "target", "status", "measuredAt", "delivery", "freshClone", "productionPublication", "productionHumanApproval", "reason", "sha256"], "Experimental handover");
    const slot = experimentSchedule(experiment).find(s => s.id === record.slotId), trial = trials.find(t => t.slot.id === record.slotId);
    if (!slot || record.schema_version !== "wringer.experiment-handover.v1" || record.experimentSha256 !== experiment.sha256 || record.registrationSha256 !== registrationSha256 || record.planSha256 !== slot.planSha256 || record.target !== "generated-private-local-origin-only" || record.productionPublication !== "not-attempted" || record.productionHumanApproval !== "not-granted" || !["passed", "failed", "unknown"].includes(record.status) || !["live-contained", "deterministic-fixture"].includes(record.evidenceKind) || !Number.isFinite(Date.parse(record.measuredAt))) throw new Error("Handover observation is not bound to its separate private experiment contract");
    // A crash may leave the handover observation just before its trial summary.
    // Keep it inspectable, but it cannot become an eligible pair until the trial exists.
    if (trial && (record.candidateCommit !== trial.candidateCommit || record.candidateTree !== trial.candidateTree || record.journeyRevision !== trial.journeyRevision || record.evidenceKind !== trial.evidenceKind || record.status !== trial.safety.handoverAudit || record.sha256 !== trial.safetyEvidence.handoverAudit)) throw new Error("Trial summary does not match its retained private handover measurement");
    boundedText(record.reason, "Private handover reason");
    for (const value of [record.candidateCommit, record.candidateTree]) if (value !== null && !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value)) throw new Error("Private handover source identity is invalid");
    if (record.journeyRevision !== null) hash(record.journeyRevision);
    if (record.status === "passed") {
        const delivery = record.delivery, clone = record.freshClone;
        if (!delivery || !clone || !record.candidateCommit || !record.candidateTree || !record.journeyRevision || delivery.codeCommit !== record.candidateCommit || !/^contained-[a-f0-9]{24}$/.test(delivery.deliveryId) || delivery.sourceBranch !== `wringer/experiment-${record.slotId}` || delivery.targetBranch !== "main" || delivery.pushed !== true || clone.headCommit !== delivery.evidenceCommit || clone.audit.schema_version !== "wringer.contained-audit.v1" || clone.audit.status !== "passed" || clone.audit.codeCommit !== record.candidateCommit || clone.audit.deliveryId !== delivery.deliveryId || !clone.audit.claims.length || clone.audit.claims.some(c => c.status !== "checked")) throw new Error("Private handover passed needs a confirmed exact branch and literal fresh-clone audit with every carried claim checked");
        const plan = experiment.tasks.find(t => t.id === slot.taskId)![slot.arm];
        if (clone.audit.checks !== plan.acceptance.checks.length || clone.audit.human !== plan.acceptance.criteria.filter(c => c.kind === "human" && c.required).length) throw new Error("Private handover audit changed the pinned check or human count");
    } else if (record.delivery !== null || record.freshClone !== null) throw new Error("An incomplete private handover cannot carry a contradictory passed audit");
}
function validateResearchCompletion(completion: ExperimentResearchCompletion, current: Pick<Awaited<ReturnType<typeof readExperiment>>, "registration" | "plan" | "trials" | "reviews" | "displays">) {
    verifyStamp(completion); const r = verifyStamp(completion.reservation);
    shape(completion, ["schema_version", "reservation", "evidenceKind", "originalJourneyRevision", "handover", "status", "completedAt", "reason", "productionHumanApproval", "sha256"], "Research completion");
    shape(r, ["schema_version", "experimentSha256", "registrationSha256", "trialSha256", "reviewSha256", "displaySha256", "actor", "startedAt", "deadline", "wallClockSeconds", "roleSessions", "action", "noProductionAuthority", "sha256"], "Research ending reservation");
    const trial = current.trials.find(t => t.sha256 === r.trialSha256), review = current.reviews.find(v => v.sha256 === r.reviewSha256);
    if (!trial || trial.outcome !== "human-hold" || !review || review.trialSha256 !== trial.sha256 || !review.independent || !review.blinded || review.criteria.some(v => !v.met) || !review.criteria.length || r.schema_version !== "wringer.experiment-research-finish-reservation.v1" || r.experimentSha256 !== current.plan.sha256 || r.registrationSha256 !== current.registration.sha256 || r.displaySha256 !== review.displayReceiptSha256 || !current.displays.some(d => d.sha256 === r.displaySha256) || r.roleSessions !== 0 || r.action !== "finish-private-research-only" || r.noProductionAuthority !== true || completion.schema_version !== "wringer.experiment-research-completion.v1" || completion.evidenceKind !== trial.evidenceKind || completion.originalJourneyRevision !== trial.journeyRevision || completion.productionHumanApproval !== "not-granted" || !["passed", "failed", "unknown"].includes(completion.status) || trial.evidenceKind === "live-contained" && review.kind !== "real-research-observation") throw new Error("Research completion lacks its exact private trial, independent observation or zero-agent authority");
    integer(r.wallClockSeconds, "Research ending seconds", 1, 120); boundedText(r.actor, "Research ending operator", 200); boundedText(completion.reason, "Research ending reason", 8000);
    if (![r.startedAt, r.deadline, completion.completedAt].every(t => Number.isFinite(Date.parse(t))) || Date.parse(r.startedAt) < Date.parse(review.at) || Date.parse(r.deadline) <= Date.parse(r.startedAt) || Date.parse(r.deadline) - Date.parse(r.startedAt) > r.wallClockSeconds * 1000 + 1 || Date.parse(completion.completedAt) < Date.parse(r.startedAt)) throw new Error("Research ending chronology or finite clock changed");
    if (completion.handover) {
        validateExperimentHandover(completion.handover, current.plan, [], current.registration.sha256);
        if (completion.handover.slotId !== trial.slot.id || completion.handover.candidateCommit !== trial.candidateCommit || completion.handover.candidateTree !== trial.candidateTree || completion.handover.evidenceKind !== trial.evidenceKind || completion.handover.status !== completion.status || Date.parse(completion.handover.measuredAt) < Date.parse(r.startedAt)) throw new Error("Research ending changed the observed candidate or handover result");
    } else if (completion.status === "passed") throw new Error("Research ending passed needs the literal fresh-clone audit");
}
function validateResearchDisplay(display: ExperimentResearchDisplay, experiment: ExperimentPlan, trials: ExperimentTrial[]) {
    verifyStamp(display); const trial = trials.find(t => t.sha256 === display.trialSha256);
    if (!trial || !["wringer.experiment-research-display.v1", "wringer.experiment-research-display.v2"].includes(display.schema_version) || display.experimentSha256 !== experiment.sha256 || display.candidateTree !== trial.candidateTree || display.candidateCommit !== trial.candidateCommit) throw new Error("Research display does not resolve to its exact retained trial candidate");
    if (display.schema_version === "wringer.experiment-research-display.v2" ? display.snapshot?.schema_version !== "wringer.design-snapshot.v2" : display.snapshot !== null && display.snapshot?.schema_version !== "wringer.design-snapshot.v1") throw new Error("Research display record version does not match its exact design snapshot version; legacy records are not reinterpreted");
    if (display.schema_version === "wringer.experiment-research-display.v2") shape(display, ["schema_version", "experimentSha256", "trialSha256", "candidateCommit", "candidateTree", "snapshot", "displays", "sha256"], "Research display");
    const plan = experiment.tasks.find(t => t.id === trial.slot.taskId)![trial.slot.arm], human = plan.acceptance.criteria.filter(c => c.kind === "human");
    if (!Array.isArray(display.displays) || hashValue(display.displays.map(d => d.criterionId).sort()) !== hashValue(human.map(c => c.id).sort())) throw new Error("Research display omitted a human requirement");
    const snapshot = display.snapshot ? parseDesignSnapshot(JSON.stringify(display.snapshot)) : null;
    if (plan.design ? snapshot?.snapshot_sha256 !== plan.design.snapshotSha256 : snapshot !== null) throw new Error("Research reference snapshot does not match the exact approved design");
    for (const row of display.displays) {
        const criterion = human.find(c => c.id === row.criterionId)!, measured = row.measured, p = measured?.provenance;
        const commands = [...plan.environment.setup.map(c => `setup/${c.id}`), criterion.show?.id];
        if (!criterion.show || row.success !== true || !p || p.role !== "verifier" || p.kind !== plan.runtime.kind || p.image !== plan.runtime.image || p.repository.url !== plan.repository.url || p.repository.commit !== display.candidateCommit || !p.clonedInside || p.hostMounts.length || measured.sourceTree !== display.candidateTree || measured.sourceChanged || hashValue(measured.results.map(r => r.id)) !== hashValue(commands) || measured.results.some(r => r.code !== 0)) throw new Error("Research display is failed, stale or lacks exact declared contained observations");
        assertContainedDisplayVisuals({ ...row, schema_version: row.visuals ? "wringer.contained-display.v2" : "wringer.contained-display.v1" }, plan, snapshot);
    }
}
function validateReview(review: ExperimentResearchReview, plan: ExperimentPlan, trials: ExperimentTrial[], displays: ExperimentResearchDisplay[]) {
    verifyStamp(review); const trial = trials.find(t => t.sha256 === review.trialSha256);
    if (!trial || review.schema_version !== "wringer.experiment-research-review.v1" || review.experimentSha256 !== plan.sha256 || review.candidateTree !== trial.candidateTree || review.noProductionAuthority !== true || !Number.isFinite(Date.parse(review.at)) || Date.parse(review.at) < Date.parse(trial.finishedAt) || typeof review.independent !== "boolean" || typeof review.blinded !== "boolean" || !["real-research-observation", "deterministic-fixture"].includes(review.kind)) throw new Error("Research judgement must bind a retained trial and exact displayed candidate, never production Send authority");
    boundedText(review.actor, "Research observer", 200); hash(review.displayReceiptSha256);
    const display = displays.find(d => d.sha256 === review.displayReceiptSha256 && d.trialSha256 === trial.sha256);
    if (!display) throw new Error("Research review must resolve an actual retained source-bound display, not an invented receipt hash");
    validateResearchDisplay(display, plan, trials);
    const human = trial.requirements.filter(r => r.kind === "human");
    if (!Array.isArray(review.criteria) || hashValue(review.criteria.map(r => r.id).sort()) !== hashValue(human.map(r => r.id).sort()) || review.criteria.some(r => typeof r.met !== "boolean")) throw new Error("Research observer must account for every human requirement");
    review.criteria.forEach(r => boundedText(r.note, "Research observation", 2000));
}
/** Recording an observation alone cannot execute, accept a product or publish. */
export async function recordExperimentReview(root: string, input: Omit<ExperimentResearchReview, "schema_version" | "at" | "sha256" | "noProductionAuthority">) {
    return experimentLock(root, async () => {
        const current = await readExperiment(root), review = stamped({ schema_version: "wringer.experiment-research-review.v1" as const, ...input, at: new Date().toISOString(), noProductionAuthority: true as const });
        validateReview(review, current.plan, current.trials, current.displays);
        await exclusiveJson(root, `reviews/${current.trials.find(t => t.sha256 === review.trialSha256)!.slot.id}.json`, review); return review;
    });
}
function signProbability(positive: number, negative: number): number | null {
    const n = positive + negative; if (!n) return null;
    let choose = 1, sum = 0;
    for (let k = 0; k <= n; k++) { if (k >= positive) sum += choose; choose = choose * (n - k) / (k + 1); }
    return Math.min(1, sum / 2 ** n);
}
/** Pure comparator. It cannot import a runtime, inspect credentials, start a model or write authority. */
export function evaluateRecordedExperiment(current: Awaited<ReturnType<typeof readExperiment>>): ExperimentResult {
    const { plan, registration, trials, reviews, displays, handovers, completions } = current; validateExperimentPlan(plan); verifyStamp(registration);
    if (hashValue(plan) !== hashValue(registration.plan)) throw new Error("Evaluation changed the registered prediction");
    trials.forEach(t => validateTrial(t, registration)); displays.forEach(d => validateResearchDisplay(d, plan, trials)); reviews.forEach(r => validateReview(r, plan, trials, displays)); handovers.forEach(h => validateExperimentHandover(h, plan, trials, registration.sha256));
    completions.forEach(c => validateResearchCompletion(c, current));
    if (new Set(trials.map(t => t.slot.id)).size !== trials.length || new Set(reviews.map(r => r.trialSha256)).size !== reviews.length || new Set(handovers.map(h => h.slotId)).size !== handovers.length || new Set(completions.map(c => c.reservation.trialSha256)).size !== completions.length) throw new Error("Duplicate research evidence");
    const ending = (trial: ExperimentTrial) => completions.find(c => c.reservation.trialSha256 === trial.sha256);
    const handoverStatus = (trial: ExperimentTrial) => ending(trial)?.status ?? trial.safety.handoverAudit;
    const missingTrials = experimentSchedule(plan).filter(s => !trials.some(t => t.slot.id === s.id)).map(s => s.id), findings: string[] = [], hard: string[] = [];
    const usedRuntimeIds = new Map<string, string>();
    for (const trial of trials.filter(t => t.evidenceKind === "live-contained")) for (const runtimeId of trial.runtimeIds) {
        if (usedRuntimeIds.has(runtimeId)) hard.push(`${trial.slot.id}: runtime identity was reused from ${usedRuntimeIds.get(runtimeId)}; fresh independent state was not established`);
        usedRuntimeIds.set(runtimeId, trial.slot.id);
    }
    const pairs: ExperimentResult["pairs"] = [];
    for (let repetition = 1; repetition <= plan.repetitions; repetition++) for (const task of plan.tasks) {
        const baseline = trials.find(t => t.slot.taskId === task.id && t.slot.repetition === repetition && t.slot.arm === "baseline"), candidate = trials.find(t => t.slot.taskId === task.id && t.slot.repetition === repetition && t.slot.arm === "candidate"), regressions: string[] = [];
        let improvement: number | null = null;
        if (baseline && candidate) {
            if (baseline.functionalCompletion && !candidate.functionalCompletion) regressions.push("functional completion regressed");
            for (const requirement of baseline.requirements) if (requirement.met === true && candidate.requirements.find(r => r.id === requirement.id)?.met !== true) regressions.push(`${requirement.id}: previously satisfied requirement is missing or failed`);
            for (const key of ["authority", "acceptance", "containment", "secrets", "handoverAudit"] as const) {
                const baseStatus = key === "handoverAudit" ? handoverStatus(baseline) : baseline.safety[key], candidateStatus = key === "handoverAudit" ? handoverStatus(candidate) : candidate.safety[key];
                if (candidateStatus === "failed") regressions.push(`${key}: safety failed`);
                if (baseStatus !== "passed" || candidateStatus !== "passed") findings.push(`${task.id}/${repetition}: ${key} not proved for both arms`);
            }
            for (const trial of [baseline, candidate]) if (!handovers.some(h => h.sha256 === trial.safetyEvidence.handoverAudit && h.status === "passed") && ending(trial)?.handover?.status !== "passed") findings.push(`${task.id}/${repetition}/${trial.slot.arm}: exact private handover and fresh-clone audit not measured`);
            if (baseline.agentIdentitySha256 === null || baseline.agentIdentitySha256 !== candidate.agentIdentitySha256) findings.push(`${task.id}/${repetition}: agent adapter identity is unknown or changed`);
            if (baseline.evidenceKind === "live-contained" && candidate.evidenceKind === "live-contained" && baseline.runtimeIds.some(id => candidate.runtimeIds.includes(id))) regressions.push("baseline and candidate reused a runtime identity");
            if (plan.prediction.metric === "worker-attempts") {
                if (baseline.workerAttempts !== null && candidate.workerAttempts !== null && baseline.functionalCompletion && candidate.functionalCompletion) improvement = baseline.workerAttempts - candidate.workerAttempts;
            } else improvement = Number(candidate.functionalCompletion) - Number(baseline.functionalCompletion);
            const baseReview = reviews.find(r => r.trialSha256 === baseline.sha256), candidateReview = reviews.find(r => r.trialSha256 === candidate.sha256);
            if (task.baseline.acceptance.criteria.some(c => c.kind === "human" && c.required)) {
                for (const [arm, review] of [["baseline", baseReview], ["candidate", candidateReview]] as const) if (!review || review.kind !== "real-research-observation" || !review.independent || !review.blinded) findings.push(`${task.id}/${repetition}/${arm}: independent blinded human research observation missing (scripted decisions do not qualify)`);
                if (baseReview && candidateReview) for (const row of baseReview.criteria) if (row.met && candidateReview.criteria.find(r => r.id === row.id)?.met !== true) regressions.push(`${row.id}: independent human result regressed`);
            }
            if (plan.prediction.visualQualityClaim && (!baseReview || !candidateReview || !baseReview.independent || !candidateReview.independent || !baseReview.blinded || !candidateReview.blinded || baseReview.kind !== "real-research-observation" || candidateReview.kind !== "real-research-observation")) findings.push(`${task.id}/${repetition}: visual quality needs real independent blinded designer observations`);
            if ([baseline, candidate].some(t => ["uncertain", "not-started", "infrastructure-failed"].includes(t.outcome))) findings.push(`${task.id}/${repetition}: failed infrastructure, missing work or uncertainty remains in the denominator`);
        }
        hard.push(...regressions.map(reason => `${task.id}/${repetition}: ${reason}`));
        pairs.push({ taskId: task.id, repetition, split: task.split, baseline: baseline?.sha256 ?? null, candidate: candidate?.sha256 ?? null, improvement, regressions });
    }
    const held = pairs.filter(p => p.split === "held-out"), measured = held.flatMap(p => p.improvement === null ? [] : [p.improvement]);
    // Repetitions of one task are correlated. Average within task before the sign
    // test; repeating one easy example cannot manufacture independent evidence.
    const taskMeans = plan.tasks.filter(t => t.split === "held-out").flatMap(task => {
        const rows = held.filter(p => p.taskId === task.id);
        return rows.length === plan.repetitions && rows.every(p => p.improvement !== null) ? [rows.reduce((sum, p) => sum + p.improvement!, 0) / rows.length] : [];
    });
    const positive = taskMeans.filter(n => n > 0).length, negative = taskMeans.filter(n => n < 0).length, mean = taskMeans.length ? taskMeans.reduce((sum, n) => sum + n, 0) / taskMeans.length : null, probability = signProbability(positive, negative);
    if (missingTrials.length) findings.push(`${missingTrials.length} planned trials are missing; none were removed from the denominator`);
    if (trials.some(t => t.evidenceKind !== "live-contained")) findings.push("Deterministic fixtures test the mechanism, not real agent-performance benefit; they cannot make a candidate eligible");
    if (measured.length < plan.prediction.minimumHeldOutPairs || measured.length !== held.length || taskMeans.length < 4) findings.push("Insufficient complete held-out pairs and distinct tasks for the predeclared comparison");
    if (mean === null || mean < plan.prediction.minimumImprovement) findings.push("The predeclared minimum useful benefit was not demonstrated");
    if (probability === null || probability > plan.prediction.maximumSignProbability) findings.push("The predeclared one-sided paired sign-test uncertainty threshold was not met");
    if (!trials.length) findings.push("No trials have been collected");
    const evidenceRevision = hashValue({ registration: registration.sha256, trials: trials.map(t => t.sha256).sort(), reviews: reviews.map(r => r.sha256).sort(), displays: displays.map(d => d.sha256).sort(), handovers: handovers.map(h => h.sha256).sort(), completions: completions.map(c => c.sha256).sort() });
    return stamped({ schema_version: "wringer.experiment-result.v1" as const, experimentSha256: plan.sha256, evidenceRevision, eligibility: hard.length ? "ineligible" as const : findings.length ? "inconclusive" as const : "eligible" as const, findings: [...new Set([...hard, ...findings])], plannedTrials: experimentSchedule(plan).length, recordedTrials: trials.length, liveTrials: trials.filter(t => t.evidenceKind === "live-contained").length, fixtureTrials: trials.filter(t => t.evidenceKind === "deterministic-fixture").length, missingTrials, pairs, heldOut: { pairs: measured.length, independentTasks: taskMeans.length, improvements: positive, regressions: negative, ties: taskMeans.length - positive - negative, meanImprovement: mean, signProbability: probability }, cost: null, limits: ["Offline evaluation made no provider, runtime, credential, publication or approval calls.", "Fixed paired one-sided sign test on within-task means; repeated samples of one task do not count as independent tasks. No population-wide or causal guarantee.", "All attempted, failed and missing trials remain visible. Unknown billing is not zero or a cash-saving claim.", "Adapter/model selection is pinned configuration; opaque provider revisions and actual billed cost remain unknown.", "Human research judgements are reported observations, not authenticated presence or production handover approval.", "Cooperative-local controller ownership remains a trust boundary; hashes are consistency evidence, not hostile-owner signatures."] });
}
export async function evaluateExperiment(root: string): Promise<ExperimentResult> { return evaluateRecordedExperiment(await readExperiment(root)); }

/** Inventory only the operator's conventional experiment namespace, never a browser-supplied path. */
export async function listExperiments(privateRoot: string, options: { repository?: string } = {}) {
    await privateExperimentRoot(privateRoot); const directory = await experimentPath(privateRoot, "experiments");
    let names: string[];
    try { names = await readdir(directory); } catch (e: any) { if (e.code === "ENOENT") return []; throw e; }
    if (names.length > 64) throw new Error("Experiment inventory exceeds the 64-record local bound");
    const rows = [];
    for (const name of names.sort()) {
        id(name); const path = await experimentPath(privateRoot, `experiments/${name}`), info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Experiment inventory contains an unexpected file or symlink");
        const current = await readExperiment(path);
        if (!options.repository || current.plan.repository === options.repository) rows.push({ id: name, path, plan: current.plan, result: evaluateRecordedExperiment(current) });
    }
    return rows;
}

export async function readPlaybookAdoptions(root: string): Promise<PlaybookAdoption[]> {
    await privateExperimentRoot(root); const decisions = await records<PlaybookAdoption>(root, "adoptions", 1000); let previous = ZERO;
    for (const decision of decisions) {
        if (decision.schema_version !== "wringer.playbook-adoption.v1" || decision.previousRevision !== previous || decision.appliesTo !== "future-plans-only" || decision.executionApproved !== false || !["promote", "rollback"].includes(decision.action)) throw new Error("Adoption history changed; active plans and future selection were not modified");
        const prior = decisions[decisions.indexOf(decision) - 1];
        if ((prior?.selectedDigest ?? null) !== decision.previousDigest || prior && (prior.repository !== decision.repository || prior.taskFamily !== decision.taskFamily)) throw new Error("Adoption history crosses task family or rewrites the prior digest");
        if (decision.selectedDigest !== null) hash(decision.selectedDigest); hash(decision.experimentSha256); hash(decision.evidenceRevision);
        boundedText(decision.actor, "Adoption actor", 200); boundedText(decision.note, "Adoption reason"); if (!Number.isFinite(Date.parse(decision.at))) throw new Error("Adoption time is invalid");
        previous = decision.sha256;
    }
    return decisions;
}
export interface AdoptionOptions { actor: string; note: string; expectedRevision: string; expectedCurrentDigest: string | null; expectedEvidenceRevision: string; }
/** Records selection only. It never edits source, rewrites a plan, grants execution or publishes. */
export async function promoteExperiment(experimentRoot: string, registryRoot: string, options: AdoptionOptions): Promise<PlaybookAdoption> {
    return experimentLock(experimentRoot, async () => {
        const current = await readExperiment(experimentRoot), result = evaluateRecordedExperiment(current);
        if (result.eligibility !== "eligible") throw new Error(`Improvement is ${result.eligibility}; keep the current approach. ${result.findings.join(" ")}`);
        if (result.evidenceRevision !== options.expectedEvidenceRevision) throw new Error("Comparison evidence changed. Review the new result before adoption");
        return experimentLock(registryRoot, async () => {
            const history = await readPlaybookAdoptions(registryRoot), prior = history.at(-1);
            if ((prior?.sha256 ?? ZERO) !== options.expectedRevision || (prior?.selectedDigest ?? null) !== options.expectedCurrentDigest || (prior?.selectedDigest ?? null) !== current.plan.baselinePlaybook) throw new Error("The current approach changed. Refresh; a stale or concurrent promotion cannot overwrite it");
            if (prior && (prior.repository !== current.plan.repository || prior.taskFamily !== current.plan.taskFamily)) throw new Error("This registry belongs to another repository or task family");
            boundedText(options.actor, "Adoption actor", 200); boundedText(options.note, "Adoption reason");
            const decision = stamped({ schema_version: "wringer.playbook-adoption.v1" as const, repository: current.plan.repository, taskFamily: current.plan.taskFamily, action: "promote" as const, actor: options.actor, note: options.note, at: new Date().toISOString(), previousRevision: prior?.sha256 ?? ZERO, previousDigest: prior?.selectedDigest ?? null, selectedDigest: current.plan.candidatePlaybook, experimentSha256: current.plan.sha256, evidenceRevision: result.evidenceRevision, appliesTo: "future-plans-only" as const, executionApproved: false as const });
            await exclusiveJson(registryRoot, `adoptions/${String(history.length + 1).padStart(6, "0")}.json`, decision); return decision;
        });
    });
}
export async function rollbackPlaybook(registryRoot: string, options: AdoptionOptions): Promise<PlaybookAdoption> {
    return experimentLock(registryRoot, async () => {
        const history = await readPlaybookAdoptions(registryRoot), prior = history.at(-1);
        if (!prior || prior.sha256 !== options.expectedRevision || prior.selectedDigest !== options.expectedCurrentDigest || prior.evidenceRevision !== options.expectedEvidenceRevision) throw new Error("Rollback needs the exact current adoption and evidence revision");
        if (prior.action !== "promote") throw new Error("Latest decision is already a rollback; no unreviewed toggling or new execution was granted");
        boundedText(options.actor, "Rollback actor", 200); boundedText(options.note, "Rollback reason");
        const decision = stamped({ schema_version: "wringer.playbook-adoption.v1" as const, repository: prior.repository, taskFamily: prior.taskFamily, action: "rollback" as const, actor: options.actor, note: options.note, at: new Date().toISOString(), previousRevision: prior.sha256, previousDigest: prior.selectedDigest, selectedDigest: prior.previousDigest, experimentSha256: prior.experimentSha256, evidenceRevision: prior.evidenceRevision, appliesTo: "future-plans-only" as const, executionApproved: false as const });
        await exclusiveJson(registryRoot, `adoptions/${String(history.length + 1).padStart(6, "0")}.json`, decision); return decision;
    });
}
/** Only structured outcomes enter the report; role conversations and raw output are intentionally absent. */
export function failurePatternReport(inputs: Awaited<ReturnType<typeof readExperiment>>[]): FailurePatternReport {
    if (!inputs.length || inputs.length > 32) throw new Error("Choose 1-32 explicit repository-scoped experiment records");
    const repository = inputs[0]!.plan.repository, taskFamily = inputs[0]!.plan.taskFamily;
    const groups = new Map<string, FailurePatternReport["groups"][number]>();
    for (const input of inputs) {
        evaluateRecordedExperiment(input);
        if (input.plan.repository !== repository || input.plan.taskFamily !== taskFamily) throw new Error("Repository-private failure patterns cannot cross repository or task-family boundaries");
        for (const trial of input.trials) {
            const task = input.plan.tasks.find(t => t.id === trial.slot.taskId)!, plan = task[trial.slot.arm];
            // Proposers see development evidence only, never held-out feedback.
            if (task.split !== "development") continue;
            const key = hashValue({ repository, taskFamily, source: plan.repository.commit, acceptance: plan.acceptance_sha256, runtime: plan.runtime, agents: plan.agents, environment: plan.environment, checks: plan.acceptance.checks });
            const kind = trial.outcome === "infrastructure-failed" || trial.outcome === "uncertain" ? "environment" : trial.requirements.some(r => r.kind === "check" && r.met !== true) ? "product-check" : trial.outcome === "human-hold" ? "human-preference" : "agent-finding";
            if (trial.outcome === "completed") continue;
            const requirementIds = trial.requirements.filter(r => r.met !== true).map(r => r.id).sort(), groupKey = hashValue({ key, kind, requirementIds });
            const row = groups.get(groupKey) ?? { comparisonKey: key, kind, requirementIds, count: 0, observations: [] };
            row.count++; row.observations.push(trial.sha256); groups.set(groupKey, row);
        }
    }
    return stamped({ schema_version: "wringer.failure-pattern-report.v1" as const, repository, taskFamily, sources: inputs.map(i => i.registration.sha256).sort(), groups: [...groups.values()].sort((a, b) => b.count - a.count || a.comparisonKey.localeCompare(b.comparisonKey)), limits: ["Structured outcomes only; no private role conversation, credential, raw output, hidden answer or unrelated design is included.", "A recurring failure is an observation, not a causal explanation. A proposal is a hypothesis until its preregistered held-out comparison survives review.", "Human-hold means a research judgement is missing; it is not evidence that a human disliked the candidate."] });
}

export function validateFailurePatternReport(report: FailurePatternReport): FailurePatternReport {
    verifyStamp(report); shape(report, ["schema_version", "repository", "taskFamily", "sources", "groups", "limits", "sha256"], "Sanitised failure report");
    if (report.schema_version !== "wringer.failure-pattern-report.v1") throw new Error("Unsupported failure report");
    boundedText(report.repository, "Failure repository", 2048); id(report.taskFamily);
    if (!Array.isArray(report.sources) || report.sources.length < 1 || report.sources.length > 32 || !Array.isArray(report.groups) || report.groups.length > 4096 || !Array.isArray(report.limits) || report.limits.length > 16) throw new Error("Failure report exceeds its bounded repository-only corpus");
    report.sources.forEach(hash); report.limits.forEach(t => boundedText(t, "Report limit", 2000));
    for (const group of report.groups) {
        shape(group, ["comparisonKey", "kind", "requirementIds", "count", "observations"], "Failure pattern"); hash(group.comparisonKey); integer(group.count, "Observed failures", 1, 4096);
        if (!["environment", "product-check", "agent-finding", "human-preference"].includes(group.kind) || !Array.isArray(group.requirementIds) || group.requirementIds.length > 128 || !Array.isArray(group.observations) || group.observations.length !== group.count) throw new Error("Failure pattern must contain bounded structured outcomes, not raw conversation or hidden answers");
        group.requirementIds.forEach(r => boundedText(r, "Requirement identity", 200)); group.observations.forEach(hash);
    }
    return report;
}
