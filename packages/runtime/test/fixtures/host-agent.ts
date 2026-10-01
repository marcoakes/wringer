/** TEST FIXTURE ONLY: an ACP agent run as an ordinary host process. On a prompt it
 * reports its working directory and the environment names it received, and, unless
 * --read-only, edits the clone it was started in. */
import { writeFileSync } from "node:fs";
const reply = (id: number, result: unknown) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const say = (text: string) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "host-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } }) + "\n");
let buffer = "";
process.stdin.on("data", data => {
    buffer += data;
    let at: number;
    while ((at = buffer.indexOf("\n")) >= 0) {
        const packet = JSON.parse(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
        if (packet.method === "initialize") reply(packet.id, { protocolVersion: 1, agentCapabilities: {}, authMethods: [] });
        else if (packet.method === "session/new") reply(packet.id, { sessionId: "host-session" });
        else if (packet.method === "session/prompt") {
            if (!process.argv.includes("--read-only")) {
                writeFileSync("src/value.js", "export const expected = true;\n");
                writeFileSync("NEW_FILE.md", "Created by the host fixture agent.\n");
            }
            say(JSON.stringify({ cwd: process.cwd(), env: Object.keys(process.env).sort() }));
            reply(packet.id, { stopReason: "end_turn" });
        }
    }
});
