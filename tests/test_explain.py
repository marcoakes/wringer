"""`wring explain` — a non-LLM diagnosis read back out of a bundle."""

from __future__ import annotations

import json
import re
from pathlib import Path

from core_helpers import flat

from wringer import cli, evidence, gates

FAILING = """\
version: 1
gates:
  - id: lint
    run: "true"
  - id: test
    run: echo boom-in-the-log; exit 1
  - id: deploy
    run: "true"
"""

PASSING = """\
version: 1
gates:
  - id: unit
    run: "true"
"""


def latest(root: Path) -> Path:
    found = evidence.latest_run(root / evidence.RUNS_DIRNAME)
    assert found is not None
    return found


def test_explain_diagnoses_the_latest_failed_run(
    repo, write_config, monkeypatch, capsys
):
    write_config(repo, FAILING)
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    assert cli.main(["explain"]) == cli.EXIT_OK

    out = capsys.readouterr().out
    run_id = latest(repo).name
    assert f"Run {run_id} — failed" in out
    assert f"{repo.name} @ " in out
    assert "(branch main, dirty)" in out
    # the gates it actually ran, in order, in verify's own shape
    assert "✓ lint passed" in out
    assert "✗ test failed" in out
    assert "deploy" not in out  # skipped gates never ran, so nothing to explain
    # the diagnosis proper
    assert "Failing gate: test" in out
    assert "command    echo boom-in-the-log; exit 1" in out
    assert "exit code  1" in out
    assert "--- gates/002_test/stdout.log ---" in out
    assert "boom-in-the-log" in out
    assert f"Full report:\n  .wringer/runs/{run_id}/summary.md" in out
    assert "Rerun:\n  wring verify --gate test" in out


def test_explain_on_a_passing_run_says_there_is_nothing_to_diagnose(
    repo, write_config, monkeypatch, capsys
):
    write_config(repo, PASSING)
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    assert cli.main(["explain"]) == cli.EXIT_OK

    out = capsys.readouterr().out
    assert "— passed" in out
    assert "Every required gate passed — nothing to diagnose." in out
    assert "Rerun:" not in out


def test_explain_diagnoses_an_interrupted_run(
    repo, write_config, monkeypatch, capsys
):
    """An interrupted run has no failing gate — but saying every gate passed
    would be a lie about the ones that never ran."""
    write_config(
        repo,
        """\
version: 1
gates:
  - id: lint
    run: "true"
  - id: test
    run: sleep 30
""",
    )
    monkeypatch.chdir(repo)

    real_run = gates.run
    calls = []

    def stop_on_the_second(*args, **kwargs):
        calls.append(None)
        if len(calls) == 2:
            raise KeyboardInterrupt
        return real_run(*args, **kwargs)

    monkeypatch.setattr(gates, "run", stop_on_the_second)

    assert cli.main(["verify"]) == cli.EXIT_INTERRUPTED
    capsys.readouterr()

    assert cli.main(["explain"]) == cli.EXIT_OK

    out = capsys.readouterr().out
    assert "— interrupted" in out
    assert "✓ lint passed" in out  # the gate that did finish
    assert "Interrupted during gate: test" in out
    assert "command    sleep 30" in out
    assert "Every required gate passed" not in out
    # the whole run is unproven, not one gate — so no --gate in the rerun
    assert out.endswith("Rerun:\n  wring verify\n")


def test_explain_lists_the_changed_files(
    repo, write_config, git_run, monkeypatch, capsys
):
    (repo / "calc.py").write_text("one\n", encoding="utf-8")
    git_run(repo, "add", "calc.py")
    git_run(repo, "commit", "-q", "-m", "add calc")
    (repo / "calc.py").write_text("two\n", encoding="utf-8")
    write_config(repo, PASSING)
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    assert cli.main(["explain"]) == cli.EXIT_OK

    out = capsys.readouterr().out
    assert "Changed files (1):" in out
    assert "  calc.py" in out
    assert "Untracked (1): .wringer.yaml" in out


