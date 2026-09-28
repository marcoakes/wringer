import { runReversions } from "./rebuild-reversions";
const file = "packages/application/src/acceptance-preparation.ts", test = "packages/application/test/acceptance-preparation.test.ts", mapping = "packages/application/src/proposal-composition.ts";
await runReversions("m3-acceptance", [test, "packages/runtime/test/assertion-adapter.test.ts", "packages/cli/test/client-adapters.test.ts"], [
    { name: "inert-path-boundary", file, before: "!pathOkay(file.path)", after: "false", test, pattern: "refuses traversal" },
    { name: "exact-preparation-decision", file, before: "decision.expectedIdentity !== preview.identity", after: "false", test, pattern: "refuses traversal" },
    { name: "complete-preview-binding", file, before: "hashValue(current) !== hashValue(preview)", after: "false", test, pattern: "refuses traversal" },
    { name: "protected-assertion-mapping", file: mapping, before: 'pinned.evidence && hashValue([...pinned.criteria].sort()) !== hashValue([...proposed.criteria].sort())', after: "false", test, pattern: "reviewed inert" },
    { name: "assertion-evidence-preserved", file: "packages/application/src/delegation-profile.ts", before: '...(gate.evidence ? { evidence: { kind: "assertions", format: "wringer-check.v1" } } : {})', after: "...({})", test, pattern: "reviewed inert" },
    { name: "custom-client-root", file: "packages/cli/src/client-adapters.ts", before: 'custom && resolve(custom) !== join(homedir(), selection.client === "codex" ? ".codex" : ".claude")', after: "false", test: "packages/cli/test/client-adapters.test.ts", pattern: "custom client" },
    { name: "registered-node-tests", file: "runtime/assertion-adapter.ts", before: 'input.adapter === "node-test" && !/^# wringer-node-registration-v1: complete$/m.test(result.stdout)', after: "false", test: "packages/runtime/test/assertion-adapter.test.ts", pattern: "contained assertion adapter" },
    { name: "empty-file-summary", file: "runtime/node-reporter.mjs", before: 'const incomplete = !reportedFiles.size || [...reportedFiles].some(file => !summaries.has(file) || summaries.get(file).tests < 1);', after: "const incomplete = false;", test: "packages/runtime/test/assertion-adapter.test.ts", pattern: "contained assertion adapter" },
]);
