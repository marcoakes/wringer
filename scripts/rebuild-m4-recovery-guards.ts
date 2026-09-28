import { runReversions } from "./rebuild-reversions";
const test = "packages/cli/test/verification-owner.test.ts", source = "packages/application/src/verification-job.ts", owner = "packages/cli/src/verification-owner.ts";
await runReversions("m4-recovery", [test, "packages/mcp/test/verification-contract.test.ts"], [
    { name: "correction-evidence", file: source, before: 'if (decisions.length) evidence("review-decision", decisions.at(-1));', after: 'void decisions;', test, pattern: "T09 correction" },
    { name: "preparation-failure-phase", file: source, before: 'preparationEligible ? "handover-blocked"', after: 'false ? "handover-blocked"', test, pattern: "failed handover preparation" },
    { name: "explicit-preparation-retry", file: owner, before: 'if (current.preparationEligible) { await prepare(id); return json(compact(await status(id))); }', after: 'void current.preparationEligible;', test, pattern: "failed handover preparation" },
]);
