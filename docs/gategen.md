# A criterion becomes a gate, and the gate is red first

*A PM writes an acceptance criterion. Something has to turn it into a check
that can be run, somebody has to install that check, and the check has to be
caught RED before anyone builds — because a gate written for a feature that
does not exist yet has exactly one honest colour, and it is not green.*

This is [specs/SPEC_GATEGEN_V0.md](specs/SPEC_GATEGEN_V0.md), built. It closes the gap
[`docs/factory-dry-run.md`](factory-dry-run.md) measured: on that run
`wring plan` proposed **zero** gates, so every acceptance gate and every
`proves:` line had to be hand-written, and the chain never reached delivery.
Three criteria there; an advanced spec has twenty. That is the constraint on
the whole vision, and this is the machinery for it.

The one-sentence test the design is held to: **could a worker that writes
both the gate and the code get a criterion evidenced without a human and a
red run in between?** If yes, the design is wrong.

![a criterion becomes a gate, and it is red first](gategen.svg)

*Captured, not written. `scripts/demo.sh` regenerates it by running the real
commands through a real pty; [`gategen.cast.json`](gategen.cast.json) beside
it is the transcript. Regenerate just this one with
`sh scripts/demo.sh "" gategen`.*

**Every console block below is real captured output**, pasted from that run
and not composed. Where a run id appears it is the one that run produced.

---

## The shape

```
wring spec        drafts wringer.gates.yaml beside the spec — proposals
wring plan        renders them as a diff, WITH proves:, and stops
(a person)        applies the diff to .wringer.yaml, or does not
wring verify      records the gates RED — the feature does not exist yet
wring run         a worker builds; the gates go green one at a time
wring verify      acceptance.json reads `evidenced`, citing the red bundle
wring deliver     the spec is satisfied by the record, so it ships
```

Two files, and the difference between them is the whole design.
`wringer.gates.yaml` is a **proposal** with zero authority: nothing reads it
at verify time, nothing runs from it, and `wring verify`, `run`, `fleet`,
`graph` and `deliver` never open it. `.wringer.yaml` is the only file that
puts a command in Wringer's mouth (SPEC_GRAPH ruling 1), and the only way
into it is a person applying a diff.

## 1. The sidecar

`wringer.gatespec.v1` — a new file, because `wringer.spec.v1` is frozen and
its `gates:` block has no channel for a binding. One entry per machine
criterion, none for a `human: true` one:

```yaml
schema_version: wringer.gatespec.v1

gates:
  - id: csv-hdr
    run: "python3 g_hdr.py"
    proves: hdr
  - id: csv-rows
    run: "python3 g_rows.py"
    proves: rows
  - id: csv-cents
    run: "python3 g_cents.py"
    proves: cents
```

**This one is hand-written, and that is the offline path rather than a
shortcut.** `wring spec --send` drafts this file from the criteria using the
same endpoint, model and key rules as `wring judge` — one network config, no
second surface. The machine this was recorded on has no endpoint, so the file
was written by hand in the shape the drafter emits, which SPEC_GATEGEN
ruling 5 keeps first-class: a repo with no LLM anywhere writes the same file
and everything downstream is identical.

`proves:` may appear **only** here. The spec's own `gates:` block has carried
model-drafted `run:` strings since P2 and still cannot carry a binding; and
if both files declare the same gate id, `wring plan` refuses and names both
files rather than picking one — a binding silently attaching to a command the
reader thinks came from the other document is exactly the confusion the
refusal exists to prevent.

## 2. `wring plan` proposes, and stops

```console
$ wring plan
Wrote tasks.jsonl — 1 task.
Wrote 1 brief: brief.md
Wrote wringer.rubric.yaml — 4 criteria (1 need a human).

Proposed gates (csv-hdr, csv-rows, csv-cents). Wringer does not install these
— changing what 'verified' means is yours to do:

--- a/.wringer.yaml
+++ b/.wringer.yaml
@@ -2,6 +2,15 @@
 gates:
   - id: test
     run: "python3 test_reports.py"
+  - id: csv-hdr
+    run: python3 g_hdr.py
+    proves: hdr
+  - id: csv-rows
+    run: python3 g_rows.py
+    proves: rows
+  - id: csv-cents
+    run: python3 g_cents.py
+    proves: cents
 
 run:
   worker: "sh ./build.sh"

Next:
  point 'judge.rubric:' at wringer.rubric.yaml
  wring fleet tasks.jsonl
```

**The `proves:` line travels with the command.** One edit installs both, so
nobody ends up with a gate whose purpose was left behind in another file.

`.wringer.yaml` is unchanged, byte for byte. There is no `--apply` and no
`--yes`. What you get is a diff `git apply` accepts.

## 3. A person installs it

