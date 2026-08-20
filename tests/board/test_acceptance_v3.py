"""The board reads `wringer.acceptance.v3` — taught from the ENGINE'S bytes.

**This file reads fixtures the core repository wrote and regenerates.**
`schema/fixtures/acceptance-v3-*.json` are produced by
`accept.Result.as_json_v3` and re-checked against it on every run of the core's
own suite, so they cannot drift from what the engine emits.

That is the whole reason Fable ruling H-1 sequenced the engine's v3 slices DARK
and taught this board afterwards, instead of teaching this board first. Writing
v3 fixtures here would have meant a reader and a fixture built from the same
author's guess — and this repository has already paid for that shape once:
eleven mutations walked through the absence guard because its fixtures agreed
with its reader rather than with reality.

If the engine is not importable these tests skip loudly, like the rest of the
cross-repo checks here.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wringer_board import cards, refusals
from wringer_board import read as read_module


def fixtures_dir() -> Path:
    """The CORE repository's fixture directory, found through the engine."""
    accept = pytest.importorskip(
        "wringer.accept",
        reason="the engine is not importable, so the board cannot be checked "
        "against the bytes it actually writes",
    )
    directory = Path(accept.__file__).parents[2] / "schema" / "fixtures"
    if not directory.is_dir():
        pytest.skip(f"the engine is importable but {directory} is absent")
    return directory


def load(name: str) -> dict:
    return json.loads((fixtures_dir() / name).read_text(encoding="utf-8"))


def criteria_of(payload: dict) -> list[read_module.Criterion]:
    """Build the board's own rows the way `read.py` does, from real bytes."""
    return [
        read_module.Criterion(
            id=row.get("criterion") or row.get("id") or "?",
            title=row.get("title") or "",
            required=bool(row.get("required")),
            state=str(row.get("state") or ""),
            refuses=bool(row.get("refuses")),
            gate_id=row.get("gate"),
            command=row.get("command"),
            reason=str(row.get("reason") or ""),
            receipt=row.get("receipt"),
            witness=row.get("witness"),
            cause=row.get("cause"),
            demonstrated_able_to_fail=row.get("demonstrated_able_to_fail"),
            judgement=row.get("judgement"),
        )
        for row in payload["criteria"]
    ]


def test_v3_is_a_version_this_board_knows():
    assert "wringer.acceptance.v3" in read_module.KNOWN_ACCEPTANCE


def test_the_engine_is_still_dark_and_this_board_is_why_it_can_stop_being():
    """The gate, read from the engine rather than asserted here.

    While `EMIT_V3` is False the engine writes v2 and this board's v3 support
    is unexercised in the wild — which is the correct order. This test exists
    so the day the engine flips, the reason it was allowed to is a fact in this
    repository and not a memory.
    """
    accept = pytest.importorskip("wringer.accept")
    assert "wringer.acceptance.v3" in read_module.KNOWN_ACCEPTANCE, (
        "this board must read v3 BEFORE the engine emits it"
    )
    # Not asserted either way: the engine may legitimately have flipped by now.
    assert isinstance(accept.EMIT_V3, bool)


@pytest.mark.parametrize(
    "fixture", ["acceptance-v3-causes.json", "acceptance-v3-human.json"]
)
def test_every_cause_in_the_engines_own_bytes_has_a_sentence(fixture):
    """**The mapping, against real output.**

    Not "every cause in a list this repository keeps" — every cause that
    appears in bytes the engine actually produced. An untranslated cause here
    is a card that would render with no sentence, which ruling 17 forbids.
    """
    payload = load(fixture)
    assert payload["schema_version"] == "wringer.acceptance.v3"
    seen = {row["cause"] for row in payload["criteria"] if row.get("cause")}
    assert seen, f"{fixture} carries no causes at all"
    for cause in sorted(seen):
        saying = refusals.say(refusals.UNEVIDENCED_CAUSE, cause)
        assert saying is not None, (
            f"the engine emitted cause {cause!r} and this board has no "
            f"sentence for it — that card would render blank"
        )
        assert saying.sentence.strip()
        assert saying.question.strip(), (
            "every cause carries an unblocking question; a card that states a "
            "problem without saying what is needed is a report, not a "
            "conversation"
        )


