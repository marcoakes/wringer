import { runReversions } from "./rebuild-reversions";
const test = "packages/cli/test/client-adapters.test.ts", file = "packages/cli/src/client-adapters.ts", old = "packages/cli/test/assistant-cli.test.ts";
await runReversions("m7-clients", [test, old], [
    { name: "preserve-other-settings", file, before: 'expected[key] = { ...map };', after: 'expected[key] = {};', test, pattern: "scoped Claude JSON" },
    { name: "duplicate-client-keys", file, before: 'parseMcpJson(text || "{}")', after: 'JSON.parse(text || "{}")', test, pattern: "scoped Claude JSON" },
    { name: "exact-preview", file, before: 'if (plan.publicValue.identity !== expected)', after: 'if (false)', test, pattern: "connection preview, exact apply" },
    { name: "retained-ownership", file, before: 'if ((latest ? hashValue(latest) : null) !== plan.next.previous && hashValue(latest) !== hashValue(plan.next))', after: 'if (false)', test, pattern: "advanced ownership" },
    { name: "owned-removal", file, before: 'if (selected.remove && (!owned || previous.workspaceId !== selected.workspaceId))', after: 'if (false)', test, pattern: "installation resumes" },
    { name: "explicit-routine-approval", file, before: '...(selected.autoApprove ? { default_tools_approval_mode: "auto" } : {})', after: '...({ default_tools_approval_mode: "auto" })', test, pattern: "connection preview, exact apply" },
    { name: "legacy-routine-approval", file: "packages/cli/src/assistant-cli.ts", before: '# default_tools_approval_mode = "auto"', after: 'default_tools_approval_mode = "auto"', test: old, pattern: "Codex recipe" },
]);
