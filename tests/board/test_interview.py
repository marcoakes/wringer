"""S3 — the interview surface. SPEC_BOARD_V0 §5 ruling 20, and H-4's questions.

**The B5 test is byte equality**: drive the verb and the hand edit against the
same fixture and assert the resulting files are identical. That is why every
write here is a line edit rather than a YAML round-trip — a round-trip
reformats comments, key order and quoting, so it could not be byte-equal to
what a person would have typed, and the person's file is the artifact of
record.

The other half of this file is the set of things the surface must REFUSE.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from wringer_board import cards, interview, refusals
from wringer_board.__main__ import main
from wringer_board.read import Criterion

SPEC = """\
schema_version: wringer.spec.v1
approved: false
title: CSV export
intent: The reports page can export what it shows.
# A comment a person wrote. Nothing may reformat this file around it.
tasks:
  - id: build-export
    brief: Build the export endpoint
    objective: The reports page exports a CSV of what it shows.
criteria:
  - id: csv-downloads
    title: The export downloads a CSV
    required: true
  - id: copy-reads-well
    title: The copy reads the way our users speak
    required: true
    human: true
open_questions:
  - id: which-columns
    question: Which columns should the export contain?
    required: true
  - id: filename
    question: What should the file be called?
    required: false
"""

GATES = """\
schema_version: wringer.gatespec.v1
gates:
  - id: export
    run: "pytest -q tests/test_export.py"
    proves: csv-downloads
"""


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    (tmp_path / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (tmp_path / "wringer.gates.yaml").write_text(GATES, encoding="utf-8")
    return tmp_path


# --- capability 1: the conversation ----------------------------------------


def test_the_button_and_the_hand_edit_produce_byte_identical_files(repo, tmp_path):
    """**THE B5 TEST.** Ruling 20's acceptance criterion, and the reason this
    surface writes line edits rather than round-tripping YAML."""
    interview.answer(repo, "which-columns", "The ones on screen, in that order.")

    by_hand = tmp_path / "hand"
    by_hand.mkdir()
    (by_hand / "wringer.spec.yaml").write_text(
        SPEC.replace(
            "  - id: which-columns\n"
            "    question: Which columns should the export contain?\n"
            "    required: true\n",
            "  - id: which-columns\n"
            "    question: Which columns should the export contain?\n"
            "    required: true\n"
            "    answer: The ones on screen, in that order.\n",
        ),
        encoding="utf-8",
    )

    assert (repo / "wringer.spec.yaml").read_bytes() == (
        by_hand / "wringer.spec.yaml"
    ).read_bytes()


def test_the_comment_and_everything_else_survive_untouched(repo):
    before = (repo / "wringer.spec.yaml").read_text(encoding="utf-8")
    interview.answer(repo, "filename", "export.csv")
    after = (repo / "wringer.spec.yaml").read_text(encoding="utf-8")

    assert "# A comment a person wrote." in after
    # Exactly one line added, and nothing else moved.
    assert after.count("\n") == before.count("\n") + 1
    for line in before.splitlines():
        assert line in after.splitlines(), line


def test_the_core_loader_reads_what_this_surface_wrote(repo):
    """The whole claim of capability 1: the answer lands in the shape the
    ENGINE's spec loader already reads. Checked against the real loader, not
    against this repository's idea of it."""
    spec = pytest.importorskip("wringer.spec")
    interview.answer(repo, "which-columns", "The ones on screen.")

    loaded = spec.load(repo / "wringer.spec.yaml")
    assert loaded.unanswered == (), [q.id for q in loaded.unanswered]
    answered = {q.id: q.answer for q in loaded.questions}
    assert answered["which-columns"] == "The ones on screen."


def test_an_empty_answer_is_refused(repo):
    with pytest.raises(interview.InterviewError, match="not an answer"):
        interview.answer(repo, "which-columns", "   ")


def test_it_refuses_to_overwrite_what_a_person_already_wrote(repo):
    interview.answer(repo, "which-columns", "The ones on screen.")
    with pytest.raises(interview.InterviewError, match="already answered"):
        interview.answer(repo, "which-columns", "Something else entirely.")
    assert "The ones on screen." in (repo / "wringer.spec.yaml").read_text()


def test_an_unknown_question_is_refused_and_names_the_known_ones(repo):
    with pytest.raises(interview.InterviewError, match="which-columns"):
        interview.answer(repo, "not-a-question", "x")


def test_an_answer_needing_quoting_round_trips(repo):
    """A colon in an answer is the first thing that breaks a naive line edit."""
    spec = pytest.importorskip("wringer.spec")
    text = "Order: the ones on screen, then # anything else"
    interview.answer(repo, "which-columns", text)
    loaded = spec.load(repo / "wringer.spec.yaml")
    assert {q.id: q.answer for q in loaded.questions}["which-columns"] == text


def test_a_task_id_is_never_mistaken_for_a_question_id(repo):
    """`tasks` and `open_questions` both have `- id:` entries. Writing an
    answer under a task would corrupt the spec silently."""
    with pytest.raises(interview.InterviewError, match="no open question"):
        interview.answer(repo, "build-export", "x")
    assert "answer:" not in (repo / "wringer.spec.yaml").read_text()


# --- capability 2: the plain-language plan ---------------------------------


def test_the_plan_says_what_will_be_built_and_how_each_piece_is_proved(repo):
    text = interview.plan(repo)
    assert "The reports page exports a CSV" in text
    # Bound: names the check, and says it must be seen to fail first.
    assert "`export`" in text and "seen to FAIL first" in text
    # Human: says a PERSON decides, and that no check will be written.
    assert "A PERSON decides this" in text
    # Still-open questions are shown, with the refusal they will cause.
    assert "which-columns" in text and "will refuse" in text
    # And the limit that stops a PM approving the wrong thing confidently.
    assert "never its wisdom" in text


def test_the_plan_says_out_loud_when_nothing_checks_a_criterion(repo):
    (repo / "wringer.gates.yaml").unlink()
    text = interview.plan(repo)
    assert "NOTHING CHECKS THIS YET" in text
    assert "will not be claimed as done" in text


# --- capability 3: approve --------------------------------------------------


