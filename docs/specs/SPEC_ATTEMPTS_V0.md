# SPEC_ATTEMPTS_V0 — parallel independent attempts

**Binding** for `bench.attempts`, `bench.parallel`, `wringer.bench.v2`, and what
a bench may say about attempts that disagree.

Status: **BUILT**, 2026-08-12.

---

## 1. What this closes

`bench.LIMITS`'s first entry has said this since the command shipped:

> "One run per contender. Agents are stochastic; a difference within noise is
> noise."

That is a warning where a measurement belongs. A reader was told the number
might be noise and given no way to find out.

`bench.attempts: N` makes N **independent attempts per contender** — each with
its own worktree, its own loop bundle and its own ledger, all detached from one
checked baseline commit under one shared ceiling. `bench.parallel: N` runs them
concurrently.

## 2. What repeats buy, and what they do not

**They do not buy a ranking.** Ruling 6 of SPEC_BENCH_V0 stands untouched: a
contender that "fixes" a planted failing test by rewriting it into a tautology
converges faster than an honest fix and reads `proven`, so an auto-ranked bench
would systematically reward reward-hacking in the product built to catch it.
Nothing here orders anything, and a test asserts that no *field key* in the
manifest or in the published schema names a rank, a score, a winner or a
position.

What they buy is **whether a contender agrees with ITSELF**:

| verdict | meaning |
|---|---|
| `insufficient` | one attempt each, so nothing can agree or disagree. **The default, valid, and expected — not a shortfall.** |
| `consistent` | every contender's attempts reached the same outcome as each other. Says the agent was consistent; says nothing about which contender is better. |
| `inconsistent` | a contender reached DIFFERENT outcomes across attempts on the same tree, from the same commit, under the same ceiling. |

`inconsistent` is the finding this feature exists to surface, and it is the same
finding a flaky gate is one level down: nothing in the inputs explains the
difference, so it is the agent's own nondeterminism. **A single run would have
reported one of those outcomes as though it were the answer.**

The comparison is a contender with itself and never across contenders. Across
contenders, *"the evidence is insufficient to rank these"* remains the answer,
and the summary says so even when the attempts agreed.

## 3. Independence, by construction rather than by discipline

- **One worktree per attempt**, named `<contender>-a<N>`. Two attempts sharing a
  tree would be one attempt with a race in it, and nothing downstream could
  tell.
- **One loop bundle and one ledger per attempt.** A test asserts no two rows
  name the same `loop_ref`.
- **One `Config` per attempt** — `_contender_config` already returns a fresh
  frozen dataclass.
- **The only shared objects are read-only**: the `Redactor`, which is frozen,
  and the baseline SHA, which is a string. The bench ledger is shared and is
  written by exactly one thread — see §5.

## 4. Serial stays the default, and parallelism costs a column

SPEC_BENCH_V0's docstring called serial *measurement hygiene, not a missing
feature*, and that is still true: parallel contenders on one machine contend for
CPU, IO and the network, and wall-clock is a primary column.

So `bench.parallel` lets a repository **spend that column to buy elapsed time**,
and the artifact says the column is spent:

- `PARALLEL_LIMIT` is appended to the manifest's `limits` and printed in the
  summary — *"wall_clock_ms is contended and rows may not be compared on it"*.
- The summary's own section says how many ran at once.

Leaving a reader to compare contended numbers would be the misleading number
this repository exists to refuse. **Both limits are appended only when the thing
they qualify actually happened**: a limit about attempts printed on a
single-attempt bench is a sentence a reader learns to skip, and the limits are
the part they must not skip.

`parallel: 1` — the default — does not build a pool at all. That is not an
optimisation: it is what makes a bench that declared no parallelism behave
exactly as it did, and a test refuses a `ThreadPoolExecutor` to prove it.

## 5. The ledger is written by one thread

`Bundle.event` reads the ledger's last line to compute `prev_hash` and then
appends. Two threads interleaving there would break the chain that is the
bundle's whole tamper-evidence — **silently, and in a way `wring audit` would
later report as tampering on an honest run.**

So no event is emitted from a worker. `contender.started` is written for every
attempt before the pool runs; `contender.finished` is written for each after
they are joined, in **declared order**. A test re-walks the chain with
`attest.check_chain` over a bench that really ran three attempts at once.

The cost is that the ledger's order is declared order rather than completion
order, and that is stated in `PARALLEL_LIMIT` rather than left for a reader to
discover.

Results come back through `pool.map`, not `as_completed`, for the same reason: a
bench whose artifact changed shape depending on which agent happened to finish
first would be an artifact nobody could diff.

