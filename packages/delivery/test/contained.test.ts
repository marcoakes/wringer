import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp, rm, unlink, lstat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { compileDeclaration, createExecutionAuthority, discoverEnvironment, hashValue, hashBytes } from "@wringer/plan";
import { createLocalSourceBundle, prepareRepositorySource, captureCandidate, processDriver, type RoleExecutionResult, type RoleExecutionRequest, type ContainedCommandRequest } from "@wringer/runtime";
import { runContainedJourney, buildRepairPacket, observeAssertionReport, type ContainedJourneyServices, type CandidateVerification } from "@wringer/workflow";
import { deliverContained, auditContained, readContainedDeliveryProjection, legacyContainedDocumentsV1, reviewContainedSource } from "../src/contained";
import { containedProjectionDigest, deriveContainedDeliveryProjection, renderContainedCertificate, renderContainedBoard, renderContainedBoardV2, renderContainedDocuments, renderContainedDocumentsV3 } from "../src/projection";
import { falsifyContained } from "../src/contained-falsify";
import { seal, files } from "../src/io";
const image = `fixture.invalid/agent@sha256:${"a".repeat(64)}`;
async function command(argv: string[], input?: string) {
    const isolated = argv[0] === "git" ? ["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", ...argv.slice(1)] : argv;
    const result = await processDriver.command(isolated, { input, timeoutMs: 20000, env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" } });
    if (result.code !== 0)
        throw new Error(result.stderr);
    return result.stdout;
}
async function fixture(human = false, mutable = false, dependencySetup = false, historicalBytes = 0, sourceExamples = false, optionalComment = false, engineering = false) {
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
    const plan = compileDeclaration({ version: engineering ? 3 : 1, ...(engineering ? { playbook: { path: "playbook.json", sha256: hashBytes(playbook), taskFamily: "fixture" } } : {}), name: "Portable exact candidate", intent: `Return after.${human ? " The display is readable." : ""}`, repository: { url: "https://example.invalid/fixture.git", commit }, runtime: { kind: "apple-container", image, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] }, agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } }, environment: { context: ["README.md"], tools: [], setup: dependencySetup ? [{ id: "dependencies", argv: ["true"], cwd: ".", timeout_seconds: 10 }] : [], writable_directories: dependencySetup ? ["node_modules"] : [], baseline: [] }, scope: { writable: ["product.txt", ...(mutable ? ["product.js"] : [])] }, acceptance: { criteria: [{ id: "after", title: "Return after", quote: "Return after.", kind: "check", required: true }, ...(human ? [{ id: "readable", title: "Readable", quote: "The display is readable.", kind: "human", required: true, show: { id: "show", argv: ["cat", "product.txt"], cwd: ".", timeout_seconds: 10 } }] : [])], checks: [{ id: "after", argv: ["sh", "check.sh"], cwd: ".", timeout_seconds: 10, criteria: ["after"], files: ["check.sh"], ...(engineering ? { evidence: { kind: "assertions", format: "wringer-check.v1" } } : {}) }], protected_paths: ["check.sh"] }, budget: { max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 3600, session_timeout_seconds: 30 } });
    await mkdir(stateDir);
    const sourceBundle = join(root, "source.bundle");
    await createLocalSourceBundle(repo, commit, sourceBundle);
    const prepared = await prepareRepositorySource({ ...plan.repository, bundlePath: sourceBundle }, { controllerDir: stateDir }), environment = await discoverEnvironment(prepared.objectStore, plan), authority = createExecutionAuthority(plan, { actor: "Fixture operator", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 3600000).toISOString() });
    const originalInputs = await command(["git", "--git-dir", prepared.objectStore, "--literal-pathspecs", "ls-tree", "-r", "-z", commit, "--", ...plan.acceptance.protected_paths]);
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
        expect(result.status).toBe("human-hold");
        const displayId = randomUUID(), body = { schema_version: "wringer.contained-display.v1", id: displayId, criterionId: "readable", candidateTree: result.candidate!.tree, acceptanceSha256: plan.acceptance_sha256, at: new Date().toISOString(), success: true, measured: { provenance: provenance("verifier", result.candidate!.source, randomUUID()), sourceChanged: false, sourceTree: result.candidate!.tree, checkInputsSha256: hashBytes(originalInputs), results: [...setupRows(), { id: "show", code: 0, stdout: "after\n", stderr: "", durationMs: 1 }] } };
        await mkdir(join(stateDir, "displays"));
        await writeFile(join(stateDir, "displays", `${displayId}.json`), JSON.stringify({ ...body, sha256: hashValue(body) }));
        result = await runContainedJourney({ ...options, humanJudgements: optionalComment ? [{ schema_version: "wringer.contained-human-decision.v1", criterionId: "readable", candidateTree: result.candidate!.tree, acceptanceSha256: plan.acceptance_sha256, verdict: "met", by: authority.actor, note: null, displayId, attribution: "initial-execution-approval", authoritySha256: hashValue(authority), display: { candidateTree: result.candidate!.tree, status: "shown", receiptSha256: hashValue(body) } }] : [{ criterionId: "readable", candidateTree: result.candidate!.tree, acceptanceSha256: plan.acceptance_sha256, verdict: "met", by: "Real fixture operator", note: "Yes — this is the display I reviewed.", display: { candidateTree: result.candidate!.tree, status: "shown", receiptSha256: hashValue(body) } }] });
    }
    expect(result.status).toBe("review-ready");
    return { root, repo, origin, stateDir, plan, result, publication: { remote: origin, sourceBranch: "wringer/contained-test", targetBranch: "main" } };
}
test("v4 handover carries strict red/green, pinned worker playbook and deterministic loop decisions into a fresh-clone audit", async () => {
    const f = await fixture(true, false, false, 0, false, true, true);
    try {
        const delivered = await deliverContained({ stateDir: f.stateDir, publication: f.publication, send: true });
        const clone = join(f.root, "engineering-fresh");
        await command(["git", "clone", "--branch", f.publication.sourceBranch, f.origin, clone]);
        const directory = join(clone, ".wringer/deliveries", delivered.deliveryId);
        const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
        const engineering = JSON.parse(await readFile(join(directory, "engineering.json"), "utf8"));
        const certificate = JSON.parse(await readFile(join(directory, "certificate.json"), "utf8"));
        expect(manifest.schema_version).toBe("wringer.contained-delivery.v4");
        expect(certificate.schema_version).toBe("wringer.contained-certificate.v2");
        expect(certificate.view.engineering).toEqual(manifest.engineering);
        expect(engineering.playbook.sha256).toBe(f.plan.playbook!.sha256);
        expect(engineering.uses).toHaveLength(1);
        expect(engineering.loopDecisions.length).toBeGreaterThan(0);
        expect(engineering.checks).toEqual([{ id: "after", level: "assertions" }]);
        expect(JSON.stringify(engineering)).not.toContain(f.stateDir);
        for (const path of ["board.html", "mr.md", "summary.md"]) expect(await readFile(join(directory, path), "utf8")).toContain("Repair the measured failure");
        const audit = await auditContained(directory);
        expect(audit.status).toBe("passed"); expect(audit.claims.every(c => c.status === "checked")).toBe(true);
        engineering.uses[0].requestSha256 = "0".repeat(64);
        await writeFile(join(directory, "engineering.json"), JSON.stringify(engineering)); await seal(directory);
        const corrupted = await auditContained(directory);
        expect(corrupted.status).toBe("failed");
    } finally { await rm(f.root, { recursive: true, force: true }); }
}, 90000);
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
    const view = await readContainedDeliveryProjection(directory), certificate = JSON.parse(await readFile(join(directory, "certificate.json"), "utf8"));
    expect(view.journeyId).toBe(f.result.journeyId);
    expect(view.source.codeCommit).toBe(delivered.codeCommit);
    expect(certificate.view).toEqual(view);
    expect(certificate.viewSha256).toBe(containedProjectionDigest(view));
    expect(view.criteria.find(c => c.id === "readable")?.note).toBe("Yes — this is the display I reviewed.");
    expect(view.checks[0]!.before.status).toBe("failed");
    expect(view.checks[0]!.after.status).toBe("passed");
    expect(view.usage.costUsd).toBeNull();
    expect(view.usage.inputTokens).toBeNull();
    expect(await readFile(join(directory, "board.html"), "utf8")).toBe(renderContainedBoard(view));
}, 60000);
test("compressed-small but over-64-MiB inflated history prepares, retries, sends and audits from a fresh clone", async () => {
    const f = await fixture(true, false, false, 40 * 1024 * 1024);
    try {
        expect((await lstat(f.result.candidate!.source.bundlePath!)).size).toBeLessThan(64 * 1024 * 1024);
        const before = (await command(["git", "--git-dir", f.origin, "show-ref"])).trim();
        const aborted = new AbortController(); aborted.abort();
        await expect(deliverContained({ stateDir: f.stateDir, publication: f.publication, signal: aborted.signal })).rejects.toThrow();
        expect((await command(["git", "--git-dir", f.origin, "show-ref"])).trim()).toBe(before);
        const midFlight = new AbortController(), interrupted = deliverContained({ stateDir: f.stateDir, publication: f.publication, signal: midFlight.signal });
        void interrupted.catch(() => {});
        let partial = "";
        for (let count = 0; count < 2000 && !partial; count++) {
            for (const name of await readdir(join(f.stateDir, "deliveries")).catch(() => [])) {
                const path = join(f.stateDir, "deliveries", name, "bundle", "candidate.bundle");
                if (await lstat(path).then(info => info.isFile() && info.size > 0, () => false)) { partial = path; break; }
            }
            if (!partial) await Bun.sleep(5);
        }
        midFlight.abort(); await expect(interrupted).rejects.toThrow(); expect(partial).not.toBe("");
        const retained = hashBytes(await readFile(partial));
        const prepared = await deliverContained({ stateDir: f.stateDir, publication: f.publication });
        expect(hashBytes(await readFile(partial))).toBe(retained);
        const repeated = await deliverContained({ stateDir: f.stateDir, publication: f.publication });
        expect(repeated.deliveryId).toBe(prepared.deliveryId); expect(repeated.evidenceCommit).toBe(prepared.evidenceCommit);
        const delivered = await deliverContained({ stateDir: f.stateDir, publication: f.publication, send: true });
        expect(delivered.evidenceCommit).toBe(prepared.evidenceCommit);
        const clone = join(f.root, "large-fresh"); await command(["git", "clone", "--branch", f.publication.sourceBranch, f.origin, clone]);
        const report = await auditContained(join(clone, ".wringer/deliveries", delivered.deliveryId));
        expect(report.status).toBe("passed"); expect(report.claims.every(claim => claim.status === "checked")).toBe(true);
        expect(report.human).toBe(1); expect(report.checks).toBe(1);
    } finally { await rm(f.root, { recursive: true, force: true }); }
}, 120000);
test("source examples require exact operator reviews, remain non-overridable for configured secrets, and carry an auditable exception record", async () => {
    const f = await fixture(true, false, false, 0, true, true);
    try {
        await expect(deliverContained({ stateDir: f.stateDir, publication: f.publication })).rejects.toThrow("source-review --state");
        const { dispatch } = await import("../../cli/src/app");
        const publicInventory = await dispatch(["source-review", "--state", f.stateDir, "--repo", f.root], "wringer-drive");
        expect(publicInventory.exit).toBe(3); expect(publicInventory.text).toContain("matching-byte SHA256"); expect(publicInventory.text).not.toContain("sk-" + "fixture-not-a-real-secret");
        const scan = await reviewContainedSource({ stateDir: f.stateDir }); expect(scan.pending).toHaveLength(2);
        for (const finding of scan.pending) await dispatch(["source-review", "--state", f.stateDir, "--repo", f.root, "--policy-dir", join(f.root, "operator-policy"), "--finding", finding.id, "--inventory", scan.inventory!.sha256, "--actor", "Codex / delegated PM fixture", "--actor-kind", "delegated-agent", "--reason", "This exact isolated fixture object contains an intentionally synthetic example, not an actual credential."], "wringer-drive");
        expect((await reviewContainedSource({ stateDir: f.stateDir })).pending).toHaveLength(0);
        const prior = process.env.WRINGER_SOURCE_REVIEW_TEST_SECRET;
        try { process.env.WRINGER_SOURCE_REVIEW_TEST_SECRET = "sk-" + "fixture-not-a-real-secret"; await expect(deliverContained({ stateDir: f.stateDir, publication: f.publication })).rejects.toThrow("detected credential"); }
        finally { if (prior === undefined) delete process.env.WRINGER_SOURCE_REVIEW_TEST_SECRET; else process.env.WRINGER_SOURCE_REVIEW_TEST_SECRET = prior; }
        const prepared = await deliverContained({ stateDir: f.stateDir, publication: f.publication });
        const delivered = await deliverContained({ stateDir: f.stateDir, publication: f.publication, send: true });
        expect(delivered.evidenceCommit).toBe(prepared.evidenceCommit);
        const fresh = join(f.root, "fresh-review"); await command(["git", "clone", "--branch", f.publication.sourceBranch, f.origin, fresh]);
        const bundle = join(fresh, ".wringer/deliveries", delivered.deliveryId), audited = await auditContained(bundle);
        expect(audited.status).toBe("passed"); expect(audited.claims.some(c => c.id === "source-credential-shape-review" && c.status === "checked")).toBe(true);
        expect(audited.limits.join(" ")).toContain("cannot repeat that check");
        const manifest = JSON.parse(await readFile(join(bundle, "manifest.json"), "utf8")); expect(manifest.schema_version).toBe("wringer.contained-delivery.v3"); expect(manifest.sourceReview.findings).toBe(2);
        const view = JSON.parse(await readFile(join(bundle, "view.json"), "utf8")); expect(view.criteria.find((c: any) => c.kind === "human").note).toBeNull();
        expect(await readFile(join(bundle, "summary.md"), "utf8")).toContain("Decision recorded; no comment supplied");
        expect(await readFile(join(bundle, "board.html"), "utf8")).toContain("Decision recorded; no comment supplied");
        const receiptPath = join(bundle, "source-inspection.json"), receipt = JSON.parse(await readFile(receiptPath, "utf8"));
        expect(receipt.approvals.every((a: any) => a.actorKind === "delegated-agent")).toBe(true);
        expect(await readFile(join(bundle, "mr.md"), "utf8")).toContain("not a secret-free claim");
        // A coherently re-rendered/resealed v3 bundle cannot hide its exception
        // requirement by removing the sender's declaration and carried receipt.
        const omitted = join(f.root, "omitted-source-disclosure"); await cp(bundle, omitted, { recursive: true });
        const omittedManifest = structuredClone(manifest), omittedView = structuredClone(view);
        omittedManifest.sourceReview = null;
        omittedManifest.limits = omittedManifest.limits.filter((line: string) => !line.startsWith("Source credential-shape exceptions:"));
        omittedView.limits = omittedView.limits.filter((line: string) => !line.startsWith("Source credential-shape exceptions:"));
        omittedManifest.viewSha256 = containedProjectionDigest(omittedView);
        const omittedProjection = JSON.parse(await readFile(join(omitted, "projection.json"), "utf8")); omittedProjection.viewSha256 = omittedManifest.viewSha256;
        for (const [name, value] of Object.entries({ "manifest.json": omittedManifest, "view.json": omittedView, "certificate.json": renderContainedCertificate(omittedView), "projection.json": omittedProjection })) await writeFile(join(omitted, name), JSON.stringify(value));
        for (const [name, value] of Object.entries({ ...renderContainedDocumentsV3(omittedView, omittedManifest.falsify.reason), "board.html": renderContainedBoardV2(omittedView) })) await writeFile(join(omitted, name), value);
        await unlink(join(omitted, "source-inspection.json")); await seal(omitted);
        const omissionAudit = await auditContained(omitted); expect(omissionAudit.status).toBe("failed");
        expect(omissionAudit.claims.some(claim => claim.reason.includes("no committed exception receipt"))).toBe(true);
        receipt.approvals[0].reason = "Changed source decision without a valid operator record"; await writeFile(receiptPath, JSON.stringify(receipt)); await seal(bundle);
        expect((await auditContained(bundle)).status).toBe("failed");
    } finally { await rm(f.root, { recursive: true, force: true }); }
}, 120000);
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
    await expect(deliverContained({ stateDir: f.stateDir, publication: f.publication, expectedRevision: "0".repeat(64) })).rejects.toThrow("stale");
    await expect(deliverContained({ stateDir: f.stateDir, publication: f.publication, expectedCandidateTree: "0".repeat(40) })).rejects.toThrow("stale");
    await expect(deliverContained({ stateDir: f.stateDir, publication: { ...f.publication, forge: { kind: "github", endpoint: "https://api.github.com", repo: "owner/repo", token_env: "FIXTURE_TOKEN" } }, send: true })).rejects.toThrow("explicit HTTPS/SSH");
    await expect(deliverContained({ stateDir: f.stateDir, publication: { ...f.publication, sourceBranch: "main" }, send: true })).rejects.toThrow("nondefault");
    await command(["git", "--git-dir", f.origin, "update-ref", `refs/heads/${f.publication.sourceBranch}`, f.plan.repository.commit]);
    await expect(deliverContained({ stateDir: f.stateDir, publication: f.publication, send: true })).rejects.toThrow("already exists");
    expect((await command(["git", "--git-dir", f.origin, "rev-parse", f.publication.sourceBranch])).trim()).toBe(f.plan.repository.commit);
    await command(["git", "--git-dir", f.origin, "symbolic-ref", "HEAD", "refs/heads/not-created"]);
    await expect(deliverContained({ stateDir: f.stateDir, publication: f.publication, send: true })).rejects.toThrow("default branch could not be established");
}, 45000);
test("portable worker write scope is carried and cannot be broadened or omitted", async () => {
    const f = await fixture(), delivery = await deliverContained({ stateDir: f.stateDir, publication: f.publication });
    const manifest = await Bun.file(join(delivery.bundleDir, "manifest.json")).json();
    const roles = await Promise.all(manifest.roles.map((id: string) => Bun.file(join(delivery.bundleDir, "roles", `${id}.json`)).json()));
    const worker = roles.find((r: any) => r.role === "worker"), path = join(delivery.bundleDir, "roles", `${worker.id}.json`);
    expect(worker.request.scope).toEqual({ writable: f.plan.scope.writable, protected: f.plan.acceptance.protected_paths, writableDirectories: f.plan.environment.writable_directories });
    for (const scope of [{ ...worker.request.scope, writable: ["."] }, undefined]) {
        const changed = structuredClone(worker);
        if (scope) changed.request.scope = scope;
        else delete changed.request.scope;
        await writeFile(path, JSON.stringify(changed)); await seal(delivery.bundleDir);
        const audit = await auditContained(delivery.bundleDir);
        expect(audit.status).toBe("failed");
        expect(audit.claims.at(-1)!.reason).toContain("worker write scope");
    }
}, 30000);
async function rewriteProjection(directory: string, change: (event: any) => void, legacy = false) {
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")), plan = JSON.parse(await readFile(join(directory, "plan.json"), "utf8")), projection = JSON.parse(await readFile(join(directory, "projection.json"), "utf8"));
    let previous = "0".repeat(64);
    for (const name of (await readdir(join(directory, "journal"))).sort()) {
        const event = JSON.parse(await readFile(join(directory, "journal", name), "utf8"));
        change(event); event.previous = previous; const { sha256: _sha, ...body } = event; event.sha256 = hashValue(body); previous = event.sha256;
        await writeFile(join(directory, "journal", name), JSON.stringify(event));
    }
    manifest.journal.headSha256 = previous; projection.portableJournalHeadSha256 = previous;
    const human = await Promise.all(manifest.humanCriteria.map((id: string) => Bun.file(join(directory, "human", `${id}.json`)).json())), roles = await Promise.all(manifest.roles.map((id: string) => Bun.file(join(directory, "roles", `${id}.json`)).json()));
    if (legacy) {
        manifest.schema_version = "wringer.contained-delivery.v1"; delete manifest.contracts; delete manifest.viewSha256;
        projection.schema_version = "wringer.contained-projection.v1"; delete projection.viewSha256;
        for (const role of roles) { delete role.disposition; await writeFile(join(directory, "roles", `${role.id}.json`), JSON.stringify(role)); }
        for (const file of ["view.json", "certificate.json", "board.html"]) await rm(join(directory, file));
        for (const [file, body] of Object.entries(legacyContainedDocumentsV1(plan, manifest, human))) await writeFile(join(directory, file), body);
    } else {
        const view = deriveContainedDeliveryProjection(plan, manifest, human, roles); manifest.viewSha256 = containedProjectionDigest(view); projection.viewSha256 = manifest.viewSha256;
        await writeFile(join(directory, "view.json"), JSON.stringify(view)); await writeFile(join(directory, "certificate.json"), JSON.stringify(renderContainedCertificate(view))); await writeFile(join(directory, "board.html"), renderContainedBoard(view));
        for (const [file, body] of Object.entries(renderContainedDocuments(view, manifest.falsify.reason))) await writeFile(join(directory, file), body);
    }
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest)); await writeFile(join(directory, "projection.json"), JSON.stringify(projection)); await seal(directory);
}
test("portable timestamps, verifier reservations and derived certificate tampering fail closed; v1 still audits", async () => {
    const f = await fixture(), prepared = await deliverContained({ stateDir: f.stateDir, publication: f.publication });
    const altered = async (name: string) => { const directory = join(f.root, name); await cp(prepared.bundleDir, directory, { recursive: true }); return directory; };
    for (const at of ["not-a-date", "1900-01-01T00:00:00.000Z"]) {
        const dir = await altered(at === "not-a-date" ? "bad-time" : "backwards-time");
        await rewriteProjection(dir, event => { if (event.sequence === 2) event.at = at; });
        const audit = await auditContained(dir); expect(audit.status).toBe("failed"); expect(audit.claims.at(-1)!.reason).toMatch(/timestamp|date-time/);
    }
    const dropped = await altered("dropped-verifier");
    await rewriteProjection(dropped, event => { if (event.type === "review-ready") event.state.verificationAttempts = []; });
    const lost = await auditContained(dropped); expect(lost.status).toBe("failed"); expect(lost.claims.at(-1)!.reason).toContain("verifier reservation");
    const cert = await altered("lying-certificate"), value = await Bun.file(join(cert, "certificate.json")).json(); value.view.counts.proved = 123;
    await writeFile(join(cert, "certificate.json"), JSON.stringify(value)); await seal(cert);
    expect((await auditContained(cert)).status).toBe("failed");
    const legacy = await altered("legacy-v1");
    await rewriteProjection(legacy, event => { event.schema_version = "wringer.contained-delivery-event.v1"; delete event.state.verificationAttempts; for (const effect of event.state.effects) delete effect.disposition; }, true);
    expect((await auditContained(legacy)).status).toBe("passed");
    expect((await readContainedDeliveryProjection(legacy)).source.codeCommit).toBe(prepared.codeCommit);
}, 120000);
test("contained falsification challenges committed changes with distinct pinned runtimes, including caught and surviving mutants", async () => {
    const f = await fixture(false, true), delivered = await deliverContained({ stateDir: f.stateDir, publication: f.publication }), requests: any[] = [];
    const observe = async (request: ContainedCommandRequest) => {
            requests.push(request);
            // Real independent Git-object inspection; command exits/provenance remain synthetic.
            const objectStore = join(await mkdtemp(join(f.root, "mutant-observation-")), "objects.git"), source = request.repo;
            await command(["git", "init", "--bare", objectStore]);
            await command(["git", "--git-dir", objectStore, "fetch", source.bundlePath!, `${source.commit}:refs/heads/measured`]);
            const tree = (await command(["git", "--git-dir", objectStore, "rev-parse", `${source.commit}^{tree}`])).trim();
            const product = await command(["git", "--git-dir", objectStore, "show", `${source.commit}:product.js`]);
            if (source.commit !== delivered.codeCommit) {
                expect((await command(["git", "--git-dir", objectStore, "rev-parse", `${source.commit}^`])).trim()).toBe(delivered.codeCommit);
                expect((await command(["git", "--git-dir", objectStore, "diff", "--name-only", delivered.codeCommit, source.commit, "--"])).trim()).toBe("product.js");
                expect(await command(["git", "--git-dir", objectStore, "show", `${source.commit}:check.sh`])).toBe(await command(["git", "--git-dir", objectStore, "show", `${delivered.codeCommit}:check.sh`]));
            }
            const caught = product.includes("expected = false");
            return { provenance: { schema_version: "wringer.runtime.v1" as const, runtimeId: randomUUID(), role: "verifier" as const, kind: request.runtime.kind, image, repository: { url: source.url, commit: source.commit }, clonedInside: true as const, hostMounts: [] as [], repositoryAccess: "read-only" as const, declared: request.runtime, observed: { fixture: true, writableDirectories: request.writableDirectories ?? [] }, limits: ["Synthetic command observations, not live isolation; actual controller-materialized Git source inspected"] }, sourceTree: tree, sourceChanged: false, checkInputsSha256: JSON.parse(await readFile(join(f.result.verification!.evidenceRef, "observations.json"), "utf8")).checkInputsSha256, results: request.commands.map(c => ({ id: c.id, code: c.id === "acceptance/after" && caught ? 1 : 0, stdout: "Synthetic fixture observation", stderr: "", durationMs: 1 })) };
        };
    const measured = await falsifyContained({ bundleDir: delivered.bundleDir, outputDir: join(f.root, "falsifications") }, { executeCommands: observe });
    expect(measured.record.schema_version).toBe("wringer.contained-falsification.v2");
    expect(measured.record.status).toBe("measured");
    expect(measured.record.counts).toEqual({ supported: 2, attempted: 2, caught: 1, survived: 1, unavailable: 0, unattempted: 0 });
    expect(requests).toHaveLength(3);
    expect(requests[0].repo.commit).toBe(delivered.codeCommit);
    expect(requests.slice(1).every(r => r.repo.commit !== delivered.codeCommit && r.acceptanceSource.commit === f.plan.repository.commit && r.protectedFiles.includes("check.sh"))).toBe(true);
    expect(new Set(requests.map(r => r.repo.commit)).size).toBe(3);
    expect(requests.every(r => r.commands.every((c: any) => !c.id.startsWith("mutation/")))).toBe(true);
    for (const [index, row] of measured.record.attempts.entries()) {
        expect(row.source?.commit).toBe(requests[index + 1].repo.commit);
        expect(row.source?.tree).not.toBe(f.result.candidate!.tree);
        expect(row.source?.bundleSha256).toBe(hashBytes(await readFile(join(measured.directory, row.source!.bundle))));
        const receipt = await Bun.file(join(measured.directory, row.receipt!)).json();
        expect(receipt.measured.sourceChanged).toBe(false);
        expect(receipt.measured.provenance.repositoryAccess).toBe("read-only");
        expect(receipt.measured.sourceTree).toBe(row.source!.tree);
    }
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
    for (const failure of ["wrong-tree", "source-write"]) {
        const wrong = await falsifyContained({ bundleDir: delivered.bundleDir, outputDir: join(f.root, "falsifications"), maxAttempts: 1 }, { executeCommands: async request => {
            const result = await observe(request);
            return request.repo.commit === delivered.codeCommit ? result : failure === "wrong-tree" ? { ...result, sourceTree: f.result.candidate!.tree } : { ...result, sourceChanged: true };
        } });
        expect(wrong.record.counts.caught).toBe(0);
        expect(wrong.record.counts.unavailable).toBe(1);
        expect(wrong.record.attempts[0]!.reason).toContain(failure === "wrong-tree" ? "identity" : "changed its committed source");
    }
}, 120000);
