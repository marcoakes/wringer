/** Offline construction example. No model, runtime or credentials are called.
 * Run from Wringer source: bun examples/improvements/prepare-comparison.ts
 *   TASK_INDEX.json PRIVATE_EXISTING_0700_EXPERIMENT_DIR
 * The index lists complete compiled baseline/candidate JSON files and exact Git
 * source trees; this program registers their frozen comparison, not spending.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateExecutionPlan } from "@wringer/plan";
import { registerExperiment } from "@wringer/application";
import { readExperimentJson } from "../../packages/application/src/experiment-store";
import type { ExperimentPlanInput } from "../../packages/application/src/experiment-types";

const [indexPath, privateDirectory] = process.argv.slice(2);
if (!indexPath || !privateDirectory) throw new Error("Supply TASK_INDEX.json and an existing private 0700 experiment directory. See docs/native/EXPERIMENTS.md; no work was run.");
type Index = Omit<ExperimentPlanInput, "tasks"> & { tasks: { id: string; sourceTree: string; split: "development" | "held-out"; baselineFile: string; candidateFile: string }[] };
const index = await readExperimentJson<Index>(resolve(indexPath)), parent = dirname(resolve(indexPath));
const tasks = await Promise.all(index.tasks.map(async task => ({ id: task.id, sourceTree: task.sourceTree, split: task.split, baseline: validateExecutionPlan(await readExperimentJson(resolve(parent, task.baselineFile)), { credentialEnvironment: {} }), candidate: validateExecutionPlan(await readExperimentJson(resolve(parent, task.candidateFile)), { credentialEnvironment: {} }) })));
const registered = await registerExperiment(resolve(privateDirectory), { ...index, tasks });
console.log(JSON.stringify({ id: registered.plan.id, planSha256: registered.plan.sha256, registeredAt: registered.registeredAt, executionApproved: false, spendingStarted: false }, null, 2));
