"""What the loop was briefed with — `wringer.briefed.v1`.

*`WRINGER_RULING_2026-08-14` Phase 1's rider, sliced by Marc on 2026-08-15:
detection and refusal now, the stale-marking ledger event deferred until
`loop-event-v3`'s contents are settled, so v3 can be designed once carrying
both that event and the witness pin instead of costing two versions.*

**The hole this closes.** `deliver.py` writes `spec_sha256` at three sites
(`:90`, `:765`, `:1006`) and compared it at none, and `spec.authorising_sha256`
hashes the spec *as it is now* — so a delivery manifest said "authorised by
spec S" where S was whatever sat on disk at delivery time, which need not be
the spec the work was briefed against. `spec.py:186-204`'s own docstring named
the gap: *"a spec could be edited after approval with no trace."*

**Three documents, because three things authorise a loop's work:** the
approved spec (`approved: true` is the authority everything downstream runs
on), the rubric compiled from it (what "satisfied" means), and `.wringer.yaml`
(what "verified" means). A change to any of them after the brief means the
landed work answers a question that is no longer the one that was asked.

**A sibling file, not a manifest key and not a ledger event.**
`wringer.loop.v2`'s manifest is frozen, so this arrives as its own file on the
`digests.json` pattern — written before `write_digests`, so the loop's own
tamper-evidence covers it. **The absence of the file is the compatibility
boundary**: a run that no loop produced, and every loop bundle written before
this existed, delivers exactly as it did before.

**Two rulings inherited verbatim from `deliver.py`, and neither is negotiable
here.** *Invalidate after landing, never abort in flight* — the comparison
happens at an iteration boundary, after a worker's turn has completed, because
you cannot un-run an agent turn. And *nothing is reverted*: the work stays, the
loop stops, and delivery refuses. This module writes no file outside the loop
bundle and touches git not at all.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path

SCHEMA_VERSION = "wringer.briefed.v1"
BRIEFED_FILENAME = "briefed.json"

# The stop reason a loop uses when an authorising document moved under it.
# `wringer.loop.v2` froze `reason` as an OPEN string precisely so a new stop
# reason costs no schema version (SPEC_STABILITY_V0 §9), which is why this
# needs no `loop-event-v3` and the ruling's stale-marking event still does.
AUTHORITY_MOVED = "authority_moved"

# Repo-relative, in the order a reader would care about them.
AUTHORITY_DOCUMENTS: tuple[str, ...] = (
    "wringer.spec.yaml",
    "wringer.rubric.yaml",
    ".wringer.yaml",
)

# What the ITERATION BOUNDARY compares — the spec and the rubric, not the gate
# config, and the asymmetry is deliberate rather than an oversight.
#
# `.wringer.yaml` is re-read by `verify` on every single lap, so a change to it
# is OBSERVED and acted on: the next verification runs the gates as they now
# stand and the bundle records which ones those were. The spec and the rubric
# are never re-read by the loop at all, so a change to either is exactly the
# silent drift this rider exists for.
#
# It is also what keeps `wring resume` usable. Editing the worker between a
# kill and a resume is a documented workflow with a test
# (`test_a_killed_loop_resumes_from_its_ledger`), and `run.worker` lives in
# `.wringer.yaml` — so comparing the config here would stop every resumed loop
# on its first boundary for doing the thing the manual tells you to do.
#
# DELIVERY compares all three, because that is where the combined claim
# ("authorised by spec S, verified by gates G") is actually made.
BOUNDARY_DOCUMENTS: tuple[str, ...] = (
    "wringer.spec.yaml",
    "wringer.rubric.yaml",
)

WHY = {
    "wringer.spec.yaml": "the approved spec — the authority the work ran on",
    "wringer.rubric.yaml": "the rubric — what 'satisfied' means",
    ".wringer.yaml": "the gate config — what 'verified' means",
}


def _digest(path: Path) -> str | None:
    """sha256 of a file, or None when it is not there.

    None is a value and not a failure: a repository with no spec is the
    ordinary case, and recording `null` says "absent when the loop was
    briefed" — which is exactly what makes a spec APPEARING mid-loop a move
    rather than a silent nothing.
    """
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def capture(root: Path) -> dict[str, str | None]:
    """The digests of the documents that authorise this loop's work, now."""
    return {name: _digest(root / name) for name in AUTHORITY_DOCUMENTS}


