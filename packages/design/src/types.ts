export type DesignDisclosure = "private" | "repository-permitted";
export interface DesignAsset {
    id: string;
    title: string;
    media_type: "image/png";
    width: number;
    height: number;
    base64: string;
    sha256: string;
}
export interface DesignSnapshotV1 {
    schema_version: "wringer.design-snapshot.v1";
    title: string;
    source: {
        provider: "owned-reference" | "figma" | "generic-mcp";
        label: string;
        endpoint: string | null;
        file_key: string | null;
        node_id: string | null;
        version: string | null;
        version_basis: "reported" | "operator-declared" | "capture-only";
    };
    captured_at: string;
    disclosure: DesignDisclosure;
    context: string;
    component_rules: string[];
    assets: DesignAsset[];
    provenance: {
        method: "owned-reference" | "mcp-read";
        calls: { tool: string; arguments_sha256: string; response_sha256: string }[];
        limits: string[];
    };
    snapshot_sha256: string;
}
/** Direct REST capture is a new contract; a REST call is never labeled MCP. */
export interface DesignSnapshotV2 extends Omit<DesignSnapshotV1, "schema_version" | "source" | "provenance"> {
    schema_version: "wringer.design-snapshot.v2";
    source: {
        provider: "figma-rest";
        label: string;
        endpoint: "https://api.figma.com";
        file_key: string;
        /** One or two canonical, sorted node identifiers, separated by a comma. */
        node_id: string;
        version: string;
        version_basis: "reported";
    };
    provenance: {
        method: "figma-rest-read";
        calls: (DesignSnapshotV1["provenance"]["calls"][number] & { request_sha256: string })[];
        limits: string[];
    };
}
export type DesignSnapshot = DesignSnapshotV1 | DesignSnapshotV2;
export type UnsealedDesignSnapshot = Omit<DesignSnapshotV1, "snapshot_sha256"> | Omit<DesignSnapshotV2, "snapshot_sha256">;
export interface DesignFigmaRestInput {
    urls: string[];
    /** Explicit secret channel, never a command argument or snapshot field. */
    token: string;
    tokenType?: "oauth" | "pat";
    disclosure: DesignDisclosure;
    title?: string;
    componentRules?: string[];
    limits?: { timeoutMs?: number; maxResponseBytes?: number };
}
export interface DesignFigmaRestRequest {
    url: string;
    method: "GET";
    headers: Record<string, string>;
    maxBytes: number;
    signal: AbortSignal;
}
export interface DesignFigmaRestResponse {
    status: number;
    headers: Record<string, string>;
    body: Uint8Array;
}
export interface DesignFigmaRestOptions {
    /** Deterministic tests only. Never accepted from CLI, MCP or configuration. */
    testTransport?: (request: DesignFigmaRestRequest) => Promise<DesignFigmaRestResponse>;
    now?: () => Date;
}
export interface DesignReferenceInput {
    title: string;
    disclosure: DesignDisclosure;
    context: string;
    componentRules?: string[];
    assets?: { id: string; title: string; pngBase64: string }[];
    source?: { provider?: "owned-reference"; label: string; version?: string | null };
}
export interface DesignMcpInput {
    provider: "figma" | "generic-mcp";
    endpoint: string;
    title?: string;
    source: { label: string; fileKey?: string; nodeId?: string; version?: string | null };
    disclosure: DesignDisclosure;
    recipe: { tool: string; arguments: Record<string, unknown> }[];
    componentRules?: string[];
    /** Explicit secret channel only. Never placed in a snapshot or command arguments. */
    token?: string;
    limits?: { timeoutMs?: number; maxCalls?: number; maxResponseBytes?: number };
}
export interface DesignHttpRequest {
    url: string;
    headers: Record<string, string>;
    body: string;
    maxBytes: number;
    signal: AbortSignal;
}
export interface DesignHttpResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
}
export interface DesignImportOptions {
    /** Deterministic tests only: bypasses DNS/network, never exposed by the CLI. */
    testTransport?: (request: DesignHttpRequest) => Promise<DesignHttpResponse>;
    now?: () => Date;
}
export class DesignError extends Error {
    constructor(message: string, readonly code = "design-refused") { super(message); this.name = "DesignError"; }
}
