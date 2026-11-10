Wringer 1.0.0-alpha.46 moves source-history review onto the job page. Before sending, Wringer
checks the history a change would carry for text shaped like a key or token. In the
first real change, on 9 November 2026, it rightly stopped on a fake key in the
repository's own redaction test. Getting past it took an internal command, a controller
path and a hand-written private file, and every later job on that repository would
stop the same way.

**Decide on the page.** The job page lists each match by file and kind, never by value.
Give each one your reason when it is a test value or an example, and say whether you
are the person or a coding agent acting for them. One button records the decisions and
prepares the handover again. There is no approve-all. If a match is a real credential,
do not send: remove it from the history first.

**Your earlier decision comes back.** Decisions are kept per workspace. When a later job
finds the same exact bytes, the page shows your earlier reason, who gave it and when,
for you to confirm. It is never applied by itself.

**Proved on a real change.** The second real change through Wringer, a CSV export for
ZenJev's evaluation lab, had Codex as the worker and Claude as an independent judge from
another vendor. It hit the same stop and cleared it on the page in about 30 seconds.
It was then sent, passed an audit from a fresh clone, and passes ZenJev's own lint,
typecheck and 94 tests.
[The run's record](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.46/docs/adoption/evidence/alpha46/REAL_CHANGE_2_ZENJEV_2026-11-09.md).
Claude ran it acting for Marc; no independent human approved or reviewed it.

**How it was tested.** Six guards were each undone alone in a scratch copy, and each
turned its test red. No schema changed.

**Not measured:** a job on the published alpha.46; an earlier decision offered again
in a live job. The second run's matches had no earlier page decisions to offer. A
trusted-local delivery is still named `contained-…` in its records.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. GitHub publication does not itself
publish an npm package, Homebrew tap or MCP registry listing. The documented
cooperative-local operator boundary remains.

[Review a Wringer job](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.46/docs/START_PM.md)
· [The second real change](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.46/docs/adoption/evidence/alpha46/REAL_CHANGE_2_ZENJEV_2026-11-09.md)
· [Previous release: what the first real change found](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.45)
