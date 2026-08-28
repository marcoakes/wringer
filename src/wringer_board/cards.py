"""One criterion → one card. SPEC_BOARD_V0 §3, rulings 4, 5 and 15.

Every state here is a function of bytes the engine wrote. The three computed
things are named in ruling 1 and two of them live in this file: the receipt
chain walk (ruling 5) and the discrimination of `unevidenced`'s four causes
(ruling 15). Nothing else is computed and nothing is scored.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from wringer_board import refusals
from wringer_board.read import Board, Criterion

# The six card states. **REFUSED is not among them and that is ruling 4a**:
# `refuses` is true for any criterion that is required and covered and not
# evidenced, so a NOT YET card, a NOT REACHED card and a bound NEEDS YOU card
# are all simultaneously refusing rows. Six mutually exclusive states with no
# precedence rule would be a lie about the data. It is also the honest model:
# **it is the delivery that was refused, not the criterion.**
DONE = "DONE — AND PROVED"
NOT_YET = "NOT YET"
NOT_REACHED = "NOT REACHED"
NEEDS_YOU = "NEEDS YOU"
# **Added 2026-08-21, and the word "you" is deliberately absent from both.**
#
# Field report finding 12, measured on a populated board: EIGHT rows badged
# `NEEDS YOU` whose own body text read *"Nothing is needed from you — an
# engineer has to bind a check to this before it can be proved"*, while the
# summary counted those same eight under *"8 will not be proved"* and said
# *"2 still needs you"*. A product manager scanning badges saw nine things
# demanding their attention; the bodies said eight of them needed nothing; the
# summary said two. **Three different answers to "what do I have to do?" on
# one page**, and the badge — the thing a person scans first — was the one
# that was wrong.
#
# `NEEDS YOU` is now reserved for rows where a PERSON is genuinely the
# blocker, which is the `human:` states and nothing else. A criterion nothing
# checks, or one whose check exists but cannot yet evidence anything, is an
# engineer's debt: real, loud, and not the reader's to discharge.
NOT_PROVABLE = "NOTHING CHECKS THIS"
NEEDS_AN_ENGINEER = "NEEDS AN ENGINEER"
UNKNOWN = "UNKNOWN"
UNTRANSLATED = "UNTRANSLATED"

STATES = (
    DONE,
    NOT_YET,
    NOT_REACHED,
    NEEDS_YOU,
    NOT_PROVABLE,
    NEEDS_AN_ENGINEER,
    UNKNOWN,
    UNTRANSLATED,
)

# **Who is blocked, per state — the ONE partition this page has.**
#
# The badge, the body sentence and the summary count all read this, so the
# three cannot give different answers again. A state absent from here is a
# state nobody classified, and `test_every_state_is_classified_by_who_is
# _blocked` fails rather than letting it default into somebody's column.
BLOCKED_ON_PERSON = (NEEDS_YOU,)
BLOCKED_ON_ENGINEER = (NOT_PROVABLE, NEEDS_AN_ENGINEER, UNTRANSLATED)
BLOCKED_ON_THE_WORK = (NOT_YET, NOT_REACHED)
SETTLED = (DONE,)
INDETERMINATE = (UNKNOWN,)

# **The refused chip reads that same partition — field report 2026-08-22
# finding 13, reproduced 2026-08-22 before it was fixed.**
#
# `refuses` is an engine fact about the DELIVERY, and ruling 4a is right that
# it is not a sixth state: a NOT YET row and a NEEDS YOU row can both be
# holding up the handover, and collapsing their badges would re-break finding
# 12. But the chip that announces the refusal printed ONE sentence — *"Refused
# — This one is holding up the handover"* — over both, so a reader met two
# rows saying the identical thing under two different badges and had no way to
# tell whether the badge or the chip was the one that mattered.
#
# The badge, the body sentence and the summary count were already three
# readers of one partition. The chip was a FOURTH thing on the card, reading
# nothing. It reads the partition now, so the rule is one rule: **a refused
# row's badge and its chip are both functions of who is blocked, and cannot
# disagree.**
#
# The wording tracks the summary line's vocabulary on purpose — "needs you",
# "not done yet", "no working check" — so the count line and the chip are the
# same words for the same fact.
WAITING_ON: dict[str, str] = {
    **{s: "it is waiting on you" for s in BLOCKED_ON_PERSON},
    **{s: "it is waiting on an engineer" for s in BLOCKED_ON_ENGINEER},
    **{s: "it is waiting on the work" for s in BLOCKED_ON_THE_WORK},
    **{s: "it is waiting on nothing this board can name" for s in SETTLED},
    **{s: "what it is waiting on cannot be read from the evidence here" for s in INDETERMINATE},
}


def waiting_on(state: str) -> str:
    """Who a refused row is waiting on — the ONE partition, never a guess.

    Total over `STATES` by construction and pinned by
    `test_the_refused_chip_and_the_badge_read_one_partition`. An unclassified
    state raises rather than printing a sentence nothing decided.
    """
    try:
        return WAITING_ON[state]
    except KeyError:  # pragma: no cover - the totality test is the guard
        raise KeyError(
            f"{state!r} has no who-is-blocked classification, so no refused "
            "chip can be written for it"
        ) from None


# Ruling 15's causes of `unevidenced`, discriminated. **There are FIVE, not the
# four the ruling enumerated**, and the fifth is here because S1 met it on real
# data and refused to render it as one of the others — see
# `tests/test_real_bundles.py`, which recorded it and handed the naming to this
# slice.
#
# **Only the unbound case is structural** — `gate: null` with no witness — and
# that is said rather than papered over. The rest are told apart by matching
# the engine's own `reason` text, each pinned by a fixture test, so a wording
# change in `accept.py` fails loudly instead of silently re-labelling a card.
#
# **Order is load-bearing.** The witness cause is matched FIRST, because its
# reason string carries "could not collect" and neighbouring words that a
# looser pattern below could claim. A reason matching none of them renders
# UNTRANSLATED with the engine's words verbatim (ruling 17) — never a generic
# sentence, which would be rendering one cause as another.
#
# The sentences live in `refusals.MAPPING`, not here. One table, so the
# totality test has one thing to be total over.
UNEVIDENCED_CAUSES: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "witness-evidenced-nothing",
        re.compile(r"witness evidences nothing", re.I),
    ),
    (
        # **CORRECTED 2026-08-17, and it had never matched.** All three
        # alternatives here were `arrived with the change`, `created by the
        # same change` and `did not exist before`. The engine says *"arrived
        # with the WORK"*, *"which this change CREATED"* and *"it did not exist
        # YET"* — so none of the three fired, and this cause fell past every
        # pattern to `untranslated`: the raw engine sentence, with no PM
        # wording at all, on the single refusal the core README advertises as
        # breaking the circularity charge.
        #
        # Found by `tests/test_acceptance_v3.py` while writing the v3 path, by
        # feeding the ENGINE'S OWN strings through these patterns instead of
        # strings written here. That is the entire argument for v3's `cause`
        # field: a mapping keyed on somebody else's prose is a mapping that
        # goes stale silently, and this one had. `test_the_patterns_match_the_
        # engines_actual_words` now derives the check from real rows.
        "arrived-with-the-work",
        re.compile(
            r"arrived with the (work|change)|created by the same change|"
            r"did not exist (yet|before)|which this change created",
            re.I,
        ),
    ),
    (
        # Renamed from `never-recorded-failing` in this slice, to the name
        # `accept.py` and `SPEC_BOARD_V0` ruling 15 both already use for it.
        # Two names for one cause is how a mapping stops being checkable.
        "born-green",
        re.compile(
            r"never (been )?recorded failing|no record of (it|this gate) "
            r"failing|born green|passed at its first",
            re.I,
        ),
    ),
    (
        "pre-existence-unestablished",
        re.compile(r"could not (be )?establish|pre-change|sensitiv", re.I),
    ),
)

UNBOUND = "unbound"


@dataclass
class Card:
    """What one criterion looks like on the board, and nothing more."""

    id: str
    title: str
    state: str
    sentence: str
    refused: bool = False
    # The check's OWN words, verbatim, in a visually distinct block attributed
    # to the check (ruling 7). Never paraphrased: the surface does not get to
    # improve a check's words, and this is the one place a machine's words earn
    # their seat on a PM's screen.
    check_said: str | None = None
    # The changed-since-bound note, verbatim from `wringer.checks`. Hint tier
    # in v0: it never changes the card's STATE and never refuses anything —
    # whether a changed check should block delivery is a named future ruling
    # that wants this v0's field evidence first.
    check_note: str | None = None
    # What the ENGINE guessed about why this criterion's check went red, when
    # the red looks like the environment rather than the work. Hint tier: it
    # never moves a card between states and never refuses anything, and the
    # card that renders it says out loud that it is a guess.
    check_environment: str | None = None
    receipt: str | None = None
    engine_words: str | None = None
    cause: str | None = None
    # **The unblocking question — ruling 16's other half, rendered at last.**
    #
    # Every value in `refusals.MAPPING` has carried a sentence AND a question
    # since S2. The totality test guarded both halves, so the questions were
    # pinned against the engine and read by NOBODY: nothing on the surface
    # rendered one. That is dead text reading as coverage, which is the defect
    # this board exists to refuse, one level up.
    #
    # H-4 of the Fable rulings of 2026-08-17 folded it into S3 rather than a
    # separate layout cycle, on the grounds that an interview is MADE of
    # unblocking questions. A card that states a problem and not what is needed
    # is a report; a card that asks is a conversation.
    #
    # None where the state genuinely asks nothing of anybody — a DONE card, and
    # the questions that say so in words ("Nothing is needed from you") are
    # still rendered, because "nothing is needed" is an answer to the question
    # a reader is already asking.
    question: str | None = None


def _chain(board: Board, criterion: Criterion) -> tuple[bool, str | None, str | None]:
    """Walk the receipt to the failure it cites. Ruling 5.

    Returns `(resolved, what the card shows, the check's own words)`.

    **Two receipt kinds, resolving differently**, and the first draft of the
    probe handled only one — which would have rendered UNKNOWN for every
    criterion in any repository using `run.prove: true`, the mechanism the
    README's own objections block advertises.
    """
    receipt = criterion.receipt or {}
    kind = receipt.get("kind")
    if not kind:
        return False, None, None

    if kind == "failure":
        # The cited bundle's gate directory says `failed`, and its stderr is
        # what the check printed. That is the red, on the record.
        run = _cited_dir(board, receipt)
        if run is None:
            return False, None, None
        said = _gate_stderr(run, criterion.gate_id)
        return (
            True,
            (
                "This check has been seen failing, and the run where it failed "
                "is saved with this project's records."
            ),
            said,
        )

    if kind == "witness":
        # **The THIRD receipt kind, and ruling 5 predates it.** The spec was
        # written against `accept.py` at `d23d7ca`, which had `failure` and
        # `sensitive`; `wringer.acceptance.v2` added `witness`, and the corpus
        # re-test's winning rows carry exactly this. Without it the board
        # demoted the strongest red-first demonstration this programme has to
        # UNKNOWN and withheld the promise — honest, and wrong.
        #
        # Its own sentence, because ruling 5's whole point is that different
        # facts get different words. A `failure` receipt says a repository's
        # own check has been recorded failing. A `sensitive` receipt says a
        # check failed on the code as it was. **This one says something neither
        # can**: the check did not exist until Wringer wrote it, it was written
        # BEFORE the work began, it was recorded failing then, and the same
        # pinned bytes pass now.
        witness = criterion.witness or {}
        if witness.get("proved_red") != "assertion":
            # Proved red for the wrong reason — a load failure — evidences
            # nothing, and a receipt pointing at it resolves nothing.
            return False, None, None
        return (
            True,
            (
                "The repository had no check for this. Wringer wrote one before "
                "the work began, recorded it failing then, and the same check "
                "passes now."
            ),
            None,
        )

    if kind == "sensitive":
        # On the CHANGED tree the gate passed, so the gate directory's
        # `result.json` says `passed` and reading it would resolve nothing. The
        # failure is in the run's `vacuity/` — and the schema already carries
        # the citation line verbatim.
        cites = receipt.get("cites")
        if not cites:
            return False, None, None
        return (
            True,
            (
                "This check failed on the code as it was BEFORE this change, and "
                "passes on it now."
            ),
            str(cites),
        )

    return False, None, None


def _cited_dir(board: Board, receipt: dict[str, Any]) -> Path | None:
    for key in ("run", "bundle", "evidence_dir"):
        value = receipt.get(key)
        if not value:
            continue
        candidate = board.repo / str(value)
        if candidate.is_dir():
            return candidate
        candidate = board.repo / ".wringer" / "runs" / Path(str(value)).name
        if candidate.is_dir():
            return candidate
    return None


def _gate_stderr(run: Path, gate_id: str | None) -> str | None:
    """The message the check printed, verbatim, from the cited run."""
    if gate_id is None:
        return None
    for directory in sorted((run / "gates").glob(f"*_{gate_id}")):
        for name in ("stderr.log", "stdout.log"):
            path = directory / name
            if not path.is_file():
                continue
            text = path.read_text(encoding="utf-8", errors="replace").strip()
            if text:
                return text[:600]
    return None


def _unevidenced(criterion: Criterion) -> tuple[str, str, str | None]:
    """Which cause, and the sentence for it.

    **v3 first: the ENGINE'S OWN `cause` field beats every pattern below.**
    Until v3 the only way to tell the causes apart was to match free text
    against `accept.py`'s wording, which meant a reworded message could
    silently re-label a card — the surface deciding what the engine said. When
    the record carries a cause, the patterns are not consulted at all.

    The prose matching stays for v1 and v2 records, which have no `cause` key
    and which this board must keep reading. It is a fallback now, not the
    mechanism.

    Rendering one as another is false and, in one direction, backwards — for a
    check that arrived with the work the record *does* show the gate can fail;
    the objection is that the gate is new. That is also one of the three things
    the core README advertises as breaking the circularity objection, so
    getting it wrong here contradicts the README two clicks away.

    The text patterns are matched BEFORE the structural unbound fallback,
    because the witness cause is also a `gate: null` row and would otherwise be
    swallowed by it — which is exactly how a fifth cause hides inside a fourth.
    """
    if criterion.cause is not None:
        saying = refusals.say(refusals.UNEVIDENCED_CAUSE, criterion.cause)
        if saying is None:
            # A cause the engine names and this board has no sentence for is
            # UNTRANSLATED — named, never prettified, never silently generic.
            # Ruling 17: a PM seeing an ugly string files a bug report; a PM
            # seeing nothing has been lied to.
            return "untranslated", "", criterion.reason
        return criterion.cause, saying.sentence, None

    for name, pattern in UNEVIDENCED_CAUSES:
        if pattern.search(criterion.reason):
            saying = refusals.say(refusals.UNEVIDENCED_CAUSE, name)
            if saying is None:  # a cause with no sentence is untranslated
                break  # rather than silently generic
            return name, saying.sentence, None

    if criterion.gate_id is None:
        saying = refusals.say(refusals.UNEVIDENCED_CAUSE, UNBOUND)
        if saying is not None:
            return UNBOUND, saying.sentence, None

    # Ruling 17: never invisibly, never swallowed, never prettified. A PM
    # seeing an ugly string files a bug report; a PM seeing nothing has been
    # lied to.
    return "untranslated", "", criterion.reason


def _answered_question(criterion: Criterion) -> str | None:
    """What to ask about a `human` row a person has already answered `met`.

    Not "is this met?" — they said so. The honest question is the one the
    record's own limit raises: the answer is pinned to the WORDING and to
    nothing else, so later work can break what was approved and nothing here
    detects it.
    """
    judged = criterion.judgement
    if not judged or judged.get("verdict") != "met":
        return None
    who = judged.get("by") or "somebody"
    return (
        f"{who} said this was met, against the requirement as worded then. "
        "Nothing re-checks it — does it still hold?"
    )


def card_for(board: Board, criterion: Criterion) -> Card:
    """One criterion, rendered — and never scored."""
    refused = criterion.refuses
    state = criterion.state
    card = _card_for(board, criterion, refused, state)
    # **Hint tier, and attached AFTER the state is decided.** A changed check
    # never moves a card between states and never refuses anything in v0 —
    # whether it should is a named future ruling. Attaching it here rather
    # than inside each branch is what makes that structural: there is no path
    # on which this note could have altered a verdict, and
    # `test_the_note_never_changes_a_CARD` reverts exactly this line to check.
    # `board.check_notes`, NOT `getattr(board, ..., {})` — the mutation sweep
    # of 2026-08-22 showed the defensive default made the whole field
    # deletable with nobody noticing. A board that has lost the field should
    # be a loud AttributeError, not a page quietly missing its notes.
    note = board.check_notes.get(criterion.id)
    if note is not None:
        card = replace(card, check_note=note)
    # **The environment guess, attached the SAME way and for the same reason.**
    # Field report 2026-08-28, finding 4: a red the environment caused and a
    # red the requirement earned read identically, so a reader went off to
    # change working code. Attached after the state is decided, so there is
    # structurally no path on which it could have altered a verdict — the
    # discipline `check_note` already established one line above.
    guess = _environment_guess(board, criterion)
    return card if guess is None else replace(card, check_environment=guess)


def _environment_guess(board: Board, criterion: Criterion) -> str | None:
    """The engine's own sentence about this criterion's failing check, or None.

    Read from `diagnosis.json`, which the engine writes and this page renders
    — the board owns no wording for it, exactly as it owns none for a check
    note or a refusal. Absent unless a face matched, and matched only against
    the gate this criterion is bound to: a guess about another gate's red is
    not about this requirement.
    """
    recorded = board.diagnosis
    if not recorded or not criterion.gate_id:
        return None
    if recorded.get("gate") != criterion.gate_id:
        return None
    # **The ENGINE's sentence for the face, never one written here.**
    # `wringer.diagnosis.v1` is `additionalProperties: false` and frozen, so
    # the record carries the face and not its wording — and a translation
    # table living in this package is precisely the drift the layer seam
    # exists to stop. `diagnose.DESCRIPTIONS` is the definition; this reads
    # it. Guarded, so a board with no engine present renders the page and
    # simply has no guess to show.
    try:
        from wringer import diagnose as diagnose_module

        return diagnose_module.DESCRIPTIONS.get(recorded.get("face"))
    except Exception:  # pragma: no cover - a hint never breaks the page
        return None


def _card_for(board: Board, criterion: Criterion, refused: bool, state: str) -> Card:

    if state == "evidenced":
        resolved, sentence, said = _chain(board, criterion)
        if not resolved:
            # **A row that CLAIMS evidenced and cannot resolve is UNKNOWN**, and
            # it vetoes the promise whatever it ends up rendering (ruling 5).
            # The probe's own implementation got this wrong: demoting the card
            # removed it from the set of greens and the promise then fired over
            # the survivors — a page reading "every green was red first" beside
            # a card that could not show its red.
            return Card(
                id=criterion.id,
                title=criterion.title,
                state=UNKNOWN,
                sentence=(
                    "This record says this requirement is proved, and the "
                    "proof it points at is not something this board could "
                    "follow. So it is showing nothing rather than something it "
                    "cannot stand behind."
                ),
                refused=refused,
            )
        return Card(
            id=criterion.id,
            title=criterion.title,
            state=DONE,
            sentence=sentence or "",
            refused=refused,
            receipt=sentence,
            check_said=said,
        )

    if state == "gate-failed":
        witness = criterion.witness or {}
        if witness.get("covers") or witness.get("proved_red") == "assertion":
            sentence = (
                "Not done yet — and the check that decides it was written "
                "BEFORE the work began, was recorded failing then, and is "
                "still failing now."
            )
        else:
            sentence = (
                "Not built yet — and the check that will decide it is written "
                "and failing right now."
            )
        return Card(
            id=criterion.id,
            title=criterion.title,
            state=NOT_YET,
            sentence=sentence,
            refused=refused,
            check_said=_gate_stderr(board.run_dir, criterion.gate_id)
            if board.run_dir
            else None,
        )

    if state == "gate-did-not-run":
        # **Ruling 4b: no cause this card cannot support.** The sentence is
        # `accept.py`'s own. A scoped run gets its own honest sentence, read
        # from the manifest rather than inferred.
        sentence = "Not checked in this run, so nothing here says anything about it."
        if board.scoped_out:
            sentence += " This run was only asked to check some of the requirements."
        return Card(
            id=criterion.id,
            title=criterion.title,
            state=NOT_REACHED,
            sentence=sentence,
            refused=refused,
        )

    if state == "human":
        # **v3 tells the three human states apart.** Before `cause` existed
        # this card said one thing for all of them — "a person has to decide
        # this one" — which is true of an unanswered criterion, misleading for
        # one a person has already answered NO to, and wrong for one whose
        # answer went stale. The engine now names which, so the card can.
        saying = (
            refusals.say(refusals.UNEVIDENCED_CAUSE, criterion.cause)
            if criterion.cause
            else None
        )
        if saying is not None:
            return Card(
                id=criterion.id,
                title=criterion.title,
                state=NEEDS_YOU,
                sentence=saying.sentence,
                refused=refused,
                cause=criterion.cause,
                question=saying.question,
            )
        # v1 and v2 records, and a v3 row a person has answered `met`: no
        # cause, and nothing is being asked.
        return Card(
            id=criterion.id,
            title=criterion.title,
            state=NEEDS_YOU,
            sentence=(
                "A person has to decide this one. Nothing automatic can, and "
                "Wringer will not pretend otherwise."
            ),
            refused=refused,
            question=_answered_question(criterion),
        )

    if state == "unevidenced":
        cause, sentence, engine = _unevidenced(criterion)
        if cause == "untranslated":
            return Card(
                id=criterion.id,
                title=criterion.title,
                state=UNTRANSLATED,
                sentence="",
                refused=refused,
                engine_words=engine,
                cause=cause,
            )
        saying = refusals.say(refusals.UNEVIDENCED_CAUSE, cause)
        return Card(
            id=criterion.id,
            title=criterion.title,
            # **Never `NEEDS YOU`** — finding 12. Every cause of `unevidenced`
            # is an engineer's debt: either nothing is bound to this criterion
            # (`unbound`) or something is bound and cannot yet evidence it
            # (born green, arrived with the work, pre-existence unestablished,
            # a witness that evidences nothing). None of them is discharged by
            # the person reading the page, and badging them as if they were is
            # what produced nine demands for attention where the summary
            # counted two.
            state=NOT_PROVABLE if cause == UNBOUND else NEEDS_AN_ENGINEER,
            sentence=sentence,
            refused=refused,
            cause=cause,
            question=saying.question if saying else None,
        )

    return Card(
        id=criterion.id,
        title=criterion.title,
        state=UNKNOWN,
        sentence=(
            "This record says something this board does not understand, so it "
            "is showing nothing rather than something it cannot stand behind."
        ),
        refused=refused,
    )


def promise_earned(board: Board, cards: list[Card]) -> bool:
    """Whether "every green on this board was red first" may be rendered.

    **Computed over CLAIMS, not over survivors** (ruling 5). A row that claims
    `evidenced` and cannot resolve its receipt VETOES the promise, whatever the
    card ends up rendering. Demoting it to UNKNOWN and then firing the promise
    over what is left is the probe's own bug, and it produced a page reading
    "every green was red first" beside a card that could not show its red.
    """
    claimed = [c for c in board.criteria if c.state == "evidenced"]
    if not claimed:
        return False
    return all(_chain(board, criterion)[0] for criterion in claimed)
