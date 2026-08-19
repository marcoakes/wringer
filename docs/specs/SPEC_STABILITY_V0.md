# SPEC_STABILITY_V0 — flaky gates

**Binding** for the `stability:` block on a gate, `wringer.stability.v1`, and
what `wring run` may do with a gate that did not give the same answer twice.

Status: **BUILT**, 2026-08-12. Written after the code, against the code, and
§8 names what it does not do rather than implying it does.

---

## 1. The defect

A nondeterministic gate is indistinguishable from a failing one. Wringer runs
a gate, gets a red tick, writes it into a brief, and hands it to an agent as
something to fix. The agent edits source that was never wrong. The next draw
comes up green. The loop reports `converged`, the bundle says every required
gate passed, and the record is *correct at every step* — a green tick bought
by re-drawing, with a diff attached that nobody needed.

That is the vacuity problem in a new hat, and it is worse than vacuity in one
respect: vacuity ships a change whose gates proved nothing, and this ships a
change nobody asked for **plus** the belief that a check now works.

Wringer had no concept of it before this slice. Nothing in `src/` contained
`flaky`, `stability` or `stable_pass`, and a repo with an intermittent test
suite got exactly the behaviour above.

## 2. The config — additive, absence is the old behaviour

```yaml
gates:
  - id: tests
    run: pytest
    stability:
      attempts: 3
      require_consistent: true
```

`attempts` has **no default**. A number Wringer picked would be a number
nobody agreed to spend, and attempts multiply the gate's wall clock. At least
1, at most `config.MAX_STABILITY_ATTEMPTS` (10) — a ceiling rather than a
taste, because a gate needing more draws than that is a gate to fix rather
than one to measure, and it is deliberately not configurable for the reason
`health.MIN_HISTORY` is not: a threshold knob's only realistic use is making
bad news go away before a release.

`require_consistent` **defaults to true, and the default is the whole safety
story.** `attempts: 3` on its own must not mean "retry until green" — that is
the defect above, so a key whose absence installed it would be a trap wearing
a feature's clothes.

**`stability:` lives in `.wringer.yaml` only.** `config.parse_gate` is shared
with `wring spec`, so the key sits in `_CONFIG_GATE_KEYS` beside `proves:` —
not for `proves:`'s reason (a drafter proposing `attempts: 3` would be
harmless) but because `spec.schema.json` is frozen with
`additionalProperties: false`, and a drafted gate carrying it would render a
`wringer.spec.yaml` that fails its own published schema.

**The absence of `stability:` is the compatibility boundary, and it is not
`attempts: 1`.** It is the entire pre-stability contract: one attempt, no
`attempts/` directory, no `stability.json`, and a byte-identical bundle.
`test_a_repo_with_no_stability_key_writes_the_bundle_it_wrote_yesterday` pins
the exact SET of files in the bundle, so a stray sibling appearing later fails
there too.

## 3. Classification — from observations, and from nothing else

| observations | classification |
|---|---|
| every attempt passed | `stable_pass` |
| every attempt failed | `stable_fail` |
| a mixture | `flaky` |
| fewer attempts ran than were asked for | `unknown` |

**No gate's output is read.** Not for the word "flaky", not for a retry hint,
not for anything. `classify(requested, statuses)` takes a count and a tuple of
`passed`/`failed` and there is no third argument it could grow. The reason is
authority: a classifier that reads text is a classifier the *supervised party*
can talk to, and the whole point of this slice is that the gate's own account
of itself is not evidence. `test_no_gate_output_can_change_the_classification`
runs a gate that shouts every word a text-reading classifier would look for
and exits 0 three times; it is `stable_pass`.

**The count is checked before the statuses.** A gate asked for three draws and
giving two has been shown nothing, however those two came back — otherwise an
interrupt manufactures the verdict the third attempt was there to buy.

**Every attempt runs, even after the answer looks settled.** Stopping at the
first failure would make `stable_fail` and `flaky` indistinguishable, which is
the entire measurement. Stopping at the first pass would be retry-until-green
with a record attached.

`unknown` has exactly one door: a Ctrl-C between attempts. It is **treated as
`stable_fail`** and the record says so — `routing: repair`, and a `reason`
that names the gap. It never decides a run's pass or fail, because the only
way to reach it already made the run `interrupted`.

## 4. Routing — a flaky gate is never handed to a worker

Every stability row carries a `routing` word, and `wring run` **reads it**
rather than inferring anything from a red tick:

- `repair` — hand it over, which is what the loop has always done. `stable_fail`
  and `unknown`.
- `no_repair` — do not. `flaky`, whatever the verdict.
- `none` — the gate passed; there is nothing to repair.

