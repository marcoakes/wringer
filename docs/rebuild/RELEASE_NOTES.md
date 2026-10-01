Wringer 1.0.0-alpha.35 makes sure a Codex connection is one Codex will actually
use. It is the release the 1.0.0-beta.1 gate runs on.

Preparing that gate on the published alpha.34 found that `wring connect --client
codex --scope project` could report success while Codex ignored the entry. On
Codex 0.153.4, a server named `wringer` in your user `~/.codex/config.toml` is
used instead of the project's. A project's `.codex/config.toml` is read only in
a folder you have trusted. The test machine had an old user-level entry from an
earlier blind test, so Codex would have talked to a controller that no longer
existed.

Now the connection preview names any existing user-level `wringer` entry and the
command it runs, and applying refuses until you remove it (`codex mcp remove
wringer`, after inspecting it) or connect with `--scope user --replace`. A folder
you have not trusted is flagged before anything is written.

Also: stopping the job page's flow now waits for a sweep already in flight, so
it makes no status read after stop. That race failed one of alpha.34's release
builds before an unchanged re-run passed.

Everything in [alpha.34](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.34)
is unchanged: the explicit trusted-local runtime, client recipes for eight named
MCP clients, the Send page that shows what changed, and the evidence that says
when nothing was contained.

Not yet measured: a live journey with Claude Code or Codex as the client. That
is the beta gate. It is run by Claude as the person under Marc's delegation, so
a pass will be a delegated AI tester's, not an independent person's.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. GitHub publication does not itself
publish an npm package, Homebrew tap or MCP registry listing. The documented
cooperative-local operator boundary remains.

[Trusted-local](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.35/docs/native/TRUSTED_LOCAL.md)
· [Clients](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.35/docs/ASSISTANT_COMPATIBILITY.md)
· [Beta gate](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.35/docs/adoption/BETA_GATE.md)
· [Previous release: delegate on this computer](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.34)
