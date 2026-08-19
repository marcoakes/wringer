# Factory dry run — what happens when a spec meets the chain

*2026-08-10. **A diagnostic, not a demo.** Every other captured transcript in
this directory shows Wringer catching something; this one shows Wringer being
asked to BUILD something, and it is published because it did not finish. The
goal is a PM writing an advanced spec and getting working software; this is
the measured distance to that, run end to end on a real feature in a real
repository, with nothing smoothed over.*

**Result: the chain did not complete.** It stopped at the repair loop, for a
reason that had nothing to do with the feature. Five findings below; two were
already suspected and are now measured, and two were not on anyone's list.

## The setup

A small Python repo with a working `reports` module and a passing test. The
feature: export the table as CSV. Four acceptance criteria, one of them
`human: true` — header matches the columns in order, every row exported,
amounts keep two decimals, and the button copy reads right.

## What happened, step by step

**1. `wring spec` — could not run here.** It refuses without a `judge:`
section, because drafting reuses the judge's endpoint, model and key rules so
that one network config is the only one. That is a deliberate design and the
message is good, but it means **the PM's very first command requires an LLM
endpoint configured before anything happens.** This machine has none, so the
spec below was hand-written in the shape `wring spec` drafts — `approved:
false`, four criteria, one task. Everything downstream is real.

**2. The approval interlock works.** `wring plan` against the unapproved
spec: exit 1, nothing written, and the message says what to do and why there
is no `--yes`. This is the part of the chain that is finished.

```
wring plan: wringer.spec.yaml says 'approved: false', so nothing was written.
Read the file, then set 'approved: true' in it by hand. There is deliberately
no --yes: the whole point of this step is that a person read what is about to
be built.
```

**3. `wring plan` proposed ZERO gates. (F2, confirmed and worse than framed.)**

```
Wrote tasks.jsonl — 1 task.
Wrote 1 brief: Add a to_csv() to reports and a button that calls it
Wrote wringer.rubric.yaml — 4 criteria (1 need a human).

No gates proposed; .wringer.yaml is unchanged.
```

The criteria became a rubric — for the *judge*, whose verdict binds nothing —
and no gate anywhere. So after the PM's spec is approved, **every acceptance
gate for the feature has to be written by a human**, along with each `proves:`
line. Three criteria here; an advanced spec has twenty. This is the constraint
on the whole vision and it is now measured rather than argued.

**4. The worker is never told what it is building. (F3, and this is the one
nobody had named.)** Here is the entire brief the loop handed the worker:

```markdown
# Fix this

`wring verify` failed. This is the structured result an agent would
get from `wring verify --json`:

    { "status": "failed", "failed_gate": "test", ... }

## Failing gate: `test`
- command: `python3 -m pytest -q test_reports.py`
- exit code: 1

### stderr
    /Applications/.../python3: No module named pytest

## What to do
Fix the failure above, then re-check with: `wring verify --gate test`
```

Thirty-five lines, and **not one word about CSV export.** No spec, no
criteria, no task objective. The loop is a *repair* loop and this brief is
exactly right for repair — but a PM's spec asking for a feature that does not
exist yet reaches the worker as "a gate failed, fix it". The intent is lost
between `wring plan`, which knows the objective, and `wring run`, which does
not.

Under `wring fleet` it is better but still indirect: the task's brief file is
passed as `WRINGER_TASK_BRIEF` in the environment, so a worker that knows to
read that variable can find the objective. Under `wring run` alone there is
no path to it at all.

**5. The loop burned its whole budget on a missing dependency.** `python3 -m
pytest` is not installed for the interpreter the gate resolved to, so the
first gate failed with `No module named pytest` — and the loop briefed the
worker to fix it, twice, then stopped.

```
iteration 1/3   ✗ test failed  → worker (exit 0)
iteration 2/3   ✗ test failed
Stopped after 2 iterations.
```

This is the same defect class as the exit-127 fix that shipped this session,
and **the fix does not cover it**: 127 is "command not found", this is exit 1
with a module error. The environment-error class is wider than the code
currently recognises, and in a fresh repo it is the *first* thing that
happens. `wring doctor` and the CLI both print a good hint for a human; the
loop does not act on it.

**6. Acceptance behaved exactly as specified, and that is the problem.**
Before any gate was bound, with the spec approved:

```
counts: {evidenced: 0, unevidenced: 3, gate-failed: 0, gate-did-not-run: 0, human: 1}
  header-matches-columns   unevidenced   refuses=False
  every-row-exported       unevidenced   refuses=False
  amounts-two-decimals     unevidenced   refuses=False
  button-copy-reads-well   human         refuses=False
```

> **STALE SINCE 2026-08-17 (OQ-1), and kept as captured.** That row now reads
> `refuses=True` with cause `human-unanswered` — nobody has answered it. The
> transcript is a record of a run that happened and is not edited; the note
> is here so the numbers are not read as current.

Correct per ruling 9 — unbound criteria are loud and never fatal. After the
gates were hand-written and bound, with the unrelated `test` gate still
failing on the missing dependency:

```
counts: {evidenced: 0, unevidenced: 0, gate-failed: 0, gate-did-not-run: 3, human: 1}
  header-matches-columns   gate-did-not-run   refuses=True
```

