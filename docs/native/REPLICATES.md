# Replicate sets: the same plan, k times

A single run of a job tells you what happened once. A replicate set runs the same
approved plan k times, from the same source, and reports where the attempts
disagreed: which checks passed in one attempt and failed in another, where each
attempt first went wrong, whether the loop decisions and the candidates matched.

It says **where** the attempts disagreed, never **why**. No model reads the
report, and nothing in it is a claim that one approach is better. A later
proposal for a better way of working can cite it; the proposal still has to win
a registered comparison before anything changes.

## Run one

For an ordinary job whose future improvements are connected
(`wring experiment connect --job JOB_ID --task-family FAMILY`), after the job has
run once:

```sh
wring experiment replicate register --job JOB_ID --task-family FAMILY --replicate-set ID --k 3
wring experiment replicate grant --job JOB_ID --replicate-set ID --actor NAME --expires ISO_TIME --output grant.json
wring experiment replicate collect --job JOB_ID --replicate-set ID --grant grant.json --yes
wring experiment replicate status --job JOB_ID --replicate-set ID
```

`register` takes the job's approved plan and the source tree its journey measured,
and needs nothing else. `k` is 2 to 5, and 3 by default. With a private directory
instead of a job, use `--state PRIVATE_DIR` and register from a JSON file naming
`{id, taskFamily, plan, k, sourceTree, wallClockSeconds}`.

## What is kept

- **Everything is reserved first.** `collect` reserves all k attempts before any
  source, runtime, credential or model activity. Its allowance is the grant's,
  separate from the job's approval, and it never extends.
- **Every outcome stays in the denominator:** completed, held for a person,
  stopped, infrastructure failed, uncertain or not started.
- **An interrupted attempt is reconciled from what it retained,** never replayed.
  The set then stops, and the attempts after it are recorded as not started.
- **The budget identity is asserted after collection.** Every reservation is one
  record, none is recorded twice, and none is recorded without its durable
  dispatch marker. A violation is recorded and refused, never repaired.
- **Replicates are research evidence.** They never enter ordinary failure
  patterns and are never delivered.

## The divergence report

[`divergence-report-v1`](../../schema/divergence-report-v1.schema.json) is a pure
projection of the records and the validated journals:

| Part | What it compares |
| --- | --- |
| `checks` | Each check's final status per attempt |
| `judge` | Each requirement's judgement per attempt |
| `loopDecisions` | The sequence of loop decisions per attempt |
| `candidates` | Whether the attempts produced the same tree |
| `replicates[].firstFailure` | The worker attempt at which each first failed, classified as for failure patterns (environment, product check, agent finding) |

Each part is `agree`, `diverge` or `incomplete`; `diverging` lists the parts that
diverged. Two attempts can produce different trees while every check agrees:
that is a different change, not a different result.

## Limits

Fixture replicates test the mechanism. Only live replicates describe an agent's
variance, and k of at most 5 is a small sample. Live replicates need a signed-in
coding agent and spend on its plan. The fixture records say so.
