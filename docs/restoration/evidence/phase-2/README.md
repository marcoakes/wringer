# Ordinary-job improvement evidence

These records qualify engineering mechanisms. They contain no live provider
comparison, independent human observation or measured product-benefit claim.
See the [phase status](../../STATUS.md) and [user guide](../../../native/JOB_IMPROVEMENTS.md).

- `measurements/` retains the baseline and red-first behavior measurements.
  `public-path-red.log` also records a local loopback restriction; the
  unsandboxed repeat reaches the intended missing public-route failure.
- `reversions.json` records the final 36 independent mutations. Each mutation
  must fail its targeted behavior test, and each restoration must pass. The
  corresponding `revert-*.log` and `restored-*.log` carry their observations.
- `initial-34/` and `initial-35/` preserve the earlier complete runs. They are
  superseded coverage, not additional independent effectiveness trials.
- `isolated-control.log` and `restored-green.log` cover the combined test set
  before and after the final mutation sequence.

Reproduce from the phase's source with:

```sh
bun scripts/restoration-phase2-reversions.ts
bun run validate
```

The mutation definitions and exact targeted commands are in
[`scripts/restoration-phase2-reversions.ts`](../../../../scripts/restoration-phase2-reversions.ts).
The script copies source into isolated checkouts; it does not remove guards from
the working checkout. Local paths in published logs are replaced with
`[checkout]`, `[isolated-checkout]` or `[temporary]`. Private controller state,
cookies and raw browser traces are not release evidence.

Local working-tree validation and remote clean-commit release checks are
different observations. The execution record identifies their coverage and any
late-change limit; publication requires the exact committed source and artifacts.
