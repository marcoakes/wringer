"""The blocks every PM artifact opens with — ONE renderer, three surfaces.

**Marc, 2026-09-03, verbatim:** *"make sure the UX on all the PM artifacts
are really good — the ones you have done so far look crap; make them look
really professional and nice."* Measured on run 4B's real delivery: `mr.md`
opened with a bold counts sentence, a bulleted judgement, TWO stacked
blockquote warnings carrying four bold sub-sentences, a gate table, and then
"Every requirement" as a wall of `###` + paragraph pairs where five of seven
said the same "NO CHECK PROVES THIS" paragraph; `certificate.md` repeated
the same blocks under three headings; `summary.md` carried the same two
stacked callouts over a gate table. Runs 4/4B, 2026-09-01: the PM read
"green" as "everything proved", judged on a manual display, never saw which
credential would spend, and saw four unrelated ids.

So every markdown artifact now opens the same way, from this module:

1. the **fact block** — one two-column table (Requirement · Run · Branch →
   base · Verified at · Written);
2. the **outcome rail** — the six PM states (0.8.1, P1.8), one table row,
   ✓ / ✗ / — each with a word;
3. the four counts as one line, from `accept.disclosure` — unchanged, and
   still quoted verbatim by every surface.

**One derivation.** `derive` reads the record — the run's manifest and
acceptance file, the loop that cites the run, the deliveries and refusals
that name it — and decides each state from ONE fact. It lives in the engine
so the board can quote it through the seam (`tests/test_layer_seam.py`)
rather than keep a second derivation of "delivered" or "built"; the
certificate, the merge request and the bundle summary all call `rail` on
what `derive` returned. Three surfaces rendering "is this delivered?" for
themselves is the two-surfaces-one-fact drift this programme keeps finding.

**Three values, and the third is not a hedge.** `True` is a fact the record
carries; `False` is a fact the record carries against; `None` is NOTHING ON
RECORD when the artifact was written — `summary.md` is written by `wring
verify` before any delivery exists, so its rail says `—` for "Ready to
deliver" and "Delivered" by construction, and that is the claim ceiling
rather than a gap. No state implies the next.

**No score and no percentage anywhere** — six words, three glyphs.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from wringer import accept, evidence

# --- the six states (0.8.1, P1.8) -------------------------------------------
#
# Each is derived from a fact the record already carries; none implies the
# next. The order is the order a delivery reaches them.
BUILT = "built"
CHECKS_PASSING = "checks_passing"
REQUIREMENTS_PROVED = "requirements_proved"
JUDGEMENT_COMPLETE = "judgement_complete"
READY_TO_DELIVER = "ready_to_deliver"
DELIVERED = "delivered"

STATES = (
    BUILT,
    CHECKS_PASSING,
    REQUIREMENTS_PROVED,
    JUDGEMENT_COMPLETE,
    READY_TO_DELIVER,
    DELIVERED,
)

#: The PM's word for each state — the vocabulary the board, the console and
#: every artifact share. Keyed off `STATES` so a state without a word fails
#: a test rather than rendering its machine name.
WORDS = {
    BUILT: "Built",
    CHECKS_PASSING: "Checks passing",
    REQUIREMENTS_PROVED: "Requirements proved",
    JUDGEMENT_COMPLETE: "Human judgement complete",
    READY_TO_DELIVER: "Ready to deliver",
    DELIVERED: "Delivered",
}

#: The glyph and the word for each of the three values.
YES = "✓ yes"
NO = "✗ no"
NOT_RECORDED = "— not recorded"

LEGEND = (
    "✓ on record · ✗ on record against · — nothing on record when this was "
    "written. No state implies the next."
)


# --- the derivation ----------------------------------------------------------


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _built(root: Path, run_dir: Path) -> bool | None:
    """The loop whose manifest names this run as its final run, and how it
    ended. An EXACT join on `result.final_run` — the same rule the board's
    `loop_for_run` keeps: the loop that produced this run, never the newest."""
    from wringer import loop as loop_module

    loops = root / loop_module.LOOPS_DIRNAME
    if not loops.is_dir():
        return None
    for candidate in sorted(loops.iterdir(), reverse=True):
        manifest = _read_json(candidate / loop_module.MANIFEST_FILENAME)
        if manifest is None:
            continue
        result = manifest.get("result") or {}
        final = result.get("final_run") if isinstance(result, dict) else None
        if not isinstance(final, str) or Path(final).name != run_dir.name:
            continue
        return result.get("status") == "converged"
    return None


def _checks_passing(run_dir: Path) -> bool | None:
    manifest = _read_json(run_dir / evidence.MANIFEST_FILENAME)
    if manifest is None:
        return None
    result = manifest.get("result") or {}
    status = result.get("status") if isinstance(result, dict) else None
    if status == "passed":
        return True
    if status == "failed":
        return False
    return None


def _requirements(recorded: dict[str, Any] | None) -> tuple[bool | None, bool | None]:
    """`(requirements proved, human judgement complete)` from the acceptance
    record the run wrote — the same rows `accept.disclosure` counts."""
    if not recorded:
        return None, None
    rows = [r for r in recorded.get("criteria") or [] if isinstance(r, dict)]
    if not rows:
        return None, None
    machine = [r for r in rows if r.get("state") != accept.HUMAN]
    people = [r for r in rows if r.get("state") == accept.HUMAN]
    proved: bool | None
    if not machine:
        proved = None
    else:
        proved = all(r.get("state") == accept.EVIDENCED for r in machine)
    judged: bool | None
    if not people:
        judged = None
    else:
        answers = []
        for row in people:
            judgement = row.get("judgement")
            if isinstance(judgement, dict) and judgement.get("verdict") == "met":
                answers.append(not judgement.get("stale"))
            elif row.get("cause") is not None or isinstance(judgement, dict):
                answers.append(False)
            else:
                # A v1/v2 record: no cause and no judgement field at all, so
                # "unanswered" and "not recorded" cannot be told apart.
                answers.append(None)
        if any(a is None for a in answers):
            judged = None
        else:
            judged = all(answers)
    return proved, judged


def _deliveries(root: Path, run_dir: Path) -> tuple[bool | None, bool | None]:
    """`(ready to deliver, delivered)` from the delivery and refusal records
    that name this run. A delivery manifest is written after the plan
    refused nothing; `mode == "send"` with a commit is the delivery itself."""
    from wringer import deliver as deliver_module

    ready: bool | None = None
    delivered: bool | None = None
    deliveries = root / deliver_module.DELIVERIES_DIRNAME
    if deliveries.is_dir():
        for candidate in sorted(deliveries.iterdir()):
            manifest = _read_json(candidate / deliver_module.MANIFEST_FILENAME)
            if manifest is None:
                continue
            named = manifest.get("run_dir")
            if not isinstance(named, str) or Path(named).name != run_dir.name:
                continue
            ready = True
            result = manifest.get("result") or {}
            if (
                manifest.get("mode") == "send"
                and isinstance(result, dict)
                and result.get("commit")
            ):
                delivered = True
    refusals = root / deliver_module.REFUSALS_DIRNAME
    if ready is None and refusals.is_dir():
        for candidate in sorted(refusals.iterdir()):
            record = _read_json(candidate / deliver_module.REFUSAL_FILENAME)
            if record is None:
                continue
            if record.get("run") == run_dir.name:
                ready = False
    return ready, delivered


def derive(
    root: Path, run_dir: Path, *, ready: bool | None = None
) -> dict[str, bool | None]:
    """The six states for ONE run, each from one fact on record.

    `ready` is the one fact a caller may hold in hand rather than on disk:
    `wring deliver` writes the certificate and the merge request AFTER its
    plan refused nothing and BEFORE it writes the delivery manifest, so it
    passes what it knows. Every other caller reads the record.
    """
    recorded = accept.read(run_dir)
    proved, judged = _requirements(recorded)
    on_record, delivered = _deliveries(root, run_dir)
    return {
        BUILT: _built(root, run_dir),
        CHECKS_PASSING: _checks_passing(run_dir),
        REQUIREMENTS_PROVED: proved,
        JUDGEMENT_COMPLETE: judged,
        READY_TO_DELIVER: on_record if ready is None else ready,
        DELIVERED: delivered,
    }


# --- the rail ----------------------------------------------------------------


def _cell(value: bool | None) -> str:
    if value is True:
        return YES
    if value is False:
        return NO
    return NOT_RECORDED


def rail(states: dict[str, bool | None]) -> list[str]:
    """The outcome rail: one markdown table, one row, six states. Markdown
    lines, and the SAME bytes on every artifact that quotes it."""
    return [
        "| " + " | ".join(WORDS[state] for state in STATES) + " |",
        "|" + ":---:|" * len(STATES),
        "| " + " | ".join(_cell(states.get(state)) for state in STATES) + " |",
        "",
        f"_{LEGEND}_",
    ]


# --- the fact block ----------------------------------------------------------

REQUIREMENT = "Requirement"
RUN = "Run"
BRANCH = "Branch → base"
VERIFIED_AT = "Verified at"
WRITTEN = "Written"

#: The five rows, in this order, on every artifact.
FACTS = (REQUIREMENT, RUN, BRANCH, VERIFIED_AT, WRITTEN)


def fact_block(facts: dict[str, str]) -> list[str]:
    """The two-column table every artifact opens with.

    The Requirement row is the table's header row — the title reads as the
    document's subject rather than as a cell — and the other four follow.
    A fact the caller does not hold renders `—`, never a guess.
    """
    said = {label: (facts.get(label) or "—") for label in FACTS}
    lines = [
        f"| {REQUIREMENT} | {said[REQUIREMENT]} |",
        "|---|---|",
    ]
    for label in FACTS[1:]:
        lines.append(f"| **{label}** | {said[label]} |")
    return lines


def journey_for_run(root: Path, run_dir: Path) -> str | None:
    """The journey whose phases cite this run (0.8.7), or None — the same
    exact join the board makes, read through the engine's own reader."""
    journeys = root / evidence.JOURNEYS_DIRNAME
    if not journeys.is_dir():
        return None
    found = (p for p in journeys.iterdir() if p.is_dir())
    for candidate in sorted(found, reverse=True):
        record = evidence.read_journey(candidate)
        if record is None:
            continue
        for phase in record.get("phases") or []:
            if isinstance(phase, dict) and phase.get("id") == run_dir.name:
                named = record.get("journey_id")
                return named if isinstance(named, str) and named else None
    return None


