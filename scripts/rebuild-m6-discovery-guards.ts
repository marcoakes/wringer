import { runReversions } from "./rebuild-reversions";
const test = "packages/cli/test/verification-owner.test.ts", file = "packages/cli/src/verification-owner.ts";
await runReversions("m6-discovery-guards", [test], [
    { name: "verification-inventory-scope", file, before: '(await readVerificationJob(root, id)).workspaceId === workspaceId', after: "true", test, pattern: "verification inventory" },
    { name: "verification-inventory-page", file, before: 'ids.slice(offset, offset + limit)', after: "ids", test, pattern: "verification inventory" },
]);
