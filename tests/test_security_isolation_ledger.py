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
from core_helpers import reader_facing_pages


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


LEDGER = "docs/MANUAL_CHECKS.md"
LEDGER_HEADING = "## Coverage record"
NARRATIVE = "SECURITY.md"
NARRATIVE_HEADING = "### What the container path has been measured to do"

# Documents that carry the isolation narrative to a reader. A claim about what
# has been attacked belongs in exactly these, and each is checked in the
# understatement direction.
#
# **`docs/MANUAL_CHECKS.md` added 2026-08-18, and it is the document that
# holds the ledger.** `:612` said *"The Linux arm is unrun and docker is
# unrun"* — false since 2026-08-16, when the row four hundred lines ABOVE it
# in the same file recorded exactly those runs. A document contradicting its
# own table is the sharpest form of this defect, and it stood because the
# running log was not watched at all.
#
# **DISCOVERED since 2026-08-23.** The tuple was four documents, and the
# comment above already stated the rule it was standing in for: pages that
# carry the isolation narrative to a reader. A page acquires that narrative by
# writing a sentence about what has and has not been attacked — not by being
# added to a list — and this repository has more pages than it had when the
# four were typed.
#
# The whole point of this file is that two hand-kept prose surfaces with no
# derived relationship went stale in opposite directions for two days. Keeping
# the SCOPE hand-kept while deriving the CLAIM leaves the same shape of hole
# one level up.
#: Contracts and dated history, excluded by the same rule the prose guards
#: use: a spec's "what this window did not measure" section is a statement
#: about the day it was written, and correcting it in place would destroy the
#: record. `SPEC_EXEC_V0.md` §7 carries a dated note instead.
#:
#: **`docs/MANUAL_CHECKS.md` is deliberately NOT excluded**, though it is the
#: most record-like page here. It holds the ledger, and the sharpest instance
#: of this defect was that file contradicting its own table four hundred lines
#: away. A running log is exactly the page that must be held to it.
_RECORDS = ("docs/specs/", "CHANGELOG.md")


def watched_documents() -> list[str]:
    """Every page whose isolation sentences are held to the ledger.

    Captures excluded: a field report saying a sequence was unrun on its date
    is accurate, and rewriting it would destroy the record the ledger's own
    rows are read against.
    """
    root = repo_root()
    return [
        name
        for name in (
            path.relative_to(root).as_posix()
            for path in reader_facing_pages(captures=False)
        )
        if not name.startswith(_RECORDS)
    ]


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
    "sequence i — the contained acp worker, attacked": ATTACK,
    # The first row in this ledger for which the macOS VM caveat does not
    # apply: Docker on a shared Linux kernel, both spawn shapes, with the
    # control beside them.
    "sequence i — **docker on linux, shared kernel**": ATTACK,
    # ATTACK, and deliberately NOT classified: it REFUSED, exit 2, and carries
    # none of `CLASSIFIED`'s words. Kept as a row because the refusal is the
    # evidence — a sequence that says "nothing was measured" is worth more on
    # the record than one quietly re-run until it looked green.
    "sequence i — docker on linux, first attempt": ATTACK,
    "sequence g — the container path, attacked": ATTACK,
    "sequence g — **on linux, shared kernel**": ATTACK,
    "sequence g — **docker on linux, read at last**": ATTACK,
    "sequence g — docker on linux": ATTACK,
    "sequence g — this mac": ATTACK,
    # OTHER, and the distinction is worth stating because the word "auth" in a
    # subject line invites the wrong guess. This probes a CAPABILITY question —
    # can a client read an agent's authentication state before paying for a
    # turn — and attacks nothing. It crosses no boundary, tries to defeat no
    # containment, and its finding ("no, it cannot") constrains what Wringer
    # may promise a product manager rather than what SECURITY.md may claim.
    "sequence l — is agent auth readable before the paid turn?": OTHER,
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


