/** TEST FIXTURE ONLY (Bun). Builds the inputs both backends replay.
 *
 *   bun scenario.ts prepare SCENARIO DIRECTORY AT
 *     DIRECTORY/local     the local backend's complete run, with a fixed clock at AT
 *     DIRECTORY/temporal  the same graph admitted at AT (plan, grant, start event), for a workflow to continue
 *     DIRECTORY/captured.json  every observation the local driver returned, and the scripted holds
 *   bun scenario.ts read STATE    the local kernel's replay of a state directory, as JSON
 *
 * The driver is a deterministic function of each node's kind and reservation; the
 * holds are scripted engineering checkpoints, never human acceptance. */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compileContainedGraph, createGraphAuthority, hashValue } from "../../../../packages/plan/src";
import { advanceContainedGraph, decideContainedGraph, initializeContainedGraph, readContainedGraph, sendContainedGraph, type GraphDriver, type GraphObservation, type GraphState } from "../../../../packages/scheduler/src";
import { delegateFixture, graphFixture, parallelFixture, tournamentFixture } from "../../../../packages/plan/test/graph-fixtures";

const SCENARIOS: Record<string, { graph: () => any; choices?: Record<string, "continue" | "reject">; check?: "passed" | "failed" }> = {
    serial: { graph: graphFixture },
    parallel: { graph: parallelFixture },
    tournament: { graph: tournamentFixture },
    delegate: { graph: delegateFixture },
    rejected: { graph: graphFixture, choices: { review: "reject" } },
    "check-fails": { graph: graphFixture, check: "failed" },
};
const [action, ...rest] = process.argv.slice(2);
const actor = "Scripted engineering fixture";

