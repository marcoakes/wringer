# SPEC — acceptance evidence (the bridge)

*Drafted 2026-08-09 by the planning window from
`~/Claude/WRINGER_ACCEPTANCE_DOSSIER.md` (compiled by the executing window
against `3f752c1`; re-anchored here against the post-health tree, where
`wring health` — which this spec leans on — is shipped, not queued).
ADVERSARIAL REVIEW STATUS IS RECORDED AT THE END OF THIS LINE AND IS PART OF
THIS SPEC'S PROVENANCE: pending at draft time; the result line below this
paragraph is updated by the review slice and an empty review result is a
DEBT, never a pass. Marc delegated the rulings on 2026-08-09; all are
DECIDED below. Binding; no approval pauses remain.
[SPEC_SUPERVISION_V0.md](SPEC_SUPERVISION_V0.md) binds as everywhere;
[SPEC_INTENT_V0.md](SPEC_INTENT_V0.md) (the spec/plan/rubric machinery) and
[SPEC_VACUITY_V0.md](SPEC_VACUITY_V0.md) and
[SPEC_HEALTH_V0.md](SPEC_HEALTH_V0.md) are load-bearing and unchanged.*

*Review: three of four lanes ran 2026-08-09 — internal 4 findings (two
HIGH: a criterion occupying two states at once; a "verbatim" predicate
carrying an unstated exception), machinery 5 (two HIGH: `gate_diff` had no
channel to know the pairing; `health.GateRun` does not read `exit_code`),
positioning 0 after a full read. ALL NINE FOLDED — the two-layer taxonomy,
ruling 2's human-writes-the-line, the rejection table's fifth row, and §6's
pre-A0 sensitivity limit all exist because of them. **The corpus lane is a
DEBT: it died in a session teardown, and its re-run was cancelled to stop
token burn.** Its highest-risk questions were checked by hand in the
specing session (worker/judge isolation: `proves:` exposes criterion IDS
only, guidance text never enters config or briefs — plan trap 2; refusal
shape: matches vacuity's presence-opt-in/no-loosening-flag precedent by
construction; exit codes: verify observes, deliver's sixth refusal exits 1
like its five siblings, never 5 extended; attest: untouched, §8). A
machine re-run of that one lane is the plan's opening slice, and an empty
result there is not a pass.*

## Positioning

> **Every acceptance criterion carries the evidence that proves it — or is
> marked as the human judgement it always was.** Wringer today proves a
> change is *mergeable*; this bridge makes "gates pass" start to mean "the
> spec is satisfied", and rules honestly on which criteria can never make
> that trip.

The ambition behind it, sized honestly: a product manager writes acceptance
criteria; those criteria already travel untranslated from spec to rubric to
judge (`wringer.spec.v1` criteria ARE a `wringer.rubric.v1` criteria list by
construction, schema-pinned). What has never existed is the link between a
criterion and the gate that evidences it — nothing anywhere says *criterion
`csv-export-downloads` is proven by gate `test-csv-export`*. That link is
this feature. Everything else here is the honesty around it: what the link
may claim, who may create it, and what refuses when it is missing.

The one-sentence test for every design question below: **would this let a
claim of satisfaction outrun the evidence?** If yes, it is wrong.

## 1. What it does — no new command

```
gates:
  - id: test-csv-export
    run: "pytest -q tests/test_csv_export.py"
    proves: csv-export-downloads      # ← the feature, in one line
```

- **The binding is a `proves:` key on the gate, in `.wringer.yaml`** —
  criterion ids from `wringer.spec.yaml`, joined by id (ruling 2).
- **`wring verify` writes `acceptance.json`** — a sibling file in the run
  bundle, present exactly when the repo declares criteria, mapping every
  criterion to its state and its receipts (ruling 4, §4).
- **`wring deliver` refuses a bundle whose acceptance artifact shows a
  required criterion unevidenced** (ruling 5, §5) — the vacuity precedent:
  the refusal attaches to the bundle, repos that never opted in behave
  exactly as today, and no flag loosens it.
- **The summary and `--json` render coverage** — "9 of 12 criteria
  evidenced, 2 human, 1 UNEVIDENCED" — with per-criterion receipts, and a
  `gate-did-not-run` line whenever a bound gate left no result (§2's fourth
  state; a renderer with no slot for it would hide exactly the absence that
  must be loud).