```console
$ wring plan --json | python3 patch.py | git apply && cat .wringer.yaml
version: 1
gates:
  - id: test
    run: "python3 test_reports.py"
  - id: csv-hdr
    run: python3 g_hdr.py
    proves: hdr
  - id: csv-rows
    run: python3 g_rows.py
    proves: rows
  - id: csv-cents
    run: python3 g_cents.py
    proves: cents

run:
  worker: "sh ./build.sh"
  max_iterations: 5

deliver:
  branch: "wringer/{run}"
```

`patch.py` is three lines and lives in the demo repo:

```python
import json
import sys

sys.stdout.write(json.load(sys.stdin)["gate_diff"])
```

**What that step proves, and what it does not.** It proves Wringer printed a
diff and stopped, and that a separate act — outside Wringer, running as
whoever ran it — put the gates in the config. It does **not** prove a person
read the diff first, and no recording can prove that; the same limit applies
to the `echo 'approved: true' | tee …` step in
[`docs/graphs.md`](graphs.md). The interlock Wringer owns is that it renders
and halts. Whether the human on the other side of the halt is paying
attention is not a property software can assert about itself, and claiming
otherwise would be the guard-that-lies this repository exists to refuse.

## 4. The gate is red, and that is the correct colour

```console
$ wring verify
✓ test passed        0.0s
✗ csv-hdr failed     0.0s

--- gates/002_csv-hdr/stderr.log ---
reports.to_csv() does not exist

Evidence written to:
.wringer/runs/20260810-132220-9511/

Next:
  open .wringer/runs/20260810-132220-9511/summary.md
  rerun wring verify --gate csv-hdr
```

Nothing has been built yet, so the criterion is unmet, so a gate that proves
it **must** fail here. A generated gate green at birth is self-refuting: it
is testing something else. `acceptance.json` in that bundle says so and
refuses delivery:

```
counts: {evidenced: 0, unevidenced: 0, gate-failed: 1, gate-did-not-run: 2, human: 1}
  hdr    gate-failed        refuses=True
  rows   gate-did-not-run   refuses=True
  cents  gate-did-not-run   refuses=True
  copy   human              refuses=False
```

> **STALE SINCE 2026-08-17 (OQ-1), and kept as captured.** `copy` is a
> required `human` criterion nobody had answered, and on this tree that row
> now reads `refuses=True` with cause `human-unanswered`. The transcript is
> not edited, because a capture is evidence of a run and rewriting it would
> make it evidence of nothing — SPEC_REFUSAL §8. Re-driving this walkthrough
> against the current engine is owed; this note is what stops the old numbers
> being read as current in the meantime.

And if a bound gate ever *is* green on its first run, the run's `summary.md`
says so beside it — `⚠ **`csv-hdr` should be RED.**` — because the artifact
recording it as `unevidenced` is not the document somebody opens right after
applying a diff.

**Note `gate-did-not-run` on two of the three.** `wring verify` stops at the
first required failure, so one run arms one gate. This is not a bug and it is
not free: an unrelated broken gate makes every criterion below it
unevidenced, which the dry run also measured. Here the loop resolves it, one
iteration at a time.

## 5. The worker builds, and each gate goes red before it goes green

```console
$ wring run

iteration 1/5
✓ test passed        0.0s
✗ csv-hdr failed     0.0s
→ worker             0.0s  (exit 0)

iteration 2/5
✓ test passed        0.0s
✓ csv-hdr passed     0.0s
✗ csv-rows failed    0.0s
→ worker             0.0s  (exit 0)

iteration 3/5
✓ test passed        0.0s
✓ csv-hdr passed     0.0s
✓ csv-rows passed    0.0s
✗ csv-cents failed   0.0s
→ worker             0.0s  (exit 0)

iteration 4/5
✓ test passed        0.0s
✓ csv-hdr passed     0.0s
✓ csv-rows passed    0.0s
✓ csv-cents passed   0.0s

Converged in 4 iterations.
Loop evidence: .wringer/loops/20260810-132220-2074/
```

The worker is a shell script standing in for a coding agent, as in every
recording here, so the demo is honest about running no agent and reproducible
by anyone. It takes **one step per call** — the nearest failing thing — which
is what a repair brief asks for, and it is why each of the three gates is
recorded red on its own iteration before it is recorded green. The
discrimination receipts acceptance needs are produced by the loop's own
sequencing, not by a step staged for the camera.

**The gate author and the build worker are different parties, separated by a
recorded red run.** That is the co-modification guard, and it is enforced by
sequencing rather than by file tracking: the three checks were committed
before `wring plan` ran and the worker never touched them (`git diff` over
`g_hdr.py g_rows.py g_cents.py` across the delivered commit is empty). What
sequencing cannot stop — a worker weakening a check *file* mid-loop while the
command string stays identical — is SPEC_VACUITY §5a's inherited blind spot,
answered by the human diff at delivery and by `wring health` across time. No
file-dependency guessing is attempted: Wringer cannot honestly derive which
files a command depends on in a language-agnostic way, and a guess would be a
guard that sometimes lies.

## 5b. What the worker was told

