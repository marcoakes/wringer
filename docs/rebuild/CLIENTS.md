# Scoped client integration — engineering state

Measured 27 September 2026. Shared workflow:
`integrations/wringer/SKILL.md`. The distributed binary embeds its exact text
and the archive also carries the readable skill. No plugin installation or
client prompt is needed to apply the standalone skill/MCP package.

Preview `wring connect --workspace ID --client codex --scope project --json`,
then repeat the same selection with `--apply --expected DIGEST`. Use
`claude-code` for Claude Code; use `--scope user` deliberately for user scope.
The exact paths, current named entry (redacted), proposed named entry and file
identities are shown. A conflicting entry requires `--replace` in the preview.
Routine Codex tool approval is available only with explicit `--auto-approve`.
The Claude adapter leaves normal approval to the client. Neither changes global
shell/browser permissions, worker keys, operator authority or unrelated servers.

`--remove` previews removal of this workspace's unchanged owned server and skill;
repeat with `--apply --expected DIGEST` to remove them. Disconnect retains work
and does not stop it. A modified or foreign entry/skill is refused. The private
application transaction retains original bytes for interrupted-write recovery;
these backups can contain unrelated client settings and must never be exported
with diagnostics or published. Application state remains outside the repository.

`--verify-client` observes the selected executable's version. `--probe-tools`
starts the fixed Wringer STDIO bridge and sends initialization, tools/list and
read-only inspect_setup, then closes it. Start the workspace owner with `wring
job open` first. A dry run cannot execute either probe. Probing the bridge does
not establish named-client discovery or a completed human journey.

| Surface | Configuration/package | Discovery | Full live job |
| --- | --- | --- | --- |
| Codex CLI 0.153.4 on macOS arm64 | Actual CLI accepted generated command and arguments through explicit configuration overrides; project trust not measured | Real Wringer STDIO and owner fixture passed; discovery inside Codex unmeasured | Unmeasured; no model calls |
| Codex desktop | Documented scoped TOML and skill paths; deterministic install/remove fixtures | Unmeasured | Unmeasured |
| Claude Code | Documented scoped JSON and skill paths; deterministic install/remove fixtures; executable absent from PATH | Unmeasured | Unmeasured |
| Generic STDIO | Exact absolute argument-vector recipe | No additional named clients claimed | Unmeasured |

The formats follow [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)
and [Codex skill locations](https://learn.chatgpt.com/docs/customization/overview),
plus [Claude Code MCP scopes](https://code.claude.com/docs/en/mcp) and
[Claude skill packaging](https://code.claude.com/docs/en/skills), consulted on the
measurement date. Project trust, reload and managed policy remain client decisions.
No authentication or personal approval is inferred from configuration acceptance.

Evidence is in `evidence/m7/` and `evidence/m7-clients/`: red-first fixtures,
seven caught controlled reversions, actual CLI parser observation, skill-format
validation and a real no-model loopback/STDIO probe. A first probe teardown
attempt timed out; the corrected probe closes stdin and bounds forced cleanup.

Remaining integration validation: both-mode STDIO controls, compiled archive
installation, explicit custom config-root handling, interrupted-lock recovery
(M6), and real named-client discovery when those environments are available.
# Custom configuration roots

The managed adapters currently refuse a nondefault `CODEX_HOME` or
`CLAUDE_CONFIG_DIR`, including before preview. This prevents writes to unused
default locations. Use `wring connect --client generic --workspace ID` to obtain
the factual STDIO command for a custom client layout. No compatibility result is
implied by that recipe.
