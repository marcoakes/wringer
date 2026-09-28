# Start with Claude Code, Codex or generic STDIO

Install the candidate using [INSTALL](../INSTALL.md). Choose verification when
your existing coding assistant will make the change. Choose delegation when
Wringer should assign a bounded contained worker/judge job. Switching modes is a
new setup decision. No provider/model is chosen implicitly.

For a repository whose checks you trust, inspect first:

```sh
wring setup --repo /absolute/project --client codex --mode verification --dry-run --json
wring setup --repo /absolute/project --client codex --mode verification --apply
```

Use `claude-code` for Claude Code or `generic` for an explicit STDIO recipe.
Inspect the proposed files and check definitions before apply. Missing meaningful
checks remain incomplete; use the [local example](../examples/adoption/local-fix/README.md)
to see a real red/green check. Setup approves no work. Copy the returned workspace
ID, then:

```sh
wring job new --workspace WORKSPACE_ID --intent 'The original request' --json
wring job open --workspace WORKSPACE_ID --job JOB_ID
wring connect --workspace WORKSPACE_ID --client codex --scope project --dry-run --json
```

Review the exact changed files and tool allowlist. Repeat connect with
`--apply --expected IDENTITY`. The default does not relax client tool prompts.
`--auto-approve` is an explicit option for only the mode's routine MCP tools;
there are no MCP approval/verdict/Send tools. `--verify-client` reads the client
version; `--probe-tools` performs a no-model STDIO discovery against the owner.
Neither proves a full named-client journey. See [compatibility](ASSISTANT_COMPATIBILITY.md).

After client trust/reload, ask it to use the Wringer skill and preserve your
original words. Use the operator page for approval, actual result review,
correction and separate Send. The page shows fixed limits and operating mode.
A scripted engineering click must not be presented as your judgment.

For generic clients, inspect `connect --client generic`: configure the exact
absolute `wring mcp --connection PATH` recipe. Keep the private connection file
in application state; do not paste its contents into a prompt or repository.

A stopped owner needs [explicit recovery](MIGRATION.md). Open the same workspace
again and reconnect; do not repropose an uncertain job. For a second request,
`wring job new` captures new source while retaining earlier records. Use `--parent`
for a successor correction/renewal; each new job still needs approval.

Contained work uses [the bounded feature example](../examples/adoption/contained-feature/README.md)
and [operator setup](START_OPERATOR.md). Provider spending and actual platform
containment are separate prerequisites.
