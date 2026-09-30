/** Phase 4 measure-first: independent contained branches before fork/join design.
 * Real Git, real source transport, real controller journals; synthetic ACP and
 * check observations. No model, container, network or human decision.
 *   bun scripts/restoration-phase4-measure.ts OUTPUT_DIRECTORY */
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileContainedGraph, compileDeclaration, createGraphAuthority, hashBytes } from "../packages/plan/src";
import { createLocalSourceBundle, processDriver, runtimeProvenanceVersion, type ContainedCommandRequest, type ContainedCommandResult, type PreparedRepositorySource, type RoleExecutionRequest, type RoleExecutionResult } from "../packages/runtime/src";
import { attachGraphRootSource, containedGraphDriver, readController } from "../packages/application/src";
import { advanceContainedGraph, initializeContainedGraph } from "../packages/scheduler/src";

const output = resolve(process.argv[2] ?? "build/restoration/phase-4/measurements"), scratch = await mkdtemp(join(tmpdir(), "wringer-phase4-measure-"));
async function git(args: string[], allow = [0]) { const r = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Phase 4 measurement", "-c", "user.email=fixture@example.invalid", ...args], { timeoutMs: 30000 }); if (!allow.includes(r.code)) throw new Error(r.stderr || r.stdout); return { code: r.code, out: r.stdout.trim() }; }
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const mib = (bytes: number) => Math.round(bytes / 1048576 * 10) / 10;
async function size(path: string): Promise<number> { let total = 0; for (const entry of await readdir(path, { withFileTypes: true })) { const full = join(path, entry.name); total += entry.isDirectory() ? await size(full) : entry.isFile() ? (await stat(full)).size : 0; } return total; }

/** One fixture repository whose check needs src/count.txt to equal the number of files in src/items.
 * The base is red (count 1, no items), as a contained journey requires. */
async function repository(name: string) {
    const root = join(scratch, name), repo = join(root, "source");
    await mkdir(join(repo, "src/items"), { recursive: true });
    await git(["init", "--initial-branch=main", repo]);
    await writeFile(join(repo, "README.md"), "Phase 4 measurement fixture.\n");
    await writeFile(join(repo, "src/count.txt"), "1\n"); await writeFile(join(repo, "src/items/.keep"), "");
    await writeFile(join(repo, "src/a.js"), "export const a = 0;\n"); await writeFile(join(repo, "src/b.js"), "export const b = 0;\n");
    await writeFile(join(repo, "check.sh"), "test \"$(cat src/count.txt)\" = \"$(ls src/items | wc -l | tr -d ' ')\"\n");
    await git(["-C", repo, "add", "."]); await git(["-C", repo, "commit", "-m", "Measurement baseline"]);
    const commit = (await git(["-C", repo, "rev-parse", "HEAD"])).out, bundle = join(root, "source.bundle");
    await createLocalSourceBundle(repo, commit, bundle);
    return { root, repo, commit, bundle };
}
/** A worker patch produced by editing a scratch copy of the base, never the base itself. */
async function patch(repo: string, edit: (dir: string) => Promise<void>) {
    await edit(repo); await git(["-C", repo, "add", "-A"]);
    const diff = (await git(["-C", repo, "diff", "--cached", "--binary", "--full-index"])).out + "\n";
    await git(["-C", repo, "reset", "-q", "--hard", "HEAD"]); await git(["-C", repo, "clean", "-q", "-fd"]);
    return diff;
}
function plan(url: string, commit: string) {
    return compileDeclaration({ version: 3, name: "Phase 4 branch fixture", intent: "Keep the item count exact.", repository: { url, commit },
        runtime: { kind: "apple-container", image: `fixture.invalid/agent@sha256:${"a".repeat(64)}`, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] },
        agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } },
        environment: { context: ["README.md"], tools: [], setup: [], baseline: [], writable_directories: [] }, scope: { writable: ["src"] },
        acceptance: { criteria: [{ id: "count", title: "Exact item count", quote: "Keep the item count exact.", kind: "check", required: true }], checks: [{ id: "count", argv: ["sh", "check.sh"], cwd: ".", timeout_seconds: 5, criteria: ["count"], files: ["check.sh"] }], protected_paths: ["check.sh"] },
        budget: { max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 3600, session_timeout_seconds: 900 } });
}
const provenance = (role: "worker" | "judge" | "verifier", source: { url: string; commit: string }, runtime: any) => ({ schema_version: runtimeProvenanceVersion(source.url), runtimeId: crypto.randomUUID(), role, kind: runtime.kind, image: runtime.image, repository: { url: source.url, commit: source.commit }, clonedInside: true as const, hostMounts: [] as [], repositoryAccess: role === "worker" ? "read-write" as const : "read-only" as const, declared: runtime, observed: { fixture: true, writableDirectories: [] }, limits: ["Synthetic measurement receipt"] });
/** Synthetic verifier: really runs check.sh against the candidate tree exported from its object store. */
async function runCommands(request: ContainedCommandRequest): Promise<ContainedCommandResult> {
    const source = request.repo as PreparedRepositorySource, acceptance = request.acceptanceSource as PreparedRepositorySource;
    const tree = (await git(["--git-dir", source.objectStore, "rev-parse", `${source.commit}^{tree}`])).out, work = await mkdtemp(join(scratch, "verify-"));
    await git(["--git-dir", source.objectStore, "--work-tree", work, "checkout", source.commit, "--", "."]);
    const check = { code: Bun.spawnSync(["sh", "check.sh"], { cwd: work, stdout: "ignore", stderr: "ignore" }).exitCode };
    const inputs = (await git(["--git-dir", acceptance.objectStore, "--literal-pathspecs", "ls-tree", "-r", "-z", acceptance.commit, "--", "check.sh"])).out;
    return { provenance: provenance("verifier", source, request.runtime), sourceChanged: false, sourceTree: tree, checkInputsSha256: hashBytes(inputs), results: request.commands.map(c => ({ id: c.id, code: c.id.startsWith("acceptance/") ? check.code : 0, stdout: "Measured check.sh on the exported candidate tree\n", stderr: "", durationMs: 1 })) };
}
function roles(changes: string) {
    return async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => ({ status: "completed", text: request.role === "worker" ? "Synthetic worker" : JSON.stringify({ criteria: [{ id: "count", met: true, reason: "Synthetic finding" }], note: "Measurement fixture" }), sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "phase-4-measurement" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: provenance(request.role as "worker" | "judge", request.repo, request.runtime), ...(request.role === "worker" ? { change: { baseCommit: request.repo.commit, patch: changes, sha256: hashBytes(changes) } } : {}) }) as RoleExecutionResult;
}
/** One single-loop graph (build → verify → hold) from the shared root. */
async function branch(fixture: Awaited<ReturnType<typeof repository>>, id: string, changes: string) {
    const template = plan("https://fixture.invalid/phase4.git", fixture.commit);
    const graph = compileContainedGraph({ version: 1, id, repository: template.repository, entry: "build", required: ["build", "verify", "review"], budget: { maxRoleSessions: 4, maxVerificationAttempts: 6, wallClockSeconds: 1800 },
        nodes: { build: { kind: "loop", input: "root", plan: template, then: "verify" }, verify: { kind: "check", input: "build", then: "review" }, review: { kind: "human-hold", input: "verify", prompt: "Inspect.", then: "done" } } });
    const directory = join(fixture.root, `graph-${id}-${crypto.randomUUID().slice(0, 8)}`), at = new Date();
    await initializeContainedGraph(directory, graph, createGraphAuthority(graph, { actor: "Phase 4 measurement", at, expiresAt: new Date(at.getTime() + 3600000).toISOString() }));
    await attachGraphRootSource(directory, fixture.bundle);
    return { directory, driver: containedGraphDriver({ executeRole: roles(changes), runCommands }) };
}
async function timed<T>(action: () => Promise<T>) { const cpu = process.cpuUsage(), started = performance.now(); let peak = process.memoryUsage().rss; const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20); try { const value = await action(); const used = process.cpuUsage(cpu); return { value, ms: Math.round(performance.now() - started), cpuMs: Math.round((used.user + used.system) / 1000), peakRssMiB: mib(peak) }; } finally { clearInterval(sampler); } }
async function candidate(directory: string): Promise<any> { const history = await readController(join(directory, "children/build/state")); if (!history.state.candidate) throw new Error(`Branch ${directory} produced no candidate: ${history.result.status} ${history.result.stop?.message ?? ""}`); return history.state.candidate; }

