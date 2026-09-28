# Install Wringer

Download an exact adoption prerelease from
[GitHub Releases](https://github.com/marcoakes/wringer/releases). A version is
available only after its native validation and release workflow succeed; inspect
the attached manifest, checksums and claim reports. Public npm packages,
Homebrew taps and registry listings remain separate, pending channels.

## Native archive and reviewed installer

Targets are macOS arm64 and Linux x64. Each release requires both native CI jobs.
Windows and other architectures are not supported
artifacts. Native `wring` needs neither Bun nor Node; repository checks still
need their own declared tools. Git is required for source identity and delivery.

A candidate directory contains the archive, flat bootstrap executable, exact
SHA-256 sidecars, manifest and inventory. The first installer is a readable shell
script, [packaging/install.sh](packaging/install.sh). Inspect it, then run:

```sh
sh packaging/install.sh --release VERSION --from /absolute/candidate-directory --download-to /absolute/new-download-directory
```

Replace `VERSION` with the exact candidate version. Use canonical absolute paths
(the installer refuses symlink aliases). Review the JSON: owned paths, digest,
source identity, state restrictions and proposed switch. Repeat the same command
with `--apply --expected IDENTITY_FROM_PREVIEW`. Downloads stay in the selected
directory; a partial download needs inspection and a fresh directory.

For a published release, omitting `--from` downloads that exact
version from `marcoakes/wringer` GitHub Releases over HTTPS. It never selects
`latest`. Same-origin checksum files detect corruption; they are not an
independent signature. For attested CI artifacts, additionally verify the
archive with `gh attestation verify ARCHIVE -R marcoakes/wringer` and inspect
its source/workflow identity before executing it.

The default private prefix is `~/Library/Application Support/WringerInstall` on
macOS, or `~/.local/share/wringer-install` on Linux. Invoke `PREFIX/bin/wring` or
add that directory to your own PATH. The installer changes no shell profile and
uses no sudo. `--prefix` selects another owned installation; `--app-dir` selects
the separate application state used for migration checks. Start with:

```sh
wring --version
wring demo --json
wring setup --help
```

Do not run the downloaded flat file from an unverified directory. Manual archive
extraction bypasses the managed install/rollback lifecycle; prefer the installer.

## npm, Homebrew and MCP registry

The machinery is implemented; the public namespace and publications are pending.
There is deliberately no invented `npm install` package name or `brew install`
tap. Maintainers generate an exact scope only after an ownership observation;
see [channel procedures](docs/RELEASE_CHANNELS.md).

The npm channel needs Node >=22.14 and installs exact-version native packages.
It has no postinstall script or execution-time download. Its launcher refuses
an absent native package or altered binary. Homebrew uses the same archive
checksums. The MCP listing describes local STDIO and requires prior setup plus a
running operator owner; it does not offer a hosted service.

## Connect your coding client

Follow [START_AGENT](docs/START_AGENT.md). `connect` previews a scoped entry and
workflow skill, preserves unrelated settings, and applies only its exact
identity. Client trust, reload and login remain client/operator actions.
No connection file contains provider keys or an operator bootstrap URL.

## Application state and removal

Workspace/job/controller state lives outside repositories in a user-owned app
directory (`~/Library/Application Support/Wringer` on macOS; see the exact
reported location on other hosts). `WRINGER_HOME` or `--app-dir` overrides it.
Repository `.wringer/` evidence remains beside source. Keep both for recovery.
[Upgrade, rollback and migration](docs/MIGRATION.md) explains retained versions,
uncertain work, client removal and default evidence retention.

## Build from source (contributors)

Use Bun 1.4.2, Git and Node24 for engineering fixtures, from the repository root:

```sh
bun install --frozen-lockfile
bun node_modules/playwright/cli.js install --with-deps chromium
bun run check
bun run build
bun run validate
./dist/wring --version
```

Install Chromium before checking: actual-browser tests must not silently skip.
This browser is a development dependency, separate from a contained agent runtime.
See [CONTRIBUTING](CONTRIBUTING.md) for targeted checks and publication boundaries.
