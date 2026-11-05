Wringer 1.0.0-alpha.42 fixes what the first beta gate run found. That run, on alpha.41
on 3 and 4 November 2026, failed the Codex journey at Install and at Ask. Both are fixed,
and so are the run's seven other findings.
[The run's record](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.42/docs/adoption/evidence/alpha41/BETA_GATE_RUN1_2026-11-04.md).

**Upgrades work again.** Upgrading to alpha.41 was held from 13 of the 15 earlier
published releases, alpha.23 to alpha.36. The installer compared every file under
`schema/` byte for byte, including the index of frozen schemas, which grows whenever a
schema is added. Now only the schema files themselves decide, and a held upgrade names
the way out instead of `wring --help`. CI now installs every published release with its
own installer and upgrades it to each new build, on Linux and macOS.

**`codex exec` can record a proposal.** Codex asks before each Wringer tool that records
something, and `codex exec` cannot answer, so it refused the call.
`wring connect --client codex --auto-approve` wrote `"auto"`, under which Codex 0.153.4
still asks. It now writes `"approve"`, for the `wringer` server only. The connect preview
and the guides say when you need it.

**Your prepared job is found.** A job `wring job new` prepared read as questions for you,
and Codex proposed a second job beside it. Its status now says it is prepared and that
the assistant records your request on it. `job new` prints a sentence naming the job to
give your assistant, and the assistant's instructions say to look for it.

**The page opens in any browser.** `wring job open --print` prints the private link
instead of opening your default browser. Anyone who opens it can act as you on the page,
so keep it to yourself.

**Clearer review.** Each check now says how it ran on the approved source before the
work, beside its result, and the commit and its source tree are labelled. A trusted-local
audit is headed "Trusted-local delivery audit". The delivery's recorded name is
unchanged, because frozen records name it. The workflow skill no longer calls
trusted-local work contained, and the agent guide says approval starts the work by itself.

**How it was tested.** Each fix has a test that failed before it and passes after.
Fourteen guards for this run's findings, and five for the upgrade fix, were each removed
alone in a scratch copy, and each turned its test red. No schema changed.

**Not measured:** a live Codex or Claude Code journey on alpha.42. That is the beta gate's
second run.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. GitHub publication does not itself
publish an npm package, Homebrew tap or MCP registry listing. The documented
cooperative-local operator boundary remains.

[Start from your coding agent](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.42/docs/START_AGENT.md)
· [Trusted-local](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.42/docs/native/TRUSTED_LOCAL.md)
· [Previous release: Send answers in seconds](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.41)
