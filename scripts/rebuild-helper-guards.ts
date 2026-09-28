import { runReversions } from "./rebuild-reversions";
const test = "packages/cli/test/confirmation-distribution.test.ts", pattern = "optional confirmation build";
await runReversions("integration-helper-guards", [test], [
    { name: "helper-outside-sealed-distribution", file: "scripts/build-confirmation.ts", before: 'join(root, "build", "native-confirmation")', after: 'join(root, "dist", "native")', test, pattern },
    { name: "probe-matches-separate-helper", file: "scripts/validate.ts", before: '"build/native-confirmation/wringer-confirm"', after: '"dist/native/wringer-confirm"', test, pattern },
]);