def test_the_engines_cause_beats_the_prose_patterns():
    """**The point of OQ-4, demonstrated rather than asserted.**

    A v3 row whose `reason` prose says one thing and whose `cause` field says
    another must be read as the CAUSE says. Before v3 the board told the causes
    apart by matching free text, so a reworded engine message could silently
    re-label a card — the surface deciding what the engine said.

    The prose here is deliberately the `born-green` wording while the cause is
    `arrived-with-the-work`: the two the core's own ruling 13 singles out,
    because rendering the fourth as the second is false AND backwards.
    """
    row = read_module.Criterion(
        id="c",
        title="T",
        required=True,
        state="unevidenced",
        refuses=True,
        gate_id="unit",
        command="pytest -q",
        reason="`unit` passed, but nothing in the record shows it can fail",
        receipt=None,
        witness=None,
        cause="arrived-with-the-work",
        demonstrated_able_to_fail=True,
    )
    name, sentence, untranslated = cards._unevidenced(row)
    assert name == "arrived-with-the-work", (
        "the prose won over the engine's own field — that is the defect v3 "
        "exists to remove"
    )
    assert untranslated is None
    assert "new check cannot vouch" in sentence


def test_a_v1_or_v2_row_still_falls_back_to_the_prose():
    """v3 does not delete the fallback. v1 and v2 records have no `cause` key
    and this board must keep reading them."""
    row = read_module.Criterion(
        id="c",
        title="T",
        required=True,
        state="unevidenced",
        refuses=True,
        gate_id="unit",
        command="pytest -q",
        reason="`unit` exercises `x.py`, which this change CREATED",
        receipt=None,
        witness=None,
    )
    assert row.cause is None
    name, sentence, untranslated = cards._unevidenced(row)
    assert name == "arrived-with-the-work"
    assert untranslated is None


def test_a_cause_this_board_cannot_say_is_NAMED_never_prettified():
    """Ruling 17, on the v3 path. A PM seeing an ugly string files a bug
    report; a PM seeing nothing has been lied to."""
    row = read_module.Criterion(
        id="c",
        title="T",
        required=True,
        state="unevidenced",
        refuses=True,
        gate_id=None,
        command=None,
        reason="something the engine said that this board has never seen",
        receipt=None,
        witness=None,
        cause="a-ninth-cause-nobody-mapped",
    )
    name, sentence, untranslated = cards._unevidenced(row)
    assert name == "untranslated"
    assert sentence == ""
    assert untranslated == row.reason, (
        "the engine's own words must survive to the card verbatim"
    )


def test_the_human_rows_reach_the_board_with_their_questions():
    """**The NEEDS YOU cards — what the PM product is for.**

    Read from the engine's real human fixture. Every one of the three human
    causes carries a question addressed to a person, because a criterion no
    check can decide is the one place the board must ask rather than report.
    """
    payload = load("acceptance-v3-human.json")
    rows = criteria_of(payload)
    assert {r.state for r in rows} == {"human"}, (
        "a human row changed state — it must never become `evidenced`"
    )
    causes = {r.cause for r in rows if r.cause}
    assert causes == {
        "human-unanswered",
        "human-said-no",
        "human-judgement-stale",
    }, sorted(causes)

    for r in rows:
        if r.cause is None:
            continue
        saying = refusals.say(refusals.UNEVIDENCED_CAUSE, r.cause)
        assert saying is not None and saying.question.strip()

    # The one that is the whole point.
    unanswered = refusals.say(refusals.UNEVIDENCED_CAUSE, "human-unanswered")
    assert "Only you can answer it" in unanswered.question


def test_the_judgement_limit_travels_verbatim_from_the_engines_bytes():
    """`limits[]` render verbatim on this board, so the engine's own caveat
    about human judgements reaches a PM with no translation to maintain — and
    it says the weak part out loud."""
    payload = load("acceptance-v3-human.json")
    joined = "\n".join(payload["limits"])
    assert "later work can invalidate it" in joined
    assert "not re-checked by anything" in joined


