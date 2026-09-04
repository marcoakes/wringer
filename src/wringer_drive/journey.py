"""One journey identity over a drive's whole run (0.8.7, P1.14).

**The body count.** Runs 4 and 4B, 2026-09-01: one afternoon's work left a
spec id under `.wringer/specs/`, a loop id under `.wringer/loops/`, a run id
under `.wringer/runs/` and a delivery id under `.wringer/deliveries/`, each
printed on a different surface, and the operator saw four unrelated ids for
one piece of work. Nothing said they belonged together.

**A JOIN, never a rename.** Every engine id stays exactly where the engine
put it, with the name the engine gave it. This package — the drive, which is
the one process that sees all four — writes `.wringer/journeys/<id>/
journey.json` naming which ids belong to which phase of one run. The engine
never writes it and never reads it to decide anything; `wring explain
<journey dir>` walks it, and the board joins on a run id to name it.

**Writes fail quietly, for the resume record's reason.** The whole effect of
a failed write is *"nothing joins this run's ids"*, which is what shipped
before this file existed; the record makes a run legible and can never make
one proceed, so it must never be the reason one dies.

The names (`JOURNEYS_DIRNAME`, `JOURNEY_FILENAME`, `JOURNEY_SCHEMA_VERSION`)
are the ENGINE's, imported — two readers and one writer must agree, and the
drive may import the engine while the engine may not import the drive.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from wringer import evidence
from wringer_drive.steps import SHOW, Step

#: The drive's phases, and the engine bundle family each one's `id` names.
#: `verify` is not a drive phase: it is the run the build's loop produced,
#: recorded beneath the build so the board's join on a run id can find it.
PHASE_KINDS: dict[str, str] = {
    "setup": "other",
    "draft": "draft",
    "interview": "other",
    "read-back": "other",
    "approve": "other",
    "gates": "other",
    "show": "other",
    "build": "build",
    "verify": "verify",
    "deliver": "deliver",
}

#: The step id every phase entry is announced under — a driver routes on it.
HEADER_STEP_ID = "journey"


def journeys_root(repo: Path) -> Path:
    return repo / evidence.JOURNEYS_DIRNAME


def path_for(repo: Path, journey_id: str) -> Path:
    return journeys_root(repo) / journey_id / evidence.JOURNEY_FILENAME


def begin(repo: Path, now: datetime | None = None) -> str:
    """Allocate a journey id and write its empty record. Returns the id.

    The id is `evidence.new_run_id` — the same shape every engine bundle
    carries, so a journey sorts beside the runs it cites. The directory is
    allocated `exist_ok=False` like a loop's, so two drives started in the
    same second get two journeys. When nothing can be written the id is
    still returned: the run still has an identity to print, and the record
    is the part that failed.
    """
    started = now or datetime.now(UTC)
    root = journeys_root(repo)
    journey_id = evidence.new_run_id(started)
    try:
        root.mkdir(parents=True, exist_ok=True)
        for _ in range(64):
            journey_id = evidence.new_run_id(started)
            try:
                (root / journey_id).mkdir(exist_ok=False)
            except FileExistsError:
                continue
            break
        _write(
            repo,
            journey_id,
            {
                "schema_version": evidence.JOURNEY_SCHEMA_VERSION,
                "journey_id": journey_id,
                "started_at": evidence.timestamp(),
                "phases": [],
            },
        )
    except OSError:
        pass
    return journey_id


def continue_or_begin(repo: Path, recorded: object) -> str:
    """The journey a checkpoint names, when its record is still there; else a
    new one. A resume is a continuation (D4), so the resumed build's loop id
    lands in the SAME journey as the drafting it continues."""
    if isinstance(recorded, str) and recorded and _read(repo, recorded) is not None:
        return recorded
    return begin(repo)


def enter(repo: Path, journey_id: str, phase: str) -> None:
    """Record that `phase` began now — and close the phase before it as
    `completed`, because a phase can only begin once the previous one is
    over. Written BEFORE the phase runs, for the checkpoint's reason: a
    record written after knows nothing about the phase that died."""
    record = _read(repo, journey_id)
    if record is None:
        return
    now = evidence.timestamp()
    _close_open(record, now, "completed")
    record["phases"].append(
        {
            "phase": phase,
            "kind": PHASE_KINDS.get(phase, "other"),
            "id": None,
            "started_at": now,
            "ended_at": None,
            "outcome": None,
        }
    )
    _write(repo, journey_id, record)


def close(
    repo: Path, journey_id: str, outcome: str, engine_id: str | None = None
) -> None:
    """End the open phase with `outcome` (quoted, never composed here) and,
    when the engine named one, the id of the bundle it produced. A journey
    with no open phase is left alone."""
    record = _read(repo, journey_id)
    if record is None:
        return
    if _close_open(record, evidence.timestamp(), outcome, engine_id):
        _write(repo, journey_id, record)


def record(
    repo: Path, journey_id: str, phase: str, engine_id: str | None, outcome: str
) -> None:
    """Append a phase the drive only learned of after it happened — the
    verification run a build's loop produced. Both timestamps are NOW, the
    moment the drive learned of it; the run's own bundle carries its times."""
    found = _read(repo, journey_id)
    if found is None:
        return
    now = evidence.timestamp()
    found["phases"].append(
        {
            "phase": phase,
            "kind": PHASE_KINDS.get(phase, "other"),
            "id": engine_id,
            "started_at": now,
            "ended_at": now,
            "outcome": outcome,
        }
    )
    _write(repo, journey_id, found)


def header_step(journey_id: str, phase: str) -> Step:
    """THE ONE RENDERER of the phase header, `journey <id> · <phase>`,
    emitted once each time a phase is entered — the same object in both
    transports, so the terminal line and the json step cannot drift."""
    return Step(
        kind=SHOW,
        id=HEADER_STEP_ID,
        text=f"journey {journey_id} · {phase}",
        detail={"journey": journey_id, "phase": phase},
    )


def bundle_id(named: object) -> str | None:
    """The engine's id from a path it printed (`.wringer/loops/<id>`), or
    None. Basename only — the engine's ids are directory NAMES."""
    if not isinstance(named, str) or not named.strip():
        return None
    return named.rstrip("/").rsplit("/", 1)[-1] or None


def _close_open(
    record: dict[str, Any], now: str, outcome: str, engine_id: str | None = None
) -> bool:
    phases = record.get("phases")
    if not isinstance(phases, list) or not phases:
        return False
    last = phases[-1]
    if not isinstance(last, dict) or last.get("ended_at") is not None:
        return False
    last["ended_at"] = now
    last["outcome"] = outcome
    if engine_id is not None:
        last["id"] = engine_id
    return True


def _read(repo: Path, journey_id: str) -> dict[str, Any] | None:
    return evidence.read_journey(journeys_root(repo) / journey_id)


def _write(repo: Path, journey_id: str, payload: dict[str, Any]) -> None:
    try:
        path = path_for(repo, journey_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    except OSError:
        return
