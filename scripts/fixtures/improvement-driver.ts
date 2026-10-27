/** TEST FIXTURE ONLY. Run by Bun from source, separately from the public CLI, for the
 * steps that would otherwise spend: replicate and comparison collection, and the one
 * proposer session. Real Git journeys, capture, validation and private handover;
 * scripted agents and check commands. It does not measure a model or containment. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { discoverEnvironment, type ExecutionPlan } from "../../packages/plan/src";
import { prepareRepositorySource, processDriver } from "../../packages/runtime/src";
import { collectExperiment, collectReplicateSet, proposePlaybookTree, readExperiment, REPLICATE_ACTOR_PREFIX } from "../../packages/application/src";
import { readExperimentJson } from "../../packages/application/src/experiment-store";
import { scriptedTreeProposer } from "../../packages/application/fixtures/proposal-tree";
import { runAndValidateTreeJourney, treeWorld } from "../../packages/workflow/fixtures/playbook-tree-journey";

const [action, directoryArgument, stateArgument] = process.argv.slice(2), directory = resolve(directoryArgument!);
process.env.TMPDIR = join(directory, "scratch"); await mkdir(process.env.TMPDIR, { recursive: true });
interface World { repo: string; bundlePath: string; plan: ExecutionPlan; sourceTree: string; }
const world = async (): Promise<World> => JSON.parse(await readFile(join(directory, "world.json"), "utf8"));
async function freshBundle(repo: string, name: string) {
    const path = join(directory, `${name}.bundle`);
    const made = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-C", repo, "bundle", "create", path, "--all"], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
    if (made.code !== 0) throw new Error(made.stderr); return path;
}
if (action === "prepare") {
    const made = await treeWorld({ select: false });
    const value: World = { repo: made.repo, bundlePath: made.bundlePath, plan: made.plan, sourceTree: made.environment.source_tree };
    await writeFile(join(directory, "world.json"), JSON.stringify(value, null, 2));
    await writeFile(join(directory, "replicate-set.json"), JSON.stringify({ id: "total-replicates", taskFamily: "total", plan: made.plan, k: 2, sourceTree: value.sourceTree, wallClockSeconds: 900 }, null, 2));
    console.log(JSON.stringify({ fixture: true, repo: made.repo, commit: made.commit, planSha256: made.plan.plan_sha256 }));
} else if (action === "collect-replicates") {
    const w = await world(), environment = await discoverEnvironment(w.repo, w.plan), state = resolve(stateArgument!);
    const current = await collectReplicateSet(state, await readExperimentJson(join(state, "grant.json")), { fixture: { run: (plan, journey, slot) => runAndValidateTreeJourney({ bundlePath: w.bundlePath, environment }, plan, journey, { actor: `${REPLICATE_ACTOR_PREFIX} Fixture operator`, failures: slot.index - 1 }) } });
    console.log(JSON.stringify({ fixture: true, outcomes: current.replicates.map(r => r.outcome), divergence: current.divergence.diverging }));
} else if (action === "propose") {
    const w = await world(), state = resolve(stateArgument!);
    const result = await proposePlaybookTree(state, await readExperimentJson(join(state, "proposal-request.json")), { fixtureExecutor: scriptedTreeProposer(), fixtureSource: (plan, controller) => prepareRepositorySource({ ...plan.repository, bundlePath: w.bundlePath }, { controllerDir: controller }) });
    console.log(JSON.stringify({ fixture: true, status: result.status, changed: result.changed, citations: result.notes?.citations.length ?? 0, reason: result.reason }));
} else if (action === "collect-experiment") {
    const w = await world(), state = resolve(stateArgument!), plans = (await readExperiment(state)).plan.tasks.flatMap(task => [task.baseline, task.candidate]);
    const bundlePath = await freshBundle(w.repo, "comparison"), environments = new Map();
    for (const plan of plans) environments.set(plan.plan_sha256, await discoverEnvironment(w.repo, plan));
    const current = await collectExperiment(state, await readExperimentJson(join(state, "grant.json")), { fixture: { run: (plan, journey, grant) => runAndValidateTreeJourney({ bundlePath, environment: environments.get(plan.plan_sha256) }, plan, journey, { actor: `Experiment: ${grant.actor}` }) } });
    console.log(JSON.stringify({ fixture: true, outcomes: current.trials.map(t => t.outcome), handovers: current.handovers.map(h => h.status) }));
} else throw new Error("Fixture actions are prepare, collect-replicates, propose and collect-experiment only");
