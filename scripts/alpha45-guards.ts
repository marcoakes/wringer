/** Isolated reversions of what the first real change through Wringer found (alpha.45): ZenJev,
 * 2026-11-09, docs/adoption/evidence/alpha45/REAL_CHANGE_ZENJEV_2026-11-09.md. Each repair is undone
 * alone in a scratch copy, and the test that names it must turn red. Nothing here runs an agent or
 * a model. */
import { runReversions } from "./rebuild-reversions";
const profile = "packages/application/test/delegation-profile.test.ts", runtime = "packages/runtime/test/trusted-local.test.ts", contained = "packages/runtime/test/runtime.test.ts";
const delivery = "packages/delivery/test/delivery.test.ts", journey = "packages/application/test/trusted-local-journey.test.ts", close = "packages/cli/test/gate-run2.test.ts";
const local = "packages/runtime/src/trusted-local.ts", profileSource = "packages/application/src/delegation-profile.ts";
await runReversions("alpha45-guards", [profile, runtime, contained, delivery, journey, close, "packages/application/test/commands-delivery.test.ts"], [
    // An npm repository could not run a job at all: its checks had no node_modules.
    { name: "npm-mode-refused", file: profileSource, before: 'if (!["none", "bun-frozen", "npm-ci"].includes(selection.dependencies))', after: 'if (!["none", "bun-frozen"].includes(selection.dependencies))', test: profile, pattern: "npm project prepares" },
    { name: "npm-setup-missing", file: profileSource, before: ': selection.dependencies === "npm-ci" ? [{ id: "dependencies", argv: ["npm", "ci",', after: ': false ? [{ id: "dependencies", argv: ["npm", "ci",', test: profile, pattern: "npm project prepares" },
    { name: "npm-lockfile-unchecked", file: profileSource, before: 'if (selection.dependencies === "npm-ci" && (!(tracked.has("package-lock.json")', after: 'if (false && (!(tracked.has("package-lock.json")', test: profile, pattern: "npm project prepares" },
    // A tracked file inside an ignored folder made Git refuse every capture and delivery.
    { name: "trusted-local-capture-adds-tracked", file: local, before: '["ls-files", "--others", "--exclude-standard", "-z", "--", ".", ...excluded]', after: '["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ".", ...excluded]', test: runtime, pattern: "tracks a file inside an ignored folder" },
    { name: "contained-capture-adds-tracked", file: "packages/runtime/src/execute.ts", before: "ls-files --others --exclude-standard -z -- . ${excludeOutputs}", after: "ls-files --cached --others --exclude-standard -z -- . ${excludeOutputs}", test: contained, pattern: "tracks a file inside an ignored folder" },
    { name: "delivery-adds-tracked", file: "packages/delivery/src/deliver.ts", before: 'await git(repo, ["add", "-u", "--pathspec-from-file=-", "--pathspec-file-nul"], { env, input: pathspecs(tracked) });', after: 'await git(repo, ["add", "--all", "--pathspec-from-file=-", "--pathspec-file-nul"], { env, input: pathspecs(tracked) });', test: delivery, pattern: "tracks a file inside an ignored folder" },
    // A completed, charged session whose change could not be kept became an uncertain effect nothing could retry.
    { name: "capture-failure-uncertain", file: local, before: 'if (!(error instanceof RuntimeError) || error.code !== "workspace-git-failed") throw error;', after: "throw error;", test: journey, pattern: "cannot keep" },
    { name: "capture-stop-unexplained", file: "packages/workflow/src/worker-outcome.ts", before: 'if (reason === "change-capture-failed" || reason === "change-refused-credential") {', after: "if (false) {", test: journey, pattern: "cannot keep" },
    { name: "credential-uncertain", file: local, before: 'if (input.redact(patch) !== patch) return { ...result, status: "failed", stopReason: "change-refused-credential",', after: 'if (input.redact(patch) !== patch) throw new RuntimeError("Worker patch contains a credential", "secret-in-change"); if (false) return { ...result, status: "failed", stopReason: "change-refused-credential",', test: runtime, pattern: "looks like it holds a credential" },
    // A stop while preparing the handover, which sends nothing, was recorded uncertain and could not be retried.
    { name: "preparation-refusal-uncertain", file: "packages/application/src/commands.ts", before: 'status: began && command.action !== "prepare-delivery" ? "uncertain" : "failed"', after: 'status: began ? "uncertain" : "failed"', test: "packages/application/test/commands-delivery.test.ts", pattern: "refused handover preparation" },
    // ...and an owner that could never be closed.
    { name: "close-held-by-recorded-step", file: "packages/cli/src/owner-close.ts", before: 'if (live.some(operation => operation.status === "uncertain")) return "uncertain";', after: 'if (true) return "uncertain";', test: close, pattern: "only a live or uncertain operation" },
], { baseline: "11f895c370b166147fd6aae61e94e69d4b1c0c4f" });
