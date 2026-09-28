import { runReversions } from "./rebuild-reversions";
const file = "scripts/rehearsal-send.ts", test = "packages/cli/test/rehearsal-send.test.ts";
await runReversions("ci-send-guards", [test], [
    { name: "reuse-ui-action-timeout", file, before: ', { timeout: 40000 }', after: '', test, pattern: "outlives" },
    { name: "unbounded-send-observation", file, before: 'timeout: 40000', after: 'timeout: 0', test, pattern: "finite bound" },
]);
