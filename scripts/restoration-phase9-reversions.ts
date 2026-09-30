/** Phase 9: each capability-ledger and registration rule is removed alone in an
 * isolated copy, watched red, restored and watched green. */
import { runReversions, type Reversion } from "./rebuild-reversions";
const test = "packages/records/test/capability-ledger.test.ts", checker = "scripts/capability-ledger.ts";
const cases: Reversion[] = [
    { name: "ledger-cited-file-exists", file: checker, before: "if (!await Bun.file(resolve(root, path)).exists()) problems.push(", after: "if (false) problems.push(", test, pattern: "missing file" },
    { name: "ledger-live-needs-live-record", file: checker, before: "if (level === \"liveQualified\" && claim.status === \"yes\" && !claim.evidence.some(", after: "if (false && !claim.evidence.some(", test, pattern: "benefit claimed from fixture evidence" },
    { name: "ledger-benefit-needs-results", file: checker, before: "if (level === \"comparativelyBeneficial\" && claim.status === \"yes\" && !claim.evidence.some(", after: "if (false && !claim.evidence.some(", test, pattern: "benefit claimed from fixture evidence" },
    { name: "registration-digest-fixed", file: checker, before: "|| hashValue(body) !== sha256) problems.push(", after: ") problems.push(", test, pattern: "registration changed" },
    { name: "showcase-every-journey-passed", file: checker, before: "|| showcase.journeys.some((row: any) => row.status !== \"passed\")) problems.push(", after: ") problems.push(", test, pattern: "showcase record missing" },
    { name: "showcase-names-every-journey", file: checker, before: "JSON.stringify((showcase.journeys ?? []).map((row: any) => row.id)) !== JSON.stringify(journeys) || ", after: "", test, pattern: "showcase record missing" },
    { name: "showcase-no-machine-path", file: checker, before: "if (/\\/Users\\/|\\/var\\/folders\\/|\\/home\\/[a-z]/.test(JSON.stringify(showcase))) problems.push(", after: "if (false) problems.push(", test, pattern: "showcase record missing" },
];
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
if (revision.exitCode) throw new Error("Could not record source baseline");
for (const row of cases) if ((await Bun.file(row.file).text()).split(row.before).length !== 2) throw new Error(`Mutation target is absent or not unique: ${row.name}`);
if (process.argv.includes("--check-targets")) console.log(`${cases.length} phase-9 isolated reversion targets`);
else await runReversions("restoration-phase9", [test], cases, { baseline: revision.stdout.toString().trim(), evidenceDirectory: "docs/restoration/evidence/phase-9", restoreEach: true });
