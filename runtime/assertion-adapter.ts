/** Embedded as reviewed, protected source in an acceptance preparation. This
 * entry runs only when the contained verifier executes its pinned command. */
import { assertionReport, translate, MAX_REPORT_BYTES } from "../packages/engine/src/adapters";
import { runProcess } from "../packages/engine/src/process";
import { Redactor } from "../packages/engine/src/io";
import type { Adapter } from "../packages/engine/src/types";
export async function runAssertionAdapter(input: { adapter: Adapter; command: string; requirements: string[]; timeout: number; report?: string }, cwd = process.cwd()) {
    const refused = (reason: string) => ({ report: { schema_version: "wringer-check.v1", assertions: [], errors: [reason] }, exit: 2 });
    if (!["vitest", "playwright", "node-test"].includes(input.adapter) || typeof input.command !== "string" || !Array.isArray(input.requirements) || !Number.isInteger(input.timeout) || input.timeout < 1 || input.timeout > 3600) return refused("Invalid pinned assertion adapter input");
    // A browser launch failure can look like a failed product assertion in
    // Playwright's own report. Measure launch independently before running it.
    if (input.adapter === "playwright") {
        const probe = await runProcess([process.execPath, "--no-env-file", "--no-install", "--no-macros", "--config=/dev/null", "-e", 'const {chromium}=await import("playwright"); const b=await chromium.launch({headless:true}); await b.close();'], { cwd, timeout: 20, maxBytes: 4096 });
        if (probe.exit_code !== 0 || probe.timed_out) return refused("The declared Playwright browser could not launch; product assertions were not run");
    }
    // File reporters need a freshness guard: never read a previous report after
    // an interrupted command. This adapter currently supports stdout reports.
    if (input.report) return refused("Use a reviewed stdout reporter for this contained adapter; file-report freshness is not established");
    const result = await runProcess(["/bin/sh", "-c", input.command], { cwd, timeout: input.timeout, maxBytes: MAX_REPORT_BYTES, redactor: new Redactor() });
    if (result.timed_out || result.interrupted || result.stdout_truncated || ![0, 1].includes(result.exit_code ?? -1)) return refused("The assertion command was incomplete or failed to execute");
    if (input.adapter === "node-test" && !/^# wringer-node-registration-v1: complete$/m.test(result.stdout)) return refused("The Node reporter did not establish registered tests in every selected file");
    try { return { report: assertionReport(translate(input.adapter, result.stdout), input.requirements), exit: result.exit_code! }; }
    catch { return refused("The runner did not produce a complete supported assertion report"); }
}
if (import.meta.main) {
    try { const result = await runAssertionAdapter(JSON.parse(process.argv[2] ?? "")); process.stdout.write(JSON.stringify(result.report) + "\n"); process.exitCode = result.exit; }
    catch { process.stdout.write(JSON.stringify({ schema_version: "wringer-check.v1", assertions: [], errors: ["Pinned adapter input could not be read"] }) + "\n"); process.exitCode = 2; }
}