def run_cell(root: Path, run_dir: Path) -> str:
    """The Run row's value: the run id, and the journey it belongs to when
    one cites it."""
    journey = journey_for_run(root, run_dir)
    if journey:
        return f"`{run_dir.name}` in journey `{journey}`"
    return f"`{run_dir.name}`"


# --- the one callout ---------------------------------------------------------


def callout(lead: str | None, bullets: list[str]) -> list[str]:
    """ONE blockquote: an optional lead sentence, then each sentence as its
    own bullet. Two stacked blockquotes over one gate table was the measured
    shape; this is the layout, and the sentences inside are unchanged."""
    if not lead and not bullets:
        return []
    lines = [""]
    if lead:
        lines.append(f"> {lead}")
        if bullets:
            lines.append(">")
    lines += [f"> - {one}" for one in bullets]
    return lines


def fenced(*commands: str) -> list[str]:
    """A command, in the only place a command appears: its own fenced block."""
    return ["```", *commands, "```"]


def spec_title(root: Path) -> str | None:
    """The requirement a run is about, in the person's own words.

    Read from the approved spec and never composed — the fact block's first
    row is the document's subject, and a title this module invented would be
    a second wording of something the spec already says. One reader, so the
    certificate, the merge request and the bundle summary cannot disagree
    about what the work was called.
    """
    from wringer import spec

    path = root / spec.SPEC_FILENAME
    if not path.is_file():
        return None
    try:
        return spec.load(path).title or None
    except Exception:
        return None
