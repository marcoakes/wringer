import { runReversions } from "./rebuild-reversions";
const file = "scripts/rehearsal-capture.ts", test = "packages/cli/test/rehearsal-capture.test.ts";
await runReversions("ci-capture-guards", [test], [
    { name: "unbounded-capture-steps", file, before: "timer = setTimeout(() => reject(new Error(`no result within ${stepMs} ms`)), stepMs);", after: "", test, pattern: "hung" },
    { name: "unbounded-context-close", file, before: 'await step("close", close);', after: "await close();", test, pattern: "hung close" },
    { name: "set-content-default-timeout", file, before: '{ waitUntil: "load", timeout }', after: '{ waitUntil: "load" }', test, pattern: "explicit" },
    { name: "screenshot-default-timeout", file, before: 'animations: "disabled", timeout }', after: 'animations: "disabled" }', test, pattern: "explicit" },
    { name: "unrecorded-failing-step", file, before: "await record({ capture: label, failedStep", after: "void ({ capture: label, failedStep", test, pattern: "hung" },
], { baseline: "115bda843cac92a792ea467b9c18c02dd7229048" });