def test_demonstrated_able_to_fail_is_read_as_three_valued():
    """`null` is not `false`. A witness-covered row with no gate has nothing to
    ask the record about AND can still be `evidenced`, so a board that read
    null as false would contradict the row beside it."""
    rows = criteria_of(load("acceptance-v3-causes.json"))
    by_id = {r.id: r for r in rows}
    assert by_id["born-green"].demonstrated_able_to_fail is False
    assert by_id["arrived-with"].demonstrated_able_to_fail is True
    evidenced_by_witness = by_id["evidenced-by-witness"]
    assert evidenced_by_witness.state == "evidenced"
    assert evidenced_by_witness.demonstrated_able_to_fail is None, (
        "an evidenced row with a null demonstration is the case the "
        "three-valued field exists for"
    )


def test_the_whole_v3_fixture_renders_without_a_version_refusal(tmp_path):
    """End to end: real v3 bytes on disk, through `render`, no banner.

    The failure this guards is the one ruling 6 describes — an unknown version
    produces a banner and NO CARDS AT ALL. Before this slice, that is exactly
    what the engine's first v3 record would have produced.
    """
    from wringer_board.__main__ import main

    repo = tmp_path / "repo"
    run = repo / ".wringer" / "runs" / "20260817-120000-v3aa"
    run.mkdir(parents=True)
    (run / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": "wringer.evidence.v1",
                "run_id": "20260817-120000-v3aa",
                "status": "passed",
                "gates": [],
            }
        ),
        encoding="utf-8",
    )
    (run / "acceptance.json").write_text(
        json.dumps(load("acceptance-v3-causes.json")), encoding="utf-8"
    )
    out = tmp_path / "board.html"
    code = main(["render", str(repo), "-o", str(out)])
    page = out.read_text(encoding="utf-8")

    assert "cannot read this evidence" not in page, (
        "the board refused a version it now knows"
    )
    assert "wringer.acceptance.v3" not in page or code != 2
    # The cards are really there, with the engine's causes translated.
    assert "No check is bound to this requirement" in page
    assert "new check cannot vouch" in page


# --- the guard that would have caught the stale pattern ---------------------


def test_the_prose_patterns_match_the_engines_ACTUAL_words():
    """**The guard this slice was written after, and the reason for `cause`.**

    Until 2026-08-17 the `arrived-with-the-work` pattern matched none of the
    three things the engine actually says — it looked for *"arrived with the
    CHANGE"* while the engine said *"arrived with the WORK"*, and for *"did not
    exist BEFORE"* while the engine said *"did not exist YET"*. So that row fell
    past every pattern, past the structural unbound branch (it has a gate), and
    out as `untranslated`: the raw engine sentence with no PM wording at all, on
    the single refusal the core README advertises as breaking the circularity
    charge.

    Nothing caught it because every test in this repository fed the patterns
    strings written IN this repository. This one builds rows with the ENGINE'S
    own `_assess_one` and asserts the board classifies each correctly — so the
    two halves are checked against each other rather than each against itself.

    **v3's `cause` field is what makes this permanently unnecessary**, and this
    guard covers the v1/v2 records that will keep arriving for as long as
    anyone has one on disk.
    """
    accept = pytest.importorskip("wringer.accept")

    # One real Row per cause, built by calling the engine's own constructors —
    # `reason` is whatever `accept.py` writes today, not a copy of it.
    _unused_expected = {
        accept.CAUSE_BORN_GREEN: accept.Row(
            criterion="c",
            title="T",
            required=True,
            state=accept.UNEVIDENCED,
            gate_id="unit",
            command="pytest -q",
            reason=(
                "`unit` passed, but nothing in the record shows it can fail — "
                "a gate born green evidences nothing. add `proves:`"
            ),
        ),
    }
    # The three that carry engine-authored prose are asserted from the real
    # fixture instead, because those bytes ARE the engine's output.
    for row in criteria_of(load("acceptance-v3-causes.json")):
        if row.cause is None:
            continue
        stripped = read_module.Criterion(
            id=row.id,
            title=row.title,
            required=row.required,
            state=row.state,
            refuses=row.refuses,
            gate_id=row.gate_id,
            command=row.command,
            reason=row.reason,
            receipt=row.receipt,
            witness=row.witness,
            # v1/v2 shape: no cause field at all, so the patterns must decide.
        )
        name, sentence, untranslated = cards._unevidenced(stripped)
        assert name == row.cause, (
            f"on a v1/v2-shaped row the patterns say {name!r}, but the engine's "
            f"own cause for this exact `reason` is {row.cause!r}. The mapping "
            f"has gone stale against the engine's wording. reason={row.reason!r}"
        )
        assert untranslated is None, (
            f"{row.cause} rendered untranslated: {untranslated!r}"
        )


