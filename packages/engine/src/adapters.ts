/**
 * Structured test results on the standalone route.
 *
 * Measured on 19 September 2026, with real runners:
 *
 *   node --test --test-reporter=tap  over two skipped tests  -> exit 0, "# pass 0, # skipped 2"
 *   playwright test --reporter=json  with no browser binary  -> exit 1, stats.unexpected 2,
 *                                                              two specs with status "failed",
 *                                                              top-level errors []
 *
 * The first passes a gate whose whole testimony is its exit code. The second is
 * indistinguishable, in the runner's own JSON, from two product assertions that
 * failed: the only trace of "the browser never started" is inside an error
 * MESSAGE. So these adapters translate each runner's own report into the frozen
 * `wringer-check.v1` shape and hand it to the shared rules in `@wringer/records`,
 * and the environment classification comes from the supervisor's measurements —
 * a launch probe or a spawn exit code — never from log text.
 */
import { validateAssertionReport, type AssertionReport } from "@wringer/records";
import { sha256 } from "./io";
import { EngineError, type Adapter } from "./types";
export const ADAPTERS = ["vitest", "playwright", "node-test"] as const;
export const MAX_ASSERTIONS = 1024;
export const MAX_REPORT_BYTES = 8 * 1024 * 1024;
export interface TranslatedAssertion {
    id: string;
    name: string;
    status: "passed" | "failed" | "skipped";
}
export interface Translation {
    adapter: Adapter;
    assertions: TranslatedAssertion[];
    errors: string[];
    counts: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
        executed: number;
    };
}
/** A runner's test name is not an assertion id. Slug plus digest keeps it exact and unique. */
export function assertionId(name: string): string {
    const slug = name.replace(/[^A-Za-z0-9_.:/-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").replace(/-+/g, "-").slice(0, 170);
    return `${slug || "assertion"}.${sha256(name).slice(0, 12)}`;
}
const bounded = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 2000);
function counted(assertions: TranslatedAssertion[], errors: string[], adapter: Adapter): Translation {
    return {
        adapter, assertions, errors: errors.filter(Boolean).slice(0, 32),
        counts: {
            total: assertions.length,
            passed: assertions.filter(a => a.status === "passed").length,
            failed: assertions.filter(a => a.status === "failed").length,
            skipped: assertions.filter(a => a.status === "skipped").length,
            executed: assertions.filter(a => a.status !== "skipped").length,
        },
    };
}
/** JSON.parse with a byte ceiling and no duplicate-key hiding. */
function readJsonReport(source: string): unknown {
    if (Buffer.byteLength(source) > MAX_REPORT_BYTES)
        throw new EngineError(`The runner report exceeds ${MAX_REPORT_BYTES} bytes; no partial report is translated`);
    const start = source.indexOf("{");
    if (start < 0)
        throw new EngineError("The runner produced no JSON report");
    return JSON.parse(source.slice(start));
}
function translateVitest(source: string): Translation {
    const report = readJsonReport(source) as any;
    if (!report || typeof report !== "object" || !Array.isArray(report.testResults))
        throw new EngineError("Not a vitest --reporter=json report: no testResults array");
    const assertions: TranslatedAssertion[] = [];
    const errors: string[] = [];
    for (const file of report.testResults) {
        const rows = Array.isArray(file?.assertionResults) ? file.assertionResults : [];
        if (!rows.length && typeof file?.message === "string" && file.message.trim())
            errors.push(bounded(`${file?.name ?? "a test file"} produced no assertions: ${file.message}`));
        for (const row of rows) {
            const name = typeof row?.fullName === "string" && row.fullName.trim() ? row.fullName : [...(Array.isArray(row?.ancestorTitles) ? row.ancestorTitles : []), row?.title].filter(Boolean).join(" > ");
            if (!name)
                throw new EngineError("A vitest assertion carried no name, so it has no identity");
            assertions.push({ id: assertionId(`${file?.name ?? ""}::${name}`), name, status: row?.status === "passed" ? "passed" : row?.status === "failed" ? "failed" : "skipped" });
        }
    }
    return counted(assertions, errors, "vitest");
}
function translatePlaywright(source: string): Translation {
    const report = readJsonReport(source) as any;
    if (!report || typeof report !== "object" || !Array.isArray(report.suites))
        throw new EngineError("Not a playwright --reporter=json report: no suites array");
    const assertions: TranslatedAssertion[] = [];
    const errors: string[] = (Array.isArray(report.errors) ? report.errors : []).map((e: any) => bounded(typeof e?.message === "string" ? e.message : String(e))).filter(Boolean);
    const walk = (suites: any[], trail: string[]) => {
        for (const suite of Array.isArray(suites) ? suites : []) {
            const path = [...trail, suite?.title].filter(Boolean) as string[];
            for (const spec of Array.isArray(suite?.specs) ? suite.specs : []) {
                const name = [...path, spec?.title].filter(Boolean).join(" > ");
                const outcomes = (Array.isArray(spec?.tests) ? spec.tests : []).flatMap((t: any) => Array.isArray(t?.results) ? t.results.map((r: any) => r?.status) : [t?.status]);
                const last = outcomes.at(-1);
                const status = outcomes.length === 0 ? "skipped" : last === "passed" ? "passed" : last === "skipped" ? "skipped" : "failed";
                assertions.push({ id: assertionId(`${suite?.file ?? ""}::${name}`), name, status });
            }
            walk(suite?.suites, path);
        }
    };
    walk(report.suites, []);
    // The runner's own counters are a second description of the same run: disagreement is a contradiction.
    const stats = report.stats ?? {};
    // A retried flaky spec ends `passed` here, so its counters are not comparable; skip the check then.
    const declared = [stats.expected, stats.unexpected, stats.skipped].every((n: unknown) => Number.isInteger(n)) && !stats.flaky
        ? { passed: stats.expected as number, failed: stats.unexpected as number, skipped: stats.skipped as number }
        : null;
    const translation = counted(assertions, errors, "playwright");
    if (declared && (declared.passed !== translation.counts.passed || declared.skipped !== translation.counts.skipped || declared.failed !== translation.counts.failed))
        translation.errors = [...translation.errors, bounded(`The playwright report's own stats (expected ${declared.passed}, unexpected ${declared.failed}, skipped ${declared.skipped}) disagree with its ${translation.counts.total} recorded specs (${translation.counts.passed} passed, ${translation.counts.failed} failed, ${translation.counts.skipped} skipped)`)].slice(0, 32);
    return translation;
}
function translateNodeTest(source: string): Translation {
    if (Buffer.byteLength(source) > MAX_REPORT_BYTES)
        throw new EngineError(`The runner report exceeds ${MAX_REPORT_BYTES} bytes; no partial report is translated`);
    const lines = source.split("\n");
    if (!lines.some(l => /^TAP version 13\s*$/.test(l.trim())))
        throw new EngineError("Not a node:test TAP report: no `TAP version 13` line. Node's default reporter on a pipe is `spec`; declare --test-reporter=tap.");
    const assertions: TranslatedAssertion[] = [];
    const errors: string[] = [];
    const summary: Record<string, number> = {};
    const seen = new Set<string>();
    for (const raw of lines) {
        const line = raw.trim();
        const bail = /^Bail out!\s*(.*)$/.exec(line);
        if (bail)
            errors.push(bounded(`The runner bailed out: ${bail[1] || "no reason given"}`));
        const count = /^#\s+(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)$/.exec(line);
        if (count)
            summary[count[1]!] = Number(count[2]);
        const row = /^(not ok|ok)\s+(\d+)\s*-?\s*(.*)$/.exec(line);
        if (!row)
            continue;
        const directive = /#\s*(SKIP|TODO)\b/i.exec(row[3] ?? "");
        const name = (row[3] ?? "").replace(/#\s*(SKIP|TODO)\b.*$/i, "").trim() || `test ${row[2]}`;
        let id = assertionId(name);
        for (let n = 2; seen.has(id); n++)
            id = assertionId(`${name}#${n}`);
        seen.add(id);
        assertions.push({ id, name, status: directive ? "skipped" : row[1] === "ok" ? "passed" : "failed" });
    }
    const translation = counted(assertions, errors, "node-test");
    // TAP's own trailer is a second description of the same run.
    if (Number.isInteger(summary.pass) && Number.isInteger(summary.fail) && Number.isInteger(summary.skipped)) {
        const skipped = summary.skipped! + (summary.todo ?? 0);
        if (summary.pass !== translation.counts.passed || summary.fail !== translation.counts.failed || skipped !== translation.counts.skipped)
            translation.errors = [...translation.errors, bounded(`The TAP trailer (pass ${summary.pass}, fail ${summary.fail}, skipped ${skipped}) disagrees with its ${translation.counts.total} recorded results (${translation.counts.passed} passed, ${translation.counts.failed} failed, ${translation.counts.skipped} skipped)`)].slice(0, 32);
    }
    return translation;
}
export function translate(adapter: Adapter, source: string): Translation {
    switch (adapter) {
        case "vitest": return translateVitest(source);
        case "playwright": return translatePlaywright(source);
        case "node-test": return translateNodeTest(source);
        default: throw new EngineError(`Unknown assertion adapter ${adapter as string}`);
    }
}
/** The frozen report, or a refusal naming why this run cannot produce one. */
export function assertionReport(translation: Translation, requirements: string[]): AssertionReport {
    if (!requirements.length)
        throw new EngineError("A gate with no proves: binding has no requirement for its assertions to be evidence of");
    if (translation.assertions.length > MAX_ASSERTIONS)
        throw new EngineError(`The runner reported ${translation.assertions.length} assertions; this record holds ${MAX_ASSERTIONS}. Split the gate rather than recording part of a run as the whole.`);
    return validateAssertionReport({ schema_version: "wringer-check.v1", assertions: translation.assertions.map(a => ({ id: a.id, requirements: [...requirements], status: a.status })), errors: translation.errors }, requirements);
}
