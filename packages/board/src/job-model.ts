/** A single-job human view. Its phase is derived by the controller, not an
 * instruction from the assistant, and never grants execution authority. */
export interface PmVisualAsset {
    id: string;
    title: string;
    sha256: string;
    bytes: number;
    width: number;
    height: number;
}
export interface PmVisualReview {
    snapshotSha256: string;
    referenceAssetIds: string[];
    captureIds: string[];
}
export interface PmEngineering {
    schema_version: "wringer.pm-engineering.v1";
    planSha256: string;
    rollback?: { action: "rollback"; actor: string; note: string; at: string; receiptSha256: string };
    approach: { path: string; sha256: string; taskFamily: string; title: string | null; revision: string | null; sourceStatus: "awaiting-validation" | "validated"; workerUses: number; adoption: { action: "promote" | "rollback"; actor: string; note: string; at: string; receiptSha256: string } | null } | null;
    checks: { id: string; level: "command" | "assertions"; status: "not-measured" | "passed" | "failed" | "unknown"; assertionStatus: "not-requested" | "not-measured" | "established" | "unavailable"; reason: string }[];
    history: { sequence: number; phase: "checks" | "judge"; action: "continue" | "warn" | "stop"; reason: string; candidateTree: string; sha256: string }[];
    limits: string[];
}
export interface PmJob {
    schema_version: "wringer.pm-job.v1" | "wringer.pm-job.v2";
    engineering?: PmEngineering;
    jobId: string;
    revision: string;
    readyRevision: string;
    candidateTree: string | null;
    /** The run advanced while this page was read; decisions wait for a fresh read. */
    revisionAdvanced?: boolean;
    phase: "approval" | "working" | "review" | "preparing" | "send" | "sent" | "blocked" | "correction";
    name: string;
    intent: string;
    requirements: { id: string; title: string; quote: string; kind: "check" | "human"; required: boolean; state: "met" | "not-met" | "unknown"; note?: string | null; by?: string | null; visualReview?: PmVisualReview }[];
    budget: { sessions: number; wallSeconds: number; expiresAt: string | null };
    scope: { repository: string; sourceCommit: string; writable: string[]; protected: string[] };
    questions?: string[];
    assumptions?: string[];
    actor: string | null;
    displays: { criterionId: string; title: string; displayId: string; candidateTree: string; success: boolean; output: string; error?: string | null; parts?: { title: string; text: string }[]; visuals?: { snapshotSha256: string; referenceAssets: PmVisualAsset[]; captures: PmVisualAsset[] } }[];
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
    const ids = (x: unknown) => list(x, 32, id) && x.length > 0 && new Set(x).size === x.length;
    const asset = (a: any) => a && id(a.id) && text(a.title, 4000) && hash(a.sha256) && count(a.bytes) && a.bytes > 0 && a.bytes <= 16 * 1024 * 1024 && count(a.width) && a.width > 0 && a.width <= 16384 && count(a.height) && a.height > 0 && a.height <= 16384 && a.width * a.height <= 40000000 && Object.keys(a).every(k => ["id", "title", "sha256", "bytes", "width", "height"].includes(k));
    const assets = (x: unknown) => list(x, 32, asset) && x.length > 0 && new Set(x.map(a => a.id)).size === x.length;
    const visualReview = (r: any) => r && hash(r.snapshotSha256) && ids(r.referenceAssetIds) && ids(r.captureIds);
    const visuals = (v: any) => v && hash(v.snapshotSha256) && assets(v.referenceAssets) && assets(v.captures);
    const exact = (x: any, keys: string[]) => !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
    const adoption = (x: any) => exact(x, ["action", "actor", "note", "at", "receiptSha256"]) && ["promote", "rollback"].includes(x.action) && id(x.actor) && text(x.note, 16000) && typeof x.at === "string" && Number.isFinite(Date.parse(x.at)) && hash(x.receiptSha256);
    const approach = (x: any) => exact(x, ["path", "sha256", "taskFamily", "title", "revision", "sourceStatus", "workerUses", "adoption"]) && text(x.path, 512) && x.path.endsWith(".json") && !/[\\\r\n\t:*?\[\]]/.test(x.path) && !x.path.split("/").some((p: string) => !p || p === "." || p === ".." || p === ".git" || p === ".wringer") && hash(x.sha256) && id(x.taskFamily) && ["awaiting-validation", "validated"].includes(x.sourceStatus) && count(x.workerUses) && x.workerUses <= 10000 && (x.sourceStatus === "validated" ? text(x.title, 256) && !!x.title.trim() && id(x.revision) : x.title === null && x.revision === null && x.workerUses === 0) && (x.adoption === null || adoption(x.adoption));
    const engineering = (x: any) => exact(x, ["schema_version", "planSha256", "approach", "checks", "history", "limits", ...(x?.rollback === undefined ? [] : ["rollback"])]) && x.schema_version === "wringer.pm-engineering.v1" && hash(x.planSha256) && (x.approach === null || approach(x.approach)) && (x.rollback === undefined || x.approach === null && adoption(x.rollback) && x.rollback.action === "rollback")
        && list(x.checks, 4096, c => exact(c, ["id", "level", "status", "assertionStatus", "reason"]) && id(c.id) && ["command", "assertions"].includes(c.level) && ["not-measured", "passed", "failed", "unknown"].includes(c.status) && ["not-requested", "not-measured", "established", "unavailable"].includes(c.assertionStatus) && text(c.reason, 16000) && (c.level === "command" ? c.assertionStatus === "not-requested" : c.assertionStatus !== "not-requested") && !(c.status === "passed" && c.level === "assertions" && c.assertionStatus !== "established")) && new Set(x.checks.map((c: any) => c.id)).size === x.checks.length
        && list(x.history, 10000, r => exact(r, ["sequence", "phase", "action", "reason", "candidateTree", "sha256"]) && count(r.sequence) && r.sequence > 0 && ["checks", "judge"].includes(r.phase) && ["continue", "warn", "stop"].includes(r.action) && text(r.reason, 16000) && tree(r.candidateTree) && hash(r.sha256)) && x.history.every((r: any, i: number) => r.sequence === i + 1) && list(x.limits, 32, x => text(x, 16000));
    if (!v || !["wringer.pm-job.v1", "wringer.pm-job.v2"].includes(v.schema_version) || (v.schema_version === "wringer.pm-job.v1" ? v.engineering !== undefined : !engineering(v.engineering)) || !uuid(v.jobId) || !hash(v.revision) || !hash(v.readyRevision) || !(v.candidateTree === null || tree(v.candidateTree))
        || !["approval", "working", "review", "preparing", "send", "sent", "blocked", "correction"].includes(v.phase)
        || !text(v.name, 1000) || !text(v.intent) || !text(v.nextAction, 16000) || !(v.error === null || text(v.error, 16000))
        || !(v.revisionAdvanced === undefined || typeof v.revisionAdvanced === "boolean") || v.revisionAdvanced === true && !["working", "sent"].includes(v.phase)
        || !(v.retryable === undefined || typeof v.retryable === "boolean") || !(v.retryLabel === undefined || text(v.retryLabel, 200)) || v.retryable === true && !id(v.retryLabel)
        || !(v.actor === null || id(v.actor)) || !list(v.limits, 100, x => text(x, 16000))
        || !v.budget || !count(v.budget.sessions) || !count(v.budget.wallSeconds) || !(v.budget.expiresAt === null || typeof v.budget.expiresAt === "string" && Number.isFinite(Date.parse(v.budget.expiresAt)))
        || !v.scope || !text(v.scope.repository, 4096) || !tree(v.scope.sourceCommit) || !list(v.scope.writable, 1000, x => text(x, 4096)) || !list(v.scope.protected, 1000, x => text(x, 4096))
        || !(v.questions === undefined || list(v.questions, 100, x => text(x, 16000))) || !(v.assumptions === undefined || list(v.assumptions, 100, x => text(x, 16000)))
        || !list(v.requirements, 1000, r => r && id(r.id) && text(r.title, 4000) && text(r.quote) && ["check", "human"].includes(r.kind) && typeof r.required === "boolean" && ["met", "not-met", "unknown"].includes(r.state) && optional(r.note) && optional(r.by, 200) && (r.visualReview === undefined || r.kind === "human" && visualReview(r.visualReview)))
        || !list(v.displays, 1000, d => d && id(d.criterionId) && uuid(d.displayId) && text(d.title, 4000) && tree(d.candidateTree) && typeof d.success === "boolean" && text(d.output, 524288) && optional(d.error, 16000) && (d.parts === undefined || list(d.parts, 100, p => p && text(p.title, 4000) && text(p.text, 524288))) && (d.visuals === undefined || visuals(d.visuals)))
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
    if (displays.some(d => !d || !d.success || d.candidateTree !== job.candidateTree || !d.visuals && !d.output.trim() && !d.parts?.some(p => p.text.trim())))
        return { eligible: false, displayIds: [], reason: "Every listed requirement needs a successful display of this exact result before you can decide." };
    for (const requirement of required) {
        const expected = requirement.visualReview, visual = displays.find(d => d!.criterionId === requirement.id)!.visuals;
        if (!expected && !visual) continue;
        const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
        if (!expected || !visual || expected.snapshotSha256 !== visual.snapshotSha256 || !sameIds(expected.referenceAssetIds, visual.referenceAssets.map(a => a.id)) || !sameIds(expected.captureIds, visual.captures.map(a => a.id)))
            return { eligible: false, displayIds: [], reason: "The pinned design reference and every required capture must match this result before you can decide." };
    }
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