const record: Record<string, unknown> = { schema_version: "wringer.restoration-phase4-measurement.v1", kind: "deterministic fixtures: real Git, source transport and controller journals; synthetic ACP and check observations", git: (await git(["--version"])).out, bun: Bun.version, platform: `${process.platform}-${process.arch}` };
const fixture = await repository("shared");
// Each branch adds one item and leaves count.txt at 1, so each passes alone.
const addItem = (name: string) => async (dir: string) => writeFile(join(dir, "src/items", name), `${name}\n`);
const editA = await patch(fixture.repo, async dir => { await writeFile(join(dir, "src/a.js"), "export const a = 1;\n"); await addItem("a")(dir); });
const editB = await patch(fixture.repo, async dir => { await writeFile(join(dir, "src/b.js"), "export const b = 1;\n"); await addItem("b")(dir); });

// 1. Serial versus concurrent independent branches, three repetitions each.
const serial = [], concurrent = [];
for (let round = 0; round < 3; round++) {
    const a = await branch(fixture, "branch-a", editA), b = await branch(fixture, "branch-b", editB);
    const expectHold = (state: { phase: string; cursor: string }) => { if (state.phase !== "human-hold" || state.cursor !== "review") throw new Error(`Branch did not reach its review hold: ${state.phase} at ${state.cursor}`); };
    serial.push(await timed(async () => { expectHold(await advanceContainedGraph(a.directory, a.driver)); expectHold(await advanceContainedGraph(b.directory, b.driver)); }));
    const c = await branch(fixture, "branch-a", editA), d = await branch(fixture, "branch-b", editB);
    const measured = await timed(() => Promise.all([advanceContainedGraph(c.directory, c.driver), advanceContainedGraph(d.directory, d.driver)]));
    measured.value.forEach(expectHold); concurrent.push(measured);
    if (round === 2) record.branches = { a: c.directory, b: d.directory, checks: { a: measured.value[0].nodes.verify!.result!.outcome, b: measured.value[1].nodes.verify!.result!.outcome } };
}
record.throughput = { serial: { medianMs: median(serial.map(r => r.ms)), cpuMs: median(serial.map(r => r.cpuMs)), peakRssMiB: Math.max(...serial.map(r => r.peakRssMiB)), runs: serial.map(r => r.ms) }, concurrent: { medianMs: median(concurrent.map(r => r.ms)), cpuMs: median(concurrent.map(r => r.cpuMs)), peakRssMiB: Math.max(...concurrent.map(r => r.peakRssMiB)), runs: concurrent.map(r => r.ms) }, note: "Two single-loop graphs to their review hold, in one process. Role and check observations are synthetic, so this is harness overhead only: Git transport, journals, capture and verification envelopes." };

