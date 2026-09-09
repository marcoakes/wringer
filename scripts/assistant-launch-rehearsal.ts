/** No-spend engineering rehearsal, NOT a PM blind test. The MCP/application,
 * journals, source commits, local publication and fresh-clone audit are real.
 * Role/check/display observations and every operator decision are SCRIPTED.
 * Never import this fixture into a production entrypoint or offer a fixture flag. */
import { chmod, copyFile, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compileDeclaration, discoverEnvironment, hashBytes, hashValue, type ExecutionPlan } from "../packages/plan/src";
import { prepareRepositorySource, type ContainedCommandRequest, type ContainedCommandResult, type PreparedRepositorySource, type RoleExecutionRequest, type RoleExecutionResult } from "../packages/runtime/src";
import { initializeAssistant, issueAssistantCapability, createAssistantService, assistantControllerState } from "../packages/application/src/assistant";
import { immutableControllerFile, startController } from "../packages/application/src/controller";
import { readWorkspaceCommand, type WorkspaceCommand } from "../packages/application/src/commands";
import { readPmWorkspace } from "../packages/cli/src/workspace";
import { createAssistantConsole } from "../packages/cli/src/assistant-console";
import { launchPmBrowser } from "./pm-browser";
import { runGuidedPmJourney } from "./guided-pm-rehearsal";
import { createMcpSession } from "../packages/mcp/src/server";
import { readValidatedContainedState } from "../packages/workflow/src";
import { readContainedDeliveryProjection } from "../packages/delivery/src";
import { runProcess } from "../packages/engine/src/process";

