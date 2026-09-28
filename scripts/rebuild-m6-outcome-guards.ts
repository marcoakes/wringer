import { runReversions } from "./rebuild-reversions";
const test = "packages/application/test/verification-job.test.ts", file = "packages/application/src/verification-recovery.ts", pattern = "lost check outcome";
await runReversions("m6-outcome-guards", [test], [
    { name: "partial-creation-cli", file: "packages/cli/src/adoption-cli.ts", before: " || await assistantExists(root, `verification-jobs/${id}/creation.json`)", after: "", test, pattern: "interrupted verification preparation" },
    { name: "reserve-exact-output", file: "packages/application/src/verification-job.ts", before: 'signal, output: operation.evidence', after: 'signal', test, pattern },
    { name: "sealed-result-required", file, before: 'if (!(await validateDigests(directory)).ok)', after: 'if (false)', test, pattern },
    { name: "live-operation-owner", file, before: 'owner === "absent" &&', after: 'true &&', test, pattern },
    { name: "exact-recovery-review", file, before: 'preview.identity !== expected || !preview.eligible', after: '!preview.eligible', test, pattern },
    { name: "recovered-status-join", file: "packages/application/src/verification-job.ts", before: 'if (await assistantExists(root, resolution))', after: 'if (false)', test, pattern },
]);
