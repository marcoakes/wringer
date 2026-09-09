import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadExecutionPlan, canonicalPlanJson, validateExecutionPlan, createExecutionAuthority, validateExecutionAuthority } from "@wringer/plan";
import { requestContainedRevision, queryContainedJourney, containedHumanReviewEligibility } from "@wringer/workflow";
import { deliverContained, auditContained, falsifyContained, reviewContainedSource } from "@wringer/delivery";
import { readControllerFile, readController, startController, resumeController, showControllerCandidate, reviewControllerCandidate, recoverWorkspaceCommand } from "@wringer/application";
import { EngineError, Redactor } from "@wringer/engine";
import { allowed, flag, number, positionals, required, string, quote, type Args } from "./args";
import { DRIVE_HELP } from "./help";
import type { Answer, DispatchContext } from "./app";

const statePath = (repo: string, a: Args) => resolve(repo, required(a, "state"));
const nextResume = (state: string) => `wringer-drive resume --state ${quote(state)}`;
const nextBoard = (state: string) => `wringer-drive board --state ${quote(state)}`;
export async function containedDrive(a: Args, repo: string, context: DispatchContext): Promise<Answer> {
    if (flag(a, "help") || !a.command) return { text: DRIVE_HELP };
    context.signal?.throwIfAborted();
    if (a.command === "propose") {
        const { proposalCommand } = await import("./intake");
        return proposalCommand(a, repo, context);
    }
    if (["planning-status", "planning-questions", "planning-new-grant"].includes(a.command)) {
        const { planningStatusCommand, planningNewGrantCommand } = await import("./intake");
        return a.command === "planning-new-grant" ? planningNewGrantCommand(a, repo, context) : planningStatusCommand(a, repo, context);
    }
    if (a.command === "new-grant") {
        const { newGrantCommand } = await import("./new-grant");
        return newGrantCommand(a, repo, context);
    }
    if (a.command === "plan") {
        positionals(a, 1); allowed(a, []);
        const plan = await loadExecutionPlan(resolve(repo, a.words[0]!));
        return { value: plan, text: `${canonicalPlanJson(plan)}\nPlan validated; no agent or repository command ran.\nNext: wringer-drive authority ${quote(resolve(repo, a.words[0]!))} --actor 'YOUR NAME' --expires 'EXPIRY IN ISO-8601' --output authority.json` };
    }
    if (a.command === "authority") {
        positionals(a, 1); allowed(a, ["actor", "expires", "output"]);
        const plan = await loadExecutionPlan(resolve(repo, a.words[0]!));
        const authority = createExecutionAuthority(plan, { actor: required(a, "actor"), expiresAt: required(a, "expires"), actions: ["plan", "build", "verify", "judge"] });
        const output = resolve(repo, required(a, "output"));
        await writeFile(output, JSON.stringify(authority, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        return { value: { path: output, authority }, text: `Bounded authority saved: ${output}\nPlan: ${plan.plan_sha256}\nNo human verdict, publication or sandbox bypass was granted.\nNext: wringer-drive run ${quote(resolve(repo, a.words[0]!))} --authority ${quote(output)}` };
    }
    if (a.command === "status") {
        positionals(a, 0); allowed(a, ["state"]);
        const state = statePath(repo, a);
        if (!existsSync(join(state, ".wringer/contained/events")) && existsSync(join(state, ".wringer/planning/events"))) {
            const { planningStatusCommand } = await import("./intake");
            return planningStatusCommand(a, repo, context);
        }
        const { result: value } = await readController(state), query = await queryContainedJourney(state);
        const next = value.status === "human-hold" || value.status === "review-ready" ? nextBoard(state) : value.stop?.next_move ?? nextResume(state);
        return { value: { ...value, revision: query.revision, actions: query.actions, budget: query.budget }, text: `${value.status}. The recorded view agrees with the validated authoritative journal.\n${value.stop?.message ?? ""}\nNext: ${next}`, exit: value.status === "review-ready" ? 0 : 3 };
    }
    if (a.command === "board") {
        positionals(a, 0); allowed(a, ["state", "port", "output"]);
        const { containedWorkspace } = await import("./workspace");
        return containedWorkspace(statePath(repo, a), { port: number(a, "port", 0), output: string(a, "output") ? resolve(repo, required(a, "output")) : undefined, signal: context.signal });
    }
    if (a.command === "recover-command") {
        positionals(a, 0); allowed(a, ["state", "command", "acknowledge-uncertain"]);
        if (!flag(a, "acknowledge-uncertain")) throw new Error("Recovery needs --acknowledge-uncertain: the old process must be dead, but an orphan runtime or remote request may remain. Nothing is replayed.");
        const state = statePath(repo, a), value = await recoverWorkspaceCommand(state, required(a, "command"), { acknowledgeUncertain: true });
        return { value, text: `${value.message}\nNext: ${nextBoard(state)}` };
    }
    if (a.command === "doctor") {
        positionals(a, 0); allowed(a, ["state", "plan", "probe-agents"]);
        const { containedDoctor } = await import("./preflight");
        return containedDoctor({ state: a.flags.has("state") ? statePath(repo, a) : undefined, planPath: a.flags.has("plan") ? resolve(repo, required(a, "plan")) : undefined, probeAgents: flag(a, "probe-agents"), signal: context.signal });
    }
    if (a.command === "audit") {
        positionals(a, 0); allowed(a, ["bundle"]);
        const value = await auditContained(resolve(repo, required(a, "bundle")));
        return { value, text: `Contained delivery audit ${value.status}: ${value.deliveryId ?? "unreadable delivery"}\n${value.claims.map(row => `${row.status}: ${row.id} — ${row.reason}`).join("\n")}\n${value.limits.join("\n")}`, exit: value.status === "passed" ? 0 : 3 };
    }
    if (a.command === "source-review") {
        positionals(a, 0); allowed(a, ["state", "policy-dir", "inventory", "finding", "actor", "actor-kind", "reason", "decisions"]);
        const state = statePath(repo, a), batch = a.flags.has("decisions"), deciding = a.flags.has("finding") || batch;
        if (batch && ["finding", "inventory", "actor", "actor-kind", "reason"].some(key => a.flags.has(key))) throw new Error("Batch decisions carry their exact inventory, per-item actor and reason; do not mix batch and single-decision flags");
        if (!deciding && ["inventory", "actor", "actor-kind", "reason", "policy-dir"].some(key => a.flags.has(key))) throw new Error("First inspect with source-review --state DIRECTORY; a decision must name exactly one --finding, inventory, actor, actor-kind, reason and external policy-dir");
        const actorKind = deciding && !batch ? required(a, "actor-kind") : "operator";
        if (!["operator", "delegated-agent"].includes(actorKind)) throw new Error("Source review actor-kind must be operator or delegated-agent; an agent decision must not be called a human judgement");
        const value = await reviewContainedSource({ stateDir: state, signal: context.signal, ...(deciding ? { policyDirectory: resolve(repo, required(a, "policy-dir")), ...(batch ? { decisionFile: resolve(repo, required(a, "decisions")) } : { decision: { findingId: required(a, "finding"), inventorySha256: required(a, "inventory"), actor: required(a, "actor"), actorKind: actorKind as "operator" | "delegated-agent", reason: required(a, "reason") } }) } : {}) });
        const inventory = value.inventory!, pending = new Set(value.pending.map(f => f.id));
        const rows = inventory.findings.map(f => `${pending.has(f.id) ? "NEEDS REVIEW" : "REVIEWED EXCEPTION"} ${f.id}\n  Object: ${f.objectId} (${f.objectType}); rule: ${f.rule}; matching-byte SHA256: ${f.matchSha256}`);
        const next = value.pending.length ? `wringer-drive source-review --state ${quote(state)} --inventory ${inventory.sha256} --finding ${value.pending[0]!.id} --policy-dir '/ABSOLUTE/OPERATOR/DIRECTORY/OUTSIDE/TARGET-REPO' --actor 'YOUR NAME OR DELEGATED AGENT' --actor-kind operator --reason 'WHY THIS EXACT MATCH IS A NON-SECRET EXAMPLE'` : `wringer-drive status --state ${quote(state)}`;
        return { value, text: `Source history review: ${inventory.findings.length} credential-shaped findings; ${value.pending.length} need a decision.\nCandidate: ${inventory.candidateCommit}\nInventory: ${inventory.sha256}\n${rows.join("\n")}\nNo matching values or raw context are printed. Never approve an unknown token as a harmless example. Configured secret values cannot be exempted. A delegated agent must use --actor-kind delegated-agent; this is not a human acceptance decision.\n${value.limitations.join("\n")}\nNext: ${next}`, exit: value.pending.length ? 3 : 0 };
    }
    if (a.command === "falsify") {
        positionals(a, 0); allowed(a, ["bundle", "output", "max-attempts", "wall-seconds"]);
        const value = await falsifyContained({ bundleDir: resolve(repo, required(a, "bundle")), outputDir: resolve(repo, string(a, "output", ".wringer/falsifications")!), maxAttempts: number(a, "max-attempts", 24), wallSeconds: number(a, "wall-seconds", 60), signal: context.signal });
        const incomplete = value.record.status === "inconclusive" || value.record.counts.survived > 0 || value.record.counts.unavailable > 0 || value.record.counts.unattempted > 0;
        return { value, text: `${value.table}\n\nRecords: ${value.directory}`, exit: context.signal?.aborted ? 4 : incomplete ? 3 : 0 };
    }
    if (a.command === "deliver") {
        positionals(a, 0); allowed(a, ["state", "remote", "source-branch", "target-branch", "forge-config", "send"]);
        const state = statePath(repo, a); await readController(state);
        const publication = { remote: required(a, "remote"), sourceBranch: required(a, "source-branch"), targetBranch: required(a, "target-branch"), ...(a.flags.has("forge-config") ? { forge: await readControllerFile(resolve(repo, required(a, "forge-config"))) } : {}) };
        const resumeCommand = `wringer-drive deliver --state ${quote(state)} --remote ${quote(publication.remote)} --source-branch ${quote(publication.sourceBranch)} --target-branch ${quote(publication.targetBranch)}${a.flags.has("forge-config") ? ` --forge-config ${quote(resolve(repo, required(a, "forge-config")))}` : ""} --send`;
        let value: Awaited<ReturnType<typeof deliverContained>>;
        try {
            value = await deliverContained({ stateDir: state, publication, send: flag(a, "send"), signal: context.signal, resumeCommand });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // Read this same record, never automatically replay an uncertain send.
            // Preserve a more specific domain recovery route when supplied.
            const next = error instanceof EngineError ? error.next_move : undefined;
            throw new EngineError(`${message}\nDelivery did not return a completed result. Retained evidence has not been discarded; inspect this run before retrying. An interrupted send may have reached the destination.`, context.signal?.aborted ? 4 : 3, next ?? `wringer-drive status --state ${quote(state)}`);
        }
        const forgeBlocked = value.forge && !["prepared", "published", "recovered"].includes(value.forge.status);
        const next = forgeBlocked ? value.forge!.next_move : value.pushed ? `From the root of a fresh clone of ${quote(value.sourceBranch)}, run ${value.auditCommand}` : resumeCommand;
        return { value, text: `${value.status}: ${value.deliveryId}\nCandidate: ${value.codeCommit}\nEvidence commit: ${value.evidenceCommit}\nBundle: ${value.bundleDir}\n${value.pushed ? "The exact evidence branch was pushed." : "Nothing was pushed. Publication needs the separate --send decision."}${value.forge ? `\nReview request: ${value.forge.status}${value.forge.url ? ` — ${value.forge.url}` : ""}${value.forge.reason ? ` — ${value.forge.reason}` : ""}` : ""}\nFalsification: ${value.falsify.reason}\nAfter publication, from the fresh review-branch clone root: ${value.falsify.command}\nNext: ${next}`, exit: forgeBlocked ? 3 : 0 };
    }
    if (["show", "review"].includes(a.command)) {
        positionals(a, 0); allowed(a, ["state", "criterion", ...(a.command === "review" ? ["display", "verdict", "by", "note"] : [])]);
        const state = statePath(repo, a), criterionId = required(a, "criterion");
        if (a.command === "show") {
            const { receipt, output } = await showControllerCandidate(state, criterionId, context);
            const eligibility = containedHumanReviewEligibility(await readController(state), criterionId);
            const next = !eligibility.enabled ? `wringer-drive new-grant --state ${quote(state)}` : receipt.success ? `wringer-drive review --state ${quote(state)} --criterion ${quote(criterionId)} --display ${receipt.id} --verdict met --by 'YOUR NAME' --note 'YOUR OWN OBSERVATION'` : `wringer-drive show --state ${quote(state)} --criterion ${quote(criterionId)}`;
            return { value: receipt, text: `${output}\nDisplay ${receipt.success ? "completed" : "failed"}; no judgement was recorded.${eligibility.enabled ? "\nChoose met or not_met and supply your own name and observation; the example below is not a verdict." : `\n${eligibility.reason}`}\nNext: ${next}`, exit: receipt.success && eligibility.enabled ? 0 : 3 };
        }
        const verdict = required(a, "verdict"); if (!["met", "not_met"].includes(verdict)) throw new Error("Verdict must be met or not_met");
        const recorded = await reviewControllerCandidate(state, { criterionId, displayId: required(a, "display"), verdict: verdict as "met" | "not_met", by: required(a, "by"), note: required(a, "note") });
        return { value: recorded.judgement, text: `Judgement recorded in ${recorded.judgement.by}'s words: ${recorded.judgement.note}\nHuman hold: previous readiness is withdrawn until all current observations are evaluated.\nNext: ${nextBoard(state)}` };
    }
    if (a.command === "request-revision") {
        positionals(a, 0); allowed(a, ["state", "by", "note"]);
        const state = statePath(repo, a); await readController(state, true);
        const value = await requestContainedRevision(state, { by: required(a, "by"), feedback: required(a, "note") });
        return { value, text: `Your revision request was recorded; no agent was started.\nNext: ${nextResume(state)}` };
    }
    if (!["run", "resume"].includes(a.command)) throw new Error(`Unknown drive command ${a.command}. See wringer-drive --help.`);
    positionals(a, a.command === "run" ? 1 : 0); allowed(a, ["authority", "state", "retry-uncertain", "retry-stopped", "retry-verification", "retry-judge"]);
    const plan = a.command === "run" ? await loadExecutionPlan(resolve(repo, a.words[0]!)) : validateExecutionPlan(await readControllerFile(join(statePath(repo, a), "plan.json")));
    const state = resolve(repo, string(a, "state", `.wringer/control/${plan.plan_sha256.slice(0, 20)}`)!);
    const authority = validateExecutionAuthority(await readControllerFile(a.flags.has("authority") ? resolve(repo, required(a, "authority")) : join(state, "authority.json")), plan);
    const value = await startController(state, plan, authority, { retryUncertain: flag(a, "retry-uncertain"), retryStopped: flag(a, "retry-stopped"), retryVerification: flag(a, "retry-verification"), retryJudge: flag(a, "retry-judge"), signal: context.signal, onEvent: !flag(a, "json") ? row => { process.stderr.write(JSON.stringify(new Redactor().deep(row)) + "\n"); } : undefined });
    const next = ["human-hold", "review-ready"].includes(value.status) ? nextBoard(state) : value.stop?.next_move ?? nextResume(state);
    return { value, text: `${value.status}: ${plan.name}\n${value.stop?.message ?? "Required checks and reviews completed for the recorded candidate."}\nCandidate: ${value.candidate?.source.commit ?? "none recorded"}\nRecords: ${value.recordDir}\nSessions: ${value.sessions}; token usage: ${JSON.stringify(value.tokens)}\nNext: ${next}`, exit: context.signal?.aborted ? 4 : value.status === "review-ready" ? 0 : 3 };
}
