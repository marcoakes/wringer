Wringer 1.0.0-alpha.47 opens the pull request. Until now a finished job's Send pushed a
branch and stopped there: someone still had to open the pull request and paste the
evidence in. Now the evidence rides the pull request itself.

**Choose a forge at setup.** Add `--forge github --forge-repo OWNER/NAME
--forge-token-env NAME` beside `--remote` and `--base` (or `--forge gitlab`, with
`--forge-endpoint URL` for a self-hosted GitLab). The preview says what Send will open
and which variable holds the token. Setup checks that the remote is that repository
and refuses a mismatch before anything is kept.

**Send opens it.** The page's Send pushes the branch and opens a pull request (GitHub)
or merge request (GitLab) whose description is the job's evidence, the delivery's
`mr.md`. Wringer looks for an existing request first, and the page links the one it
opened. An HTTPS remote is pushed with the same token.

**The token is never kept.** Wringer reads it from the named variable at Send, in the
terminal you ran `wring job open` from, and never stores or prints it. Without it,
Send is refused before anything is pushed, and the page names the variable. If the
branch went but the forge refused the request, for example a token that cannot open
pull requests, fix that and Send again: nothing new is pushed and only one request is
opened.

**A fix for GitHub fine-grained tokens.** With a `github_pat_…` token in a variable
whose name holds TOKEN, Wringer read the word "github" as part of a credential, so any
record naming GitHub was refused. Token prefixes like `github_pat_` and `glpat-` are
now treated as public, and the tokens themselves are still redacted.

**How it was tested.** A trusted-local job ran end to end against a local stand-in for
GitHub, its SSH remote reaching a local bare repository. Its pull request's description
was byte-for-byte the `mr.md` in a fresh clone of the pushed branch, that clone passed
its audit, and the token appeared in no record. Twenty-two guards were each undone
alone in a scratch copy, and each turned its test red. No published schema changed.

**Not measured:** a pull or merge request opened on GitHub or GitLab itself. Every
forge request in this release went to a local stand-in, and the HTTPS push credential
was checked through Git's credential protocol, not against a live server. A job run on
the published alpha.47. A trusted-local delivery is still named `contained-…` in its
records.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. GitHub publication does not itself
publish an npm package, Homebrew tap or MCP registry listing. The documented
cooperative-local operator boundary remains.

[Review a Wringer job](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.47/docs/START_PM.md)
· [Set up a job for a coding agent](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.47/docs/START_AGENT.md)
· [Previous release: source review on the job page](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.46)