There is deliberately no `wring accept` command in v0. Acceptance is derived
from evidence that verify already produces; a separate command would be a
second place for the same answer to drift apart (non-goal). `wring health`
remains the longitudinal view; this artifact is the per-run one.

## 2. The taxonomy — who may claim what (ruling 1)

Two layers, kept distinct because the first draft of this section conflated
them and its own review caught a criterion occupying two states at once.

**The author's sort** is three declarations, derived from two fields that
already exist — no schema edit, no new vocabulary, and **no model ever
sorts a criterion into a bucket**:

| declaration | derived from | means |
|---|---|---|
| **bound** | a gate carries `proves: <id>` | the author claims a declared command exits nonzero when the criterion is unmet — the bridge's whole population |
| **human-answered** | `human: true` on the criterion | a person answers, and the artifact says so. Two honest sub-cases live here, distinguished in `guidance` prose, not in machinery: judgement that is human *forever* (taste, tone, "the copy reads the way our users speak") and criteria that are checkable only against a running system, staging data, or real users — which today a person checks. A running-system evidence channel is named as the v1 candidate and nothing more |
| **unbound** | neither | a debt the author has not yet paid in either currency |

**The artifact's per-run state** is what `acceptance.json` records, and it
is a function of three inputs — the declaration, this run's gate result,
and the discrimination history (§3) — so binding alone never earns the
claim:

| state | reached when |
|---|---|
| `evidenced` | bound, gate passed in this run, AND the record shows the gate can fail (§3) |
| `unevidenced` | unbound — or bound but born green: passing now with no recorded failure and no sensitive row. Rendered UNEVIDENCED, in capitals, and refusing delivery when `required` |
| `human` | `human: true` — answered by people, not gates |
| `gate-did-not-run` | bound, but the gate left no result in this bundle (skipped, interrupted) — absence, never a pass-through |

The author sorts, in the spec file, through the same human approval that
owns the spec — `wring plan`'s drafter MAY propose `human: true` exactly as
it proposes everything else, because a draft is a proposal and the file a
human approved is the decision. The machinery's job is only to make the
sort's consequences visible: an unbound required criterion is loud, not
absent. Letting an LLM decide the bucket would seat a model as the arbiter
of what counts as proof — the one seat this program never gives one.

## 3. The evidence model — when is a criterion *evidenced*?

A criterion with a bound gate is **evidenced in a bundle** when BOTH hold:

1. **its gate passed in this run** — the ordinary meaning of green; and
2. **the record shows the gate can fail**: the repo's own history holds, for
   this `(id, command)` pair, a genuine failure — `status: failed`,
   `timed_out: false`, **and `exit_code != 127`** — or a `sensitive: true`
   vacuity row. The receipt names the bundle it was found in. The first two
   terms are health's genuine-failure predicate; the third is this spec's
   addition (ruling 7), because a missing binary records `failed` today and
   proves only that PATH was wrong — and slice A0 teaches health's own
   predicate the same exclusion, so the two converge rather than drift.

Clause 2 is the anti-fraud core (ruling 3). A worker that writes both the
acceptance gate and the code it must pass is the vacuity problem in a new
hat, and a gate born green proves nothing about the criterion — it has never
demonstrated it can tell satisfied from unsatisfied. The bench stated it
first (a benchmark of repair needs a red baseline); health says it across
time (a gate that cannot fail is not a gate); acceptance says it at the
moment the claim is made. The natural satisfying flow is the honest
workflow this program has always wanted: **install the acceptance gate
first, watch it fail — the criterion is unmet, which is true — then build.**
The remedy for a green-born gate is one run: `wring verify --prove` records
a sensitive row, or records the insensitivity that confirms the doubt.

