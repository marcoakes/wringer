/** Compiled public contained-graph journey. A separately compiled fixture binary
 * supplies deterministic role/check observations for the loop and check nodes;
 * every other step uses the public binary. Not a live-agent or containment run. */
import { chmod, copyFile, cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProcess } from "../packages/engine/src/process";

const root = resolve(import.meta.dir, ".."), directory = join(root, ".wringer", `graph-distribution-${crypto.randomUUID()}`), bin = join(directory, "bin"), home = join(directory, "isolated-home");
await mkdir(bin, { recursive: true }); await mkdir(home);
await copyFile(join(root, "dist/wring"), join(bin, "wring")); await chmod(join(bin, "wring"), 0o755);
await symlink("wring", join(bin, "wringer-drive"));
// No /usr/local/bin or Homebrew: the public binary must not find a container runtime.
const environment = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LANG: "C.UTF-8" };
const transcript: unknown[] = [], startedAt = new Date().toISOString(), node = Bun.which("node");
if (!node) throw new Error("The independent reader check needs Node.js on the host PATH");
async function execute(label: string, argv: string[], options: { expected?: number | "nonzero"; cwd?: string; build?: boolean; env?: Record<string, string> } = {}) {
    const result = await runProcess(argv, { cwd: options.cwd ?? directory, env: options.build ? process.env : { ...environment, ...options.env }, timeout: options.build ? 180 : 120, maxBytes: 8 * 1024 * 1024 });
    transcript.push({ label, command: argv.map(arg => arg.replaceAll(directory, "[fixture]")), exit: result.exit_code });
    await writeFile(join(directory, "transcript.json"), JSON.stringify(transcript, null, 2) + "\n");
    const expected = options.expected ?? 0;
    if (result.timed_out || (expected === "nonzero" ? result.exit_code === 0 : result.exit_code !== expected)) throw new Error(`${label}: unexpected exit ${result.exit_code}\n${result.stdout}\n${result.stderr}`);
    return result;
}
const json = (text: string) => JSON.parse(text);
const drive = join(bin, "wringer-drive"), fixture = join(bin, "graph-fixture-driver");
await execute("compile-fixture-only-driver", [process.execPath, "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "--asset", "schema", "scripts/fixtures/graph-driver.ts", "--outfile", fixture], { cwd: root, build: true });
const prepared = json((await execute("synthetic-fixture-repository", [fixture, "prepare", directory])).stdout);
const graph = prepared.graph, authority = join(directory, "graph-authority.json"), state = join(directory, "state"), expires = new Date(Date.now() + 3600000).toISOString();
const planned = await execute("public-graph-plan", [drive, "graph", "plan", graph]);
if (!planned.stdout.includes("No agent, container or repository command ran")) throw new Error("Graph plan did not state its lack of effects");
await cp(join(root, "examples/graphs/issue-to-mr.yaml"), join(directory, "legacy.yaml"));
const legacy = await execute("public-legacy-graph-named-refusal", [drive, "graph", "plan", join(directory, "legacy.yaml")], { expected: 2 });
if (!/retired host-execution graph/.test(legacy.stdout + legacy.stderr)) throw new Error("Legacy graph was not refused by name");
await execute("public-graph-authority", [drive, "graph", "authority", graph, "--actor", "Graph distribution fixture operator", "--expires", expires, "--output", authority]);
const scope = json((await execute("public-run-holds-at-scope", [drive, "graph", "run", graph, "--authority", authority, "--state", state, "--source-bundle", prepared.bundle, "--json"], { expected: 3 })).stdout);
if (scope.phase !== "human-hold" || scope.next.node !== "scope") throw new Error("Graph did not hold at its root scope");
const decide = (view: any, extra: string[] = []) => [drive, "graph", "decide", "--state", state, "--node", view.next.node, "--revision", view.revision, "--input", view.next.inputSha256, "--continue", "--by", "Graph distribution fixture operator", "--note", "Deterministic fixture checkpoint; not independent human acceptance.", ...extra];
await execute("public-scope-decision", decide(scope));
const noRuntime = await execute("public-resume-without-runtime", [drive, "graph", "resume", "--state", state], { expected: "nonzero" });
if (!/Containment unavailable/.test(noRuntime.stdout + noRuntime.stderr)) throw new Error("Missing runtime was not refused before dispatch");
const reserved = json((await execute("public-status-loop-reserved", [drive, "graph", "status", "--state", state, "--json"], { expected: 3 })).stdout);
if (reserved.nodes.find((row: any) => row.id === "build").state !== "reserved") throw new Error("Runtime refusal did not leave the loop reserved");
// Fixture: the child completes, then the process dies before the parent records it.
await execute("fixture-child-completes-then-crash", [fixture, "advance", directory, state], { expected: 9, env: { WRINGER_GRAPH_FIXTURE_CRASH: "after-child" } });
const review = json((await execute("fixture-reconcile-without-redispatch", [fixture, "advance", directory, state])).stdout);
if (review.phase !== "human-hold" || review.next.node !== "review") throw new Error(`Graph did not reach the candidate review: ${review.phase}`);
// The child is an ordinary contained journey: its own public commands read it.
await execute("public-child-loop-history", [drive, "loop", "--state", join(state, "children/build/state"), "--json"]);
const child = json((await execute("public-child-status", [drive, "status", "--state", join(state, "children/build/state"), "--json"])).stdout);
if (child.status !== "review-ready" || child.sessions !== 2) throw new Error(`Reconciliation repeated or lost child work: ${child.status}, ${child.sessions} sessions`);
await execute("public-stale-review-decision-refused", decide({ ...review, revision: "a".repeat(64) }), { expected: "nonzero" });
if (json((await execute("public-status-after-stale", [drive, "graph", "status", "--state", state, "--json"], { expected: 3 })).stdout).revision !== review.revision) throw new Error("A stale decision changed the graph");
await execute("public-review-decision", decide(review));
const sendHold = json((await execute("public-resume-prepares-delivery", [drive, "graph", "resume", "--state", state, "--json"], { expected: 3 })).stdout);
if (sendHold.phase !== "send-hold") throw new Error(`Delivery was not prepared: ${sendHold.phase}`);
const send = (view: any, prepared = view.next.preparedSha256) => [drive, "graph", "send", "--state", state, "--node", view.next.node, "--revision", view.revision, "--prepared", prepared, "--by", "Graph distribution fixture operator", "--note", "Explicit fixture Send to a new local bare origin."];
await execute("public-send-wrong-preparation-refused", send(sendHold, "b".repeat(64)), { expected: "nonzero" });
if (await execute("unsent-branch-absent", ["git", "--git-dir", prepared.origin, "rev-parse", "--verify", "--quiet", "refs/heads/wringer/graph-fixture"], { expected: 1 })) { /* absent as expected */ }
const done = json((await execute("public-explicit-send", [...send(sendHold), "--json"])).stdout);
if (done.phase !== "complete") throw new Error(`Graph did not complete: ${done.phase}`);
await execute("public-second-send-refused", send(sendHold), { expected: "nonzero" });
const main = (await execute("unchanged-default-branch", ["git", "--git-dir", prepared.origin, "rev-parse", "main"])).stdout.trim();
if (main !== prepared.baseCommit) throw new Error("Graph delivery changed the default branch");
const exported = join(directory, "export");
await execute("public-graph-export", [drive, "graph", "export", "--state", state, "--output", exported]);
const inspected = json((await execute("node-only-independent-reader", [node, join(exported, "read-bundle.mjs"), exported], { env: { PATH: "/usr/bin:/bin" } })).stdout);
if (inspected.finished !== "done" || inspected.nodes.map((row: any) => row.id).join() !== "scope,build,verify,review,ship") throw new Error("Independent reader did not confirm the finished lineage");
const tampered = join(directory, "export-tampered"); await cp(exported, tampered, { recursive: true });
const eventPath = join(tampered, "graph/events/0003.json"), event = JSON.parse(await readFile(eventPath, "utf8")); event.at = "2026-01-01T00:00:00.000Z"; await writeFile(eventPath, JSON.stringify(event));
await execute("node-reader-refuses-altered-event", [node, join(tampered, "read-bundle.mjs"), tampered], { expected: 1, env: { PATH: "/usr/bin:/bin" } });
const sent = JSON.parse(await readFile(join(state, "children/ship/sent.json"), "utf8")), clone = join(directory, "fresh-clone");
await execute("fresh-review-branch-clone", ["git", "clone", "--no-local", "--branch", "wringer/graph-fixture", prepared.origin, clone]);
await execute("literal-delivery-audit-command", ["/bin/sh", "-c", sent.auditCommand], { cwd: clone });
// A second graph: the process dies right after the dispatch marker. Resume must not start work again.
const stuck = join(directory, "state-uncertain"), second = join(directory, "graph-authority-2.json");
await execute("public-second-authority", [drive, "graph", "authority", graph, "--actor", "Graph distribution fixture operator", "--expires", expires, "--output", second]);
const scope2 = json((await execute("public-second-run", [drive, "graph", "run", graph, "--authority", second, "--state", stuck, "--source-bundle", prepared.bundle, "--json"], { expected: 3 })).stdout);
await execute("public-second-scope-decision", [drive, "graph", "decide", "--state", stuck, "--node", "scope", "--revision", scope2.revision, "--input", scope2.next.inputSha256, "--continue", "--by", "Graph distribution fixture operator", "--note", "Fixture checkpoint."]);
await execute("fixture-crash-after-dispatch-marker", [fixture, "advance", directory, stuck], { expected: 9, env: { WRINGER_GRAPH_FIXTURE_CRASH: "after-marker" } });
const uncertain = json((await execute("public-resume-stays-uncertain", [drive, "graph", "resume", "--state", stuck, "--json"], { expected: 3 })).stdout);
if (uncertain.phase !== "uncertain" || !/never dispatches again/.test(uncertain.reason)) throw new Error(`Uncertain dispatch was not preserved: ${uncertain.phase}`);
const childStarted = await readFile(join(stuck, "children/build/state/plan.json"), "utf8").then(() => true, () => false);
if (childStarted) throw new Error("Resume started the uncertain child");
const binary = await readFile(join(root, "dist/wring"));
if (binary.includes(Buffer.from("WRINGER_GRAPH_FIXTURE_CRASH"))) throw new Error("The public binary contains the fixture crash hook");
const result = { status: "passed", startedAt, finishedAt: new Date().toISOString(), publicCommandStages: transcript.filter((row: any) => row.label.startsWith("public-")).length, fixtureStages: transcript.filter((row: any) => row.label.startsWith("fixture-")).length, graph: done.graph.sha256, revision: done.revision, childSessions: child.sessions, deliveryId: sent.deliveryId, evidenceCommit: sent.evidenceCommit, exportFinished: inspected.finished, synthetic: ["worker ACP reply", "judge ACP reply", "check execution observations"], liveProviderMeasured: false, realContainmentMeasured: false, humanAcceptanceMeasured: false, limits: ["Deterministic contract fixture: the loop and check observations are synthetic and injected by a separate fixture binary.", "Publication used only a new local bare fixture origin.", "Scripted decisions are engineering checkpoints, not independent human acceptance."] };
await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`Compiled contained-graph fixture passed: ${directory}\n${result.publicCommandStages} public stages, ${result.fixtureStages} fixture stages. Real provider, containment and human acceptance remain unmeasured.`);
