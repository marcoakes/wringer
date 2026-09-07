export interface Step {
    id: string;
    needs: string[];
    operation: "literal" | "uppercase" | "join" | "fail";
    value?: string;
}
export interface StepResult {
    id: string;
    status: "passed" | "failed" | "skipped";
    value: string | null;
    error: string | null;
    blockedBy: string[];
}
export interface PipelineResult {
    ok: boolean;
    steps: StepResult[];
    attempted: string[];
}

function order(input: Step[]): Step[] {
    if (!Array.isArray(input)) throw new Error("A pipeline must be an array of steps");
    const ids = new Set<string>();
    for (const step of input) {
        if (!step || typeof step.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(step.id) || ids.has(step.id)) throw new Error("Step ids must be unique lower-case names");
        if (!Array.isArray(step.needs) || step.needs.some(id => typeof id !== "string") || new Set(step.needs).size !== step.needs.length) throw new Error(`Invalid prerequisites for ${step.id}`);
        if (!["literal", "uppercase", "join", "fail"].includes(step.operation) || step.value !== undefined && typeof step.value !== "string") throw new Error(`Invalid operation for ${step.id}`);
        ids.add(step.id);
    }
    for (const step of input) for (const dependency of step.needs) if (!ids.has(dependency)) throw new Error(`Unknown prerequisite ${dependency}`);
    const pending = [...input], sorted: Step[] = [], completed = new Set<string>();
    while (pending.length) {
        const next = pending.findIndex(step => step.needs.every(id => completed.has(id)));
        if (next === -1) throw new Error("The pipeline contains a dependency cycle");
        const [step] = pending.splice(next, 1);
        sorted.push(step!); completed.add(step!.id);
    }
    return sorted;
}
function execute(step: Step, prerequisites: StepResult[]): string {
    const input = prerequisites.map(result => result.value ?? "");
    switch (step.operation) {
        case "literal": return step.value ?? "";
        case "uppercase": return input.join(" ").toUpperCase();
        case "join": return input.join(step.value ?? ", ");
        case "fail": throw new Error(step.value ?? "The step failed");
    }
}

/** Existing behaviour: every scheduled step is attempted, even after failure.
 * This committed baseline intentionally lacks the feature requested in PRD.md. */
export function runPipeline(input: Step[], options: { onAttempt?: (id: string) => void } = {}): PipelineResult {
    const scheduled = order(input), results = new Map<string, StepResult>(), attempted: string[] = [];
    for (const step of scheduled) {
        attempted.push(step.id); options.onAttempt?.(step.id);
        try {
            results.set(step.id, { id: step.id, status: "passed", value: execute(step, step.needs.map(id => results.get(id)!)), error: null, blockedBy: [] });
        } catch (error) {
            results.set(step.id, { id: step.id, status: "failed", value: null, error: error instanceof Error ? error.message : String(error), blockedBy: [] });
        }
    }
    return { ok: [...results.values()].every(result => result.status === "passed"), steps: [...results.values()], attempted };
}