Discovery for clause 2 reuses `health`'s shipped reader (`discover`,
`gate_runs`, sensitivity via `vacuity.read_verdict` — the same functions,
not lookalikes), over the same roots, with the same rule that bench-sourced
bundles never qualify (health ruling 9) — synthetic red from a bench
baseline must not launder a criterion any more than it may resurrect a
zombie. One additive extension is required and named: `health.GateRun`
today does not read `exit_code` from the result rows (the schema has always
recorded it; the reader drops it), so slice A0 adds that field to the
reader — a code change to health.py reading a field its frozen input format
already carries, not a schema edit — and clause 2's third term is computed
from it. Identity is `(id, command)` (health ruling 2): **edit the gate's
command and its discrimination history resets**, because an edited check is
how checks narrow, and the acceptance claim resets with it.

**`human: true` criteria never bind.** A gate whose `proves:` names a human
criterion is a config hard error naming both sides — a command claiming to
evidence judgement is a category error, and the existing law that human
criteria are never sent to a judge survives unchanged: this spec adds no
path by which anything scores them. They render `human — answered by
people, not gates`, and count toward neither evidenced nor unevidenced.

**Validation — the rejection table.** All four are config hard errors
(exit 2), the unknown-keys law is unchanged, and the table is the normative
list a derived test reads (DONE box 4):

| rejection | why |
|---|---|
| `proves:` names a criterion id absent from `wringer.spec.yaml` | a binding to nothing is a claim about nothing |
| `proves:` present with no `wringer.spec.yaml` at all | same, one level up |
| two gates prove the same criterion | one criterion, one gate in v0 — a second gate is a second claim to keep honest; lifted deliberately later if real repos need it, non-goal now |
| `proves:` on an `optional: true` gate, at all | evidence that cannot stop a run is a promise without enforcement — and `--prove` never proves optional gates (vacuity §6, binding), so the one-run remedy printed beside an unevidenced binding could never fire for one. The first draft forbade only the optional-gate/required-criterion pairing; its review caught that the permitted remainder was a binding whose remedy was impossible |
| `proves:` names a `human: true` criterion | a command claiming to evidence judgement is a category error (§3 below) |

One gate may prove at most one criterion; a gate with no `proves:` is every
gate today, untouched. A criterion bound to a gate that did not run in this
bundle (skipped, interrupted) is **not evidenced in this bundle** — absence
of a result is absence, never a pass-through to an older green.

## 4. The artifact — `acceptance.json` (ruling 4)

The `vacuity.json`/`usage.json` move exactly: a sibling file in the run
bundle, a new published schema `wringer.acceptance.v1` frozen in the same
commit, absent from every bundle whose repo declares no criteria, every
existing reader untouched, written through the bundle's redactor, covered by
`digests.json`. Per criterion: id · state (`evidenced` / `unevidenced` /
`human` / `gate-did-not-run`) · bound gate id and its redacted command ·
this run's result ref · the discrimination receipt (bundle-relative-to-repo
path + which kind, failure or sensitive) or `null` with the reason. Top
level: `schema_version`, counts that are never invented zeros (unknown is
`—` in renderings, absent in JSON), and `limits` (§6).

`wringer.evidence.v1` and `wringer.spec.v1` are frozen and stay frozen: no
field is added to either. The join needs nothing from them — criterion ids
exist, gate results carry `command`, and `.wringer.yaml` is config, not a
frozen bundle format.

## 5. Where it bites — delivery, by the vacuity precedent (ruling 5)

