# The SPEC_PMPLAN_V0 review (2026-08-19) — NOT SOUND, 19 findings

An adversarial multi-lane review of `SPEC_PMPLAN_V0.md`, run before any code
was written against it. **Verdict: NOT SOUND.**

| | |
|---|---|
| lanes | 8, each pointed at a different binding source |
| raw findings | 97 |
| after dedupe | 54 |
| **confirmed by adversarial refutation** | **19** |
| killed by refutation | 5 |
| passed through unverified (severity cap) | 30 |
| agents / tokens / wall clock | 57 / 4.4M / 53 min |

Every finding was put to two independent skeptics with different lenses — one
required to re-read the source and decide whether the claim is true of the code
TODAY, one required to assume it true and decide whether it matters — and each
was told to default to REFUTED when uncertain. The 19 below survived that.

**This file is the record, not the fold.** Findings are folded into the spec
commit by commit; this document is what the review actually said, kept so that
a later reader can check the fold against it rather than against my summary of
it. Where a finding names a line number, that anchor is as of the reviewed
revision and may have moved.

## Scope note — what the review was NOT asked to do

Lanes were told to hunt contradictions with binding sources and to skip
anchor-checking, because this programme has measured that contradiction lanes
find the shipping defects while anchor lanes spend the budget on line numbers.
So the absence of anchor findings below is a choice, not a clean bill.

## The 30 unverified

Thirty of the 54 merged findings were below the verification cap and are
recorded in the run's own transcript rather than here. They are NOT known to be
wrong — they are unexamined, and saying so is the point: a cap that is not
declared reads as "we covered everything".

---

## C1 — HIGH · §2 ruling 9 (WHAT WILL HAPPEN AT THE END) and §0.4

**Claim.** Ruling 9's three classes are wrong in BOTH directions. An unbound criterion
can never hold a handover, so the block prints "The handover is being held…"
on plans whose handover will not be held; and a merely PROPOSED gate is
counted as "has a check bound to them", a stronger claim than the criteria
block eight lines above makes. §0.4 still states the false cause the Status
block records as fixed in ruling 9 only.

**Evidence.** accept.py:406-449 — Row.refuses is `self.required and self.covered and
self.state != EVIDENCED`, and covered is `gate_id is not None or (witness is
not None and witness.covers)`; its docstring: "An uncovered one is a debt the
author has not paid yet — loud, never fatal." deliver.py:742-748 refuses only
over rows with refuses true, and names the case in its own docstring. Measured
on the run the spec cites: scratchpad/verify-drive2/…/acceptance.json has 8
rows state=unevidenced cause=unbound refuses=False and exactly ONE refusing
row, heading-reads-as-yours (HUMAN); console.txt:150-157 lists that one row
and no other. Second leg: wringer-board interview.py:363-402 `_bindings()`
merges wringer.gates.yaml (installed=False) with .wringer.yaml
(installed=True) and ruling 9 discards the flag, while accept.py:776 joins
acceptance from `cfg.gates` — .wringer.yaml only. The board's own fixture
(test_interview.py:50-63) is proposed-only, so slice 3's capture would be
taken against the one shape that hides the defect. Third leg:
SPEC_PMPLAN_V0.md:79-82 still reads "because the other criteria have nothing
checking them", which ruling 9 itself (:396-400) calls false.

**Proposed fix.** Re-ground ruling 9's classes on accept.Row.refuses, not on boundness: (a)
required human criteria with no judgement, and (b) required COVERED criteria
(INSTALLED gate or witness) not yet evidenced, are the only classes that may
be said to hold the handover; (c) unbound criteria get their own honest line —
"nothing checks this; it will be reported unevidenced and will not stop the
handover", which is the more alarming fact for a PM anyway. Change the render
condition to "at least one required human, or at least one required installed-
bound criterion". Count from the `installed` flag `_bindings()` already
returns, and iterate the spec's criteria looking each up in `bound` rather
than taking `len(bound)`. Say that `covered` includes a witness the board
cannot see, so an unbound row can acquire a refusal at run time the plan
cannot foresee. Rewrite §0.4 to name heading-reads-as-yours as the sole
holder.

*Raised by lanes: interlock, drift, internal, pinned.*

---

## C2 — HIGH · §2 ruling 9 ("reused verbatim from refusals.py:451-455, and confirmed byte-identical against the real run's console"), §5 non-goal 6, §8

**Claim.** Half the specimen block is invented board prose about engine behaviour that
exists in no repository and in no capture, while the ruling claims byte-
identity and non-goal 6 claims the board writes no second sentence for a fact
the engine already has words for. A builder copies the specimen block, so it
ships.

