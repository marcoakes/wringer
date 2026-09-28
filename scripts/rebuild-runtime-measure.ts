/** Read-only host and public metadata measurements. No provisioning, login, ACP
 * connection, or model prompt. Every run retains a new observation file. */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inspectRuntime, resolveOfficialBase } from "../packages/runtime/src";
const root = resolve(import.meta.dir, ".."), directory = join(root, "docs/rebuild/evidence/m3");
await mkdir(directory, { recursive: true });
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--platform" || !["linux/arm64", "linux/amd64"].includes(args[1]!))) throw new Error("Use --platform linux/arm64 or linux/amd64 to inspect public metadata for one architecture");
const at = new Date().toISOString(), platform = (args[1] ?? (process.arch === "arm64" ? "linux/arm64" : "linux/amd64")) as "linux/arm64" | "linux/amd64";
const results = await Promise.allSettled([inspectRuntime({ kind: process.platform === "darwin" ? "apple-container" : "gvisor-kubernetes" }), resolveOfficialBase("bun", platform), resolveOfficialBase("node", platform)]);
const observations = results.map((row, index) => ({ id: ["host", "bun-base", "node-base"][index], ...(row.status === "fulfilled" ? { status: "observed", value: row.value } : { status: "unavailable", reason: row.reason instanceof Error ? row.reason.message : "Measurement unavailable" }) }));
const path = join(directory, `runtime-inspection-${at.replaceAll(":", "-")}.json`);
await writeFile(path, JSON.stringify({ at, kind: "Read-only measurement; zero model prompts; no service started", observations }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ path, observations }, null, 2));
if (results.some(row => row.status === "rejected")) process.exitCode = 2;
