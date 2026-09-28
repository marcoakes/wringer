import { runReversions } from "./rebuild-reversions";
const test = "packages/cli/test/delegation-owner.test.ts", file = "packages/cli/src/delegation-owner.ts";
await runReversions("m6-history-guards", [test], [
    { name: "history-never-starts-runner", file, before: 'const flow = createAssistantJobFlow(controller,', after: 'await controller.runner.start(); const flow = createAssistantJobFlow(controller,', test, pattern: "more than 128" },
    { name: "passive-cache-evicts-history", file, before: 'if (observations.size >= 64) observations.delete(observations.keys().next().value!);', after: 'if (observations.size >= 64) throw new Error("Historical owner reached its context bound");', test, pattern: "more than 128" },
]);
