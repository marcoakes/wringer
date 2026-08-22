# The witness programme — the phases, and what takes the claim back out

*Written 2026-08-15. This file exists for one reason: the phase order and the
pre-commitment that rides on it were recorded only in ruling documents outside
this repository, and **a future window must be able to execute the retreat
without them.** Everything load-bearing is transcribed here rather than
referenced.*

The rulings behind it: `WRINGER_RULING_2026-08-14` (the witness ruling) and
`WRINGER_RULING_2026-08-15` (the fork ruling). In the repository, the binding
text is [specs/SPEC_GATEGEN_V0.md](specs/SPEC_GATEGEN_V0.md) §6 (W1–W10) — the
contract — and this file is the schedule.

## Why there is a programme at all

The first corpus run measured this program's operating assumption and
disproved it ([corpus-2026-08-13.md](corpus-2026-08-13.md)): in the regime the
product targets, the repository's declared gates carried **zero information
about the change** — `wring deliver` said yes on 26 of 26 supervised rows
including every wrong one, and `--prove` afterwards returned `gates_vacuous`
on 13 of 13. The replacement thesis is one sentence:

> **Evidence is manufactured, not found.** A check is evidence about a change
> only if it was demonstrated able to fail in that change's absence with
> respect to the criterion it proves; Wringer's job is to ensure such a check
> exists — authoring it when the repository lacks one — to prove the red, pin
> it, and to refuse or route to a human when it cannot.

## The phases

| | phase | state |
|---|---|---|
| **P0** | Salvage the corpus patches | **DONE** 2026-08-13/14 — 52 trees, 51 patches verified, `wringer.benchmark.v4` |
| **P1** | The witness author, calibrated offline | **CLOSED** 2026-08-15 on (a)+(b); see below |
| **P2** | Contain the worker | **DONE** 2026-08-15 — [specs/SPEC_CONTAIN_V0.md](specs/SPEC_CONTAIN_V0.md), built at `f002bd0`: the worker joins a netns holder WITHOUT `NET_ADMIN`, so it cannot disarm its own boundary. Sequence I ran against it with a `--privileged` control |
| **P3** | Wire delivery, then re-test live | **DONE 2026-08-16, and the re-test LOST.** Wired at `f310b7f` (`wringer.acceptance.v2` — a red witness refuses a delivery); the pass ran the same day and missed three of §5's six clauses ([corpus-2026-08-16.md](corpus-2026-08-16.md)). The stop was 2026-09-30; it ran six weeks early |
| **P4** | Standard emission (in-toto), then release 0.4.0 | **Half done, and the other half will not happen.** In-toto emits beside the bundle (`f27681a`, R3 discharged). **0.4.0 did not ship on this programme's terms** — and it is left standing
because it was the ruling at the time. *Dated note, 2026-08-22: `0.4.0`
shipped later anyway, for a different reason — the four packages merging into
one — and `0.4.1` and `0.4.2` after it. The bar below was not met and was not
what released it.* The original sentence, as it stood at the time: R4 gates the release on a re-test WIN and the re-test lost. Tags stop at `v0.3.0` (dated note: they no longer do) |

### P1 — closed, and how

The stop was three numbers. The capture is
[witness-calibration-2026-08-15.md](witness-calibration-2026-08-15.md).

| | target | result | |
|---|---|---|---|
| **(a)** witness proved RED pre-change, for the right reason | ≥ 9 of 13 | **12 / 13** | HIT |
| **(b)** of those, GREEN on upstream's true fix | ≥ 8 | **10 / 12** | HIT |
| **(c)** RED on the salvaged known-wrong changes it covers | ≥ 80% | **1 of 12 — 8%** | **MISS** |

**(c) was RETIRED on 2026-08-15 as invalid-as-specified**, and Phase 1's stop
was amended to (a)+(b), both hit. The reason is not that the number was
disliked. A judge diagnostic with 8/8 negative controls found **12/12** of the
covered "wrong" changes satisfy the stated criterion, and **12/12** fail
upstream's held-out test — so the corpus's `wrong` label is an
**upstream-agreement** verdict, and (c) asked a criterion-authored check to
reproduce an upstream-agreement oracle. No criterion-derived instrument can do
that in principle: a change that satisfies the stated criterion while diverging
from upstream is indistinguishable, *from the criterion*, from one that agrees.
`SPEC_BENCHMARK_V0` §3 pre-registered exactly this limit in writing before any
number existed. Under W10 the single (c) catch was location-luck, so the honest
(c) is 0/12 — the retired number was inflated, not deflated.

