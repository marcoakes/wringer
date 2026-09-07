import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { git, validateDigests } from "@wringer/engine";
import { runGraph, validateGraph, loadGraph, renderGraph, graphStatus, runFleet, parseFleetConfig, validateTasks, type GraphDefinition } from "../src";
const scratch = await mkdtemp(join(tmpdir(), "wringer-scheduler-tests-"));
let sequence = 0;
afterAll(async () => { await rm(scratch, { recursive: true, force: true }); });
async function repo(extra: Record<string, unknown> = {}) {
    const root = join(scratch, String(++sequence));
    await mkdir(root);
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", "Scheduler fixture"]);
    await git(root, ["config", "user.email", "fixture@example.invalid"]);
    await git(root, ["config", "commit.gpgsign", "false"]);
    await Bun.write(join(root, ".gitignore"), ".wringer/\n");
    await Bun.write(join(root, "brief.md"), "Create result.txt containing fixed.\n");
    await Bun.write(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "accept", run: "test -f result.txt", timeout: 2 }], run: { worker: "printf fixed > result.txt", max_iterations: 1, worker_timeout: 2, wall_clock: 5 }, ...extra }));
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "fixture baseline"]);
    return root;
}
const graph: GraphDefinition = { version: 1, id: "build-flow", inputs: { task: "brief.md" }, state: {}, budgets: { wall_clock: 30 }, nodes: { intent: { kind: "intent", input: "inputs.task", then: "review" }, review: { kind: "human", prompt: "Read the requirement and approve the build.", then: "build" }, build: { kind: "loop", budgets: { max_iterations: 1, wall_clock: 10 }, writes: { status: "state.build-status" }, then: "route" }, route: { kind: "router", routes: [{ when: "state.build-status == 'converged'", to: "done" }], default: "fail" } } };
describe("graph validation and durable execution", () => {
    test("strict graph grammar rejects cycles, shell keys and missing dataflow", () => {
        expect(validateGraph(graph).id).toBe("build-flow");
        expect(renderGraph(graph)).toContain("build --> route");
        expect(() => validateGraph({ ...graph, nodes: { ...graph.nodes, build: { ...graph.nodes.build, command: "touch secret" } } })).toThrow("unknown key");
        expect(() => validateGraph({ ...graph, nodes: { a: { kind: "intent", input: "inputs.task", then: "b" }, b: { kind: "router", routes: [{ when: "state.unknown == 'yes'", to: "done" }], default: "fail" } } })).toThrow("not declared");
        expect(() => validateGraph({ ...graph, nodes: { a: { kind: "intent", input: "inputs.task", then: "a" } } })).toThrow("start node");
        expect(() => validateGraph({ ...graph, nodes: { a: { kind: "router", routes: [{ when: "process.exit()", to: "done" }], default: "fail" } } })).toThrow("Unsupported route");
    });
    test("a real worker runs only after the human park; resume ignores forged state snapshots", async () => {
        const root = await repo();
        const parked = await runGraph(root, graph);
        expect(parked.exit_code).toBe(5);
        expect(parked.completed).toEqual(["intent"]);
        const directory = join(root, parked.graph_dir);
        const before = await readFile(join(directory, "graph.jsonl"), "utf8");
        const again = await runGraph(root, graph, { resume: parked.graph_dir });
        expect(again.exit_code).toBe(5);
        expect(await readFile(join(directory, "graph.jsonl"), "utf8")).toBe(before);
        await Bun.write(join(directory, "state.json"), JSON.stringify({ "build-status": "converged" }));
        await Bun.write(join(directory, "nodes/review/decision.yaml"), "approved: true\ncomments: Fixture approval\nstate_updates: {}\n");
        const done = await runGraph(root, graph, { resume: parked.graph_dir });
        expect(done.exit_code).toBe(0);
        expect(await Bun.file(join(root, "result.txt")).text()).toBe("fixed");
        const events = (await Bun.file(join(directory, "graph.jsonl")).text()).trim().split("\n").map(line => JSON.parse(line));
        expect(events.filter(e => e.type === "node.finished" && e.node_id === "intent").length).toBe(1);
        expect((await graphStatus(root, parked.graph_dir)).status).toBe("done");
        const ajv = addFormats(new Ajv2020({ strict: false }));
        const valid = ajv.compile(await Bun.file(new URL("../../../schema/graph-event.schema.json", import.meta.url)).json());
        expect(events.every(e => valid(e))).toBe(true);
        expect((await validateDigests(directory)).ok).toBe(true);
    });
    test("routing a forged success directly to delivery cannot invent evidence", async () => {
        const root = await repo();
        const value: GraphDefinition = { version: 1, id: "forgery", inputs: {}, state: { status: "converged" }, budgets: { wall_clock: 10 }, nodes: { route: { kind: "router", routes: [{ when: "state.status == 'converged'", to: "ship" }], default: "fail" }, ship: { kind: "deliver", then: "done" } } };
        const result = await runGraph(root, value);
        expect(result.exit_code).toBe(3);
        expect(result.reason).toContain("actual loop evidence");
    });
    test("duplicate graph YAML and duplicate human approval keys refuse before any worker", async () => {
        const root = await repo();
        await Bun.write(join(root, "duplicate.yaml"), "version: 1\nversion: 1\n");
        await expect(loadGraph(join(root, "duplicate.yaml"))).rejects.toThrow("unique");
        const parked = await runGraph(root, graph);
        await Bun.write(join(root, parked.graph_dir, "nodes/review/decision.yaml"), "approved: false\napproved: true\ncomments: Contradictory fixture\nstate_updates: {}\n");
        await expect(runGraph(root, graph, { resume: parked.graph_dir })).rejects.toThrow("unique");
        expect(await Bun.file(join(root, "result.txt")).exists()).toBe(false);
    });
});
describe("bounded isolated fleets", () => {
    test("task dependency cycles and duplicates are rejected before work", () => {
        expect(() => validateTasks([{ id: "a", brief: "a", depends_on: ["b"] }, { id: "b", brief: "b", depends_on: ["a"] }])).toThrow("cycle");
        expect(() => validateTasks([{ id: "a", brief: "a" }, { id: "a", brief: "a" }])).toThrow("Duplicate");
    });
    test("fleet settings reject unsupported fields even when their value is false or empty", () => {
        for (const patch of [{ scope: "" }, { scope: false }, { worker_fallbacks: {} }, { worker_fallbacks: null }, { deadline: 20, unknown: 1 }])
            expect(() => parseFleetConfig({ deadline: 10, ...patch })).toThrow();
        expect(parseFleetConfig({ deadline: 10, worker_fallbacks: [] }).concurrency).toBe(1);
    });
    test("real workers run in retained worktrees, respecting dependency completion", async () => {
        const root = await repo({ fleet: { concurrency: 2, deadline: 20, progress_window: 5, retries: 0, worktree: true, child: { max_iterations: 1, wall_clock: 6 } } });
        const result = await runFleet(root, [{ id: "first", brief: "brief.md" }, { id: "second", brief: "brief.md", depends_on: ["first"] }]);
        expect(result).toMatchObject({ succeeded: 2, failed: 0, parked: 0, join_satisfied: true, exit_code: 0 });
        expect(await Bun.file(join(root, "result.txt")).exists()).toBe(false);
        const directory = join(root, result.fleet_dir), retained = await Bun.file(join(directory, "worktrees.json")).json();
        expect(await Bun.file(join(retained.tasks.first, "result.txt")).text()).toBe("fixed");
        expect(retained.tasks.first).not.toBe(retained.tasks.second);
        const events = (await Bun.file(join(directory, "fleet.jsonl")).text()).trim().split("\n").map(line => JSON.parse(line));
        expect(events.findIndex(e => e.type === "task.finished" && e.task === "first" && e.status === "succeeded")).toBeLessThan(events.findIndex(e => e.type === "task.started" && e.task === "second"));
        const validate = new Ajv2020({ strict: false }).compile(await Bun.file(new URL("../../../schema/fleet-event.schema.json", import.meta.url)).json());
        expect(events.every(e => validate(e))).toBe(true);
        const resumed = await runFleet(root, [], { resume: result.fleet_dir });
        expect(resumed.tasks.map(t => t.attempts)).toEqual([1, 1]);
    });
    test("a deterministic no-progress worker is parked without consuming retry budget", async () => {
        const root = await repo({ run: { worker: "true", max_iterations: 1, worker_timeout: 2 }, fleet: { concurrency: 1, deadline: 10, progress_window: 3, retries: 3, worktree: true } });
        const result = await runFleet(root, [{ id: "blocked", brief: "brief.md" }, { id: "dependent", brief: "brief.md", depends_on: ["blocked"] }]);
        expect(result.tasks[0]?.attempts).toBe(1);
        expect(result.tasks[0]?.status).toBe("parked");
        expect(result.tasks[1]?.attempts).toBe(0);
        expect(result.join_satisfied).toBe(false);
    });
    test("concurrency is bounded while independent tasks genuinely overlap", async () => {
        const root = await repo({ run: { worker: "sleep 0.2; printf fixed > result.txt", max_iterations: 1, worker_timeout: 3 }, fleet: { concurrency: 2, deadline: 15, progress_window: 5, retries: 0, worktree: true } });
        const result = await runFleet(root, [{ id: "a", brief: "brief.md" }, { id: "b", brief: "brief.md" }, { id: "c", brief: "brief.md" }]);
        expect(result.succeeded).toBe(3);
        const events = (await Bun.file(join(root, result.fleet_dir, "fleet.jsonl")).text()).trim().split("\n").map(line => JSON.parse(line));
        let running = 0, maximum = 0;
        for (const event of events) {
            if (event.type === "task.started")
                maximum = Math.max(maximum, ++running);
            if (event.type === "task.finished")
                running--;
        }
        expect(maximum).toBe(2);
        expect(running).toBe(0);
    });
    test("a silent real child is reaped at its progress deadline", async () => {
        const root = await repo({ run: { worker: "sleep 4; printf fixed > result.txt", max_iterations: 1, worker_timeout: 6 }, fleet: { concurrency: 1, deadline: 10, progress_window: 1, retries: 0, worktree: true } });
        const started = Date.now();
        const result = await runFleet(root, [{ id: "silent", brief: "brief.md" }]);
        expect(Date.now() - started).toBeLessThan(3500);
        expect(result.tasks[0]?.status).toBe("parked");
        expect(await Bun.file(join(root, result.fleet_dir, "fleet.jsonl")).text()).toContain('"type":"task.reaped"');
        const paths = await Bun.file(join(root, result.fleet_dir, "worktrees.json")).json();
        expect(await Bun.file(join(paths.tasks.silent, "result.txt")).exists()).toBe(false);
    });
});
