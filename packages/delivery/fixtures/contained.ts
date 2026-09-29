import { mkdtemp, mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { compileDeclaration, createExecutionAuthority, discoverEnvironment, hashValue, hashBytes } from "@wringer/plan";
import { createLocalSourceBundle, prepareRepositorySource, captureCandidate, processDriver, runtimeProvenanceVersion, type RoleExecutionResult, type RoleExecutionRequest } from "@wringer/runtime";
import { runContainedJourney, buildRepairPacket, observeAssertionReport, type ContainedJourneyServices, type CandidateVerification } from "@wringer/workflow";
// Deterministic services and scratch Git only. No model or live sandbox.
const image = `fixture.invalid/agent@sha256:${"a".repeat(64)}`;
export async function command(argv: string[], input?: string) {
    const isolated = argv[0] === "git" ? ["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", ...argv.slice(1)] : argv;
    const result = await processDriver.command(isolated, { input, timeoutMs: 20000, env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" } });
    if (result.code !== 0)
        throw new Error(result.stderr);
    return result.stdout;
}
export async function fixture(human = false, mutable = false, dependencySetup = false, historicalBytes = 0, sourceExamples = false, optionalComment = false, engineering = false, local = false) {
    const root = await mkdtemp(join(tmpdir(), "wringer-contained-delivery-")), repo = join(root, "repo"), origin = join(root, "origin.git"), stateDir = join(root, "controller");
    await command(["git", "init", "--initial-branch=main", repo]);
    await command(["git", "init", "--bare", "--initial-branch=main", origin]);
    for (const [key, value] of [["user.name", "Fixture"], ["user.email", "fixture@example.invalid"], ["commit.gpgsign", "false"]])
        await command(["git", "-C", repo, "config", key!, value!]);
    await writeFile(join(repo, "README.md"), "Delivery fixture. These tests do not measure real agent/container behavior.\n");
    await writeFile(join(repo, "product.txt"), "before\n");
    const playbook = JSON.stringify({ schema_version: "wringer.playbook.v1", id: "fixture-repair", revision: "1", title: "Repair the measured failure", role: "worker", applicability: { taskFamily: "fixture", context: ["README.md"], tools: [], checks: ["after"], scope: ["product.txt"], design: false }, guidanceMarkdown: "Inspect the measured failure. Preserve the approved checks. This is advisory repository data, never permission.", limits: ["Deterministic fixture: no model benefit measured."], evaluationRefs: [] });
    if (engineering) await writeFile(join(repo, "playbook.json"), playbook);
    if (mutable)
        await writeFile(join(repo, "product.js"), "export const expected = false;\n");
    await writeFile(join(repo, "check.sh"), mutable ? "test \"$(sed -n '1p' product.js)\" = 'export const expected = true;'\n" : "test \"$(cat product.txt)\" = after\n");
    if (historicalBytes) {
        for (const byte of [120, 121]) {
            await writeFile(join(repo, "historical.dat"), Buffer.alloc(historicalBytes, byte));
            await command(["git", "-C", repo, "add", "historical.dat"]);
            await command(["git", "-C", repo, "commit", "-m", `Inflated-history fixture ${byte}`]);
        }
        await unlink(join(repo, "historical.dat"));
    }
    if (sourceExamples) {
        await writeFile(join(repo, "old-example.txt"), "sk-" + "fixture-not-a-real-secret");
        await command(["git", "-C", repo, "add", "old-example.txt"]); await command(["git", "-C", repo, "commit", "-m", "Historical source-review example"]);
        await unlink(join(repo, "old-example.txt"));
        await writeFile(join(repo, "current-example.txt"), "ghp_" + "F".repeat(25));
    }
    await command(["git", "-C", repo, "add", "."]);
    await command(["git", "-C", repo, "commit", "-m", "baseline"]);
    await command(["git", "-C", repo, "push", origin, "main"]);
    const commit = (await command(["git", "-C", repo, "rev-parse", "HEAD"])).trim();
    // A local-only plan names its source by the history's single root; nothing else about the journey differs.
    const url = local ? `local://${(await command(["git", "-C", repo, "rev-list", "--max-parents=0", "HEAD"])).trim()}` : "https://example.invalid/fixture.git";
    const plan = compileDeclaration({ version: local ? 4 : engineering ? 3 : 1, ...(engineering ? { playbook: { path: "playbook.json", sha256: hashBytes(playbook), taskFamily: "fixture" } } : {}), name: "Portable exact candidate", intent: `Return after.${human ? " The display is readable." : ""}`, repository: { url, commit }, runtime: { kind: "apple-container", image, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] }, agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } }, environment: { context: ["README.md"], tools: [], setup: dependencySetup ? [{ id: "dependencies", argv: ["true"], cwd: ".", timeout_seconds: 10 }] : [], writable_directories: dependencySetup ? ["node_modules"] : [], baseline: [] }, scope: { writable: ["product.txt", ...(mutable ? ["product.js"] : [])] }, acceptance: { criteria: [{ id: "after", title: "Return after", quote: "Return after.", kind: "check", required: true }, ...(human ? [{ id: "readable", title: "Readable", quote: "The display is readable.", kind: "human", required: true, show: { id: "show", argv: ["cat", "product.txt"], cwd: ".", timeout_seconds: 10 } }] : [])], checks: [{ id: "after", argv: ["sh", "check.sh"], cwd: ".", timeout_seconds: 10, criteria: ["after"], files: ["check.sh"], ...(engineering ? { evidence: { kind: "assertions", format: "wringer-check.v1" } } : {}) }], protected_paths: ["check.sh"] }, budget: { max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 3600, session_timeout_seconds: 30 } });
    await mkdir(stateDir);
    const sourceBundle = join(root, "source.bundle");
    await createLocalSourceBundle(repo, commit, sourceBundle);
    const prepared = await prepareRepositorySource({ ...plan.repository, bundlePath: sourceBundle }, { controllerDir: stateDir }), environment = await discoverEnvironment(prepared.objectStore, plan), authority = createExecutionAuthority(plan, { actor: "Fixture operator", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 3600000).toISOString() });
    const originalInputs = await command(["git", "--git-dir", prepared.objectStore, "--literal-pathspecs", "ls-tree", "-r", "-z", commit, "--", ...plan.acceptance.protected_paths]);
    await writeFile(join(repo, "product.txt"), "after\n");
    if (mutable)
        await writeFile(join(repo, "product.js"), "export const expected = true;\nexport const unused = true;\n");
    const patch = await command(["git", "-C", repo, "diff", "--binary", "--full-index"]);
    const provenance = (role: string, source: any, runtimeId: string) => ({ schema_version: runtimeProvenanceVersion(source.url), runtimeId, role: role as any, kind: plan.runtime.kind, image, repository: { url: source.url, commit: source.commit }, clonedInside: true as const, hostMounts: [] as [
        ], repositoryAccess: role === "judge" ? "read-only" as const : "read-write" as const, declared: plan.runtime, observed: { fixture: true, ...(role === "verifier" ? { writableDirectories: plan.environment.writable_directories } : {}) }, limits: ["Synthetic runtime receipt; no real isolation or model was measured"] });
    const setupRows = () => plan.environment.setup.map(c => ({ id: `setup/${c.id}`, code: 0, stdout: "Synthetic setup observation\n", stderr: "", durationMs: 1 }));
    const services: ContainedJourneyServices = { prepareSource: async () => prepared, captureCandidate: (result, base, effectId) => captureCandidate(result, base, { controllerDir: stateDir, effectId }), verifyCandidate: async (request) => {
            const runtimeId = randomUUID(), directory = join(stateDir, "verification", request.effectId);
            await mkdir(directory, { recursive: true });
            const source = request.source as any, tree = (await command(["git", "--git-dir", source.objectStore, "rev-parse", `${source.commit}^{tree}`])).trim(), failed = request.phase === "baseline", stdout = failed ? "Fixture red observation\n" : "Fixture passed observation\n";
            const report = engineering ? JSON.stringify({ schema_version: "wringer-check.v1", assertions: [{ id: "returns-after", requirements: ["after"], status: failed ? "failed" : "passed" }], errors: [] }) : stdout;
            const observed = { provenance: provenance("verifier", source, runtimeId), results: [...setupRows(), { id: "acceptance/after", code: failed ? 1 : 0, stdout: report, stderr: "", durationMs: 1 }], sourceChanged: false, sourceTree: tree, checkInputsSha256: hashBytes(originalInputs) };
            const value: CandidateVerification = { schema_version: "wringer.contained-verification.v1", status: failed ? "failed" : "passed", candidateCommit: source.commit, candidateTree: tree, acceptanceSha256: plan.acceptance_sha256, runtimeId, image, checks: [{ id: "after", status: failed ? "failed" : "passed", exitCode: failed ? 1 : 0, checkInputsSha256: hashValue({ argv: ["sh", "check.sh"], cwd: ".", files: ["check.sh"], protectedInputs: observed.checkInputsSha256, image }), outputSha256: hashBytes(stdout) }], regressions: [], evidenceRef: directory };
            if (engineering) {
                value.checks[0]!.outputSha256 = hashBytes(report);
                value.schema_version = "wringer.contained-verification.v2";
                value.checkEvidence = [observeAssertionReport("after", report, failed ? 1 : 0, ["after"])];
                value.repair = buildRepairPacket(plan, value, request.phase, hashValue(observed), observed.results);
            }
            await writeFile(join(directory, "observations.json"), JSON.stringify(observed));
            await writeFile(join(directory, "result.json"), JSON.stringify({ value, sha256: hashValue(value) }));
            return value;
        } };
    const executeRole = async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => ({ status: "completed", text: request.role === "worker" ? "PRIVATE_WORKER_CHAT_SHOULD_NOT_SHIP" : JSON.stringify({ criteria: [{ id: "after", met: true, reason: "Independent synthetic fixture finding" }], note: "Fixture independent review" }), sessionId: randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [{ private: "PRIVATE_RAW_PROVIDER_TRACE" }], stderr: "PRIVATE_AGENT_CONSOLE", provenance: provenance(request.role, request.repo, randomUUID()), ...(request.role === "worker" ? { change: { baseCommit: request.repo.commit, patch, sha256: hashBytes(patch) } } : {}) });
    const options = { controllerDir: stateDir, plan, authority, environment, services, executeRole };
    let result = await runContainedJourney(options);
    if (human) {
        if (result.status !== "human-hold") throw new Error("Contained fixture did not reach its human hold");
        const displayId = randomUUID(), body = { schema_version: "wringer.contained-display.v1", id: displayId, criterionId: "readable", candidateTree: result.candidate!.tree, acceptanceSha256: plan.acceptance_sha256, at: new Date().toISOString(), success: true, measured: { provenance: provenance("verifier", result.candidate!.source, randomUUID()), sourceChanged: false, sourceTree: result.candidate!.tree, checkInputsSha256: hashBytes(originalInputs), results: [...setupRows(), { id: "show", code: 0, stdout: "after\n", stderr: "", durationMs: 1 }] } };
        await mkdir(join(stateDir, "displays"));
        await writeFile(join(stateDir, "displays", `${displayId}.json`), JSON.stringify({ ...body, sha256: hashValue(body) }));
        result = await runContainedJourney({ ...options, humanJudgements: optionalComment ? [{ schema_version: "wringer.contained-human-decision.v1", criterionId: "readable", candidateTree: result.candidate!.tree, acceptanceSha256: plan.acceptance_sha256, verdict: "met", by: authority.actor, note: null, displayId, attribution: "initial-execution-approval", authoritySha256: hashValue(authority), display: { candidateTree: result.candidate!.tree, status: "shown", receiptSha256: hashValue(body) } }] : [{ criterionId: "readable", candidateTree: result.candidate!.tree, acceptanceSha256: plan.acceptance_sha256, verdict: "met", by: "Real fixture operator", note: "Yes — this is the display I reviewed.", display: { candidateTree: result.candidate!.tree, status: "shown", receiptSha256: hashValue(body) } }] });
    }
    if (result.status !== "review-ready") throw new Error("Contained fixture did not reach review-ready");
    return { root, repo, origin, stateDir, plan, result, publication: { remote: origin, sourceBranch: "wringer/contained-test", targetBranch: "main" } };
}