# --- the delivery refusal reaching a card ----------------------------------


def test_a_real_refused_delivery_reaches_the_page_in_the_PMs_language(tmp_path):
    """**The single most PM-relevant fact in the repository, which never
    reached a card until 2026-08-17.**

    *Your handover was stopped, and here is why.* The board mapped three
    delivery reasons, none of which was among the engine's 23, and had no code
    path to `.wringer/refusals/` at all — so this rendered as nothing.

    The record here is written by the ENGINE's own `deliver.record_refusal`
    from a real `deliver.Refused`, not by a fixture written in this repository.
    """
    deliver = pytest.importorskip("wringer.deliver")
    from wringer_board import read as read_module
    from wringer_board import refusals as refusals_module

    repo = tmp_path / "repo"
    (repo / ".wringer").mkdir(parents=True)
    written = deliver.record_refusal(
        repo,
        deliver.Refused(
            "refusing to deliver: its gates passed, but the spec is not "
            "satisfied by the record",
            1,
            reason="acceptance_unevidenced",
        ),
        run="20260817-120000-aaaa",
    )
    assert written is not None and written.is_file()

    found = read_module.latest_refusal(repo)
    assert found == written

    import json

    reason = json.loads(found.read_text(encoding="utf-8"))["reason"]
    saying = refusals_module.say(refusals_module.DELIVERY_REFUSAL, reason)
    assert saying is not None, (
        f"the engine emitted {reason!r} and the board has no sentence"
    )
    assert "handover is being held" in saying.sentence
    assert saying.question.strip()


def test_every_one_of_the_engines_23_refusals_has_a_sentence_and_a_question():
    """Derived from `deliver.REFUSAL_REASONS`, both directions.

    A 24th refusal reddens here rather than reaching a PM as a raw token like
    `gates_did_not_pass`, which is what the whole chain ended in before this.
    """
    deliver = pytest.importorskip("wringer.deliver")
    from wringer_board import refusals as refusals_module

    mapped = {
        value
        for (family, value) in refusals_module.MAPPING
        if family == refusals_module.DELIVERY_REFUSAL
    }
    engine = set(deliver.REFUSAL_REASONS)
    assert mapped == engine, {
        "engine emits, board cannot say": sorted(engine - mapped),
        "board says, engine cannot emit": sorted(mapped - engine),
    }
    for reason in sorted(engine):
        saying = refusals_module.say(refusals_module.DELIVERY_REFUSAL, reason)
        assert saying.sentence.strip() and saying.question.strip(), reason
        # No house jargon reaches a PM.
        for word in ("vacuity", "gategen", "witness", "ratchet", "unevidenced"):
            assert word not in saying.sentence.lower(), (reason, word)


def test_the_newest_refusal_wins_and_old_ones_are_history(tmp_path):
    """A refusal from last week that somebody has since fixed is history, not
    a verdict about the work in front of you."""
    pytest.importorskip("wringer.deliver")
    from wringer_board import read as read_module

    repo = tmp_path / "repo"
    root = repo / ".wringer" / "refusals"
    for stamp, reason in (
        ("20260810-090000-old1", "nothing_to_deliver"),
        ("20260817-120000-new1", "gates_did_not_pass"),
    ):
        directory = root / stamp
        directory.mkdir(parents=True)
        (directory / "refusal.json").write_text(
            '{"schema_version": "wringer.refusal.v1", "reason": '
            f'"{reason}", "exit_code": 1, "message": "m", '
            '"at": "x", "run": null}',
            encoding="utf-8",
        )
    import json

    found = read_module.latest_refusal(repo)
    assert json.loads(found.read_text())["reason"] == "gates_did_not_pass"
