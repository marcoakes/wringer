import { randomUUID } from "node:crypto";
import { validateExecutionAuthority } from "@wringer/plan";
import { readValidatedContainedState, recordContainedHumanJudgement, runContainedJourney } from "@wringer/workflow";
import { Redactor } from "@wringer/engine";
import { readExperiment } from "./experiments";
import { measureExperimentHandover } from "./experiment-handover";
import { ensureExperimentControllerPurpose } from "./experiment-purpose";
import type { ExperimentResearchCompletion, ExperimentResearchFinishReservation } from "./experiment-types";
import { boundedText, integer, hash, stamped, exclusiveJson, optionalJson, experimentLock, experimentPath, verifyStamp } from "./experiment-store";

export interface ExperimentResearchFinishInput { trialSha256: string; expectedReviewSha256: string; actor: string; wallClockSeconds: number; }
/** Only human acceptance of retained research output and local Git ending are allowed.
 * The source, checks, original allowance and trial summary are never rewritten. */
export async function finishExperimentResearch(root: string, input: ExperimentResearchFinishInput, options: { signal?: AbortSignal } = {}): Promise<ExperimentResearchCompletion> {
    hash(input.trialSha256); hash(input.expectedReviewSha256); boundedText(input.actor, "Research ending operator", 200); integer(input.wallClockSeconds, "Local research ending seconds", 1, 120);
    return experimentLock(root, async () => {
        const current = await readExperiment(root), trial = current.trials.find(t => t.sha256 === input.trialSha256), review = current.reviews.find(r => r.trialSha256 === input.trialSha256);
        if (!trial || trial.outcome !== "human-hold" || !trial.candidateTree || !trial.candidateCommit || !trial.journeyRevision || !review || review.sha256 !== input.expectedReviewSha256 || !review.independent || !review.blinded || trial.evidenceKind === "live-contained" && review.kind !== "real-research-observation") throw new Error("Finish requires the exact retained human-hold trial and independent blinded research review; no synthetic observation can complete live research");
        const display = current.displays.find(d => d.sha256 === review.displayReceiptSha256)!;
        if (!display || !review.criteria.length || review.criteria.some(c => !c.met)) throw new Error("A missing or negative research judgement cannot authorise a private handover; its failed requirements remain in the comparison");
        const prior = current.completions.find(c => c.reservation.trialSha256 === trial.sha256);
        if (prior) {
            if (prior.reservation.reviewSha256 !== review.sha256) throw new Error("The immutable research ending names another review");
            return prior;
        }
        const taskPlan = current.plan.tasks.find(t => t.id === trial.slot.taskId)![trial.slot.arm], state = await experimentPath(root, `journeys/${trial.slot.id}`);
        await ensureExperimentControllerPurpose(root, state, current.plan, current.registration.sha256, trial.slot);
        const reservationPath = `research-finish-reservations/${trial.slot.id}.json`;
        let reservation = await optionalJson<ExperimentResearchFinishReservation>(root, reservationPath), completion: ExperimentResearchCompletion;
        if (reservation) {
            verifyStamp(reservation);
            if (reservation.trialSha256 !== trial.sha256 || reservation.reviewSha256 !== review.sha256 || reservation.experimentSha256 !== current.plan.sha256) throw new Error("Prior research ending reservation changed; no effect was repeated");
            completion = stamped({ schema_version: "wringer.experiment-research-completion.v1" as const, reservation, evidenceKind: trial.evidenceKind, originalJourneyRevision: trial.journeyRevision, handover: null, status: "unknown" as const, completedAt: new Date().toISOString(), reason: "Interrupted local research ending has an uncertain reservation; no approval, publication or agent work was repeated.", productionHumanApproval: "not-granted" as const });
        } else {
            const original = await readValidatedContainedState(state);
            if (original.events.at(-1)?.sha256 !== trial.journeyRevision || original.plan.plan_sha256 !== taskPlan.plan_sha256 || original.result.candidate?.tree !== trial.candidateTree || original.result.candidate?.source.commit !== trial.candidateCommit || original.state.stage !== "human" || original.result.status !== "human-hold") throw new Error("Research candidate, source or workflow changed after the recorded display; original trial remains immutable");
            validateExecutionAuthority(original.authority, taskPlan);
            const startedAt = new Date().toISOString(), originalDeadline = Math.min(Date.parse(original.authority.expires_at), Date.parse(original.state.startedAt) + original.authority.budget.wall_clock_seconds * 1000);
            if (Date.now() >= originalDeadline) throw new Error("Original research approval is out of date; finishing cannot renew its clock or authorise another worker");
            const deadline = new Date(Math.min(originalDeadline, Date.now() + input.wallClockSeconds * 1000)).toISOString();
            reservation = stamped({ schema_version: "wringer.experiment-research-finish-reservation.v1" as const, experimentSha256: current.plan.sha256, registrationSha256: current.registration.sha256, trialSha256: trial.sha256, reviewSha256: review.sha256, displaySha256: display.sha256, actor: input.actor, startedAt, deadline, wallClockSeconds: input.wallClockSeconds, roleSessions: 0 as const, action: "finish-private-research-only" as const, noProductionAuthority: true as const });
            await exclusiveJson(root, reservationPath, reservation);
            const deadlineSignal = AbortSignal.timeout(Math.max(1, Date.parse(deadline) - Date.now())), signal = options.signal ? AbortSignal.any([options.signal, deadlineSignal]) : deadlineSignal;
            try {
                for (const observation of review.criteria) {
                    signal.throwIfAborted();
                    const shown = display.displays.find(d => d.criterionId === observation.id)!;
                    const id = randomUUID(), receipt = stamped({ schema_version: shown.visuals ? "wringer.contained-display.v2" : "wringer.contained-display.v1", id, criterionId: observation.id, candidateTree: trial.candidateTree, acceptanceSha256: taskPlan.acceptance_sha256, at: review.at, success: shown.success, measured: shown.measured, ...(shown.visuals ? { visuals: shown.visuals } : {}) });
                    // The original measured output is re-enveloped, not redisplayed or invented.
                    await exclusiveJson(state, `displays/${id}.json`, receipt);
                    await recordContainedHumanJudgement(state, { criterionId: observation.id, candidateTree: trial.candidateTree, acceptanceSha256: taskPlan.acceptance_sha256, verdict: "met", by: review.actor, note: observation.note, displayId: id, display: { candidateTree: trial.candidateTree, status: "shown", receiptSha256: receipt.sha256 } }, { expectedCandidateTree: trial.candidateTree });
                }
                const blocked = async (): Promise<never> => { throw new Error("Research ending authorises zero agent, verification or source work"); };
                const beforeResume = await readValidatedContainedState(state);
                const result = await runContainedJourney({ controllerDir: state, plan: taskPlan, authority: original.authority, environment: original.environment, services: { prepareSource: blocked, captureCandidate: blocked, verifyCandidate: blocked, reconcileVerification: blocked }, executeRole: blocked, expectedRevision: beforeResume.events.at(-1)!.sha256, expectedCandidateTree: trial.candidateTree, signal });
                const validated = await readValidatedContainedState(state);
                if (validated.state.effects.length !== original.state.effects.length || result.sessions !== original.result.sessions || result.candidate?.source.commit !== trial.candidateCommit || result.candidate.tree !== trial.candidateTree) throw new Error("Private research ending attempted work beyond the exact observed candidate");
                const handover = await measureExperimentHandover({ root, state, experiment: current.plan, registrationSha256: current.registration.sha256, slot: trial.slot, plan: taskPlan, result, validated, fixture: trial.evidenceKind === "deterministic-fixture", signal, researchReviewSha256: review.sha256 });
                signal.throwIfAborted();
                completion = stamped({ schema_version: "wringer.experiment-research-completion.v1" as const, reservation, evidenceKind: trial.evidenceKind, originalJourneyRevision: trial.journeyRevision, handover, status: handover.status, completedAt: new Date().toISOString(), reason: "The actual source-bound research observation was evaluated only in its private experimental workflow. " + handover.reason, productionHumanApproval: "not-granted" as const });
            } catch (error) {
                completion = stamped({ schema_version: "wringer.experiment-research-completion.v1" as const, reservation, evidenceKind: trial.evidenceKind, originalJourneyRevision: trial.journeyRevision, handover: null, status: signal.aborted ? "unknown" as const : "failed" as const, completedAt: new Date().toISOString(), reason: new Redactor().scrub((error as Error).message).slice(0, 3500), productionHumanApproval: "not-granted" as const });
            }
        }
        await exclusiveJson(root, `research-completions/${trial.slot.id}.json`, completion); return completion;
    });
}
