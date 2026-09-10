import { hashValue } from "@wringer/plan";
import { Redactor } from "@wringer/engine";
import type { PmJob } from "@wringer/board";
import { ASSISTANT_REVISION_ADVANCED, approveAssistantProposal, assistantControllerState, type createAssistantService } from "../../application/src/assistant";
import { assistantInventory, readAssistantRecord, writeAssistantRecord } from "../../application/src/assistant-store";
import { activeWorkspaceCommand, queueWorkspaceCommand, readWorkspaceCommand, type WorkspaceCommand, type WorkspaceCommandResult } from "../../application/src/commands";
import { readController, controllerStatus, type ApplicationOptions } from "../../application/src/controller";
import { projectDesignDisplay } from "./design-assets";
import { readPmEngineering } from "../../application/src/engineering-view";

type Service = Awaited<ReturnType<typeof createAssistantService>>;
const id = (value: unknown) => { const h = hashValue(value); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`; };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const redactor = new Redactor();

/** A deterministic convenience layer, never a second workflow or model loop.
 * Only automatic start, declared showing and PREPARATION are scheduled. A
 * person's decision and sending require separate guarded POSTs. */
export function createAssistantJobFlow(service: Service, options: ApplicationOptions & { isStopping?: () => boolean; beforeCommand?: (jobId: string) => Promise<void>; /** Construction-time seam for the page's own journal re-read. */ dependencies?: { status?: typeof controllerStatus } } = {}) {
    const active = new Set<string>(), transient = new Map<string, string>();
    const cancellations = new Map<string, AbortController>();
    let stopped = false, sweeping = false;
    const assertRunning = () => { if (stopped || options.isStopping?.() || options.signal?.aborted) throw new Error("The owner is stopping. No new work or decision is allowed."); };
    const stateOf = (jobId: string) => assistantControllerState(service.root, jobId);
    const purposeId = (jobId: string, candidate: string | null, purpose: string, attempt: number) => id({ schema: "wringer.pm-convenience.v1", jobId, candidate, purpose, attempt });
    async function retryCount(jobId: string, candidate: string | null) {
        const names = await assistantInventory(service.root, `jobs/${jobId}/pm-retries`);
        if (names.length > 256) throw new Error("Too many retained UI recovery records; no recovery was replayed.");
        let count = 0;
        for (const name of names) { if (!/^[a-f0-9-]{36}\.json$/.test(name)) throw new Error("Unreadable UI recovery record"); const record = await readAssistantRecord(service.root, `jobs/${jobId}/pm-retries/${name}`); if (record.candidateTree === candidate) count++; }
        return count;
    }
    async function recorded(state: string, commandId: string): Promise<WorkspaceCommandResult | null> {
        try { return await readWorkspaceCommand(state, commandId); } catch (error: any) { if (error.code === "ENOENT") return null; throw error; }
    }
    async function guardJob(jobId: string) {
        if (stopped || options.isStopping?.() || options.signal?.aborted) throw new Error("The owner is stopping. No new work or decision is allowed.");
        await service.assertJobActive(jobId);
        await options.beforeCommand?.(jobId);
        const view = await service.status(jobId), approval = await service.inspectApproval(jobId);
        assertRunning();
        if (view.outcome === "cancelled") throw new Error("The job was cancelled while its state was read. No command was reserved.");
        await service.assertJobActive(jobId);
        assertRunning();
        if (!approval || Date.parse(approval.authority.expires_at) <= Date.now()) throw new Error("Approval is out of date or missing. Reading cannot renew it.");
        if (view.uncertainty || view.operations.some((op: any) => ["accepted", "running", "cancel-requested", "uncertain"].includes(op.status))) throw new Error("An operation is running or uncertain. It has not been repeated.");
        return { view, approval };
    }
    async function queue(jobId: string, commandId: string, action: WorkspaceCommand["action"], payload: Record<string, unknown>, expected?: { revision: string; candidateTree: string | null }, waitForCompletion = true) {
        const state = stateOf(jobId), existing = await recorded(state, commandId);
        if (existing) return existing;
        const { view, approval } = await guardJob(jobId);
        if (expected && (view.revision !== expected.revision || view.candidateTree !== expected.candidateTree)) throw new Error("The result advanced after this decision. No follow-on work was started; inspect the current source.");
        let cancellation = cancellations.get(jobId);
        if (!cancellation) { cancellation = new AbortController(); cancellations.set(jobId, cancellation); }
        const signal = options.signal ? AbortSignal.any([options.signal, cancellation.signal]) : cancellation.signal;
        let checking = false;
        const supervision = setInterval(() => {
            if (checking || cancellation.signal.aborted) return;
            checking = true;
            void (async () => {
                try { assertRunning(); await service.assertJobActive(jobId); assertRunning(); }
                catch { cancellation.abort(new Error("The job was cancelled, its owner stopped, or its state became unreadable. Retain uncertain effects; no replay is allowed.")); }
                finally { checking = false; }
            })();
        }, 250); supervision.unref();
        let observingInBackground = false;
        try {
            await service.assertJobActive(jobId);
            assertRunning();
            let result = await queueWorkspaceCommand(state, { idempotencyKey: commandId, expectedRevision: view.revision, expectedCandidateTree: view.candidateTree, action, payload }, { ...options, signal });
            const deadline = Math.min(Date.parse(approval.authority.expires_at), Date.now() + 600000);
            // Admission is not completion. Observe this exact retained command;
            // never re-enqueue it, and never chain a correction from a pending No.
            const observe = async () => {
                while (result.status === "running" || result.status === "completed" && (await activeWorkspaceCommand(state))?.commandId === commandId) {
                    if (signal.aborted || Date.now() >= deadline) { cancellation.abort(new Error("The bounded local command observation ended. Retain any uncertain effects.")); return result; }
                    await new Promise(resolve => setTimeout(resolve, 100));
                    result = await readWorkspaceCommand(state, commandId);
                }
                return result;
            };
            if (!waitForCompletion && result.status === "running") {
                // The durable command owns publication; an HTTP response is not
                // the publication. Keep cancellation/deadline supervision alive
                // while the page observes this exact command, never reposting.
                observingInBackground = true;
                void observe().catch(error => {
                    cancellation.abort(new Error("The accepted command could not be observed. Stop further work and retain any uncertain effect; no command may be repeated."));
                    transient.set(jobId, redactor.scrub(error instanceof Error ? error.message : "The accepted command could not be observed. No work was repeated."));
                }).finally(() => clearInterval(supervision));
                return result;
            }
            return await observe();
        }
        finally { if (!observingInBackground) clearInterval(supervision); }
    }
    async function details(jobId: string) {
        const p = await service.inspectProposal(jobId), { status, query } = await service.inspectForPm(jobId), approval = await service.inspectApproval(jobId);
        const operation = query ? await activeWorkspaceCommand(stateOf(jobId)) : null;
        // These are projections of the same validated status/query snapshot.
        // Do not perform another full bundle audit merely to derive PM wording.
        const board = query ? { criteria: status.requirements as PmJob["requirements"], status: operation ? operation.status === "running" ? "running" : "stopped" : query.status,
            actions: query.actions.map(a => operation ? { ...a, enabled: false } : a),
            limits: ["This workspace derives the validated controller journal. A button is not additional authority.", "A check and an independent agent judgement support a declared requirement; neither guarantees that every intended behaviour was specified.", `Verifier attempts: ${query.budget.verificationAttempts.reserved}/${query.budget.verificationAttempts.ceiling}; unresolved: ${query.budget.verificationAttempts.unknown}.`, `Whole-journey wall-clock ceiling: ${query.budget.wallClock.ceilingSeconds} seconds${query.budget.wallClock.expired ? " (expired)" : ""}.`, "Host login directories are not shared with agents. Provider cost is not inferred from absent billing observations."] } : null;
        const attempt = await retryCount(jobId, status.candidateTree), displays: PmJob["displays"] = [];
        const commands: WorkspaceCommandResult[] = [];
        for (const requirement of p.plan?.acceptance.criteria.filter(c => c.kind === "human" && c.required) ?? []) {
            if (!status.candidateTree) continue;
            const command = await recorded(stateOf(jobId), purposeId(jobId, status.candidateTree, `show/${requirement.id}`, attempt));
            if (command) commands.push(command);
            if (command?.status !== "completed") continue;
            const value = command.result as any, receipt = value?.receipt;
            if (!receipt || receipt.criterionId !== requirement.id || receipt.candidateTree !== status.candidateTree) throw new Error("The retained display does not describe this result.");
            // Present only the declared showing command, not setup logs as if
            // they were a second report. Its enclosing receipt binds all bytes.
            const rows = receipt.measured?.results?.filter((r: any) => r.id === requirement.show?.id) ?? [];
            const parts = rows.map((r: any) => ({ title: requirement.title, text: typeof r.stdout === "string" ? r.stdout : "" }));
            const output = parts.map((r: any) => r.text).join("\n");
            const visuals = projectDesignDisplay(receipt, p.plan!);
            const success = receipt.success === true && (!!visuals || !!output.trim());
            displays.push({ criterionId: requirement.id, title: requirement.title, displayId: receipt.id, candidateTree: receipt.candidateTree, success, output, parts, ...(visuals ? { visuals } : {}), ...(!success ? { error: "This result could not be shown successfully. No decision has been recorded." } : {}) });
        }
        const prepareId = purposeId(jobId, status.candidateTree, "prepare", attempt);
        const preparation = status.candidateTree ? await recorded(stateOf(jobId), prepareId) : null;
        const sendId = purposeId(jobId, status.candidateTree, `send/${prepareId}`, 0);
        const send = status.candidateTree ? await recorded(stateOf(jobId), sendId) : null;
        return { p, status, board, approval, attempt, displays, commands, preparation, prepareId, send, sendId };
    }
    async function read(jobId: string): Promise<PmJob> {
        const { p, status, board, approval, attempt, displays, commands, preparation, prepareId, send } = await details(jobId);
        const engineering = p.plan ? await readPmEngineering(p.plan, status.stage === "intake" ? undefined : stateOf(jobId)) : undefined;
        // An observation never refuses because work advanced while it was read: the page says so and offers no decision.
        const revisionAdvanced = status.revisionAdvanced === true || !!engineering && status.stage !== "intake" && (await (options.dependencies?.status ?? controllerStatus)(stateOf(jobId))).revision !== status.revision;
        const destination = approval?.destination ?? service.workspace.destination;
        const human = p.plan?.acceptance.criteria.filter(c => c.kind === "human" && c.required) ?? [];
        const failed = commands.find(c => ["failed", "uncertain"].includes(c.status)) ?? (preparation && ["failed", "uncertain"].includes(preparation.status) ? preparation : null);
        const failedDisplay = displays.some(d => !d.success);
        const needCorrection = board?.criteria.some(c => c.required && c.kind === "human" && c.state === "not-met");
        let phase: PmJob["phase"] = "working", nextAction = "The approved work is running. No decision is needed right now.", error: string | null = null;
        if (status.publication && ["branch-pushed", "published", "recovered", "closed", "merged"].includes(status.publication.status)) { phase = "sent"; nextAction = "The reviewed change was sent. Share its handover record and fresh-clone audit route."; }
        else if (send && ["uncertain", "failed"].includes(send.status)) { phase = "blocked"; error = `Sending did not establish a completed handover. ${send.error ?? "Inspect the recorded publication outcome."} No send was repeated; reconcile the retained operation before continuing.`; }
        else if (send?.status === "running") { phase = "working"; nextAction = "Sending the accepted handover. This exact command is recorded; do not send it again."; }
        else if (status.outcome === "awaiting-approval" && !p.questions.length) { phase = "approval"; nextAction = "Approve this request and its finite limits once. Work will start automatically."; }
        else if (status.uncertainty || status.outcome === "cancelled" || approval && Date.parse(approval.authority.expires_at) <= Date.now()) { phase = "blocked"; error = status.nextAction; }
        else if (failed || failedDisplay || transient.has(jobId)) { phase = "blocked"; error = failed?.error ?? displays.find(d => !d.success)?.error ?? transient.get(jobId) ?? "This step did not complete."; }
        else if (needCorrection) { phase = "correction"; nextAction = "Your No is recorded. Say what should change; correction uses only the remaining approved allowance."; }
        else if (status.outcome === "review-ready") {
            if (preparation?.status === "completed") { phase = "send"; nextAction = "Your result is accepted. Send this exact prepared change to the destination below?"; }
            else if (!destination) { phase = "blocked"; error = "No handover destination was selected during setup. Nothing can be sent."; }
            else { phase = "preparing"; nextAction = "Your result is accepted. Preparing its handover proof; nothing is being sent."; }
        } else if (status.outcome === "human-hold" && human.length && displays.length === human.length && displays.every(d => d.success) && board?.actions.some(a => a.id === "review" && a.enabled)) { phase = "review"; nextAction = "Your result is ready. Does it meet the requirements shown below?"; }
        else if (status.outcome === "human-hold") { phase = "preparing"; nextAction = "Opening the actual result for your review. No decision has been recorded."; }
        else if (!["approved", "running"].includes(status.outcome)) { phase = "blocked"; error = status.nextAction; }
        if (board?.status === "running" || active.has(jobId)) { if (!["approval", "sent"].includes(phase)) { phase = "working"; nextAction = "Recording this step. No extra approval or repeated action is needed."; error = null; } }
        if (revisionAdvanced && phase !== "sent") { phase = "working"; nextAction = ASSISTANT_REVISION_ADVANCED; error = null; }
        const publication = status.publication ? { ...status.publication, ...(destination && typeof destination.remote === "string" ? { cloneCommand: `git clone --branch ${quote(status.publication.sourceBranch)} -- ${quote(destination.remote)} 'reviewed-change'` } : {}) } : null;
        const revision = status.revision, retryable = phase === "blocked" && !send && attempt < 3 && (failed?.status === "failed" || failedDisplay) && !status.uncertainty && !!approval && Date.parse(approval.authority.expires_at) > Date.now();
        const readyRevision = hashValue({ jobId, revision, candidateTree: status.candidateTree, phase, attempt, displays: displays.map(d => ({ id: d.displayId, success: d.success })), preparedId: phase === "send" ? prepareId : null, publication });
        return redactor.deep({ schema_version: engineering ? "wringer.pm-job.v2" : "wringer.pm-job.v1", ...(engineering ? { engineering } : {}), jobId, revision, readyRevision, candidateTree: status.candidateTree, revisionAdvanced, phase, name: p.plan?.name ?? "Your requested work", intent: p.intent,
            scope: { repository: p.plan?.repository.url ?? service.workspace.profile.repository.url, sourceCommit: p.plan?.repository.commit ?? service.workspace.profile.repository.commit, writable: p.plan?.scope.writable ?? [], protected: p.plan?.acceptance.protected_paths ?? [] }, questions: p.questions, assumptions: p.assumptions,
            requirements: (p.plan?.acceptance.criteria ?? []).map(c => {
                const visual = p.plan?.design?.reviews.find(row => row.criterionId === c.id);
                return { id: c.id, title: c.title, quote: c.quote, kind: c.kind, required: c.required, state: board?.criteria.find(r => r.id === c.id)?.state ?? "unknown", note: board?.criteria.find(r => r.id === c.id)?.note ?? null, by: board?.criteria.find(r => r.id === c.id)?.by ?? null, ...(visual ? { visualReview: { snapshotSha256: p.plan!.design!.snapshotSha256, referenceAssetIds: visual.referenceIds, captureIds: visual.captures.map(capture => capture.id) } } : {}) };
            }),
            budget: { sessions: p.plan?.budget.max_sessions ?? 0, wallSeconds: p.plan?.budget.wall_clock_seconds ?? 0, expiresAt: approval?.authority.expires_at ?? null }, actor: approval?.authority.actor ?? null,
            displays, destination: destination ? { remote: destination.remote, sourceBranch: destination.sourceBranch, targetBranch: destination.targetBranch } : null,
            preparedId: phase === "send" ? prepareId : null, publication, nextAction: error ?? nextAction, error, retryable, retryLabel: preparation?.status === "failed" ? "Retry handover preparation" : "Try showing the result again",
            limits: ["Cooperative-local preview: the recorded name is not proof of physical human presence.", "Only an actual click records a decision. An optional comment is retained only when the person supplied it.", "A changed result needs a fresh decision. Sending is separate from accepting, merging and deploying.", "Coding-app and managed development costs are unknown when not reported; session/time limits are not a cash ceiling.", ...(board?.limits ?? [])],
        }) as PmJob;
    }
    async function advance(jobId: string) {
        if (stopped || options.isStopping?.() || active.has(jobId)) return;
        let ownsActivity = false;
        try {
            const { p, status, approval, attempt, commands } = await details(jobId);
            transient.delete(jobId); // A fresh validated snapshot supersedes an earlier observation error; durable command failures remain authoritative.
            assertRunning();
            if (!approval || Date.parse(approval.authority.expires_at) <= Date.now() || status.uncertainty || status.outcome === "cancelled" || status.outcome === "running") return;
            if (status.outcome === "approved") {
                if (active.has(jobId)) return; active.add(jobId); ownsActivity = true;
                const result = await service.requestRoutine("wringer.start", { jobId, idempotencyKey: purposeId(jobId, null, "start", 0), expectedRevision: status.revision, expectedCandidateTree: null });
                if (result.outcome === "refused") transient.set(jobId, String(result.message));
                return;
            }
            if (commands.some(c => c.status !== "completed")) return;
            if (status.outcome === "human-hold" && !status.requirements.some((c: any) => c.required && c.kind === "human" && c.state === "not-met")) {
                for (const c of p.plan?.acceptance.criteria.filter(c => c.kind === "human" && c.required) ?? []) {
                    const commandId = purposeId(jobId, status.candidateTree, `show/${c.id}`, attempt);
                    if (!await recorded(stateOf(jobId), commandId)) { if (active.has(jobId)) return; active.add(jobId); ownsActivity = true; await queue(jobId, commandId, "show", { criterionId: c.id }); return; }
                }
            }
            if (status.outcome === "review-ready" && !status.publication?.status?.match(/branch-pushed|published|recovered|uncertain|closed|merged/)) {
                if (!approval.destination) return;
                const commandId = purposeId(jobId, status.candidateTree, "prepare", attempt);
                if (!await recorded(stateOf(jobId), commandId)) { if (active.has(jobId)) return; active.add(jobId); ownsActivity = true; await queue(jobId, commandId, "prepare-delivery", approval.destination); }
            }
        } catch (error) { transient.set(jobId, redactor.scrub(error instanceof Error ? error.message : "The recorded step could not be read.")); }
        finally { if (ownsActivity) active.delete(jobId); }
    }
    async function post(action: string, input: unknown) {
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Use the displayed decision.");
        const body = input as Record<string, any>;
        const allowed: Record<string, string[]> = { approve: ["jobId", "expectedRevision", "actor"], decision: ["jobId", "expectedRevision", "expectedCandidateTree", "verdict", "note", "displayIds"], correction: ["jobId", "expectedRevision", "expectedCandidateTree", "note"], send: ["jobId", "expectedRevision", "expectedCandidateTree", "preparedId"], retry: ["jobId", "expectedRevision", "expectedCandidateTree"] };
        if (!allowed[action] || Object.keys(body).some(k => !allowed[action]!.includes(k)) || !uuid.test(body.jobId)) throw new Error("The decision contains unexpected fields or an unknown job.");
        const jobId = body.jobId;
        if (active.has(jobId) || stopped || options.isStopping?.()) throw new Error("This job is advancing. Refresh its recorded state before deciding.");
        await service.assertJobActive(jobId);
        const current = await read(jobId);
        assertRunning();
        if (body.expectedRevision !== current.readyRevision || action !== "approve" && body.expectedCandidateTree !== current.candidateTree) throw new Error("This result changed. Inspect the current result before deciding; nothing was repeated.");
        if (active.has(jobId)) throw new Error("The job advanced while this decision was read. Refresh before deciding.");
        active.add(jobId);
        try {
            if (action === "approve") {
                if (current.phase !== "approval") throw new Error("This work is not awaiting a new approval.");
                const p = await service.inspectProposal(jobId);
                assertRunning();
                const value = await approveAssistantProposal(service.root, { jobId, expectedRevision: hashValue(p), actor: body.actor, expiresAt: new Date(Date.now() + current.budget.wallSeconds * 1000).toISOString(), confirmExecution: true });
                return { outcome: "approved", expiresAt: value.authority.expires_at };
            }
            if (action === "send") {
                if (current.phase !== "send" || body.preparedId !== current.preparedId) throw new Error("Inspect the exact prepared handover before sending.");
                return await queue(jobId, purposeId(jobId, current.candidateTree, `send/${current.preparedId}`, 0), "publish", { preparedId: current.preparedId }, current, false);
            }
            const { approval } = await guardJob(jobId);
            if (action === "retry") {
                if (!current.retryable) throw new Error("No failed local step is eligible for retry. Uncertain work or publication is never replayed here.");
                const recordId = id({ jobId, revision: current.readyRevision, action });
                await writeAssistantRecord(service.root, `jobs/${jobId}/pm-retries/${recordId}.json`, { schema_version: "wringer.pm-retry.v1", candidateTree: current.candidateTree, expectedRevision: current.readyRevision, actor: approval.authority.actor });
                transient.delete(jobId); return { outcome: "retry-recorded" };
            }
            if (body.note !== undefined && (typeof body.note !== "string" || !body.note.trim() || Buffer.byteLength(body.note) > 16000)) throw new Error("Use your own nonempty comment, within 16,000 bytes, or omit it.");
            if (action === "correction") {
                if (!["correction", "review"].includes(current.phase) || !body.note) throw new Error("Write what needs to change before requesting a correction.");
                let expected = { revision: current.revision, candidateTree: current.candidateTree };
                if (current.phase === "review") {
                    const declined = await queue(jobId, id({ jobId, revision: current.readyRevision, action: "decline-for-correction", note: body.note }), "review-decisions", { decisions: current.displays.map(d => ({ criterionId: d.criterionId, displayId: d.displayId, verdict: "not_met", note: body.note })) }, expected);
                    if (declined.status !== "completed") return declined;
                    const history = await readController(stateOf(jobId)), tail = history.events.slice(-2);
                    if (tail[0]?.previous !== current.revision || tail[0]?.type !== "human-decisions-recorded" || tail[1]?.type !== "journey-stopped" || history.result.candidate?.tree !== current.candidateTree) throw new Error("Your No is recorded, but the result advanced before correction. Inspect the current source; no follow-on work was started.");
                    expected = { revision: tail[1]!.sha256, candidateTree: current.candidateTree };
                }
                return await queue(jobId, id({ jobId, revision: current.readyRevision, action, note: body.note }), "request-revision", { by: approval.authority.actor, note: body.note }, expected);
            }
            if (current.phase !== "review" || !["met", "not_met"].includes(body.verdict)) throw new Error("A current successfully displayed result and explicit Yes or No are required.");
            const expected = current.displays.map(d => d.displayId).sort();
            if (!Array.isArray(body.displayIds) || hashValue([...body.displayIds].sort()) !== hashValue(expected) || !expected.length) throw new Error("Your decision must name exactly the requirements and successful displays on this page.");
            return await queue(jobId, id({ jobId, revision: current.readyRevision, action, verdict: body.verdict, note: body.note ?? null }), "review-decisions", { decisions: current.displays.map(d => ({ criterionId: d.criterionId, displayId: d.displayId, verdict: body.verdict, ...(body.note ? { note: body.note } : {}) })) }, current);
        } finally { active.delete(jobId); }
    }
    const tick = async () => {
        if (sweeping || stopped || options.isStopping?.()) return;
        sweeping = true;
        try { for (const job of await service.list()) { if (job.outcome === "cancelled") cancellations.get(job.jobId)?.abort(new Error("The job was cancelled.")); else await advance(job.jobId); } }
        catch { /* Unreadable owner state cannot authorize convenience work. GET surfaces the stop. */ }
        finally { sweeping = false; }
    };
    const timer = setInterval(() => { void tick(); }, 1000); timer.unref();
    return { read, post, tick, stop() { stopped = true; clearInterval(timer); for (const cancellation of cancellations.values()) cancellation.abort(new Error("The job page owner stopped.")); } };
}
