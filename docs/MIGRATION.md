# Upgrade, recovery, rollback and removal

The installer retains versioned binaries separately from application state and
repository evidence. Existing formats keep their original readers. It does not
rewrite old history, refresh budgets, restart workers or move uncertain effects.
Back up the private application directory and repository `.wringer/` together
using your normal private backup procedure before switching versions.

```sh
wring upgrade --archive /absolute/candidate.tar.gz --sha256 EXACT_SHA --release VERSION --dry-run --json
```

Review the target, current/previous versions, owned changes and holds; repeat with
`--apply --expected IDENTITY`. In-flight owners, pending check results, queued
runner work and uncertain Send hold the switch. Stop known owners and reconcile
work first. Completed checks and decisions remain source-bound. Never remove a
reservation or edit a controller record to bypass a hold.

A lost installation response retains `PREFIX/pending.json`. Repeat its exact
selection/identity to resume. A completed old transaction cannot switch back after
a newer upgrade. `wring upgrade --rollback` previews the retained prior version;
apply its identity separately. Rollback refuses missing/changed owned bytes or a
version without the installed schema set. This is conservative compatibility,
not automatic downgrade conversion. Default uninstall retains jobs/evidence.

## Recovery with no automatic replay

Read `wring job list --json` and `wring job status --job ID --json`. Preview:

```sh
wring recover --workspace ID --dry-run --json
wring recover --job ID --operation OPERATION_ID --dry-run --json
wring recover --job ID --send --dry-run --json
```

Choose one route and repeat only an eligible exact preview with
`--apply --expected IDENTITY --actor NAME`. Workspace recovery releases a confirmed
dead page owner and retains uncertainty. Domain recovery inspects existing
operations. It never spends or sends. If a dead coordination lock blocks it,
`wring recover --lock-kind KIND --lock-id ID` previews the exact lock; the help
lists the additional workspace argument for controller locks.

New verification reservations bind one output directory. Recovery requires its
sealed final completion, exact source and selection. It records the observation
without executing checks. Lost display observations remain missing: acceptance
stays unavailable until a subsequent explicitly granted check/display supplies
them. Repetitions and expiry remain spent. Legacy v1 operations lack that exact
output binding and remain uncertain; do not guess among nearby evidence bundles.
An incomplete bundle cannot become success through recovery.

Lost Send recovery observes the exact prepared remote head, copies matching
local Git objects privately and audits carried evidence. Missing, changed or
source-only remote results stay uncertain. It performs no push. Provider work
whose effect cannot be observed likewise remains uncertain; any deliberate
retry must acknowledge possible duplicate spend under the original authority.

Legacy assistant roots remain usable via `wring assistant status --root PATH`
and the retained `assistant` recovery commands. They are not silently imported
into the new workspace registry. Upgrade preserves their files/readers. Keep the
older version's evidence and original semantics; [CLI](CLI.md) includes aliases.
The [documentation disposition](rebuild/DOCUMENTATION_INVENTORY.md) retains old
entrypoints and historical implementation reports.

## Remove only owned configuration and installation

```sh
wring connect --workspace ID --client codex --scope project --remove --dry-run --json
wring uninstall --dry-run --json
```

Apply each separately with its current identity. Client removal preserves
unrelated settings; a changed/unowned skill or entry refuses replacement.
Disconnecting does not stop a job. Uninstall holds while owned client bindings
remain, deletes only manifest-owned installation files, and retains private
installation receipts plus app/repository evidence. No broad home-directory
cleanup exists. `wring storage` inventories owned state; only explicitly selected
incomplete acceptance/profile preparations can be archived/removed by that route.

## Diagnostics

`wring diagnostics --workspace ID --dry-run --json` previews a bounded, redacted
export. Repeat with `--output NEW_DIRECTORY --apply --expected IDENTITY` to write
it. Inspect before sharing: no credentials, private operator URL, raw provider
transcript or browser profile should be sent. Reports name omissions and retain
unknown costs. See [SUPPORT](../SUPPORT.md).
