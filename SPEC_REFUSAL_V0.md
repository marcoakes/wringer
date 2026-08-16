# SPEC — refusal legibility: the engine names what it refuses and why (v0)

*Drafted 2026-08-16 by an Opus implementation window under
`~/Claude/WRINGER_REMAP_RUN_PROMPT_2026-08-16.md`, which carries the Fable
direction ruling of the same day. Inputs: `SPEC_BOARD_V0.md` §4, §12 (the OQ
list this spec discharges) and §8 (non-goals that bind anything the board does
with this); `WRINGER_RULING_2026-08-15.md` **§Q1**, whose claim ceiling binds
every sentence here; `WRINGER_FACTORY.md`, which governs the order of work and
outranks this file.*

*Every "exists today" claim below was read out of the tree at **`478494c`** and
carries its `file:line`. Nothing here is recalled.*

> ## ⚠ NOT REVIEWED. NOT BUILT. DO NOT BUILD TO THIS YET.
>
> **The independent review did not happen.** It was launched on 2026-08-16 and
> the reviewing agent was terminated mid-pass by an account spend limit, having
> produced no findings. This house's law is one independent refute-instructed
> review before any code, so **no code was written** and none may be until that
> review runs. §12 records what happened and what the next window must do.
>
> §12 also records an **author's self-check**, which is explicitly *not* the
> review — the author of a document is the worst available reviewer of it — and
> which already found one HIGH defect this document did not have when it was
> drafted. That is evidence for the law, not against it.

---

## Positioning

> **A refusal that only a person can read is a refusal only a person can act
> on.** Wringer already refuses in all the right places. What it does not do is
> say, in a form a machine can consume, *which* refusal happened — so every
> surface downstream must parse English prose to find out, and a surface that
> parses prose renders the wrong thing the day the prose is reworded.

This cycle changes no policy about *when* Wringer refuses, with exactly one
deliberate exception (§3, OQ-1), and it adds no new judgement of any kind. It
takes facts the engine already computes or already knows and writes them down
under names.

**The one-sentence test for every ruling here:** *could this change make a
delivery look better than the evidence says it is?* If yes, the design is
wrong. Three of the four items make refusals MORE visible and one adds a
refusal that does not exist today. None removes or softens one.

**Why now, and why it counts as surface work.** The board's plain-language
refusal mapping (`SPEC_BOARD_V0.md` §4, ruling 16) must be **total** over what
the engine can emit, and the test that forces totality can only enumerate from
public symbols. Two of its eight families have no symbol to enumerate from:
delivery refusals have no names at all (ruling 19), and `unevidenced`'s causes
are told apart by matching free text (ruling 15). The board can be honest about
that — it renders UNTRANSLATED and shows the engine's own words — but honest is
not the same as finished. **These names are what let a PM read a refusal.**

---

## §1 — The four items, where each lands, and how a reviewer catches a violation

A row whose "how to check" says only "see §N" is a failed row.

| | what it says | lands in | how a reviewer catches a violation |
|---|---|---|---|
| **OQ-1** | an unanswered required `human` criterion refuses delivery | §3 — `accept.py` policy, `wringer.judgement.v1`, `wringer.acceptance.v3` | `test_an_unanswered_required_human_criterion_refuses` and `test_an_answered_one_does_not` — **both directions, and the second is the one that matters**, because a change that refuses everything passes the first. Plus `test_a_judgement_whose_criterion_moved_is_stale`: edit the criterion's wording and the row refuses again |
| **OQ-2** | delivery refusals get named reasons | §4 — `deliver.REFUSAL_REASONS`, `wringer.refusal.v1` | `test_every_refusal_site_names_a_reason` parses `deliver.py` for `raise Refused(` and fails on any site with no `reason=`; `test_every_named_reason_is_raised_somewhere` fails on a name in the tuple that no site uses. **Set equality in both directions** — a name nothing raises is dead text that reads as coverage. Structurally, `Refused.__init__` requires the argument, so a new site cannot omit it |
| **OQ-3** | the engine writes demonstrated-able-to-fail for non-evidenced rows | §5 — a field on `wringer.acceptance.v3` | `test_a_gate_the_record_shows_can_fail_says_so_while_failing` and `test_a_born_green_gate_says_false`, plus `test_an_unbound_row_says_null` — three values, three fixtures, because a two-valued field would have to lie about the third case |
| **OQ-4** | `unevidenced`'s causes are named in the artifact | §6 — a closed `cause` enum on `wringer.acceptance.v3` | `test_every_unevidenced_site_sets_a_cause` walks `accept.py`'s emission sites; `test_the_five_causes_are_each_reachable_from_a_fixture` builds one record per cause. A cause value the code cannot produce fails the same set-equality test |
| **OQ-5** | `sign.py` exposes an `INTEGRITY_STATES` tuple | **ALREADY LANDED** — `ab884b5`, `sign.py:90` | Nothing to build. §7 records the residue check and its answer, which is *none* |

