Wringer 1.0.0-alpha.47 opens the pull request, and decides source review on the job page.
It follows alpha.45: alpha.46 was tagged but never published, and everything in it is
here too.

**The evidence rides the pull request.** Until now a finished job's Send pushed a branch
and stopped there; someone still had to open the pull request and paste the evidence
in. Add `--forge github --forge-repo OWNER/NAME --forge-token-env NAME` beside
`--remote` and `--base` at setup (or `--forge gitlab`, with `--forge-endpoint URL` for a
self-hosted GitLab). The preview says what Send will open and which variable holds the
token, and setup refuses a forge that is not the remote's repository. Send then pushes
the branch and opens a pull request (GitHub) or merge request (GitLab) whose
description is the job's evidence, the delivery's `mr.md`, after looking for an
existing one. The page links it. An HTTPS remote is pushed with the same token.

**The token is never kept.** Wringer reads it from the named variable at Send, in the
terminal you ran `wring job open` from, and never stores or prints it. Without it, Send
is refused before anything is pushed, and the page names the variable. If the branch
went but the forge refused the request, for example a token that cannot open pull
requests, fix that and Send again: nothing new is pushed and only one request is opened.

**Decide source review on the page.** Before sending, Wringer checks the history a
change would carry for text shaped like a key or token. In the first real change it
rightly stopped on a fake key in the repository's own redaction test, and getting past
it took an internal command and a hand-written private file. Now the job page lists
each match by file and kind, never by value. Give each one your reason when it is a
test value or an example, and say whether you are the person or a coding agent acting
for them; one button records the decisions and prepares the handover again. There is
no approve-all. If a match is a real credential, do not send. When a later job finds
the same exact bytes, the page shows your earlier reason for you to confirm; it is
never applied by itself.

**A fix for GitHub fine-grained tokens.** With a `github_pat_…` token in a variable
whose name holds TOKEN, Wringer read the word "github" as part of a credential, so any
record naming GitHub was refused. Token prefixes like `github_pat_` and `glpat-` are
now treated as public, and the tokens themselves are still redacted.

**Proved on a real change, and by fixtures.** The second real change through Wringer,
a CSV export for ZenJev's evaluation lab, had Codex as the worker and Claude as an
independent judge. It hit the source-review stop and cleared it on the page in about 30
seconds, was sent, passed an audit from a fresh clone, and passes ZenJev's own lint,
typecheck and 94 tests.
[The run's record](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.47/docs/adoption/evidence/alpha46/REAL_CHANGE_2_ZENJEV_2026-11-09.md).
Claude ran it acting for Marc; no independent human approved or reviewed it. Opening
the pull request was proved with a trusted-local job against a local stand-in for
GitHub: its description was byte-for-byte the `mr.md` in a fresh clone of the pushed
branch, that clone passed its audit, and the token appeared in no record. Twenty-two
guards for this release and six for source review were each undone alone in a scratch
copy, and each turned its test red. No published schema changed.

**Not measured:** a pull or merge request opened on GitHub or GitLab itself; every
forge request went to a local stand-in, and the HTTPS push credential was checked
through Git's credential protocol, not against a live server. An earlier source-review
decision offered again in a live job. A job run on the published alpha.47. A
trusted-local delivery is still named `contained-…` in its records.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. GitHub publication does not itself
publish an npm package, Homebrew tap or MCP registry listing. The documented
cooperative-local operator boundary remains.

[Review a Wringer job](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.47/docs/START_PM.md)
· [Set up a job for a coding agent](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.47/docs/START_AGENT.md)
· [The second real change](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.47/docs/adoption/evidence/alpha46/REAL_CHANGE_2_ZENJEV_2026-11-09.md)
· [Previous release: what the first real change found](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.45)
