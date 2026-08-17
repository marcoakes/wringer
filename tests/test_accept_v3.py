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


def causes_the_code_emits() -> set[str]:
    """Every `CAUSE_*` the module actually USES, found with `ast`.

    Deliberately not "keyword arguments named `cause`": `_human_row` picks its
    cause into a local and passes the local, so a keyword-only scan reported
    `human-said-no` and `human-judgement-stale` as unreachable while both were
    wired. That near-miss is why this counts every reference outside the
    `CAUSES` tuple's own definition instead.
    """
    import ast

    tree = ast.parse(Path(accept.__file__).read_text(encoding="utf-8"))
    declaration = None
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "CAUSES" for t in node.targets
        ):
            declaration = node.value
    declared_nodes = set(map(id, ast.walk(declaration))) if declaration else set()
    found = set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Name)
            and node.id.startswith("CAUSE_")
            and id(node) not in declared_nodes
        ):
            found.add(getattr(accept, node.id))
    return found


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
    emitted = causes_the_code_emits()
    assert emitted, "no cause is set anywhere — the wiring is gone"
    assert emitted <= set(accept.CAUSES), sorted(emitted - set(accept.CAUSES))


def test_every_cause_is_reachable_from_a_fixture(tmp_path):
    """**Both directions, forced, over all eight** — ruling 12.

    REPLACES R2's `test_the_three_human_causes_are_declared_and_not_yet_
    reachable`, which pinned the dark half so it could not pass unnoticed. R3
    wires all three `human-*` causes, so the honest assertion is now the strong
    one: every cause in the tuple is producible by the engine, and every cause
    the engine produces is in the tuple. A ninth added without joining the
    tuple reddens rather than ageing quietly.

    The reversal of R2's pin IS the forcing function — it is what made R3 wire
    all three rather than one.
    """
    emitted = causes_the_code_emits()
    assert emitted == set(accept.CAUSES), {
        "in the tuple, never emitted": sorted(set(accept.CAUSES) - emitted),
        "emitted, not in the tuple": sorted(emitted - set(accept.CAUSES)),
    }


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


# --- R3: the human interlock ------------------------------------------------


import textwrap

from wringer import rubric


def criterion(cid="c-h", title="The copy reads well", guidance="", human=True,
              required=True):
    return rubric.Criterion(
        id=cid, title=title, guidance=guidance, required=required, human=human
    )