## 6. Threads, and reapability

Threads rather than subprocesses, because ruling 2 wraps `loop.run` **in
process** so the identical ceiling is handed over rather than re-derived on the
far side of a CLI. The work each thread does is almost entirely waiting on
`subprocess.communicate`, so the GIL is not the bottleneck — the agents are.

**A Ctrl-C reaches the main thread only**, so the workers are still inside
`communicate` with their agents still running. Left alone, the pool's shutdown
would wait out every agent's full timeout with nothing attached to its output —
SPEC_SUPERVISION's reapability invariant, quietly revoked by a thread pool. So
the interrupt path reaps: every loop writes `worker.pgid` for exactly this
purpose, and `loop.worker_pgids` / `loop.reap_orphans` are the shipped
machinery. Reaping makes `communicate` return, the threads unwind, and the
bundle is still written.

## 7. `wringer.bench.v2`

v1's contender rows are `additionalProperties: false` and its own description
says *"one row per contender"* — both true only of a bench making one attempt
each. Six rows for two contenders is not a v1 document however permissively you
read one, so law 7 says new shape arrives as new files:
`bench-manifest-v2.schema.json` and `bench-event-v2.schema.json`, with v1
untouched and still frozen.

**With `attempts: 1` the rows carry exactly v1's keys.** `attempt` is written
only when there was more than one — the field is `int | None` rather than a
number that is sometimes noise, so attempt 1 of three is never mistaken for the
only one, and a single-attempt bench's record does not move for a feature nobody
turned on. `attempts` and `parallel` at the top level are likewise present only
when greater than 1.

`bench.SCHEMA_VERSIONS` is the derived list every reader accepts. `health` needs
it and **cannot import `bench`** — the cycle runs through `verify` and `accept` —
so the versions are a literal on the reader's side, pinned by a test, the same
shape as `config._KNOWN_RUNTIMES`. This is SPEC_ENV_V0's finding D3 met for the
second time in this release, and a test plants a v1 bench bundle and asserts
health still reads it.

## 8. Ceilings

`attempts` is capped at 10 and `parallel` at 8. Ceilings rather than tastes:
**every attempt is a real agent run**, so `attempts` multiplies the bill
linearly and a typo in a config file is money. Not configurable, for the reason
`health.MIN_HISTORY` is not — a threshold knob's only realistic use is making
bad news go away.

One contender with `attempts: 1` is still refused, because a comparison of one
is `wring run`. One contender with `attempts: 2` or more is **legal**, and the
refusal message says why they are different measurements.

## 9. What this does NOT do

- **No cross-contender comparison, ever.** §2. `agreement` compares a contender
  with itself and has no code path that touches two.
- **No aggregate over attempts** — no mean iteration count, no pass rate, no
  "converged 2 of 3". Every one of those is a score wearing a statistic, and a
  reader with three rows in front of them can count. `inconsistent` names the
  contender and stops.
- **`wall_clock_ms` is still recorded under parallelism**, contended. Dropping
  it would be worse: the number is real, it is just a different quantity, and an
  absent field would read as "not measured".
- **Attempts are not diffed against each other.** Whether two attempts produced
  the *same implementation* is a question this machinery does not ask; it
  compares outcomes, and the worktrees are kept so a human can diff them.
- **No retry.** An attempt that errors is a row, exactly as a contender that
  errors always was — honest partial success, invariant 6.
- **Parallelism does not extend to `wring fleet`,** which already had its own
  bounded pool of child subprocesses and its own concurrency key.
- **The pool does not bound memory or CPU.** `parallel: 8` on a small machine
  will thrash, and nothing here notices; the ceiling is a guard against typos,
  not a scheduler.

## 10. DONE

- [x] N attempts per contender, same requirement, same starting SHA, same
      ceilings.
- [x] Independent worktrees, loop bundles and ledgers, asserted as the absence
      of collision.
- [x] No shared mutable state; the shared objects are frozen or read-only.
- [x] Concurrent execution behind `bench.parallel`, serial by default and no
      pool built when serial.
- [x] Only observed facts compared, and only a contender against itself.
- [x] No field in any artifact or schema orders anything — asserted on KEYS,
      not on prose, because the limits legitimately deny a ranking in words.
- [x] `insufficient` is the default verdict and says it is not a shortfall.
- [x] The wall-clock column is declared contended under parallelism.
- [x] The ledger's `prev_hash` chain re-walks clean after a parallel bench.
- [x] A `wringer.bench.v1` bundle is still read.
