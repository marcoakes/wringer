# Install Wringer from this checkout

The active implementation is the Bun workspace at the repository root. Build this checkout; do not use historical Python package-install instructions for the current product.

To use a coding app as the conversational front door, build once below, then
follow [ASSISTANT_START.md](ASSISTANT_START.md). That route is an explicit
cooperative-local engineering preview, not a protected or fully measured
named-client integration. It does not require entering existing keys again.

## Prerequisites

- Bun 1.4.2, Git and Node.js on `PATH`. The source verification/demo fixtures
  need Node.js; CI uses Node.js 24. Node.js is a fixture prerequisite, not the
  Bun harness's runtime.
- macOS or Linux for the process-supervision paths. A build on one platform is not a cross-platform release test.
- Enough disk space for dependencies, compiled binaries, retained run evidence and isolated repository copies.

Installing Wringer does not install a coding agent, sign into an account, choose a model, store a key, provision a Kubernetes cluster, or pull an execution image.

## Build

From the root of a trusted Wringer source checkout:

```sh
bun --version
git --version
node --version
bun install --frozen-lockfile
bun run check
bun run build
./dist/wring --version
./dist/wring --help
./dist/wringer-drive --help
./dist/wringer-board --help
```

`bun install` obtains the declared dependencies; review the checkout and lockfile as you would for any development tool. `bun run check` runs the repository's configured checks. Read failures rather than bypassing them to obtain a binary.

The output is `dist/`. Keep it as a unit so its command aliases, schemas and documentation stay together. To use this build in the current shell:

```sh
export PATH="$PWD/dist:$PATH"
command -v wring
wring --version
```

Run that export while still at the Wringer checkout root. It does not edit a shell profile or replace an existing global installation. The resolved path and version tell you which executable you are actually testing.

## Verify the installation without paid work

```sh
bun run demo
```

This is a deterministic developer exercise, not a live-model test. Keep the printed transcript and evidence paths if it fails. Do not paste API keys into a bug report.

For maintainers running the complete release validation, also install its pinned
test browser once, then run the validation envelope:

```sh
bun node_modules/playwright/cli.js install --with-deps chromium
bun run validate
```

This browser is only for automated engineering tests. It is not an execution
runtime or a prerequisite for a PM opening the local workspace in their own
browser. The scripted rehearsal clicks the real approval, review and publication
forms; it makes no provider calls. A missing test browser fails validation rather
than silently skipping the UI check. Browser binaries are downloaded separately
from normal product installation; see [Playwright's browser instructions](https://playwright.dev/docs/browsers).

## Before a real product run

Follow [SETUP.md](SETUP.md). Production execution requires the declared ACP agents and an established isolated runtime. A compiled CLI and a present credential do not establish either.

If keys already exist in your credential store, reuse them through the explicit runtime/agent declaration; do not create replacements simply to retry a run. [HEADLESS.md](docs/native/HEADLESS.md) explains the bounded authority and credential handoff. `wringer-headless` uses the same contained driver; it does not launch a host coding agent.

No published Bun package, release download or ready-made execution image is promised here. Source builds are the supported installation route described by this checkout. Historical release artifacts remain historical; they are not this implementation.
