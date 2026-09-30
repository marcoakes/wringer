Wringer 1.0.0-alpha.29 lets a failure propose a better check or workflow and
judges that proposal on held-out work against a frozen oracle. A proposal changes
how work is graded, so it never grades itself.

```sh
wring experiment gate register --input experiment.json --proposal proposal.json --source-bundle corpus.bundle --state DIR
wring experiment gate evaluate --state DIR --oracle oracle.json --yes
wring experiment gate change --state DIR --output NEW-DIRECTORY
```

Phase 5's measurement shows why the oracle matters. On one labelled corpus, a
weakened gate had the highest pass rate (100%) and caught none of four seeded
defects. A noisy gate caught three but failed two of three correct
implementations. A property gate caught all four and failed no control. A gate's
pass rate cannot tell these apart; the labels can.

Registration freezes a corpus of exact commits and trees with development and
held-out splits. It also freezes a digest of the oracle's labels, both arms' gates
pinned by content in evaluator commits, the prediction, the run budget, the wall
clock and the holdout policy. The labels stay with the evaluator until
evaluation. A proposal that names a held-out item cannot be registered. Every run
overlays the arm's pinned gate files on the item, so an item cannot rewrite the
gate that judges it.

Evaluation runs every item once in each arm, in corpus order, in a contained
verifier. A run that cannot show its exact commit and tree, a clone made inside
and no host mounts is `unavailable`. An infrastructure failure stops collection,
and the remaining runs stay in the denominator. A reservation without a record
is `uncertain` and is never rerun. With no container runtime on PATH, the command
refuses before reserving anything.

A result qualifies only on the held-out split. The candidate must catch the
predicted extra defects, add no false positives on correct controls beyond the
prediction, add no required human holds beyond the allowance, record every
planned run and never have seen a held-out item. The evaluation also records each
arm's gate latency and required holds. A workflow proposal is compared through
the gates its loops require and its required holds.

A qualified evaluation can prepare a reviewable source change. It carries the
patch, the prediction, the held-out results, the scope limits and the rollback.
Sending it to a review branch and adopting its gates for future plans are
separate confirmed actions. Adoption is revision-checked and can be undone. No
action edits an active plan, grader or approval.

New sibling records are `wringer.gate-proposal.v1`, `-oracle.v1`,
`-experiment.v1`, `-evaluation.v1` and `-adoption.v1`. Published schemas keep
their bytes. The phase has 47 isolated reversion checks, each classified by what
removing the guard changed. A compiled walkthrough drives the public binary
through proposal, sealing, registration, a refused evaluation without a runtime,
qualification, change, Send and adoption, and a weakened gate that looks greener
and fails. Its gate runs come from a separately compiled fixture runner that
really runs each gate on the exported item tree. It does not start a container.
Real containment, live agent failures as a corpus source and any rate of
improvement remain unmeasured.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. The required release jobs verify
those archives and their installer/package routes before staging publication.
GitHub publication does not itself publish an npm package, Homebrew tap or MCP
registry listing. The documented cooperative-local operator boundary remains.

[Gate and workflow proposals](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.29/docs/native/GATE_EXPERIMENTS.md)
· [Capabilities and limits](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.29/docs/CAPABILITIES.md)
· [Previous release: parallel branches](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.28)

Tournaments with a prosecutor, Temporal durability and A2A remain subsequent
phases in the restoration plan.
