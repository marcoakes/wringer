"""The six PM states and the blocks every artifact opens with (0.8.4).

**Marc, 2026-09-03:** the PM artifacts *"look crap; make them look really
professional and nice"* — and runs 4/4B, 2026-09-01: the PM read "green" as
"everything proved". This module is what every artifact opens with, so it is
the one place the six states are decided and the one place they are worded.
"""

from __future__ import annotations

from pathlib import Path

from wringer import outcome


def test_THE_SIX_STATES_ARE_A_CLOSED_ROSTER_IN_ONE_ORDER():
    """The order is the order a delivery reaches them, and every state has a
    PM's word. A state without a word would render its machine name at a
    person."""
    assert outcome.STATES == (
        outcome.BUILT,
        outcome.CHECKS_PASSING,
        outcome.REQUIREMENTS_PROVED,
        outcome.JUDGEMENT_COMPLETE,
        outcome.READY_TO_DELIVER,
        outcome.DELIVERED,
    )
    assert set(outcome.WORDS) == set(outcome.STATES)
    for state in outcome.STATES:
        assert outcome.WORDS[state][0].isupper(), state


def test_THE_RAIL_RENDERS_THREE_VALUES_AND_NEVER_A_SCORE():
    """True, False and "nothing on record" are three different facts. A
    percentage would blend them into one, which is what the whole board and
    every artifact refuse to do."""
    rail = "\n".join(outcome.rail({
        outcome.BUILT: True,
        outcome.CHECKS_PASSING: False,
        outcome.REQUIREMENTS_PROVED: None,
    }))
    assert "✓ yes" in rail and "✗ no" in rail and "— not recorded" in rail
    assert "%" not in rail
    for word in outcome.WORDS.values():
        assert word in rail, word
    # A state the caller did not mention is NOT RECORDED, never a guess.
    assert rail.count("— not recorded") == 4


def test_A_STATE_NOBODY_ASKED_ABOUT_READS_AS_NOTHING_ON_RECORD():
    assert outcome._cell(None) == outcome.NOT_RECORDED
    assert outcome._cell(True) == outcome.YES
    assert outcome._cell(False) == outcome.NO


def test_THE_FACT_BLOCK_HAS_FIVE_ROWS_AND_A_MISSING_FACT_IS_A_DASH():
    block = "\n".join(outcome.fact_block({outcome.RUN: "`r`"}))
    for label in outcome.FACTS[1:]:
        assert f"**{label}**" in block, label
    assert "| — |" in block, "a fact nobody holds must render a dash, not a guess"


def test_ONE_CALLOUT_KEEPS_EACH_SENTENCE_ITS_OWN_BULLET():
    """Ruling MR1 survives the layout: two debts must LOOK like two, and a
    bullet separates them more strongly than the blank quote line did."""
    said = outcome.callout("the lead", ["first debt", "second debt"])
    assert said[1] == "> the lead"
    assert "> - first debt" in said and "> - second debt" in said
    assert outcome.callout(None, []) == []


def test_DERIVE_READS_AN_EMPTY_REPOSITORY_AS_NOTHING_ON_RECORD(tmp_path: Path):
    """No loop, no run record, no delivery — every state is absent, and none
    of them is False. "Not built" and "no record of a build" are different
    facts and the artifact says which it has."""
    states = outcome.derive(tmp_path, tmp_path / ".wringer" / "runs" / "nope")
    assert set(states) == set(outcome.STATES)
    assert all(value is None for value in states.values()), states


def test_READY_IS_THE_ONE_FACT_A_CALLER_MAY_HOLD_IN_HAND(tmp_path: Path):
    """`wring deliver` writes the certificate after its plan refused nothing
    and before the delivery manifest exists, so it passes what it knows."""
    run_dir = tmp_path / ".wringer" / "runs" / "nope"
    assert outcome.derive(tmp_path, run_dir)[outcome.READY_TO_DELIVER] is None
    held = outcome.derive(tmp_path, run_dir, ready=True)
    assert held[outcome.READY_TO_DELIVER] is True
    assert held[outcome.DELIVERED] is None, "ready is not delivered"