// 2. Isolation between concurrent branches.
const { a: dirA, b: dirB, checks } = record.branches as { a: string; b: string; checks: { a: string; b: string } };
const scan = async (root: string, needle: string): Promise<string[]> => { const hits: string[] = []; const walk = async (path: string) => { for (const entry of await readdir(path, { withFileTypes: true })) { const full = join(path, entry.name); if (entry.isDirectory()) { if (!entry.name.endsWith(".git") && entry.name !== "objects") await walk(full); } else if (entry.isFile() && (await stat(full)).size < 4 * 1024 * 1024 && (await readFile(full, "utf8")).includes(needle)) hits.push(full.slice(root.length + 1)); } }; await walk(root); return hits; };
const candA = await candidate(dirA), candB = await candidate(dirB);
const changed = async (c: any) => (await git(["--git-dir", c.source.objectStore, "diff", "--name-only", fixture.commit, c.source.commit])).out.split("\n").filter(Boolean);
record.isolation = { aReferencesB: await scan(dirA, dirB), bReferencesA: await scan(dirB, dirA), aObjectStoreHasB: (await git(["--git-dir", candA.source.objectStore, "cat-file", "-e", `${candB.source.commit}^{commit}`], [0, 1, 128])).code === 0, changedA: await changed(candA), changedB: await changed(candB), stateMiB: { a: mib(await size(dirA)), b: mib(await size(dirB)), rootBundleKiB: Math.round((await stat(fixture.bundle)).size / 1024) } };

