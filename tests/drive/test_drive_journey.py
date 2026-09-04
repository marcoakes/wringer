"""**One journey identity (0.8.7, P1.14) — a JOIN, never a rename.**

Runs 4 and 4B, 2026-09-01: one afternoon's work left a spec id under
`.wringer/specs/`, a loop id under `.wringer/loops/`, a run id under
`.wringer/runs/` and a delivery id under `.wringer/deliveries/`, each printed
on a different surface, and the operator saw four unrelated ids for one
piece of work. Nothing said they belonged together.

The drive — the one process that sees all four — now writes
`.wringer/journeys/<id>/journey.json` naming which ids belong to which phase
of one run, and prints `journey <id> · <phase>` the first time each phase
is entered. Every existing id stays exactly where the engine put it.

Every test here drives the REAL verb on the REAL fixtures `test_drive_docs`
and `test_drive_resume_verb` build (imported by name, never copied), and
reads the file the drive actually wrote — a journey asserted from
`session.steps` alone would pass with the writer deleted.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from test_drive_docs import drive, project  # noqa: F401 — fixture by import
from test_drive_resume_verb import (  # noqa: F401 — fixture by import
    _stop_at_the_failed_turn,
    failing_build,
)
from test_drive_resume_verb import drive as drive_json
from test_drive_resume_verb import prd as resume_prd

from wringer_drive import journey
from wringer_drive import run as run_module

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "schema" / "journey.schema.json"
ID_SHAPE = re.compile(r"^[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$")


def journeys_written(repo: Path) -> list[Path]:
    root = repo / ".wringer" / "journeys"
    if not root.is_dir():
        return []
    return sorted(p for p in root.iterdir() if p.is_dir())


def record_of(repo: Path) -> dict:
    written = journeys_written(repo)
    assert len(written) == 1, f"expected ONE journey, found {written}"
    return json.loads((written[0] / "journey.json").read_text(encoding="utf-8"))


def basename(named: str) -> str:
    return named.rstrip("/").rsplit("/", 1)[-1]


@pytest.fixture
def converged(project, tmp_path, capsys, monkeypatch):
    """`test_drive_docs`'s converged ending: only the engine's delivery
    VERDICT is substituted (this fixture has no remote), with the engine's
    own `mode` and `delivery_dir` keys in the payload it returns."""
    monkeypatch.setattr(run_module, "delivery_plan", lambda repo: {"would": "send"})
    monkeypatch.setattr(
        run_module,
        "deliver",
        lambda repo, *, answered_yes: {
            "mode": "send",
            "delivery_dir": ".wringer/deliveries/20260901-120000-abcd",
        },
    )
    code, steps = drive(
        project, tmp_path, "The ones on screen.\nyes\nyes\ndeliver\nyes\n",
        monkeypatch
    )
    out = capsys.readouterr().out
    assert code == 0, f"the converged fixture no longer converges: {code}"
    return project, steps, out


# --- the writer ---------------------------------------------------------------


def test_a_converged_drive_writes_ONE_journey_citing_the_loop_the_run_and_the_delivery(
    converged,
):
    """The join, on the real ids: the loop the engine created, the run that
    loop's ledger names, and the delivery — each cited by the phase that
    produced it, and each present on disk under the engine's own root."""
    repo, steps, _ = converged
    record = record_of(repo)
    assert record["schema_version"] == "wringer.journey.v1"
    assert ID_SHAPE.match(record["journey_id"]), record["journey_id"]
    assert (repo / ".wringer" / "journeys" / record["journey_id"]).is_dir()

    by_phase = {phase["phase"]: phase for phase in record["phases"]}
    assert [p["phase"] for p in record["phases"]] == [
        "setup", "draft", "interview", "read-back", "approve", "gates", "show",
        "build", "verify", "deliver",
    ], [p["phase"] for p in record["phases"]]

    built = next(s for s in steps if s.id.startswith("build:"))
    loop_id = basename(built.detail["loop"])
    run_id = basename(built.detail["run"])
    assert (repo / ".wringer" / "loops" / loop_id).is_dir(), loop_id
    assert (repo / ".wringer" / "runs" / run_id).is_dir(), run_id

    assert by_phase["build"]["kind"] == "build"
    assert by_phase["build"]["id"] == loop_id
    assert by_phase["build"]["outcome"] == "converged", by_phase["build"]
    assert by_phase["verify"]["kind"] == "verify"
    assert by_phase["verify"]["id"] == run_id
    assert by_phase["verify"]["outcome"] == "passed", by_phase["verify"]
    assert by_phase["deliver"]["kind"] == "deliver"
    assert by_phase["deliver"]["id"] == "20260901-120000-abcd"
    assert by_phase["deliver"]["outcome"] == "send", by_phase["deliver"]
    # The interview produces no bundle: null, never a guess.
    assert by_phase["interview"]["id"] is None
    assert by_phase["interview"]["kind"] == "other"
    # This fixture carries its spec already, so the draft phase ends on the
    # drive's own `spec-reused` step and cites NO bundle: the engine drafted
    # nothing, so there is nothing to name.
    assert by_phase["draft"]["kind"] == "draft"
    assert by_phase["draft"]["id"] is None, by_phase["draft"]
    assert by_phase["draft"]["outcome"] == "spec-reused", by_phase["draft"]
    # Every phase on a finished run is closed.
    assert all(p["ended_at"] is not None for p in record["phases"]), record


