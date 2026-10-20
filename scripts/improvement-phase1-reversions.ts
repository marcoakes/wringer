/** Improvement release 1 (trajectories, replicate sets): each guard is removed alone in an
 * isolated copy, watched red, restored and watched green. Scripted roles, no model.
 *   bun scripts/improvement-phase1-reversions.ts [--check-targets] [--only NAME,NAME] */
import { runReversions, type Reversion } from "./rebuild-reversions";

const trajectory = "packages/workflow/src/trajectory.ts", trajectoryTest = "packages/workflow/test/trajectory.test.ts";
const page = "packages/application/src/loop-inspection.ts", pageTest = "packages/application/test/loop-trajectory-page.test.ts";
const protocol = "packages/application/src/delegation-protocol.ts", journeyTest = "packages/application/test/trusted-local-journey.test.ts";
const replicates = "packages/application/src/replicates.ts", replicateTest = "packages/application/test/replicates.test.ts";
const patterns = "packages/application/src/journey-patterns.ts", research = "packages/delivery/src/research-purpose.ts";
const cases: Reversion[] = [
    // The trajectory view: redacted again at render, bounded per item and in total, never inventing output.
    { name: "trajectory-render-redaction", file: trajectory, before: "const tidy = (text: string) => redactor.scrub(text)", after: "const tidy = (text: string) => (text)", test: trajectoryTest, pattern: "render-time redaction" },
    { name: "trajectory-item-bound", file: trajectory, before: "if (text.length > TRAJECTORY_ITEM_LIMIT) {", after: "if (false) {", test: trajectoryTest, pattern: "cut at 4 KiB" },
    { name: "trajectory-total-bound", file: trajectory, before: "if (total + text.length > TRAJECTORY_LIMIT) { omitted.droppedLines++; return; }", after: "if (false) { omitted.droppedLines++; return; }", test: trajectoryTest, pattern: "stops at its bound" },
    { name: "trajectory-says-when-no-output", file: trajectory, before: 'unfinished ? "(no completion was observed for this call)" : "(output not carried by this adapter for this call)"', after: '""', test: trajectoryTest, pattern: "nothing is invented" },
    { name: "trajectory-codex-raw-output", file: trajectory, before: "const text = [output.formatted_output, output.output, output.stdout, output.stderr]", after: "const text = [output.output, output.stdout, output.stderr]", test: trajectoryTest, pattern: "Codex-shaped updates" },
    { name: "trajectory-page-bound", file: page, before: "if (bytes > TRAJECTORY_PAGE_BYTES && lines.length) break;", after: "", test: pageTest, pattern: "stops at 64 KiB" },
    { name: "inspect-loop-trajectory-fields-need-the-flag", file: protocol, before: "if (args.effectId !== undefined || args.offset !== undefined || args.limit !== undefined) return refusal(", after: "if (false) return refusal(", test: journeyTest, pattern: "from proposal to review, stamped" },
    // Replicate sets: reserved before any effect, never replayed, the identity asserted, classification shared.
    { name: "replicate-dispatch-marker-before-run", file: replicates, before: 'row.status = "dispatched"; row.dispatchedAt = startedAt; await save();', after: 'row.status = "dispatched"; row.dispatchedAt = startedAt;', test: replicateTest, pattern: "all reserved first" },
    // Not probed: the collection's first write. The dispatch marker is written before any run, so
    // removing the first write alone changes nothing observable before an effect (measured).
    { name: "replicate-interruption-stops-the-set", file: replicates, before: '                    halt = "An interrupted replicate was reconciled. The set stops instead of silently extending or replaying uncertain spend.";\n', after: "", test: replicateTest, pattern: "never replayed, and the set stops" },
    { name: "replicate-identity-unrecorded", file: replicates, before: 'for (const slot of reserved) if (!ids.includes(slot)) reasons.push(', after: 'for (const slot of reserved) if (false) reasons.push(', test: replicateTest, pattern: "budget identity" },
    { name: "replicate-identity-dispatch-marker", file: replicates, before: 'if (!row || row.dispatchedAt === null || row.status !== "recorded") reasons.push(', after: "if (false) reasons.push(", test: replicateTest, pattern: "budget identity" },
    { name: "replicate-fixture-never-live", file: replicates, before: 'if (collection && collection.evidenceKind !== (fixture ? "deterministic-fixture" : "live")) throw', after: "if (false) throw", test: replicateTest, pattern: "never relabelled live" },
    { name: "replicate-grant-exact-credentials", file: replicates, before: "if (!Array.isArray(options.credentialNames) || hashValue([...options.credentialNames].sort()) !== hashValue(expected)) throw", after: "if (false) throw", test: replicateTest, pattern: "never relabelled live" },
    { name: "divergence-reads-the-recorded-journal", file: replicates, before: "if (history && (history.plan.plan_sha256 !== set.plan.plan_sha256 || history.events.at(-1)?.sha256 !== replicate.journeyRevision)) throw", after: "if (false) throw", test: replicateTest, pattern: "measured-loop decisions" },
    { name: "divergence-shares-failure-classification", file: patterns, before: 'add("product-check", requirements(failed),', after: 'add("environment", requirements(failed),', test: replicateTest, pattern: "where they disagreed" },
    { name: "replicate-authority-fenced-from-patterns", file: patterns, before: 'if (history.authority.actor?.startsWith("Replicate set:")) throw', after: "if (false) throw", test: replicateTest, pattern: "cannot enter ordinary failure patterns" },
    { name: "replicate-directory-fenced-from-patterns", file: patterns, before: '"experiment-purpose.json", "replicate-set.json", "replicate-collection.json"]', after: '"experiment-purpose.json"]', test: replicateTest, pattern: "cannot enter ordinary failure patterns" },
    { name: "replicate-never-delivered", file: research, before: 'if (actor.startsWith("Replicate set:")) throw', after: "if (false) throw", test: replicateTest, pattern: "cannot enter ordinary failure patterns" },
];
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1]!.split(",") : null;
if (only) for (const name of only) if (!cases.some(row => row.name === name)) throw new Error(`Unknown probe ${name}`);
const selected = only ? cases.filter(row => only.includes(row.name)) : cases;
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
if (revision.exitCode) throw new Error("Could not record source baseline");
for (const row of cases) if ((await Bun.file(row.file).text()).split(row.before).length !== 2) throw new Error(`Mutation target is absent or not unique: ${row.name}`);
if (process.argv.includes("--check-targets")) console.log(`${cases.length} improvement phase-1 isolated reversion targets`);
else await runReversions("improvement-phase1", [trajectoryTest, pageTest, journeyTest, replicateTest], selected, { baseline: revision.stdout.toString().trim(), evidenceDirectory: only ? "docs/improvement/evidence/phase-1/reversions-followup" : "docs/improvement/evidence/phase-1/reversions" });
