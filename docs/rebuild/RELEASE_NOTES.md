Wringer 1.0.0-alpha.45 fixes what the first real change through it found. On 9 November
2026, Wringer carried a real multi-file feature for the first time: per-team routing
precision and recall for ZenJev's evaluation lab, on an npm repository, with live
coding agents and an independent judge. The change was sent, and it passed an audit
from a fresh clone. It stopped four times on the way.
[The run's record](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.45/docs/adoption/evidence/alpha45/REAL_CHANGE_ZENJEV_2026-11-09.md).

**npm projects can run jobs.** Setup offered only `none` or Bun for dependencies, so an
npm project's checks ran without its packages. `--dependencies npm-ci` installs them
from the committed lockfile in each fresh clone, with install scripts off.

**Ignored folders no longer break capture.** ZenJev keeps tracked files inside folders
its `.gitignore` ignores, and Git refuses `add -A` on those. Wringer's capture and
delivery both used it, so every attempt failed. Tracked changes are now staged with
`add -u`.

**A stuck job is no longer stuck.** That failure came after a paid agent session, and
Wringer recorded it as uncertain. Then nothing could retry it or recover it, and
`wring job close` refused forever, which would have held every later install. A
finished session whose change cannot be kept is now a stop your coding assistant can
retry. `wring job close` waits only for work that is still live.

**Preparing a handover can be retried.** Source-history review rightly stopped on a
fake key in ZenJev's redaction test. That stop was recorded as uncertain, though
preparing sends nothing, so the page would not prepare again. Now the page offers
"Retry handover preparation".

**What was delivered.** Four files, +47 −4: a new `src/domain/routing.ts`, its use in
the lab's evaluation, a per-team table and a confusion table in the lab, and their
styles. ZenJev's own lint, typecheck and 90 domain, provider and GitLab tests pass on it.
Claude ran it acting for Marc; no independent human approved or reviewed it.

**How it was tested.** Each fix has a test that failed before it and passes after.
Eleven guards were each undone alone in a scratch copy, and each turned its test red.
No schema changed.

**Not measured:** a job on the published alpha.45, and a contained capture failure,
which is still recorded uncertain. A trusted-local delivery is still named
`contained-…` in its records.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. GitHub publication does not itself
publish an npm package, Homebrew tap or MCP registry listing. The documented
cooperative-local operator boundary remains.

[The first real change](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.45/docs/adoption/evidence/alpha45/REAL_CHANGE_ZENJEV_2026-11-09.md)
· [Trusted-local](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.45/docs/native/TRUSTED_LOCAL.md)
· [Previous release: the doors, honestly](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.44)
