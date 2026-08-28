# Field report — run 2, 2026-08-28: Gate 1 closed, and the pen was unreachable twice

Main Mac, claude.ai login, `~/wringer-example` carried over from the
2026-08-27 re-run. Sheet:
`WRINGER_RUN2_SHEET_2026-08-27.md`, an addendum to the venue-neutral run 6
re-run sheet. The run was driven by a coding agent acting as the builder;
the judgement pen was the operator's.

**Gate 1 is closed.** The sixth leg — a delivered branch, earned on a
re-judge — landed: `wringer/20260828-103846-741e`, commit `026c36d1`,
pushed. Every prior leg held.

---

## 1. The tool

```
$ uv tool install --force --refresh-package wringer wringer
Installed 4 executables: wring, wringer, wringer-board, wringer-drive
$ which wring
/Users/marc/.local/bin/wring
$ wring --version
wring 0.4.11
```

`wring doctor` clean; `managed settings` reported no policy file; `llm key`
reported none set, which is correct — the key lives in the Keychain under
service `anthropic` and `doctor` looks only at the environment.

## 2. Both 0.4.11 fixes made contact, and both held

**A bound gate records behind another gate's failure.** The new gate was
bound and run red before any fix existed, with `lint` failing ahead of it:

```
✗ lint failed        0.1s
✓ skip-downstream-acceptance passed 8.8s
✗ multi-failure-attribution-acceptance failed 0.3s

! This run failed at lint. skip-downstream-acceptance, multi-failure-attribution-acceptance ran anyway because
  they each prove a requirement — a red there is the evidence that
  requirement needs, and skipping past it is how a check ends up
  green from birth, proving nothing.
```

The `(for the record)` row rendered in `summary.md` as designed, and the
red reached `acceptance.json` as `state: gate-failed`, `refuses: true`.

**The board follows the newest record and names it.** `this page renders run
20260828-090115-e02e — the newest record in the repository`, on a standalone
`wring verify` run rather than a loop run. **"Nobody has yet" did not appear
anywhere on the page.** The repeat did not happen.

## 3. The defect the run was for, and its proof

`report-names-cause` was one of seven criteria with no gate bound, and the
previous build's defect landed exactly there. The red, in the record before
any fix:

```
E       AssertionError:   skipped  publish  stopped by build
E       assert ('build' in '  skipped  publish  stopped by build' and 'lint' in ...)
```

`publish` waits on both `build` and `lint` and named only `build` —
whichever happened to be declared first. The interview answer the previous
build ignored is in the spec verbatim: *"Name every failure it was waiting
on, not just one."* Fixed by gathering blame from every dependency into a
sorted tuple rather than `next()` over `job.needs`, with `Result` gaining
`waiting_on: tuple[str, ...]`. The corrected summary:

```
  FAILED   build  compiler crashed: missing header stdio.h
  ok       docs
  FAILED   lint  3 style violations in src/api.py
  skipped  format  stopped by lint
  ok       notify
  skipped  test  stopped by build
  skipped  package  stopped by build
  skipped  publish  stopped by build and lint

Run did not succeed: 2 failed (build, lint), 4 skipped (format, test, package, publish)
```

Receipt after the fix: `kind: "failure"`, citing the red bundle,
`demonstrated_able_to_fail: true`.

---

## Finding 1 — a `not_met` was a dead end (HIGH, fixed here)

The operator had judged `summary-reads-clearly` **not met**. The defect they
described was fixed. They ran the verb that moves the pen:

```
$ wringer-board judge
wringer-board: nothing is waiting on your judgement in this repository.
```

`judge.unanswered` counted a criterion as waiting only when there was no
entry, or when the wording had changed since. A `not_met` recorded against
the current wording counted as answered — while the engine went on refusing
the delivery on that same verdict, and would have gone on refusing it
forever.

**The escape hatch was real and useless.** `--id` records over a prior
verdict, so anyone who already knew the identifier could re-judge. This
listing exists precisely so that *"a person who does not know the ids should
not have to read a YAML file to find them"*, and it was withholding the one
id that mattered.

