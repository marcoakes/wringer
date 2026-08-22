# The benchmark harness

**This runs Wringer. It is not Wringer.** It lives outside `src/wringer/` on
purpose and is pruned from the distribution: nothing here is importable from the
package, and the package does not need it.

Contract: [docs/specs/SPEC_BENCHMARK_V0.md](../docs/specs/SPEC_BENCHMARK_V0.md). Design legwork:
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

## When there is credit on the account

Everything else is wired. Check it, spending nothing:

```bash
sh benchmark/tasks/demo/build.sh agent benchmark/tasks/demo "$(command -v python3)"
python3 benchmark/preflight.py --task benchmark/tasks/smoke-real-agent.yaml
```

`preflight.py` **makes no API call** — it verifies the agent binary and its
package version, the Keychain entry's presence (never its value), the task file,
and the held-out isolation, then reports the one precondition it cannot check.
When it prints `READY — and the ONLY thing left is money`, it means that.

Then, in order:

| step | command | cost |
|---|---|---|
| 1. smoke | `python3 benchmark/harness.py --task benchmark/tasks/smoke-real-agent.yaml --out results/` | ~$1–3 |
| 2. corpus | select tasks against [CORPUS.md](CORPUS.md)'s rule, **then** run them | ~$80–400 |

**Do step 1 first.** `smoke-real-agent.yaml` is a planted bug in a repo we own,
and it is deliberately *not* a corpus task — `CORPUS.md` §5 keeps it out of the
table, because one draw of one task we control measures nothing about any agent.
Its whole job is that the $80–400 is not the first time a real model meets this
harness.

A run with no credit fails at the agent's first turn and records **VOID** for that
arm. It will not be mistaken for a refusal.

## What has not been run

**No corpus run**, and **nothing selected** — `CORPUS.md`'s candidate table is
empty. The selection rule is written down first on purpose: whoever picks the
tasks can pick the result.

**A real model HAS now run through it, once** — 2026-08-13, both arms
`true_confidence`, $0.135 reported, recorded in
[docs/benchmark-first-run.md](../docs/benchmark-first-run.md). What that
established is that the plumbing works with a real model at both ends. What it did
NOT establish is anything about the claim: both arms landed in the same cell, so
the task discriminated nothing.

**No task hard enough to discriminate has ever been run**, so
`SPEC_BENCHMARK_V0` §1's claim has not been tested once. Every interesting cell
this project has produced still comes from a worker written to be dishonest.

Absent, and named rather than implied:

- a corpus, and the selection rule that must be written before any task runs;
- aggregation across tasks — there is no `summarise` command, because a rate over
  two scripted rows would be a number worth nothing;
- the third arm the dossier names (identical prompt, Wringer observing only),
  which would separate *supervision* from *better prompting* and costs a third
  more.
