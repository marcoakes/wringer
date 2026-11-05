/** Isolated reversions of what beta gate run 2 found (alpha.43): each fix is undone alone in a
 * scratch copy, and the test that names it must turn red. Findings in
 * docs/adoption/evidence/alpha42/BETA_GATE_RUN2_2026-11-05.md. The guard that would let
 * `wring job close` signal a process that is not the owner is not reverted here: undone, the
 * test's own process would be the one signalled. Its test still runs. Nothing here runs an
 * agent, a model or a browser. */
import { runReversions } from "./rebuild-reversions";
const overlay = "packages/runtime/test/overlay.test.ts", installer = "packages/cli/test/installer.test.ts", door = "packages/cli/test/gate-run2.test.ts", clients = "packages/cli/test/client-adapters.test.ts";
const installation = "packages/cli/src/installation.ts", close = "packages/cli/src/owner-close.ts", adapters = "packages/cli/src/client-adapters.ts", cli = "packages/cli/src/adoption-cli.ts";
await runReversions("gate-run2", [overlay, installer, door, clients], [
    // F10: a finished job left one record under two names, and the installer refused it.
    { name: "capture-pending-kept", file: "packages/runtime/src/source.ts", before: "try { await link(pending, recordPath); await unlink(pending); }", after: "try { await link(pending, recordPath); }", test: overlay, pattern: "each kept under one name" },
    { name: "overlay-pending-kept", file: "packages/runtime/src/overlay.ts", before: "try { await link(pending, recordPath); await unlink(pending); } catch", after: "try { await link(pending, recordPath); } catch", test: overlay, pattern: "each kept under one name" },
    { name: "retained-pair-refused", file: installation, before: "await ownedFile(full, 2 * 1024 * 1024, await retainedPair(full, s))", after: "await ownedFile(full)", test: installer, pattern: "a computer that has run a job installs" },
    { name: "pair-any-second-name", file: installation, before: "return names === 1 ? { dev: info.dev, ino: info.ino } : undefined;", after: "return { dev: info.dev, ino: info.ino };", test: installer, pattern: "a computer that has run a job installs" },
    { name: "hold-unnamed", file: installation, before: "held.push(`unreadable-state-record:${relative(root, full)}`)", after: 'held.push("unreadable-state-record")', test: installer, pattern: "a computer that has run a job installs" },
    { name: "unreadable-generic-next", file: installation, before: 'const prefixes = ["target-lacks-compatible-record:", "disconnect-client:", "unreadable-state-record:"]', after: 'const prefixes = ["target-lacks-compatible-record:", "disconnect-client:"]', test: installer, pattern: "a computer that has run a job installs" },
    // F12: nothing closed an owner, and the hold did not say how.
    { name: "owner-unnamed", file: installation, before: 'if (dirname(path) === join(root, "owners")) owners.add(basename(path));', after: "", test: installer, pattern: "a computer that has run a job installs" },
    { name: "close-command-missing", file: cli, before: 'if (verb === "close") {', after: 'if (verb === "close-unrouted") {', test: door, pattern: "job close stops the owner" },
    { name: "close-ignores-working", file: close, before: "if (first) return { exit: 3,", after: "if (false) return { exit: 3,", test: door, pattern: "job close stops the owner" },
    // F11: internal IDs reached the person.
    { name: "branch-preparation-id", file: "packages/application/src/delegation-jobs.ts", before: 'sourceBranch: "wringer/job", targetBranch', after: "sourceBranch: `wringer/job-${id}`, targetBranch", test: door, pattern: "review branch is named after the job" },
    { name: "evidence-unexplained", file: "packages/application/src/delegation-protocol.ts", before: "...identities }, handover", after: "}, handover", test: door, pattern: "review branch is named after the job" },
    { name: "owner-omits-workspace", file: "packages/cli/src/delegation-owner.ts", before: "createDelegationProtocol(controller, { workspaceId })", after: "createDelegationProtocol(controller)", test: door, pattern: "review branch is named after the job" },
    // F13: a trusted folder above the repository was counted, and Codex ignored the entry.
    { name: "trust-ancestor", file: adapters, before: "resolve(path) === resolve(selected.repo)", after: '(selected.repo === path || selected.repo.startsWith(path.endsWith("/") ? path : path + "/"))', test: clients, pattern: "a Codex project entry that Codex would not use" },
    // F14: a removal printed connect's next step and left what connect made.
    { name: "removal-next-is-connect", file: cli, before: "const next = !input.remove ?", after: "const next = true ?", test: door, pattern: "removing a connection removes what connect made" },
    { name: "removal-keeps-empty-config", file: adapters, before: 'const configAfter = selected.remove && selected.scope === "project" && emptyConfiguration(selected.client, after) ? null : after;', after: "const configAfter = after;", test: door, pattern: "removing a connection removes what connect made" },
    { name: "removal-keeps-folders", file: adapters, before: "for (const path of folders) await removeEmptyDirectory(path);", after: "", test: door, pattern: "removing a connection removes what connect made" },
], { baseline: "32c78ab2456315670a3e54136792647e3c8bcb83" });
