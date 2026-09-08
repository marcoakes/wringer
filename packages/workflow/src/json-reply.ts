import { createHash } from "node:crypto";

export interface AcpJsonReplyEvidence {
    schema_version: "wringer.acp-json-reply.v1";
    path: "strict-json" | "json-fence" | "balanced-object";
    textSha256: string;
    jsonSha256: string;
    /** Half-open JavaScript string offsets (UTF-16), not UTF-8 byte offsets. */
    start: number;
    end: number;
}
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const object = (value: unknown): Record<string, unknown> => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("ACP JSON reply must be an object");
    return value as Record<string, unknown>;
};
/** Select strict JSON, then the first explicit JSON fence, then the first balanced object. Never repair syntax or try later candidates after rejection. Domain validation remains the caller's obligation. */
export function parseAcpJsonReply(text: string): { value: Record<string, unknown>; evidence: AcpJsonReplyEvidence } {
    if (typeof text !== "string" || Buffer.byteLength(text) > 1024 * 1024 || text.includes("\0")) throw new Error("ACP JSON reply must be bounded text of at most 1 MiB");
    const finish = (path: AcpJsonReplyEvidence["path"], start: number, end: number) => {
        const json = text.slice(start, end);
        let value: unknown;
        try { value = JSON.parse(json); } catch { throw new Error(`ACP reply ${path} contains invalid JSON; syntax was not repaired`); }
        return { value: object(value), evidence: { schema_version: "wringer.acp-json-reply.v1" as const, path, textSha256: sha(text), jsonSha256: sha(json), start, end } };
    };
    let strict: unknown, valid = false;
    try { strict = JSON.parse(text); valid = true; } catch { /* Transport decoration may surround an otherwise exact JSON object. */ }
    if (valid) { object(strict); return finish("strict-json", 0, text.length); }
    const opening = /^[ \t]*```json[ \t]*\r?$/mi.exec(text);
    if (opening) {
        const start = opening.index + opening[0].length, closing = /^[ \t]*```[ \t]*\r?$/m.exec(text.slice(start));
        if (!closing) throw new Error("ACP reply's first JSON fence is incomplete; no later object was selected");
        const end = start + closing.index;
        return finish("json-fence", start, end);
    }
    const candidates: [number, number][] = [];
    let depth = 0, start = -1, quoted = false, escaped = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (!depth) { if (char === "{") { start = i; depth = 1; } continue; }
        if (quoted) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === "{") depth++;
        else if (char === "}" && --depth === 0) { candidates.push([start, i + 1]); break; }
    }
    if (depth || candidates.length !== 1) throw new Error("ACP reply has no complete first JSON object; incomplete output was not repaired");
    return finish("balanced-object", candidates[0]![0], candidates[0]![1]);
}
