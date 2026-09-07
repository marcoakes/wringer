/** Deterministic protocol fixture only: no provider, network, tools, or prompts. */
import { createInterface } from "node:readline";

export function fixtureResponse(message: any): Record<string, unknown> | undefined {
  if (message.id === undefined) return undefined;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result });
  switch (message.method) {
    case "initialize":
      return reply({ protocolVersion: 1, agentInfo: { name: "wringer-no-model-fixture", version: "1" }, agentCapabilities: { sessionCapabilities: { close: {} } }, authMethods: [] });
    case "session/new": return reply({ sessionId: "fixture-only-no-provider" });
    case "session/close": return reply({});
    default: return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: message.method === "session/prompt" ? "This smoke fixture refuses every model prompt" : "Unsupported fixture method" } };
  }
}

if (import.meta.main) {
  const stall = process.argv.includes("--stall-initialize");
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    try {
      const message = JSON.parse(line);
      if (stall && message.method === "initialize") continue;
      const response = fixtureResponse(message);
      if (response) process.stdout.write(JSON.stringify(response) + "\n");
    } catch { process.stderr.write("Malformed fixture request\n"); process.exitCode = 2; }
  }
}
