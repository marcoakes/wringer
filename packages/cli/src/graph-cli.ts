/** Thin routes for contained serial graphs. The kernel, adapter and view live in
 * scheduler/application; this file parses arguments and prints results. No
 * fixture driver, clock or crash hook is reachable from here. */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closesFork, createGraphAuthority, graphReservation, validateGraphAuthority, type ContainedGraphNode, type GraphAuthority } from "@wringer/plan";
import { advanceContainedGraph, decideContainedGraph, initializeContainedGraph, readContainedGraph, sendContainedGraph, type GraphState } from "@wringer/scheduler";
import { attachGraphRootSource, containedGraphDriver, exportContainedGraph, graphStatusView, loadContainedGraphFile, readControllerFile, renderGraphStatus } from "@wringer/application";
import { EngineError } from "@wringer/engine";
import { allowed, flag, positionals, quote, required, type Args } from "./args";
import type { Answer, DispatchContext } from "./app";

export const GRAPH_HELP = `wringer-drive graph · serial graphs of contained loops

  wringer-drive graph plan GRAPH.yaml            Validate, pin every leaf plan and show the allowance; no spend
  wringer-drive graph authority GRAPH.yaml --actor NAME --expires ISO --output AUTH.json
  wringer-drive graph run GRAPH.yaml --authority AUTH.json --state DIR [--source-bundle FILE]
  wringer-drive graph resume --state DIR          Advance or reconcile; never a new grant or a repeated effect
  wringer-drive graph status --state DIR          Nodes, candidates, allowance and the exact next action
  wringer-drive graph decide --state DIR --node ID --revision SHA --input SHA (--continue | --reject) --by NAME --note TEXT
  wringer-drive graph send --state DIR --node ID --revision SHA --prepared SHA --by NAME --note TEXT
  wringer-drive graph export --state DIR --output DIR

Version 2 graphs add fork and join: a fork opens 2–8 private branches, up to
the declared parallelism at once; the join waits for every branch, merges their
exact candidates deterministically and verifies the result afresh against every
branch plan (integrated, failed, conflict or unavailable). A failure in any
branch ends the graph and cancels the others. A delivery of an integrated
candidate publishes the graph's own portable evidence with the merged code.
Each loop node is an ordinary contained journey under children/NODE/state, with
its own status, review and resume commands. Allowance for every declared leaf is
reserved before any effect. A human hold binds the exact revision and input; it
does not satisfy a child's own human criteria. Delivery is prepared, then needs
a separate Send. Graph authority never grants Send.
Exit: 0 complete, 1 failed, 3 waiting (hold, Send, uncertain, expired), 2 refused.
Legacy host graphs stay readable with wring graph show|status|explain.`;

