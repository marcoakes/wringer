import { runReversions } from "./rebuild-reversions";
const test = "packages/cli/test/delegation-owner.test.ts", file = "packages/cli/src/delegation-owner.ts";
await runReversions("m6-owner-write-guards", [test], [
    { name: "incomplete-context-does-not-poison-history", file, before: '} catch { activationErrors.set(name.slice(0, -5), "context-preparation-incomplete-inspect-retained-records"); }', after: '} catch (error) { throw error; }', test, pattern: "registered delegation" },
    { name: "track-before-connection-write", file, before: '        created.push(path);\n        try { await writeFile(file, contents); await file.sync(); }', after: '        try { await writeFile(file, contents); created.push(path); await file.sync(); }', test, pattern: "partial owned" },
]);