def judgements_file(root: Path, *entries) -> Path:
    import yaml

    path = root / accept.JUDGEMENTS_FILENAME
    path.write_text(
        yaml.safe_dump(
            {
                "schema_version": accept.JUDGEMENT_SCHEMA_VERSION,
                "judgements": list(entries),
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    return path


def entry(c, verdict="met", by="Marc", digest=None, **extra):
    return {
        "criterion": c.id,
        "verdict": verdict,
        "by": by,
        "at": "2026-08-17T10:00:00Z",
        "criterion_digest": digest or accept.criterion_digest(c),
        **extra,
    }


def test_the_digest_is_over_the_parsed_criterion_and_excludes_policy():
    """Ruling 3, all three consequences, each as its own assertion.

    `required` and `human` are EXCLUDED on purpose: changing either changes the
    policy, not the question. A criterion that stops being required has not
    been reworded, and staling every judgement when somebody flips a flag would
    be a refusal that always fires.
    """
    base = criterion()
    assert accept.criterion_digest(base) == accept.criterion_digest(
        criterion(required=False)
    )
    assert accept.criterion_digest(base) == accept.criterion_digest(
        criterion(human=False)
    )
    # An absent and an empty `guidance` are already the same parsed value.
    assert accept.criterion_digest(base) == accept.criterion_digest(
        criterion(guidance="")
    )
    # Rewording the QUESTION does move it. That is the whole pin.
    assert accept.criterion_digest(base) != accept.criterion_digest(
        criterion(title="The copy reads the way our users speak")
    )
    assert accept.criterion_digest(base) != accept.criterion_digest(
        criterion(guidance="Ask two users.")
    )


def test_a_whitespace_only_edit_to_the_spec_file_does_not_stale_a_judgement(
    tmp_path,
):
    """The reason the digest is over the PARSED object rather than raw bytes.

    Hashing file bytes — which is what `staleness.capture` does, and what the
    drafted spec's "canonicalised" hid — would stale every judgement in the
    repository on a comment change. The `briefed.json` precedent is cited for
    its DISCIPLINE (nothing may move under an answer), not its mechanism.
    """
    before = criterion(title="It works", guidance="Look at it")
    after = criterion(title="It works", guidance="Look at it")
    assert accept.criterion_digest(before) == accept.criterion_digest(after)


def test_no_flag_no_env_var_and_no_command_can_write_a_judgement():
    """Ruling 2, and it is the load-bearing refusal of this whole slice.

    A `human: true` criterion exists precisely because a model asked anyway
    would be guessing. A machine that could fill in its own answer would be the
    vibe tooling this project exists to answer — so there is deliberately no
    flag, no `--judge`, no `--accept-human`, and no environment variable.

    Checked structurally: nothing in `src/` WRITES the judgements file.
    """
    import ast

    src = Path(accept.__file__).parent
    writers = []
    for path in sorted(src.glob("*.py")):
        text = path.read_text(encoding="utf-8")
        if accept.JUDGEMENTS_FILENAME not in text and "JUDGEMENTS_FILENAME" not in text:
            continue
        tree = ast.parse(text)
        for node in ast.walk(tree):
            # `<something>.write_text(...)` where the target mentions the file.
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                if node.func.attr in ("write_text", "write_bytes", "safe_dump", "dump"):
                    seg = ast.get_source_segment(text, node) or ""
                    if "JUDGEMENTS" in seg or accept.JUDGEMENTS_FILENAME in seg:
                        writers.append(f"{path.name}:{node.lineno}")
    assert writers == [], (
        f"something in src/ writes the judgements file: {writers}. Nothing may."
    )
    # And no CLI surface offers one.
    cli_src = (src / "cli.py").read_text(encoding="utf-8")
    for forbidden in ("--judge", "--accept-human", "--judgement"):
        assert forbidden not in cli_src, forbidden


def test_an_unanswered_required_human_criterion_gets_the_unanswered_cause(tmp_path):
    row_ = accept._human_row(
        {"criterion": "c-h", "title": "T", "required": True},
        criterion(),
        {},
    )
    assert row_.state == accept.HUMAN
    assert row_.cause == accept.CAUSE_HUMAN_UNANSWERED
    assert row_.judgement is None
    # Ruling 5's scoped exception: the reason names the file to edit, because
    # "answered by people, not gates" under a refusal heading is a non-sequitur.
    assert accept.JUDGEMENTS_FILENAME in row_.reason


def test_a_met_judgement_clears_the_cause_and_the_state_stays_human(tmp_path):
    """**It never becomes `evidenced`, and that is not a technicality.**

    `evidenced` means a bound check passed now and the record shows the same
    check recorded failing. A person saying yes has no receipt. Rendering it
    under the same word would put a human judgement inside the sentence "every
    green was red first" — which would be false, and is the overclaim
    SPEC_BOARD's B3 exists to prevent.
    """
    c = criterion()
    row_ = accept._human_row(
        {"criterion": c.id, "title": c.title, "required": True},
        c,
        {c.id: entry(c)},
    )
    assert row_.state == accept.HUMAN
    assert row_.state != accept.EVIDENCED
    assert row_.cause is None
    assert row_.judgement.verdict == "met"
    assert row_.judgement.by == "Marc"
    assert row_.judgement.stale is False


def test_a_not_met_judgement_and_a_reworded_one_each_get_their_own_cause():
    c = criterion()
    said_no = accept._human_row(
        {"criterion": c.id, "title": c.title, "required": True},
        c, {c.id: entry(c, verdict="not_met")},
    )
    assert said_no.cause == accept.CAUSE_HUMAN_SAID_NO
    assert said_no.judgement.stale is False

    # The SAME answer, against a criterion whose wording has since moved.
    reworded = criterion(title="The copy reads the way our users speak")
    stale = accept._human_row(
        {"criterion": c.id, "title": reworded.title, "required": True},
        reworded, {c.id: entry(c)},
    )
    assert stale.cause == accept.CAUSE_HUMAN_JUDGEMENT_STALE
    assert stale.judgement.stale is True
    assert accept.JUDGEMENTS_FILENAME in stale.reason


def test_stale_is_computed_never_trusted_from_the_file():
    """A stale flag a person can write is a stale flag a person can forget.

    The file has no `stale` key at all — the schema forbids it with
    `additionalProperties: false` — and even a hand-added one is ignored,
    because `stale` is derived from the digest comparison and nothing else.
    """
    c = criterion()
    lying = entry(c)
    lying["stale"] = False
    reworded = criterion(title="Something else entirely")
    row_ = accept._human_row(
        {"criterion": c.id, "title": reworded.title, "required": True},
        reworded, {c.id: lying},
    )
    assert row_.judgement.stale is True, "a written 'stale' was believed"


def test_the_judgement_limit_rides_only_a_record_that_has_one():
    """A repository with no human criteria should not read a caveat about a
    mechanism it never used."""
    c = criterion()
    judged = accept.Result(
        rows=(
            accept.Row(
                criterion=c.id, title=c.title, required=True, state=accept.HUMAN,
                judgement=accept.Judgement(
                    verdict="met", by="Marc", at="2026-08-17T10:00:00Z", stale=False
                ),
            ),
        )
    )
    plain = accept.Result(rows=(row(cause=accept.CAUSE_UNBOUND),))
    assert accept.JUDGEMENT_LIMIT in judged.as_json_v3()["limits"]
    assert accept.JUDGEMENT_LIMIT not in plain.as_json_v3()["limits"]
    # And it says the weak part out loud.
    assert "later work can invalidate it" in accept.JUDGEMENT_LIMIT


def test_the_refusal_policy_is_DARK_until_the_flip():
    """OQ-1's reversal is gated on the SAME switch as emission.

    A live policy over v2 bytes would falsify the frozen v1 schema's own
    description of what can refuse; a dark policy under corrected prose would
    ship eight false sentences. One switch, both — and the flip commit reverses
    this test together with the gate test above.
    """
    c = criterion()
    unanswered = accept._human_row(
        {"criterion": c.id, "title": c.title, "required": True}, c, {}
    )
    assert unanswered.cause == accept.CAUSE_HUMAN_UNANSWERED
    assert accept.EMIT_V3 is False
    assert unanswered.refuses is False, (
        "the human refusal went live while EMIT_V3 is False — the policy and "
        "the emission flip together, in one commit, or the tree ships a lie"
    )


def test_a_malformed_judgements_file_is_treated_as_absent(tmp_path):
    """Total by construction, like `read_spec`. This runs inside `wring
    verify`, and a malformed sibling must not take down a verification."""
    (tmp_path / accept.JUDGEMENTS_FILENAME).write_text(
        "not: [valid", encoding="utf-8"
    )
    assert accept.read_judgements(tmp_path) == {}

    (tmp_path / accept.JUDGEMENTS_FILENAME).write_text(
        "schema_version: wringer.judgement.v99\njudgements: []\n", encoding="utf-8"
    )
    assert accept.read_judgements(tmp_path) == {}

    # A third verdict is not a verdict.
    c = criterion()
    judgements_file(tmp_path, entry(c, verdict="partially"))
    assert accept.read_judgements(tmp_path) == {}


def test_absence_is_never_read_as_met(tmp_path):
    assert accept.read_judgements(tmp_path) == {}
    c = criterion()
    row_ = accept._human_row(
        {"criterion": c.id, "title": c.title, "required": True},
        c, accept.read_judgements(tmp_path),
    )
    assert row_.cause == accept.CAUSE_HUMAN_UNANSWERED


def test_the_judgements_file_round_trips_through_its_own_schema(tmp_path):
    import yaml

    jsonschema = pytest.importorskip("jsonschema")
    c = criterion()
    path = judgements_file(tmp_path, entry(c, note="Checked with two users."))
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    schema = json.loads(
        (SCHEMA_DIR / "judgements.schema.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(payload, schema)
    assert accept.read_judgements(tmp_path)[c.id]["verdict"] == "met"


def test_the_v3_human_fixture_is_real_engine_output_and_validates():
    """**The second set of real bytes the board learns from** — the human rows.

    Same discipline as the causes fixture: produced by `as_json_v3`, re-checked
    against it every run, committed. The board's tests read this file, so if the
    engine's shape moves the fixture moves with it in the same commit.
    """
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads(
        (SCHEMA_DIR / "acceptance-v3.schema.json").read_text(encoding="utf-8")
    )
    c = criterion()
    reworded = criterion(title="The copy reads the way our users speak")

    rows = [
        accept._human_row(
            {"criterion": "unanswered", "title": "Nobody has answered this",
             "required": True}, criterion(cid="unanswered"), {},
        ),
        accept._human_row(
            {"criterion": "said-met", "title": "A person said yes",
             "required": True},
            criterion(cid="said-met"),
            {"said-met": entry(criterion(cid="said-met"), note="Two users tried it.")},
        ),
        accept._human_row(
            {"criterion": "said-no", "title": "A person said no",
             "required": True},
            criterion(cid="said-no"),
            {"said-no": entry(criterion(cid="said-no"), verdict="not_met")},
        ),
        accept._human_row(
            {"criterion": "reworded", "title": reworded.title, "required": True},
            criterion(cid="reworded", title=reworded.title),
            {"reworded": entry(criterion(cid="reworded"))},
        ),
    ]
    payload = accept.Result(rows=tuple(rows)).as_json_v3()
    jsonschema.validate(payload, schema)
    assert payload["schema_version"] == accept.SCHEMA_VERSION_V3

    seen = {r["cause"] for r in payload["criteria"] if r["cause"]}
    assert seen == {
        accept.CAUSE_HUMAN_UNANSWERED,
        accept.CAUSE_HUMAN_SAID_NO,
        accept.CAUSE_HUMAN_JUDGEMENT_STALE,
    }, sorted(seen)
    assert accept.JUDGEMENT_LIMIT in payload["limits"]
    # Every human row stays HUMAN, including the one a person said yes to.
    assert {r["state"] for r in payload["criteria"]} == {"human"}

    FIXTURE_DIR.mkdir(exist_ok=True)
    path = FIXTURE_DIR / "acceptance-v3-human.json"
    written = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    if not path.is_file() or path.read_text(encoding="utf-8") != written:
        path.write_text(written, encoding="utf-8")
    assert path.read_text(encoding="utf-8") == written
