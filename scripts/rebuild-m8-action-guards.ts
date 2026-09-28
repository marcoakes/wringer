import { runReversions } from "./rebuild-reversions";
const test = "packages/cli/test/action.test.ts", file = "packaging/action.mjs";
await runReversions("m8-action-guards", [test], [
    { name: "action-ref-not-consumer-tag", file, before: "ref = env.WRINGER_ACTION_REF ?? ''", after: "ref = env.GITHUB_REF_NAME ?? ''", test, pattern: "only its own exact tag" },
    { name: "real-exit-status", file, before: "return { ...result, reporting, output, observed };", after: "return { ...result, exit: 0, reporting, output, observed };", test, pattern: "every verifier exit" },
    { name: "gate-selection", file, before: "for (const id of selection.gates) argv.push('--gate', id);", after: "/* selection lost */", test, pattern: "every verifier exit" },
    { name: "proof-request", file, before: "if (selection.prove) argv.push('--prove');", after: "/* proof request lost */", test, pattern: "every verifier exit" },
]);