Not in the recording — a thirty-line brief would be a wall rather than a
demo — but written to disk by that same loop, at
`.wringer/loops/<id>/iterations/001/brief.md`, and this is its head, verbatim:

```markdown
# What you are building

**Export the report as CSV** — from `wringer.spec.yaml`, which a human approved.

The table view is fine but nobody can get the numbers out of it.
Add a CSV export: same columns, same order, every row, and the
amounts must still read as money.

## This task — `csv`

Add reports.to_csv() and a button that calls it
```

and, further down, the part this spec is responsible for:

```markdown
## What finishing means

The acceptance criteria a human approved, and the gate bound to each:

- `hdr` — The CSV header is the table's columns, in order — bound to `csv-hdr`
- `rows` — Every row of the table reaches the CSV — bound to `csv-rows`
- `cents` — Amounts keep two decimal places — bound to `csv-cents`

Some are judged by people, not gates: `copy`. Their guidance is deliberately not in this brief — nothing you do to a gate can satisfy them.

Everything above is what this work is for. Everything below is the gate that failed on this lap.
```

**That last line is the join.** On the day of the dry run the brief was
thirty-five lines about a failing gate with not one word about CSV export
(F3, since fixed — [`docs/brief-quality.md`](brief-quality.md)). It now opens
with the objective, and the gate that failed comes *after* it, named as the
lap's failure rather than as the job. The `— bound to csv-hdr` clauses are
this spec's contribution: the worker is told which check stands for which
criterion, which on the dry run's repo could not be written because no gate
was bound to anything.

## 6. Evidenced, citing the run where it failed

```console
$ head -24 .wringer/runs/20260810-132221-0562/acceptance.json
{
  "schema_version": "wringer.acceptance.v1",
  "counts": {
    "evidenced": 3,
    "unevidenced": 0,
    "gate-failed": 0,
    "gate-did-not-run": 0,
    "human": 1
  },
  "criteria": [
    {
      "criterion": "hdr",
      "title": "The CSV header is the table's columns, in order",
      "required": true,
      "state": "evidenced",
      "gate": "csv-hdr",
      "command": "python3 g_hdr.py",
      "receipt": {
        "kind": "failure",
        "bundle": ".wringer/runs/20260810-132220-e026"
      },
      "reason": "`csv-hdr` passed, and the record shows it can fail",
      "refuses": false
    },
```

Three evidenced, each citing the bundle where its gate demonstrably failed.
The fourth criterion — "the export button's label reads well" — is `human`,
carried and marked, never scored by anything.

**The receipt is keyed on `(gate id, command)`.** Edit a gate's command
between the red run and the green one — even cosmetically — and the receipt
no longer matches, the criterion stays `unevidenced`, and delivery is
refused. That is correct (a different command is a different check and has
never been shown to fail) and it is the single most confusing way this can
go wrong, so it is worth knowing before it happens rather than after.

## 7. Delivery

```console
$ wring deliver --send
wring deliver: the branch is pushed, but no 'forge:' section is declared, so
no merge request was opened.
Branch:  wringer/20260810-132221-0562
Commit:  fba3c48ee76e
Pushed:  yes

Delivery evidence: .wringer/deliveries/20260810-132222-86eb/
```

A real branch, a real commit, a real push. The remote is a bare `origin` on
local disk — no network, no credential, no forge declared, which is why no
merge request was opened and why the command says so plainly instead of
pretending.

The run id in the branch name is the run whose `acceptance.json` is quoted
above. That is the join the whole chain exists for: **this branch ships
because that record says the spec is satisfied**, and if any criterion had
read `unevidenced` the same command would have refused.

> **AMENDED 2026-08-17 (OQ-1).** `unevidenced` is no longer the only state
> that refuses. A required `human` criterion that nobody has answered refuses
> too, so on the current engine this delivery would NOT have shipped: `copy`
> is unanswered. What the sentence describes — the record deciding, not the
> command — is unchanged and is the point.

## What this does not claim

- **`wring spec` drafting the sidecar is not exercised here.** No endpoint on
  this machine. The parser, the validation and the refusals are the same on
  both paths and are tested; what is untested by this recording is the
  network round trip that fills the file in.
- **No gate here needs `pytest`.** Every check is stdlib-only, deliberately.
  The dry run died on `No module named pytest` — exit 1, an environment
  failure the repair loop read as a repair job — and that defect (F6) is
  still open. This scenario is built so the environment does not get to
  decide the result; it is a choice about what the recording measures, not a
  fix for the thing it avoids.
- **The worker here is scripted**, so what it was told did not decide the
  outcome. What it WAS told is in §5b above and is real.
- **One gate per criterion**, and Wringer checks the binding's consequences,
  never its wisdom. That `csv-hdr` is a fair test of "the header matches the
  columns" is a human's declaration.
- **A green suite is not a satisfied user.** `evidenced` means the bound gate
  passed and has demonstrably failed before. It does not mean the criterion
  was the right one to ask for.
