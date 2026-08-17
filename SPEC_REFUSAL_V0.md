# SPEC — refusal legibility: the engine names what it refuses and why (v0)

*Drafted 2026-08-16 by an Opus implementation window under
`~/Claude/WRINGER_REMAP_RUN_PROMPT_2026-08-16.md`, which carries the Fable
direction ruling of the same day. Inputs: `SPEC_BOARD_V0.md` §4, §12 (the OQ
list this spec discharges) and §8 (non-goals that bind anything the board does
with this); `WRINGER_RULING_2026-08-15.md` **§Q1**, whose claim ceiling binds
every sentence here; `WRINGER_FACTORY.md`, which governs the order of work and
outranks this file.*

*Every "exists today" claim below was read out of the tree at **`478494c`**,
re-checked by the independent review on 2026-08-16 at its own HEAD, re-read
once more while folding that review at **`fb51427`**, and carries its
`file:line`. Where the review found a citation wrong, the correction is in
place. Where the FOLD found the review's own citation wrong, that correction is
in place too and is named where it sits (§9, §12). Nothing here is recalled.*

> ## REVIEWED 2026-08-16 — verdict **NOT SOUND**, 22 findings. It may now be built to.
>
> One independent refute-instructed review ran on 2026-08-16 and returned
> **NOT SOUND** with **22 findings — 7 HIGH, 7 MEDIUM, 8 LOW**. This was the
> second attempt; the first was terminated mid-pass by an account spend limit
> and returned nothing, which §12 keeps as history rather than hiding.
>
> **All 22 are folded**, seven of them under window-supervisor rulings recorded
> in §12 and not re-opened here. One sub-point inside a LOW is **rebutted in
> writing** (§12, finding 19's aside). The document below is the folded
> version: where a ruling changed, the ruling changed — this is not a review
> appendix bolted onto an unchanged spec.
>
> **Build order is §9's, behind §9's sequencing gate.** R2 may not land until
> `wringer-board` can read `wringer.acceptance.v3`.

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
| **OQ-1** | an unanswered required `human` criterion refuses delivery | §3 — `accept.py` policy, `wringer.judgement.v1`, `wringer.acceptance.v3` | `test_an_unanswered_required_human_criterion_refuses` and `test_an_answered_one_does_not` — **both directions, and the second is the one that matters**, because a change that refuses everything passes the first. Plus `test_a_judgement_whose_criterion_moved_is_stale`, and `test_a_human_refusal_does_not_print_the_gate_remedy` (§3 ruling 5). Ruling 6 lists the **eight** entries this overturns — six published document sentences, one source docstring, one test — and a commit that lands the policy without them is a violation |
| **OQ-2** | delivery refusals get named reasons | §4 — `deliver.REFUSAL_REASONS`, `wringer.refusal.v1` | `test_every_refusal_site_names_a_reason` walks `ast.parse(deliver.py)` for every `ast.Raise` of `Refused` and fails on any whose keywords lack `reason` — **a text scan is forbidden** (§4 ruling 7); `test_every_named_reason_is_raised_somewhere` fails on a name in the tuple that no site uses. **Set equality in both directions** — a name nothing raises is dead text that reads as coverage. Plus `test_a_refused_delivery_does_not_become_an_attestation_anchor` (§4 ruling 8) |
| **OQ-3** | the engine writes demonstrated-able-to-fail for non-evidenced rows | §5 — a v3-only field on `wringer.acceptance.v3` | `test_a_gate_the_record_shows_can_fail_says_so_while_failing` and `test_a_born_green_gate_says_false`, plus `test_an_unbound_row_says_null` — three values, three fixtures, because a two-valued field would have to lie about the third case. And `test_a_record_with_nothing_new_to_say_still_writes_v1` — the selector's other direction (§2) |
| **OQ-4** | `unevidenced`'s causes are named in the artifact | §6 — one closed `cause` enum of **eight** values on `wringer.acceptance.v3` | `test_every_unevidenced_site_sets_a_cause` walks `accept.py`'s emission sites; `test_every_cause_is_reachable_from_a_fixture` builds one record per cause and ranges over **all eight**, human causes included. A cause value the code cannot produce fails the same set-equality test |
| **OQ-5** | `sign.py` exposes an `INTEGRITY_STATES` tuple | **ALREADY LANDED** — `ab884b5`, `sign.py:90` | Nothing to build in this repository. §7 records the residue check and its answer, which is **not** none: four sentences in `SPEC_BOARD_V0.md` went false when the tuple landed, and this spec names them rather than inheriting them |

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

**Each new schema file joins `schema/frozen.json` with its sha256 in the same
commit that publishes it.** `test_the_freeze_covers_every_published_schema`
(`tests/test_schema.py:1037-1046`) asserts SET EQUALITY between frozen.json's
keys and the `*.schema.json` files present — 38 and 38 today — so a slice that
adds a schema without adding its digest goes red immediately. From that moment
`test_no_schema_frozen_at_v0_2_0_has_changed_a_byte`
(`tests/test_schema.py:1049-1070`) byte-freezes it; despite its name it
iterates **every** entry, not only the ten from the v0.2.0 tag. §9 ruling on R2
follows directly from this.

### The version selector, narrowed by the review

`Result.has_witness` (`accept.py:269-278`) picks between v1 (`accept.py:305`)
and v2 (`accept.py:318`) today. This cycle adds one step, and **the two new
fields are v3-only**:

1. A v1 or v2 row **omits `cause` and `demonstrated_able_to_fail` entirely** —
   absent, not null. `tests/test_accept.py:650-653` pins exactly that ("a v1
   row grew a key, which is a silent break for every existing reader").
2. **v3 is written whenever ANY row would carry a non-null `cause`, a non-null
   `demonstrated_able_to_fail`, or a `judgement`.** Otherwise the selector
   chooses v1 or v2 exactly as it does today and the record is byte-identical
   to what this repository writes now.
3. §5 ruling 10's "every row carries `demonstrated_able_to_fail`" therefore
   narrows to **every row in a v3 record carries it**.

**A repository with no `human` criteria, no causes and no
demonstrated-able-to-fail values pays nothing.** That sentence is now true. The
drafted version of it was not, and the review's finding 1 is why: the drafted
selector fired on "a value a v2 row could not have carried", which every value
of a brand-new field satisfies, so v1 and v2 would never have been emitted
again while §2 still promised they would.

**And the honest reading of the promise, because a promise with a small
denominator is still a promise.** Through `assess`, most real records will
select v3 — most repositories have at least one unevidenced row (which carries
a cause) or at least one bound gate with a discriminating receipt (a non-null
`demonstrated_able_to_fail`). What the narrow selector buys is **not** that
readers rarely meet v3. It is that no reader ever meets a v3 record that
carries no new fact, and that the two pinned selector tests
(`tests/test_accept.py:637-653` and `656-667`) stay green **unmodified** —
verified: both construct `Row` objects directly with neither new field set, so
both still land on v1 and v2 respectively. Readers that *do* meet v3 must be
taught it first, which is §9's sequencing gate, not a footnote.

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
named causes, never one** — and they are three members of §6's single closed
`cause` enum, not a private vocabulary:

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
| `criterion_digest` | sha256 of the criterion this answers (ruling 3) |
| `note` | optional, free text, rendered verbatim wherever it is rendered at all |

**It is a file a person edits, exactly like `approved: true`, and for exactly
the same reason.** There is deliberately **no flag, no `--judge`, no
`--accept-human`, and no environment variable** that writes an entry. Nothing
in this cycle gives any model, agent or command the ability to answer a
criterion a human was asked to answer — a `human: true` criterion exists
precisely because a model asked anyway would be guessing
(`spec.schema.json:96-99`), and a machine that could fill in its own answer
would be the vibe tooling this programme exists to answer.

**Where the file goes in a delivery, which is not an open question.**
`deliver.plan`'s `carried` set (`deliver.py:734-741`) excludes only paths under
`.wringer/`, and the commit is `git add --all --pathspec-from-file=-`
(`deliver.py:811`) over exactly those paths. So an untracked
`wringer.judgements.yaml` at the repository root **is swept into the delivery
commit and into the merge request by default**. R3 states which behaviour it
wants before the file exists (§9); leaving it undecided decides it, and the
default it decides is "committed, silently, into somebody else's MR".

*A later surface slice may write this file on a person's click, on exactly the
terms `SPEC_BOARD_V0.md` §5 ruling 20 sets for `approved: true` — the button
writes what the hand edit writes, byte for byte, and there is no path that
answers without rendering what is being answered. That is not this cycle, and
`SPEC_BOARD_V0.md` §8 non-goal 9 (the surface writes only
`wringer.spec.yaml` and its own output) stands until a reviewed slice amends
it.*

### Ruling 3 — a judgement is pinned to the question it answered, and to nothing else

`criterion_digest` is computed from the **parsed** `rubric.Criterion`, with the
preimage written out rather than hidden behind a word:

```
criterion_digest = sha256(
    json.dumps(
        {"id": c.id, "title": c.title, "guidance": c.guidance},
        sort_keys=True, ensure_ascii=False, separators=(",", ":"),
    ).encode("utf-8")
).hexdigest()
```

Three things that follows from, stated because "canonicalised" hid all three
in the drafted version and the review was right that it did:

- **Parsed, not raw bytes.** An absent `guidance` and an empty one are already
  the same value in the parsed object (`rubric.py:39-45`, `guidance: str = ""`),
  so that ambiguity is closed before the digest sees it. It also means a
  whitespace-only or comment-only edit to `wringer.spec.yaml` does not stale
  every judgement in the repository — `test_a_whitespace_only_edit_to_the_spec_file_does_not_stale_a_judgement`.
- **`required` and `human` are deliberately excluded.** Changing either changes
  the policy, not the question. A criterion that stops being required has not
  been reworded.
- **The `briefed.json` precedent is cited for its DISCIPLINE, not its
  mechanism.** `staleness.capture` (`staleness.py:102-104`) hashes whole file
  bytes (`staleness.py:95-99`), and there is no field-level canonical form
  anywhere in `src/wringer/`. What carries over is the rule — *nothing may move
  under an answer* — not an implementation.

If the requirement is reworded, every judgement of it goes **stale** and the
row refuses again under `human-judgement-stale`.

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

### Ruling 4 — what the row carries, when it is computed, and what it does not become

A `human` row in v3 gains an optional `judgement` object: `verdict`, `by`,
`at`, `note`, and `stale` (boolean). Its `state` stays **`human`**.

**`stale` is computed at ACCEPTANCE time, inside `assess`, where the criterion
text and the judgement file are both in hand — never at read time.** The
drafted version said read time, and the review showed that cannot work:
`refuses` is serialised into `acceptance.json` by `Row.as_json`
(`accept.py:256`) and delivery reads the **stored boolean** out of the file
(`deliver.py:585-588`), never recomputing it. A read-time `stale` could not
reach the `refuses` value baked into the record, so a reworded criterion would
not refuse the delivery — which is precisely what ruling 3 and R3's third
capture promise. `stale` is written into the row and `refuses` is derived from
it in the same pass, so the record and every reader agree by construction.

**It never becomes `evidenced`, and that is not a technicality.** `evidenced`
means a bound check passed now and the record shows the same check recorded
failing (`accept.py`, `SPEC_ACCEPT_V0.md` §3). A person saying yes is a
different kind of fact, it has no receipt, and rendering it under the same
word would put a human judgement inside the sentence "every green was red
first" — which would be false, and would be exactly the overclaim
`SPEC_BOARD_V0.md`'s B3 exists to prevent. The five-value `state` enum is
therefore **unchanged in v3**.

### Ruling 5 — the refusal message goes through the machinery that already exists, and its remedy must be clearable

`deliver._check_acceptance` builds the acceptance refusal by reading the
serialised `refuses` key out of `acceptance.json` (`deliver.py:585-588`),
written by `Row.as_json` at `accept.py:256` — **not** from `Result.refusing`
(`accept.py:265-267`), which delivery never sees. A `human` row that refuses
arrives at `deliver.py:606` by the same route as every other refusing row.
**No new refusal path, no new exit code, no second code path that can drift
from the first.**

Two things the block must change, because the review found the drafted version
printing a remedy that cannot clear the refusal it prints under — the exact
defect `deliver.py:630-637` records this repository fixing once already
("*Sending a reader off to do work that changes nothing is worse than saying
only 'no'*"):

1. **A refusing `human` row's `reason` is its cause's sentence, naming the file
   to edit.** Today a human row's reason is `"answered by people, not gates"`
   (`accept.py:472`), which under a refusal heading is a non-sequitur. This is
   a scoped exception to §6 ruling 13, whose "the prose stays unchanged" is
   about `unevidenced` rows.
2. **The block's fixed trailer becomes conditional.** `deliver.py:601-605`
   always appends *"A criterion is evidenced when its gate passed AND the
   record shows that gate can fail. Make the evidence better, not the check
   weaker."* For `human-unanswered` that is false guidance — there is no gate,
   and no amount of evidence clears it; only a person editing
   `wringer.judgements.yaml` does. The trailer prints only when at least one
   refusing row is bound. `test_a_human_refusal_does_not_print_the_gate_remedy`.

### Ruling 6 — the published sentences OQ-1 falsifies, named here and corrected in the same commit

OQ-1 is a policy reversal, and this programme's standing defect is not the
reversal — it is the sibling sentence that does not move with it. **R3's scope
includes correcting every published sentence OQ-1 makes false, in the same
commit as the `refuses` change, each citing OQ-1 as the authority that
overturned it and keeping the old sentence visible as what was previously
believed.** The list is exhaustive as of 2026-08-16 and each entry was read:

| where | the sentence that goes false |
|---|---|
| `tests/test_accept.py:286-300` | `test_a_human_criterion_is_answered_by_people` asserts `human["refuses"] is False` (`:299`), docstring *"it never refuses: a person's judgement is not a gate's to hold hostage"*. Replaced by both directions; docstring amended, not deleted |
| `SPEC_ACCEPT_V0.md:216-217` | ruling 9, *"**Only bound criteria can refuse; unbound ones are loud, never fatal.**"* |
| `SPEC_ACCEPT_V0.md:238-239` | *"A criterion that is `human: true` never refuses — a person's judgement is not a gate's to hold hostage"* — the sentence the test docstring paraphrases, in the spec the test enforces |
| `SPEC_ACCEPT_V0.md:388-391` | a **shipped acceptance criterion of SPEC_ACCEPT itself**: *"marking it `human: true` (the author's honest out) **lifts the refusal** and changes its rendering, and a test pins both directions"* |
| `docs/gategen.md:196-201` | the rendered row `copy   human   refuses=False`, in a filmed walkthrough whose §7 then shows that same delivery pushing |
| `docs/gategen.md:372-374` | §7's closing sentence: *"if any criterion had read `unevidenced` the same command would have refused"* — after OQ-1 that understates the policy |
| `docs/factory-dry-run.md:118` | the rendered row `button-copy-reads-well   human   refuses=False`, annotated at `:121` as *"Correct per ruling 9 — unbound criteria are loud and never fatal"* — the ruling OQ-1 amends |
| `src/wringer/accept.py:230-243` | the `Row.refuses` docstring: *"Only a COVERED criterion can refuse … An uncovered one is a debt the author has not paid yet — loud, never fatal"*, citing SPEC_ACCEPT's ruling 9 by number at `:230`. **Found during this fold, not by the review** — the rationale survives for gate-bound criteria (an uncovered non-`human` criterion still never refuses), the flat sentence does not |

`required` defaults to true (`spec.py:348`, `entry.get("required", True)`; the
schema says "Defaults to true"), and neither walkthrough shows its criterion
declared optional — **R3 opens each walkthrough's spec block and confirms the
`required:` value before writing the correction.** The review flagged that it
could not reach those blocks; if either criterion is genuinely `required:
false`, the doc says so explicitly rather than leaving it inferred, and that
document's correction shrinks to the closing sentence. **The transcript stays
as the record of what happened; the policy sentence beside it does not stay
false.** Neither document is guarded by any test in `tests/test_docs.py`, which
is why they are listed here rather than trusted to go red.

**One sentence on the list cannot be corrected, and that is an independent
argument for §2's narrow selector.** `schema/acceptance.schema.json:89` — the
FROZEN v1 schema — describes `refuses` as *"True only for a criterion that is
both REQUIRED and BOUND and not `evidenced`. An unbound criterion never
refuses…"*, and `acceptance-v2.schema.json` repeats the reasoning (*"in v1 only
a bound criterion could refuse, and that sentence is why this is a version"*).
Law 7 forbids amending either. The only way that sentence stays true is for it
to stay true **of v1 and v2 records**, which the narrow selector guarantees: a
row that refuses while NOTHING covers it — no gate, no witness, so not even
under v2's widening (`accept.py:218-226`) — is a `human` row; a `human` row
that is not MET carries one of §6's three human causes; and any non-null
`cause` selects v3. **So a row refusing with nothing covering it can only ever
appear in a v3 record** — not as a convention a builder must remember, but as a
consequence of the selector. v3's own top-level description states that
widening in its own voice, exactly as `acceptance-v2.schema.json` stated v2's.

**This is the SEVENTH recorded occurrence of this class in this programme.** The
sixth was found on 2026-08-16 by the independent review of `SPEC_ENV_V0.md`,
which had been sent to look at something else: `docs/graphs.md` claimed to
enumerate "every loop outcome" and named six of the eight in
`graph.LOOP_REASONS`, corrected at `babc10b` with a derived both-direction
guard. Like two of the others, it was found by an agent looking elsewhere. The
lesson this spec takes from that is not "be careful" — it is **name the
sentences before the policy lands**, which is what this ruling is.

---

## §4 — OQ-2: the delivery refusals get names

### Ruling 7 — a closed, public tuple, the constructor requires it, and the guard parses with `ast`

`deliver.py` raises `Refused` at **23 sites**, verified by count at `478494c`
and re-counted by the review at its own HEAD. Every one is a prose string plus
an exit code; there is no enum, no machine-readable record, and a refused
delivery writes nothing at all.

**`deliver.REFUSAL_REASONS`** becomes a public tuple of 23 names, and
`Refused.__init__` (`deliver.py:68-70`) takes `reason` as a **required**
argument.

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

**The guard parses with `ast`, and a text scan is forbidden.**
`test_every_refusal_site_names_a_reason` walks `ast.parse` over `deliver.py`
for every `ast.Raise` whose callee is `Refused` and fails on any whose keywords
lack `reason`. Only two of the 23 raises fit on one line (`deliver.py:606` and
`743`); the other 21 span three to eleven lines, so a same-line check finds
`reason=` on none of them, and a scan-forward-to-the-closing-paren is defeated
by the literal `)` inside `deliver.py:191`'s message (`"(try 'git ls-remote
{remote}') "`).

**The constructor requirement and the source guard are not redundant with each
other, in either direction.** The drafted version said the constructor means "a
new site cannot omit it"; that is false for a site the suite never executes,
because a missing required argument raises at call time and most of these 23
sites are not on any tested path. The constructor catches omissions on executed
paths; the `ast` guard catches them everywhere else. Both stay.

**A correction to `SPEC_BOARD_V0.md` ruling 19, made here rather than left to
be inherited.** That ruling says three of the 23 are reachable from an artifact
and characterises "the other twenty" as being about git and the machine, while
stating plainly that its review did not re-check the characterisation. Reading
all 23: **the three artifact-reachable ones are right**, and the
characterisation of the remaining twenty is **wrong for nine of them** — seven
`head_moved`-family refusals (`230, 262, 284, 332, 349, 359, 384`) and
`gates_did_not_pass` (`679`) are refusals about whether the evidence covers the
change being delivered, which are the most substantive refusals in the file,
and `signature_required` (`553`) is a policy the repository declared. Eight
about evidence plus one declared policy is nine, not eight; the drafted version
said eight and then listed nine, which is a poor way to correct another
document's arithmetic. Ruling 19's *rendering rule* is unaffected and this spec
does not change it; the reading it disclaimed is corrected.

### Ruling 8 — the refusal record: where it goes, from where, and where it may never go

On refusal the record is written to **`.wringer/refusals/<id>/refusal.json`** —
a directory the refusal path allocates — with `schema_version:
wringer.refusal.v1`, `reason`, `exit_code`, `message` (the prose, verbatim),
`at`, and `run` (the bundle id where one is known, `null` otherwise).

**No delivery directory exists at any refusal.** The drafted version put the
record "into a delivery directory allocated for the attempt", and the review
established that no such directory exists for any of the 23: every
`raise Refused(` is inside `deliver.plan()` (`deliver.py:674-776` and the
helpers it calls, including `_check_untracked_bytes` via `deliver.py:294`), and
`deliver.Bundle.create` — the only thing that makes `.wringer/deliveries/<id>/`
— is not reached until `plan()` has returned successfully: `cli.py:3276` vs
`cli.py:3287`, `graph.py:1804` vs `graph.py:1813`.

**One choke point per entry path, never 23 writes.** `cli.py:3279`
(`except deliver.Refused as exc:` → `_fail("deliver", exc)` → `return
exc.exit_code`) and `graph.py:1807` (`except deliver_module.Refused as exc:` →
`raise NodeRefused(...)`). Both write the record, so a graph `deliver` node
refusal is recorded on the same terms as a CLI one. Nothing between the raise
and the return touches disk today, which is why the write is a new statement in
two places rather than a change to any of the 23.

**It may NEVER be written under `.wringer/deliveries/`, and the reason is
mechanical.** `attest.latest_anchor` (`attest.py:279-288`) takes the newest
entry under that directory as the attestation anchor; a refusal-only entry has
no `manifest.json`, so `attest.build` falls through to the run-dir branch
(`attest.py:363-369`) and refuses at `attest.py:371-375` with *"… is not a
Wringer bundle — there is no manifest.json in it"*. **Every refused delivery
would silently disable `wring attest` until the next successful one** — a
refusal this cycle invented, in a cycle whose non-goal 2 forbids touching
refusals, created outside `deliver.py` where ruling 9's "anything else is a
violation" would not have looked. It would also reverse a live pinned
assertion: `tests/test_deliver.py:316`, `assert not (delivery_repo /
deliver.DELIVERIES_DIRNAME).exists()` after a `gates_did_not_pass` refusal.
`test_a_refused_delivery_does_not_become_an_attestation_anchor` pins it, and R1
**constructs and observes** that failure mode rather than reasoning about it —
the review traced this by reading and said so.

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

**Retention, stated so a reader does not have to infer it.** One file per
refused attempt. Nothing prunes them, nothing counts them, and **no command
enumerates `.wringer/refusals/`** — it is not an anchor for `attest`, not an
input to `health`, and not a source for any surface. §8 non-goal 9 forbids the
aggregate and the counter; the accumulating file is what it permits, and the
drafted version left a reader unable to tell which.

### Ruling 9 — no refusal changes, moves, or gains a route around it

This cycle adds no refusal to `deliver.py`, removes none, changes no exit code
and changes no condition. Naming a refusal is not negotiating with it: there is
still no `--force`, no `--allow`, and no configuration that turns one off.

**The diff, precisely.** `deliver.py` gains a `reason=` argument at 23 sites,
the `REFUSAL_REASONS` tuple, and the record-writing helper. **The CALL to that
helper is in `cli.py` (at the `except deliver.Refused` at `cli.py:3279`) and in
`graph.py` (`graph.py:1807`)** — it cannot be in `deliver.py`, because the
`Refused` instance leaves `plan()` before anything knows about directories. A
reviewer who finds anything else in the `deliver.py` diff has found a
violation; a reviewer checking the two callers is checking two added statements
and nothing more.

---

## §5 — OQ-3: whether the record shows this check can fail

### Ruling 10 — a three-valued field, because two values would have to lie

`accept._discriminating_pairs(root)` (`accept.py:622-634`) computes
`{(gate_id, command): Receipt}` for every pair the record shows can fail,
reusing `health`'s reader so the exclusions live in one place — bench-sourced
bundles never qualify, and timeouts and exit 127 are already excluded.

**It is computed ONCE per record at `accept.py:423`, before the row loop, and
consulted at `accept.py:528` for every row with a bound gate that ran and
passed** — which is how three of the five `unevidenced` outcomes are decided
(`accept.py:530`, `555`, `567`) as well as `evidenced` (`accept.py:578`).
Nothing is thrown away. The drafted version said it was "consulted for rows
that reach `evidenced` and thrown away for everything else", which is false and
which invites a builder to add a second computation for the new field. It is
already in hand for every row, so `demonstrated_able_to_fail` costs **a lookup
on `(gate_id, command)` and no new computation**.

**Ruled: every row in a v3 record carries `demonstrated_able_to_fail`** (§2 for
why "in a v3 record" is load-bearing).

| value | meaning |
|---|---|
| `true` | this row's `(gate, command)` pair appears in the record having genuinely failed |
| `false` | it does not. **Not "cannot fail"** — only that nothing on disk shows it doing so |
| `null` | there is no bound `(gate, command)` to ask about: unbound, `human`, **or covered by a witness with no gate** (`accept.py:481-482`), which **can be `evidenced`** (`accept.py:610-619`). *Not asked* and *asked, answer no* are different facts, and this repository has paid for conflating them before (`accept.py:424-426` makes the identical distinction about `created`) |

The third `null` case is spelled out because the drafted table listed only two,
and a reader who inferred "null implies not evidenced" from it would be wrong on
exactly the rows the witness lane produces. **The field is about the RECORD's
gate history and says nothing about a witness-sourced green.**

**It is a field, not a judgement** — the value is read out of a computation the
engine already performs, and no new inference is introduced. The field name
carries its own ceiling: *demonstrated*, about the record. A field called
`can_fail` would be a claim about the world, which nothing here can support.

### Ruling 11 — what this earns, and what it does NOT license yet

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

## §6 — OQ-4: one closed `cause` enum of EIGHT values

### Ruling 12 — the enum, closed, spanning `unevidenced` and `human` rows

`SPEC_BOARD_V0.md` ruling 15 enumerated **four** causes of `unevidenced` from
`accept.py` at `d23d7ca`. The witness lane added a fifth, and it was found on
real data rather than by reading: the board's own tests recorded it and wrote
*"Naming it a fifth cause with its own sentence is S2's job, not S1's"*
(`wringer-board/tests/test_real_bundles.py:79-96`). OQ-1 adds three more, for
`human` rows.

**`cause` is ONE closed enum of eight values**, not two vocabularies. The
drafted version declared a closed five-value enum in §6 and then named three
more causes in §3 with nowhere to live; the review's finding 5 is that the two
could not both hold, and that if the human causes lived outside a public symbol
the board could not render them — which would re-create, in OQ-1, the exact
defect OQ-4 exists to remove.

| cause | row | site | the engine's condition |
|---|---|---|---|
| `unbound` | unevidenced | `accept.py:485`, no witness | no gate binds the criterion and no witness covers it |
| `witness-evidenced-nothing` | unevidenced | `accept.py:485`, `witness.discarded` | **the fifth.** No gate binds it, a witness was authored, and the witness demonstrated nothing — so its red says nothing about the criterion |
| `born-green` | unevidenced | `accept.py:532` | the bound gate passed and nothing in the record shows it can fail |
| `pre-existence-unestablished` | unevidenced | `accept.py:557` | a sensitivity receipt whose pre-existence could not be established |
| `arrived-with-the-work` | unevidenced | `accept.py:569` | the check was created by the change it judges |
| `human-unanswered` | human | `accept.py:468-473`, no judgement loaded | nobody has answered the question |
| `human-said-no` | human | `accept.py:468-473`, judgement `not_met` | somebody answered, and the answer was no |
| `human-judgement-stale` | human | `accept.py:468-473`, digest mismatch | somebody answered a different wording of the question |

**Both directions, forced, over all eight.**
`test_every_unevidenced_site_sets_a_cause` fails on an emission site with no
cause; `test_every_cause_is_reachable_from_a_fixture` builds one record per
cause and fails on a name the code cannot produce. (One name for one test: the
drafted spec called this `test_the_five_causes_are_each_reachable_from_a_fixture`
in §1 and `test_every_cause_is_reachable_from_a_fixture` in §6, and the count in
the first name is now wrong anyway.) A ninth cause added without joining the
tuple reddens rather than ageing quietly — the shape `test_sign.py` uses for
the three state axes.

**One thing R2 settles before it writes the enum.** The review could not
determine whether `WitnessEvidence` can reach `_assess_one` with
`covers == False` and `discarded is None` — a witness whose `proved_red` is not
`"assertion"` but which carries no discard reason. If it can, `unbound` and
`witness-evidenced-nothing` do not partition `accept.py:485` and there is a
third case at that site, which gets a name of its own rather than falling into
either. R2 reads `witness.py`'s construction path and records the answer in the
commit message; it does not assume the partition.

### Ruling 13 — the `reason` prose stays, unchanged, beside the name

`Row.reason` on an `unevidenced` row is not replaced, not shortened, and not
regenerated from the cause. It carries the remedy (`accept.py:485` prints the
exact `proves:` line to add) and it is what a human reads. The name is the
machine's handle on the same fact. *The one scoped exception is a refusing
`human` row, whose reason today is `"answered by people, not gates"` and would
be a non-sequitur under a refusal heading — §3 ruling 5.*

**Why this matters more than it looks.** Rendering the fourth cause as the
second is *false and backwards* — the record does show that gate can fail; the
objection is that the gate is new — and it is the single refusal the README's
objections block advertises as breaking the circularity charge. The board
currently tells the five apart by matching free text against `accept.py`'s
wording. **After this cycle it does not have to**, and a reworded message stops
being able to silently re-label a card.

---

## §7 — OQ-5: landed, and the residue is NOT none

`sign.INTEGRITY_STATES` shipped at **`ab884b5`** (`sign.py:90`), as a rider on
the Phase 2 containment window. `test_sign.py` pins all three axes against the
module's own constants in both directions.

OQ-5's text also observed that the two integrity values were in "no collection
and no schema enum". **Checked at `478494c`: `schema/attestation.schema.json`
contains no `integrity` enum, and never did.** So **the residue inside this
repository is none** — there is nothing to add and nothing to correct here; the
schema is frozen, so an enum could not be added without a version this cycle
has no reason to spend, and the public tuple is a strictly better guard because
a derived test can read it.

**The residue OUTSIDE this repository is four sentences, and "none" was the
wrong answer to give.** The drafted §7 concluded "the residue is none" and then,
two paragraphs later, identified live false sentences and left them as future
work — in a repository whose standing defect class is exactly a sentence going
false when its sibling is corrected. Named, so they age in the open:

| where | the sentence, false at HEAD |
|---|---|
| `SPEC_BOARD_V0.md:401` | *"\| **integrity** \| **no collection and no schema enum exists** — `sign.py:54-55` only \| 2 \|"* |
| `SPEC_BOARD_V0.md:404` | *"The two integrity values carry an explicit per-value exemption with a reason string in the test"* |
| `SPEC_BOARD_V0.md:704` | acceptance criterion 3: *"the two integrity values carry a named exemption"* |
| `SPEC_BOARD_V0.md:739` | OQ-5's own text: *"the two integrity values are in no collection and no schema enum"* |

And the code half the drafted §7 prescribed as future board work **has already
landed**: `wringer-board/src/wringer_board/refusals.py:45-48` states that the
exemption "is discharged … enumerated like their two siblings and the exemption
is gone", and `wringer-board/tests/test_refusals.py:155` reads
`frozenset(sign.INTEGRITY_STATES)`. So what is owed is four documentary
corrections in `SPEC_BOARD_V0.md`, which this cycle **names and does not do** —
board-spec work, listed here so the next board window inherits a list rather
than a surprise.

### Owed by this document, to itself

Landing this rewrite makes **three** claims in `AGENTS.md:75` false, and they
are named here in the same breath as everybody else's:

1. *"a closed `cause` enum over `unevidenced`'s **FIVE** causes"* — §6 now rules
   ONE enum of eight, five of them `unevidenced`'s and three of them `human`'s.
2. *"`wringer.refusal.v1` (a record **beside a refused delivery**)"* — §4
   ruling 8 rules `.wringer/refusals/<id>/refusal.json`, and rules that it may
   never be written beside a delivery, because that would disable `wring
   attest`.
3. *"`Refused.__init__` REQUIRES the name, **so a new site cannot omit one**"* —
   §4 ruling 7 corrects exactly this: a required argument catches an omission
   only on a path something executes, and most of the 23 sites are not on one.
   The `ast` guard is what makes the claim true, and the sentence credits the
   wrong mechanism.

This commit touches `SPEC_REFUSAL_V0.md` alone by instruction, so the three
sentences are **owed, dated 2026-08-16, and named here rather than left to be
discovered** — which is the whole point of the class this document is tracking,
and the discipline would be worth nothing if it applied only to other people's
files. The third is the sharpest of them: it is a false sentence this document's
own draft put into `AGENTS.md`, found by the review of this document.

---

## §8 — Non-goals (binding)

Each is refused, not deferred-with-a-wink.

1. **Any new judgement.** Nothing here scores, ranks, grades or infers. Every
   value written is read from a computation the engine already performs or
   from a file a person wrote.
2. **Any weakening of any refusal**, anywhere. No `--force`, no `--allow`, no
   config that disables one, no path that catches a refusal and continues —
   and no refusal invented as a side effect either (§4 ruling 8's `attest`
   trap is the one the review caught).
3. **Any model, agent or command answering a `human` criterion.** The
   judgement file is a human edit. There is no flag and no environment
   variable, for the same reason there is no `--yes`.
4. **Changing a frozen schema.** `wringer.spec.v1`, `wringer.acceptance.v1`,
   `wringer.acceptance.v2` and every other entry in `schema/frozen.json` are
   untouched — including `wringer.acceptance.v3` from the moment R2 publishes
   it, which is why §9 rules that R2 authors it complete.
5. **A 20th top-level command.** Everything here rides inside `deliver`,
   `accept` and the files they already read and write.
6. **Rendering PROVEN-RED**, or any new board card state. §5 ruling 11.
7. **Pinning a human judgement to a tree, a build or a commit.** §3 ruling 3
   states the limit and puts it in the artifact rather than pretending to
   close it.
8. **An identity system.** `by` is a name a person typed. It is recorded,
   never verified, and the schema description says so.
9. **A refusal history that anything reads.** One file per refused attempt is
   permitted and is what §4 ruling 8 builds; what is refused is the aggregate:
   no dashboard, no count, no trend, and no command that enumerates
   `.wringer/refusals/`.

---

## §9 — Slice plan, each slice with its capture and its gate

**The house does not claim unfilmed work.**

| slice | what it builds | capture |
|---|---|---|
| **R1 — the names** | `deliver.REFUSAL_REASONS`, the required `reason` argument at 23 sites, the `ast` guard, `wringer.refusal.v1`, and the record write from the two choke points (`cli.py:3279`, `graph.py:1807`). No behaviour change beyond the write | A refused delivery driven for real, with `.wringer/refusals/<id>/refusal.json` beside it and the console output unchanged from before the slice, shown side by side; plus the observed `wring attest` run proving the anchor is untouched |
| **R2 — the causes** | `wringer.acceptance.v3`'s `cause` and `demonstrated_able_to_fail`, both set at every site, the narrowed version selector, and the drift test on the new schema | One record per cause, from fixtures, over all eight; the three-valued field's three fixtures; and a record with nothing new to say still writing v1 |
| **R3 — the human interlock** | `wringer.judgement.v1`, the loader, the digest pin, the `stale`-at-acceptance-time computation, the `refuses` change, the conditional remedy block, the new `limits[]` entry, **and every correction in §3 ruling 6, in the same commit** | A delivery **refused** because a required human criterion is unanswered; the same delivery proceeding once the file records `met`; and a third run where the criterion is reworded and it refuses again |

**R1 is sequenced first and is the least invasive**, so that if this cycle is
interrupted, what has landed is the half the board needs most and the half
that changes no policy.

### R2 authors the schema COMPLETE

**R2 authors `schema/acceptance-v3.schema.json` in full — including the
`judgement` object and the three human causes that only R3 populates — because
publishing it freezes it.** `tests/test_schema.py:1037-1046` forces every
published schema into `schema/frozen.json`, and `tests/test_schema.py:1049-1070`
byte-freezes every entry in that manifest from then on. R3 could not add a
field to v3 afterwards without spending a v4, and §8 non-goal 4 forbids editing
it. **R2's code writes only the subset R2 builds; the schema describes the
version, not the slice.** (The alternative — R2 and R3 in one commit — is
rejected: it would fuse a no-policy-change slice with the one policy reversal
in this cycle, which is the opposite of why R1 is first.)

### The sequencing gate: the engine may not emit v3 until the board reads it

**R2 does not land until a `wringer-board` slice adds `wringer.acceptance.v3`
to `KNOWN_ACCEPTANCE` (`wringer-board/src/wringer_board/read.py:32`) and
teaches `cards._unevidenced` (`wringer-board/src/wringer_board/cards.py:199`)
to prefer the engine's `cause` field over prose matching.** Today `read.py:32`
is `("wringer.acceptance.v1", "wringer.acceptance.v2")` and
`read.py:486-487` raises `UnknownVersion` on anything else — deliberately: the
board's own rule, stated in the comment above the tuple (`read.py:30-31`), is
that an unknown version produces a banner and **no cards at all**, not
best-effort parsing.

*The review cited that raise as `read.py:241-244`. It is at `:486-487` — read
here at the board's `cfb749d`, which is S2 finished and landed after the review
read the file. `KNOWN_ACCEPTANCE` at `:32` is unmoved and still names v1 and v2
only, so **the gate stands exactly as ruled**; only the line number moved. The
correction is recorded rather than made silently, because a spec that names
other people's stale sentences and quietly repairs its own would be the same
defect wearing better manners.*

So the first record this cycle emits would, without the gate, make the board
refuse to read the record this cycle exists to make readable. **The surface
refusing to read the artifact it exists to render would be a self-inflicted
version of exactly the failure `SPEC_BOARD_V0.md` ruling 6 was written for** —
and it would be caused by the engine, which is worse, because the engine is
the half that gets to choose when to spend a version. The gate is on the
engine, not on the board: v3 waits.

### Two things R3 decides before it writes a line

1. **Committed or gitignored** (§3 ruling 2): `deliver.plan` carries every
   untracked path outside `.wringer/` into the delivery commit
   (`deliver.py:734-741`, `811`), so "undecided" means "committed, silently".
   R3 states the rule and, if the rule is "gitignored", says which file gets
   the line.
2. **The walkthroughs' `required:` values** (§3 ruling 6): read each
   walkthrough's spec block before correcting its rendered row.

R3's third capture also re-runs `wring verify` between the judgement edit and
the delivery, because acceptance is computed at verify time and read from the
bundle at deliver time — a capture that edits the file and re-runs `deliver`
alone would film nothing.

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
- It does not license **a board slice beyond the sequencing gate**. The gate
  buys v3 a reader; it does not buy the board a cause-rendering redesign, a new
  card, or anything ruling 11 refuses.

---

## §11 — Open questions, recorded rather than answered

- **Should a `not_met` judgement stop the loop as well as the delivery?**
  Today only delivery reads acceptance. A person saying "this is wrong" while a
  fleet is still running is exactly the ratchet's input, and wiring it into the
  loop is a policy call with an anti-thrash dimension. Not decided here.
- **Does the summary writer need a human-refusal line?** `summary.md` already
  special-cases born-green rows (`accept.py`'s `_REMEDY`,
  `tests/test_accept.py:560-620`), and the review could not reach whether
  `wring verify --json`, `summary.md` or `wring health` need to say anything
  about a refusing `human` row. §3 ruling 5's claim of "no new refusal path"
  is about **delivery** and is verified there; R3 checks the summary writer
  before it claims more than that.

*The drafted §11's second bullet — "should `wringer.judgements.yaml` be
committed or gitignored?" — is no longer an open question. It is a decision
R3 must make, with a default that fires if it does not: §9.*

---

## §12 — The review record

### The two attempts

The independent review was launched on 2026-08-16 with a refute instruction, a
list of every citation to open, and the specific question of whether the design
is implementable against the real call flow. **The first attempt was terminated
mid-pass by an account spend limit and returned no findings.** That is kept
here rather than tidied away: the spec sat UNREVIEWED and UNBUILT for the
interval, no code was written against it, and the law held under a condition
that was nobody's fault and no exception.

**The second attempt ran on 2026-08-16 and returned:**

> **Verdict: NOT SOUND. 22 findings — 7 HIGH, 7 MEDIUM, 8 LOW.**

All 22 are folded into the document above. One sub-point inside finding 19 is
rebutted below. Seven HIGHs were ruled on by the window supervisor before this
fold and are applied as ruled, not re-argued.

### The choke-point answer — the question the first attempt never reached

**ONE CHOKE POINT PER ENTRY PATH, and no delivery directory at any refusal.**
All 23 `raise Refused(` sites are inside `deliver.plan()`'s call tree and
nowhere else; a grep for external callers of `check_tree`, `check_identity`,
`branch_exists`, `check_verified_tree`, `resolve_base` and `gates_passed` found
none outside `deliver.py`. The catches are `cli.py:3279` and `graph.py:1807`.
`deliver.Bundle.create` (`deliver.py:958-977`), the only thing that creates
`.wringer/deliveries/<id>/`, runs at `cli.py:3287` and `graph.py:1813` —
strictly after `plan()` returns. So ruling 8's directory question is answered:
one write per entry path, in a new `.wringer/refusals/` root, and **the drafted
ruling was wrong not merely for the early sites but for all 23**.

### Every finding, and what it did to this document

**The rulings after §3 were renumbered by this fold, and the table below reads
in both numberings.** Folding finding 6 required a new §3 ruling 6 (the
published sentences OQ-1 falsifies), so every ruling from the old 6 onward
**shifted up by one**: the delivery-names tuple was ruling 6 and is now 7; the
refusal record was 7 and is now 8; the no-weakening rule was 8 and is now 9; the
three-valued field was 9 and is now 10; the `cause` enum was 11 and is now 12.
§3's rulings 1–5 are unmoved. **The *finding* column quotes the review, which
saw the drafted numbering; the *disposition* column names where the ruling
lives now.** They differ on purpose rather than by neglect.

| # | sev | finding (drafted numbering) | disposition (this document's numbering) |
|---|---|---|---|
| 1 | HIGH | the v3 selector contradicts "every row carries the field": v1/v2 would never be emitted again and §2's byte-identical promise was false | **FOLDED** — §2's narrowed selector: the two fields are v3-only and absent (not null) in v1/v2; v3 fires on any non-null `cause`, non-null `demonstrated_able_to_fail`, or a `judgement`; ruling 10 narrows to "every row in a v3 record". §2 also states the promise's honest denominator |
| 2 | HIGH | ruling 7 is false: no delivery directory exists at any of the 23 refusals | **FOLDED** — §4 ruling 8 rewritten; ruling 9's diff sentence amended. *One precision:* the record-writing helper **may** live in `deliver.py` (§4 ruling 9 puts it there); what cannot be in `deliver.py` is the CALL, which is the finding's substance |
| 3 | HIGH | writing under `.wringer/deliveries/` silently disables `wring attest` and reverses a pinned assertion | **FOLDED** — §4 ruling 8 forbids that location with the mechanism spelled out (`attest.py:279-288`, `363-375`, `tests/test_deliver.py:316`) and adds `test_a_refused_delivery_does_not_become_an_attestation_anchor`, to be **observed**, since the review reached this by reading |
| 4 | HIGH | R2-then-R3 violates law 7: R2 freezes v3 and R3 must then add a field | **FOLDED** — §9: R2 authors the schema complete, including the `judgement` object and the human causes R3 populates; R2's code writes only its own subset. The one-commit alternative is named and rejected with a reason |
| 5 | HIGH | OQ-1's three human causes have nowhere to live and break OQ-4's closed five-value enum | **FOLDED** — §6 is now ONE closed enum of **eight**, heading and table rewritten with sites, and the set-equality test ranges over all eight |
| 6 | HIGH | OQ-1 makes three SPEC_ACCEPT_V0.md sentences false, including one of its shipped acceptance criteria, and §12 named only the test | **FOLDED** — §3 ruling 6 names all eight entries (the six published sentences, the test, and one more this fold found: the `Row.refuses` docstring at `accept.py:230-243`, which states the rule OQ-1 reverses inside the very property R3 rewrites), requires the corrections in the same commit citing OQ-1, and records that this is the SEVENTH occurrence of the class (the sixth: `docs/graphs.md`, `babc10b`). The finding's closing sub-point is folded too: the FROZEN `schema/acceptance.schema.json:89` says `refuses` is "True only for a criterion that is both REQUIRED and BOUND", law 7 forbids amending it, and ruling 6 turns that into a derivation — a refusing unbound row necessarily carries a `cause`, so it can only ever appear in a v3 record |
| 7 | HIGH | emitting v3 makes `wringer-board` refuse to read the record, and §9 has no slice that fixes it | **FOLDED as a hard sequencing gate** — §9: the engine may not emit v3 until a board slice adds it to `KNOWN_ACCEPTANCE` (`read.py:32`) and prefers the engine's `cause` over prose matching |
| 8 | MED | ruling 5's refusal block prints a remedy that cannot clear a human refusal | **FOLDED** — §3 ruling 5: the human row's reason becomes its cause's sentence naming the file to edit, the gate trailer becomes conditional, and `test_a_human_refusal_does_not_print_the_gate_remedy` is added; §6 ruling 13 records the scoped exception |
| 9 | MED | `stale` "computed at read time" contradicts ruling 1, which needs it at write time | **FOLDED** — §3 ruling 4: computed inside `assess`, written into the row, `refuses` derived in the same pass, with the `deliver.py:585-588` evidence for why read time cannot work |
| 10 | MED | "canonicalised" is undefined and the cited precedent canonicalises nothing | **FOLDED** — §3 ruling 3 gives the literal preimage, excludes `required`/`human` with a reason, says the `briefed.json` citation is for discipline not mechanism, and adds the whitespace-edit test |
| 11 | MED | §7's "residue is none" is wrong: four false SPEC_BOARD sentences, and the code half already landed | **FOLDED** — §7 rewritten: residue inside this repo is none, residue outside is four named sentences, and `wringer-board` already discharged the exemption (`refusals.py:45-48`, `test_refusals.py:155`) |
| 12 | MED | the refusal-site guard must parse with `ast`; 21 of 23 sites span lines and one message contains a literal `)` | **FOLDED** — §1 and §4 ruling 7 require `ast.parse` and forbid a text scan. *Note:* the drafted spec did not use the word "redundant"; it claimed the constructor means "a new site cannot omit it", which is false for an unexecuted path — so the finding's substance stands and that sentence is corrected |
| 13 | MED | "committed or gitignored" is not an open question — an untracked judgements file is swept into the delivery commit | **FOLDED** — §3 ruling 2 states the mechanism, §11's bullet is retired, and §9 makes it a decision R3 must make with the default named |
| 14 | MED | OQ-1 makes two published walkthroughs false and nothing guards them | **FOLDED** — §3 ruling 6 names `docs/gategen.md:196-201`, its §7 closing sentence at `:372-374`, and `docs/factory-dry-run.md:118`, and requires R3 to read each walkthrough's `required:` value first |
| 15 | LOW | §12's scope claim is wrong for two of the three cleared tests | **FOLDED** — corrected below, in the self-check record itself |
| 16 | LOW | "consulted for rows that reach `evidenced` and thrown away" is false and invites a duplicate computation | **FOLDED** — §5 ruling 10: computed once at `accept.py:423`, consulted at `accept.py:528`, in hand for every row, so the field costs a lookup |
| 17 | LOW | the `null` case is under-enumerated: a witness-covered row with no gate is a third null and can be `evidenced` | **FOLDED** — §5 ruling 10's table carries the third case with its citations and the warning it exists to prevent |
| 18 | LOW | one test has two names across §1 and §6 | **FOLDED** — `test_every_cause_is_reachable_from_a_fixture` in both, the counted name dropped |
| 19 | LOW | §4 counts eight and lists nine | **FOLDED** — "wrong for nine of them", with the eight-plus-one spelled out. **The aside is REBUTTED — see below** |
| 20 | LOW | three new schema files need three `frozen.json` entries in the same commit, which §2 did not say | **FOLDED** — §2 says it, with the set-equality test and the note that the byte-freeze test iterates every entry despite its name |
| 21 | LOW | ruling 5's `accept.py:267` names a property delivery never uses | **FOLDED** — §3 ruling 5 cites `deliver.py:585-588` and `accept.py:256`, and says explicitly that `Result.refusing` is not the mechanism |
| 22 | LOW | non-goal 9 is in tension with a directory-per-refusal shape | **FOLDED** — §4 ruling 8 states the retention rule (nothing prunes, counts or enumerates) and non-goal 9 is reworded to forbid the aggregate rather than the file |

### The one rebuttal: finding 19's aside

Finding 19's arithmetic is right and is fixed. Its **aside** — "consider whether
`deliver.py:367` `unsupported_file_type`, which fires inside
`_check_untracked_bytes`, belongs with the evidence family rather than
machine/tree" — is **declined, with a reason.**

The evidence family in §4's table is defined by one property: *the tree is fine
and the record does not cover it.* Every member is cured by re-running
`wring verify` against the tree as it stands — `head_moved`, `tree_moved`,
`tracked_contents_differ`, the untracked-record refusals and `gates_did_not_pass`
all mean "the evidence is about a different tree than the one you are
delivering". `unsupported_file_type` is not that. It fires because the tree
contains an object that is **neither a regular file nor a symlink**, which no
record could ever cover and which git will not commit either; its remedy is
"Remove it and run `wring verify` again" — remove the object, not improve the
evidence. Classifying it as evidence would make the family's defining property
false, and the family exists to correct someone else's loose characterisation,
so a loose one of our own is the worst possible payment. It stays machine/tree,
and the count stays nine.

### The author's self-check, kept — and the review's ruling on it

The author of a document is the worst available reviewer of it. The drafting
window ran a citation-verification pass anyway, so a reviewer's budget would not
be spent on wrong line numbers. **It was not the review and it did not discharge
the obligation.** Three citations were wrong and were corrected in place: the
version selector (`Result.has_witness`, `accept.py:269-278`, write sites
`accept.py:305` and `:318`, not `:277-286` which is `Result.counts`);
`Row.refuses` (`accept.py:228-244`, not `:229-243` which is the docstring
alone); the digest discipline (`staleness.capture`, `staleness.py:102-104`, not
`:52-58` which is `AUTHORITY_DOCUMENTS`).

The self-check also found one HIGH the drafted spec did not contain: that OQ-1
invalidates `tests/test_accept.py:286-300`, whose docstring states the rationale
OQ-1 overturns, and that the fix must amend the docstring in the same commit
citing OQ-1 rather than reversing a pinned assertion quietly.

**The review's ruling on that self-check: REAL, correctly prescribed, WRONGLY
SCOPED, and it found one of at least eight.** Taken in full:

- **Real.** The review ran the test at HEAD and confirmed it passes, confirmed
  the fixture at `tests/test_accept.py:59-64` is `required: true, human: true`,
  and confirmed the prescribed discipline matches what `wringer-board` did for
  its fifth cause.
- **The scope claim was wrong for two of three.** The self-check wrote that the
  other three `refuses is False` assertions are "all three about **unbound and
  unevidenced** criteria". Corrected: `tests/test_accept.py:151` is the unbound
  case; `tests/test_accept.py:198` (inside
  `test_a_recorded_failure_evidences_the_criterion`) and
  `tests/test_accept.py:465` (inside
  `test_a_sensitive_receipt_discloses_an_unverified_pre_change_environment`)
  both assert `row["state"] == accept.EVIDENCED` on the line above. None is a
  `human` criterion, so the conclusion — OQ-1 does not touch them — survives;
  the stated basis did not, in a passage explicitly labelled "Checked rather
  than assumed". **That is what a self-check is worth, recorded rather than
  argued.**
- **It looked in one file.** The review's own list of what the self-check
  missed runs to **eight items** — the two selector tests
  (`tests/test_accept.py:637-653` and `656-667`), `tests/test_deliver.py:316`,
  three `SPEC_ACCEPT_V0.md` sentences, the two walkthroughs as one item, and
  the board's `KNOWN_ACCEPTANCE` — every one of them outside
  `tests/test_accept.py`, which is exactly the blind spot the self-check's own
  argument predicts. *Two counts are running here and they are not the same
  count, so neither is rounded into the other:* eight items the self-check
  missed, of which four items — three `SPEC_ACCEPT_V0.md` sentences and the
  walkthroughs item, six sentences in all — are published sentences that go
  false, and they are §3 ruling 6's list minus the one test the self-check did
  find and the one docstring neither pass found (`accept.py:230-243`, caught
  while folding); the programme-wide stale-sentence class stands at
  **seven occurrences** (§3 ruling 6). **OQ-1 adds none of its own**, because
  R3 lands the corrections in the same commit as the policy — that is the whole
  point of ruling 6. **This commit does add one**, and it is not netted off
  against that: the three `AGENTS.md:75` claims §7 names go false the moment
  this rewrite lands, and they are owed and dated there rather than counted as
  clean.

### What the review could not reach, and who owes it

Recorded because an unreached item is not a cleared one:

1. **The full suite was not run** — three targeted tests were, and all three
   pass at HEAD. R1/R2/R3 each run `sh scripts/ci-repro.sh`.
2. **The `wring attest` breakage was traced by reading, not observed.** R1
   constructs the case and observes it (§4 ruling 8).
3. **The walkthroughs' `required:` values were not read.** R3 reads them before
   correcting (§3 ruling 6).
4. **`wringer-board`'s git state was not checked** — the working tree was read
   at the cited paths, and the board has no remote, so "HEAD" there is not a
   shared reference. **Checked during this fold: the board is clean at
   `cfb749d` ("S2 finished"), which landed after the review read the file.** One
   citation moved and is corrected in §9 (`UnknownVersion` is raised at
   `read.py:486-487`, not `:241-244`); `KNOWN_ACCEPTANCE` at `read.py:32` is
   unchanged and still names v1 and v2 only, so the gate itself is unaffected.
   The sequencing gate names the file and line the board slice must change (§9).
5. **Whether `unbound` and `witness-evidenced-nothing` partition
   `accept.py:485` was not settled.** R2 reads `witness.py`'s construction path
   and records the answer (§6 ruling 12).
6. **`wringer.judgement.v1`'s interaction with `wring verify --json`,
   `summary.md` and `wring health` was not examined.** §11 carries it as an
   open question and R3 checks the summary writer (§3 ruling 5's claim is
   scoped to delivery).

### The state of this document

**REVIEWED, NOT SOUND, 22 findings, all folded, one sub-point rebutted. It may
be built to, in §9's order, behind §9's gate.** The next window builds R1
first, because it changes no policy — and R1's own capture is the first thing
in this cycle that a PM could read.
