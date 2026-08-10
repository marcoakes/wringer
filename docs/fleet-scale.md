# Many tasks, one tree — what a fleet actually does, and what it claims

*A fleet of repair loops has worked for months by a mechanism nobody wrote
down, and reported the mechanism's normal operation as failure. This is that
mechanism, measured; the flag that removes the waste
([SPEC_SCOPE_V0.md](../SPEC_SCOPE_V0.md)); and — stated at the same volume —
the four places where a scoped fleet still cannot do what a reader might
assume it can.*

The one-sentence test the design is held to: **can the harness's own scoping
ever make a green tick claim more than it measured?** It cannot, and not by
policy: a scoped-out gate leaves no result, acceptance reads absence as
`gate-did-not-run`, and `wring deliver` already refuses on it.

---

## 1. The mechanism: every child runs the whole gate set

`wring fleet` spawns one ordinary `wring run` per task. Each child verifies
the **whole declared gate set**, because that is what `wring verify` does. So
a task cannot converge until every *other* task's work also exists in the
tree that child is looking at.

In the default shared tree (`worktree: false`) that is survivable, and the
reason is the part nobody had written down: a child that "failed" still
**left its own code behind**, and the retry queue then hands the next attempt
a tree that has grown.

Measured on 2026-08-10 — three tasks, `concurrency: 1`, one spec:

| `fleet.retries` | outcome |
|---|---|
| `1` | `3 succeeded, 0 failed, 0 parked` — `csv` and `total` on attempt 2, `sort` on attempt 1 |
| `0` | `1 succeeded, 0 failed, 2 parked` — only `sort`, the last task to run |

**Only the last task ever succeeds on the first pass.** That is the mechanism
isolated: pass one lands every task's code in the tree, pass two finds it
there. It appears to need O(1) retries rather than O(N) — one full pass lands
everything regardless of N — which was measured at N=3 and is *inferred* for
larger N. Nobody has run it at N=20.

The same shape reproduces at N=2 in this repo's own suite
(`test_an_unscoped_multi_task_fleet_says_a_failure_may_be_another_tasks_gate`):
with `retries: 0`, one task converges and one parks, and the parked one is
not broken.

**What the summary used to say about that:** nothing. It reported the
first-pass failures as failures, with reasons like `no_progress`, and an
operator watching half their tasks fail on every run had no way to tell
expected from real. An unscoped multi-task fleet's summary now says it:

> This fleet is not scoped, so every child ran the whole declared gate set: a
> failure above may mean **blocked by a gate another task will build**, not
> broken work.

That sentence appears only when it can be true — more than one task, at least
one non-success, and no `fleet.scope`. In a scoped fleet it would teach a
reader to discount a failure that means exactly what it says.

**With real agents the waste is worse than waste.** The child's brief names
the first failing gate as the thing to fix, and mid-fleet that is routinely
another task's gate — so the harness instructs agents to wander into each
other's work, in one shared tree, four at a time.

## 2. The declaration: `fleet.scope`

A human writes which criteria each task proves, in the vocabulary the spec
was approved in. Gate ids never appear here; the gate is reached through the
`proves:` binding already installed in `.wringer.yaml`.

```yaml
gates:
  - id: csv-hdr
    run: "python3 g_hdr.py"
    proves: hdr
  - id: csv-rows
    run: "python3 g_rows.py"
    proves: rows

fleet:
  concurrency: 1
  deadline: 300
  scope:
    hdr-task:  [hdr]
    rows-task: [rows]
```

Each child is then dispatched as `wring run --gate csv-hdr` — the loop
verifies only those gates, converges when they are green, and briefs the
worker on nothing else. The other tasks' criteria stay **visible** in the
brief and are marked as theirs: a worker that cannot see the whole spec
cannot tell when its change breaks a neighbour.

Three records, one truth, and none of them is a new kind of proof:

- **absence**, at the result level — a scoped-out gate leaves no result row,
  which acceptance already reads as `gate-did-not-run` and delivery already
  refuses on;
- **`summary.md`**, at the run level — a "Scoped out" section naming each
  excluded gate and the scope that excluded it, for the person who opens it;
- **`scope.json`** (`wringer.fleetscope.v1`), at the fleet level — the
  resolved task→criteria→gates joins, the criteria no task claimed, and the
  whole declared gate set as that run saw it, so any task's *excluded* gates
  are computable from that one file.

If `fleet.scope` is declared it must cover every task in the task file, and
ten things are refused before any child spawns — a scoped task missing from
the task file, a task missing from the map, an unknown criterion, an empty
criteria list, a criterion listed twice in one task, a criterion bound to no
gate, a `human: true` criterion, a criterion claimed by two tasks, a task
resolving to no gates, and — checked first — a `fleet.scope` declared in a
repo whose `wringer.spec.yaml` is not `approved: true`. That last one is not
bureaucracy: `acceptance.json` is written only for an approved spec, so
without it a scoped fleet would deliver on a bundle nothing checked, and the
"absence already refuses" guarantee this whole feature rests on would be
guarding nothing.

The fleet neither verifies nor delivers. The sequence is `wring fleet` →
`wring verify` → `wring deliver`, run by an operator, and the final **full**
verify is where cross-task breakage surfaces: a task that broke another's
gate after that child converged is caught there, and delivery refuses on the
record naming the gate.

