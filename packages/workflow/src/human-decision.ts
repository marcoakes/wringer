import { hashValue, type ExecutionAuthority } from "@wringer/plan";
import type { CandidateHumanDecision } from "./contained-types";

/** Cooperative-local attribution to the retained approval, not proof of identity.
 * Historical noted observations keep their historical interpretation. */
export function validContainedHumanAttribution(value: unknown, authority: ExecutionAuthority): boolean {
    const row = value as Partial<CandidateHumanDecision> | null;
    if (!row || typeof row.by !== "string" || !row.by.trim()) return false;
    if (row.schema_version === undefined) return typeof row.note === "string";
    return row.schema_version === "wringer.contained-human-decision.v1"
        && Object.keys(row).every(key => ["schema_version", "criterionId", "candidateTree", "acceptanceSha256", "verdict", "by", "note", "displayId", "display", "attribution", "authoritySha256"].includes(key))
        && row.attribution === "initial-execution-approval" && row.by === authority.actor && row.authoritySha256 === hashValue(authority)
        && row.by.length <= 200 && typeof row.criterionId === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,180}$/.test(row.criterionId)
        && typeof row.candidateTree === "string" && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(row.candidateTree)
        && typeof row.acceptanceSha256 === "string" && /^[a-f0-9]{64}$/.test(row.acceptanceSha256)
        && (row.verdict === "met" || row.verdict === "not_met") && !!row.display && Object.keys(row.display).length === 3
        && row.display.status === "shown" && row.display.candidateTree === row.candidateTree && typeof row.display.receiptSha256 === "string" && /^[a-f0-9]{64}$/.test(row.display.receiptSha256)
        && typeof row.displayId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(row.displayId)
        && (row.note === null || typeof row.note === "string" && !!row.note.trim() && !row.note.includes("\0") && Buffer.byteLength(row.note) <= 16384);
}
