/** SCRIPTED TEST FIXTURE. Executed only inside the declared role sandbox.
 * No model SDK, network client, credential lookup or human decision exists here. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const role = process.argv[2], sessionId = randomUUID();
if (!["worker", "judge"].includes(role)) throw new Error("Only scripted worker/judge fixtures are supported");
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");
const reply = (id, result) => send({ id, result });
const update = text => send({ method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });
const hash = value => createHash("sha256").update(value).digest("hex");
for await (const line of createInterface({ input: process.stdin })) {
    const packet = JSON.parse(line);
    if (packet.method === "initialize") reply(packet.id, { protocolVersion: 1, agentCapabilities: {}, authMethods: [], agentInfo: { name: "SCRIPTED-REPORTS-FIXTURE-NO-MODEL", version: "1" } });
    else if (packet.method === "session/new") reply(packet.id, { sessionId });
    else if (packet.method === "session/prompt") {
        if (role === "worker") {
            const fixture = JSON.parse(await readFile("rehearsal/fixture.json", "utf8"));
            const current = hash(await readFile("src/app.ts"));
            const baseline = fixture.sourceInputs.find(row => row.path === "src/app.ts").sha256;
            const initial = current === baseline;
            if (!initial && current !== fixture.initialImplementationSha256) throw new Error("Scripted author refuses an unexpected candidate");
            const next = await readFile(`rehearsal/${initial ? "initial" : "corrected"}-app.ts.txt`);
            if (hash(next) !== (initial ? fixture.initialImplementationSha256 : fixture.correctedImplementationSha256)) throw new Error("Scripted source digest mismatch");
            await writeFile("src/app.ts", next);
            const ignored = "SCRIPTED ignored .evidence capture probe written\n";
            await writeFile(".evidence/scripted-worker-capture.txt", ignored);
            if (await readFile(".evidence/scripted-worker-capture.txt", "utf8") !== ignored) throw new Error("Ignored capture probe did not persist");
            update(`${ignored}Predetermined ${initial ? "initial" : "corrected"} implementation copied inside the worker sandbox. No model authored this change.`);
        } else update(JSON.stringify({ criteria: [{ id: "reports-work", met: true, reason: "SCRIPTED test-role finding; real assertions are separate verifier evidence" }], note: "Predetermined fixture reply, not live model judgement or human approval" }));
        reply(packet.id, { stopReason: "end_turn" });
    }
}
