import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { parseSmokeProfile } from "../../../scripts/runtime-smoke";
import { fixtureResponse } from "../../../runtime/smoke-acp";
import { probeAcpSession } from "@wringer/acp";
import { connectProcess } from "../src/driver";
import { appleContainerIds } from "../src/adapters";

// A syntactically valid fixture digest is only parser input, never a live image.
const profile = () => ({ runtime: { kind: "apple-container", image: "example.invalid/synthetic@sha256:" + "a".repeat(64), cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [] }, networkProbe: { address: "192.0.2.10", port: 4321 } });
const script = resolve(import.meta.dir, "../../../runtime/smoke-acp.ts");
test("live smoke requires explicit digest, deny, zero credentials, and a unicast control", () => {
  expect(parseSmokeProfile(profile()).timeoutMs).toBe(180000);
  expect(() => parseSmokeProfile({ ...profile(), ignored: true })).toThrow("Unknown");
  expect(() => parseSmokeProfile({ ...profile(), runtime: { ...profile().runtime, image: "oven/bun:1.4.2" } })).toThrow();
  expect(() => parseSmokeProfile({ ...profile(), runtime: { ...profile().runtime, env: ["CODEX_API_KEY"] } })).toThrow("zero credential");
  expect(() => parseSmokeProfile({ ...profile(), runtime: { ...profile().runtime, network: { policy: "allowlist", allow: [{ cidr: "192.0.2.10/32", ports: [4321] }] } } })).toThrow("network deny");
  for (const address of ["127.0.0.1", "::1", "224.0.0.1", "0.0.0.0", "hostname.invalid"]) expect(() => parseSmokeProfile({ ...profile(), networkProbe: { address, port: 4321 } })).toThrow();
  expect(() => parseSmokeProfile({ ...profile(), timeoutMs: 600001 })).toThrow();
});
test("deterministic image ACP fixture refuses every model prompt", () => {
  expect(fixtureResponse({ id: 1, method: "session/prompt", params: { prompt: [] } })).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "This smoke fixture refuses every model prompt" } });
  expect(fixtureResponse({ method: "session/cancel" })).toBeUndefined();
});
test("Apple cleanup never treats an unfamiliar listing schema as absence", () => {
  expect(appleContainerIds([])).toEqual([]);
  expect(appleContainerIds([{ configuration: { id: "one" } }, { id: "two" }])).toEqual(["one", "two"]);
  for (const value of [{}, null, [null], [{}], [{ name: "still-running" }], [{ id: "one", configuration: { id: "another" } }]]) expect(() => appleContainerIds(value)).toThrow();
});
test("real Bun subprocess negotiates fixture without a coding prompt", async () => {
  const result = await probeAcpSession(connectProcess([process.execPath, script]), { role: "judge", cwd: "/workspace/repo", timeoutMs: 3000 });
  expect(result.status).toBe("completed");
  expect(result.agentInfo?.name).toBe("wringer-no-model-fixture");
  expect(result.promptSent).toBe(false);
  expect(result.providerCredentialValidated).toBe(false);
  expect(result.authentication.sessionOpened).toBe(true);
});
test("real fixture protocol cancellation is bounded", async () => {
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 100);
  try {
    const result = await probeAcpSession(connectProcess([process.execPath, script, "--stall-initialize"]), { role: "judge", cwd: "/workspace/repo", timeoutMs: 3000, signal: abort.signal });
    expect(result.stopReason).toBe("cancelled");
    expect(result.promptSent).toBe(false);
  } finally { clearTimeout(timer); }
});
