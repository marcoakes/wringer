import { lstat, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compilePlanningRequest, compileExecutionPlan, planningRequestFromPlan, createPlanningAuthority, validatePlanningAuthority, canonicalPlanJson, type PlanningAuthority } from "@wringer/plan";
import { parseYaml } from "@wringer/engine";
import { prepareRepositorySource } from "@wringer/runtime";
import { loadExistingCredentials } from "@wringer/application";
import { proposeContainedPlan } from "@wringer/workflow";
import { allowed, flag, positionals, required, quote, type Args } from "./args";
import type { Answer, DispatchContext } from "./app";

async function boundedText(path: string) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error("Intent/template must be a regular file of at most 1 MiB");
    const content = await readFile(path, "utf8");
    if (content.includes("\0")) throw new Error("Intent/template cannot be binary");
    return content;
}
/** Explicit command creates planning-only authority. Result still needs separate execution approval. */
export async function proposalCommand(a: Args, repo: string, context: DispatchContext, dependencies: { prepareSource?: typeof prepareRepositorySource; propose?: typeof proposeContainedPlan } = {}): Promise<Answer> {
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
    await mkdir(state, { recursive: true, mode: 0o700 });
    const authorityPath = join(state, ".wringer/planning/authority.json");
    let authority: PlanningAuthority;
    try {
        authority = validatePlanningAuthority(JSON.parse(await boundedText(authorityPath)), request);
        if (authority.actor !== actor || authority.expires_at !== expiresAt) throw new Error("The existing planning authority has a different actor or expiry; a resume cannot replace it");
    } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
        authority = createPlanningAuthority(request, { actor, expiresAt });
    }
    context.signal?.throwIfAborted();
    await loadExistingCredentials(request.agents.planner?.env ?? []);
    const source = await (dependencies.prepareSource ?? prepareRepositorySource)(request.repository, { controllerDir: state });
    const value = await (dependencies.propose ?? proposeContainedPlan)({ controllerDir: state, request, authority, source, retryUncertain: flag(a, "retry-uncertain"), retryStopped: flag(a, "retry-stopped"), signal: context.signal });
    if (value.status === "proposal" && value.plan) {
        const wire = canonicalPlanJson(value.plan);
        try { await writeFile(output, wire, { flag: "wx", mode: 0o600 }); }
        catch (error: any) { if (error.code !== "EEXIST" || await boundedText(output) !== wire) throw new Error(`The proposed plan is retained in ${state}; output ${output} already differs or cannot be written. Choose a new output path. No planner needs to run again.`); }
        return { value: { ...value, output }, text: `Unapproved plan proposed: ${output}\n${value.note}\nNo worker ran and no execution authority was granted. Review the source-linked acceptance before approving it.\nNext: wringer-drive authority ${quote(output)} --actor ${quote(actor)} --expires ${quote(expiresAt)} --output ${quote(join(state, "execution-authority.json"))}` };
    }
    const retry = value.stopReason?.includes("uncertain") ? " --retry-uncertain" : value.stopReason?.includes("invalid-reply") || value.stopReason?.includes("planner-stopped") ? " --retry-stopped" : "";
    const next = value.status === "needs-decision" ? "Update the intent/template with the genuine decision and use a new explicitly bounded planning state." : retry ? `wringer-drive propose ${quote(templatePath)} --intent ${quote(intentPath)} --actor ${quote(actor)} --expires ${quote(expiresAt)} --state ${quote(state)} --output ${quote(output)}${retry}` : "Inspect the retained planning records; an exhausted budget cannot be enlarged by resume.";
    return { value, text: `${value.status}: ${value.stopReason ?? value.note}\n${value.questions.map(q => `Decision needed: ${q}`).join("\n")}\nNo execution approval or product change was created.\nNext: ${next}`, exit: 3 };
}
