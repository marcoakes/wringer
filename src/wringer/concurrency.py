"""Which gates ran beside which — SPEC_PERF_V0.md.

**This file exists because `duration_ms` is not private to a run.** `wring health`
compares it across a window and flags drift past 2× (oldest-five median against
newest-five). Run two gates at once and every gate's wall clock inflates by an
amount nobody recorded, so a repo that turned concurrency on would read as
drifting everywhere at once — and the honest reading of that report is that *the
instrument moved*, not the gates.

That is SPEED_PLAN R1, and this is its first option taken: record the duration,
record that the gate ran concurrently, and let health **exclude** those rows from
drift rather than compare numbers that are not the same quantity. The plan also
flags the obstacle — `gate-result.schema.json` is frozen and closed, so the mark
cannot go on the row. It goes in a sibling instead, which is the same answer
`vacuity.json`, `acceptance.json` and `stability.json` each got.

A gate's PASS/FAIL is unaffected by concurrency, which is why the acceptance
receipt survives it (R4) and why nothing here touches a verdict. The only thing
concurrency changes is a number, and the only thing this file does is say which
numbers not to compare.

ABSENT from every bundle whose gates all ran alone — which is every bundle
written before this existed and every repo that has not declared `concurrent:
true` on anything.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from wringer import evidence

SCHEMA_VERSION = "wringer.concurrency.v1"
CONCURRENCY_FILENAME = evidence.CONCURRENCY_FILENAME


@dataclass(frozen=True)
class Ran:
    """One gate that ran beside others, and who they were.

    `beside` names them, because "this gate was concurrent" is not actionable on
    its own: a reader looking at an inflated duration wants to know what it was
    competing with.
    """

    gate_id: str
    group: int
    beside: tuple[str, ...]


def write(directory: Path, rows: list[Ran]) -> Path | None:
    """Write `concurrency.json`, or nothing when every gate ran alone.

    Nothing rather than an empty list, for the reason `stability.write` returns
    None: a reader must never have to tell an empty record from a missing one.
    """
    if not rows:
        return None
    payload = {
        "schema_version": SCHEMA_VERSION,
        "gates": [
            {
                "gate_id": row.gate_id,
                "group": row.group,
                "beside": list(row.beside),
            }
            for row in rows
        ],
    }
    path = directory / CONCURRENCY_FILENAME
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def read_ids(directory: Path) -> frozenset[str]:
    """Which gate ids in this bundle ran concurrently.

    Total by construction, like `vacuity.read_verdict`: a file that is missing,
    unparseable or the wrong shape yields an empty set rather than an exception.
    `wring health` reads bundles it did not write, including ones from a future
    version — and the failure mode of guessing here is that a real duration gets
    compared to a contended one.
    """
    try:
        raw = json.loads(
            (directory / CONCURRENCY_FILENAME).read_text(encoding="utf-8")
        )
    except (OSError, ValueError, UnicodeDecodeError):
        return frozenset()
    if not isinstance(raw, dict) or raw.get("schema_version") != SCHEMA_VERSION:
        return frozenset()
    rows = raw.get("gates")
    if not isinstance(rows, list):
        return frozenset()
    return frozenset(
        row["gate_id"]
        for row in rows
        if isinstance(row, dict) and isinstance(row.get("gate_id"), str)
    )
