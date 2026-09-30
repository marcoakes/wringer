/** One graph driver operation for an external controller, such as the Temporal
 * adapter, bound to what this state directory's retained history records.
 *
 * The controller decides; this runs one effect for it. A preflight needs a
 * reserved node without its marker. A dispatch or Send needs the kernel's durable
 * marker for it and no recorded result, and claims that marker once: a second
 * attempt at the same marker is refused before the driver runs, whoever makes it.
 * An observation is read-only and can repeat. The history is replayed and
 * revalidated in full before anything runs. */
import { lstat, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { readContainedGraph, type GraphDriver, type GraphEffectRequest, type GraphObservation } from "@wringer/scheduler";
import { safePath } from "@wringer/workflow";
import { containedGraphDriver } from "./graph";

export type GraphEffectOperation = "preflight-dispatch" | "preflight-send" | "dispatch" | "observe" | "send";
/** A function, not a module constant: the compiled CLI can read it before this module's initialiser has run. */
export function graphEffectOperations(): GraphEffectOperation[] { return ["preflight-dispatch", "preflight-send", "dispatch", "observe", "send"]; }
export interface GraphEffectOutcome { operation: GraphEffectOperation; node: string; revision: string; observation?: GraphObservation | null; }

function fail(message: string): never { throw new Error(message); }
/** Create-once record that this marker's effect was started; never removed. */
async function claim(directory: string, node: string, kind: "dispatch" | "send", revision: string) {
    const claims = await safePath(directory, ".wringer/graph-effects");
    await mkdir(claims, { recursive: true, mode: 0o700 });
    const stat = await lstat(claims);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("Graph effect claims must be a real directory");
    let handle;
    try { handle = await open(join(claims, `${node}.${kind}.json`), "wx", 0o600); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") fail(`The ${kind} of ${node} was already started for this marker; it is never started twice. Observe it instead.`);
        throw error;
    }
    try { await handle.writeFile(JSON.stringify({ node, kind, revision }) + "\n"); await handle.sync(); } finally { await handle.close(); }
}

export async function runGraphEffect(directory: string, operation: GraphEffectOperation, node: string, options: { signal?: AbortSignal; driver?: GraphDriver } = {}): Promise<GraphEffectOutcome> {
    if (!graphEffectOperations().includes(operation)) fail(`Unknown graph effect operation ${operation}`);
    const state = await readContainedGraph(directory), row = state.nodes[node];
    if (!state.plan.nodes[node]) fail(`${node} is not a node of this graph; no effect ran`);
    if (!row) fail(`${node} has no reservation in this graph history; no effect ran`);
    const driver = options.driver ?? containedGraphDriver({ signal: options.signal });
    const request: GraphEffectRequest = { directory, plan: state.plan, authority: state.authority, node, reservation: row.reservation, signal: options.signal };
    const outcome: GraphEffectOutcome = { operation, node, revision: state.revision };
    if (operation === "preflight-dispatch") {
        if (row.dispatched || row.result) fail(`${node} already has a dispatch marker; a preflight comes before it`);
        await driver.preflight?.(request, "dispatch");
    } else if (operation === "preflight-send") {
        if (!row.prepared || row.sent || row.result) fail(`${node} has no prepared, unsent delivery to preflight`);
        await driver.preflight?.(request, "send");
    } else if (operation === "dispatch") {
        if (!row.dispatched || row.result) fail(`${node} has no durable dispatch marker without a result; nothing was started`);
        await claim(directory, node, "dispatch", state.revision);
        await driver.dispatch(request);
    } else if (operation === "observe") {
        if (!row.dispatched) fail(`${node} was never dispatched; there is nothing to observe`);
        outcome.observation = await driver.observe(request);
    } else {
        if (!row.sent || !row.prepared || row.result) fail(`${node} has no durable Send marker without a result; nothing was pushed`);
        await claim(directory, node, "send", state.revision);
        await driver.send(request, row.prepared);
    }
    return outcome;
}
