# The witness, calibrated offline — 2026-08-15

*The measurement, not a spec. Phase 1 of `WRINGER_RULING_2026-08-14` (the
witness ruling), scored against the salvaged corpus at
`benchmark/corpus/results/patches/`. Published whichever way it landed, which
is the rule this programme set for itself before the numbers existed.*

**Two of the three stop conditions were hit. The third missed completely, and
it is the one the ruling put the bet on.**

| | target | result | |
|---|---|---|---|
| **(a)** witness proved RED on the pre-change tree, for the right reason | ≥ 9 of 13 | **10 / 13** | HIT |
| **(b)** of those, GREEN on upstream's true fix | ≥ 8 | **9 / 10** | HIT |
| **(c)** RED on the salvaged known-wrong changes it covers | ≥ 80% | **0 of 11 — 0%** | **MISS** |

Estimated spend: **$0.38** against a $10 cap. One model call per task; nothing
else here touches a network.

## What was measured, and how it was made checkable first

The witness author is given the criterion statement and a bounded view of the
pre-change tree, and nothing else. Upstream's fix, the held-out tests and every
salvaged agent change are applied by the scorer *after* authoring and are never
in the author's context — the calibration index splits `author_visible` from
`scoring_only` so that handing the author the wrong half is a visible act.

**The apparatus was validated before a penny was spent.** All 13 tasks
demonstrably fail their held-out suite on the pre-change tree and pass it once
upstream's real fix is applied, so nothing below is bounded by a scorer that
cannot tell a fixed tree from an unfixed one. Getting there needed upstream's
13 fix commits fetched from GitHub: the corpus repos *and* their origin mirrors
are truncated to two commits, which is the `.git` leak fix working as designed.

**(a) counts only a red for the right reason.** A witness that dies at
collection — `ModuleNotFoundError`, a bad import, no test collected — is not a
proved red, per SPEC_GATEGEN W8. That is enforced structurally from the
runner's own outcome, not by reading failure text, and the harness was shown to
classify both cases correctly before the run.

## (c): what actually happened

Zero of eleven is extreme enough to be a bug, so it was checked before being
believed. On each wrong change, the witness and upstream's held-out suite were
run **on the same tree**:

| outcome | count |
|---|---|
| witness caught it (both red) | **0** |
| **witness PASSED where held-out FAILED** | **11** |
| witness red on a change held-out accepts | 0 |

Unanimous, with no noise. The measurement is sound: **the witness is
consistently weaker than upstream's test.**

### The worked example

`attrs-frozen-exception-mutable-attrs`. The statement the author was given says,
in full, that the fix should *allow `__suppress_context__` and `__notes__` to be
mutated on frozen exceptions*. The witness tests exactly that, and passes once
those two attributes are settable.

Upstream's held-out test exercises `__traceback__`, `__cause__`, `__context__`,
`__suppress_context__`, `__notes__` **and `del __notes__`**, plus `add_note()`.

So a change that does precisely what the statement asks passes the witness and
fails the held-out suite. The witness is faithful to its criterion; the held-out
suite is faithful to upstream's fix; the criterion under-specifies the fix.

`click-help-hint-shadowed-name` shows the same shape, and notably **not**
because the witness is shallow — it is a careful two-test reproduction that
also checks the suggested flag actually works. It reproduces the reported
scenario. Upstream's test checks upstream's generalised formatting rule.

### What this does and does not say

**It does not say the eleven changes are correct.** That was not measured. Two
readings fit the evidence and they are not distinguished here: the changes may
satisfy the stated criterion while diverging from upstream, or they may be
genuinely incomplete in a way a criterion-faithful witness cannot see. For
`attrs-frozen` the first reading is well supported by the text of the statement.

**It does raise a validity question about (c) itself.** A row is labelled
`false_confidence` when the agent claimed success and *upstream's* held-out
suite failed — agreement with upstream's fix, never satisfaction of the
requirement. `SPEC_BENCHMARK_V0` §3 says so in writing and predicts the
consequence, though it predicts it landing on false-refusals rather than here.
So (c) asks a criterion-authored check to catch changes labelled wrong by an
upstream-agreement oracle. **The miss is real and is reported as a miss; that
the target may also be mis-specified is a separate finding and does not rescue
it.**

## The individual failures

| task | what |
|---|---|
| `click-zsh-completion-colons` | author failed — `RemoteDisconnected`. Transient network, not a model result |
| `marshmallow-data-key-in-schema-validator` | author failed — read timeout. Same |
| `marshmallow-email-idn` | the witness was **green on the pre-change tree** — it did not reproduce the defect, so it is self-refuting and was excluded from (a), exactly as a born-green gate is |
| `marshmallow-constant-required` | the witness was **red on upstream's true fix** — a manufactured false refusal, and the single (b) miss |

The two authoring failures are retryable and were not retried in this pass. (a)
would likely land at 11–12 of 13 with them, which changes nothing about (c).

## Limits

- **(c) is scored on 5 of 13 tasks**, the only ones that produced a recorded
  wrong change, and on 14 patches of which **only 7 come from the
  uncontaminated run 2** — run 1's trees carried 778–3697 commits of upstream
  history. At that size 80% moves in very large steps.
- **These numbers are an UPPER BOUND on live behaviour.** They score witnesses
  against changes made by workers that never saw a witness. A `trusted_local`
  worker can read `.wringer/` and special-case the only check carrying
  information about the change. Closing that is Phase 2's containment.
- One draw per task. No aggregate, no score, no crown.
- A manufactured fail-to-pass witness is necessary and demonstrably not
  sufficient (UTBoost: 345 erroneous patches passing curated tests; PVBench:
  >40% failing the developer's own PoC tests — both inherited from the ruling
  and not independently verified here).

## What this licenses

Nothing yet. The ruling is explicit that a miss on the calibration stop is a
result rather than something to negotiate around, and that if Phase 1 misses,
**R2's de-scope fires — bug fixes leave scope by editing the README sentence,
an explicit retreat rather than a silent one.** That call belongs to Marc and to
a ruling window, not to the window that ran the measurement.

What the two hits do establish, and it is not nothing: **Wringer can author a
check that reproduces a real defect from its report alone, prove it red on the
pre-change tree for the right reason, and keep it green on the real fix — 10 of
13 and 9 of 10, for 38 cents.** The gap is not authorship. It is that a check
written from the criterion does not measure what an upstream-agreement oracle
measures.

*Artifacts: `~/Claude/wringer-phase1-2026-08-15/` — every authored witness, the
per-task result, the apparatus validation, the calibration index, and the
scoring-only upstream fixes.*
