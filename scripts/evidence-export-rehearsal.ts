/** Native CLI export -> independent Node reader -> native semantic audit.
 * Scratch Git and deterministic role/verifier services; no model or provider. */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fixture } from "../packages/delivery/fixtures/contained";
import { deliverContained } from "../packages/delivery/src/contained";
import { processDriver } from "../packages/runtime/src";
const root = resolve(import.meta.dir, ".."), output = join(root, "build", `evidence-export-${crypto.randomUUID()}`);
await mkdir(output, { recursive: true });
const f = await fixture(false, false, false, 0, false, false, true), checks: string[] = [];
try {
    const prepared = await deliverContained({ stateDir: f.stateDir, publication: f.publication }), destination = join(f.root, "exported");
    const run = (args: string[]) => processDriver.command([join(root, "dist/wring"), ...args, "--json"], { timeoutMs: 60000 });
    const exported = await run(["bundle", "export", "--bundle", prepared.bundleDir, "--output", destination]);
    if (exported.code || JSON.parse(exported.stdout).source.commit !== prepared.codeCommit) throw new Error(`Native export failed: ${exported.stderr}`);
    checks.push("native export preserves exact candidate identity");
    const independent = await processDriver.command(["node", join(destination, "read-bundle.mjs"), destination], { timeoutMs: 30000 });
    const value = JSON.parse(independent.stdout);
    if (independent.code || value.integrity !== "passed" || value.semanticAudit !== "not-run" || value.source.commit !== prepared.codeCommit || !value.decisions.length) throw new Error("Independent reader did not establish the carried integrity and loop facts");
    checks.push("exported reader runs with Node built-ins and no Wringer dependency");
    const inspected = await run(["bundle", "inspect", "--bundle", destination]);
    if (inspected.code || JSON.parse(inspected.stdout).semanticAudit !== "passed") throw new Error("Native export semantic audit failed");
    checks.push("native semantic audit passes on the carried payload");
    await writeFile(join(destination, "evidence/summary.md"), "Injected corruption");
    if ((await run(["bundle", "inspect", "--bundle", destination])).code === 0) throw new Error("Corrupt exported bytes were accepted");
    checks.push("tampered payload refuses");
    await writeFile(join(output, "transcript.json"), JSON.stringify({ schema_version: "wringer.evidence-export-rehearsal.v1", fixture: true, providerCalls: 0, liveContainment: "unmeasured", status: "passed", checks, sourceCommit: prepared.codeCommit }, null, 2) + "\n");
    console.log(`${checks.length} packaged evidence-export checks passed: ${output}`);
} finally { await rm(f.root, { recursive: true, force: true }); }
