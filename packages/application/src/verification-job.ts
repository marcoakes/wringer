import { open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { hashBytes, hashValue } from "@wringer/plan";
import { checkIdentity, loadConfig, loadSpec, Redactor, validateDigests, verify, type Snapshot } from "@wringer/engine";
import { loadBoard } from "@wringer/board";
import { assistantExists, assistantId, assistantInventory, assistantPath, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
import { readWorkspace, safeWorkspaceSnapshot } from "./workspaces";
import { showCriterion, recordJudgements } from "./standalone-review";
type SourceIdentity = Pick<Snapshot, "head_sha" | "branch" | "dirty" | "fingerprint">;
const sourceIdentity = ({ head_sha, branch, dirty, fingerprint }: Snapshot): SourceIdentity => ({ head_sha, branch, dirty, fingerprint });

export interface VerificationJob {
    schema_version: "wringer.verification-job.v1"; id: string; workspaceId: string;
    mode: "verification"; parentJobId: string | null; intent: string; createdAt: string;
    source: SourceIdentity; configSha256: string; checkIdentities: unknown[]; selection: string[];
    ceilings: { repetitions: number; elapsedSeconds: number; runSeconds: number; supervisedCommandsPerRun: number };
    destination: { remote: string; base: string; branch: string } | null; trust: "trusted-local";
}
export interface VerificationGrant {
    schema_version: "wringer.verification-grant.v1"; jobId: string; proposalSha256: string;
    actor: string; issuedAt: string; expiresAt: string; boundary: "trusted-local";
}
export interface Observation {
    schema_version: "wringer.verification-observation.v1"; operationId: string; jobId: string;
    at: string; evidence: string | null; exit: number | null; source: SourceIdentity | null;
    outcome: "completed" | "interrupted" | "unconfirmed";
    displays: Awaited<ReturnType<typeof showCriterion>>[];
}
const jobPath = (id: string, name: string) => `verification-jobs/${assistantId(id)}/${name}`;
const clean = new Redactor();
/** Same exact serialization is used by the status handle and page reader. */
export function verificationEvidenceContent(value: { board: Awaited<ReturnType<typeof loadBoard>> | null; displays: Observation["displays"] }, root: string) {
    const content = JSON.stringify(clean.deep({ facts: value.board?.facts, requirements: value.board?.requirements, gates: value.board?.gates, limits: value.board?.limits, displays: value.displays })).replaceAll(root, "[application]");
    if (Buffer.byteLength(content) > 1024 * 1024) throw new Error("Verification evidence exceeds its bounded page contract");
    return content;
}
function words(value: unknown, max = 16384): string {
    if (typeof value !== "string" || !value.trim() || value.length > max || clean.scrub(value) !== value || value.includes("\0")) throw new Error("Supply bounded text without credentials");
    return value;
}
async function identity(repo: string) {
    const config = await loadConfig(repo);
    if (config.execution && config.execution.backend !== "local") throw new Error("This verification grant is trusted-local. Select a contained job explicitly for contained execution.");
    return { config, configSha256: hashValue(config), checkIdentities: await Promise.all(config.gates.map(gate => checkIdentity(repo, gate))) };
}
export async function readVerificationJob(root: string, id: string) {
    let value: VerificationJob;
    if (await assistantExists(root, jobPath(id, "job.json"))) value = await readAssistantRecord<VerificationJob>(root, jobPath(id, "job.json"));
    else {
        const retained = await readAssistantRecord<{ schema_version: string; request: { idempotencyKey: string; workspaceId: string; intent: string }; job: VerificationJob }>(root, jobPath(id, "creation.json"));
        if (retained.schema_version !== "wringer.verification-creation.v1" || retained.request.idempotencyKey !== id || retained.request.workspaceId !== retained.job.workspaceId || retained.request.intent !== retained.job.intent) throw new Error("Retained verification preparation identity changed");
        value = retained.job;
    }
    if (value.schema_version !== "wringer.verification-job.v1" || value.id !== id || value.mode !== "verification" || value.trust !== "trusted-local") throw new Error("Unsupported verification job");
    return value;
}
export async function createVerificationJob(root: string, workspaceId: string, request: { intent: string; selection?: string[]; repetitions?: number; elapsedSeconds?: number; runSeconds?: number; parentJobId?: string; idempotencyKey: string }) {
    const workspace = await readWorkspace(root, workspaceId);
    if (workspace.mode !== "verification") throw new Error("This workspace selected delegation; it cannot fall back to host checks");
    const id = assistantId(request.idempotencyKey), requestFile = jobPath(id, "request.json"), body = { workspaceId, ...request, intent: words(request.intent) };
    const creationFile = jobPath(id, "creation.json");
    if (await assistantExists(root, creationFile)) {
        const retained = await readAssistantRecord<{ schema_version: string; request: typeof body; job: VerificationJob }>(root, creationFile);
        if (retained.schema_version !== "wringer.verification-creation.v1" || hashValue(retained.request) !== hashValue(body) || retained.job.id !== id || retained.job.workspaceId !== workspaceId || retained.job.intent !== body.intent) throw new Error("This idempotency key already names different retained work");
        await writeAssistantRecord(root, requestFile, body);
        await writeAssistantRecord(root, jobPath(id, "job.json"), retained.job);
        return readVerificationJob(root, id);
    }
    if (await assistantExists(root, requestFile)) {
        if (hashValue(await readAssistantRecord(root, requestFile)) !== hashValue(body)) throw new Error("This idempotency key already names different work");
        return readVerificationJob(root, id);
    }
    const { config, configSha256, checkIdentities } = await identity(workspace.repo), source = sourceIdentity(await safeWorkspaceSnapshot(workspace.repo));
    if (!source.head_sha) throw new Error("Verification jobs need an initial repository commit; no automatic commit was made");
    const selection = request.selection ?? config.gates.map(gate => gate.id);
    if (!selection.length || new Set(selection).size !== selection.length || selection.some(id => !config.gates.some(gate => gate.id === id))) throw new Error("Select fixed declared check identifiers");
    const ceilings = { repetitions: request.repetitions ?? 3, elapsedSeconds: request.elapsedSeconds ?? 3600, runSeconds: request.runSeconds ?? 300, supervisedCommandsPerRun: config.setup.length + config.teardown.length + config.services.length + config.gates.filter(gate => selection.includes(gate.id)).reduce((sum, gate) => sum + (gate.stability?.attempts ?? 1), 0) + Object.keys(config.show ?? {}).length };
    if (!Number.isInteger(ceilings.repetitions) || ceilings.repetitions < 1 || ceilings.repetitions > 32 || !Number.isInteger(ceilings.elapsedSeconds) || ceilings.elapsedSeconds < 1 || ceilings.elapsedSeconds > 86400 || !Number.isInteger(ceilings.runSeconds) || ceilings.runSeconds < 1 || ceilings.runSeconds > ceilings.elapsedSeconds || ceilings.supervisedCommandsPerRun > 256) throw new Error("Use finite grants: 1–32 repetitions, up to one day elapsed, with a bounded per-run deadline");
    if (request.parentJobId && (await readVerificationJob(root, assistantId(request.parentJobId))).workspaceId !== workspace.id) throw new Error("A successor must retain its workspace lineage");
    const job: VerificationJob = { schema_version: "wringer.verification-job.v1", id, workspaceId, mode: "verification", parentJobId: request.parentJobId ?? null, intent: body.intent, createdAt: new Date().toISOString(), source, configSha256, checkIdentities, selection, ceilings, destination: workspace.preferences.destination ? { ...workspace.preferences.destination, branch: `wringer/job-${id}` } : null, trust: "trusted-local" };
    // One immutable preparation holds both request and original source before
    // either public index write. Exact retry never snapshots later work.
    await writeAssistantRecord(root, creationFile, { schema_version: "wringer.verification-creation.v1", request: body, job });
    await writeAssistantRecord(root, requestFile, body);
    await writeAssistantRecord(root, jobPath(id, "job.json"), job);
    return job;
}
async function grant(root: string, job: VerificationJob): Promise<VerificationGrant | null> {
    if (!await assistantExists(root, jobPath(job.id, "grant.json"))) return null;
    const value = await readAssistantRecord<VerificationGrant>(root, jobPath(job.id, "grant.json"));
    if (value.schema_version !== "wringer.verification-grant.v1" || value.jobId !== job.id || value.proposalSha256 !== hashValue(job) || value.boundary !== job.trust || !Number.isFinite(Date.parse(value.expiresAt))) throw new Error("Approval does not bind this verification job");
    return value;
}
export async function approveVerificationJob(root: string, id: string, decision: { expectedRevision: string; actor: string; confirmLocalExecution: boolean }) {
    const job = await readVerificationJob(root, id);
    if (await assistantExists(root, jobPath(id, "stop.json"))) throw new Error("This job was stopped; approval cannot restore its execution authority");
    if (decision.expectedRevision !== hashValue(job) || decision.confirmLocalExecution !== true) throw new Error("Review the exact local check declaration and finite limits before approval");
    const actor = words(decision.actor, 200), existing = await grant(root, job);
    if (existing) { if (existing.actor !== actor) throw new Error("This job already has its recorded approval"); return existing; }
    const workspace = await readWorkspace(root, job.workspaceId), current = await identity(workspace.repo);
    if (current.configSha256 !== job.configSha256 || hashValue(current.checkIdentities) !== hashValue(job.checkIdentities) || (await safeWorkspaceSnapshot(workspace.repo)).fingerprint !== job.source.fingerprint) throw new Error("Source or checks changed since the proposal; prepare a new source-bound proposal before approval");
    const now = Date.now(), value: VerificationGrant = { schema_version: "wringer.verification-grant.v1", jobId: id, proposalSha256: hashValue(job), actor, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + job.ceilings.elapsedSeconds * 1000).toISOString(), boundary: "trusted-local" };
    await writeAssistantRecord(root, jobPath(id, "grant.json"), value); return value;
}
async function operations(root: string, id: string) {
    const names = await assistantInventory(root, jobPath(id, "operations"));
    return Promise.all(names.filter(name => name.endsWith(".json")).map(name => readAssistantRecord<any>(root, jobPath(id, `operations/${name}`))));
}
export async function readVerificationObservation(root: string, id: string, operationId: string): Promise<Observation | null> {
    const resolution = jobPath(id, `resolved/${assistantId(operationId)}.json`);
    if (await assistantExists(root, resolution)) {
        const record = await readAssistantRecord<any>(root, resolution), operation = await readAssistantRecord<any>(root, jobPath(id, `operations/${operationId}.json`));
        if (record.schema_version !== "wringer.verification-recovery-result.v1" || record.operationIdentity !== hashValue(operation) || record.observation.jobId !== id || record.observation.operationId !== operationId) throw new Error("Recovered verification identity changed");
        return record.observation;
    }
    const path = jobPath(id, `observations/${operationId}.json`);
    return await assistantExists(root, path) ? await readAssistantRecord<Observation>(root, path) : null;
}
export async function verificationStatus(root: string, id: string) {
    const job = await readVerificationJob(root, id), workspace = await readWorkspace(root, job.workspaceId), approval = await grant(root, job), attempts = await operations(root, id);
    const rows = await Promise.all(attempts.map(async operation => ({ operation, observation: await readVerificationObservation(root, id, operation.id) })));
    rows.sort((a, b) => a.operation.sequence - b.operation.sequence);
    const latest = rows.at(-1), pending = rows.find(row => !row.observation || row.observation.outcome === "unconfirmed"), stopped = await assistantExists(root, jobPath(id, "stop.json"));
    const source = await safeWorkspaceSnapshot(workspace.repo), policy = await identity(workspace.repo);
    const prepared = await assistantExists(root, jobPath(id, `handovers/${source.fingerprint}.json`)) ? await readAssistantRecord<any>(root, jobPath(id, `handovers/${source.fingerprint}.json`)) : null;
    const sending = await assistantExists(root, jobPath(id, "send-request.json"));
    const publication = await assistantExists(root, jobPath(id, "publication.json")) ? await readAssistantRecord<any>(root, jobPath(id, "publication.json")) : null;
    const decisions = await Promise.all((await assistantInventory(root, jobPath(id, "decisions"))).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => readAssistantRecord<any>(root, jobPath(id, "decisions/" + name))));
    decisions.sort((a, b) => a.at.localeCompare(b.at) || hashValue(a).localeCompare(hashValue(b)));
    const preparationErrors = await Promise.all((await assistantInventory(root, jobPath(id, "preparation-errors"))).filter(name => /^[a-f0-9-]+\.json$/.test(name)).map(async name => ({ name, record: await readAssistantRecord<any>(root, jobPath(id, "preparation-errors/" + name)) })));
    const preparationError = preparationErrors.filter(row => (row.record.candidateIdentity ?? row.name.slice(0, -5)) === source.fingerprint).sort((a, b) => String(a.record.at ?? "").localeCompare(String(b.record.at ?? ""))).at(-1)?.record ?? null;
    const policyCurrent = policy.configSha256 === job.configSha256 && hashValue(policy.checkIdentities) === hashValue(job.checkIdentities);
    let board: Awaited<ReturnType<typeof loadBoard>> | null = null;
    if (latest?.observation?.evidence) {
        const evidence = latest.observation.evidence;
        if (!/^\.wringer\/runs\/[A-Za-z0-9_-]+$/.test(evidence)) throw new Error("Invalid retained evidence handle");
        if (!(await validateDigests(join(workspace.repo, evidence))).ok) throw new Error("Verification evidence was altered or omitted");
        board = await loadBoard(workspace.repo, evidence);
    }
    const fresh = !!latest?.observation?.source && source.fingerprint === latest.observation.source.fingerprint && policyCurrent;
    const remaining = { repetitions: Math.max(0, job.ceilings.repetitions - attempts.length), expiresAt: approval?.expiresAt ?? null, cost: null };
    const checksEligible = !!approval && !stopped && !pending && !sending && policyCurrent && remaining.repetitions > 0 && Date.parse(approval.expiresAt) > Date.now();
    const preparationEligible = !!approval && !stopped && !pending && !sending && fresh && !!board?.facts.readyToDeliver && !!job.destination && !prepared;
    const phase = publication ? "sent" : pending || sending ? "uncertain" : stopped ? "stopped" : !approval ? "approval" : !policyCurrent ? "policy-changed" : !latest ? "ready" : !fresh ? "source-changed" : prepared && board?.facts.readyToDeliver ? "send" : preparationEligible ? "handover-blocked" : latest.observation?.exit === 0 && board?.facts.checksPassing ? "review" : "checks-failed";
    const revision = hashValue({ job: hashValue(job), approval, rows, source: source.fingerprint, policyCurrent, stopped, prepared, sending, publication, decisions, preparationError });
    const displays = latest?.observation?.displays ?? [], evidenceContent = verificationEvidenceContent({ board, displays }, root);
    const evidenceContents: { id: string; kind: string; contentIdentity: string; content: string }[] = [];
    function evidence(kind: string, value: unknown, existingId?: string) {
        const content = typeof value === "string" ? value : JSON.stringify(clean.deep(value)).replaceAll(root, "[application]");
        if (Buffer.byteLength(content) > 1024 * 1024) throw new Error("Retained evidence exceeds its bounded page contract");
        const key = hashValue({ jobId: id, kind, value }), opaque = [key.slice(0, 8), key.slice(8, 12), key.slice(12, 16), key.slice(16, 20), key.slice(20, 32)].join("-");
        evidenceContents.push({ id: existingId ?? opaque, kind, contentIdentity: hashBytes(Buffer.from(content)), content });
    }
    if (latest?.observation?.evidence) evidence("standalone-sealed-bundle", evidenceContent, latest.operation.id);
    if (decisions.length) evidence("review-decision", decisions.at(-1));
    if (preparationError) evidence("preparation-error", preparationError);
    const human = board?.requirements.filter(row => row.human && row.required) ?? [];
    const eligible = phase === "handover-blocked" ? preparationEligible : phase === "send" ? !!approval && fresh && !!prepared && !!board?.facts.readyToDeliver
        : phase === "review" ? !!approval && fresh && human.length > 0 && human.every(row => displays.some(display => display.criterion === row.id && display.success))
        : phase === "approval" ? policyCurrent && source.fingerprint === job.source.fingerprint : checksEligible;
    return { schema_version: "wringer.job-response.v2", jobId: id, workspaceId: workspace.id, mode: "verification", revision, candidateIdentity: source.fingerprint, eventId: revision, phase, outcome: phase, uncertainty: !!pending || sending && !publication, nextAction: { code: phase === "handover-blocked" ? "prepare-handover" : phase === "send" ? "send" : phase === "review" ? "review" : phase === "approval" ? "approve" : checksEligible ? "run-checks" : phase, actor: !approval || phase === "review" || phase === "send" || phase === "handover-blocked" ? "operator" : "assistant", eligible, reason: phase === "handover-blocked" ? "Handover is not prepared. Inspect the retained preparation error, resolve its cause, and explicitly retry preparation. No checks or Send will run." : phase === "send" ? "Review the exact prepared destination. Sending is a separate decision; it does not consume or renew check authority." : phase === "approval" && eligible ? "Review this exact source, declared checks and finite trusted-local allowance." : pending ? "Inspect retained operation evidence; no automatic replay." : !policyCurrent ? "Check definitions or declared inputs changed; fresh review is required." : phase === "review" ? "Inspect the change and declared outputs. Passing checks and requirement proof remain separate." : checksEligible ? "Run the fixed selection within the remaining local grant." : "Read retained evidence and prepare a separate review when needed." }, decision: { kind: !approval ? "approval" : phase === "review" ? "review" : phase === "send" ? "send" : null, page: null }, remaining, operation: latest ? { id: latest.operation.id, status: latest.observation?.outcome ?? "uncertain" } : null, evidence: evidenceContents.map(({ content, ...handle }) => handle), boundary: { approval: "cooperative-local", execution: "trusted-local" }, job, approval, board, fresh, prepared, publication, displays, checksEligible, preparationEligible, evidenceContents };
}
export function compactVerificationStatus(value: Omit<Awaited<ReturnType<typeof verificationStatus>>, "decision"> & { decision: { kind: string | null; page: string | null } }) {
    const { job, approval, board, displays, fresh, prepared, publication, checksEligible, preparationEligible, evidenceContents, ...response } = value;
    return response;
}
export function createVerificationOperations(root: string) {
    const active = new Map<string, AbortController>();
    type Request = { idempotencyKey: string; expectedRevision: string; expectedCandidateIdentity: string; jobId?: string };
    function canonicalRequest(id: string, input: Request) {
        if (input.jobId !== undefined && input.jobId !== id) throw new Error("Operation request names another job");
        if (Object.keys(input).some(key => !["jobId", "idempotencyKey", "expectedRevision", "expectedCandidateIdentity"].includes(key))) throw new Error("Unknown operation request field");
        const { idempotencyKey, expectedRevision, expectedCandidateIdentity } = input;
        return { idempotencyKey, expectedRevision, expectedCandidateIdentity };
    }
    async function execute(id: string, input: Request, onReserved?: () => void) {
        const request = canonicalRequest(id, input);
        assistantId(request.idempotencyKey);
        const old = jobPath(id, `operations/${request.idempotencyKey}.json`);
        if (await assistantExists(root, old)) {
            if (hashValue(canonicalRequest(id, (await readAssistantRecord<any>(root, old)).request)) !== hashValue(request)) throw new Error("Operation key conflicts with its original request");
            onReserved?.(); return verificationStatus(root, id);
        }
        const status = await verificationStatus(root, id), job = status.job;
        if (status.revision !== request.expectedRevision || status.candidateIdentity !== request.expectedCandidateIdentity || !status.checksEligible) throw new Error("Checks are not currently eligible under those exact guards");
        const lockPath = await assistantPath(root, jobPath(id, "execution.lock")), lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("A verification operation is active or uncertain. Read retained status before retrying."); });
        try {
            const current = await verificationStatus(root, id);
            if (current.revision !== request.expectedRevision || !current.checksEligible) throw new Error("Verification state advanced before reservation");
            const controller = new AbortController(), deadline = Math.min(Date.parse(status.approval!.expiresAt), Date.now() + job.ceilings.runSeconds * 1000);
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]);
            const workspace = await readWorkspace(root, job.workspaceId), operation = { schema_version: "wringer.verification-operation.v2", id: request.idempotencyKey, jobId: id, sequence: (await operations(root, id)).length + 1, at: new Date().toISOString(), request, deadline: new Date(deadline).toISOString(), evidence: `.wringer/runs/verification-${request.idempotencyKey}` };
            await writeAssistantRecord(root, old, operation); active.set(id, controller);
            await lock.writeFile(JSON.stringify({ operationId: operation.id, pid: process.pid })); await lock.sync();
            onReserved?.();
            let observation: Observation;
            try {
                const result = await verify(workspace.repo, { gate: job.selection, strict: true, serial: true, signal, output: operation.evidence });
                const displays: Observation["displays"] = [], spec = await loadSpec(workspace.repo);
                if (result.exit_code === 0 && !signal.aborted) for (const criterion of spec?.criteria.filter((row: any) => row.human && row.required !== false) ?? []) {
                    signal.throwIfAborted(); displays.push(await showCriterion(workspace.repo, criterion.id, { signal }));
                }
                const verified = await Bun.file(join(workspace.repo, result.evidence_dir, "snapshot.json")).json();
                observation = { schema_version: "wringer.verification-observation.v1", operationId: operation.id, jobId: id, at: new Date().toISOString(), evidence: result.evidence_dir, exit: result.exit_code, source: sourceIdentity(verified), outcome: signal.aborted ? "interrupted" : "completed", displays };
            } catch {
                observation = { schema_version: "wringer.verification-observation.v1", operationId: operation.id, jobId: id, at: new Date().toISOString(), evidence: null, exit: null, source: null, outcome: "unconfirmed", displays: [] };
            }
            await writeAssistantRecord(root, jobPath(id, `observations/${operation.id}.json`), observation);
            return verificationStatus(root, id);
        } finally { active.delete(id); await lock.close(); await unlink(lockPath); }
    }
    async function stop(id: string, actor: string, request?: { idempotencyKey: string; expectedRevision: string; expectedCandidateIdentity: string }) {
        await readVerificationJob(root, id);
        if (request) {
            const record = jobPath(id, `cancellations/${assistantId(request.idempotencyKey)}.json`);
            if (await assistantExists(root, record)) {
                if (hashValue((await readAssistantRecord<any>(root, record)).request) !== hashValue(request)) throw new Error("Cancellation key conflicts with its recorded request");
            } else {
                const current = await verificationStatus(root, id);
                if (current.revision !== request.expectedRevision || current.candidateIdentity !== request.expectedCandidateIdentity) throw new Error("Cancellation is stale; refresh the job before stopping it");
                await writeAssistantRecord(root, record, { schema_version: "wringer.verification-cancellation.v1", request, actor, at: new Date().toISOString() });
            }
        }
        const path = jobPath(id, "stop.json");
        if (!await assistantExists(root, path)) await writeAssistantRecord(root, path, { schema_version: "wringer.verification-stop.v1", jobId: id, actor: words(actor, 200), at: new Date().toISOString() });
        active.get(id)?.abort(); return verificationStatus(root, id);
    }
    async function review(id: string, request: { expectedRevision: string; expectedCandidateIdentity: string; verdict: "met" | "not_met"; note?: string }) {
        const status = await verificationStatus(root, id);
        if (status.revision !== request.expectedRevision || status.candidateIdentity !== request.expectedCandidateIdentity || !status.fresh || status.phase !== "review" || !status.approval) throw new Error("Review requires the current successful source-bound result");
        if (!["met", "not_met"].includes(request.verdict)) throw new Error("Select acceptance or correction");
        const actor = status.approval.actor;
        const note = request.note?.trim() ? words(request.note) : undefined, workspace = await readWorkspace(root, status.job.workspaceId), human = status.board?.requirements.filter(row => row.human && row.required) ?? [];
        if (request.verdict === "not_met" && !note) throw new Error("Describe the requested correction in your own words");
        if (!human.length) throw new Error("No human criterion is declared; conclude with a verification report without inventing acceptance criteria");
        for (const criterion of human) if (!status.displays.find(row => row.criterion === criterion.id)?.success) throw new Error("Every human criterion needs a successful display of this candidate");
        await recordJudgements(workspace.repo, human.map(criterion => ({ criterion: criterion.id, display: status.displays.find(row => row.criterion === criterion.id)!.id, verdict: request.verdict, note, by: actor })));
        await writeAssistantRecord(root, jobPath(id, `decisions/${request.expectedRevision}.json`), { schema_version: "wringer.verification-decision.v1", candidateIdentity: request.expectedCandidateIdentity, revision: request.expectedRevision, verdict: request.verdict, ...(note ? { note } : {}), actor: status.approval.actor, at: new Date().toISOString() });
        return verificationStatus(root, id);
    }
    return { execute, stop, review, isRunning: (id: string) => active.has(id) };
}
