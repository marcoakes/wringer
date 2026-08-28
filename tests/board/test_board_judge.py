"""`wringer-board judge` — the person's pen, and the teeth that keep it theirs.

Field report 2026-08-21, finding 13. The one `human:` criterion in the run
said:

> write your answer into `wringer.judgements.yaml` in the project. Nothing
> else can put it there, and until it is there the handover waits.

There was no verb for it. The file did not exist, so the product manager had
to create it, guess its schema, and hand-write YAML — including a sha256 digest
pinning the answer to the criterion's wording — to unblock a handover. This is
the first log's "recovery means hand-editing YAML", now sitting on the critical
path of every delivery that has a human criterion.

**The law did not loosen and these tests are how that is checked.** No
automation may answer a criterion a human was asked to answer. What moved is
whose hand holds the pen: the friction was aimed at the wrong party — an agent
can write YAML perfectly and compute a sha256 trivially, so the hand-edit
requirement stopped only the human whose judgement the file records.
"""

from __future__ import annotations

import ast
import json
import subprocess
from pathlib import Path

import pytest
import yaml

from wringer_board import interview
from wringer_board import judge as judge_module
from wringer_board.__main__ import build_parser, main

SPEC = """\
schema_version: wringer.spec.v1
approved: true
title: Arcade
intent: Players pick up where they left off.
open_questions: []
criteria:
  - id: heading-reads-as-mine
    title: The heading reads as mine
    guidance: Decide whether it sounds like your product.
    required: true
    human: true
  - id: machine-one
    title: A test asserts the row renders
    required: true
    human: false
gates: []
tasks:
  - id: build
    brief: briefs/build.md
    dir: .
    objective: Build it.
"""


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "A Person"], cwd=root, check=True)
    (root / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    return root


def test_A_PERSON_CAN_RECORD_A_JUDGEMENT_WITHOUT_WRITING_YAML(repo, capsys):
    """The finding itself. One command, and the engine reads the result."""
    assert main(["judge", str(repo), "--id", "heading-reads-as-mine",
                 "--verdict", "met", "--note", "It sounds like us."]) == 0

    said = capsys.readouterr().out
    # **The wording is printed BEFORE the write** — `approve`'s rule, and the
    # whole value of a human judgement is that a person read what they answered.
    assert "The heading reads as mine" in said
    assert said.index("The heading reads as mine") < said.index("recorded")

    written = repo / judge_module.JUDGEMENTS_FILENAME
    assert written.is_file()

    # **The round trip is what proves it, not the file's shape.** The ENGINE
    # has to read this, and its digest has to agree, or a person has answered
    # into a void.
    accept = pytest.importorskip("wringer.accept")
    spec = pytest.importorskip("wringer.spec")
    read = accept.read_judgements(repo)
    assert read["heading-reads-as-mine"]["verdict"] == "met"
    assert read["heading-reads-as-mine"]["note"] == "It sounds like us."
    criterion = next(
        c for c in spec.load(repo / "wringer.spec.yaml").criteria
        if c.id == "heading-reads-as-mine"
    )
    assert read["heading-reads-as-mine"]["criterion_digest"] == (
        accept.criterion_digest(criterion)
    ), "the board's digest disagrees with the engine's — the answer is stale on arrival"


def test_the_written_file_matches_its_published_schema(repo):
    """Hand-rendered, so this is the guard that it is still the format the
    engine publishes. A writer that drifts from its own schema is a file
    nothing else can read."""
    jsonschema = pytest.importorskip("jsonschema")
    main(["judge", str(repo), "--id", "heading-reads-as-mine",
          "--verdict", "not_met", "--note", "The heading is generic."])
    schema = json.loads(
        (Path(__file__).resolve().parents[2] / "schema" / "judgements.schema.json")
        .read_text(encoding="utf-8")
    )
    jsonschema.validate(
        yaml.safe_load((repo / judge_module.JUDGEMENTS_FILENAME).read_text("utf-8")),
        schema,
    )


def test_RE_WORDING_THE_REQUIREMENT_STALES_THE_ANSWER(repo):
    """The pin, and it is the reason a digest is written at all.

    Somebody answered a question. If the question changes, they answered a
    different one, and the answer must stop counting. This is the property
    that makes it safe for the verb to be easy.
    """
    accept = pytest.importorskip("wringer.accept")
    spec = pytest.importorskip("wringer.spec")
    main(["judge", str(repo), "--id", "heading-reads-as-mine",
          "--verdict", "met", "--note", "Fine."])

    path = repo / "wringer.spec.yaml"
    path.write_text(
        path.read_text(encoding="utf-8").replace(
            "The heading reads as mine", "The heading names the customer"
        ),
        encoding="utf-8",
    )

    criterion = next(
        c for c in spec.load(path).criteria if c.id == "heading-reads-as-mine"
    )
    recorded = accept.read_judgements(repo)["heading-reads-as-mine"]
    assert recorded["criterion_digest"] != accept.criterion_digest(criterion), (
        "a reworded requirement kept its old answer — somebody's judgement of "
        "a different question is being counted"
    )
    # And the verb itself says it is waiting again.
    waiting = [c["id"] for c in judge_module.unanswered(repo)]
    assert "heading-reads-as-mine" in waiting


def test_only_a_HUMAN_criterion_can_be_judged(repo, capsys):
    """A machine criterion has a gate. A person marking one met by hand would
    be able to turn any red check green by typing a sentence, which is the
    entire evidence chain defeated from the surface."""
    assert main(["judge", str(repo), "--id", "machine-one",
                 "--verdict", "met"]) == 2
    assert "not a criterion a person answers" in capsys.readouterr().err
    assert not (repo / judge_module.JUDGEMENTS_FILENAME).exists()


def test_naming_no_criterion_LISTS_and_writes_nothing(repo, capsys):
    """A person who does not know the ids should not have to read a YAML file
    to find them — that is the complaint this verb answers, and it would be
    absurd to answer it with a verb that requires reading a YAML file."""
    assert main(["judge", str(repo)]) == 0
    said = capsys.readouterr().out
    assert "heading-reads-as-mine" in said
    assert "machine-one" not in said, "a machine criterion was offered for judgement"
    assert not (repo / judge_module.JUDGEMENTS_FILENAME).exists()


def test_naming_a_criterion_with_NO_verdict_prints_it_and_writes_nothing(
    repo, capsys
):
    """Reading the requirement and answering it are separate acts, and a
    person may do the first without the second."""
    assert main(["judge", str(repo), "--id", "heading-reads-as-mine"]) == 2
    assert "The heading reads as mine" in capsys.readouterr().out
    assert not (repo / judge_module.JUDGEMENTS_FILENAME).exists()


# --- the three teeth, AMENDED rather than deleted ---------------------------


def test_TOOTH_1_judging_changes_the_directory_by_at_most_the_one_file(repo):
    """Before: no board verb changed the directory listing at all. Now exactly
    one file may appear, and it is named."""
    before = {p.name for p in repo.iterdir()}
    main(["judge", str(repo), "--id", "heading-reads-as-mine",
          "--verdict", "met", "--note", "Fine."])
    after = {p.name for p in repo.iterdir()}
    assert after - before == {judge_module.JUDGEMENTS_FILENAME}, (
        f"judging created or removed something else: {after ^ before}"
    )
    # Twice must be idempotent in the listing sense — one answer per criterion.
    main(["judge", str(repo), "--id", "heading-reads-as-mine",
          "--verdict", "not_met", "--note", "Changed my mind."])
    assert {p.name for p in repo.iterdir()} == after
    entries = yaml.safe_load(
        (repo / judge_module.JUDGEMENTS_FILENAME).read_text("utf-8")
    )["judgements"]
    assert len(entries) == 1, "a second answer appended instead of replacing"
    assert entries[0]["verdict"] == "not_met"


def test_TOOTH_2_the_judgements_path_is_named_ONLY_in_the_judge_module():
    """**Retargeted, not deleted.** The old check asserted that no board
    module named a judgements path in executable code. That is now false of
    exactly one file, so the check becomes: only that file may name it.

    The teeth are the same. A judgements FILE PATH appearing in `render.py`,
    `cards.py`, `read.py` or `interview.py` would mean a second writer, which
    is the thing the original guard existed to prevent.

    **The word is not the path.** This looks for the FILENAME, not for
    "judgement": a refusal id like `human-judgement-stale`, and prose telling
    a person what is waiting on them, are the surface doing its job. The
    original check could afford the broader net because no board module named
    the file at all; now exactly one does, and the net has to be aimed at what
    actually matters, which is who can WRITE it.
    """
    package = Path(interview.__file__).parent
    offenders = []
    for path in sorted(package.glob("*.py")):
        if path.name == "judge.py":
            continue
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        # Only the three node kinds that HAVE a docstring. `getattr(node,
        # "body")` on an `IfExp` returns an expression rather than a list, and
        # subscripting it raises — the same walk the interview guard does, and
        # it restricts the node kinds for this reason.
        docstrings = set()
        for node in ast.walk(tree):
            if not isinstance(
                node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
            ):
                continue
            body = node.body
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
            ):
                docstrings.add(id(body[0].value))
        offenders += [
            f"{path.name}:{n.lineno}: {n.value!r}"
            for n in ast.walk(tree)
            if isinstance(n, ast.Constant)
            and isinstance(n.value, str)
            and id(n) not in docstrings
            and judge_module.JUDGEMENTS_FILENAME in n.value
        ]
    assert offenders == [], (
        f"the judgements FILE is named outside judge.py: {offenders}. One "
        "writer, so one place has to be right about the format and the digest"
    )


