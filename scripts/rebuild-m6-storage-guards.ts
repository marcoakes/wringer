import { runReversions } from "./rebuild-reversions";
const test = "packages/application/test/storage.test.ts", file = "packages/application/src/storage.ts";
await runReversions("m6-storage-guards", [test], [
    { name: "exact-selected-archive", file, before: 'if (current.preview.identity !== expected) throw new Error("Preparation archive preview changed");', after: 'expected = current.preview.identity;', test, pattern: "archives only an exact" },
    { name: "keep-completed-preparations", file, before: 'if (await assistantExists(root, `${path}/${selected.kind === "acceptance" ? "result.json" : "profile-record.json"}`))', after: 'if (false)', test, pattern: "archives only an exact" },
    { name: "keep-live-preparations", file, before: 'process.kill(owner.pid, 0); throw new Error("Preparation owner is live; no active outputs can be archived");', after: 'process.kill(owner.pid, 0);', test, pattern: "refuses a live" },
    { name: "exact-selected-removal", file, before: 'if (preview.identity !== expected) throw new Error("Removal preview changed");', after: 'expected = preview.identity;', test, pattern: "archives only an exact" },
]);
