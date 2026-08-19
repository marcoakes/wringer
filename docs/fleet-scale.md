# Many tasks, one tree — what a fleet actually does, and what it claims

*A fleet of repair loops has worked for months by a mechanism nobody wrote
down, and reported that mechanism's normal operation as failure. This is the
mechanism, measured; the flag that removes the waste
([specs/SPEC_SCOPE_V0.md](../SPEC_SCOPE_V0.md)); the chain driven end to end at
scale; and — stated at the same volume — the four places where a scoped fleet
still cannot do what a reader might assume it can.*

The one-sentence test the design is held to: **can the harness's own scoping
ever make a green tick claim more than it measured?** It cannot, and not by
policy: a scoped-out gate leaves no result, acceptance reads absence as
`gate-did-not-run`, and `wring deliver` already refuses on it.

![one spec, two tasks, one delivery](fleet-scale.svg)

*Captured, not written. `scripts/demo.sh` regenerates it by running the real
commands through a real pty; [`fleet-scale.cast.json`](fleet-scale.cast.json)
beside it is the transcript. Regenerate just this one with
`sh scripts/demo.sh "" fleetscale`.*

**Every console block under "The chain, at scale" is real captured output**,
pasted from that run and not composed. Where a run id appears it is the one
that run produced. Three blocks elsewhere on this page come from other real
runs — the unscoped control, and §3d's two — and each says so where it sits.

---

## The shape

```
wring plan        proposes a gate per criterion, WITH proves:, and stops
(a person)        applies the diff — and declares fleet.scope by hand
wring verify      records the first gate RED; the feature does not exist
wring fleet       one child per task, each scoped to the gates it owns
wring verify      the WHOLE gate set, unscoped, on the joined tree
wring deliver     one branch, because the record is one tree's
```

