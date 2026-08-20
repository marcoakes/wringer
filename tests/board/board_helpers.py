"""Board test helpers, named uniquely.

Both suites had a `conftest.py` and both did `from conftest import ...`.
Once the packages collapsed into one repository that became ambiguous —
core tests started resolving `conftest` to the board's and failed at
collection. Fixtures still live in `conftest.py`, which pytest auto-loads
per directory; anything imported BY NAME lives here.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    (tmp_path / ".wringer" / "runs").mkdir(parents=True)
    (tmp_path / ".wringer" / "loops").mkdir(parents=True)
    (tmp_path / "wringer.spec.yaml").write_text(
        "schema_version: wringer.spec.v1\n"
        "approved: true\n"
        "title: Weekly reports go out on time\n"
        "intent: |\n"
        "  Finance needs the weekly figures as a file they can open in a\n"
        "  spreadsheet, without asking anyone.\n",
        encoding="utf-8",
    )
    return tmp_path


def write_run(
    repo: Path,
    run_id: str,
    criteria: list[dict],
    *,
    version: str = "wringer.acceptance.v1",
    limits: list[str] | None = None,
    gates: dict[str, tuple[str, str]] | None = None,
    scoped_out: list[str] | None = None,
) -> Path:
    """One verify bundle, in the shape `accept.write` produces."""
    run = repo / ".wringer" / "runs" / run_id
    run.mkdir(parents=True, exist_ok=True)
    (run / "acceptance.json").write_text(
        json.dumps(
            {
                "schema_version": version,
                "criteria": criteria,
                "limits": limits
                or [
                    "A gate passing says the gate passed. It does not say the "
                    "criterion is met in every case the criterion could describe.",
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (run / "manifest.json").write_text(
        json.dumps(
            {"schema_version": "wringer.evidence.v1", "scoped_out": scoped_out or []}
        ),
        encoding="utf-8",
    )
    for index, (gate_id, (stream, text)) in enumerate(sorted((gates or {}).items())):
        directory = run / "gates" / f"{index:03d}_{gate_id}"
        directory.mkdir(parents=True, exist_ok=True)
        (directory / f"{stream}.log").write_text(text, encoding="utf-8")
        (directory / "result.json").write_text(
            json.dumps({"gate": gate_id, "status": "failed"}), encoding="utf-8"
        )
    return run


def write_loop(repo: Path, loop_id: str, run_ids: list[str]) -> Path:
    """A loop ledger whose `verify.finished` events order the runs.

    Ruling 8: the order comes from HERE and never from the ids, which are
    `<date>-<HHMMSS>-<4 hex>` and do not sort chronologically.
    """
    loop = repo / ".wringer" / "loops" / loop_id
    loop.mkdir(parents=True, exist_ok=True)
    lines = [
        json.dumps(
            {
                "type": "verify.finished",
                "iteration": index + 1,
                "status": "failed",
                "evidence_dir": f".wringer/runs/{run_id}",
            }
        )
        for index, run_id in enumerate(run_ids)
    ]
    (loop / "loop.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return loop


# --- the artifacts the ROUND section reads -----------------------------------
#
# One writer per artifact, and each writes the shape traced in the engine's own
# source rather than one invented here — the trace is in `read.py`'s constants
# block. They are separate from `write_run`/`write_loop` on purpose: **absence
# has to be reachable**, and a fixture that always wrote a loop manifest beside
# a loop ledger would make the absence discipline untestable.


def write_loop_manifest(
    repo: Path, loop_id: str, reason: str, *, version: str = "wringer.loop.v2"
) -> Path:
    """`.wringer/loops/<id>/manifest.json` — `result.reason` is the ending."""
    loop = repo / ".wringer" / "loops" / loop_id
    loop.mkdir(parents=True, exist_ok=True)
    path = loop / "manifest.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": version,
                "loop_id": loop_id,
                "started_at": "2026-08-16T09:00:00+01:00",
                "repo": {
                    "root": ".",
                    "head_sha": None,
                    "branch": "main",
                    "dirty": False,
                },
                "config": {"max_iterations": 5, "worker": "sh ./worker.sh"},
                "result": {
                    "status": "stopped",
                    "reason": reason,
                    "iterations": 2,
                    "final_run": None,
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return path


def write_vacuity(
    repo: Path, run_id: str, verdict: str, *, version: str = "wringer.vacuity.v1"
) -> Path:
    """`<run bundle>/vacuity.json` — written only under `run.prove`."""
    path = repo / ".wringer" / "runs" / run_id / "vacuity.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": version,
                "verdict": verdict,
                "reason": "the pre-change comparison said so",
                "worktree_ms": 0,
                "prove_ms": 0,
                "setup": None,
                "gates": [],
            }
        ),
        encoding="utf-8",
    )
    return path


def write_fleet(
    repo: Path,
    fleet_id: str,
    statuses: list[str],
    *,
    version: str = "wringer.fleet.v1",
) -> Path:
    """`.wringer/fleets/<id>/manifest.json` — `tasks[].status`."""
    fleet = repo / ".wringer" / "fleets" / fleet_id
    fleet.mkdir(parents=True, exist_ok=True)
    path = fleet / "manifest.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": version,
                "fleet_id": fleet_id,
                "started_at": "2026-08-16T09:00:00+01:00",
                "config": {
                    "concurrency": 2,
                    "deadline": 600,
                    "retries": 1,
                    "join": "all",
                },
                "result": {
                    "succeeded": 0,
                    "failed": 0,
                    "parked": 0,
                    "join_satisfied": False,
                },
                "tasks": [
                    {
                        "id": f"task-{index}",
                        "status": status,
                        "reason": "",
                        "attempts": 1,
                        "loops": [],
                    }
                    for index, status in enumerate(statuses)
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return path


def write_health_report(
    path: Path, verdicts: list[str], *, version: str = "wringer.health.v1"
) -> Path:
    """What `wring health --json --output PATH` leaves on disk.

    `retired` is a verdict AND a top-level list (`health.py:790-793`), so a
    retired row is written where the engine writes it rather than in `gates`.
    """

    def gate(index: int, verdict: str) -> dict:
        return {
            "gate_id": f"gate-{index}",
            "command": "python3 check.py",
            "verdict": verdict,
            "qualifying_runs": 3,
            "optional": False,
            "last_failure": None,
            "last_sensitive": None,
            "drift": None,
            "receipts": [],
        }

    rows = [gate(index, v) for index, v in enumerate(verdicts)]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": version,
                "coverage": {
                    "roots": ["."],
                    "read": 1,
                    "counts": {"run": 1, "loop": 0, "bench": 0},
                    "skipped": [],
                    "duplicates": [],
                    "discovered": 1,
                },
                "gates": [row for row in rows if row["verdict"] != "retired"],
                "retired": [row for row in rows if row["verdict"] == "retired"],
                "limits": ["Health reads recorded history and nothing else."],
            }
        ),
        encoding="utf-8",
    )
    return path


def write_audit_report(path: Path, **axes: str) -> Path:
    """What `wring audit --json` prints. **It carries no `schema_version`** —
    it is a CLI report rather than a bundle, which is why `read_audit` has no
    version to gate on and reads its three keys by name."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "ok": True,
                "attestation": "attestation.json",
                "checked": [],
                "problem": None,
                "signature_reason": "",
                "limits": [],
                "signature_limits": [],
                **axes,
            }
        ),
        encoding="utf-8",
    )
    return path


def criterion(
    cid: str,
    title: str,
    state: str,
    *,
    required: bool = True,
    refuses: bool = False,
    gate: str | None = "suite",
    reason: str = "",
    receipt: dict | None = None,
    witness: dict | None = None,
) -> dict:
    row = {
        "id": cid,
        "title": title,
        "required": required,
        "state": state,
        "gate": gate,
        "command": "pytest -q",
        "refuses": refuses,
        "reason": reason,
        "receipt": receipt,
    }
    if witness is not None:
        row["witness"] = witness
    return row