## 3. What it still cannot do

### 3a. One `wring verify` arms one gate

`wring verify` stops at the first required failure, and scoping does not
change that — it is a binding non-goal here. So a scoped child whose task
owns **two** gates arms them one per red iteration, and only if its worker
fixes them one at a time.

Measured: two required gates both red, one verify recorded a result row for
the first only. A worker that then satisfied the whole task in one call left
the second gate green **having never been red** — `unevidenced`,
`refuses: true`, delivery refused, with the summary's born-green warning
firing correctly beside it.

Nothing there is unsafe; the guard does its job and the tick does not
inflate. But a real agent handed a scoped brief is *more* likely to satisfy
its whole task in one call, not less — scoping is what finally tells it what
its whole task is. This is F4's finding, recorded and unfixed, and named here
rather than inherited silently.

### 3b. `worktree: true` cannot compose, and its evidence arms nothing

Each worktree is a detached checkout of HEAD with **tracked files only**, so
a child never sees another task's work and, unlike the shared tree, never
will. Retries do not help: a retry is a fresh worktree. Measured, two tasks:
`0 succeeded, 0 failed, 2 parked`.

There is a second, sharper reason it cannot reach delivery, and it holds even
for tasks whose files never overlap. `health.Bundle.qualifying` is
`kind == "run" and not bench_sourced`, and `bench_sourced` is decided by
**position**: any bundle under `.wringer/worktrees/`, which is exactly where
`fleet.make_worktree` puts every child. Measured: a red run then a green run
inside `.wringer/worktrees/t1` left the criterion `unevidenced`, both bundles
reading `bench_sourced=True qualifying=False`. **A worktree child's red runs
therefore arm nothing**, so worktree mode plus scope cannot reach delivery
even for perfectly disjoint tasks.

Wringer does not refuse the combination, because a refusal would claim to
know what the tasks are for, which the harness cannot.

**The teardown no longer destroys the evidence it cites.** `git worktree
remove --force` discards untracked files, and a child's whole `.wringer/` is
untracked — so the "child loop directories" the fleet summary pointed at went
with the tree, while the sentence promising them stayed. The loop directories
are now copied into the fleet bundle first, under `loops/<task-id>/`, and the
summary names them.

**Those copies are for a human to read, and nothing else.** A copy under
`.wringer/fleets/` is out from under the `.wringer/worktrees/` marker, so it
reads `bench_sourced=False`: if `wring health` ever discovered it, runs that
were deliberately excluded from the receipt economy would start arming
receipts. `.wringer/fleets` is absent from `health.search_roots` and a test
pins that it stays absent. The child's own **run** bundles are not preserved
— they go with the tree, and being bench-sourced they could arm nothing
either way.

### 3c. Scoping fixes what the harness SAYS, not what an agent may DO

Two agents in one shared tree can still collide on a file for their own
legitimate reasons. The fix for parallel write isolation is worktree
publish-back, which collides with the commit-or-push non-goal and is a future
cycle with a law change to argue for. Until then `concurrency: 1` is
collision-free and still gets every benefit of scoping. The default is 4.

### 3d. Scope assumes the tasks share the root repo's config

`fleet.scope` resolves against the **root** config's gates, and every child
is spawned with `cwd` set to its task's directory. When that directory is a
separate repository with its own `.wringer.yaml`, the child is handed
`--gate` ids its own config does not declare.

Measured on 2026-08-10, two tasks in two nested repos:

```
$ wring run --gate out-a          # what the fleet spawns, in the task's dir
wring run: no gate 'out-a' in .wringer.yaml (declared: own-check)
exit=2
```

and the fleet summary a human then reads:

```
| t1 | parked | 1 | unknown (attempts exhausted) |
| t2 | parked | 1 | unknown (attempts exhausted) |
```

The child's stderr goes to `DEVNULL`, so the explanation is lost. **Declare
`fleet.scope` only for tasks that share the root repo's `.wringer.yaml`.**
Whether this should become an eleventh refusal is a design decision and has
not been taken; it is recorded here rather than guessed at. (The parked
sentence above no longer claims evidence in child loop directories when the
children left none — that much is fixed.)

## 4. A note on `wring verify --gate`

`wring verify --gate` has narrowed a run to one gate since v0.1 and said
nothing about it in the bundle. It now writes the same "Scoped out" section a
scoped loop does, because the section is derived where the narrowing happens.
That is additive honesty on a shipped surface: the run claims strictly less
than a full one and now says so.

## Where every number above came from

No transcript on this page was typed by hand, and no measurement is recalled.

- The `retries: 0` / `retries: 1` table, the worktree parked counts and the
  bench-sourced worktree bundles were measured on 2026-08-10 by the scouting
  and review passes that preceded this feature, each with a reproduction
  script named beside it in their own notes; §1's N=2 shape and the
  laundering guard are re-measured on every run of this repo's suite
  (`tests/test_scope.py`).
- §3a's two-red-gates measurement is the review's, on shipped code, and is
  why the at-scale capture this cycle owes must carry a task that owns two
  gates rather than one.
- §3d was measured for this document, on this machine, and the console block
  is that run's output.
