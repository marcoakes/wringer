"""SECURITY.md's isolation narrative, derived from the run ledger.

**Why this exists, and it is the second time.** On 2026-08-13 sequence G ran
and was classified — twice, on macOS/podman and on a shared-kernel Linux guest
— and on 2026-08-14 a third time on Docker. `backend.LIMITS` was corrected that
same day. `SECURITY.md` was not, and for two days its container section told
every reader the path had *"never been adversarially tested"* and that sequence
G was *"unrun"*, while `docs/MANUAL_CHECKS.md` recorded three classified runs
four hundred lines away in the same repository.

Nothing derived one from the other, so nothing could notice. That is the whole
defect: **two hand-kept prose surfaces, no relationship a test could check.**
The first time this class was paid for was the signing row, where the guard
could only catch *overstatement*; `tests/test_security_capabilities.py` carries
that lesson. This file carries the other half of it — **understatement is also
a stale claim.** A document that says less than the measurement is not being
careful, it is being wrong, and a reader deciding whether to trust a container
is misled in the direction that looks humble.

**Why this file rather than an extension of the capability guard.**
`test_security_capabilities.py` parses one table, named by its
`TABLE_HEADING = "## Who may do what — the authority model"`. The isolation
narrative lives *outside* that heading, which SPEC_CONTAIN_V0 §1's R-5 row
states in as many words: *the guard that forces probes parses the AUTHORITY
table only*, so it **cannot fire on the one wording R-5 exists to control**.
That gap is real and it is this file's territory. Nothing here touches the
authority table, and nothing there is weakened.

**What is derived, in both directions.**

- The ledger — `docs/MANUAL_CHECKS.md`'s *Coverage record* table — is the
  record. Every row is classified as an attack sequence or not, and as RAN or
  not, from the row's own cells.
- **Understatement:** no watched document may assert that an attack sequence is
  unrun, untested or unmeasured once the ledger carries a classified run of it.
- **Overstatement:** SECURITY.md's measured-results table must state exactly
  the (sequence, platform, runtime, date) keys the ledger classifies. Not a
  subset — a row claiming a measurement the ledger does not carry fails, and a
  ledger row missing from the table fails too, because a narrative that keeps
  an older, narrower story while new measurements land is how this drifted the
  first time.

**Completeness forcing, on the pattern Q3 ruled.** Every ledger row must be
classified by `LEDGER_SUBJECTS` below. A row nobody has classified FAILS with
the label it needs — a new sequence cannot ship unwatched, and it cannot ship
silently watched either.

**The honest limit, stated here rather than discovered later.** The
understatement patterns are hand-written regexes over English, and no test can
prove the list is complete: a document can always find a new way to say
"untested" that no pattern matches. What the derivation buys is that the
*specific* sentences which went stale — and any close paraphrase — cannot go
stale again without reddening, and that the results table cannot drift from the
ledger at all, because that half is a set comparison rather than a pattern.
That is the most two prose surfaces admit, and it is strictly more than the
nothing which produced this twice.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import pytest


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


LEDGER = "docs/MANUAL_CHECKS.md"
LEDGER_HEADING = "## Coverage record"
NARRATIVE = "SECURITY.md"
NARRATIVE_HEADING = "### What the container path has been measured to do"

# Documents that carry the isolation narrative to a reader. A claim about what
# has been attacked belongs in exactly these, and each is checked in the
# understatement direction.
WATCHED = ("SECURITY.md", "README.md", "SETUP.md")

# --- classifying the ledger's rows ------------------------------------------

# Which coverage rows are ATTACK sequences — the ones whose result is a
# statement about isolation — and which are something else. Hand-written once,
# and a row absent from this map fails the suite rather than being skipped.
# The key is the row's leading `Sequence` cell, normalised.
ATTACK = "attack"
OTHER = "other"

LEDGER_SUBJECTS = {
    "apple `container`": OTHER,
    "docker stub (r2-02)": OTHER,
    "docker desktop on macos": OTHER,
    "sequence i — the contained worker, attacked": ATTACK,
    "sequence g — the container path, attacked": ATTACK,
    "sequence g — **on linux, shared kernel**": ATTACK,
    "sequence g — **docker on linux, read at last**": ATTACK,
    "sequence g — docker on linux": ATTACK,
    "sequence g — this mac": ATTACK,
    "docker on linux": OTHER,
}

# A result cell states a CLASSIFIED run only with these words. "EXECUTED for
# the first time … UNCLASSIFIED: nobody has read it" is deliberately not one of
# them: a row saying the sequence RAN is not a row saying what it found, and
# the ledger says so in those words. Neither is "REFUSED, exit 2", which is the
# script working.
CLASSIFIED = "ran and classified"


@dataclass(frozen=True)
class LedgerRow:
    subject: str          # normalised leading cell
    os_cell: str
    runtime_cell: str
    date: str
    result: str

    @property
    def classified(self) -> bool:
        return CLASSIFIED in self.result.lower()

    @property
    def sequence(self) -> str | None:
        found = re.search(r"sequence ([a-z])\b", self.subject)
        return found.group(1).upper() if found else None


def _cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def read_ledger() -> list[LedgerRow]:
    """The Coverage record table, as the document states it."""
    text = (repo_root() / LEDGER).read_text(encoding="utf-8")
    assert LEDGER_HEADING in text, f"{LEDGER} lost its {LEDGER_HEADING!r}"
    after = text.split(LEDGER_HEADING, 1)[1]

    rows: list[LedgerRow] = []
    started = False
    for line in after.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            if started:
                break
            continue
        cells = _cells(stripped)
        if cells and set(cells[0]) <= {"-", ":"} and cells[0]:
            continue
        if not started:
            # The header row names the columns this parser depends on.
            assert cells[:1] == ["Sequence"], (
                f"the {LEDGER_HEADING!r} table no longer starts with a "
                f"'Sequence' column; this parser reads {cells[:1]}"
            )
            started = True
            continue
        if len(cells) < 7:
            continue
        rows.append(
            LedgerRow(
                subject=cells[0].lower(),
                os_cell=cells[2],
                runtime_cell=cells[3],
                date=cells[4],
                result=cells[6],
            )
        )
    assert rows, f"no rows parsed out of {LEDGER}'s {LEDGER_HEADING!r}"
    return rows


def platform_family(text: str) -> str:
    lowered = text.lower()
    if "macos" in lowered or "darwin" in lowered:
        return "macOS"
    if any(word in lowered for word in ("linux", "coreos", "ubuntu")):
        return "Linux"
    return "?"


def runtime_family(text: str) -> str:
    lowered = text.lower()
    for name in ("podman", "docker", "nerdctl"):
        if name in lowered:
            return name
    if "apple" in lowered:
        return "apple"
    if "none" in lowered:
        return "none"
    return "?"


# --- completeness forcing ---------------------------------------------------


def test_every_coverage_row_is_classified_as_attack_or_not():
    """**A row nobody classified FAILS.** A new sequence cannot ship
    unwatched, and it cannot ship silently watched either — the author has to
    say which it is, in this file, where the decision is reviewable."""
    unknown = [
        row.subject for row in read_ledger()
        if row.subject not in LEDGER_SUBJECTS
    ]
    assert not unknown, (
        "these rows of the coverage record are not classified in "
        "LEDGER_SUBJECTS, so nothing knows whether SECURITY.md must agree "
        f"with them: {unknown}. Add each with ATTACK or OTHER"
    )


def test_no_classification_is_registered_for_a_row_that_left():
    """The other direction of the same completeness: a stale entry here would
    quietly stop guarding a row that no longer exists, and would read as
    coverage."""
    present = {row.subject for row in read_ledger()}
    orphans = sorted(set(LEDGER_SUBJECTS) - present)
    assert not orphans, (
        f"LEDGER_SUBJECTS classifies rows the coverage record no longer has: "
        f"{orphans}. Remove them, or the map reads as coverage it does not have"
    )


# --- direction 1: understatement --------------------------------------------

# Claims that an attack sequence has not happened. Deliberately tense-agnostic
# — "is unrun", "was unrun" and "remains unrun" are all caught — because the
# discrimination that matters is not grammatical tense but whether the sentence
# is ASSERTING the state or DESCRIBING a corrected one. That second question is
# `_is_a_mention`'s, and separating the two is what stops this guard from
# reddening the very correction note that records why it exists.
UNRUN_CLAIMS = (
    r"sequence\s+[GI][^.]{0,40}\bunrun\b",
    r"\bunrun\b[^.]{0,40}sequence\s+[GI]",
    r"never\s+been\s+adversarially\s+tested",
    r"no\s+container\s+has\s+ever\s+run\s+through\s+this\s+backend",
    r"none\s+of\s+those\s+flags\s+has\s+been\s+adversarially\s+tested",
    r"docker\s+is\s+still\s+unmeasured",
    r"the\s+maintainer's\s+machine\s+has\s+no\s+container\s+runtime",
)

# A claim is a MENTION — history, a quotation, a correction note — when one of
# these stands close in front of it. The house convention is that captures are
# evidence and corrections are dated rather than silent, so a document MUST be
# able to say what it used to say; a guard that forbade that would force the
# next window to delete the record of the drift in order to fix the drift.
HISTORY_MARKERS = (
    r"\bsaid\b", r"\bused to\b", r"\buntil\b", r"\bpreviously\b",
    r"\bwas false\b", r"\bwere false\b", r"\bcorrected\b", r"\bstale\b",
    r"\bno longer\b", r"\bformerly\b", r"\bbefore\b",
)

# How far back a history marker may stand and still govern the claim. One
# sentence's worth: far enough for "Until this date the section below said …",
# short enough that an unrelated paragraph three sentences up cannot launder a
# live assertion.
MENTION_WINDOW = 240


def _is_a_mention(text: str, start: int) -> bool:
    """Whether the claim at `start` is describing history rather than making it.

    The distinction SPEC_CONTAIN_V0's review finding 27 forced on the sibling
    guard, applied here: *a sentence saying "deliberately not sandboxed" is a
    mention and must not redden it.* A guard that cannot tell a claim from a
    sentence about a claim fires on correct prose, and a guard that fires on
    correct prose is a guard somebody deletes.
    """
    window = text[max(0, start - MENTION_WINDOW):start]
    return any(re.search(marker, window, re.IGNORECASE) for marker in
               HISTORY_MARKERS)


@pytest.mark.parametrize("document", WATCHED)
def test_no_watched_document_calls_a_classified_sequence_unrun(document):
    """**The stale-claim class, in the understatement direction.**

    Every pattern here matched a sentence that was live in `SECURITY.md` on
    2026-08-15 and false since 2026-08-13. The ledger is consulted rather than
    assumed: if every attack row were genuinely unclassified, this test would
    have nothing to enforce and says so.
    """
    classified = [row for row in read_ledger()
                  if LEDGER_SUBJECTS.get(row.subject) == ATTACK
                  and row.classified]
    if not classified:  # pragma: no cover - the ledger has classified rows
        pytest.skip("no attack sequence is classified in the ledger")

    text = (repo_root() / document).read_text(encoding="utf-8")
    for pattern in UNRUN_CLAIMS:
        for found in re.finditer(pattern, text, re.IGNORECASE):
            assert _is_a_mention(text, found.start()), (
                f"{document} asserts {found.group(0)!r}, and "
                f"{LEDGER}'s coverage record carries "
                f"{len(classified)} classified attack run(s). Understatement "
                "is a stale claim too — correct the sentence, or, if it is "
                "history, date it and say so in the same breath"
            )


def test_the_mention_and_the_assertion_are_told_apart():
    """**The fixture that pins the distinction**, on the pattern SPEC_CONTAIN
    used for its own `sandboxed` sentence: the document this guard watches most
    closely contains the forbidden words, legitimately, in the note recording
    why the guard was written. If that ever stops being distinguishable from a
    live claim, this test says so before the other one does.

    Watched to fail both ways: an assertion with no history marker in front of
    it must redden, and the real correction note must not.
    """
    live = "The container path has never been adversarially tested."
    assert not _is_a_mention(live, live.index("never been"))

    note = (
        "Corrected 2026-08-15. Until this date the section below said the "
        "container path had never been adversarially tested."
    )
    assert _is_a_mention(note, note.index("never been"))

    # And the real one, read off disk rather than restated — a fixture that
    # paraphrases the document it pins is a fixture that can pass while the
    # document fails.
    text = (repo_root() / NARRATIVE).read_text(encoding="utf-8")
    found = re.search(r"never\s+been\s+adversarially\s+tested", text, re.I)
    assert found is not None, (
        "SECURITY.md no longer records what it used to claim. The correction "
        "note is the evidence that this guard was earned; keep it dated"
    )
    assert _is_a_mention(text, found.start())


# --- direction 2: the results table equals the ledger -----------------------


def read_narrative_table() -> set[tuple[str, str, str, str]]:
    """SECURITY.md's measured-results table, as (sequence, platform, runtime,
    date) keys."""
    text = (repo_root() / NARRATIVE).read_text(encoding="utf-8")
    assert NARRATIVE_HEADING in text, (
        f"{NARRATIVE} lost the heading this guard reads "
        f"({NARRATIVE_HEADING!r}); the results table cannot be found"
    )
    after = text.split(NARRATIVE_HEADING, 1)[1]

    keys: set[tuple[str, str, str, str]] = set()
    started = False
    for line in after.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            if started:
                break
            continue
        cells = _cells(stripped)
        if cells and set(cells[0]) <= {"-", ":"} and cells[0]:
            continue
        if not started:
            assert cells[:4] == ["sequence", "platform", "runtime", "date"], (
                f"{NARRATIVE}'s results table no longer carries the columns "
                f"this guard derives from; it reads {cells[:4]}"
            )
            started = True
            continue
        if len(cells) < 4:
            continue
        keys.add(
            (
                cells[0].strip().upper(),
                platform_family(cells[1]),
                runtime_family(cells[2]),
                cells[3].strip(),
            )
        )
    assert started, f"{NARRATIVE} has no results table under {NARRATIVE_HEADING!r}"
    return keys


def ledger_keys() -> set[tuple[str, str, str, str]]:
    keys = set()
    for row in read_ledger():
        if LEDGER_SUBJECTS.get(row.subject) != ATTACK or not row.classified:
            continue
        sequence = row.sequence
        assert sequence is not None, (
            f"an attack row names no sequence letter: {row.subject!r}"
        )
        keys.add(
            (
                sequence,
                platform_family(f"{row.os_cell} {row.subject}"),
                runtime_family(row.runtime_cell),
                row.date,
            )
        )
    return keys


def test_the_narrative_states_every_classified_run_and_no_others():
    """**The half that is a set comparison rather than a pattern.**

    A narrative that keeps an older, narrower story while new measurements land
    is exactly how this drifted the first time, and it is invisible to any
    check that only looks for forbidden words. Both directions in one
    assertion: a claimed measurement the ledger does not carry is
    overstatement, and a classified run the narrative does not mention is
    understatement.
    """
    from_ledger = ledger_keys()
    from_narrative = read_narrative_table()

    missing = sorted(from_ledger - from_narrative)
    invented = sorted(from_narrative - from_ledger)

    assert not missing, (
        f"{LEDGER} classifies runs that {NARRATIVE} does not state: {missing}. "
        "A narrative that stays narrower than the record is the stale claim "
        "this file exists to stop"
    )
    assert not invented, (
        f"{NARRATIVE} states measurements {LEDGER} does not classify: "
        f"{invented}. Every row of that table is a claim about an attack that "
        "happened, and the ledger is where it is recorded"
    )


def test_the_narrative_never_upgrades_itself_past_the_canaries():
    """The phrases a reader would quote back at us. None may appear as an
    assertion, whatever the ledger says: the classification is a human's, and
    eight scripted probes are not an escape suite."""
    text = (repo_root() / NARRATIVE).read_text(encoding="utf-8")
    # `demonstrated to isolate` is quoted in the correction note as the phrase
    # that is NOT claimed, so the check is for the assertion rather than the
    # mention: the word must not appear without its negation nearby.
    for claim in ("proven secure", "cannot escape", "guaranteed to isolate"):
        assert claim not in text.lower(), claim
    for found in re.finditer(r"demonstrated to isolate", text, re.IGNORECASE):
        window = text[max(0, found.start() - 120):found.start()]
        assert re.search(r"\bnot\b|\bdoes not\b|rather than", window, re.I), (
            "SECURITY.md asserts 'demonstrated to isolate'. Sequence G has no "
            "`--privileged` control run, so nothing shows the flags are what "
            "stopped the attacks"
        )
