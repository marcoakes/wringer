import { hashBytes, hashValue } from "@wringer/plan";
import { Redactor } from "@wringer/engine";
import type { createAssistantService } from "./assistant";
import { assistantId, assistantInventory } from "./assistant-store";
import { assistantControllerState } from "./assistant";
import { readJobLoopInspection } from "./loop-inspection";
import { inspectJobImprovements } from "./improvements";
type Service = Awaited<ReturnType<typeof createAssistantService>>;
const guard = ["jobId", "idempotencyKey", "expectedRevision", "expectedCandidateIdentity"];
const fields: Record<string, string[]> = {
    "wringer.inspect_setup": [], "wringer.validate_proposal": ["workspaceId", "proposal"], "wringer.propose": ["workspaceId", "idempotencyKey", "proposal"],
    "wringer.revise_proposal": ["jobId", "idempotencyKey", "expectedRevision", "proposal"], "wringer.get_status": ["jobId"], "wringer.get_approval_request": ["jobId"],
    "wringer.list_jobs": ["offset", "limit"], "wringer.wait_for_update": ["jobId", "afterEventId", "timeoutSeconds"], "wringer.get_evidence": ["jobId", "evidenceId", "contentIdentity", "offset", "limit"],
    "wringer.start": guard, "wringer.cancel": guard, "wringer.continue": [...guard, "action"], "wringer.request_revision": [...guard, "note"], "wringer.prepare_handover": guard,
    "wringer.inspect_loop": ["jobId"],
    "wringer.inspect_improvements": ["jobId"],
};
const refusal = (code: string, message: string) => ({ schema_version: "wringer.assistant-refusal.v2", mode: "delegation", outcome: "refused", isError: true, code, message });
const opaque = (value: unknown) => { const h = hashValue(value); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };
/** Versioned adapter over the existing authority engine. Legacy v1 responses
 * retain their meaning. Evidence identities cover exactly the returned bytes. */
