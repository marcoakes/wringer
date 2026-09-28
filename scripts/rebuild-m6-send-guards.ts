import { runReversions } from "./rebuild-reversions";
const test = "packages/cli/test/verification-owner.test.ts", file = "packages/application/src/verification-send-recovery.ts", pattern = "T17 lost Send";
await runReversions("m6-send-guards", [test], [
    { name: "exact-remote-head", file, before: 'if (remoteHead && localHead === remoteHead)', after: 'if (localHead)', test, pattern },
    { name: "no-live-send-recovery", file, before: ' && sendOwner === "absent"', after: '', test, pattern },
    { name: "carried-evidence-audit", file, before: 'if (observed.status !== "passed")', after: 'if (false)', test, pattern },
    { name: "exact-send-recovery-decision", file, before: 'if (preview.identity !== expected) throw new Error("Send recovery observation changed; inspect its exact current head");', after: 'expected = preview.identity;', test, pattern },
    { name: "durable-audit-receipt", file, before: 'if (await assistantExists(root, savedPath))', after: 'if (false)', test, pattern },
]);
