import { runReversions } from "./rebuild-reversions";
const test = "packages/application/test/diagnostics.test.ts", file = "packages/application/src/diagnostics.ts";
await runReversions("m6-diagnostic-guards", [test], [
    { name: "exact-diagnostic-preview", file, before: 'if (preview.identity !== expectedIdentity)', after: 'if (false)', test, pattern: "diagnostic preview" },
    { name: "no-project-request-in-export", file, before: 'jobId: row.id, mode: workspace.mode, schemaVersion: row.schema, monetaryCost: null', after: 'jobId: row.id, mode: workspace.mode, schemaVersion: row.schema, monetaryCost: null, originalRequest: (await readVerificationJob(root, row.id)).intent', test, pattern: "diagnostic preview" },
]);
