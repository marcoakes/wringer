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


# ---------------------------------------------------------------------------
# S7 — the repo-as-attacker pass over this window's own diff.
#
# `.wringer/drive/resume.json` is a file INSIDE the repository, and the
# repository is the untrusted thing. So the question is not "does the resume
# work" but "what does a hostile repo buy by shipping one?"
#
# The answer, worked out and then measured: a repo can ship a
# `wringer.spec.yaml` whose questions are already answered AND a
# `resume.json` whose digest matches them, and the read-back confirm is then
# skipped for answers the person never wrote. That is a real thing a repo can
# do, and it is bounded by two properties this file pins:
#
#   1. the answers are still DISPLAYED — the skip removes a yes/no, never the
#      sight of the record;
#   2. every CONSENT gate is still asked live, so nothing is built, installed
#      or delivered on the strength of the file.
#
# Both are already true. Neither was asserted, and property 1 is one `else`
# away from not being.
# ---------------------------------------------------------------------------


def test_A_REPO_SHIPPING_ITS_OWN_RESUME_RECORD_STILL_SHOWS_THE_ANSWERS(
    project, tmp_path
):
    """**The attacker's best move, played, and what it does not buy.**

    The fixture is the hostile arrival: answers already in the spec, and a
    resume record whose digest matches them, both present before the person
    has seen anything. The read-back confirm is skipped — that is the
    mechanism working as designed — and the answers are on screen anyway.
    """
    document = prd(tmp_path)
    from wringer_board import interview

    interview.answer(project, "which-columns", "whatever the repo wants")
    run_module.record_answers_confirmed(project)
    assert run_module.answers_already_confirmed(project), (
        "the fixture did not manage to plant a matching record, so this test "
        "is not measuring the attack"
    )

    _code, steps = drive(project, document, "")

    ids = [step["id"] for step in steps]
    assert "answers-recorded" in ids, (
        "a planted resume record suppressed the DISPLAY of the answers, not "
        "just the confirm — the person cannot see what was decided for them"
    )
    shown = next(s for s in steps if s["id"] == "answers-recorded")
    assert "whatever the repo wants" in shown["text"], (
        "the read-back does not contain the answer it is reading back"
    )
    assert "approve" in [s["id"] for s in steps if s["kind"] == "confirm"], (
        "the run did not reach the approval, so this says nothing about "
        "whether the approval survives a planted record"
    )


def test_A_RECORD_FROM_A_SCHEMA_THIS_VERSION_DOES_NOT_KNOW_IS_IGNORED(
    project, tmp_path
):
    """**The mutation sweep found this one had no guard.**

    `read_resume` checks the schema tag, and nothing exercised it: every
    record the tests produce carries the current tag, so deleting the check
    left the suite green. A `wringer.driveresume.v2` written by a later
    version could then be read by this one under v1's assumptions — which is
    the compatibility failure law 7 exists to prevent, at the one file this
    window added.

    Ignored means ASKED, not trusted: the read-back comes back.
    """
    document = prd(tmp_path)
    drive(project, document, "date, total\nyes\n")
    assert run_module.answers_already_confirmed(project)

    record = json.loads(run_module.resume_path(project).read_text(encoding="utf-8"))
    record["schema"] = "wringer.driveresume.v2"
    run_module.resume_path(project).write_text(json.dumps(record), encoding="utf-8")

    assert run_module.read_resume(project) == {}, (
        "a record tagged with a schema this version has never seen was read "
        "anyway, under this version's assumptions about what its fields mean"
    )
    assert not run_module.answers_already_confirmed(project)
    _code, again = drive(project, document, "")
    assert "answers-ok" in [step["id"] for step in again], (
        "an unreadable record did not fall back to asking"
    )


# ---------------------------------------------------------------------------
# THE BUG HUNT, 2026-08-24 — the write path nothing had attacked.
#
# `read_resume` and `clear_resume` were written to catch `OSError` from the
# start. `_write_resume` was not, and `checkpoint` calls it before EVERY ask —
# so a `.wringer/drive` the process cannot write turned every question in the
# run into a traceback in front of a product manager. Two shapes a real
# machine produces, both measured, both crashing:
#
#     a stray FILE where the directory goes   -> FileExistsError
#     a directory the operator cannot write   -> PermissionError
#
# The same probe found the SAME class one step earlier and PRE-EXISTING:
# `bring_prd_inside` crashed identically, and had done since the verb shipped.
#
# **The two fixes are deliberately different, and the difference is the
# lesson.** The resume record is a convenience: it fails quietly, because the
# whole effect of failing is "the next run will not know where this one
# stopped", which is what shipped before it existed. The PRD copy is
# load-bearing — step 1 reads the file it makes — so it STOPS, with a sentence.
# ---------------------------------------------------------------------------


@pytest.fixture(params=["a file where the directory goes", "unwritable"])
def hostile_drive_dir(request, project):
    """`.wringer/drive` in the two states a real machine produces."""
    drive_dir = project / ".wringer" / "drive"
    drive_dir.parent.mkdir(parents=True, exist_ok=True)
    if request.param == "unwritable":
        drive_dir.mkdir(parents=True, exist_ok=True)
        drive_dir.chmod(0o500)
        yield project
        drive_dir.chmod(0o700)
    else:
        drive_dir.write_text("a stray file\n", encoding="utf-8")
        yield project


def test_A_RESUME_RECORD_THAT_CANNOT_BE_WRITTEN_COSTS_NOTHING(hostile_drive_dir):
    """**The regression this window introduced, and the property that fixes
    it.** `checkpoint` runs before every ask. It may lose the record; it may
    not lose the run."""
    repo = hostile_drive_dir

    run_module.checkpoint(repo, "approve")
    run_module.record_answers_confirmed(repo)

    assert run_module.read_resume(repo) == {}, (
        "the record was written to a place it should not have been writable"
    )
    assert not run_module.answers_already_confirmed(repo), (
        "a record that could not be written still reported a confirmation — "
        "which would skip a question on the strength of a write that failed"
    )
    assert run_module.resumed_step(repo) is None


def test_A_PRD_THAT_CANNOT_BE_COPIED_STOPS_WITH_A_SENTENCE(
    hostile_drive_dir, tmp_path
):
    """**Pre-existing, since the verb shipped, and found by the same probe.**

    The copy is load-bearing, so this one must NOT fail quietly. It must also
    not fail with a traceback: this is the first step of the verb whose whole
    job is that a product manager never sees one.
    """
    session = run_module.Session(repo=hostile_drive_dir)

    with pytest.raises(run_module.Stop) as stopped:
        run_module.bring_prd_inside(session, prd(tmp_path))

    assert stopped.value.exit_code == 2
    assert stopped.value.step.id == "stopped:prd-not-copyable"
    assert "nothing has been read and nothing was created" in stopped.value.step.text
    assert stopped.value.step.engine_words, (
        "the stop does not carry the operating system's own words, so nobody "
        "can tell a full disk from a permissions problem"
    )
