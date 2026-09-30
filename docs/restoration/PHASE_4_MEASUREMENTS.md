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

# Implementation measurements — 30 September 2026

Recorded while implementing fork and join from the baseline above. Deterministic
fixtures only: no model, container, fleet, human decision or external delivery.

## Design as built

- **Version 2 graphs.** `fork` opens 2–8 branches; `join` names its fork and waits
  for all of them. `parallelism` (1–8) caps concurrent branch effects. Version 1
  declarations, plans, events and views are unchanged.
- **Private branches.** A branch is every node reachable from its entry before
  the join. The compiler refuses shared nodes, nodes reachable from outside,
  branch nodes reading outside the branch, later nodes reading a branch, nested
  forks, deliveries in a branch, a branch that reaches `done`, and a branch that
  never produces its own candidate. Required nodes use wait-all dominance: a node
  that dominates its branch's arrival dominates the join.
- **Several cursors, one chain.** Replay admits an event only for an active node.
  A fork's route opens its branches; each branch's route to the join records one
  arrival; the join activates when every branch has arrived. Results are recorded
  in a fixed node order after concurrent dispatch settles.
- **Integration.** The join merges branch candidates with `git merge-tree
  --write-tree --merge-base` in declared order, records merge commits with a fixed
  identity and time, checks acceptance inputs against the root, and verifies the
  merged candidate with every branch plan's pinned checks. The integration record
  and every verification summary form the join's evidence digest.
- **Delivery of an integration.** The evidence commit sits on the merged commit
  and carries the graph's own export under `.wringer/graph-deliveries/ID/`; Send
  pushes it to the review branch only and confirms the exact commit.

## Observed

The packaged parallel walkthrough (validation stage
`compiled-parallel-graph-contract`) drives 11 public commands and 2 fixture-binary
steps. The public `run` refuses the missing runtime before dispatch and leaves both
branches reserved. A fixture crash after both branch children finished leaves one
result unrecorded, and resume reconciles it: each child has exactly two sessions.
The join integrates; review, graph-evidence preparation and Send follow through
the public binary. The evidence commit's parent is the integration commit, the
default branch is unchanged, a fresh clone passes the Node-only audit and holds
both branches' code, and an altered integration record is refused.

The adapter tests use real Git merges and run the pinned checks on exported trees.
Two passing branches integrate; a shared rule in only one branch's plan makes the
clean merge `failed`, which is only visible because the join verifies against
every branch plan; same-line edits are a `conflict` with no candidate; the same
graph at ceilings 1 and 2 integrates to the same commit; and branch B's object
store never holds branch A's candidate.

## Reversions

`scripts/restoration-phase4-reversions.ts` removes each fork/join guard alone in an
isolated copy. The first run caught 31 of 33. The two that stayed green are the
fork–join pairing checks: each masks the other, and the branch-region rule also
refuses a mismatched pair. They are listed as layered, not claimed. Five other
compiler guards are caught only as "a different guard refused", because the branch
rules overlap; one turns a crash into a named refusal. The final run's counts are
in the [reversion record](evidence/phase-4/reversions.json) and
[effects](evidence/phase-4/effects.json).

## Not measured

Live agents, real containers, parallel model spend and any benefit of branches
over one loop doing both changes. The join runs no model judge of the integration.