const exitFor = (state: GraphState) => state.phase === "complete" ? 0 : state.phase === "failed" ? 1 : 3;
const statePath = (repo: string, a: Args) => resolve(repo, required(a, "state"));
function answer(directory: string, state: GraphState, lead?: string): Answer {
    const view = graphStatusView(directory, state);
    return { value: view, text: `${lead ? `${lead}\n` : ""}${renderGraphStatus(view)}`, exit: exitFor(state) };
}
/** Refusals from an effect-free preflight or a validated transition: nothing new was recorded. */
async function guarded(directory: string, action: () => Promise<GraphState>, context: DispatchContext): Promise<GraphState> {
    try { return await action(); }
    catch (error) {
        if (error instanceof EngineError) throw error;
        throw new EngineError(`${(error as Error).message}\nThe graph history was revalidated; inspect it before acting again.`, context.signal?.aborted ? 4 : 3, `wringer-drive graph status --state ${quote(directory)}`);
    }
}
export async function graphDrive(a: Args, repo: string, context: DispatchContext): Promise<Answer> {
    const verb = a.words[0];
    if (!verb || flag(a, "help")) return { text: GRAPH_HELP };
    context.signal?.throwIfAborted();
    if (verb === "plan") {
        positionals(a, 2); allowed(a, []);
        const path = resolve(repo, a.words[1]!), plan = await loadContainedGraphFile(path);
        const roles = Object.keys(plan.nodes).reduce((sum, id) => sum + graphReservation(plan, id).roleSessions, 0);
        const edge = (node: ContainedGraphNode) => node.kind === "router" ? `${node.routes.map(route => `${route.outcome}→${route.to}`).join(", ")}, otherwise→${node.otherwise}` : node.kind === "fork" ? `branches ${node.branches.join(", ")}; join ${node.join}` : node.then;
        const lines = Object.entries(plan.nodes).map(([id, node]) => `  ${id} · ${node.kind} · ${closesFork(node) ? `fork ${node.fork}` : `input ${node.input}`} → ${edge(node)}${node.kind === "loop" ? ` · plan ${node.plan.plan_sha256.slice(0, 12)}` : ""}${node.kind === "tournament" ? ` · 1 prosecutor, ${node.controls.length} trusted control${node.controls.length === 1 ? "" : "s"}, ${node.evaluator.length} final evaluator gate${node.evaluator.length === 1 ? "" : "s"}, ties → ${node.tie}` : ""}${node.kind === "delivery" ? ` · ${node.publication.sourceBranch} → ${node.publication.targetBranch} (Send is separate)` : ""}`);
        return { value: plan, text: `Contained graph ${plan.id} validated: ${plan.sha256}\nSource ${plan.repository.url} @ ${plan.repository.commit}\nEntry ${plan.entry}; required ${plan.required.join(", ")}.\n${lines.join("\n")}\nDeclared leaves reserve ${roles}/${plan.budget.maxRoleSessions} role sessions; verifier ceiling ${plan.budget.maxVerificationAttempts}; wall clock ${plan.budget.wallClockSeconds} s${plan.parallelism ? `; up to ${plan.parallelism} branches at once` : ""}.\nNo agent, container or repository command ran.\nNext: wringer-drive graph authority ${quote(path)} --actor 'YOUR NAME' --expires 'EXPIRY IN ISO-8601' --output graph-authority.json` };
    }
    if (verb === "authority") {
        positionals(a, 2); allowed(a, ["actor", "expires", "output"]);
        const path = resolve(repo, a.words[1]!), plan = await loadContainedGraphFile(path);
        const authority = createGraphAuthority(plan, { actor: required(a, "actor"), expiresAt: required(a, "expires") }), output = resolve(repo, required(a, "output"));
        await writeFile(output, JSON.stringify(authority, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        return { value: { path: output, authority }, text: `Graph authority saved: ${output}\nGraph ${plan.sha256}; expires ${authority.expiresAt}.\nIt grants the declared allowance only. No human verdict, Send or sandbox bypass was granted.\nNext: wringer-drive graph run ${quote(path)} --authority ${quote(output)} --state GRAPH-STATE-DIRECTORY` };
    }
    if (verb === "run") {
        positionals(a, 2); allowed(a, ["authority", "state", "source-bundle"]);
        const path = resolve(repo, a.words[1]!), plan = await loadContainedGraphFile(path), directory = statePath(repo, a);
        let authority: GraphAuthority;
        try { authority = validateGraphAuthority(await readControllerFile(resolve(repo, required(a, "authority"))), plan); }
        catch (error) { throw new EngineError(`Graph authority refused: ${(error as Error).message}`, 2, `wringer-drive graph authority ${quote(path)} --help`); }
        await initializeContainedGraph(directory, plan, authority);
        if (a.flags.has("source-bundle")) await attachGraphRootSource(directory, resolve(repo, required(a, "source-bundle")));
        const state = await guarded(directory, () => advanceContainedGraph(directory, containedGraphDriver({ signal: context.signal }), { signal: context.signal }), context);
        return answer(directory, state, `Graph started at ${directory}.`);
    }
    if (verb === "resume") {
        positionals(a, 1); allowed(a, ["state"]);
        const directory = statePath(repo, a);
        return answer(directory, await guarded(directory, () => advanceContainedGraph(directory, containedGraphDriver({ signal: context.signal }), { signal: context.signal }), context));
    }
    if (verb === "status") {
        positionals(a, 1); allowed(a, ["state"]);
        const directory = statePath(repo, a);
        return answer(directory, await readContainedGraph(directory));
    }
    if (verb === "decide") {
        positionals(a, 1); allowed(a, ["state", "node", "revision", "input", "continue", "reject", "by", "note"]);
        if (flag(a, "continue") === flag(a, "reject")) throw new EngineError("Choose exactly one of --continue or --reject; nothing was recorded", 2);
        const directory = statePath(repo, a), decision = { node: required(a, "node"), expectedRevision: required(a, "revision"), inputSha256: required(a, "input"), choice: flag(a, "continue") ? "continue" as const : "reject" as const, actor: required(a, "by"), note: required(a, "note") };
        const state = await guarded(directory, () => decideContainedGraph(directory, decision), context);
        return { ...answer(directory, state, `Decision recorded in ${decision.actor}'s words. It binds revision ${decision.expectedRevision.slice(0, 12)} and this exact input; it is not a child's human acceptance.`), exit: 0 };
    }
    if (verb === "send") {
        positionals(a, 1); allowed(a, ["state", "node", "revision", "prepared", "by", "note"]);
        const directory = statePath(repo, a), send = { node: required(a, "node"), expectedRevision: required(a, "revision"), preparedSha256: required(a, "prepared"), actor: required(a, "by"), note: required(a, "note") };
        const state = await guarded(directory, () => sendContainedGraph(directory, send, containedGraphDriver({ signal: context.signal }), { signal: context.signal }), context);
        return answer(directory, state, state.phase === "complete" ? "The exact prepared evidence branch was sent." : "Send was recorded; its outcome is not yet confirmed and will be reconciled read-only, never sent again.");
    }
    if (verb === "export") {
        positionals(a, 1); allowed(a, ["state", "output"]);
        const directory = statePath(repo, a), output = resolve(repo, required(a, "output")), value = await exportContainedGraph(directory, output);
        return { value, text: `Graph evidence exported: ${output}\n${Object.keys(value.files).length} files carried with digests, ${value.nodes.filter(node => node.delivery).length} delivery envelope(s), ${value.omissions.length} named omissions.\nCheck it anywhere with Node alone: node ${quote(output + "/read-bundle.mjs")} ${quote(output)}` };
    }
    throw new EngineError(`Unknown graph verb ${verb}. See wringer-drive graph --help.`, 2);
}