// 3. Integration of two candidates by a deterministic three-way merge.
const integration = join(scratch, "integration.git"); await git(["init", "--bare", "--initial-branch=main", integration]);
await git(["--git-dir", integration, "fetch", "--no-tags", candA.source.bundlePath!, `${candA.source.commit}:refs/heads/a`]);
await git(["--git-dir", integration, "fetch", "--no-tags", candB.source.bundlePath!, `${candB.source.commit}:refs/heads/b`]);
async function merge(left: string, right: string) { const r = await git(["--git-dir", integration, "merge-tree", "--write-tree", "--name-only", "--no-messages", left, right], [0, 1]); const [tree, ...conflicts] = r.out.split("\n").filter(Boolean); return { clean: r.code === 0, tree: r.code === 0 ? tree : null, conflicts: r.code === 0 ? [] : conflicts }; }
async function checkTree(tree: string) { const work = await mkdtemp(join(scratch, "merged-")); await git(["--git-dir", integration, "--work-tree", work, "read-tree", tree]); await git(["--git-dir", integration, "--work-tree", work, "checkout-index", "-a"]); return Bun.spawnSync(["sh", "check.sh"], { cwd: work, stdout: "ignore", stderr: "ignore" }).exitCode; }
const independent = await merge("a", "b");
// Each branch passes alone and neither touches count.txt; Git merges cleanly, yet the merged tree holds two items.
record.integration = { independentEdits: { ...independent, branchChecks: checks, mergedCheckExit: independent.tree ? await checkTree(independent.tree) : null, reading: "A clean textual merge of two individually passing candidates fails the pinned check: integration needs its own fresh verification." } };
const conflictRepo = await repository("conflict");
const sameLineA = await patch(conflictRepo.repo, async dir => writeFile(join(dir, "src/a.js"), "export const a = 1;\n"));
const sameLineB = await patch(conflictRepo.repo, async dir => writeFile(join(dir, "src/a.js"), "export const a = 2;\n"));
const conflictStore = join(scratch, "conflict.git"); await git(["init", "--bare", "--initial-branch=main", conflictStore]); await git(["--git-dir", conflictStore, "fetch", conflictRepo.bundle, `${conflictRepo.commit}:refs/heads/base`]);
async function commitPatch(diff: string, ref: string) { const index = join(scratch, `index-${ref}`); const env = { GIT_INDEX_FILE: index }; const run = async (args: string[], input?: string) => { const r = await processDriver.command(["git", "-c", "user.name=m", "-c", "user.email=m@example.invalid", "--git-dir", conflictStore, ...args], { env, timeoutMs: 20000, input }); if (r.code) throw new Error(r.stderr); return r.stdout.trim(); }; await run(["read-tree", "base"]); await run(["apply", "--cached", "-"], diff); const tree = await run(["write-tree"]); const commit = await run(["commit-tree", tree, "-p", "base", "-m", ref]); await run(["update-ref", `refs/heads/${ref}`, commit]); }
await commitPatch(sameLineA, "left"); await commitPatch(sameLineB, "right");
const conflictMerge = await git(["--git-dir", conflictStore, "merge-tree", "--write-tree", "--name-only", "--no-messages", "left", "right"], [0, 1]);
record.integration = { ...(record.integration as object), overlappingEdits: { clean: conflictMerge.code === 0, conflicts: conflictMerge.out.split("\n").filter(Boolean).slice(1), reading: "Two edits to the same line cannot be combined silently; merge-tree reports the conflicted path without touching any working tree." } };

// 4. Failure isolation: one branch loses its acknowledgement after its child completed.
{
    const a = await branch(fixture, "branch-a", editA), b = await branch(fixture, "branch-b", editB), dispatch = b.driver.dispatch.bind(b.driver);
    b.driver.dispatch = async request => { await dispatch(request); if (request.node === "build") throw new Error("simulated lost acknowledgement"); };
    const [left, right] = await Promise.allSettled([advanceContainedGraph(a.directory, a.driver), advanceContainedGraph(b.directory, b.driver)]);
    b.driver.dispatch = dispatch;
    const resumed = await advanceContainedGraph(b.directory, b.driver), child = await readController(join(b.directory, "children/build/state"));
    record.failureIsolation = { unaffectedBranch: left.status === "fulfilled" ? left.value.phase : "rejected", failedBranchFirstAdvance: right.status, failedBranchAfterResume: resumed.phase, failedBranchChildSessions: child.result.sessions, reading: "Branches in separate graphs fail independently; the failed branch reconciles its completed child without another run." };
}

// 5. What the current serial contract cannot express.
const refusals: Record<string, string> = {};
const baseGraph = (nodes: any) => ({ version: 1, id: "fork-probe", repository: plan("https://fixture.invalid/phase4.git", fixture.commit).repository, entry: "build-a", required: ["build-a"], budget: { maxRoleSessions: 8, maxVerificationAttempts: 12, wallClockSeconds: 1800 }, nodes });
const leaf = plan("https://fixture.invalid/phase4.git", fixture.commit);
for (const [name, nodes] of Object.entries({
    "two-root-loops": { "build-a": { kind: "loop", input: "root", plan: leaf, then: "done" }, "build-b": { kind: "loop", input: "root", plan: leaf, then: "done" } },
    "join-by-two-inputs": { "build-a": { kind: "loop", input: "root", plan: leaf, then: "build-b" }, "build-b": { kind: "loop", input: "root", plan: leaf, then: "check" }, check: { kind: "check", input: ["build-a", "build-b"], then: "done" } },
})) { try { compileContainedGraph(baseGraph(nodes)); refusals[name] = "compiled"; } catch (error) { refusals[name] = (error as Error).message; } }
record.serialContract = { refusals, kernel: "Replay admits an event only for the single current cursor node, and each effect node has exactly one success edge. Fan-out needs several cursors; fan-in needs a node whose input names several candidates." };

await mkdir(output, { recursive: true });
const portable = JSON.parse(JSON.stringify(record).replaceAll(scratch, "[scratch]"));
delete portable.branches;
await writeFile(join(output, "phase4-baseline.json"), JSON.stringify(portable, null, 2) + "\n");
console.log(JSON.stringify(portable, null, 2));
await rm(scratch, { recursive: true, force: true });
