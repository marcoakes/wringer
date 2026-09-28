import { runReversions } from "./rebuild-reversions";
const file = "packages/cli/src/verification-owner.ts", test = "packages/cli/test/verification-owner.test.ts";
await runReversions("ci-verification-observation-guards", [test], [
    { name: "completion-relabels-earlier-evidence", file, before: "observedActive || active.has(id)", after: "active.has(id)", test, pattern: "held MCP observation" },
    { name: "pm-rechecks-later-activity", file, before: 'working = value.phase === "working"', after: "working = active.has(id)", test, pattern: "held PM observation" },
]);
