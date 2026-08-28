"""`certificate.md` and `certificate.json` — docs/specs/SPEC_CERTIFICATE_V0.md.

**The proof must TRAVEL.** A cold reviewer, handed a branch and a document,
read the delivery and wrote down four things they could not do (field report
2026-08-27, "The judgement you asked for"):

> "Unevidenced" isn't a word I use … It doesn't say which six. That's the big
> one … "1 for a person to judge" doesn't say it was judged … Nothing names
> the one proved criterion either.

Every one of those is a RENDERING failure, not a recording failure. The run
that produced them had all four facts on disk, in `acceptance.json`, and put
none of them in the two files that go with the code. This module is that
rendering, and its acceptance list is the reviewer's own four sentences.

Two artifacts, one source:

- **`certificate.json`** — the machine record, `wringer.certificate.v1`. A
  NEW sibling file rather than a change to any published schema, which is
  what the frozen-schema law allows and requires.
- **`certificate.md`** — the face. Rendered from the record and from nothing
  else, so the page cannot come to say more than the record holds.

**The face grows; the record does not.** This version records exactly the
facts this slice earns. Later facts — a coverage number, a falsification
result — ride their own sibling records and the face renders them where it
finds them. There are deliberately no empty fields here waiting to be filled:
a key present and null is a claim that the question was asked.

**Nothing here calls an LLM or opens a socket**, and `check` — the offline
verification a stranger runs — reads files and nothing else.

**Author-blind by construction.** `check` never reads who wrote the branch,
which agent produced it, or who signed the judgement: not the commit author,
not the committer, not `judgement.by`, not any worker identity. A verification
whose answer moves when the author changes is a verification of the author.
`test_certificate.py` proves it by moving all of them and re-checking.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from wringer import accept, evidence

SCHEMA_VERSION = "wringer.certificate.v1"
RECORD_FILENAME = "certificate.json"
FACE_FILENAME = "certificate.md"
BOARD_FILENAME = "board.html"

_GIT_TIMEOUT_SECONDS = 10


# --- the plain English, which is the whole of gap 1 -------------------------
#
# The reviewer's objection was not that the record was wrong. It was that
# `unevidenced` is a word they do not use, and `6 of 8 requirements have no
# test proving them` would have landed faster. So every state a reader can
# meet has a phrase written for a reader, and the machine words never reach
# the page.
#
# Keyed on `(state, cause)` because the cause is what distinguishes the four
# ways a requirement can be unproved, and telling a reader "no check proves
# this" when a check IS bound and has simply never been red would send them
# to write a check that already exists.

#: The chip above a requirement's title. Short, upper case, and a person's
#: words.
PROVED = "PROVED"
NO_CHECK = "NO CHECK PROVES THIS"
NEVER_FAILED = "ITS CHECK HAS NEVER FAILED"
CHECK_CAME_WITH_THE_WORK = "ITS CHECK ARRIVED WITH THE CHANGE"
CHECK_AGE_UNKNOWN = "ITS CHECK CANNOT BE DATED"
CHECK_PROVED_NOTHING = "THE CHECK WRITTEN FOR IT PROVED NOTHING"
FAILING = "ITS CHECK FAILED"
DID_NOT_RUN = "ITS CHECK DID NOT RUN"
JUDGED_MET = "A PERSON SAID YES"
JUDGED_NOT_MET = "A PERSON SAID NO"
AWAITING_A_PERSON = "WAITING FOR A PERSON"
REWORDED_SINCE_JUDGED = "REWORDED SINCE THE PERSON ANSWERED"
UNKNOWN = "THIS PAGE CANNOT READ THIS ROW"

#: `(state, cause)` → the chip, and the sentence under it. Total over the
#: five states and the eight causes `accept.CAUSES` declares; a pair this
#: table does not know renders `UNKNOWN` and says so, rather than picking the
#: nearest phrase. A wrong plain-English label is worse than a machine word,
#: because it reads as though somebody checked.
_PHRASES: dict[tuple[str, str | None], tuple[str, str]] = {
    (accept.EVIDENCED, None): (
        PROVED,
        "A check covers this, it passed here, and the record shows that same "
        "check failing before. That is the whole claim: it did not work, and "
        "now it does.",
    ),
    (accept.UNEVIDENCED, accept.CAUSE_UNBOUND): (
        NO_CHECK,
        "Nothing tests this. It is not failing — nobody is looking, so this "
        "page cannot tell you either way.",
    ),
    (accept.UNEVIDENCED, accept.CAUSE_BORN_GREEN): (
        NEVER_FAILED,
        "A check is meant to prove this and it passed, but nothing on record "
        "shows it ever failing. A check that has only ever been green has not "
        "shown it can tell the difference.",
    ),
    (accept.UNEVIDENCED, accept.CAUSE_ARRIVED_WITH_THE_WORK): (
        CHECK_CAME_WITH_THE_WORK,
        "The check that passes here was written as part of this change, so it "
        "failed beforehand only because it did not exist yet.",
    ),
    (accept.UNEVIDENCED, accept.CAUSE_PRE_EXISTENCE_UNESTABLISHED): (
        CHECK_AGE_UNKNOWN,
        "The check passes and has failed before, but this run could not "
        "establish that it existed before the change — so it cannot be told "
        "apart from a check written alongside the work.",
    ),
    (accept.UNEVIDENCED, accept.CAUSE_WITNESS_EVIDENCED_NOTHING): (
        CHECK_PROVED_NOTHING,
        "A check was written for this and it demonstrated nothing, so it was "
        "put aside. Nothing proves this requirement.",
    ),
    (accept.GATE_FAILED, None): (
        FAILING,
        "The check that covers this ran and failed, so the requirement is not "
        "met. This is the ordinary, honest state of work in progress.",
    ),
    (accept.GATE_DID_NOT_RUN, None): (
        DID_NOT_RUN,
        "A check covers this and it left no result in this round, so this "
        "round says nothing about it either way.",
    ),
    # **`(UNEVIDENCED, None)` and `(HUMAN, None)` are REACHABLE, and the
    # first draft of this table had neither.** `cause` is v3-only, so a v1 or
    # v2 `acceptance.json` — still published, still valid, still read forever
    # — carries every unproved row with no cause at all. The draft's `(HUMAN,
    # None)` said *"a person looked and said it was met"*, which over a v2
    # record would have invented a verdict nobody gave, in the one place this
    # document exists to render a person's actual answer.
    (accept.UNEVIDENCED, None): (
        NO_CHECK,
        "Nothing in this run proves this. The record does not say which of "
        "the several reasons applies — an older record than this document "
        "reads does not carry that fact — so this says only what it knows.",
    ),
    (accept.HUMAN, None): (
        AWAITING_A_PERSON,
        "No check can settle this one, and this record carries no answer to "
        "it.",
    ),
    (accept.HUMAN, accept.CAUSE_HUMAN_UNANSWERED): (
        AWAITING_A_PERSON,
        "No check can settle this one, and nobody has answered it yet.",
    ),
    (accept.HUMAN, accept.CAUSE_HUMAN_SAID_NO): (
        JUDGED_NOT_MET,
        "No check can settle this one. A person looked and said it was NOT "
        "met; their answer, and their words, are below.",
    ),
    (accept.HUMAN, accept.CAUSE_HUMAN_JUDGEMENT_STALE): (
        REWORDED_SINCE_JUDGED,
        "A person answered this, and the requirement has been reworded since. "
        "Their answer was about different words, so it no longer settles it.",
    ),
}

#: How each receipt kind reads to somebody who has not been taught the word.
#: The run id is filled in; the path to the bundle is NOT, because a page that
#: needs a path into someone else's `.wringer/` is the page the reviewer
#: already complained about.
_RECEIPTS = {
    accept.FAILURE: (
        "the same check is on record failing for real, in run `{run}`"
    ),
    accept.SENSITIVE: (
        "the same check was run against the tree as it stood BEFORE this "
        "change and failed there, and passes here — recorded in run `{run}`"
    ),
    accept.WITNESS: (
        "a check written for this requirement was watched failing on the tree "
        "as it stood before the work, and passes now — recorded in run `{run}`"
    ),
}

#: What this document does NOT say, travelling ON the document. The claim
#: ceiling, and the one the whole slice most needs: a certificate is a
#: rendering of a record, and a record can be complete and still describe
#: work nobody wanted.
LIMITS = (
    "This says what the record holds. It does not say the requirements were "
    "the right ones, and it cannot: somebody wrote them, and a change can "
    "satisfy every word of a requirement that describes the wrong thing.",
    "A proved requirement means one named check failed before and passes now. "
    "It does not mean the check covers everything the requirement means — "
    "`wring health` is what watches coverage narrow over time.",
    "A person's verdict is recorded, never scored and never verified. The "
    "name beside it is what somebody typed.",
    "Checking this document offline proves the record is internally "
    "consistent and matches the clone in front of you. It proves nothing "
    "about whether the work is any good.",
)


def _plain(
    state: str, cause: str | None, judgement: Any = None
) -> tuple[str, str]:
    """The chip and sentence for one row, or the honest refusal to translate.

    `UNKNOWN` is a real outcome and not a fallback: a `(state, cause)` this
    table has never met is a row this version of the page cannot describe,
    and rendering the nearest phrase would be a guess wearing a verdict's
    clothes. The board makes the same refusal with its UNTRANSLATED chip and
    for the same reason.

    **`judgement` decides a settled human row, and `cause` decides the rest.**
    A v3 `human` row that a person answered `met` carries no cause — there is
    nothing to explain it from — so the cause alone cannot tell "answered
    yes" from "an older record that never recorded answers at all". The
    ANSWER is what says somebody answered, which is the fact the whole row is
    about.
    """
    if state == accept.HUMAN and cause is None:
        if isinstance(judgement, dict) and judgement.get("verdict") == "met":
            return (
                JUDGED_MET,
                "No check can settle this one. A person looked and said it "
                "was met; their answer, and their words, are below.",
            )
    found = _PHRASES.get((state, cause))
    if found is not None:
        return found
    return (
        UNKNOWN,
        "The record describes this requirement in a way this document does "
        "not have wording for, so it is showing you nothing rather than a "
        "guess.",
    )


# --- the record ------------------------------------------------------------


def build(
    root: Path,
    run_dir: Path,
    *,
    title: str,
    branch: str,
    base: str,
    head_sha: str | None,
    files_changed: int,
    spec_sha256: str | None,
    run_relative: str,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """The machine record, or None when this repository declared no spec.

    None is the opt-in boundary, unchanged everywhere else in this program: a
    repository that never ran `wring spec` has no requirements, and a
    certificate over zero requirements would be a document asserting that
    nothing was asked for. It is not written at all rather than written empty.

    **This re-reads nothing.** Every requirement fact comes out of the
    `acceptance.json` `wring verify` already wrote; this module joins it to
    the change and renders it. A second assessor here would be a second
    opinion about the same run, and the two would drift.
    """
    recorded = accept.read(run_dir)
    if not recorded:
        return None
    rows = recorded.get("criteria")
    if not isinstance(rows, list) or not rows:
        return None

    stamped = (now or datetime.now().astimezone()).replace(microsecond=0)
    requirements = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        chip, sentence = _plain(
            row.get("state", ""), row.get("cause"), row.get("judgement")
        )
        requirements.append(
            {
                "id": row.get("criterion"),
                "title": row.get("title"),
                "required": row.get("required"),
                "state": row.get("state"),
                # The plain words, IN the record. They travel with the row
                # rather than being re-derived by each surface that renders
                # it — the same discipline `accept.disclosure` is under, for
                # the same reason: two renderers of one fact drift.
                "says": chip,
                "means": sentence,
                "check": row.get("gate"),
                "command": row.get("command"),
                "receipt": row.get("receipt"),
                "reason": row.get("reason"),
                "refuses": row.get("refuses"),
                "judgement": row.get("judgement"),
            }
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "written_at": stamped.isoformat(),
        "change": {
            "title": title,
            "branch": branch,
            "base": base,
            "commit": head_sha,
            "files_changed": files_changed,
        },
        "run": {"id": run_dir.name, "bundle": run_relative},
        "spec": {"sha256": spec_sha256},
        "acceptance": {
            "schema_version": recorded.get("schema_version"),
            "counts": recorded.get("counts") or {},
        },
        "requirements": requirements,
        # The acceptance record's own ceiling travels with the numbers it is
        # about, and this document's ceiling is added to it rather than
        # replacing it. A shorter list on the more portable artifact would be
        # the ceiling quietly rising as the document travels further.
        #
        # This document's own go FIRST: the face renders them first, and a
        # record whose order contradicted its face would be one more pair of
        # surfaces to keep in step.
        "limits": list(LIMITS) + list(recorded.get("limits") or []),
    }


# --- the face --------------------------------------------------------------


def headline(payload: dict[str, Any]) -> list[str]:
    """The one-line answer, in the reviewer's own words.

    *"'6 of 8 requirements have no test proving them' would land faster."*
    So this counts, in that shape, and never once says `unevidenced`.
    """
    rows = payload.get("requirements") or []
    total = len(rows)
    if not total:
        return []
    proved = sum(1 for row in rows if row.get("state") == accept.EVIDENCED)
    unproved = sum(1 for row in rows if row.get("state") == accept.UNEVIDENCED)
    failing = sum(1 for row in rows if row.get("state") == accept.GATE_FAILED)
    absent = sum(1 for row in rows if row.get("state") == accept.GATE_DID_NOT_RUN)
    people = sum(1 for row in rows if row.get("state") == accept.HUMAN)

    # The count goes in the lead-in and NOT in every bullet under it. The
    # first draft read "2 of 8 are proved — a check covers it", which is the
    # sentence a program assembles rather than one somebody wrote: the number
    # repeated four times and the pronoun disagreeing with it.
    lines = [
        f"Of the {total} requirement{'' if total == 1 else 's'} this change "
        "was asked to satisfy:",
        "",
    ]
    lines.append(
        f"- **{proved} {'is' if proved == 1 else 'are'} proved** — a check "
        f"covers {'it' if proved == 1 else 'each of them'}, and the record "
        f"shows that same check failing before."
        if proved
        else "- **none of them is proved** — nothing here has a check that "
        "was watched to fail and then pass."
    )
    if unproved:
        lines.append(
            f"- **{unproved} {'has' if unproved == 1 else 'have'} no check "
            f"proving {'it' if unproved == 1 else 'them'}.**"
        )
    if failing:
        lines.append(
            f"- **{failing} {'has a check that' if failing == 1 else 'have checks that'} "
            "ran and failed.**"
        )
    if absent:
        lines.append(
            f"- **{absent} {'has a check that' if absent == 1 else 'have checks that'} "
            "did not run in this round.**"
        )
    if people:
        lines.append(
            f"- **{people} can only be settled by a person.** Their answer, if "
            f"{'they have' if people != 1 else 'it has been'} given, is below."
        )
    return lines


def _receipt_line(row: dict[str, Any]) -> str | None:
    receipt = row.get("receipt")
    if not isinstance(receipt, dict):
        return None
    template = _RECEIPTS.get(receipt.get("kind"))
    if template is None:
        return None
    bundle = receipt.get("bundle") or ""
    # The RUN, never the path. The reviewer's complaint was that the page
    # sent them to a machine they do not have; a run id is a name they can
    # quote back, and the path is in the machine record for whoever has it.
    said = template.format(run=Path(str(bundle)).name or "unknown")
    cites = receipt.get("cites")
    if cites:
        return f"{said}. That run's own line for it: `{cites}`"
    return said


def _judgement_lines(row: dict[str, Any]) -> list[str]:
    """WHO judged, WHAT they said, THEIR WORDS, and WHEN — gap 3, closed.

    *"'1 for a person to judge' doesn't say it was judged. You judged that
    criterion met, with a note. The MR doesn't show the verdict, the note, or
    who gave it. I'd assume it was still outstanding."*

    The note is rendered verbatim as a block quote and is never summarised.
    The body count for rendering it at all is `your words here5`: a
    placeholder with a stray keystroke reached `wringer.judgements.yaml` as
    the reason a requirement passed, travelled into a delivered branch, and
    was caught only because somebody opened the YAML — because no surface in
    the program showed a judgement note to anybody.
    """
    judged = row.get("judgement")
    if not isinstance(judged, dict):
        return []
    verdict = "MET" if judged.get("verdict") == "met" else "NOT MET"
    who = judged.get("by") or "somebody who left no name"
    when = judged.get("at") or "an unrecorded time"
    lines = [f"- Judged **{verdict}** by {who}, {when}."]
    note = judged.get("note")
    if note:
        lines.append("- In their words:")
        lines.append("")
        for piece in str(note).splitlines() or [""]:
            lines.append(f"  > {piece}")
    else:
        lines.append("- They left no note.")
    if judged.get("stale"):
        lines.append(
            "- ⚠ The requirement has been REWORDED since they answered, so "
            "their answer was about different words."
        )
    return lines


def requirement_lines(payload: dict[str, Any]) -> list[str]:
    """Every requirement BY TITLE with its state — gaps 2 and 4, closed.

    *"It doesn't say which six. That's the big one … Nothing names the one
    proved criterion either."*

    In the order the spec declares them, and sorted by nothing: ranking these
    would be this document deciding which debts matter, which is the
    reviewer's call and is the same reason `acceptance.json` refuses to sort.
    """
    rows = payload.get("requirements") or []
    if not rows:
        return []
    lines = []
    for row in rows:
        title = row.get("title") or row.get("id") or "an unnamed requirement"
        lines += ["", f"### {row.get('says')} — {title}", "", row.get("means") or ""]
        if not row.get("required"):
            lines.append("")
            lines.append("This one is optional: it never holds up a handover.")
        check = row.get("check")
        if check:
            command = row.get("command")
            lines.append("")
            lines.append(
                f"- Checked by `{check}`"
                + (f": `{command}`" if command else "")
            )
        receipt = _receipt_line(row)
        if receipt:
            lines.append(f"- Where it was seen failing: {receipt}")
        lines += _judgement_lines(row)
        if row.get("refuses"):
            lines.append("- **This one is holding up the handover.**")
    return lines


def render(payload: dict[str, Any]) -> str:
    """`certificate.md` — the face, from the record and from nothing else."""
    change = payload.get("change") or {}
    run = payload.get("run") or {}
    title = change.get("title") or "this change"

    lines = [
        f"# Certificate — {title}",
        "",
        "What was asked for, what came back, and what the record can actually "
        "show. Written by `wring deliver` from the record of the run that "
        "verified this change.",
        "",
        f"- branch: `{change.get('branch')}` onto `{change.get('base')}`",
        f"- verified at commit: `{change.get('commit') or 'unknown'}`",
        f"- files changed: {change.get('files_changed')}",
        f"- run: `{run.get('id')}`",
        f"- written: {payload.get('written_at')}",
        "",
        "## In one line",
        "",
    ]
    lines += headline(payload)
    lines += ["", "## Every requirement"]
    lines += requirement_lines(payload)

    # **Two groups, and the plain one leads.** The record's own ceiling
    # sentences are carried VERBATIM — they are the engine's careful words
    # about its own limits and rewriting them here would be a second copy
    # that could drift, and a ceiling nobody may lower. But they are written
    # in the record's vocabulary, and rendering them first would open the
    # section a reader most needs with the exact words that reader said they
    # do not use. So this document's own ceiling goes first, in the same
    # plain English as the rest of the page, and the record's follows under
    # its own attribution.
    carried = list(payload.get("limits") or [])
    mine = [limit for limit in carried if limit in LIMITS]
    theirs = [limit for limit in carried if limit not in LIMITS]
    lines += ["", "## What this does not say", ""]
    lines += [f"- {limit}" for limit in mine or carried]
    if mine and theirs:
        lines += [
            "",
            "And, in the engine's own words, what the record this was built "
            "from says it does not say:",
            "",
        ]
        lines += [f"- {limit}" for limit in theirs]
    lines += [
        "",
        "## Checking this yourself",
        "",
        "This document and the record beside it can be re-checked with no "
        "network, no model, and no account:",
        "",
        "```",
        f"wring audit {RECORD_FILENAME}",
        "```",
        "",
        "It reports one line per claim: that the numbers above match the rows "
        "below them, that the requirements listed are the ones this "
        "repository's approved spec declares, that the commit named is in "
        "this clone, and — for every proved requirement whose evidence "
        "travelled with this document — that the run named really does record "
        "that check failing. A claim it cannot check from here says so, in "
        "those words, and is never counted as a pass.",
        "",
        "It does not read who wrote the branch, which tool produced it, or "
        "whose name is on the judgement. The answer would not be a check on "
        "the work if it moved when the author did.",
        "",
    ]
    return "\n".join(lines) + "\n"


# --- checking it, offline (the stranger's command) --------------------------

#: Three outcomes, and the third is not a hedge. `check` runs against
#: whatever the reader happens to be holding: a full delivery, or a
#: certificate that arrived on its own. A claim whose evidence did not travel
#: has NOT been checked, and reporting that as either ✓ or ✗ would be a lie in
#: one of the two directions — the same reason `demonstrated_able_to_fail` is
#: three-valued rather than two.
HOLDS = "holds"
BROKEN = "broken"
NOT_HERE = "not-checkable-here"

_MARKS = {HOLDS: "✓", BROKEN: "✗", NOT_HERE: "−"}


@dataclass(frozen=True)
class Claim:
    """One checkable sentence, and what looking at it found."""

    what: str
    outcome: str
    detail: str = ""

    @property
    def mark(self) -> str:
        return _MARKS.get(self.outcome, "?")


@dataclass(frozen=True)
class Report:
    ok: bool
    claims: list[Claim] = field(default_factory=list)
    limits: list[str] = field(default_factory=list)

    def as_json(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "claims": [
                {"what": c.what, "outcome": c.outcome, "detail": c.detail}
                for c in self.claims
            ],
            "limits": list(self.limits),
        }


def is_certificate(path: Path) -> bool:
    """Whether this file is one, decided by its own declared version.

    By content and not by name: a certificate that somebody renamed is still
    a certificate, and a `certificate.json` that declares something else is
    not one this version knows how to read.
    """
    if not path.is_file():
        return False
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return False
    return (
        isinstance(loaded, dict)
        and loaded.get("schema_version") == SCHEMA_VERSION
    )


def _git(root: Path, args: list[str]) -> tuple[int, str]:
    try:
        done = subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True,
            text=True,
            check=False,
            timeout=_GIT_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        return 127, ""
    return done.returncode, (done.stdout or "").strip()


def _check_counts(payload: dict[str, Any]) -> Claim:
    """The headline against the rows it claims to count.

    The cheapest forgery is an edited number: the rows stay honest and the
    summary above them does not. It is also the only claim on the page that
    can be checked with nothing but the page.
    """
    counts = (payload.get("acceptance") or {}).get("counts") or {}
    rows = payload.get("requirements") or []
    tallied: dict[str, int] = {state: 0 for state in accept.STATES}
    for row in rows:
        state = row.get("state")
        if state in tallied:
            tallied[state] += 1
    recorded = {state: int(counts.get(state, 0)) for state in accept.STATES}
    if recorded == tallied:
        return Claim(
            "the counts match the requirements listed below them",
            HOLDS,
            f"{len(rows)} requirement{'' if len(rows) == 1 else 's'}",
        )
    return Claim(
        "the counts match the requirements listed below them",
        BROKEN,
        f"the document says {recorded} and the rows are {tallied}",
    )


def _check_spec(payload: dict[str, Any], root: Path) -> list[Claim]:
    """The requirements listed against the ones the clone's spec declares.

    **The anti-fabrication check, and the strongest thing here.** A
    certificate is a claim about a spec; a certificate naming requirements
    that spec does not contain is the forgery worth catching, and it needs no
    evidence bundle at all — only the clone the reviewer already has.
    """
    from wringer import spec as spec_module

    what = "the requirements listed are the ones this repository declares"
    path = root / spec_module.SPEC_FILENAME
    if not path.is_file():
        return [
            Claim(
                what,
                NOT_HERE,
                f"there is no {spec_module.SPEC_FILENAME} in {root}",
            )
        ]
    try:
        loaded = spec_module.load(path)
    except Exception as exc:  # noqa: BLE001 — any unreadable spec is the same answer
        return [Claim(what, NOT_HERE, f"the spec could not be read: {exc}")]

    declared = [criterion.id for criterion in loaded.criteria]
    listed = [row.get("id") for row in payload.get("requirements") or []]
    claims = []
    if declared == listed:
        claims.append(
            Claim(
                what,
                HOLDS,
                f"{len(listed)} requirement{'' if len(listed) == 1 else 's'}, "
                "in order",
            )
        )
    else:
        missing = [one for one in listed if one not in declared]
        claims.append(
            Claim(
                what,
                BROKEN,
                (
                    f"this document lists {listed} and the spec declares "
                    f"{declared}"
                )
                if not missing
                else (
                    "this document names requirements the spec does not "
                    f"declare: {missing}"
                ),
            )
        )

    digest = (payload.get("spec") or {}).get("sha256")
    said = "the spec in this clone is the one this document was written against"
    if not digest:
        claims.append(
            Claim(said, NOT_HERE, "this document names no spec")
        )
    else:
        actual = spec_module.authorising_sha256(root)
        if actual is None:
            claims.append(
                Claim(said, NOT_HERE, f"this clone's {path.name} cannot be read")
            )
        elif actual == digest:
            claims.append(Claim(said, HOLDS, digest))
        else:
            # **Not automatically a forgery, and it must not read as one.**
            # A spec edited after the run — an answer revised, a criterion
            # reworded — moves this digest legitimately, and the ids check
            # above is the one that catches a document describing a different
            # set of requirements. This says the bytes moved, which is a fact
            # the reader needs and not a verdict about anybody.
            claims.append(
                Claim(
                    said,
                    BROKEN,
                    f"this document names {digest} and the clone's "
                    f"{path.name} hashes to {actual} — the spec was edited "
                    "after this run, or this document is about another one",
                )
            )
    return claims


def _check_commit(payload: dict[str, Any], root: Path) -> Claim:
    """Is the commit this was verified at in the clone the reader has?

    **"There is no repository here" is not "this commit is fabricated", and
    the first draft reported them as the same thing.** A certificate read
    beside a checkout, or emailed on its own, would have come back ✗ on a
    claim nobody could have checked — teaching its reader that a red mark
    means nothing, which is the failure that costs a check its authority.
    """
    what = "the commit this was verified at is in this clone"
    commit = (payload.get("change") or {}).get("commit")
    if not commit:
        return Claim(what, NOT_HERE, "this document names no commit")
    code, _ = _git(root, ["rev-parse", "--git-dir"])
    if code == 127:
        return Claim(what, NOT_HERE, "git is not available here")
    if code != 0:
        return Claim(what, NOT_HERE, f"{root} is not a git repository")
    code, _ = _git(root, ["cat-file", "-e", f"{commit}^{{commit}}"])
    if code == 0:
        return Claim(what, HOLDS, str(commit))
    return Claim(what, BROKEN, f"{commit} is not an object in {root}")


def _check_receipts(payload: dict[str, Any], root: Path) -> list[Claim]:
    """✓/✗ per receipt — and `−` where the evidence did not travel.

    The join is `health.gate_runs`, which is the SAME reader `accept` used to
    write the receipt in the first place. A second implementation here could
    disagree with the engine about whether a run shows a check failing, and
    two answers to that question is the drift the whole program is about.
    """
    from wringer import health

    claims: list[Claim] = []
    wanted = [
        row
        for row in payload.get("requirements") or []
        if isinstance(row.get("receipt"), dict)
    ]
    if not wanted:
        return claims

    try:
        found = {
            bundle.receipt: bundle
            for bundle in health.discover(root).read
            if bundle.qualifying
        }
    except Exception:  # noqa: BLE001 — an unreadable tree checks nothing
        found = {}

    for row in wanted:
        receipt = row["receipt"]
        title = row.get("title") or row.get("id")
        what = f"the record shows the check for “{title}” failing"
        bundle = found.get(receipt.get("bundle"))
        if bundle is None:
            claims.append(
                Claim(
                    what,
                    NOT_HERE,
                    f"run `{Path(str(receipt.get('bundle') or '')).name}` did "
                    "not travel with this document, so nothing here can look",
                )
            )
            continue
        pair = (row.get("check"), row.get("command"))
        kind = receipt.get("kind")
        seen = False
        for run in health.gate_runs(bundle):
            if (run.gate_id, run.command) != pair:
                continue
            if kind == accept.FAILURE and run.genuine_failure:
                seen = True
                break
            if kind == accept.SENSITIVE and run.sensitive:
                seen = True
                break
        if seen:
            claims.append(Claim(what, HOLDS, f"run `{bundle.run_id}`"))
        elif kind == accept.WITNESS:
            # A witness is pinned over its own bytes and is checked by the
            # witness lane, not by a gate row. Saying `✗` because this
            # function cannot see it would be this check reporting its own
            # blind spot as the document's fault.
            claims.append(
                Claim(
                    what,
                    NOT_HERE,
                    "this was proved by a check Wringer wrote for it, which "
                    "is pinned in the run bundle rather than in the gate "
                    "rows this command reads",
                )
            )
        else:
            claims.append(
                Claim(
                    what,
                    BROKEN,
                    f"run `{bundle.run_id}` is here and does not record "
                    f"`{row.get('check')}` failing",
                )
            )
    return claims


def check(payload: dict[str, Any], root: Path) -> Report:
    """Re-check a certificate against a clone. Offline, and author-blind.

    No network, no model, no config: an auditor may not have a `.wringer.yaml`
    and must not need one, which is the contract `wring audit` already holds.

    **`ok` is false only on `broken`.** A claim this reader could not check is
    not a failure of the document — the delivery it came from may simply not
    have travelled — and marking it as one would teach readers that the
    ordinary case is a red page.
    """
    claims = [_check_counts(payload)]
    claims += _check_spec(payload, root)
    claims.append(_check_commit(payload, root))
    claims += _check_receipts(payload, root)
    return Report(
        ok=not any(claim.outcome == BROKEN for claim in claims),
        claims=claims,
        limits=list(payload.get("limits") or []),
    )


def read(path: Path) -> dict[str, Any]:
    """Load a certificate, or raise `ValueError` naming what is wrong."""
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError) as exc:
        raise ValueError(f"{path} could not be read: {exc}") from exc
    if not isinstance(loaded, dict):
        raise ValueError(f"{path} is not a certificate")
    version = loaded.get("schema_version")
    if version != SCHEMA_VERSION:
        raise ValueError(
            f"{path} declares {version!r}, which this version of wring does "
            f"not read. It reads {SCHEMA_VERSION!r}"
        )
    return loaded


# Re-exported so the delivery bundle names it from one place, the way
# `accept` re-exports its own filename from `evidence`.
DIGESTS_FILENAME = evidence.DIGESTS_FILENAME
