export function inspectBundle(path: string): Promise<{
    schema_version: string; integrity: "passed"; semanticAudit: "not-run";
    deliveryId: string; source: { commit: string; tree: string }; bundleFamily: string;
    files: number; decisions: unknown[]; summary: string; limits: string[];
}>;
export function inspectGraph(path: string): Promise<{
    schema_version: string; integrity: "passed"; semanticAudit: "not-run";
    graph: { id: string; sha256: string }; revision: string; events: number; finished: "done" | "fail" | null;
    nodes: { id: string; kind: string; outcome: string | null; candidate: string | null; evidence: string | null; delivery: string | null }[];
    omissions: { what: string; reason: string }[]; limits: string[];
}>;
