"""`coverage.json` — docs/specs/SPEC_COVERAGE_V0.md. The number, and its twin.

**The field case, in one sentence.** On run 2's delivered board, 5 of 8
requirements had no check at all — and the defect that run existed to fix
landed exactly on one of the unwatched ones. Nothing anywhere carried that as
a NUMBER: `acceptance.json` held it per row, every surface counted STATES, and
"how much of what we asked for is anybody watching" was a question a person
had to answer by reading eight rows and doing arithmetic.

**RULED (MR1): two debts, two lines, never blended.**

> *N of M requirements carry a check that can prove them.*
>
> *K of H requirements that need a person have something to show them.*

A single number over both populations points nowhere: the remedy for the
first is to write a check, and the remedy for the second is to declare a
command that renders the thing a person is being asked to look at. A reader
told "6 of 9 covered" cannot tell which of those two jobs they have, and the
two are done by different people.

The populations are DISJOINT and together they are everything: a requirement
marked `human` can never carry a check — that is what the marking means — so
it is counted in the second line and nowhere in the first.

**Why there is a record at all.** The binding half is a RENDERING: the
acceptance record already holds, per row, which check binds it and whether a
witness covers it. The visibility half has no home anywhere — `show:` is
declared in the person's own `.wringer.yaml`, is read at render time, and is
recorded by nothing. So a new sibling file carries it, which is what the
frozen-schema law allows and requires; no published schema moves.

**One computation, one renderer.** `assess` is the only thing that decides
these numbers and `lines` is the only thing that words them, because this
programme's most-repeated failure is two surfaces describing one fact and
drifting. Every surface that carries the number quotes `lines` verbatim.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from wringer import accept, evidence

SCHEMA_VERSION = "wringer.coverage.v1"
COVERAGE_FILENAME = "coverage.json"

#: The claim ceiling, ON the surface rather than in a spec nobody opened, and
#: rendered wherever the number is. It is the honest reading of what was
#: counted: a BINDING, which is a declaration somebody made, and not a
#: measurement of how much of the requirement that check actually exercises.
LIMIT = (
    "This counts checks that are bound to a requirement. A bound check can "
    "still test less than the requirement means, and this number cannot see "
    "that — `wring health` is what watches coverage narrow over time."
)


@dataclass(frozen=True)
class Requirement:
    """One requirement, and whether anything is watching it.

    Two independent questions, and which one applies is the requirement's own
    kind. `covered` is meaningless for a requirement only a person can settle,
    and `shown` is meaningless for every other one — so each is None where it
    does not apply, rather than False. **False would be a debt somebody could
    pay; None is a question that was never asked**, and this programme has
    already ruled twice that collapsing those two is how a record comes to
    lie.
    """

    criterion: str
    title: str
    needs_a_person: bool
    covered: bool | None = None
    check: str | None = None
    shown: bool | None = None
    show: str | None = None

    def as_json(self) -> dict[str, Any]:
        return {
            "criterion": self.criterion,
            "title": self.title,
            "needs_a_person": self.needs_a_person,
            "covered": self.covered,
            "check": self.check,
            "shown": self.shown,
            "show": self.show,
        }


@dataclass(frozen=True)
class Coverage:
    """The two numbers, over an ENUMERATED population.

    A zero here is a real zero: the requirements are the ones an approved spec
    declares, so "none of them" is a count and not an absence. That is the
    same reason `accept.Result.counts` emits every state even at zero.
    """

    requirements: tuple[Requirement, ...] = ()

    @property
    def checkable(self) -> tuple[Requirement, ...]:
        return tuple(one for one in self.requirements if not one.needs_a_person)

    @property
    def people(self) -> tuple[Requirement, ...]:
        return tuple(one for one in self.requirements if one.needs_a_person)

    @property
    def covered(self) -> int:
        return sum(1 for one in self.checkable if one.covered)

    @property
    def shown(self) -> int:
        return sum(1 for one in self.people if one.shown)

    @property
    def unwatched(self) -> tuple[Requirement, ...]:
        """The ones with nothing checking them, in spec order.

        Named rather than only counted, for the same reason the certificate
        names requirements by title: a reader told there is a hole and not
        told where it is has been informed, not helped.
        """
        return tuple(one for one in self.checkable if not one.covered)

    @property
    def unshown(self) -> tuple[Requirement, ...]:
        return tuple(one for one in self.people if not one.shown)

    def as_json(self) -> dict[str, Any]:
        return {
            "schema_version": SCHEMA_VERSION,
            "counts": {
                "covered": self.covered,
                "checkable": len(self.checkable),
                "shown": self.shown,
                "needing_a_person": len(self.people),
            },
            "requirements": [one.as_json() for one in self.requirements],
            "limits": [LIMIT],
        }


def _covers(witness: Any) -> bool:
    """Whether a witness in a WRITTEN record may decide anything.

    The same rule as `accept.WitnessEvidence.covers`, read off the JSON: only
    a witness proved red for the right reason covers a requirement. It is
    computed from the record rather than imported as a property because the
    callers here hold bytes, not objects — the board and `wring audit` never
    see a `Row`.
    """
    return (
        isinstance(witness, dict)
        and witness.get("discarded") is None
        and witness.get("proved_red") == "assertion"
    )


def assess(rows: list[dict] | None, show: dict[str, str] | None) -> Coverage | None:
    """The only thing that decides these numbers.

    `rows` are acceptance rows as WRITTEN — v1, v2 or v3, all of which carry
    `state` and `gate`, and where `witness` is simply absent in v1 because a
    v1 record is only written when there was none.

    None for a repository that declared no requirements, which is the opt-in
    boundary every other artifact in this program draws in the same place.
    """
    if not rows:
        return None
    declared = show or {}
    found = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        ident = row.get("criterion")
        needs_a_person = row.get("state") == accept.HUMAN
        if needs_a_person:
            command = declared.get(ident)
            found.append(
                Requirement(
                    criterion=ident,
                    title=row.get("title") or ident,
                    needs_a_person=True,
                    shown=command is not None,
                    show=command,
                )
            )
            continue
        gate = row.get("gate")
        found.append(
            Requirement(
                criterion=ident,
                title=row.get("title") or ident,
                needs_a_person=False,
                covered=gate is not None or _covers(row.get("witness")),
                check=gate,
            )
        )
    return Coverage(requirements=tuple(found))


def lines(coverage: Coverage | None) -> list[str]:
    """The two sentences, and nothing else says them. Markdown lines.

    **Each line appears only when its population exists.** A repository with
    no requirement needing a person gets no visibility line — a sentence
    reading "0 of 0" is a caveat over a clean record, which is how a reader
    learns to skip caveats, and this programme has the body count for it.

    **No house vocabulary.** `criterion`, `unevidenced` and `proves:` are the
    machine's words; these sentences are read on the board by somebody who was
    never taught them, and the board's jargon guard covers this text.

    **Number agreement follows the POPULATION, not the count**, which is one
    rule rather than two and is the wording the ruling itself uses. Both
    alternatives were rendered and read: keying the verb off the count gives
    *"1 of 3 requirements carries"*, and keying the verb off one and the
    pronoun off the other gives *"0 of 1 requirement that needs a person have
    something to show them"* — which is what a real run printed before this
    was fixed. A sentence a program assembled is exactly what this project has
    a body count for.
    """
    if coverage is None:
        return []
    said = []
    checkable = coverage.checkable
    if checkable:
        said.append(
            f"**{coverage.covered} of {len(checkable)} "
            + (
                "requirement carries a check that can prove it.**"
                if len(checkable) == 1
                else "requirements carry a check that can prove them.**"
            )
        )
    people = coverage.people
    if people:
        # **Its OWN line, always** (ruling MR1). Never folded into the number
        # above it: the remedy for a missing check is to write one, and the
        # remedy here is to declare what a person should be shown. A reader
        # given one blended number cannot tell which job is theirs.
        said.append(
            f"**{coverage.shown} of {len(people)} "
            + (
                "requirement that needs a person has something to show it.**"
                if len(people) == 1
                else "requirements that need a person have something to show "
                "them.**"
            )
        )
    if not said:
        return []
    if coverage.unshown:
        said.append(
            "A person cannot judge what nothing will show them. Declare a "
            "command under `show:` for each of these and the next round will "
            "say so: "
            + ", ".join(one.title for one in coverage.unshown)
            + "."
        )
    said.append(LIMIT)
    return said


def unshowable(criteria: Any, show: dict[str, str] | None) -> list[Any]:
    """Spec criteria only a person can settle that nothing will show them.

    Takes the SPEC's criteria rather than an acceptance record, because this
    is asked at plan time — before any run exists, which is the whole point
    of asking it there.
    """
    declared = show or {}
    return [
        criterion
        for criterion in (criteria or ())
        if getattr(criterion, "human", False) and criterion.id not in declared
    ]


def plan_warning(criteria: Any, show: dict[str, str] | None) -> list[str]:
    """**A WARNING, by name, and never a refusal** — ruling MR2.

    A requirement marked `human` with no `show:` command is a requirement
    whose whole lifecycle ends with a person being asked to judge something
    nothing will put in front of them. That was measured in the field: on run
    2 the person was asked about the wording of a summary that appeared in no
    surface Wringer had, and the judgement was only possible because a coding
    agent pasted it into a chat window unprompted.

    **It does not refuse, and the reason is a body count that does not exist
    yet.** The only place this has hurt anybody is at the pen, and the pen now
    speaks in capitals — `wringer-board judge` says out loud that it is asking
    about something it cannot show. A plan-time refusal would stop work over a
    file the person can write at any point up to the moment they judge, and
    this project does not add a refusal without somebody having been hurt
    DESPITE the warning. When that happens, the ruling is already written.
    """
    missing = unshowable(criteria, show)
    if not missing:
        return []
    return [
        f"{len(missing)} requirement{'' if len(missing) == 1 else 's'} "
        f"here can only be settled by a person, and nothing is declared "
        f"that would show {'it' if len(missing) == 1 else 'them'}:",
        *[f"  - {one.id}: {one.title}" for one in missing],
        "Declare a command under `show:` in the project's settings for each "
        "of those, and whoever judges will see what they are judging. This "
        "is a warning, not a refusal — you can add them any time before "
        "somebody is asked.",
    ]


def quoted(coverage: Coverage | None) -> list[str]:
    """`lines`, as a markdown blockquote with the sentences kept APART.

    **The separator is load-bearing, not cosmetic.** Consecutive `> ` lines
    are one paragraph in every markdown renderer there is, so the first draft
    put the two numbers on a single rendered line — which is the blending
    ruling MR1 forbids, arriving through the formatting rather than through
    the arithmetic. Two debts have to LOOK like two.

    Used by `summary.md` and `mr.md` both, because two surfaces spacing one
    fact differently is the smaller version of the same problem.
    """
    said = lines(coverage)
    if not said:
        return []
    out = [""]
    for index, one in enumerate(said):
        if index:
            out.append(">")
        out.append(f"> {one}")
    return out


def write(directory: Path, coverage: Coverage, redactor: Any = None) -> Path:
    """Write `coverage.json` into a bundle. A NEW file; nothing else moves.

    Scrubbed like every other record here — `show` holds a command somebody
    declared, and a command can carry anything a person put in it.
    """
    payload = coverage.as_json()
    if redactor is not None:
        payload = evidence.deep_scrub(redactor, payload)
    path = directory / COVERAGE_FILENAME
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def read(run_dir: Path) -> dict[str, Any] | None:
    """The record a run wrote, or None. **Absent is absent.**

    A run from before this file existed has no coverage record, and that is
    not a coverage of zero — every surface that reads this renders nothing
    rather than a number nobody measured.
    """
    try:
        loaded = json.loads(
            (run_dir / COVERAGE_FILENAME).read_text(encoding="utf-8")
        )
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    if not isinstance(loaded, dict):
        return None
    if loaded.get("schema_version") != SCHEMA_VERSION:
        return None
    return loaded


def of(recorded: dict[str, Any] | None) -> Coverage | None:
    """Rebuild a `Coverage` from a record, so `lines` has one input shape.

    The alternative was a second renderer that reads the JSON directly, which
    is the two-implementations drift this module's whole docstring is about.
    """
    if not recorded:
        return None
    rows = recorded.get("requirements")
    if not isinstance(rows, list):
        return None
    return Coverage(
        requirements=tuple(
            Requirement(
                criterion=one.get("criterion"),
                title=one.get("title") or one.get("criterion"),
                needs_a_person=bool(one.get("needs_a_person")),
                covered=one.get("covered"),
                check=one.get("check"),
                shown=one.get("shown"),
                show=one.get("show"),
            )
            for one in rows
            if isinstance(one, dict)
        )
    )
