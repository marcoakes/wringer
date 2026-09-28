import { runReversions } from "./rebuild-reversions";
const file = "packages/application/src/verification-job.ts", test = "packages/application/test/verification-job.test.ts", pattern = "transport requests and legacy retries";
await runReversions("integration-request-guards", [test], [
    { name: "canonical-transport-request", file, before: "const request = canonicalRequest(id, input);", after: "const request = input;", test, pattern },
    { name: "request-job-binding", file, before: "input.jobId !== undefined && input.jobId !== id", after: "false", test, pattern },
    { name: "unknown-request-field", file, before: 'Object.keys(input).some(key => !["jobId", "idempotencyKey", "expectedRevision", "expectedCandidateIdentity"].includes(key))', after: "false", test, pattern },
    { name: "legacy-retry-binding", file, before: "canonicalRequest(id, (await readAssistantRecord<any>(root, old)).request)", after: "(await readAssistantRecord<any>(root, old)).request", test, pattern },
]);
