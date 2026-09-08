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
    if (state.stage === "planning") {
        if (state.status === "planning-running") return { title: "Planning is underway.", description: "The bounded planning attempt is active. This page only reads its recorded state; no second attempt is started by refreshing.", tone: "quiet", label: "Planning in progress" };
        if (state.status === "planning-needs-decision") return { title: "Answer the planning questions first.", description: "Read every retained question and the original note below. No build or human acceptance is recorded; revising the intent and approving any new spending remain separate decisions.", tone: "attention", label: "Planning decisions needed" };
        if (state.status === "planning-proposal") return { title: "Review the unapproved proposal.", description: "A proposed execution plan is recorded below. It is not approved, and no build, human verdict or delivery has been inferred from it.", tone: "quiet", label: "Unapproved proposal" };
        return { title: "Planning stopped before a usable proposal.", description: "Inspect the retained planning note, reason and read-only recovery routes below. This page cannot retry, approve new spending or record a human verdict.", tone: "attention", label: state.status === "planning-uncertain" ? "Planning ownership uncertain" : "Planning stopped" };
    }
    if (state.stop?.reason === "operation-uncertain") return { title: "The previous action needs reconciliation.", description: state.stop.message, tone: "attention", label: "Outcome uncertain" };
    if (state.status === "running") {
        const stage = ({ prepare: "Preparing the pinned source", planner: "Reviewing the brief and acceptance plan", baseline: "Checking the starting point", worker: "Building the requested change", capture: "Collecting the changed source", verify: "Checking the candidate", judge: "Independent review of the candidate", human: "Recording the human-review step", ready: "Preparing the ready handover" } as Record<string, string>)[state.stage] ?? "Carrying out the current bounded step";
        return { title: "Work is underway.", description: `${stage}. Follow the recorded evidence here; no second action is needed while this step runs.`, tone: "quiet", label: "In progress" };
    }
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
    if ((state.status === "human-hold" || state.stage === "human") && state.criteria.some(c => c.kind === "human" && c.required && c.state === "not-met"))
        return { title: "Your review asks for more work.", description: "The negative judgement is recorded for this candidate. Request a revision within the remaining authority; Continue cannot turn that observation into acceptance.", tone: "attention", label: "Human requirement not met" };
    if (state.status === "human-hold" || state.stage === "human")
        return { title: "A real decision needs your eyes.", description: "See the recorded result, then say whether it meets the requirement. Your judgement stays in your own words.", tone: "attention", label: "Your review needed" };
    if (state.status === "review-ready" || state.stage === "ready")
        return { title: "Ready to hand over.", description: "Required evidence is complete. Prepare the delivery, inspect it, then make a separate decision to publish.", tone: "good", label: "Ready for delivery" };
    if (state.stage === "judge" && state.checks.length > 0 && state.checks.every(c => c.after.status === "passed"))
        return { title: "Checks passed. Review is still pending.", description: "Independent review has not established the required result. Human review remains unavailable until that step finishes; passing checks alone are not acceptance.", tone: "attention", label: "Independent review pending" };
    if (state.stop) {
        const summaries: Record<string, { title: string; description: string }> = {
            "acceptance-born-green": { title: "These checks already passed before the change.", description: "They do not establish a failing starting point for the requested change. Inspect the named checks and original baseline receipt in the recorded stop evidence." },
            "agent-budget-exhausted": { title: "The approved attempts are used up.", description: "This run cannot continue the next agent step within its remaining role/session limits. The recorded result and unmet or unevaluated requirements remain visible; Continue cannot increase the budget." },
            "verification-budget-exhausted": { title: "The approved check attempts are used up.", description: "The verifier cannot run another attempt under this approval. Existing observations remain evidence; a new budget is a separate decision." },
            "wall-clock-exhausted": { title: "The approved time has run out.", description: "The original journey clock includes interruptions and downtime. No new work is authorized by refreshing or continuing this run." },
            "worker-auth-rejected": { title: "The coding agent could not authenticate.", description: "Check the existing credential setup before another explicit attempt. No successful build is inferred from an authentication failure." },
            "worker-no-change": { title: "The coding agent returned no changed source.", description: "No product change was captured from this attempt. Inspect the retained result before choosing a bounded retry; a completed response is not a completed build." },
            "worker-stopped": { title: "The coding agent stopped before finishing.", description: "Inspect the recorded reason and any remaining retry allowance. This stop is not a successful build, and ordinary Continue will not silently replay the attempt." },
            "judge-invalid-reply": { title: "Independent review could not be read.", description: "The review reply did not match the required findings format. The retained reply and parsing evidence are available below; no judgement was inferred from it." },
            "planner-invalid-reply": { title: "The planning reply could not be read.", description: "The planning reply did not match the required format. Inspect the retained reply and parsing evidence before an explicit bounded retry." },
            "judge-stopped": { title: "Independent review stopped before finishing.", description: "No accepted independent review was established. Inspect the recorded stop evidence and remaining retry allowance before asking for human judgement." },
        };
        const summary = summaries[state.stop.reason];
        return { title: summary?.title ?? "Work is paused. Inspect the recorded stop.", description: summary?.description ?? "The controller stopped before establishing the next outcome. The original reason and evidence are preserved below; only the eligible recovery actions can continue this run.", tone: "attention", label: "Needs attention" };
    }
    if (!state.candidate)
        return { title: "A clear brief. A bounded journey.", description: "The controller will preserve the original requirements, the working budget, and the evidence from each step.", tone: "quiet", label: "Getting started" };
    return { title: "The change is taking shape.", description: "A candidate exists. Checks, independent review and any human decisions remain separate steps.", tone: "quiet", label: "Work in progress" };
}
