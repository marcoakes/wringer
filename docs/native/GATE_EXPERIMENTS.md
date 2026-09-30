# Gate and workflow proposals

A failure can suggest a better check or a different workflow. That change alters
how Wringer judges work, so it cannot grade itself. A gate experiment compares
the proposed checks with the current ones on a labelled corpus. An evaluator
judges the result on the held-out split against a frozen oracle, never by the
gate's own pass rate.

```text
propose → seal oracle → register → evaluate → change → Send (review branch) → adopt for future plans
             (evaluator)   (frozen)   (held-out vs oracle)   (separate)          (separate, revision-checked)
```

Each arrow is a separate recorded action. None changes an active plan, grader or
approval. [Measured playbook improvements](EXPERIMENTS.md) remain the route for
comparing worker playbooks; this route exists because a playbook comparison
correctly refuses a different grader.

## Why the oracle, not the pass rate

The [phase 5 baseline](../restoration/PHASE_5_MEASUREMENTS.md) ran four gates on
one labelled corpus:

| Gate | Pass rate | Seeded defects caught | Correct controls failed |
| --- | --- | --- | --- |
| Narrow existing check | 71% | 2 of 4 | 0 of 3 |
| Weakened check | 100% | 0 of 4 | 0 of 3 |
| Noisy check | 29% | 3 of 4 | 2 of 3 |
| Property check | 43% | 4 of 4 | 0 of 3 |

The weakened gate looks greenest and catches nothing. The noisy gate catches
defects by failing correct work. Only the labels tell them apart.

## What is frozen before any run

`register` refuses to start unless all of these are fixed:

- **The corpus.** Every item is an exact commit and tree in a bundle, with a
  declared `development` or `held-out` split.
- **An oracle commitment.** The registration holds only the digest of the
  oracle's labels. The labels stay with the evaluator until evaluation.
- **Both arms' gates, pinned by content.** Each arm's files are committed into an
  evaluator-owned commit. Every run overlays them on the item, so an item cannot
  rewrite the gate that judges it.
- **The prediction.** It names the extra held-out defects the candidate must catch,
  the false positives it may add, and the minimum held-out defects and controls.
- **The sample.** Every item runs once in each arm, in corpus order, under a run
  budget and a wall clock. There are no extensions.
- **Holdout policy.** A proposal lists every item its author looked at. If it names
  a held-out item, it cannot be registered. The candidate iteration is bounded, so
  held-out items cannot be reused for endless tuning.
- **A contained runtime.** The verifier image is pinned by digest, the network is
  denied and the gates receive no credentials.

## Run one

```sh
wring experiment gate propose --input proposal-input.json --output proposal.json
wring experiment gate oracle --corpus totals --labels labels.json --output oracle.json
wring experiment gate register --input experiment.json --proposal proposal.json \
  --source-bundle corpus.bundle --state gate-experiment
wring experiment gate evaluate --state gate-experiment --oracle oracle.json --yes
wring experiment gate status --state gate-experiment
```

Keep `labels.json` and `oracle.json` outside every repository a proposer or
worker can read. `evaluate` needs `--yes` because it spends the fixed sample. If
no container runtime is on PATH, it refuses before reserving any run, so the
sample stays intact.

`status` exits 0 when qualified, 3 when evaluated but not qualified, and 2 on a
refusal. This is the packaged walkthrough's weakened gate. Its runs come from the
fixture runner, which reports 1 ms per gate command:

```text
Evaluated against the frozen oracle (deterministic-fixture): not qualified.
  Baseline  caught 2/4 held-out defects · failed 0/2 correct controls · pass rate 67% · required holds 0 · 8 gate runs in 8 ms
  Candidate caught 0/4 held-out defects · failed 0/2 correct controls · pass rate 100% · required holds 0 · 8 gate runs in 8 ms
  - the candidate catches fewer held-out defects than the baseline (0 against 2), however green it looks
```

## How a result qualifies

A comparison qualifies only when all of these hold on the held-out split:

- every planned run in both arms has a recorded pass or fail;
- the held-out split has at least the registered number of defects and controls;
- the candidate catches at least the predicted number of extra defects;
- it adds no more false positives on correct controls than the prediction allows;
- it adds no more required human holds than the allowance;
- the proposal never saw a held-out item.

Each failed condition is written into the evaluation as a reason.

A gate run counts as `unavailable` when the runner cannot show that the exact
item ran in a contained verifier. That covers another commit, another tree, a host
mount, a clone made outside, a role other than verifier, a missing gate result or
an infrastructure exit code. An infrastructure failure stops collection, and the
remaining runs stay in the denominator as `not-started`.

A run reserved without a record, for example after a crash, is `uncertain` and is
never rerun. A second `evaluate` returns the recorded evaluation.

Latency is the gate commands' reported time per run and per arm. Intervention cost
is the number of required human holds.

## Workflow proposals

A workflow arm is the set of gates its loops require plus its required human
holds. `wring experiment workflow register` takes `baselineGraph` and
`candidateGraph` files, and `gateFiles` holding the pinned content of every check
file. Both graphs must pin the corpus base. The proposal's candidate gates must be
exactly the gates the candidate graph requires. The comparison then runs like a
gate comparison.

This compares recorded candidates statically. It is not a live run of either
graph, and it says nothing about agent behaviour inside the graph.

## Change, Send and adoption

1. **`change`** works only on a qualified evaluation. It writes `change.patch`,
   which adds the candidate's pinned gate files to the corpus base, and
   `PROPOSAL.md`. That file holds the rationale, the registered prediction, the
   held-out results, the scope limits and the rollback. It also copies the
   records. Nothing is sent.
2. **`send`** pushes that exact commit to a review branch on a
   credential-free remote, and needs `--yes`. It refuses `main`, `master`, the
   remote's default branch, an existing branch with other content and a second
   Send. It records the intent before the push and confirms the exact commit
   afterwards. Opening the merge request and merging go through your normal
   source review and release.
3. **`adopt`** appends a revision-checked record that selects the candidate gates
   for future plans in that task family only. **`undo`** appends a record that
   returns to the previous selection. **`selections`** shows the current one. The
   history refuses a missing record or one linked to the wrong previous record.

## Scope limits

- The evidence covers one task family, repository base, corpus and verifier image.
  A different model, image, check family or task family puts it out of scope.
- The repository's fixture walkthrough runs every gate on exported item trees.
  It does not start a container, so real containment stays unmeasured there.
- No gate experiment edits the engine, an active plan, a grader or an approval.
  Harness, policy and evaluator code change only through ordinary source review.
