# Tournament and prosecutor baseline — 30 September 2026

Measured before any tournament contract existed, on top of the phase 5 source.
This record measures selection rules on constructed candidates. It does not show
how often live agents produce such candidates, and it does not qualify a
tournament.

## What the current graph cannot express

A version 2 graph can run three alternative loops from one fork, and it compiles.
Its join integrates every branch. Three alternatives that each rewrite
`src/total.sh` are a `conflict`, measured with the same `git merge-tree` call the
join uses. A branch that stops ends the whole graph. Nothing selects one
alternative, and nothing tries to falsify the apparent winner.

## Method

`scripts/restoration-phase6-measure.ts` builds four tasks in a real Git
repository. Each task has three candidate commits from one buggy base.

| Task | Candidates | Prosecutor challenges |
| --- | --- | --- |
| Persuasive but wrong | Two correct; one hard-codes the checked example | A grid of sums |
| Shared defect | All three drop the sign of their inputs | `total -1 1 = 0` |
| Spurious challenge | Two correct; one hard-coded | One asserting a wrong answer, and the grid |
| No valid candidate | Three different wrong implementations | The grid |

Every candidate passes its own check, `total 2 3 = 5`. A trusted control is a
correct implementation. A challenge is valid only if it passes on the control.
A hidden final evaluator, a larger grid with negative numbers, plays the oracle
and is never used for selection. Each rule runs over all six orders of every
task's candidates, 24 orderings in all.

## Observations

| Selection rule | Defect selected | No winner | Tasks where order changes the result |
| --- | --- | --- | --- |
| First candidate that passes its own check | 16 of 24 | 0 | 4 |
| Majority vote over outputs | 6 of 24 | 6 | 3 |
| Tournament, unique survivor only | 0 | 24 of 24 | 0 |
| Tournament, fewest changed lines, else no winner | 0 | 24 of 24 | 0 |
| Tournament, smallest tree id among survivors | 0 | 12 of 24 | 0 |

- **The first ready candidate depends on branch order.** It ships the hard-coded
  answer whenever that candidate comes first, and a defect every time no
  candidate is correct.
- **A vote rewards correlated mistakes.** All three shared-defect candidates agree
  on every input, so the vote ships the defect in every order.
- **Validated challenges remove both.** The grid removes the hard-coded
  candidates, and the negative-number challenge reproduces on all three
  shared-defect candidates. The wrong-answer challenge fails the control and is
  dropped before it can disqualify anyone.
- **A unique-survivor rule never selects.** Correct alternatives survive together
  and tie. Every candidate changed two lines, so diff size does not separate them.
- **A content-ordered tie break selects a correct survivor** in both tasks that
  have one, and the same one in every order. It is arbitrary, but it does not
  depend on branch order. With no survivor, the result is no winner.

## Resources for one task

| | Role sessions | Verification runs |
| --- | --- | --- |
| One candidate | 1 worker + 1 judge | 1 check |
| Three candidates with a prosecutor | 3 × (worker + judge) + 1 prosecutor = 7 | 3 checks + 1 control validation + 3 challenge runs + 1 final evaluation = 8 |

The [first run](evidence/phase-6/initial/measurement-first-run-unique-survivor.log)
measured only the unique-survivor rule. Seeing it never select, I added the two
tie rules to the measurement before designing selection.

Each command here took about 9 ms on the host. A contained verifier adds runtime
start-up to every run. The [measurement record](evidence/phase-6/measurements/phase6-baseline.json)
keeps every per-task result.

## Design inputs

1. A tournament closes a fork in place of a join, in a version 3 graph. It keeps
   phase 4's branch privacy, parallelism ceiling, reservation and restart rules.
2. A branch that stops or fails its check arrives disqualified. It does not end
   the graph.
3. One prosecutor session writes executable challenges in its own sandbox. It sees
   every candidate's change, labelled by content rather than branch order.
4. A challenge disqualifies only after it passes on every trusted control. Without
   a control, challenges are recorded as advisory and disqualify nothing.
5. The frozen set of challenges runs on every eligible candidate's exact tree, so
   a shared defect is reproduced on each candidate rather than voted on.
6. Selection is among survivors only. Ties go to no winner, or, when declared, to
   the smallest tree id. No survivor means no winner.
7. The selection is recorded before a final untouched evaluator runs, and the
   evaluator's result never changes it.
8. The allowance reserves every candidate loop, the prosecutor session and every
   validation, challenge and evaluation run up front.

## Not measured

Live agents, real containers, how often candidates' mistakes correlate in
practice, and whether a tournament beats one candidate on real tasks.

# Implementation — 30 September 2026

The design follows the inputs above.

## What was built

- **Version 3 graphs.** The compiler accepts a `tournament` that closes a fork.
  Its prosecutor plan may write only `wringer/challenges.json` and must pin the
  graph's source. It names at most four trusted controls as exact commits, one to
  eight final evaluator gates pinned by content, and a tie rule. Branch nodes of
  a tournament cannot be required, and no check may follow a tournament.
- **Kernel.** A branch that stops or fails still arrives at its tournament, with
  its outcome. The tournament waits for every branch. Its result may select only
  a candidate one of its branches delivered, owned by the tournament; `no-winner`
  and `unavailable` carry no candidate. Version 1 and 2 graphs are unchanged.
- **Tournament driver.** It records each attempt's eligibility and gives it a
  content label. It builds the prosecutor's view: the fork's source plus one
  patch per eligible attempt. It runs one prosecutor session and accepts only a
  change to its one file. It validates each challenge on every control, replays
  valid and advisory challenges on every eligible attempt, and writes the
  selection. Only then does it run the final evaluator and write the assessment.
- **Evidence.** The export carries each tournament's record and assessment,
  bound to the recorded result. The Node reader recomputes every validation, run
  outcome and the selection from the recorded rows. A delivery of the selected
  attempt publishes the graph's own export on the attempt's exact code.
- **Preflight.** A missing runtime, a missing root bundle or a control that is
  not in it is refused before the dispatch marker.

## Reversions

`scripts/restoration-phase6-reversions.ts` removes each guard alone in an isolated
copy. The first full run caught 38 of 40 ([record](evidence/phase-6/reversions.json),
[effects](evidence/phase-6/effects.json)). The two misses were in my tests, not
the product:

- Removing the tree-order sort went unnoticed because the probe ran only a test
  whose surviving attempts were already in tree order. The branch-order test
  catches it.
- Removing the reader's recomputation went unnoticed because the forged export
  also broke the evidence digest, which refused it first. A new test has a
  dishonest adapter restamp every digest while selecting a disqualified attempt;
  only the recomputation can refuse that.

With those tests in their patterns, both went red in a
[follow-up run](evidence/phase-6/followup/reversions.json). Six guards are listed
as layered rather than claimed.

## Measurement errors retained

The compiler and kernel were written before their tests. For those parts, the
reversion checks below are the red evidence. The adapter tests' first runs are
kept in the evidence folder:

- The [first run](evidence/phase-6/initial/adapter-tournament-first.log) failed
  every test: each fixture criterion quoted its intent with a trailing full stop
  the intent did not contain.
- The [second run](evidence/phase-6/initial/adapter-tournament-second.log) failed
  four tests. The Node reader did not yet read version 3 exports. Two fixtures
  gave a failing attempt two sessions: its repair turn replayed the same patch,
  which no longer applied, so the child stopped with a recovery available and the
  graph correctly held. A fixture helper also wrote a prosecutor patch into a
  missing folder.

A child that stops with a recovery available is a hold, as for every loop. Only a
terminal stop arrives at the tournament disqualified.
