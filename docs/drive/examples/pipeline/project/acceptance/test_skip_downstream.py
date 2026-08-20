"""The executable spec for downstream skipping.

This directory holds checks written from a requirement BEFORE the requirement
is built, which is why `pyproject.toml` keeps it out of the default test run:
`pytest -q` is the suite that must stay green, and these are the ones that are
allowed to be red until the feature lands.

Run them on their own:

    pytest -q acceptance/test_skip_downstream.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from pipeline.cli import main
from pipeline.graph import Graph
from pipeline.report import render
from pipeline.runner import FAILED, OK, run

SKIPPED = "skipped"

# build fails; test needs build; package needs test; docs needs nothing.
CHAIN = {
    "build": {"command": "build-cmd"},
    "test": {"needs": ["build"], "command": "test-cmd"},
    "package": {"needs": ["test"], "command": "package-cmd"},
    "docs": {"command": "docs-cmd"},
}


def executor(failing=()):
    seen = []

    def execute(command):
        seen.append(command)
        if command in failing:
            return 1, f"{command} blew up"
        return 0, ""

    return execute, seen


def statuses(results):
    return {r.name: r.status for r in results}


def test_a_job_that_depends_on_a_failure_is_not_attempted():
    execute, seen = executor(failing={"build-cmd"})
    results = run(Graph.from_data(CHAIN), execute)
    assert statuses(results)["test"] == SKIPPED
    assert "test-cmd" not in seen


def test_skipping_carries_all_the_way_down_the_chain():
    execute, seen = executor(failing={"build-cmd"})
    results = run(Graph.from_data(CHAIN), execute)
    assert statuses(results)["package"] == SKIPPED
    assert "package-cmd" not in seen


def test_a_job_off_the_failing_chain_still_runs():
    execute, seen = executor(failing={"build-cmd"})
    results = run(Graph.from_data(CHAIN), execute)
    assert statuses(results)["docs"] == OK
    assert "docs-cmd" in seen


def test_every_job_is_still_accounted_for():
    execute, _ = executor(failing={"build-cmd"})
    results = run(Graph.from_data(CHAIN), execute)
    assert sorted(statuses(results)) == ["build", "docs", "package", "test"]
    assert statuses(results)["build"] == FAILED


def test_the_summary_names_each_skipped_job_and_the_failure_that_caused_it():
    execute, _ = executor(failing={"build-cmd"})
    text = render(run(Graph.from_data(CHAIN), execute))
    for name in ("test", "package"):
        line = [row for row in text.splitlines() if row.split()[1:2] == [name]]
        assert line, f"no summary line for {name}: {text}"
        assert "skipped" in line[0].lower(), line[0]
        assert "build" in line[0], (
            f"the line for {name} does not say which failure caused it: {line[0]}"
        )


def test_the_summary_still_says_the_run_did_not_succeed():
    execute, _ = executor(failing={"build-cmd"})
    text = render(run(Graph.from_data(CHAIN), execute))
    assert "Run did not succeed" in text


def test_a_deeper_chain_is_blamed_on_the_nearest_failure(tmp_path):
    """Two failures, and each skipped job names the one it actually waited on."""
    data = {
        "a": {"command": "a-cmd"},
        "b": {"needs": ["a"], "command": "b-cmd"},
        "c": {"command": "c-cmd"},
        "d": {"needs": ["c"], "command": "d-cmd"},
    }
    execute, _ = executor(failing={"a-cmd", "c-cmd"})
    text = render(run(Graph.from_data(data), execute))
    rows = {row.split()[1]: row for row in text.splitlines() if row.startswith("  ")}
    assert "a" in rows["b"] and "c" not in rows["b"], rows["b"]
    assert "c" in rows["d"] and "a" not in rows["d"], rows["d"]


def test_the_command_line_still_exits_non_zero_and_does_not_crash(tmp_path, capsys):
    path = tmp_path / "pipeline.json"
    path.write_text(
        json.dumps(
            {
                "build": {"command": "false"},
                "test": {"needs": ["build"], "command": "echo ran-test"},
            }
        ),
        encoding="utf-8",
    )
    assert main([str(path)]) == 1
    out = capsys.readouterr().out
    assert "ran-test" not in out
    assert "skipped" in out.lower()


def test_the_real_process_skips_too():
    """End to end through a subprocess, so nothing here is a test-double trick."""
    root = Path(__file__).resolve().parents[1]
    spec = root / "acceptance" / "chain.json"
    done = subprocess.run(
        [sys.executable, "-m", "pipeline", str(spec)],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
        env={"PYTHONPATH": str(root / "src"), "PATH": "/usr/bin:/bin"},
    )
    assert done.returncode == 1, done.stdout + done.stderr
    assert "SHOULD-NOT-RUN" not in done.stdout, done.stdout
    assert "skipped" in done.stdout.lower(), done.stdout
