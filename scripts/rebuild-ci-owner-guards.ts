import { runReversions } from "./rebuild-reversions";
const file = "packages/cli/src/assistant-job.ts", test = "packages/cli/test/assistant-job.test.ts", correction = "packages/cli/test/assistant-job-correction.test.ts";
await runReversions("ci-owner-guards", [test, correction], [
    { name: "shutdown-poisons-observation", file, before: "if (stopped || options.isStopping?.() || options.signal?.aborted) return;", after: "assertRunning();", test: correction, pattern: "owner shutdown during" },
    { name: "shutdown-allows-convenience-work", file, before: "if (stopped || options.isStopping?.() || options.signal?.aborted) return;", after: "/* fault: stopped owner continues */", test, pattern: "shutdown during an awaited read cannot automatically" },
    { name: "concurrent-error-changes-read-phase", file, before: "else if (failed || failedDisplay || observedTransient !== null)", after: "else if (failed || failedDisplay || transient.has(jobId))", test, pattern: "an observation error" },
]);
