# Trusted-local: delegate on this computer

A contained job needs Apple Container or gVisor on Kubernetes, an image pinned by
digest and measured tool versions. A **trusted-local** job needs none of them.
The worker and judge are your own coding agents, Claude Code or Codex, started
through their ACP adapters on this computer under your account. It was added in
1.0.0-alpha.34 (ruling R-1, 2026-10-01) so a person can try delegation in
minutes, and it says what it is everywhere:

> Ran on this computer under the operator's account; nothing was contained.

That sentence is in every role and check record, the delivery manifest, the
summary and the merge-request text.

## What it does

- **Each role gets a fresh temporary clone** of the exact approved commit. The
  worker's change is captured as a patch against that commit and the clone is
  removed. Your working copy is never touched.
- **Checks run in another fresh clone** of the candidate. Pinned check inputs are
  compared with the approved source before any check runs, and a check that
  changes the source is reported.
- **The approved scope is enforced at review.** A change outside the writable
  paths is refused before it can become a candidate.
- **The agents see a short, fixed environment:** `PATH`, `HOME`, `USER`,
  `LOGNAME`, `SHELL`, `LANG`, `LC_*`, `TERM` and `TMPDIR`, plus any name the plan
  declares. Git, Node and Bun control variables, SSH agents and Kubernetes
  configuration are not passed.
- **The human decisions are unchanged.** Approval, result review and Send are
  separate, source-bound decisions on the job page. The agent cannot make them.
- **Delivery and audit work as for contained jobs.** A fresh clone of the review
  branch can audit the bundle offline.

## What it does not do

- **Nothing is isolated.** The agents run as ordinary processes with your
  permissions. They can read your files, use your network and use any login your
  account holds. The network policy is recorded as `unenforced`; `deny` and
  `allowlist` are refused, not pretended.
- **Protected mode refuses it**, and so do falsification (it needs an isolated
  verifier) and design references.
- **It is never a fallback.** A contained plan that cannot get its container
  stops. Trusted-local is only used when the profile declares it.
- **Model usage is billed by your coding agent's own plan**, not reserved or
  counted by Wringer. Session and turn limits still apply.

Use it on repositories and machines where you would let your coding agent work
unattended anyway.

## Set it up

You need Git and either Claude Code or Codex, signed in. The adapters are
fetched by `npx` at fixed versions: `@agentclientprotocol/claude-agent-acp@0.65.0`
and `@agentclientprotocol/codex-acp@1.10.0`.

```sh
wring setup --repo /absolute/project --client claude-code --mode delegation \
  --runtime trusted-local --worker-adapter claude-agent-acp --judge-adapter claude-agent-acp \
  --source local --dependencies none --dry-run --json
```

Review the profile it prints: the adapters, the checks, the writable paths and
the limits. Keep it by repeating the same command with
`--apply --expected IDENTITY --actor NAME --cooperative-local`. Then create a
job and connect your client:

```sh
wring job new --workspace WORKSPACE_ID --intent 'The original request'
wring connect --workspace WORKSPACE_ID --client claude-code --scope project --dry-run --json
```

If a coding agent's login has expired, the job stops before any change and says
so: sign in with that agent's own login (Claude Code: run `claude` and use
`/login`; Codex: `codex login`) and ask your assistant to retry the stopped step.

With Codex, a project's `.codex/config.toml` is read only in a folder you have
trusted, and a server named `wringer` in your user configuration is used instead
of the project's. `wring connect` says so before writing anything and refuses the
second case: remove the old entry after inspecting it (`codex mcp remove
wringer`), or connect with `--scope user --replace`.

Any named client works (`claude-code`, `codex`, `cursor`, `gemini-cli`,
`generic`, `kimi`, `vscode`, `windsurf`); none is a default. The worker and judge
adapters are chosen separately from the client you talk to.

## Records

A trusted-local plan is `wringer.execution-plan.v5`; it exists only to name this
runtime. Its role and check records are `wringer.runtime.v3`, and its environment
map is `wringer.environment-map.v3`. They are siblings of the contained records,
never written under the contained versions, so an old reader cannot mistake one
for a contained run. Its MCP answers use `wringer.assistant-response.v3` and
`wringer.delegation-setup.v2`, and a revised proposal is recorded as
`wringer.proposal-supersession.v2`: siblings that admit the trusted-local
boundary and plan. Contained workspaces keep the earlier versions.

Graphs, experiments and playbook proposals still name contained plans only.
