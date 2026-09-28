import { runReversions } from "./rebuild-reversions";
const test = "packages/application/test/delegation-recovery.test.ts", pattern = "retained delegation status";
await runReversions("m6-read-guards", [test], [
    { name: "read-does-not-repair-index", file: "packages/application/src/delegation-jobs.ts", before: 'if (await assistantExists(controller, `jobs/${id}/proposal.json`)) return deriveDelegationJob(root, context, id);', after: 'if (await assistantExists(controller, `jobs/${id}/proposal.json`)) return retainDelegationJob(root, context, id);', test, pattern },
    { name: "read-does-not-allocate-queue", file: "packages/application/src/assistant.ts", before: 'beforeOwnerRelease: options.beforeOwnerRelease, createStorage: false', after: 'beforeOwnerRelease: options.beforeOwnerRelease, createStorage: true', test, pattern },
]);
