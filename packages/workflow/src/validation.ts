import type { Assumption, NativePlan, PlanTask, ProposedGate, Question, Requirement, SourceSpan } from "./types";
import { array, bool, digest, knownKeys, object, slug, string, unique } from "./storage";
export function sourceSpans(source: string): SourceSpan[] {
    const result: SourceSpan[] = [];
    const occurrences = new Map<string, number>();
    for (const match of source.matchAll(/[^\r\n]+(?:\r?\n(?!\s*\r?\n)[^\r\n]+)*/g)) {
        const quote = match[0];
        if (!quote.trim())
            continue;
        const n = (occurrences.get(quote) ?? 0) + 1;
        occurrences.set(quote, n);
        result.push({ id: `source-${digest([quote, n]).slice(0, 16)}`, start: match.index!, end: match.index! + quote.length, quote });
    }
    return result;
}
export interface RequirementsSection {
    title: string;
    requirements: Requirement[];
    source_coverage: {
        source_id: string;
        classification: "requirement" | "context";
        reason: string;
    }[];
}
export function validateRequirements(value: unknown, source: string, spans: SourceSpan[]): RequirementsSection {
    const data = object(value, "requirements section");
    knownKeys(data, ["title", "requirements", "source_coverage"], "requirements section");
    const requirements = unique(array(data.requirements, "requirements").map((v, i) => {
        const row = object(v, `requirement ${i}`);
        knownKeys(row, ["semantic_key", "source_id", "quote", "title", "required", "human", "guidance"], `requirement ${i}`);
        const source_id = string(row.source_id, "source_id");
        const span = spans.find(x => x.id === source_id);
        if (!span)
            throw new Error(`Unknown source span ${source_id}`);
        const quote = string(row.quote, "quote");
        if (!span.quote.includes(quote) || !source.includes(quote))
            throw new Error(`Requirement quote is not verbatim in its original source span ${source_id}`);
        const semanticKey = slug(row.semantic_key, "semantic_key");
        const id = `r-${digest([source_id, semanticKey]).slice(0, 16)}`;
        return { id, title: string(row.title, "title"), quote, source_id, required: bool(row.required, "required", true), human: bool(row.human, "human", false), ...(row.guidance === undefined ? {} : { guidance: string(row.guidance, "guidance") }) };
    }), r => r.id, "requirements");
    if (!requirements.length || requirements.length > 20)
        throw new Error("A compatible plan needs 1–20 requirements; larger PRDs must be explicitly split, never silently narrowed");
    const coverage = unique(array(data.source_coverage, "source_coverage").map(v => {
        const row = object(v, "source coverage");
        knownKeys(row, ["source_id", "classification", "reason"], "source coverage");
        const source_id = string(row.source_id, "coverage source_id");
        if (!spans.some(x => x.id === source_id))
            throw new Error(`Unknown source span ${source_id}`);
        if (row.classification !== "requirement" && row.classification !== "context")
            throw new Error("Source classification must be requirement or context");
        if (row.classification === "requirement" && !requirements.some(r => r.source_id === source_id))
            throw new Error(`Source ${source_id} is classified as a requirement but has no requirement row`);
        if (row.classification === "context" && requirements.some(r => r.source_id === source_id))
            throw new Error(`Source ${source_id} cannot be both context and a requirement`);
        return { source_id, classification: row.classification, reason: string(row.reason, "coverage reason") } as RequirementsSection["source_coverage"][number];
    }), x => x.source_id, "source coverage");
    for (const span of spans)
        if (!coverage.some(c => c.source_id === span.id))
            throw new Error(`Original source span ${span.id} was dropped; every paragraph must be accounted for`);
    return { title: string(data.title, "title"), requirements, source_coverage: coverage };
}
function references(value: unknown, requirements: Requirement[]): string[] {
    const refs = unique(array(value, "requirement_ids").map(v => string(v, "requirement id")), v => v, "requirement_ids").sort();
    if (!refs.length)
        throw new Error("A decision or task must name the requirements it concerns");
    for (const id of refs)
        if (!requirements.some(r => r.id === id))
            throw new Error(`Unknown requirement ${id}`);
    return refs;
}
export function validateDecisions(value: unknown, requirements: Requirement[]): {
    questions: Question[];
    assumptions: Assumption[];
} {
    const data = object(value, "decisions section");
    knownKeys(data, ["questions", "assumptions"], "decisions section");
    const questions: Question[] = unique(array(data.questions, "questions").map(v => {
        const row = object(v, "question");
        knownKeys(row, ["semantic_key", "requirement_ids", "question", "required", "human", "suggested_answer"], "question");
        const requirement_ids = references(row.requirement_ids, requirements);
        const semantic_key = slug(row.semantic_key, "semantic_key");
        const human = bool(row.human, "human", false) || requirement_ids.some(id => requirements.find(r => r.id === id)!.human);
        return { id: `q-${digest([requirement_ids, semantic_key]).slice(0, 16)}`, semantic_key, requirement_ids, question: string(row.question, "question"), required: bool(row.required, "required", true), human, ...(row.suggested_answer === undefined ? {} : { suggested_answer: string(row.suggested_answer, "suggested_answer") }) };
    }), q => q.id, "questions");
    if (questions.length > 20)
        throw new Error("At most 20 open questions are supported by the compatible spec");
    const assumptions: Assumption[] = unique(array(data.assumptions, "assumptions").map(v => {
        const row = object(v, "assumption");
        knownKeys(row, ["semantic_key", "requirement_ids", "statement", "human"], "assumption");
        const requirement_ids = references(row.requirement_ids, requirements);
        const semantic_key = slug(row.semantic_key, "semantic_key");
        const human = bool(row.human, "human", false) || requirement_ids.some(id => requirements.find(r => r.id === id)!.human);
        if (human)
            throw new Error(`Assumption ${semantic_key} settles a human requirement: turn it into an explicit question; do not decide it in an assumption`);
        return { id: `a-${digest([requirement_ids, semantic_key]).slice(0, 16)}`, semantic_key, requirement_ids, statement: string(row.statement, "statement"), human, status: "pending" as const };
    }), a => a.id, "assumptions");
    return { questions, assumptions };
}
export function validateTasks(value: unknown, requirements: Requirement[]): {
    tasks: PlanTask[];
    gates: ProposedGate[];
    show: Record<string, string>;
} {
    const data = object(value, "tasks section");
    knownKeys(data, ["tasks", "gates", "show"], "tasks section");
    const tasks = unique(array(data.tasks, "tasks").map(v => {
        const row = object(v, "task");
        knownKeys(row, ["id", "objective", "requirement_ids"], "task");
        const id = slug(row.id, "task id");
        return { id, brief: `.wringer/workflow/briefs/${id}.md`, dir: ".", objective: string(row.objective, "objective"), requirement_ids: references(row.requirement_ids, requirements) };
    }), t => t.id, "tasks");
    if (!tasks.length || tasks.length > 50)
        throw new Error("A plan must have 1–50 tasks");
    for (const req of requirements)
        if (!tasks.some(t => t.requirement_ids.includes(req.id)))
            throw new Error(`Requirement ${req.id} was not assigned to any task`);
    const gates = unique(array(data.gates, "gates").map(v => {
        const row = object(v, "gate");
        knownKeys(row, ["id", "run", "proves", "timeout"], "gate");
        const proves = string(row.proves, "proves");
        const req = requirements.find(r => r.id === proves);
        if (!req)
            throw new Error(`Gate names unknown requirement ${proves}`);
        if (req.human)
            throw new Error(`A gate cannot prove human requirement ${proves}`);
        const timeout = row.timeout;
        if (timeout !== undefined && (!Number.isSafeInteger(timeout) || (timeout as number) < 1))
            throw new Error("Gate timeout must be a positive integer");
        return { id: slug(row.id, "gate id"), run: string(row.run, "gate command"), proves, ...(timeout === undefined ? {} : { timeout: timeout as number }) };
    }), g => g.id, "gates");
    for (const req of requirements.filter(r => r.required && !r.human))
        if (!gates.some(g => g.proves === req.id))
            throw new Error(`Required machine requirement ${req.id} has no proposed check. Do not replace proof with a green unrelated suite`);
    const show = Object.fromEntries(Object.entries(object(data.show, "show")).map(([id, run]) => {
        if (!requirements.find(r => r.id === id)?.human)
            throw new Error(`Display ${id} does not name a human requirement`);
        return [id, string(run, "show command")];
    }));
    for (const req of requirements.filter(r => r.required && r.human))
        if (!show[req.id])
            throw new Error(`Human requirement ${req.id} needs a display command with a success exit when showing succeeds`);
    return { tasks, gates, show };
}
export function validateNativePlan(value: unknown): NativePlan {
    const data = object(value, "native plan");
    if (data.schema_version !== "wringer.workflow-plan.v1")
        throw new Error("Unknown native plan schema");
    for (const key of ["source_sha256", "ledger_sha256", "title", "intent", "created_at"])
        string(data[key], key);
    if (!/^[0-9a-f]{64}$/.test(data.source_sha256 as string) || !/^[0-9a-f]{64}$/.test(data.ledger_sha256 as string))
        throw new Error("Plan has an invalid source or ledger digest");
    const requirements = array(data.requirements, "requirements");
    if (!requirements.length)
        throw new Error("Plan has no requirements");
    unique(requirements, v => slug(object(v, "requirement").id, "requirement id"), "requirements");
    for (const key of ["questions", "assumptions", "tasks", "gates"])
        array(data[key], key);
    object(data.show, "show");
    return data as unknown as NativePlan;
}