---

## §2 — What this cycle spends, verified at HEAD

Law 7: frozen shapes never change; new facts get new versions or sibling
files. `schema/frozen.json` states in its own `_comment` that **adding a NEW
schema file is always allowed**.

| artifact | status at `478494c` | this cycle |
|---|---|---|
| `schema/acceptance.schema.json` (`wringer.acceptance.v1`) | frozen | untouched |
| `schema/acceptance-v2.schema.json` (`wringer.acceptance.v2`) | frozen — **spent by the witness lane at `f310b7f`** | untouched |
| `schema/acceptance-v3.schema.json` (`wringer.acceptance.v3`) | does not exist | **NEW** — OQ-1, OQ-3, OQ-4 |
| `schema/refusal.schema.json` (`wringer.refusal.v1`) | does not exist | **NEW** — OQ-2 |
| `schema/judgement.schema.json` (`wringer.judgement.v1`) | does not exist | **NEW** — OQ-1's input |
| `schema/spec.schema.json` (`wringer.spec.v1`) | frozen, `additionalProperties: false` on the criterion object (`spec.schema.json:76`) | **untouched — and this is why OQ-1's input is a sibling file** |

**The version-selector rule, inherited unchanged from v2** (`Result.has_witness`,
`accept.py:269-278`; the two write sites are `accept.py:305` and `accept.py:318`):
a repository that uses none of this writes a byte-identical earlier version and
pays nothing. **The absence of a v3 record is what tells a v2 reader it may
proceed.** Concretely: v3 is written only when the record contains a `human`
criterion **or** any row carries a `cause` or a `demonstrated_able_to_fail`
that a v2 row could not have carried. Otherwise the existing selector decides
between v1 and v2 exactly as it does now.

*The OQ rulings of the Phase 2 window said OQ-1/3/4 would share one
`wringer.acceptance.v2` spend. **That is superseded by events, not by
argument**: v2 was spent at `f310b7f` on the witness lane before this cycle
started. HEAD wins; the spend moves to v3. The delta is recorded here rather
than reconciled silently.*

---

## §3 — OQ-1: an unanswered required human criterion refuses delivery

### Ruling 1 — the policy change, stated exactly

Today `Row.refuses` is `required and covered and state != EVIDENCED`
(`accept.py:228-244`), and `covered` is `gate_id is not None or (witness is not
None and witness.covers)` (`accept.py:218-226`). A `human` criterion gets
`state=HUMAN`, no gate and no witness (`accept.py:468-473`), so it is **not
covered**, cannot refuse, and never stops anything. The A-probe caught this on
real data: a criterion marked `required: true, human: true`, never judged by
anyone, and `wring deliver` branched, committed and pushed.

**Ruled: a required `human` criterion refuses delivery unless a person has
recorded that it is met.** After this cycle:

```
refuses = required and (
    (covered and state != EVIDENCED)
    or (state == HUMAN and judgement is not MET)
)
```

