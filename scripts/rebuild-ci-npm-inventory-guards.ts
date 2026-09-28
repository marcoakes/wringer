import { runReversions } from "./rebuild-reversions";
const file = "scripts/npm-pack-inventory.ts", test = "packages/cli/test/release-channels.test.ts", pattern = "actual npm tarball agrees";
await runReversions("ci-npm-inventory-guards", [test], [
    { name: "redacted-display-paths", file, test, pattern, before: "entries = readReleaseArchive(bytes)", after: 'entries = readReleaseArchive(bytes).map(entry => ({ ...entry, path: entry.path.replace(/54127b7f-b29f-44d4-b8a7-82b8ce9ad6b9/g, "***") }))' },
    { name: "missing-or-extra-files", file, test, pattern, before: "JSON.stringify(entries.map(entry => entry.path).sort()) !== JSON.stringify(expected)", after: "false" },
    { name: "nonregular-entry", file, test, pattern, before: 'entries.some(entry => entry.kind !== "file")', after: "false" },
    { name: "content-hash", file, test, pattern, before: "distributionHash(entry.data) !== file.sha256", after: "false" },
    { name: "executable-mode", file, test, pattern, before: "!!(entry.mode & 0o111) !== file.executable", after: "false" },
    { name: "package-metadata", file, test, pattern, before: "for (const file of files)", after: 'for (const file of files.filter(file => file.path !== "package.json"))' },
    { name: "inventory-metadata", file, test, pattern, before: "for (const file of files)", after: 'for (const file of files.filter(file => file.path !== "dist/PACKAGE-CONTENTS.json"))' },
]);
