# Gate and workflow proposals baseline — 30 September 2026

Measured after alpha.27's commit `e039720` passed full local validation, before any
gate or workflow experiment contract existed. This record does not qualify one.

## What the current comparison cannot express

The existing improvement experiment compares exactly one variable: the worker
playbook. Its registration refuses any other difference.

| Attempted registration | Refusal |
| --- | --- |
| Candidate plan adds a check | "Only the worker playbook may differ: source, intent, tests, grader, runtime, agents, scope, authority ceilings and protected paths must remain identical" |
| Declares `changedVariable: acceptance-gate` | "Experiments permit one worker-playbook variable, a fixed alternating sample and repository-only data" |

This is correct for a playbook experiment: a candidate that changes the grader
would be grading itself. A gate or workflow proposal therefore needs a sibling
contract whose evaluator is frozen outside the proposal.

## A labelled corpus measured against its oracle

`scripts/restoration-phase5-measure.ts` builds a real Git corpus from a buggy base
(`total` is off by one). Its seven items each commit one implementation: three
correct controls written three different ways, and four seeded defects. The
defects are a tautology for the existing example, a tautology on the held-out
split, a sign flip, and an agent that changed nothing. Labels are the frozen
oracle. Four gates run on each item's exported tree:

| Gate | Pass rate | Defects caught (of 4) | Correct controls failed (of 3) |
| --- | --- | --- | --- |
| Narrow existing check | 71% | 2 | 0 |
| Weakened check | 100% | 0 | 0 |
| Noisy check | 29% | 3 | 2 |
| Property check | 43% | 4 | 0 |

- **A weakened gate looks greener.** It has the highest pass rate and catches no
  defect. A gate's own pass rate cannot judge it; the oracle's labels can.
- **A noisy gate shows only on controls.** It catches defects, but it fails two
  correct implementations that happen not to use the same syntax.
- **A useful gate catches every seeded defect** without failing a control.
- **The narrow existing gate passes a tautology** written for its only example.
  Its own pass rate would call that change correct.

The [measurement record](evidence/phase-5/measurements/phase5-baseline.json) has
every per-item result. Each gate run takes a few milliseconds on the host here;
a contained verifier adds runtime start-up per run.

## Design inputs

1. A gate experiment freezes the corpus items, splits, a commitment to the
   oracle's labels, both gate sets, the prediction and the run budget before any
   run. The labels stay in the evaluator's private domain until evaluation.
2. Qualification is decided on the held-out split against the oracle: more
   defects caught than the baseline, no more false positives on controls, and
   every planned run recorded.
3. A proposal records its inputs. A proposal that saw a held-out item cannot be
   registered.
4. A gate's files are pinned by content and overlaid on every item, so an item
   cannot change the gate that judges it.
5. Proposal, evaluation, a reviewable source change, its separate Send and
   future-only adoption are separate recorded actions. Nothing changes an active
   plan or grader.
6. A workflow proposal is compared on the same corpus through the gates its loops
   require and the human holds it requires.

## Measurement errors retained

The first probe run failed exporting a tree: checking out into a separate work
tree conflicted with the corpus index. The second failed because an unchanged
variant produced an empty commit, which Git refuses by default. The probe now
uses `git archive` and allows the empty commit, which is a real corpus item (an
agent that claims success without changing anything).

# Implementation — 30 September 2026

The design follows the inputs above. Each item below was written test first.

## What was built

- **Sibling records.** `wringer.gate-proposal.v1`, `-oracle.v1`, `-experiment.v1`,
  `-evaluation.v1` and `-adoption.v1`. The playbook experiment and every
  published schema keep their bytes.
- **Registration.** It freezes the corpus of exact commits and trees, the splits,
  the oracle digest, both arms' gates in evaluator commits, the prediction, the
  run budget, the wall clock and the holdout policy. It refuses a proposal that
  saw a held-out item, a verifier image without a digest, a network that is not
  denied, credentials, a wrong item tree and an exhausted holdout.
- **Evaluation.** Every item runs once in each arm, in corpus order, with the
  arm's pinned files overlaid. A reservation precedes each run. A run that cannot
  show its exact item in a contained verifier is unavailable. An infrastructure
  failure stops collection, and the rest stay in the denominator.
- **Qualification.** It is decided on the held-out split against the oracle, with
  a written reason for each failed condition. Per-arm gate latency and required
  holds are recorded.
- **Workflow comparison.** A graph is reduced to the gates its loops require and
  its required human holds, then compared on the same corpus.
- **Change, Send and adoption.** A qualified evaluation prepares a patch and a
  `PROPOSAL.md` with the prediction, results, scope limits and rollback. Send
  pushes that exact commit to a non-default review branch. Adoption and undo are
  a revision-checked chain for future plans only.
- **Public route.** `wring experiment gate` and `wring experiment workflow
  register`. Spending the sample and every outward action need `--yes`. A missing
  container runtime refuses before any reservation.

## Reversions

`scripts/restoration-phase5-reversions.ts` removes each guard alone in an isolated
copy. All 48 went red and were restored: a refusal vanished in 21, recorded state
changed in 23, and a different guard refused in 4. Four guards are listed as
layered rather than claimed: the oracle's own label set and digest, the
proposal's own digest, the qualification-time leakage reason and the remote's
confirmation of a sent commit, which no fixture remote can falsify. See the
[reversion record](evidence/phase-5/reversions.json) and
[effects](evidence/phase-5/effects.json).

## Measurement errors retained

Each failed first run is kept in the evidence folder.

- The [first red run](evidence/phase-5/initial/application-first-red-stubs.log)
  used stubs so that the tests failed on behaviour, not on a missing module.
- The [second run](evidence/phase-5/initial/application-second-run-5s-timeouts.log)
  failed every corpus test at Bun's 5 s default timeout. That was a harness
  limit, not behaviour; each corpus test now allows 120 s.
- The [third run](evidence/phase-5/initial/application-third-run-push-refspec.log)
  failed because the test pushed an unqualified refname to its fixture origin.
  It now pushes `HEAD:refs/heads/main`.
- The [fourth run](evidence/phase-5/initial/application-fourth-run-prepare-message.log)
  matched the Send refusal case-sensitively and missed "Prepare".
- The walkthrough's [first run](evidence/phase-5/initial/walkthrough-first-run-compile-cwd.log)
  compiled the fixture driver from the wrong working directory.
- The public gate help was unreachable: the generic `--help` answer ran first,
  and the first help test passed only because the generic text also mentions a
  frozen oracle. The route now answers gate help, and the test checks text that
  only the gate help contains.
- Two test expectations were wrong before implementation: the baseline misses
  two held-out defects, not one, and the missed-prediction case needs a threshold
  of three.