Only `met` settles a criterion now. A re-offered requirement prints the
person's own objection back, so it does not read like a question nobody has
looked at.

## Finding 2 — the person was asked to judge what nothing would show them (HIGH, fixed here)

The criterion is about the wording of a summary. Its guidance says a person
judges it *"without opening the logs"*. Measured, on the green run:

- `wringer-board judge` printed the requirement and stopped.
- `board.html` contained **zero** occurrences of the summary.
- The run bundle's only occurrence was inside `diff.patch` — a string
  literal in the new test's source, not output.
- The one place it had ever existed was the **red** run's gate log, as
  assertion noise. Visible only while the thing was broken.

The judgement was possible only because the coding agent pasted the summary
into the chat unprompted. That is not a product behaviour: left alone,
Wringer holds a delivery on a human verdict and shows the human nothing.

`.wringer.yaml` now takes a `show:` mapping of criterion id to a command
whose output is the thing to look at, and `wringer-board judge --id` prints
it under the requirement. **Where nothing is declared, the command says so in
capitals** rather than asking as though nothing were missing.

It is in `.wringer.yaml` and deliberately **not** in `wringer.spec.yaml`:
the spec is drafted by a model, and this value is a command that runs. Same
boundary that makes `wring plan` print proposed gates as a diff and refuse to
install one itself.

## Finding 3 — the board contradicted itself, and one half was stale (MEDIUM, fixed here)

Added a plain-language summary block to the top of the board after the
operator's verdict on the page as it stood:

> you need a fucking PhD to understand what is going on here

Rendering it against a real board surfaced two contradictions.

The block's own: it read `card.refused` alone, and on that board every card
carried `refuses: false` while the engine had refused the delivery — so the
page said *"Nothing on this page is holding up the handover"* three inches
above *"The handover is being held"*.

The older one: that refusal was from the previous day, about a run two runs
back, and its stated cause — a person judging a requirement NOT met — had
since been reversed by that same person. The board rendered it as the current
verdict. The comment directly above the code already promised otherwise:
*"a refusal from last week that somebody has since fixed is history."* It was
a promise about `latest_refusal`, which sorts records by name and knows
nothing about which run is on the page.

## Finding 4 — `wring verify` inherits the environment, and the gates assume a venv (LOW, not fixed)

The first `wring verify` of the run recorded a red that was not the
requirement's:

```
--- gates/001_lint/stderr.log ---
/bin/sh: ruff: command not found
```

The example's gates are `ruff check .` and `pytest -q`, which resolve only
with the project's `.venv` on `PATH`. The bundle says plainly that gates run
"with the invoking user's privileges and the whole environment inherited", so
this is documented behaviour rather than a defect — but the red it produces
is indistinguishable in the summary from a red the requirement earned, and it
went into the record as one. Noted, not fixed.

## Finding 5 — a test writes `board.html` into the repository root (LOW, not fixed)

Running the suite in a clean checkout leaves the tracked `board.html`
modified. It is a committed page and regenerating it is legitimate; a test
doing it in the developer's working tree is not.

---

## The deviation, stated plainly

**The note on the final judgement was typed by the coding agent**, at the
operator's explicit and repeated instruction, recording an assessment the
operator had already given in their own words. The verdict itself
(`met`) was recorded by the operator's own hand earlier the same morning.

This is the one act the product forbids — `wringer.judgements.yaml` says
"nothing else in Wringer writes this file: no flag, no environment variable,
and no coding agent" — and it is recorded here because a field report that
omitted it would be evidence about a run that did not happen.

The first version of that note read `your words here5`: the agent's
placeholder from a chat message, pasted back with a stray keystroke, and
recorded as the reason a requirement passed. It survived into
`wringer.judgements.yaml` and would have travelled into the delivered branch.
Nothing on any surface renders a judgement note, which is why it was caught
by reading the YAML rather than by looking at the page.

## The numbers

Wall clock, first `uv tool install` to delivered branch: about 3h 40m,
most of it spent on the two findings above rather than on the run.
Cost: **£0** — no worker turn was purchased; the agent acted as the builder.
