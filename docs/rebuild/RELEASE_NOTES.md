Wringer 1.0.0-alpha.34 lets a person delegate work without a container: the
worker and judge are their own Claude Code or Codex, run on this computer in
fresh temporary clones. Any of eight named MCP clients can connect, and none is a
default.

```sh
wring setup --repo /absolute/project --client claude-code --mode delegation \
  --runtime trusted-local --worker-adapter claude-agent-acp --judge-adapter claude-agent-acp \
  --source local --dependencies none --dry-run --json
```

**Trusted-local is explicit and stamped.** A plan declares it (execution plan
v5); it is never a fallback for a missing container. Each role runs through a
pinned ACP adapter (`@agentclientprotocol/claude-agent-acp@0.65.0` or
`@agentclientprotocol/codex-acp@1.10.0`) in its own fresh clone of the approved
commit, with a short fixed environment. The worker's change is captured as a
patch and the clone removed; your working copy is not touched. Checks run in
another fresh clone, pinned check inputs are compared before any check runs, and
the approved scope is enforced at review. Every role and check record, the
delivery manifest, summary and merge-request text carry one sentence: "Ran on
this computer under the operator's account; nothing was contained." Network
deny/allowlist, images and resource limits are refused for it, not recorded as
enforced. Protected mode, falsification and design inputs refuse it. Its records
are new siblings (`wringer.runtime.v3`, `wringer.environment-map.v3`), so no
reader can mistake one for a contained run.

**Clients are named, not assumed.** `wring connect --client` takes claude-code,
codex, cursor, gemini-cli, generic, kimi, vscode or windsurf. Each recipe was
checked against its client's official documentation on 2026-10-01; Windsurf's
could not be verified, so it gets only the generic stanza. Claude Code and Codex
entries are applied with review; the others are printed. The MCP server now
tells a connected agent the loop and the three decisions that stay with the
person, and to give them each decision link exactly, once.

**Rehearsed before release.** The trusted-local journey was run from source with
the real Codex adapter. A scripted MCP client played the agent. Claude, as the
delegated tester, approved and sent from the job page. The run went from approval
to review-ready in about 90 seconds and ended in a passing fresh-clone audit. It
found eight defects, all fixed and tested here. The Send page now shows what
changed, and it no longer says a result was accepted when nobody reviewed it. A
stopped role now says why, and for an expired login how to sign in. Three frozen
contracts gained trusted-local siblings (`assistant-response-v3`,
`delegation-setup-v2`, `proposal-supersession-v2`).

Also: the README is one screen with two doors, for coding agents and for product
managers. Installs no longer contain the repository's maintainer instructions
(`AGENTS.md`). `wring init` proposes Gradle, Maven, .NET, Swift and Elixir tests.
Root-level history moved to `docs/archive`.

Tested on deterministic fixtures: a trusted-local job through the real assistant
service, from MCP proposal to approval, fresh-clone worker, judge and checks,
review, Send to a local bare origin and an offline audit of a fresh clone, with
fixture ACP agents and no model. Not yet measured: a live journey with real
Claude Code or Codex adapters, which is the gate for 1.0.0-beta.1.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. GitHub publication does not itself
publish an npm package, Homebrew tap or MCP registry listing. The documented
cooperative-local operator boundary remains.

[Trusted-local](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.34/docs/native/TRUSTED_LOCAL.md)
· [Clients](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.34/docs/ASSISTANT_COMPATIBILITY.md)
· [Previous release: a second durable runtime, Temporal](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.33)
