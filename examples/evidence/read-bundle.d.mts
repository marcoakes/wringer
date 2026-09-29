export function inspectBundle(path: string): Promise<{
    schema_version: string; integrity: "passed"; semanticAudit: "not-run";
    deliveryId: string; source: { commit: string; tree: string }; bundleFamily: string;
    files: number; decisions: unknown[]; summary: string; limits: string[];
}>;
