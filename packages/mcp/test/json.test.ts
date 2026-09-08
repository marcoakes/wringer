import { describe, expect, test } from "bun:test";
import { MCP_MAX_INPUT_BYTES, parseMcpJson } from "../src/json";

describe("bounded unambiguous MCP JSON", () => {
    test("preserves Unicode and complete JSON values without evaluating strings", () => {
        const value = { text: "PM's own words — café 🧭 \"quotes\"\nnext line", braces: "{a:[1,2]}", code: "$(cat /etc/passwd)", zero: 0, negative: -42.125e-3, values: [null, true, false, { okay: "yes" }] };
        expect(parseMcpJson(JSON.stringify(value))).toEqual(value);
        expect(parseMcpJson(" \t\n {\"escaped\":\"\u0041\", \"backslash\":\"\\\\\"} \r\n")).toEqual({ escaped: "A", backslash: "\\" });
    });
    test("rejects duplicate decoded keys at every depth, not just the selected tool name", () => {
        for (const source of [
            '{"id":1,"id":2}', '{"method":"ping","metho\\u0064":"tools/call"}',
            '{"arguments":{"plan":{"budget":{"max_sessions":1,"max_sessions":99}}}}',
            '{"x":[{"key":1,"key":2}]}', '{"__proto__":{}}', '{"x":{"constructor":{}}}', '{"prototype":0}',
        ]) expect(() => parseMcpJson(source)).toThrow();
    });
    test("rejects malformed, non-finite, trailing and dangerously deep input", () => {
        for (const source of ["", "undefined", "NaN", "Infinity", "1e999", "01", "+1", "1.", "--1", "{}{}", "[1,]", '{"x":}', '{"x":1,}', '"unterminated', '"raw\nnewline"', '"\\uD800"', '"\\uDC00"', "[".repeat(66) + "0" + "]".repeat(66), '\uFEFF{"x":1}'])
            expect(() => parseMcpJson(source)).toThrow();
    });
    test("size is measured as UTF-8 bytes, not JavaScript characters", () => {
        const input = JSON.stringify("🧭".repeat(MCP_MAX_INPUT_BYTES / 4));
        expect(input.length).toBeLessThan(MCP_MAX_INPUT_BYTES);
        expect(() => parseMcpJson(input)).toThrow();
    });
    test("deterministic generated JSON agrees with the platform reader", () => {
        let seed = 781;
        const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
        const value = (depth: number): unknown => {
            switch (Math.floor(random() * (depth ? 7 : 5))) {
                case 0: return null;
                case 1: return random() < 0.5;
                case 2: return Math.floor((random() - 0.5) * 1e7);
                case 3: return (random() - 0.5) * 1e10;
                case 4: return ["hello", "café", "🧭", "\u0000\"\\\n", "{\"x\":0}"][Math.floor(random() * 5)];
                case 5: return Array.from({ length: Math.floor(random() * 6) }, () => value(depth - 1));
                default: return Object.fromEntries(Array.from({ length: Math.floor(random() * 6) }, (_, i) => [`field${i}`, value(depth - 1)]));
            }
        };
        for (let n = 0; n < 512; n++) { const json = JSON.stringify(value(4)); expect(parseMcpJson(json)).toEqual(JSON.parse(json)); }
    });
});
