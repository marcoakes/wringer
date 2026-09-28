import { runReversions } from "./rebuild-reversions";
const test = "packages/application/test/verification-job.test.ts", file = "packages/application/src/verification-job.ts";
await runReversions("m6-guards", [test], [
    { name: "retained-verification-source", file, before: "if (await assistantExists(root, creationFile)) {", after: "if (false) {", test, pattern: "interrupted verification preparation" },
    { name: "creation-request-binding", file, before: "hashValue(retained.request) !== hashValue(body)", after: "false", test, pattern: "interrupted verification preparation" },
    { name: "read-retained-preparation", file, before: "value = retained.job;", after: 'value = await readAssistantRecord<VerificationJob>(root, jobPath(id, "job.json"));', test, pattern: "interrupted verification preparation" },
]);
