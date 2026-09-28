import { runReversions, type Reversion } from "./rebuild-reversions";
const file = "packages/application/src/workspaces.ts", test = "packages/application/test/workspace-snapshot.test.ts";
const cases: Reversion[] = [
    { name: "reject-unused-driver", file, before: "if (filters.timed_out || ![0, 1].includes(filters.exit_code))", after: "if (filters.stdout.trim() || filters.timed_out || ![0, 1].includes(filters.exit_code))", test, pattern: "unused inherited" },
    { name: "allow-active-filter", file, before: 'if (fields.some((value, index) => index % 3 === 2 && value !== "unspecified" && value !== "unset"))', after: "if (false)", test, pattern: "active Git filters" },
    { name: "omit-untracked-filter-path", file, before: '["ls-files", "--cached", "--others", "--exclude-standard", "-z"]', after: '["ls-files", "--cached", "-z"]', test, pattern: "untracked files" },
    { name: "ignore-worktree-attributes", file, before: '["check-attr", "-z", "--stdin", "filter"]', after: '["check-attr", "--cached", "-z", "--stdin", "filter"]', test, pattern: "worktree attributes" },
    { name: "drop-attribute-input", file: "packages/engine/src/git.ts", before: "maxBytes: 20 * 1024 * 1024, input, redactor:", after: "maxBytes: 20 * 1024 * 1024, redactor:", test, pattern: "unused inherited" },
];
await runReversions("ci-filter-guards", [test], cases);
