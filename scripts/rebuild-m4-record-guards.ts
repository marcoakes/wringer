import { runReversions } from "./rebuild-reversions";
const test = "packages/application/test/adoption-records.test.ts", file = "packages/application/src/assistant-store.ts";
await runReversions("m4-records", [test, "packages/application/test/proposal-revision.test.ts", "packages/application/test/delegation-profile.test.ts", "packages/application/test/verification-job.test.ts"], [
    { name: "write-shape-validation", file, before: "await validateAdoptionRecord(value);", after: "void value;", test, pattern: "refuse malformed writes" },
    { name: "read-shape-validation", file, before: "await validateAdoptionRecord(body);", after: "void body;", test, pattern: "malformed retained record" },
]);
