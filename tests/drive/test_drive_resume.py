"""**A killed run comes back to the question it died on — and no further.**

LangChain's `interrupt()` checkpoints the whole state BEFORE asking the human,
so the process may die and the resume replays to the same question
(`~/Claude/WRINGER_DEEPAGENTS_DOSSIER_2026-08-23.md` §3.2). A blocking
JSON-RPC approval dies with its connection; this survives.

**The gap was MEASURED before anything was built**, because SPEC_DRIVE_V0 §8
had already answered "the session record earns nothing" and reversing that on
an argument would have been the wrong kind of confidence. Two real runs, the
first killed at the approval:

    run 1  prd-copied · question · answers-recorded · answers-ok · plan ·
           approve · stopped:nobody-there
    run 2  prd-copied · answers-recorded · answers-ok · stopped

The resumed run landed on the read-back the person had already confirmed, one
step BEFORE the approval, and nothing said where they had got to. Re-asking a
question somebody answered is how a person learns to type `yes` without
reading — and the question immediately after this one is the approval.

**The line this file exists to hold: the resume goes TO a question, never
PAST one.** `answers-ok` is not an approval (ruling 2 says so in the source)
and can be skipped while nothing it confirmed has changed. `approve`,
`gate-approval`, `trial` and `deliver` are consent, and every one of them is
asked live on every run whatever is on disk. The last test here is the one
that would catch a future edit widening the first rule into the second.
"""

from __future__ import annotations

import io
import json
import subprocess
import sys
from pathlib import Path

import pytest

from wringer_drive import run as run_module
from wringer_drive.__main__ import main


@pytest.fixture
def project(tmp_path: Path) -> Path:
    """The same real repository `test_drive.py` builds, from the ENGINE's own
    renderer — never a hand-typed spec."""
    spec = pytest.importorskip("wringer.spec")
    repo = tmp_path / "project"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=repo, check=True)
    for key, value in (
        ("user.email", "pm@e.invalid"),
        ("user.name", "PM"),
        ("commit.gpgsign", "false"),
    ):
        subprocess.run(["git", "config", key, value], cwd=repo, check=True)
    drafted = spec.Spec(
        approved=False,
        title="Weekly report export",
        intent="A manager can export the weekly report as a CSV.",
        questions=(
            spec.Question(id="which-columns", question="Which columns?", required=True),
        ),
        criteria=(
            spec.Criterion(id="exports-csv", title="It exports a CSV", required=True),
        ),
        gates=(),
        tasks=(
            spec.Task(id="build", brief="briefs/build.md", objective="It exports."),
        ),
        path="wringer.spec.yaml",
    )
    (repo / "wringer.spec.yaml").write_text(spec.render(drafted), encoding="utf-8")
    (repo / ".wringer.yaml").write_text(
        "version: 1\n"
        "gates:\n"
        "  - id: unit\n"
        '    run: "true"\n'
        "\n"
        "judge:\n"
        "  endpoint: http://127.0.0.1:1/v1/chat/completions\n"
        "  model: none\n"
        "  rubric: wringer.rubric.yaml\n"
        "\n"
        "run:\n"
        '  worker: "true"\n'
        "  max_iterations: 1\n"
        "\n"
        "deliver:\n"
        '  branch: "wringer/{run}"\n',
        encoding="utf-8",
    )
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "base"], cwd=repo, check=True)
    return repo


def prd(tmp_path: Path) -> Path:
    path = tmp_path / "PRD.md"
    path.write_text("We need the weekly report as a CSV.\n", encoding="utf-8")
    return path


def drive(repo: Path, document: Path, typed: str) -> tuple[int, list[dict]]:
    """One whole run of the real verb, with `typed` as everything the person
    types. The stream simply ENDING is what a killed terminal is."""
    original_in, original_out = sys.stdin, sys.stdout
    sys.stdin = io.StringIO(typed)
    sys.stdout = captured = io.StringIO()
    try:
        code = main(["run", str(document), "--repo", str(repo), "--emit", "json"])
    finally:
        sys.stdin, sys.stdout = original_in, original_out
    steps = []
    for line in captured.getvalue().splitlines():
        if line.strip():
            try:
                steps.append(json.loads(line))
            except json.JSONDecodeError:  # pragma: no cover
                pass
    return code, steps


def test_A_RUN_KILLED_AT_THE_APPROVAL_COMES_BACK_TO_THE_APPROVAL(
    project, tmp_path
):
    """**The property, driven end to end.** Answer the interview and the
    read-back, then die. Come back, type nothing, and see which question is
    in front of you — and that the plan it is asked against is the same
    plan."""
    document = prd(tmp_path)

    first_code, first = drive(project, document, "date, total\nyes\n")
    assert first_code == 2 and first[-1]["id"] == "stopped:nobody-there"
    assert [s["id"] for s in first][-2] == "approve", (
        f"the first run did not die at the approval: {[s['id'] for s in first]}"
    )

    second_code, second = drive(project, document, "")

    ids = [step["id"] for step in second]
    assert "answers-ok" not in ids, (
        f"the resumed run re-asked a question the person already answered: "
        f"{ids}"
    )
    asked = [s["id"] for s in second if s["kind"] == "confirm"]
    assert asked == ["approve"], (
        f"the resumed run did not land on the approval: {ids}"
    )
    assert second_code == 2

    first_plan = next(s for s in first if s["id"] == "plan")["text"]
    second_plan = next(s for s in second if s["id"] == "plan")["text"]
    assert second_plan == first_plan, (
        "the resumed run rendered a DIFFERENT plan under the same approval "
        "question, which is the interlock answering about something the "
        "person never saw"
    )


