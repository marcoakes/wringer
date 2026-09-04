"""Decisions taken without asking, as cards (P1.12, 0.8.8).

Assumptions render inside the plan under DECIDED WITHOUT ASKING YOU — a dense
block a person scrolls past on the way to the approval, which then approves
all of it. Each is now its own question, asked before that yes.
"""

from __future__ import annotations

from test_drive_open_board import (  # noqa: F401
    TO_THE_PEN,
    converge_the_handover,
    drive,
    prd,
    project,
)

from wringer_board import interview
from wringer_drive import run as run_module

DECISIONS = """\
schema_version: wringer.decisions.v2
assumptions:
  - id: date-format
    decision: Dates are written ISO-8601.
    why: It sorts correctly in a spreadsheet.
    instead_of_asking: Which date format should the export use?
"""


def _with_a_decision(project) -> None:
    (project / interview.DECISIONS_FILENAME).write_text(DECISIONS, encoding="utf-8")


def test_A_CARD_PER_DECISION_NAMES_WHAT_IT_REPLACED(project):
    _with_a_decision(project)

    cards = run_module.assumption_cards(project)

    assert [c.id for c in cards] == ["assumption:date-format"]
    card = cards[0]
    assert "Dates are written ISO-8601." in card.text
    assert "It sorts correctly in a spreadsheet." in card.text
    assert "Which date format should the export use?" in card.text
    assert "accept" in card.question


def test_ACCEPT_CHANGES_NOTHING_AND_SAYS_SO(project):
    """Keeping a decision must leave the spec byte-identical: an "accept"
    that quietly rewrote the plan would be the drive answering for the
    person."""
    _with_a_decision(project)
    before = (project / "wringer.spec.yaml").read_text(encoding="utf-8")

    said = run_module.record_assumption(project, "date-format", "accept")

    assert said.id == "assumption-kept:date-format"
    assert (project / "wringer.spec.yaml").read_text(encoding="utf-8") == before


def test_A_CHANGE_GOES_THROUGH_THE_BOARDS_OWN_WRITER(project):
    """Not a second writer: `interview.revise` promotes the assumption to an
    answered question and withdraws the approval, exactly as it does from the
    terminal."""
    _with_a_decision(project)

    said = run_module.record_assumption(project, "date-format", "Use DD/MM/YYYY.")

    assert said.id == "assumption-changed:date-format"
    spec_text = (project / "wringer.spec.yaml").read_text(encoding="utf-8")
    assert "Use DD/MM/YYYY." in spec_text
    assert "approved: true" not in spec_text, (
        "changing a decision must withdraw the approval of the plan it made"
    )


def test_AN_ANSWERED_DECISION_IS_NEVER_ASKED_AGAIN(project):
    """A resumed run must not re-ask what was settled — the same rule the
    board already applies when it marks one superseded."""
    _with_a_decision(project)
    run_module.record_assumption(project, "date-format", "Use DD/MM/YYYY.")

    assert run_module.assumption_cards(project) == []


def test_NO_SIDECAR_MEANS_NO_CARDS(project):
    """A project whose drafter took no decisions meets no questions about
    them, and an unreadable sidecar is the interview's to report at the plan
    — never a card this package invented."""
    assert run_module.assumption_cards(project) == []

    (project / interview.DECISIONS_FILENAME).write_text(
        "schema_version: wringer.decisions.v9\nassumptions: []\n", encoding="utf-8"
    )
    assert run_module.assumption_cards(project) == []


def test_AN_EMPTY_ANSWER_IS_NOT_ACCEPTANCE(project, tmp_path, monkeypatch):
    """Offers never fall back — least of all into approving a decision
    nobody was asked about."""
    _with_a_decision(project)

    code, steps = drive(
        ["run", str(prd(tmp_path)), "--repo", str(project)],
        "The ones on screen.\nyes\n\n",
        monkeypatch,
    )

    ids = [step.id for step in steps]
    assert "assumption:date-format" in ids, ids
    assert ids[-1] == "stopped:assumption-unanswered", ids
    assert "wringer-drive resume" in steps[-1].text


def test_THE_CARDS_COME_BEFORE_THE_PLAN_AND_ITS_YES(project, tmp_path,
                                                    monkeypatch):
    """Asked before the approval, because the approval approves them."""
    _with_a_decision(project)

    code, steps = drive(
        ["run", str(prd(tmp_path)), "--repo", str(project)],
        "The ones on screen.\nyes\naccept\nyes\necho shown\n",
        monkeypatch,
    )

    ids = [step.id for step in steps]
    assert "assumption:date-format" in ids, ids
    assert ids.index("assumption:date-format") < ids.index("plan"), ids
