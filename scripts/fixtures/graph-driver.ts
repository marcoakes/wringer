/** TEST FIXTURE ONLY. Separately compiled; never imported by the public CLI.
 * Synthesizes ACP replies and check observations for contained graph loops and
 * checks. Real Git, real source transport and a real local bare origin; no real
 * container, provider or human decision is measured. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hashBytes } from "../../packages/plan/src";
import { createLocalSourceBundle, processDriver, runtimeProvenanceVersion, type ContainedCommandRequest, type ContainedCommandResult, type PreparedRepositorySource, type RoleExecutionRequest, type RoleExecutionResult } from "../../packages/runtime/src";
import { containedGraphDriver, graphStatusView } from "../../packages/application/src";
import { advanceContainedGraph } from "../../packages/scheduler/src";

const [action, directoryArgument, stateArgument] = process.argv.slice(2), directory = resolve(directoryArgument!), repo = join(directory, "source"), origin = join(directory, "origin.git");
async function git(args: string[]) { const result = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { timeoutMs: 20000 }); if (result.code !== 0) throw new Error(result.stderr); return result.stdout.trim(); }
if (action === "prepare") {
    await mkdir(directory, { recursive: true });
    await git(["init", "--initial-branch=main", repo]); await git(["init", "--bare", "--initial-branch=main", origin]);
    await git(["-C", repo, "config", "user.name", "Graph distribution fixture"]); await git(["-C", repo, "config", "user.email", "fixture@example.invalid"]);
    await mkdir(join(repo, "src"));
    await writeFile(join(repo, "README.md"), "Deterministic graph distribution fixture. Synthetic receipts do not measure real containers or providers.\n");
    await writeFile(join(repo, "src/value.js"), "export const expected = false;\n");
    await writeFile(join(repo, "check.sh"), "test \"$(sed -n '1p' src/value.js)\" = 'export const expected = true;'\n");
    await git(["-C", repo, "add", "."]); await git(["-C", repo, "commit", "-m", "Committed fixture baseline"]); await git(["-C", repo, "push", origin, "main"]);
    const commit = await git(["-C", repo, "rev-parse", "HEAD"]);
    await writeFile(join(repo, "src/value.js"), "export const expected = true;\n");
    await writeFile(join(directory, "worker.patch"), await git(["-C", repo, "diff", "--binary", "--full-index"]) + "\n");
    await git(["-C", repo, "checkout", "--", "src/value.js"]);
    await createLocalSourceBundle(repo, commit, join(directory, "source.bundle"));
    const url = "https://fixture.invalid/graph.git";
    const plan = { version: 3, name: "Graph distribution fixture", intent: "Return the expected value.", repository: { url, commit },
        runtime: { kind: "apple-container", image: `fixture.invalid/agent@sha256:${"a".repeat(64)}`, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] },
        agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } },
        environment: { context: ["README.md"], tools: [], setup: [], baseline: [], writable_directories: [] }, scope: { writable: ["src"] },
        acceptance: { criteria: [{ id: "expected", title: "Expected value", quote: "Return the expected value.", kind: "check", required: true }], checks: [{ id: "expected", argv: ["sh", "check.sh"], cwd: ".", timeout_seconds: 5, criteria: ["expected"], files: ["check.sh"] }], protected_paths: ["check.sh"] },
        budget: { max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 3600, session_timeout_seconds: 900 } };
    const graph = { version: 1, id: "graph-fixture", repository: { url, commit }, entry: "scope", required: ["build", "verify", "review", "ship"],
        budget: { maxRoleSessions: 4, maxVerificationAttempts: 6, wallClockSeconds: 1800 },
        nodes: { scope: { kind: "human-hold", input: "root", prompt: "Confirm this exact scope before work.", then: "build" },
            build: { kind: "loop", input: "root", plan: "plan.yaml", then: "verify" }, verify: { kind: "check", input: "build", then: "route" },
            route: { kind: "router", input: "verify", routes: [{ outcome: "passed", to: "review" }], otherwise: "fail" },
            review: { kind: "human-hold", input: "verify", prompt: "Inspect the exact candidate and evidence.", then: "ship" },
            ship: { kind: "delivery", input: "review", publication: { remote: origin, sourceBranch: "wringer/graph-fixture", targetBranch: "main" }, then: "done" } } };
    await writeFile(join(directory, "plan.yaml"), JSON.stringify(plan, null, 2)); await writeFile(join(directory, "graph.yaml"), JSON.stringify(graph, null, 2));
    console.log(JSON.stringify({ fixture: true, origin, baseCommit: commit, graph: join(directory, "graph.yaml"), bundle: join(directory, "source.bundle") }));
} else if (action === "advance") {
    const state = resolve(stateArgument!), patch = await readFile(join(directory, "worker.patch"), "utf8"), crash = process.env.WRINGER_GRAPH_FIXTURE_CRASH;
    const provenance = (role: "worker" | "judge" | "verifier", source: { url: string; commit: string }, runtime: any) => ({ schema_version: runtimeProvenanceVersion(source.url), runtimeId: crypto.randomUUID(), role, kind: runtime.kind, image: runtime.image, repository: { url: source.url, commit: source.commit }, clonedInside: true as const, hostMounts: [] as [], repositoryAccess: role === "worker" ? "read-write" as const : "read-only" as const, declared: runtime, observed: { fixture: true, writableDirectories: [] }, limits: ["Synthetic fixture receipt: no real container, provider, authentication or agent convergence measured"] });
    const runCommands = async (request: ContainedCommandRequest): Promise<ContainedCommandResult> => {
        const source = request.repo as PreparedRepositorySource, acceptance = request.acceptanceSource as PreparedRepositorySource;
        const tree = await git(["--git-dir", source.objectStore, "rev-parse", `${source.commit}^{tree}`]), contents = await git(["--git-dir", source.objectStore, "show", `${source.commit}:src/value.js`]);
        const inputs = await git(["--git-dir", acceptance.objectStore, "--literal-pathspecs", "ls-tree", "-r", "-z", acceptance.commit, "--", "check.sh"]);
        return { provenance: provenance("verifier", source, request.runtime), sourceChanged: false, sourceTree: tree, checkInputsSha256: hashBytes(inputs), results: request.commands.map(c => ({ id: c.id, code: c.id.startsWith("acceptance/") && !contents.includes("expected = true;") ? 1 : 0, stdout: "Synthetic fixture observation of the pinned source blob\n", stderr: "", durationMs: 1 })) };
    };
    const executeRole = async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => ({ status: "completed", text: request.role === "worker" ? "PRIVATE_FIXTURE_WORKER_NARRATIVE" : JSON.stringify({ criteria: [{ id: "expected", met: true, reason: "Synthetic independent fixture finding" }], note: "Fixture only, not live model review" }), sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "synthetic-graph-fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "PRIVATE_FIXTURE_CONSOLE", provenance: provenance(request.role as "worker" | "judge", request.repo, request.runtime), ...(request.role === "worker" ? { change: { baseCommit: request.repo.commit, patch, sha256: hashBytes(patch) } } : {}) }) as RoleExecutionResult;
    const driver = containedGraphDriver({ executeRole, runCommands }), dispatch = driver.dispatch.bind(driver);
    // Crash probes simulate a killed process at an exact durable boundary.
    driver.dispatch = async request => { await dispatch(request); if (crash === "after-child" && request.node === "build") process.exit(9); };
    const result = await advanceContainedGraph(state, driver, { checkpoint: async event => { if (crash === "after-marker" && event.kind === "dispatch") process.exit(9); } });
    console.log(JSON.stringify(graphStatusView(state, result)));
} else throw new Error("Fixture actions are prepare and advance only");
