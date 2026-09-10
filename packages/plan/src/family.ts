import { LOCAL_SOURCE_URL, RUNTIME_PROVENANCE_VERSIONS } from "@wringer/runtime";

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
export const sourceFamily = (plan: { schema_version: string }): SourceFamily => plan.schema_version === "wringer.execution-plan.v4" ? "local" : "hosted";
/** Plan v3 and v4 share the measured-loop contract; v4 only names a local-only source. */
export const measuredLoopPlan = (plan: { schema_version: string }): boolean => plan.schema_version === "wringer.execution-plan.v3" || plan.schema_version === "wringer.execution-plan.v4";
export type RecordVersion<K extends RecordKind> = (typeof RECORD_FAMILIES)[K]["hosted"] | (typeof RECORD_FAMILIES)[K]["local"];
export const recordVersion = <K extends RecordKind>(plan: { schema_version: string }, kind: K): RecordVersion<K> => (RECORD_FAMILIES[kind] as { hosted: string; local: string })[sourceFamily(plan)] as RecordVersion<K>;
const refuse = (kind: RecordKind, found: unknown, family: SourceFamily) => new Error(`This ${RECORD_FAMILIES[kind].label} is ${String(found)}, but a ${family === "local" ? "local-only" : "hosted"} source's ${RECORD_FAMILIES[kind].label} is ${RECORD_FAMILIES[kind][family]}. Records from different source kinds are never mixed; nothing was accepted.`);
/** The record must be the version its plan's source kind names. */
export function assertRecordFamily(plan: { schema_version: string }, kind: RecordKind, found: unknown): void {
    if (found !== recordVersion(plan, kind)) throw refuse(kind, found, sourceFamily(plan));
}
/** Without a plan to hand, the record's own repository url decides its kind. */
export function assertRecordUrlFamily(kind: RecordKind, found: unknown, url: unknown): void {
    const family: SourceFamily = typeof url === "string" && LOCAL_SOURCE_URL.test(url) ? "local" : "hosted";
    if (found !== RECORD_FAMILIES[kind][family]) throw refuse(kind, found, family);
}
