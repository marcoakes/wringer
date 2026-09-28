import { runReversions } from "./rebuild-reversions";
const test = "packages/application/test/verification-job.test.ts", file = "packages/cli/src/adoption-cli.ts", pattern = "CLI creates";
await runReversions("integration-cli-job-guards", [test], [
    { name: "absent-check-selection", file, before: "...(selection !== undefined ? { selection } : {})", after: "selection", test, pattern },
    { name: "absent-parent", file, before: "...(parentJobId !== undefined ? { parentJobId } : {})", after: "parentJobId", test, pattern },
]);