**The classification decides `routing`, never the verdict.** A tolerated
mixture (§5) has verdict `passed` and routing `no_repair`: reading the verdict
first would let `require_consistent: false` quietly buy repairability back
along with the tick, which is the one thing tolerating a coin flip must not do.

`wring run` checks this **before every other stop**, because every other stop
is a statement about the *worker* and this is a statement about the *check*. It
then stops, with `reason: flaky_gate`, having called no worker at all. It does
not re-verify: looping on a nondeterministic gate until it draws all-green is
retry-until-green one level up, and it would end in an honest-looking
`converged` bought by re-drawing.

**Under `wring fleet`, a child that stopped `flaky_gate` is not retried.**
Invariant 2 generalised from "the same signature twice" to "deterministic with
respect to anything a retry can change": a retry re-runs the same gate against
the same tree, so it buys a fresh coin flip rather than information — and a
retry that happened to draw all-green would CONVERGE and record the task
`succeeded`, which is fleet-scale retry-until-green arrived at without anybody
deciding to build it. It stays `failed` rather than becoming `parked`, and §8
says why that is the weaker word.

## 5. `require_consistent: false` — legal, loud, and fenced

It buys the tick and nothing else:

- the classification is still `flaky` — it comes from the observations,
- `tolerated: true` is recorded, and `summary.md`'s gate row reads
  `passed (flaky, tolerated)` rather than a bare `passed`,
- the routing is still `no_repair`.

And it is **refused outright on a gate that carries `proves:`**, at parse time,
where the two keys meet. A tolerated flaky gate reads `passed` while its own
record says the result was a coin flip, and `proves:` would turn that coin flip
into acceptance evidence. Worse, it satisfies the *hard* half of SPEC_ACCEPT_V0
§3's `evidenced` for free: that rule wants a gate that has demonstrably FAILED,
and a nondeterministic gate manufactures the receipt without ever telling
satisfied from unsatisfied. Refused at the config, so no acceptance code has to
defend against it.

The same hole is closed twice over for required gates, which is deliberate:
with `require_consistent: true` a flaky gate FAILS, so the run never reaches
the prove pass and `vacuity.json` cannot manufacture a `sensitive` row for it
either. And `proves:` has always been refused on an optional gate, so a flaky
*optional* gate is bound to nothing.

## 6. The record

Every attempt gets **its own directory, its own `result.json` and its own
logs**, at `gates/NNN_<id>/attempts/NNN/`. `stability.json` — a sibling of
`manifest.json`, like `vacuity.json` and for the same law-7 reason — says how
many were asked for, how many ran, what each did, and where each lives.

A retried gate reporting one clean result is exactly what a hidden flake looks
like. So:

- **`gate.finished` is unchanged in shape.** `wringer.evidence.v1` closes every
  branch with `additionalProperties: false`, so an `attempts` key there would
  make every bundle fail the schema it publishes. No new event type either.
- **`gates/NNN_<id>/` holds the DECIDING attempt** — the first one matching the
  verdict — copied up from its attempt directory. Every existing reader
  (`explain`, `health`, `accept`, `attest`) has always looked there, and a gate
  whose canonical result contradicts the run's own verdict is the
  self-contradicting bundle `evidence._clear_previous` exists to prevent,
  arriving through a different door. A copy rather than a move, or `attempts/`
  would be incomplete in the one place the record must make the retry visible.
- **The console prints one line per attempt.** Three lines carrying the same
  gate id is the honest shape: something ran three times.
- **`summary.md` gets a Stability section whatever the classification came out
  as**, including `stable_pass`. The count is the guarantee, and a guarantee
  that only appears with bad news is a guarantee nobody can rely on.

## 7. `wring health` — observed frequency, never a probability

`wring health`'s human report gains a stability line per gate: how many of the
recorded runs classified it each way, phrased as **observed frequency** and
never as a claim about the gate. "flaky in 2 of 14 recorded runs" is a fact
about the record; "this gate fails 14% of the time" would be an invented
number, which §3c of SPEC_HEALTH_V0 already bans.

**A `flaky` row is not a `genuine_failure`, and its sensitivity does not
count.** Same reasoning as the `127` exclusion that command already carries:
nothing discriminated. A gate that failed nondeterministically failed for a
reason that is not the tree, so counting it would let nondeterminism
manufacture the demonstration `alive` rests on — and `accept.py` reads
`genuine_failure` through the same function, so the acceptance receipt is
closed by the same three lines.

**`wring health --json` is unchanged.** `health-report.schema.json` is frozen
with `additionalProperties: false` on its gate object, and a new key would cost
`wringer.health.v2` — a shape break for every script that parses it, in
exchange for a field. The human report has no schema; that is where this goes,
and §8 records the gap.

