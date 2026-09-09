import { lstat, mkdir, readFile, readdir, realpath, open, link, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { hashValue } from "@wringer/plan";
import { requestContainedRevision } from "@wringer/workflow";
import { deliverContained, readContainedDeliveryProjection, parseForgeConfiguration, assertForgeRepositoryBinding, type ContainedDeliveryResult } from "@wringer/delivery";
import { Redactor, sha256 } from "@wringer/engine";
import { readController, controllerStatus, resumeController, showControllerCandidate, reviewControllerCandidate, reviewControllerDecisions, type HumanDecisionInput, type ApplicationOptions } from "./controller";

export type WorkspaceAction = "resume" | "retry-verification" | "retry-judge" | "retry-stopped" | "retry-uncertain" | "show" | "review" | "review-decision" | "review-decisions" | "request-revision" | "prepare-delivery" | "publish";
export interface WorkspaceCommand { idempotencyKey: string; expectedRevision: string; expectedCandidateTree: string | null; action: WorkspaceAction; payload: Record<string, unknown>; }
export interface WorkspaceCommandResult { commandId: string; status: "running" | "completed" | "failed" | "uncertain"; result?: unknown; error?: string; }
const actions = new Set<WorkspaceAction>(["resume", "retry-verification", "retry-judge", "retry-stopped", "retry-uncertain", "show", "review", "review-decision", "review-decisions", "request-revision", "prepare-delivery", "publish"]);
const queryAction = (action: WorkspaceAction) => ["prepare-delivery", "publish"].includes(action) ? "deliver" : ["review-decision", "review-decisions"].includes(action) ? "review" : action;
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const running = new Map<string, Promise<void>>();
const lockName = ".wringer/application/operation.lock";
const field = (body: Record<string, unknown>, name: string, limit = 16384) => {
    const value = body[name];
    if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > limit || value.includes("\0")) throw new Error(`A bounded ${name} is required`);
    return value;
};
export function parseWorkspaceCommand(input: unknown): WorkspaceCommand {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected a command object");
    const value = input as Record<string, any>;
    if (Object.keys(value).some(k => !["idempotencyKey", "expectedRevision", "expectedCandidateTree", "action", "payload"].includes(k)) || typeof value.idempotencyKey !== "string" || !idPattern.test(value.idempotencyKey) || typeof value.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(value.expectedRevision) || !(value.expectedCandidateTree === null || typeof value.expectedCandidateTree === "string" && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value.expectedCandidateTree)) || typeof value.action !== "string" || !actions.has(value.action as WorkspaceAction) || !value.payload || typeof value.payload !== "object" || Array.isArray(value.payload)) throw new Error("Command needs an exact revision, candidate, action and unique request ID");
    const allowed: Record<WorkspaceAction, string[]> = { resume: [], "retry-verification": [], "retry-judge": [], "retry-stopped": [], "retry-uncertain": [], show: ["criterionId"], review: ["criterionId", "displayId", "verdict", "by", "note"], "review-decision": ["criterionId", "displayId", "verdict", "note"], "review-decisions": ["decisions"], "request-revision": ["by", "note"], "prepare-delivery": ["remote", "sourceBranch", "targetBranch", "forge"], publish: ["preparedId"] };
    if (Object.keys(value.payload).some(k => !allowed[value.action as WorkspaceAction].includes(k))) throw new Error("Unexpected command argument; arbitrary paths and shell commands are not accepted");
    const p = value.payload;
    if (["show", "review"].includes(value.action) && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,180}$/.test(field(p, "criterionId", 181))) throw new Error("Name a declared criterion ID");
    if (["review", "request-revision"].includes(value.action)) { field(p, "by", 200); field(p, "note"); }
    if (value.action === "review" && (!idPattern.test(field(p, "displayId", 36)) || !["met", "not_met"].includes(field(p, "verdict", 7)))) throw new Error("A display ID and explicit met/not_met verdict are required");
    if (["review-decision", "review-decisions"].includes(value.action)) {
        const decisions = value.action === "review-decision" ? [p] : p.decisions;
        if (!Array.isArray(decisions) || decisions.length < 1 || decisions.length > 64) throw new Error("Name 1–64 displayed human requirements");
        for (const d of decisions) {
            if (!d || typeof d !== "object" || Array.isArray(d) || Object.keys(d).some(k => !["criterionId", "displayId", "verdict", "note"].includes(k)) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,180}$/.test(field(d, "criterionId", 181)) || !idPattern.test(field(d, "displayId", 36)) || !["met", "not_met"].includes(field(d, "verdict", 7))) throw new Error("Each displayed requirement needs an explicit met/not_met decision; identity is retained from the initial approval");
            if (d.note !== undefined) field(d, "note");
        }
        if (new Set(decisions.map(d => d.criterionId)).size !== decisions.length) throw new Error("A requirement can occur only once in a grouped decision");
    }
    if (value.action === "publish" && !idPattern.test(field(p, "preparedId", 36))) throw new Error("A preparation command ID is required");
    if (value.action === "prepare-delivery") {
        for (const key of ["remote", "sourceBranch", "targetBranch"]) field(p, key, 2048);
        for (const key of ["sourceBranch", "targetBranch"]) if (/^[/-]|[\s~^:?*\[\\\x00-\x1f\x7f]|\.\.|@\{/.test(p[key]) || p[key].split("/").some((x: string) => !x || x.startsWith(".") || x.endsWith(".lock")) || p[key].endsWith(".")) throw new Error("A safe explicit branch name is required");
        if (p.sourceBranch === p.targetBranch || ["main", "master"].includes(p.sourceBranch)) throw new Error("Use a distinct nondefault review branch");
        if (p.forge !== undefined) { parseForgeConfiguration(p.forge); assertForgeRepositoryBinding(p.remote, p.forge); }
        else if (!p.remote.startsWith("/")) { const u = new URL(p.remote); if (!["https:", "ssh:"].includes(u.protocol) || u.password || u.search || u.hash || u.protocol === "https:" && u.username) throw new Error("Publication needs a credential-free HTTPS/SSH URL or explicit local bare repository"); }
    }
    const copy = JSON.parse(JSON.stringify(value));
    if (copy.action === "review-decisions") { copy.payload.decisions.forEach(Object.freeze); Object.freeze(copy.payload.decisions); }
    Object.freeze(copy.payload); return Object.freeze(copy) as WorkspaceCommand;
}
/** Construction-time fixtures only. None of these dependencies can be selected in HTTP JSON. */
export interface WorkspaceCommandDependencies {
    readController: typeof readController;
    controllerStatus: typeof controllerStatus;
    execute: (state: string, command: WorkspaceCommand, options: ApplicationOptions) => Promise<unknown>;
    readProjection: typeof readContainedDeliveryProjection;
}
const defaultDependencies: WorkspaceCommandDependencies = { readController, controllerStatus, execute, readProjection: readContainedDeliveryProjection };
async function safePath(state: string, name: string): Promise<string> {
    const base = await realpath(state), path = resolve(base, name), rel = relative(base, path);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || !path.startsWith(base + sep)) throw new Error("Application path escapes its controller");
    let cursor = base;
    for (const part of rel.split(sep)) { cursor = join(cursor, part); try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error("Application records must not traverse symlinks"); } catch (e: any) { if (e.code !== "ENOENT") throw e; } }
    return path;
}
async function readControllerFile(path: string): Promise<any> {
    const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) throw new Error("Application record is not a bounded regular file"); return JSON.parse(await readFile(path, "utf8"));
}
/** Atomic no-replace install: a reader never observes partial JSON or partial lock ownership. */
async function immutableControllerFile(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${crypto.randomUUID()}.tmp`, file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); } finally { await file.close(); }
    try { await link(temporary, path); } finally { await unlink(temporary); }
}
interface Owner { schema_version: "wringer.workspace-operation.v1"; commandId: string; requestSha256: string; pid: number; token: string; at: string; }
function ownerOf(value: any): Owner {
    if (!value || value.schema_version !== "wringer.workspace-operation.v1" || !idPattern.test(value.commandId) || !/^[a-f0-9]{64}$/.test(value.requestSha256) || !Number.isSafeInteger(value.pid) || value.pid <= 0 || !idPattern.test(value.token) || !Number.isFinite(Date.parse(value.at))) throw new Error("Operation owner is unreadable; no recovery or execution was attempted"); return value;
}
function ownerAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (e: any) { if (e.code === "ESRCH") return false; throw new Error("Operation owner liveness is unknown; no recovery was attempted"); } }
async function ownerRecord(state: string): Promise<Owner | null> { try { return ownerOf(await readControllerFile(await safePath(state, lockName))); } catch (e: any) { if (e.code === "ENOENT") return null; throw e; } }
async function releaseOwner(state: string, owner: Owner) { const current = await ownerRecord(state); if (current?.token !== owner.token || current.pid !== owner.pid) throw new Error("Operation ownership changed; no foreign lock was removed"); await unlink(await safePath(state, lockName)); }
export async function activeWorkspaceCommand(state: string): Promise<{ commandId: string; status: "running" | "uncertain"; message: string } | null> {
    const owner = await ownerRecord(state); if (!owner) return null; const live = ownerAlive(owner.pid);
    return { commandId: owner.commandId, status: live ? "running" : "uncertain", message: live ? "Another workspace action owns this controller; observe it instead of starting overlapping work." : `The owner is dead, but an orphan runtime or remote request may remain. Explicit recovery: wringer-drive recover-command --state '${state.replaceAll("'", "'\\''")}' --command ${owner.commandId} --acknowledge-uncertain. Only the application lock is released; all domain reservations remain.` };
}
export async function hasActiveWorkspaceCommand(state: string): Promise<boolean> { return (await activeWorkspaceCommand(state)) !== null; }
async function requestRecord(state: string, id: string) {
    const directory = await commandDirectory(state, id), record = await readControllerFile(await safePath(state, join(directory, "request.json")));
    if (record.schema_version !== "wringer.workspace-command.v2" || record.command?.idempotencyKey !== id || record.sha256 !== hashValue(parseWorkspaceCommand(record.command)) || !Number.isFinite(Date.parse(record.at))) throw new Error("Retained command identity is unreadable or changed");
    const owner = ownerOf(record.owner); if (owner.commandId !== id || owner.requestSha256 !== record.sha256) throw new Error("Retained command owner disagrees with its request"); return record;
}
async function commandDirectory(state: string, id: string) {
    if (!idPattern.test(id)) throw new Error("Invalid command ID");
    return safePath(state, `.wringer/application/commands/${id}`);
}
export async function readWorkspaceCommand(state: string, id: string): Promise<WorkspaceCommandResult> {
    const directory = await commandDirectory(state, id);
    const request = await requestRecord(state, id), path = await safePath(state, join(directory, "result.json"));
    try {
        const record = await readControllerFile(path), { sha256: digest, ...body } = record;
        if (record.schema_version !== "wringer.workspace-command-result.v2" || digest !== hashValue(body) || record.requestSha256 !== request.sha256 || record.commandId !== id || !["completed", "failed", "uncertain"].includes(record.status) || !Number.isFinite(Date.parse(record.at))) throw new Error("Retained command outcome was changed or is not bound to its request");
        return { commandId: id, status: record.status, ...(Object.hasOwn(record, "result") ? { result: record.result } : {}), ...(Object.hasOwn(record, "error") ? { error: record.error } : {}) };
    } catch (e: any) { if (e.code !== "ENOENT") throw e; }
    const active = await activeWorkspaceCommand(state), live = active?.commandId === id && active.status === "running";
    return { commandId: id, status: live ? "running" : "uncertain", ...(!live ? { error: "No durable outcome exists. This request was not replayed; inspect domain evidence before explicit reconciliation." } : {}) };
}
async function entries(state: string, path: string): Promise<string[]> {
    const names = await readdir(await safePath(state, path)).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return []; throw e; });
    if (names.length > 10000) throw new Error("Application record inventory exceeds its read bound");
    return names;
}
function publicationInput(command: WorkspaceCommand) {
    const p = command.payload;
    return { remote: field(p, "remote"), sourceBranch: field(p, "sourceBranch"), targetBranch: field(p, "targetBranch"), ...(p.forge ? { forge: parseForgeConfiguration(p.forge) } : {}) };
}
async function preparationRecord(state: string, id: string) {
    const request = await requestRecord(state, id), saved = await readControllerFile(await safePath(state, join(await commandDirectory(state, id), "publication.json")));
    if (request.command.action !== "prepare-delivery" || saved.schema_version !== "wringer.workspace-preparation.v2" || saved.requestSha256 !== request.sha256 || hashValue(saved.publication) !== hashValue(publicationInput(request.command)) || saved.revision !== request.command.expectedRevision || saved.candidateTree !== request.command.expectedCandidateTree || !/^contained-[a-f0-9]{24}$/.test(saved.deliveryId) || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(saved.evidenceCommit)) throw new Error("Prepared delivery identity is unreadable or differs from its original request");
    return saved;
}
// Forge has a frozen locale-sorted request digest. Do not substitute the plan
// canonicalizer here: historical intent bytes must keep their original identity.
const forgeStable = (v: any): string => Array.isArray(v) ? `[${v.map(forgeStable).join(",")}]` : v && typeof v === "object" ? `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${forgeStable(x)}`).join(",")}}` : JSON.stringify(v);
async function latestForgeOutcome(state: string, directory: string, saved: any, view: Awaited<ReturnType<typeof readContainedDeliveryProjection>>) {
    const forge = parseForgeConfiguration(saved.publication.forge), intent = await readControllerFile(await safePath(state, join(directory, "forge/intent.json")));
    // CLI domain records retain canonical hosted identity, but older prepared
    // records retain the transport only as a digest. Validate that identity; do
    // not invent or expose a recovered Git transport URL.
    const repository = assertForgeRepositoryBinding(saved.publication.remote ?? `https://${intent.repository}`, forge);
    if (intent.schema_version !== "wringer.forge-intent.v2" || intent.delivery_id !== saved.deliveryId || hashValue(intent.forge) !== hashValue(forge) || intent.repository !== repository || intent.expected_head_commit !== saved.evidenceCommit || intent.source_branch !== saved.publication.sourceBranch || intent.target_branch !== saved.publication.targetBranch || intent.title !== view.name || intent.body_path !== relative(state, join(directory, "bundle/mr.md")) || intent.body_sha256 !== sha256(await readFile(await safePath(state, join(directory, "bundle/mr.md"))))) throw new Error("Hosted request does not identify the audited delivery, repository and exact evidence commit");
    const found: { at: number; value: NonNullable<ContainedDeliveryResult["forge"]> }[] = [];
    for (const name of await entries(state, join(directory, "forge/outcomes"))) {
        if (!/^[A-Za-z0-9-]+\.json$/.test(name)) throw new Error("Unexpected hosted outcome path");
        const { at, ...value } = await readControllerFile(await safePath(state, join(directory, "forge/outcomes", name)));
        if (value.schema_version !== "wringer.forge-publication.v2" || value.request_sha256 !== sha256(forgeStable(intent)) || value.state_directory !== join(directory, "forge") || !Number.isFinite(Date.parse(at)) || !["prepared", "published", "recovered", "closed", "merged", "blocked", "uncertain"].includes(value.status)) throw new Error("Hosted outcome is not bound to its retained request");
        if (["published", "recovered", "closed", "merged"].includes(value.status) && (value.repository !== repository || value.head_commit !== saved.evidenceCommit || value.hosted_state !== (["published", "recovered"].includes(value.status) ? "open" : value.status))) throw new Error("Hosted outcome has a different repository, commit or request state");
        found.push({ at: Date.parse(at), value: value as NonNullable<ContainedDeliveryResult["forge"]> });
    }
    found.sort((a, b) => b.at - a.at);
    if (found.length > 1 && found[0]!.at === found[1]!.at && hashValue(found[0]!.value) !== hashValue(found[1]!.value)) throw new Error("Hosted outcomes have ambiguous ordering; refresh through explicit publication reconciliation");
    return found[0]?.value ?? null;
}
/** Reads domain records and independently audits the portable view. Command
 * result caches are deliberately not publication evidence. No network is used. */
async function authoritativePublication(state: string, saved: any, deps: WorkspaceCommandDependencies): Promise<ContainedDeliveryResult | null> {
    const directory = await safePath(state, `deliveries/${saved.deliveryId}`), bundle = await safePath(state, join(directory, "bundle")), view = await deps.readProjection(bundle);
    const manifest = await readControllerFile(await safePath(state, join(bundle, "manifest.json")));
    // The portable journal deliberately has a different hash chain from the
    // private controller. Bind both identities; never compare them as if equal.
    if (!["wringer.contained-delivery.v2", "wringer.contained-delivery.v3"].includes(manifest.schema_version) || manifest.viewSha256 !== hashValue(view) || manifest.journal?.sourceHeadSha256 !== saved.revision || manifest.journal?.headSha256 !== view.journalHeadSha256 || view.deliveryId !== saved.deliveryId || view.source.tree !== saved.candidateTree) throw new Error("Audited delivery does not match the prepared journal and candidate");
    const prepared = await readControllerFile(await safePath(state, join(directory, "prepared.json")));
    const transport = saved.transportSha256 ?? hashValue(saved.publication);
    if (!/^[a-f0-9]{64}$/.test(transport) || prepared.schema_version !== "wringer.contained-publication.v1" || prepared.status !== "prepared" || prepared.pushed !== false || prepared.deliveryId !== saved.deliveryId || prepared.bundleDir !== bundle || prepared.codeCommit !== view.source.codeCommit || prepared.evidenceCommit !== saved.evidenceCommit || prepared.sourceBranch !== saved.publication.sourceBranch || prepared.targetBranch !== saved.publication.targetBranch || prepared.transportSha256 !== transport || prepared.auditCommand !== view.auditCommand || prepared.falsify?.command !== view.falsifyCommand) throw new Error("Retained publication does not match the audited source and explicit transport");
    const { transportSha256: _transport, ...base } = prepared;
    const found: ContainedDeliveryResult[] = [];
    for (const name of await entries(state, join(directory, "outcomes"))) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error("Unexpected publication outcome path");
        const record = await readControllerFile(await safePath(state, join(directory, "outcomes", name))), { status, pushed, forge: hosted, ...identity } = record, { status: _status, pushed: _pushed, ...baseIdentity } = base;
        if (`${hashValue(record)}.json` !== name || hashValue(identity) !== hashValue(baseIdentity) || !(status === "prepared" && pushed === false || status === "delivered" && pushed === true) || hosted && !saved.publication.forge) throw new Error("Publication outcome identity was changed or contradicts its prepared source");
        found.push(record);
    }
    const value = found.find(r => r.status === "delivered") ?? found.find(r => r.status === "prepared");
    if (!value) return null;
    if (saved.publication.forge) {
        const hosted = await latestForgeOutcome(state, directory, saved, view);
        if (!hosted) return null;
        return { ...value, forge: hosted };
    }
    return value;
}
async function boundPreparation(state: string, id: string, command: WorkspaceCommand, deps = defaultDependencies) {
    const saved = await preparationRecord(state, id), prior = await readWorkspaceCommand(state, id);
    if (prior.status !== "completed" || saved.revision !== command.expectedRevision || saved.candidateTree !== command.expectedCandidateTree || !await authoritativePublication(state, saved, deps)) throw new Error("Prepared delivery is stale or incomplete. Prepare the current candidate again.");
    return saved;
}
export async function latestWorkspacePublication(stateDirectory: string, dependencies: Partial<WorkspaceCommandDependencies> = {}): Promise<ContainedDeliveryResult | null> {
    const state = await realpath(stateDirectory), deps = { ...defaultDependencies, ...dependencies }, names = await entries(state, "deliveries"), found: ContainedDeliveryResult[] = [];
    if (!names.length) return null;
    const history = await deps.readController(state, false, true);
    if (history.state.stage !== "ready" || history.result.status !== "review-ready") return null;
    // Discovery must start with the domain inventory, not with whichever UI
    // happened to initiate publication. CLI and browser actions share this data.
    for (const id of names.sort()) {
        if (!/^contained-[a-f0-9]{24}$/.test(id)) continue;
        const directory = await safePath(state, `deliveries/${id}`);
        try {
            const manifest = await readControllerFile(await safePath(state, join(directory, "bundle/manifest.json")));
            if (manifest.journal?.sourceHeadSha256 !== history.events.at(-1)?.sha256 || manifest.source?.tree !== history.result.candidate?.tree || manifest.source?.codeCommit !== history.result.candidate?.source.commit || manifest.journeyId !== history.state.id || manifest.planSha256 !== history.plan.plan_sha256) continue;
            const prepared = await readControllerFile(await safePath(state, join(directory, "prepared.json")));
            let forge: unknown;
            try { forge = (await readControllerFile(await safePath(state, join(directory, "forge/intent.json")))).forge; }
            catch (e: any) { if (e.code !== "ENOENT") throw e; }
            const saved = { deliveryId: id, evidenceCommit: prepared.evidenceCommit, revision: manifest.journal.sourceHeadSha256, candidateTree: manifest.source.tree, transportSha256: prepared.transportSha256, publication: { sourceBranch: manifest.publication?.sourceBranch, targetBranch: manifest.publication?.targetBranch, ...(forge ? { forge: parseForgeConfiguration(forge) } : {}) } };
            if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(saved.evidenceCommit) || typeof saved.publication.sourceBranch !== "string" || typeof saved.publication.targetBranch !== "string") throw new Error("Domain publication source identity is unreadable");
            const value = await authoritativePublication(state, saved, deps);
            if (value) found.push(value);
        } catch (e: any) { if (e.code !== "ENOENT") throw e; /* Interrupted before a complete domain record was retained. */ }
    }
    // v1 outcomes contain no publication timestamp. Prefer a recorded push over
    // preparation, then a stable ID; never fabricate chronology from file mtimes.
    found.sort((a, b) => Number(b.pushed) - Number(a.pushed) || a.deliveryId.localeCompare(b.deliveryId));
    return found[0] ?? null;
}
/** A branch already sent is still sent when its hosted request later blocks.
 * Apply only to the current candidate's audited domain publication, never a
 * command-result cache or an unrelated earlier candidate. A definitely unsent
 * preparation remains eligible for its separate explicit publication decision. */
