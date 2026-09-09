import { createHash } from "node:crypto";
import { open, lstat } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { constants } from "node:fs";
import { isIP } from "node:net";
import { DesignError, type DesignAsset, type DesignSnapshot, type DesignSnapshotV1, type DesignSnapshotV2, type UnsealedDesignSnapshot, type DesignReferenceInput } from "./types";

export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024, MAX_DESIGN_ASSET_BYTES = 8 * 1024 * 1024, MAX_CONTEXT_BYTES = 2 * 1024 * 1024;
export const hashDesignBytes = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function designCanonicalJson(value: unknown): string {
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(designCanonicalJson).join(",")}]`;
    if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${designCanonicalJson((value as any)[k])}`).join(",")}}`;
    throw new DesignError("Design records contain only finite JSON data.");
}
export const hashDesignSnapshot = (value: UnsealedDesignSnapshot | DesignSnapshot) => {
    const { snapshot_sha256: _ignored, ...body } = value as DesignSnapshot;
    return hashDesignBytes(designCanonicalJson(body));
};
function object(value: unknown, label: string, keys: string[]): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(k => !keys.includes(k))) throw new DesignError(`Malformed ${label}; unknown fields are not ignored.`);
    return value as Record<string, any>;
}
const string = (v: unknown, label: string, max = 4096, empty = false): string => {
    if (typeof v !== "string" || (!empty && !v.trim()) || Buffer.byteLength(v) > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) throw new DesignError(`Invalid or oversized ${label}.`);
    return v;
};
const optional = (v: unknown, label: string) => v === null ? null : string(v, label);
const digest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function assertNoDesignSecrets(value: unknown, known: string[] = []) {
    const visit = (v: unknown): void => {
        if (typeof v === "string") {
            if (known.some(k => k.length > 0 && v.includes(k)) || /(?:\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(v)) throw new DesignError("Design input contains a detected credential; no snapshot was retained.", "design-secret-detected");
        } else if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === "object") for (const [k, item] of Object.entries(v)) { visit(k); visit(item); }
    };
    visit(value);
}
function crc32(bytes: Uint8Array) {
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
}
/** A deliberately narrow PNG subset: no SVG, animation, scripts, EXIF or textual metadata. */
export function designPngAsset(input: { id: string; title: string; pngBase64: string }): DesignAsset {
    const id = string(input.id, "asset id", 80), title = string(input.title, "asset title", 500);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new DesignError("Asset ids must be safe exact identifiers.");
    if (typeof input.pngBase64 !== "string" || input.pngBase64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || input.pngBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.pngBase64)) throw new DesignError("Design images must be bounded canonical base64 PNG bytes.");
    const bytes = Buffer.from(input.pngBase64, "base64");
    if (bytes.toString("base64") !== input.pngBase64 || bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new DesignError("Design image is not a supported PNG.");
    let cursor = 8, width = 0, height = 0, channels = 0, color = 0, paletteEntries = 0, ended = false, sawData = false, endedData = false;
    const compressed: Buffer[] = [], counts = new Map<string, number>();
    while (cursor < bytes.length) {
        if (cursor + 12 > bytes.length) throw new DesignError("Truncated PNG chunk.");
        const length = bytes.readUInt32BE(cursor), type = bytes.toString("ascii", cursor + 4, cursor + 8), end = cursor + 12 + length;
        if (end > bytes.length || !["IHDR", "PLTE", "tRNS", "IDAT", "IEND", "sRGB", "gAMA", "cHRM", "pHYs"].includes(type)) throw new DesignError("Unsupported PNG chunk or metadata; export a static PNG without embedded metadata.");
        if (crc32(bytes.subarray(cursor + 4, cursor + 8 + length)) !== bytes.readUInt32BE(cursor + 8 + length)) throw new DesignError("PNG integrity check failed.");
        counts.set(type, (counts.get(type) ?? 0) + 1);
        if ((type !== "IDAT" && counts.get(type)! > 1) || (cursor === 8) !== (type === "IHDR") || ended || sawData && type !== "IDAT" && type !== "IEND") throw new DesignError("Invalid PNG chunk ordering.");
        if (type === "IHDR") {
            if (length !== 13) throw new DesignError("Invalid PNG header.");
            width = bytes.readUInt32BE(cursor + 8); height = bytes.readUInt32BE(cursor + 12);
            const bit = bytes[cursor + 16]; color = bytes[cursor + 17]!;
            channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color!] ?? 0;
            if (!width || !height || width > 4096 || height > 4096 || width * height > 8_000_000 || bit !== 8 || !channels || bytes[cursor + 18] !== 0 || bytes[cursor + 19] !== 0 || bytes[cursor + 20] !== 0) throw new DesignError("PNG must be a bounded, non-interlaced 8-bit image.");
        } else if (type === "PLTE") { if (!length || length > 768 || length % 3 || color === 0 || color === 4) throw new DesignError("Invalid PNG palette."); paletteEntries = length / 3; }
        else if (type === "tRNS") { if (!(color === 0 && length === 2 || color === 2 && length === 6 || color === 3 && paletteEntries && length >= 1 && length <= paletteEntries)) throw new DesignError("Invalid PNG transparency."); }
        else if (type === "sRGB" && (length !== 1 || bytes[cursor + 8]! > 3) || type === "gAMA" && (length !== 4 || bytes.readUInt32BE(cursor + 8) === 0) || type === "cHRM" && length !== 32 || type === "pHYs" && (length !== 9 || bytes[cursor + 16]! > 1)) throw new DesignError("Invalid PNG color or resolution metadata.");
        else if (type === "IDAT") { if (endedData || color === 3 && !paletteEntries) throw new DesignError("PNG image data is not contiguous or lacks its palette."); sawData = true; compressed.push(bytes.subarray(cursor + 8, cursor + 8 + length)); }
        else if (type === "IEND") { if (length !== 0 || !sawData) throw new DesignError("Invalid PNG end."); ended = true; }
        else if (sawData) endedData = true;
        cursor = end;
    }
    if (!ended) throw new DesignError("PNG has no end chunk.");
    const expected = (1 + width * channels) * height;
    let decoded: Buffer;
    try { decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected + 1 }); } catch { throw new DesignError("PNG compressed image data is invalid or oversized."); }
    if (decoded.length !== expected) throw new DesignError("PNG image data does not match its dimensions.");
    for (let row = 0; row < height; row++) if (decoded[row * (1 + width * channels)]! > 4) throw new DesignError("PNG row uses an invalid filter.");
    return { id, title, media_type: "image/png", width, height, base64: input.pngBase64, sha256: hashDesignBytes(bytes) };
}
export const validatePngAsset = designPngAsset;
export function inspectPng(base64: string) {
    const asset = designPngAsset({ id: "image", title: "PNG inspection", pngBase64: base64 });
    return { width: asset.width, height: asset.height, sha256: asset.sha256, bytes: Buffer.from(base64, "base64").length };
}
export function validateDesignSnapshot(input: unknown): DesignSnapshot {
    const v = object(input, "design snapshot", ["schema_version","title","source","captured_at","disclosure","context","component_rules","assets","provenance","snapshot_sha256"]);
    const rest = v.schema_version === "wringer.design-snapshot.v2";
    if (!rest && v.schema_version !== "wringer.design-snapshot.v1" || !["private", "repository-permitted"].includes(v.disclosure)) throw new DesignError("Unsupported design snapshot or missing explicit disclosure.");
    string(v.title, "design title", 500); string(v.context, "design context", MAX_CONTEXT_BYTES, true);
    if (typeof v.captured_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.captured_at) || !Number.isFinite(Date.parse(v.captured_at)) || new Date(v.captured_at).toISOString() !== v.captured_at) throw new DesignError("Design capture requires an explicit UTC timestamp.");
    const s = object(v.source, "design source", ["provider","label","endpoint","file_key","node_id","version","version_basis"]);
    if (!(rest ? ["figma-rest"] : ["owned-reference","figma","generic-mcp"]).includes(s.provider) || !["reported","operator-declared","capture-only"].includes(s.version_basis)) throw new DesignError("Unknown design source identity.");
    string(s.label, "source label", 500); optional(s.endpoint, "source endpoint"); optional(s.file_key, "file key"); optional(s.node_id, "node id"); optional(s.version, "source version");
    if ((s.version === null) !== (s.version_basis === "capture-only")) throw new DesignError("Missing versions must be labeled capture-only, not a pinned remote version.");
    if (s.provider === "owned-reference" && (s.endpoint !== null || s.file_key !== null || s.node_id !== null)) throw new DesignError("Owned references cannot claim a remote import identity.");
    if (s.provider !== "owned-reference" && s.endpoint === null || s.provider === "figma" && (!s.file_key || !s.node_id || s.endpoint !== "https://mcp.figma.com/mcp")) throw new DesignError("Remote design source identity is incomplete.");
    if (s.endpoint !== null) {
        let u: URL; try { u = new URL(s.endpoint); } catch { throw new DesignError("Retained design endpoint is invalid."); }
        if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.port && u.port !== "443" || isIP(u.hostname) || !u.hostname.includes(".") || u.hostname.endsWith(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(u.hostname) || !/^[a-z0-9.-]+$/.test(u.hostname)) throw new DesignError("Retained design endpoint must be a credential-free public HTTPS identity.");
    }
    if (!Array.isArray(v.component_rules) || v.component_rules.length > 100) throw new DesignError("Design component rules must be a bounded list.");
    v.component_rules.forEach((r: unknown) => string(r, "component rule", 8192));
    if (!Array.isArray(v.assets) || v.assets.length > 8) throw new DesignError("A design snapshot accepts at most eight PNG assets.");
    const seen = new Set<string>(); let imageBytes = 0;
    for (const raw of v.assets) {
        const a = object(raw, "design image", ["id","title","media_type","width","height","base64","sha256"]), decoded = designPngAsset({ id: a.id, title: a.title, pngBase64: a.base64 });
        if (seen.has(a.id) || a.media_type !== "image/png" || a.width !== decoded.width || a.height !== decoded.height || a.sha256 !== decoded.sha256) throw new DesignError("Design image identity, size or digest is inconsistent.");
        imageBytes += Buffer.from(a.base64, "base64").length;
        if (imageBytes > MAX_DESIGN_ASSET_BYTES) throw new DesignError("Design reference images exceed their aggregate byte ceiling.");
        seen.add(a.id);
    }
    if (!v.context.trim() && !v.assets.length) throw new DesignError("A design snapshot must contain observed context or an actual PNG reference.");
    const p = object(v.provenance, "design provenance", ["method","calls","limits"]);
    if (p.method !== (rest ? "figma-rest-read" : s.provider === "owned-reference" ? "owned-reference" : "mcp-read") || !Array.isArray(p.calls) || p.calls.length > 12 || !Array.isArray(p.limits) || p.limits.length < 1 || p.limits.length > 20) throw new DesignError("Invalid design import provenance.");
    p.limits.forEach((x: unknown) => string(x, "design limitation", 2000));
    if ((s.provider === "owned-reference") !== (p.calls.length === 0)) throw new DesignError("MCP snapshots need measured calls; owned references cannot claim MCP calls.");
    for (const raw of p.calls) { const c = object(raw, "design call receipt", ["tool","arguments_sha256","response_sha256", ...(rest ? ["request_sha256"] : [])]); string(c.tool, "tool name", 120); if (!digest(c.arguments_sha256) || !digest(c.response_sha256) || rest && !digest(c.request_sha256)) throw new DesignError("Design call receipts require digests."); }
    if (rest) validateFigmaRestBinding(v as DesignSnapshotV2);
    if (!digest(v.snapshot_sha256) || v.snapshot_sha256 !== hashDesignSnapshot(v as DesignSnapshot)) throw new DesignError("Design snapshot digest does not match its retained contents.", "design-digest-mismatch");
    if (Buffer.byteLength(designCanonicalJson(v)) > MAX_SNAPSHOT_BYTES) throw new DesignError("Design snapshot exceeds its byte ceiling.");
    assertNoDesignSecrets(v);
    return v as DesignSnapshot;
}
export function sealDesignSnapshot(input: Omit<DesignSnapshotV1, "snapshot_sha256">): DesignSnapshotV1;
export function sealDesignSnapshot(input: Omit<DesignSnapshotV2, "snapshot_sha256">): DesignSnapshotV2;
export function sealDesignSnapshot(input: UnsealedDesignSnapshot): DesignSnapshot;
export function sealDesignSnapshot(input: UnsealedDesignSnapshot): DesignSnapshot { return validateDesignSnapshot({ ...input, snapshot_sha256: hashDesignSnapshot(input) }); }

/** Stable request arguments can be audited without retaining ephemeral download URLs. */
export function figmaRestReceiptArguments(fileKey: string, nodeIds: string[], version: string) {
    return [
        { tool: "GET /v1/files/:key/nodes", arguments: { file_key: fileKey, node_ids: nodeIds, version: null } },
        { tool: "GET /v1/images/:key", arguments: { file_key: fileKey, node_ids: nodeIds, version, format: "png", scale: 1 } },
        ...nodeIds.map(nodeId => ({ tool: "GET Figma render PNG", arguments: { file_key: fileKey, node_id: nodeId, version } }))
    ];
}
function validateFigmaRestBinding(value: DesignSnapshotV2) {
    const source = value.source, ids = typeof source.node_id === "string" ? source.node_id.split(",") : [];
    if (source.endpoint !== "https://api.figma.com" || typeof source.file_key !== "string" || !/^[A-Za-z0-9]{1,128}$/.test(source.file_key) || !ids.length || ids.length > 2 || ids.some(id => !/^(?:0|[1-9]\d{0,19}):(?:0|[1-9]\d{0,19})$/.test(id)) || [...new Set(ids)].sort().join(",") !== source.node_id || source.version_basis !== "reported" || typeof source.version !== "string" || !/^[A-Za-z0-9._-]{1,200}$/.test(source.version)) throw new DesignError("REST design source must pin one or two canonical nodes and a reported version at the exact Figma API.", "design-source-mismatch");
    const context = object(parseDesignJson(value.context, MAX_CONTEXT_BYTES), "selected Figma context", ["format","file_key","version","nodes"]);
    if (context.format !== "figma-rest-selected-nodes-v1" || context.file_key !== source.file_key || context.version !== source.version || !context.nodes || typeof context.nodes !== "object" || Array.isArray(context.nodes) || Object.keys(context.nodes).sort().join(",") !== source.node_id) throw new DesignError("Retained Figma context does not match the approved file, nodes and version.", "design-source-mismatch");
    for (const id of ids) {
        const node = object(context.nodes[id], "selected Figma node", ["document","components","componentSets","styles"]);
        if (!node.document || typeof node.document !== "object" || Array.isArray(node.document) || node.document.id !== id || typeof node.document.type !== "string" || ["DOCUMENT","CANVAS"].includes(node.document.type)) throw new DesignError("Figma references must be selected frame/layer nodes, not an entire file or page.", "design-source-mismatch");
    }
    // Query-bearing links and Figma credential formats are never portable reference data.
    if (/https?:\/\/[^\s"<>]*[?#]/i.test(value.context) || /\bfig[dp]_[A-Za-z0-9_-]{8,}/i.test(designCanonicalJson(value))) throw new DesignError("Figma context contains temporary links or detected credentials.", "design-secret-detected");
    const expected = figmaRestReceiptArguments(source.file_key, ids, source.version);
    if (value.assets.length !== ids.length || value.provenance.calls.length !== expected.length) throw new DesignError("Every selected Figma node requires its actual PNG and exact read receipts.", "design-source-mismatch");
    expected.forEach((call, index) => {
        const receipt = value.provenance.calls[index]!;
        if (receipt.tool !== call.tool || receipt.arguments_sha256 !== hashDesignBytes(designCanonicalJson(call.arguments))) throw new DesignError("Figma REST receipt route or pinned arguments do not match this snapshot.", "design-source-mismatch");
        if (index < 2) {
            const url = new URL(index === 0 ? `https://api.figma.com/v1/files/${source.file_key}/nodes` : `https://api.figma.com/v1/images/${source.file_key}`);
            url.searchParams.set("ids", ids.join(","));
            if (index === 1) { url.searchParams.set("format", "png"); url.searchParams.set("scale", "1"); url.searchParams.set("version", source.version); }
            if (receipt.request_sha256 !== hashDesignBytes(designCanonicalJson({ method: "GET", url: url.href }))) throw new DesignError("Figma REST exact request receipt disagrees with its approved source or pinned version.", "design-source-mismatch");
        }
        if (index >= 2) {
            const asset = value.assets[index - 2]!;
            if (asset.id !== `figma-${ids[index - 2]!.replace(":", "-")}` || receipt.response_sha256 !== asset.sha256) throw new DesignError("Figma PNG receipt does not match its selected node and retained bytes.", "design-source-mismatch");
        }
    });
}
/** Bounded JSON parsing rejects duplicate keys before a caller interprets an input. */
export function parseDesignJson(contents: string | Uint8Array, maxBytes = MAX_SNAPSHOT_BYTES): unknown {
    const source = typeof contents === "string" ? contents : Buffer.from(contents).toString("utf8");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024 || Buffer.byteLength(source) > maxBytes) throw new DesignError("Design JSON exceeds its byte ceiling.");
    let parsed: unknown; try { parsed = JSON.parse(source); } catch { throw new DesignError("Design input is not valid JSON."); }
    let cursor = 0, members = 0;
    const space = () => { while (/\s/.test(source[cursor] ?? "") && cursor < source.length) cursor++; };
    const quoted = (key: boolean): string => { const begin = cursor++; while (cursor < source.length) { const c = source[cursor++]!; if (c === "\\") cursor++; else if (c === '"') return key ? JSON.parse(source.slice(begin, cursor)) : ""; } throw new DesignError("Unterminated design JSON string."); };
    const walk = (depth: number): void => {
        if (depth > 64 || ++members > 100000) throw new DesignError("Design JSON nesting or member count exceeds its bound.");
        space(); const c = source[cursor];
        if (c === '"') { quoted(false); return; }
        if (c === "{") {
            cursor++; space(); const keys = new Set<string>(); if (source[cursor] === "}") { cursor++; return; }
            while (cursor < source.length) { space(); const key = quoted(true); if (keys.has(key)) throw new DesignError("Design JSON contains duplicate keys; no hidden alternate reference is accepted."); keys.add(key); space(); cursor++; walk(depth + 1); space(); if (source[cursor++] === "}") return; }
        } else if (c === "[") { cursor++; space(); if (source[cursor] === "]") { cursor++; return; } while (cursor < source.length) { walk(depth + 1); space(); if (source[cursor++] === "]") return; } }
        else { while (cursor < source.length && !/[\s,}\]]/.test(source[cursor]!)) cursor++; }
    };
    walk(0);
    return parsed;
}
/** Parse exact source bytes without accepting duplicate keys hidden by JSON.parse. */
export function parseDesignSnapshot(contents: string | Uint8Array): DesignSnapshot { return validateDesignSnapshot(parseDesignJson(contents)); }
export function createDesignSnapshot(input: DesignReferenceInput, now = new Date()): DesignSnapshotV1 {
    if (input.source?.provider && input.source.provider !== "owned-reference") throw new DesignError("Use the measured MCP import for remote source claims.");
    return sealDesignSnapshot({ schema_version: "wringer.design-snapshot.v1", title: input.title, source: { provider: "owned-reference", label: input.source?.label ?? input.title, endpoint: null, file_key: null, node_id: null, version: input.source?.version ?? null, version_basis: input.source?.version ? "operator-declared" : "capture-only" }, captured_at: now.toISOString(), disclosure: input.disclosure, context: input.context, component_rules: input.componentRules ?? [], assets: (input.assets ?? []).map(designPngAsset), provenance: { method: "owned-reference", calls: [], limits: ["Operator-supplied reference, not a Figma/MCP access measurement.", "The snapshot hash pins retained bytes, not ownership or design correctness.", "PNG pixels may contain private information; text redaction cannot establish image privacy."] } });
}
export function assertRepositoryDisclosure(snapshot: DesignSnapshot) { validateDesignSnapshot(snapshot); if (snapshot.disclosure !== "repository-permitted") throw new DesignError("This design reference is private. Explicit repository permission is required before attaching it to source or delivery.", "design-disclosure-required"); }
export async function readDesignSnapshot(path: string): Promise<DesignSnapshot> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const stat = await file.stat(); if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) throw new DesignError("Design snapshot must be a bounded regular file, not a link or directory.");
        const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_SNAPSHOT_BYTES + 1));
        let offset = 0;
        while (offset < buffer.length) { const next = await file.read(buffer, offset, buffer.length - offset, null); if (!next.bytesRead) break; offset += next.bytesRead; }
        if (offset > stat.size) throw new DesignError("Design snapshot changed or grew during its bounded read.");
        return parseDesignSnapshot(buffer.subarray(0, offset));
    } finally { await file.close(); }
}
/** Exclusive creation only: an existing snapshot is never rewritten in place. */
export async function writeDesignSnapshot(path: string, value: DesignSnapshot): Promise<void> {
    validateDesignSnapshot(value);
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(designCanonicalJson(value) + "\n"); await file.sync(); } finally { await file.close(); }
    if (!(await lstat(path)).isFile()) throw new DesignError("Snapshot destination changed during capture.");
}