**"is not MET" covers three distinct situations and they are three distinct
named causes, never one** (§6's discipline, applied here):

| situation | cause | why it is not the others |
|---|---|---|
| no judgement recorded | `human-unanswered` | nobody has looked. The board's NEEDS YOU card, and the only one that is a *waiting* state |
| a judgement recording `not_met` | `human-said-no` | somebody looked and said no. This is not waiting; it is a decision, and rendering it as waiting would erase the person who made it |
| a judgement whose criterion has since been reworded | `human-judgement-stale` | somebody answered a **different question**. See ruling 3 |

### Ruling 2 — where a judgement lands, and why it is a sibling file

`wringer.spec.yaml` is `wringer.spec.v1`, frozen, and its criterion object is
closed with `additionalProperties: false`. An `answer:` key on a criterion
would therefore cost `wringer.spec.v2` — a version that reaches the drafter,
the approval interlock and `wring plan`, for a field none of them produce.
**A sibling file is the cheaper and the more honest shape**, and it is the
pattern this repository has already used twice for the same reason:
`digests.json` beside a frozen `wringer.evidence.v1` and `briefed.json` beside
a frozen `wringer.loop.v2`.

**`wringer.judgements.yaml`** at the repository root, schema
`wringer.judgement.v1`. One entry per criterion a person has judged:

| field | meaning |
|---|---|
| `criterion` | the id it answers |
| `verdict` | `met` or `not_met`. **Two values, closed.** There is no `partially`, no score, and no third value that means "probably" |
| `by` | a free-text name. Recorded, never verified, and the schema says so — this is not an identity system |
| `at` | ISO-8601, the person's own claim about when |
| `criterion_digest` | sha256 of the criterion text this answers (ruling 3) |
| `note` | optional, free text, rendered verbatim wherever it is rendered at all |

**It is a file a person edits, exactly like `approved: true`, and for exactly
the same reason.** There is deliberately **no flag, no `--judge`, no
`--accept-human`, and no environment variable** that writes an entry. Nothing
in this cycle gives any model, agent or command the ability to answer a
criterion a human was asked to answer — a `human: true` criterion exists
precisely because a model asked anyway would be guessing
(`spec.schema.json:96-99`), and a machine that could fill in its own answer
would be the vibe tooling this programme exists to answer.

*A later surface slice may write this file on a person's click, on exactly the
terms `SPEC_BOARD_V0.md` §5 ruling 20 sets for `approved: true` — the button
writes what the hand edit writes, byte for byte, and there is no path that
answers without rendering what is being answered. That is not this cycle, and
`SPEC_BOARD_V0.md` §8 non-goal 9 (the surface writes only
`wringer.spec.yaml` and its own output) stands until a reviewed slice amends
it.*

### Ruling 3 — a judgement is pinned to the question it answered, and to nothing else

`criterion_digest` is the sha256 of the criterion's own text — its `id`,
`title` and `guidance`, canonicalised. If the requirement is reworded, every
judgement of it goes **stale** and the row refuses again under
`human-judgement-stale`. This is the `briefed.json` discipline
(`staleness.AUTHORITY_DOCUMENTS` at `staleness.py:53-57`, captured by
`staleness.capture` at `staleness.py:102-104`) applied one level down: *nothing may move under an
answer.*

**What it deliberately does NOT pin, stated because it is the weak part and
hiding it would be the defect this repository exists to catch.** A judgement is
not pinned to a tree, a commit, a bundle or a build. A person judged a running
product at a moment; later work can break what they approved, and **nothing in
this cycle detects that.** Two reasons it is out:

1. Pinning to the tree would invalidate every human judgement on every commit,
   which is a constant-no wearing a rigour costume. `SPEC_BOARD_V0.md` §1's B6
   row and this repository's whole history are clear that a refusal which
   always fires teaches people to route around it.
2. The honest mechanism for "the thing I approved has regressed" is not a
   digest, it is the ratchet: the person says so, and the correction becomes a
   criterion with a check demonstrated red today. That is
   `SPEC_GATEGEN_V0.md`'s path and it is built.

**So the limit goes in the artifact, in the engine's own voice.** A record
carrying any judgement gains one entry in `acceptance.json`'s `limits[]`: *a
human judgement records that a person said this was met at a moment, against
the requirement as worded then; it is not re-checked by anything, and later
work can invalidate it without this record changing.* `acceptance.json`'s
`limits[]` already render verbatim on the board (`SPEC_BOARD_V0.md` ruling 9),
so this reaches the PM without a translation anybody has to maintain.

### Ruling 4 — what the row carries, and what it does not become

A `human` row in v3 gains an optional `judgement` object: `verdict`, `by`,
`at`, `note`, and `stale` (boolean, computed at read time by comparing
digests). Its `state` stays **`human`**.

**It never becomes `evidenced`, and that is not a technicality.** `evidenced`
means a bound check passed now and the record shows the same check recorded
failing (`accept.py`, `SPEC_ACCEPT_V0.md` §3). A person saying yes is a
different kind of fact, it has no receipt, and rendering it under the same
word would put a human judgement inside the sentence "every green was red
first" — which would be false, and would be exactly the overclaim
`SPEC_BOARD_V0.md`'s B3 exists to prevent. The five-value `state` enum is
therefore **unchanged in v3**.

### Ruling 5 — the refusal message goes through the machinery that already exists

`deliver.py:606` builds the acceptance refusal from `refuses` rows
(`accept.py:267`). A `human` row that refuses arrives there by the same route
as every other refusing row and prints in the same block, with its cause's
sentence. **No new refusal path, no new exit code, no second code path that can
drift from the first.**

---

## §4 — OQ-2: the delivery refusals get names

### Ruling 6 — a closed, public tuple, and the constructor requires it

`deliver.py` raises `Refused` at **23 sites**, verified by count at
`478494c`. Every one is a prose string plus an exit code; there is no enum, no
machine-readable record, and a refused delivery writes nothing at all.

**`deliver.REFUSAL_REASONS`** becomes a public tuple of 23 names, and
`Refused.__init__` takes `reason` as a **required** argument. The requirement
is structural on purpose: a test that a new site named a reason can be
forgotten; a constructor that will not build without one cannot.

| name | site | what it is about |
|---|---|---|
| `unfinished_git_operation` | `deliver.py:120` | machine/tree |
| `no_git_identity` | `141` | machine |
| `remote_unreachable` | `187` | machine |
| `head_moved` | `230` | **evidence** — the gates never ran against this tree |
| `tree_moved` | `262` | **evidence** |
| `tracked_contents_differ` | `284` | **evidence** |
| `untracked_record_unreadable` | `332` | **evidence** |
| `untracked_record_unknown_version` | `349` | **evidence** — an unanswerable check refuses rather than passes |
| `files_unreadable_at_verify` | `359` | **evidence** |
| `unsupported_file_type` | `367` | machine/tree |
| `untracked_file_moved` | `384` | **evidence** |
| `case_alias_collision` | `456` | machine/tree |
| `gates_vacuous` | `479` | **evidence** — artifact-reachable |
| `authority_moved` | `518` | **evidence** — artifact-reachable |
| `signature_required` | `553` | policy |
| `acceptance_unevidenced` | `606` | **evidence** — artifact-reachable |
| `default_branch_unknown` | `638` | machine |
| `gates_did_not_pass` | `679` | **evidence** |
| `nothing_to_deliver` | `743` | tree |
| `branch_is_base` | `751` | machine/policy |
| `branch_is_default` | `758` | machine/policy |
| `branch_is_current` | `765` | machine/policy |
| `branch_exists` | `771` | machine/policy |

**A correction to `SPEC_BOARD_V0.md` ruling 19, made here rather than left to
be inherited.** That ruling says three of the 23 are reachable from an artifact
and characterises "the other twenty" as being about git and the machine, while
stating plainly that its review did not re-check the characterisation. Reading
all 23: **the three artifact-reachable ones are right**, and the
characterisation of the remaining twenty is **wrong for eight of them**. Seven
`head_moved`-family refusals and `gates_did_not_pass` are refusals about
whether the evidence covers the change being delivered — the most substantive
refusals in the file — and one more, `signature_required`, is a policy the
repository declared. Ruling 19's *rendering rule* is unaffected and this spec
does not change it; the reading it disclaimed is corrected.

### Ruling 7 — the refusal record, and the one direction its failure may go

On refusal, `wring deliver` writes **`refusal.json`** into a delivery
directory allocated for the attempt: `schema_version: wringer.refusal.v1`,
`reason`, `exit_code`, `message` (the prose, verbatim), `at`, and `run` (the
bundle id where one is known, `null` otherwise).

**The prose is kept, not replaced.** A name is for machines; the sentence is
what tells a person what to do, and this repository's refusals carry remedies
inside them (`deliver.py:141` prints the `git config` commands to run). Dropping
the prose in favour of an enum would be a downgrade wearing a schema.

**One-directional failure, and it is a test.** If the record cannot be written
— unwritable directory, full disk — the refusal still happens, with the same
exit code and the same message, and the failure to write is printed rather than
swallowed. **Nothing about this feature may convert a refusal into a success**,
and `test_a_delivery_still_refuses_when_the_record_cannot_be_written` pins it
with an unwritable path.

### Ruling 8 — no refusal changes, moves, or gains a route around it

This cycle adds no refusal to `deliver.py`, removes none, changes no exit code
and changes no condition. Naming a refusal is not negotiating with it: there is
still no `--force`, no `--allow`, and no configuration that turns one off. The
diff to `deliver.py` is a `reason=` argument at 23 sites plus one write, and a
reviewer who finds anything else in it has found a violation.

---

## §5 — OQ-3: whether the record shows this check can fail

### Ruling 9 — a three-valued field, because two values would have to lie

`accept._discriminating_pairs(root)` (`accept.py:622-634`) already computes
`{(gate_id, command): Receipt}` for every pair the record shows can fail,
reusing `health`'s reader so the exclusions live in one place — bench-sourced
bundles never qualify, and timeouts and exit 127 are already excluded. It is
consulted for rows that reach `evidenced` and thrown away for everything else.

**Ruled: every row carries `demonstrated_able_to_fail`.**

| value | meaning |
|---|---|
| `true` | this row's `(gate, command)` pair appears in the record having genuinely failed |
| `false` | it does not. **Not "cannot fail"** — only that nothing on disk shows it doing so |
| `null` | there is no bound check to ask about (unbound, or `human`). *Not asked* and *asked, answer no* are different facts, and this repository has paid for conflating them before (`accept.py:424-426` makes the identical distinction about `created`) |

**It is a field, not a judgement** — the value is read out of a computation the
engine already performs, and no new inference is introduced. The field name
carries its own ceiling: *demonstrated*, about the record. A field called
`can_fail` would be a claim about the world, which nothing here can support.

### Ruling 10 — what this earns, and what it does NOT license yet

It earns the strongest honest sentence a not-yet-built requirement can have:
*the check that will decide this is written, it has been demonstrated able to
fail, and the work simply is not done.* That is what `SPEC_BOARD_V0.md`
ruling 4 refused to render as PROVEN-RED, for the stated reason that the
surface would have to recompute it and ruling 1 forbids that. **This removes
that obstacle and licenses nothing by itself.**

Rendering it remains a board non-goal (`SPEC_BOARD_V0.md` §8 non-goal 7) until
a reviewed board slice takes it, and **this spec does not take it**: the board
work in flight is the refusal-language mapping and the interview surface. A
window that reads this section as permission to add a card state has misread
it.

---

## §6 — OQ-4: `unevidenced` has FIVE causes and each gets a name

### Ruling 11 — the enum, closed, with the fifth cause included

`SPEC_BOARD_V0.md` ruling 15 enumerated **four** causes from `accept.py` at
`d23d7ca`. The witness lane added a fifth, and it was found on real data rather
than by reading: the board's own tests recorded it and wrote *"Naming it a
fifth cause with its own sentence is S2's job, not S1's"*
(`wringer-board/tests/test_real_bundles.py:79-96`). At `478494c` the sites are:

| cause | site | the engine's condition |
|---|---|---|
| `unbound` | `accept.py:485`, no witness | no gate binds the criterion and no witness covers it |
| `witness-evidenced-nothing` | `accept.py:485`, `witness.discarded` | **the fifth.** No gate binds it, a witness was authored, and the witness demonstrated nothing — so its red says nothing about the criterion |
| `born-green` | `accept.py:532` | the bound gate passed and nothing in the record shows it can fail |
| `pre-existence-unestablished` | `accept.py:557` | a sensitivity receipt whose pre-existence could not be established |
| `arrived-with-the-work` | `accept.py:569` | the check was created by the change it judges |

**Both directions, forced.** `test_every_unevidenced_site_sets_a_cause` fails on
an emission site with no cause; `test_every_cause_is_reachable_from_a_fixture`
fails on a name the code cannot produce. A sixth cause added without joining the
tuple reddens rather than ageing quietly — the shape `test_sign.py` uses for the
three state axes.

### Ruling 12 — the `reason` prose stays, unchanged, beside the name

`Row.reason` is not replaced, not shortened, and not regenerated from the
cause. It carries the remedy (`accept.py:485` prints the exact `proves:` line
to add) and it is what a human reads. The name is the machine's handle on the
same fact.

**Why this matters more than it looks.** Rendering the fourth cause as the
second is *false and backwards* — the record does show that gate can fail; the
objection is that the gate is new — and it is the single refusal the README's
objections block advertises as breaking the circularity charge. The board
currently tells the five apart by matching free text against `accept.py`'s
wording. **After this cycle it does not have to**, and a reworded message stops
being able to silently re-label a card.

---

## §7 — OQ-5: landed, and the residue is none

`sign.INTEGRITY_STATES` shipped at **`ab884b5`** (`sign.py:90`), as a rider on
the Phase 2 containment window. `test_sign.py` pins all three axes against the
module's own constants in both directions.

OQ-5's text also observed that the two integrity values were in "no collection
and no schema enum". **Checked at `478494c`: `schema/attestation.schema.json`
contains no `integrity` enum, and never did.** There is nothing to add and
nothing to correct — the schema is frozen, so an enum could not be added to it
anyway without a version this cycle has no reason to spend, and the public
tuple is a strictly better guard because a derived test can read it.

**Consequence for the board, stated here because the board's spec is now
stale about it:** `SPEC_BOARD_V0.md` ruling 16's table says integrity has
"**no collection and no schema enum exists**" and grants the two values a
hand-listed per-value exemption with a reason string. **That rationale expired
at `ab884b5`.** A board slice touching ruling 16's totality test enumerates
integrity from `sign.INTEGRITY_STATES` like its two siblings, and the exemption
is removed rather than left as a comment nobody re-reads.

---

## §8 — Non-goals (binding)

Each is refused, not deferred-with-a-wink.

1. **Any new judgement.** Nothing here scores, ranks, grades or infers. Every
   value written is read from a computation the engine already performs or
   from a file a person wrote.
2. **Any weakening of any refusal**, anywhere. No `--force`, no `--allow`, no
   config that disables one, no path that catches a refusal and continues.
3. **Any model, agent or command answering a `human` criterion.** The
   judgement file is a human edit. There is no flag and no environment
   variable, for the same reason there is no `--yes`.
4. **Changing a frozen schema.** `wringer.spec.v1`, `wringer.acceptance.v1`,
   `wringer.acceptance.v2` and every other entry in `schema/frozen.json` are
   untouched.
5. **A 20th top-level command.** Everything here rides inside `deliver`,
   `accept` and the files they already read and write.
6. **Rendering PROVEN-RED**, or any new board card state. §5 ruling 10.
7. **Pinning a human judgement to a tree, a build or a commit.** §3 ruling 3
   states the limit and puts it in the artifact rather than pretending to
   close it.
8. **An identity system.** `by` is a name a person typed. It is recorded,
   never verified, and the schema description says so.
9. **A refusal history, a dashboard, or any aggregate over refusals.** One
   record per refused attempt, and nothing counts them.

---

## §9 — Slice plan, and each slice names its capture

**The house does not claim unfilmed work.**

| slice | what it builds | capture |
|---|---|---|
| **R1 — the names** | `deliver.REFUSAL_REASONS`, the required `reason` argument at 23 sites, `wringer.refusal.v1` and the record write. No behaviour change beyond the write | A refused delivery driven for real, with `refusal.json` beside it and the console output unchanged from before the slice, shown side by side |
| **R2 — the causes** | `wringer.acceptance.v3`'s `cause` and `demonstrated_able_to_fail`, both set at every site, the version selector, and the drift test on the new schema | One record per cause, from fixtures, plus the three-valued field's three fixtures |
| **R3 — the human interlock** | `wringer.judgement.v1`, the loader, the digest pin, the `refuses` change and the new `limits[]` entry | A delivery **refused** because a required human criterion is unanswered; the same delivery proceeding once the file records `met`; and a third run where the criterion is reworded and it refuses again |

**R1 is sequenced first and is the least invasive**, so that if this cycle is
interrupted, what has landed is the half the board needs most and the half
that changes no policy.

---

## §10 — What this spec does not license

- It does not license **any claim about intent**. Q1's ceiling binds every
  string this cycle produces: *a witness proves the stated criterion could fail
  and was made to pass; it does not certify agreement with an unstated intended
  fix, and where the criterion under-describes the intent, the witness inherits
  that gap.* No artifact here may claim anything catches wrong fixes.
- It does not license **a human judgement being treated as evidence**. It is a
  recorded human decision, it never becomes `evidenced`, and it never enters
  the red-first promise.
- It does not license **the witness lane as a supplier of anything**. The
  bug-fix claim was withdrawn on 2026-08-16 (`039bebc`); the red-first seam is
  served by `SPEC_GATEGEN_V0.md` alone. `witness-evidenced-nothing` is named
  here precisely because it is a cause of *unevidenced*.
- It does not license **the surface writing `wringer.judgements.yaml`**.
  `SPEC_BOARD_V0.md` §8 non-goal 9 stands until a reviewed slice amends it.
- It does not license **a new card state**, a score, a ranking, or a count of
  refusals over time.

---

## §11 — Open questions, recorded rather than answered

- **Should a `not_met` judgement stop the loop as well as the delivery?**
  Today only delivery reads acceptance. A person saying "this is wrong" while a
  fleet is still running is exactly the ratchet's input, and wiring it into the
  loop is a policy call with an anti-thrash dimension. Not decided here.
- **Should `wringer.judgements.yaml` be committed or gitignored?** It is a
  person's decision about a repository, which argues for committed; it is also
  the kind of file that collects one entry per person per branch, which argues
  the other way. This cycle writes neither rule and touches no `.gitignore`.

---

## §12 — The review that did not run, and the self-check that is not a substitute

### What happened

The independent review was launched on 2026-08-16 with a refute instruction, a
list of every citation to open, and the specific question of whether the design
is implementable against the real call flow. **The reviewing agent was
terminated mid-pass by an account spend limit and returned no findings.**

**Verdict: NONE. This spec is UNREVIEWED and is not built to.** No code was
written against it. The house law it is waiting on is one independent
refute-instructed review before any code, and a spend limit is not an exception
to it — a spec that has not been attacked is a spec whose defects are still in
it, which the section below demonstrates rather than argues.

### The author's self-check, and why it does not count

The author of a document is the worst available reviewer of it: the errors that
survive drafting are the ones the drafter cannot see. What follows is a
citation-verification pass by the drafting window, run because a spec with wrong
line numbers wastes the reviewer's pass too. **It is not the review, it does not
discharge the obligation, and it is recorded here so nobody later mistakes it
for one.**

Three citations were wrong and are corrected in place:

1. **The version selector was cited at `accept.py:277-286`, which is
   `Result.counts`.** It is `Result.has_witness` at `accept.py:269-278`, and
   the two write sites are `accept.py:305` (v1) and `accept.py:318` (v2).
2. `Row.refuses` was cited at `accept.py:229-243`, which is its docstring
   alone; the property including its return is `accept.py:228-244`.
3. The digest discipline was cited at `staleness.py:52-58`, which is
   `AUTHORITY_DOCUMENTS`; the capture that computes the digests is
   `staleness.capture` at `staleness.py:102-104`.

**And one HIGH finding the drafted spec did not contain:**

> **HIGH — OQ-1 breaks a passing test, and that test's docstring states the
> rationale OQ-1 overturns.** `tests/test_accept.py:286-300`
> (`test_a_human_criterion_is_answered_by_people`) builds a criterion that is
> `required: true, human: true` (`tests/test_accept.py:59-63`) and asserts
> `human["refuses"] is False`, with the docstring *"it never refuses: a
> person's judgement is not a gate's to hold hostage."* The spec proposed the
> policy change without naming the test it invalidates.
>
> **What the fix must be, so it is not done quietly:** the assertion is
> replaced by both directions — unanswered refuses, answered does not — and the
> docstring is amended **in the same commit**, citing the OQ-1 ruling as the
> authority that overturned it and keeping the old sentence visible as what was
> previously believed. This is the discipline the board used for its fifth
> `unevidenced` cause and the one this window used for the de-scope: a pinned
> assertion is evidence of a decision, and reversing one silently is the defect
> this repository exists to catch.
>
> The old rationale is also worth answering rather than deleting. *"A person's
> judgement is not a gate's to hold hostage"* is right about the direction it
> was defending — a gate must not be able to fail a criterion only a person can
> decide. OQ-1 does not do that. It holds the delivery for the **person's own
> unanswered question**, which is the opposite arrangement.

Three other tests assert `refuses is False` (`tests/test_accept.py:151, 198,
465`); all three are about **unbound and unevidenced** criteria, not `human`
ones, and OQ-1 does not touch them. Checked rather than assumed.

### What the next window must do

1. Run the review. One agent, refute-instructed, over this document, before any
   code. The prompt should carry the checklist above plus the questions the
   terminated pass never reached — chiefly **§4 ruling 7's implementability**:
   the 23 refusal sites are spread across the call flow and some fire before any
   delivery directory could exist, so whether `refusal.json` can be written from
   one choke point or needs 23 writes is unverified, and if it is the latter the
   ruling is wrong as written.
2. Fold or rebut every finding **in writing, here**, replacing this section.
3. Only then build, in §9's order — R1 first, because it changes no policy.