The 8% stands in the capture unedited. Nothing was re-scored.

## The pre-commitment, and its automatic trigger

**This is the part a future window must be able to execute alone.**

R2 of the witness ruling put bug fixes in scope *conditionally*, and wrote the
condition into the README:

> **Wringer delivers only on evidence that could have failed.** For net-new
> work, a generated gate is red because the feature does not exist yet. For bug
> fixes, Wringer authors a reproduction witness from the criterion and proves
> it red on the pre-change tree before the work begins. Where no red witness
> can be established, Wringer does not guess: the criterion exits
> `unevidenced` and a human decides.

Beside it, the **claim ceiling** — no artifact in this repository may exceed
it, and none may claim the witness "catches wrong fixes":

> A witness proves the stated criterion could fail and was made to pass; it
> does not certify agreement with an unstated intended fix, and where the
> criterion under-describes the intent, the witness inherits that gap.

**The trigger moved from Phase 1 to Phase 3, and became automatic.** It was
"if Phase 1 misses its calibration stop, bug fixes are de-scoped". Phase 1's
stop is now (a)+(b) and both hit, so nothing fires there. Phase 3 is the one
venue for the prevention question, and:

> **A Phase 3 loss fires the bug-fix de-scope AUTOMATICALLY.** The implementing
> window performs the README edit R2 specified — the sentence above comes out,
> net-new work only, where the red is natural — **without a further ruling.**
> Marc may overrule; nobody else needs to be asked, and no window may treat the
> retreat as a question.

Pre-registered here so it cannot be lawyered after the run: **a loss driven by
criterion-satisfying-but-upstream-divergent deliveries still fires it.** If the
identifiability limit makes the Phase 3 stop unwinnable, then the wide claim is
unlicensable, which is the same fact wearing its honest name. R4's
no-release-until-a-win stands in addition: 0.4.0 does not ship on a loss. *Dated note, 2026-08-22: at the time that was the ruling; 0.4.0 shipped later on different grounds — the packages merging — and never on this bar.*

## The Phase 3 stop, transcribed in full

