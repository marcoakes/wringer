import { runReversions } from "./rebuild-reversions";
await runReversions("m3-model", ["packages/acp/test/acp.test.ts", "packages/runtime/test/model-launch.test.ts", "packages/runtime/test/runtime.test.ts", "packages/application/test/runtime-provisioning.test.ts"], [
    { name: "explicit-model-required", file: "packages/acp/src/client.ts", before: "if (options.model !== undefined)", after: "if (false)", test: "packages/acp/test/acp.test.ts", pattern: "explicit model selection" },
    { name: "model-response-confirmation", file: "packages/acp/src/client.ts", before: "returned.length !== 1 || returned[0].currentValue !== options.model", after: "false", test: "packages/acp/test/acp.test.ts", pattern: "explicit model selection" },
    { name: "role-model-forwarding", file: "packages/runtime/src/execute.ts", before: "...(explicitModel ? { model: explicitModel } : {}),", after: "", test: "packages/runtime/test/runtime.test.ts", pattern: "pinned model launcher" },
    { name: "launcher-no-default", file: "runtime/model-launch.ts", before: "args.length !== 2 ||", after: "", test: "packages/runtime/test/model-launch.test.ts", pattern: "explicit provider" },
]);