const actor = "SCRIPTED TEST FIXTURE (not an independent person)";
const negativeNote = "SCRIPTED negative review: the value is correct, but the label is still hard to understand.";
const correction = "SCRIPTED correction: keep the correct value and replace the cryptic label with Expected value is ready.";
const positiveNote = "SCRIPTED positive review: Expected value is ready is clear in this synthetic display; this is not a real person's verdict.";
const baseLimits = [
    "Engineering rehearsal, not a PM blind-test result or observed genuine human approval.",
    "Role replies, check outcomes, runtime provenance and display observations are synthetic; real client, model convergence and containment are unmeasured.",
    "Uses cooperative-local fixture state, not a demonstrated protected controller boundary.",
    "No provider API calls or credential reads; usage fields remain unknown where the production records have no billing evidence.",
    "Publication changes only a newly created local bare test origin, not a hosted forge, merge or deployment.",
    "Recovery models a lost completed response and an explicit owner recreation, not an OS kill, reboot or sleep measurement.",
];
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const htmlText = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export async function runAssistantLaunchRehearsal(repository = resolve(import.meta.dir, ".."), guided = false) {
    const limits = guided ? [...baseLimits.slice(0, -1), "Authenticated page reload and locking are exercised; OS kill, reboot and sleep recovery are not measured in this guided fixture."] : baseLimits;
    const began = Date.now(), startedAt = new Date(began).toISOString();
    const directory = join(repository, ".wringer", `assistant-launch-rehearsal-${crypto.randomUUID()}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const root = await realpath(directory), controller = join(root, "assistant"), source = join(root, "source"), origin = join(root, "origin.git"), bin = join(root, "bin"), fixtureHome = join(root, "isolated-home");
    await mkdir(bin); await mkdir(fixtureHome);
    await copyFile(join(repository, "dist/wring"), join(bin, "wring")); await chmod(join(bin, "wring"), 0o755);
    await symlink("wring", join(bin, "wringer-drive"));
    const environment = { PATH: `${bin}:/usr/bin:/bin`, HOME: fixtureHome, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LANG: "C.UTF-8" };
    const transcript: unknown[] = [], checks: string[] = [], roles: { role: string; runtimeId: string }[] = [];
    let service: Awaited<ReturnType<typeof createAssistantService>> | undefined, failed = true;
    let consoleServer: Awaited<ReturnType<typeof createAssistantConsole>> | undefined;
    let browser: Awaited<ReturnType<typeof launchPmBrowser>> | undefined;
    const sanitize = (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll(root, "FIXTURE").replaceAll(repository, "WRINGER_CHECKOUT").replace(/#token=[a-f0-9]+/g, "#token=REDACTED"));
    const record = async (entry: unknown) => { transcript.push(sanitize(entry)); await writeFile(join(root, "transcript.json"), JSON.stringify({ fixture: true, startedAt, limits, transcript }, null, 2) + "\n"); };
    const check = async (name: string, value: unknown) => { assert(value, name); checks.push(name); await record({ check: name, status: "passed" }); };
    async function command(label: string, argv: string[], cwd = root, expected = 0) {
        const result = await runProcess(argv, { cwd, env: environment, timeout: 40, maxBytes: 4 * 1024 * 1024 });
        await record({ label, command: argv, cwd, ...result });
        assert(!result.timed_out && result.exit_code === expected, `${label}: expected exit ${expected}, got ${result.exit_code}: ${result.stderr}`);
        return result;
    }
    const git = async (args: string[]) => (await command("fixture-local-git", ["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args])).stdout;
    try {
        const checkpoint = (await git(["-C", repository, "rev-parse", "HEAD"])).trim();
        const workingTree = (await git(["-C", repository, "status", "--porcelain"])).trim();
        const implementation = { baseCommit: checkpoint, workingTree: workingTree ? "modified" : "clean", rehearsalSha256: hashBytes(await readFile(import.meta.path)), browserFixtureSha256: hashBytes(await readFile(join(import.meta.dir, "pm-browser.ts"))), ...(guided ? { guidedFixtureSha256: hashBytes(await readFile(join(import.meta.dir, "guided-pm-rehearsal.ts"))) } : {}), auditBinarySha256: hashBytes(await readFile(join(bin, "wring"))) };
        await record({ implementation, note: "A modified worktree is not described as a frozen release candidate; the exact script and compiled audit bytes are identified separately." });
        await git(["init", "--initial-branch=main", source]); await git(["init", "--bare", "--initial-branch=main", origin]);
        await git(["-C", source, "config", "user.name", "Scripted launch rehearsal"]); await git(["-C", source, "config", "user.email", "fixture@example.invalid"]);
        await mkdir(join(source, "src"));
        await writeFile(join(source, "README.md"), limits.join("\n") + "\n");
        await writeFile(join(source, "src/value.js"), "export const expected = false;\n");
        await writeFile(join(source, "check.sh"), "test \"$(sed -n '1p' src/value.js)\" = 'export const expected = true;'\n");
        await git(["-C", source, "add", "."]); await git(["-C", source, "commit", "-m", "Scripted launch rehearsal baseline"]); await git(["-C", source, "push", origin, "main"]);
        const baseCommit = (await git(["-C", source, "rev-parse", "HEAD"])).trim();
        const plan = compileDeclaration({ version: 1, name: "Assistant launch engineering rehearsal", intent: "Return the expected value. The display is readable.", repository: { url: "https://fixture.invalid/assistant-launch.git", commit: baseCommit }, runtime: { kind: "apple-container", image: `fixture.invalid/agent@sha256:${"a".repeat(64)}`, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] }, agents: { worker: { protocol: "acp", command: "fixture-acp" }, judge: { protocol: "acp", command: "fixture-acp" } }, environment: { context: ["README.md"], tools: [], setup: [{ id: "dependencies", argv: ["true"], cwd: ".", timeout_seconds: 5 }], baseline: [], writable_directories: [] }, scope: { writable: ["src"] }, acceptance: { criteria: [{ id: "expected", title: "Expected value", quote: "Return the expected value.", kind: "check", required: true }, { id: "readable", title: "Readable display", quote: "The display is readable.", kind: "human", required: true, show: { id: "show", argv: ["cat", "src/value.js"], cwd: ".", timeout_seconds: 5 } }], checks: [{ id: "expected", argv: ["sh", "check.sh"], cwd: ".", timeout_seconds: 5, criteria: ["expected"], files: ["check.sh"] }], protected_paths: ["check.sh"] }, budget: { max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 600, session_timeout_seconds: 20 } });
        const destination = { remote: origin, sourceBranch: "wringer/assistant-launch-fixture", targetBranch: "main" };
        const initialized = await initializeAssistant(controller, { plan, destination, cooperativeLocal: true });
        const capability = await issueAssistantCapability(controller, new Date(Date.now() + 600000).toISOString());
        let workerTurns = 0, loseStartReply = !guided, failNextDisplay = false;
        const provenance = (role: "worker" | "judge" | "verifier", requestSource: ExecutionPlan["repository"], runtime = plan.runtime) => ({ schema_version: "wringer.runtime.v1" as const, runtimeId: crypto.randomUUID(), role, kind: runtime.kind, image: runtime.image, repository: { url: requestSource.url, commit: requestSource.commit }, clonedInside: true as const, hostMounts: [] as [], repositoryAccess: role === "worker" ? "read-write" as const : "read-only" as const, declared: runtime, observed: { fixture: true, writableDirectories: plan.environment.writable_directories }, limits: [limits[1]!] });
        const runCommands = async (request: ContainedCommandRequest): Promise<ContainedCommandResult> => {
            const pinned = request.repo as PreparedRepositorySource;
            const tree = (await git(["--git-dir", pinned.objectStore, "rev-parse", `${pinned.commit}^{tree}`])).trim();
            const contents = await git(["--git-dir", pinned.objectStore, "show", `${pinned.commit}:src/value.js`]);
            const originalInputs = await git(["--git-dir", pinned.objectStore, "--literal-pathspecs", "ls-tree", "-r", "-z", plan.repository.commit, "--", "check.sh"]);
            const failShow = failNextDisplay && request.commands.some(c => c.id === "show");
            if (failShow) failNextDisplay = false;
            return { provenance: provenance("verifier", pinned, request.runtime), sourceChanged: false, sourceTree: tree, checkInputsSha256: hashBytes(originalInputs), results: request.commands.map(c => ({ id: c.id, code: c.id === "show" && failShow || c.id.startsWith("acceptance/") && !contents.includes("expected = true;") ? 1 : 0, stdout: c.id === "show" ? failShow ? "SCRIPTED failed display: no current result shown" : contents : "SYNTHETIC check observation of the pinned source blob\n", stderr: "", durationMs: 1 })) };
        };
        const executeRole = async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => {
            const p = provenance(request.role as "worker" | "judge", request.repo); roles.push({ role: request.role, runtimeId: p.runtimeId });
            let patch: string | undefined;
            if (request.role === "worker") {
                workerTurns++;
                patch = workerTurns === 1 ? "diff --git a/src/value.js b/src/value.js\n--- a/src/value.js\n+++ b/src/value.js\n@@ -1 +1,2 @@\n-export const expected = false;\n+export const expected = true;\n+export const label = 'X';\n" : "diff --git a/src/value.js b/src/value.js\n--- a/src/value.js\n+++ b/src/value.js\n@@ -1,2 +1,2 @@\n export const expected = true;\n-export const label = 'X';\n+export const label = 'Expected value is ready';\n";
            }
            return { status: "completed", text: request.role === "worker" ? "PRIVATE_FIXTURE_NARRATIVE" : JSON.stringify({ criteria: [{ id: "expected", met: true, reason: "Synthetic separate judge fixture finding" }], note: "No live agent review measured" }), sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "synthetic-launch-rehearsal" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "PRIVATE_FIXTURE_CONSOLE", provenance: p, ...(patch ? { change: { baseCommit: request.repo.commit, patch, sha256: hashBytes(patch) } } : {}) };
        };
        const application = { executeRole, runCommands };
        const createService = () => createAssistantService(controller, { application, dependencies: { start: async (state, accepted, authority, options) => {
            await mkdir(state, { recursive: true });
            const prepared = await prepareRepositorySource(accepted.repository, { controllerDir: state, localRepo: source });
            await immutableControllerFile(join(state, "prepared-source.json"), prepared);
            // Declared fixture bypass: this does not claim measured environment discovery.
            await immutableControllerFile(join(state, "environment.json"), await discoverEnvironment(prepared.objectStore, accepted));
            const result = await startController(state, accepted, authority, { ...options, ...application });
            if (loseStartReply) { loseStartReply = false; throw new Error("SCRIPTED lost reply after the durable domain stop"); }
            return result;
        } } });
        service = await createService();
        let sequence = 0;
        const connect = async () => {
            const session = createMcpSession({ version: "fixture", call: (name, args) => service!.call(capability.token, name, args) });
            await session.receive(JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Scripted MCP test client, not Codex", version: "fixture" } } }));
            await session.receive(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
            return async (name: string, args: unknown): Promise<any> => {
                const request = { jsonrpc: "2.0", id: ++sequence, method: "tools/call", params: { name: `wringer.${name}`, arguments: args } }, response = await session.receive(JSON.stringify(request));
                await record({ surface: "in-process MCP protocol fixture", request, response });
                assert(response && "result" in response, `MCP ${name} did not produce a tool response`);
                return response.result.structuredContent;
            };
        };
        let call = await connect();
        const proposed = await call("propose", { workspaceId: initialized.workspace.id, idempotencyKey: crypto.randomUUID(), intent: plan.intent, plan, assumptions: [limits[1]], questions: [] }), jobId = proposed.jobId, state = assistantControllerState(controller, jobId);
        const status = () => call("get_status", { jobId });
        const guard = (view: any) => ({ jobId, idempotencyKey: crypto.randomUUID(), expectedRevision: view.revision, expectedCandidateTree: view.candidateTree });
        await check("proposal holds without approving or spending", proposed.outcome === "awaiting-approval" && roles.length === 0);
        await check("unapproved start refuses", (await call("start", guard(proposed))).code === "not-approved");
        const approval = await call("get_approval_request", { jobId });
        await record({ surface: "SCRIPTED operator approval, not a human", actor, jobId, revision: approval.revision, budget: plan.budget });
        if (guided) {
            consoleServer = await createAssistantConsole(service, { application, guided: true });
            browser = await launchPmBrowser(root, record); await service.runner.start();
            const result = await runGuidedPmJourney({ page: browser.page, url: consoleServer.url, root, state, jobId, actor, origin, baseCommit, roleCount: () => roles.length, call, record, check, git, command });
            await writeFile(join(root, "result.json"), JSON.stringify({ ...result, implementation, checks, limits }, null, 2) + "\n");
            failed = false; return { directory: root, ...result, checks, implementation, limits };
        }
        consoleServer = await createAssistantConsole(service, { application });
        browser = await launchPmBrowser(root, record);
        await browser.approve(consoleServer.url, actor);
        await check("real browser approves the actual form after console reload and reopen", (await status()).outcome !== "awaiting-approval");
        const start = guard(await status()); await call("start", start); await service.runner.start();
        async function settled(id: string) {
            const deadline = Date.now() + 60000;
            while (Date.now() < deadline) { const op = await service!.runner.read(id); if (["completed", "failed", "uncertain"].includes(op.status)) { await record({ surface: "durable assistant operation", operation: op }); return op; } await Bun.sleep(25); }
            throw new Error(`Operation ${id} did not settle within the fixture deadline`);
        }
        await check("lost response stays uncertain despite completed domain work", (await settled(start.idempotencyKey)).status === "uncertain" && (await status()).outcome === "uncertain");
        await consoleServer.stop(); await service.runner.stop(1000); service = await createService(); call = await connect();
        consoleServer = await createAssistantConsole(service, { application });
        await check("owner recreation and reconnect do not replay uncertain work", (await call("start", start)).outcome === "uncertain" && roles.length === 2);
        const reconciled = await service.reconcile(jobId, start.idempotencyKey, true); await record({ surface: "SCRIPTED operator reconciliation", reconciled }); await service.runner.start();
        await check("reconciliation preserves original role reservations", reconciled.status === "completed" && (await status()).usage.development.measured.sessions.reserved === 2);
        const first = await status(), firstBoard = await readPmWorkspace(state);
        await check("assistant and PM board agree at first hold", first.outcome === "human-hold" && first.revision === firstBoard.revision && first.candidateTree === firstBoard.candidate?.tree && first.stage === firstBoard.stage);
        await check("red-first evidence precedes green result", firstBoard.checks.every(c => c.before.status === "failed" && c.after.status === "passed"));
        await check("handover refuses before the human requirement", (await call("prepare_handover", guard(first))).code === "not-ready");
        for (const name of ["record_human_verdict", "publish", "increase_budget"]) {
            const refused = await service.call(capability.token, `wringer.${name}`, { jobId }); await record({ surface: "forbidden assistant capability probe", name, refused });
            await check(`assistant cannot invoke ${name}`, refused.outcome === "refused");
        }
        async function operator(action: WorkspaceCommand["action"]) {
            const input = await browser!.command(action, page => page.locator(`[data-command="${action}"]`).click());
            const deadline = Date.now() + 60000;
            while (Date.now() < deadline) { const outcome = await readWorkspaceCommand(state, input.idempotencyKey); if (outcome.status !== "running") { await record({ surface: "operator command outcome", outcome }); assert(outcome.status === "completed", `${action}: ${outcome.error}`); return outcome.result as any; } await Bun.sleep(25); }
            throw new Error(`Operator ${action} did not settle`);
        }
        await browser.openReview(consoleServer.url);
        failNextDisplay = true;
        const failedDisplay = await operator("show");
        await browser.assertFailedDisplay();
        await check("real browser refuses a verdict after failed showing", failedDisplay.receipt.success === false && (await readPmWorkspace(state)).criteria.find(c => c.id === "readable")?.state === "unknown");
        const firstDisplay = await operator("show");
        await browser.reviewForm("not_met", actor, negativeNote);
        await operator("review");
        await check("negative original words remain negative", (await readPmWorkspace(state)).criteria.find(c => c.id === "readable")?.note === negativeNote && (await status()).outcome !== "review-ready");
        const revisionRequest = { ...guard(await status()), note: correction }; await call("request_revision", revisionRequest);
        await check("correction runs within the same finite job allowance", (await settled(revisionRequest.idempotencyKey)).status === "completed" && roles.length === 4);
        const corrected = await status(), correctedBoard = await readPmWorkspace(state), history = await readValidatedContainedState(state);
        await check("correction changes source, retains feedback and does not inherit positive acceptance", corrected.candidateTree !== first.candidateTree && history.events.some(e => e.type === "revision-requested" && (e.details as any).feedback === correction) && correctedBoard.criteria.find(c => c.id === "readable")?.state !== "met");
        await check("duplicate correction observes without replay", (await call("request_revision", revisionRequest)).outcome === "completed" && roles.length === 4);
        await check("exhausted correction allowance refuses", (await call("request_revision", { ...guard(corrected), note: "SCRIPTED extra attempt must not run" })).outcome === "refused" && roles.length === 4);
        await browser.refresh();
        await check("changed source does not inherit a browser verdict or note", !await browser.page.locator("#review-yes").isChecked() && !await browser.page.locator("#review-no").isChecked() && await browser.page.locator("#review-note").inputValue() === "");
        const shown = await operator("show");
        await check("display is bound to the corrected source", shown.receipt.candidateTree === corrected.candidateTree && shown.output.includes("Expected value is ready"));
        await browser.reviewForm("met", actor, positiveNote);
        await operator("review");
        const ready = await status();
        await check("scripted positive review reaches ready without another agent", ready.outcome === "review-ready" && roles.length === 4);
        const handover = guard(ready); await call("prepare_handover", handover);
        const preparation = await settled(handover.idempotencyKey);
        await check("handover preparation completes", preparation.status === "completed");
        const assistantPrepared = (await readWorkspaceCommand(state, handover.idempotencyKey)).result as any;
        await browser.refresh();
        await browser.page.locator("#delivery-remote").fill(destination.remote);
        await browser.page.locator("#delivery-source").fill(destination.sourceBranch);
        await browser.page.locator("#delivery-target").fill(destination.targetBranch);
        const prepared = await operator("prepare-delivery");
        await check("browser preparation after assistant preparation retains delivery identity", prepared.delivery.deliveryId === assistantPrepared.delivery.deliveryId);
        const beforeSend = await git(["--git-dir", origin, "for-each-ref", "--format=%(refname)", "refs/heads"]);
        await record({ surface: "SCRIPTED handover refusal", decision: "Do not publish yet", note: "Withholding the separate send command is the refusal; no synthetic API approval was inferred." });
        await check("prepared handover and withheld send do not publish", prepared.delivery.pushed === false && beforeSend.trim() === "refs/heads/main");
        await check("browser publication waits for a separate explicit confirmation", await browser.page.locator('[data-command="publish"]').isDisabled() && !await browser.page.locator("#publication-consent").isChecked());
        await browser.page.locator("#publication-consent").check();
        const delivered = await operator("publish");
        await check("separate scripted send publishes only the review branch", delivered.pushed === true && (await git(["--git-dir", origin, "rev-parse", "main"])).trim() === baseCommit);
        const clone = join(root, "fresh-clone"); await git(["clone", "--branch", destination.sourceBranch, origin, clone]);
        const audit = await command("literal carried audit command from fresh clone root", ["/bin/sh", "-c", delivered.auditCommand], clone);
        const bundle = join(clone, ".wringer/deliveries", delivered.deliveryId), view = await readContainedDeliveryProjection(bundle), certificate = JSON.parse(await readFile(join(bundle, "certificate.json"), "utf8"));
        const assistant = await status(), board = await readPmWorkspace(state), documents = await Promise.all(["mr.md", "summary.md", "board.html"].map(name => readFile(join(bundle, name), "utf8")));
        await check("assistant and PM board report the actual branch publication and next audit action", assistant.outcome === "branch-pushed" && assistant.publication?.status === board.publication?.status && assistant.publication?.deliveryId === board.publication?.deliveryId && assistant.publication?.deliveryId === delivered.deliveryId && assistant.publication?.evidenceCommit === delivered.evidenceCommit && assistant.nextAction.includes("fresh clone") && !assistant.nextAction.includes("Review the handover and its exact destination"));
        await check("sent handover disables fresh preparation in the assistant", assistant.actions.find((action: any) => action.action === "prepare_handover")?.enabled === false);
        await check("sent handover disables both PM publication buttons", board.actions.filter(action => ["prepare-delivery", "publish"].includes(action.id)).every(action => action.enabled === false));
        await check("fresh handover request after publication refuses without another operation", (await call("prepare_handover", guard(assistant))).outcome === "refused" && (await status()).operations.length === assistant.operations.length);
        await check("live readers and carried delivery share the corrected candidate", assistant.candidateTree === board.candidate?.tree && assistant.candidateTree === view.source.tree && delivered.codeCommit === view.source.codeCommit);
        await check("all carried views preserve delivery identity and original positive note", documents.every((text, index) => text.includes(delivered.deliveryId) && text.includes(index === 2 ? htmlText(positiveNote) : positiveNote)) && certificate.view.deliveryId === delivered.deliveryId && certificate.view.criteria.find((c: any) => c.id === "readable")?.note === positiveNote);
        const counts = { checks: board.checks.length, proved: board.criteria.filter(c => c.kind === "check" && c.state === "met").length, human: board.criteria.filter(c => c.kind === "human" && c.state === "met").length };
        // The frozen delivery view leaves a check row's optional "by" null;
        // live PM readers label it "Independent agent review". Compare semantic
        // requirement facts and exact HUMAN attribution, not that UI label.
        const semantic = (rows: typeof board.criteria) => rows.map(row => ({ ...row, by: row.kind === "human" ? row.by : null }));
        await check("assistant board certificate and carried text agree on requirements and counts", hashValue(assistant.requirements) === hashValue(board.criteria) && hashValue(semantic(board.criteria)) === hashValue(semantic(view.criteria)) && hashValue(certificate.view) === hashValue(view) && hashValue(view.counts) === hashValue(counts) && documents.every(text => text.includes(`Checks: ${counts.checks}; red-first receipts: ${counts.proved}; human answers: ${counts.human}.`)));
        await check("private role narratives and controller paths are not carried", documents.every(text => !text.includes("PRIVATE_FIXTURE") && !text.includes(root)));
        await check("both usage lanes retain unknown bill values", assistant.usage.codingApp.cost === null && assistant.usage.development.cost === null && board.usage.costUsd === null && assistant.usage.development.measured.sessions.reserved === 4);
        const falsify = await command("literal breakage command truthfully unavailable without fixture runtime", ["/bin/sh", "-c", delivered.falsify.command], clone, 3);
        await check("unavailable live breakage measurement stays inconclusive", /inconclusive|unavailable/i.test(falsify.stdout));
        await writeFile(join(root, "assistant.json"), JSON.stringify(sanitize(assistant), null, 2) + "\n"); await writeFile(join(root, "pm-workspace.json"), JSON.stringify(sanitize(board), null, 2) + "\n");
        await browser.finish(consoleServer.origin + "/");
        await check("real browser can lock its console and reload without decision authority", true);
        const result = { schema_version: "wringer.assistant-launch-rehearsal.v1", status: "passed", fixture: true, implementation, startedAt, finishedAt: new Date().toISOString(), wallMs: Date.now() - began, jobId, journeyId: board.journeyId, deliveryId: delivered.deliveryId, candidateCommit: delivered.codeCommit, candidateTree: board.candidate?.tree, evidenceCommit: delivered.evidenceCommit, checks, roleSessions: roles, providerCalls: 0, credentialReads: 0, realBrowserMeasured: true, independentPmMeasured: false, realClientMeasured: false, realContainmentMeasured: false, humanDecisions: "scripted-test-fixtures-only", freshCloneAudit: { exitCode: audit.exit_code, command: delivered.auditCommand }, breakageTest: "inconclusive-runtime-unavailable", limits };
        await writeFile(join(root, "result.json"), JSON.stringify(result, null, 2) + "\n");
        failed = false;
        return { directory: root, ...result };
    } catch (error) {
        if (guided && browser) { await browser.page.screenshot({ path: join(root, "browser-guided-stop.png"), fullPage: true }).catch(() => {}); await record({ browserStopText: await browser.page.locator("#job-message").innerText().catch(() => "unavailable") }); }
        await record({ stop: error instanceof Error ? error.message : String(error) });
        await writeFile(join(root, "result.json"), JSON.stringify({ status: "failed", fixture: true, startedAt, wallMs: Date.now() - began, checks, limits }, null, 2) + "\n");
        throw new Error(`Assistant launch rehearsal failed; retained evidence: ${root}`, { cause: error });
    } finally {
        if (browser) await browser.close();
        if (consoleServer) await consoleServer.stop();
        if (service) await service.runner.stop(1000);
        await record({ finishedAt: new Date().toISOString(), failed, ownerStopped: true });
    }
}
if (import.meta.main) console.log(JSON.stringify(await runAssistantLaunchRehearsal(undefined, process.argv.includes("--guided")), null, 2));
