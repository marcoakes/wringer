/** Public binary walkthrough; all research observations are explicit fixtures. */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ordinaryImprovementFixture } from "../packages/application/fixtures/ordinary-improvement";
import { collectExperiment, jobExperimentLocation, retainDelegationJob, assistantControllerState } from "../packages/application/src";
import { createExecutionAuthority } from "../packages/plan/src";
import { runContainedJourney } from "../packages/workflow/src";
import { environment } from "../packages/workflow/fixtures/loop-engineering";
const repository = resolve(import.meta.dir, ".."), output = join(repository, "build", `job-improvements-${crypto.randomUUID()}`);
await mkdir(output, { recursive: true });
const f = await ordinaryImprovementFixture(), checks: { name: string; passed: boolean }[] = [];
let fixtureDispatches = 0;
const check = (name: string, passed: boolean) => { checks.push({ name, passed }); if (!passed) throw new Error(name); };
async function cli(args: string[], succeeds = true) {
    const child = Bun.spawn([join(repository, "dist/wring"), ...args, "--app-dir", f.root, "--json"], { cwd: f.root, stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if ((exit === 0) !== succeeds) throw new Error(`Packaged ${args[0]} ${args[1]} exit ${exit}; ${stderr.replaceAll(f.root, "[private-fixture]")}`);
    return succeeds ? JSON.parse(stdout) : null;
}
try {
    check("ordinary job starts with no research connection or grant", !(await cli(["job", "improvements", "--job", f.jobId])).connected);
    await cli(["experiment", "connect", "--job", f.jobId, "--task-family", "reports"]);
    // A real durable journey interrupted before any runtime dispatch supplies
    // development-only observations. It is not a live product failure.
    const prepared = await f.controller.recordProposal({ workspaceId: f.controller.workspace.id, idempotencyKey: crypto.randomUUID(), proposal: { intent: f.plan.intent, title: f.plan.name, criteria: f.plan.acceptance.criteria, checks: f.plan.acceptance.checks.map(({ id, criteria }) => ({ id, criteria })) } });
    const jobId = String(prepared.jobId); await retainDelegationJob(f.root, f.context, jobId);
    const plan = (await f.controller.inspectProposal(jobId)).plan!, abort = new AbortController(); abort.abort();
    const forbidden = async () => { throw new Error("No runtime or model dispatch is allowed"); };
    await runContainedJourney({ controllerDir: assistantControllerState(f.controllerRoot, jobId), plan, environment: environment(plan), authority: createExecutionAuthority(plan, { actor: "Scripted engineering fixture", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 60000).toISOString() }), signal: abort.signal, services: { prepareSource: forbidden, captureCandidate: forbidden, verifyCandidate: forbidden }, executeRole: forbidden });
    const patterns = await cli(["experiment", "patterns", "--job", jobId, "--task-family", "reports"]);
    check("job handle exposes structured ordinary failure evidence without controller paths", patterns.sources.length === 1 && !JSON.stringify(patterns).includes(f.root));
    const input = join(f.root, "comparison.json"); await writeFile(input, JSON.stringify(f.experiment));
    const select = ["--job", f.jobId, "--experiment", f.experiment.id];
    await cli(["experiment", "register", ...select, "--input", input]);
    const proposal = await cli(["experiment", "proposal", ...select]);
    check("registered artifact fixes the prediction and comparison before collection", proposal.plan.prediction.statement === f.experiment.prediction.statement && (await cli(["experiment", "evaluate", ...select])).missingTrials.length === 2);
    const grant = await cli(["experiment", "grant", ...select, "--actor", "Scripted research fixture", "--expires", new Date(Date.now() + 60000).toISOString(), "--output", "grant.json"]);
    const location = await jobExperimentLocation(f.root, f.jobId, f.experiment.id);
    await collectExperiment(location.state!, grant, { fixture: { run: async () => { fixtureDispatches++; throw new Error("Deliberate fixture unavailability"); } } });
    const result = await cli(["experiment", "evaluate", ...select]), view = await cli(["job", "improvements", "--job", f.jobId]);
    check("failed and undispatched fixture slots remain in the full denominator", result.recordedTrials === 2 && result.fixtureTrials === 2 && result.liveTrials === 0 && result.cost !== 0 && view.experiments[0].result.evidenceRevision === result.evidenceRevision);
    check("applicability and the proposed approach are reviewable from a job", view.experiments[0].applicability.every((row: any) => ["source", "runtime", "models", "environment", "checks"].every(key => row[key] === true)) && view.experiments[0].proposal.playbooks[0].candidate.sha256 === f.experiment.candidatePlaybook);
    await cli(["experiment", "promote", ...select, "--actor", "Fixture", "--note", "Must refuse fixture adoption", "--expected-revision", view.revision, "--expected-current", "none", "--expected-evidence", result.evidenceRevision, "--yes"], false);
    check("fixtures never qualify adoption or change an active plan", !(await cli(["job", "improvements", "--job", f.jobId])).selectedDigest && (await f.controller.inspectProposal(jobId)).plan?.plan_sha256 === plan.plan_sha256);
    await collectExperiment(location.state!, grant, { fixture: { run: forbidden } });
    check("re-observation never dispatches the comparison again", fixtureDispatches === 1);
} finally {
    await writeFile(join(output, "transcript.json"), JSON.stringify({ fixture: true, status: checks.length === 7 && checks.every(row => row.passed) ? "passed" : "failed", checks, providerCalls: 0, fixtureDispatches, limits: ["Packaged job routes and the real collector with a failure fixture. No provider, real containment, live benefit or independent person was measured.", "Positive adoption and rollback are separate synthetic mechanism tests. This walkthrough correctly refuses to promote fixture evidence."] }, null, 2) + "\n");
}
console.log(`Packaged ordinary improvement evidence: ${output}`);
