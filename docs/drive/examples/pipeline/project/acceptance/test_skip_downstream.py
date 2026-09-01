"""The executable spec for downstream skipping.

This directory holds checks written from a requirement BEFORE the requirement
is built, which is why `pyproject.toml` keeps it out of the default test run:
`pytest -q` is the suite that must stay green, and these are the ones that are
allowed to be red until the feature lands.

Run them on their own:

    pytest -q acceptance/test_skip_downstream.py

Conventions this file holds the build to, learned from a real blind run's
code review:

- `SKIPPED` is imported from the package, like `OK` and `FAILED` — a spec
  that has to define the vocabulary locally is speccing a private API.
- The CAUSE of a skip is the structured `Result.blocked_by` field, and the
  rendered prose is derived from it. Assertions here read the field, not a
  whitespace-split of the summary line — a one-letter job name once made the
  letter `c` in the word "blocked" pass for a blame, and that failure was
  this file's fault, not the build's.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from pipeline.cli import main
from pipeline.graph import Graph
from pipeline.report import render
from pipeline.runner import FAILED, OK, SKIPPED, Result, run, succeeded

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


def by_name(results):
    return {r.name: r for r in results}


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


def test_a_skipped_result_names_its_blockers_and_a_run_one_never_does():
    """The invariant the constructor already refuses to break, held at the
    run level too: every skip carries at least one blocker, and no job that
    actually ran carries any."""
    execute, _ = executor(failing={"build-cmd"})
    results = run(Graph.from_data(CHAIN), execute)
    for result in results:
        if result.status == SKIPPED:
            assert result.blocked_by, f"{result.name} skipped with no blocker"
        else:
            assert not result.blocked_by, f"{result.name} ran but carries blame"


def test_the_constructor_refuses_an_unexplained_skip():
    with pytest.raises(ValueError):
        Result(name="ghost", status=SKIPPED)
    with pytest.raises(ValueError):
        Result(name="ran", status=OK, blocked_by=("build",))


def test_a_skipped_result_renders_its_cause_from_the_structured_field():
    """The rendered prose is DERIVED from `blocked_by` — there is no second
    place the cause is stored, so there is no second place for it to
    disagree."""
    text = render([Result(name="test", status=SKIPPED, blocked_by=("build",))])
    line = text.splitlines()[0]
    assert "skipped" in line and "test" in line and "build" in line, line


def test_the_summary_names_each_skipped_job_and_the_failure_that_caused_it():
    execute, _ = executor(failing={"build-cmd"})
    results = run(Graph.from_data(CHAIN), execute)
    blamed = by_name(results)
    for name in ("test", "package"):
        assert blamed[name].blocked_by == ("build",), (
            f"{name} does not carry the structured blame: "
            f"{blamed[name].blocked_by!r}"
        )
    text = render(results)
    skipped_lines = [
        row for row in text.splitlines() if row.startswith("  skipped")
    ]
    for name in ("test", "package"):
        mine = [row for row in skipped_lines if f" {name} " in f"{row} "]
        assert mine, f"no summary line for {name}: {text}"
        assert "build" in mine[0], (
            f"the line for {name} does not say which failure caused it: {mine[0]}"
        )


def test_the_run_did_not_succeed_and_the_summary_says_so():
    execute, _ = executor(failing={"build-cmd"})
    results = run(Graph.from_data(CHAIN), execute)
    assert not succeeded(results)
    assert "Run did not succeed" in render(results)


def test_every_job_appears_exactly_once_in_the_summary():
    """A job printed inline AND in some skipped section is counted twice;
    a mutation once survived exactly that way while the gate stayed green."""
    execute, _ = executor(failing={"build-cmd"})
    results = run(Graph.from_data(CHAIN), execute)
    text = render(results)
    for name in ("build", "test", "package", "docs"):
        rows = [row for row in text.splitlines() if f" {name}" in f"{row} "]
        assert len(rows) == 1, f"{name} appears {len(rows)} times:\n{text}"


def test_a_deeper_chain_is_blamed_on_the_nearest_failure(tmp_path):
    """Two failures, and each skipped job names the one it actually waited
    on — asserted on the structured field, with full-word names."""
    data = {
        "compile": {"command": "compile-cmd"},
        "bundle": {"needs": ["compile"], "command": "bundle-cmd"},
        "lint": {"command": "lint-cmd"},
        "publish": {"needs": ["lint"], "command": "publish-cmd"},
    }
    execute, _ = executor(failing={"compile-cmd", "lint-cmd"})
    blamed = by_name(run(Graph.from_data(data), execute))
    assert blamed["bundle"].blocked_by == ("compile",)
    assert blamed["publish"].blocked_by == ("lint",)


def test_two_failed_roots_converging_through_skips_blame_both_once():
    """The multi-root join: two failures converge through skipped
    intermediates into one job. Its blame is stable, deduplicated, and
    names the nearest failure on each incoming path — never one of them
    twice, never a skipped intermediate."""
    data = {
        "left": {"command": "left-cmd"},
        "right": {"command": "right-cmd"},
        "mid-left": {"needs": ["left"], "command": "mid-left-cmd"},
        "mid-right": {"needs": ["right"], "command": "mid-right-cmd"},
        "join": {"needs": ["mid-left", "mid-right"], "command": "join-cmd"},
    }
    execute, seen = executor(failing={"left-cmd", "right-cmd"})
    results = run(Graph.from_data(data), execute)
    blamed = by_name(results)
    assert blamed["join"].status == SKIPPED
    assert "join-cmd" not in seen
    assert blamed["join"].blocked_by == ("left", "right"), (
        "the join must blame both roots, each exactly once, in a stable "
        f"order: {blamed['join'].blocked_by!r}"
    )


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
