import { runReversions } from "./rebuild-reversions";
const test = "packages/application/test/maintenance.test.ts", domain = "packages/application/test/delegation-recovery.test.ts", file = "packages/application/src/maintenance.ts";
await runReversions("m6-lock-guards", [test, domain], [
    { name: "confirmed-dead-only", file, before: 'process.kill(pid, 0); return "live";', after: 'process.kill(pid, 0); return "dead";', test, pattern: "dead coordination" },
    { name: "exact-lock-decision", file, before: 'if (preview.identity !== expected) throw new Error("Coordination lock preview changed");', after: 'expected = preview.identity;', test, pattern: "dead coordination" },
    { name: "retained-lock-integrity", file, before: ' || hashBytes(await lockBytes(root, retainedLock)) !== request.preview.lockIdentity', after: '', test, pattern: "dead coordination" },
    { name: "process-lock-exclusion", file, before: 'db.exec("BEGIN IMMEDIATE");', after: '/* defect: no OS transaction lock */', test, pattern: "OS coordination" },
    { name: "lost-successful-reply", file: "packages/application/src/delegation-recovery.ts", before: 'if (await assistantExists(root, `${prefix}/result.json`))', after: 'if (false)', test: domain, pattern: "delegation recovery" },
    { name: "exact-domain-recovery", file: "packages/application/src/delegation-recovery.ts", before: 'if (preview.identity !== expected) throw new Error("Recovery state changed; inspect the current retained operation");', after: 'expected = preview.identity;', test: domain, pattern: "delegation recovery" },
]);
