import { readFile } from "node:fs/promises";
import { runReversions } from "./rebuild-reversions";
const source = "packages/application/src/verification-job.ts", owner = "packages/cli/src/verification-owner.ts", test = "packages/cli/test/verification-owner.test.ts";
const original = await readFile(new URL("../" + source, import.meta.url), "utf8");
await runReversions("m4-verification", [test, "packages/mcp/test/verification-contract.test.ts"], [
    { name: "returned-evidence-bytes", file: source, before: "contentIdentity: hashBytes(Buffer.from(content))", after: "contentIdentity: hashValue(latest!.observation)", test, pattern: "verification evidence hashes" },
    { name: "separate-send-eligibility", file: source, before: 'phase === "send" ? !!approval && fresh && !!prepared && !!board?.facts.readyToDeliver', after: 'phase === "send" ? checksEligible', test, pattern: "verification review prepares" },
    // Both admission checks defend the same boundary; removing only one leaves
    // the other correctly refusing. Revert both in the isolated source copy.
    { name: "send-is-not-check-authority", file: source, before: original, after: original.replace("!status.checksEligible", "!status.nextAction.eligible").replace("!current.checksEligible", "!current.nextAction.eligible"), test, pattern: "verification review prepares" },
    { name: "startup-listener-cleanup", file: owner, before: "ownedPage?.stop(true); ownedTransport?.stop();", after: "void ownedPage; void ownedTransport;", test, pattern: "failed owner construction" },
    { name: "startup-lock-cleanup", file: owner, before: "await lock.close(); await unlink(lockPath);", after: "await lock.close();", test, pattern: "failed owner construction" },
]);
