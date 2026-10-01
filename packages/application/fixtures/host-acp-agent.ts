/** TEST FIXTURE ONLY: an ACP agent that runs as an ordinary process on this computer,
 * for trusted-local journeys. Never imported by product code.
 *   bun host-acp-agent.ts worker   sets src/value.js to the expected value in its clone
 *   bun host-acp-agent.ts judge    replies with every check criterion met, as JSON
 * It reads its prompt for the criterion ids it must answer; it measures nothing. */
import { writeFileSync } from "node:fs";
const role = process.argv[2], session = `host-fixture-${crypto.randomUUID()}`;
const reply = (id: number, result: unknown) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const say = (text: string) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: session, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } }) + "\n");
let buffer = "";
process.stdin.on("data", data => {
    buffer += data;
    let at: number;
    while ((at = buffer.indexOf("\n")) >= 0) {
        const packet = JSON.parse(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
        if (packet.method === "initialize") reply(packet.id, { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: "host-fixture", version: "0" }, authMethods: [] });
        else if (packet.method === "session/new") reply(packet.id, { sessionId: session });
        else if (packet.method === "session/prompt") {
            const prompt = (packet.params?.prompt ?? []).map((part: any) => part?.text ?? "").join("\n");
            if (role === "worker") {
                writeFileSync("src/value.js", "export const expected = true;\n");
                say("Set the value. Fixture worker; no model was used.");
            } else {
                const ids = [...new Set([...prompt.matchAll(/"id":\s*"([a-z][a-z0-9-]*)"/g)].map(match => match[1]))].filter(id => id === "value");
                say("```json\n" + JSON.stringify({ criteria: (ids.length ? ids : ["value"]).map(id => ({ id, met: true, reason: "Fixture judge; not an independent review" })), note: "Fixture judge only" }) + "\n```");
            }
            reply(packet.id, { stopReason: "end_turn" });
        }
    }
});
