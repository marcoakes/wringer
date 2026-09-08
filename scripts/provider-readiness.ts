import { inspectProviderReadiness, type ReadinessVendor } from "../packages/application/src/provider-readiness";

const vendor = process.argv[2];
if (process.argv.length !== 3 || !["openai", "anthropic", "all"].includes(vendor ?? "")) {
    console.error("Use: bun scripts/provider-readiness.ts openai|anthropic|all\nExplicitly reads existing credentials in memory and sends one metadata GET per vendor. No model prompts, key changes or response bodies.");
    process.exit(2);
}
const results = [];
for (const name of vendor === "all" ? ["openai", "anthropic"] : [vendor]) results.push(await inspectProviderReadiness(name as ReadinessVendor));
console.log(JSON.stringify({ schema_version: "wringer.provider-readiness-report.v1", results }, null, 2));
if (results.some(row => row.outcome !== "metadata-authenticated")) process.exitCode = 2;
