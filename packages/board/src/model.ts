/** One set of facts feeds the board, its Markdown face, and delivery. */
export type RecordStatus = "complete" | "pending" | "failed" | "unknown";
export interface Issue {
    path: string;
    code: string;
    message: string;
}
export interface Gate {
    id: string;
    command: string;
    status: "passed" | "failed";
    optional: boolean;
    exitCode: number;
    timedOut: boolean;
    durationMs: number;
    path: string;
    stdout: string | null;
    stderr: string | null;
}
export interface SourceQuote {
    quote: string | null;
    status: "verified" | "mismatch" | "missing" | "unfrozen";
    against: string | null;
    message: string;
}
export interface Receipt {
    kind: string;
    path: string | null;
    resolved: boolean;
    message: string;
    before: string | null;
    after: string | null;
}
export interface HumanJudgement {
    verdict: "met" | "not_met";
    by: string;
    at: string;
    stale: boolean;
    note: string | null;
    withoutDisplay: boolean;
}
export interface Requirement {
    id: string;
    title: string;
    required: boolean;
    state: string;
    cause: string | null;
    label: string;
    status: RecordStatus;
    reason: string;
    refuses: boolean;
    human: boolean;
    proved: boolean;
    gate: string | null;
    command: string | null;
    receipt: Receipt | null;
    source: SourceQuote;
    judgement: HumanJudgement | null;
    rawReceipt: {
        kind: string;
        bundle: string;
        cites?: string;
    } | null;
    rawJudgement: {
        verdict: "met" | "not_met";
        by: string;
        at: string;
        stale: boolean;
        note?: string;
    } | null;
    show: string | null;
}
export interface RailStep {
    label: string;
    status: RecordStatus;
    detail: string;
}
export interface BoardFacts {
    built: boolean | null;
    buildDetail?: string;
    checksPassing: boolean | null;
    checks: {
        passed: number;
        failed: number;
        total: number;
    } | null;
    requirements: {
        total: number;
        proved: number;
        unproved: number;
        human: number;
        humanComplete: number;
        humanMet: number;
        requiredUnproved: number;
    } | null;
    humanComplete: boolean | null;
    readyToDeliver: boolean | null;
    delivered: boolean | null;
}
export interface NextAction {
    title: string;
    description: string;
    command: string | null;
    owner: "worker" | "person" | "operator";
    spends: boolean | null;
}
export interface UsageLane {
    lane: "drafting" | "building";
    tokens: number | null;
    cost: {
        amount: number;
        currency: string;
    } | null;
    basis: string;
    calls: number | null;
}
export interface TimelineItem {
    at: string;
    label: string;
    detail: string;
    status: RecordStatus;
}
export interface BoardModel {
    version: "wringer.board.v1";
    repo: string;
    title: string;
    intent: string | null;
    generatedAt: string;
    selected: boolean;
    run: {
        id: string;
        path: string;
        createdAt: string;
        head: string;
        branch: string;
        result: string;
    } | null;
    delivery: {
        id: string;
        mode: string;
        commit: string | null;
        pushed: boolean;
    } | null;
    journey: string | null;
    buildContext?: {
        journeyId: string;
        runId: string;
        detail: string;
    };
    gates: Gate[];
    requirements: Requirement[];
    acceptanceCounts: Record<string, number> | null;
    facts: BoardFacts;
    rail: RailStep[];
    nextAction: NextAction;
    timeline: TimelineItem[];
    usage: UsageLane[];
    issues: Issue[];
    limits: string[];
}
export function deriveFacts(model: Pick<BoardModel, "run" | "gates" | "requirements" | "acceptanceCounts" | "delivery" | "issues"> & {
    built?: boolean | null;
    buildContext?: BoardModel["buildContext"];
}): BoardFacts {
    const fatal = model.issues.some(i => !["source-unfrozen", "source-missing", "optional-absent"].includes(i.code));
    const checks = model.run ? { passed: model.gates.filter(g => g.status === "passed").length, failed: model.gates.filter(g => g.status === "failed").length, total: model.gates.length } : null;
    const requirements = model.acceptanceCounts === null ? null : {
        total: model.requirements.length,
        proved: model.requirements.filter(r => r.proved).length,
        unproved: model.requirements.filter(r => !r.human && !r.proved).length,
        human: model.requirements.filter(r => r.human).length,
        humanComplete: model.requirements.filter(r => r.human && r.judgement && !r.judgement.stale).length,
        humanMet: model.requirements.filter(r => r.human && r.judgement?.verdict === "met" && !r.judgement.stale).length,
        requiredUnproved: model.requirements.filter(r => r.required && !r.human && !r.proved).length,
    };
    const checksPassing = model.run && checks && checks.total > 0 ? model.run.result === "passed" && model.gates.every(g => g.optional || g.status === "passed") : null;
    const humanComplete = requirements ? requirements.humanComplete === requirements.human : null;
    const requiredHumanSatisfied = model.requirements.filter(r => r.required && r.human).every(r => r.judgement?.verdict === "met" && !r.judgement.stale);
    return {
        built: model.built ?? null, ...(model.built == null && model.buildContext ? { buildDetail: model.buildContext.detail } : {}), checksPassing, checks, requirements, humanComplete,
        readyToDeliver: model.run && requirements ? !fatal && checksPassing === true && requirements.requiredUnproved === 0 && requiredHumanSatisfied && !model.requirements.some(r => r.refuses) : null,
        delivered: model.delivery ? model.delivery.mode === "live" && Boolean(model.delivery.commit) && model.delivery.pushed : null,
    };
}
export function deriveRail(facts: BoardFacts): RailStep[] {
    const state = (v: boolean | null): RecordStatus => v === null ? "unknown" : v ? "complete" : "pending";
    const r = facts.requirements, g = facts.checks;
    return [
        { label: "Built", status: state(facts.built), detail: facts.built === true ? "The worker recorded a completed build." : facts.buildDetail ?? "No completed build is recorded for this run." },
        { label: "Checks passing", status: state(facts.checksPassing), detail: g ? `${g.passed} of ${g.total} recorded checks passed${g.failed ? `; ${g.failed} failed` : ""}.` : "Checks have not been recorded." },
        { label: "Requirements proved", status: r ? (r.unproved === 0 ? "complete" : "pending") : "unknown", detail: r ? `${r.proved} proved · ${r.unproved} unproved · ${r.human} for a person.` : "Requirements have not been assessed." },
        { label: "Human judgement complete", status: state(facts.humanComplete), detail: r ? `${r.humanComplete} of ${r.human} judgements recorded; ${r.humanMet} said met.` : "Human judgements have not been assessed." },
        { label: "Ready to deliver", status: state(facts.readyToDeliver), detail: facts.readyToDeliver ? "Required checks, proof and human decisions are satisfied in this record." : "Outstanding evidence or decisions still need attention." },
        { label: "Delivered", status: state(facts.delivered), detail: facts.delivered ? "A live delivery names its committed change." : "No committed delivery is recorded for this run." },
    ];
}
/** Recompute after publication too: a frozen preview action must not survive delivery. */
export function deriveNextAction(model: BoardModel): NextAction {
    const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
    if (model.facts.delivered && model.delivery)
        return { title: "Audit and falsify the delivered change", description: "From the root of a fresh clone on the delivered branch, audit the carried evidence, then falsify the committed source change. Neither command spends on a model.", command: `wring audit --delivery ${shellQuote(model.delivery.id)} --repo .\nwring verify --falsify --delivery ${shellQuote(model.delivery.id)} --repo .`, owner: "operator", spends: false };
    if (model.facts.requirements?.requiredUnproved)
        return { title: "Finish the missing proof", description: `${model.facts.requirements.requiredUnproved} required requirement(s) still need a check with a recorded failure and a passing result. This standalone record cannot authorize an agent. Declare a contained plan to delegate the repair.`, command: "wringer-drive plan --help", owner: "operator", spends: false };
    const human = model.requirements.find(r => r.required && r.human && (!r.judgement || r.judgement.stale || r.judgement.verdict !== "met"));
    if (human)
        return { title: "A person needs to see the result", description: human.title, command: `wringer-board judge --id ${shellQuote(human.id)}`, owner: "person", spends: false };
    if (model.facts.readyToDeliver)
        return { title: "Review the delivery", description: "The evidence is ready for a delivery preview.", command: "wring deliver", owner: "operator", spends: false };
    if (model.run && !model.facts.checksPassing)
        return { title: "Bring the checks to green", description: "The failed checks contain the next concrete build work. This standalone record cannot start a coding agent; declare a bounded contained plan to delegate the repair.", command: "wringer-drive plan --help", owner: "operator", spends: false };
    return model.nextAction;
}
