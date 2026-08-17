"""`wringer.acceptance.v3` — the causes and the demonstration — SPEC_REFUSAL R2.

**This slice is DARK.** The schema is published and frozen complete, the writer
is built, and the public emission path still writes v2 — `accept.EMIT_V3` is
False until `wringer-board` reads v3. Fable ruling H-1 of 2026-08-17 put the
gate on EMISSION rather than on landing, and the reason is in this file's own
fixtures: the board is taught v3 from **bytes the engine actually wrote**, not
from hand-built ones. A fixture written from the same guess as its reader is
the failure mode that let eleven mutations walk through the board's absence
guard, and hand-building v3 fixtures would have repeated it one artifact over.

`test_the_engine_does_not_emit_v3_until_the_board_reads_it` is the gate. The
flip commit reverses it.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wringer import accept

SCHEMA_DIR = Path(accept.__file__).parents[2] / "schema"
FIXTURE_DIR = SCHEMA_DIR / "fixtures"


def row(**kwargs) -> accept.Row:
    base = dict(
        criterion="c-1", title="It works", required=True, state=accept.UNEVIDENCED
    )
    return accept.Row(**{**base, **kwargs})


# --- the gate ---------------------------------------------------------------


def test_the_engine_does_not_emit_v3_until_the_board_reads_it():
    """**THE SEQUENCING GATE, as a test** — SPEC_REFUSAL §9, amended H-1.

    `wringer-board` refuses any version outside `KNOWN_ACCEPTANCE` and renders
    ZERO cards — its own ruling 6, and correct. So an engine that emitted v3
    before the board could read it would make the surface refuse to read the
    artifact this whole cycle exists to make readable, **caused by the engine**,
    which is the worse direction: the engine is the half that chooses when to
    spend a version.

    This test is the gate. **The flip commit sets `EMIT_V3 = True` and reverses
    this assertion**, in the same commit that turns OQ-1's refusal policy on,
    because the two cannot be separated without shipping a falsehood in one
    direction or the other.
    """
    assert accept.EMIT_V3 is False, (
        "EMIT_V3 was turned on. That is only lawful in the commit where "
        "wringer-board's KNOWN_ACCEPTANCE already names wringer.acceptance.v3 "
        "— and this assertion is reversed in that same commit."
    )
    # And the public path really does still write v2 even with v3 facts on it.
    result = accept.Result(rows=(row(cause=accept.CAUSE_BORN_GREEN),))
    assert result.has_v3_facts is True
    assert result.as_json()["schema_version"] == accept.SCHEMA_VERSION_V2 or (
        result.as_json()["schema_version"] == accept.SCHEMA_VERSION
    )


def test_a_v1_or_v2_row_omits_the_new_keys_entirely(tmp_path):
    """Absent, not null. A v1 row growing a key is a silent break for every
    existing reader, and `tests/test_accept.py` pins exactly that."""
    plain = accept.Result(rows=(row(state=accept.EVIDENCED),))
    emitted = plain.as_json()
    for criterion in emitted["criteria"]:
        assert "cause" not in criterion
        assert "demonstrated_able_to_fail" not in criterion
        assert "judgement" not in criterion


# --- the narrow selector ----------------------------------------------------


@pytest.mark.parametrize(
    "kwargs,expected",
    [
        ({}, False),
        ({"cause": accept.CAUSE_UNBOUND}, True),
        ({"demonstrated_able_to_fail": True}, True),
        ({"demonstrated_able_to_fail": False}, True),
    ],
)
def test_the_selector_fires_only_on_a_row_that_carries_a_new_fact(kwargs, expected):
    """The review's finding 1: the drafted selector fired on "a value a v2 row
    could not have carried", which EVERY value of a brand-new field satisfies —
    so v1 and v2 would never have been emitted again while §2 still promised
    they would.

    `demonstrated_able_to_fail=False` counts, and that is deliberate: `False`
    is a fact ("nothing on disk shows this failing"), not an absence.
    """
    assert accept.Result(rows=(row(**kwargs),)).has_v3_facts is expected


# --- the eight causes, both directions --------------------------------------


def test_the_causes_are_a_closed_tuple_without_duplicates():
    assert len(accept.CAUSES) == len(set(accept.CAUSES)) == 8


def test_every_cause_the_code_emits_is_in_the_tuple():
    """One direction, total NOW: no site may invent a cause the enum does not
    name. A ninth added without joining the tuple reddens rather than ageing
    quietly — the shape `test_sign.py` uses for its three state axes."""
    import ast

    source = Path(accept.__file__).read_text(encoding="utf-8")
    emitted = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.keyword) and node.arg == "cause":
            for sub in ast.walk(node.value):
                if isinstance(sub, ast.Name) and sub.id.startswith("CAUSE_"):
                    emitted.add(getattr(accept, sub.id))
    assert emitted, "no cause is set anywhere — the wiring is gone"
    assert emitted <= set(accept.CAUSES), sorted(emitted - set(accept.CAUSES))


def test_the_three_human_causes_are_declared_and_not_yet_reachable():
    """**The dark half, pinned so it cannot pass unnoticed.**

    R2 declares all eight because publishing the schema freezes it. R2's CODE
    sets five. The three `human-*` causes need R3's judgement loader, and this
    test says so out loud rather than letting a both-directions totality test
    quietly assert something untrue.

    **R3 reverses this**, and the reversal is what forces R3 to wire all three
    rather than one.
    """
    import ast

    source = Path(accept.__file__).read_text(encoding="utf-8")
    emitted = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.keyword) and node.arg == "cause":
            for sub in ast.walk(node.value):
                if isinstance(sub, ast.Name) and sub.id.startswith("CAUSE_"):
                    emitted.add(getattr(accept, sub.id))
    human = {
        accept.CAUSE_HUMAN_UNANSWERED,
        accept.CAUSE_HUMAN_SAID_NO,
        accept.CAUSE_HUMAN_JUDGEMENT_STALE,
    }
    assert human <= set(accept.CAUSES), "declared in the frozen schema"
    assert not (human & emitted), (
        "a human cause is now emitted — that is R3, and this test is reversed "
        "in R3's commit together with the three-way judgement wiring"
    )
    # The five R2 builds ARE all reachable.
    assert emitted == set(accept.CAUSES) - human, sorted(emitted)


def test_the_schema_enum_and_the_tuple_agree_in_both_directions():
    """The frozen schema and the public symbol are one fact. A cause in the
    code that the schema rejects would write records nothing can validate; a
    cause in the schema the code cannot produce is dead text reading as
    coverage."""
    schema = json.loads(
        (SCHEMA_DIR / "acceptance-v3.schema.json").read_text(encoding="utf-8")
    )
    declared = schema["properties"]["criteria"]["items"]["properties"]["cause"]["enum"]
    assert set(declared) - {None} == set(accept.CAUSES)


# --- demonstrated_able_to_fail: the three values, and why not two -----------


def test_the_field_is_three_valued_and_null_is_not_false():
    """Ruling 10. `null` means *there was no bound (gate, command) to ask
    about* — and such a row CAN be evidenced, via a witness with no gate. A
    reader inferring "null implies not evidenced" would be wrong on exactly the
    rows the witness lane produces, which is why two values would have to lie.
    """
    unbound = row(cause=accept.CAUSE_UNBOUND)
    assert unbound.demonstrated_able_to_fail is None

    born_green = row(
        cause=accept.CAUSE_BORN_GREEN, demonstrated_able_to_fail=False
    )
    assert born_green.demonstrated_able_to_fail is False

    # The case the table exists for: evidenced AND null.
    witnessed = row(state=accept.EVIDENCED, demonstrated_able_to_fail=None)
    assert witnessed.state == accept.EVIDENCED
    assert witnessed.demonstrated_able_to_fail is None
    assert witnessed.as_json_v3()["demonstrated_able_to_fail"] is None


def test_arrived_with_the_work_demonstrated_TRUE_which_is_the_whole_point():
    """Ruling 13: rendering the fourth cause as the second is *false and
    BACKWARDS*. The record DOES show that gate can fail — the objection is that
    the gate is new. It is also the single refusal the README's objections
    block advertises as breaking the circularity charge, so getting it
    backwards is expensive."""
    arrived = row(
        cause=accept.CAUSE_ARRIVED_WITH_THE_WORK, demonstrated_able_to_fail=True
    )
    born = row(cause=accept.CAUSE_BORN_GREEN, demonstrated_able_to_fail=False)
    assert arrived.demonstrated_able_to_fail is True
    assert born.demonstrated_able_to_fail is False
    assert arrived.cause != born.cause


# --- the real bytes the board is taught from --------------------------------


def test_the_v3_fixtures_are_real_engine_output_and_validate(tmp_path):
    """**The bytes `wringer-board` learns v3 from, written BY the engine.**

    Committed under `schema/fixtures/` and regenerated by this test, so they
    can never drift from what `as_json_v3` actually produces. The board's own
    test suite reads these files; if the engine's shape moves, the fixture moves
    with it in the same commit and the board's tests redden on the next run.

    That is the whole reason H-1 sequenced R2 dark instead of teaching the
    board first.
    """
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads(
        (SCHEMA_DIR / "acceptance-v3.schema.json").read_text(encoding="utf-8")
    )

    rows = [
        row(
            criterion="unbound-one",
            title="Nothing binds this",
            cause=accept.CAUSE_UNBOUND,
        ),
        row(
            criterion="witness-nothing",
            title="Its witness evidenced nothing",
            cause=accept.CAUSE_WITNESS_EVIDENCED_NOTHING,
        ),
        row(
            criterion="born-green",
            title="Its gate was born green",
            gate_id="unit",
            command="pytest -q",
            cause=accept.CAUSE_BORN_GREEN,
            demonstrated_able_to_fail=False,
        ),
        row(
            criterion="pre-existence",
            title="Pre-existence could not be established",
            gate_id="unit2",
            command="pytest -q tests/b.py",
            cause=accept.CAUSE_PRE_EXISTENCE_UNESTABLISHED,
            demonstrated_able_to_fail=True,
        ),
        row(
            criterion="arrived-with",
            title="The check arrived with the work",
            gate_id="unit3",
            command="pytest -q tests/c.py",
            cause=accept.CAUSE_ARRIVED_WITH_THE_WORK,
            demonstrated_able_to_fail=True,
        ),
        row(
            criterion="evidenced-by-gate",
            title="A gate proved it",
            state=accept.EVIDENCED,
            gate_id="unit4",
            command="pytest -q tests/d.py",
            receipt=accept.Receipt(kind=accept.FAILURE, bundle=".wringer/runs/x"),
            demonstrated_able_to_fail=True,
        ),
        row(
            criterion="evidenced-by-witness",
            title="A witness proved it, and there is no gate to ask about",
            state=accept.EVIDENCED,
            receipt=accept.Receipt(kind=accept.WITNESS, bundle=".wringer/runs/y"),
            demonstrated_able_to_fail=None,
        ),
    ]
    payload = accept.Result(rows=tuple(rows)).as_json_v3()

    assert payload["schema_version"] == accept.SCHEMA_VERSION_V3
    jsonschema.validate(payload, schema)

    # Every cause R2 builds appears in the fixture the board is taught from.
    seen = {c["cause"] for c in payload["criteria"] if c["cause"]}
    human = {
        accept.CAUSE_HUMAN_UNANSWERED,
        accept.CAUSE_HUMAN_SAID_NO,
        accept.CAUSE_HUMAN_JUDGEMENT_STALE,
    }
    assert seen == set(accept.CAUSES) - human, sorted(seen)

    FIXTURE_DIR.mkdir(exist_ok=True)
    path = FIXTURE_DIR / "acceptance-v3-causes.json"
    written = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    if not path.is_file() or path.read_text(encoding="utf-8") != written:
        path.write_text(written, encoding="utf-8")
    assert path.read_text(encoding="utf-8") == written, (
        "the committed fixture drifted from what the engine writes"
    )
