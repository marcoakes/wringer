import { runReversions } from "./rebuild-reversions";
const test = "packages/application/test/workspace-recovery.test.ts", file = "packages/application/src/workspace-recovery.ts";
await runReversions("m6-owner-guards", [test], [
    { name: "live-owner-refusal", file, before: 'process.kill(pid, 0); return "live";', after: 'process.kill(pid, 0); return "dead";', test, pattern: "refuses live" },
    { name: "exact-owner-preview", file, before: 'if (preview.identity !== decision.expectedIdentity)', after: 'if (false)', test, pattern: "dead owner recovery" },
    { name: "retained-owner-integrity", file, before: 'hashValue(retained.files) !== hashValue(preview.files)', after: 'false', test, pattern: "dead owner recovery" },
]);