if (action === "read") {
    const state = await readContainedGraph(resolve(rest[0]!));
    console.log(JSON.stringify({ phase: state.phase, revision: state.revision, events: state.events.map(event => ({ sequence: event.sequence, kind: event.kind, node: event.node })), active: state.active, holds: state.holds, reserved: state.reserved,
        uncertain: state.active.filter(id => state.nodes[id]?.dispatched && !state.nodes[id]?.result) }));
} else if (action === "decide") {
    // A second controller acting on the same directory, through the local kernel.
    const directory = resolve(rest[0]!), node = rest[1]!, state = await readContainedGraph(directory);
    await decideContainedGraph(directory, { node, expectedRevision: state.revision, inputSha256: hashValue(state.nodes[node]!.reservation.input), choice: "continue", actor, note: "A second controller's checkpoint." });
    console.log(JSON.stringify({ decided: node }));
} else if (action === "local-until") {
    // The local backend advances an admitted directory through the first COUNT scripted holds, then stops at the next hold.
    const [name, stateArgument, atArgument, countArgument] = rest, scenario = SCENARIOS[name!]!, state0 = resolve(stateArgument!), at = new Date(atArgument!), now = () => at;
    const captured = JSON.parse(await readFile(join(state0, "..", "captured.json"), "utf8")), actions = captured.actions.slice(0, Number(countArgument));
    let finished = new Set<string>();
    const driver: GraphDriver = {
        async dispatch(request) { finished.add(`dispatch ${request.node}`); },
        async observe(request) { const rows = captured.observations[request.node] ?? {}; return finished.has(`send ${request.node}`) ? rows.send : finished.has(`dispatch ${request.node}`) ? rows.dispatch : null; },
        async send(request) { finished.add(`send ${request.node}`); },
    };
    let state = await advanceContainedGraph(state0, driver, { now });
    for (const step of actions) {
        if (step.kind === "decide") state = await decideContainedGraph(state0, { node: step.node, expectedRevision: state.revision, inputSha256: hashValue(state.nodes[step.node]!.reservation.input), choice: step.choice, actor: step.actor, note: step.note }, { now });
        else state = await sendContainedGraph(state0, { node: step.node, expectedRevision: state.revision, preparedSha256: hashValue(state.nodes[step.node]!.prepared), actor: step.actor, note: step.note }, driver, { now });
        state = await advanceContainedGraph(state0, driver, { now });
    }
    void scenario;
    console.log(JSON.stringify({ phase: state.phase, events: state.events.length, holds: state.holds }));
} else if (action === "prepare") {
    const [name, directoryArgument, atArgument] = rest, scenario = SCENARIOS[name!];
    if (!scenario) throw new Error(`Unknown scenario ${name}; use ${Object.keys(SCENARIOS).join(", ")}`);
    const directory = resolve(directoryArgument!), at = new Date(atArgument!), now = () => at;
    const raw = scenario.graph(); raw.budget.wallClockSeconds = 3600;
    const plan = compileContainedGraph(raw), authority = createGraphAuthority(plan, { actor, at, expiresAt: new Date(at.getTime() + 3600000).toISOString() });
    const candidateOf = (node: string) => ({ source: { ...plan.repository, commit: hashValue(node).slice(0, 40) }, tree: hashValue(`tree-${node}`).slice(0, 40), owner: node });
    const captured: Record<string, { dispatch?: GraphObservation; send?: GraphObservation }> = {}, observed = new Map<string, GraphObservation>();
    const keep = (node: string, phase: "dispatch" | "send", observation: GraphObservation) => { (captured[node] ??= {})[phase] = observation; observed.set(node, observation); };
    const driver: GraphDriver = {
        async dispatch(request) {
            const kind = plan.nodes[request.node]!.kind, input = request.reservation.input;
            keep(request.node, "dispatch", kind === "delivery" ? { kind: "prepared", candidate: input.candidate!, evidenceSha256: hashValue(`prepared-${request.node}`) }
                : kind === "check" ? { kind: "complete", outcome: scenario.check ?? "passed", candidate: input.candidate, evidenceSha256: hashValue(`check-${request.node}`) }
                : kind === "tournament" ? { kind: "complete", outcome: "selected", candidate: { ...input.branches![0]!.candidate!, owner: request.node }, evidenceSha256: hashValue(input.branches) }
                : kind === "join" ? { kind: "complete", outcome: "integrated", candidate: candidateOf(request.node), evidenceSha256: hashValue(input.branches) }
                : kind === "delegate" ? { kind: "complete", outcome: "returned", candidate: candidateOf(request.node), evidenceSha256: hashValue(`returned-${request.node}`) }
                : { kind: "complete", outcome: "ready", candidate: candidateOf(request.node), evidenceSha256: hashValue(`loop-${request.node}`) });
        },
        async observe(request) { return observed.get(request.node) ?? null; },
        async send(request) { keep(request.node, "send", { kind: "complete", outcome: "delivered", candidate: request.reservation.input.candidate, evidenceSha256: hashValue(`sent-${request.node}`) }); },
    };
    const local = join(directory, "local"), temporal = join(directory, "temporal"), actions: unknown[] = [];
    await mkdir(directory, { recursive: true });
    await initializeContainedGraph(temporal, plan, authority, { now });
    let state: GraphState = await initializeContainedGraph(local, plan, authority, { now });
    for (let step = 0; step < 32 && state.phase !== "complete" && state.phase !== "failed"; step++) {
        state = await advanceContainedGraph(local, driver, { now });
        const hold = state.holds.find(row => row.kind === "human"), send = state.holds.find(row => row.kind === "send");
        if (hold) {
            const choice = scenario.choices?.[hold.node] ?? "continue", note = `Fixture checkpoint at ${hold.node}; not independent human acceptance.`;
            actions.push({ kind: "decide", node: hold.node, choice, actor, note });
            state = await decideContainedGraph(local, { node: hold.node, expectedRevision: state.revision, inputSha256: hashValue(state.nodes[hold.node]!.reservation.input), choice, actor, note }, { now });
        } else if (send) {
            const note = `Fixture Send of ${send.node} to a test origin.`;
            actions.push({ kind: "send", node: send.node, actor, note });
            state = await sendContainedGraph(local, { node: send.node, expectedRevision: state.revision, preparedSha256: hashValue(state.nodes[send.node]!.prepared), actor, note }, driver, { now });
        }
    }
    const events = (await readdir(join(local, "events"))).sort();
    await writeFile(join(directory, "captured.json"), JSON.stringify({ scenario: name, at: at.toISOString(), graphSha256: plan.sha256, schema: plan.schema_version, phase: state.phase, events: events.length, observations: captured, actions }, null, 2) + "\n");
    console.log(JSON.stringify({ phase: state.phase, events: events.length, local, temporal, first: JSON.parse(await readFile(join(local, "events", events[0]!), "utf8")).sha256 }));
} else throw new Error("Use prepare or read");
