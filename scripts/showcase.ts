/** The reproducible showcase (bun run build && bun scripts/showcase.ts): four compiled
 * public journeys that together carry a graph, all candidate and integration
 * evidence, a restart, a source-bound review and delivery, an offline audit and a
 * future-improvement proposal with its comparison results. It writes
 * docs/showcase/showcase.json with machine paths removed. Every journey uses a
 * separately compiled fixture binary for role replies or verifiers, so the showcase
 * demonstrates the mechanism, never live agent behaviour. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const journeys = [
    { id: "parallel-integration", script: "scripts/graph-parallel-distribution.ts", demonstrates: ["a version 2 graph", "integration evidence re-checked against every branch plan", "a restart: a crash after the first branch result, reconciled without repeating work", "a source-bound review decision and an explicit Send", "a fresh-clone offline audit with Node alone", "a refused edited export"] },
    { id: "tournament", script: "scripts/graph-tournament-distribution.ts", demonstrates: ["all candidate evidence: eligibility, challenges validated on a trusted control, replays on every attempt and the selection", "a spurious challenge dropped and a hard-coded attempt disqualified", "a restart after the attempts finished", "delivery of the selected attempt and a fresh-clone offline audit"] },
    { id: "future-improvement", script: "scripts/gate-experiment-distribution.ts", demonstrates: ["a future-improvement proposal: a stronger gate registered with a prediction, evaluated on held-out items against a frozen oracle, qualified, prepared as a reviewable change, sent to a review branch and adopted for future plans only", "a weakened gate that looks greener refused by the same comparison"] },
    { id: "external-task", script: "scripts/graph-delegate-distribution.ts", demonstrates: ["the public binary as an A2A 1.0 client to a local reference peer", "a changed Agent Card refused before sending", "a returned patch verified afresh before review and delivery"] },
];
const results = [];
for (const journey of journeys) {
    const started = Date.now(), child = Bun.spawn([process.execPath, journey.script], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exit !== 0) throw new Error(`Showcase journey ${journey.id} failed:\n${(out + err).slice(-2000)}`);
    const directory = /passed: (\S+)/.exec(out)?.[1] ?? /fixture passed: (\S+)/.exec(out)?.[1];
    if (!directory) throw new Error(`Showcase journey ${journey.id} did not name its record`);
    const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8")), transcript = JSON.parse(await readFile(join(directory, "transcript.json"), "utf8"));
    const scrub = (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll(directory, "[journey]").replaceAll(root, "[checkout]"));
    results.push({ ...journey, status: result.status, seconds: Math.round((Date.now() - started) / 1000), stages: transcript.map((row: any) => ({ label: row.label, exit: row.exit })), result: scrub(result) });
    console.log(`${journey.id}: ${result.status} (${transcript.length} stages)`);
}
const record = { schema_version: "wringer.showcase.v1", generatedAt: new Date().toISOString(), version: (await Bun.file(join(root, "package.json")).json()).version, reproduce: "bun run build && bun scripts/showcase.ts", journeys: results,
    notDemonstrated: ["live agent behaviour or convergence", "real containment of these runs", "a real A2A peer", "independent human acceptance", "any comparative benefit"],
    note: "Commits, times and digests differ between runs because every journey builds fresh fixture repositories; the stages and outcomes are what reproduce." };
await mkdir(join(root, "docs/showcase"), { recursive: true });
await writeFile(join(root, "docs/showcase/showcase.json"), JSON.stringify(record, null, 2) + "\n");
console.log(`Showcase passed: ${results.length} journeys, ${results.reduce((sum, row) => sum + row.stages.length, 0)} stages. Wrote docs/showcase/showcase.json.`);
