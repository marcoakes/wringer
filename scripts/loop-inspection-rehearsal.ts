/** Packaged read-only loop inspection against deterministic contained fixtures.
 * This never calls a model, runs a fleet or claims live containment. */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fixture } from "../packages/workflow/fixtures/loop-engineering";
import { runContainedJourney } from "../packages/workflow/src/contained";
import { readLoopInspection } from "../packages/application/src/loop-inspection";
import { hashValue } from "../packages/plan/src";
import { processDriver } from "../packages/runtime/src";

const root = resolve(import.meta.dir, ".."), output = join(root, "build", `loop-inspection-${crypto.randomUUID()}`);
await mkdir(output, { recursive: true });
const scenarios = [
    { name: "success", settings: {}, actions: ["continue"], status: "review-ready" },
    { name: "failed-repair", settings: { failedCandidates: 1 }, actions: ["continue", "continue"], status: "review-ready" },
    { name: "repeat-stop", settings: { failedCandidates: 8, trees: ["b".repeat(40), "c".repeat(40), "b".repeat(40)] }, actions: ["continue", "continue", "stop"], status: "stopped" },
    { name: "outcome-warning", settings: { failedCandidates: 3 }, actions: ["continue", "continue", "warn", "continue"], status: "review-ready" },
    { name: "interrupted-resume", settings: { failedCandidates: 1 }, actions: ["continue"], status: "stopped" },
];
const observations: unknown[] = [];
for (const scenario of scenarios) {
    const f = await fixture(scenario.settings);
    try {
        let dispatchedWorkers = 0;
        if (scenario.name === "interrupted-resume") {
            const execute = f.options.executeRole!;
            f.options.executeRole = async request => {
                if (request.role === "worker" && ++dispatchedWorkers === 2) throw new Error("Synthetic lost response after possible spend");
                return execute(request);
            };
        }
        await runContainedJourney(f.options);
        if (scenario.name === "interrupted-resume") {
            await runContainedJourney(f.options);
            if (dispatchedWorkers !== 2) throw new Error("Resume redispatched an uncertain worker");
        }
        const expected = await readLoopInspection(f.options.plan, f.options.controllerDir), before = f.counts();
        const result = await processDriver.command([join(root, "dist/wringer-drive"), "loop", "--state", f.options.controllerDir, "--json"], { timeoutMs: 30000 });
        if (result.code !== 0) throw new Error(`Packaged ${scenario.name}: ${result.stderr}`);
        const observed = JSON.parse(result.stdout);
        if (hashValue(observed) !== hashValue(expected) || hashValue(before) !== hashValue(f.counts()) || observed.status !== scenario.status || JSON.stringify(observed.decisions.map((row: any) => row.action)) !== JSON.stringify(scenario.actions)) throw new Error(`Packaged loop projection differs: ${scenario.name}`);
        await writeFile(join(output, `${scenario.name}.json`), JSON.stringify({ fixture: true, projection: observed }, null, 2) + "\n");
        observations.push({ scenario: scenario.name, status: "passed", snapshotSha256: hashValue(observed), outcome: observed.status, reservedSessions: observed.budget.sessions.reserved, unresolvedSessions: observed.budget.unresolvedSessions });
        console.log(`${scenario.name}: passed`);
    } finally { await rm(f.options.controllerDir, { recursive: true, force: true }); }
}
await writeFile(join(output, "transcript.json"), JSON.stringify({ schema_version: "wringer.loop-inspection-rehearsal.v1", fixture: true, providerCalls: 0, liveContainment: "unmeasured", observations }, null, 2) + "\n");
console.log(`Packaged loop-inspection evidence: ${output}`);