def spawn_family(text: str) -> str:
    """Which WORKER a sequence-I row attacked.

    **The key had four parts and needed five, and the counter-example landed
    one commit after the guard.** The contained shell worker and the contained
    ACP worker were both measured on macOS/podman on 2026-08-15, so they
    collapsed to one key: the ledger gained a classified run,
    `SECURITY.md` kept the older narrower story naming only the shell row, and
    all twelve tests here passed. That is precisely the drift this file was
    written to catch, committed by the file that catches it.

    They are different boundaries in the sense that matters to a reader — a
    shell string handed to `gates.run` versus a stdio session carried across
    the boundary — and the second is the one the re-test uses.

    **`both` added 2026-08-18, and the key is now read off the WHOLE row.**
    The 2026-08-16 Linux/Docker run attacked both spawn shapes — the ledger's
    result cell says *"Both spawn shapes (shell and ACP)"* — while its subject
    cell does not spell either word, so this function saw `shell`; and
    `SECURITY.md:187` labelled the row `shell worker`, which saw `shell` too.
    Two understatements agreeing is not agreement, and the set comparison
    below passed on it. Reading the whole row makes the ledger say `both` and
    reddens any narrative row that still says one shape.
    """
    lowered = text.lower()
    acp = "acp" in lowered
    shell = "shell" in lowered
    if acp and shell:
        return "both"
    return "acp" if acp else "shell"


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
    # **The shape that evaded every pattern above.** The first two require a
    # sequence LETTER within 40 characters; `docs/MANUAL_CHECKS.md:612` named
    # a PLATFORM and a RUNTIME instead — "The Linux arm is unrun and docker is
    # unrun" — and stayed green for two days after both had run and been
    # classified in that same file's own coverage record. An unrun-claim is a
    # claim about an attack sequence whether or not it spells the letter.
    r"\b(?:linux|docker|podman|nerdctl|macos)\b[^.]{0,40}?"
    r"\b(?:is|are|remains?|stays?)\s+(?:still\s+)?unrun\b",
    r"\b(?:is|are|remains?|stays?)\s+(?:still\s+)?unrun\b[^.]{0,40}?"
    r"\b(?:linux|docker|podman|nerdctl|macos)\b",
    r"\b(?:linux|docker|podman|nerdctl)\b[^.]{0,40}?"
    r"\b(?:is|are|remains?)\s+(?:still\s+)?unmeasured\b",
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


# How far either side of an unrun-claim to look for the combination it scopes
# itself to. Wider than MENTION_WINDOW's backward reach is not needed; a scope
# that is not in the same sentence is not a scope a reader will apply.
SCOPE_WINDOW = 160


def _scopes_itself_to_an_unmeasured_combination(text: str, start: int,
                                                end: int) -> bool:
    """Whether an unrun-claim names a combination the ledger really lacks.

    **Added 2026-08-18, and ruling 5 forced it.** *"`unmeasured` is a
    legitimate cell"* — but before this, no watched document could name a
    genuine gap at all: `sequence I on Linux + podman is unrun` is TRUE, has
    never run, and reddened this guard exactly as hard as the false
    unscoped claim did. A guard that forbids the honest word pushes documents
    towards vagueness, which is the failure it exists to prevent wearing a
    different coat.

    So the escape hatch is DERIVED rather than granted: the claim must name a
    sequence, a platform AND a runtime, and that triple must be absent from
    the ledger's classified runs. `sequence G on Linux with podman is unrun`
    still reddens, because 2026-08-13 says otherwise. An unscoped
    `sequence I is unrun` still reddens, because it claims more than any gap.
    """
    window = text[max(0, start - SCOPE_WINDOW):end + SCOPE_WINDOW]
    named = re.search(r"sequence\s+([GI])\b", window, re.IGNORECASE)
    if named is None:
        return False
    platform = platform_family(window)
    runtime = runtime_family(window)
    if platform == "?" or runtime in ("?", "none"):
        return False
    triple = (named.group(1).upper(), platform, runtime)
    carried = {(sequence, host, engine)
               for sequence, host, engine, _date, _worker in ledger_keys()}
    return triple not in carried


def _is_permitted(text: str, start: int, end: int) -> bool:
    return (
        _is_a_mention(text, start)
        or _scopes_itself_to_an_unmeasured_combination(text, start, end)
    )


@pytest.mark.parametrize("document", watched_documents())
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
            assert _is_permitted(text, found.start(), found.end()), (
                f"{document} asserts {found.group(0)!r}, and "
                f"{LEDGER}'s coverage record carries "
                f"{len(classified)} classified attack run(s). Understatement "
                "is a stale claim too — correct the sentence, or, if it is "
                "history, date it and say so in the same breath"
            )


