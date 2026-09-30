# Parallel branches baseline — 30 September 2026

Measured after alpha.26 was published and verified, from commit
`30eedc8733c19285dc06b55424ca08bf2d55cafe`. This record precedes any fork, join
or integration contract. It does not qualify parallel execution.

## Method

`scripts/restoration-phase4-measure.ts` builds a real Git fixture whose pinned
check requires `src/count.txt` to equal the number of files in `src/items`. The
base is red: the count is 1 and there are no items. Branch A adds `src/items/a`
and edits `src/a.js`; branch B adds `src/items/b` and edits `src/b.js`. Each
branch is a single-loop graph (loop → fresh check → hold) from the same root,
run through the production graph driver with real source transport, controller
journals and candidate capture. Worker and judge replies are synthetic; the check
really runs `check.sh` on the candidate tree exported from its object store.

```sh
bun scripts/restoration-phase4-measure.ts build/restoration/phase-4/measurements
```

The [measurement record](evidence/phase-4/measurements/phase4-baseline.json) has
every value below.

## Observations

| Measurement | Serial | Concurrent |
| --- | --- | --- |
| Two branches to their hold, median of three | 7.2 s | 3.6 s |
| Process CPU time | 0.68 s | 0.53 s |
| Peak resident memory | 168 MiB | 172 MiB |

- **Overhead is mostly waiting.** Each branch spends about 3.6 s of wall time and
  well under a second of CPU in Git transport, capture, journals and verification
  envelopes. Two branches in one process overlap almost perfectly. With live
  agents, role time will dominate; this is harness overhead only.
- **Branches are isolated.** Neither branch's state names the other's directory,
  neither object store holds the other's candidate, and each candidate changes
  only its own two paths. Each branch keeps about 0.3 MiB of state.
- **A clean merge is not a verified integration.** Each candidate passed the
  pinned check on its own. `git merge-tree --write-tree` combined them without a
  conflict, and the merged tree then failed the same check: two items, count 1.
- **Overlapping edits are detected, not combined.** Two different edits to the
  same line of `src/a.js` produce a conflict naming that path. `merge-tree`
  writes objects only; it touches no working tree.
- **Failures stay in their branch.** With one branch losing its acknowledgement
  after its child completed, the other branch still reached its hold. The failed
  branch then reconciled to its hold without another child run: exactly two
  child sessions.
- **The serial contract cannot express either shape.** Two root loops are refused
  as an unreachable node, and a check naming two inputs is refused as malformed.
  Replay admits events only for the single current cursor, and each effect node
  has one success edge.

## Design inputs for phase 4

These follow from the observations; they are not yet a contract.

1. **Integration is its own contained candidate.** A join combines exact branch
   candidates with a deterministic three-way merge in controller storage. The
   result gets a fresh contained verification against the root's pinned
   acceptance, and a judge where the plan requires one. A textual merge never
   inherits the branches' passes.
2. **Conflicts are an outcome, not an error.** A conflicting merge is a typed
   join outcome (`conflict`) naming the paths. It routes to a bounded repair loop
   whose input is the conflicted merge, or to a hold, never to a silent pick.
3. **Several cursors, one history.** The kernel must admit events for every open
   branch while keeping one hash chain. Reservation, dispatch, result and route
   remain per node; a join may reserve and dispatch only after every one of its
   branch inputs has a recorded success, a failure or an explicit cancellation.
4. **Reserve the whole fan-out first.** The root allowance must already cover every
   branch, the integration candidate, its verification and any repair. Branch
   reservations can be taken together before any branch dispatches, so one branch
   cannot starve another mid-run.
5. **A concurrency ceiling, not a budget.** Concurrent branches overlapped well in
   one process. The plan needs a small declared maximum parallelism, separate from
   the aggregate allowance, because each live branch will hold a container and a
   model session.
6. **Branch state stays private.** Each branch keeps its own child directory and
   object store; the join reads only the exact candidates and their bundles.

## Measurement errors retained

- The first run executed `check.sh` in the wrong working directory because the
  runtime command helper takes none. The verifier correctly reported the check as
  unavailable, and the branch stopped without a candidate. The script now spawns
  the check with an explicit working directory.
- The second run used a base that already passed its check. A contained journey
  refuses acceptance that is green before any work, so both branches failed. The
  base is now red.
- One value in an early draft of the record was typed in rather than measured;
  branch check outcomes now come from the recorded graph results.

Both failed runs are kept in `evidence/phase-4/initial/`.

## Not measured

Live agents, real containers, parallel model spend, a live publication remote and
any benefit of parallel branches over one loop doing both edits. Timings come from
one macOS arm64 machine with synthetic role replies.