def write(loop_dir: Path, documents: dict[str, str | None]) -> Path:
    """`briefed.json` in the loop bundle. Written before `digests.json`."""
    path = loop_dir / BRIEFED_FILENAME
    path.write_text(
        json.dumps(
            {
                "schema_version": SCHEMA_VERSION,
                "captured_at": datetime.now().astimezone().replace(
                    microsecond=0
                ).isoformat(),
                "documents": documents,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return path


def read(loop_dir: Path) -> dict[str, str | None] | None:
    """The recorded digests, or None when this loop recorded none.

    Total by construction, like `vacuity.read_verdict`: a file that cannot be
    read is treated as one that is not there. A damaged capture is not
    evidence that something moved, and refusing on it would turn an unreadable
    byte into an accusation.
    """
    try:
        raw = json.loads((loop_dir / BRIEFED_FILENAME).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    documents = raw.get("documents") if isinstance(raw, dict) else None
    if not isinstance(documents, dict):
        return None
    return {
        name: value
        for name, value in documents.items()
        if isinstance(name, str) and (value is None or isinstance(value, str))
    }


def moved(
    recorded: dict[str, str | None],
    current: dict[str, str | None],
    among: tuple[str, ...] = AUTHORITY_DOCUMENTS,
) -> tuple[str, ...]:
    """Which authorising documents are not what the loop was briefed with.

    Only names the capture actually holds: a capture written by an older
    version that recorded two documents is read as a statement about those
    two, never as a claim that the third was absent.
    """
    return tuple(
        name
        for name in among
        if name in recorded and recorded[name] != current.get(name)
    )


def _describe(name: str, before: str | None, after: str | None) -> str:
    if before is None:
        return f"  {name} did not exist when the loop was briefed and does now"
    if after is None:
        return f"  {name} existed when the loop was briefed and is now gone"
    why = WHY.get(name)
    changed = f"  {name} changed ({before[:12]} -> {after[:12]})"
    return f"{changed} — {why}" if why else changed


def refusal_message(
    run_id: str,
    loop_id: str,
    names: tuple[str, ...],
    recorded: dict[str, str | None],
    current: dict[str, str | None],
) -> str:
    """Actionable, per SPEC_VACUITY §3b's rule: say what moved and what to do.

    It deliberately does not tell anyone to revert. `deliver.py`'s standing
    ruling against auto-reversal binds every effects design in this program,
    and it binds the ADVICE too — an agent reading "revert" in a refusal is an
    agent about to undo work nobody asked it to undo.
    """
    lines = [
        f"refusing to deliver {run_id} — the work is stale. Loop {loop_id} was "
        f"briefed against a different version of what authorises it:",
        "",
    ]
    lines += [_describe(name, recorded.get(name), current.get(name)) for name in names]
    lines += [
        "",
        "The landed work is untouched and nothing has been reverted: a turn "
        "that has run cannot be un-run, and this refusal is about what the "
        "evidence proves, not about the tree.",
        "",
        "Re-run the loop against the documents as they now stand, and deliver "
        "that. There is no flag to wave this through — flags tighten, never "
        "loosen.",
    ]
    return "\n".join(lines)


def loop_for_run(root: Path, run_dir_relative: str) -> tuple[Path, str] | None:
    """The loop bundle whose final verification is this run, if there is one.

    Joined on `result.final_run`, which `loop.write_manifest` records in the
    same repo-relative posix form `deliver.plan` uses for `run_dir` — the two
    were already speaking the same dialect, which is the only reason this join
    is exact rather than a path-shaped guess.

    Returns None for a run no loop produced, which is every `wring verify` run
    and every bundle written before this existed.
    """
    from wringer.loop import LOOPS_DIRNAME, MANIFEST_FILENAME

    loops = root / LOOPS_DIRNAME
    if not loops.is_dir():
        return None
    for directory in sorted(loops.iterdir(), reverse=True):
        if not directory.is_dir():
            continue
        try:
            manifest = json.loads(
                (directory / MANIFEST_FILENAME).read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            continue
        result = manifest.get("result")
        if not isinstance(result, dict):
            continue
        if result.get("final_run") == run_dir_relative:
            return directory, str(manifest.get("loop_id") or directory.name)
    return None