def test_approve_writes_only_the_approved_line(repo):
    interview.answer(repo, "which-columns", "The ones on screen.")
    before = (repo / "wringer.spec.yaml").read_text(encoding="utf-8")

    interview.approve(repo, read_the_plan=True)

    after = (repo / "wringer.spec.yaml").read_text(encoding="utf-8")
    assert after == before.replace("approved: false", "approved: true", 1)


def test_approve_and_the_hand_edit_are_byte_identical(repo, tmp_path):
    interview.answer(repo, "which-columns", "The ones on screen.")
    hand = tmp_path / "hand.yaml"
    hand.write_text(
        (repo / "wringer.spec.yaml")
        .read_text(encoding="utf-8")
        .replace("approved: false", "approved: true", 1),
        encoding="utf-8",
    )
    interview.approve(repo, read_the_plan=True)
    assert (repo / "wringer.spec.yaml").read_bytes() == hand.read_bytes()


def test_approve_does_not_corrupt_a_hand_written_capital_False(repo):
    """**A LIVE DEFECT, found 2026-08-19 by the adversarial review of
    SPEC_PMPLAN_V0 — in shipped code, not in the spec under review.**

    `approved: False` is valid YAML and PyYAML reads it as the boolean false,
    so a person who wrote their own spec by hand can perfectly well have it.
    `APPROVED_LINE` matches case-insensitively and therefore accepts it — and
    the edit underneath was `partition("false")`, which is case-SENSITIVE. It
    found nothing, so `head` became the entire line and the write produced

        approved: Falsetrue

    a corrupted spec that the engine's own loader then refuses with
    "'approved' must be a boolean". The person's file is destroyed and the
    error blames them for it.

    This surface exists to edit files a person wrote (`_spec_path`'s own
    message: *"this surface edits a spec a person or `wring spec` already
    wrote"*), so "the engine only ever writes lowercase" is not a defence —
    it is exactly the seam the board's fixtures kept landing on the wrong
    side of.
    """
    path = repo / "wringer.spec.yaml"
    path.write_text(
        path.read_text(encoding="utf-8").replace(
            "approved: false", "approved: False", 1
        ),
        encoding="utf-8",
    )
    interview.answer(repo, "which-columns", "The ones on screen.")

    interview.approve(repo, read_the_plan=True)

    after = path.read_text(encoding="utf-8")
    assert "Falsetrue" not in after, f"the interlock line was corrupted: {after!r}"
    import yaml

    assert yaml.safe_load(after)["approved"] is True, (
        "the file no longer parses with approved: true"
    )


def test_approve_preserves_the_operators_own_capitalisation_and_comment(repo):
    """The line edit changes the WORD and nothing else — the same promise the
    lowercase path already keeps, on a line a person capitalised."""
    path = repo / "wringer.spec.yaml"
    path.write_text(
        path.read_text(encoding="utf-8").replace(
            "approved: false", "approved:   False   # mine, and I capitalise", 1
        ),
        encoding="utf-8",
    )
    interview.answer(repo, "which-columns", "x")

    interview.approve(repo, read_the_plan=True)

    line = [
        ln
        for ln in path.read_text(encoding="utf-8").splitlines()
        if ln.startswith("approved:")
    ][0]
    assert line == "approved:   true   # mine, and I capitalise", line


@pytest.mark.parametrize("spelling", ["no", "No", "NO", "off", "Off"])
def test_approve_handles_every_yaml_false_the_ENGINE_accepts(repo, spelling):
    """**The other half of the 2026-08-19 interlock defect.**

    YAML 1.1 spells false `false`, `no` and `off`, in any case, and PyYAML
    reads all of them as the boolean. The ENGINE'S OWN LOADER accepts every
    one: `spec.load` on a file saying `approved: no` returns `approved=False`,
    a completely valid unapproved spec.

    `APPROVED_LINE` matched only `true|false`, so `approve` fell through the
    loop and raised *"has no top-level `approved:` line to set. This surface
    edits what is there; it does not invent structure"* — telling a person
    their file lacks a line that is sitting right there, and reading as a
    caller bug when it is not.

    That sentence has now been wrong twice for the same reason. The comment
    above `APPROVED_LINE` records the first time, when the pattern ended
    `\\s*$` and so refused every spec the engine itself drafts. Both were
    missed because this package's fixtures are written on the same side of the
    seam as its reader.

    `y`/`n` are deliberately NOT accepted: PyYAML reads those as the strings
    "y"/"n", so the engine refuses such a spec first with "'approved' must be
    a boolean". A spelling this surface accepts must be one the engine does.
    """
    import yaml

    path = repo / "wringer.spec.yaml"
    path.write_text(
        path.read_text(encoding="utf-8").replace(
            "approved: false", f"approved: {spelling}", 1
        ),
        encoding="utf-8",
    )
    interview.answer(repo, "which-columns", "The ones on screen.")

    interview.approve(repo, read_the_plan=True)

    after = path.read_text(encoding="utf-8")
    assert yaml.safe_load(after)["approved"] is True, after
    assert f"approved: {spelling}" not in after


@pytest.mark.parametrize("spelling", ["true", "True", "yes", "Yes", "on", "On"])
def test_an_already_approved_spec_is_recognised_in_every_yaml_true(repo, spelling):
    """The mirror, and the direction that would be dangerous to get wrong: a
    spec already approved as `yes` must be seen as approved, not re-approved
    and not reported as structureless."""
    path = repo / "wringer.spec.yaml"
    # Answer FIRST, then set the interlock — because answering a question now
    # withdraws a standing approval, so doing it the other way round would
    # destroy the very state this test exists to check.
    interview.answer(repo, "which-columns", "x")
    path.write_text(
        path.read_text(encoding="utf-8").replace(
            "approved: false", f"approved: {spelling}", 1
        ),
        encoding="utf-8",
    )

    with pytest.raises(interview.InterviewError, match="already approved"):
        interview.approve(repo, read_the_plan=True)


def test_there_is_no_way_to_approve_without_the_plan_being_rendered(repo):
    """**Ruling 20's forbidden button.** A button that approves without showing
    the plan is not the act the approval step exists for."""
    interview.answer(repo, "which-columns", "x")
    with pytest.raises(interview.InterviewError, match="rendered first"):
        interview.approve(repo, read_the_plan=False)
    assert "approved: false" in (repo / "wringer.spec.yaml").read_text()


