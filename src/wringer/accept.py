"""Acceptance evidence — the bridge (docs/specs/SPEC_ACCEPT_V0.md).

**Every acceptance criterion carries the evidence that proves it — or is
marked as the human judgement it always was.** Wringer proves a change is
*mergeable*; this makes "gates pass" start to mean "the spec is satisfied",
and says honestly which criteria can never make that trip.

The whole feature is one join — `proves:` on a gate names the criterion it
evidences — plus one refusal to be talked out of: **green is not evidence.**
A criterion is `evidenced` only when its bound gate passed in THIS run and
the record shows that gate can fail. A worker that writes both the acceptance
gate and the code it must pass is the vacuity problem in a new hat, and a
gate born green has never demonstrated it can tell satisfied from
unsatisfied. The bench said it first (a benchmark of repair needs a red
baseline), health says it across time (a gate that cannot fail is not a
gate), and this says it at the moment the claim is made.

Two opt-in boundaries, both rulings and both tested as boundaries:

- **approval, not presence** (ruling 8). `wring spec` drafts criteria with
  `approved: false`. Triggering on the file existing would hand a model's
  draft delivery-blocking force before a person read it — the interlock
  SPEC_INTENT §3 owns, and the repair SPEC_PROVENANCE §2a already made once.
- **binding, not declaring** (ruling 9). Criteria default `required: true`
  and nothing is bound the moment a spec is approved, so refusing on unbound
  criteria would refuse the first delivery in every spec repo. An unbound
  criterion is loud — UNEVIDENCED, in capitals — and never fatal. Binding a
  gate is the act that says "hold me to this".

This module reads; it never scores. No model is asked anything here, and
`human: true` criteria are answered by people — nothing in this file can
give one a verdict.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from wringer import evidence as evidence_module
from wringer import spec as spec_module
from wringer.redact import Redactor

SCHEMA_VERSION = "wringer.acceptance.v1"
# **v2, written ONLY when the run carried a witness lane** (SPEC_GATEGEN_V0 §6
# W6, which named this cost before it was paid). A repository with no witness
# writes a byte-identical v1 and pays nothing, and the ABSENCE of a v2 record is
# the compatibility boundary — the `wringer.execution.v2` precedent, for the
# same reason.
#
# **Why a version and not an added key.** v1 says in its own field description
# that only a required and BOUND criterion can refuse, so `gate: null` implies
# `refuses: false` to every existing reader. A witness covers a criterion that
# no gate binds, so v2 has rows with `gate: null` and `refuses: true`. That is a
# meaning change in a field readers already act on, not a new field they can
# ignore, and `accept.py`'s own standing rule is that even an optional new key
# is a silent break.
SCHEMA_VERSION_V2 = "wringer.acceptance.v2"

# **v3 — SPEC_REFUSAL_V0 §2, OQ-3 and OQ-4.** Two new facts per row: WHICH of
# eight named causes put an unevidenced-or-human row where it is, and whether
# the record shows this row's check ever failing. Both are v3-only, absent (not
# null) from a v1 or v2 row — `tests/test_accept.py:650-653` pins exactly that,
# because a v1 row growing a key is a silent break for every existing reader.
SCHEMA_VERSION_V3 = "wringer.acceptance.v3"

# **THE SWITCH, FLIPPED 2026-08-17 — SPEC_REFUSAL §9's sequencing gate, as
# amended the same day by Fable ruling H-1.**
#
# It was False for three commits while v3's schema, its writers and its
# fixtures landed dark. `wringer-board` now names `wringer.acceptance.v3` in
# `KNOWN_ACCEPTANCE` and reads the `cause` field in preference to prose, having
# been taught from `schema/fixtures/acceptance-v3-*.json` — bytes THIS module
# produced. The gate is discharged and the engine emits.
#
# **This is also the moment the v3 schema truly freezes.** While nothing
# emitted it, no bundle anywhere was written against it and its shape could
# still be corrected; from this commit that is over, and a change to
# `acceptance-v3.schema.json` costs a v4.
#
# **The refusal policy flips WITH it, on this one constant.** They cannot be
# separated: a live policy over v2 bytes would falsify the frozen v1 schema's
# own description of what can refuse, and a dark policy under corrected prose
# would ship eight false sentences. The original note follows.
#
# ---
#
# **THE DARK SWITCH — SPEC_REFUSAL §9's sequencing gate, as amended
# 2026-08-17 by Fable ruling H-1.**
#
# The gate is on EMISSION, not on landing: v3's schema is frozen complete, its
# writers are built, and its tests and captures write REAL v3 bytes — while the
# public path this constant guards still writes v2. `wringer-board` refuses any
# version outside `KNOWN_ACCEPTANCE` and renders ZERO cards, by its own ruling
# 6 and correctly; so an engine that emitted v3 first would make the surface
# refuse to read the artifact it exists to render, caused by the half that gets
# to choose when to spend a version.
#
# **The board learns v3 from the bytes R2 and R3 actually wrote**, not from
# hand-built fixtures — a fixture written from the same guess as its reader is
# the failure mode that let eleven mutations through the board's absence guard.
# When the board reads v3, ONE commit sets this True and reverses
# `test_the_engine_does_not_emit_v3_until_the_board_reads_it`.
#
# It is not a feature flag and there is no config for it. Nothing a user can
# type reaches it, and it exists for exactly as long as the two repositories
# are out of step.
EMIT_V3 = True    # flipped 2026-08-17; see the paragraph above

# **The eight causes, ONE closed enum** (§6 ruling 12). Not two vocabularies:
# the drafted spec declared a closed five-value enum for `unevidenced` and then
# named three more for `human` rows with nowhere to live. If the human causes
# lived outside a public symbol the board could not render them, which would
# re-create in OQ-1 the exact defect OQ-4 exists to remove.
#
# The board tells these apart TODAY by matching free text against this module's
# wording, so a reworded message silently re-labels a card. After this, it does
# not have to.
CAUSE_UNBOUND = "unbound"
CAUSE_WITNESS_EVIDENCED_NOTHING = "witness-evidenced-nothing"
CAUSE_BORN_GREEN = "born-green"
CAUSE_PRE_EXISTENCE_UNESTABLISHED = "pre-existence-unestablished"
CAUSE_ARRIVED_WITH_THE_WORK = "arrived-with-the-work"
CAUSE_HUMAN_UNANSWERED = "human-unanswered"
CAUSE_HUMAN_SAID_NO = "human-said-no"
CAUSE_HUMAN_JUDGEMENT_STALE = "human-judgement-stale"

CAUSES = (
    CAUSE_UNBOUND,
    CAUSE_WITNESS_EVIDENCED_NOTHING,
    CAUSE_BORN_GREEN,
    CAUSE_PRE_EXISTENCE_UNESTABLISHED,
    CAUSE_ARRIVED_WITH_THE_WORK,
    CAUSE_HUMAN_UNANSWERED,
    CAUSE_HUMAN_SAID_NO,
    CAUSE_HUMAN_JUDGEMENT_STALE,
)

# Named in evidence.py with the bundle's other filenames and re-exported here:
# this module writes it, and that one is the one that has to be able to REMOVE
# it from a reused `--output` directory.
ACCEPTANCE_FILENAME = evidence_module.ACCEPTANCE_FILENAME
SPEC_FILENAME = spec_module.SPEC_FILENAME

# The states an artifact records. The author's SORT is three declarations
# (bound / human / unbound); these are what a RUN makes of them, which is why
# binding alone never earns the claim.
EVIDENCED = "evidenced"
UNEVIDENCED = "unevidenced"
GATE_FAILED = "gate-failed"
GATE_DID_NOT_RUN = "gate-did-not-run"
HUMAN = "human"

STATES = (EVIDENCED, UNEVIDENCED, GATE_FAILED, GATE_DID_NOT_RUN, HUMAN)

#: How each state reads in a sentence a merger has to understand. The keys
#: derive from `STATES`, so a state that arrives without a phrase here fails
#: `test_accept.py` rather than silently rendering its own machine word at a
#: reviewer. `human` is deliberately NOT "human-judged": a `human` row may be
#: unanswered, and `summary.md` is written at verify time when it usually is.
#:
#: **AMENDED 2026-08-28 — the machine words left the page.** A cold reviewer
#: read this line as `1 evidenced, 6 unevidenced, 1 for a person to judge`
#: and said: *"'Unevidenced' isn't a word I use. I'd infer it, but '6 of 8
#: requirements have no test proving them' would land faster."* They were
#: right, and the record's own state names were never meant to be a reader's
#: vocabulary — `state` is the machine's handle and this mapping is the
#: reader's, which is exactly why the mapping exists. So `evidenced` becomes
#: `proved` and `unevidenced` becomes `unproved`: ordinary words, and the
#: record's enum is untouched.
STATE_PHRASES = {
    EVIDENCED: "proved",
    UNEVIDENCED: "unproved",
    GATE_FAILED: "with a failing check",
    GATE_DID_NOT_RUN: "with a check that did not run",
    HUMAN: "for a person to judge",
}


# The two causes that mean NOTHING IS WATCHING. The other three unevidenced
# causes — born-green, arrived-with-the-work, pre-existence-unestablished —
# all have a bound check; what they lack is a recorded red.
NO_CHECK_AT_ALL = (CAUSE_UNBOUND, CAUSE_WITNESS_EVIDENCED_NOTHING)


def unevidenced_split(rows: Any) -> tuple[int, int]:
    """`(no check at all, a check that has never been red)`.

    **The two adjacent sentences said 6 + 4 = 10 of 8.** Eight criteria — one
    evidenced, three bound gates born green, three unbound, one human —
    rendered "⚠ 6 of these 8 requirements have no check proving them"
    immediately above "4 of 7 requirements carry a check that can prove
    them", in `summary.md`, in `mr.md` and on the certificate.

    Both numbers were right about their own question and the first one was
    asked wrongly: three of the five unevidenced causes DO have a bound
    check. The sentence sent a reader off to write a check that already
    exists, and `certificate.py` rules against exactly this wording while the
    per-row chips get it right ("ITS CHECK HAS NEVER FAILED").

    Reads `state` and `cause` off dicts or off `Row`s, because the surfaces
    that need it hold one or the other. A record with no `cause` at all — v1
    and v2 — falls back to whether the row names a gate, which is the only
    fact those versions carry.
    """
    def field(row: Any, name: str) -> Any:
        if isinstance(row, dict):
            return row.get(name)
        return getattr(row, name, None)

    unwatched = watched = 0
    for row in rows or ():
        if field(row, "state") != UNEVIDENCED:
            continue
        cause = field(row, "cause")
        gate = field(row, "gate") or field(row, "gate_id")
        if cause in NO_CHECK_AT_ALL or (cause is None and not gate):
            unwatched += 1
        else:
            watched += 1
    return unwatched, watched


def disclosure(counts: dict[str, int], rows: Any = None) -> list[str]:
    """The acceptance headline, for the surfaces that TRAVEL. Markdown lines.

    **Field report 2026-08-26, finding 3.** A run reached delivered with
    `evidenced: 1, unevidenced: 6, human: 1`. `board.html` said so six times
    and `acceptance.json` said so per criterion — and `mr.md` and the bundle's
    `summary.md`, the two files that go with the code to whoever merges it,
    said it zero times between them. Both were literally true: all gates
    passed. A reviewer saw three green ticks and the word `passed`, and the
    six criteria with nothing proving them stayed on the machine that ran it.

    That is Law 1's own failure — two surfaces describing one fact, drifting —
    so there is ONE renderer and both surfaces quote it verbatim. Landing this
    on the surface where the gap was NOTICED and leaving the other to catch up
    is the mistake of 2026-08-22, whose second reader quoted the false face
    four days later.

    Reads a record's `counts` and decides nothing: `assess` made these numbers
    and this puts them in a sentence. Empty for a repository with no
    acceptance record at all, which is every repository that never ran `wring
    spec` — the opt-in boundary, unchanged.

    The warning is CONDITIONAL on there being something to warn about. A
    caveat printed over a clean record is how a reader learns to skip caveats.
    """
    if not counts:
        return []
    total = sum(int(counts.get(state, 0)) for state in STATES)
    if not total:
        return []
    said = ", ".join(
        f"{counts[state]} {STATE_PHRASES[state]}"
        for state in STATES
        if counts.get(state)
    )
    lines = ["", f"**Requirements: {said}.**"]
    unevidenced = int(counts.get(UNEVIDENCED, 0))
    if unevidenced and rows is not None:
        unwatched, watched = unevidenced_split(rows)
        clauses = []
        if unwatched:
            clauses.append(
                f"{unwatched} of these {total} requirement"
                f"{'' if unwatched == 1 else 's'} "
                f"{'has' if unwatched == 1 else 'have'} no check at all"
            )
        if watched:
            clauses.append(
                f"{watched} {'has' if watched == 1 else 'have'} a check that "
                "has never been recorded failing, so passing it shows nothing"
            )
        if clauses:
            lines += [
                "",
                f"> ⚠ **{' — and '.join(clauses)}.** Every gate passing means "
                "the change is mergeable. It does not mean the thing that was "
                "asked for was built, and these are the difference.",
            ]
        return lines
    if unevidenced:
        # **The cold reviewer's own sentence, 2026-08-27.** This warning used
        # to read "N of these M criteria are UNEVIDENCED", and the reviewer
        # said the shape that would have landed was "6 of 8 requirements have
        # no test proving them". The fix is the sentence, not a glossary: a
        # reader who has to be taught a word before the warning works has
        # already been failed by the warning.
        lines += [
            "",
            f"> ⚠ **{unevidenced} of these {total} requirements "
            f"{'has' if unevidenced == 1 else 'have'} no check proving "
            f"{'it' if unevidenced == 1 else 'them'}: nothing in this run "
            f"shows {'it is' if unevidenced == 1 else 'they are'} met.** "
            "Every gate passing means the change is mergeable. It does not "
            "mean the thing that was asked for was built, and these are the "
            "difference.",
        ]
    return lines

# Receipt kinds. `witness` is v2's, and it is the only addition to this
# vocabulary — **the STATE vocabulary above is untouched**, which is the
# ruling: delivery consumes the witness through the existing taxonomy and no
# new verdict word exists anywhere.
FAILURE = "failure"
SENSITIVE = "sensitive"
WITNESS = "witness"

# What this artifact does NOT say, travelling with the numbers rather than
# living in a spec nobody opened. A test pins each by content.
LIMITS = (
    "Evidenced means the bound gate passed and has demonstrably failed "
    "before. It does not mean the criterion is what the user needed, that "
    "the gate covers the criterion's whole meaning, or that coverage cannot "
    "narrow later — `wring health` watches that across time.",
    "The gate-to-criterion binding is a human's declaration. Wringer checks "
    "the binding's consequences, never its wisdom.",
    "Human criteria are answered by people. Nothing here scored them.",
    "A sensitivity receipt says the gate's result differed between the two "
    "trees, not that the difference was the change. A gate whose own "
    "command arrived with the change reads sensitive for that reason alone "
    "— the citation beside it is how you tell.",
)

# What a v2 artifact does not say, on top of everything v1 does not say. This
# is `WRINGER_RULING_2026-08-15` Q1's ceiling, travelling with the numbers
# rather than living in a ruling nobody opened, and no artifact anywhere may
# exceed it.
LIMITS_V2 = LIMITS + (
    "A witness proves the stated criterion could fail and was made to pass. It "
    "does not certify agreement with an unstated intended fix, and where the "
    "criterion under-describes the intent the witness inherits that gap. "
    "Nothing here catches a change that satisfies the criterion and is still "
    "wrong.",
    "A witness evidences ONE criterion. A manufactured fail-to-pass check is "
    "necessary and demonstrably not sufficient — it raises the floor and does "
    "not make a delivery safe.",
    "The pin is tamper-EVIDENT, not tamper-proof: a worker on the host can "
    "read and rewrite what it finds there. It becomes a boundary only under "
    "run.containment.",
)

# **v3's limits.** Two additions, both about the two new fields, both stating
# what the field does NOT say — which is the only kind of limit worth
# publishing beside a new fact.
# Added to a record's `limits[]` only when that record carries a judgement.
# Not a standing limit of the format: a repository with no human criteria
# should not read a caveat about a mechanism it never used.
JUDGEMENT_LIMIT = (
    "A human judgement records that a PERSON said this was met at a moment, "
    "against the requirement as worded then. It is not re-checked by anything, "
    "and later work can invalidate it without this record changing. It is "
    "pinned to the WORDING of the criterion and to nothing else — not to a "
    "tree, a commit, a bundle or a build."
)

LIMITS_V3 = LIMITS_V2 + (
    "`demonstrated_able_to_fail` is about the RECORD, never about the world. "
    "`false` means nothing on disk shows this check failing — NOT that it "
    "cannot fail. `null` means there was no bound (gate, command) to ask "
    "about, which includes a criterion covered by a witness with no gate, and "
    "such a row can still be evidenced.",
    "`cause` names WHY a row is unevidenced or awaiting a person. It is the "
    "machine's handle on the fact the `reason` prose already states; it is "
    "not a diagnosis, not a remedy, and not a claim that the cause is the "
    "only one that applies.",
)

_REMEDY = (
    "run `wring verify --prove` to record whether it can fail, or install "
    "the gate first and watch it go red"
)


@dataclass(frozen=True)
class Receipt:
    """Where the record shows this gate can fail."""

    kind: str            # failure | sensitive
    bundle: str          # repo-relative path to the bundle holding it
    cites: str | None = None
    # Only on a sensitive receipt, and only when the run that produced it
    # declared no `run.prove_setup`. RULED 2026-08-11 as disclosure rather
    # than refusal: a prove worktree carries tracked files only, so in a repo
    # whose dependencies are gitignored EVERY pre-change gate fails for the
    # wrong reason and every criterion collects a receipt that means nothing
    # (SPEC_VACUITY_V0 §5a). But refusing on an absent `prove_setup` would
    # have refused the first real measurement this program ever took, whose
    # gates are stdlib and need no setup and whose receipts were true. So the
    # artifact says what it did not check, and `cites` — already carried — is
    # the tell that separates the two cases.
    #
    # **It rides in `reason`, not in a key of its own.** `acceptance.json` is
    # frozen (law 7, `schema/frozen.json`), and a new key — even an optional
    # advisory one — is a silent break for every reader of a bundle already on
    # disk and costs a `wringer.acceptance.v2`. `reason` is free text in the
    # same row, which is where the ruling asked for it: beside the receipt. If
    # a machine-readable form is ever wanted, THAT is the version bump
    # conversation, and it should not be had for a sentence.
    environment: str | None = None

    def as_json(self) -> dict[str, Any]:
        recorded: dict[str, Any] = {"kind": self.kind, "bundle": self.bundle}
        # Present only for a sensitivity receipt, and load-bearing there:
        # limit 4 is why a reader needs the line the verdict rests on.
        if self.cites:
            recorded["cites"] = self.cites
        return recorded


@dataclass(frozen=True)
class WitnessEvidence:
    """Wringer's own manufactured evidence for one criterion, as v2 records it.

    Carried on the row **independently of the receipt**, because the case a
    reader most needs to see is the one where they disagree: a green gate
    beside a witness that still fails. That is the corpus's headline finding —
    26 of 26 delivered yes on gates that carried zero information — and a
    format that could not show it would be certifying the same thing again.
    """

    pinned_sha256: str
    proved_red: str          # assertion | collection_error | green
    result: str              # passed | failed | not_run
    discarded: str | None = None
    # Where the witness record lives, so a receipt can send a reader to it.
    # Deliberately absent from `as_json`: this belongs on the RECEIPT, which is
    # the field whose whole job is "go and look here", and duplicating it into
    # the witness object would be two copies of one fact to keep in step.
    bundle: str = ""

    @property
    def covers(self) -> bool:
        """Whether this witness may decide anything about its criterion.

        Only a witness proved red FOR THE RIGHT REASON covers one. A discarded
        witness leaves the criterion uncovered, which routes to a human — an
        honest outcome, and deliberately not a failure.
        """
        return self.discarded is None and self.proved_red == "assertion"

    def as_json(self) -> dict[str, Any]:
        return {
            "pinned_sha256": self.pinned_sha256,
            "proved_red": self.proved_red,
            "result": self.result,
            "discarded": self.discarded,
        }


@dataclass(frozen=True)
class Judgement:
    """A person's answer to a `human` criterion — SPEC_REFUSAL §3 ruling 2.

    **Written by a person, copied verbatim, never scored.** Nothing in Wringer
    produces one and no model is asked anything: this module reads.

    `stale` is COMPUTED at acceptance time by comparing the current criterion
    wording's digest against the judgement's `criterion_digest`, and is never
    trusted from the file — a stale flag a person can write is a stale flag a
    person can forget. That is the pin: reword the question and the answer
    stops applying, because somebody answered a different question.

    **Never at READ time.** `refuses` is serialised into `acceptance.json` by
    `Row.as_json` and delivery reads the STORED boolean out of the file, never
    recomputing it — so a read-time `stale` could not reach the `refuses` value
    baked into the record, and a reworded criterion would not refuse the
    delivery. `stale` is written into the row and `refuses` is derived from it
    in the same pass, so the record and every reader agree by construction.

    **`by` is recorded and never verified**, and that sentence is in the schema
    too so nothing downstream reads it as an identity claim. `wring attest
    --sign` is where identity lives; this is not that.
    """

    verdict: str              # met | not_met — two values, closed
    by: str                   # recorded, NEVER verified
    at: str
    stale: bool
    note: str | None = None

    def as_json(self) -> dict[str, Any]:
        payload = {
            "verdict": self.verdict,
            "by": self.by,
            "at": self.at,
            "stale": self.stale,
        }
        if self.note is not None:
            payload["note"] = self.note
        return payload


@dataclass(frozen=True)
class Row:
    """One criterion, and what this run can honestly say about it."""

    criterion: str
    title: str
    required: bool
    state: str
    gate_id: str | None = None
    command: str | None = None
    receipt: Receipt | None = None
    reason: str = ""
    witness: WitnessEvidence | None = None
    # **v3 only.** Which of `CAUSES` put this row where it is, or None for a
    # row that needs no cause (an evidenced row, a gate-failed row). The
    # machine's handle on the fact `reason` states in prose — ruling 13 keeps
    # the prose unchanged BESIDE the name, never regenerated from it, because
    # the prose carries the remedy and is what a human reads.
    cause: str | None = None
    # **v3 only, three-valued, because two values would have to lie**
    # (ruling 10):
    #   True  — this row's (gate, command) pair appears in the record having
    #           genuinely failed;
    #   False — it does not. NOT "cannot fail": only that nothing on disk shows
    #           it doing so;
    #   None  — there is no bound (gate, command) to ask about. Unbound,
    #           `human`, or covered by a witness with no gate — which CAN be
    #           evidenced. *Not asked* and *asked, answer no* are different
    #           facts, and this module already makes the identical distinction
    #           about `created`.
    #
    # The name carries its own ceiling: *demonstrated*, about the record. A
    # field called `can_fail` would be a claim about the world.
    demonstrated_able_to_fail: bool | None = None
    # **v3 only, and R2 always leaves it None.** The field exists from v3's
    # first publication because publishing the schema FREEZES it, and R3 could
    # not add a key afterwards without spending a v4 — SPEC_REFUSAL §9, "R2
    # authors the schema COMPLETE". R3 builds the loader, the digest pin and
    # the staleness computation that fill it. A row that is not `human` keeps
    # it None for ever.
    judgement: Judgement | None = None

    @property
    def covered(self) -> bool:
        """Whether anything in this run is answerable for the criterion.

        A gate binding it, or a witness that covers it. **This is the v1-to-v2
        change**: in v1 the only possible answer was a gate.
        """
        return self.gate_id is not None or (
            self.witness is not None and self.witness.covers
        )

    @property
    def refuses(self) -> bool:
        """Whether this row stops delivery (ruling 9).

        **AMENDED 2026-08-17 (OQ-1), and this was the EIGHTH sentence —
        the one neither the independent review nor the author's own self-check
        found.** It read: *"Only a COVERED criterion can refuse, and only when
        it is required."* True of v1 and v2, and false in v3, where a required
        `human` criterion refuses with no gate and no witness. The review named
        seven; the folding window found this one by reading the code the
        seven described.

        Two rules now, and which applies is the row's own kind:

        - A **non-human** row refuses when it is required, COVERED and not
          `evidenced`. Unchanged. An uncovered one is a debt the author has not
          paid yet — loud, never fatal — because every spec starts with all its
          criteria required and nothing covering them, and refusing there would
          refuse the first delivery in every repo that ever ran `wring spec`.
        - A **`human`** row refuses when it is required and carries a cause:
          nobody answered, a person said no, or the wording moved under the
          answer. Coverage is not the question, because no check covers it and
          none ever will — that is what `human: true` means. Treating "nobody
          has looked" as "fine" was the quiet exemption OQ-1 removes.

        **v2 widens "covered" from "bound" to "bound or witnessed", and that is
        the whole reason the version moved.** A criterion no gate binds can now
        stop a delivery, on exactly the same terms — required, covered, not
        evidenced. A v1 reader meeting such a row would read `gate: null` and
        conclude it cannot refuse, which is why this could not be an added key.
        """
        if EMIT_V3 and self.state == HUMAN:
            # **OQ-1's policy reversal — SPEC_REFUSAL §3 ruling 1, DARK until
            # the flip.** A required `human` criterion that nobody has
            # answered, that a person answered NO to, or whose wording has
            # moved under the answer, stops the delivery. Until then a `human`
            # row is never `covered` and never refuses, exactly as v1 and v2
            # describe themselves — which is why this is gated on the same
            # switch as emission rather than on a second one. A live policy
            # over v2 bytes would falsify the frozen v1 schema's own
            # description of what can refuse.
            #
            # `met` and not stale is the ONLY answer that clears it. Absence is
            # not an answer.
            return self.required and self.cause is not None
        return self.required and self.covered and self.state != EVIDENCED

    def as_json(self) -> dict[str, Any]:
        return {
            "criterion": self.criterion,
            "title": self.title,
            "required": self.required,
            "state": self.state,
            "gate": self.gate_id,
            "command": self.command,
            "receipt": self.receipt.as_json() if self.receipt else None,
            "reason": self.reason,
            "refuses": self.refuses,
            "witness": self.witness.as_json() if self.witness else None,
        }

    def as_json_v3(self) -> dict[str, Any]:
        """The v3 row: v2's keys plus the two new facts.

        Built by ADDING to `as_json` rather than by a second literal, so a key
        can never exist in one shape and not the other — v1's own row is
        already derived from this one by removing `witness`.
        """
        return {
            **self.as_json(),
            "cause": self.cause,
            "demonstrated_able_to_fail": self.demonstrated_able_to_fail,
            "judgement": self.judgement.as_json() if self.judgement else None,
        }


@dataclass(frozen=True)
class Result:
    rows: tuple[Row, ...] = field(default_factory=tuple)

    @property
    def refusing(self) -> tuple[Row, ...]:
        return tuple(row for row in self.rows if row.refuses)

    @property
    def has_witness(self) -> bool:
        """Whether this run carried a witness lane at all.

        **The version selector, and the compatibility boundary.** A repository
        with no witness writes a byte-identical v1 and pays nothing; the
        absence of a v2 record is what tells a v1 reader it may proceed. The
        `wringer.execution.v2` precedent, for the same reason.
        """
        return any(row.witness is not None for row in self.rows)

    def counts(self) -> dict[str, int]:
        """One key per state, always all of them.

        Every state is present even at zero: these are counts OVER a known
        population, not measurements that might be absent. The absent-is-not-
        zero law bites on receipts and on drift, where "we did not look" and
        "we looked and found none" are different — here the criteria are
        enumerated, so a zero is a real zero.
        """
        tally = {state: 0 for state in STATES}
        for row in self.rows:
            tally[row.state] += 1
        return tally

    @property
    def has_v3_facts(self) -> bool:
        """Whether any row carries something only v3 can express.

        **The narrowed selector** (§2, the review's finding 1). The drafted
        version fired on "a value a v2 row could not have carried", which every
        value of a brand-new field satisfies — so v1 and v2 would never have
        been emitted again while §2 still promised they would. This fires only
        on a non-null `cause`, a non-null `demonstrated_able_to_fail`, or a
        judgement.

        **What the narrow selector buys is not that readers rarely meet v3.**
        Through `assess`, most real records will select it: most repositories
        have at least one unevidenced row or one bound gate with a
        discriminating receipt. It buys that no reader ever meets a v3 record
        carrying no new fact, and that the two pinned selector tests stay green
        unmodified — both construct `Row`s with neither field set.
        """
        # **`or a judgement` was in this docstring and not in this code**
        # until 2026-09-01, found by executing the 0.6.1 pen tests: a record
        # whose ONLY v3 fact was an answered-`met` human judgement (cause
        # None on every row) emitted v1 — and a v1 row has no `judgement`
        # key, so the person's answer was silently dropped from the record
        # the certificate and board read. The `has_judgement` property below
        # existed, unused, the whole time.
        return any(
            row.cause is not None
            or row.demonstrated_able_to_fail is not None
            or row.judgement is not None
            for row in self.rows
        )

    def as_json(self) -> dict[str, Any]:
        """The artifact, at v1 unless this run carried a witness.

        **The version moves with the CONTENT, not with the code version.** A
        repository that never opted into the witness lane keeps writing exactly
        the bytes it wrote before this feature existed — which is the whole
        compatibility promise, and the reason the row's `witness` key is
        absent rather than null there.

        **v3 is gated on `EMIT_V3`, which is False until the board reads it.**
        See that constant: the gate is on emission, and the board learns the
        version from the real bytes this method produces under test before the
        public path ever writes one.
        """
        if EMIT_V3 and self.has_v3_facts:
            return self.as_json_v3()
        if not self.has_witness:
            return {
                "schema_version": SCHEMA_VERSION,
                "counts": self.counts(),
                "criteria": [
                    {
                        key: value
                        for key, value in row.as_json().items()
                        if key != "witness"
                    }
                    for row in self.rows
                ],
                "limits": list(LIMITS),
            }
        return {
            "schema_version": SCHEMA_VERSION_V2,
            "counts": self.counts(),
            "criteria": [row.as_json() for row in self.rows],
            "limits": list(LIMITS_V2),
        }

    @property
    def has_judgement(self) -> bool:
        return any(row.judgement is not None for row in self.rows)

    def as_json_v3(self) -> dict[str, Any]:
        """The v3 artifact. **Reachable today only through tests and captures.**

        This is the method the board is taught from: R2's and R3's fixtures
        call it directly and commit the bytes, so `wringer-board` learns v3
        from what the engine really writes rather than from a fixture written
        by whoever also wrote the reader. When `EMIT_V3` flips, `as_json`
        starts returning this and nothing here changes.
        """
        return {
            "schema_version": SCHEMA_VERSION_V3,
            "counts": self.counts(),
            "criteria": [row.as_json_v3() for row in self.rows],
            # **The judgement limit rides the RECORD, in the engine's own
            # voice, and only when a judgement is actually present** — ruling
            # 3. `limits[]` already renders verbatim on the board, so this
            # reaches a PM without a translation anybody has to maintain, and
            # it says the weak part out loud rather than hiding it.
            "limits": list(LIMITS_V3) + (
                [JUDGEMENT_LIMIT] if self.has_judgement else []
            ),
        }


def read_spec(root: Path) -> spec_module.Spec | None:
    """The APPROVED spec, or None (ruling 8).

    Total by construction: an unreadable or unparseable spec is treated as
    one that is not there. This runs inside `wring verify`, and a malformed
    spec file must not take down a verification — the spec commands are where
    that error belongs, and they report it properly.
    """
    path = root / SPEC_FILENAME
    if not path.is_file():
        return None
    try:
        loaded = spec_module.load(path)
    except Exception:
        return None
    return loaded if loaded.approved else None


def created_stems(state: Any) -> frozenset[str] | None:
    """The names this change brought into existence, or None if unknowable.

    Sourced from git's own untracked list — files it has never seen — so
    nothing here parses a command or reads a failure message. Both were
    considered and refused: classifying failure prose is what SPEC_VACUITY §4b
    forbids, and parsing a shell command for filenames is that same
    classification wearing a structural costume.

    **Stems, not filenames**, and the reason is measured rather than
    theoretical: the gate that exposed this ran
    `python3 -m unittest test_csv_export.CsvExportTest.test_columns...`, which
    names the MODULE. `test_csv_export.py` does not appear in it and a
    filename match would have found nothing. The stem does.

    The cost is stated rather than hidden: a change that creates `utils.py` in
    a repo whose gate command happens to contain the word `utils` will refuse
    a receipt it need not have. That direction is chosen. Ruled 2026-08-11 —
    un-establishable is unevidenced, never a pass — which is the vacuity
    precedent applied to this artifact itself.
    """
    untracked = getattr(state, "untracked", None)
    if untracked is None:
        return None
    return frozenset(
        Path(path).stem for path in untracked if Path(path).stem
    )


def _arrived_with_the_change(command: str | None, created: Any) -> str | None:
    """The name this gate exercises that did not exist before, or None.

    None means "nothing found", which is only an answer when `created` is a
    real set. A None `created` means the question could not be asked, and the
    caller treats that as unevidenced rather than as a pass.
    """
    if not command or not created:
        return None
    for stem in sorted(created):
        if re.search(rf"\b{re.escape(stem)}\b", command):
            return stem
    return None


JUDGEMENTS_FILENAME = "wringer.judgements.yaml"
JUDGEMENT_SCHEMA_VERSION = "wringer.judgement.v1"
# Every version this reader accepts — the `loop.SCHEMA_VERSIONS` rule: a
# naive bump orphans every file already on disk. v2 (0.6.1) adds only
# OPTIONAL per-entry facts (the bound display, the judged-without-display
# acknowledgement), so a v2 entry reads exactly as a v1 entry does here and
# the extra keys ride along verbatim for the record writer.
JUDGEMENT_SCHEMA_VERSIONS = ("wringer.judgement.v2", JUDGEMENT_SCHEMA_VERSION)


def criterion_digest(criterion) -> str:
    """sha256 of the criterion this answers — ruling 3, preimage written out.

    Over the **PARSED** object, not raw bytes, and the three consequences are
    stated rather than hidden behind the word "canonicalised":

    - An absent `guidance` and an empty one are already the same value in the
      parsed object, so that ambiguity is closed before the digest sees it. It
      also means a whitespace- or comment-only edit to `wringer.spec.yaml` does
      not stale every judgement in the repository.
    - **`required` and `human` are deliberately EXCLUDED.** Changing either
      changes the policy, not the question. A criterion that stops being
      required has not been reworded.
    - The `briefed.json` precedent is cited for its DISCIPLINE — *nothing may
      move under an answer* — not its mechanism. `staleness.capture` hashes
      whole file bytes and there is no field-level canonical form anywhere else
      in this package.
    """
    import hashlib

    preimage = json.dumps(
        {
            "id": criterion.id,
            "title": criterion.title,
            "guidance": getattr(criterion, "guidance", "") or "",
        },
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(preimage.encode("utf-8")).hexdigest()


def _iso(value: Any) -> str:
    """A timestamp as the person wrote it, even after YAML parsed it."""
    isoformat = getattr(value, "isoformat", None)
    return isoformat() if callable(isoformat) else str(value)


def read_judgement_file(root: Path) -> tuple[str, list[dict[str, Any]]]:
    """The judgements file's declared version and its entries, VERBATIM.

    The one raw reader, so `read_judgements` (the assess view) and
    `write_judgement_record` (the run-bundle capture, 0.6.1) cannot disagree
    about what the file said. An unreadable, unparseable or wrong-shaped
    file is `("", [])` — the same rule `read_spec` follows, and for the same
    reason: this runs inside `wring verify`, and a malformed sibling must
    not take down a verification.
    """
    path = root / JUDGEMENTS_FILENAME
    if not path.is_file():
        return "", []
    try:
        import yaml

        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception:
        return "", []
    if not isinstance(raw, dict):
        return "", []
    version = raw.get("schema_version")
    if version not in JUDGEMENT_SCHEMA_VERSIONS:
        return "", []
    entries = raw.get("judgements")
    if not isinstance(entries, list):
        return "", []
    return str(version), [e for e in entries if isinstance(e, dict)]


def judgements_by_criterion(
    entries: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """The assess view: usable entries keyed by criterion id.

    **Absence is never read as `met`.** A criterion with no entry is
    UNANSWERED, which is a state and not a judgement.
    """
    found: dict[str, dict[str, Any]] = {}
    for entry in entries:
        name = entry.get("criterion")
        if not isinstance(name, str) or not name:
            continue
        if entry.get("verdict") not in ("met", "not_met"):
            continue
        found[name] = entry
    return found


def read_judgements(root: Path) -> dict[str, dict[str, Any]]:
    """Every answer a PERSON wrote, by criterion id. Total by construction."""
    _version, entries = read_judgement_file(root)
    return judgements_by_criterion(entries)


# The run-bundle capture of the judgements file (0.6.1, run 3 F12) — a
# SIBLING, the `coverage.json` precedent exactly: the acceptance row's
# `judgement` object is frozen and closed (verdict, by, at, stale, note),
# so the display facts `wringer.judgement.v2` binds to a judgement cannot
# ride it, and law 7 says a new fact arrives as a new file. The certificate
# and the board read THIS to render the judged-without-display fact
# wherever the note renders; the acceptance row stays the one authority
# for verdict and staleness.
JUDGEMENT_RECORD_FILENAME = "judgements.json"
JUDGEMENT_RECORD_SCHEMA_VERSION = "wringer.judgementrecord.v1"


def write_judgement_record(
    directory: Path,
    source_version: str,
    entries: list[dict[str, Any]],
    redactor: Redactor | None = None,
) -> Path | None:
    """Capture what `wringer.judgements.yaml` said when this run assessed.

    ABSENT — not empty — when the repository holds no judgements, the
    sibling rule every other optional file follows. Entries travel VERBATIM:
    this is a capture of one file at one moment, never a second assessor.
    """
    if not entries:
        return None
    import json as json_module

    scrub = (redactor or Redactor()).scrub
    path = directory / JUDGEMENT_RECORD_FILENAME
    payload = {
        "schema_version": JUDGEMENT_RECORD_SCHEMA_VERSION,
        "source_schema_version": source_version,
        "entries": entries,
    }
    path.write_text(
        scrub(json_module.dumps(payload, indent=2, ensure_ascii=False)) + "\n",
        encoding="utf-8",
    )
    return path


def read_judgement_record(run_dir: Path) -> dict[str, Any] | None:
    """The capture back, or None — absent is absent, wrong version is None."""
    path = run_dir / JUDGEMENT_RECORD_FILENAME
    if not path.is_file():
        return None
    try:
        import json as json_module

        raw = json_module.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(raw, dict):
        return None
    if raw.get("schema_version") != JUDGEMENT_RECORD_SCHEMA_VERSION:
        return None
    if not isinstance(raw.get("entries"), list):
        return None
    return raw


def assess(
    root: Path,
    cfg: Any,
    results: Any,
    *,
    state: Any = None,
    redactor: Redactor | None = None,
    witnesses: Any = None,
    judgements: Any = None,
) -> Result | None:
    """What this run can say about each criterion. None when not opted in.

    `results` is the run's own gate results — the gates that actually ran and
    finished. A criterion whose gate is absent from them did not run, and
    absence is absence: never a pass-through to an older green.

    `witnesses` is the witness lane's answer for the same criteria, as
    `WitnessEvidence` keyed by criterion id. **It is consumed through the
    EXISTING taxonomy and adds no verdict vocabulary** — that is the ruling,
    and it is why this is an argument rather than a second artifact: a
    criterion evidenced by a witness is `evidenced`, one whose witness still
    fails is `gate-failed`, and one covered by neither is `unevidenced` and
    goes to a human. Three states this module already had.
    """
    approved = read_spec(root)
    if approved is None:
        return None

    scrub = (redactor or Redactor()).scrub
    bound: dict[str, Any] = {
        gate.proves: gate for gate in cfg.gates if getattr(gate, "proves", None)
    }
    ran = {result.gate.id: result for result in results}

    # Read the record ONCE for the whole artifact rather than per criterion:
    # the same bundles answer every question here, and re-walking them per row
    # would make the cost quadratic in criteria for no new information.
    discriminating = _discriminating_pairs(root)
    # None when the caller had no git state to offer — and None is NOT an
    # empty set here. "Nothing was created" and "we could not ask" are
    # different claims, and only the first may earn a receipt.
    created = created_stems(state)

    by_criterion = dict(witnesses or {})
    # What a PERSON wrote. Read once, like the record above — and handed in
    # by `verify.run` since 0.6.1 so the run-bundle capture and these rows
    # describe ONE read of the file, never two.
    if judgements is None:
        judgements = read_judgements(root)

    rows = []
    for criterion in approved.criteria:
        rows.append(
            _assess_one(
                criterion, bound, ran, discriminating, created, scrub,
                by_criterion.get(criterion.id),
                judgements=judgements,
            )
        )
    return Result(rows=tuple(rows))


def _assess_one(
    criterion, bound, ran, discriminating, created, scrub, witness=None,
    judgements=None,
) -> Row:
    """One criterion's verdict, gate and witness together.

    **The ordering is the whole design and it is not arbitrary:**

    1. A FAILING gate wins over everything. The criterion is not met, and that
       is the ordinary honest state of work in progress.
    2. Otherwise a covering WITNESS decides — including over a PASSING gate.
       This is the point of the lane. The corpus measured the declared gates
       returning green on all 13 tasks including every wrong change, so a
       design in which a green gate could overrule a red witness would
       reproduce exactly the result that disproved this programme's operating
       assumption.
    3. Otherwise the gate decides, exactly as it did in v1.

    A DISCARDED witness decides nothing in either direction: it leaves the
    criterion as the gate found it, or uncovered if no gate binds it.
    """
    common = {
        "criterion": criterion.id,
        "title": criterion.title,
        "required": criterion.required,
    }

    if criterion.human:
        return _human_row(common, criterion, judgements)

    gate = bound.get(criterion.id)
    if gate is None:
        # **v2's new branch.** No gate binds this criterion, and in v1 that was
        # the end of it. A witness can now cover it — which is the entire
        # reason the lane exists, because the criteria this programme targets
        # are exactly the ones the repository has no check for.
        if witness is not None and witness.covers:
            return _witness_verdict(common, witness, gate=None)
        # **The partition at this site HOLDS, and R2 settled it by reading
        # the construction path rather than assuming** (ruling 12's "one thing
        # R2 settles"). `WitnessEvidence` is built in exactly two places, both
        # `verify.py:792` and `:808`. The first always sets a non-empty
        # `discarded` (`item.discarded or "the witness was never pinned"`); the
        # second is reached only when `item.usable`, and `witness.usable`
        # REQUIRES `proved_red.outcome == ASSERTION` with `discarded is None`
        # (`witness.py:416-425`), which is exactly `covers`. So a witness
        # arriving here with `covers == False` always has a discard reason, and
        # there is no third case needing a name of its own.
        return Row(
            **common,
            state=UNEVIDENCED,
            witness=witness,
            cause=(
                CAUSE_WITNESS_EVIDENCED_NOTHING
                if witness is not None and witness.discarded
                else CAUSE_UNBOUND
            ),
            reason=(
                "no gate proves this criterion"
                + (
                    f", and its witness evidences nothing ({witness.discarded})"
                    " — a human decides"
                    if witness is not None and witness.discarded
                    else f" — add `proves: {criterion.id}` to the gate that "
                    "evidences it"
                )
            ),
        )

    command = scrub(gate.run)
    detail = {**common, "gate_id": gate.id, "command": command}

    result = ran.get(gate.id)
    if result is None:
        return Row(
            **detail,
            state=GATE_DID_NOT_RUN,
            witness=witness,
            reason=(
                f"`{gate.id}` left no result in this run, so this run says "
                "nothing about the criterion"
            ),
        )
    if not result.passed:
        return Row(
            **detail,
            state=GATE_FAILED,
            witness=witness,
            reason=f"`{gate.id}` failed, so the criterion is not met",
        )

    # **Rule 2: the gate passed, so now the witness decides if it covers.**
    # A witness that is red on the changed tree means the criterion is not
    # satisfied, whatever the declared gates said — and the declared gates
    # saying yes anyway is the measured baseline this lane exists to break.
    if witness is not None and witness.covers:
        return _witness_verdict(
            detail, witness, gate=gate, discriminating=discriminating
        )

    receipt = discriminating.get((gate.id, command))
    if receipt is None:
        return Row(
            **detail,
            state=UNEVIDENCED,
            witness=witness,
            cause=CAUSE_BORN_GREEN,
            demonstrated_able_to_fail=False,
            reason=(
                f"`{gate.id}` passed, but nothing in the record shows it can "
                f"fail — a gate born green evidences nothing. {_REMEDY}"
            ),
        )

    # RULED 2026-08-11: the gate must PRE-DATE the change it judges.
    #
    # A sensitivity receipt says the gate failed before and passes now. That
    # is the same sentence whether the feature was missing or the TEST was —
    # and measured on the first real end-to-end run, it was the test: the
    # drafter bound criteria to a file that did not exist, the agent wrote
    # that file along with the code it checks, and four criteria came back
    # `evidenced` on the strength of an import error. The harness certified
    # work whose acceptance tests its own worker had written.
    #
    # E1a is NOT reversed by this. The pre-change comparison remains the
    # mechanism by which a one-shot agent evidences anything; this adds the
    # one precondition the born-red story always implied.
    if receipt.kind == "sensitive":
        if created is None:
            return Row(
                **detail,
                state=UNEVIDENCED,
                cause=CAUSE_PRE_EXISTENCE_UNESTABLISHED,
                demonstrated_able_to_fail=True,
                reason=(
                    f"`{gate.id}` passed and the record shows it can fail, but "
                    "this run could not establish that the gate existed before "
                    "the change — and a receipt that cannot be established is "
                    "not a receipt"
                ),
            )
        arrived = _arrived_with_the_change(command, created)
        if arrived is not None:
            return Row(
                **detail,
                state=UNEVIDENCED,
                cause=CAUSE_ARRIVED_WITH_THE_WORK,
                # TRUE, and the distinction is the whole point of ruling 13's
                # "rendering the fourth cause as the second is false and
                # BACKWARDS": the record DOES show this gate can fail. The
                # objection is that the gate is new.
                demonstrated_able_to_fail=True,
                reason=(
                    f"`{gate.id}` exercises `{arrived}`, which this change "
                    "CREATED — so it failed beforehand only because it did not "
                    "exist yet. A gate that arrived with the work cannot "
                    "evidence the work. Commit the check first and let it go "
                    "red on its own"
                ),
            )
    return Row(
        **detail,
        state=EVIDENCED,
        receipt=receipt,
        witness=witness,
        # No cause: an evidenced row is not anywhere it needs explaining from.
        demonstrated_able_to_fail=True,
        reason=(
            f"`{gate.id}` passed, and the record shows it can fail"
            + (f". {receipt.environment}" if receipt.environment else "")
        ),
    )


def _human_row(common: dict, criterion, judgements) -> Row:
    """A `human` criterion, and what a person has (or has not) said about it.

    **Its `state` stays `human` in every branch, including `met`.** It never
    becomes `evidenced`, and that is not a technicality: `evidenced` means a
    bound check passed now and the record shows the same check recorded
    failing. A person saying yes is a different kind of fact with no receipt,
    and rendering it under the same word would put a human judgement inside the
    sentence "every green was red first" — which would be false, and is exactly
    the overclaim `docs/specs/SPEC_BOARD_V0.md`'s B3 exists to prevent. The five-value
    `state` enum is UNCHANGED in v3.

    **The refusal is DARK until `EMIT_V3`.** `refuses` is a policy, the policy
    is OQ-1's reversal, and it flips in the same commit as emission — see
    `EMIT_V3`. A live policy over v2 bytes would falsify the frozen v1 schema's
    own description of what can refuse; a dark policy under corrected prose
    would ship eight false sentences. One switch, both.
    """
    entry = (judgements or {}).get(criterion.id)
    if entry is None:
        return Row(
            **common,
            state=HUMAN,
            cause=CAUSE_HUMAN_UNANSWERED,
            # Ruling 5's scoped exception to ruling 13: under a refusal
            # heading, "answered by people, not gates" is a non-sequitur. The
            # reason names the file to edit, because a remedy that cannot clear
            # the refusal it prints under is worse than saying only "no".
            reason=(
                "nobody has answered this — a person decides it, and records "
                f"the decision in `{JUDGEMENTS_FILENAME}`"
            ),
        )

    stale = entry.get("criterion_digest") != criterion_digest(criterion)
    verdict = entry["verdict"]
    judgement = Judgement(
        verdict=verdict,
        by=str(entry.get("by", "")),
        # `str()` on a value YAML already parsed into a `datetime` gives
        # `2026-08-17 11:00:00+00:00` — a space where the person typed a `T`,
        # so the record would not carry back what was written. YAML resolves
        # unquoted ISO-8601 timestamps eagerly, which most people writing this
        # file by hand will do, so the safe-guard belongs here rather than in
        # advice nobody reads.
        at=_iso(entry.get("at", "")),
        stale=stale,
        note=entry.get("note"),
    )
    if stale:
        cause = CAUSE_HUMAN_JUDGEMENT_STALE
        reason = (
            "this requirement has been REWORDED since it was answered, so the "
            f"answer was given to a different question. Re-answer it in "
            f"`{JUDGEMENTS_FILENAME}`"
        )
    elif verdict == "not_met":
        cause = CAUSE_HUMAN_SAID_NO
        reason = (
            "a person judged this NOT met"
            + (f" ({judgement.by})" if judgement.by else "")
            + ". The work is not done; nothing here can overrule that"
        )
    else:
        cause = None
        reason = (
            "a person judged this met"
            + (f" ({judgement.by})" if judgement.by else "")
            + ", against the requirement as worded then"
        )
    return Row(
        **common,
        state=HUMAN,
        cause=cause,
        judgement=judgement,
        reason=reason,
    )


def _witness_verdict(fields: dict, witness, gate, discriminating=None) -> Row:
    """What a COVERING witness says, in the existing vocabulary.

    Red on the changed tree is `gate-failed` — the criterion is not met. Green
    is `evidenced`, with a receipt whose kind names where the evidence came
    from, so a reader is never left guessing whether a green came from the
    repository's own check or from one Wringer manufactured.

    **`demonstrated_able_to_fail` is None when there is no gate**, and it is
    the third null case ruling 10 spells out: a witness-covered row with no
    bound `(gate, command)` has nothing to ask the record about, AND it can
    still be `evidenced`. A reader who inferred "null implies not evidenced"
    would be wrong on exactly the rows this lane produces. The field is about
    the RECORD's gate history and says nothing about a witness-sourced green.
    """
    where = f"`{gate.id}` passed, but " if gate is not None else ""
    demonstrated = None
    if gate is not None and discriminating is not None:
        demonstrated = (gate.id, fields.get("command")) in discriminating
    if witness.result != "passed":
        return Row(
            **fields,
            state=GATE_FAILED,
            witness=witness,
            demonstrated_able_to_fail=demonstrated,
            reason=(
                f"{where}the check Wringer authored for this criterion — "
                "proved red before the work began — is still red. The "
                "criterion is not satisfied"
            ),
        )
    return Row(
        **fields,
        state=EVIDENCED,
        receipt=Receipt(kind=WITNESS, bundle=witness.bundle),
        witness=witness,
        demonstrated_able_to_fail=demonstrated,
        reason=(
            "a check Wringer authored for this criterion was proved red "
            "before the work began, pinned, and passes now"
        ),
    )


def _discriminating_pairs(root: Path) -> dict[tuple[str, str], Receipt]:
    """Every `(id, command)` the record shows can fail, with its receipt.

    Reuses health's shipped reader rather than a lookalike, so the exclusions
    stay in ONE place and cannot drift apart: bench-sourced bundles never
    qualify (health ruling 9 — a bench guarantees a red row for every
    required gate on a tree nobody changed), and `genuine_failure` already
    excludes timeouts and exit 127 (a missing binary proves only that PATH
    was wrong).

    The newest receipt wins, because the reader is being sent somewhere to
    look and the most recent demonstration is the most useful one.
    """
    # Imported here, not at module scope: `verify` imports this module and
    # `health` imports `loop` which imports `verify`, so a top-level import
    # closes the cycle. The dependency is real but it is one function deep.
    from wringer import health

    found: dict[tuple[str, str], Receipt] = {}
    coverage = health.discover(root)
    for bundle in coverage.read:
        if not bundle.qualifying:
            continue
        for run in health.gate_runs(bundle):
            key = (run.gate_id, run.command)
            if run.genuine_failure:
                found[key] = Receipt(kind="failure", bundle=bundle.receipt)
            elif run.sensitive:
                found[key] = Receipt(
                    kind="sensitive",
                    bundle=bundle.receipt,
                    cites=_cite_of(bundle.directory, run.gate_id),
                    environment=_environment_of(bundle.directory),
                )
    return found


def _environment_of(bundle_dir: Path) -> str | None:
    """The E3 disclosure, or None when that run verified its own environment.

    Read from the BUNDLE rather than from the live config on purpose: the
    receipt is a claim about the run that produced it, and a `prove_setup`
    added to `.wringer.yaml` afterwards would otherwise retroactively launder
    every receipt already on disk.
    """
    from wringer import vacuity

    try:
        recorded = json.loads(
            (bundle_dir / vacuity.VACUITY_FILENAME).read_text(encoding="utf-8")
        )
    except (OSError, ValueError):
        return None
    if recorded.get("setup"):
        return None
    return (
        "unverified — this run declared no 'run.prove_setup', so a pre-change "
        "tree missing its dependencies would have failed for that reason "
        "instead. Read 'cites' to tell the two apart"
    )


def _cite_of(bundle_dir: Path, gate_id: str) -> str | None:
    """The `cites` line the sensitivity rests on, carried verbatim.

    Limit 4 exists because a sensitive row inherits vacuity's blind spot: a
    gate whose own command arrived with the change reads sensitive for that
    reason alone. Vacuity's answer — binding, and correct — is to make the
    failure VISIBLE rather than to classify it, so the line travels with the
    receipt instead of being interpreted here.
    """
    from wringer import vacuity

    verdict = vacuity.read_verdict(bundle_dir)
    if verdict is None:
        return None
    for row in verdict.rows:
        if row.gate_id == gate_id and row.sensitive:
            return row.cites
    return None


def write(bundle_dir: Path, result: Result, redactor: Redactor | None = None) -> Path:
    """Write `acceptance.json`. Called BEFORE the digests cover the bundle."""
    payload = result.as_json()
    if redactor is not None:
        payload = json.loads(redactor.scrub(json.dumps(payload)))
    path = bundle_dir / ACCEPTANCE_FILENAME
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def read(bundle_dir: Path) -> dict[str, Any] | None:
    """The recorded artifact, or None when the repo never opted in.

    **The convenience form, and it is derived — one line over
    `evidence.read_sidecar`.** It answers "what does this bundle say", which
    is all its callers here and in `certificate` need, and it deliberately
    cannot tell absent from unreadable.

    The caller who MUST tell them apart is `deliver`, because a damaged
    record silently removed the acceptance interlock: the bundle recorded
    `refuses: true` rows and delivery proceeded with no refusal and no word.
    That caller reads the sidecar itself and refuses on `unreadable` (D2).
    """
    return evidence_module.read_sidecar(
        bundle_dir / ACCEPTANCE_FILENAME
    ).payload