def product_claims() -> dict[str, str]:
    """The isolation sentences Wringer SHIPS, by value rather than by source.

    A document nobody opens going stale is bad; a **record** going stale is
    worse, because it travels. `execution.json`'s `limits` array and the run
    summary's *"Where these gates ran"* section are handed to strangers as
    evidence, and both carried "sequence G … is unrun" for two days after
    sequence G ran.

    Read as values, not as file text: a guard grepping `backend.py` would pass
    the moment somebody moved the string to a constant, and the thing that must
    be true is about what lands in the bundle.
    """
    from wringer import backend, config, containment, summary

    execution = backend.Container(
        settings=config.Execution(
            backend="container",
            runtime="podman",
            image="example/image:tag",
            network=False,
            env=(),
            user=None,
        )
    )
    return {
        "backend.LIMITS_V1": " ".join(backend.LIMITS_V1),
        "backend.LIMITS_V2": " ".join(backend.LIMITS_V2),
        "containment.LIMITS": " ".join(containment.LIMITS),
        "summary._execution_section": "\n".join(
            summary._execution_section(execution)
        ),
    }


@pytest.mark.parametrize("source", sorted(product_claims()))
def test_no_shipped_record_calls_a_classified_sequence_unrun(source):
    """**The same derivation, aimed at what travels.**

    `backend.LIMITS_V1` said *"docker is still unmeasured"* until 2026-08-15,
    which had been false since the 2026-08-14 Docker classification, and the
    run summary said sequence G *"is unrun"* for two days. Both were stamped
    into every new bundle. The guard that pinned the first of those sentences
    is `test_the_limits_never_inflate_the_container_claim`, and its own
    docstring had pre-authorised this edit — *"a future window that measures
    docker should have to edit this test"* — which is why the correction and
    the guard move together rather than one arriving later.
    """
    classified = [row for row in read_ledger()
                  if LEDGER_SUBJECTS.get(row.subject) == ATTACK
                  and row.classified]
    if not classified:  # pragma: no cover - the ledger has classified rows
        pytest.skip("no attack sequence is classified in the ledger")

    text = product_claims()[source]
    for pattern in UNRUN_CLAIMS:
        for found in re.finditer(pattern, text, re.IGNORECASE):
            assert _is_permitted(text, found.start(), found.end()), (
                f"{source} ships {found.group(0)!r} into every record it "
                f"writes, and {LEDGER} carries {len(classified)} classified "
                "attack run(s). A stale sentence in a document misleads a "
                "reader; a stale sentence in a record travels"
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


def read_narrative_table() -> set[tuple[str, str, str, str, str]]:
    """SECURITY.md's measured-results table, as (sequence, platform, runtime,
    date, worker) keys."""
    text = (repo_root() / NARRATIVE).read_text(encoding="utf-8")
    assert NARRATIVE_HEADING in text, (
        f"{NARRATIVE} lost the heading this guard reads "
        f"({NARRATIVE_HEADING!r}); the results table cannot be found"
    )
    after = text.split(NARRATIVE_HEADING, 1)[1]

    keys: set[tuple[str, str, str, str, str]] = set()
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
            assert cells[:5] == [
                "sequence", "platform", "runtime", "date", "worker"
            ], (
                f"{NARRATIVE}'s results table no longer carries the columns "
                f"this guard derives from; it reads {cells[:5]}"
            )
            started = True
            continue
        if len(cells) < 5:
            continue
        keys.add(
            (
                cells[0].strip().upper(),
                platform_family(cells[1]),
                runtime_family(cells[2]),
                cells[3].strip(),
                # **The whole row, not just the worker cell.** Symmetric with
                # the ledger side below: a row that says "Both spawn shapes"
                # in its results and `shell worker` in its label is claiming
                # two things, and the wider read is the honest one.
                spawn_family(" ".join(cells)),
            )
        )
    assert started, f"{NARRATIVE} has no results table under {NARRATIVE_HEADING!r}"
    return keys


def ledger_keys() -> set[tuple[str, str, str, str, str]]:
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
                spawn_family(f"{row.subject} {row.result}"),
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


def test_the_watched_scope_is_wider_than_the_four_names_it_replaced():
    """**Found by sweeping this window's own change, 2026-08-23.**

    `watched_documents()` replaced a tuple of four filenames, and reverting it
    to that tuple reddened nothing — the derivation was unevidenced, so a
    later window could narrow it back with the suite green throughout.

    That matters more here than almost anywhere: this file exists because two
    hand-kept prose surfaces with no derived relationship went stale in
    opposite directions for two days, and an unguarded derivation is the same
    hole one level up.
    """
    scope = set(watched_documents())
    assert {"SECURITY.md", "README.md", "SETUP.md", LEDGER} <= scope
    assert "AGENTS.md" in scope, (
        "AGENTS.md is outside the isolation guard again — it is the page that "
        "told every window sequence G was unrun ten days after it ran"
    )
    assert len(scope) > 20, (
        f"only {len(scope)} pages watched; the tuple this replaced had four"
    )
    assert not any(name.startswith("docs/specs/") for name in scope)