## 8. What this does NOT do

- **`wring health --json` says nothing about stability.** Human report only, for
  the frozen-schema reason in §7. A consumer that needs it reads each bundle's
  `stability.json`, which is published and frozen.
- **A flaky child under `wring fleet` is `failed`, not `parked`.**
  `task.parked`'s `why` is a closed enum in the frozen `wringer.fleet.v1` event
  schema and none of its five values is true here — `deterministic` is the
  opposite of what this is. Park would need `wringer.fleet.v2`, and spending a
  second version bump inside one slice to upgrade a word is worse than the word.
  The retry, which is the part that could manufacture a green, is already
  refused.
- **Attempts are serial.** N attempts cost N times the gate's wall clock. No
  parallelism, because two attempts sharing one working tree is a different
  experiment from the one being run.
- **`wring verify --prove` proves once, not per attempt.** A flaky gate never
  reaches the prove pass while `require_consistent` is true (§5), so this is
  not a hole today — but if tolerance and proving are ever both wanted on one
  gate, the pre-change draw is a coin flip and `sensitive` means less than it
  says.
- **Nothing detects flakiness a repo did not ask to measure.** `stability:` is
  opt-in per gate. A repo with an intermittent suite and no policy declared
  gets exactly the behaviour §1 describes. Wringer cannot infer the policy: the
  cost is the repo's to spend.
- **`unknown` is only reachable by interrupt.** There is no per-attempt ceiling
  and no wall clock that could cut the sequence short, so a slow gate runs all
  its attempts however long that takes.

## 9. `wringer.loop.v2`

The `flaky_gate` stop reason needed one, and this is the whole of why.

v1 froze `result.reason` and `loop.finished.reason` as **closed enums of six
values**, and none of the six is nearly true of a flaky stop: no worker ran,
the tree is not unchanged, the same failure did not come back, and re-verifying
would give a *different* answer — which is the point. Law 7 says new shape
arrives as a new file, so `loop-manifest-v2.schema.json` and
`loop-event-v2.schema.json` are published and v1 is untouched and still frozen.
SPEC_ENV_V0 §3 had already chartered these mechanics for its own `environment`
value; this executes them first.

**v2's `reason` is an open string, and that is a design decision rather than
laziness.** The fleet's own manifest and events have always recorded `reason`
as a plain string, and SPEC_ENV_V0 §4 cites that approvingly as the reason an
environment stop needs no fleet schema change at all. Closed here, *every*
future stop reason costs a bundle-format version — F6's `environment` would
have needed v3 — and version churn on the bundle format is what a frozen schema
exists to prevent, not cause. So F6 lands `environment` without a bump.

The drift guard moves out of the schema and into tests, because an open string
cannot catch a typo: every value `loop._REASONS` knows must be named in v2's
own description and matched by `graph.LOOP_REASONS`, and
`test_the_console_names_every_reason_the_loop_can_stop_for` already pins the
console against the same list.

**Every reader accepts both versions, and the reader set is DERIVED.**
`loop.SCHEMA_VERSIONS` is the list; `health._KINDS` is built from it rather
than keyed off the current version alone. That is SPEC_ENV_V0's finding D3, and
it is not hypothetical — reverting the two-line widening makes
`test_a_v1_loop_bundle_is_still_valid_and_is_still_read` report the v1 bundle
as *skipped: not a format this reads*. A version bump that orphans existing
evidence is not a bump; it is a deletion, performed by a tool whose product is
evidence.

## 10. DONE

- [x] A gate that alternates pass/fail on one tree is classified `flaky`
      (`test_an_alternating_gate_is_classified_flaky`).
- [x] The worker is not asked to repair it — the loop stops `flaky_gate` having
      called nobody (`test_the_loop_never_hands_a_flaky_gate_to_the_worker`,
      whose companion proves the loop still repairs a genuinely broken gate, or
      it would pass for a loop that never briefs anyone).
- [x] Every attempt is on disk with its own `result.json` and logs, and the
      record points at each by path.
- [x] A repo with no `stability:` key writes the same bundle it wrote
      yesterday, asserted as the exact file set.
- [x] Classification reads no gate output.
- [x] `stable_fail` still routes to repair; `unknown` is treated as
      `stable_fail` and the record says so.
- [x] A tolerated mixture passes the run and is still `no_repair`.
- [x] `proves:` + `require_consistent: false` is a config error.
- [x] New schema file, `gate-result.schema.json` untouched.
- [x] Health reads observed stability as a frequency, and a flaky row cannot
      make a gate read `alive`.
- [x] A `wringer.loop.v1` bundle is still valid and still read.
