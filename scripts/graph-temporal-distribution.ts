/** Compiled public contained-graph journey on a local Temporal service. The public
 * binary plans, grants and admits the graph (graph init: no effect), and afterwards
 * reads, resumes and exports the directory the workflow mirrored. The Temporal
 * adapter's own command line runs the worker and answers the holds. Every effect goes
 * through the effect command, here a separately compiled fixture binary that wraps
 * the real graph driver with synthetic role replies and check observations, as in
 * the other graph walkthroughs. Not a live-agent, containment or Temporal Cloud run.
 *
 * Needs: bun run build; Node.js; npm ci in adapters/temporal; the Temporal CLI as
 * TEMPORAL_CLI or on PATH. */
import { chmod, copyFile, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { runProcess } from "../packages/engine/src/process";

const root = resolve(import.meta.dir, ".."), directory = join(root, ".wringer", `graph-temporal-distribution-${crypto.randomUUID()}`), bin = join(directory, "bin"), home = join(directory, "isolated-home");
const nodeFound = Bun.which("node"), temporalFound = process.env.TEMPORAL_CLI || Bun.which("temporal");
if (!nodeFound) throw new Error("The Temporal adapter and the independent reader need Node.js on the host PATH");
if (!temporalFound) throw new Error("Set TEMPORAL_CLI to the Temporal CLI, or put it on PATH");
const node: string = nodeFound, temporalCli: string = temporalFound;
if (!await Bun.file(join(root, "adapters/temporal/node_modules/@temporalio/worker/package.json")).exists()) throw new Error("Run npm ci in adapters/temporal first");
await mkdir(bin, { recursive: true }); await mkdir(home);
await copyFile(join(root, "dist/wring"), join(bin, "wring")); await chmod(join(bin, "wring"), 0o755);
await symlink("wring", join(bin, "wringer-drive"));
// No /usr/local/bin or Homebrew: nothing here may find a container runtime.
const environment = { PATH: `${bin}:${dirname(node)}:/usr/bin:/bin`, HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LANG: "C.UTF-8" };
const transcript: unknown[] = [], startedAt = new Date().toISOString();
async function execute(label: string, argv: string[], options: { expected?: number | "nonzero"; cwd?: string; build?: boolean; env?: Record<string, string>; timeout?: number } = {}) {
    const result = await runProcess(argv, { cwd: options.cwd ?? directory, env: options.build ? process.env : { ...environment, ...options.env }, timeout: options.timeout ?? (options.build ? 180 : 120), maxBytes: 8 * 1024 * 1024 });
    transcript.push({ label, command: argv.map(arg => arg.replaceAll(directory, "[fixture]").replaceAll(root, "[checkout]")), exit: result.exit_code });
    await writeFile(join(directory, "transcript.json"), JSON.stringify(transcript, null, 2) + "\n");
    const expected = options.expected ?? 0;
    if (result.timed_out || (expected === "nonzero" ? result.exit_code === 0 : result.exit_code !== expected)) throw new Error(`${label}: unexpected exit ${result.exit_code}\n${result.stdout}\n${result.stderr}`);
    return result;
}
const json = (text: string) => JSON.parse(text);
const drive = join(bin, "wringer-drive"), fixture = join(bin, "graph-fixture-driver"), adapter = join(root, "adapters/temporal/src/cli.mjs");
await execute("compile-fixture-only-driver", [process.execPath, "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "--asset", "schema", "scripts/fixtures/graph-driver.ts", "--outfile", fixture], { cwd: root, build: true });
const prepared = json((await execute("synthetic-fixture-repository", [fixture, "prepare", directory])).stdout);
const graph = prepared.graph, authority = join(directory, "graph-authority.json"), state = join(directory, "state"), expires = new Date(Date.now() + 3600000).toISOString();
await execute("public-graph-plan", [drive, "graph", "plan", graph]);
await execute("public-graph-authority", [drive, "graph", "authority", graph, "--actor", "Temporal walkthrough fixture operator", "--expires", expires, "--output", authority]);
const admitted = json((await execute("public-graph-init-no-effect", [drive, "graph", "init", graph, "--authority", authority, "--state", state, "--source-bundle", prepared.bundle, "--json"])).stdout);
if (admitted.phase !== "pending" || admitted.events !== undefined && admitted.events !== 1) throw new Error(`graph init did not only admit the graph: ${admitted.phase}`);
const unmarked = await execute("public-effect-without-marker-refused", [drive, "graph", "effect", "dispatch", "--state", state, "--node", "build", "--json"], { expected: 3 });
if (!/no reservation in this graph history; no effect ran/.test(unmarked.stdout)) throw new Error("An effect without its marker was not refused");

// A private Temporal dev server on a free loopback port.
const port = await new Promise<number>((done, fail) => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address() as { port: number }; server.close(() => done(port)); }); server.on("error", fail); });
const address = `127.0.0.1:${port}`, taskQueue = "wringer-walkthrough", workflowId = `walkthrough-${crypto.randomUUID()}`;
const server = Bun.spawn([temporalCli, "server", "start-dev", "--headless", "--ip", "127.0.0.1", "--port", String(port), "--db-filename", join(directory, "temporal-dev.db"), "--log-level", "error"], { stdout: "ignore", stderr: "ignore" });
const worker = { process: null as ReturnType<typeof Bun.spawn> | null };
try {
    for (let attempt = 0; ; attempt++) {
        const probe = await runProcess([temporalCli, "operator", "namespace", "describe", "--namespace", "default", "--address", address], { cwd: directory, env: environment, timeout: 10, maxBytes: 1024 * 1024 });
        if (probe.exit_code === 0) break;
        if (attempt > 60) throw new Error("The Temporal dev server did not start");
        await Bun.sleep(500);
    }
    transcript.push({ label: "temporal-dev-server", command: ["temporal", "server", "start-dev", "--headless", "--port", "[free port]"], exit: 0 });
    const effectCommand = JSON.stringify([fixture, "effect-for", directory]);
    worker.process = Bun.spawn([node, adapter, "worker", "--address", address, "--task-queue", taskQueue, "--effect-command", effectCommand], { env: environment, stdout: "pipe", stderr: "pipe" });
    transcript.push({ label: "adapter-worker", command: ["node", "[checkout]/adapters/temporal/src/cli.mjs", "worker", "--task-queue", taskQueue, "--effect-command", effectCommand.replaceAll(directory, "[fixture]")], exit: null });
    const cli = (label: string, args: string[], expected: number | "nonzero" = 0) => execute(label, [node, adapter, ...args, "--address", address], { expected });
    await cli("adapter-start", ["start", "--state", state, "--task-queue", taskQueue, "--workflow-id", workflowId]);
    async function waitFor(label: string, predicate: (graph: any) => boolean) {
        for (let attempt = 0; attempt < 240; attempt++) {
            const view = json((await runProcess([node, adapter, "status", "--workflow-id", workflowId, "--address", address], { cwd: directory, env: environment, timeout: 30, maxBytes: 8 * 1024 * 1024 })).stdout || "{}");
            if (view.graph && predicate(view.graph)) { transcript.push({ label, command: ["node", "cli.mjs", "status", "--workflow-id", "[workflow]"], exit: 0 }); return view.graph; }
            if (view.workflow && view.workflow !== "RUNNING") return view;
            await Bun.sleep(250);
        }
        throw new Error(`${label}: timed out`);
    }
    const decide = (view: any, node: string, extra: string[] = []) => ["decide", "--workflow-id", workflowId, "--node", node, "--revision", view.revision, "--input", view.holds.find((row: any) => row.node === node).inputSha256, "--continue", "--by", "Temporal walkthrough fixture operator", "--note", "Deterministic fixture checkpoint; not independent human acceptance.", ...extra];
    const scope = await waitFor("adapter-status-holds-at-scope", view => view.holds?.some((row: any) => row.node === "scope"));
    await cli("adapter-stale-decision-refused", decide({ ...scope, revision: "a".repeat(64) }, "scope"), "nonzero");
    await cli("adapter-scope-decision", decide(scope, "scope"));
    const review = await waitFor("adapter-status-holds-at-review", view => view.holds?.some((row: any) => row.node === "review"));
    const midway = json((await execute("public-status-reads-mirrored-directory", [drive, "graph", "status", "--state", state, "--json"], { expected: 3 })).stdout);
    if (midway.revision !== review.revision || midway.phase !== "human-hold") throw new Error("The public reader did not see the workflow's exact revision");
    await cli("adapter-review-decision", decide(review, "review"));
    const sendHold = await waitFor("adapter-status-send-hold", view => view.holds?.some((row: any) => row.kind === "send"));
    const hold = sendHold.holds.find((row: any) => row.kind === "send");
    const send = (prepared: string) => ["send", "--workflow-id", workflowId, "--node", hold.node, "--revision", sendHold.revision, "--prepared", prepared, "--by", "Temporal walkthrough fixture operator", "--note", "Explicit fixture Send to a new local bare origin."];
    await cli("adapter-send-wrong-preparation-refused", send("b".repeat(64)), "nonzero");
    await cli("adapter-explicit-send", send(hold.preparedSha256));
    const finished = await waitFor("adapter-workflow-completed", view => view.phase === "complete");
    if (finished.workflow !== "COMPLETED" && finished.phase !== "complete") throw new Error(`Workflow did not complete: ${JSON.stringify(finished).slice(0, 400)}`);
} finally {
    worker.process?.kill("SIGTERM"); await worker.process?.exited;
    server.kill("SIGTERM"); await server.exited;
}
const done = json((await execute("public-status-complete", [drive, "graph", "status", "--state", state, "--json"])).stdout);
if (done.phase !== "complete") throw new Error(`The mirrored directory is not complete: ${done.phase}`);
const resumed = json((await execute("public-resume-runs-nothing", [drive, "graph", "resume", "--state", state, "--json"])).stdout);
if (resumed.revision !== done.revision) throw new Error("A local resume after the workflow changed the history");
for (const [node, kind] of [["build", "dispatch"], ["verify", "dispatch"], ["ship", "dispatch"], ["ship", "send"]]) if (!await Bun.file(join(state, `.wringer/graph-effects/${node}.${kind}.json`)).exists()) throw new Error(`No effect claim for ${node} ${kind}`);
const main = (await execute("unchanged-default-branch", ["git", "--git-dir", prepared.origin, "rev-parse", "main"])).stdout.trim();
if (main !== prepared.baseCommit) throw new Error("Delivery changed the default branch");
const exported = join(directory, "export");
await execute("public-graph-export", [drive, "graph", "export", "--state", state, "--output", exported]);
const inspected = json((await execute("node-only-independent-reader", [node, join(exported, "read-bundle.mjs"), exported], { env: { PATH: "/usr/bin:/bin" } })).stdout);
if (inspected.finished !== "done") throw new Error("Independent reader did not confirm the finished lineage");
const sent = JSON.parse(await readFile(join(state, "children/ship/sent.json"), "utf8")), clone = join(directory, "fresh-clone");
await execute("fresh-review-branch-clone", ["git", "clone", "--no-local", "--branch", "wringer/graph-fixture", prepared.origin, clone]);
await execute("literal-delivery-audit-command", ["/bin/sh", "-c", sent.auditCommand], { cwd: clone });
const binary = await readFile(join(root, "dist/wring"));
if (binary.includes(Buffer.from("effect-for"))) throw new Error("The public binary contains the fixture effect command");
const result = { status: "passed", startedAt, finishedAt: new Date().toISOString(), publicCommandStages: transcript.filter((row: any) => row.label.startsWith("public-")).length, adapterStages: transcript.filter((row: any) => row.label.startsWith("adapter-")).length, graph: done.graph.sha256, revision: done.revision, events: done.events?.length ?? null, deliveryId: sent.deliveryId, evidenceCommit: sent.evidenceCommit, exportFinished: inspected.finished,
    synthetic: ["worker ACP reply", "judge ACP reply", "check execution observations"], liveProviderMeasured: false, realContainmentMeasured: false, humanAcceptanceMeasured: false, temporalCloudMeasured: false,
    limits: ["Deterministic contract fixture: role replies and check observations are synthetic, injected through the effect command by a separate fixture binary.", "A local Temporal dev server on loopback; no Temporal Cloud or production cluster.", "Publication used only a new local bare fixture origin.", "Scripted decisions are engineering checkpoints, not independent human acceptance."] };
await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`Compiled contained-graph Temporal fixture passed: ${directory}\n${result.publicCommandStages} public stages, ${result.adapterStages} adapter stages. Real provider, containment, Temporal Cloud and human acceptance remain unmeasured.`);
