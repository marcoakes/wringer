/** Real Chromium and product loopback/session routes; every action and adversarial
 * response here is SCRIPTED. No live research, model benefit or human is measured. */
import { mkdir, mkdtemp, readFile, readdir, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileDeclaration, compileExecutionPlan, hashBytes, hashValue } from "../packages/plan/src";
import { initializeAssistant, createAssistantService, issueAssistantCapability } from "../packages/application/src/assistant";
import { connectImprovements, inspectImprovements } from "../packages/application/src/improvements";
import { registerExperiment } from "../packages/application/src/experiments";
import { createAssistantConsole } from "../packages/cli/src/assistant-console";
import { launchPmBrowser } from "./pm-browser";

export async function runImprovementsBrowserRehearsal(repository = resolve(import.meta.dir, "..")) {
    const startedAt = new Date().toISOString(), directory = join(repository, ".wringer", `improvements-browser-${crypto.randomUUID()}`);
    await mkdir(directory, { recursive: true });
    const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "wringer-improvements-browser-"))), controller = join(privateRoot, "assistant"), research = join(privateRoot, "research"), registry = join(privateRoot, "adoptions");
    await mkdir(join(research, "experiments", "reports-browser"), { recursive: true, mode: 0o700 }); await mkdir(registry, { mode: 0o700 });
    const transcript: unknown[] = [], checks: string[] = [];
    const limits = ["Scripted engineering fixture: Chromium, private session and invalid server requests are real; no independent PM, live model, containment or improvement benefit is measured.", "Eligible/malformed comparison responses are explicitly browser-injected fixtures, never retained research results.", "No valid collection, adoption, job approval or publication is requested. Research records remain empty and production work remains unapproved."];
    const record = async (value: unknown) => { transcript.push(JSON.parse(JSON.stringify(value).replaceAll(privateRoot, "PRIVATE_FIXTURE").replaceAll(directory, "RECEIPTS").replace(/#token=[a-f0-9]+/g, "#token=REDACTED"))); await writeFile(join(directory, "transcript.json"), JSON.stringify({ fixture: true, startedAt, limits, transcript }, null, 2) + "\n"); };
    const check = async (name: string, value: unknown) => { if (!value) throw new Error(name); checks.push(name); await record({ check: name, status: "passed" }); };
    const template = compileExecutionPlan(await readFile(join(repository, "packages/plan/examples/contained.yaml"), "utf8"), { format: "yaml" });
    const { schema_version, plan_sha256, acceptance_sha256, intent_sha256, ...data } = template;
    const declaration = { version: 3, ...data, runtime: { ...data.runtime, env: [] }, agents: { worker: { ...data.agents.worker, env: [] }, judge: { ...data.agents.judge, env: [] } }, acceptance: { ...data.acceptance, protected_paths: [...data.acceptance.protected_paths, "wringer/playbooks/candidate.json"] } };
    const baseline = compileDeclaration(declaration), candidate = compileDeclaration({ ...declaration, playbook: { path: "wringer/playbooks/candidate.json", sha256: "a".repeat(64), taskFamily: "reports" } });
    const { workspace } = await initializeAssistant(controller, { plan: baseline, cooperativeLocal: true });
    const capability = await issueAssistantCapability(controller, new Date(Date.now() + 600000).toISOString());
    let dispatches = 0;
    const service = await createAssistantService(controller, { dependencies: { start: async () => { dispatches++; throw new Error("No approval or dispatch belongs in this browser fixture"); } } });
    const proposal = await service.call(capability.token, "wringer.propose", { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), intent: baseline.intent, plan: baseline, questions: [], assumptions: [] });
    const jobId = String(proposal.jobId), before = hashValue(await service.inspectProposal(jobId));
    await registerExperiment(join(research, "experiments", "reports-browser"), { id: "reports-browser", repository: baseline.repository.url, taskFamily: "reports", baselinePlaybook: null, candidatePlaybook: candidate.playbook!.sha256, changedVariable: "worker-playbook", tasks: [{ id: "reports-1", sourceTree: "c".repeat(40), split: "held-out", baseline, candidate }], repetitions: 1, order: "alternating-pairs", stratum: { platform: process.platform === "darwin" ? "darwin" : "linux", modelSelection: "Scripted configuration only", adapterSelection: "Scripted configuration only" }, prediction: { statement: "SCRIPTED hypothesis: reduce worker attempts by one without lost requirements.", metric: "worker-attempts", minimumImprovement: 1, minimumHeldOutPairs: 4, maximumSignProbability: 0.05, visualQualityClaim: false }, limits: { maxTrials: 2, maxRoleSessions: baseline.budget.max_sessions * 2, wallClockSeconds: 600 }, dataScope: "this-repository-only", holdout: { corpusId: "scripted-reports", candidateIteration: 1, maximumCandidateIterations: 1, candidateAuthorSawHeldOutSolutions: false }, accounting: "all-planned-trials-including-failures", stoppingRule: "fixed-sample-no-extension" });
    await connectImprovements(controller, { researchRoot: research, registryRoot: registry, taskFamily: "reports" });
    const server = await createAssistantConsole(service, { guided: true }), browser = await launchPmBrowser(directory, record), page = browser.page;
    const requests: { path: string; method: string }[] = [], errors: string[] = [];
    page.on("request", request => requests.push({ path: new URL(request.url()).pathname, method: request.method() })); page.on("pageerror", error => errors.push(error.message));
    const post = (path: string, body: unknown) => page.evaluate(async ({ path, body }) => { const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "X-Wringer-Console": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; }, { path, body });
    const refresh = async () => { const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/improvements"); await page.locator("#refresh-improvements").click(); await response; };
    try {
        await page.goto(server.url); await page.locator("#approval-panel").waitFor({ state: "visible" }); await page.locator("#improvements-panel").waitFor({ state: "visible" });
        await check("real guided session removes private fragment and keeps normal approval separate", !new URL(page.url()).hash && await page.locator("#approve-job").isVisible());
        await check("optional research and engineering start collapsed without any effect", !await page.locator("#improvements-panel").evaluate(element => (element as HTMLDetailsElement).open) && !await page.locator("#job-engineering").evaluate(element => (element as HTMLDetailsElement).open) && dispatches === 0 && requests.every(row => row.method !== "POST" || row.path === "/api/session"));
        await page.locator("#improvements-panel > summary").click();
        await check("unmeasured comparison shows finite separate allowance and no adoption button", (await page.locator("#improvements-content").innerText()).includes("at most 2 fresh trials") && await page.getByRole("button", { name: "Test this improvement", exact: true }).count() === 1 && await page.getByRole("button", { name: "Use for future work", exact: true }).count() === 0);
        const initial = await inspectImprovements(controller, baseline), experiment = initial.experiments[0]!;
        const invalid = await post("/api/improvements/collect", { experimentId: experiment.id, expectedPlanSha256: experiment.planSha256, actor: "SCRIPTED", expiresAt: new Date(Date.now() + 60000).toISOString(), path: "/forbidden" });
        const stale = await post("/api/improvements/collect", { experimentId: experiment.id, expectedPlanSha256: "f".repeat(64), actor: "SCRIPTED", expiresAt: new Date(Date.now() + 60000).toISOString() });
        await check("real product routes refuse extra authority and a stale comparison identity before collection", invalid.status >= 400 && stale.status >= 400 && dispatches === 0);
        await record({ invalidRequest: invalid, staleRequest: stale, fixture: true });
        let injection: "eligible" | "malformed" = "eligible", holdNextRead = false, releaseHeldRead: (() => void) | null = null;
        await page.route(/\/api\/improvements$/, async route => {
            if (holdNextRead) { holdNextRead = false; await new Promise<void>(resolve => { releaseHeldRead = resolve; }); }
            const view = structuredClone(initial) as any; view.collection = {};
            view.experiments[0].result = { ...view.experiments[0].result, eligibility: "eligible", plannedTrials: 2, recordedTrials: 2, liveTrials: 0, fixtureTrials: 2, findings: ["SCRIPTED browser response only; not eligible real research evidence."] };
            if (injection === "malformed") view.experiments[0].result.evidenceRevision = "malformed";
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(view) });
        });
        await refresh(); const use = page.getByRole("button", { name: "Use for future work", exact: true }); await use.waitFor();
        await page.getByLabel("Who is adopting this approach?", { exact: true }).fill("SCRIPTED BROWSER FIXTURE"); await page.getByLabel("Why use this for future work?", { exact: true }).fill("Injected display must not override real evidence.");
        const refused = page.waitForResponse(response => new URL(response.url()).pathname === "/api/improvements/promote"); await use.click(); await check("a scripted eligible-looking browser view cannot override retained ineligible evidence", (await refused).status() >= 400);
        await page.getByText(/Nothing was automatically repeated/).waitFor();
        await check("refused adoption does not post a job decision or change the active proposal", requests.filter(row => row.method === "POST" && row.path.startsWith("/api/job/")).length === 0 && hashValue(await service.inspectProposal(jobId)) === before && dispatches === 0);
        await page.screenshot({ path: join(directory, "browser-improvement-refusal.png"), fullPage: true });
        injection = "malformed"; await refresh(); await page.getByText(/Improvement review unavailable/).waitFor();
        await check("malformed comparison removes all research controls without hiding ordinary approval", await page.locator("#improvements-content button").count() === 0 && await page.locator("#approve-job").isVisible());
        injection = "eligible"; await refresh(); await use.waitFor();
        await check("recovered comparison evidence clears the stale unavailable warning", !(await page.locator("#improvements-message").innerText()).includes("unavailable"));
        await page.setViewportSize({ width: 390, height: 844 }); await check("optional card fits a real mobile viewport", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: join(directory, "browser-improvement-mobile.png"), fullPage: true });
        holdNextRead = true;
        const lateRead = page.waitForResponse(response => new URL(response.url()).pathname === "/api/improvements");
        await page.locator("#refresh-improvements").click();
        for (let attempt = 0; !releaseHeldRead && attempt < 100; attempt++) await Bun.sleep(10);
        await check("the late-read lock probe held an actual comparison response", !!releaseHeldRead);
        await page.locator("#lock-job-page").click(); await page.getByText("Locked", { exact: true }).waitFor();
        (releaseHeldRead as (() => void) | null)?.(); await lateRead;
        await check("guided lock clears comparison content immediately", await page.locator("#improvements-panel").isHidden() && !(await page.locator("#improvements-content").textContent())?.trim());
        await check("a late eligible-looking response cannot restore locked research content or replay adoption", await page.locator("#improvements-content button").count() === 0 && requests.filter(row => row.method === "POST" && row.path === "/api/improvements/promote").length === 1);
        await check("no collection, adoption or production authority was retained", !(await readdir(join(research, "experiments", experiment.id))).some(name => ["collection.json", "trials"].includes(name)) && (await readdir(registry)).length === 0 && !await service.inspectApproval(jobId) && dispatches === 0);
        await check("real Chromium reported no uncaught page errors", errors.length === 0);
        const result = { schema_version: "wringer.improvements-browser-rehearsal.v1", fixture: true, status: "passed", startedAt, finishedAt: new Date().toISOString(), checks, productionDispatches: dispatches, providerCalls: 0, liveTrials: 0, independentPmMeasured: false, screenshots: ["browser-improvement-refusal.png", "browser-improvement-mobile.png"], implementationSha256: hashBytes(await readFile(import.meta.path)), limits };
        await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n"); return { directory, ...result };
    } catch (error) { await record({ failure: error instanceof Error ? error.message : String(error), fixture: true }); throw new Error(`Improvement browser fixture failed; retained evidence: ${directory}`, { cause: error }); }
    finally { await browser.close(); await server.stop(); await service.runner.stop(); }
}
if (import.meta.main) console.log(JSON.stringify(await runImprovementsBrowserRehearsal(), null, 2));