export function workspacePublicationBlocksHandover(publication: Pick<ContainedDeliveryResult, "pushed" | "forge"> | null): boolean {
    return publication !== null && (publication.pushed || !!publication.forge && ["uncertain", "published", "recovered", "closed", "merged"].includes(publication.forge.status));
}
export const WORKSPACE_HANDOVER_RECORDED = "This candidate has already been sent, or its publication outcome is uncertain. Inspect the recorded handover; a new preparation or send is not allowed from this workspace.";
async function assertFreshHandover(state: string, command: WorkspaceCommand, deps: WorkspaceCommandDependencies) {
    if (["prepare-delivery", "publish"].includes(command.action) && workspacePublicationBlocksHandover(await latestWorkspacePublication(state, deps))) throw new Error(WORKSPACE_HANDOVER_RECORDED);
}
async function execute(state: string, command: WorkspaceCommand, options: ApplicationOptions): Promise<unknown> {
    const query = await controllerStatus(state), history = await readController(state, true, true), payload = command.payload;
    if (query.revision !== command.expectedRevision || query.candidateTree !== command.expectedCandidateTree) throw new Error("The run changed. Refresh and inspect the current result before acting.");
    const action = queryAction(command.action);
    if (!query.actions.find(a => a.id === action)?.enabled) throw new Error(query.actions.find(a => a.id === action)?.reason ?? "Action is unavailable in this state");
    const guard = { expectedRevision: command.expectedRevision, expectedCandidateTree: command.expectedCandidateTree };
    if (["resume", "retry-verification", "retry-judge", "retry-stopped", "retry-uncertain"].includes(command.action)) return resumeController(state, { ...options, ...guard, retryVerification: command.action === "retry-verification", retryJudge: command.action === "retry-judge", retryStopped: command.action === "retry-stopped", retryUncertain: command.action === "retry-uncertain" });
    if (command.action === "show") return showControllerCandidate(state, field(payload, "criterionId"), { ...options, ...guard });
    if (command.action === "review") {
        const verdict = field(payload, "verdict"); if (!["met", "not_met"].includes(verdict)) throw new Error("Verdict must be met or not_met");
        const recorded = await reviewControllerCandidate(state, { ...guard, criterionId: field(payload, "criterionId"), displayId: field(payload, "displayId"), verdict: verdict as "met" | "not_met", by: field(payload, "by"), note: field(payload, "note") });
        const current = await ownMutation(state, history.events.length, command, "human-review-recorded");
        const result = verdict === "met" ? await resumeController(state, { ...options, expectedRevision: current.events.at(-1)!.sha256, expectedCandidateTree: command.expectedCandidateTree }) : current.result;
        return { judgement: recorded.judgement, result };
    }
    if (command.action === "review-decision" || command.action === "review-decisions") {
        const decisions = (command.action === "review-decision" ? [payload] : payload.decisions) as HumanDecisionInput[];
        const recorded = await reviewControllerDecisions(state, { ...guard, decisions });
        const current = await ownMutation(state, history.events.length, command, "human-decisions-recorded");
        const result = decisions.every(d => d.verdict === "met") ? await resumeController(state, { ...options, expectedRevision: current.events.at(-1)!.sha256, expectedCandidateTree: command.expectedCandidateTree }) : current.result;
        return { judgements: recorded.judgements, ...(command.action === "review-decision" ? { judgement: recorded.judgements[0] } : {}), result };
    }
    if (command.action === "request-revision") {
        await requestContainedRevision(state, { ...guard, by: field(payload, "by"), feedback: field(payload, "note") });
        const current = await ownMutation(state, history.events.length, command, "revision-requested");
        return resumeController(state, { ...options, expectedRevision: current.events.at(-1)!.sha256, expectedCandidateTree: command.expectedCandidateTree });
    }
    if (command.action === "prepare-delivery") {
        const publication = publicationInput(command);
        const value = await deliverContained({ stateDir: state, publication, send: false, expectedRevision: guard.expectedRevision, expectedCandidateTree: guard.expectedCandidateTree ?? undefined, signal: options.signal });
        await immutableControllerFile(await safePath(state, join(await commandDirectory(state, command.idempotencyKey), "publication.json")), { schema_version: "wringer.workspace-preparation.v2", publication, requestSha256: hashValue(command), revision: command.expectedRevision, candidateTree: command.expectedCandidateTree, deliveryId: value.deliveryId, evidenceCommit: value.evidenceCommit });
        return { preparedId: command.idempotencyKey, delivery: value, remote: publication.remote, sourceBranch: publication.sourceBranch, targetBranch: publication.targetBranch, evidenceCommit: value.evidenceCommit };
    }
    const prepared = await boundPreparation(state, field(payload, "preparedId"), command);
    return deliverContained({ stateDir: state, publication: prepared.publication, send: true, expectedRevision: guard.expectedRevision, expectedCandidateTree: guard.expectedCandidateTree ?? undefined, signal: options.signal });
}
async function ownMutation(state: string, priorLength: number, command: WorkspaceCommand, eventType: string) {
    const current = await readController(state, true, true), tail = current.events.slice(priorLength);
    if (tail.length !== 2 || tail[0]?.previous !== command.expectedRevision || tail[0]?.type !== eventType || tail[1]?.type !== "journey-stopped" || current.result.candidate?.tree !== command.expectedCandidateTree) throw new Error("The review was recorded, but the journey changed before follow-on work. Refresh; no follow-on session was started.");
    return current;
}
/** Reserves a durable command before work; duplicate IDs observe, never repeat it. */
export async function queueWorkspaceCommand(stateDirectory: string, input: unknown, options: ApplicationOptions = {}, dependencies: Partial<WorkspaceCommandDependencies> = {}): Promise<WorkspaceCommandResult> {
    const state = await realpath(resolve(stateDirectory)), command = parseWorkspaceCommand(input), directory = await commandDirectory(state, command.idempotencyKey), deps = { ...defaultDependencies, ...dependencies };
    const requestPath = await safePath(state, join(directory, "request.json"));
    try { await lstat(requestPath); const request = await requestRecord(state, command.idempotencyKey); if (request.sha256 !== hashValue(command)) throw new Error("This request ID already names a different command"); return readWorkspaceCommand(state, command.idempotencyKey); }
    catch (e: any) { if (e.code !== "ENOENT") throw e; }
    // Identical retained commands above are observations, even after publication.
    // Only a fresh operation is refused, before another request is persisted.
    await assertFreshHandover(state, command, deps);
    const history = await deps.readController(state, false, true), clean = new Redactor(["*TOKEN*", "*SECRET*", "*KEY*", "*PASSWORD*", ...(history.plan.runtime.env ?? [])]);
    if (clean.scrub(JSON.stringify(command)) !== JSON.stringify(command)) throw new Error("Command contains a detected credential; it was not recorded");
    const owner: Owner = { schema_version: "wringer.workspace-operation.v1", commandId: command.idempotencyKey, requestSha256: hashValue(command), pid: process.pid, token: crypto.randomUUID(), at: new Date().toISOString() };
    try { await immutableControllerFile(await safePath(state, lockName), owner); }
    catch (error: any) {
        if (error.code !== "EEXIST") throw error;
        const retained = await ownerRecord(state);
        if (retained?.commandId === command.idempotencyKey && retained.requestSha256 === hashValue(command)) return { commandId: command.idempotencyKey, status: (await activeWorkspaceCommand(state))!.status };
        throw new Error((await activeWorkspaceCommand(state))?.message ?? "Operation ownership changed; refresh before acting");
    }
    try { await immutableControllerFile(requestPath, { schema_version: "wringer.workspace-command.v2", command, sha256: hashValue(command), owner, at: owner.at }); }
    catch (error) { await releaseOwner(state, owner); throw error; }
    const work = (async () => {
        let outcome: WorkspaceCommandResult, began = false;
        try {
            const query = await deps.controllerStatus(state), current = await deps.readController(state, true, true);
            if (query.revision !== command.expectedRevision || query.candidateTree !== command.expectedCandidateTree || current.events.at(-1)?.sha256 !== command.expectedRevision || (current.result.candidate?.tree ?? null) !== command.expectedCandidateTree) throw new Error("The run changed. Refresh before acting.");
            // Revalidate after claiming the application operation lock: another
            // publication may have completed between admission and dispatch.
            await assertFreshHandover(state, command, deps);
            const action = queryAction(command.action), offered = query.actions.find(a => a.id === action);
            if (!offered?.enabled) throw new Error(offered?.reason ?? "Action is unavailable in this state");
            if (["show", "review"].includes(command.action) && !current.plan.acceptance.criteria.some(c => c.id === command.payload.criterionId && c.kind === "human")) throw new Error("Name a declared human criterion");
            if (["review-decision", "review-decisions"].includes(command.action)) {
                const decisions = (command.action === "review-decision" ? [command.payload] : command.payload.decisions) as HumanDecisionInput[];
                if (decisions.some(d => !current.plan.acceptance.criteria.some(c => c.id === d.criterionId && c.kind === "human"))) throw new Error("Name declared human requirements");
            }
            if (command.action === "publish") await boundPreparation(state, field(command.payload, "preparedId"), command, deps);
            options.signal?.throwIfAborted();
            began = true;
            const result = await deps.execute(state, command, options);
            // Hash precisely the scrubbed JSON representation that is retained,
            // including native optional fields omitted by JSON serialization.
            const retainedResult = JSON.parse(JSON.stringify(clean.deep(result) ?? null));
            outcome = { commandId: command.idempotencyKey, status: "completed", result: retainedResult };
        } catch (error) { outcome = { commandId: command.idempotencyKey, status: began ? "uncertain" : "failed", error: clean.scrub(error instanceof Error ? error.message : String(error)) }; }
        const body = { schema_version: "wringer.workspace-command-result.v2", requestSha256: hashValue(command), at: new Date().toISOString(), ...outcome };
        await immutableControllerFile(await safePath(state, join(directory, "result.json")), { ...body, sha256: hashValue(body) });
        await releaseOwner(state, owner);
    })();
    running.set(directory, work); void work.finally(() => running.delete(directory)).catch(() => { /* Unrecorded completion retains the cross-process operation lock. */ });
    return { commandId: command.idempotencyKey, status: "running" };
}
/** Releases only application ownership after explicit orphan uncertainty acknowledgement. Never replays. */
export async function recoverWorkspaceCommand(stateDirectory: string, id: string, options: { acknowledgeUncertain: true }, dependencies: Partial<WorkspaceCommandDependencies> = {}) {
    if (!options || options.acknowledgeUncertain !== true || Object.keys(options).some(k => k !== "acknowledgeUncertain")) throw new Error("Explicit uncertainty acknowledgement is required");
    const state = await realpath(resolve(stateDirectory)); await commandDirectory(state, id); const owner = await ownerRecord(state), deps = { ...defaultDependencies, ...dependencies };
    if (!owner) return { recovered: false, commandId: id, message: "No application operation lock remains; no command was replayed.", query: await deps.controllerStatus(state) };
    if (owner.commandId !== id || ownerAlive(owner.pid)) throw new Error("The named operation is not owned by a provably dead process; no lock was released");
    let predecessor = owner.token, won = false;
    // Each dead claimant has one immutable successor. Competing live recoverers
    // cannot both unlink, and a recovery crash can itself be explicitly recovered.
    for (let depth = 0; depth < 128; depth++) {
        const path = await safePath(state, `.wringer/application/recoveries/${predecessor}.json`), claim = { schema_version: "wringer.workspace-recovery.v1", commandId: id, operationToken: owner.token, predecessor, pid: process.pid, token: crypto.randomUUID(), at: new Date().toISOString(), acknowledgement: "An orphan runtime or remote request may remain. Release only the application lock; retain all domain uncertainty and budgets." };
        try { await immutableControllerFile(path, claim); won = true; break; }
        catch (error: any) { if (error.code !== "EEXIST") throw error; const prior = await readControllerFile(path); if (prior.schema_version !== claim.schema_version || prior.operationToken !== owner.token || prior.predecessor !== predecessor || !idPattern.test(prior.token) || !Number.isSafeInteger(prior.pid) || prior.pid <= 0 || ownerAlive(prior.pid)) throw new Error("Another recovery owns this acknowledgement; no lock was removed"); predecessor = prior.token; }
    }
    if (!won) throw new Error("Recovery history exceeded its bound; no operation lock was removed");
    await releaseOwner(state, owner);
    return { recovered: true, commandId: id, message: "Only the application operation lock was released. The old command stays uncertain; an orphan runtime or remote request may remain. Domain reconciliation and every budget check still apply.", query: await deps.controllerStatus(state) };
}
