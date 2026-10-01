# Wringer

![Wringer](docs/banner.webp)

**Keep your AI coding app. Wringer runs the approved work, checks it with checks
that could have failed, keeps the human decisions human, and hands over evidence
anyone can audit.**

```text
request → approved plan → worker → protected checks → independent judge
        → your review → separate Send → evidence a fresh clone can audit
```

## Two doors

- **Coding agents start here: [docs/START_AGENT.md](docs/START_AGENT.md).**
  Connect over MCP, propose a plan, and give the person the decision link.
- **Product managers start here: [docs/START_PM.md](docs/START_PM.md).**
  Three decisions stay yours: approve the plan, accept the result, Send it.

Setting it up for others: [docs/START_OPERATOR.md](docs/START_OPERATOR.md).

## Install

Archives for macOS arm64 and Linux x64 are on
[GitHub Releases](https://github.com/marcoakes/wringer/releases), with a reviewed
installer in [INSTALL.md](INSTALL.md). Windows is not supported, and there is no
npm or Homebrew package yet. Try the labelled simulation first; it uses no model
and no account:

```sh
wring demo --json
```

## Where the work runs

- **Trusted-local:** the worker and judge are your own Claude Code or Codex
  login, run on this computer in fresh temporary clones. Nothing is contained,
  and every record says so. [How it works](docs/native/TRUSTED_LOCAL.md).
- **Contained:** Apple Container or gVisor on Kubernetes isolate each role.
  Protected work needs this.

## Limits

This is an engineering prerelease. What has been measured, and what has not, is
in [EVIDENCE.md](EVIDENCE.md). [What Wringer does](docs/OVERVIEW.md) covers
graphs, parallel branches, tournaments and measured improvements. Read the
[security boundary](SECURITY.md) before using valuable source or credentials.

[Support](SUPPORT.md) · [Contributing](CONTRIBUTING.md) · [Apache-2.0](LICENSE)

Created and directed by [Marc Oakes](https://github.com/marcoakes).
