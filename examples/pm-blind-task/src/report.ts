import type { PipelineResult } from "./pipeline";

export function renderReport(result: PipelineResult): string {
    const lines = [result.ok ? "Pipeline succeeded" : "Pipeline unsuccessful", "STEP | RESULT | DETAIL"];
    for (const step of result.steps) lines.push(`${step.id} | ${step.status.toUpperCase()} | ${step.error ?? step.value ?? "(no output)"}`);
    lines.push(`Attempted ${result.attempted.length} of ${result.steps.length} steps.`);
    return lines.join("\n") + "\n";
}
