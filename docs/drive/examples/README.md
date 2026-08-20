# Two examples, both driven end to end before they were committed

Each one is **one command to set up and one command to run**, and each has been
through the whole chain on a real model with a real coding agent. The numbers
below are from those runs, not estimates.

| | what you ask for | language | ending reached |
|---|---|---|---|
| [`pipeline/`](pipeline/) | a failing pipeline step should stop its downstream steps being attempted, and the summary should say which failure blocked each one | Python | **DONE — AND PROVED** |
| [`arcade/`](arcade/) | an arcade of four browser games should remember what you played and offer it back | JavaScript | **DONE — AND PROVED** |

Start with either. `pipeline/` is the smaller read; `arcade/` is the one whose
checks need no dependencies at all — Node's own test runner, no `npm install`.

```sh
cd pipeline && sh setup.sh ~/wringer-example
```

```sh
cd arcade && sh setup.sh ~/arcade-example
```

Both scripts **refuse to hand you a broken copy**. Each example's value rests on
one fact — the project's own suite is green and its acceptance check is red — and
the script verifies all of it before printing the two commands to run next. If
either has stopped being true, you get an error instead of a demo that quietly
demonstrates nothing.

## What they have in common, and why it matters

Both repositories keep **executable specs** in an `acceptance/` directory:
checks written from a requirement *before* it is built, deliberately outside the
default test run, red until the feature lands.

That convention is the whole reason either can reach a proof. A check written
alongside the code it judges passes because somebody wrote it to; a check that
was already there, and is on the record having failed, is the only kind that
tells you the work did anything.

If your own repositories do not work this way, that is worth knowing before you
start — see step 3 of [START-HERE](../START-HERE.md).

## What neither of them shows

The coding agent runs **uncontained**: driving with one verb gives it the same
access you have, and there is no way to change that from the one verb yet.

And a proved requirement means the bound check passed and has demonstrably
failed before. It does not certify that the change is the one anybody intended
— see [the four endings](../docs/ENDINGS.md).
