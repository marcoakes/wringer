import { lstat, readFile } from "node:fs/promises";
import { hashValue } from "@wringer/plan";
import { assistantId, assistantPath, readAssistantRecord } from "./assistant-store";
export const REQUIRED_RUNTIME_MEASUREMENTS = ["worker-scope-and-protected-metadata", "peer-source-and-private-storage", "host-filesystem-separation", "host-sentinel-unchanged", "resource-policy", "network-deny", "no-model-acp-session", "cancellation", "runtime-inventory"];
export function validateRuntimeReadiness(report: any, image: string) {
    if (report?.schema_version !== "wringer.live-runtime-smoke.v1" || report.status !== "pass" || report.runtime?.image !== image || report.modelPromptsSent !== 0 || report.providerCredentialsForwarded !== false || report.providerAuthenticationMeasured !== false) throw new Error("Readiness must name the exact image and its completed no-model measurement");
    if (!Array.isArray(report.rows) || report.rows.length > 256 || new Set(report.rows.map((row: any) => row.id)).size !== report.rows.length || report.rows.some((row: any) => row.status !== "pass") || REQUIRED_RUNTIME_MEASUREMENTS.some(id => !report.rows.some((row: any) => row.id === id))) throw new Error("Required runtime measurement is missing or inconclusive");
    if (report.rows.filter((row: any) => row.id.startsWith("cleanup-") && row.detail?.absentFromSuccessfulPlatformListing === true && row.id === `cleanup-${row.detail.runtimeId}`).length < 5) throw new Error("Runtime cleanup is not confirmed for every required instance");
    const inventory = report.rows.find((row: any) => row.id === "runtime-inventory").detail;
    if (inventory?.bun !== "1.4.2" || !/^24\.[0-9]+\.[0-9]+$/.test(inventory.node) || !/^[a-f0-9]{64}$/.test(inventory.lock) || !/^[a-f0-9]{64}$/.test(inventory.modelLauncher) || inventory.packages?.["@agentclientprotocol/codex-acp"] !== "1.10.0" || inventory.packages?.["@agentclientprotocol/claude-agent-acp"] !== "0.65.0" || inventory.packages?.["@openai/codex"] !== "0.153.4" || inventory.packages?.["@anthropic-ai/claude-agent-sdk"] !== "0.3.220") throw new Error("Runtime inventory differs from the selected catalogue");
    return inventory as { node: string; bun: string; lock: string; modelLauncher: string; packages: Record<string, string> };
}
export async function readRuntimeReadiness(root: string, provisionId: string, readinessId: string, image: string) {
    assistantId(provisionId); assistantId(readinessId);
    const record = await readAssistantRecord<any>(root, `provisions/${provisionId}/readiness/${readinessId}.json`);
    if (record.schema_version !== "wringer.runtime-readiness.v1" || record.provisionId !== provisionId || record.id !== readinessId || record.image !== image || record.reportPath !== `readiness-${readinessId}/report.json`) throw new Error("Readiness record does not bind this provisioned image");
    const path = await assistantPath(root, `provisions/${provisionId}/${record.reportPath}`), info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || info.size > 2 * 1024 ** 2) throw new Error("Readiness report is not a bounded owned regular file");
    const report = JSON.parse(await readFile(path, "utf8")); if (hashValue(report) !== record.reportSha256) throw new Error("Retained readiness evidence changed");
    const inventory = validateRuntimeReadiness(report, image);
    if (hashValue(inventory) !== hashValue(record.inventory)) throw new Error("The retained inventory differs from its actual measurement");
    return { inventory, report, id: readinessId, measuredAt: record.measuredAt };
}
