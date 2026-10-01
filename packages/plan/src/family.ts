import { LOCAL_SOURCE_URL, RUNTIME_PROVENANCE_VERSIONS, TRUSTED_LOCAL_PROVENANCE } from "@wringer/runtime";

/** One version per source kind (ruled 2026-09-10). A local-only plan (v4) and
 * every record about its repository use the local siblings; a hosted plan keeps
 * the originals, byte for byte. The two are never mixed. */
export const RECORD_FAMILIES = {
    authority: { label: "execution authority", hosted: "wringer.execution-authority.v1", local: "wringer.execution-authority.v2" },
    environment: { label: "environment map", hosted: "wringer.environment-map.v1", local: "wringer.environment-map.v2" },
    runtime: { label: "runtime provenance", ...RUNTIME_PROVENANCE_VERSIONS },
    playbook: { label: "playbook snapshot", hosted: "wringer.playbook-snapshot.v1", local: "wringer.playbook-snapshot.v2" },
} as const;
export type RecordKind = keyof typeof RECORD_FAMILIES;
export type SourceFamily = "hosted" | "local";
/** Plan v4 is local-only; a v5 trusted-local plan takes its kind from its source. */
export const sourceFamily = (plan: { schema_version: string; repository?: { url: string } }): SourceFamily => plan.schema_version === "wringer.execution-plan.v4" || plan.schema_version === "wringer.execution-plan.v5" && LOCAL_SOURCE_URL.test(plan.repository?.url ?? "") ? "local" : "hosted";
/** Plan v3, v4 and v5 share the measured-loop contract; v4 names a local-only source and v5 a trusted-local runtime. */
export const measuredLoopPlan = (plan: { schema_version: string }): boolean => plan.schema_version === "wringer.execution-plan.v3" || plan.schema_version === "wringer.execution-plan.v4" || plan.schema_version === "wringer.execution-plan.v5";
/** A trusted-local plan: ran on this computer, nothing contained. */
export const trustedLocalPlan = (plan: { runtime?: { kind: string } }): boolean => plan.runtime?.kind === "trusted-local";
/** Records whose content names a runtime have their own trusted-local sibling, whatever the source. */
export const TRUSTED_LOCAL_RECORDS = { runtime: TRUSTED_LOCAL_PROVENANCE, environment: "wringer.environment-map.v3" } as const;
type TrustedLocalRecord<K extends RecordKind> = K extends keyof typeof TRUSTED_LOCAL_RECORDS ? (typeof TRUSTED_LOCAL_RECORDS)[K] : never;
export type RecordVersion<K extends RecordKind> = (typeof RECORD_FAMILIES)[K]["hosted"] | (typeof RECORD_FAMILIES)[K]["local"] | TrustedLocalRecord<K>;
type FamilyPlan = { schema_version: string; repository?: { url: string }; runtime?: { kind: string } };
/** The version a record must carry. A trusted-local plan's runtime and environment records are its own siblings. */
export const recordVersion = <K extends RecordKind>(plan: FamilyPlan, kind: K): RecordVersion<K> => (trustedLocalPlan(plan) && kind in TRUSTED_LOCAL_RECORDS ? TRUSTED_LOCAL_RECORDS[kind as keyof typeof TRUSTED_LOCAL_RECORDS] : (RECORD_FAMILIES[kind] as { hosted: string; local: string })[sourceFamily(plan)]) as RecordVersion<K>;
const refuse = (kind: RecordKind, found: unknown, family: SourceFamily) => new Error(`This ${RECORD_FAMILIES[kind].label} is ${String(found)}, but a ${family === "local" ? "local-only" : "hosted"} source's ${RECORD_FAMILIES[kind].label} is ${RECORD_FAMILIES[kind][family]}. Records from different source kinds are never mixed; nothing was accepted.`);
/** The record must be the version its plan's source kind names. */
export function assertRecordFamily(plan: FamilyPlan, kind: RecordKind, found: unknown): void {
    if (found !== recordVersion(plan, kind)) {
        if (kind in TRUSTED_LOCAL_RECORDS && (trustedLocalPlan(plan) || found === TRUSTED_LOCAL_RECORDS[kind as keyof typeof TRUSTED_LOCAL_RECORDS])) throw new Error(`This ${RECORD_FAMILIES[kind].label} is ${String(found)}, but a ${trustedLocalPlan(plan) ? "trusted-local" : "contained"} plan's ${RECORD_FAMILIES[kind].label} is ${recordVersion(plan, kind)}. A trusted-local run is never recorded as contained, nor a contained one as trusted-local; nothing was accepted.`);
        throw refuse(kind, found, sourceFamily(plan));
    }
}
/** Without a plan to hand, the record's own repository url decides its kind. */
export function assertRecordUrlFamily(kind: RecordKind, found: unknown, url: unknown): void {
    // A trusted-local sibling serves both source kinds; its plan-bound check decides the pairing.
    if (kind in TRUSTED_LOCAL_RECORDS && found === TRUSTED_LOCAL_RECORDS[kind as keyof typeof TRUSTED_LOCAL_RECORDS]) return;
    const family: SourceFamily = typeof url === "string" && LOCAL_SOURCE_URL.test(url) ? "local" : "hosted";
    if (found !== RECORD_FAMILIES[kind][family]) throw refuse(kind, found, family);
}
