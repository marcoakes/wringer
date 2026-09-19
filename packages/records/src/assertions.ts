/**
 * `wringer-check.v1` and the rules that read it — one implementation, both lanes.
 *
 * The contained lane has had a structured assertion contract since alpha.9: a
 * protected runner emits `wringer-check.v1` and these rules decide whether it
 * establishes anything. The standalone lane had nothing, so a gate's whole
 * testimony was its exit code, and on 19 September 2026 an entirely skipped
 * suite and a browser that never started were both indistinguishable from a
 * deliberate product result.
 *
 * Zen report §5 called that an integration opportunity, not a second protocol.
 * So the rules live here, below both lanes, and the standalone adapters
 * translate a runner's own JSON or TAP into this same shape rather than
 * inventing one. Nothing in this file reads a log line: every judgement rests
 * on the report, the executed-assertion identities and the observed exit code.
 */
import { canonicalJson, hashValue } from "./canonical";
export interface AssertionReport {
    schema_version: "wringer-check.v1";
    assertions: {
        id: string;
        requirements: string[];
        status: "passed" | "failed" | "skipped";
    }[];
    errors: string[];
}
export interface CheckEvidenceObservation {
    schema_version: "wringer.check-observation.v1";
    checkId: string;
    kind: "assertions";
    format: "wringer-check.v1";
    status: "established" | "unavailable";
    reportSha256: string | null;
    report: AssertionReport | null;
    reason: string;
}
export const ASSERTION_ESTABLISHED = "Executed requirement assertions were reported by the pinned check runner; test honesty and sufficiency are not established.";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(v);
/** The frozen shape, checked field by field. Requirement ids must be declared ones. */
export function validateAssertionReport(value: unknown, requirements: string[]): AssertionReport {
    if (!object(value) || !exact(value, ["schema_version", "assertions", "errors"]) || value.schema_version !== "wringer-check.v1" || !Array.isArray(value.assertions) || value.assertions.length > 1024 || !Array.isArray(value.errors) || value.errors.length > 32 || value.errors.some(e => typeof e !== "string" || !e.trim() || e.length > 2000))
        throw new Error("Malformed bounded assertion report");
    const seen = new Set<string>();
    for (const row of value.assertions) {
        if (!object(row) || !exact(row, ["id", "requirements", "status"]) || !id(row.id) || seen.has(row.id) || !["passed", "failed", "skipped"].includes(row.status as string) || !Array.isArray(row.requirements) || !row.requirements.length || row.requirements.length > 128 || new Set(row.requirements).size !== row.requirements.length || row.requirements.some(r => typeof r !== "string" || !requirements.includes(r)))
            throw new Error("Assertion identity, requirement mapping or outcome is invalid");
        seen.add(row.id);
    }
    if (Buffer.byteLength(canonicalJson(value)) > 256 * 1024)
        throw new Error("Assertion report exceeds its byte limit");
    return value as unknown as AssertionReport;
}
/**
 * The rules, applied to one already-parsed report. `produce` may throw: a runner
 * whose output cannot be read is `unavailable`, which is a different fact from a
 * product assertion that failed.
 */
export function observeAssertions(checkId: string, produce: () => AssertionReport, exitCode: number | null, requirements: string[]): CheckEvidenceObservation {
    let report: AssertionReport | null = null;
    let reason = ASSERTION_ESTABLISHED;
    let status: CheckEvidenceObservation["status"] = "established";
    try {
        report = produce();
        if (report.errors.length)
            throw new Error("The check runner reported an execution error, not assertion evidence");
        if (!report.assertions.some(a => a.status !== "skipped"))
            throw new Error("An empty or all-skipped suite is not established");
        if (requirements.some(r => !report!.assertions.some(a => a.requirements.includes(r))))
            throw new Error("The check report omitted a declared requirement");
        const failed = report.assertions.some(a => a.status === "failed");
        if (!failed && report.assertions.some(a => a.status === "skipped"))
            throw new Error("Skipped assertions cannot establish a green requirement");
        if (exitCode === null || (failed ? exitCode !== 1 : exitCode !== 0))
            throw new Error("The assertion report contradicts the observed process exit");
    }
    catch (error) {
        status = "unavailable";
        reason = error instanceof Error ? error.message : "Assertion evidence is unavailable";
    }
    return { schema_version: "wringer.check-observation.v1", checkId, kind: "assertions", format: "wringer-check.v1", status, reportSha256: report ? hashValue(report) : null, report, reason };
}
