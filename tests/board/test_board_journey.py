"""**The board names the journey its run belongs to — by an EXACT join.**

0.8.7 (P1.14). Runs 4 and 4B, 2026-09-01: the page named a run id in its
engineers' block and nothing said which afternoon's work that run was part
of. Now, when a journey's own phases cite the rendered run, the block names
the journey beside the run — and NEVER names a journey that does not cite
it, however new: a journey this run is not part of is not this run's journey.
"""

from __future__ import annotations

import json
from pathlib import Path

from board_helpers import criterion, write_run

from wringer_board import read as read_module
from wringer_board import render as render_module

RUN = "20260901-100000-aaaa"
OTHER_RUN = "20260901-110000-bbbb"


def write_journey(
    repo: Path, journey_id: str, cites: str, *, version: str = "wringer.journey.v1"
) -> Path:
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
                        "phase": "interview", "kind": "other", "id": None,
                        "started_at": "2026-09-01T10:00:01.000+01:00",
                        "ended_at": "2026-09-01T10:00:02.000+01:00",
                        "outcome": "completed",
                    },
                    {
                        "phase": "verify", "kind": "verify", "id": cites,
                        "started_at": "2026-09-01T10:01:00.000+01:00",
                        "ended_at": "2026-09-01T10:01:00.000+01:00",
                        "outcome": "passed",
                    },
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return directory


def page(repo: Path) -> str:
    return render_module.render(read_module.read(repo))


def test_the_page_names_the_journey_whose_phases_CITE_the_rendered_run(repo):
    write_run(repo, RUN, [criterion("c", "It exports", "evidenced")])
    write_journey(repo, "20260901-095900-0001", RUN)

    board = read_module.read(repo)
    assert board.run_dir is not None and board.run_dir.name == RUN
    assert board.journey_id == "20260901-095900-0001"
    html = page(repo)
    assert "journey <code>20260901-095900-0001</code>" in html
    assert ".wringer/journeys/20260901-095900-0001/journey.json" in html


def test_a_journey_that_does_NOT_cite_the_run_is_never_named_however_new(repo):
    """The exact join. A newer journey citing a DIFFERENT run is not this
    run's journey, and "the newest journey in the repository" is not a fact
    the page may substitute."""
    write_run(repo, RUN, [criterion("c", "It exports", "evidenced")])
    write_journey(repo, "20260901-115900-ffff", OTHER_RUN)

    board = read_module.read(repo)
    assert board.run_dir is not None and board.run_dir.name == RUN
    assert board.journey_id is None
    assert "journey <code>" not in page(repo)


def test_with_no_journeys_at_all_the_page_says_nothing_about_one(repo):
    write_run(repo, RUN, [criterion("c", "It exports", "evidenced")])
    assert read_module.read(repo).journey_id is None
    assert "journey <code>" not in page(repo)


def test_a_journey_in_a_version_this_board_does_not_know_is_NOT_joined(repo):
    """Silence, never a guess: a record whose version the board does not
    know is not read for a field the board cannot know the place of."""
    write_run(repo, RUN, [criterion("c", "It exports", "evidenced")])
    write_journey(repo, "20260901-095900-0001", RUN, version="wringer.journey.v9")
    assert read_module.read(repo).journey_id is None
    assert "journey <code>" not in page(repo)


def test_the_join_is_on_the_run_this_page_renders_not_any_run_it_cites(repo):
    """Two runs, one journey citing only the OLDER. The page renders the
    newest run (recency wins) and that run has no journey."""
    write_run(repo, OTHER_RUN, [criterion("c", "It exports", "evidenced")])
    write_run(repo, RUN, [criterion("c", "It exports", "evidenced")])
    write_journey(repo, "20260901-095900-0001", RUN)

    newest = read_module.read(repo)
    if newest.run_dir is not None and newest.run_dir.name == OTHER_RUN:
        assert newest.journey_id is None
    pinned = read_module.read(repo, run_dir=repo / ".wringer" / "runs" / RUN)
    assert pinned.journey_id == "20260901-095900-0001"
    assert "journey <code>20260901-095900-0001</code>" in render_module.render(pinned)
