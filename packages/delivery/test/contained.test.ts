import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { compileDeclaration, createExecutionAuthority, discoverEnvironment, hashValue, hashBytes } from "@wringer/plan";
import { prepareRepositorySource, captureCandidate, processDriver, type RoleExecutionResult, type RoleExecutionRequest } from "@wringer/runtime";
import { runContainedJourney, type ContainedJourneyServices, type CandidateVerification } from "@wringer/workflow";
import { deliverContained, auditContained } from "../src/contained";
import { falsifyContained } from "../src/contained-falsify";
import { seal, files } from "../src/io";
const image = `fixture.invalid/agent@sha256:${"a".repeat(64)}`;
async function command(argv: string[], input?: string) {
    const result = await processDriver.command(argv, { input, timeoutMs: 20000 });
    if (result.code !== 0)
        throw new Error(result.stderr);
    return result.stdout;
}
async function fixture(human = false, mutable = false, dependencySetup = false) {
    const root = await mkdtemp(join(tmpdir(), "wringer-contained-delivery-")), repo = join(root, "repo"), origin = join(root, "origin.git"), stateDir = join(root, "controller");
    await command(["git", "init", "--initial-branch=main", repo]);
    await command(["git", "init", "--bare", "--initial-branch=main", origin]);
    for (const [key, value] of [["user.name", "Fixture"], ["user.email", "fixture@example.invalid"], ["commit.gpgsign", "false"]])
        await command(["git", "-C", repo, "config", key!, value!]);
    await writeFile(join(repo, "README.md"), "Delivery fixture. These tests do not measure real agent/container behavior.\n");
    await writeFile(join(repo, "product.txt"), "before\n");
    if (mutable)
        await writeFile(join(repo, "product.js"), "export const expected = false;\n");
    await writeFile(join(repo, "check.sh"), mutable ? "test \"$(sed -n '1p' product.js)\" = 'export const expected = true;'\n" : "test \"$(cat product.txt)\" = after\n");
    await command(["git", "-C", repo, "add", "."]);
    await command(["git", "-C", repo, "commit", "-m", "baseline"]);
    await command(["git", "-C", repo, "push", origin, "main"]);
    const commit = (await command(["git", "-C", repo, "rev-parse", "HEAD"])).trim();
    const plan = compileDeclaration({ version: 1, name: "Portable exact candidate", intent: `Return after.${human ? " The display is readable." : ""}`, repository: { url: "https://example.invalid/fixture.git", commit }, runtime: { kind: "apple-container", image, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] }, agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } }, environment: { context: ["README.md"], tools: [], setup: dependencySetup ? [{ id: "dependencies", argv: ["true"], cwd: ".", timeout_seconds: 10 }] : [], writable_directories: dependencySetup ? ["node_modules"] : [], baseline: [] }, scope: { writable: ["product.txt", ...(mutable ? ["product.js"] : [])] }, acceptance: { criteria: [{ id: "after", title: "Return after", quote: "Return after.", kind: "check", required: true }, ...(human ? [{ id: "readable", title: "Readable", quote: "The display is readable.", kind: "human", required: true, show: { id: "show", argv: ["cat", "product.txt"], cwd: ".", timeout_seconds: 10 } }] : [])], checks: [{ id: "after", argv: ["sh", "check.sh"], cwd: ".", timeout_seconds: 10, criteria: ["after"], files: ["check.sh"] }], protected_paths: ["check.sh"] }, budget: { max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 3600, session_timeout_seconds: 30 } });
    await mkdir(stateDir);
    const prepared = await prepareRepositorySource(plan.repository, { controllerDir: stateDir, localRepo: repo }), environment = await discoverEnvironment(prepared.objectStore, plan), authority = createExecutionAuthority(plan, { actor: "Fixture operator", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 3600000).toISOString() });
    const originalInputs = await command(["git", "--git-dir", prepared.objectStore, "--literal-pathspecs", "ls-tree", "-r", "-z", commit, "--", "check.sh"]);
    await writeFile(join(repo, "product.txt"), "after\n");
    if (mutable)
        await writeFile(join(repo, "product.js"), "export const expected = true;\nexport const unused = true;\n");
    const patch = await command(["git", "-C", repo, "diff", "--binary", "--full-index"]);
    const provenance = (role: string, source: any, runtimeId: string) => ({ schema_version: "wringer.runtime.v1" as const, runtimeId, role: role as any, kind: plan.runtime.kind, image, repository: { url: source.url, commit: source.commit }, clonedInside: true as const, hostMounts: [] as [
        ], repositoryAccess: role === "judge" ? "read-only" as const : "read-write" as const, declared: plan.runtime, observed: { fixture: true, ...(role === "verifier" ? { writableDirectories: plan.environment.writable_directories } : {}) }, limits: ["Synthetic runtime receipt; no real isolation or model was measured"] });
    const setupRows = () => plan.environment.setup.map(c => ({ id: `setup/${c.id}`, code: 0, stdout: "Synthetic setup observation\n", stderr: "", durationMs: 1 }));
    const services: ContainedJourneyServices = { prepareSource: async () => prepared, captureCandidate: (result, base, effectId) => captureCandidate(result, base, { controllerDir: stateDir, effectId }), verifyCandidate: async (request) => {
            const runtimeId = randomUUID(), directory = join(stateDir, "verification", request.effectId);
            await mkdir(directory, { recursive: true });
            const source = request.source as any, tree = (await command(["git", "--git-dir", source.objectStore, "rev-parse", `${source.commit}^{tree}`])).trim(), failed = request.phase === "baseline", stdout = failed ? "Fixture red observation\n" : "Fixture passed observation\n";
            const observed = { provenance: provenance("verifier", source, runtimeId), results: [...setupRows(), { id: "acceptance/after", code: failed ? 1 : 0, stdout, stderr: "", durationMs: 1 }], sourceChanged: false, sourceTree: tree, checkInputsSha256: hashBytes(originalInputs) };
            const value: CandidateVerification = { schema_version: "wringer.contained-verification.v1", status: failed ? "failed" : "passed", candidateCommit: source.commit, candidateTree: tree, acceptanceSha256: plan.acceptance_sha256, runtimeId, image, checks: [{ id: "after", status: failed ? "failed" : "passed", exitCode: failed ? 1 : 0, checkInputsSha256: hashValue({ argv: ["sh", "check.sh"], cwd: ".", files: ["check.sh"], protectedInputs: observed.checkInputsSha256, image }), outputSha256: hashBytes(stdout) }], regressions: [], evidenceRef: directory };
            await writeFile(join(directory, "observations.json"), JSON.stringify(observed));
            await writeFile(join(directory, "result.json"), JSON.stringify({ value, sha256: hashValue(value) }));
            return value;
        } };
    const executeRole = async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => ({ status: "completed", text: request.role === "worker" ? "PRIVATE_WORKER_CHAT_SHOULD_NOT_SHIP" : JSON.stringify({ criteria: [{ id: "after", met: true, reason: "Independent synthetic fixture finding" }], note: "Fixture independent review" }), sessionId: randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [{ private: "PRIVATE_RAW_PROVIDER_TRACE" }], stderr: "PRIVATE_AGENT_CONSOLE", provenance: provenance(request.role, request.repo, randomUUID()), ...(request.role === "worker" ? { change: { baseCommit: request.repo.commit, patch, sha256: hashBytes(patch) } } : {}) });
    const options = { controllerDir: stateDir, plan, authority, environment, services, executeRole };
    let result = await runContainedJourney(options);
    if (human) {
        expect(result.status).toBe("human-hold");
        const displayId = randomUUID(), body = { schema_version: "wringer.contained-display.v1", id: displayId, criterionId: "readable", candidateTree: result.candidate!.tree, acceptanceSha256: plan.acceptance_sha256, at: new Date().toISOString(), success: true, measured: { provenance: provenance("verifier", result.candidate!.source, randomUUID()), sourceChanged: false, sourceTree: result.candidate!.tree, checkInputsSha256: hashBytes(originalInputs), results: [...setupRows(), { id: "show", code: 0, stdout: "after\n", stderr: "", durationMs: 1 }] } };
        await mkdir(join(stateDir, "displays"));
        await writeFile(join(stateDir, "displays", `${displayId}.json`), JSON.stringify({ ...body, sha256: hashValue(body) }));
        result = await runContainedJourney({ ...options, humanJudgements: [{ criterionId: "readable", candidateTree: result.candidate!.tree, acceptanceSha256: plan.acceptance_sha256, verdict: "met", by: "Real fixture operator", note: "Yes — this is the display I reviewed.", display: { candidateTree: result.candidate!.tree, status: "shown", receiptSha256: hashValue(body) } }] });
    }
    expect(result.status).toBe("review-ready");
    return { root, repo, origin, stateDir, plan, result, publication: { remote: origin, sourceBranch: "wringer/contained-test", targetBranch: "main" } };
}
test("contained delivery prepares without publishing, then fresh-clone audit resolves exact candidate and human note", async () => {
    const f = await fixture(true, false, true), base = (await command(["git", "--git-dir", f.origin, "rev-parse", "main"])).trim();
    const prepared = await deliverContained({ stateDir: f.stateDir, publication: f.publication });
    expect(prepared.status).toBe("prepared");
    expect(prepared.codeCommit).toBe(f.result.candidate!.source.commit);
    expect(prepared.evidenceCommit).not.toBe(prepared.codeCommit);
    expect((await command(["git", "--git-dir", f.origin, "show-ref"]))).not.toContain("contained-test");
    const text = (await Promise.all((await files(prepared.bundleDir)).filter(path => path.endsWith(".json") || path.endsWith(".md")).map(path => readFile(join(prepared.bundleDir, path), "utf8")))).join("\n");
    expect(text).not.toContain(f.stateDir);
    expect(text).not.toContain("PRIVATE_WORKER_CHAT");
    expect(text).not.toContain("PRIVATE_AGENT_CONSOLE");
    expect(text).not.toContain("PRIVATE_RAW_PROVIDER_TRACE");
    expect(text).toContain("Yes — this is the display I reviewed.");
    expect(text).toContain("setup/dependencies");
    const delivered = await deliverContained({ stateDir: f.stateDir, publication: f.publication, send: true });
    expect(delivered.status).toBe("delivered");
    expect(delivered.evidenceCommit).toBe(prepared.evidenceCommit);
    expect((await command(["git", "--git-dir", f.origin, "rev-parse", "main"])).trim()).toBe(base);
    const clone = join(f.root, "fresh");
    await command(["git", "clone", "--branch", f.publication.sourceBranch, f.origin, clone]);
    const directory = join(clone, ".wringer/deliveries", delivered.deliveryId), audit = await auditContained(directory);
    expect(audit.status).toBe("passed");
    expect(audit.checks).toBe(1);
    expect(audit.human).toBe(1);
    expect((await command(["git", "-C", clone, "rev-parse", "HEAD^"])).trim()).toBe(delivered.codeCommit);
    expect(delivered.auditCommand).toBe(`wringer-drive audit --bundle .wringer/deliveries/${delivered.deliveryId}`);
    expect(delivered.falsify.command).toBe(`wringer-drive falsify --bundle .wringer/deliveries/${delivered.deliveryId}`);
    expect(await readFile(join(directory, "mr.md"), "utf8")).toContain(delivered.falsify.command);
}, 60000);
test("mutable terminal view or omitted verification observation cannot authorize delivery", async () => {
    const f = await fixture(), view = join(f.stateDir, ".wringer/contained/result.json"), original = await readFile(view, "utf8");
    await writeFile(view, original.replace('"review-ready"', '"stopped"'));
    await expect(deliverContained({ stateDir: f.stateDir, publication: f.publication })).rejects.toThrow();
    await writeFile(view, original);
    const observation = join(f.result.verification!.evidenceRef, "observations.json");
    const record = JSON.parse(await readFile(observation, "utf8"));
    record.results[0].code = 9;
    await writeFile(observation, JSON.stringify(record));
    await expect(deliverContained({ stateDir: f.stateDir, publication: f.publication })).rejects.toThrow("receipt");
}, 30000);
test("offline audit rejects missing red receipt, changed candidate bundle and resealed contradictory proof", async () => {
    const f = await fixture(), delivered = await deliverContained({ stateDir: f.stateDir, publication: f.publication }), manifest = JSON.parse(await readFile(join(delivered.bundleDir, "manifest.json"), "utf8"));
    const path = join(delivered.bundleDir, manifest.baseline.evidenceRef, "observations.json"), original = await readFile(path, "utf8"), record = JSON.parse(original);
    record.results[0].code = 0;
    await writeFile(path, JSON.stringify(record));
    await seal(delivered.bundleDir);
    expect((await auditContained(delivered.bundleDir)).status).toBe("failed");
    await writeFile(path, original);
    await writeFile(join(delivered.bundleDir, "candidate.bundle"), "not a git bundle");
    await seal(delivered.bundleDir);
    expect((await auditContained(delivered.bundleDir)).status).toBe("failed");
}, 45000);
test("publication refuses a default branch or a review branch with other content", async () => {
    const f = await fixture();
    await expect(deliverContained({ stateDir: f.stateDir, publication: { ...f.publication, sourceBranch: "main" }, send: true })).rejects.toThrow("nondefault");
    await command(["git", "--git-dir", f.origin, "update-ref", `refs/heads/${f.publication.sourceBranch}`, f.plan.repository.commit]);
    await expect(deliverContained({ stateDir: f.stateDir, publication: f.publication, send: true })).rejects.toThrow("already exists");
    expect((await command(["git", "--git-dir", f.origin, "rev-parse", f.publication.sourceBranch])).trim()).toBe(f.plan.repository.commit);
    await command(["git", "--git-dir", f.origin, "symbolic-ref", "HEAD", "refs/heads/not-created"]);
    await expect(deliverContained({ stateDir: f.stateDir, publication: f.publication, send: true })).rejects.toThrow("default branch could not be established");
}, 45000);
test("contained falsification challenges committed changes with distinct pinned runtimes, including caught and surviving mutants", async () => {
    const f = await fixture(false, true), delivered = await deliverContained({ stateDir: f.stateDir, publication: f.publication }), requests: any[] = [];
    const measured = await falsifyContained({ bundleDir: delivered.bundleDir, outputDir: join(f.root, "falsifications") }, { executeCommands: async (request) => {
            requests.push(request);
            const mutation = request.commands.find(c => c.id === "mutation/apply"), caught = mutation?.argv?.[2]?.includes("expected = false"), source = request.repo, tree = f.result.candidate!.tree;
            return { provenance: { schema_version: "wringer.runtime.v1", runtimeId: randomUUID(), role: "verifier", kind: request.runtime.kind, image, repository: { url: source.url, commit: source.commit }, clonedInside: true, hostMounts: [], repositoryAccess: "read-write", declared: request.runtime, observed: { fixture: true }, limits: ["Synthetic command observations, not live isolation"] }, sourceTree: tree, sourceChanged: !!mutation, checkInputsSha256: JSON.parse(await readFile(join(f.result.verification!.evidenceRef, "observations.json"), "utf8")).checkInputsSha256, results: request.commands.map(c => ({ id: c.id, code: c.id === "acceptance/after" && caught ? 1 : 0, stdout: "Synthetic fixture observation", stderr: "", durationMs: 1 })) };
        } });
    expect(measured.record.status).toBe("measured");
    expect(measured.record.counts).toEqual({ supported: 2, attempted: 2, caught: 1, survived: 1, unavailable: 0, unattempted: 0 });
    expect(requests).toHaveLength(3);
    expect(requests.every(r => r.repo.commit === delivered.codeCommit && r.acceptanceSource.commit === f.plan.repository.commit && r.protectedFiles.includes("check.sh"))).toBe(true);
    expect(requests.slice(1).every(r => r.commands.at(-1).id === "mutation/integrity")).toBe(true);
    expect(measured.record.anchor.committedRange).toBe(`${f.plan.repository.commit}..${delivered.codeCommit}`);
    expect(measured.table).toContain(`Measured at commit: ${delivered.codeCommit}`);
    expect(measured.table).toContain("survived");
    expect((await auditContained(join(measured.directory, "delivery"))).status).toBe("passed");
    const contents = (await Promise.all((await files(measured.directory)).filter(p => p.endsWith(".json")).map(p => readFile(join(measured.directory, p), "utf8")))).join("\n");
    expect(contents).not.toContain(f.stateDir);
    let calls = 0;
    const unavailable = await falsifyContained({ bundleDir: delivered.bundleDir, outputDir: join(f.root, "falsifications") }, { executeCommands: async () => { calls++; throw new Error("fixture runtime unavailable"); } });
    expect(calls).toBe(1);
    expect(unavailable.record.status).toBe("inconclusive");
    expect(unavailable.record.counts.caught).toBe(0);
    expect(unavailable.record.reason).toContain("fixture runtime unavailable");
    expect(await readFile(join(unavailable.directory, "record.json"), "utf8")).toContain("Control unavailable");
}, 120000);
