Wringer 1.0.0-alpha.43 fixes what the second beta gate run found. That run, on alpha.42
on 5 November 2026, failed both journeys at Install: the installer refused a computer
that had already run a job. On a separate installation, Claude Code and Codex then
passed every other step.
[The run's record](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.43/docs/adoption/evidence/alpha42/BETA_GATE_RUN2_2026-11-05.md).

**A computer that has run a job can install and upgrade again.** Each captured change
and playbook overlay was kept under two file names, and the installer refuses any
record with two names. Every release since alpha.20 did both. New records keep one
name, and the installer reads the pairs older releases left. A hold now names the
record it could not read, and gives a next step that fits it. CI's upgrade check now
upgrades each published release over a finished job's records.

**`wring job close` stops the page's owner.** `wring job open` leaves the owner running
in the background, and the installer's hold said to stop it without saying how.
`wring job close --workspace ID` stops it and keeps every job. It refuses while a job
is still working, and the hold now names it.

**Clearer IDs.** A new job's review branch is `wringer/job/<job ID>`, named after the
job you were given. The evidence report says which workspace ID is internal and which
one you connected.

**Codex trust is checked for the repository itself.** Codex ignored a project's
`.codex/config.toml` in a repository inside a trusted folder. `wring connect` now
warns unless the repository's own folder is trusted, and names both ways forward.

**A removed connection leaves nothing behind.** `wring connect … --remove` now says
what to do after a removal, removes a project configuration file left empty, and
removes the empty folders connect made. Your own user configuration file stays.

**How it was tested.** Each fix has a test that failed before it and passes after.
Sixteen guards were each removed alone in a scratch copy, and each turned its test red.
No schema changed.

**Not measured:** a live Codex or Claude Code journey on alpha.43. That is the beta
gate's third run. A trusted-local delivery is still named `contained-…` in its records.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. GitHub publication does not itself
publish an npm package, Homebrew tap or MCP registry listing. The documented
cooperative-local operator boundary remains.

[Start from your coding agent](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.43/docs/START_AGENT.md)
· [Trusted-local](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.43/docs/native/TRUSTED_LOCAL.md)
· [Previous release: what the first beta gate run found](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.42)