def test_a_DRAFTED_spec_is_cited_by_the_draft_phase_under_the_engines_own_id(
    project, tmp_path, capsys, monkeypatch
):
    """The other draft ending. The `--send` subprocess is intercepted (this
    is about the id, and spending money at a live endpoint would be an odd
    way to test which directory name got recorded); what it leaves behind is
    exactly what the engine's `--json` prints — `spec_dir`, a path under
    `.wringer/specs/` — and the journey cites its basename, as it does the
    loop's and the delivery's."""
    import subprocess

    spec_path = project / "wringer.spec.yaml"
    drafted = spec_path.read_text(encoding="utf-8")
    spec_path.unlink()
    real = run_module.run_command

    def recording(repo, argv, env=None):
        if "--send" in argv:
            spec_path.write_text(drafted, encoding="utf-8")
            return subprocess.CompletedProcess(
                argv, 0,
                stdout=json.dumps({"spec_dir": ".wringer/specs/20260901-100000-5pec"}),
                stderr="",
            )
        return real(repo, argv, env)

    monkeypatch.setattr(run_module, "run_command", recording)
    # No interview answer: the run stops AT the first question, which is
    # after the draft phase has ended — the only phase this test is about.
    code, steps = drive(project, tmp_path, "", monkeypatch)
    capsys.readouterr()
    assert code != 0 and "drafting" in [s.id for s in steps], [s.id for s in steps]

    record = record_of(project)
    draft = next(p for p in record["phases"] if p["phase"] == "draft")
    assert draft["kind"] == "draft"
    assert draft["id"] == "20260901-100000-5pec", draft
    assert draft["outcome"] == "drafting", draft
    assert draft["ended_at"] is not None


def test_the_written_journey_VALIDATES_against_its_published_schema(converged):
    """`journey.schema.json` is frozen at birth, so the file the drive REALLY
    writes is held to it here (the round-trip guard derives from the engine's
    source only, and the engine never writes a journey)."""
    from jsonschema import Draft202012Validator

    repo, _, _ = converged
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    errors = sorted(
        Draft202012Validator(schema).iter_errors(record_of(repo)), key=str
    )
    assert not errors, "\n".join(str(e.message) for e in errors)


def test_a_REFUSED_handover_ends_the_deliver_phase_on_the_refusal_STEP_ID(
    project, tmp_path, capsys, monkeypatch
):
    """The common ending. The refusal is the product working, and the journey
    quotes the drive's own step id for it rather than composing a word."""
    code, steps = drive(project, tmp_path, "The ones on screen.\nyes\nyes\n", monkeypatch)
    capsys.readouterr()
    assert code != 0
    record = record_of(project)
    last = record["phases"][-1]
    assert last["phase"] == "deliver", record["phases"]
    assert last["ended_at"] is not None
    assert last["outcome"] == steps[-1].id, (last, steps[-1].id)
    assert steps[-1].id.startswith("stopped")