Also correct: stop-on-first-required-failure meant the acceptance gates never
ran, absence is absence, and delivery is refused. But note what it means for a
factory — **one unrelated broken gate makes every criterion unevidenced**, so
the acceptance verdict is only as available as the least related gate in the
repo.

**7. `wring deliver` was never reached.** The chain stopped at step 5.

## What this says about the distance

The refusal half of the chain works, and it works well: the interlock held,
acceptance told the truth in both states, and nothing claimed more than it
could evidence. The building half has a gap in the middle. `wring plan` knows
the objective and produces no gates; `wring run` produces gates' failures and
does not know the objective. Between them is where a PM's spec turns into
working software, and right now nothing carries it across.

None of this is fixed here — F-DRY measures, it does not repair. The findings
are recorded in `~/Claude/WRINGER_FACTORY.md` §3 as F2 (gate authoring), F3
(the brief), and a new one this run produced: **the environment-error class is
wider than exit 127**, which the loop still treats as a repair job.

---

## Postscript — 2026-08-10, the same scenario, driven again

*Everything above is unedited and stays that way. It is the primary evidence
of where the chain stopped, and a document that quietly improved its own
history would be worthless for exactly the thing it is for. This is what
happened when the scenario was re-driven after
[specs/SPEC_GATEGEN_V0.md](../SPEC_GATEGEN_V0.md) shipped.*

**The chain completed. It reached `wring deliver`, and delivery succeeded.**
Captured end to end in [`docs/gategen.md`](gategen.md); regenerate it with
`sh scripts/demo.sh "" gategen`.

What is different from the run above, step for step:

- **§3 is answered.** `wring plan` proposed three gates, one per machine
  criterion, each carrying the `proves:` line that binds it. The sidecar
  (`wringer.gates.yaml`) is still hand-written here — there is still no LLM
  endpoint on this machine — but the file now has a schema, a parser, a
  validator and a place in the diff, which is what did not exist before. The
  hand-writing is the offline path, not the gap.
- **§6 is answered in the other direction.** `acceptance.json` on the final
  run reads `evidenced: 3`, each citing the bundle in which its gate
  demonstrably failed, and the human criterion stays `human`. Delivery was
  not refused.
- **§7 is answered.** `wring deliver --send` created the branch, wrote the
  commit and pushed it to a bare `origin` on local disk. Exit 0. `--send`
  rather than the dry run deliberately: a dry run also runs the acceptance
  refusal, so exit 0 there would have proved acceptance did not block — but
  this document's claim is that the chain *completes*, and the strongest
  available form of that is a branch that exists.
- **§4 is answered, and this postscript first said it was not.** The claim
  was written from memory of the finding above rather than from the file, and
  reading the file corrected it — which is the whole reason this project
  writes things down. The brief the loop actually handed the worker opens
  `# What you are building`, quotes the PM's intent, names the task
  objective, lists all four criteria and says which gate is bound to each,
  and only then reaches the gate that failed on this lap — labelled as the
  lap's failure rather than as the job. F3 shipped separately
  ([`docs/brief-quality.md`](brief-quality.md)); what this run adds is the
  `— bound to csv-hdr` clauses, which on the day of the dry run could not
  have been written because nothing was bound to anything.
- **§5 is NOT answered, and was avoided rather than fixed.** Every check in
  the new scenario is stdlib-only, so `No module named pytest` never
  happened. That is a deliberate choice about what this recording measures.
  **F6 is exactly as open as it was**, and in a repo whose gates do need an
  installed dependency it is still the first thing that happens.

### What the re-drive found that was not on anyone's list

**One `wring verify` arms one gate.** Verify stops at the first required
failure, so on the first run after installing three gates the record showed
`gate-failed` for one and `gate-did-not-run` for two. Every criterion below
the first failure is unevidenced, which is §6's finding restated: the
acceptance verdict is only as available as the least related gate above it.
In this scenario the repair loop resolved it for free — the worker fixes the
nearest failing thing, so each gate went red on its own iteration and then
green — but that was a property of a worker that takes one step at a time. A
worker that builds the whole feature in one call would turn the remaining
gates green *without either of them ever having been red*, and those criteria
would read `unevidenced` with delivery refused. **The sequencing that arms
the gates is doing real work, and nothing currently states it as a
requirement on the worker.** That is a candidate F-blocker and it is not
fixed here.

### What this still does not prove

The scenario is one repo, one task, four criteria, and a scripted worker.
`wring fleet` — many tasks, one spec, at scale — has still never been driven
end to end, which is the half of F4 that remains outstanding. No agent wrote
any of this code. And "the chain completed" means the record was consistent
enough to ship, not that a person wanted what came out the other end.

**Correction, added 2026-08-18.** The sentence above about `wring fleet` was
true when this report was written on 2026-08-10 and **false from 2026-08-11**:
`docs/fleet-scale.md` records one approved spec, two tasks, `fleet.scope`, one
delivery, `2 succeeded, 0 failed, 0 parked`, and `wring deliver --send`
branching, committing and pushing — with the unscoped control beside it. This
report is dated evidence and is not rewritten; the correction is added here so
a reader who reaches this paragraph first is not misinformed. The other three
sentences in it still stand: no agent has written this code, the worker was
scripted, and a consistent record is not a satisfied person.
