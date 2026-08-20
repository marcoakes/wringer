# The example — a requirement, a real agent, and proof it was red first

**One command sets it up, one command drives it.** About four minutes, most of
it waiting for a model.

```sh
sh setup.sh ~/wringer-example
```

Then follow the two steps it prints. That is the whole thing.

## What you are looking at

`project/` is a small pipeline runner — a job graph with dependencies, a
runner, a text summary, a command line. Four modules, four test files, 18 tests
green, lint clean. It is not a toy and it is not scaffolding: it does something,
and the thing you are about to ask for is genuinely fiddly.

`PRD.md` is four paragraphs of ordinary English. No acceptance criteria, no
file paths, no function names, no YAML — the document a product manager
actually writes. It asks for one thing:

> If a step fails, anything waiting on it — directly, or further down the
> chain — should not be attempted at all. […] The summary should say plainly
> which steps were not attempted, and for each one it should name the failure
> that caused it.

Nothing in the project does that yet.

## The one convention that makes this work

`project/README.md` says it, and it is the reason a proof is possible at all:

> `tests/` is the suite that must stay green — `pytest -q` runs exactly that.
> `acceptance/` holds executable specs: checks written from a requirement
> *before* it is built. They are red until the feature lands, which is why they
> are not in the default run.

So `acceptance/test_skip_downstream.py` already exists, was committed before
any of the work, and **fails today**. `setup.sh` refuses to hand you a copy
where that is not true.

That check is what makes the ending mean something. A green tick proves nothing
unless the same check is on the record having failed.

## What you should see

Roughly ten questions, then two decisions that are yours.

**The plan**, before anything is built, listing every requirement and how each
will be proved — including the ones where the honest answer is
`NOTHING CHECKS THIS YET`. You say yes or no.

**The checks**, as an exact diff to the project's settings, with an offer to
run them against the project as it stands first. Say yes to that: a check that
already passes cannot show the difference the work makes, and this is the
moment you can still do something about it. Here it will report
*None of them passes today*, which is the answer you want.

**The build.** Your coding agent gets the failing check and the requirement,
and writes the code. Wringer never writes code.

**The board**, at `board.html`. Open it.

> **DONE — AND PROVED** — A step whose dependency failed is never executed,
> directly or transitively
> **It was red first.** *This check has been recorded failing — the run that
> failed it is in this repository's evidence.*

## And then it refuses

The run exits non-zero, and that is the product working rather than a fault.

One requirement in this spec — *a reader can tell from the summary which single
thing to go and fix* — is one no machine can decide. Nobody has answered it, so
the handover is held. Wringer will not resolve that for you and there is no
flag that makes it.

Several other requirements will come back with nothing checking them. They are
reported as unproved rather than quietly counted as done.

## What this does not show

One repository, one requirement, one language, one agent. The agent runs
**uncontained** — the one verb has no way to declare containment yet. And a
proved criterion means the bound check passed and has demonstrably failed
before; it does not certify that the change is the one you had in mind.

The full four-run capture, including two drives that went wrong and why, is at
[`docs/demo-2026-08-19.md`](../../docs/demo-2026-08-19.md).
