import { runReversions } from "./rebuild-reversions";
const file = ".wringer.yaml", test = "packages/cli/test/repository-check-budget.test.ts";
await runReversions("ci-action-budget-guards", [test], [
    { name: "old-full-suite-cap", file, before: "timeout: 1200", after: "timeout: 600", test, pattern: "measured finite envelope" },
    { name: "excessive-full-suite-cap", file, before: "timeout: 1200", after: "timeout: 86400", test, pattern: "measured finite envelope" },
]);
