# SPEC_BENCHMARK_V0 — the harness for the one experiment that can lose

**Binding** for `benchmark/`, the task-file format, the 2×2, and what may be
published from a result row.

Status: **BUILT and PROVEN ON TWO SCRIPTED TASKS**, 2026-08-13. No corpus run.
§9 is what that leaves unmeasured, and it is most of the interesting part.

---

## 1. The claim, stated so it can lose

> **`delivery_eligible` is a better predictor of *actually correct* than *the
> agent says it is done*.**

Not "Wringer completes more tasks" — a refusing system completes fewer. Not
"Wringer's gates go green" — that is the thing under suspicion. It is a claim
about two predictors of a third, independent fact, and one table decides it:

|                          | held-out PASSES  | held-out FAILS         |
|--------------------------|------------------|------------------------|
| agent declared done      | `true_confidence`| **`false_confidence`** |
| Wringer says deliverable | `true_confidence`| **`false_confidence`** |

The number that decides it is the bottom-right cell against the top-right.

**The claim loses** if Wringer's false-confidence rate is not materially lower,
or if its false-refusal rate is high enough that the precision is not worth the
throughput.

**What is published on a loss, decided here, before any number exists:** the
rows whole, every deviation, and this spec. Deciding afterwards is how a
benchmark becomes marketing.

## 2. The harness is not the product

It lives in `benchmark/`, outside `src/wringer/`, and `MANIFEST.in` **prunes**
it — stated rather than left to the absence of a graft. Two tests hold the line:
`wringer.harness` and `wringer.benchmark` must not import, and the prune must be
in the manifest. The test suite loads it by path, which is the asymmetry made
concrete: the harness may reach for Wringer, and Wringer may never reach for the
harness.

`wring bench` is **not** this and must not be bent into it. Bench compares two
*workers* on one job in one repo and deliberately crowns nobody. This compares
one worker *with and without the harness* against an external signal. Different
question, different artifact.

## 3. The circularity trap, which is the whole design problem

Wringer's own delivery decision must not define truth. If the evaluator asks "did
Wringer approve it", the experiment measures nothing.

The independent signal is **upstream's own later tests** — written by people who
never saw the agent's change.

**Its honest limit, and it travels in every row:** a held-out suite measures
agreement with upstream's fix, not satisfaction of the requirement. A
different-but-correct implementation fails it. That is a false negative in the
*ground truth itself*, and it inflates the measured false-**refusal** rate rather
than the false-confidence rate — conservative in the direction that matters and
generous in the direction that flatters.

## 4. Isolation, enforced rather than promised

Held-out tests must not be in the working tree, must not be reachable by any
declared gate, and must not be in any brief. **If a worker can read the test it
is scored against, the experiment is over** — the "worker writes its own success
criterion" defect at the benchmark's own level.

`check_isolation` runs before either arm and raises `Void` on any of three:

1. the held-out file is already in the working tree;
2. a declared gate's command mentions it — then Wringer's verdict is partly the
   ground truth, which is §3's trap;
3. the task statement mentions it — then arm A is reading the answer.

The fourth is closed by construction: arm B's brief is built by `wring run` from
failing gates, and a gate cannot name the held-out file without tripping (2).

**Scoring happens in a THIRD copy**, made after the arm finishes, with the
held-out files added. The arm's tree is never touched, and a test asserts on the
filesystem that no arm's tree ever contained them.

## 5. The two arms

| held identical | arm A (`a_native`) | arm B (`b_wringer`) |
|---|---|---|
| model, starting SHA, task text, budget | the agent runs the task directly | `wring run`, then a dry-run `wring deliver` |
| | claim = **the agent's exit code** | claim = **`wring deliver` exit 0** |

`delivery_eligible` is measured by **asking Wringer** — a dry-run
`wring deliver`, whose exit code is its actual decision. A reimplementation here
would be a second opinion that could drift from the product, and the product's
decision is the thing being measured.

Each arm gets its own **copy** of the repo, not a worktree: a worktree's `.git`
is a file pointing back at one shared object store, and the arms must share
nothing.

## 6. Deviations are never empty

Arm B is handed a brief built from failing gates; arm A is handed the task
statement. That is the treatment, not a rigged comparison — but the arms differ
in **prompt** as well as in supervision, and every row says so. A write-up
claiming "the same agent" without "given different information" would be
overclaiming, so the field cannot be empty and a test asserts it.

