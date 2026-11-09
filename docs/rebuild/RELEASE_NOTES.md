Wringer 1.0.0-alpha.44 fixes what an end-to-end review found at the doors. On
9 November 2026 the review walked both doors, the coding agent's and the person's, with
no model, and found dead ends and words that did not match what Wringer does. This
release adds no capability.

**A refusal names its fix.** Setting `WRINGER_HOME` or `--app-dir` to a folder others
can read was refused with `wring --help` as the only way out. The refusal now names the
folder and its mode, and the next step is `chmod 700 PATH`, or the default application
directory.

**Connection files stay out of your commits.** `wring connect --scope project` writes
`.mcp.json` and a skill folder into the repository, and both hold absolute paths to this
computer's Wringer and its owner. Preview and apply now say not to commit them. Apply
adds them to the clone's own `.git/info/exclude` when nothing ignores them, so
`git status` stays clean, and `--remove` takes those lines out again.

**A tenth of the tool list.** Every client session reads Wringer's MCP tool list. It was
166,286 bytes compact, 148,488 of them output schemas. The list now leaves output schemas
out, and the owner still checks every result against them: measured over stdio,
17,542 bytes for the same 16 tools.

**A stopped step says who retries it.** When a coding agent could not start, the page
said "retry the stopped step" without saying who could, and the assistant was told to
inspect, for the operator. When a retry is allowed, the assistant is now told to call
`wringer.continue`, with the action to send, and the page says "Ask your coding assistant
to retry the stopped step". A stop only you can act on says what to run.

**One job, one ID.** When your assistant recorded your request on a job `wring job new`
prepared, Wringer made a second record. `wring job open --job` then opened the old one,
and `wring job list` showed two jobs. The page, its decision link, `job list`,
`job status`, `job open` and the evidence report now all name the job by the ID you were
given. The later record is shown only as "request revision 2".

**Smaller fixes.** The setup preview shows the destination it will record. `wring demo`
now points at the two start pages, not the standalone route.

**Current coding-agent adapters.** New trusted-local profiles run
`claude-agent-acp` 0.101.1 and `codex-acp` 2.6.0, up from 0.65.0 and 1.10.0. Both
started and opened a session under `wring job check` with real logins, with no model
prompt; no live job has run on them yet. A profile set up earlier keeps its versions
until you run setup again.

**Measured for the next releases.** On `initialize`, Claude Code 2.1.317 asks for MCP
revision 2025-11-25 and Codex 0.153.4 for 2025-06-18; Wringer answers both. Claude Code
first sent `server/discover`, and fell back to `initialize` when Wringer refused it.
Nothing was built for it in this release.

**How it was tested.** Each fix has a test that failed before it and passes after.
Twenty-four guards were each undone alone in a scratch copy, and each turned its test red.
No schema changed.

**Not measured:** a live Codex or Claude Code journey on alpha.44. That is the beta
gate's third run. A trusted-local delivery is still named `contained-…` in its records.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. GitHub publication does not itself
publish an npm package, Homebrew tap or MCP registry listing. The documented
cooperative-local operator boundary remains.

[Start from your coding agent](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.44/docs/START_AGENT.md)
· [Trusted-local](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.44/docs/native/TRUSTED_LOCAL.md)
· [Previous release: what the second beta gate run found](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.43)
