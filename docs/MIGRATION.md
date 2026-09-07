# Python retirement and the Bun replacement

The active Wringer implementation on main is Bun/TypeScript. Python harness
source, Python test runner, pyproject/SDist packaging, PyPI publishing workflow
and the old probe/release scripts have been retired. There is no Python runtime
fallback and no second supported product under `ts/`.

The root `package.json`, `bun.lock`, `packages/`, `scripts/*.ts` and Bun CI are
the build authority. See [installation](../INSTALL.md), [quickstart](../QUICKSTART.md)
and [the rewrite contract](REWRITE_PLAN.md). The replacement remains a prerelease
until its declared live-model and real-containment release gates pass.

## What is preserved

- Published `schema/` files and their original digests. Old records are read
  according to the version they declare; new facts use new record versions.
- Committed data fixtures, past delivery bundles and dated field reports.
- Upstream held-out tests and historical example projects, including Python
  target code. They document what was measured; they are not Wringer's runtime.
- The complete prior implementation and tests in Git history. The baseline is
  commit `7b79c58`; [the retirement inventory](python-retirement.json) names the
  removed tracked files. No installed local interpreter or Keychain item is
  removed by this repository migration.

This is not a claim that the smaller new test suite reproduces all prior Python
coverage. The historical implementation report documents its actual measurement.
New acceptance evidence must come from the replacement itself. Unsupported old
configuration is rejected with a migration route, not silently interpreted as
a weaker policy.

## Configuration and responsibility changes

The supported agent path is a versioned execution plan, ACP, and isolated worker
and judge instances. Shell workers and direct model HTTP endpoints are not the
new production orchestration interface. The CLI orchestrates; agent runtimes
author product code. Apple container and gVisor/Kubernetes contain the repo clones.

Standalone evidence inspection and verification retain explicit local operation.
Running a repository's checks locally is trusted local execution, not isolation.
Existing installed Python `wring` commands do not change just because this checkout
changes: invoke `dist/wring --version` when checking the new build.

Published PyPI artifacts and historical Git tags are not altered or deleted here.
Their installation instructions in dated documents describe the old product.
No new PyPI release is produced by main or by the Bun release workflow.

## Recovering historical source

Inspect a named old file without changing this checkout:

```sh
git show 7b79c58:src/wringer/cli.py
```

If a historical experiment needs an old release, use a separate clone at that
existing tag. Do not reactivate its runtime or build system on main.
