/** Phase 7: each guard of the durability interface, the effect route and the Temporal
 * adapter is removed alone in an isolated copy, watched red, restored and watched
 * green. Adapter cases run with Node against a private local Temporal dev server;
 * TEMPORAL_CLI must name the Temporal CLI and adapters/temporal must be installed.
 *   TEMPORAL_CLI=... bun scripts/restoration-phase7-reversions.ts [--check-targets] */
import { resolve } from "node:path";
import { runReversions, type Reversion } from "./rebuild-reversions";

const kernel = "packages/scheduler/src/contained-kernel.ts", journal = "packages/scheduler/src/contained.ts", effect = "packages/application/src/graph-effect.ts";
const workflow = "adapters/temporal/src/graph-workflow.ts", activities = "adapters/temporal/src/activities.mjs";
const durability = "packages/scheduler/test/contained-durability.test.ts", effects = "packages/application/test/graph-effect.test.ts";
const failures = "adapters/temporal/test/failure-modes.test.mjs", conformance = "adapters/temporal/test/conformance.test.mjs", versioning = "adapters/temporal/test/versioning.test.mjs", unit = "adapters/temporal/test/activities.test.mjs", sandbox = "adapters/temporal/test/sandbox-crypto.test.mjs";
const node = (row: Omit<Reversion, "runner">): Reversion => ({ ...row, runner: "node" });
const cases: Reversion[] = [
    // The kernel reads every retained record the same way on every host; the writing host still screens.
    { name: "kernel-replay-shapes-only", file: kernel, before: "    if (SHAPES.scrub(value as string) !== value) fail(", after: "    if (new Redactor().scrub(value as string) !== value) fail(", test: durability, pattern: "does not depend on the reading host" },
    { name: "journal-replays-plan-without-host-credentials", file: journal, before: "validateContainedGraph(value, purpose === 'replay' ? REPLAY : {})", after: "validateContainedGraph(value, {})", test: durability, pattern: "retained plan and grant read the same" },
    { name: "journal-replays-grant-without-host-credentials", file: journal, before: "validateGraphAuthority(value, plan, at, purpose === 'replay' ? REPLAY : {})", after: "validateGraphAuthority(value, plan, at, {})", test: durability, pattern: "retained plan and grant read the same" },
    // Not probed: admitting the plan against host credentials. The grant's validator
    // revalidates the plan against the same credentials, so removing the plan's own
    // check alone changes nothing observable (measured: attempt 1 stayed green).
    { name: "journal-admits-grant-against-host-credentials", file: journal, before: "validateGraphAuthority(value, plan, at, purpose === 'replay' ? REPLAY : {})", after: "validateGraphAuthority(value, plan, at, REPLAY)", test: durability, pattern: "admitting a plan or grant still refuses" },
    { name: "local-writes-screen-host-credentials", file: journal, before: "screen: options.screen ?? hostScreen", after: "screen: options.screen", test: durability, pattern: "new decision carrying a credential" },
    { name: "kernel-screens-hold-reason", file: kernel, before: "                    options.screen?.(reason, 'Child hold reason');\n", after: "", test: durability, pattern: "child hold reason carrying a credential" },
    // An external controller's effect runs only for its durable marker, once.
    { name: "effect-preflight-before-marker", file: effect, before: "        if (row.dispatched || row.result) fail(", after: "        if (false) fail(", test: effects, pattern: "a preflight needs a reserved node" },
    { name: "effect-dispatch-needs-marker", file: effect, before: "        if (!row.dispatched || row.result) fail(", after: "        if (row.result) fail(", test: effects, pattern: "a dispatch runs only for a durable marker" },
    { name: "effect-dispatch-claimed-once", file: effect, before: "        await claim(directory, node, \"dispatch\", state.revision);\n", after: "", test: effects, pattern: "a dispatch runs only for a durable marker" },
    { name: "effect-send-needs-marker", file: effect, before: "        if (!row.sent || !row.prepared || row.result) fail(", after: "        if (!row.prepared || row.result) fail(", test: effects, pattern: "a Send runs only for its durable Send marker" },
    { name: "effect-send-claimed-once", file: effect, before: "        await claim(directory, node, \"send\", state.revision);\n", after: "", test: effects, pattern: "a Send runs only for its durable Send marker" },
    // The Temporal workflow: one attempt per effect, lost work observed, holds bound, divergence stops it.
    node({ name: "workflow-effect-single-attempt", file: workflow, before: "retry: { maximumAttempts: 1 } });", after: "retry: { maximumAttempts: 3 } });", test: failures, pattern: "worker loss during a dispatch" }),
    node({ name: "workflow-heartbeat-bounds-lost-worker", file: workflow, before: "heartbeatTimeout: heartbeatSeconds * 1000, ", after: "", test: failures, pattern: "worker loss during a dispatch" }),
    node({ name: "workflow-lost-dispatch-reconciled", file: workflow, before: "error.activityType !== 'dispatch') throw error;", after: "error.activityType !== 'never') throw error;", test: failures, pattern: "worker loss during a dispatch" }),
    node({ name: "workflow-validator-binds-revision", file: workflow, before: "            if (decision.expectedRevision !== last.revision) throw new Error(", after: "            if (false) throw new Error(", test: failures, pattern: "holds:" }),
    node({ name: "workflow-screens-decision-on-worker", file: workflow, before: "            await safe.screen({ entries: [{ text: decision.actor, label: 'Decision actor' }, { text: decision.note, label: 'Decision note' }] });\n", after: "", test: failures, pattern: "holds:" }),
    node({ name: "workflow-divergence-stops", file: workflow, before: "            if (divergence) throw ApplicationFailure.nonRetryable(", after: "            if (false) throw ApplicationFailure.nonRetryable(", test: failures, pattern: "second controller" }),
    node({ name: "workflow-checks-plan-digest", file: workflow, before: "validatePlan(value) { graphVersion(value); checkGraphDigest(value as Record<string, unknown>); return", after: "validatePlan(value) { graphVersion(value); return", test: failures, pattern: "tampered plan or grant" }),
    node({ name: "workflow-checks-grant", file: workflow, before: "            checkGraphAuthority(value as Record<string, unknown>, plan, at);\n", after: "", test: failures, pattern: "tampered plan or grant" }),
    node({ name: "workflow-continues-with-retained-events", file: workflow, before: "await continueAsNew<typeof containedGraph>({ ...input, events: journal.events() });", after: "await continueAsNew<typeof containedGraph>({ ...input });", test: versioning, pattern: "continue-as-new" }),
    // The worker: create-once mirror in the local byte format, credential screen, a faithful digest.
    node({ name: "mirror-refuses-divergent-event", file: activities, before: "        if (await readFile(join(directory, name), 'utf8') !== content) refuse(", after: "        if (false) refuse(", test: unit, pattern: "refuses a divergent event" }),
    node({ name: "mirror-writes-local-byte-format", file: activities, before: "eventName(event.sequence), JSON.stringify(event, null, 2) + '\\n');", after: "eventName(event.sequence), JSON.stringify(event) + '\\n');", test: conformance, pattern: "serial: identical recorded inputs" }),
    node({ name: "worker-screens-hold-reason", file: activities, before: "            if (observation?.kind === 'held') screen([{ text: observation.reason, label: 'Child hold reason' }]);\n", after: "", test: failures, pattern: "child hold reason carrying a credential" }),
    node({ name: "sandbox-sha256-faithful", file: "adapters/temporal/src/sandbox-crypto.js", before: "    0x428a2f98, 0x71374491,", after: "    0x428a2f99, 0x71374491,", test: sandbox, pattern: "equals node:crypto" }),
    node({ name: "sandbox-sha256-used-by-conformance", file: "adapters/temporal/src/sandbox-crypto.js", before: "    0x428a2f98, 0x71374491,", after: "    0x428a2f99, 0x71374491,", test: conformance, pattern: "serial: identical recorded inputs" }),
];
// --only NAME,NAME runs a follow-up of the named probes into their own record.
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1]!.split(",") : null;
if (only) for (const name of only) if (!cases.some(row => row.name === name)) throw new Error(`Unknown probe ${name}`);
const selected = only ? cases.filter(row => only.includes(row.name)) : cases;
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
if (revision.exitCode) throw new Error("Could not record source baseline");
for (const row of cases) if ((await Bun.file(row.file).text()).split(row.before).length !== 2) throw new Error(`Mutation target is absent or not unique: ${row.name}`);
if (process.argv.includes("--check-targets")) console.log(`${cases.length} phase-7 isolated reversion targets`);
else {
    if (!process.env.TEMPORAL_CLI) throw new Error("Set TEMPORAL_CLI to the Temporal CLI");
    const root = resolve(import.meta.dir, "..");
    await runReversions("restoration-phase7", [durability, effects, "packages/scheduler/test/contained.test.ts"], selected, { baseline: revision.stdout.toString().trim(), evidenceDirectory: only ? "docs/restoration/evidence/phase-7/reversions-followup" : "docs/restoration/evidence/phase-7/reversions", restoreEach: true,
        nodeTests: [unit, sandbox, conformance, failures, versioning], links: [{ target: resolve(root, "adapters/temporal/node_modules"), path: "adapters/temporal/node_modules" }], env: { TEMPORAL_CLI: process.env.TEMPORAL_CLI } });
}