Two tasks, three criteria, and the ownership is the point: **`csv` proves two
criteria and `fmt` proves one.** A capture in which every task owned exactly
one gate would go green while demonstrating strictly less than this page
claims — `wring verify` stops at the first required failure, so the
interesting case is a task that has to arm two gates on two separate red laps.
That case is [§3a](#3a-one-wring-verify-arms-one-gate), and it is the reason
this recording is shaped the way it is.

## The chain, at scale, and where it reached

### A gate per criterion, proposed and not installed

```console
$ wring plan
Wrote tasks.jsonl — 2 tasks.
Wrote 2 briefs: briefs/csv.md, briefs/fmt.md
Wrote wringer.rubric.yaml — 3 criteria.

Proposed gates (g-hdr, g-rows, g-cents). Wringer does not install these —
changing what 'verified' means is yours to do:

--- a/.wringer.yaml
+++ b/.wringer.yaml
@@ -2,6 +2,15 @@
 gates:
   - id: test
     run: "python3 test_reports.py"
+  - id: g-hdr
+    run: python3 g_hdr.py
+    proves: hdr
+  - id: g-rows
+    run: python3 g_rows.py
+    proves: rows
+  - id: g-cents
+    run: python3 g_cents.py
+    proves: cents
 
 run:
   worker: "sh ./build.sh"

Next:
  point 'judge.rubric:' at wringer.rubric.yaml
  wring fleet tasks.jsonl
```

Two tasks out of one spec, and three gates proposed with the `proves:` line
that binds each to the criterion it evidences. This is
[`docs/gategen.md`](gategen.md)'s machinery unchanged; what is new starts at
the next step.

### A person installs the gates — and the scope map is right there

```console
$ wring plan --json | python3 patch.py | git apply && cat .wringer.yaml
version: 1
gates:
  - id: test
    run: "python3 test_reports.py"
  - id: g-hdr
    run: python3 g_hdr.py
    proves: hdr
  - id: g-rows
    run: python3 g_rows.py
    proves: rows
  - id: g-cents
    run: python3 g_cents.py
    proves: cents

run:
  worker: "sh ./build.sh"
  max_iterations: 5

fleet:
  concurrency: 1
  deadline: 300
  retries: 0
  scope:
    csv: [hdr, rows]
    fmt: [cents]

deliver:
  branch: "wringer/{run}"
```

**`fleet.scope` names criteria, never gates.** `csv: [hdr, rows]` is the
vocabulary the spec was approved in; the gate is reached through the `proves:`
line four lines above it. One join, declared twice nowhere — and a human wrote
both halves, which is R2's first condition met outright.

Note `retries: 0`. The unscoped fleet's entire survival mechanism is the retry
queue harvesting first-pass failures ([§1](#1-the-mechanism-every-child-runs-the-whole-gate-set));
turning retries off is how this run measures that it no longer needs them.

### The gate is red first, and one verify arms one gate

```console
$ wring verify
✓ test passed        0.0s
✗ g-hdr failed       0.0s

--- gates/002_g-hdr/stderr.log ---
reports.to_csv() does not exist

Evidence written to:
.wringer/runs/20260810-231722-4190/

Next:
  open .wringer/runs/20260810-231722-4190/summary.md
  rerun wring verify --gate g-hdr
```

Nothing is built yet, so a gate that proves an unmet criterion **must** fail.
Note what this run does *not* say: `g-rows` and `g-cents` never ran, because
verify stopped at the first required failure. One run, one gate armed. That
limit is not fixed here and it is what §3a is about.

### The fleet: one child per task, each on its own gates

```console
$ wring fleet tasks.jsonl
2 tasks, 1 at a time.

2 succeeded, 0 failed, 0 parked.
Fleet evidence: .wringer/fleets/20260810-231722-ac2d/
```

Two for two, first attempt, with retries off.

**The control, run on this same scenario with the `scope:` block deleted and
nothing else changed** — a separate run, not in the recording, because a demo
that films its own counterfactual is a demo about itself. This is the head of
that fleet's `summary.md`, unedited apart from dropping its title and start
time:

```markdown
- result: **1 succeeded, 0 failed, 1 parked** of 2
- join: **not satisfied**

| task | status | attempts | why |
|---|---|---|---|
| csv | parked | 1 | no_progress (attempts exhausted) |
| fmt | succeeded | 1 | converged |
```

`csv` ran the whole gate set, fixed both of its own gates, then hit `g-cents`
— `fmt`'s gate, which its worker cannot fix — and burned the rest of its
budget on it. `no_progress` blames the worker for a condition no worker could
affect. With `retries: 1` the queue would have harvested it on a second pass;
that is the mechanism, and scoping is what makes it unnecessary. The same
control run also prints the sentence [§1](#1-the-mechanism-every-child-runs-the-whole-gate-set)
describes, because it is exactly the case that sentence exists for:

> This fleet is not scoped, so every child ran the whole declared gate set: a
> failure above may mean **blocked by a gate another task will build**, not
> broken work.

### What the children actually did

```console
$ cat .wringer/loops/*/summary.md
# wring run — 20260810-231722-04bf

- repo: **wringer-fleetscale** @ `1029315`
- started: 2026-08-11T00:17:22+01:00
- result: **converged** — every required gate passed
- iterations: 3

| iteration | verify | worker | evidence |
|---|---|---|---|
| 1 | failed (`g-hdr`) | exit 0 | `.wringer/runs/20260810-231722-5c7d` |
| 2 | failed (`g-rows`) | exit 0 | `.wringer/runs/20260810-231723-6629` |
| 3 | passed | — | `.wringer/runs/20260810-231723-4848` |

Final verification: `.wringer/runs/20260810-231723-4848`
# wring run — 20260810-231723-9d55

- repo: **wringer-fleetscale** @ `1029315`
- started: 2026-08-11T00:17:23+01:00
- result: **converged** — every required gate passed
- iterations: 2

| iteration | verify | worker | evidence |
|---|---|---|---|
| 1 | failed (`g-cents`) | exit 0 | `.wringer/runs/20260810-231723-b485` |
| 2 | passed | — | `.wringer/runs/20260810-231723-49c8` |

Final verification: `.wringer/runs/20260810-231723-49c8`
```

**This is the whole cycle, in two tables.**

- `csv` owns two gates and armed them **one per red lap**: `g-hdr` on
  iteration 1, `g-rows` on iteration 2, both green on iteration 3. Two
  discrimination receipts out of one task, produced by the loop's own
  sequencing rather than by a step staged for the camera.
- `fmt` failed on `g-cents` and nothing else.
- **Neither child ever failed on the other's gate.** Neither ran `test`
  either — the tables above only ever name a FAILING gate, so the evidence for
  that is each child's own bundle, which lists `test` under "Scoped out" —
  quoted at the end of this section.
- The control two blocks up is what the same pair does without scope: `csv`
  reached `g-cents`, which belongs to `fmt`, and a real agent's brief would
  have named it as the thing to fix.

The children's consoles are not in the recording because they do not exist:
`wring fleet` sends each child's stdout to `DEVNULL`, since four interleaved
loops would be unreadable. The tables above are read back off disk, which is
where the fleet put them.

### The full gate set, unscoped, on the joined tree

```console
$ wring verify
✓ test passed        0.0s
✓ g-hdr passed       0.0s
✓ g-rows passed      0.0s
✓ g-cents passed     0.0s
```

The fleet neither verifies nor delivers (ruling 7). This run is the
operator's, it is **unscoped**, and it is where cross-task breakage would
surface: a task that broke another's gate after that child converged is caught
here, on the record, with delivery refusing and naming the gate. `test` — the
gate no child ran — passes here too.

### Evidenced, citing the children's own red bundles

```console
$ head -24 .wringer/runs/20260810-231724-a5ca/acceptance.json
{
  "schema_version": "wringer.acceptance.v1",
  "counts": {
    "evidenced": 3,
    "unevidenced": 0,
    "gate-failed": 0,
    "gate-did-not-run": 0,
    "human": 0
  },
  "criteria": [
    {
      "criterion": "hdr",
      "title": "The CSV header is the table's columns, in order",
      "required": true,
      "state": "evidenced",
      "gate": "g-hdr",
      "command": "python3 g_hdr.py",
      "receipt": {
        "kind": "failure",
        "bundle": ".wringer/runs/20260810-231722-5c7d"
      },
      "reason": "`g-hdr` passed, and the record shows it can fail",
      "refuses": false
    },
```

**Read the receipt against the previous block.**
`.wringer/runs/20260810-231722-5c7d` is `csv`'s iteration 1 — the child's own
red run, in the shared tree, is what arms the criterion. That is the join this
whole cycle rests on: the first-pass failures that looked like waste are the
evidence, and a scoped child's partial bundle qualifies for it exactly as a
full one does.

### Delivery

```console
$ wring deliver --send
wring deliver: the branch is pushed, but no 'forge:' section is declared, so
no merge request was opened.
Branch:  wringer/20260810-231724-a5ca
Commit:  35c28c01b55c
Pushed:  yes

Delivery evidence: .wringer/deliveries/20260810-231724-40f7/
```

A real branch, a real commit, a real push, to a bare `origin` on local disk —
no network, no credential, no forge declared, which is why no merge request
was opened and why the command says so plainly.

**The chain reached `wring deliver` at scale.** One approved spec, two tasks,
a scoped fleet, one branch. That is the half of F4 that had never been driven
on anything real; the single-task half is [`docs/gategen.md`](gategen.md).

### The two artifacts that are not in the recording

Both were written by that same run. The fleet's `scope.json`
(`wringer.fleetscope.v1`), whole and unedited:

```json
{
  "schema_version": "wringer.fleetscope.v1",
  "fleet_id": "20260810-231722-ac2d",
  "declared_gates": [
    "test",
    "g-hdr",
    "g-rows",
    "g-cents"
  ],
  "tasks": [
    {
      "task": "csv",
      "criteria": [
        "hdr",
        "rows"
      ],
      "gates": [
        "g-hdr",
        "g-rows"
      ]
    },
    {
      "task": "fmt",
      "criteria": [
        "cents"
      ],
      "gates": [
        "g-cents"
      ]
    }
  ],
  "unclaimed_criteria": []
}
```

`declared_gates` is the whole set as that run saw it, so a reader computes any
task's *excluded* gates from this one file. And in `csv`'s first, red run
bundle — `.wringer/runs/20260810-231722-5c7d`, the one the receipt above cites
— `summary.md` says the same thing where a person will read it. Its prose is
one paragraph in the file and is wrapped here to fit the page; nothing else is
changed:

```markdown
## Scoped out

Not run, because this run was scoped to `g-hdr`, `g-rows`. This bundle
measured nothing about the gates below and claims nothing about them: each
leaves no result, which acceptance reads as `gate-did-not-run` and delivery
refuses on.

- `test`
- `g-cents`
```

Three records, one truth: machine-readable at the fleet level, human-readable
at the run level, and **absence** at the result level — which is the one that
actually refuses.

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
`proves:` binding already installed in `.wringer.yaml`, exactly as in the
capture above.

Each child is then dispatched as `wring run --gate g-hdr --gate g-rows` — the
loop verifies only those gates, converges when they are green, and briefs the
worker on nothing else. The other tasks' criteria stay **visible** in the
brief and are marked as theirs: a worker that cannot see the whole spec cannot
tell when its change breaks a neighbour.

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

A bound criterion that NO task claims is legal and loud: it lands in
`scope.json`'s unclaimed list, its gate goes red in the operator's final
verify if nobody built it, and acceptance refuses delivery exactly as today.

## 3. What it still cannot do

### 3a. One `wring verify` arms one gate

`wring verify` stops at the first required failure, and scoping does not
change that — it is a binding non-goal here. So a scoped child whose task
owns **two** gates arms them one per red iteration, and only if its worker
fixes them one at a time. In the capture above the worker takes one step per
call, which is what a repair brief asks for, and that is why `csv`'s two
gates are recorded red on two separate laps.

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
even for perfectly disjoint tasks — which is why the capture above runs in one
shared tree.

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
reads `bench_sourced=False` — preserving a bundle moves it out from under the
very thing that disqualified it. Two guards, because one is not enough:

- `.wringer/fleets` is absent from `health.search_roots`, and a test pins that
  it stays absent, so no default path discovers them;
- and `wring health --from <fleet bundle>` walks straight past that, because
  `--from` appends whatever root it is handed. What stops it there is **kind**:
  ruling 8 preserves LOOP directories, `Bundle.qualifying` is
  `kind == "run" and not bench_sourced`, and a loop bundle is not a run
  bundle. Also pinned, and it reddens if the preservation ever grows to
  include runs.

Which is exactly why the child's own **run** bundles are not preserved. They
go with the tree, and being bench-sourced they could arm nothing where they
were; copying them out is the one move that would change that.

### 3c. Scoping fixes what the harness SAYS, not what an agent may DO

Two agents in one shared tree can still collide on a file for their own
legitimate reasons. The fix for parallel write isolation is worktree
publish-back, which collides with the commit-or-push non-goal and is a future
cycle with a law change to argue for. Until then `concurrency: 1` is
collision-free and still gets every benefit of scoping — which is what the
capture above uses. The default is 4.

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

## What this capture does not claim

- **No agent ran.** Every worker here is a shell script, as in every recording
  in this repository, so the demo is honest about running no agent and
  reproducible by anyone. What a real agent would do with a scoped brief is
  the open question §3a names.
- **Two tasks is not a hundred.** The retry-harvest measurement is N=3 and the
  capture is N=2. Nothing here has been run at the scale `wring fleet` is
  built for.
- **No gate here needs `pytest`.** Every check is stdlib-only, deliberately:
  F6 — an environment failure the repair loop reads as a repair job — is
  specified and unbuilt, so this scenario is built so the environment does not
  get to decide the result. That is a choice about what the recording
  measures, not a fix for the thing it avoids.
- **A green suite is not a satisfied user.** `evidenced` means the bound gate
  passed and has demonstrably failed before. It does not mean the criterion
  was the right one to ask for.

## Where every number above came from

No transcript on this page was typed by hand, and no measurement is recalled.

- The `retries: 0` / `retries: 1` table, §3b's worktree parked counts and its
  bench-sourced worktree bundles were measured on 2026-08-10 by the scouting
  and review passes that preceded this feature, each with a reproduction
  script named beside it in their own notes; §1's N=2 shape and the
  laundering guard are re-measured on every run of this repo's suite
  (`tests/test_scope.py`).
- §3a's two-red-gates measurement is the review's, on shipped code, and is
  why the capture carries a task that owns two gates rather than one.
- §3d was measured for this document, on this machine, and the console block
  is that run's output.
- Everything under "The chain, at scale" is one recorded run, and
  `fleet-scale.cast.json` is its transcript. The unscoped control beside it is
  a second run of the same scenario with the `scope:` block deleted and
  nothing else changed — the scenario was copied out of `scripts/demo.sh`
  rather than retyped, so it is the same scenario and not a similar-looking
  one.
