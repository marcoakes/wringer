"""`stop.json` — every stop a first-class product object (0.9.6, SOTA item 3).

Run 5, 2026-09-05: the stops lived in terminal scrollback and three partial
records (`next-move.json` for worker turns, `summary.md` for drafting, the
refusal record for delivery), and `wring explain` could read none of them
back. One record now, at every stop, in the journey's directory — and every
field QUOTED from something that already existed: the step's text and engine
words, the resume preface's derivation of what is preserved and whether the
next action spends, and the step's next move.

Driven through the real verb against a real stopped fixture, never a record
written by this file: a fixture the drive could not have written is not
evidence about the drive (0.9.3).
"""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest
from test_printed_commands import Ctx, drive_json, drive_project, execute, prd

from wringer import evidence
from wringer_drive import journey

SCHEMA = json.loads(
    (Path(__file__).resolve().parent.parent.parent / "schema" / "stop.schema.json")
    .read_text(encoding="utf-8")
)


@pytest.fixture
def ctx(request, tmp_path, monkeypatch, capsys) -> Ctx:
    return Ctx(
        request=request, tmp_path=tmp_path, monkeypatch=monkeypatch, capsys=capsys
    )


def _stopped_journey(ctx: Ctx) -> tuple[Path, dict, list[dict]]:
    """A real drive that builds, fails the build, and stops — the shape
    `capture_resume_next_move` uses. Returns the journey directory, the
    record it wrote, and the steps the drive emitted."""
    project = drive_project(ctx, gate="false", worker=": {brief}; exit 1")
    code, steps = drive_json(
        ["run", str(prd(ctx)), "--repo", str(project)],
        "The ones on screen.\nyes\nyes\n",
    )
    assert code != 0
    ctx.state["project"] = project
    journeys = sorted(journey.journeys_root(project).iterdir())
    assert len(journeys) == 1, "the premise: one journey"
    record = journeys[0] / evidence.STOP_FILENAME
    assert record.is_file(), "the drive stopped and wrote no stop record"
    return journeys[0], json.loads(record.read_text(encoding="utf-8")), steps


def test_a_STOPPED_drive_writes_a_record_that_VALIDATES_and_QUOTES_the_step(ctx):
    journey_dir, record, steps = _stopped_journey(ctx)
    jsonschema.validate(record, SCHEMA)

    stopped = [s for s in steps if s["kind"] == "stopped"]
    assert stopped, "the premise: the drive emitted a stopped step"
    last = stopped[-1]
    assert record["journey_id"] == journey_dir.name
    assert record["step_id"] == last["id"]
    assert record["what"] == last["text"], "the record paraphrased the stop"
    assert record["why"] == last.get("engine_words"), (
        "the record's why is not the engine's own words"
    )

    # **MEASURED, 2026-09-05: this fixture emits `build:max_iterations`
    # (which carries the next move) and then raises
    # `stopped:gates_did_not_pass` (which does not).** The first draft of
    # the writer recorded only the raised step's field and wrote `null`
    # under a console that had just printed a command. The record carries
    # the last next move the console printed, and names its step.
    assert len(stopped) == 2, [s["id"] for s in stopped]
    assert last["id"] == "stopped:gates_did_not_pass"
    assert last.get("next_move") is None, "the fixture's premise changed"
    carrier = next(s for s in reversed(stopped) if s.get("next_move"))
    assert carrier["id"] == "build:max_iterations"
    assert record["next_move"] == carrier["next_move"], (
        "the record's next move is not the last one the console printed, verbatim"
    )
    assert record["next_move_from"] == carrier["id"]


def test_the_record_says_what_is_PRESERVED_and_whether_the_next_step_SPENDS(ctx):
    """Both from `resume_lines` — the SAME derivation the resume preface
    prints — so the record and the preface cannot disagree about one run."""
    from wringer_drive import run as run_module

    journey_dir, record, _ = _stopped_journey(ctx)
    project = ctx.state["project"]
    facts = run_module.resume_facts(project)
    assert facts is not None, "the premise: a checkpoint exists to derive from"
    preserved, _, _, spends = run_module.resume_lines(facts)

    assert record["preserved"] == preserved
    assert record["preserved"], (
        "a stopped build with an approved plan preserved nothing?"
    )
    assert any("the plan in" in line for line in record["preserved"])
    assert record["next_spends"] == spends
    assert isinstance(record["next_spends"], bool), (
        "a checkpoint exists, so whether the next step spends is derivable — "
        "null here is the honest blank used where it is not honest"
    )


def test_the_records_NEXT_MOVE_executes_as_written(ctx):
    """The command in the record moves the run forward — executed as
    written, the way every printed command is. A record whose command does
    not run is scrollback with a schema."""
    import re

    _, record, _ = _stopped_journey(ctx)
    sentence = record["next_move"]
    assert sentence, "the stopped build carried no next move to execute"
    # The registry's own extractor for this family: the command sits at the
    # end of the sentence, backticked, with a full stop after it.
    found = re.search(r"(wringer-drive resume)`?\.?\s*$", sentence)
    assert found, sentence

    ctx.monkeypatch.chdir(ctx.state["project"])
    done = execute(ctx, found.group(1))
    assert "Traceback" not in done.text, done.text
    for label in ("Preserved:", "Reused:", "Will spend:"):
        assert label in done.out, f"the preface lacks {label!r}:\n{done.text}"


def test_explain_READS_THE_STOP_BACK_from_the_journey_directory(ctx, capsys):
    """`wring explain <journey dir>` prints the stop after the phases:
    what, why, preserved, whether the next step spends, and the next move."""
    from wringer import cli

    journey_dir, record, _ = _stopped_journey(ctx)
    ctx.monkeypatch.chdir(ctx.state["project"])
    assert cli.main(["explain", str(journey_dir)]) == cli.EXIT_OK
    out = capsys.readouterr().out

    assert f"Stopped: {record['what']}" in out
    assert "Preserved: " in out
    assert "Next step spends money: " in out
    assert f"Next: {record['next_move']}" in out


def test_a_stop_with_NO_next_move_records_null_and_never_a_composed_sentence(
    tmp_path, monkeypatch
):
    """The honest blank. A step that carried no next move gets `null` in the
    record, not a sentence this package made up for it."""
    from wringer_drive import run as run_module
    from wringer_drive import steps

    repo = tmp_path / "p"
    repo.mkdir()
    journey_id = journey.begin(repo)
    step = steps.Step(
        kind=steps.STOPPED, id="stopped", text="This stopped.", engine_words="said"
    )
    path = run_module.write_stop(repo, journey_id, step)
    assert path is not None and path.is_file()
    record = json.loads(path.read_text(encoding="utf-8"))
    jsonschema.validate(record, SCHEMA)
    assert record["next_move"] is None
    assert record["next_move_from"] is None
    assert record["why"] == "said"
    assert record["next_spends"] is None, (
        "no checkpoint exists here, so whether the next step spends is not "
        "derivable — anything but null is a guess"
    )


def test_BEFORE_A_JOURNEY_EXISTS_nothing_is_written_and_nothing_is_raised(
    tmp_path
):
    from wringer_drive import run as run_module
    from wringer_drive import steps

    step = steps.Step(kind=steps.STOPPED, id="stopped:no-prd", text="No document.")
    assert run_module.write_stop(tmp_path, None, step) is None
    assert not list(tmp_path.rglob(evidence.STOP_FILENAME))
