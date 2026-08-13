# The benchmark harness

**This runs Wringer. It is not Wringer.** It lives outside `src/wringer/` on
purpose and is pruned from the distribution: nothing here is importable from the
package, and the package does not need it.

Contract: [SPEC_BENCHMARK_V0.md](../SPEC_BENCHMARK_V0.md). Design legwork:
`~/Claude/WRINGER_BENCHMARK_DOSSIER.md`.

## The claim, stated so it can lose

> **`delivery_eligible` is a better predictor of *actually correct* than *the
> agent says it is done*.**

Not "Wringer completes more tasks" — a refusing system completes fewer. Not
"Wringer's gates go green" — that is the thing under suspicion. One table
decides it:

|                          | held-out PASSES  | held-out FAILS       |
|--------------------------|------------------|----------------------|
| agent declared done      | `true_confidence`| **`false_confidence`** |
| Wringer says deliverable | `true_confidence`| **`false_confidence`** |

The number that decides the claim is the bottom-right cell against the
top-right. **The claim loses** if Wringer's false-confidence rate is not
materially lower, or if its false-refusal rate is high enough that the precision
is not worth the throughput.

**What gets published on a loss, decided before any number exists:** the rows,
whole, plus every deviation, plus this file. Deciding afterwards is how a
benchmark becomes marketing.

## Running it

```bash
sh benchmark/tasks/demo/build.sh narrow
sh benchmark/tasks/demo/build.sh covering
python3 benchmark/harness.py --task benchmark/tasks/demo-narrow.yaml --out /tmp/rows
python3 benchmark/harness.py --task benchmark/tasks/demo-covering.yaml --out /tmp/rows
```

Both demo tasks use a **scripted worker and a fake upstream test**. Nothing calls
a model, so they run in the suite on every push and cost nothing. They prove the
*harness*; they prove nothing about agents.

## What the two demo tasks measured, on this machine

Real output, both tasks, zero cost:

```
demo-narrow-gates    a_native     false_confidence   agent exit 0
demo-narrow-gates    b_wringer    false_confidence   wring deliver would deliver this (dry run, exit 0)

demo-covering-gates  a_native     false_confidence   agent exit 0
demo-covering-gates  b_wringer    true_refusal       wring deliver refused on the evidence: its gates did not pass (`test` failed)
```

The scripted worker writes a **tautological fix**: it hardcodes the case named in
the issue. Upstream's held-out test fails it in both tasks. The two tasks differ
only in the repository's own test suite.

**The finding, and it is not flattering: Wringer's precision is bounded by the
quality of the gates the repository wrote down.** In `demo-narrow-gates` the
repo's own test covers only the reported case, the tautological fix goes green,
and `wring deliver` says yes — Wringer bought nothing, and the harness says so.
In `demo-covering-gates` the same fix cannot pass a gate that covers the general
case, and the refusal is earned.

A demo that could only produce the flattering cell would be an advert. Both tasks
ship, and both run in the suite.

## What is NOT claimed

Every row carries these, because a limit that lives only in a design document is
a limit nobody reads:

- **The held-out suite measures agreement with upstream's fix**, not satisfaction
  of the requirement. A different-but-correct implementation fails it. That is a
  false negative in the *ground truth itself*, and it inflates the measured
  false-**refusal** rate rather than the false-confidence rate — conservative in
  the direction that matters, generous in the direction that flatters.
- **Arm A's claim is its exit code.** An agent that exits 0 having done nothing is
  recorded as claiming success, because that is what a caller with no harness
  would believe.
- **The arms differ in prompt as well as in supervision.** Arm B is handed a brief
  built from failing gates; arm A is handed the task statement. That is the
  treatment, and every row lists it as a deviation. "The same agent" without
  "given different information" would be overclaiming.
- **One attempt per arm per task.** Agents are stochastic, so a single row is a
  draw and not a measurement.
- **A void row contributes to no rate**, and whoever picks the tasks can pick the
  result. The selection rule and the excluded tasks must be published beside any
  number from here.

## The two ways an experiment goes void

Both are recorded outcomes rather than footnotes, and `VOID` contributes to no
rate.

**1. The held-out signal was reachable.** `check_isolation` refuses before either
arm runs, if the held-out file is already in the working tree, if a declared
gate's command mentions it, or if the task statement mentions it. If a worker can
read the test it is scored against, the experiment is over — it is the "worker
writes its own success criterion" defect at the benchmark's own level.

**2. An arm never produced a claim.** Arm B counts a refusal only when
`wring deliver` exited **1** — refused *on the evidence*. Exit 2 or 3 is a config
or precondition problem, and Wringer never reached a verdict about the change.

That second rule was found the hard way and is the most important thing in this
directory. The first run of this harness scored arm B a `true_refusal` on the
demo — because the demo repo had no reachable `origin`, so `wring deliver` exited
3 before looking at any evidence. **A constant refuser scores perfect true-refusal
on every failing task and perfect false-refusal on every passing one**: precision
bought by an accident of the machine, in exactly the direction that flatters the
claim under test.

## What has not been run

**No corpus run.** Roughly $80–400 for one pass over 10–20 real tasks in 3–5
repositories, and it is Marc's to approve. Until then this harness has been proven
on two scripted tasks and has measured nothing about any agent.

Absent, and named rather than implied:

- a corpus, and the selection rule that must be written before any task runs;
- aggregation across tasks — there is no `summarise` command, because a rate over
  two scripted rows would be a number worth nothing;
- the third arm the dossier names (identical prompt, Wringer observing only),
  which would separate *supervision* from *better prompting* and costs a third
  more.
