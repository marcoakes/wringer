/** The replicate-set CLI: private-path and job-handle forms; offline register, grant and
 * status; collection needs --yes. Scripted roles only; no model or runtime. */
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDeclaration, createExecutionAuthority } from "@wringer/plan";
import { runContainedJourney } from "@wringer/workflow";
import { assistantControllerState, collectReplicateSet, retainDelegationJob, REPLICATE_ACTOR_PREFIX } from "@wringer/application";
import { readExperimentJson } from "../../application/src/experiment-store";
import { ordinaryImprovementFixture } from "../../application/fixtures/ordinary-improvement";
import { fixturePlan, runFixtureJourney } from "../../application/test/support/journey-fixture";
import { environment } from "../../workflow/fixtures/loop-engineering";
import { dispatch } from "../src/app";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
test("private-path form: register, grant and status are offline; collect needs --yes; status says where attempts disagreed", async () => {
    const root = await mkdtemp(join(tmpdir(), "wringer-replicate-cli-")); roots.push(root); await chmod(root, 0o700);
    const inputs = await mkdtemp(join(tmpdir(), "wringer-replicate-input-")); roots.push(inputs);
    const plan = fixturePlan(2);
    await writeFile(join(inputs, "set.json"), JSON.stringify({ id: "cli-replicates", taskFamily: "reports", plan, k: 3, sourceTree: "a".repeat(40), wallClockSeconds: 600 }));
    const registered: any = await dispatch(["experiment", "replicate", "register", "--state", root, "--input", join(inputs, "set.json")]);
    expect(registered.value.k).toBe(3); expect(registered.text).toContain("No attempt started");
    const granted: any = await dispatch(["experiment", "replicate", "grant", "--state", root, "--actor", "Fixture operator", "--expires", new Date(Date.now() + 600000).toISOString(), "--output", "grant.json"]);
    expect(granted.value.limits.replicates).toBe(3);
    expect((await dispatch(["experiment", "replicate", "status", "--state", root])).text).toContain("no attempt has been recorded");
    await expect(dispatch(["experiment", "replicate", "collect", "--state", root, "--grant", "grant.json"])).rejects.toThrow("add --yes");
    await collectReplicateSet(root, await readExperimentJson(join(root, "grant.json")), { fixture: { run: (p, state, slot) => runFixtureJourney(p, state, { actor: `${REPLICATE_ACTOR_PREFIX} Fixture operator`, failures: [0, 1, 2][slot.index - 1]! }) } });
    const status: any = await dispatch(["experiment", "replicate", "status", "--state", root]);
    expect(status.text).toContain("Attempt 3: stopped, 2 worker attempts"); expect(status.text).toContain("Disagreed on: check total-check");
    expect(status.value.divergence.diverging).toContain("first failure");
    expect((await dispatch(["experiment", "replicate", "--help"])).text).toContain("never why");
});
test("job-handle form repeats the job's approved plan on the source tree its journey measured", async () => {
    const f = await ordinaryImprovementFixture(); roots.push(f.root);
    await dispatch(["experiment", "connect", "--app-dir", f.root, "--job", f.jobId, "--task-family", "reports"]);
    const complete = await f.controller.recordProposal({ workspaceId: f.controller.workspace.id, idempotencyKey: crypto.randomUUID(), proposal: { intent: f.plan.intent, title: f.plan.name, criteria: f.plan.acceptance.criteria, checks: f.plan.acceptance.checks.map(({ id, criteria }) => ({ id, criteria })) } });
    const jobId = String(complete.jobId); await retainDelegationJob(f.root, f.context, jobId);
    const register = ["experiment", "replicate", "register", "--app-dir", f.root, "--job", jobId, "--task-family", "reports", "--replicate-set", "job-replicates", "--k", "2"];
    await expect(dispatch(register)).rejects.toThrow("Run the job first");
    await expect(dispatch([...register.slice(0, 8), "other-family", ...register.slice(9)])).rejects.toThrow("connected task family");
    const plan = (await f.controller.inspectProposal(jobId)).plan!, abort = new AbortController(); abort.abort();
    const forbidden = async () => { throw new Error("No provider or runtime is permitted"); };
    await runContainedJourney({ controllerDir: assistantControllerState(f.controllerRoot, jobId), plan, environment: environment(plan), authority: createExecutionAuthority(plan, { actor: "Scripted fixture", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 60000).toISOString() }), signal: abort.signal, services: { prepareSource: forbidden, captureCandidate: forbidden, verifyCandidate: forbidden }, executeRole: forbidden });
    const set: any = (await dispatch(register)).value;
    expect(set.plan.plan_sha256).toBe(plan.plan_sha256); expect(set.sourceTree).toBe("a".repeat(40)); expect(set.k).toBe(2);
    const granted: any = await dispatch(["experiment", "replicate", "grant", "--app-dir", f.root, "--job", jobId, "--replicate-set", "job-replicates", "--actor", "Fixture operator", "--expires", new Date(Date.now() + 600000).toISOString(), "--output", "grant.json"]);
    expect(granted.value.replicateSetSha256).toBe(set.sha256);
    expect((await dispatch(["experiment", "replicate", "status", "--app-dir", f.root, "--job", jobId, "--replicate-set", "job-replicates"])).text).toContain("no attempt has been recorded");
    await expect(dispatch(["experiment", "replicate", "status", "--app-dir", f.root, "--job", jobId, "--replicate-set", "job-replicates", "--state", f.root])).rejects.toThrow("never both");
}, 20000);
