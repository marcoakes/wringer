import { canonicalJson, hashValue, type ExecutionPlan } from "@wringer/plan";
import { observeAssertions, validateAssertionReport, type AssertionReport, type CheckEvidenceObservation } from "@wringer/records";
import { parseDesignJson } from "@wringer/design";
import type { CandidateVerification } from "./contained-types";

/** The shape and the rules live in `@wringer/records`, below both lanes: the
 * standalone adapters translate a runner's own JSON or TAP into the same
 * `wringer-check.v1` report and apply the same judgements. Re-exported here so
 * every existing caller of this module keeps its import. */
export type { AssertionReport, CheckEvidenceObservation } from "@wringer/records";
/** Exact source bytes, refusing duplicate keys that JSON.parse would hide. */
export function parseAssertionReport(input: string | unknown, requirements: string[]): AssertionReport {
    return validateAssertionReport(typeof input === "string" ? parseDesignJson(input, 256 * 1024) : input, requirements);
}
export function observeAssertionReport(checkId: string, stdout: string | unknown, exitCode: number | null, requirements: string[]): CheckEvidenceObservation {
    return observeAssertions(checkId, () => parseAssertionReport(stdout, requirements), exitCode, requirements);
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
