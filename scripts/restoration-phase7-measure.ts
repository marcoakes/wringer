/** Phase 7 measure-first (bun scripts/restoration-phase7-measure.ts OUTPUT): which
 * orchestration operations are deterministic decisions and which perform external
 * effects, measured on the graph kernel with a recording driver; whether identical
 * recorded inputs replay to identical records; and what a second durable runtime
 * would need. No model, container, network or Temporal service is used. */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileContainedGraph, createGraphAuthority, hashValue } from "../packages/plan/src";
import { advanceContainedGraph, decideContainedGraph, initializeContainedGraph, readContainedGraph, sendContainedGraph, type GraphDriver, type GraphObservation, type GraphState } from "../packages/scheduler/src";
import { graphFixture, tournamentFixture } from "../packages/plan/test/graph-fixtures";

const output = resolve(process.argv[2] ?? "build/restoration/phase-7/measurements"), scratch = await mkdtemp(join(tmpdir(), "wringer-phase7-measure-"));
const record: Record<string, unknown> = { schema_version: "wringer.restoration-phase7-measurement.v1", kind: "deterministic: the real graph kernel with a recording fake driver; no model, container, network or Temporal service" };
const at = new Date("2026-09-30T12:00:00Z");

/** Run one graph to completion through a driver that records every call it receives. */
async function journey(name: string, raw: any, fixedClock: boolean) {
    const directory = join(scratch, `${name}-${fixedClock ? "fixed" : "live"}-${crypto.randomUUID()}`), plan = compileContainedGraph(raw);
    const start = fixedClock ? at : new Date(), clock = fixedClock ? () => at : () => new Date();
    const calls: { operation: string; node: string }[] = [], observed = new Map<string, GraphObservation>();
    const candidateOf = (node: string) => ({ source: { ...plan.repository, commit: hashValue(node).slice(0, 40) }, tree: hashValue(`tree-${node}`).slice(0, 40), owner: node });
    const driver: GraphDriver = {
        async preflight(request, operation) { calls.push({ operation: `preflight-${operation}`, node: request.node }); },
        async dispatch(request) {
            calls.push({ operation: "dispatch", node: request.node });
            const kind = plan.nodes[request.node]!.kind, input = request.reservation.input;
            observed.set(request.node, kind === "delivery" ? { kind: "prepared", candidate: input.candidate!, evidenceSha256: hashValue("prepared") }
                : kind === "check" ? { kind: "complete", outcome: "passed", candidate: input.candidate, evidenceSha256: hashValue(request.node) }
                : kind === "tournament" ? { kind: "complete", outcome: "selected", candidate: { ...input.branches![0]!.candidate!, owner: request.node }, evidenceSha256: hashValue(input.branches) }
                : { kind: "complete", outcome: "ready", candidate: candidateOf(request.node), evidenceSha256: hashValue(request.node) });
        },
        async observe(request) { calls.push({ operation: "observe", node: request.node }); return observed.get(request.node) ?? null; },
        async send(request) { calls.push({ operation: "send", node: request.node }); observed.set(request.node, { kind: "complete", outcome: "delivered", candidate: request.reservation.input.candidate, evidenceSha256: hashValue("sent") }); },
    };
    const authority = createGraphAuthority(plan, { actor: "Scripted engineering fixture", at: start, expiresAt: new Date(start.getTime() + 3600000).toISOString() });
    let state: GraphState = await initializeContainedGraph(directory, plan, authority, { now: () => start });
    for (let step = 0; step < 16 && state.phase !== "complete" && state.phase !== "failed"; step++) {
        state = await advanceContainedGraph(directory, driver, { now: clock });
        const hold = state.holds.find(row => row.kind === "human");
        if (hold) state = await decideContainedGraph(directory, { node: hold.node, expectedRevision: state.revision, inputSha256: hashValue(state.nodes[hold.node]!.reservation.input), choice: "continue", actor: "Scripted engineering fixture", note: "Fixture checkpoint." }, { now: clock });
        const send = state.holds.find(row => row.kind === "send");
        if (send) state = await sendContainedGraph(directory, { node: send.node, expectedRevision: state.revision, preparedSha256: hashValue(state.nodes[send.node]!.prepared), actor: "Scripted engineering fixture", note: "Fixture Send." }, driver, { now: clock });
    }
    const names = (await readdir(join(directory, "events"))).sort(), events = [];
    for (const name of names) events.push(JSON.parse(await readFile(join(directory, "events", name), "utf8")));
    return { directory, plan, state, calls, events };
}

