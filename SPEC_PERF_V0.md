# SPEC_PERF_V0 — safe gate parallelism

**Binding** for `gates[].concurrent`, `wring verify --serial`,
`wringer.concurrency.v1`, and what `wring health` may compare across a
concurrency boundary.

Status: **BUILT**, 2026-08-13. §7 is what this does not do, and it includes the
other half of the phase it was asked for.

---

## 1. Why this needed a spec at all

Running gates concurrently is the speedup everyone asks for first, and it is the
one that cannot be taken quietly:

> **`duration_ms` is not private to a run.**

`wring health` compares it across a window and flags drift past 2×
(`health._median`, oldest-five median against newest-five). Run two gates at once
and every gate's wall clock inflates by an amount nobody recorded — so a repo that
turned this on would read as drifting everywhere at once, and the honest reading of
that report is that **the instrument moved, not the gates**.

That is the same argument SPEC_BENCH_V0 ruling 2 makes for contenders
("concurrency would corrupt the very numbers the command exists to report"),
reaching one module further. `tests/test_verify.py` carried a fence forbidding
`concurrent` from being imported at all, named *"until a spec says otherwise"*.
This is otherwise. The fence was **moved rather than removed**: it now asserts the
three properties it was protecting, and its docstring says why.

## 2. The declaration

```yaml
gates:
  - id: lint
    run: ruff check src
    concurrent: true
  - id: types
    run: mypy src
    concurrent: true
  - id: tests
    run: pytest            # serial, and stays serial
```

`concurrent: false` is the default and every gate that shipped has it.

**Gates are grouped into maximal runs of CONSECUTIVE concurrent gates**, and
consecutive is the whole rule. Collecting every concurrent gate into one group
wherever it sat would reorder them relative to the serial gates between, and
declared order is a contract — the config decides what runs cheapest first. So
`[a(c), b, c(c), d(c)]` is three groups: `[a] [b] [c,d]`.

A repo that declared nothing gets one group per gate, which is the loop that
shipped. **A group of one builds no pool at all** — not an optimisation, but what
keeps the serial path identical, live console output included, and a test refuses
a `ThreadPoolExecutor` to prove it.

**It is per-gate and not a job count** (SPEED_PLAN R3, diverged from with reason).
The plan suggested `gates.jobs: N`. A count answers "how many at once" — but the
question that decides safety is *which gates may overlap*, and only the repository
can answer that: two gates share one working tree, and Wringer cannot know whether
`pytest` and a build step fight over `dist/`. A job count would let Wringer overlap
gates nobody declared safe. Nothing bounds a group beyond the declaration, and §7
says so rather than quietly capping it.

## 3. What it costs, and where that is recorded

`concurrency.json` — `wringer.concurrency.v1`, a sibling, absent when every gate
ran alone. It names each gate that ran beside another and **who they were**,
because "this gate was concurrent" is not actionable on its own: a reader looking
at an inflated duration wants to know what it was competing with.

`wring health` then **excludes contended rows from the duration trend** and
**counts the exclusion**:

```
  test  alive  12 runs  [2 ran concurrently, excluded from the duration trend]
```

That is SPEED_PLAN R1's first option, taken. Timeouts and truncations are *not*
excluded: those are facts about what happened rather than comparisons between
numbers, and a gate that timed out under contention still timed out.

A ratio computed over four of twelve runs is a different claim from one computed
over twelve, so the count is reported. A duration comparison that quietly dropped
runs would be the narrowing check `wring health` exists to hunt, committed by
`wring health`.

The mark could not go on the row: `gate-result.schema.json` is frozen and closed.
The plan flagged that obstacle, and a sibling is the answer `vacuity.json`,
`acceptance.json` and `stability.json` each got.

## 4. The ledger stays single-writer

`Bundle.event` reads the ledger's last line to compute `prev_hash` and then
appends. Two threads there would break the chain that is the bundle's whole
tamper-evidence — **silently, and in a way `wring audit` would later report as
tampering on an honest run.**

So `_run_gate` emits no event. `gate.started` is written for every gate in the
group before the pool runs; `gate.finished` for each after the join, in **declared
order**. `pool.map` rather than `as_completed`, so results come back in that order
and the bundle stays byte-deterministic over the same inputs. The two things in
`_run_gate` that were not thread-safe — the events and the position in `observed` —
were moved out for exactly that reason, and a test re-walks the chain with
`attest.check_chain` after a run whose gates really overlapped.

Same rule `wring bench`'s parallel attempts follow (SPEC_ATTEMPTS_V0 §5). Two
features, one invariant.

