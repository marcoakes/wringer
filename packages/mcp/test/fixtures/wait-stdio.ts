import { runMcpStdio } from "../../src/server";

// Real STDIO, synthetic application. No controller, credential or provider access.
let waits = 0, cancelledJobs = 0;
await runMcpStdio({ version: "wait-fixture", call: async (name, args, context) => {
    if (name === "wringer.wait_for_update") {
        waits++;
        process.stderr.write("wait-entered\n");
        try {
            await new Promise<void>(resolve => {
                const timer = setTimeout(done, 25000);
                function done() { clearTimeout(timer); context?.signal?.removeEventListener("abort", done); resolve(); }
                if (context?.signal?.aborted) done();
                else context?.signal?.addEventListener("abort", done, { once: true });
            });
        } finally { waits--; process.stderr.write("wait-exited\n"); }
    }
    if (name === "wringer.cancel") cancelledJobs++;
    return { schema_version: "fixture.wait.v1", outcome: "observed", name, jobId: args.jobId ?? null, waits, cancelledJobs, providerCalls: 0 };
} });
