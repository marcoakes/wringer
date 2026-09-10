import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, mkdir, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { compileDeclaration, discoverEnvironment, createExecutionAuthority, hashValue, hashBytes, type ExecutionPlan } from "@wringer/plan";
import { createDesignSnapshot, inspectPng } from "@wringer/design";
import { createLocalSourceBundle, prepareRepositorySource, processDriver, type ContainedCommandRequest, type ContainedCommandResult, type PreparedRepositorySource, type RoleExecutionRequest, type RoleExecutionResult } from "@wringer/runtime";
import { auditContained, deliverContained } from "@wringer/delivery";
import { seal } from "../../delivery/src/io";
import { readPinnedDesignSnapshot, assertContainedDisplayVisuals } from "@wringer/workflow";
import { startController, resumeController, showControllerCandidate, reviewControllerDecisions, immutableControllerFile, readController } from "../src/controller";

// Actual Chromium screenshots of an explicitly scripted test card; synthetic
// contained-role/command observations. This is not a live sandbox or PM blind pass.
test("visual review carries real PNGs, refuses substitutions, and audits from committed source", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-visual-evidence-"))), repo = join(root, "source"), origin = join(root, "origin.git"), state = join(root, "state");
    const git = async (args: string[]) => { const r = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", ...args], { env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 20000 }); if (r.code) throw new Error(r.stderr); return r.stdout; };
    try {
        const browser = await chromium.launch({ headless: true, env: Object.fromEntries(["PATH", "HOME", "TMPDIR", "SystemRoot"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])) });
        let reference: string, capture: string;
        try {
            const context = await browser.newContext({ viewport: { width: 320, height: 200 } }); await context.route("**/*", route => route.abort());
            const page = await context.newPage();
            await page.setContent('<main style="font-family:sans-serif;padding:20px;background:#e7edf6"><h1>Review card</h1><p>Scripted reference</p><button>Continue</button></main>');
            reference = (await page.screenshot({ type: "png" })).toString("base64");
            await page.locator("p").evaluate(element => { element.textContent = "Scripted candidate"; });
            capture = (await page.screenshot({ type: "png" })).toString("base64");
        } finally { await browser.close(); }
        const snapshot = createDesignSnapshot({ title: "Engineering review reference", disclosure: "repository-permitted", context: "Show the review card and Continue button.", assets: [{ id: "reference", title: "Scripted browser reference", pngBase64: reference }] });
        await git(["init", "--initial-branch=main", repo]); await git(["init", "--bare", "--initial-branch=main", origin]);
        await git(["-C", repo, "config", "user.name", "Visual engineering fixture"]); await git(["-C", repo, "config", "user.email", "fixture@example.invalid"]);
        await mkdir(join(repo, "src")); await writeFile(join(repo, "src/value.js"), "export const expected = false;\n"); await writeFile(join(repo, "check.sh"), "test true = false\n"); await writeFile(join(repo, "design.json"), JSON.stringify(snapshot));
        await git(["-C", repo, "add", "."]); await git(["-C", repo, "commit", "-m", "Explicit visual fixture baseline"]); await git(["-C", repo, "push", origin, "main"]);
        const commit = (await git(["-C", repo, "rev-parse", "HEAD"])).trim();
        const plan: ExecutionPlan = compileDeclaration({ version: 2, name: "Visual evidence fixture", intent: "Return the expected value. Show the review card.", repository: { url: "https://fixture.invalid/visual.git", commit }, runtime: { kind: "apple-container", image: `fixture.invalid/agent@sha256:${"a".repeat(64)}`, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] }, agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } }, environment: { context: [], tools: [], setup: [], baseline: [], writable_directories: ["outputs"] }, scope: { writable: ["src"] }, acceptance: { criteria: [{ id: "expected", title: "Expected value", quote: "Return the expected value.", kind: "check", required: true }, { id: "card", title: "Review card", quote: "Show the review card.", kind: "human", required: true, show: { id: "show", argv: ["fixture-browser"], cwd: ".", timeout_seconds: 10 } }], checks: [{ id: "expected", argv: ["sh", "check.sh"], cwd: ".", timeout_seconds: 5, criteria: ["expected"], files: ["check.sh"] }], protected_paths: ["check.sh", "design.json"] }, design: { snapshotPath: "design.json", snapshotSha256: snapshot.snapshot_sha256, reviews: [{ criterionId: "card", referenceIds: ["reference"], captures: [{ id: "desktop", path: "outputs/desktop.png", mimeType: "image/png", width: 320, height: 200 }] }] }, budget: { max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 3600, session_timeout_seconds: 20 } });
        const authority = createExecutionAuthority(plan, { actor: "SCRIPTED engineering choice", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 3600000).toISOString() });
        await mkdir(state); const sourceBundle = join(root, "source.bundle"); await createLocalSourceBundle(repo, commit, sourceBundle);
        const prepared = await prepareRepositorySource({ ...plan.repository, bundlePath: sourceBundle }, { controllerDir: state });
        await immutableControllerFile(join(state, "prepared-source.json"), prepared); await immutableControllerFile(join(state, "environment.json"), await discoverEnvironment(prepared.objectStore, plan));
        expect(await readPinnedDesignSnapshot(plan, prepared.objectStore)).toEqual(snapshot);
        await expect(readPinnedDesignSnapshot({ ...plan, design: { ...plan.design!, snapshotSha256: "f".repeat(64) } }, prepared.objectStore)).rejects.toThrow("digest");
        await writeFile(join(repo, "src/value.js"), "export const expected = true;\n"); const patch = await git(["-C", repo, "diff", "--binary", "--full-index"]);
        const protectedInputs = await git(["--git-dir", prepared.objectStore, "--literal-pathspecs", "ls-tree", "-r", "-z", commit, "--", ...plan.acceptance.protected_paths]);
        const provenance = (role: "worker" | "judge" | "verifier", source: any) => ({ schema_version: "wringer.runtime.v1" as const, runtimeId: crypto.randomUUID(), role, kind: plan.runtime.kind, image: plan.runtime.image, repository: { url: source.url, commit: source.commit }, clonedInside: true as const, hostMounts: [] as [], repositoryAccess: role === "worker" ? "read-write" as const : "read-only" as const, declared: plan.runtime, observed: { fixture: true, writableDirectories: plan.environment.writable_directories }, limits: ["Synthetic containment observations with actual scripted browser PNGs; not a live isolation or human test."] });
        let artifactMode: "valid" | "missing" | "wrong-size" = "valid";
        const runCommands = async (request: ContainedCommandRequest): Promise<ContainedCommandResult> => {
            const source = request.repo as PreparedRepositorySource, tree = (await git(["--git-dir", source.objectStore, "rev-parse", `${source.commit}^{tree}`])).trim(), contents = await git(["--git-dir", source.objectStore, "show", `${source.commit}:src/value.js`]);
            const artifacts = request.captureArtifacts?.map(row => ({ id: row.id, path: row.path, mimeType: "image/png" as const, base64: capture, ...inspectPng(capture), ...(artifactMode === "wrong-size" ? { width: 1 } : {}) }));
            return { provenance: provenance("verifier", source), sourceChanged: false, sourceTree: tree, checkInputsSha256: hashBytes(protectedInputs), results: request.commands.map(row => ({ id: row.id, code: row.id.startsWith("acceptance/") && !contents.includes("expected = true") ? 1 : 0, stdout: "Synthetic contained-command observation", stderr: "", durationMs: 1 })), ...(artifacts ? { artifacts: artifactMode === "missing" ? [] : artifacts } : {}) };
        };
        let roles = 0;
        const executeRole = async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => { roles++; expect(request.design).toEqual({ snapshotPath: plan.design!.snapshotPath, snapshotSha256: snapshot.snapshot_sha256, referenceIds: ["reference"] }); return { status: "completed", text: request.role === "worker" ? "Synthetic worker" : JSON.stringify({ criteria: [{ id: "expected", met: true, reason: "Synthetic independent fixture result" }], note: "Not a real model judge" }), sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: provenance(request.role as "worker" | "judge", request.repo), ...(request.role === "worker" ? { change: { baseCommit: request.repo.commit, patch, sha256: hashBytes(patch) } } : {}) }; };
        expect((await startController(state, plan, authority, { runCommands, executeRole })).status).toBe("human-hold");
        artifactMode = "missing"; await expect(showControllerCandidate(state, "card", { runCommands })).rejects.toThrow("omitted");
        artifactMode = "wrong-size"; await expect(showControllerCandidate(state, "card", { runCommands })).rejects.toThrow(); artifactMode = "valid";
        const { receipt } = await showControllerCandidate(state, "card", { runCommands }); expect(receipt.schema_version).toBe("wringer.contained-display.v2"); expect(receipt.visuals!.referenceAssets[0]!.base64).toBe(reference); expect(receipt.visuals!.captures[0]!.base64).toBe(capture);
        const forged = structuredClone(receipt); forged.visuals!.referenceAssets[0] = { ...forged.visuals!.referenceAssets[0]!, base64: capture, ...inspectPng(capture) }; const { sha256: _, ...forgedBody } = forged; forged.sha256 = hashValue(forgedBody);
        expect(() => assertContainedDisplayVisuals(forged, plan, snapshot)).toThrow("pinned source");
        await writeFile(join(state, "displays", `${receipt.id}.json`), JSON.stringify(forged));
        await expect(reviewControllerDecisions(state, { decisions: [{ criterionId: "card", displayId: receipt.id, verdict: "met" }] })).rejects.toThrow("pinned source");
        expect((await readController(state)).state.humanJudgements).toEqual([]);
        await writeFile(join(state, "displays", `${receipt.id}.json`), JSON.stringify(receipt));
        const recorded = await reviewControllerDecisions(state, { decisions: [{ criterionId: "card", displayId: receipt.id, verdict: "met" }] }); expect(recorded.judgements[0]!.note).toBeNull();
        expect((await resumeController(state, { runCommands, executeRole })).status).toBe("review-ready"); expect(roles).toBe(2);
        const delivered = await deliverContained({ stateDir: state, publication: { remote: origin, sourceBranch: "review/visual", targetBranch: "main" } });
        const audit = await auditContained(delivered.bundleDir); expect(audit.status).toBe("passed"); expect(audit.claims.some(row => row.id === "source-bound-visual-review" && row.status === "checked")).toBe(true);
        const imagePath = join(delivered.bundleDir, "visuals/card/capture-desktop.png"); expect((await readFile(imagePath)).toString("base64")).toBe(capture);
        await writeFile(imagePath, Buffer.from(reference, "base64")); await seal(delivered.bundleDir);
        const changed = await auditContained(delivered.bundleDir); expect(changed.status).toBe("failed"); expect(JSON.stringify(changed)).toContain("Carried visual image differs");
    } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
