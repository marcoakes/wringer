export const MCP_MAX_INPUT_BYTES = 256 * 1024;
export const MCP_MAX_OUTPUT_BYTES = 512 * 1024;
export const MCP_MAX_JSON_DEPTH = 64;

export class McpJsonError extends Error {
    constructor() { super("Invalid, ambiguous or oversized JSON input."); this.name = "McpJsonError"; }
}

/** JSON.parse loses duplicate keys. Read the grammar once and reject ambiguity before dispatch. */
export function parseMcpJson(source: string): unknown {
    if (Buffer.byteLength(source, "utf8") > MCP_MAX_INPUT_BYTES) throw new McpJsonError();
    let at = 0;
    const fail = (): never => { throw new McpJsonError(); };
    const space = () => { while (at < source.length && /[\x20\t\r\n]/.test(source[at]!)) at++; };
    const string = (): string => {
        const start = at++;
        while (at < source.length) {
            const c = source[at++];
            if (c === "\\") { at++; continue; }
            if (c === '"') {
                let decoded: string;
                try { decoded = JSON.parse(source.slice(start, at)); } catch { return fail(); }
                if (!decoded.isWellFormed()) return fail();
                return decoded;
            }
        }
        return fail();
    };
    const value = (depth: number): unknown => {
        if (depth > MCP_MAX_JSON_DEPTH) return fail();
        space();
        const c = source[at];
        if (c === '"') return string();
        if (c === "{") {
            at++; space();
            const result: Record<string, unknown> = {};
            const seen = new Set<string>();
            if (source[at] === "}") { at++; return result; }
            while (at < source.length) {
                if (source[at] !== '"') return fail();
                const key = string();
                if (seen.has(key) || ["__proto__", "prototype", "constructor"].includes(key)) return fail();
                seen.add(key); space();
                if (source[at++] !== ":") return fail();
                result[key] = value(depth + 1); space();
                if (source[at] === "}") { at++; return result; }
                if (source[at++] !== ",") return fail();
                space();
            }
            return fail();
        }
        if (c === "[") {
            at++; space();
            const result: unknown[] = [];
            if (source[at] === "]") { at++; return result; }
            while (at < source.length) {
                result.push(value(depth + 1)); space();
                if (source[at] === "]") { at++; return result; }
                if (source[at++] !== ",") return fail();
            }
            return fail();
        }
        for (const [text, result] of [["true", true], ["false", false], ["null", null]] as const) {
            if (source.startsWith(text, at)) { at += text.length; return result; }
        }
        const numeric = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(at));
        if (numeric?.index !== 0) return fail();
        at += numeric[0].length;
        const n = Number(numeric[0]);
        if (!Number.isFinite(n)) return fail();
        return n;
    };
    const parsed = value(0);
    space();
    if (at !== source.length) return fail();
    return parsed;
}
