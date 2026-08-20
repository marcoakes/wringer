"""Rendered against bundles a REAL Wringer run wrote, not fixtures.

`conftest.py` says why this file is the load-bearing one: the fixtures there
are a second copy of the engine's output shape, which is the drift ruling 1
exists to refuse. This file holds bytes the engine actually produced, so if the
engine's shape moves, this fails and the fixtures do not get to disagree
quietly.
"""

from __future__ import annotations

import json
from pathlib import Path

from wringer_board import cards
from wringer_board import read as read_module
from wringer_board import render as render_module

# **A real `wringer.acceptance.v2` row**, copied verbatim from the bundle a
# corpus re-validation wrote on 2026-08-16. Two things in it would have been
# got wrong by a fixture written from the spec alone, and both are here for
# that reason:
#
#   1. the id key is `criterion`, not `id`;
#   2. `witness.result` is the STRING `"not_run"`, not null, and the witness
#      object carries no `covers` key at all.
REAL_V2 = {
    "schema_version": "wringer.acceptance.v2",
    "counts": {
        "evidenced": 0,
        "unevidenced": 1,
        "gate-failed": 0,
        "gate-did-not-run": 0,
        "human": 0,
    },
    "criteria": [
        {
            "criterion": "issue",
            "title": "`fields.Constant` with `required=True` raised a warning",
            "required": True,
            "state": "unevidenced",
            "gate": None,
            "command": None,
            "receipt": None,
            "reason": (
                "no gate proves this criterion, and its witness evidences nothing "
                "(the runner could not collect it (exit 2), so its red says "
                "nothing about the criterion) — a human decides"
            ),
            "refuses": False,
            "witness": {
                "pinned_sha256": "3343c99acd3d",
                "proved_red": "collection_error",
                "result": "not_run",
                "discarded": "the runner could not collect it (exit 2)",
            },
        }
    ],
    "limits": [
        "A witness proves the stated criterion could fail and was made to "
        "pass. It does not certify agreement with an unstated intended fix.",
    ],
}


def _repo(tmp_path: Path) -> Path:
    run = tmp_path / ".wringer" / "runs" / "20260816-055805-a77a"
    run.mkdir(parents=True)
    (run / "acceptance.json").write_text(json.dumps(REAL_V2), encoding="utf-8")
    (run / "manifest.json").write_text(
        json.dumps({"schema_version": "wringer.evidence.v1"}), encoding="utf-8"
    )
    return tmp_path


def test_a_real_v2_bundle_renders_without_a_fixture_in_sight(tmp_path):
    """The id key is `criterion` and not `id`. A reader that assumed `id`
    would render every card as `?` — and every fixture in this suite would
    still have passed."""
    board = read_module.read(_repo(tmp_path))
    assert board.acceptance_version == "wringer.acceptance.v2"
    assert [c.id for c in board.criteria] == ["issue"]

    page = render_module.render(board)
    assert "fields.Constant" in page


def test_the_witness_lanes_own_unevidenced_cause_is_NAMED(tmp_path):
    """**A FIFTH cause, found on real data — and S2 discharging the handoff.**

    Ruling 15 enumerated four `unevidenced` causes from `accept.py` as it stood
    at `d23d7ca`. The witness lane added another: *no gate proves this
    criterion, and its witness evidences nothing*. It is not any of the four —
    it is not unbound-with-nothing-else, not born green, not an unestablished
    pre-existence, and not a check that arrived with the work.

    **What this test asserted in S1, and why it changed.** S1 asserted the card
    rendered UNTRANSLATED with the engine's own words, which is what ruling 17
    prescribes for a reason the mapping does not cover, and then said in this
    docstring: *"Naming it a fifth cause with its own sentence is S2's job, not
    S1's. Recorded here so the next slice starts from a measured fact."*

    S2 did that. The cause is `witness-evidenced-nothing`, it has its own
    sentence in `refusals.MAPPING`, and the card is now NEEDS YOU rather than
    UNTRANSLATED. **This assertion is flipped on the authority of the sentence
    above it, in the commit that does the naming** — never quietly, because a
    pinned assertion is a record of a decision and reversing one silently is
    the defect this repository exists to catch.

    What has NOT changed, and is still asserted below: it never gets another
    cause's sentence. UNTRANSLATED was the honest answer while the mapping had
    no entry; it would be a wrong answer now, and the generic born-green
    sentence would have been a wrong answer in both slices.
    """
    board = read_module.read(_repo(tmp_path))
    card = cards.card_for(board, board.criteria[0])

    assert card.state == cards.NEEDS_YOU
    assert card.cause == "witness-evidenced-nothing"
    assert "turned out to prove nothing" in card.sentence

    page = render_module.render(board)
    assert "never been recorded failing" not in page, (
        "the fifth cause was rendered as the generic born-green sentence — "
        "one cause shown as another"
    )


