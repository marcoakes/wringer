# Wringer

![Wringer](docs/banner.webp)

Check your coding agent's changes, or delegate a bounded job. Wringer keeps the
request, source, checks, review and handover together so another checkout can
inspect what happened.

- **Check existing work:** keep Claude Code, Codex or another coding assistant.
  Wringer runs reviewed repository checks locally. No worker account, image or
  extra model call is needed. These commands have your host permissions.
- **Delegate work:** select worker and judge models explicitly, provision Apple
  Container or gVisor Kubernetes, and approve a finite job. Missing containment
  stops delegation. Model/provider billing is separate from the assistant chat.

Start with [installation](INSTALL.md), then try the labelled, no-model simulation:

```sh
wring demo --json
wring setup --repo /absolute/path/to/project --client codex --mode verification --dry-run --json
```

Inspect the proposed changes, apply the selected setup, and use
`wring job new` and `wring job open` to review a job. The
[local bug-fix example](examples/adoption/local-fix/README.md) includes a failing
check, a correction and source-bound evidence. [Agent](docs/START_AGENT.md),
[PM](docs/START_PM.md) and [operator](docs/START_OPERATOR.md) guides describe the
next steps. [CLI reference](docs/CLI.md) lists the actual commands.

**Adoption prerelease.** Native archives are published through
[GitHub Releases](https://github.com/marcoakes/wringer/releases). Each release
requires green native macOS arm64 and Linux x64 CI, including extracted archive
and installer checks; inspect its attached claim reports for measured coverage.
Windows is not a release target. Claude Code and Codex scoped adapters are implemented; complete
live journeys and Codex desktop remain unmeasured. See
[compatibility](docs/ASSISTANT_COMPATIBILITY.md) and [evidence](EVIDENCE.md).

Approval, result acceptance and Send are separate. The local review page uses
cooperative trust: another unrestricted process under your OS identity could
impersonate its operator. Protected mode remains unavailable. Read the
[security boundary](SECURITY.md) before using valuable source or credentials.

[Support](SUPPORT.md) · [Contributing](CONTRIBUTING.md) · [Apache-2.0](LICENSE)

Created and directed by [Marc Oakes](https://github.com/marcoakes).