def test_approving_with_a_required_question_open_is_refused(repo):
    with pytest.raises(interview.InterviewError, match="still unanswered"):
        interview.approve(repo, read_the_plan=True)
    assert "approved: false" in (repo / "wringer.spec.yaml").read_text()


def test_the_cli_approve_path_prints_the_plan_before_it_writes(repo, capsys):
    interview.answer(repo, "which-columns", "The ones on screen.")
    assert main(["approve", str(repo)]) == 0
    out = capsys.readouterr().out
    assert "HOW EACH PIECE WILL BE PROVED" in out
    assert out.index("HOW EACH PIECE") < out.index("approved: true")
    assert "never the same action" in out
    assert "approved: true" in (repo / "wringer.spec.yaml").read_text()


def test_no_verb_writes_anything_but_the_spec_file(repo):
    """**The surface writes `wringer.spec.yaml` and nothing else** — §8
    non-goal 9. In particular it never writes a judgement: a surface that could
    answer a `human` criterion would be the thing this programme exists to
    answer."""
    import ast

    before = {p.name for p in repo.iterdir()}
    interview.answer(repo, "which-columns", "x")
    interview.approve(repo, read_the_plan=True)
    assert {p.name for p in repo.iterdir()} == before

    # Structural, with `ast`, for the reason the core's face-detector guard is:
    # the PROSE here names `wringer.judgements.yaml` on purpose, because a
    # comment that cannot spell the thing it explains is no use. Only string
    # literals in executable positions count.
    source = Path(interview.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.ClassDef)):
            body = getattr(node, "body", [])
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
            ):
                docstrings.add(id(body[0].value))

    named = [
        f"{n.lineno}: {n.value!r}"
        for n in ast.walk(tree)
        if isinstance(n, ast.Constant)
        and isinstance(n.value, str)
        and id(n) not in docstrings
        and "judgement" in n.value.lower()
    ]
    assert named == [], (
        f"this surface names a judgements path in executable code: {named}. "
        "Nothing anywhere may write a person's answer for them"
    )

    # **Writes go through the `_write` helper now**, which opens with
    # `newline=""` so a CRLF document keeps its line endings — `write_text`
    # translated them and rewrote every line in the file. The invariant is
    # unchanged and this test keeps the same teeth: every write still targets
    # the `path` that `_spec_path` returned, and there is still exactly one
    # way to write.
    direct = [
        n.lineno
        for n in ast.walk(tree)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr in ("write_text", "write_bytes", "mkdir", "unlink")
    ]
    assert not direct, (
        f"a write bypasses `_write` at line(s) {direct}. One writer, so one "
        "place has to be right about line endings and about the target"
    )

    writes = [
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Name)
        and n.func.id == "_write"
    ]
    assert writes, "the module writes nothing at all — that is also wrong"
    assert "GATES_FILENAME" in source, "the sidecar is READ, so it is named"
    for node in writes:
        target = ast.get_source_segment(source, node.args[0]) or ""
        assert target == "path", (
            f"a write at line {node.lineno} targets {target!r}, not the "
            "`path` that `_spec_path` returned"
        )

    # `_write` itself is the ONE place allowed to open a file for writing.
    opens = [
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr == "open"
    ]
    assert len(opens) == 2, (
        f"expected exactly the reader and the writer to open a file, found "
        f"{len(opens)} at {[n.lineno for n in opens]}"
    )


# --- H-4: the questions, rendered ------------------------------------------


def criterion(**kwargs) -> Criterion:
    base = dict(
        id="c",
        title="T",
        required=True,
        state="unevidenced",
        refuses=True,
        gate_id=None,
        command=None,
        reason="",
        receipt=None,
        witness=None,
    )
    return Criterion(**{**base, **kwargs})


def test_every_needs_you_card_carries_its_unblocking_question():
    """**H-4.** Ruling 16 has given every value a question since S2 and nothing
    rendered one — half the mapping was guarded, pinned against the engine, and
    read by nobody. A card that states a problem without saying what is needed
    is a report; the question is what makes it a conversation."""
    board = object()
    for cause in (
        "unbound",
        "witness-evidenced-nothing",
        "born-green",
        "pre-existence-unestablished",
        "arrived-with-the-work",
    ):
        card = cards.card_for(board, criterion(cause=cause, gate_id="unit"))
        assert card.state == cards.NEEDS_YOU
        assert card.question, cause
        assert card.question == refusals.say(refusals.UNEVIDENCED_CAUSE, cause).question


def test_the_three_human_states_each_get_their_own_question():
    """The NEEDS YOU card's question is the PM product's whole point, and
    before v3 this card said one thing for all three human states."""
    board = object()
    asked = {}
    for cause in ("human-unanswered", "human-said-no", "human-judgement-stale"):
        card = cards.card_for(board, criterion(state="human", cause=cause))
        assert card.state == cards.NEEDS_YOU
        asked[cause] = card.question
    assert len(set(asked.values())) == 3, asked
    assert "Only you can answer it" in asked["human-unanswered"]
    assert "still hold" in asked["human-judgement-stale"]


def test_a_human_row_a_person_answered_met_asks_the_honest_question():
    """Not "is this met?" — they said so. The honest question is the one the
    record's own limit raises: nothing re-checks it."""
    card = cards.card_for(
        object(),
        criterion(
            state="human",
            refuses=False,
            judgement={"verdict": "met", "by": "Marc", "at": "x", "stale": False},
        ),
    )
    assert card.state == cards.NEEDS_YOU
    assert "Marc said this was met" in card.question
    assert "does it still hold?" in card.question


def test_the_question_reaches_the_rendered_page():
    """Guarded at the HTML, not only on the dataclass — a question carried and
    never rendered is exactly the gap H-4 closes."""
    from wringer_board import render

    html = render._card_html(
        cards.Card(
            id="c",
            title="T",
            state=cards.NEEDS_YOU,
            sentence="Nothing checks this yet.",
            question="Which check should decide this requirement?",
        )
    )
    assert 'class="ask"' in html
    assert "Which check should decide this requirement?" in html


