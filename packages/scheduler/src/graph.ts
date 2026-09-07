import { readFile, mkdir } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { Bundle, EngineError, Redactor, loadConfig, newId, now, parseYaml, safePath, sha256, run, type EventCallback } from "@wringer/engine";
import { deliver } from "@wringer/delivery";
import { boundedSignal, integer, isObject, keys, ledger, slug, strings, type Obj } from "./shared";
export const GRAPH_KINDS = ["intent", "human", "loop", "router", "deliver"] as const;
export interface GraphNode {
    kind: typeof GRAPH_KINDS[number];
    then?: string;
    input?: string;
    prompt?: string;
    writes?: Record<string, string>;
    budgets?: {
        max_iterations?: number;
        wall_clock?: number;
    };
    routes?: {
        when: string;
        to: string;
    }[];
    default?: string;
}
export interface GraphDefinition {
    version: 1;
    id: string;
    inputs: Record<string, string>;
    state: Record<string, string>;
    budgets: {
        wall_clock: number;
    };
    nodes: Record<string, GraphNode>;
}
export interface GraphOptions {
    send?: boolean;
    signal?: AbortSignal;
    onEvent?: EventCallback;
    resume?: string;
}
export interface GraphOutcome {
    status: "done" | "failed" | "parked" | "interrupted";
    reason: string;
    graph_dir: string;
    current_node: string | null;
    completed: string[];
    exit_code: number;
    next_move: string;
    state: Record<string, string>;
}
function expression(text: string): {
    key: string;
    matches: (value: string | undefined) => boolean;
} {
    const scalar = /^state\.([A-Za-z0-9_-]+)\s*(==|!=)\s*'([^']*)'$/.exec(text.trim());
    if (scalar) {
        const [, key, operator, value] = scalar;
        return { key: key!, matches: v => v !== undefined && (operator === "==" ? v === value : v !== value) };
    }
    const list = /^state\.([A-Za-z0-9_-]+)\s+in\s+\[\s*('([^']*)'(?:\s*,\s*'[^']*')*)\s*\]$/.exec(text.trim());
    if (list) {
        const values = [...list[2]!.matchAll(/'([^']*)'/g)].map(v => v[1]);
        return { key: list[1]!, matches: v => v !== undefined && values.includes(v) };
    }
    throw new EngineError(`Unsupported route '${text}'. Use state.NAME == 'value', != 'value', or in ['a', 'b'].`);
}
const edges = (node: GraphNode) => node.kind === "router" ? [...node.routes!.map(r => r.to), node.default!] : [node.then!];
export function validateGraph(value: unknown): GraphDefinition {
    if (!isObject(value))
        throw new EngineError("A graph must be a mapping.");
    keys(value, ["version", "id", "inputs", "state", "budgets", "nodes"], "graph");
    if (value.version !== 1)
        throw new EngineError("Graph version must be 1.");
    slug(value.id, "graph.id");
    const inputs = strings(value.inputs ?? {}, "graph.inputs"), state = strings(value.state ?? {}, "graph.state");
    for (const key of [...Object.keys(inputs), ...Object.keys(state)])
        slug(key, "State or input name");
    if (!isObject(value.budgets))
        throw new EngineError("Declare graph.budgets.wall_clock before starting work.");
    keys(value.budgets, ["wall_clock"], "graph.budgets");
    integer(value.budgets.wall_clock, "graph.budgets.wall_clock");
    if (!isObject(value.nodes) || Object.keys(value.nodes).length === 0)
        throw new EngineError("A graph needs at least one node.");
    const nodes = value.nodes as Record<string, GraphNode>;
    for (const [id, node] of Object.entries(nodes)) {
        slug(id, "node id");
        if (["done", "fail"].includes(id))
            throw new EngineError(`'${id}' is a reserved graph sink.`);
        if (!isObject(node))
            throw new EngineError(`Node ${id} must be a mapping.`);
        const allowed: Record<GraphNode["kind"], string[]> = { intent: ["kind", "input", "then", "writes"], human: ["kind", "prompt", "then"], loop: ["kind", "budgets", "writes", "then"], router: ["kind", "routes", "default"], deliver: ["kind", "then"] };
        if (!GRAPH_KINDS.includes(node.kind))
            throw new EngineError(`Node ${id} has unsupported kind ${node.kind}.`);
        keys(node, allowed[node.kind as GraphNode["kind"]], `node ${id}`);
        if (node.kind !== "router" && typeof node.then !== "string")
            throw new EngineError(`Node ${id} needs 'then'.`);
        if (node.kind === "intent" && (!node.input?.startsWith("inputs.") || !(node.input.slice(7) in inputs)))
            throw new EngineError(`Node ${id} must name a declared inputs.NAME.`);
        if (node.kind === "human" && (typeof node.prompt !== "string" || !node.prompt.trim()))
            throw new EngineError(`Human node ${id} needs a review prompt.`);
        if (node.writes) {
            strings(node.writes, `node ${id} writes`);
            for (const path of Object.values(node.writes))
                if (!/^state\.[A-Za-z0-9_-]+$/.test(path))
                    throw new EngineError(`Node ${id} writes must name state.NAME.`);
        }
        if (node.budgets) {
            if (!isObject(node.budgets))
                throw new EngineError(`Node ${id} budgets must be a mapping.`);
            keys(node.budgets, ["max_iterations", "wall_clock"], `node ${id} budgets`);
            for (const [k, v] of Object.entries(node.budgets))
                integer(v, `${id}.${k}`);
        }
        if (node.kind === "router") {
            if (!Array.isArray(node.routes) || !node.routes.length || typeof node.default !== "string")
                throw new EngineError(`Router ${id} needs routes and a default.`);
            for (const route of node.routes) {
                if (!isObject(route))
                    throw new EngineError(`Router ${id} route must be a mapping.`);
                keys(route, ["when", "to"], `router ${id}`);
                if (typeof route.when !== "string" || typeof route.to !== "string")
                    throw new EngineError(`Router ${id} routes need when and to strings.`);
                expression(route.when);
            }
        }
    }
    const incoming = new Map(Object.keys(nodes).map(k => [k, [] as string[]]));
    for (const [id, node] of Object.entries(nodes))
        for (const target of edges(node)) {
            if (target in nodes)
                incoming.get(target)!.push(id);
            else if (!["done", "fail"].includes(target))
                throw new EngineError(`Node ${id} targets unknown node '${target}'.`);
        }
    const starts = [...incoming].filter(([, from]) => !from.length).map(([id]) => id);
    if (starts.length !== 1)
        throw new EngineError(`A graph needs exactly one start node; found ${starts.length}. Check disconnected nodes or cycles.`);
    const visited = new Set<string>(), active = new Set<string>();
    function walk(id: string) {
        if (["done", "fail"].includes(id))
            return;
        if (active.has(id))
            throw new EngineError(`Graph cycle reaches ${id}; keep retries inside a bounded loop node.`);
        if (visited.has(id))
            return;
        active.add(id);
        for (const next of edges(nodes[id]!))
            walk(next);
        active.delete(id);
        visited.add(id);
    }
    walk(starts[0]!);
    if (visited.size !== Object.keys(nodes).length)
        throw new EngineError("The graph contains unreachable nodes or a disconnected cycle.");
    const known = new Map<string, Set<string>>();
    function available(id: string): Set<string> {
        if (known.has(id))
            return known.get(id)!;
        const parents = incoming.get(id)!;
        const all = parents.map(p => new Set([...available(p), ...Object.values(nodes[p]!.writes ?? {}).map(s => s.slice(6))]));
        const set = all.length ? new Set([...all[0]!].filter(k => all.every(s => s.has(k)))) : new Set(Object.keys(state));
        known.set(id, set);
        return set;
    }
    for (const [id, node] of Object.entries(nodes))
        if (node.kind === "router")
            for (const route of node.routes!)
                if (!available(id).has(expression(route.when).key))
                    throw new EngineError(`Router ${id} reads state.${expression(route.when).key}, which is not declared on every incoming path.`);
    return { version: 1, id: value.id, inputs, state, budgets: { wall_clock: value.budgets.wall_clock }, nodes };
}
export async function loadGraph(path: string): Promise<GraphDefinition> { return validateGraph(parseYaml(await readFile(path, "utf8"), "graph")); }
function start(graph: GraphDefinition) { const targeted = new Set(Object.values(graph.nodes).flatMap(edges)); return Object.keys(graph.nodes).find(id => !targeted.has(id))!; }
export function renderGraph(graph: GraphDefinition): string {
    graph = validateGraph(graph);
    const lines = ["flowchart TD"];
    for (const [id, node] of Object.entries(graph.nodes)) {
        lines.push(`  ${id}["${id}: ${node.kind}"]`);
        for (const target of edges(node))
            lines.push(`  ${id} --> ${target}`);
    }
    return lines.join("\n") + "\n";
}
export async function graphStatus(repo: string, directory: string): Promise<GraphOutcome> {
    const path = await safePath(repo, directory), events = await ledger(path, "graph.jsonl"), last = [...events].reverse().find(e => e.type === "graph.finished");
    const definition = validateGraph(JSON.parse(await readFile(join(path, "graph.resolved.json"), "utf8")));
    const completed = events.filter(e => e.type === "node.finished").map(e => e.node_id), state: Record<string, string> = { ...definition.state };
    for (const e of events)
        if (e.type === "state.updated")
            state[e.path.replace(/^state\./, "")] = e.value;
    return { status: last?.status ?? "interrupted", reason: last?.reason ?? "No terminal event was recorded", graph_dir: relative(repo, path), current_node: last?.node_id ?? null, completed, exit_code: last?.status === "done" ? 0 : last?.status === "parked" ? 5 : last?.status === "interrupted" ? 4 : 1, next_move: `wring graph resume ${relative(repo, path)}`, state };
}
export async function runGraph(repo: string, input: string | GraphDefinition, options: GraphOptions = {}): Promise<GraphOutcome> {
    repo = resolve(repo);
    const config = await loadConfig(repo);
    const directory = await safePath(repo, options.resume ?? `.wringer/graphs/${newId()}`);
    const previous = options.resume ? await ledger(directory, "graph.jsonl") : [];
    const graph = options.resume ? validateGraph(JSON.parse(await readFile(join(directory, "graph.resolved.json"), "utf8"))) : typeof input === "string" ? await loadGraph(await safePath(repo, input)) : validateGraph(input);
    const started = previous.find(e => e.type === "graph.started");
    if (options.resume && (!started || started.detail !== sha256(JSON.stringify(graph))))
        throw new EngineError("Resolved graph differs from the graph the ledger started. Resume refuses changed instructions.", 3);
    if (previous.at(-1)?.type === "graph.finished" && previous.at(-1)?.status === "done")
        throw new EngineError("This graph already completed; there is nothing to resume.");
    const last = previous.at(-1);
    if (last?.type === "graph.finished" && last.status === "parked" && graph.nodes[last.node_id]?.kind === "human") {
        const decision = parseYaml(await readFile(await safePath(directory, `nodes/${last.node_id}/decision.yaml`), "utf8"), "human decision");
        if (isObject(decision) && decision.approved === false)
            return graphStatus(repo, relative(repo, directory));
    }
    const bundle = await new Bundle(directory, new Redactor(config.evidence.redact.env), "graph.jsonl", options.onEvent).prepare();
    const startedAt = started?.ts ?? now();
    const deadline = Date.parse(startedAt) + graph.budgets.wall_clock * 1000;
    const completed = previous.filter(e => e.type === "node.finished").map(e => String(e.node_id)), state = { ...graph.state };
    for (const e of previous)
        if (e.type === "state.updated")
            state[e.path.replace(/^state\./, "")] = e.value;
    let current = completed.length ? String([...previous].reverse().find(e => e.type === "node.finished")!.to) : start(graph);
    let finalRun: string | undefined = [...previous].reverse().find(e => e.type === "node.finished" && e.kind === "loop")?.ref;
    let status: GraphOutcome["status"] = "failed", reason = "", exitCode = 1, sendUsed = false;
    if (!options.resume) {
        await bundle.json("graph.resolved.json", graph);
        await bundle.event("graph.started", { graph_id: graph.id, detail: sha256(JSON.stringify(graph)) });
    }
    else
        await bundle.event("graph.resumed", { graph_id: graph.id });
    while (!["done", "fail"].includes(current)) {
        if (options.signal?.aborted) {
            status = "interrupted";
            reason = "Interrupted by the operator";
            exitCode = 4;
            break;
        }
        if (Date.now() >= deadline) {
            reason = "The whole-graph wall clock is exhausted.";
            await bundle.event("budget.exhausted", { budget: "wall_clock" });
            break;
        }
        const node = graph.nodes[current]!;
        await bundle.event("node.started", { node_id: current, kind: node.kind });
        let next = node.then!, ref: string | undefined;
        try {
            const updates: Record<string, string> = {};
            if (node.kind === "intent") {
                const text = await readFile(await safePath(repo, graph.inputs[node.input!.slice(7)]!), "utf8");
                await bundle.write(`nodes/${current}/intent.md`, text);
                for (const path of Object.values(node.writes ?? {}))
                    updates[path] = relative(repo, join(directory, "nodes", current, "intent.md"));
            }
            else if (node.kind === "human") {
                const path = join(directory, "nodes", current, "decision.yaml");
                await mkdir(join(directory, "nodes", current), { recursive: true });
                if (!await Bun.file(path).exists()) {
                    await bundle.write(`nodes/${current}/prompt.md`, node.prompt!);
                    await bundle.write(`nodes/${current}/decision.yaml`, `approved: false\ncomments: ""\nstate_updates: {}\n`);
                }
                const decision = parseYaml(await readFile(await safePath(directory, relative(directory, path)), "utf8"), "human decision");
                if (!isObject(decision))
                    throw new EngineError("Human decision must be a mapping.");
                keys(decision, ["approved", "comments", "state_updates"], "human decision");
                if (typeof decision.approved !== "boolean")
                    throw new EngineError("Human decision approved must be true or false.");
                if (!decision.approved) {
                    status = "parked";
                    reason = node.prompt!;
                    exitCode = 5;
                    await bundle.event("node.parked", { node_id: current, kind: node.kind, reason });
                    break;
                }
                for (const [key, value] of Object.entries(strings(decision.state_updates ?? {}, "state_updates"))) {
                    slug(key.replace(/^state\./, ""), "state update");
                    updates[key.startsWith("state.") ? key : `state.${key}`] = value;
                }
            }
            else if (node.kind === "loop") {
                if (!config.run)
                    throw new EngineError("A loop node needs the repository's declared run.worker.");
                const signal = boundedSignal(Math.min(node.budgets?.wall_clock ?? Infinity, (deadline - Date.now()) / 1000), options.signal);
                try {
                    const outcome = await run(repo, { maxIterations: Math.min(node.budgets?.max_iterations ?? config.run.max_iterations, config.run.max_iterations), signal: signal.signal, onEvent: options.onEvent });
                    finalRun = outcome.final?.evidence_dir;
                    ref = finalRun;
                    await bundle.json(`nodes/${current}/loop.ref.json`, { loop_dir: outcome.loop_dir, run_dir: finalRun ?? null, status: outcome.status, reason: outcome.reason });
                    for (const path of Object.values(node.writes ?? {}))
                        updates[path] = outcome.reason;
                }
                finally {
                    signal.dispose();
                }
            }
            else if (node.kind === "router") {
                const route = node.routes!.find(r => { const parsed = expression(r.when); return parsed.matches(state[parsed.key]); });
                next = route?.to ?? node.default!;
                await bundle.event("route.selected", { node_id: current, to: next, ...(route ? { when: route.when } : {}) });
            }
            else if (node.kind === "deliver") {
                if (!finalRun)
                    throw new EngineError("Delivery needs an actual loop evidence bundle. Routing state cannot substitute for proof.", 3);
                const result = await deliver(repo, { run: finalRun, send: options.send === true && !sendUsed });
                if (options.send)
                    sendUsed = true;
                ref = result.directory;
                await bundle.json(`nodes/${current}/delivery.ref.json`, { delivery: result.directory, mode: result.mode });
            }
            for (const [path, value] of Object.entries(updates)) {
                state[path.slice(6)] = value;
                await bundle.event("state.updated", { path, value, node_id: current });
            }
            await bundle.event("node.finished", { node_id: current, kind: node.kind, status: "completed", to: next, ...(ref ? { ref } : {}) });
            completed.push(current);
            current = next;
        }
        catch (error) {
            status = options.signal?.aborted ? "interrupted" : "failed";
            reason = (error as Error).message;
            exitCode = error instanceof EngineError ? error.exit_code : 1;
            await bundle.event("node.failed", { node_id: current, kind: node.kind, reason });
            break;
        }
    }
    if (current === "done") {
        status = "done";
        reason = "Every reached node completed.";
        exitCode = 0;
    }
    else if (current === "fail") {
        status = "failed";
        reason = "The graph routed to fail.";
        exitCode = 1;
    }
    await bundle.event("graph.finished", { graph_id: graph.id, status, reason, ...(!["done", "fail"].includes(current) ? { node_id: current } : {}) });
    await bundle.json("state.json", state);
    await bundle.json("manifest.json", { schema_version: "wringer.graph.v1", graph_run_id: basename(directory), graph_id: graph.id, started_at: startedAt, result: { status, reason, current_node: ["done", "fail"].includes(current) ? null : current, completed } });
    const next_move = status === "parked" ? `Review ${relative(repo, join(directory, "nodes", current, "prompt.md"))}, edit ${relative(repo, join(directory, "nodes", current, "decision.yaml"))}, then wring graph resume ${relative(repo, directory)}` : status === "done" ? "wring doctor" : `wring graph explain ${relative(repo, directory)}`;
    await bundle.write("summary.md", `# Graph ${graph.id}\n\n${status}: ${reason}\n\nCompleted: ${completed.join(", ") || "none"}\n\nNext: ${next_move}\n`);
    await bundle.seal();
    return { status, reason, graph_dir: relative(repo, directory), current_node: ["done", "fail"].includes(current) ? null : current, completed, exit_code: exitCode, next_move, state };
}
