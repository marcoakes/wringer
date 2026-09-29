import { resolve } from "node:path";
import { measuredLoopPlan, planVersion, compileDeclaration, hashValue, type ExecutionPlan } from "@wringer/plan";
import { assistantExists, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
import { listExperiments, readPlaybookAdoptions, promoteExperiment, rollbackPlaybook, createExperimentGrant, collectExperiment } from "./experiments";
import { privateExperimentRoot } from "./experiment-store";
import type { AdoptionOptions } from "./experiments";

interface ImprovementConnection {
    schema_version: "wringer.improvement-connection.v1";
    researchRoot: string;
    registryRoot: string;
    repository: string;
    taskFamily: string;
}
const EMPTY = "0".repeat(64);
const shortId = (id: unknown): id is string => typeof id === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(id);
const connectionFile = "improvement-connection.json";

/** Operator-only setup. The assistant/browser can never submit filesystem paths. */
export async function connectImprovements(controller: string, options: { researchRoot: string; registryRoot: string; taskFamily: string }) {
    if (!shortId(options.taskFamily)) throw new Error("Choose one explicit task family for this private comparison connection");
    const workspace = await readAssistantRecord<{ profile: ExecutionPlan }>(controller, "workspace.json");
    const connection: ImprovementConnection = { schema_version: "wringer.improvement-connection.v1", researchRoot: await privateExperimentRoot(resolve(options.researchRoot)), registryRoot: await privateExperimentRoot(resolve(options.registryRoot)), repository: workspace.profile.repository.url, taskFamily: options.taskFamily };
    await writeAssistantRecord(controller, connectionFile, connection);
    return { connected: true, repository: connection.repository, taskFamily: connection.taskFamily, note: "Read-only comparison cards are now available. No collection, adoption, job approval or publication ran." };
}
export async function improvementConnection(root: string, repository: string): Promise<ImprovementConnection | null> {
    if (!await assistantExists(root, connectionFile)) return null;
    const value = await readAssistantRecord<ImprovementConnection>(root, connectionFile);
    if (value.schema_version !== "wringer.improvement-connection.v1" || value.repository !== repository || !shortId(value.taskFamily) || Object.keys(value).sort().join(",") !== "registryRoot,repository,researchRoot,schema_version,taskFamily") throw new Error("The private comparison connection does not match this repository");
    await privateExperimentRoot(value.researchRoot); await privateExperimentRoot(value.registryRoot);
    return value;
}
async function inventory(root: string, profile: ExecutionPlan) {
    const link = await improvementConnection(root, profile.repository.url);
    if (!link) return null;
    const experiments = (await listExperiments(link.researchRoot, { repository: link.repository })).filter(row => row.plan.taskFamily === link.taskFamily);
    if (experiments.length > 16) throw new Error("This connection exceeds its bounded 16-comparison PM view; retain the archive outside the connected experiments directory");
    const history = await readPlaybookAdoptions(link.registryRoot);
    if (history.some(row => row.repository !== link.repository || row.taskFamily !== link.taskFamily)) throw new Error("The adoption registry belongs to another repository or task family");
    return { link, experiments, history };
}
export function improvementApplicability(plan: ExecutionPlan, profile: ExecutionPlan) {
    return { source: hashValue(plan.repository) === hashValue(profile.repository), runtime: hashValue(plan.runtime) === hashValue(profile.runtime), models: hashValue(plan.agents) === hashValue(profile.agents), environment: hashValue(plan.environment) === hashValue(profile.environment), checks: hashValue(plan.acceptance.checks) === hashValue(profile.acceptance.checks) };
}
/** Public projection with exact applicability and the preregistered proposal.
 * This does not grant collection or change an existing proposal. */
export async function inspectJobImprovements(root: string, profile: ExecutionPlan, jobId: string) {
    const current = await inventory(root, profile), view = improvementView(current), future = futureTemplate(profile, current);
    const result = { ...view, schema_version: "wringer.job-improvements.v1" as const, jobId,
        profile: { source: profile.repository, runtimeSha256: hashValue(profile.runtime), modelsSha256: hashValue(profile.agents), environmentSha256: hashValue(profile.environment), checksSha256: hashValue(profile.acceptance.checks) },
        future: { playbookDigest: future.plan.playbook?.sha256 ?? null, selectionReceipt: future.plan.playbook?.adoption?.sha256 ?? future.plan.approachAdoption?.sha256 ?? null, note: future.note, executionApproved: false as const },
        experiments: view.experiments.map(row => {
            const plan = current!.experiments.find(item => item.id === row.id)!.plan;
            return { ...row, applicability: plan.tasks.map(task => ({ taskId: task.id, sourceIdentity: task.baseline.repository, ...improvementApplicability(task.baseline, profile) })), proposal: { changedVariable: plan.changedVariable, prediction: plan.prediction, holdout: plan.holdout, stoppingRule: plan.stoppingRule, accounting: plan.accounting, playbooks: plan.tasks.map(task => ({ taskId: task.id, baseline: task.baseline.playbook ?? null, candidate: task.candidate.playbook ?? null })) } };
        }) };
    if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw new Error("Job improvement evidence exceeds its bounded view");
    return result;
}
export async function inspectImprovements(root: string, profile: ExecutionPlan) {
    return improvementView(await inventory(root, profile));
}
function improvementView(value: Awaited<ReturnType<typeof inventory>>) {
    const prior = value?.history.at(-1);
    return {
        schema_version: "wringer.improvement-view.v1" as const, connected: !!value,
        revision: prior?.sha256 ?? EMPTY, selectedDigest: prior?.selectedDigest ?? null,
        adoption: prior ?? null,
        experiments: (value?.experiments ?? []).map(row => ({ id: row.id, prediction: row.plan.prediction.statement, taskFamily: row.plan.taskFamily, candidateDigest: row.plan.candidatePlaybook, baselineDigest: row.plan.baselinePlaybook, planSha256: row.plan.sha256, limits: row.plan.limits, result: row.result })),
        limits: ["Optional research for future work. Current jobs and their approvals never change.", "Reviewing this card makes no model or credential calls. Testing requires a separate finite allowance; session/time limits are not a cash cap.", "Fixture results cannot establish live benefit. Names record an operator decision, not verified physical human presence."]
    };
}
/** Only the local operator route may call this function. No MCP tool exports it. */
export async function decideImprovement(root: string, profile: ExecutionPlan, action: "promote" | "rollback", input: AdoptionOptions & { experimentId?: string }) {
    const current = await inventory(root, profile);
    if (!current) throw new Error("No operator-selected comparison is connected");
    if (Object.keys(input).some(key => !["actor", "note", "expectedRevision", "expectedCurrentDigest", "expectedEvidenceRevision", "experimentId"].includes(key))) throw new Error("Unexpected improvement decision fields");
    if (action === "rollback") return rollbackPlaybook(current.link.registryRoot, input);
    if (!shortId(input.experimentId)) throw new Error("Select the displayed comparison identity");
    const selected = current.experiments.find(row => row.id === input.experimentId);
    if (!selected) throw new Error("This comparison is not in the operator-selected repository/task family");
    return promoteExperiment(selected.path, current.link.registryRoot, input);
}
/** A separate grant is created once; the collector reserves the whole comparison before dispatch. */
export async function prepareImprovementTest(root: string, profile: ExecutionPlan, input: { experimentId: string; expectedPlanSha256: string; actor: string; expiresAt: string }) {
    if (!input || Object.keys(input).sort().join(",") !== "actor,expectedPlanSha256,experimentId,expiresAt" || !shortId(input.experimentId)) throw new Error("Select an exact displayed comparison and its separate finite allowance");
    const current = await inventory(root, profile), selected = current?.experiments.find(row => row.id === input.experimentId);
    if (!current || !selected || selected.plan.sha256 !== input.expectedPlanSha256) throw new Error("The selected comparison changed; no trials were started");
    const grant = createExperimentGrant(selected.plan, { actor: input.actor, expiresAt: input.expiresAt, credentialNames: [...new Set(selected.plan.tasks.flatMap(task => task.baseline.runtime.env ?? []))] });
    return { experimentId: selected.id, reservationKey: hashValue({ path: selected.path }), run: (signal?: AbortSignal) => collectExperiment(selected.path, grant, { signal }) };
}

/** Offer only a known exact selected source; never discover arbitrary playbook files.
 * This returns an UNAPPROVED template. Existing proposal/approval files are untouched. */
export async function futureImprovementTemplate(root: string, profile: ExecutionPlan): Promise<{ plan: ExecutionPlan; note: string }> {
    return futureTemplate(profile, await inventory(root, profile));
}
function futureTemplate(profile: ExecutionPlan, current: Awaited<ReturnType<typeof inventory>>): { plan: ExecutionPlan; note: string } {
    const selected = current?.history.at(-1);
    if (!current || !selected) return { plan: profile, note: "No evaluated future approach has been selected." };
    if (!measuredLoopPlan(profile)) return { plan: profile, note: "The current profile predates pinned approaches. Select a v3 profile before adopting guidance in a new proposal." };
    const { schema_version, plan_sha256, acceptance_sha256, intent_sha256, ...declaration } = profile;
    const plans = current.experiments.filter(row => row.plan.sha256 === selected.experimentSha256).flatMap(row => row.plan.tasks.flatMap(task => [task.baseline, task.candidate]));
    const comparable = (plan: ExecutionPlan) => Object.values(improvementApplicability(plan, profile)).every(Boolean);
    if (!selected.selectedDigest) {
        if (!profile.playbook) {
            if (!plans.some(plan => plan.playbook?.sha256 === selected.previousDigest && comparable(plan))) return { plan: profile, note: "The no-playbook selection belongs to another source/runtime/check family. This profile is unchanged." };
            return { plan: compileDeclaration({ version: planVersion(profile), ...declaration, approachAdoption: selected }, { credentialEnvironment: {} }), note: "The future selection is no playbook, with its rollback receipt retained. Existing jobs are unchanged." };
        }
        if (profile.playbook.taskFamily !== selected.taskFamily || profile.playbook.sha256 !== selected.previousDigest || !plans.some(plan => plan.playbook?.sha256 === profile.playbook!.sha256 && comparable(plan))) return { plan: profile, note: "This rollback does not match the profile's pinned approach and source/runtime/check family. Its explicit guidance is unchanged." };
        delete declaration.playbook;
        return { plan: compileDeclaration({ version: planVersion(profile), ...declaration, approachAdoption: selected }, { credentialEnvironment: {} }), note: "Rollback selected no playbook for future proposals only. New work still needs its own approval." };
    }
    const known = plans.find(plan => plan.playbook?.sha256 === selected.selectedDigest && comparable(plan));
    if (!known?.playbook) return { plan: profile, note: "The adopted evidence does not match this pinned source/runtime/check family. The current profile is unchanged; prepare and evaluate a matching profile before claiming benefit." };
    delete declaration.approachAdoption;
    return { plan: compileDeclaration({ version: planVersion(profile), ...declaration, playbook: { ...known.playbook, adoption: selected } }, { credentialEnvironment: {} }), note: "This unapproved future proposal pins the adopted approach and decision receipt. Existing jobs are unchanged. New execution still requires approval." };
}