def test_explain_reads_a_named_run(repo, write_config, monkeypatch, capsys):
    write_config(repo, PASSING)
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    first = latest(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    assert cli.main(["explain", str(first)]) == cli.EXIT_OK

    # the named run, not the newer one
    assert f"Run {first.name} —" in capsys.readouterr().out


def test_explain_without_any_runs_is_a_config_error(repo, monkeypatch, capsys):
    monkeypatch.chdir(repo)

    assert cli.main(["explain"]) == cli.EXIT_CONFIG

    err = flat(capsys.readouterr().err)
    assert "no runs" in err
    assert "wring verify" in err


def test_explain_of_a_missing_directory_is_a_config_error(
    repo, monkeypatch, capsys
):
    monkeypatch.chdir(repo)

    assert cli.main(["explain", "nope/not/here"]) == cli.EXIT_CONFIG

    assert "no run directory at nope/not/here" in capsys.readouterr().err


def test_explain_of_a_corrupt_bundle_is_a_config_error(
    repo, write_config, monkeypatch, capsys
):
    write_config(repo, PASSING)
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    manifest = latest(repo) / evidence.MANIFEST_FILENAME
    manifest.write_text("{not json", encoding="utf-8")

    assert cli.main(["explain"]) == cli.EXIT_CONFIG
    assert "not valid JSON" in capsys.readouterr().err


# --- a JOURNEY directory (0.8.7, P1.14) --------------------------------------
#
# Runs 4 and 4B, 2026-09-01: the operator saw a spec id, a loop id, a run id
# and a delivery id for one afternoon's work, and no verb could read back
# which belonged together. `wring explain <journey dir>` walks the drive's
# record, told apart by its own file and its own schema version — the way
# 0.7.1 taught `explain` loop directories, by the record and never the path.


def write_journey(repo: Path, journey_id: str, *, version: str = "wringer.journey.v1"):
    directory = repo / ".wringer" / "journeys" / journey_id
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "journey.json").write_text(
        json.dumps(
            {
                "schema_version": version,
                "journey_id": journey_id,
                "started_at": "2026-09-01T10:00:00.000+01:00",
                "phases": [
                    {
                        "phase": "draft", "kind": "draft",
                        "id": "20260901-100001-5pec",
                        "started_at": "2026-09-01T10:00:01.000+01:00",
                        "ended_at": "2026-09-01T10:00:09.000+01:00",
                        "outcome": "drafting",
                    },
                    {
                        "phase": "build", "kind": "build",
                        "id": "20260901-100100-100p",
                        "started_at": "2026-09-01T10:01:00.000+01:00",
                        "ended_at": "2026-09-01T10:05:00.000+01:00",
                        "outcome": "converged",
                    },
                    {
                        "phase": "verify", "kind": "verify",
                        "id": "20260901-100400-4run",
                        "started_at": "2026-09-01T10:05:00.000+01:00",
                        "ended_at": "2026-09-01T10:05:00.000+01:00",
                        "outcome": "passed",
                    },
                    {
                        "phase": "deliver", "kind": "deliver", "id": None,
                        "started_at": "2026-09-01T10:05:01.000+01:00",
                        "ended_at": None,
                        "outcome": None,
                    },
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return directory


def test_explain_WALKS_a_journey_directory_quoting_each_phase(
    repo, monkeypatch, capsys
):
    directory = write_journey(repo, "20260901-095959-j0ur")
    monkeypatch.chdir(repo)

    assert cli.main(["explain", str(directory)]) == cli.EXIT_OK
    raw = capsys.readouterr().out
    out = flat(raw)

    assert "Journey 20260901-095959-j0ur" in out
    # ONE ROW per phase: phase, the bundle it cites, the outcome — asserted
    # as the row, not as three words somewhere in the page. Red-watched
    # 2026-09-03: `"open" in out` stayed green with the outcome column
    # mutated to "completed", because the timestamps line says `-> open`.
    for phase, cited, outcome in (
        ("draft", "draft 20260901-100001-5pec", "drafting"),
        ("build", "build 20260901-100100-100p", "converged"),
        ("verify", "verify 20260901-100400-4run", "passed"),
        # The open phase is OPEN — not completed, not guessed at.
        ("deliver", "no bundle", "open"),
    ):
        assert re.search(rf"^  {phase}\s+{re.escape(cited)}\s+{outcome}$", raw, re.M), (
            phase, raw
        )
    assert "completed" not in raw, raw
    assert ".wringer/journeys/20260901-095959-j0ur/journey.json" in out


def test_explain_of_a_journey_this_version_cannot_read_is_a_config_error(
    repo, monkeypatch, capsys
):
    directory = write_journey(
        repo, "20260901-095959-j0ur", version="wringer.journey.v9"
    )
    monkeypatch.chdir(repo)

    assert cli.main(["explain", str(directory)]) == cli.EXIT_CONFIG
    err = flat(capsys.readouterr().err)
    assert "journey.json" in err and "wringer.journey.v1" in err, err
