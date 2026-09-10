import { lstat, readFile, mkdir, writeFile, realpath } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { compilePlanningRequest, compileExecutionPlan, planningRequestFromPlan, planningRequestVersion, createPlanningAuthority, validatePlanningAuthority, canonicalPlanJson, type PlanningAuthority } from "@wringer/plan";
import { parseYaml } from "@wringer/engine";
import { prepareRepositorySource } from "@wringer/runtime";
import { loadExistingCredentials } from "@wringer/application";
import { proposeContainedPlan, inspectContainedPlanning, type ContainedPlanningView, type ContainedPlanProposal } from "@wringer/workflow";
import { allowed, flag, positionals, required, quote, string, type Args } from "./args";
import type { Answer, DispatchContext } from "./app";

async function boundedText(path: string) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error("Intent/template must be a regular file of at most 1 MiB");
    const content = await readFile(path, "utf8");
    if (content.includes("\0")) throw new Error("Intent/template cannot be binary");
    return content;
}
type PlanningDependencies = { prepareSource?: typeof prepareRepositorySource; propose?: typeof proposeContainedPlan };
async function exists(path: string): Promise<boolean> {
    try { await lstat(path); return true; } catch (error: any) { if (error.code === "ENOENT") return false; throw error; }
}
async function assertFreshPlanningPath(path: string, oldState: string, label: string): Promise<void> {
    const oldReal = await realpath(oldState);
    for (const original of [resolve(oldState), oldReal]) {
        if (path === original || path.startsWith(original + sep)) throw new Error(`${label} must be outside the old planning state; retained evidence cannot be overwritten or extended`);
    }
    for (let cursor = path; ; cursor = dirname(cursor)) {
        try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`${label} cannot traverse a symlink parent or target; use an explicit real path`); }
        catch (error: any) { if (error.code !== "ENOENT") throw error; }
        if (dirname(cursor) === cursor) break;
    }
}
function planningSummary(view: ContainedPlanningView, state: string): Answer {
    const p = view.proposal, reason = view.budget.authorityExpired ? "Approval expired." : view.budget.wallClockExpired ? "Planning time limit exhausted." : view.budget.remaining === 0 ? "Planning session allowance exhausted." : "";
    const next = view.recovery.newGrantRequired ? `wringer-drive planning-new-grant --state ${quote(state)}` : `wringer-drive planning-status --state ${quote(state)}`;
    const eligible = view.recovery.retryUncertain ? "\nEligible: --retry-uncertain (possible prior spend remains charged)." : view.recovery.retryStopped ? "\nEligible: --retry-stopped (a new session remains within this grant)." : "";
    return { value: view, text: `${p.status}: ${p.stopReason ?? p.note}\n${p.stopReason ? p.note + "\n" : ""}${p.questions.map(q => `Decision needed: ${q}`).join("\n")}\nPlanning sessions: ${view.budget.reserved}/${view.budget.ceiling}; ${view.budget.remaining} remaining. ${reason}${eligible}\nNo execution approval or product change was created.\n${p.questions.length ? "Answer the questions in a revised intent file, then request a new planning grant with --intent. The old request, grant and paid attempts stay unchanged.\n" : ""}Next: ${next}`, exit: p.status === "proposal" ? 0 : 3 };
}
async function writeProposal(value: ContainedPlanProposal, output: string, state: string, authority: PlanningAuthority): Promise<Answer> {
    const wire = canonicalPlanJson(value.plan!);
    try { await writeFile(output, wire, { flag: "wx", mode: 0o600 }); }
    catch (error: any) { if (error.code !== "EEXIST" || await boundedText(output) !== wire) throw new Error(`The proposed plan is retained in ${state}; output ${output} already differs or cannot be written. Choose a new output path. No planner needs to run again.`); }
    const authorityOutput = join(state, "execution-authority.json"), expired = Date.now() >= Date.parse(authority.expires_at), outputExists = await exists(authorityOutput);
    const next = expired || outputExists ? `wringer-drive plan ${quote(output)}` : `wringer-drive authority ${quote(output)} --actor ${quote(authority.actor)} --expires ${quote(authority.expires_at)} --output ${quote(authorityOutput)}`;
    const guidance = expired || outputExists ? `\n${expired ? "The earlier planning approval has expired. " : ""}${outputExists ? "The suggested execution-authority file already exists and was not changed. " : ""}After inspecting the plan, explicitly choose a future expiry and a new output file for execution approval. No future time or replacement authority was granted.` : "";
    return { value: { ...value, output }, text: `Unapproved plan proposed: ${output}\n${value.note}\nNo worker ran and no execution authority was granted. Review the source-linked acceptance before approving it.${guidance}\nNext: ${next}` };
}
/** No credential lookup, source preparation, writes, or role execution. Works after authority expiry. */
export async function planningStatusCommand(a: Args, repo: string, _context: DispatchContext): Promise<Answer> {
    positionals(a, 0); allowed(a, ["state"]);
    const state = resolve(repo, required(a, "state"));
    return planningSummary(await inspectContainedPlanning(state), state);
}
/** Preview is read-only. A confirmed invocation creates a different state and grant; old reservations are never reset. */
export async function planningNewGrantCommand(a: Args, repo: string, context: DispatchContext, dependencies: PlanningDependencies = {}): Promise<Answer> {
    positionals(a, 0); allowed(a, ["state", "new-state", "expires", "output", "intent", "actor", "confirm-new-grant"]);
    const oldState = resolve(repo, required(a, "state")), prior = await inspectContainedPlanning(oldState);
    const intentPath = string(a, "intent"), intent = intentPath ? await boundedText(resolve(repo, intentPath)) : prior.request.intent;
    if (!flag(a, "confirm-new-grant")) {
        const fresh = resolve(repo, string(a, "new-state") ?? `${oldState}-new-grant-${randomUUID().slice(0, 8)}`), output = resolve(repo, string(a, "output") ?? join(fresh, "proposed-plan.json"));
        const expiry = string(a, "expires") ?? new Date(Date.now() + 3600000).toISOString();
        const actor = string(a, "actor");
        const command = `wringer-drive planning-new-grant --state ${quote(oldState)} --new-state ${quote(fresh)} --expires ${quote(expiry)} --output ${quote(output)}${actor ? ` --actor ${quote(actor)}` : ""}${intentPath ? ` --intent ${quote(resolve(repo, intentPath))}` : ""} --confirm-new-grant`;
        const needsAnswer = prior.proposal.questions.length > 0 && intent === prior.request.intent;
        return { value: { approved: false, priorRequest: prior.request.request_sha256, priorBudget: prior.budget, proposedBudget: prior.request.budget, proposedExpiry: expiry, questions: prior.proposal.questions, nextCommand: needsAnswer ? null : command }, text: `New planning grant preview — nothing was approved or started.\nThe old ${prior.budget.reserved} reserved session(s) remain charged and retained. A new grant may spend again; it is not a free resume.\nLimits remain ${JSON.stringify(prior.request.budget)}. Proposed expiry: ${expiry}.\n${prior.proposal.questions.map(q => `Decision needed: ${q}`).join("\n")}\n${needsAnswer ? "Answer these questions in a revised intent file, then run planning-new-grant again with --intent FILE. No answer was invented and no retry is being offered before that decision." : `If these new limits and expiry are acceptable, explicitly authorize:\n${command}`}` };
    }
    const state = resolve(repo, required(a, "new-state")), output = resolve(repo, required(a, "output")), expiresAt = required(a, "expires");
    await assertFreshPlanningPath(state, oldState, "--new-state");
    await assertFreshPlanningPath(output, oldState, "--output");
    if (state === oldState || await exists(state)) throw new Error("A new planning grant requires an entirely new --new-state directory; no existing grant can be reset");
    if (await exists(output)) throw new Error("A new planning grant requires a new output file; no planner was started");
    if (prior.proposal.questions.length && intent === prior.request.intent) throw new Error("Answer the retained planning questions in a revised --intent file before authorizing another paid planning attempt");
    const { schema_version, request_sha256, ...data } = prior.request;
    const request = compilePlanningRequest({ version: planningRequestVersion(prior.request.schema_version), ...data, intent }), authority = createPlanningAuthority(request, { actor: string(a, "actor") ?? prior.authority.actor, expiresAt });
    context.signal?.throwIfAborted();
    await mkdir(state, { recursive: false, mode: 0o700 });
    // The link is a new sibling, not a mutation or enlargement of the old authority.
    await writeFile(join(state, "planning-parent.json"), JSON.stringify({ schema_version: "wringer.planning-parent.v1", priorRequestSha256: prior.request.request_sha256, priorRevision: prior.revision, priorReservedSessions: prior.budget.reserved, requestSha256: request.request_sha256, explicitlyConfirmed: true }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await loadExistingCredentials(request.agents.planner?.env ?? []);
    const source = await (dependencies.prepareSource ?? prepareRepositorySource)(request.repository, { controllerDir: state });
    const value = await (dependencies.propose ?? proposeContainedPlan)({ controllerDir: state, request, authority, source, signal: context.signal });
    if (value.status === "proposal" && value.plan) return writeProposal(value, output, state, authority);
    return planningSummary(await inspectContainedPlanning(state), state);
}
/** Explicit command creates planning-only authority. Result still needs separate execution approval. */
export async function proposalCommand(a: Args, repo: string, context: DispatchContext, dependencies: PlanningDependencies = {}): Promise<Answer> {
    positionals(a, 1);
    allowed(a, ["intent", "actor", "expires", "state", "output", "retry-uncertain", "retry-stopped"]);
    const templatePath = resolve(repo, a.words[0]!), intentPath = resolve(repo, required(a, "intent")), intent = await boundedText(intentPath), template = await boundedText(templatePath);
    const actor = required(a, "actor"), expiresAt = required(a, "expires"), state = resolve(repo, required(a, "state")), output = resolve(repo, required(a, "output"));
    let request;
    try {
        if (templatePath.endsWith(".ts")) request = planningRequestFromPlan(compileExecutionPlan(template, { format: "typescript", sourceName: templatePath }), intent);
        else {
            const raw = parseYaml(template, templatePath) as Record<string, unknown>;
            request = raw.acceptance ? planningRequestFromPlan(compileExecutionPlan(template, { format: "yaml", sourceName: templatePath }), intent) : compilePlanningRequest({ ...raw, intent });
        }
    } catch (error) {
        throw new Error(`Planning template is not usable: ${String(error)}. Declare a pinned repository/runtime, agents.planner with protocol acp, and budget.max_planner_turns of at least 1. No agent was started.`);
    }
    const authorityPath = join(state, ".wringer/planning/authority.json");
    let authority: PlanningAuthority;
    if (await exists(authorityPath)) {
        const view = await inspectContainedPlanning(state);
        if (view.request.request_sha256 !== request.request_sha256) throw new Error(`The existing planning request differs. Answer decisions through an explicit new grant: wringer-drive planning-new-grant --state ${quote(state)}`);
        authority = view.authority;
        if (authority.actor !== actor || authority.expires_at !== expiresAt) throw new Error("The existing planning authority has a different actor or expiry; a resume cannot replace it");
        if (flag(a, "retry-uncertain") && flag(a, "retry-stopped")) throw new Error("Choose only one eligible retry flag");
        if (flag(a, "retry-uncertain") && !view.recovery.retryUncertain) throw new Error(`--retry-uncertain is not eligible for this planning state. Read it without spending: wringer-drive planning-status --state ${quote(state)}`);
        if (flag(a, "retry-stopped") && !view.recovery.retryStopped) return planningSummary(view, state);
        if (!flag(a, "retry-uncertain") && !flag(a, "retry-stopped")) {
            if (view.proposal.status === "proposal" && view.proposal.plan) return writeProposal(view.proposal, output, state, authority);
            return planningSummary(view, state);
        }
        validatePlanningAuthority(authority, request);
    } else {
        if (flag(a, "retry-uncertain") || flag(a, "retry-stopped")) throw new Error("No prior planning attempt exists; no retry flag is eligible and no planner was started");
        authority = createPlanningAuthority(request, { actor, expiresAt });
    }
    await mkdir(state, { recursive: true, mode: 0o700 });
    context.signal?.throwIfAborted();
    await loadExistingCredentials(request.agents.planner?.env ?? []);
    const source = await (dependencies.prepareSource ?? prepareRepositorySource)(request.repository, { controllerDir: state });
    const value = await (dependencies.propose ?? proposeContainedPlan)({ controllerDir: state, request, authority, source, retryUncertain: flag(a, "retry-uncertain"), retryStopped: flag(a, "retry-stopped"), signal: context.signal });
    if (value.status === "proposal" && value.plan) return writeProposal(value, output, state, authority);
    return planningSummary(await inspectContainedPlanning(state), state);
}
