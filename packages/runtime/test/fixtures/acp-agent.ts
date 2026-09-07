import { spawn } from "node:child_process";
const reply = (id: number, result: unknown) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const update = (text: string) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "real-process-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } }) + "\n");
let buffer = "";
process.stdin.on("data", data => {
    buffer += data;
    let at: number;
    while ((at = buffer.indexOf("\n")) >= 0) {
        const packet = JSON.parse(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
        if (packet.method === "initialize")
            reply(packet.id, { protocolVersion: 1, agentCapabilities: {}, authMethods: [] });
        else if (packet.method === "session/new")
            reply(packet.id, { sessionId: "real-process-session" });
        else if (packet.method === "session/prompt") {
            if (process.argv.includes("--hang")) {
                const descendant = spawn("sleep", ["30"], { stdio: "ignore" });
                update(String(descendant.pid));
                process.on("SIGTERM", () => { });
            }
            else {
                update("Real process protocol completed.");
                reply(packet.id, { stopReason: "end_turn" });
            }
        }
    }
});
