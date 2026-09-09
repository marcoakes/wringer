import { canonicalJson, hashValue, type ExecutionPlan } from "@wringer/plan";
import { parseDesignJson } from "@wringer/design";
import type { CandidateVerification } from "./contained-types";

/** A protected runner's structured report, not a worker narrative or a proof of test sufficiency. */
export interface AssertionReport {
    schema_version: "wringer-check.v1";
    assertions: { id: string; requirements: string[]; status: "passed" | "failed" | "skipped" }[];
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
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(v);
export function parseAssertionReport(input: string | unknown, requirements: string[]): AssertionReport {
    const value = typeof input === "string" ? parseDesignJson(input, 256 * 1024) : input;
    if (!object(value) || !exact(value, ["schema_version", "assertions", "errors"]) || value.schema_version !== "wringer-check.v1" || !Array.isArray(value.assertions) || value.assertions.length > 1024 || !Array.isArray(value.errors) || value.errors.length > 32 || value.errors.some(e => typeof e !== "string" || !e.trim() || e.length > 2000)) throw new Error("Malformed bounded assertion report");
    const seen = new Set<string>();
    for (const row of value.assertions) {
        if (!object(row) || !exact(row, ["id", "requirements", "status"]) || !id(row.id) || seen.has(row.id) || !["passed", "failed", "skipped"].includes(row.status as string) || !Array.isArray(row.requirements) || !row.requirements.length || row.requirements.length > 128 || new Set(row.requirements).size !== row.requirements.length || row.requirements.some(r => typeof r !== "string" || !requirements.includes(r))) throw new Error("Assertion identity, requirement mapping or outcome is invalid");
        seen.add(row.id);
    }
    if (Buffer.byteLength(canonicalJson(value)) > 256 * 1024) throw new Error("Assertion report exceeds its byte limit");
    return value as unknown as AssertionReport;
}
export function observeAssertionReport(checkId: string, stdout: string, exitCode: number | null, requirements: string[]): CheckEvidenceObservation {
    let report: AssertionReport | null = null;
    let reason = "Executed requirement assertions were reported by the pinned check runner; test honesty and sufficiency are not established.";
    let status: CheckEvidenceObservation["status"] = "established";
    try {
        report = parseAssertionReport(stdout, requirements);
        if (report.errors.length) throw new Error("The check runner reported an execution error, not assertion evidence");
        if (!report.assertions.some(a => a.status !== "skipped")) throw new Error("An empty or all-skipped suite is not established");
        if (requirements.some(r => !report!.assertions.some(a => a.requirements.includes(r)))) throw new Error("The check report omitted a declared requirement");
        const failed = report.assertions.some(a => a.status === "failed");
        if (!failed && report.assertions.some(a => a.status === "skipped")) throw new Error("Skipped assertions cannot establish a green requirement");
        if (exitCode === null || (failed ? exitCode !== 1 : exitCode !== 0)) throw new Error("The assertion report contradicts the observed process exit");
    } catch (error) { status = "unavailable"; reason = error instanceof Error ? error.message : "Assertion evidence is unavailable"; }
    return { schema_version: "wringer.check-observation.v1", checkId, kind: "assertions", format: "wringer-check.v1", status, reportSha256: report ? hashValue(report) : null, report, reason };
}
/** Recompute derived status from the carried protected-runner report; never trust a status label. */
export function validateCheckEvidence(plan: ExecutionPlan, verification: CandidateVerification): void {
    const strict = plan.acceptance.checks.filter(c => c.evidence?.kind === "assertions");
    const rows = verification.checkEvidence ?? [];
    if (rows.length !== strict.length || new Set(rows.map(r => r.checkId)).size !== rows.length) throw new Error("Verification omitted or duplicated declared assertion evidence");
    for (const check of strict) {
        const row = rows.find(r => r.checkId === check.id), result = verification.checks.find(r => r.id === check.id);
        if (!row || !result || row.schema_version !== "wringer.check-observation.v1" || row.kind !== "assertions" || row.format !== "wringer-check.v1" || !["established", "unavailable"].includes(row.status) || typeof row.reason !== "string" || row.reason.length > 4000 || row.reportSha256 !== (row.report ? hashValue(parseAssertionReport(row.report, check.criteria)) : null)) throw new Error("Structured check evidence identity or report digest changed");
        if (row.status === "established") {
            const checked = observeAssertionReport(check.id, canonicalJson(row.report), result.exitCode, check.criteria);
            if (checked.status !== "established" || result.status === "unavailable") throw new Error("Established assertion evidence contradicts the protected runner result");
        } else if (result.status !== "unavailable") throw new Error("Unavailable assertion evidence cannot establish a failed or passed requirement");
    }
}
export function assertAssertionRed(plan: ExecutionPlan, verification: CandidateVerification): void {
    validateCheckEvidence(plan, verification);
    for (const check of plan.acceptance.checks.filter(c => c.evidence?.kind === "assertions")) {
        const evidence = verification.checkEvidence!.find(r => r.checkId === check.id)!;
        if (evidence.status !== "established" || check.criteria.filter(id => plan.acceptance.criteria.find(c => c.id === id)?.required).some(id => !evidence.report!.assertions.some(a => a.requirements.includes(id) && a.status === "failed"))) throw new Error(`Check ${check.id} has not executed a failing assertion for every required linked requirement`);
    }
}
/** The complete discovered assertion set and mapping stay fixed, not just the suite's exit code. */
export function assertAssertionPair(plan: ExecutionPlan, baseline: CandidateVerification, candidate: CandidateVerification): void {
    validateCheckEvidence(plan, candidate);
    for (const check of plan.acceptance.checks.filter(c => c.evidence?.kind === "assertions")) {
        const red = baseline.checkEvidence?.find(r => r.checkId === check.id), green = candidate.checkEvidence?.find(r => r.checkId === check.id);
        if (green?.status !== "established") continue; // unavailable observations stop the journey normally
        const identities = (report: AssertionReport) => report.assertions.map(a => ({ id: a.id, requirements: [...a.requirements].sort() })).sort((a, b) => a.id.localeCompare(b.id));
        if (red?.status !== "established" || !red.report || !green.report || canonicalJson(identities(red.report)) !== canonicalJson(identities(green.report))) throw new Error(`Check ${check.id} changed its original assertion identities or requirement mappings; missing assertions cannot become green`);
        if (candidate.checks.find(r => r.id === check.id)?.status === "passed" && green.report.assertions.some(a => a.status !== "passed")) throw new Error(`Check ${check.id} did not execute every original assertion successfully`);
    }
}
