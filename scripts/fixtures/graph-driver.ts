/** TEST FIXTURE ONLY. Separately compiled; never imported by the public CLI.
 * Synthesizes ACP replies and check observations for contained graph loops and
 * checks. Real Git, real source transport and a real local bare origin; no real
 * container, provider or human decision is measured. */
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
} else if (action === "prepare-parallel") {
    // Two branches, each finishing its own module; each plan checks its own file.
    await mkdir(directory, { recursive: true });
    await git(["init", "--initial-branch=main", repo]); await git(["init", "--bare", "--initial-branch=main", origin]);
    await git(["-C", repo, "config", "user.name", "Graph distribution fixture"]); await git(["-C", repo, "config", "user.email", "fixture@example.invalid"]);
    await mkdir(join(repo, "src"));
    await writeFile(join(repo, "README.md"), "Deterministic parallel graph fixture. Synthetic role receipts do not measure real containers or providers.\n");
    await writeFile(join(repo, "src/reader.js"), "export const reader = 'todo';\n"); await writeFile(join(repo, "src/writer.js"), "export const writer = 'todo';\n");
    await writeFile(join(repo, "check-reader.sh"), "grep -q \"'done'\" src/reader.js\n"); await writeFile(join(repo, "check-writer.sh"), "grep -q \"'done'\" src/writer.js\n");
    await git(["-C", repo, "add", "."]); await git(["-C", repo, "commit", "-m", "Committed fixture baseline"]); await git(["-C", repo, "push", origin, "main"]);
    const commit = await git(["-C", repo, "rev-parse", "HEAD"]);
    for (const name of ["reader", "writer"]) {
        await writeFile(join(repo, `src/${name}.js`), `export const ${name} = 'done';\n`);
        await writeFile(join(directory, `worker-${name}.patch`), await git(["-C", repo, "diff", "--binary", "--full-index"]) + "\n");
        await git(["-C", repo, "checkout", "--", `src/${name}.js`]);
    }
    await createLocalSourceBundle(repo, commit, join(directory, "source.bundle"));
    const url = "https://fixture.invalid/parallel.git";
    const leaf = (name: string) => ({ version: 3, name: `Finish ${name}`, intent: `Finish the ${name} module.`, repository: { url, commit },
        runtime: { kind: "apple-container", image: `fixture.invalid/agent@sha256:${"a".repeat(64)}`, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] },
        agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } },
        environment: { context: ["README.md"], tools: [], setup: [], baseline: [], writable_directories: [] }, scope: { writable: ["src"] },
        acceptance: { criteria: [{ id: "done", title: `Finish ${name}`, quote: `Finish the ${name} module.`, kind: "check", required: true }], checks: [{ id: "done", argv: ["sh", `check-${name}.sh`], cwd: ".", timeout_seconds: 5, criteria: ["done"], files: ["check-reader.sh", "check-writer.sh"] }], protected_paths: ["check-reader.sh", "check-writer.sh"] },
        budget: { max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 3600, session_timeout_seconds: 900 } });
    for (const name of ["reader", "writer"]) await writeFile(join(directory, `${name}.yaml`), JSON.stringify(leaf(name), null, 2));
    const graph = { version: 2, id: "parallel-fixture", repository: { url, commit }, entry: "split", required: ["reader", "writer", "review", "ship"], parallelism: 2,
        budget: { maxRoleSessions: 8, maxVerificationAttempts: 12, wallClockSeconds: 1800 },
        nodes: { split: { kind: "fork", input: "root", branches: ["reader", "writer"], join: "merge" },
            reader: { kind: "loop", input: "split", plan: "reader.yaml", then: "merge" }, writer: { kind: "loop", input: "split", plan: "writer.yaml", then: "merge" },
            merge: { kind: "join", fork: "split", then: "after" },
            after: { kind: "router", input: "merge", routes: [{ outcome: "integrated", to: "review" }], otherwise: "fail" },
            review: { kind: "human-hold", input: "merge", prompt: "Inspect the integrated candidate.", then: "ship" },
            ship: { kind: "delivery", input: "review", publication: { remote: origin, sourceBranch: "wringer/parallel-fixture", targetBranch: "main" }, then: "done" } } };
    await writeFile(join(directory, "graph.yaml"), JSON.stringify(graph, null, 2));
    console.log(JSON.stringify({ fixture: true, origin, baseCommit: commit, graph: join(directory, "graph.yaml"), bundle: join(directory, "source.bundle") }));
} else if (action === "prepare-tournament") {
    // Three attempts at one task: one hard-codes the checked example; a trusted control and a hidden evaluator.
    await mkdir(directory, { recursive: true });
    await git(["init", "--initial-branch=main", repo]); await git(["init", "--bare", "--initial-branch=main", origin]);
    await git(["-C", repo, "config", "user.name", "Graph distribution fixture"]); await git(["-C", repo, "config", "user.email", "fixture@example.invalid"]);
    await mkdir(join(repo, "src"));
    await writeFile(join(repo, "README.md"), "Deterministic tournament fixture. Synthetic role receipts do not measure real containers or providers.\n");
    await writeFile(join(repo, "src/total.sh"), "#!/bin/sh\necho $(( $1 + $2 + 1 ))\n"); await writeFile(join(repo, "check.sh"), "test \"$(sh src/total.sh 2 3)\" = 5\n");
    await git(["-C", repo, "add", "."]); await git(["-C", repo, "commit", "-m", "Committed buggy baseline"]); await git(["-C", repo, "push", origin, "main"]);
    const commit = await git(["-C", repo, "rev-parse", "HEAD"]);
    const attempts: Record<string, string> = { "build-a": "echo 5", "build-b": "echo $(( $1 + $2 ))", "build-c": "expr \"$1\" + \"$2\"" };
    for (const [branch, body] of Object.entries(attempts)) {
        await writeFile(join(repo, "src/total.sh"), `#!/bin/sh\n${body}\n`);
        await writeFile(join(directory, `worker-${branch}.patch`), await git(["-C", repo, "diff", "--binary", "--full-index"]) + "\n");
        await git(["-C", repo, "checkout", "--", "src/total.sh"]);
    }
    await git(["-C", repo, "checkout", "-q", "-b", "reference"]); await writeFile(join(repo, "src/total.sh"), `#!/bin/sh\n${attempts["build-b"]}\n`); await git(["-C", repo, "commit", "-qam", "Trusted reference implementation"]);
    const control = await git(["-C", repo, "rev-parse", "HEAD"]); await git(["-C", repo, "checkout", "-q", "main"]);
    await git(["-C", repo, "bundle", "create", join(directory, "source.bundle"), "main", "reference"]);
    const scratch = join(directory, "prosecutor-artifact"); await git(["init", "-q", scratch]); await mkdir(join(scratch, "wringer"), { recursive: true });
    const grid = { id: "grid", criterion: "sum", argv: ["sh", "wringer/challenges/grid.sh"], timeout_seconds: 10, files: [{ path: "wringer/challenges/grid.sh", content: "for a in 0 1 4; do for b in 0 2 9; do test \"$(sh src/total.sh $a $b)\" = $(( a + b )) || exit 1; done; done\n" }] };
    const wrong = { id: "wrong-expectation", criterion: "sum", argv: ["sh", "wringer/challenges/wrong.sh"], timeout_seconds: 10, files: [{ path: "wringer/challenges/wrong.sh", content: "test \"$(sh src/total.sh 2 2)\" = 5\n" }] };
    await writeFile(join(scratch, "wringer/challenges.json"), JSON.stringify([wrong, grid], null, 2)); await git(["-C", scratch, "add", "-A"]);
    await writeFile(join(directory, "prosecutor.patch"), await git(["-C", scratch, "diff", "--cached", "--binary", "--full-index"]) + "\n");
    const url = "https://fixture.invalid/tournament.git";
    const leaf = (intent: string, writable: string[]) => ({ version: 3, name: "Fix the total", intent, repository: { url, commit },
        runtime: { kind: "apple-container", image: `fixture.invalid/agent@sha256:${"a".repeat(64)}`, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] },
        agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } },
        environment: { context: ["README.md"], tools: [], setup: [], baseline: [], writable_directories: [] }, scope: { writable },
        acceptance: { criteria: [{ id: "sum", title: "Sum", quote: "Return the sum of two integers", kind: "check", required: true }], checks: [{ id: "sum", argv: ["sh", "check.sh"], cwd: ".", timeout_seconds: 5, criteria: ["sum"], files: ["check.sh"] }], protected_paths: ["check.sh"] },
        budget: { max_sessions: 2, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 3600, session_timeout_seconds: 900 } });
    for (const branch of Object.keys(attempts)) await writeFile(join(directory, `${branch}.yaml`), JSON.stringify(leaf(`Return the sum of two integers (attempt ${branch}).`, ["src"]), null, 2));
    await writeFile(join(directory, "prosecutor.yaml"), JSON.stringify(leaf("Return the sum of two integers; try to falsify every candidate.", ["wringer/challenges.json"]), null, 2));
    const graph = { version: 3, id: "tournament-fixture", repository: { url, commit }, entry: "split", required: ["pick", "review", "ship"], parallelism: 3,
        budget: { maxRoleSessions: 7, maxVerificationAttempts: 16, wallClockSeconds: 1800 },
        nodes: { split: { kind: "fork", input: "root", branches: Object.keys(attempts), join: "pick" },
            ...Object.fromEntries(Object.keys(attempts).map(branch => [branch, { kind: "loop", input: "split", plan: `${branch}.yaml`, then: "pick" }])),
            pick: { kind: "tournament", fork: "split", prosecutor: { plan: "prosecutor.yaml", maxChallenges: 4 },
                controls: [{ id: "reference", commit: control }],
                evaluator: [{ id: "hidden", argv: ["sh", "evaluator/hidden.sh"], cwd: ".", timeout_seconds: 10, files: [{ path: "evaluator/hidden.sh", content: "for a in -3 0 2 7; do for b in -2 0 3 5; do test \"$(sh src/total.sh $a $b)\" = $(( a + b )) || exit 1; done; done\n" }] }],
                tie: "tree-order", then: "after" },
            after: { kind: "router", input: "pick", routes: [{ outcome: "selected", to: "review" }], otherwise: "fail" },
            review: { kind: "human-hold", input: "pick", prompt: "Inspect the selected candidate and the tournament record.", then: "ship" },
            ship: { kind: "delivery", input: "review", publication: { remote: origin, sourceBranch: "wringer/tournament-fixture", targetBranch: "main" }, then: "done" } } };
    await writeFile(join(directory, "graph.yaml"), JSON.stringify(graph, null, 2));
    console.log(JSON.stringify({ fixture: true, origin, baseCommit: commit, control, graph: join(directory, "graph.yaml"), bundle: join(directory, "source.bundle") }));
} else if (action === "advance") {
    const state = resolve(stateArgument!), crash = process.env.WRINGER_GRAPH_FIXTURE_CRASH;
    const patchFor = async (prompt: string) => {
        if (prompt.includes("You are the prosecutor")) return readFile(join(directory, "prosecutor.patch"), "utf8");
        const attempt = /\(attempt (build-[a-z])\)/.exec(prompt)?.[1]; if (attempt) return readFile(join(directory, `worker-${attempt}.patch`), "utf8");
        for (const name of ["reader", "writer"]) if (prompt.includes(`Finish the ${name} module.`)) return readFile(join(directory, `worker-${name}.patch`), "utf8"); return readFile(join(directory, "worker.patch"), "utf8");
    };
    const provenance = (role: "worker" | "judge" | "verifier", source: { url: string; commit: string }, runtime: any) => ({ schema_version: runtimeProvenanceVersion(source.url), runtimeId: crypto.randomUUID(), role, kind: runtime.kind, image: runtime.image, repository: { url: source.url, commit: source.commit }, clonedInside: true as const, hostMounts: [] as [], repositoryAccess: role === "worker" ? "read-write" as const : "read-only" as const, declared: runtime, observed: { fixture: true, writableDirectories: [] }, limits: ["Synthetic fixture receipt: no real container, provider, authentication or agent convergence measured"] });
    const runCommands = async (request: ContainedCommandRequest): Promise<ContainedCommandResult> => {
        const source = request.repo as PreparedRepositorySource, acceptance = request.acceptanceSource as PreparedRepositorySource;
        // Really run each pinned acceptance command on the exported candidate tree.
        const tree = await git(["--git-dir", source.objectStore, "rev-parse", `${source.commit}^{tree}`]), work = await mkdtemp(join(directory, "verify-"));
        await git(["--git-dir", source.objectStore, "--work-tree", work, "checkout", source.commit, "--", "."]);
        const protectedFiles = request.protectedFiles?.length ? request.protectedFiles : ["check.sh"];
        // Pinned inputs come from the acceptance source, never from the candidate.
        for (const path of request.protectedFiles ?? []) { await mkdir(join(work, path, ".."), { recursive: true }); await writeFile(join(work, path), await git(["--git-dir", acceptance.objectStore, "show", `${acceptance.commit}:${path}`]) + "\n"); }
        const inputs = await git(["--git-dir", acceptance.objectStore, "--literal-pathspecs", "ls-tree", "-r", "-z", acceptance.commit, "--", ...protectedFiles]);
        return { provenance: provenance("verifier", source, request.runtime), sourceChanged: false, sourceTree: tree, checkInputsSha256: hashBytes(inputs), results: request.commands.map(c => ({ id: c.id, code: /^(acceptance|challenge|evaluator)\//.test(c.id) ? Bun.spawnSync(c.argv!, { cwd: work, stdout: "ignore", stderr: "ignore" }).exitCode : 0, stdout: "Fixture ran the pinned command on the exported candidate tree\n", stderr: "", durationMs: 1 })) };
    };
    const executeRole = async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => { const patch = await patchFor(request.prompt); return ({ status: "completed", text: request.role === "worker" ? "PRIVATE_FIXTURE_WORKER_NARRATIVE" : JSON.stringify({ criteria: [{ id: /Finish the (reader|writer) module\./.test(request.prompt) ? "done" : /Return the sum of two integers/.test(request.prompt) ? "sum" : "expected", met: true, reason: "Synthetic independent fixture finding" }], note: "Fixture only, not live model review" }), sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "synthetic-graph-fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "PRIVATE_FIXTURE_CONSOLE", provenance: provenance(request.role as "worker" | "judge", request.repo, request.runtime), ...(request.role === "worker" ? { change: { baseCommit: request.repo.commit, patch, sha256: hashBytes(patch) } } : {}) }) as RoleExecutionResult; };
    const driver = containedGraphDriver({ executeRole, runCommands }), dispatch = driver.dispatch.bind(driver);
    // Crash probes simulate a killed process at an exact durable boundary.
    driver.dispatch = async request => { await dispatch(request); if (crash === "after-child" && request.node === "build") process.exit(9); };
    // after-first-result: every branch child has finished, and the process dies before the second result is recorded.
    let results = 0;
    const result = await advanceContainedGraph(state, driver, { checkpoint: async event => { if (crash === "after-marker" && event.kind === "dispatch") process.exit(9); if (crash === "after-first-result" && event.kind === "result" && ++results === 1) process.exit(9); } });
    console.log(JSON.stringify(graphStatusView(state, result)));
} else throw new Error("Fixture actions are prepare, prepare-parallel, prepare-tournament and advance only");