## 5. Interrupts still work

A thread pool does not receive SIGINT — only the main thread does — so without
help the pool's shutdown would wait out every gate's full timeout (900s by
default) with nothing attached to its output. That is SPEC_VERIFY's exit-4
contract quietly revoked by a pool.

So the interrupt path kills the process groups of every gate in flight. The pids
arrive through `gates.run`'s existing `on_spawn`, which was written for precisely
this: `start_new_session` makes each gate a group leader, so its pid *is* its pgid.

## 6. The four rulings SPEED_PLAN §4 left open

| | answer |
|---|---|
| **R1** `duration_ms` under concurrency | The first option: record it, record that the gate ran concurrently, and have health EXCLUDE those rows from drift and count the exclusion (§3). |
| **R2** stop-on-first-required-failure with gates in flight | The group **finishes**, then the stop is decided — the loop's own precedent, SPEC_SUPERVISION S1 stopping after the step in flight. The contract holds at GROUP granularity: a failure still skips every later group, and a repo that declared nothing has one gate per group and so keeps it exactly. No gate is killed, so no killed gate needs a name. |
| **R3** who chooses, and can it loosen | Per-gate `concurrent: true` rather than a job count (§2). `wring verify --serial` TIGHTENS by collapsing every group; there is deliberately **no `--jobs N`**, because a flag that widened would let an operator overlap gates the repository never declared safe. |
| **R4** does a concurrent run stay comparable for ACCEPTANCE | **Yes, and it is stated rather than inferred.** Concurrency changes a duration and never a pass/fail, so SPEC_ACCEPT §3 clause 2's genuine-failure receipt for an `(id, command)` pair survives it untouched. Nothing in this slice reads or writes an acceptance verdict. |

## 7. What this does NOT do

- **Nothing bounds a group beyond the declaration.** `concurrent: true` on twenty
  gates runs twenty at once and will thrash a small machine. Wringer does not
  invent a worker count, and `--serial` is the escape.
- **Nothing detects interference.** Two gates that fight over `dist/` will produce
  a mess, and the record will say they ran together and nothing more. Only the
  repository can know, which is why only the repository may declare.
- **`vacuity`, `bench` and the loop's worker are untouched.** The prove pass was
  already parallel on purpose (measured 3.95×) on a throwaway tree where no
  published number compares those durations to anything.
- **The live console reports a concurrent group after the join**, in declared
  order, rather than as each gate finishes. Determinism over immediacy; a serial
  group is unaffected.
- **No caching.** The other half of the phase this spec was asked for is
  **evidence-aware caching, and it is deliberately not here.** The analysis is
  worth recording because it is not a scheduling problem: a cache key must
  account for every input that justifies reuse, and a gate's result depends on the
  environment, the toolchain, the clock and the network — none of which Wringer
  can enumerate, so **no key can be complete and every hit can be a false green.**
  The honest shapes are (a) require the repository to declare a gate a pure
  function of the tree and mark every reused result as reused, or (b) treat a
  cached gate as one that DID NOT RUN, leaving no result — which is already this
  bundle's contract for a skipped gate, and which makes delivery refuse by
  construction because `deliver.gates_passed` reads the manifest's status while
  the gate's own evidence is absent. (b) is safe and narrow: it speeds up a
  developer's re-run and can never contribute to a delivery claim. Neither is
  built, because "prefer missing a cache hit over a false green" deserves its own
  slice and its own refusals rather than the tail of this one.
- **Judge calibration is not here either, and its precondition is why.** The
  phase asked for it *only if* the benchmark's evidence showed judge quality was
  load-bearing. SPEC_BENCHMARK_V0 §9's evidence shows the opposite emphasis: the
  judge appears in no row and in no code path of the harness — arm B's decision
  came entirely from gates and delivery's refusals — and the finding was that
  precision is bounded by **gate** quality. So the condition is unmet, and
  calibrating the judge now would be work chosen against the evidence.

## 8. DONE

- [x] Gates run concurrently only where a repository declared it, in maximal
      consecutive groups, in declared order.
- [x] Serial is the default and builds no pool.
- [x] The gates really overlap, proven by the clock and not by a config key.
- [x] `--serial` tightens; no flag widens.
- [x] The ledger is single-writer and its chain re-walks clean.
- [x] Every gate in a group leaves its own evidence; the stop contract holds at
      group granularity.
- [x] A contended duration is recorded, excluded from drift, and the exclusion is
      counted rather than silent.
- [x] Interrupts reach the gates in flight.
- [x] All four of SPEED_PLAN's open rulings answered, one of them by diverging
      with a reason.