# --- the fixture that is the ENGINE'S OWN OUTPUT ---------------------------
#
# **These are the tests that would have caught two live defects, and did not
# exist.** Every fixture above is hand-typed, i.e. written on the same side of
# the seam as the reader — the identical failure mode that let eleven mutations
# through this repository's absence guard, and the one this window had already
# written into a commit message hours before repeating it here.
#
# The refute review of SPEC_DRIVE_V0 found both by driving `spec.render()`
# through `interview`. What follows is that, as a test.


def engine_spec_file(directory: Path) -> Path:
    """A `wringer.spec.yaml` rendered by the ENGINE, not typed here."""
    spec = pytest.importorskip("wringer.spec")
    drafted = spec.Spec(
        approved=False,
        title="CSV export",
        intent="A manager can export the report as a CSV.",
        questions=(
            spec.Question(id="which-columns", question="Which columns?", required=True),
            spec.Question(id="filename", question="What filename?", required=False),
        ),
        criteria=(
            spec.Criterion(id="exports-csv", title="It exports a CSV", required=True),
        ),
        gates=(),
        tasks=(spec.Task(id="build", brief="Build it", objective="It exports."),),
        path="wringer.spec.yaml",
    )
    path = directory / "wringer.spec.yaml"
    path.write_text(spec.render(drafted), encoding="utf-8")
    return path


def test_approve_accepts_the_spec_THIS_ENGINE_DRAFTS(tmp_path):
    """**The defect this catches shipped.**

    `wring spec` renders the interlock with a trailing comment:

        approved: false        # <- the interlock. `wring plan` refuses …

    and the first `APPROVED_LINE` ended `\\s*$`, so `approve` REFUSED every
    spec the engine itself drafts, with the message *"it does not invent
    structure"* — which reads as a caller bug and is not one.
    """
    engine_spec_file(tmp_path)
    interview.answer(tmp_path, "which-columns", "The ones on screen.")

    interview.approve(tmp_path, read_the_plan=True)

    text = (tmp_path / "wringer.spec.yaml").read_text(encoding="utf-8")
    assert "approved: true" in text
    # **The interlock's own comment survives**, because it is the sentence that
    # tells a person what the flag does. A surface that deleted the explanation
    # while flipping the flag would be removing the reason for the thing it did.
    line = next(
        one for one in text.splitlines() if one.startswith("approved:")
    )
    assert "#" in line and "interlock" in line, line
    # And the engine can read its own file back.
    spec = pytest.importorskip("wringer.spec")
    assert spec.load(tmp_path / "wringer.spec.yaml").approved is True


def test_answer_FILLS_the_empty_answer_the_engine_already_wrote(tmp_path):
    """**The second defect this catches shipped**, and it was invisible.

    `wring spec` renders `answer: ''` unconditionally, so appending produced a
    mapping with a DUPLICATE `answer:` key. PyYAML takes the last, so nothing
    errored and the byte-equality test stayed green — its fixture had no
    `answer:` line at all.
    """
    engine_spec_file(tmp_path)
    interview.answer(tmp_path, "which-columns", "The ones on screen.")

    text = (tmp_path / "wringer.spec.yaml").read_text(encoding="utf-8")
    block = text.split("open_questions:", 1)[1]
    first = block.split("- id: filename", 1)[0]
    assert first.count("answer:") == 1, (
        f"duplicate `answer:` key written into one mapping:\n{first}"
    )
    assert "answer: ''" not in first
    assert "The ones on screen." in first

    spec = pytest.importorskip("wringer.spec")
    loaded = spec.load(tmp_path / "wringer.spec.yaml")
    assert {q.id: q.answer for q in loaded.questions}["which-columns"] == (
        "The ones on screen."
    )
    assert loaded.unanswered == ()


def test_the_whole_S3_chain_runs_on_engine_output(tmp_path):
    """plan → answer → plan → approve, against bytes the engine wrote.

    The end-to-end version, so a future change that breaks any one link fails
    here rather than in whatever composes them later.
    """
    engine_spec_file(tmp_path)

    before = interview.plan(tmp_path)
    assert "which-columns" in before and "will refuse" in before

    interview.answer(tmp_path, "which-columns", "The ones on screen.")
    after = interview.plan(tmp_path)
    assert "STILL UNANSWERED" not in after, after

    interview.approve(tmp_path, read_the_plan=True)
    spec = pytest.importorskip("wringer.spec")
    assert spec.load(tmp_path / "wringer.spec.yaml").approved is True


def test_a_required_question_left_open_still_blocks_approval_on_engine_output(
    tmp_path,
):
    engine_spec_file(tmp_path)
    with pytest.raises(interview.InterviewError, match="still unanswered"):
        interview.approve(tmp_path, read_the_plan=True)
    spec = pytest.importorskip("wringer.spec")
    assert spec.load(tmp_path / "wringer.spec.yaml").approved is False


# --- multi-line answers, which a PM writes and which used to be lost -------


@pytest.mark.parametrize(
    "text",
    [
        "one line",
        "line one\nline two",
        "First: the ones on screen.\nSecond: in that order.\nThird: no totals row.",
        "has: a colon",
        "has # a hash",
        'has "quotes" in it',
        "  leading and trailing  ",
        # **YAML's plain scalars are not decided by which characters are in them**,
        # which is what `_scalar` used to check. Every one of these round-tripped
        # as a bool, None, a float or a date — and `yes` is the likeliest answer
        # anybody will ever type into an interview. `wring plan` then refused the
        # PM's own spec with "'answer' must be a string".
        #
        # Found by driving a REAL drafted spec through `wringer-drive`, not by
        # reading this function.
        "yes",
        "no",
        "true",
        "off",
        "null",
        "~",
        "1.5",
        "12",
        "2026-08-17",
        "Yes",
        "NO",
    ],
)
def test_an_answer_round_trips_EXACTLY_through_the_engines_own_loader(tmp_path, text):
    """**`_scalar`'s docstring claimed this and it was false** (finding 15).

    A double-quoted YAML scalar containing a literal newline is FOLDED, so
    `"line one\\nline two"` reparses as `line one line two`. A PM answering in
    more than one sentence lost their line breaks with no error anywhere.

    Byte-equality could not catch it, which is the interesting part: both
    sides of that test go through `_scalar`, so it agreed with itself. This
    checks the round trip against the ENGINE's loader instead.
    """
    spec = pytest.importorskip("wringer.spec")
    engine_spec_file(tmp_path)
    interview.answer(tmp_path, "which-columns", text)

    loaded = spec.load(tmp_path / "wringer.spec.yaml")
    got = {q.id: q.answer for q in loaded.questions}["which-columns"]
    assert got == text, f"answer did not survive: {text!r} -> {got!r}"