`wring deliver` gains its sixth refusal: **a bundle whose `acceptance.json`
records any `required` criterion `unevidenced` (or whose bound gate did not
run) does not deliver.** Everything about the vacuity refusal's shape is
kept deliberately: the refusal reads the artifact in the bundle (state
routes, only bundles gate); a repo with no `wringer.spec.yaml` writes no
artifact and behaves exactly as today, so opt-in is by declaring criteria —
presence, not a flag; there is no flag that loosens it and none that is
needed to tighten it; and the refusal message names the criterion, its
state, and the one-run remedy. A criterion that is `human: true` never
refuses — a person's judgement is not a gate's to hold hostage — and
`optional` (`required: false`) criteria render honestly and refuse nothing.
Exit codes: unchanged everywhere. Verify stays an observer of acceptance
(the artifact is a record, not a verdict — bench ruling 7's grammar);
deliver's refusal exits 1 exactly as its other five do; never 5, family
extended.

## 6. What the artifact refuses to claim — `limits`, pinned by content

1. *Evidenced means the bound gate passed and has demonstrably failed
   before. It does not mean the criterion is what the user needed, that the
   gate covers the criterion's whole meaning, or that coverage cannot narrow
   later — `wring health` watches that across time.*
2. *The gate ↔ criterion binding is a human's declaration. Wringer checks
   the binding's consequences, never its wisdom.*
3. *Human criteria are answered by people. Nothing here scored them.*

Limit 1's second clause is this spec inheriting vacuity §5a and health limit
4 in its own voice: a `sensitive` row or an old red proves the gate CAN
discriminate, not that the fix was honest, and a gate can satisfy clause 2
while testing a tautology it was later narrowed into. The longitudinal
answer is health's; the per-run answer is `--prove`; this artifact states
the boundary rather than blurring it.

One more inherited edge, stated rather than silently trusted: a vacuity row
records no exit code (`wringer.vacuity.v1`, frozen), so a `sensitive: true`
row written BEFORE slice A0 could in principle rest on a pre-change tree
whose gate died of a missing binary rather than of the change. A0 closes
the source — after it, a 127 pre-change result renders the prove
`inconclusive` (vacuity's own grammar for a broken environment, computed at
generation time from the result the prove pass just ran, no schema change) —
and rows older than the fix are covered by limit 1's wording rather than
filtered by machinery that has nothing to filter on.

## 7. Rulings

1. **The taxonomy is two layers — a human's sort from `human:` and
   `proves:`, and a per-run state the artifact computes — and a model
   never sorts — DECIDED** (§2). The author's three declarations come from
   two existing fields; the artifact's four states add this run's result
   and the discrimination history, so binding alone never earns the claim.
   The drafter proposes, the approved file decides, the machinery only
   makes the sort's consequences loud. No new criterion field, so
   `wringer.spec.v1` stays frozen and the rubric/judge law survives
   untouched.
2. **The binding lives in `.wringer.yaml` as `proves:` on the gate, and in
   v0 the HUMAN writes that line — DECIDED** (§1, §3). The link rides with
   the command, in the one file allowed to put commands into Wringer's
   mouth, through the same human act that installs the gate. The first
   draft had `spec.gate_diff()` proposing gates "with their `proves:`
   line" — the review broke that: the drafter's proposed gates are parsed
   from `wringer.spec.yaml`'s frozen gates section, which carries no
   `proves` field and may not grow one, so the diff has no channel to know
   the pairing. `gate_diff` is therefore UNCHANGED in v0 — it proposes the
   gate and stops, exactly as shipped — and the person applying the diff
   adds the `proves:` line, which makes "installing evidence is a human
   act" literally true twice. A spec-schema v2 carrying an optional
   `proves` on proposed gates is the named v1 channel and nothing more.
   Binding on the spec side today would need a frozen-schema edit; binding
   in a third file would be a second place for commands to acquire
   meaning.
3. **A criterion is evidenced only by a gate that passed now AND has
   demonstrably failed — DECIDED** (§3). The bench precedent chosen over
   the alternatives (human diff alone: already kept, necessary, not
   sufficient; separate gate-writing worker: kept as workflow guidance, not
   machinery — isolation without a receipt proves nothing). Born-green
   acceptance gates are the self-serving-test attack in its commonest form,
   and the remedy is one `--prove` run, printed in the refusal.
4. **The artifact is a sibling `acceptance.json`, and there is no new
   command — DECIDED** (§1, §4). The sibling-file precedent is three-for-
   three (vacuity, usage, health's report schema); an `accept` command
   would be a second derivation of the same answer, and the freeze law
   forbids the only alternative location.
5. **Unevidenced required acceptance refuses delivery, by presence opt-in —
   DECIDED** (§5). The strongest statement the corpus allows without a
   turned-off-by-noon wall of red: repos opt in by declaring criteria,
   refusal reads the bundle, no loosening flag exists. A report alone was
   rejected because a claim nobody is held to is the diagnosis this program
   was built against; attestation-limits-only was rejected because attest
   stays untouched (health ruling 8's reasoning, inherited).
6. **v0 is scoped to an existing repo with a working gate suite, and the
   positioning says so — DECIDED** (§8, §9-README). Greenfield — a PM's
   spec becoming a product from an empty directory — needs scaffolding
   this spec deliberately does not contain (no gates exist to bind, no
   baseline exists to be red against). Scoping it out is stated in the
   README edit itself so the northstar cannot outrun the machinery: the
   claim is the bridge, not the factory. Greenfield is the named v1
   direction, behind `wring wrap`'s on-ramp (next-act plan Move 2),
   unbuilt and unpromised here.
7. **Exit-127 is an environment answer, and clause 2 carries the exclusion
   in its own text — DECIDED.** A gate whose command is missing from PATH
   records `status: failed` today (found 2026-08-09, M3 dogfooding, chip
   filed) — which would have counted as a discrimination receipt while
   proving only that a binary was absent. So §3 clause 2 states all three
   terms — failed, not timed out, not 127 — rather than citing health "and
   also" excluding something, which this spec's own review caught as a
   contradiction dressed as a citation. Slice A0 fixes the recording
   forward AND teaches health's predicate the same exclusion; clause 2 is
   honest against unfixed history either way.

## 8. Non-goals (binding)

Any LLM call anywhere in classification, binding, or evidence · a `wring
accept` command · greenfield scaffolding (ruling 6) · a running-system,
browser, or staging evidence channel (named v1 candidate, §2) · scoring
`human: true` criteria by any path · auto-installing or auto-writing gates
(the diff stops for a person, always) · editing `wringer.spec.v1`,
`wringer.evidence.v1`, or any frozen schema · more than one proving gate
per criterion · a `proves:` flag on any CLI (config only) · coverage
percentages as exit codes or thresholds (a knob for making debts disappear)
· amending `wring attest` · Windows.

## 9. Definition of DONE

- [ ] the bridge end to end through real processes: a spec with a required
      criterion, `gate_diff` proposing the gate and stopping, the human
      applying the diff and writing the `proves:` line by hand (ruling 2 —
      the diff has no channel for it in v0, and the demo shows the honest
      flow rather than a flow the machinery does not have), the gate red at
      baseline (recorded), the work done, verify green — and
      `acceptance.json` reads `evidenced` citing the red bundle; then
      delivery succeeds, and reverting the criterion's binding reddens
      delivery, not just a test
- [ ] a required criterion with no binding renders UNEVIDENCED and refuses
      delivery with the criterion named; marking it `human: true` (the
      author's honest out) lifts the refusal and changes its rendering, and
      a test pins both directions
- [ ] a born-green gate (no failure, no sensitive row in history) leaves its
      criterion unevidenced despite passing, the refusal prints the
      `--prove` remedy, and one recorded sensitive row flips it — pinned by
      a test that reverts exactly the sensitivity read
- [ ] every row of §3's rejection table fails config validation with a
      message naming both sides — and the test's list of rejections is
      DERIVED by parsing that table out of this spec file (the roadmap
      guard's method), so a rejection added to the spec without a test, or
      a test dropped while its row remains, both go red
- [ ] an edited gate command resets discrimination: the old command's red
      history cannot evidence the new command's criterion — health ruling
      2's test method, applied to the acceptance join
- [ ] a bench-baseline red row and an exit-127 row each fail to serve as a
      discrimination receipt — planted, one test each (ruling 7)
- [ ] a criterion whose gate was skipped or interrupted in this run reads
      `gate-did-not-run` and refuses if required — absence is absence
- [ ] `acceptance.json` validates against a published
      `acceptance.schema.json`, frozen in the same commit, drift test
      extended, the freeze manifest updated, and the schema README row
      present (the derived guard from B3 covers this)
- [ ] the three `limits` are pinned by content, not by non-emptiness
- [ ] repos with no `wringer.spec.yaml` write no artifact and a
      byte-level test pins that their bundles are unchanged — the opt-in
      boundary is a test, not a promise
- [ ] every parser-derived guard passes in the shipping commits: hierarchy
      row for this spec, module map if a module is added, no gate probing
      from hand-kept lists, and the README/QUICKSTART guards over the
      re-aimed wording
- [ ] the README re-aim ships with the spec, its claim exactly the
      positioning line's, greenfield scoped out in the same breath, and the
      existing README guards (thesis lead, understatements, counts) green
      in the same commit
