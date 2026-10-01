import { fileURLToPath } from "node:url";
import { openReader } from "@wringer/records";

// Sibling adoption records have their own published shapes. Existing controller
// records retain their established readers; do not reinterpret historical data.
const versions = new Map([
    ["wringer.verification-operation.v2", "verification-operation-v2.schema.json"],
    ["wringer.verification-recovery-preview.v1", "verification-recovery-preview-v1.schema.json"],
    ["wringer.verification-recovery-result.v1", "verification-recovery-result-v1.schema.json"],

    ["wringer.verification-send-recovery-preview.v1", "verification-send-recovery-preview-v1.schema.json"],
    ["wringer.verification-send-recovery-decision.v1", "verification-send-recovery-decision-v1.schema.json"],
    ["wringer.verification-publication.v2", "verification-publication-v2.schema.json"],
    ["wringer.audited-verification-publication.v1", "audited-verification-publication-v1.schema.json"],

    ["wringer.storage-use.v1", "storage-use-v1.schema.json"],
    ["wringer.preparation-archive-preview.v1", "preparation-archive-preview-v1.schema.json"],
    ["wringer.preparation-archive-request.v1", "preparation-archive-request-v1.schema.json"],
    ["wringer.preparation-archive-result.v1", "preparation-archive-result-v1.schema.json"],
    ["wringer.archive-removal-preview.v1", "archive-removal-preview-v1.schema.json"],
    ["wringer.archive-removal-decision.v1", "archive-removal-decision-v1.schema.json"],
    ["wringer.archive-removal-result.v1", "archive-removal-result-v1.schema.json"],

    ["wringer.lock-recovery-preview.v1", "lock-recovery-preview-v1.schema.json"],
    ["wringer.lock-recovery-request.v1", "lock-recovery-request-v1.schema.json"],
    ["wringer.lock-recovery-result.v1", "lock-recovery-result-v1.schema.json"],
    ["wringer.delegation-recovery-preview.v1", "delegation-recovery-preview-v1.schema.json"],
    ["wringer.delegation-recovery-decision.v1", "delegation-recovery-decision-v1.schema.json"],
    ["wringer.delegation-recovery-result.v1", "delegation-recovery-result-v1.schema.json"],

    ["wringer.diagnostic-report.v1", "diagnostic-report-v1.schema.json"],
    ["wringer.diagnostic-manifest.v1", "diagnostic-manifest-v1.schema.json"],
    ["wringer.diagnostic-preview.v1", "diagnostic-preview-v1.schema.json"],
    ["wringer.acceptance-input.v1", "acceptance-input-v1.schema.json"],
    ["wringer.acceptance-preview.v1", "acceptance-preview-v1.schema.json"],
    ["wringer.acceptance-prepared.v1", "acceptance-prepared-v1.schema.json"],
    ["wringer.authored-proposal.v1", "authored-proposal-v1.schema.json"],
    ["wringer.proposal-lineage.v1", "proposal-lineage-v1.schema.json"],
    ["wringer.proposal-supersession.v1", "proposal-supersession-v1.schema.json"],
    ["wringer.proposal-supersession.v2", "proposal-supersession-v2.schema.json"],
    ["wringer.proposal-destination-policy.v1", "proposal-destination-policy-v1.schema.json"],
    ["wringer.delegation-context.v1", "delegation-context-v1.schema.json"],
    ["wringer.delegation-job.v1", "delegation-job-v1.schema.json"],
    ["wringer.workspace.v2", "workspace-v2.schema.json"],
    ["wringer.workspace-recovery-preview.v1", "workspace-recovery-preview-v1.schema.json"],
    ["wringer.workspace-recovery-request.v1", "workspace-recovery-request-v1.schema.json"],
    ["wringer.workspace-recovery-result.v1", "workspace-recovery-result-v1.schema.json"],
    ["wringer.verification-job.v1", "verification-job-v1.schema.json"],
    ["wringer.verification-creation.v1", "verification-creation-v1.schema.json"],
    ["wringer.verification-grant.v1", "verification-grant-v1.schema.json"],
    ["wringer.verification-decision.v1", "verification-decision-v1.schema.json"],
]);
const reader = openReader(fileURLToPath(new URL("../../../schema", import.meta.url)));
export async function validateAdoptionRecord(value: object) {
    const version = (value as Record<string, unknown>).schema_version;
    const schema = typeof version === "string" ? versions.get(version) : undefined;
    if (!schema) return;
    const result = await (await reader).validate(value, schema);
    if (!result.ok) throw new Error(`Invalid adoption record shape (${version}): ${result.said}`);
}
