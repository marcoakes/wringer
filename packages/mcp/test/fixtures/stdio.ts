import { runMcpStdio } from "../../src/server";

// Real-process protocol fixture only: no controller, providers or execution authority.
await runMcpStdio({ version: "protocol-fixture", call: (name, args) => ({ schema_version: "fixture.protocol.v1", outcome: "recorded", name, jobId: args.jobId ?? null, providerCalls: 0 }) });