# --- the header line ------------------------------------------------------------


def test_EVERY_PHASE_ENTRY_PRINTS_ONE_HEADER_LINE_journey_id_phase(converged):
    """`journey <id> · <phase>`, once per phase entry, as its own SHOW step —
    the same object in both transports — and BEFORE the phase's first step,
    where the person is standing."""
    repo, steps, out = converged
    journey_id = record_of(repo)["journey_id"]
    headers = [s for s in steps if s.id == journey.HEADER_STEP_ID]
    phases = [
        "setup", "draft", "interview", "read-back", "approve", "gates", "show",
        "build", "deliver",
    ]
    assert [h.text for h in headers] == [
        f"journey {journey_id} · {phase}" for phase in phases
    ], [h.text for h in headers]
    assert all(h.kind == "show" for h in headers)
    assert all(h.detail == {"journey": journey_id, "phase": p}
               for h, p in zip(headers, phases, strict=True))
    # Printed, not only emitted (the 2026-08-26 lesson): the terminal saw it.
    for phase in phases:
        assert f"journey {journey_id} · {phase}" in out, phase
    # Before the phase's own first step.
    ids = [s.id for s in steps]
    build_header = next(
        i for i, s in enumerate(steps)
        if s.id == journey.HEADER_STEP_ID and s.detail["phase"] == "build"
    )
    assert build_header < ids.index("building"), ids


# --- resume is a continuation (D4) -------------------------------------------


def test_RESUME_CONTINUES_the_journey_it_stopped_in_rather_than_opening_a_second(
    failing_build, tmp_path
):
    """Run 4B's shape: a build stops at a failed turn, `resume` redoes the
    build. ONE journey, the build phase entered twice, the second build citing
    a NEW loop — the record is a log, not a state."""
    document = resume_prd(tmp_path)
    first = _stop_at_the_failed_turn(failing_build, document)
    first_loop = basename(
        next(s for s in first if s["id"].startswith("build:"))["detail"]["loop"]
    )
    before = record_of(failing_build)
    assert run_module.recorded_journey(failing_build) == before["journey_id"]
    builds = [p for p in before["phases"] if p["phase"] == "build"]
    assert len(builds) == 1 and builds[0]["id"] == first_loop, builds

    code, steps = drive_json(["resume", "--repo", str(failing_build)], "")
    assert code != 0, "the fixture's turn still fails"

    after = record_of(failing_build)
    assert after["journey_id"] == before["journey_id"], (
        "resume opened a second journey for the same piece of work"
    )
    builds = [p for p in after["phases"] if p["phase"] == "build"]
    assert [b["id"] for b in builds][0] == first_loop
    assert len(builds) == 2, [p["phase"] for p in after["phases"]]
    assert builds[1]["id"] and builds[1]["id"] != first_loop, builds
    headers = [s["text"] for s in steps if s["id"] == journey.HEADER_STEP_ID]
    assert headers[0] == f"journey {before['journey_id']} · build", headers


# --- the resume record's rule: a write that fails costs the run nothing ------


def test_a_journey_that_CANNOT_BE_WRITTEN_costs_the_run_NOTHING(
    project, tmp_path, capsys, monkeypatch
):
    """A stray FILE where the journeys directory goes. The record makes a run
    legible and can never make one proceed, so its failure must never be
    the reason one dies — the same rule as `resume.json`."""
    (project / ".wringer").mkdir(exist_ok=True)
    (project / ".wringer" / "journeys").write_text("in the way\n", encoding="utf-8")

    code, steps = drive(project, tmp_path, "The ones on screen.\nyes\nyes\n", monkeypatch)
    capsys.readouterr()

    ids = [s.id for s in steps]
    assert "building" in ids, f"the run did not reach the build: {ids}"
    assert code != 0 and ids[-1].startswith("stopped"), ids
    assert (project / ".wringer" / "journeys").is_file()
    # The run still has an identity to print, even with no record behind it.
    headers = [s for s in steps if s.id == journey.HEADER_STEP_ID]
    assert headers and ID_SHAPE.match(headers[0].detail["journey"]), headers
