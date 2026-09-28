import { runReversions } from "./rebuild-reversions";
const source = "packages/application/src/delegation-protocol.ts", test = "packages/application/test/delegation-protocol.test.ts", contract = "packages/mcp/test/delegation-contract.test.ts";
await runReversions("m4-protocol", [test, contract], [
    { name: "evidence-content-binding", file: source, before: "handle.contentIdentity !== args.contentIdentity", after: "false", test, pattern: "typed delegation protocol" },
    { name: "elapsed-clock-stability", file: source, before: "delete report.usage.development.measured.wallClock.elapsedSeconds", after: "void report.usage.development.measured.wallClock.elapsedSeconds", test, pattern: "stable across elapsed-clock" },
    { name: "operator-action-role", file: source, before: 'code: "approve", actor: "operator"', after: 'code: "approve", actor: "assistant"', test, pattern: "typed delegation protocol" },
    { name: "unknown-cost", file: source, before: "monetaryCost: null", after: "monetaryCost: 0", test, pattern: "typed delegation protocol" },
]);
