import { mkdir, lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { ExecutionPlan } from "@wringer/plan";
import { deliverContained, auditContained } from "@wringer/delivery";
import { readValidatedContainedState } from "@wringer/workflow";
import type { ContainedJourneyResult, ValidatedContainedState } from "@wringer/workflow";
import { Redactor } from "@wringer/engine";
import type { ExperimentPlan, ExperimentTrialSlot, ExperimentHandover } from "./experiment-types";
import { experimentPath, exclusiveJson, optionalJson, stamped, verifyStamp } from "./experiment-store";
import { ensureExperimentControllerPurpose } from "./experiment-purpose";

/** No caller-controlled remote, forge, publication credential or repository program. */
async function privateGit(argv: string[], signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const child = Bun.spawn(["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", "-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=always", ...argv], { env: { PATH: process.env.PATH, HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" }, stdout: "pipe", stderr: "pipe" });
    const abort = () => child.kill("SIGTERM"), timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    signal?.addEventListener("abort", abort, { once: true });
    try {
        const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        if (code !== 0 || Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 1024 * 1024) throw new Error(`Private experiment Git operation failed: ${new Redactor(undefined, {}).scrub(stderr).slice(0, 2000)}`);
        signal?.throwIfAborted(); return stdout.trim();
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
export interface MeasureExperimentHandoverOptions {
    root: string;
    state: string;
    experiment: ExperimentPlan;
    registrationSha256: string;
    slot: ExperimentTrialSlot;
    plan: ExecutionPlan;
    result: ContainedJourneyResult;
    validated: ValidatedContainedState;
    fixture: boolean;
    signal?: AbortSignal;
    /** Reconcile previously retained local publication only; never start a new one. */
    reconcileOnly?: boolean;
    /** Separately authorised research ending; preserves the original hold receipt. */
    researchReviewSha256?: string;
}
export async function measureExperimentHandover(options: MeasureExperimentHandoverOptions): Promise<ExperimentHandover> {
    const { root, state, experiment, slot, plan, result, validated } = options;
    // Historical research fixtures/states are restricted before any ending; the
    // live collector creates this immutable marker before source preparation.
    await ensureExperimentControllerPurpose(root, state, experiment, options.registrationSha256, slot);
    const base = { schema_version: "wringer.experiment-handover.v1" as const, experimentSha256: experiment.sha256, registrationSha256: options.registrationSha256, slotId: slot.id, planSha256: plan.plan_sha256, candidateCommit: result.candidate?.source.commit ?? null, candidateTree: result.candidate?.tree ?? null, journeyRevision: validated.events.at(-1)?.sha256 ?? null, evidenceKind: options.fixture ? "deterministic-fixture" as const : "live-contained" as const, target: "generated-private-local-origin-only" as const, measuredAt: new Date().toISOString(), productionPublication: "not-attempted" as const, productionHumanApproval: "not-granted" as const };
    if (options.researchReviewSha256 && !/^[a-f0-9]{64}$/.test(options.researchReviewSha256)) throw new Error("An exact research review identity is required");
    const prefix = options.researchReviewSha256 ? "reviewed-" : "";
    const prior = await optionalJson<ExperimentHandover>(root, `${prefix}handovers/${slot.id}.json`);
    if (prior) {
        verifyStamp(prior);
        if (prior.experimentSha256 !== experiment.sha256 || prior.slotId !== slot.id || prior.planSha256 !== plan.plan_sha256 || prior.candidateTree !== base.candidateTree || prior.candidateCommit !== base.candidateCommit || prior.journeyRevision !== base.journeyRevision || prior.evidenceKind !== base.evidenceKind || prior.registrationSha256 !== options.registrationSha256) throw new Error("Retained local handover belongs to another trial or candidate; no publication was repeated");
        return prior;
    }
    let record: ExperimentHandover;
    if (result.status !== "review-ready" || validated.state.stage !== "ready" || !result.candidate || plan.acceptance.criteria.some(c => c.kind === "human" && !result.humanJudgements.some(j => j.criterionId === c.id && j.verdict === "met"))) {
        record = stamped({ ...base, status: "unknown" as const, delivery: null, freshClone: null, reason: "The experimental journey is not terminal review-ready. A research observation cannot become production Yes; no private handover or fresh-clone audit was attempted." });
    } else if (options.reconcileOnly) {
        record = stamped({ ...base, status: "unknown" as const, delivery: null, freshClone: null, reason: "Local handover had no complete retained measurement after interruption; no new publication was started during read-only reconciliation." });
    } else {
        const folder = await experimentPath(root, `private-deliveries/${prefix}${slot.id}`), origin = join(folder, "origin.git"), fresh = join(folder, "fresh-clone"), branch = `wringer/experiment-${slot.id}`;
        // Durable reservation precedes all local transport and publication effects.
        const reservation = stamped({ schema_version: "wringer.experiment-handover-reservation.v1", experimentSha256: experiment.sha256, slotId: slot.id, planSha256: plan.plan_sha256, candidateCommit: base.candidateCommit, candidateTree: base.candidateTree, journeyRevision: base.journeyRevision, evidenceKind: base.evidenceKind, target: base.target, sourceBranch: branch, at: base.measuredAt });
        if (await optionalJson(root, `${prefix}handover-reservations/${slot.id}.json`)) {
            record = stamped({ ...base, status: "unknown" as const, delivery: null, freshClone: null, reason: "A prior private publication reservation is uncertain; its local effects were not blindly repeated." });
        } else {
            await exclusiveJson(root, `${prefix}handover-reservations/${slot.id}.json`, reservation);
            try {
                options.signal?.throwIfAborted();
                // Re-read the authority-owning state immediately before any publication.
                const exact = await readValidatedContainedState(state);
                if (exact.events.at(-1)?.sha256 !== base.journeyRevision || exact.result.candidate?.tree !== base.candidateTree || exact.result.status !== "review-ready") throw new Error("Candidate or journey changed before its private handover check");
                const sourceBundle = result.candidate.source.bundlePath;
                if (!sourceBundle) throw new Error("Private handover requires the exact controller-captured candidate bundle");
                // macOS may retain /var while the private controller resolves under
                // /private/var. Compare canonical paths without accepting a symlink file.
                const sourceStat = await lstat(sourceBundle);
                if (sourceStat.isSymbolicLink()) throw new Error("Private handover source must not be a symlink");
                const bundle = await experimentPath(state, await realpath(sourceBundle)), stat = await lstat(bundle);
                if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw new Error("Private handover source is not a bounded regular bundle");
                await mkdir(folder, { recursive: true, mode: 0o700 }); await experimentPath(root, `private-deliveries/${prefix}${slot.id}`);
                await privateGit(["clone", "--bare", "--no-hardlinks", bundle, origin], options.signal);
                await privateGit(["--git-dir", origin, "update-ref", "refs/heads/main", plan.repository.commit], options.signal);
                await privateGit(["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/main"], options.signal);
                for (const [key, value] of [["user.name", "Wringer private experiment"], ["user.email", "experiment@localhost"], ["commit.gpgsign", "false"], ["wringer.researchOnly", experiment.sha256]]) await privateGit(["--git-dir", origin, "config", "--local", key!, value!], options.signal);
                const delivery = await deliverContained({ stateDir: state, publication: { remote: await realpath(origin), sourceBranch: branch, targetBranch: "main" }, send: true, signal: options.signal, expectedRevision: base.journeyRevision!, expectedCandidateTree: base.candidateTree! });
                if (!delivery.pushed || delivery.forge || delivery.status !== "delivered" || delivery.codeCommit !== base.candidateCommit || delivery.sourceBranch !== branch || delivery.targetBranch !== "main") throw new Error("Private handover did not establish its exact nonproduction review branch");
                await privateGit(["clone", "--no-hardlinks", "--single-branch", "--branch", branch, origin, fresh], options.signal);
                const headCommit = await privateGit(["-C", fresh, "rev-parse", "HEAD"], options.signal);
                const audit = await auditContained(join(fresh, ".wringer/deliveries", delivery.deliveryId));
                options.signal?.throwIfAborted();
                if (headCommit !== delivery.evidenceCommit || audit.status !== "passed" || audit.deliveryId !== delivery.deliveryId || audit.codeCommit !== base.candidateCommit || audit.claims.some(claim => claim.status !== "checked")) throw new Error("Literal fresh-clone handover audit did not resolve every carried claim");
                record = stamped({ ...base, status: "passed" as const, delivery: { deliveryId: delivery.deliveryId, codeCommit: delivery.codeCommit, evidenceCommit: delivery.evidenceCommit, sourceBranch: branch, targetBranch: "main" as const, pushed: true as const }, freshClone: { headCommit, audit }, reason: "Generated private local origin received the exact experimental evidence branch; a literal fresh clone audited every carried claim. No forge, production remote, merge, deployment or production human approval was used." });
            } catch (error) {
                record = stamped({ ...base, status: options.signal?.aborted ? "unknown" as const : "failed" as const, delivery: null, freshClone: null, reason: new Redactor().scrub((error as Error).message).slice(0, 3500) || "Private handover measurement failed" });
            }
        }
    }
    await exclusiveJson(root, `${prefix}handovers/${slot.id}.json`, record); return record;
}
