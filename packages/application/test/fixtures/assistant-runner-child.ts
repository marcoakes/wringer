// Construction-only test fixture. No production JSON can select this executor.
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { createAssistantRunner } from "../../src/assistant-runner";

const directory = process.argv[2]!, mode = process.argv[3]!;
const keepAlive = setInterval(() => {}, 1000);
const runner = await createAssistantRunner(directory, {
    pollIntervalMs: 10,
    execute: async (request, signal) => {
        await appendFile(join(directory, "fixture-dispatches.jsonl"), JSON.stringify({ id: request.id, jobId: request.jobId }) + "\n");
        if (mode === "block") await new Promise<void>(() => {});
        if (mode === "abort") await new Promise<void>((_resolve, reject) => {
            if (signal.aborted) reject(new Error("Fixture observed cancellation after dispatch"));
            else signal.addEventListener("abort", () => reject(new Error("Fixture observed cancellation after dispatch")), { once: true });
        });
        if (mode === "finish") await Bun.sleep(100);
        return { fixture: true, requestId: request.id };
    },
});
if (mode !== "before-start") await runner.start();
process.stdout.write("fixture-ready\n");
process.on("SIGTERM", () => { void runner.stop(20).finally(() => { clearInterval(keepAlive); process.exit(0); }); });