export function createDelegationProtocol(service: Service) {
    const redactor = new Redactor(), boundary = { approval: "cooperative-local", execution: service.workspace.profile.runtime.kind === "trusted-local" ? "trusted-local" : "contained" };
    // The earlier versions pin a contained boundary; a trusted-local workspace answers in their siblings.
    const trusted = boundary.execution === "trusted-local", RESPONSE = trusted ? "wringer.assistant-response.v3" : "wringer.assistant-response.v2", SETUP = trusted ? "wringer.delegation-setup.v2" : "wringer.delegation-setup.v1";
    async function snapshots(jobId: string, view: any) {
        const proposal = await service.inspectProposal(jobId);
        const report = structuredClone(view);
        // Wall-clock sampling is not a retained-state transition. Keep that
        // live observation in status, outside the revision-bound report bytes.
        if (report.usage?.development?.measured?.wallClock) delete report.usage.development.measured.wallClock.elapsedSeconds;
        const values = { request: { intent: proposal.intent, assumptions: proposal.assumptions, questions: proposal.questions }, proposal, report: { schema_version: "wringer.delegation-evidence-view.v1", state: report, note: "Live elapsed-clock sampling is omitted. Current status supplies that observation; it does not reset the grant." }, handover: view.publication ?? null };
        return Object.entries(values).map(([kind, value]) => {
            const content = redactor.scrub(JSON.stringify(value, null, 2)).replaceAll(service.root, "[controller]");
            if (Buffer.byteLength(content) > 1024 * 1024) throw new Error("Evidence exceeds its bounded read contract");
            const contentIdentity = hashBytes(Buffer.from(content)), id = opaque({ jobId, kind });
            return { id, kind, contentIdentity, content };
        });
    }
    function next(view: any) {
        if (view.outcome === "superseded") return { code: "inspect-successor", actor: "assistant", eligible: true, reason: view.nextAction };
        if (view.revisionAdvanced) return { code: "inspect", actor: "assistant", eligible: false, reason: view.nextAction };
        if (view.uncertainty) return { code: "reconcile", actor: "operator", eligible: false, reason: view.nextAction };
        if (view.outcome === "cancelled") return { code: "inspect", actor: "assistant", eligible: false, reason: view.nextAction };
        if (["accepted", "running"].includes(view.outcome)) return { code: "wait", actor: "assistant", eligible: true, reason: view.nextAction };
        if (view.outcome === "needs-decision") return { code: "answer-questions", actor: "operator", eligible: true, reason: view.nextAction };
        if (view.outcome === "awaiting-approval") return { code: "approve", actor: "operator", eligible: true, reason: view.nextAction };
        const phase = view.decision?.phase, reason = view.decision?.nextAction ?? view.nextAction;
        if (["working", "preparing"].includes(phase)) return { code: "wait", actor: "assistant", eligible: true, reason };
        if (["review", "send", "correction"].includes(phase)) return { code: phase, actor: "operator", eligible: true, reason };
        if (phase === "sent") return { code: "audit", actor: "assistant", eligible: true, reason };
        if (phase === "blocked" || view.stage === "human") return { code: "inspect", actor: "operator", eligible: false, reason };
        const action = view.actions?.find((row: any) => row.enabled);
        return { code: action?.action ?? "inspect", actor: "assistant", eligible: !!action && !view.revisionAdvanced, reason: action?.reason ?? view.nextAction };
    }
    async function compact(view: any) {
        const evidence = (await snapshots(view.jobId, view)).map(({ content, ...handle }) => handle), action = next(view);
        const phase = view.outcome === "awaiting-approval" ? "approval" : view.outcome === "needs-decision" ? "questions" : view.outcome === "superseded" ? "superseded" : view.decision?.phase ?? view.stage;
        const page = view.decision?.pageUrl;
        const safePage = typeof page === "string" && /^http:\/\/127\.0\.0\.1:[0-9]+\/\?jobId=[a-f0-9-]{36}$/.test(page) ? page : null;
        return { schema_version: RESPONSE, jobId: view.jobId, workspaceId: service.workspace.id, mode: "delegation", revision: view.revision, candidateIdentity: view.candidateTree, eventId: view.eventId ?? hashValue({ revision: view.revision, outcome: view.outcome, candidate: view.candidateTree, operations: view.operations, publication: view.publication }), phase, outcome: view.outcome, uncertainty: view.uncertainty, nextAction: action,
            decision: { kind: action.actor === "operator" ? action.code : null, page: safePage }, remaining: { ceilings: view.usage.development.limits, measured: view.usage.development.measured, monetaryCost: null, codingAppCost: null }, operation: view.operations.length ? { operationId: view.operations.at(-1).operationId, status: view.operations.at(-1).status, message: view.operations.at(-1).message } : null, evidence, boundary, lineage: view.lineage ? { parentJobId: view.lineage.parentJobId, rootJobId: view.lineage.rootJobId } : null, supersededBy: view.supersededBy ?? null };
    }
    return { async call(token: string, name: string, raw: unknown, signal?: AbortSignal): Promise<Record<string, any>> {
        try {
            if (!Object.hasOwn(fields, name) || !raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(key => !fields[name]!.includes(key)) || Buffer.byteLength(JSON.stringify(raw)) > 256 * 1024) return refusal("invalid-arguments", "Use only the declared bounded fields for this tool");
            const args = raw as Record<string, any>;
            // The existing service owns authentication. No construction-only
            // method is consulted until this exact capability is authenticated.
            if (name === "wringer.validate_proposal") {
                const value: any = await service.call(token, name, args, signal);
                if (value.isError) return refusal(String(value.code), String(value.message));
                const { plan, ...validation } = value;
                return { ...validation, schema_version: "wringer.proposal-validation.v2", preview: plan ? { intent: plan.intent, title: plan.name, criteria: plan.acceptance.criteria, checks: plan.acceptance.checks.map((check: any) => ({ id: check.id, criteria: check.criteria })), scope: plan.scope, ceilings: plan.budget, assumptions: value.assumptions, questions: value.questions } : null };
            }
            if (["wringer.inspect_setup", "wringer.list_jobs"].includes(name)) {
                const authenticated = await service.call(token, "wringer.inspect_setup", {});
                if (authenticated.isError) return refusal(String(authenticated.code), String(authenticated.message));
                if (name === "wringer.inspect_setup") {
                    const p = service.workspace.profile;
                    return { schema_version: SETUP, mode: "delegation", workspaceId: service.workspace.id, profileIdentity: p.plan_sha256, checks: p.acceptance.checks.map(check => ({ id: check.id, argv: check.argv, cwd: check.cwd, timeout_seconds: check.timeout_seconds, files: check.files, evidence: check.evidence ?? null })), writable: p.scope.writable, protectedPaths: p.acceptance.protected_paths, ceilings: p.budget, boundary, authority: "none", untrustedContent: true };
                }
                const offset = args.offset ?? 0, limit = args.limit ?? 20;
                if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) return refusal("page-bounds", "Read at most 50 retained jobs using a nonnegative offset");
                const ids = await assistantInventory(service.root, "jobs"), jobs = [];
                for (const id of ids.slice(offset, offset + limit)) {
                    const view = await service.call(token, "wringer.get_status", { jobId: assistantId(id) });
                    if (view.isError) return refusal(String(view.code), String(view.message));
                    jobs.push({ jobId: view.jobId, outcome: view.outcome, revision: view.revision, supersededBy: view.supersededBy ?? null });
                }
                return { schema_version: "wringer.job-list.v2", mode: "delegation", workspaceId: service.workspace.id, jobs, nextOffset: offset + limit < ids.length ? offset + limit : null };
            }
            if (name === "wringer.inspect_improvements") {
                const observed = await service.call(token, "wringer.get_status", { jobId: args.jobId });
                if (observed.isError) return refusal(String(observed.code), String(observed.message));
                const proposal = await service.inspectProposal(args.jobId);
                return inspectJobImprovements(service.root, proposal.plan ?? service.workspace.profile, args.jobId);
            }
            if (name === "wringer.inspect_loop") {
                const observed = await service.call(token, "wringer.get_status", { jobId: args.jobId });
                if (observed.isError) return refusal(String(observed.code), String(observed.message));
                const proposal = await service.inspectProposal(args.jobId);
                return await readJobLoopInspection(proposal.plan, observed.stage === "intake" ? undefined : assistantControllerState(service.root, args.jobId));
            }
            if (name === "wringer.get_evidence") {
                const observed = await service.call(token, "wringer.get_status", { jobId: args.jobId });
                if (observed.isError) return refusal(String(observed.code), String(observed.message));
                const handle = (await snapshots(args.jobId, observed)).find(row => row.id === args.evidenceId);
                if (!handle || handle.contentIdentity !== args.contentIdentity) return refusal("evidence-changed", "This cursor does not name the current content. Read status for a complete new snapshot; do not splice pages");
                const offset = args.offset ?? 0, limit = args.limit ?? 4096;
                if (!Number.isSafeInteger(offset) || offset < 0 || offset > handle.content.length || !Number.isSafeInteger(limit) || limit < 1 || limit > 8192 || offset > 0 && /[\uDC00-\uDFFF]/.test(handle.content[offset] ?? "")) return refusal("evidence-bounds", "Use the returned offset and a page size of 1 to 8192 UTF-16 code units");
                let end = Math.min(handle.content.length, offset + limit);
                if (/[\uD800-\uDBFF]/.test(handle.content[end - 1] ?? "") && end < handle.content.length) end--;
                if (end === offset && end < handle.content.length) return refusal("evidence-bounds", "Use a page size of at least two for this Unicode character");
                return { schema_version: "wringer.evidence-page.v2", jobId: args.jobId, contentIdentity: handle.contentIdentity, content: handle.content.slice(offset, end), nextOffset: end < handle.content.length ? end : null, untrustedContent: true };
            }
            const mapped = { ...args };
            if (fields[name]!.includes("expectedCandidateIdentity")) { mapped.expectedCandidateTree = mapped.expectedCandidateIdentity; delete mapped.expectedCandidateIdentity; }
            const result = await service.call(token, name === "wringer.get_approval_request" ? "wringer.get_status" : name, mapped, signal);
            if (result.isError) return refusal(String(result.code), String(result.message));
            const view = result.usage ? result : await service.call(token, "wringer.get_status", { jobId: result.jobId ?? args.jobId });
            if (view.isError) return refusal(String(view.code), String(view.message));
            return await compact(view);
        } catch { return refusal("invalid-or-unavailable", "The input or retained state could not be validated. No authority was added; observe the existing request before retrying"); }
    } };
}