// 1. Where decisions end and effects begin, on a serial and a tournament graph.
const classify = (kind: string) => kind === "dispatch" ? "durable marker before an effect" : ["prepared", "send"].includes(kind) ? "record of an effect's observable outcome" : kind === "decision" ? "external human input" : kind === "result" ? "validated outcome: an effect's observation, or a hold or fork computed inline" : "deterministic decision";
for (const [name, raw] of [["serial", graphFixture()], ["tournament", tournamentFixture()]] as const) {
    const run = await journey(name, raw, true);
    const kinds: Record<string, number> = {}; for (const event of run.events) kinds[event.kind] = (kinds[event.kind] ?? 0) + 1;
    const operations: Record<string, number> = {}; for (const call of run.calls) operations[call.operation] = (operations[call.operation] ?? 0) + 1;
    // Every effect call has a durable marker (or a Send record) before it.
    const effectsWithoutMarker = run.calls.filter(call => call.operation === "dispatch" || call.operation === "send").filter(call => !run.events.some(event => event.node === call.node && event.kind === (call.operation === "dispatch" ? "dispatch" : "send"))).length;
    record[name] = { phase: run.state.phase, events: run.events.length, eventKinds: Object.fromEntries(Object.entries(kinds).map(([kind, count]) => [kind, { count, role: classify(kind) }])), driverCalls: operations, effectsWithoutMarker,
        driverRoles: { preflight: "effect-free check before a marker", dispatch: "external effect (agent session, verifier, integration, tournament or delivery preparation)", observe: "read-only reconciliation of retained outcomes", send: "external publication" } };
}

// 2. Replay: identical recorded inputs and a fixed clock give byte-identical records; a live clock does not.
const [left, right, live] = [await journey("replay-a", graphFixture(), true), await journey("replay-b", graphFixture(), true), await journey("replay-live", graphFixture(), false)];
const chain = (run: typeof left) => run.events.map(event => event.sha256);
const decisionOf = (event: any) => ({ kind: event.kind, node: event.node, outcome: event.data?.outcome ?? event.data?.choice ?? null, to: event.data?.to ?? null, via: event.data?.via ?? null, reserved: event.data?.reservation ? { roleSessions: event.data.reservation.roleSessions, verificationAttempts: event.data.reservation.verificationAttempts } : null });
const replayed = await readContainedGraph(left.directory, { now: () => at }), again = await readContainedGraph(left.directory, { now: () => at });
record.replay = { fixedClockIdenticalChains: JSON.stringify(chain(left)) === JSON.stringify(chain(right)), liveClockIdenticalChains: JSON.stringify(chain(left)) === JSON.stringify(chain(live)),
    // The decisions themselves: each event's kind, node, outcome and route, without times or the digests that bind them.
    liveClockSameDecisions: JSON.stringify(left.events.map(decisionOf)) === JSON.stringify(live.events.map(decisionOf)),
    readTwiceIdenticalProjection: hashValue(replayed) === hashValue(again),
    reading: "The kernel is a pure function of its recorded events: the same observations and clock yield the same chain. With a live clock the same observations yield the same decisions and reservations; the times, deadlines and the digests that bind them differ, and are recorded rather than erased." };

// 3. What the kernel does besides deciding: static inventory of its non-deterministic operations.
const kernel = await readFile(resolve(import.meta.dir, "../packages/scheduler/src/contained.ts"), "utf8");
const count = (pattern: RegExp) => (kernel.match(pattern) ?? []).length;
record.kernelInventory = { clockReads: count(/clock\(options\)/g), randomIds: count(/randomUUID\(\)/g), fileWrites: count(/durableCreate\(/g), fileReads: count(/boundedFile\(/g) + count(/readdir\(/g), locks: count(/locked\(/g), driverCalls: count(/driver\.(preflight|dispatch|observe|send)/g),
    reading: "Time comes from one injected clock. Random ids name only staging files, never records. Every file read and write goes through the event store (load, durableCreate) and one lock. A second durable runtime therefore needs the event store, the lock and the clock behind an interface; decisions (apply, resolveRoute, expectedInput) move unchanged." };

// 4. The loop controller is a different shape: a stage machine that calls effects inline.
const controller = await readFile(resolve(import.meta.dir, "../packages/workflow/src/contained.ts"), "utf8");
record.loopController = { serviceCalls: [...new Set((controller.match(/services\.(\w+)\(/g) ?? []).map(call => call.slice(9, -1)))].sort(), roleExecutions: (controller.match(/executeRole|services\.executeRole|runRole/g) ?? []).length,
    reading: "A contained loop interleaves decisions with agent sessions, verifiers, capture and delivery in one stage machine with its own journal and reconciliation. Replaying it inside a deterministic workflow would re-run effects; it fits a second runtime only as one bounded activity per loop node, resumed from its own journal." };

// 5. Prerequisites for the Temporal prototype on this machine.
const which = (binary: string) => Bun.which(binary, { PATH: process.env.PATH ?? "" });
const nodeVersion = which("node") ? Bun.spawnSync(["node", "--version"], { stdout: "pipe" }).stdout.toString().trim() : null;
record.temporalPrerequisites = { temporalCli: which("temporal") ? "present" : "absent", sdkPackages: await Bun.file(resolve(import.meta.dir, "../node_modules/@temporalio/client/package.json")).exists() ? "present" : "absent", node: nodeVersion, bunWorkers: "not supported by the official TypeScript SDK (per its documentation); an adapter worker would run on Node",
    reading: "No Temporal CLI, server or SDK is installed here. Prototyping compatibility and recovery against a local service needs them downloaded, which needs the operator's explicit approval. Nothing was downloaded." };

await mkdir(output, { recursive: true });
await writeFile(join(output, "phase7-baseline.json"), JSON.stringify(JSON.parse(JSON.stringify(record).replaceAll(scratch, "[scratch]")), null, 2) + "\n");
console.log(JSON.stringify(record, null, 2));
await rm(scratch, { recursive: true, force: true });
