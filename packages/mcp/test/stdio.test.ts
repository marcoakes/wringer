import { describe, expect, test } from "bun:test";
import { MCP_MAX_INPUT_BYTES } from "../src/json";
import { runMcpStdio } from "../src/server";

const encode = (text: string) => new TextEncoder().encode(text);
const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fixture 🧭", version: "0" } } });
const initialized = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
const status = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "wringer.get_status", arguments: {} } });
async function stream(chunks: Uint8Array[]) {
    const outputs: string[] = [], calls: string[] = [];
    const outcome = await runMcpStdio({ version: "fixture", input: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }), output: { write(bytes) { outputs.push(new TextDecoder().decode(bytes)); } }, call: name => { calls.push(name); return { outcome: "recorded", cost: null }; } });
    return { outcome, calls, output: outputs.join(""), messages: outputs.flatMap(out => out.trimEnd().split("\n").map(line => JSON.parse(line))) };
}

describe("bounded MCP stdio transport", () => {
    test("handles split UTF-8, one-byte chunks and multiple messages per chunk", async () => {
        const bytes = encode(`${init}\n${initialized}\n${status}\n`);
        const run = await stream(Array.from(bytes, b => new Uint8Array([b])));
        expect(run.outcome).toEqual({ reason: "eof", messages: 3 });
        expect(run.calls).toEqual(["wringer.get_status"]);
        expect(run.messages).toHaveLength(2); expect(run.messages[1].result.structuredContent.cost).toBeNull();
        expect((await stream([bytes])).messages).toEqual(run.messages);
    });
    test("accepts CRLF but rejects embedded raw carriage returns", async () => {
        expect((await stream([encode(`${init}\r\n${initialized}\r\n${status}\r\n`)])).calls).toEqual(["wringer.get_status"]);
        const bad = await stream([encode('{"jsonrpc":\r"2.0","id":1,"method":"ping"}\n')]);
        expect(bad.outcome.reason).toBe("invalid-transport"); expect(bad.calls).toEqual([]);
    });
    test("invalid UTF-8 fails closed rather than replacing source words", async () => {
        const bad = await stream([new Uint8Array([123, 34, 120, 34, 58, 34, 0xc0, 0xaf, 34, 125, 10])]);
        expect(bad.outcome.reason).toBe("invalid-transport"); expect(bad.messages[0].error.code).toBe(-32700); expect(bad.calls).toEqual([]);
    });
    test("unterminated final frame never becomes a dispatch on EOF", async () => {
        const bad = await stream([encode(`${init}\n${initialized}\n${status}`)]);
        expect(bad.outcome.reason).toBe("invalid-transport"); expect(bad.calls).toEqual([]); expect(bad.messages.at(-1).error.code).toBe(-32700);
    });
    test("oversized frames are rejected before decoding, even with multibyte characters", async () => {
        for (const chunks of [[encode("a".repeat(MCP_MAX_INPUT_BYTES + 1))], [encode('"'), encode("🧭".repeat(MCP_MAX_INPUT_BYTES / 4)), encode('"\n')]]) {
            const bad = await stream(chunks);
            expect(bad.outcome.reason).toBe("invalid-transport"); expect(bad.messages).toHaveLength(1); expect(bad.calls).toEqual([]);
        }
    });
    test("a real Bun subprocess writes only protocol responses and exits after chat input closes", async () => {
        const proc = Bun.spawn([process.execPath, new URL("fixtures/stdio.ts", import.meta.url).pathname], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", TMPDIR: process.env.TMPDIR ?? "/tmp" } });
        proc.stdin.write(`${init}\n${initialized}\n${status}\n`); proc.stdin.end();
        const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
        expect(code).toBe(0); expect(stderr).toBe("");
        const messages = stdout.trimEnd().split("\n").map(line => JSON.parse(line));
        expect(messages).toHaveLength(2); expect(messages[1].result.structuredContent).toMatchObject({ outcome: "recorded", providerCalls: 0, name: "wringer.get_status" });
    });
});
