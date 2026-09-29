import { afterEach, expect, test, spyOn } from "bun:test";
import { mkdtemp, realpath, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileExecutionPlan } from "@wringer/plan";
import { createAssistantDirectory, writeAssistantRecord, initializeAssistant, createAssistantService, retainDelegationJob } from "@wringer/application";
import { createDelegationOwner } from "../src/delegation-owner";
import { callAssistantConnection } from "../src/assistant-transport";
import { dispatch } from "../src/app";
import { collectExperiment, jobExperimentLocation, registerExperiment } from "@wringer/application";
import { writeFile } from "node:fs/promises";
import { validateDelegationOutput } from "../../mcp/src/delegation-contract";
import * as experimentStore from "../../application/src/experiment-store";
import { createExecutionAuthority, compileDeclaration } from "@wringer/plan";
import { runContainedJourney } from "@wringer/workflow";
import { environment } from "../../workflow/fixtures/loop-engineering";
import { assistantControllerState } from "@wringer/application";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
import { ordinaryImprovementFixture } from "../../application/fixtures/ordinary-improvement";
async function fixture() { const f = await ordinaryImprovementFixture(); cleanup.push(() => rm(f.root, { recursive: true, force: true })); return f; }

test("ordinary job improvement CLI removes private path setup and refuses replacing a task family", async () => {
    const f = await fixture();
    const before = (await readdir(f.root, { recursive: true })).sort();
    const empty: any = (await dispatch(["job", "improvements", "--app-dir", f.root, "--job", f.jobId])).value;
    expect(empty.schema_version).toBe("wringer.job-improvements.v1"); expect(empty.connected).toBeFalse(); expect(empty.jobId).toBe(f.jobId);
    expect((await readdir(f.root, { recursive: true })).sort()).toEqual(before);
    const args = ["experiment", "connect", "--app-dir", f.root, "--job", f.jobId, "--task-family", "reports"];
    expect((await dispatch(args)).value).toMatchObject({ connected: true, taskFamily: "reports" });
    await expect(dispatch([...args.slice(0, -1), "unrelated"])).rejects.toThrow();
    const connected: any = (await dispatch(["job", "improvements", "--app-dir", f.root, "--job", f.jobId])).value;
    expect(connected.connected).toBeTrue(); expect(connected.experiments).toEqual([]);
    expect(JSON.stringify(connected)).not.toContain(f.root); expect(connected.future.executionApproved).toBeFalse();
    expect(await f.controller.inspectApproval(f.jobId)).toBeNull(); expect(await f.controller.runner.list(f.jobId)).toEqual([]);
});
test("ordinary improvement MCP and operator page share a job-bound read without approval or dispatch", async () => {
    const f = await fixture(), other = await ordinaryImprovementFixture(f.root);
    const owner = await createDelegationOwner(f.root, f.workspaceId); cleanup.push(() => owner.stop());
    const token = new URL(owner.operatorUrl).hash.slice("#token=".length), headers = { authorization: `Bearer ${token}`, origin: owner.page, "content-type": "application/json" };
    expect(await (await fetch(owner.page)).text()).toContain('id="improvements-panel"');
    expect((await fetch(owner.page + "/api/improvements?jobId=" + f.jobId)).status).toBe(401);
    const before = (await readdir(f.root, { recursive: true })).sort();
    const cli: any = (await dispatch(["job", "improvements", "--app-dir", f.root, "--job", f.jobId])).value;
    const mcp = await callAssistantConnection(owner.connectionPath, "wringer.inspect_improvements", { jobId: f.jobId });
    const response = await fetch(owner.page + "/api/improvements?jobId=" + f.jobId, { headers });
    expect(response.status).toBe(200); expect(mcp).toEqual(cli); expect(await response.json()).toMatchObject(cli as any);
    for (const query of ["", "?jobId=" + other.jobId, "?jobId=" + f.jobId + "&jobId=" + f.jobId, "?jobId=" + f.jobId + "&state=/tmp"]) expect((await fetch(owner.page + "/api/improvements" + query, { headers })).status).toBe(409);
    expect((await (await fetch(owner.page + "/api/improvements?jobId=" + other.jobId, { headers })).json() as any).error).toBe("Job belongs to another workspace");
    expect((await fetch(owner.page + "/api/improvements/collect", { method: "POST", headers, body: JSON.stringify({ jobId: f.jobId, experimentId: "absent", expectedPlanSha256: "0".repeat(64), actor: "Fixture", expiresAt: new Date(Date.now() + 60000).toISOString() }) })).status).toBe(409);
    expect((await readdir(f.root, { recursive: true })).sort()).toEqual(before);
    expect(await f.controller.inspectApproval(f.jobId)).toBeNull(); expect(await f.controller.runner.list(f.jobId)).toEqual([]);
}, 15000);
test("job comparison lookup refuses a foreign repository retained under the selected private handle", async () => {
    const f = await fixture();
    await dispatch(["experiment", "connect", "--app-dir", f.root, "--job", f.jobId, "--task-family", "reports"]);
    const location = await jobExperimentLocation(f.root, f.jobId, f.experiment.id, f.experiment);
    const foreign = structuredClone(f.experiment); foreign.repository = "https://example.invalid/foreign.git";
    for (const task of foreign.tasks) for (const arm of ["baseline", "candidate"] as const) {
        const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...data } = task[arm];
        task[arm] = (await import("@wringer/plan")).compileDeclaration({ ...data, version: 3, repository: { ...data.repository, url: foreign.repository } });
    }
    await registerExperiment(location.state!, foreign);
    await expect(dispatch(["experiment", "evaluate", "--app-dir", f.root, "--job", f.jobId, "--experiment", f.experiment.id])).rejects.toThrow("repository or task family");
});
test("job registration retains the one input validated against its handle even if the file changes", async () => {
    const f = await fixture(), input = join(f.root, "comparison.json");
    await dispatch(["experiment", "connect", "--app-dir", f.root, "--job", f.jobId, "--task-family", "reports"]);
    await writeFile(input, JSON.stringify(f.experiment));
    const original = experimentStore.readExperimentJson;
    const spy = spyOn(experimentStore, "readExperimentJson").mockImplementation((async (path: string, max?: number) => {
        const value = await original(path, max);
        if (path === input) await writeFile(input, JSON.stringify({ ...f.experiment, id: "swapped" }));
        return value;
    }) as typeof original);
    try {
        const result: any = (await dispatch(["experiment", "register", "--app-dir", f.root, "--job", f.jobId, "--experiment", f.experiment.id, "--input", input])).value;
        expect(result.plan.id).toBe(f.experiment.id);
    } finally { spy.mockRestore(); }
});
test("job comparison registers a reviewable prediction, collects only labelled fixtures, and cannot adopt them", async () => {
    const f = await fixture(), call = (verb: string, extra: string[] = []) => dispatch(["experiment", verb, "--app-dir", f.root, "--job", f.jobId, ...extra]);
    await call("connect", ["--task-family", "reports"]);
    const input = join(f.root, "comparison.json"); await writeFile(input, JSON.stringify(f.experiment));
    const args = ["--experiment", f.experiment.id, "--input", input];
    const before = (await readdir(f.root, { recursive: true })).sort();
    await expect(call("register", [...args, "--unexpected", "ignored"])).rejects.toThrow("Unknown option");
    expect((await readdir(f.root, { recursive: true })).sort()).toEqual(before);
    await expect(call("register", ["--experiment", "another", "--input", input])).rejects.toThrow("match");
    await call("register", args);
    await expect(call("register", args)).rejects.toThrow("fresh");
    const selected = ["--experiment", f.experiment.id];
    const proposal: any = (await call("proposal", selected)).value;
    expect(proposal.plan.prediction).toEqual(f.experiment.prediction);
    const initial: any = (await call("evaluate", selected)).value; expect(initial.missingTrials).toHaveLength(2);
    const grant: any = (await call("grant", [...selected, "--actor", "Scripted fixture", "--expires", new Date(Date.now() + 60000).toISOString(), "--output", "fixture-grant.json"])).value;
    const location = await jobExperimentLocation(f.root, f.jobId, f.experiment.id); let calls = 0;
    await collectExperiment(location.state!, grant, { fixture: { run: async () => { calls++; throw new Error("Scripted unavailability, not a model observation"); } } });
    expect(calls).toBe(1);
    const result: any = (await call("evaluate", selected)).value;
    expect(result.fixtureTrials).toBe(2); expect(result.liveTrials).toBe(0); expect(result.eligibility).toBe("inconclusive");
    const view: any = (await dispatch(["job", "improvements", "--app-dir", f.root, "--job", f.jobId])).value;
    expect(view.experiments[0].applicability[0]).toMatchObject({ source: true, runtime: true, models: true, environment: true, checks: true });
    expect(view.experiments[0].result).toEqual(result);
    expect(validateDelegationOutput("wringer.inspect_improvements", view)).toEqual(view);
    await expect(call("promote", [...selected, "--actor", "Scripted fixture", "--note", "Must refuse fixtures", "--expected-revision", view.revision, "--expected-current", "none", "--expected-evidence", result.evidenceRevision, "--yes"])).rejects.toThrow("inconclusive");
    expect(await f.controller.inspectApproval(f.jobId)).toBeNull(); expect(await f.controller.runner.list(f.jobId)).toEqual([]);
}, 15000);
test("job failure patterns require the exact compiled job plan, not its template or substituted history", async () => {
    const f = await fixture(), args = ["experiment", "patterns", "--app-dir", f.root, "--job", f.jobId, "--task-family", "reports"];
    await expect(dispatch(args)).rejects.toThrow("compiled job plan");
    const complete = await f.controller.recordProposal({ workspaceId: f.controller.workspace.id, idempotencyKey: crypto.randomUUID(), proposal: { intent: f.plan.intent, title: f.plan.name, criteria: f.plan.acceptance.criteria, checks: f.plan.acceptance.checks.map(({ id, criteria }) => ({ id, criteria })) } });
    const jobId = String(complete.jobId); await retainDelegationJob(f.root, f.context, jobId);
    const { schema_version, plan_sha256, acceptance_sha256, intent_sha256, ...data } = (await f.controller.inspectProposal(jobId)).plan!;
    const other = compileDeclaration({ version: 3, ...data, repository: { ...data.repository, commit: "f".repeat(40) } }), abort = new AbortController(); abort.abort();
    const forbidden = async () => { throw new Error("No provider or runtime is permitted"); };
    await runContainedJourney({ controllerDir: assistantControllerState(f.controllerRoot, jobId), plan: other, environment: environment(other), authority: createExecutionAuthority(other, { actor: "Scripted fixture", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 60000).toISOString() }), signal: abort.signal, services: { prepareSource: forbidden, captureCandidate: forbidden, verifyCandidate: forbidden }, executeRole: forbidden });
    await expect(dispatch(["experiment", "patterns", "--app-dir", f.root, "--job", jobId, "--task-family", "reports"])).rejects.toThrow("plan");
});