def test_a_multi_line_answer_is_a_block_scalar_which_is_what_a_person_writes():
    """Byte-equality with a hand edit still holds, because `|-` is the form a
    person reaching for multi-line YAML would use."""
    rendered = interview._scalar("line one\nline two", "    ")
    assert rendered.startswith("|-\n")
    assert "      line one" in rendered
    assert "      line two" in rendered


def test_the_plan_reads_INSTALLED_bindings_not_only_proposed_ones(tmp_path):
    """**It said "NOTHING CHECKS THIS YET" about a criterion a gate binds.**

    `wringer.gates.yaml` holds gates a drafter PROPOSED; `.wringer.yaml` holds
    the ones a human INSTALLED, and only those run. `_bindings` read the
    sidecar alone, so a repository that had already bound a criterion was told
    nothing checked it — a false sentence, to the reader least able to check
    it, on the page they approve from.

    Found by driving DRIVE end to end against a repository with a binding.
    """
    (tmp_path / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (tmp_path / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: export-works\n"
        '    run: "grep -q text/csv report.py"\n    proves: csv-downloads\n',
        encoding="utf-8",
    )
    text = interview.plan(tmp_path)
    assert "NOTHING CHECKS THIS" not in text.split("copy-reads-well")[0], text
    assert "`export-works`" in text
    assert "seen to FAIL first" in text
    assert "proposed, not installed" not in text


def test_a_PROPOSED_gate_says_so_rather_than_reading_as_installed(tmp_path):
    """The other direction, and it is the honest half: a proposal is not a
    check yet, and a plan that read one as installed would promise a proof
    nobody has agreed to run."""
    (tmp_path / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (tmp_path / "wringer.gates.yaml").write_text(GATES, encoding="utf-8")

    text = interview.plan(tmp_path)
    assert "`export`" in text
    assert "proposed, not installed yet" in text


def test_an_installed_binding_wins_over_a_proposed_one(tmp_path):
    """The plan describes what WILL happen, and what happens is what
    `.wringer.yaml` says."""
    (tmp_path / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (tmp_path / "wringer.gates.yaml").write_text(GATES, encoding="utf-8")
    (tmp_path / ".wringer.yaml").write_text(
        'version: 1\ngates:\n  - id: the-real-one\n    run: "true"\n'
        "    proves: csv-downloads\n",
        encoding="utf-8",
    )
    text = interview.plan(tmp_path)
    assert "`the-real-one`" in text
    assert "proposed, not installed" not in text


# --- SPEC_PMPLAN_V0: the consent surface ------------------------------------

DECISIONS = """\
schema_version: wringer.decisions.v1
assumptions:
  - id: memory-scope
    decision: The export is remembered per browser only.
    why: The requirements describe no accounts.
    instead_of_asking: Should it follow a person to another device?
outcomes:
  - task: build-export
    outcome: You can download exactly the rows you are looking at.
"""


def test_the_plan_shows_what_was_decided_WITHOUT_asking(repo):
    """**The channel the drafter did not have.** Measured 2026-08-19: told to
    prefer visible assumptions and given no field for one, it wrote decisions
    into criteria' test guidance — where the person approving never reads them
    as decisions. This is where they read them as decisions."""
    (repo / "wringer.decisions.yaml").write_text(DECISIONS, encoding="utf-8")

    text = interview.plan(repo)

    assert "DECIDED WITHOUT ASKING YOU" in text
    assert "Approving this plan approves them" in text
    assert "The export is remembered per browser only." in text
    # The displaced question travels with it — that is what stops the channel
    # becoming a tidier hiding place than `guidance` was.
    assert "You were not asked: Should it follow a person" in text


def test_an_id_COINCIDENCE_never_renders_as_though_they_had_answered(repo):
    """**Reproduced by the adversarial review, and this test used to assert
    the defect.** An assumption whose id merely coincides with some question's
    id was joined BY ID, so the plan printed "NO LONGER DECIDED FOR YOU — you
    answered this:" quoting an answer to a completely different question,
    while SUPPRESSING the decision, the reason, and the displaced question
    that the whole channel exists to show. The person was told a decision was
    no longer being taken for them, and never saw what it was.

    That is `carry_answers_forward`'s own rule — an id is not a question —
    broken inside the consent surface itself. The join is on TEXT now."""
    (repo / "wringer.decisions.yaml").write_text(
        DECISIONS.replace("memory-scope", "which-columns"), encoding="utf-8"
    )
    interview.answer(repo, "which-columns", "Just the ones on screen.")

    text = interview.plan(repo)

    assert "NO LONGER DECIDED FOR YOU" not in text
    assert "Just the ones on screen." not in text.split("HOW EACH PIECE")[0]
    # The assumption still renders in full — decision, reason, and the
    # question they were never asked.
    assert "The export is remembered per browser only." in text
    assert "You were not asked: Should it follow a person" in text


def test_revise_REFUSES_an_id_that_is_both_a_question_and_a_decision(repo):
    """A verb that could mean two things must not guess. It used to take the
    question branch silently — overwriting the person's own prior answer,
    which is the loss `answer`'s no-overwrite refusal exists to prevent,
    bypassed precisely because they were aiming at the assumption."""
    (repo / "wringer.decisions.yaml").write_text(
        DECISIONS.replace("memory-scope", "which-columns"), encoding="utf-8"
    )
    interview.answer(repo, "which-columns", "Just the ones on screen.")

    with pytest.raises(interview.InterviewError, match="BOTH an open question"):
        interview.revise(repo, "which-columns", "Something else entirely.")

    assert "Just the ones on screen." in (repo / "wringer.spec.yaml").read_text(
        encoding="utf-8"
    )


def test_an_unreadable_decisions_file_is_SAID_not_rendered_as_no_decisions(
    repo,
):
    """Absence and unreadable are different states. Swallowing the error
    rendered a broken sidecar as "no decisions were taken for you" — a false
    and reassuring sentence, on the page a person approves from, about the one
    thing this file exists to tell them."""
    (repo / "wringer.decisions.yaml").write_text(
        "schema_version: wringer.decisions.v1\nassumptions: [ unclosed",
        encoding="utf-8",
    )

    with pytest.raises(interview.InterviewError, match="could not be read"):
        interview.plan(repo)


def test_an_unknown_decisions_schema_version_is_refused(repo):
    """**`v2` used to be this test's example of "unknown", and now it is not.**

    v2 shipped on 2026-08-21 (the criteria back-reference), so the example
    moved to a version that genuinely does not exist. The property under test
    is unchanged and is the one that matters: a version this reader predates
    must be refused rather than half-rendered.
    """
    (repo / "wringer.decisions.yaml").write_text(
        "schema_version: wringer.decisions.v99\nassumptions: []\n", encoding="utf-8"
    )

    with pytest.raises(interview.InterviewError, match="will not guess"):
        interview.plan(repo)


def test_BOTH_published_decisions_versions_are_read(repo):
    """v1 sidecars already exist on disk and must never stop being readable.

    A reader that accepted only the newest version would turn law 7's "a new
    file, never a changed one" into a break by a different route — the file
    would be untouched and every document written before today would be
    unreadable anyway.
    """
    for version in interview.DECISIONS_VERSIONS:
        (repo / "wringer.decisions.yaml").write_text(
            f"schema_version: {version}\nassumptions: []\n", encoding="utf-8"
        )
        interview.plan(repo)  # must not raise


def test_the_plan_leads_with_the_OUTCOME_and_labels_the_objective(repo):
    """Two registers, prominence to the person's. The objective is
    instructions for whoever builds it and is labelled as such, rather than
    left to look like a promise made to the reader."""
    (repo / "wringer.decisions.yaml").write_text(DECISIONS, encoding="utf-8")

    text = interview.plan(repo)
    build = text.split("WHAT I WILL BUILD")[1].split("HOW EACH PIECE")[0]

    assert "You can download exactly the rows you are looking at." in build
    assert "For the engineer:" in build
    assert build.index("You can download") < build.index("For the engineer:")


def test_a_task_with_no_outcome_says_so_rather_than_going_silent(repo):
    (repo / "wringer.decisions.yaml").write_text(
        DECISIONS.split("outcomes:")[0], encoding="utf-8"
    )

    text = interview.plan(repo)

    assert "no plain-language outcome was written for this task" in text


def test_the_ending_block_counts_INSTALLED_bindings_not_proposed_ones(tmp_path):
    """**Review C1's second leg, and the fixture is the point.** `_bindings()`
    merges proposed gates with installed ones; acceptance joins on the
    installed ones alone. Counting a proposal as a bound check would make this
    block contradict the criteria block a few lines above it, which already
    says "proposed, not installed yet".

    The default `repo` fixture is proposed-only — the one shape in which this
    defect is invisible — so this builds its own with BOTH files.
    """
    (tmp_path / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (tmp_path / "wringer.gates.yaml").write_text(GATES, encoding="utf-8")

    proposed_only = interview.plan(tmp_path)
    block = proposed_only.split("WHAT WILL HAPPEN AT THE END")[1]
    assert "0 of" in block, block

    (tmp_path / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: export-works\n"
        '    run: "grep -q text/csv report.py"\n    proves: csv-downloads\n',
        encoding="utf-8",
    )
    installed = interview.plan(tmp_path)
    assert "1 of" in installed.split("WHAT WILL HAPPEN AT THE END")[1]


def test_the_ending_block_counts_human_criteria_as_their_own_class(repo):
    """A `human` criterion is unbound BY DESIGN — nothing will ever check it.
    Folding it into "nothing checking them yet" would contradict this same
    page, which says "no check can, and none will be written for it"."""
    text = interview.plan(repo)
    block = text.split("WHAT WILL HAPPEN AT THE END")[1]

    assert "yours to decide" in block
    assert "you record the answer yourself" in block


def test_the_ending_block_says_approving_ACCEPTS_the_unproved_ones(repo):
    """The consent this document exists to obtain, and which no draft of the
    plan has ever asked for."""
    block = interview.plan(repo).split("WHAT WILL HAPPEN AT THE END")[1]

    assert "Approving this plan accepts" in block
    assert "will not be proved" in block


def test_the_ending_block_makes_NO_claim_about_what_holds_the_handover(repo):
    """**Counts only** (ruling 9 after review C2). Whether an unbound
    criterion can hold a handover is a fact about `accept.py`, and board
    ruling 1 says this layer renders engine facts rather than authoring prose
    about them. `refusals.py` has no saying for a refusal that will NOT
    happen, so the sentence waits for one rather than being invented here."""
    block = interview.plan(repo).split("WHAT WILL HAPPEN AT THE END")[1]

    lowered = block.lower()
    assert "handover is being held" not in lowered
    assert "will be held" not in lowered


def test_no_ending_block_when_every_criterion_is_installed_bound(tmp_path):
    """A plan predicting an ending that will not happen is noise. Watched
    because a block that always renders would pass every test above."""
    (tmp_path / "wringer.spec.yaml").write_text(
        SPEC.replace("    human: true\n", "    human: false\n"), encoding="utf-8"
    )
    (tmp_path / ".wringer.yaml").write_text(
        "version: 1\ngates:\n"
        '  - id: g1\n    run: "true"\n    proves: csv-downloads\n'
        '  - id: g2\n    run: "true"\n    proves: copy-reads-well\n',
        encoding="utf-8",
    )

    assert "WHAT WILL HAPPEN AT THE END" not in interview.plan(tmp_path)


# --- SPEC_PMPLAN_V0 P3: the way back ----------------------------------------


def test_every_revision_withdraws_the_approval(repo):
    """**The invariant this slice exists to build.** A person changing an
    answer has withdrawn their approval of the plan that answer produced;
    leaving `approved: true` standing would mean a build proceeding on a plan
    nobody agreed to."""
    interview.answer(repo, "which-columns", "The ones on screen.")
    interview.approve(repo, read_the_plan=True)
    assert "approved: true" in (repo / "wringer.spec.yaml").read_text()

    interview.revise(repo, "which-columns", "Actually, every column.")

    text = (repo / "wringer.spec.yaml").read_text(encoding="utf-8")
    assert "approved: false" in text
    assert "Actually, every column." in text
    assert "The ones on screen." not in text


def test_the_flip_is_unconditional_even_when_the_text_is_unchanged(repo):
    """A person saying "change it to X" when it already says X is still asking
    to reconsider. A conditional flip is a branch that can be wrong."""
    interview.answer(repo, "which-columns", "Same answer.")
    interview.approve(repo, read_the_plan=True)

    interview.revise(repo, "which-columns", "Same answer.")

    assert "approved: false" in (repo / "wringer.spec.yaml").read_text()


def test_answers_refusal_to_overwrite_is_UNTOUCHED_by_revise_existing(repo):
    """Two verbs, two consent meanings. `answer` is for a question nobody has
    answered; `revise` is a person changing their mind. This window may not
    quietly unify them."""
    interview.answer(repo, "which-columns", "The ones on screen.")

    with pytest.raises(interview.InterviewError, match="already answered"):
        interview.answer(repo, "which-columns", "Something else.")


def test_revising_a_MULTI_LINE_answer_leaves_no_orphaned_prose(repo):
    """A `|-` block scalar spans several lines. Replacing only the `answer:`
    line would leave the old prose orphaned inside the question's block, where
    the next reader takes it for part of the new answer."""
    import yaml

    interview.answer(repo, "which-columns", "First line.\nSecond line.\nThird.")
    assert "|-" in (repo / "wringer.spec.yaml").read_text(encoding="utf-8")

    interview.revise(repo, "which-columns", "One line now.")

    text = (repo / "wringer.spec.yaml").read_text(encoding="utf-8")
    assert "Second line." not in text, text
    loaded = yaml.safe_load(text)
    answers = [q for q in loaded["open_questions"] if q["id"] == "which-columns"]
    assert len(answers) == 1
    assert answers[0]["answer"] == "One line now."


def test_revise_writes_exactly_one_answer_key_and_the_engine_reads_it(repo):
    """The duplicate-key malformation, guarded from the engine's side. PyYAML
    happens to take the last of a duplicate pair, so a naive append can leave
    the round-trip green while the document is malformed."""
    spec = pytest.importorskip("wringer.spec")
    interview.answer(repo, "which-columns", "First.")
    interview.revise(repo, "which-columns", "Second.")

    raw = (repo / "wringer.spec.yaml").read_text(encoding="utf-8")
    assert raw.count("answer:") == 1, raw
    loaded = spec.load(repo / "wringer.spec.yaml")
    assert {q.id: q.answer for q in loaded.questions}["which-columns"] == "Second."


def test_revising_an_ASSUMPTION_promotes_it_to_a_question_they_answered(repo):
    """What stops the assumptions channel becoming a place to hide decisions.
    It lands in `open_questions` because that is the channel `wring plan`
    already reads into the briefs — an override recorded only in the sidecar
    would be a person correcting a decision the builder never hears."""
    spec = pytest.importorskip("wringer.spec")
    (repo / "wringer.decisions.yaml").write_text(DECISIONS, encoding="utf-8")

    interview.revise(repo, "memory-scope", "No — one browser is fine.")

    loaded = spec.load(repo / "wringer.spec.yaml")
    promoted = {q.id: q for q in loaded.questions}["memory-scope"]
    assert promoted.question == "Should it follow a person to another device?"
    assert promoted.answer == "No — one browser is fine."
    assert loaded.approved is False


def test_a_promoted_assumption_renders_as_superseded_not_as_a_live_decision(
    repo,
):
    """The other half of C8: after promotion the plan must stop presenting the
    decision as one that approving approves."""
    (repo / "wringer.decisions.yaml").write_text(DECISIONS, encoding="utf-8")
    interview.revise(repo, "memory-scope", "No — one browser is fine.")

    text = interview.plan(repo)

    assert "NO LONGER DECIDED FOR YOU" in text
    assert "No — one browser is fine." in text


def test_a_second_revise_of_a_promoted_assumption_edits_the_answer(repo):
    """Dispatch follows the same join the plan does: an id that is now a
    question takes the question path, so revising twice does not promote
    twice."""
    import yaml

    (repo / "wringer.decisions.yaml").write_text(DECISIONS, encoding="utf-8")
    interview.revise(repo, "memory-scope", "First thought.")
    interview.revise(repo, "memory-scope", "Second thought.")

    loaded = yaml.safe_load((repo / "wringer.spec.yaml").read_text(encoding="utf-8"))
    matching = [q for q in loaded["open_questions"] if q["id"] == "memory-scope"]
    assert len(matching) == 1, matching
    assert matching[0]["answer"] == "Second thought."


def test_promotion_works_when_the_spec_asked_NO_questions_at_all(tmp_path):
    """`render()` emits `open_questions: []` in flow style on one line — no
    sibling to measure an indent from, so this is a replacement rather than an
    append, which is also what a person adding their first question by hand
    would type."""
    spec = pytest.importorskip("wringer.spec")
    head, _, _ = SPEC.partition("open_questions:")
    (tmp_path / "wringer.spec.yaml").write_text(
        head + "open_questions: []\n", encoding="utf-8"
    )
    (tmp_path / "wringer.decisions.yaml").write_text(DECISIONS, encoding="utf-8")

    interview.revise(tmp_path, "memory-scope", "One browser is fine.")

    loaded = spec.load(tmp_path / "wringer.spec.yaml")
    assert [q.id for q in loaded.questions] == ["memory-scope"]
    assert loaded.questions[0].answer == "One browser is fine."


def test_revise_refuses_an_id_it_does_not_know_and_names_what_it_does(repo):
    with pytest.raises(interview.InterviewError, match="which-columns"):
        interview.revise(repo, "not-a-thing", "x")


def test_an_empty_revision_is_refused(repo):
    with pytest.raises(interview.InterviewError, match="not an answer"):
        interview.revise(repo, "which-columns", "   ")


def test_answering_an_OPTIONAL_question_after_approval_withdraws_it(repo):
    """**A hole in the invariant, found by the adversarial review of this
    build.** `approve` only requires the REQUIRED questions to be answered, so
    an OPTIONAL one could be answered afterwards — the document a person
    approved changing underneath them, with `approved: true` still standing
    and nothing said.

    `revise` withdrew approval from the day it was written because a revision
    always means reconsidering. This is the quieter case and needs the same
    answer: any content change after an approval withdraws it. The interlock
    only ever tightens."""
    interview.answer(repo, "which-columns", "The ones on screen.")
    interview.approve(repo, read_the_plan=True)
    assert "approved: true" in (repo / "wringer.spec.yaml").read_text()

    interview.answer(repo, "filename", "export.csv")

    text = (repo / "wringer.spec.yaml").read_text(encoding="utf-8")
    assert "approved: false" in text, text
    assert "export.csv" in text


def test_answering_BEFORE_approval_leaves_the_interlock_exactly_as_it_was(repo):
    """The ordinary path, and it must stay a no-op: `approve` refuses while
    required questions are open, so answering normally happens first."""
    before = (repo / "wringer.spec.yaml").read_text(encoding="utf-8")

    interview.answer(repo, "which-columns", "The ones on screen.")

    after = (repo / "wringer.spec.yaml").read_text(encoding="utf-8")
    # Exactly one line added, every original line still present, and the
    # interlock byte-identical to how it started.
    assert after.count("\n") == before.count("\n") + 1
    for line in before.splitlines():
        assert line in after.splitlines(), line
    assert "approved: false" in after


def test_the_withdrawal_covers_the_FILL_path_too(repo):
    """`answer` has two write paths — fill an empty `answer:` in place, or
    append one — and the interlock must be withdrawn on both. `wring spec`
    renders `answer: ''` unconditionally, so the FILL path is the one a real
    drafted spec takes; the fixture here has no `answer:` key, so it exercises
    append. Both, or the hole stays open on the path that matters most."""
    path = repo / "wringer.spec.yaml"
    path.write_text(
        path.read_text(encoding="utf-8").replace(
            "  - id: filename\n    question: What should the file be called?\n"
            "    required: false\n",
            "  - id: filename\n    question: What should the file be called?\n"
            "    required: false\n    answer: ''\n",
        ),
        encoding="utf-8",
    )
    interview.answer(repo, "which-columns", "The ones on screen.")
    interview.approve(repo, read_the_plan=True)
    assert "approved: true" in path.read_text(encoding="utf-8")

    interview.answer(repo, "filename", "export.csv")

    text = path.read_text(encoding="utf-8")
    assert "approved: false" in text, text
    assert "export.csv" in text


def test_two_interlock_lines_are_REFUSED_rather_than_guessed(repo):
    """**The interlock failed OPEN, which is the one direction it may never
    fail.** PyYAML reads the LAST duplicate key; these edits found the FIRST.
    With two top-level `approved: true` lines — silently legal to PyYAML,
    refused by nothing anywhere — `revise` flipped the first, printed "your
    approval was withdrawn", exited 0, and the engine went on reading
    approved=True."""
    import yaml

    path = repo / "wringer.spec.yaml"
    interview.answer(repo, "which-columns", "x")
    path.write_text(
        path.read_text(encoding="utf-8").replace(
            "approved: false", "approved: true\napproved: true", 1
        ),
        encoding="utf-8",
    )

    # Every verb that touches the interlock refuses, including `answer`.
    with pytest.raises(interview.InterviewError, match="records your consent"):
        interview.revise(repo, "which-columns", "y")
    with pytest.raises(interview.InterviewError, match="records your consent"):
        interview.answer(repo, "filename", "export.csv")
    with pytest.raises(interview.InterviewError, match="records your consent"):
        interview.approve(repo, read_the_plan=True)

    # And nothing was changed on the way to refusing.
    assert yaml.safe_load(path.read_text(encoding="utf-8"))["approved"] is True


def test_revising_a_multi_PARAGRAPH_answer_retracts_all_of_it(repo):
    """**Silent content corruption, reproduced.** `_scalar` writes a paragraph
    break inside a `|-` block as a truly empty line, and the deletion walk
    stopped at the first blank — so revising a multi-paragraph answer deleted
    only the first paragraph and left the rest orphaned, which YAML then
    FOLDED INTO THE NEW ANSWER. A person who retracted a sentence found it
    still in their answer, and in the builder's brief.

    `_replace_existing`'s own docstring claimed this could not happen."""
    spec = pytest.importorskip("wringer.spec")
    interview.answer(
        repo, "which-columns", "First paragraph.\n\nSecond paragraph I retract."
    )

    interview.revise(repo, "which-columns", "Totally new answer.")

    loaded = spec.load(repo / "wringer.spec.yaml")
    got = {q.id: q.answer for q in loaded.questions}["which-columns"]
    assert got == "Totally new answer.", got
    assert "retract" not in (repo / "wringer.spec.yaml").read_text(encoding="utf-8")


def test_a_multi_paragraph_answer_survives_being_written_and_read(repo):
    """The other direction: the blank line is part of the body and must come
    back intact, or the fix above would 'work' by destroying paragraphs."""
    spec = pytest.importorskip("wringer.spec")
    text = "First paragraph.\n\nSecond paragraph."
    interview.answer(repo, "which-columns", text)

    loaded = spec.load(repo / "wringer.spec.yaml")
    assert {q.id: q.answer for q in loaded.questions}["which-columns"] == text


def test_a_CRLF_spec_keeps_its_line_endings(repo):
    """**B5, and it was broken on every verb.** `Path.read_text` opens with
    `newline=None`, so universal-newline translation collapsed `\\r\\n` to
    `\\n` before anything here saw it, and `write_text` re-emitted
    `os.linesep`. A CRLF-authored spec came back LF-throughout: EVERY line
    changed, not the one line the verb touched. A person hand-flipping the
    interlock changes one line — that is the whole claim these line edits
    exist to keep."""
    path = repo / "wringer.spec.yaml"
    path.write_bytes(path.read_text(encoding="utf-8").replace("\n", "\r\n").encode())
    before = path.read_bytes()

    interview.answer(repo, "filename", "export.csv")

    after = path.read_bytes()
    assert after.count(b"\r\n") == before.count(b"\r\n") + 1, (
        "line endings were rewritten across the file"
    )
    assert after.count(b"\n") == after.count(b"\r\n"), "a bare LF was introduced"


def test_an_LF_spec_is_not_given_CRLF_either(repo):
    """The mirror. On Windows the same defect ran the other way."""
    path = repo / "wringer.spec.yaml"
    interview.answer(repo, "filename", "export.csv")
    assert b"\r\n" not in path.read_bytes()
