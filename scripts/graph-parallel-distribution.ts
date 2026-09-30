/** Compiled public parallel graph journey. A separately compiled fixture binary
 * supplies deterministic role observations for the branch loops and runs each
 * pinned check on exported trees; every other step uses the public binary. Not a
 * live-agent or containment run. */
import { chmod, copyFile, cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProcess } from "../packages/engine/src/process";

const root = resolve(import.meta.dir, ".."), directory = join(root, ".wringer", `graph-parallel-distribution-${crypto.randomUUID()}`), bin = join(directory, "bin"), home = join(directory, "isolated-home");
await mkdir(bin, { recursive: true }); await mkdir(home);
await copyFile(join(root, "dist/wring"), join(bin, "wring")); await chmod(join(bin, "wring"), 0o755);
await symlink("wring", join(bin, "wringer-drive"));
const node = Bun.which("node"); if (!node) throw new Error("The independent reader check needs Node.js on the host PATH");
await symlink(node, join(bin, "node"));
// No /usr/local/bin or Homebrew container runtime: the public binary must refuse before dispatch.
const environment = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LANG: "C.UTF-8" };
const transcript: { label: string; command: string[]; exit: number }[] = [], startedAt = new Date().toISOString();
async function execute(label: string, argv: string[], options: { expected?: number | "nonzero"; cwd?: string; build?: boolean; env?: Record<string, string> } = {}) {
    const result = await runProcess(argv, { cwd: options.cwd ?? directory, env: options.build ? process.env : { ...environment, ...options.env }, timeout: options.build ? 180 : 180, maxBytes: 8 * 1024 * 1024 });
    transcript.push({ label, command: argv.map(arg => arg.replaceAll(directory, "[fixture]")), exit: result.exit_code });
    await writeFile(join(directory, "transcript.json"), JSON.stringify(transcript, null, 2) + "\n");
    const expected = options.expected ?? 0;
    if (result.timed_out || (expected === "nonzero" ? result.exit_code === 0 : result.exit_code !== expected)) throw new Error(`${label}: unexpected exit ${result.exit_code}\n${result.stdout}\n${result.stderr}`);
    return result;
}
const json = (text: string) => JSON.parse(text), drive = join(bin, "wringer-drive"), fixture = join(bin, "graph-fixture-driver");
await execute("compile-fixture-only-driver", [process.execPath, "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "--asset", "schema", "scripts/fixtures/graph-driver.ts", "--outfile", fixture], { cwd: root, build: true });
const prepared = json((await execute("synthetic-parallel-repository", [fixture, "prepare-parallel", directory])).stdout);
const state = join(directory, "state"), authority = join(directory, "graph-authority.json"), expires = new Date(Date.now() + 3600000).toISOString();
const planned = await execute("public-parallel-graph-plan", [drive, "graph", "plan", prepared.graph]);
if (!/up to 2 branches at once/.test(planned.stdout)) throw new Error("Graph plan did not state its branch ceiling");
await execute("public-graph-authority", [drive, "graph", "authority", prepared.graph, "--actor", "Parallel fixture operator", "--expires", expires, "--output", authority]);
const refused = await execute("public-run-refuses-missing-runtime-before-dispatch", [drive, "graph", "run", prepared.graph, "--authority", authority, "--state", state, "--source-bundle", prepared.bundle], { expected: "nonzero" });
if (!/Containment unavailable/.test(refused.stdout + refused.stderr)) throw new Error("Missing runtime was not refused before dispatch");
const reserved = json((await execute("public-status-both-branches-reserved", [drive, "graph", "status", "--state", state, "--json"], { expected: 3 })).stdout);
if (JSON.stringify(reserved.active) !== JSON.stringify(["reader", "writer"]) || reserved.nodes.filter((row: any) => ["reader", "writer"].includes(row.id)).some((row: any) => row.state !== "reserved")) throw new Error("Both branches were not left reserved");
await execute("fixture-branches-finish-then-crash", [fixture, "advance", directory, state], { expected: 9, env: { WRINGER_GRAPH_FIXTURE_CRASH: "after-first-result" } });
const partial = json((await execute("public-status-after-crash", [drive, "graph", "status", "--state", state, "--json"], { expected: 3 })).stdout);
if (partial.phase !== "uncertain") throw new Error(`Crash did not leave one branch uncertain: ${partial.phase}`);
const review = json((await execute("fixture-reconcile-and-integrate", [fixture, "advance", directory, state])).stdout);
if (review.phase !== "human-hold" || review.actions[0]?.node !== "review") throw new Error(`Graph did not reach the integrated review: ${review.phase}`);
for (const branch of ["reader", "writer"]) {
    const child = json((await execute(`public-${branch}-child-status`, [drive, "status", "--state", join(state, "children", branch, "state"), "--json"])).stdout);
    if (child.status !== "review-ready" || child.sessions !== 2) throw new Error(`Branch ${branch} repeated or lost work: ${child.status}, ${child.sessions} sessions`);
}
const merge = review.nodes.find((row: any) => row.id === "merge");
if (merge.outcome !== "integrated" || merge.candidate.owner !== "merge") throw new Error("Join did not record an integrated candidate");
const decision = review.actions[0];
await execute("public-review-decision", [drive, "graph", "decide", "--state", state, "--node", "review", "--revision", review.revision, "--input", decision.inputSha256, "--continue", "--by", "Parallel fixture operator", "--note", "Deterministic fixture checkpoint; not independent human acceptance."]);
const sendHold = json((await execute("public-resume-prepares-graph-delivery", [drive, "graph", "resume", "--state", state, "--json"], { expected: 3 })).stdout);
const send = sendHold.actions.find((row: any) => row.action === "send");
if (sendHold.phase !== "send-hold" || !send) throw new Error(`Graph delivery was not prepared: ${sendHold.phase}`);
await execute("public-explicit-send", [drive, "graph", "send", "--state", state, "--node", "ship", "--revision", sendHold.revision, "--prepared", send.preparedSha256, "--by", "Parallel fixture operator", "--note", "Explicit fixture Send to a new local bare origin."]);
const sent = JSON.parse(await readFile(join(state, "children/ship/sent.json"), "utf8"));
const integration = JSON.parse(await readFile(join(state, "children/merge/integration.json"), "utf8"));
const parent = (await execute("evidence-commit-parent-is-integration", ["git", "--git-dir", prepared.origin, "rev-parse", `${sent.evidenceCommit}^`])).stdout.trim();
if (parent !== integration.commit) throw new Error("The published evidence commit does not sit on the integrated code");
if ((await execute("unchanged-default-branch", ["git", "--git-dir", prepared.origin, "rev-parse", "main"])).stdout.trim() !== prepared.baseCommit) throw new Error("Delivery changed the default branch");
const clone = join(directory, "fresh-clone");
await execute("fresh-review-branch-clone", ["git", "clone", "--no-local", "--branch", "wringer/parallel-fixture", prepared.origin, clone]);
const audited = json((await execute("literal-graph-audit-command-with-node", ["/bin/sh", "-c", sent.auditCommand], { cwd: clone })).stdout);
if (!audited.nodes.some((row: any) => row.id === "merge" && row.kind === "join")) throw new Error("The carried graph evidence lost its join");
for (const name of ["reader", "writer"]) if (!(await readFile(join(clone, `src/${name}.js`), "utf8")).includes("'done'")) throw new Error(`Integrated code lost the ${name} branch`);
const exported = join(directory, "export");
await execute("public-graph-export", [drive, "graph", "export", "--state", state, "--output", exported]);
const inspected = json((await execute("node-only-independent-reader", [node, join(exported, "read-bundle.mjs"), exported], { env: { PATH: "/usr/bin:/bin" } })).stdout);
if (inspected.finished !== "done") throw new Error("Independent reader did not confirm the finished graph");
const tampered = join(directory, "export-tampered"); await cp(exported, tampered, { recursive: true });
const evidence = join(tampered, "nodes/merge/integration.json"), value = JSON.parse(await readFile(evidence, "utf8")); value.integration.status = "merged-by-hand"; await writeFile(evidence, JSON.stringify(value));
await execute("node-reader-refuses-altered-integration", [node, join(tampered, "read-bundle.mjs"), tampered], { expected: 1, env: { PATH: "/usr/bin:/bin" } });
const binary = await readFile(join(root, "dist/wring"));
if (binary.includes(Buffer.from("WRINGER_GRAPH_FIXTURE_CRASH"))) throw new Error("The public binary contains the fixture crash hook");
const result = { status: "passed", startedAt, finishedAt: new Date().toISOString(), publicCommandStages: transcript.filter(row => row.label.startsWith("public-")).length, fixtureStages: transcript.filter(row => row.label.startsWith("fixture-")).length, integrationCommit: integration.commit, evidenceCommit: sent.evidenceCommit, branchSessions: 2, synthetic: ["worker ACP replies", "judge ACP replies"], checksRunOnExportedTrees: true, liveProviderMeasured: false, realContainmentMeasured: false, humanAcceptanceMeasured: false, limits: ["Deterministic contract fixture: branch role observations come from a separately compiled fixture binary; pinned checks really ran on exported candidate trees.", "Publication used only a new local bare fixture origin.", "Scripted decisions are engineering checkpoints, not independent human acceptance."] };
await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`Compiled parallel graph fixture passed: ${directory}\n${result.publicCommandStages} public stages, ${result.fixtureStages} fixture stages. Real provider, containment and human acceptance remain unmeasured.`);
