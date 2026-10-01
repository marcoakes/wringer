/** alpha.35: the guards found by the beta-gate preparation on alpha.34 (a Codex project
 * entry that Codex would not use; a flow sweep outliving stop) are each removed alone in
 * an isolated copy, watched red, restored and watched green. No model.
 *   bun scripts/adoption-alpha35-reversions.ts [--check-targets] */
import { runReversions, type Reversion } from "./rebuild-reversions";

const adapters = "packages/cli/src/client-adapters.ts", adaptersTest = "packages/cli/test/client-adapters.test.ts";
const flow = "packages/cli/src/assistant-job.ts", flowTest = "packages/cli/test/assistant-job.test.ts";
const cases: Reversion[] = [
    { name: "connect-refuses-shadowed-codex-entry", file: adapters, before: "            if (plan.refusal) throw new Error(plan.refusal);\n", after: "", test: adaptersTest, pattern: "a Codex project entry that Codex would not use" },
    { name: "connect-flags-untrusted-codex-folder", file: adapters, before: "        if (!trusted) warnings.push(", after: "        if (false) warnings.push(", test: adaptersTest, pattern: "a Codex project entry that Codex would not use" },
    { name: "stop-waits-for-sweep-in-flight", file: flow, before: 'cancellation.abort(new Error("The job page owner stopped.")); return sweep; } };', after: 'cancellation.abort(new Error("The job page owner stopped.")); return Promise.resolve(); } };', test: flowTest, pattern: "stopping waits for the sweep already in flight" },
    // Not probed: a separate stop check inside the sweep loop. advance() already returns once
    // stopped, so removing it changed nothing observable (measured: it stayed green); it was removed.
];
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
if (revision.exitCode) throw new Error("Could not record source baseline");
for (const row of cases) if ((await Bun.file(row.file).text()).split(row.before).length !== 2) throw new Error(`Mutation target is absent or not unique: ${row.name}`);
if (process.argv.includes("--check-targets")) console.log(`${cases.length} alpha.35 isolated reversion targets`);
else await runReversions("adoption-alpha35", [adaptersTest, flowTest], cases, { baseline: revision.stdout.toString().trim(), evidenceDirectory: "docs/adoption/evidence/alpha35/reversions" });