One pass over the 13-task corpus, ~$38, by **2026-09-30**, worker contained
(P2's stop hit first), witness lane on. Preconditions: `.git` truncation,
`forbidden_shas` enforcement, `FETCH_HEAD` deletion and the post-arm
`check_isolation` VOID rule all standing as built; the witness author isolated
identically to the worker — pre-change tree, truncated history, no upstream
reachability.

1. **Coverage:** witness proved RED pre-work on **≥ 9 of 13**. Uncovered rows
   exit `unevidenced` to a human and count as neither win nor loss — but **> 4
   uncovered is a coverage loss** and returns the programme to Phase 1.
2. **False greens on covered rows ≤ 1**, target 0. Baseline: 3 per pass, and
   `deliver` said yes to all of them.
3. **Of the wrong changes that occur on covered rows, ≥ ⅔ end repaired or
   refused** — and at least one row must show the repair loop running ≥ 1
   worker turn with a red witness converting to green. The loop ran zero turns
   in 26 attempts last time; the loop *existing in the data* is part of the
   claim.
4. **False refusals ≤ 2.** A correct fix refused twice is tolerable evidence of
   strictness; more is the constant-no failure wearing a new hat.
5. **Contingency:** if fewer than 2 wrong changes occur in the pass, the pass
   decides nothing about prevention — run a second pass (~$38) before claiming
   anything.
6. **Void rules:** a post-arm `check_isolation` firing, a witness digest
   mismatch, or a contamination signal VOIDs the row; **> 2 VOID rows
   invalidates the pass** — fix, then re-run.

**None of these numbers may be softened.** A window that reaches Phase 3 and
wants a different number is a window asking to grade its own homework.

**What a win licenses, exactly:** the README sentence above, plus a published
capture in the house style — counts, no aggregate score, no crown, the corpus
shape named. On a 13-task corpus a win is proof of life, not proof of market.

## What is NOT in the programme

The stop list stands entire: judge calibration is dead (the 2026-08-15
diagnostic licensed the corpus label reclassification and nothing else — a
judge may retire a ruler, it may never become one), evidence-aware caching is
dead, mutation testing as a merge gate is dead. No 20th top-level command; the
witness lane lives inside existing surfaces. `wringer.attestation.v1` is frozen
and gains no v2 dialect — P4 emits the standard alongside it.

---

## 2026-08-16 — Phase 4: what landed, and how the programme ended

*Appended by the implementing window. The programme document says what takes
R2's README sentence back out; this records where the answer stands.*

> **CORRECTED 2026-08-16, later the same day.** The paragraph below said *"The
> de-scope has NOT fired, and it has NOT been earned off either"* — true at the
> moment it was written, with the pass still running, and false by the time the
> pass finished that afternoon. **The de-scope FIRED.** The pass lost on three of §5's
> six clauses, and commit `039bebc` performed R2's README edit automatically,
> exactly as the pre-commitment below requires. The original paragraph is kept
> underneath rather than deleted, because a status document that silently
> flips its own answer is the defect this correction exists to stop — the
> third time this class has been caught in this repository, after `SECURITY.md`
> and `backend.LIMITS_V1`.
>
> The retreat, in one line: the bug-fix sentence is out of the README, the
> ratchet seam is served by GATEGEN alone, and no artifact here may present the
> witness lane as a second supplier unless Marc authorises another pass and it
> wins. The evidence is [corpus-2026-08-16.md](corpus-2026-08-16.md).

*Superseded, and quoted rather than restated — what follows is no longer this
document speaking:*

> The de-scope has NOT fired, and it has NOT been earned off either. Its
> trigger is a Phase 3 LOSS on §5 as written, and §5 is defined over *one pass
> over the 13 tasks*. That pass was launched on 2026-08-16 and had not finished
> when this window ended, so there is no §5 verdict — not a win, not a loss.
> Nothing in this window licenses R2's sentence any more widely than it already
> was, and nothing takes it away.

**Why the money waited, and it was not caution.** `WRINGER_RULING_2026-08-14`
§5.3 requires a row where the repair loop ran ≥1 worker turn with a red witness
converting to green. The loop's continuation predicate was gate-only, and the
corpus selects tasks whose declared gates do NOT cover the issue — so on every
task the gates were green at base and every loop converged at iteration 1
having briefed nobody. **§5.3 was unsatisfiable as built**, and a pass launched
before P4-1 would have spent the single authorised run measuring nothing.

**Three independent checks each found something the others did not**, which is
the part worth carrying forward:

| check | what it cost | what it found |
|---|---|---|
| the suite | $0 | nothing — every defect below passed it |
| one review agent, refute-instructed | $0 | **NOT SOUND**: 14 findings, 4 HIGH. Both HIGHs against the spec's own claims came from MUTATION — deleting a mechanism and watching the suite stay green — not from reading |
| the re-armed gate, one real task | ~$20 | a **false proved-red** (a witness proved inside the containment, executed on the host, recorded `covered: true` for a check that never ran), then a **0/13 coverage wipe** (the corpus's dependencies live in a separate gate venv) |

**The rule that generalises: a false proved-red is strictly worse than an
uncovered criterion.** Uncovered exits to a human and counts as neither a win
nor a loss, by §5.1's own terms. A false one manufactures coverage out of a
check that cannot execute — in the exact number the pass is scored on.

**A spend guard was added and it is a deviation worth naming.** The prompt
budgeted ~$38 for the pass. Three measured tasks came in at $1.63, $5.71 and
$11.01, so 13 tasks could have crossed the $75 authorisation. The pass now runs
one task at a time and stops while it can still afford the worst task it has
seen. **A partial pass cannot satisfy §5**, which is defined over one pass
across the corpus, and any un-run task is named rather than dropped.

**One task can never count until its repository is rebuilt.**
`attrs-frozen-exception-mutable-attrs` has the answer commit reachable in its
own `.git`; preflight refused it at $0 rather than paying for a row that would
have been VOID.