def test_the_promise_is_WITHHELD_on_a_run_that_evidenced_nothing(tmp_path):
    board = read_module.read(_repo(tmp_path))
    page = render_module.render(board)
    assert "does not claim that every requirement" in page
    assert "It was red first." not in page


def test_the_real_bundles_limits_render_verbatim(tmp_path):
    board = read_module.read(_repo(tmp_path))
    page = render_module.render(board)
    assert "does not certify agreement with an unstated intended fix" in page


# --- the THIRD receipt kind, found on the corpus pass's own bundles ----------

# A real `evidenced` row from the corpus re-test, 2026-08-16 — the shape a
# WINNING row has. `receipt.kind` is `witness`, which SPEC_BOARD ruling 5
# predates: the spec was written against `accept.py` at `d23d7ca`, which had
# `failure` and `sensitive` only.
REAL_WITNESS_RECEIPT = {
    "schema_version": "wringer.acceptance.v2",
    "criteria": [
        {
            "criterion": "issue",
            "title": "`order` check runs after the field transformer",
            "required": True,
            "state": "evidenced",
            "gate": None,
            "command": None,
            "receipt": {
                "kind": "witness",
                "bundle": ".wringer/runs/20260816-102739-2755",
            },
            "refuses": False,
            "reason": "",
            "witness": {
                "pinned_sha256": "9c13fb8dd745",
                "proved_red": "assertion",
                "result": "passed",
                "discarded": None,
            },
        }
    ],
    "limits": ["A witness proves the stated criterion could fail."],
}


def _repo_with(tmp_path: Path, payload: dict) -> Path:
    run = tmp_path / ".wringer" / "runs" / "20260816-102739-2755"
    run.mkdir(parents=True)
    (run / "acceptance.json").write_text(json.dumps(payload), encoding="utf-8")
    (run / "manifest.json").write_text(
        json.dumps({"schema_version": "wringer.evidence.v1"}), encoding="utf-8"
    )
    return tmp_path


def test_a_WITNESS_receipt_resolves_and_earns_the_promise(tmp_path):
    """**The gap the corpus pass's own bundles found.**

    Before this, the board met the strongest red-first demonstration the
    programme has and rendered UNKNOWN — the receipt kind was one ruling 5 did
    not enumerate, so the chain would not resolve, the card was demoted, and
    the promise was withheld. Honest, and wrong: the record DOES show the check
    failing, on a check that did not exist until Wringer wrote it.
    """
    board = read_module.read(_repo_with(tmp_path, REAL_WITNESS_RECEIPT))
    card = cards.card_for(board, board.criteria[0])

    assert card.state == cards.DONE, (
        f"a winning row rendered {card.state} — the board cannot read the "
        "receipt its own engine writes on the rows that matter most"
    )
    assert cards.promise_earned(board, [card])

    page = render_module.render(board)
    assert "It was red first." in page
    assert "before the work began" in page


def test_a_witness_receipt_whose_red_was_a_LOAD_FAILURE_resolves_nothing(tmp_path):
    """W8's discrimination, carried onto the card.

    A witness red because the runner could not LOAD it turns green the moment
    any file of that name exists. It evidences nothing, so a receipt pointing
    at it must not resolve — and the promise must not fire over it.
    """
    payload = json.loads(json.dumps(REAL_WITNESS_RECEIPT))
    payload["criteria"][0]["witness"]["proved_red"] = "collection_error"

    board = read_module.read(_repo_with(tmp_path, payload))
    card = cards.card_for(board, board.criteria[0])

    assert card.state == cards.UNKNOWN
    assert not cards.promise_earned(board, [card])


def test_the_three_receipt_kinds_say_THREE_different_things(tmp_path):
    """Ruling 5's whole point: different facts get different words, and
    rendering one as another is an overclaim. Asserted as a set so a future
    kind cannot quietly reuse an existing sentence."""
    said = set()
    for kind, extra in (
        ("failure", {}),
        ("sensitive", {"cites": "it failed on the pre-change tree"}),
        ("witness", {}),
    ):
        payload = json.loads(json.dumps(REAL_WITNESS_RECEIPT))
        payload["criteria"][0]["receipt"] = {"kind": kind, **extra}
        root = _repo_with(tmp_path / kind, payload)
        board = read_module.read(root)
        said.add(cards.card_for(board, board.criteria[0]).sentence)

    assert len(said) == 3, f"two receipt kinds share a sentence: {said}"