def test_TOOTH_3_every_write_in_the_judge_module_goes_through_the_one_writer():
    """`interview._write`, and nothing else. One writer means one place has to
    be right about line endings and about the target path."""
    source = Path(judge_module.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    direct = [
        n.lineno
        for n in ast.walk(tree)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr in ("write_text", "write_bytes", "mkdir", "unlink")
    ]
    assert direct == [], f"a write bypasses `_write` at line(s) {direct}"


def test_the_ENGINE_still_writes_no_judgement():
    """**The law that did not move, checked from this side too.**

    `tests/test_accept_v3.py::test_no_flag_no_env_var_and_no_command_can_write
    _a_judgement` is the primary guard and is byte-untouched — it scans
    `src/wringer/`, which this change does not touch. This asserts the same
    fact from the board's side, so a later refactor that moved `judge.py` into
    the engine would redden something.
    """
    accept = pytest.importorskip("wringer.accept")
    engine = Path(accept.__file__).parent
    assert engine.name == "wringer"
    writers = []
    for path in sorted(engine.glob("*.py")):
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                if node.func.attr in ("write_text", "write_bytes", "safe_dump", "dump"):
                    segment = ast.get_source_segment(source, node) or ""
                    if "JUDGEMENT" in segment.upper():
                        writers.append(f"{path.name}:{node.lineno}")
    assert writers == [], f"the engine writes a judgement at {writers}"


def test_there_is_NO_BULK_MODE_and_no_flag_that_answers_without_printing():
    """A verdict given in a batch is a verdict nobody gave individually, and a
    switch is something you can hit by accident. Read off the real parser."""
    parser = build_parser()
    flags: list[str] = []
    for action in parser._actions:
        choices = getattr(action, "choices", None)
        if not hasattr(choices, "values"):
            continue
        for name, sub in choices.items():
            if name != "judge":
                continue
            flags += [s for a in sub._actions for s in a.option_strings]
    assert "--verdict" in flags, "the judge parser was not introspected at all"
    for banned in ("--all", "--met", "--yes", "--from", "--file", "--quiet", "-q"):
        assert banned not in flags, (
            f"{banned} lets a judgement be given without reading the "
            "requirement, or gives several at once"
        )
    # The verdict is typed out, from a closed set, and there is no third value.
    assert judge_module.VERDICTS == ("met", "not_met")


def test_an_unreadable_judgements_file_REFUSES_rather_than_overwriting(repo):
    """**The opposite of the engine's rule for the same file, on purpose.**

    `accept.read_judgements` treats a broken file as absent, because it runs
    inside `wring verify` and a malformed sibling must not take down a
    verification. This is a WRITER: if it cannot read what is there, writing
    would destroy answers somebody already gave.
    """
    (repo / judge_module.JUDGEMENTS_FILENAME).write_text(
        "schema_version: wringer.judgement.v1\njudgements: [ oh dear\n",
        encoding="utf-8",
    )
    before = (repo / judge_module.JUDGEMENTS_FILENAME).read_bytes()
    with pytest.raises(interview.InterviewError, match="could not be read"):
        judge_module.record(
            repo, "heading-reads-as-mine", "met", read_the_criterion=True
        )
    assert (repo / judge_module.JUDGEMENTS_FILENAME).read_bytes() == before


def test_recording_without_having_shown_the_criterion_is_refused(repo):
    """`read_the_criterion` is `approve`'s `read_the_plan`, with the same
    meaning and the same honest limitation: it is the caller's assertion, and
    the CLI is what makes it true by printing first."""
    with pytest.raises(interview.InterviewError, match="has been shown"):
        judge_module.record(
            repo, "heading-reads-as-mine", "met", read_the_criterion=False
        )
    assert not (repo / judge_module.JUDGEMENTS_FILENAME).exists()


def test_a_verdict_outside_the_closed_pair_is_refused(repo):
    with pytest.raises(interview.InterviewError, match="met or not_met"):
        judge_module.record(
            repo, "heading-reads-as-mine", "probably", read_the_criterion=True
        )
    assert not (repo / judge_module.JUDGEMENTS_FILENAME).exists()


# --- S4c: ONE arithmetic across badges, bodies and the summary --------------


def test_EVERY_CARD_STATE_IS_CLASSIFIED_BY_WHO_IS_BLOCKED():
    """**The partition, and the reason the page had three answers.**

    Field report 2026-08-21 finding 12, measured on a populated board: eight
    rows badged `NEEDS YOU`, each with a body reading *"Nothing is needed from
    you — an engineer has to bind a check to this"*, all eight counted in the
    summary's *"8 will not be proved"* while the summary also said *"2 still
    needs you"*. Badges said nine, bodies said one, the summary said two.

    It happened because the badge and the summary were reading DIFFERENT
    partitions: the badge read `state`, the summary counted `refused`. There
    is one partition now and both read it — so a state nobody classified is a
    state that would silently default into somebody's column, and that fails
    here instead.
    """
    from wringer_board import cards

    classified = (
        set(cards.BLOCKED_ON_PERSON)
        | set(cards.BLOCKED_ON_ENGINEER)
        | set(cards.BLOCKED_ON_THE_WORK)
        | set(cards.SETTLED)
        | set(cards.INDETERMINATE)
    )
    assert classified == set(cards.STATES), (
        "these states are not classified by who is blocked: "
        f"{set(cards.STATES) ^ classified}"
    )
    # Mutually exclusive, or a row would be counted twice in one line.
    groups = [
        cards.BLOCKED_ON_PERSON,
        cards.BLOCKED_ON_ENGINEER,
        cards.BLOCKED_ON_THE_WORK,
        cards.SETTLED,
        cards.INDETERMINATE,
    ]
    assert sum(len(g) for g in groups) == len(classified), "a state is in two groups"


def test_NO_STATE_BLAMING_THE_READER_EXCEPT_THE_ONE_THAT_MEANS_IT():
    """`NEEDS YOU` is reserved for rows a person actually unblocks.

    The word "you" in a badge is a demand for attention, and the measured
    failure was making that demand eight times over rows whose own text said
    nothing was needed. Only the states in `BLOCKED_ON_PERSON` may say it.
    """
    from wringer_board import cards

    for state in cards.STATES:
        if state in cards.BLOCKED_ON_PERSON:
            continue
        assert "you" not in state.lower(), (
            f"{state!r} tells the reader they are the blocker, and the "
            "summary does not count it that way"
        )


def test_the_summary_and_the_badges_partition_the_SAME_criteria(tmp_path):
    """The arithmetic, on a populated page rather than on the constants.

    One page, one partition: every card carries exactly one state, every state
    lands in exactly one summary bucket, and the buckets sum to the number of
    criteria. This is the property a reader is entitled to — that the three
    places the page answers "what do I have to do?" agree.
    """
    import re

    from wringer_board import cards
    from wringer_board import read as read_module
    from wringer_board import render as render_module

    def row(cid, state, cause, *, refuses=True, gate=None):
        return read_module.Criterion(
            id=cid,
            title=f"Requirement {cid}",
            required=True,
            state=state,
            refuses=refuses,
            gate_id=gate,
            command="pytest -q" if gate else None,
            reason="",
            receipt=None,
            witness=None,
            cause=cause,
        )

    # **The field report's own shape**: one criterion a person must judge, and
    # a pile of criteria nothing checks. That combination is what produced
    # nine badges, one body sentence and two summary counts.
    board = read_module.Board(
        repo=tmp_path,
        criteria=[
            row("human-one", "human", "human-unanswered"),
            *[
                row(f"unbound-{n}", "unevidenced", "unbound")
                for n in range(8)
            ],
            row("engineer-one", "unevidenced", "born-green", gate="suite"),
        ],
    )
    made = [cards.card_for(board, c) for c in board.criteria]
    page = render_module.render(board)

    counts = re.search(r'<p class="counts">(.*?)</p>', page, re.S)
    assert counts, "the page has no summary line at all"
    line = counts.group(1)

    total = int(re.search(r"of (\d+) proved", line).group(1))
    assert total == len(made), "the summary counts a different number of rows"

    person = sum(1 for c in made if c.state in cards.BLOCKED_ON_PERSON)
    found = re.search(r"(\d+) needs you", line)
    assert (int(found.group(1)) if found else 0) == person, (
        f"the summary and the badges disagree about who needs the reader: "
        f"{line!r} over {[c.state for c in made]}"
    )
    # The measured page: ONE row needs the reader, not nine.
    assert person == 1, [c.state for c in made]
    assert "8 needs you" not in line and "9 needs you" not in line


def test_A_BADGE_AND_ITS_OWN_BODY_NEVER_CONTRADICT_EACH_OTHER():
    """**The third leg, and the one that actually catches finding 12.**

    A first version of this guard compared the summary count with the badge
    count — and it passed with the defect fully restored, because after the
    fix both read the same field and agreed trivially. A tautology reads
    exactly like a guard until you revert the thing it is supposed to be
    guarding, which is why every fix in this window is watched red.

    The real contradiction was never summary-vs-badge. It was **badge versus
    the card's own body**: eight rows badged `NEEDS YOU` whose bodies read
    *"Nothing is needed from you — an engineer has to bind a check to this."*
    A reader scanning badges and a reader reading bodies got opposite answers
    from the same card.

    So this checks the two against each other, over every cause the board can
    render.
    """
    from wringer_board import cards
    from wringer_board import read as read_module

    def texts(card):
        return f"{card.sentence} {card.question or ''}".lower()

    for state_name, causes in (
        ("unevidenced", (
            "unbound",
            "born-green",
            "witness-evidenced-nothing",
            "pre-existence-unestablished",
            "arrived-with-the-work",
        )),
        ("human", ("human-unanswered", "human-said-no", "human-judgement-stale")),
    ):
        for cause in causes:
            card = cards.card_for(
                read_module.Board(repo=Path('.')),
                _criterion(state=state_name, cause=cause, gate_id="unit"),
            )
            said = texts(card)
            if card.state in cards.BLOCKED_ON_PERSON:
                assert "nothing is needed from you" not in said, (
                    f"{cause}: badged {card.state!r} while its own body says "
                    "nothing is needed from the reader"
                )
            else:
                assert "only you can answer" not in said, (
                    f"{cause}: badged {card.state!r} while its own body says "
                    "only the reader can answer it"
                )


def test_TWO_REFUSED_ROWS_DO_NOT_SAY_THE_IDENTICAL_THING(tmp_path):
    """Field report 2026-08-22 finding 13, on a rendered page.

    Reproduced before it was fixed: a `gate-failed` row and an unanswered
    `human:` row both refuse, both printed *"Refused — This one is holding up
    the handover"* verbatim, and they were badged `NOT YET` and `NEEDS YOU`.
    A reader met two rows saying the same thing under two different badges,
    with nothing on the page reconciling them.

    Ruling 4a is not touched — refusal is still not a state and the two badges
    still differ, because the two rows really are blocked on different people.
    What lands is one RULE: the chip is a function of the same who-is-blocked
    partition the badge is, so the chip and the badge cannot disagree.

    The assertions here are literal strings read out of the page, never
    `WAITING_ON` fed back to itself — the finding-12 lesson is that a guard
    derived from the thing it guards passes with the defect fully restored.
    """
    import re

    from wringer_board import read as read_module
    from wringer_board import render as render_module

    def row(cid, state, cause, *, gate=None):
        return read_module.Criterion(
            id=cid,
            title=f"Requirement {cid}",
            required=True,
            state=state,
            refuses=True,
            gate_id=gate,
            command="npm test" if gate else None,
            reason="",
            receipt=None,
            witness=None,
            cause=cause,
        )

    board = read_module.Board(
        repo=tmp_path,
        criteria=[
            row("the-work", "gate-failed", None, gate="suite"),
            row("the-person", "human", "human-unanswered"),
        ],
    )
    page = render_module.render(board)

    chips = re.findall(r'<span class="badge">Refused</span>([^<]*)', page)
    assert len(chips) == 2, f"expected two refused chips, got {chips!r}"
    assert chips[0] != chips[1], (
        "both refused rows print the identical chip while carrying different "
        f"badges — finding 13, restored: {chips[0]!r}"
    )

    work_chip, person_chip = chips
    assert "waiting on you" in person_chip, (
        f"the row a PERSON unblocks does not say so: {person_chip!r}"
    )
    assert "waiting on you" not in work_chip, (
        "a row nobody is asking the reader to do says it is waiting on them: "
        f"{work_chip!r}"
    )
    assert "waiting on the work" in work_chip, work_chip


def test_the_refused_chip_and_the_badge_read_ONE_partition():
    """Totality, so a new state cannot arrive without a chip clause.

    `waiting_on` raises on an unclassified state rather than printing a
    sentence nothing decided, and the same law the badges live under —
    only `BLOCKED_ON_PERSON` says "you" — applies to the chip.
    """
    from wringer_board import cards

    for state in cards.STATES:
        clause = cards.waiting_on(state)
        assert clause, f"{state!r} has an empty chip clause"
        if state not in cards.BLOCKED_ON_PERSON:
            assert "you" not in clause.lower(), (
                f"{state!r}'s refused chip tells the reader they are the "
                f"blocker while its badge does not: {clause!r}"
            )
    assert set(cards.WAITING_ON) == set(cards.STATES), (
        "these states have no refused-chip clause: "
        f"{set(cards.STATES) ^ set(cards.WAITING_ON)}"
    )
    with pytest.raises(KeyError):
        cards.waiting_on("A STATE NOBODY CLASSIFIED")


def _criterion(*, state, cause, gate_id=None):
    from wringer_board import read as read_module

    return read_module.Criterion(
        id="c",
        title="T",
        required=True,
        state=state,
        refuses=True,
        gate_id=gate_id,
        command="pytest -q" if gate_id else None,
        reason="",
        receipt=None,
        witness=None,
        cause=cause,
    )


# --- field report 2026-08-28: the two ways the pen was unreachable ----------


def test_a_NOT_MET_criterion_is_offered_again(repo, capsys):
    """**The closed loop, and it closed on the product's own reason to exist.**

    A person judged a requirement not met. An engineer fixed exactly what they
    objected to. The person ran `wringer-board judge` to look again and was
    told *"nothing is waiting on your judgement in this repository"* — while
    the engine went on refusing the delivery on that same verdict, and would
    have gone on refusing it forever, because the one verb that moves the pen
    would not offer the question a second time.

    Only `met` settles a criterion. A `not_met` is an open objection.
    """
    assert main(["judge", str(repo), "--id", "heading-reads-as-mine",
                 "--verdict", "not_met", "--note", "It is generic."]) == 0
    capsys.readouterr()

    assert main(["judge", str(repo)]) == 0
    said = capsys.readouterr().out
    assert "nothing is waiting" not in said.lower(), (
        "a requirement somebody rejected was dropped from the list, so the fix "
        "for it can never be re-judged"
    )
    assert "heading-reads-as-mine" in said
    # **Their own words back.** A re-offered requirement and one nobody has
    # ever looked at ask for completely different things.
    assert "You said this was NOT met" in said
    assert "It is generic." in said


def test_a_MET_criterion_is_settled_and_stays_off_the_list(repo, capsys):
    assert main(["judge", str(repo), "--id", "heading-reads-as-mine",
                 "--verdict", "met", "--note", "It sounds like us."]) == 0
    capsys.readouterr()
    assert main(["judge", str(repo)]) == 0
    assert "nothing is waiting" in capsys.readouterr().out.lower()


def test_the_person_is_SHOWN_the_thing_they_are_judging(repo, capsys):
    """**The finding of run 2.**

    A person was asked to judge the wording of a summary, and the summary
    appeared in no surface Wringer has: not this command, not the board, not
    the run bundle. They could answer only because an agent pasted it into a
    chat window unprompted.
    """
    (repo / ".wringer.yaml").write_text(
        "version: 1\n"
        "gates:\n"
        "  - id: t\n"
        "    run: 'true'\n"
        "show:\n"
        "  heading-reads-as-mine: printf 'Welcome back to Arcade'\n",
        encoding="utf-8",
    )
    assert main(["judge", str(repo), "--id", "heading-reads-as-mine"]) == 2
    said = capsys.readouterr().out
    assert "Welcome back to Arcade" in said, (
        "the person was asked to judge something this command never showed them"
    )
    # The requirement first, then the thing, then the question.
    assert said.index("The heading reads as mine") < said.index("Welcome back")


def test_when_NOTHING_can_be_shown_the_command_SAYS_SO(repo, capsys):
    """Asking somebody to judge what you will not show them is the defect.
    Asking while pretending nothing is missing is the same defect with the
    evidence removed."""
    assert main(["judge", str(repo), "--id", "heading-reads-as-mine"]) == 2
    said = capsys.readouterr().out
    assert "NOTHING IS BEING SHOWN TO YOU" in said
    assert "show:" in said
    assert "heading-reads-as-mine" in said


def test_a_show_command_is_read_from_the_PERSONS_file_not_the_spec(repo):
    """**The boundary, and it is the reason `show:` is not in the spec.**

    `wringer.spec.yaml` is drafted by a model. `.wringer.yaml` is the person's,
    and it is already the file where a command earns the right to run — `wring
    plan` prints proposed gates as a diff and refuses to install one itself. A
    `show:` in the spec would be a model-supplied command executing on a
    person's machine on the strength of having been suggested.
    """
    spec_module = pytest.importorskip("wringer.spec")
    text = (repo / "wringer.spec.yaml").read_text(encoding="utf-8")
    loaded = spec_module.load(repo / "wringer.spec.yaml")
    assert "show" not in text
    for criterion in loaded.criteria:
        assert not hasattr(criterion, "show"), (
            "a criterion carries a `show:` command, so a drafted spec can put "
            "a command on a person's machine"
        )


def test_the_shown_text_keeps_the_shape_the_person_is_judging(repo, capsys):
    """A plain `.strip()` eats the FIRST line's indentation and no other's.

    The requirement this exists for is about whether columns line up. A
    surface that re-indents the thing on the way past is deciding the answer.
    """
    (repo / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: t\n    run: 'true'\n"
        "show:\n  heading-reads-as-mine: \"printf '  a\\\\n  b\\\\n'\"\n",
        encoding="utf-8",
    )
    text, _ = judge_module.shown(repo, "heading-reads-as-mine")
    assert text == "  a\n  b", (
        f"the shown text was re-indented on the way to the person: {text!r}"
    )
