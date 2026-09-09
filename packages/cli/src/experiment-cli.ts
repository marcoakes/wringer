import { resolve } from "node:path";
import { createExperimentGrant, createPlaybookProposalRequest, registerExperiment, readExperiment, evaluateExperiment, collectExperiment, finishExperimentResearch, promoteExperiment, rollbackPlaybook, readPlaybookAdoptions, failurePatternReport, recordExperimentReview, proposePlaybookImprovement } from "@wringer/application";
import { readExperimentJson, exclusiveJson, privateExperimentRoot } from "../../application/src/experiment-store";
import { allowed, flag, positionals, required, string, type Args } from "./args";
import type { Answer } from "./app";

export const EXPERIMENT_HELP = `Measured improvements for future work - never self-approval

  wring experiment register --input COMPARISON.json --state PRIVATE_DIR
  wring experiment status --state PRIVATE_DIR
  wring experiment evaluate --state PRIVATE_DIR
  wring experiment grant --state PRIVATE_DIR --actor NAME --expires ISO_TIME
      --output grant.json
  wring experiment collect --state PRIVATE_DIR --grant grant.json --yes
  wring experiment review --state PRIVATE_DIR --input RESEARCH_REVIEW.json --yes
  wring experiment research-finish --state PRIVATE_DIR --trial TRIAL_SHA
      --expected-review REVIEW_SHA --actor NAME --seconds 120 --yes
  wring experiment promote --state PRIVATE_DIR --registry PRIVATE_REGISTRY
      --actor NAME --note REASON --expected-revision HASH
      --expected-current HASH_OR_none --expected-evidence HASH --yes
  wring experiment rollback --registry PRIVATE_REGISTRY --actor NAME --note REASON
      --expected-revision HASH --expected-current HASH_OR_none
      --expected-evidence HASH --yes
  wring experiment adoptions --registry PRIVATE_REGISTRY
  wring experiment patterns --state PRIVATE_DIR
  wring experiment prepare-proposal --input PROPOSAL_GRANT.json --state PRIVATE_DIR
      --output proposal-request.json
  wring experiment propose --request proposal-request.json --state PRIVATE_DIR --yes

All state/registry directories must already exist, be operator-owned 0700 and
outside Git and production controllers. State is private research evidence.
Input paths are relative to --repo; grant/request/output paths are relative to state.
Register, status, evaluate, patterns and prepare-proposal are offline: no model,
credential read, sandbox, human acceptance or publication. Grant records one
separate finite research allowance. Collect/propose may spend using only declared
credential names; --yes confirms that separate operation. Sessions/time are not
a hard money cap. All attempts, failures and missing trials remain visible.
Ready trials measure normal delivery only to a generated private local origin,
then audit a literal fresh clone. No production destination or hosted MR is available.
Research-finish separately confirms a retained real human review for that private
ending only; it grants zero agent sessions and never extends original approval.
Research reviews never become product Yes or Send. Promotion and rollback select an exact
approach for FUTURE unapproved plans only; they do not start or approve a job.
Fixtures cannot prove live benefit. Guide: docs/native/EXPERIMENTS.md
`;
const confirmed = (a: Args) => { if (!flag(a, "yes")) throw new Error("This separate operator action needs --yes after reviewing its exact finite allowance or adoption evidence. No action was taken."); };
export async function experimentCommand(a: Args, repo: string): Promise<Answer> {
    if (flag(a, "help")) return { value: { help: EXPERIMENT_HELP }, text: EXPERIMENT_HELP };
    positionals(a, 1); const operation = a.words[0];
    const root = () => resolve(repo, required(a, "state")), registry = () => resolve(repo, required(a, "registry"));
    if (operation === "register") {
        allowed(a, ["input", "state"]); const result = await registerExperiment(root(), await readExperimentJson(resolve(repo, required(a, "input"))));
        return { value: result, text: `Registered the prediction before any trials.\nExperiment: ${result.plan.id}\nPlan: ${result.plan.sha256}\nNo spend or execution approved. Next: wring experiment grant --help` };
    }
    if (operation === "status" || operation === "evaluate") {
        allowed(a, ["state"]); const result = await evaluateExperiment(root());
        return { value: result, text: `Improvement: ${result.eligibility}\nTrials retained: ${result.recordedTrials}/${result.plannedTrials} (${result.liveTrials} live, ${result.fixtureTrials} fixtures).\nHeld-out: ${result.heldOut.pairs} pairs across ${result.heldOut.independentTasks} tasks.\nEvidence revision: ${result.evidenceRevision}\n${result.findings.join("\n")}\nCosts remain unknown. No provider or credential calls; adoption not granted.` };
    }
    if (operation === "grant") {
        allowed(a, ["state", "actor", "expires", "output"]); const current = await readExperiment(root());
        const grant = createExperimentGrant(current.plan, { actor: required(a, "actor"), expiresAt: required(a, "expires"), credentialNames: [...new Set(current.plan.tasks.flatMap(t => t.baseline.runtime.env ?? []))] });
        await exclusiveJson(root(), required(a, "output"), grant);
        return { value: grant, text: `Recorded separate research allowance: at most ${grant.limits.maxTrials} trials, ${grant.limits.maxRoleSessions} role sessions, ${grant.limits.wallClockSeconds} seconds.\nExpires: ${grant.expiresAt}\nNo work started. Collect requires this exact grant and --yes; no production publication is authorised.` };
    }
    if (operation === "collect") {
        allowed(a, ["state", "grant", "yes"]); confirmed(a);
        const { experimentPath } = await import("../../application/src/experiment-store");
        const current = await collectExperiment(root(), await readExperimentJson(await experimentPath(root(), required(a, "grant"))));
        return { value: await evaluateExperiment(root()), text: `Comparison collection stopped with ${current.trials.length} retained planned-trial records.\nNo production handover, Send or promotion ran. Review: wring experiment evaluate --state ${JSON.stringify(root())}` };
    }
    if (operation === "review") {
        allowed(a, ["state", "input", "yes"]); confirmed(a);
        const review = await recordExperimentReview(root(), await readExperimentJson(resolve(repo, required(a, "input"))));
        return { value: review, text: "Recorded an exact-candidate research observation. It grants no production acceptance, Send or execution authority." };
    }
    if (operation === "research-finish") {
        allowed(a, ["state", "trial", "expected-review", "actor", "seconds", "yes"]); confirmed(a);
        const result = await finishExperimentResearch(root(), { trialSha256: required(a, "trial"), expectedReviewSha256: required(a, "expected-review"), actor: required(a, "actor"), wallClockSeconds: Number(required(a, "seconds")) });
        return { value: result, text: `Private research ending: ${result.status}.\n${result.reason}\nNo extra agent session or production approval was granted. Original trial remains unchanged.` };
    }
    if (operation === "promote" || operation === "rollback") {
        allowed(a, ["state", "registry", "actor", "note", "expected-revision", "expected-current", "expected-evidence", "yes"]); confirmed(a);
        const selected = required(a, "expected-current"), options = { actor: required(a, "actor"), note: required(a, "note"), expectedRevision: required(a, "expected-revision"), expectedCurrentDigest: selected === "none" ? null : selected, expectedEvidenceRevision: required(a, "expected-evidence") };
        const result = operation === "promote" ? await promoteExperiment(root(), registry(), options) : await rollbackPlaybook(registry(), options);
        return { value: result, text: `${operation === "promote" ? "Selected evaluated approach" : "Restored previous approach"} for future unapproved plans only: ${result.selectedDigest ?? "no playbook"}.\nActive work, old records and approval are unchanged. No new job started.\nRevision: ${result.sha256}` };
    }
    if (operation === "adoptions") {
        allowed(a, ["registry"]); const history = await readPlaybookAdoptions(registry());
        return { value: { history }, text: history.length ? history.map(row => `${row.action}: ${row.selectedDigest ?? "no playbook"} - ${row.note}\nRevision: ${row.sha256}`).join("\n") : "No future approach has been adopted. Current revision: " + "0".repeat(64) };
    }
    if (operation === "patterns") {
        allowed(a, ["state"]); const result = failurePatternReport([await readExperiment(root())]);
        return { value: result, text: `${result.groups.length} comparable development-only failure patterns.\nNo raw role conversation, hidden answers, credentials or held-out feedback. A pattern is not a causal finding.` };
    }
    if (operation === "prepare-proposal") {
        allowed(a, ["input", "state", "output"]); await privateExperimentRoot(root());
        const result = createPlaybookProposalRequest(await readExperimentJson(resolve(repo, required(a, "input"))));
        await exclusiveJson(root(), required(a, "output"), result);
        return { value: result, text: `Prepared one separate proposal allowance: 1 session, ${result.maxTurns} turns, ${result.wallClockSeconds} seconds.\nOnly writable output: ${result.outputPath}\nNo runtime or provider called. Proposed text cannot adopt itself.` };
    }
    if (operation === "propose") {
        allowed(a, ["state", "request", "yes"]); confirmed(a);
        const { experimentPath } = await import("../../application/src/experiment-store");
        const result = await proposePlaybookImprovement(root(), await readExperimentJson(await experimentPath(root(), required(a, "request"))));
        return { value: result, text: `Playbook proposal: ${result.status}.\nOne reservation retained. No experiment, promotion, execution approval or publication followed. Inspect the private proposal-result.json.` };
    }
    throw new Error(EXPERIMENT_HELP);
}
