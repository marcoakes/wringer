/** The job-handle route for proposals: evidence fences every held-out task of the job's
 * connected comparisons, refuses replicates that ran a held-out source, reads lessons,
 * and the job's improvement view shows replicate sets and proposals. Scripted roles. */
import { afterEach, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createExecutionAuthority } from "@wringer/plan";
import { runContainedJourney } from "@wringer/workflow";
import { assistantControllerState, collectReplicateSet, jobReplicateLocation, retainDelegationJob, REPLICATE_ACTOR_PREFIX } from "@wringer/application";
import { readExperimentJson } from "../../application/src/experiment-store";
import { ordinaryImprovementFixture } from "../../application/fixtures/ordinary-improvement";
import { runFixtureJourney } from "../../application/test/support/journey-fixture";
import { environment } from "../../workflow/fixtures/loop-engineering";
import { dispatch } from "../src/app";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("job form: replicate evidence is fenced by the job's held-out tasks and shown on the job's view", async () => {
    const f = await ordinaryImprovementFixture(); roots.push(f.root);
    await dispatch(["experiment", "connect", "--app-dir", f.root, "--job", f.jobId, "--task-family", "reports"]);
    const input = join(f.root, "comparison.json"); await writeFile(input, JSON.stringify(f.experiment));
    await dispatch(["experiment", "register", "--job", f.jobId, "--app-dir", f.root, "--experiment", f.experiment.id, "--input", input]);
    const complete = await f.controller.recordProposal({ workspaceId: f.controller.workspace.id, idempotencyKey: crypto.randomUUID(), proposal: { intent: f.plan.intent, title: f.plan.name, criteria: f.plan.acceptance.criteria, checks: f.plan.acceptance.checks.map(({ id, criteria }) => ({ id, criteria })) } });
    const jobId = String(complete.jobId); await retainDelegationJob(f.root, f.context, jobId);
    const plan = (await f.controller.inspectProposal(jobId)).plan!, abort = new AbortController(); abort.abort();
    const forbidden = async () => { throw new Error("No provider or runtime is permitted"); };
    await runContainedJourney({ controllerDir: assistantControllerState(f.controllerRoot, jobId), plan, environment: environment(plan), authority: createExecutionAuthority(plan, { actor: "Scripted fixture", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 60000).toISOString() }), signal: abort.signal, services: { prepareSource: forbidden, captureCandidate: forbidden, verifyCandidate: forbidden }, executeRole: forbidden });
    await dispatch(["experiment", "replicate", "register", "--app-dir", f.root, "--job", jobId, "--task-family", "reports", "--replicate-set", "job-replicates", "--k", "2"]);
    await dispatch(["experiment", "replicate", "grant", "--app-dir", f.root, "--job", jobId, "--replicate-set", "job-replicates", "--actor", "Fixture operator", "--expires", new Date(Date.now() + 600000).toISOString(), "--output", "grant.json"]);
    const replicates = (await jobReplicateLocation(f.root, jobId, "job-replicates")).state;
    await collectReplicateSet(replicates, await readExperimentJson(join(replicates, "grant.json")), { fixture: { run: (p, state, slot) => runFixtureJourney(p, state, { actor: `${REPLICATE_ACTOR_PREFIX} Fixture operator`, failures: slot.index - 1 }) } });
    const evidence: any = await dispatch(["experiment", "evidence", "--app-dir", f.root, "--job", jobId, "--replicate-set", "job-replicates", "--proposal", "first"]);
    expect(evidence.value.journeys.map((j: any) => j.label)).toEqual(["replicate-01", "replicate-02"]);
    expect(evidence.value.fence.heldOutIds).toEqual(expect.arrayContaining(f.experiment.tasks.filter(t => t.split === "held-out").flatMap(t => [t.id, t.sourceTree])));
    expect(evidence.value.lessons).toEqual([]);
    await expect(dispatch(["experiment", "evidence", "--app-dir", f.root, "--job", jobId, "--replicate-set", "job-replicates", "--proposal", "second", "--state", f.root])).rejects.toThrow("never both");
    expect((await dispatch(["experiment", "proposal-result", "--app-dir", f.root, "--job", jobId, "--proposal", "first"])).text).toContain("No proposal has run here");
    // A comparison whose held-out task is the very source the replicates ran: refused before any byte is written.
    await writeFile(join(f.root, "overlap.json"), JSON.stringify({ ...f.experiment, id: "reports-same-source", tasks: f.experiment.tasks.map(t => ({ ...t, sourceTree: "a".repeat(40) })) }));
    await dispatch(["experiment", "register", "--job", f.jobId, "--app-dir", f.root, "--experiment", "reports-same-source", "--input", join(f.root, "overlap.json")]);
    await expect(dispatch(["experiment", "evidence", "--app-dir", f.root, "--job", jobId, "--replicate-set", "job-replicates", "--proposal", "third"])).rejects.toThrow("ran a held-out task's source tree");
    const view: any = await dispatch(["job", "improvements", "--app-dir", f.root, "--job", jobId, "--json"]);
    expect(view.value.schema_version).toBe("wringer.job-improvements.v2");
    expect(view.value.evidence.replicateSets.map((r: any) => [r.id, r.k, r.recorded])).toEqual([["job-replicates", 2, 2]]);
    expect(view.value.evidence.proposals.map((p: any) => [p.id, p.status])).toEqual([["first", "not-run"]]);
}, 120000);