## 7. VOID — the two ways an experiment measures nothing

`VOID` is a recorded outcome and contributes to **no rate**.

**1. The held-out signal was reachable** — §4.

**2. An arm never produced a claim.** Arm B counts a refusal only when
`wring deliver` exited **1**, refused *on the evidence*. Exit 2 or 3 is config or
a precondition, and Wringer never reached a verdict about the change. Arm A is
void when its worker could not be started at all (127): the agent never ran, so
it claimed nothing.

**Rule 2 was found the hard way and is the most important thing in this spec.**
The first run of this harness scored arm B a `true_refusal` on the demo — because
the demo repo had no reachable `origin`, so `wring deliver` exited 3 before
looking at any evidence. **A constant refuser scores perfect true-refusal on every
failing task and perfect false-refusal on every passing one**: precision bought by
an accident of the machine, in exactly the direction that flatters the claim under
test. Without this rule the harness would have advertised a result it never
earned.

A void row carries `claimed: null` and `held_out_passed: null`, and the held-out
suite is deliberately not run for it: a cell needs both coordinates, and half a
row invites somebody to fill in the other half.

## 8. No aggregation, and that is a decision

There is no `summarise`, no rate, no score — a test greps for their absence. A
rate over two scripted rows would be a number worth nothing, and the moment one
exists somebody will quote it. Aggregation lands with a corpus, or not at all.

## 9. What was measured, and what was not

**Measured, on this machine, at zero cost.** Two demo tasks with a scripted worker
and a fake upstream test. The worker writes a **tautological fix** — it hardcodes
the case named in the issue — and upstream's held-out test fails it in both:

```
demo-narrow-gates    a_native     false_confidence
demo-narrow-gates    b_wringer    false_confidence   wring deliver would deliver this
demo-covering-gates  a_native     false_confidence
demo-covering-gates  b_wringer    true_refusal       refused on the evidence: gates did not pass
```

The tasks differ **only in the repository's own test suite**, and the contrast is
the first real finding this harness produced:

> **Wringer's precision is bounded by the quality of the gates the repository
> wrote down.** In `demo-narrow-gates` the repo's own test covers only the
> reported case, so the tautological fix goes green and `wring deliver` says yes.
> Wringer bought nothing. It runs the checks a repo has and cannot invent the one
> nobody wrote.

Both tasks ship and both run in the suite, because a demo that could only produce
the flattering cell would be an advert. Note also what the narrow task shows about
`--prove`: vacuity would *not* have caught this fix either, because the gate
genuinely fails on the pre-change tree — the gate can fail, it just cannot fail
for the right reason.

**Not measured: anything about any agent.** No model has run through this harness.
Every number above comes from a shell script, and the only thing proven is the
harness.

## 10. What this does NOT do

- **No corpus.** Roughly $80–400 for one pass over 10–20 real tasks in 3–5
  repositories, and it is Marc's to approve. Nothing here spends money.
- **No selection rule**, which must be written *before* any real task runs, with
  the excluded tasks and their reasons published beside the kept ones. Whoever
  picks the tasks can pick the result.
- **No third arm** (identical prompt, Wringer observing only). It would separate
  *supervision* from *better prompting* and costs a third more.
- **No aggregation** — §8.
- **No container execution.** The dossier wants the arms run under the container
  path; SPEC_EXEC_V0 §7 has not measured that path, so using it here would build
  a benchmark on an unmeasured boundary.
- **No repeated attempts per arm.** One draw each, and the limit says so.
  `bench.attempts` is the same lesson one layer down and is not wired in here.
- **Arm A's claim is an exit code**, which is a proxy for "the agent says it is
  done". An agent that reports completion in prose while exiting non-zero is
  recorded as claiming failure.

## 11. DONE

- [x] Held-out upstream tests as the independent signal, invisible to the worker
      and unreachable by any declared gate — refused before either arm runs, and
      asserted on the filesystem afterwards.
- [x] Arm A (agent alone) and arm B (same agent under Wringer), same SHA, same
      budget, own copy each.
- [x] Deviations recorded on every row and never empty.
- [x] One command runs a task through both arms and writes a result row.
- [x] Proven end to end on two scripted tasks with a fake upstream test, at zero
      cost, in the suite.
- [x] A precondition refusal is VOID and not a true refusal.
- [x] The harness lives outside `src/wringer/` and is pruned from the
      distribution, with tests holding both.
- [x] No corpus run; no money spent.
