/** The PM workspace is a projection, never an execution or acceptance authority. */
export interface PmWorkspace {
    schema_version: "wringer.pm-workspace.v1";
    name: string;
    intent: string;
    journeyId: string;
    revision: string;
    status: string;
    stage: string;
    candidate: { commit: string; tree: string; changedPaths: string[] } | null;
    criteria: { id: string; title: string; kind: "check" | "human"; required: boolean; state: "met" | "not-met" | "unknown"; checkIds: string[]; note: string | null; by: string | null }[];
    checks: { id: string; before: { status: string; exitCode: number | null }; after: { status: string; exitCode: number | null } }[];
    usage: { sessions: number; ceiling: number; inputTokens: number | null; outputTokens: number | null; costUsd: null };
    actions: { id: string; enabled: boolean; reason: string }[];
    stop: { reason: string; message: string } | null;
    updatedAt: string;
    limits: string[];
    publication?: { status: string; url?: string; deliveryId: string; bundleDir?: string };
}
/** Also embedded in the browser: refuse incomplete state instead of enabling actions on guesses. */
export function validatePmWorkspace(value: unknown): PmWorkspace {
    const v = value as any, text = (x: any) => typeof x === "string" && x.length <= 262144;
    const list = (x: any, check: (v: any) => boolean) => Array.isArray(x) && x.length <= 10000 && x.every(check);
    const count = (x: any) => Number.isSafeInteger(x) && x >= 0, amount = (x: any) => x === null || count(x), note = (x: any) => x === null || text(x);
    const outcome = (x: any) => x && text(x.status) && (x.exitCode === null || count(x.exitCode) && x.exitCode <= 255);
    if (!v || typeof v !== "object" || v.schema_version !== "wringer.pm-workspace.v1" || ![v.name, v.intent, v.journeyId, v.revision, v.status, v.stage, v.updatedAt].every(text) || !v.journeyId || !v.revision || !Number.isFinite(Date.parse(v.updatedAt)) || !(v.candidate === null || v.candidate && text(v.candidate.commit) && text(v.candidate.tree) && list(v.candidate.changedPaths, text)) || !list(v.criteria, c => c && text(c.id) && text(c.title) && ["check", "human"].includes(c.kind) && typeof c.required === "boolean" && ["met", "not-met", "unknown"].includes(c.state) && list(c.checkIds, text) && note(c.note) && note(c.by)) || !list(v.checks, c => c && text(c.id) && outcome(c.before) && outcome(c.after)) || !v.usage || !count(v.usage.sessions) || !count(v.usage.ceiling) || !amount(v.usage.inputTokens) || !amount(v.usage.outputTokens) || v.usage.costUsd !== null || !list(v.actions, a => a && text(a.id) && typeof a.enabled === "boolean" && text(a.reason)) || !(v.stop === null || v.stop && text(v.stop.reason) && text(v.stop.message)) || !list(v.limits, text) || !(v.publication === undefined || v.publication && text(v.publication.status) && text(v.publication.deliveryId) && (v.publication.url === undefined || text(v.publication.url)) && (v.publication.bundleDir === undefined || text(v.publication.bundleDir))))
        throw new Error("The controller returned an incomplete workspace. Actions remain unavailable.");
    if (new Set(v.criteria.map((c: any) => c.id)).size !== v.criteria.length || new Set(v.actions.map((a: any) => a.id)).size !== v.actions.length || new Set(v.checks.map((c: any) => c.id)).size !== v.checks.length)
        throw new Error("The workspace contains duplicate identities. Actions remain unavailable.");
    const hash = (x: string) => /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(x);
    if (v.status === "unconnected" ? v.journeyId !== "connection-pending" || v.revision !== "connection-pending" || v.candidate !== null || v.actions.length !== 0 || v.criteria.length !== 0 || v.checks.length !== 0 || v.publication !== undefined : !/^[a-f0-9]{64}$/.test(v.revision) || v.journeyId === "connection-pending" || v.candidate && (!hash(v.candidate.commit) || !hash(v.candidate.tree)))
        throw new Error("The workspace source identity is incomplete. Actions remain unavailable.");
    return v;
}
/** Plain-language status never infers a hosted review from a Git push. */
export function pmOutcome(state: PmWorkspace): { title: string; description: string; tone: string; label: string } {
    if (state.status === "unconnected") return { title: "Connecting to your workspace.", description: "Your private link is required before any run details or actions are available.", tone: "quiet", label: "No run loaded" };
    if (state.stop?.reason === "operation-uncertain") return { title: "The previous action needs reconciliation.", description: state.stop.message, tone: "attention", label: "Outcome uncertain" };
    if (state.status === "running") return { title: "Work is underway.", description: "The controller is carrying out the current bounded step. Follow its evidence here; no second action is needed while it runs.", tone: "quiet", label: "In progress" };
    let hosted = false;
    try { const url = new URL(state.publication?.url ?? ""); hosted = url.protocol === "https:" && !url.username && !url.password; } catch {}
    if (state.publication && ["published", "recovered"].includes(state.publication.status) && hosted)
        return { title: "Your change is ready for review.", description: "The hosted review request is recorded. The candidate and its evidence travel together.", tone: "good", label: "Review request open" };
    if (state.publication?.status === "closed" || state.publication?.status === "merged")
        return { title: state.publication.status === "merged" ? "The review request was merged." : "The review request is closed.", description: "This is the recorded publication state, not an open review request.", tone: "quiet", label: state.publication.status === "merged" ? "Merged" : "Closed" };
    if (state.publication?.status === "branch-pushed" || state.publication?.status === "delivered")
        return { title: "The branch and its evidence are delivered.", description: "The Git publication is recorded. No hosted review request is established by that push alone.", tone: "good", label: "Branch delivered" };
    if (state.publication && ["uncertain", "failed", "refused"].includes(state.publication.status))
        return { title: "Publication needs attention.", description: "The prepared change remains recorded, but publication has not been established. Inspect the recorded outcome before attempting another send.", tone: "attention", label: "Publication not established" };
    if (state.publication?.status === "prepared")
        return { title: "Prepared, awaiting your publication decision.", description: "The delivery exists locally. Nothing is inferred about a remote branch or hosted review request until publication is recorded.", tone: "quiet", label: "Delivery prepared" };
    if ((state.status === "human-hold" || state.stage === "human") && state.criteria.filter(c => c.required).every(c => c.state === "met"))
        return { title: "Your review is recorded.", description: "Continue the same run to evaluate its current evidence and readiness. No new human verdict is needed for this unchanged candidate.", tone: "quiet", label: "Ready to recheck" };
    if (state.status === "human-hold" || state.stage === "human")
        return { title: "A real decision needs your eyes.", description: "See the recorded result, then say whether it meets the requirement. Your judgement stays in your own words.", tone: "attention", label: "Your review needed" };
    if (state.status === "review-ready" || state.stage === "ready")
        return { title: "Ready to hand over.", description: "Required evidence is complete. Prepare the delivery, inspect it, then make a separate decision to publish.", tone: "good", label: "Ready for delivery" };
    if (state.stop)
        return { title: "Work is paused. Here’s the next step.", description: state.stop.message, tone: "attention", label: "Needs attention" };
    if (!state.candidate)
        return { title: "A clear brief. A bounded journey.", description: "The controller will preserve the original requirements, the working budget, and the evidence from each step.", tone: "quiet", label: "Getting started" };
    return { title: "The change is taking shape.", description: "A candidate exists. Checks, independent review and any human decisions remain separate steps.", tone: "quiet", label: "Work in progress" };
}
