import { expect, test } from "bun:test";
import * as application from "../src";
test("T21 readiness requires exact image inventory, every safety row and confirmed cleanup; provider work remains unknown", () => {
    const inspect = (application as any).validateRuntimeReadiness; expect(typeof inspect).toBe("function");
    const image = `fixture/image@sha256:${"a".repeat(64)}`, inventory = { node: "24.19.0", bun: "1.4.2", lock: "b".repeat(64), modelLauncher: "c".repeat(64), packages: { "@agentclientprotocol/codex-acp": "1.10.0", "@agentclientprotocol/claude-agent-acp": "0.65.0", "@openai/codex": "0.153.4", "@anthropic-ai/claude-agent-sdk": "0.3.220" } };
    const rows = ["worker-scope-and-protected-metadata", "peer-source-and-private-storage", "host-filesystem-separation", "host-sentinel-unchanged", "resource-policy", "network-deny", "no-model-acp-session", "cancellation"].map(id => ({ id, status: "pass", detail: {} }));
    for (let n = 0; n < 5; n++) rows.push({ id: `cleanup-fixture-${n}`, status: "pass", detail: { runtimeId: `fixture-${n}`, absentFromSuccessfulPlatformListing: true } });
    const report = { schema_version: "wringer.live-runtime-smoke.v1", status: "pass", runtime: { kind: "gvisor-kubernetes", image }, modelPromptsSent: 0, providerCredentialsForwarded: false, providerAuthenticationMeasured: false, rows: [...rows, { id: "runtime-inventory", status: "pass", detail: inventory }] };
    expect(inspect(report, image)).toEqual(inventory);
    expect(() => inspect(report, `fixture/other@sha256:${"d".repeat(64)}`)).toThrow("image");
    expect(() => inspect({ ...report, rows: report.rows.filter(row => row.id !== "network-deny") }, image)).toThrow("measurement");
    expect(() => inspect({ ...report, rows: report.rows.filter(row => row.id !== "cleanup-fixture-1") }, image)).toThrow("cleanup");
    expect(() => inspect({ ...report, rows: [...rows, { id: "runtime-inventory", status: "pass", detail: { ...inventory, bun: "0.0.0" } }] }, image)).toThrow("inventory");
});
