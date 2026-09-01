"""**Recency wins**: the board renders the repository's NEWEST run record.

Field report 2026-08-27 (run 6 re-run, main Mac), finding 2. After the pen had
moved and `wring verify --prove` had run, a fresh `wringer-board render` still
said "Nobody has yet" and "0 of 8 proved" — while `acceptance.json` in the run
that had just been written carried the person's `not_met` verdict, and `wring
deliver` was refusing delivery citing that very verdict. Two surfaces, one
fact, drifted apart, on the page the whole product points at.

The mechanism was `read.read`: it pinned `run_dir` to the LOOP's last attempt
whenever a loop existed, and `latest_run` was only the fallback — so every
standalone run, which is what both `wring verify` and `wring verify --prove`
write, was invisible to the board. The ruling is that the board follows the
newest record whoever wrote it; the loop rail keeps telling the loop's story.

**The acceptance here is the sheet's own recipe** — judge, then `wring verify`,
then render — and the assertion after every step is that the page and the
record agree. Written against the real engine and the real board, because a
fixture is a second copy of the shape that drifted.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from wringer import accept, cli, evidence

pytest.importorskip("wringer_board")

SPEC = """\
schema_version: wringer.spec.v1
approved: true
title: Weekly figures go out on time
intent: |
  Finance needs the weekly figures as a file they can open, without
  asking anyone.
tasks:
  - id: build
    brief: Write the figures out
    objective: The figures land in a file.
criteria:
  - id: figures-written
    title: The figures are written to a file
    required: true
  - id: reads-clearly
    title: A reader can tell at a glance what happened
    required: true
    human: true
"""

CONFIG = """\
version: 1

gates:
  - id: figures
    run: python3 acceptance/figures.py
    timeout: 60
    proves: figures-written

run:
  max_iterations: 2
  worker: ": {brief}; printf 'done\\n' > figures.txt"
"""

CHECK = """\
import pathlib
assert pathlib.Path("figures.txt").is_file(), "no figures.txt"
print("ok")
"""


@pytest.fixture
def project(repo: Path) -> Path:
    """A repo whose loop converges, leaving a loop AND its runs behind."""
    (repo / "acceptance").mkdir()
    (repo / "acceptance" / "figures.py").write_text(CHECK, encoding="utf-8")
    (repo / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (repo / ".wringer.yaml").write_text(CONFIG, encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-q", "-m", "the checks, before the work"],
        cwd=repo,
        check=True,
        capture_output=True,
    )
    return repo


def _render(repo: Path) -> str:
    from wringer_board import read as board_read
    from wringer_board import render as board_render

    return board_render.render(board_read.read(repo))


def _board_run(repo: Path) -> Path:
    from wringer_board import read as board_read

    board = board_read.read(repo)
    assert board.run_dir is not None
    return board.run_dir


def _newest_run(repo: Path) -> Path:
    run = evidence.latest_run(repo / evidence.RUNS_DIRNAME)
    assert run is not None
    return run


def _record(run: Path) -> dict:
    return json.loads((run / accept.ACCEPTANCE_FILENAME).read_text(encoding="utf-8"))


def test_the_board_agrees_with_the_record_after_JUDGE_and_VERIFY(
    project, monkeypatch
):
    """The sheet's recipe, step by step, with the page checked after each.

    Field report 2026-08-27 finding 2 in one function: the loop leaves a
    record, the person's pen writes a verdict, `wring verify` writes a NEW
    record carrying it, and the board must be reading that one.
    """
    from wringer_board import judge as judge_module

    monkeypatch.chdir(project)
    assert cli.main(["run"]) == cli.EXIT_OK

    # 1. Straight after the loop, the newest record IS the loop's last run and
    #    the two agree trivially. The board must already say so.
    assert _board_run(project) == _newest_run(project)
    page = _render(project)
    assert "Nobody has yet." in page, (
        "nobody has judged the human criterion yet, so this is the honest page"
    )

    # 2. The pen moves. `wringer.judgements.yaml` is the person's file; it is
    #    not a run record, and nothing about the board should change yet.
    judge_module.record(
        project,
        "reads-clearly",
        "not_met",
        by="Pipeline team",
        note="the summary buries the failure",
        read_the_criterion=True,
        # The pen fails closed since 0.6.1; this fixture declares no
        # `show:`, and its subject is the board following the record — so
        # the judgement rides the explicit escape, exactly as an operator
        # judging on their own sight of it would.
        without_display=True,
    )
    assert (project / "wringer.judgements.yaml").is_file()

    # 3. `wring verify` — a STANDALONE run, outside the loop, which is what
    #    the sheet tells a person to run and what the engine's own born-green
    #    remedy tells them to run. This is the record the board must follow.
    assert cli.main(["verify"]) == cli.EXIT_OK
    newest = _newest_run(project)
    record = _record(newest)
    judged = {
        row.get("id") or row.get("criterion"): row for row in record["criteria"]
    }["reads-clearly"]
    assert judged["judgement"]["verdict"] == "not_met", record

    assert _board_run(project) == newest, (
        "the board is rendering an older run than the newest record in the "
        "repository — the drift of field report 2026-08-27 finding 2"
    )
    page = _render(project)
    assert "said it is not met" in page, page[:800]
    assert "Nobody has yet." not in page, (
        "the page is telling a person to go and do the thing they have "
        "already done, while a not_met verdict blocks the handover"
    )


def test_the_board_NAMES_the_run_it_renders(project, monkeypatch):
    """A page that disagrees with a record must be traceable to one.

    The whole cost of finding 2 was that the page and the record could not be
    told apart by reading them: nothing on the board said WHICH run it came
    from. It is a technical string, so it lives in the block B4 reserves for
    technical strings — but it is on the page.
    """
    monkeypatch.chdir(project)
    assert cli.main(["run"]) == cli.EXIT_OK
    assert cli.main(["verify"]) == cli.EXIT_OK

    newest = _newest_run(project)
    page = _render(project)
    assert newest.name in page, (
        "the board does not name the run it rendered, so a reader who thinks "
        "the page is stale has no way to check"
    )


def test_the_loop_rail_still_tells_the_LOOPS_story(project, monkeypatch):
    """Recency moved the RUN, not the attempts.

    The loop's own count is a different fact from "which record is newest",
    and a standalone verify must not make the loop's attempts disappear.
    """
    from wringer_board import read as board_read

    monkeypatch.chdir(project)
    assert cli.main(["run"]) == cli.EXIT_OK
    attempts_after_loop = len(board_read.read(project).attempts)
    assert attempts_after_loop >= 1

    assert cli.main(["verify"]) == cli.EXIT_OK
    board = board_read.read(project)
    assert len(board.attempts) == attempts_after_loop
    assert board.run_dir not in {attempt.directory for attempt in board.attempts}, (
        "the fixture no longer distinguishes a standalone run from a loop "
        "attempt, so it can no longer catch the drift"
    )
