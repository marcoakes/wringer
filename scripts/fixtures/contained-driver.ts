/** TEST FIXTURE ONLY. Separately compiled; never imported by the public CLI.
 * Synthesizes ACP/check/display observations. It does not measure real containment. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compileDeclaration, canonicalPlanJson, discoverEnvironment, hashBytes, hashValue, type ExecutionPlan } from "../../packages/plan/src";
import { createLocalSourceBundle, prepareRepositorySource, processDriver, runtimeProvenanceVersion, type ContainedCommandRequest, type ContainedCommandResult, type PreparedRepositorySource, type RoleExecutionRequest, type RoleExecutionResult } from "../../packages/runtime/src";
import { startController, showControllerCandidate, immutableControllerFile } from "../../packages/application/src";

const [action, directoryArgument] = process.argv.slice(2), directory = resolve(directoryArgument!), repo = join(directory, "source"), origin = join(directory, "origin.git"), state = join(directory, "state");
async function git(args: string[]) { const result = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { timeoutMs: 20000 }); if (result.code !== 0) throw new Error(result.stderr); return result.stdout; }
const json = (path: string) => Bun.file(path).json();
if (action === "prepare") {
    await mkdir(directory, { recursive: true });
    await git(["init", "--initial-branch=main", repo]);
    await git(["init", "--bare", "--initial-branch=main", origin]);
    await git(["-C", repo, "config", "user.name", "Contained distribution fixture"]);
    await git(["-C", repo, "config", "user.email", "fixture@example.invalid"]);
    await mkdir(join(repo, "src"));
    await writeFile(join(repo, "README.md"), "Deterministic distribution fixture. Synthetic ACP/check/display receipts do not measure real containers or providers.\n");
    await writeFile(join(repo, "src/value.js"), "export const expected = false;\n");
    await writeFile(join(repo, "check.sh"), "test \"$(sed -n '1p' src/value.js)\" = 'export const expected = true;'\n");
    await git(["-C", repo, "add", "."]); await git(["-C", repo, "commit", "-m", "Committed fixture baseline"]); await git(["-C", repo, "push", origin, "main"]);
    const commit = (await git(["-C", repo, "rev-parse", "HEAD"])).trim();
    const declaration = { version: 1, name: "Compiled contained distribution fixture", intent: "Return the expected value. The display is readable.", repository: { url: "https://fixture.invalid/contained.git", commit }, runtime: { kind: "apple-container", image: `fixture.invalid/agent@sha256:${"a".repeat(64)}`, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] }, agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } }, environment: { context: ["README.md"], tools: [], setup: [{ id: "dependencies", argv: ["true"], cwd: ".", timeout_seconds: 5 }], baseline: [], writable_directories: [] }, scope: { writable: ["src"] }, acceptance: { criteria: [{ id: "expected", title: "Expected value", quote: "Return the expected value.", kind: "check", required: true }, { id: "readable", title: "Readable display", quote: "The display is readable.", kind: "human", required: true, show: { id: "show", argv: ["cat", "src/value.js"], cwd: ".", timeout_seconds: 5 } }], checks: [{ id: "expected", argv: ["sh", "check.sh"], cwd: ".", timeout_seconds: 5, criteria: ["expected"], files: ["check.sh"] }], protected_paths: ["check.sh"] }, budget: { max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 3600, session_timeout_seconds: 20 } };
    const plan = compileDeclaration(declaration);
    await writeFile(join(directory, "plan.yaml"), JSON.stringify(declaration, null, 2));
    await writeFile(join(directory, "plan.canonical.json"), canonicalPlanJson(plan));
    await mkdir(state);
    const sourceBundle = join(directory, "source.bundle");
    await createLocalSourceBundle(repo, commit, sourceBundle);
    const prepared = await prepareRepositorySource({ ...plan.repository, bundlePath: sourceBundle }, { controllerDir: state });
    await immutableControllerFile(join(state, "prepared-source.json"), prepared);
    // This is an explicitly synthetic pre-mapped fixture, not a discovery claim.
    await immutableControllerFile(join(state, "environment.json"), await discoverEnvironment(prepared.objectStore, plan));
    await writeFile(join(repo, "src/value.js"), "export const expected = true;\nexport const unused = true;\n");
    await writeFile(join(directory, "worker.patch"), await git(["-C", repo, "diff", "--binary", "--full-index"]));
    console.log(JSON.stringify({ fixture: true, state, origin, source: repo, plan: join(directory, "plan.yaml"), baseCommit: commit }));
} else {
    const plan: ExecutionPlan = await json(join(directory, "plan.canonical.json")), authority = await json(join(directory, "authority.json")), prepared: PreparedRepositorySource = await json(join(state, "prepared-source.json"));
    const originalInputs = await git(["--git-dir", prepared.objectStore, "--literal-pathspecs", "ls-tree", "-r", "-z", plan.repository.commit, "--", "check.sh"]);
    const provenance = (role: "worker" | "judge" | "verifier", source: any, runtime = plan.runtime) => ({ schema_version: runtimeProvenanceVersion(source.url), runtimeId: crypto.randomUUID(), role, kind: runtime.kind, image: runtime.image, repository: { url: source.url, commit: source.commit }, clonedInside: true as const, hostMounts: [] as [], repositoryAccess: role === "worker" ? "read-write" as const : "read-only" as const, declared: runtime, observed: { fixture: true, writableDirectories: plan.environment.writable_directories }, limits: ["Synthetic fixture receipt: no real container, provider, authentication or agent convergence measured"] });
    const runCommands = async (request: ContainedCommandRequest): Promise<ContainedCommandResult> => {
        const source = request.repo as PreparedRepositorySource;
        if (!source.objectStore) throw new Error("Fixture needs the controller's bare source object store");
        const tree = (await git(["--git-dir", source.objectStore, "rev-parse", `${source.commit}^{tree}`])).trim(), contents = await git(["--git-dir", source.objectStore, "show", `${source.commit}:src/value.js`]);
        return { provenance: provenance("verifier", source, request.runtime), sourceChanged: false, sourceTree: tree, checkInputsSha256: hashBytes(originalInputs), results: request.commands.map(c => ({ id: c.id, code: c.id.startsWith("acceptance/") && !contents.includes("expected = true;") ? 1 : 0, stdout: c.id === "show" ? contents : "Synthetic fixture observation of the pinned source blob\n", stderr: "", durationMs: 1 })) };
    };
    if (action === "run") {
        const patch = await readFile(join(directory, "worker.patch"), "utf8");
        const executeRole = async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => ({ status: "completed", text: request.role === "worker" ? "PRIVATE_FIXTURE_WORKER_NARRATIVE" : JSON.stringify({ criteria: [{ id: "expected", met: true, reason: "Synthetic independent fixture finding" }], note: "Fixture only, not live model review" }), sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "synthetic-distribution-fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "PRIVATE_FIXTURE_CONSOLE", provenance: provenance(request.role as "worker" | "judge", request.repo), ...(request.role === "worker" ? { change: { baseCommit: request.repo.commit, patch, sha256: hashBytes(patch) } } : {}) });
        const result = await startController(state, plan, authority, { executeRole, runCommands });
        if (result.status !== "human-hold") throw new Error(JSON.stringify(result));
        console.log(JSON.stringify(result));
    } else if (action === "display") {
        const result = await showControllerCandidate(state, "readable", { runCommands });
        await writeFile(join(directory, "display.json"), JSON.stringify(result.receipt, null, 2));
        console.log(JSON.stringify({ synthetic: true, id: result.receipt.id, output: result.output }));
    } else throw new Error("Fixture actions are prepare, run and display only");
}
