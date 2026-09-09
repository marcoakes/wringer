/** A single-job human view. Its phase is derived by the controller, not an
 * instruction from the assistant, and never grants execution authority. */
export interface PmJob {
    schema_version: "wringer.pm-job.v1";
    jobId: string;
    revision: string;
    readyRevision: string;
    candidateTree: string | null;
    phase: "approval" | "working" | "review" | "preparing" | "send" | "sent" | "blocked" | "correction";
    name: string;
    intent: string;
    requirements: { id: string; title: string; quote: string; kind: "check" | "human"; required: boolean; state: "met" | "not-met" | "unknown"; note?: string | null; by?: string | null }[];
    budget: { sessions: number; wallSeconds: number; expiresAt: string | null };
    scope: { repository: string; sourceCommit: string; writable: string[]; protected: string[] };
    questions?: string[];
    assumptions?: string[];
    actor: string | null;
    displays: { criterionId: string; title: string; displayId: string; candidateTree: string; success: boolean; output: string; error?: string | null; parts?: { title: string; text: string }[] }[];
    destination: { remote: string; sourceBranch: string; targetBranch: string } | null;
    preparedId: string | null;
    publication: { status: string; deliveryId: string; url?: string; auditCommand: string; cloneCommand?: string } | null;
    nextAction: string;
    error: string | null;
    retryable?: boolean;
    retryLabel?: string;
    limits: string[];
}

/** Embedded in the browser: malformed, duplicate or oversized facts cannot
 * enable a decision. Untrusted text is allowed as text, never interpreted. */
export function validatePmJob(value: unknown): PmJob {
    const v = value as any;
    const text = (x: unknown, limit = 262144): x is string => typeof x === "string" && x.length <= limit;
    const id = (x: unknown) => text(x, 200) && x.length > 0;
    const uuid = (x: unknown) => typeof x === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
    const hash = (x: unknown) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
    const tree = (x: unknown) => typeof x === "string" && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(x);
    const list = (x: unknown, maximum: number, check: (entry: any) => boolean): x is any[] => Array.isArray(x) && x.length <= maximum && x.every(check);
    const optional = (x: unknown, limit = 262144) => x === null || x === undefined || text(x, limit);
    const count = (x: unknown) => Number.isSafeInteger(x) && Number(x) >= 0;
    if (!v || v.schema_version !== "wringer.pm-job.v1" || !uuid(v.jobId) || !hash(v.revision) || !hash(v.readyRevision) || !(v.candidateTree === null || tree(v.candidateTree))
        || !["approval", "working", "review", "preparing", "send", "sent", "blocked", "correction"].includes(v.phase)
        || !text(v.name, 1000) || !text(v.intent) || !text(v.nextAction, 16000) || !(v.error === null || text(v.error, 16000))
        || !(v.retryable === undefined || typeof v.retryable === "boolean") || !(v.retryLabel === undefined || text(v.retryLabel, 200)) || v.retryable === true && !id(v.retryLabel)
        || !(v.actor === null || id(v.actor)) || !list(v.limits, 100, x => text(x, 16000))
        || !v.budget || !count(v.budget.sessions) || !count(v.budget.wallSeconds) || !(v.budget.expiresAt === null || typeof v.budget.expiresAt === "string" && Number.isFinite(Date.parse(v.budget.expiresAt)))
        || !v.scope || !text(v.scope.repository, 4096) || !tree(v.scope.sourceCommit) || !list(v.scope.writable, 1000, x => text(x, 4096)) || !list(v.scope.protected, 1000, x => text(x, 4096))
        || !(v.questions === undefined || list(v.questions, 100, x => text(x, 16000))) || !(v.assumptions === undefined || list(v.assumptions, 100, x => text(x, 16000)))
        || !list(v.requirements, 1000, r => r && id(r.id) && text(r.title, 4000) && text(r.quote) && ["check", "human"].includes(r.kind) && typeof r.required === "boolean" && ["met", "not-met", "unknown"].includes(r.state) && optional(r.note) && optional(r.by, 200))
        || !list(v.displays, 1000, d => d && id(d.criterionId) && uuid(d.displayId) && text(d.title, 4000) && tree(d.candidateTree) && typeof d.success === "boolean" && text(d.output, 524288) && optional(d.error, 16000) && (d.parts === undefined || list(d.parts, 100, p => p && text(p.title, 4000) && text(p.text, 524288))))
        || !(v.destination === null || v.destination && text(v.destination.remote, 4096) && id(v.destination.sourceBranch) && id(v.destination.targetBranch))
        || !(v.preparedId === null || uuid(v.preparedId))
        || !(v.publication === null || v.publication && id(v.publication.status) && id(v.publication.deliveryId) && optional(v.publication.url, 4096) && text(v.publication.auditCommand, 16000) && optional(v.publication.cloneCommand, 16000)))
        throw new Error("The job record is incomplete or unreadable. Decisions remain paused.");
    if (new Set(v.requirements.map((r: any) => r.id)).size !== v.requirements.length || new Set(v.displays.map((d: any) => d.criterionId)).size !== v.displays.length || new Set(v.displays.map((d: any) => d.displayId)).size !== v.displays.length)
        throw new Error("The job record contains duplicate requirements or displays. Decisions remain paused.");
    if (JSON.stringify(v).length > 2 * 1024 * 1024) throw new Error("The job record exceeds the bounded review size. Decisions remain paused.");
    return v;
}

/** The combined human decision covers exactly the required, unknown human
 * requirements in front of the person. It does not accept unseen optional work. */
export function pmJobReviewSet(job: PmJob): { eligible: boolean; displayIds: string[]; reason: string } {
    if (job.phase !== "review" || !job.candidateTree) return { eligible: false, displayIds: [], reason: "No current human review is available." };
    if (job.questions?.length) return { eligible: false, displayIds: [], reason: "The recorded questions still need answers before a decision is available." };
    const required = job.requirements.filter(r => r.kind === "human" && r.required && r.state === "unknown");
    if (!required.length) return { eligible: false, displayIds: [], reason: "No unreviewed human requirements were identified. A decision cannot be invented." };
    const displays = required.map(r => job.displays.find(d => d.criterionId === r.id));
    if (displays.some(d => !d || !d.success || d.candidateTree !== job.candidateTree || !d.output.trim() && !d.parts?.some(p => p.text.trim())))
        return { eligible: false, displayIds: [], reason: "Every listed requirement needs a successful display of this exact result before you can decide." };
    if (!job.actor?.trim()) return { eligible: false, displayIds: [], reason: "The recorded review identity is unavailable. Ask the operator to inspect the approval." };
    return { eligible: true, displayIds: displays.map(d => d!.displayId), reason: "" };
}

export function pmJobHeading(job: PmJob): string {
    return ({ approval: "Approve the work, then leave it with us.", working: "Your approved work is underway.", review: "Is this the result you wanted?", preparing: "Preparing the next step.", send: "Ready to send this change?", sent: "Your handover is recorded.", blocked: "Your work needs attention.", correction: "What should change?" })[job.phase];
}

export function safeJobReviewLink(value: unknown): string | null {
    if (typeof value !== "string") return null;
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}