def test_THE_RESUMED_RUN_SAYS_WHERE_THE_LAST_ONE_STOPPED(project, tmp_path):
    """A skip nobody is told about is indistinguishable from a question that
    was answered for them, so both the resume and the skip are spoken."""
    document = prd(tmp_path)
    drive(project, document, "date, total\nyes\n")

    _code, second = drive(project, document, "")

    ids = [step["id"] for step in second]
    assert "resuming" in ids, f"the resume is silent: {ids}"
    assert "answers-already-confirmed" in ids, f"the skip is silent: {ids}"
    resuming = next(s for s in second if s["id"] == "resuming")
    assert "approve" in resuming["text"], (
        f"the resume does not say WHICH question the last run stopped at: "
        f"{resuming['text']!r}"
    )


def test_CHANGING_AN_ANSWER_BRINGS_THE_READ_BACK_STRAIGHT_BACK(
    project, tmp_path
):
    """**The invalidation, and it is the half that makes the skip lawful.**

    What was confirmed is the ANSWERS, so the confirmation dies with them. The
    edit here is the one the refusal itself recommends — `wringer-board
    revise` — reduced to its effect on disk.
    """
    document = prd(tmp_path)
    drive(project, document, "date, total\nyes\n")
    assert run_module.answers_already_confirmed(project)

    from wringer_board import interview

    interview.revise(project, "which-columns", "date, total, and the region")

    assert not run_module.answers_already_confirmed(project), (
        "an answer changed and the earlier confirmation still stands — the "
        "person would be building from a record they never read back"
    )
    _code, again = drive(project, document, "")
    ids = [step["id"] for step in again]
    assert "answers-ok" in ids, f"the read-back did not come back: {ids}"


def test_NO_CONSENT_GATE_IS_EVER_SKIPPED_BY_THE_RESUME_RECORD():
    """**The line, held structurally.**

    `answers-ok` is the only question the resume may skip, and only because
    ruling 2 states in the source that it is not an approval. This reads the
    driver and fails if the skip is ever widened — because the shape of that
    edit is one more `if already_confirmed` around one more `_confirm`, and
    it would look like tidying.
    """
    body = (
        Path(run_module.__file__).parent / "__main__.py"
    ).read_text(encoding="utf-8")

    guarded = body.count("answers_already_confirmed")
    assert guarded == 1, (
        f"`answers_already_confirmed` is consulted {guarded} times. It gates "
        "exactly one question — the read-back — and a second caller is a "
        "consent gate being answered from a file"
    )
    for gate in ("approval_step", "gate_approval_step", "trial_step", "delivery_step"):
        assert f"_confirm(run_module.{gate}(" in body.replace("\n", " ").replace(
            "  ", " "
        ) or f"{gate}()" in body, f"{gate} is no longer asked at all"

    # And the record itself may never hold an answer to one of them.
    assert "approved" not in run_module.RESUME_SCHEMA
    for forbidden in ("approve", "deliver", "install"):
        assert f'"{forbidden}"' not in body.split("def checkpoint")[0].split(
            "RESUME_FILENAME"
        )[-1][:400], f"the resume record has grown a field about {forbidden}"


def test_AN_UNREADABLE_RESUME_RECORD_COSTS_A_QUESTION_AND_NOT_A_RUN(
    project, tmp_path
):
    """Corrupt is the same as absent. This file can only ever make a run
    GENTLER, so a broken one must fall back to asking — never to proceeding,
    and never to crashing."""
    document = prd(tmp_path)
    drive(project, document, "date, total\nyes\n")
    run_module.resume_path(project).write_text("{not json", encoding="utf-8")

    assert run_module.read_resume(project) == {}
    assert not run_module.answers_already_confirmed(project)

    _code, again = drive(project, document, "")
    ids = [step["id"] for step in again]
    assert "answers-ok" in ids, (
        f"a corrupt resume record did not fall back to asking: {ids}"
    )
    assert "resuming" not in ids


def test_A_FINISHED_RUN_LEAVES_NOTHING_TO_RESUME_TO(project, tmp_path):
    """The record is cleared on completion and kept on a stop, which is the
    only ordering that makes "where did I get to" mean anything."""
    document = prd(tmp_path)
    drive(project, document, "date, total\nyes\n")
    assert run_module.resume_path(project).is_file(), (
        "a run that stopped left no record of where"
    )

    run_module.clear_resume(project)
    assert not run_module.resume_path(project).exists()
    assert run_module.read_resume(project) == {}
