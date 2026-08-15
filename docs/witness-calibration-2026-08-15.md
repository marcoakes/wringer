# The witness, calibrated offline — 2026-08-15

*The measurement, not a spec. Phase 1 of `WRINGER_RULING_2026-08-14` (the
witness ruling), scored against the salvaged corpus at
`benchmark/corpus/results/patches/`. Published whichever way it landed, which
is the rule this programme set for itself before the numbers existed.*

**Two of the three stop conditions were hit. The third missed completely, and
it is the one the ruling put the bet on.**

| | target | result | |
|---|---|---|---|
| **(a)** witness proved RED on the pre-change tree, for the right reason | ≥ 9 of 13 | **12 / 13** | HIT |
| **(b)** of those, GREEN on upstream's true fix | ≥ 8 | **10 / 12** | HIT |
| **(c)** RED on the salvaged known-wrong changes it covers | ≥ 80% | **1 of 12 — 8%** | **MISS** |

Estimated spend: **$0.50** against a $10 cap. One model call per task; nothing
else here touches a network.

> **The table above is the FIRMED pass.** The first pass, published earlier the
> same day, read 10/13 · 9/10 · 0 of 11, and two of its thirteen authoring
> calls had died on transport and were never retried. They were retried; both
> produced a witness; one of them brought a twelfth wrong change into (c) and
> the witness caught it. **[Postscript 1](#postscript-1--the-two-retries-that-were-never-run-2026-08-15)
> carries the superseded numbers, what moved and why.** Everything below this
> box is the first pass as published and is not rewritten.
> [Postscript 2](#postscript-2--what-the-eleven-changes-actually-are-2026-08-15)
> answers the question §"What this does and does not say" left open.

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
| `click-zsh-completion-colons` | author failed — `RemoteDisconnected`. Transient network, not a model result. **→ retried; see Postscript 1** |
| `marshmallow-data-key-in-schema-validator` | author failed — read timeout. Same. **→ retried; see Postscript 1** |
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

---

## Postscript 1 — the two retries that were never run (2026-08-15)

Two of thirteen authoring calls died on transport — `RemoteDisconnected` and a
read timeout — and were recorded above as `author_failed`. **That is an
instrument malfunction being carried in a column that means "model result".**
They were retried with a bounded backoff added to `witness_author.py`
(transport failures only; a 400 or a 401 is a real answer and is not retried).
Nothing else changed: same author, same prompt shape, same scorer, same
targets. Added spend **$0.12**.

Both produced a witness, and both were red on the pre-change tree for the right
reason.

| | first pass | firmed | |
|---|---|---|---|
| **(a)** red pre-change, right reason | 10 / 13 | **12 / 13** | HIT, and by a wider margin |
| **(b)** of those, green on the true fix | 9 / 10 | **10 / 12** | HIT |
| **(c)** red on the wrong changes it covers | 0 of 11 — 0% | **1 of 12 — 8%** | **still a MISS, by a mile** |

**(c) was expected to be untouched and it was not.** The prediction was that
retrying two authoring calls could only move (a). It was wrong on a fact:
`click-zsh-completion-colons` is one of the five corpus tasks that carry a
salvaged wrong change, so giving it a witness put a **twelfth** patch into (c)'s
denominator — and the witness stayed RED on it. That is the first and only
salvaged wrong change any witness in this calibration has caught.

- `click-zsh-completion-colons` — **a = RED** (2 failed, 1 passed) · **b = red
  on upstream's true fix**, so it is the second (b) miss · **c = caught 1 of 1**.
- `marshmallow-data-key-in-schema-validator` — **a = RED** · **b = GREEN** ·
  covers no wrong change.

### The one catch, read honestly

It is a real catch and it is not a clean one, and both halves matter.

The witness file holds three tests. Running them across the three trees
separately:

| | pre-change | upstream's true fix | the salvaged wrong change |
|---|---|---|---|
| `…escapes_colon_in_value` (value **with** a description) | FAIL | **PASS** | **FAIL** |
| `…escapes_multiple_colons` (value with **no** description) | FAIL | FAIL | FAIL |
| `…leaves_plain_value_alone` | PASS | PASS | PASS |

The first test is exactly what a witness is supposed to be: red before the
work, green on the real fix, red on the change that did not do it. **The second
is red on everything it was ever shown**, including upstream's own fix — it
asserts escaping for a value with no description, which upstream does not do
because that value never reaches `_describe`. So one file carries one
discriminating check and one false-refusal manufacturer, and file-level scoring
records both facts at once: `caught` in (c), `b_green: false` in (b).

**This is a per-test decomposition of one row, offered as a diagnostic. It is
not a re-score** — (c) is defined over witness files and stays 1 of 12.

Why the change was caught is worth naming too, because it is not what the
headline finding above would predict. Upstream escapes the colon in
`format_completion` (Python); the agent escaped it in the generated zsh script
(`_SOURCE_ZSH`). The criterion — issue #2703, reproduced verbatim — describes a
symptom at the shell and never says where the escaping belongs. The witness
tested `format_completion`, i.e. it happened to pick upstream's location. So
this catch is **location-sensitive**, and a witness that had probed the symptom
end-to-end instead would have had to decide the same question the criterion
leaves open.

Everything the body of this capture says about (c) stands. One catch in twelve
against a target of ten is not a target that nearly held.

---

## Postscript 2 — what the eleven changes actually are (2026-08-15)

The section *"What this does and does not say"* names two readings of (c)'s
miss and deliberately does not distinguish them: either the salvaged wrong
changes **satisfy their stated criterion** while diverging from upstream — so
the label "wrong" is an upstream-agreement verdict rather than a requirement
verdict — or they are **genuinely incomplete**, and a criterion-faithful
witness is simply too weak to see it.

Marc and a ruling window cannot choose between R2's de-scope and re-targeting
(c) without knowing which. So it was measured.

### The instrument, and what is wrong with it

For each covered wrong change, **one call in a fresh context** — never the
authoring context, never a conversation — given **only** the task statement and
the change's complete diff, answering: *does this change satisfy the stated
requirement — yes / partial / no, and if not, which clause is unmet?* The judge
never sees upstream's fix, the held-out test, or the witness. `witness_judge.py`.

**A judge is a model reading prose. It is weaker evidence than an executable
test, and it is the same class of instrument this programme distrusts
everywhere else** — `wring judge` is on the ruling's dead list and stays there.
It is used here to *describe a corpus's labels* and it gates nothing: no
verdict, no target, no number in the table above moves because of it.

Because a gate that cannot fail is not a gate, the judge was made to fail
first. **Eight negative controls, all expected to come back "no"**
(`judge_controls.py`, $0.15):

| control | what it is | result |
|---|---|---|
| **mismatched** ×4 | task X's requirement paired with task Y's diff, different repository | **4/4 "no"** |
| **gutted** ×4 | the real diff with every `src/` hunk removed, leaving only the changelog and the agent's own test edits — unsatisfiable by construction | **4/4 "no"** |

The gutted control is the one that matters: it is the same prose, the same
changelog claim and the same agent-written tests, with the actual change taken
out. The judge said "no" on all four, so it is reading the diff rather than
scoring the story around it.

### The table

Twelve rows — the eleven the body of this capture reports, plus the twelfth
Postscript 1 added. Judge verdict against the held-out suite, re-run offline on
each patch the harness's way (a third copy, upstream's test files copied in
afterwards, exit 0 is a pass).

| judge verdict | held-out FAIL | held-out PASS |
|---|---|---|
| **yes** — satisfies the requirement as written | **12** | 0 |
| partial | 0 | 0 |
| no | 0 | 0 |

**Unanimous, in one cell.** Every one of the twelve changes the corpus labelled
`false_confidence` was judged to satisfy the requirement it was given, and every
one of them fails upstream's held-out test. Estimated spend **$0.30**; 12 calls,
one of which had to be re-asked because its reply was valid JSON but for a stray
`;` (re-asked, not hand-repaired — editing a model's reply into the shape the
parser wanted is the move this repository refuses elsewhere).

Per task, with the judge's own reason compressed:

| task | n | what the judge said |
|---|---|---|
| `attrs-frozen-exception-mutable-attrs` | 3 | adds `__notes__` and `__suppress_context__` to `_frozen_setattrs`' allowlist — "exactly satisfying the requirement" |
| `click-help-hint-shadowed-name` | 4 | the hint now derives its flag from the help option's actual names, so the reported command prints the requested line |
| `marshmallow-constant-required` | 4 | sets `load_default`/`dump_default` after `super().__init__`, so `required=True` no longer trips the mutual-exclusion check |
| `click-zsh-completion-colons` | 1 | escapes colons in the value passed to `_describe`, "which is exactly the fix the issue describes" |

### What this settles, and what it does not

**It settles the fork.** The reading that the eleven — now twelve — changes are
*genuinely incomplete against their own criterion* is not supported: an
instrument that says "no" eight times out of eight when the change is absent
says "yes" twelve times out of twelve when it is present. **The corpus's `wrong`
label is an upstream-agreement verdict**, exactly as `SPEC_BENCHMARK_V0` §3
says in writing, and (c) asked a criterion-authored check to catch changes that
label had selected.

**It does not rescue (c) and it is not offered as doing so.** (c) is 1 of 12
against a target of 80%, and the ruling's stop condition is a number, not an
argument. What this changes is what the miss *means*, which is precisely the
thing a de-scope-or-re-target decision turns on — and that decision belongs to
Marc and to a Fable window, not here.

**Three limits, stated rather than discovered later.**

1. **The judge and the corpus's agents are the same model family.** A model is
   being asked whether another instance's change satisfies a requirement, and
   agreement between them is not independent of their sharing a prior.
2. **"Satisfies the requirement as written" is not "correct".** The
   `click-zsh` row is the demonstration: the judge said yes with high
   confidence, and both the witness and upstream's test say the change does not
   produce the behaviour the issue asks for. A prose reading cannot see that.
3. **One draw per change.** No aggregate, no score, no crown — and no
   verdict here is consulted by any gate, now or later.

*Artifacts: `~/Claude/wringer-phase1-2026-08-15/judge-result.json`,
`judge-controls.json`, `witness_judge.py`, `judge_controls.py`,
`retry_two.py`, and `calibration-result.pre-retry.json` — the first pass, kept.*