**Evidence.** Read directly: wringer-board/src/wringer_board/refusals.py:451-455 is a two-
field Saying — "The handover is being held because at least one requirement
cannot show its proof." / "See the cards above — each one holding this up says
what it needs." The spec keeps field one, DROPS field two, and substitutes
"That is this tool working, not failing: it will not hand over work it cannot
prove." Grepped /Users/marc/Claude/wringer, wringer-board and wringer-drive:
the only hit is SPEC_PMPLAN_V0.md:388 itself. tests/test_refusals.py:376-389
pins that a Saying is a sentence AND exactly one question, so dropping half is
not "verbatim" either. The block also renders at APPROVAL time in the present
tense about an event that has not happened, and "working, not failing" softens
a refusal in advance (non-goal 4).

**Proposed fix.** Render the block by CALLING refusals.say(DELIVERY_REFUSAL,
"acceptance_unevidenced") and printing what it returns, under board
scaffolding that marks it conditional ("IF THAT HAPPENS, THIS IS WHAT YOU WILL
SEE:"). The real reason the reuse does not fit — field two points at cards
that do not exist before a run — must be stated rather than papered over; if
the reassurance is wanted, add it to refusals.py as a new plan-context family
so there is still exactly one authored copy inside every_string()'s ceiling.
Delete the "confirmed byte-identical against the real run's console" claim; it
is false of the sentence it is attached to. Pin the reuse with a test that
imports the Saying rather than re-typing it.

*Raised by lanes: parseorder, interlock, byteedit, drift, redraft, internal, pinned.*

---

## C3 — HIGH · §3 ruling 12 (wringer-board approve records a fingerprint; wring plan recomputes it and refuses when it differs)

**Claim.** The fingerprint must exist twice, in two packages with no shared code and no
dependency edge, over a "canonical serialisation" the spec never defines — so
any normalisation difference makes wring plan accuse an honest PM of editing
their spec after approving it. That refusal renders and never resolves, and
its only escape is deleting the sidecar.

**Evidence.** wringer-board/pyproject.toml declares `dependencies = []`, and
tests/test_refusals.py:135-140 states it as a rule: "This package has no
runtime dependency on `wringer` and will not gain one." interview.py imports
only re, yaml, dataclasses, pathlib. AGENTS.md installs wringer-board into its
own tool environment, so wringer.spec is not importable at runtime. The two
sides already read one field differently: board `str(entry.get("answer") or
"")` (interview.py:442) vs core's strict isinstance check (spec.py:361-362);
and the two _scalar emitters disagree on multi-line answers (board writes `|-`
blocks, core writes JSON-quoted). Ruling 12 specifies no ordering, encoding,
separator, newline or unicode rule.

**Proposed fix.** Name the canonical form byte-exactly in the ruling (e.g. UTF-8 of
`id\x1fanswer\x1e` pairs sorted by id, questions then assumptions, with a
version tag) and make ONE implementation the source: either declare wringer a
real dependency of wringer-board, or have the board shell out to a core
command that prints the fingerprint. Guard it with a cross-package test that
computes the fingerprint through both entry points on one spec.render()
fixture carrying a multi-line answer and a unicode answer, watched red by
mutating one side — the tests/test_publication_wording.py:12-16 pattern for
cross-repo guards. Without that, ship ruling 12 as OWED under its own escape
hatch.

*Raised by lanes: pinned, parseorder, redraft.*

---

## C4 — HIGH · §3 ruling 12 (the consent fingerprint) — no refresh path

**Claim.** Nothing can ever rewrite a stale fingerprint, so the check dead-ends the very
hand-edit remedy the engine and the board both print to the PM — and it is
silently off for the flow SPEC_INTENT blesses.

**Evidence.** wring plan's refusal tells the PM "Read the file, then set 'approved: true' in
it by hand" (cli.py:3022-3027), and answer's refusal says "edit
wringer.spec.yaml by hand" (interview.py:135-140). The only writer of a fresh
consent block is wringer-board approve — which raises
InterviewError("wringer.spec.yaml is already approved. Nothing was changed",
exit_code=0) at interview.py:461-465 BEFORE writing anything (confirmed in
source). Sequence: approve → consent written; PM takes the recommended hand-
edit remedy; wring plan refuses on the mismatch; approve refuses as already-
approved. The only exits are hand-flipping approved: false or deleting the
sidecar — the bypass ruling 12 already concedes. Ruling 12's specified refusal
names no remedy, in a spec whose ruling 13 exists solely because a refusal
pointed at a destructive one. Second leg: a repo that runs wring spec and
hand-approves (SPEC_INTENT_V0 §3) has assumptions and no consent block, so the
check is off for the blessed flow and live only where it deadlocks.

**Proposed fix.** Rule what refreshes consent: when the fingerprint is stale, approve re-renders
the plan and REWRITES consent instead of raising already-approved — re-
approving after reading the plan IS the consent act, and the exit-0 refusal is
only correct when nothing moved. The mismatch refusal must then name that
command. Otherwise ship ruling 12 as OWED.

*Raised by lanes: interlock.*

---

## C5 — HIGH · §1 ruling 3 (the parse-time question cap), conditions (i)/(ii)

**Claim.** The spec states no counting rule, and at the insertion point it names the cap
runs BEFORE `_parse_questions` — so it steals four precise error messages, and
on one malformed shape the obvious implementation raises an uncaught
AttributeError instead of a refusal.

**Evidence.** The insertion point is spec.py:887 → :889; every question-shape check lives
inside parse() at spec.py:328-372. Measured against the real parser: 4
questions with `required: 'yes'` → "open_questions[0] ('q0'): 'required' must
be a boolean"; a list of 4 bare strings → "open_questions[0] must be a
mapping"; 25 questions of which 4 required → the existing MAX_OPEN_QUESTIONS
message. A cap written the obvious way, `sum(1 for q in asked if
q.get('required', True))`, pre-empts all four and raises AttributeError on the
bare-string list — which cli.py:2783 does not catch (spec.SpecError only), so
`wring spec --send` tracebacks and bundle.write_summary never runs. A truthy
count is also incoherent: `required: 'yes'` counts, `required: None` does not.

**Proposed fix.** Move the cap to immediately AFTER `drafted_spec = parse(...)` (spec.py:904)
and count `sum(1 for q in drafted_spec.questions if q.required)` — still after
all three interlock refusals, still before validate_rubric_text and
parse_bindings, no counting rule needed (Question.required is a validated
bool), cannot crash, every _parse_questions message intact. If the cap must
stay pre-parse, rule explicitly: count only entries where isinstance(entry,
dict) and entry.get('required', True) is True, and skip the cap entirely when
any entry is not a dict or its `required` is not a boolean. Either way say
whether MAX_OPEN_QUESTIONS' message is displaced.

*Raised by lanes: parseorder.*

---

## C6 — HIGH · §3 ruling 10 ("B5's byte-equality doctrine constrains both edits to line edits, reusing `_fill_existing`/`_scalar` for the answer")

**Claim.** `_fill_existing` returns None for exactly the case revise exists to handle,
and both obvious builds on top of it corrupt wringer.spec.yaml — one
recreating the duplicate-key defect the module documents as already fixed
once, the other producing a file PyYAML cannot parse.

**Evidence.** interview.py:186-210 — docstring "Replace this question's EMPTY `answer:` in
place, or None if it has none", and :204-206 `if existing: return None  # a
real answer; the caller refuses`. Executed against a render()-produced spec
whose question already has an answer: returns None. Running answer()'s fall-
through append branch (interview.py:159-182) on the same lines emits a SECOND
`answer:` key inside the question; yaml.safe_load silently takes the last, so
a round-trip test AND a byte-equality test both stay green over a malformed
file — the exact failure interview.py:145-153 documents ("a strict loader
rejects it"). Replacing only the `answer:` line is worse when the previous
answer was a `|-` block (interview.py:256-259): the continuation lines are
orphaned and PyYAML raises ParserError (reproduced).

**Proposed fix.** Ruling 10 must stop naming `_fill_existing` and specify a new
`_replace_existing(lines, id, text)` that (a) accepts a non-empty answer, (b)
deletes the whole existing scalar including every block-scalar continuation
line, and (c) REFUSES rather than falling through to answer()'s append branch
when it cannot locate exactly one `answer:` line. Alternatively give
`_fill_existing` an `overwrite: bool` and keep answer() calling it with False
so its pinned refusal (tests/test_interview.py:124-128) is provably unchanged.
Slice 4's watched-red guard must include revising a `|-` multi-line answer, a
round-trip through the ENGINE's spec.load, an assertion of exactly one
`answer:` key in the target block, and byte-equality against the hand edit.

*Raised by lanes: byteedit, interlock, parseorder, pinned.*

---

## C7 — HIGH · §3 ruling 10 ("The flip is unconditional", reusing APPROVED_LINE)

**Claim.** Built the way ruling 10 says — mirroring approve() — the flip corrupts the
interlock line on the case the ruling makes mandatory, and two valid YAML
spellings are not matched at all, so revise can write the answer while the
approval silently stands. approve() carries the same bug live today.

**Evidence.** Read in source: APPROVED_LINE (interview.py:423-425) matches `true|false` with
re.I, but the edit at interview.py:468 is
`line.rstrip("\n").partition("false")` — a case-SENSITIVE literal — and the
`if not head` fallback can never fire, because a non-matching partition
returns the whole line as head. So today `approved: False` → `approved:
Falsetrue`, which no longer loads (spec.parse: "'approved' must be a
boolean"). The mirror flip for revise on the engine's own rendered line
(`approved: false        # <- the interlock…`) yields `approved: falsefalse
# …`. And `approved: yes` / `approved: on` are valid YAML true, accepted by
spec.parse, but do not match APPROVED_LINE at all — so no flip is computed.

**Proposed fix.** Ruling 10 must specify (a) the flip is written from the regex match's `value`
span, never partition on a literal; (b) revise REFUSES WHOLE — nothing
written, not even the answer — when no `approved:` line matches, because "one
write, both edits" is worthless if one edit can silently be a no-op; and (c)
approve()'s existing partition("false") is fixed in the same slice. Watch red
on all four spellings: false, False, yes, on.

*Raised by lanes: byteedit, interlock.*

---

## C8 — HIGH · §3 ruling 11 (revising an assumption promotes it) with §1 ruling 5 and §2 ruling 7

**Claim.** Promotion leaves the assumption standing in the sidecar, so the next plan re-
presents a decision the PM just overruled as one that approving approves, the
PM's own answer renders nowhere, and a second revise of the same id is refused
— the way back closes after one use.

**Evidence.** Ruling 11 lands the promoted question "in open_questions and nowhere else";
ruling 10's single write_text targets wringer.spec.yaml, and ruling 12's
amendment makes approve the sidecar's only board-side writer, so revise never
touches wringer.decisions.yaml. Ruling 5 then renders the sidecar's
assumptions verbatim under "DECIDED WITHOUT ASKING YOU / These were decided
for you. Approving this plan approves them." Meanwhile interview.py:341-348
builds the STILL UNANSWERED list from unanswered(repo) — required-and-empty
only (interview.py:108-110) — so an answered question renders nowhere. Net:
the plan asserts the overruled decision as consented-to, the brief carries the
opposite, and the override is invisible on the page the PM approves from — two
surfaces describing one fact inside the consent surface, board ruling 1's own
failure mode. Ruling 11's first refusal then fires on the second revise, and
answer() also refuses (interview.py:135-140), so the PM cannot change their
mind twice. Ruling 11's parenthetical "ruling 7 makes this unreachable for a
drafted spec" is false the moment one revise succeeds.

**Proposed fix.** Rule the assumption's fate. Cleanest: revise REMOVES the assumption row from
the sidecar in the same act (it has been promoted, not duplicated), making the
collision structurally unreachable; then rule the dispatch — an id present in
open_questions always takes the question path, so a second revise works. If it
is kept for provenance, ruling 5 must render it struck through with the PM's
answer beside it and never as "you were not asked", and ruling 12's
fingerprint must not count the same decision twice. Watched red: revise, re-
render the plan, assert the old decision sentence is gone or superseded.

*Raised by lanes: parseorder, interlock, internal.*

---

## C9 — HIGH · §3 ruling 13 ("Matching ids in the new draft get their answer restored")

**Claim.** Matching on id alone attaches a person's answer to a question they never saw.
The repo's own captures show the same id carrying materially different
question text across rolls, so the restore manufactures an answer — the exact
harm the self-answered-question refusal exists to prevent, in a place that
refusal cannot reach.

**Evidence.** Measured from the captures: `what-counts-as-played` is asked in run 2 as "…or
only after they have actually played for a while (and if so, how long)?" and
in run 3 as "…or only after they actually start a round (e.g. press start)?";
`clearing-history` differs between run 1 and run 4 the same way. An answer of
"after about ten seconds" answers run 2 and is nonsense under run 3, yet
ruling 13 restores it unseen. spec.py:867-885 refuses a whole reply for
exactly this ("an assumption a human did not make is exactly what an open
question is for") and runs before any merge could reach it; cli.py:3031-3045
refuses only while a required question is EMPTY, never while it is wrongly
filled. The in-house discipline already exists: accept.criterion_digest
(accept.py:667-695) exists so nothing may move under an answer.

**Proposed fix.** Restore an answer only when the previous question's text is byte-equal to the
new one. Where the id matches but the text differs, do not fill: carry the
PREVIOUS (question, answer) pair forward as its own entry so the answer stays
under the words it answered, leave the new question unanswered and required so
wring plan refuses until the person re-answers, and emit a Draft.notes line
naming the id. State in the ruling that id equality is not question equality,
and cite run 2 vs run 3 as the measurement; watch it red on a reworded-same-id
fixture.

*Raised by lanes: interlock, redraft, pinned.*

---

## C10 — HIGH · §3 ruling 13 ("The merge can still trip MAX_OPEN_QUESTIONS, which refuses with its existing message")

**Claim.** That refusal cannot fire as specified. MAX_OPEN_QUESTIONS lives only inside
_parse_questions, reachable only through parse(), which has already run on the
reply before the merge. Nothing re-validates the merged document, so --redraft
writes a wringer.spec.yaml that spec.load will refuse at wring plan — and the
previous file is gone.

**Evidence.** spec.py:333-338 is the only site of the limit, called from parse at
spec.py:265; parse_response calls parse once, at spec.py:889, on the reply's
own questions. cli.py:2797 then does `target.write_text(spec.render(drafted))`
with no further validation, under a comment at cli.py:2794-2796 claiming
"Written only now, once the whole document has been through the same parsers
the file itself will face" — which the merge falsifies. The union is
realistically over 20: an old spec may legally carry 20 and ruling 3 caps only
REQUIRED questions in the reply. The same gap swallows _parse_questions'
duplicate-id check (spec.py:351-353) and its answer-must-be-a-string check
(spec.py:361-362).

**Proposed fix.** Rule that the merged document is re-run through spec.parse(...) before render,
and that a failure there refuses and writes nothing — so the limit, duplicate
ids and the answer-type check all fire against the bytes that would be
written. Guard: a redraft merge that would exceed the limit refuses with the
file untouched, watched red.

*Raised by lanes: redraft.*

---

## C11 — HIGH · §2 ruling 7 (assumption id colliding with an open_questions id → refused whole) and §3 ruling 11's parenthetical

**Claim.** The collision refusal is both too broad and wrongly scoped: it kills whole
paid drafts on measured drafter behaviour, and its "unreachable for a drafted
spec" claim is false on two paths — after one revise, and after any --redraft.

**Evidence.** Measured: tests/replies/2026-08-19-arcade-run4-drafter-reply.json ASKS
`memory-scope` and writes into criterion survives-tab-close's guidance
"Decision taken unless the memory-scope question says otherwise: this is per-
browser only…" — a drafted reply that deliberately pairs a PROVISIONAL
decision with a question of the same subject and names the question by id.
Once ruling 1 gives it an assumptions list, the natural id is `memory-scope`
and ruling 7 refuses the whole draft; the stated justification ("claiming both
to have decided a thing and to be asking about it") does not describe run 4.
This is the objective_note mistake R3 exists to stop (test_spec.py:1114-1126:
one drafting run in four died over `objective_note: ""`). Reachability: ruling
7's check runs inside parse_response on ONE reply, so after a redraft whose
fresh reply lacks the id, the sidecar keeps the assumption while ruling 13
appends the answered question — collision, with no check anywhere.

**Proposed fix.** Narrow the refusal to the case that is actually a contradiction — an
assumption whose instead_of_asking duplicates a question that is required AND
unanswered — and make a bare id collision a Draft.notes entry plus a rendered
cross-reference ("this was decided provisionally; you were also asked about
it"). Move the check to a post-merge position for the redraft path and make it
drop-with-note there: an assumption whose id matches an ANSWERED question is
dropped from the sidecar with a note that the person already decided it.
Correct ruling 11's parenthetical.

*Raised by lanes: redraft, parseorder, internal.*

---

## C12 — HIGH · §1 ruling 2 (the sidecar is written by `wring spec` "or by hand") with §3 rulings 12 and 13

**Claim.** Two writers share one new file with no generated/hand-written protection, so
an ordinary `wring spec --send` silently clobbers a person's hand-written
sidecar — including the consent record ruling 12 depends on. The core already
carries the precedent for the sibling sidecar ten lines away, and the spec
never cites it.

**Evidence.** spec.py:106-110 defines GATESPEC_MARKER, whose comment says it "earns it twice
over: an offline repo writes this file BY HAND (ruling 5), so `wring spec
--send` must never silently replace a person's own gate proposals with a
model's"; spec.py:1079-1080 gatespec_is_generated; cli.py:2808-2819 leaves an
unmarked wringer.gates.yaml alone and says where the drafted gates went. The
spec's own text makes the decisions sidecar hand-writable (:149-150, and :170
"A consent-only sidecar is the normal case for a repository whose spec was
written by hand"), yet cli.py:2712-2720's overwrite refusal keys only on
wringer.spec.yaml — and its remedy literally tells the reader to delete that
file, after which --send proceeds and overwrites the sidecar unchecked.
Nothing protects it at all when wringer.spec.yaml is absent.

**Proposed fix.** Add a DECISIONS_MARKER rendered as the sidecar's first line the way
GATESPEC_MARKER is, plus a decisions_is_generated twin, and rule the same
three-way outcome as the gatespec: generated → overwrite; hand-written → leave
alone with a console line saying where the drafted assumptions are; absent →
write. On both the --send and --redraft paths. Rule that a consent block is
NEVER written or overwritten by the core (only wringer-board approve writes
that key) and that a redraft never carries a consent block forward — a
redrafted spec was never approved. Ruling 13's "copied into the drafting
bundle" is recovery, not consent, and does not replace this.

*Raised by lanes: frozen, pinned, redraft.*

---

## C13 — HIGH · §1 ruling 2 (freeze on publication) vs §4 slice plan vs §3 ruling 12

**Claim.** The sidecar schema freezes in slice 2, but two of its three blocks (outcomes,
consent) are not built until slices 3 and 4 — and ruling 12 reserves the right
never to build consent at all. The spec never rules whether
decisions.schema.json is authored complete at publication, so every build path
from here violates law 2 or the suite's own "declared shape with no producer"
standard.

**Evidence.** SPEC_PMPLAN_V0.md:146 freezes it on publication; §4:603-605 puts assumptions
in slice 2, outcome in slice 3, revise+fingerprint in slice 4; :551-553 lets
the fingerprint ship OWED; :613 says slices 1–2 alone are a successful window.
tests/test_schema.py:1037 asserts frozen.json == the set of
schema/*.schema.json exactly, so the file is frozen the instant it exists. The
repo has a named standard against the alternative — test_schema.py:1308, 1521,
1618, 1736 all assert "a declared shape/value no fixture produces is a branch
validated against nothing" — and the one deliberate exception carries its
justification in schema/README.md's acceptance-v3 row: "Authored complete on
first publication — including the judgement object the slice after it
populates — because publishing freezes it".

**Proposed fix.** Add to ruling 2: decisions.schema.json is AUTHORED COMPLETE in slice 2 —
assumptions, outcomes and consent all declared, all optional — with the
acceptance-v3 justification quoted in its description and its README row, so
the later slices add producers and never a byte. Then state the consequence
out loud: if the fingerprint ships OWED, the frozen schema carries a consent
block nothing writes, and the DONE list must say so rather than let §6 imply
it landed.

*Raised by lanes: frozen.*

---

## C14 — HIGH · §1 ruling 1 (assumption `id`) with §3 ruling 11

**Claim.** Nothing pins an assumption id to the frozen question-id rule and nothing
requires instead_of_asking to be non-empty, so `wringer-board revise
<assumption-id>` can write a wringer.spec.yaml that the frozen
spec.schema.json rejects and spec.load refuses — while law 9 claims the
board's writes are byte-identical to a hand edit.

**Evidence.** schema/spec.schema.json:45-49 pins open_questions[].id to
`^[A-Za-z0-9][A-Za-z0-9_-]*$` with maxLength 64, and :50-53 pins question to
minLength 1. spec.py:314-323 (_slug) enforces the same via
config.GATE_ID_PATTERN / MAX_GATE_ID_LENGTH, applied to every entry at
spec.py:346-366. The spec defines the assumption id only as "a slug, unique
within the reply" (:117) and promotes it verbatim as `id:` with `question:`
taken verbatim from instead_of_asking (:468-470). A 70-character id, an id
containing `.`, or an absent/blank instead_of_asking each produce a file the
board wrote and the engine cannot load — the same class of defect ruling 6
caught for _TASK_KEYS, on the path the spec did not look.

**Proposed fix.** In ruling 1's field table, pin id to the identical rule the frozen schema uses
(`^[A-Za-z0-9][A-Za-z0-9_-]*$`, maxLength 64) and make instead_of_asking
REQUIRED with minLength 1, enforced both in decisions.schema.json and at
parse. Add a refusal to ruling 11: an assumption whose id or displaced
question could not survive _parse_questions is refused before any write,
naming which rule it broke.

*Raised by lanes: frozen.*

---

## C15 — HIGH · §3 rulings 10/11 — `_scalar` reuse, against law 9 (B5 byte-equality)

**Claim.** Ruling 11 makes the board write a `question:` line that the ENGINE also
writes, but the board's _scalar and the engine's _scalar are different
functions with different quoting rules — so the same text produces different
bytes depending on which surface wrote it, and the obvious B5 test cannot
catch it.

**Evidence.** Executed side by side: for "Should a player's history follow them to another
device?" the engine emits it PLAIN while the board emits it double-quoted with
an escaped apostrophe; for "Scope: which devices…" the engine single-quotes
and the board double-quotes; `yes` → engine `'yes'`, board `"yes"`; `a # b` →
engine `'a # b'`, board `"a # b"`. Four of four sampled strings differ. The
emitters are wringer-board interview.py:240-285 (char blacklist → double-
quote, \n → `|-`) vs wringer spec.py:1181-1219 (safe_dump plain attempt →
single-quote → json.dumps). The B5 test at tests/test_interview.py:69-91
compares against a hand-TYPED fixture, so a test written the same way self-
agrees — the failure mode the board's own _scalar docstring names. And ruling
13's --redraft re-renders the whole file through spec.render (cli.py:2797), so
a board-written question comes back engine-quoted. The spec's own ruling 11
example shows `answer: "No — one browser is fine."` quoted, which
interview._scalar emits PLAIN.

**Proposed fix.** Rule that any line class the engine also emits (`question:`, `required:`, the
`- id:` line) is written with the ENGINE's scalar rule — port spec._scalar
into the board or expose it — and that `answer:` stays on the board's rule
only because the engine never writes a non-empty one. Rule the guard too: the
byte-equality test for ruling 11 compares against spec.render() output for a
Spec carrying the promoted question, never a hand-typed literal, with an
apostrophe, a colon and a `#` in the question text.

*Raised by lanes: byteedit.*

---

## C16 — HIGH · §2 ruling 7 ("Missing — a task with no `outcome` … a note in Draft.notes"), unacknowledged by §1 ruling 3(iii)

**Claim.** Ruling 7's missing-outcome note turns a currently-green pinned test red, and
the spec's only budget for that test is the question cap.

**Evidence.** tests/test_spec.py:1087 asserts `drafted.notes == ()` (exact empty tuple)
after spec.parse_response on the 2026-08-17 capture. I loaded that capture:
both tasks carry keys ['brief','dir','id','objective'] only — neither has an
outcome. Under ruling 7 that reply produces two missing-outcome notes and the
assertion fails. §1 ruling 3(iii) lists this test as needing only a trimmed-
question payload; §2 says nothing about it.

**Proposed fix.** Add to ruling 7: the missing-outcome note is emitted only when the reply
carries the outcomes channel at all (at least one task has `outcome`); OR
state explicitly that this assertion becomes a "no note mentions 'outcome'"
shape and name it in slice 3's guard list. Do not leave it to the builder — a
silent loosening to `assert not [n for n in notes if 'binding' in n]` would
destroy the watch that the duplicate-binding rule refuses duplicates and
nothing else.

*Raised by lanes: pinned.*

---

## C17 — MEDIUM · §1 rulings 1/2 vs the interlock invariant at spec.py:769-789

**Claim.** `assumptions` is a fourth reply-side container of id-keyed entries that
_drop_unknown_reply_keys does not cover, so `approved` smuggled onto an
assumption entry escapes interlock refusal — in a parser whose stated law is
that the interlock does not become droppable by moving down a level. The R3
drop-with-note behaviour is likewise undefined, so an unknown key can kill a
whole paid draft.

**Evidence.** spec.py:785-789 — the sections tuple is exactly open_questions/criteria/tasks,
and spec.py:801-807 is the only place a sub-entry `approved` is refused; its
docstring (spec.py:780-784): "The interlock does not become droppable by
moving down a level." test_spec.py:1172-1189 pins it for tasks only. Ruling 1
says an assumption carries "four fields and no others" and rules nothing about
a fifth key or about `approved`; parse_response's top-level strictness
(spec.py:856-865) refuses whole. The measured cost of getting this wrong is on
the record: test_spec.py:1114-1126, one drafting run in four died over
`objective_note: ""`. Law 7 says the interlock only ever tightens.

**Proposed fix.** Define _ASSUMPTION_KEYS = {"id","decision","why","instead_of_asking"} and add
("assumptions", _ASSUMPTION_KEYS) to the sections tuple in the same slice that
adds the section: unknown key drops with a named note, `approved` at any level
still refuses whole, a missing required field drops the whole assumption with
a note rather than refusing the draft. Amend the docstring to name four
sections and parametrize
test_a_reply_carrying_approved_on_a_task_is_refused_whole over all four.

*Raised by lanes: pinned, parseorder, interlock.*

---

## C18 — MEDIUM · §3 ruling 13 ("appended … with its answer intact and a note saying it came from the previous draft") vs §5 non-goal 2

**Claim.** That note has nowhere legal to live. Every in-file home is frozen shut or
absent from the renderer, and the one remaining option rewrites the person's
own words — so the obvious build ships a spec that loads and fails its own
published schema, the exact defect ruling 6 forbids for `outcome`.

**Evidence.** spec.py:121 _QUESTION_KEYS = {"id","question","required","answer"}, applied at
spec.py:346; schema/spec.schema.json's open_questions items are
additionalProperties: false with exactly those four properties; §5 non-goal 2
freezes both by name. tests/test_schema.py:502-518 validates the rendered
wringer.spec.yaml against that schema, so a fifth key goes red. render()
(spec.py:1125-1131) emits exactly four lines per question with no comment
mechanism, and Question is a frozen dataclass with no field to carry one.
--redraft re-renders the whole file (cli.py:2797), so anything outside
render() is erased on the next redraft anyway.

**Proposed fix.** Say which channel carries it, and rule out the other two by name. Cheapest
lawful options: a Draft.notes entry printed to stderr by cmd_spec (the channel
R3 already uses at cli.py:2802-2803), or a `# carried over from the previous
draft (<id>)` comment emitted by render(), which needs a new optional field on
the in-memory Question. Not a fifth key (frozen, closed), and not appended
into question: text (that rewrites a question a person already answered — the
answer-eating this ruling exists to stop).

*Raised by lanes: frozen, interlock, byteedit, redraft, internal.*

---

## C19 — MEDIUM · §1 ruling 2's file header vs §3 ruling 12 (claim ceiling, law 8)

**Claim.** The sidecar's shipped header declares "NO AUTHORITY" and names the wrong set
of writers, while ruling 12 gives the same file the power to make wring plan
refuse. The false sentence is in the bytes every generated sidecar carries
and, by sibling convention, in the frozen schema description where it can
never be corrected. Ruling 12 also leaves the sidecar write's shape
unconstrained by B5, so a builder will reach for a YAML round-trip and reflow
a person's hand-authored file.

**Evidence.** SPEC_PMPLAN_V0.md:149-151 vs :501-506 ("wring plan recomputes it and refuses
when it differs"). Every sibling schema puts exactly this kind of ceiling
sentence in its description (see briefed.schema.json, and schema/README.md's
diagnosis / worker-diagnosis rows), and law 2 makes that description unfixable
after publication. On B5: ruling 10 applies the byte-equality doctrine to
"both edits" of wringer.spec.yaml only; ruling 12 says nothing, while ruling 2
makes the sidecar hand-writable and calls a consent-only hand-written sidecar
the normal case.

**Proposed fix.** Reword before freezing, to the narrow true claim: "NO AUTHORITY OVER WHAT IS
BUILT: no gate here runs, nothing under `.wringer/` is written from it, and no
builder is briefed from it. Its consent block can make `wring plan` REFUSE,
and refusing is the only thing it can do." Name all three writers (wring spec,
wringer-board approve, a person). Carry the same sentence into the schema
description and the README row. Extend B5 explicitly in ruling 12: the consent
write is a line edit — fill in place or append a block at the end — never a
re-serialisation.

*Raised by lanes: frozen, parseorder, interlock, internal, redraft.*

---

## The five findings refutation KILLED

Recorded because a killed finding is evidence too — two of these were killed for the best possible reason, that the defect had already been fixed in the spec between the lanes reading it and the skeptics re-reading it.

- **§1 ruling 4 (the guidance-marker detector), §0.2, §4 guard evidence, §6 DONE** — Run 2 is NOT a negative control. It buried FOUR decisions under a fourth
phrasing — `Decision to approve:` — that the ruled marker `decision taken`
misses entirely. The spec proposes to pin the detector's worst false negative
as its proof of correctness, and the same false claim is already committed to
docs/variance-2026-08-19.md §3.

- **§3 ruling 11 (the append into open_questions) and its named fallback** — The append has two anchor-less cases the spec never names and that are
knowable from render() and the frozen schema today — `open_questions: []`, and
the key absent entirely — so the "ship as OWED" fallback is triggered by
conditions foreseeable before the build rather than discovered in it, and the
named helper supplies the wrong indent.

- **§3 ruling 12 / §6 DONE — the claim ceiling on the fingerprint** — "Absence is not evidence of tampering" is the right rule and it means the
check is defeated by deleting one file, so the fingerprint detects an honest
hand edit and nothing adversarial. §6 DONE claims "the hand-edit fingerprint
lands" with no ceiling attached, which is more than the mechanism supports.

- **§3 ruling 10 ("every revision through a board verb flips approved: false") vs §3 ruling 12** — Nothing clears or refreshes the sidecar's consent block when revise runs, so
between a legitimate revision and the next approval the fingerprint is stale
and wring plan refuses with a tampering message about a spec whose own
interlock already says approved: false. Two refusals describe one state and
the more accusatory one has no ordering rule.

- **§1 ruling 5 ("Approving this plan approves them") vs §6 DONE's OWED escape on ruling 12** — The consent claim ships unconditionally while the mechanism that makes it true
may ship as OWED — nothing binds approved: true in the spec file to the
assumption text in the sidecar.
