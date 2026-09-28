# Support

Start with `wring --version`, the job's compact status and the exact error.
Use [recovery](docs/MIGRATION.md) for retained/uncertain work, and
[compatibility](docs/ASSISTANT_COMPATIBILITY.md) for current platform/client limits.

For a reproducible non-sensitive bug, open a
[GitHub issue](https://github.com/marcoakes/wringer/issues/new/choose) with version,
platform, selected mode, expected/observed behavior, minimal reproduction and
sanitized evidence. Mark fixture results, actual platforms and live clients
separately. Include exit 3 or 4 rather than describing every nonzero exit as a
failed check. Do not publish connection records, private page URLs, provider logs,
credentials or private source. Diagnostic exports are previewed explicitly with
`wring diagnostics --workspace ID`; inspect the result before sharing.

Use [SECURITY.md](SECURITY.md) for a vulnerability. There is no hosted service,
response-time guarantee or support entitlement implied by this prerelease.
