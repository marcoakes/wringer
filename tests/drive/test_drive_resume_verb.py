"""**`wringer-drive resume` — one reliable resume command (0.7.1, P0.2).**

Run 4B, 2026-09-01: a worker turn was refused with a 401, the operator read
"an attempt changed nothing at all", and no verb said how to continue. What
existed — re-running `wringer-drive run` — reused the approved spec and spent
nothing on a second draft (measured), and SAID none of that: no sentence
named what was preserved, what would be reused, or what the next attempt
would cost. A person who cannot see that a retry is cheap does not retry.

The verb here reads the checkpoint the run left, refuses a plan whose bytes
moved since it was approved, prints one preface step with three labelled
lines, and joins THE SAME sequence `run` drives at the phase that stopped.
Two front doors, one implementation — the last test holds that structurally.

**S7, the repo-as-attacker pass, for this verb.** A hostile repository can
ship `approved: true` in its spec and a record whose phase is `build` with a
matching digest, and `resume` will then go to the build without a person
having read the plan in THIS process. That is exactly the engine's own
posture — `wring run` on that repository runs on the spec's `approved: true`
and asks nobody — and `run`, which asks the approval live every time, is
one word away. The preface shows what is being reused, by name, before the
build starts; nothing is delivered on the strength of the file, because the
handover's second yes is still asked live.
"""

from __future__ import annotations

import ast
import io
import json
import subprocess
import sys
from pathlib import Path

import pytest

from wringer_drive import run as run_module
from wringer_drive.__main__ import main

SRC = Path(run_module.__file__).parent


def _project(tmp_path: Path, *, gate: str, worker: str) -> Path:
    """The same real repository `test_drive.py` builds, from the ENGINE's own
    renderer, with the one check and the one worker this file needs."""
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
        f"    run: {json.dumps(gate)}\n"
        "\n"
        "judge:\n"
        "  endpoint: http://127.0.0.1:1/v1/chat/completions\n"
        "  model: none\n"
        "  rubric: wringer.rubric.yaml\n"
        "\n"
        "run:\n"
        f"  worker: {json.dumps(worker)}\n"
        "  max_iterations: 1\n"
        "\n"
        "deliver:\n"
        '  branch: "wringer/{run}"\n',
        encoding="utf-8",
    )
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "base"], cwd=repo, check=True)
    return repo


@pytest.fixture
def failing_build(tmp_path: Path) -> Path:
    """A red check and a worker whose turn FAILS — run 4B's shape: the loop
    hands the failure to the agent, the agent's turn exits non-zero having
    written nothing, and the build stops at `no_progress`."""
    return _project(tmp_path, gate="false", worker=": {brief}; exit 1")


@pytest.fixture
def converging_build(tmp_path: Path) -> Path:
    """A green check, so the loop converges without a worker turn and the run
    reaches the handover — which this fixture, having no remote, refuses."""
    return _project(tmp_path, gate="true", worker=": {brief}; true")


def prd(tmp_path: Path) -> Path:
    path = tmp_path / "PRD.md"
    path.write_text("We need the weekly report as a CSV.\n", encoding="utf-8")
    return path


def drive(argv: list[str], typed: str) -> tuple[int, list[dict]]:
    """One whole invocation of the real verb in json mode, with `typed` as
    everything the person types. The stream ENDING is a killed terminal."""
    original_in, original_out = sys.stdin, sys.stdout
    sys.stdin = io.StringIO(typed)
    sys.stdout = captured = io.StringIO()
    try:
        code = main([*argv, "--emit", "json"])
    finally:
        sys.stdin, sys.stdout = original_in, original_out
    steps = []
    for line in captured.getvalue().splitlines():
        if line.strip():
            steps.append(json.loads(line))
    return code, steps


def counting_engine_calls(monkeypatch) -> list[list[str]]:
    """Every engine subprocess the verb launches, by argv — so a drafting call
    is COUNTED rather than inferred from the absence of a step."""
    launched: list[list[str]] = []
    real = run_module.run_command

    def recording(repo, argv, env=None):
        launched.append(list(argv))
        return real(repo, argv, env)

    monkeypatch.setattr(run_module, "run_command", recording)
    return launched


def _stop_at_the_failed_turn(repo: Path, document: Path) -> list[dict]:
    """`run` through the interview, the read-back and the approval, into a
    build whose only turn fails. Returns the steps, having asserted the shape
    is the one the fixture promises."""
    code, steps = drive(["run", str(document), "--repo", str(repo)],
                        "The ones on screen.\nyes\nyes\n")
    ids = [step["id"] for step in steps]
    # MEASURED, not assumed: with `max_iterations: 1` the engine ends the loop
    # on its budget (`build:max_iterations`) after the one failed turn, not on
    # `no_progress` — that check runs before a NEXT turn. Either way the
    # build STOPPED after a turn that failed, which is the shape this needs.
    built = [s for s in steps if s["id"].startswith("build:")]
    assert built and built[-1]["kind"] == "stopped", (
        f"the build did not stop at a failed turn: {ids}"
    )
    assert code != 0, "the run did not end on a stop, so there is nothing to resume"
    assert run_module.read_resume(repo).get("phase") == "build", (
        "the record does not name the build as the phase that stopped: "
        f"{run_module.read_resume(repo)}"
    )
    return steps


# --- the named stop when there is nothing to continue -----------------------


def test_RESUME_WITH_NO_CHECKPOINT_STOPS_AND_NAMES_THE_RUN_VERB(converging_build):
    """A resume that finds no record says so and says what to run instead —
    exit 2, the code every missing-precondition stop in this verb uses
    (`stopped:no-prd`, `stopped:not-a-repo`)."""
    assert run_module.read_resume(converging_build) == {}

    code, steps = drive(["resume", "--repo", str(converging_build)], "")

    assert code == 2
    assert [step["id"] for step in steps] == ["stopped:nothing-to-resume"], steps
    assert "wringer-drive run" in steps[-1]["text"], (
        "the stop names no command to run next"
    )
    assert steps[-1]["kind"] == "stopped"


# --- run 4B's shape: a failed worker turn, then `resume` ---------------------


def test_A_RUN_STOPPED_AT_A_FAILED_TURN_RESUMES_AT_THE_BUILD_ASKING_AND_DRAFTING_NOTHING(
    failing_build, tmp_path, monkeypatch
):
    """**The plan's guard, verbatim: stop at a failed worker turn → `resume`
    → the drafting endpoint's call count stays zero, no ASK is re-emitted,
    the loop runs.** Plus the three lines, present and derived from the
    record rather than recited."""
    document = prd(tmp_path)
    first = _stop_at_the_failed_turn(failing_build, document)
    first_loop = next(s for s in first if s["id"].startswith("build:"))["detail"]["loop"]

    launched = counting_engine_calls(monkeypatch)
    code, steps = drive(["resume", "--repo", str(failing_build)], "")
    ids = [step["id"] for step in steps]

    # Nothing drafted: not one `wring spec` launch, not one drafting step.
    assert not [argv for argv in launched if "spec" in argv], (
        f"resume launched the drafting verb: {launched}"
    )
    assert "drafting" not in ids and "spec-reused" not in ids, ids
    # Nothing asked: the answers, the read-back and the approval are on disk.
    asked = [s["id"] for s in steps if s["kind"] in ("ask", "confirm")]
    assert asked == [], f"resume re-asked what the record already holds: {asked}"
    # The loop RAN — a new loop directory, not the first run's re-rendered.
    assert "building" in ids, f"resume did not reach the build: {ids}"
    again = next(s for s in steps if s["id"].startswith("build:"))
    assert again["detail"]["loop"] and again["detail"]["loop"] != first_loop, (
        "the resumed build reports the FIRST run's loop — nothing ran"
    )
    assert code != 0, "the fixture's turn still fails, so the resume must too"

    # The preface: one step, first, three labelled lines, each read off disk.
    assert ids[0] == "resume-preface", ids
    text = steps[0]["text"]
    for label in ("Preserved:", "Reused:", "Will spend:"):
        assert label in text, f"the preface lacks {label!r}:\n{text}"
    assert "wringer.spec.yaml (approved)" in text
    assert "which-columns" in text, "the recorded answer is not named"
    assert "your approval of it (not asked again)" in text
    assert "your answers (not asked again)" in text
    assert "no drafting" in text
    assert "1 attempt(s)" in text, "the spend is not the project's own ceiling"
    assert "during the 'build' step" in text
    assert steps[0]["detail"]["phase"] == "build"
    # The build is not a question. The record carried the approval's
    # `last_question` into the build phase, and the preface said the run
    # stopped "at the question 'approve'" — after that approval had been
    # given. A phase's start clears the question; only a pending one is named.
    assert "at the question" not in text, f"a stale question survives:\n{text}"
    assert steps[0]["detail"]["last_question"] is None
    # And `run`'s own first sentence quotes the same renderer, so the two
    # front doors cannot disagree about where the run stopped.
    resuming = run_module.resumed_step(failing_build)
    assert resuming is not None and "during the 'build' step" in resuming.text
    assert "at the question" not in resuming.text


def test_A_SPEC_CHANGED_SINCE_THE_APPROVAL_STOPS_THE_RESUME(failing_build, tmp_path):
    """The approval was given against other words. The staleness law the
    judgement obeys, applied to the plan: the resume stops, names the verb
    that re-approves, and neither builds nor asks."""
    document = prd(tmp_path)
    _stop_at_the_failed_turn(failing_build, document)
    spec_path = failing_build / "wringer.spec.yaml"
    spec_path.write_text(
        spec_path.read_text(encoding="utf-8") + "# one more line\n", encoding="utf-8"
    )

    code, steps = drive(["resume", "--repo", str(failing_build)], "")

    assert code == 1
    assert [step["id"] for step in steps] == ["stopped:spec-changed"], steps
    text = steps[-1]["text"]
    assert "The plan you approved has changed since" in text
    assert "wringer-drive run" in text, "the stop names no command to run next"
    # And the record is left for the next `run` to overwrite, not cleared: a
    # stop is exactly when somebody comes back.
    assert run_module.resume_path(failing_build).is_file()


def test_A_RUN_KILLED_AT_THE_APPROVAL_RESUMES_TO_THE_APPROVAL_AND_NOT_PAST_IT(
    converging_build, tmp_path
):
    """The line `test_drive_resume.py` holds, kept by the new verb: a resume
    goes TO a question, never PAST one. Killed at the approval, `resume`
    lands on the approval — the read-back is not re-asked, the approval is —
    and the preface does not claim an approval that was never given."""
    document = prd(tmp_path)
    code, first = drive(["run", str(document), "--repo", str(converging_build)],
                        "The ones on screen.\nyes\n")
    assert code == 2 and first[-1]["id"] == "stopped:nobody-there"
    assert first[-2]["id"] == "approve", [s["id"] for s in first]
    assert run_module.read_resume(converging_build).get("phase") == "approve"

    code, steps = drive(["resume", "--repo", str(converging_build)], "")
    ids = [step["id"] for step in steps]

    assert ids[0] == "resume-preface"
    assert [s["id"] for s in steps if s["kind"] == "confirm"] == ["approve"], ids
    assert "answers-ok" not in ids and "question:which-columns" not in ids, ids
    assert "plan" in ids, "the approval is asked against no plan"
    reused_line = next(
        line for line in steps[0]["text"].splitlines() if line.startswith("Reused:")
    )
    assert "your approval of it" not in reused_line, (
        "the preface claims the approval is reused, and it is about to be asked"
    )
    assert "your answers (not asked again)" in reused_line
    assert "the build:" in steps[0]["text"], "the spend line does not name the build"
    assert code == 2 and steps[-1]["id"] == "stopped:nobody-there"


def test_THE_RECORD_ADVANCES_PAST_THE_BUILD_ONLY_WHEN_THE_LOOP_CONVERGED(
    converging_build, tmp_path
):
    """A converged build moves the record to the handover; a resume then
    redoes no build and says nothing is paid. (The failed-build half is the
    `phase == "build"` assertion every other test here makes first.)"""
    document = prd(tmp_path)
    code, first = drive(["run", str(document), "--repo", str(converging_build)],
                        "The ones on screen.\nyes\nyes\n")
    assert code != 0, "this fixture has no remote, so the handover must refuse"
    assert "build:converged" in [s["id"] for s in first]
    assert run_module.read_resume(converging_build).get("phase") == "deliver"

    code, steps = drive(["resume", "--repo", str(converging_build)], "")
    ids = [step["id"] for step in steps]

    assert ids[0] == "resume-preface"
    assert "building" not in ids, f"a converged build was redone: {ids}"
    assert "nothing paid" in steps[0]["text"]
    assert steps[-1]["kind"] == "stopped", ids


def test_A_RESUME_RECORD_FROM_BEFORE_PHASES_EXISTED_STARTS_FROM_THE_BEGINNING(
    converging_build, tmp_path
):
    """A 0.6.7 record names a question and no phase. `resume` on it behaves
    as `run` does — every phase, the approval asked live — rather than
    guessing a phase from the question's name."""
    document = prd(tmp_path)
    drive(["run", str(document), "--repo", str(converging_build)],
          "The ones on screen.\nyes\n")
    record = json.loads(run_module.resume_path(converging_build).read_text(encoding="utf-8"))
    del record["phase"]
    run_module.resume_path(converging_build).write_text(json.dumps(record), encoding="utf-8")
    assert run_module.resume_facts(converging_build).phase is None

    code, steps = drive(["resume", "--repo", str(converging_build)], "")

    assert [s["id"] for s in steps if s["kind"] == "confirm"] == ["approve"]
    # A 0.6.7 record names the question and no phase, and the preface says
    # exactly that much: the question, and no step it never recorded.
    assert "at the question 'approve'" in steps[0]["text"]
    assert "during the '" not in steps[0]["text"]
    assert steps[0]["detail"]["phase"] is None


# --- two front doors, one implementation --------------------------------------


def test_RUN_AND_RESUME_SHARE_ONE_STEP_SEQUENCE():
    """**The drive's own law, held structurally.** `_run` and `_resume` each
    call `_drive` and neither calls a phase's body itself; every engine phase
    is launched from exactly one line of `__main__.py`, so a step added later
    cannot land in one front door and not the other."""
    source = (SRC / "__main__.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    functions = {
        node.name: node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef)
    }
    for door in ("_run", "_resume"):
        calls = {
            getattr(call.func, "id", None)
            for call in ast.walk(functions[door])
            if isinstance(call, ast.Call)
        }
        assert "_drive" in calls, f"{door} does not enter the shared sequence"
        for phase_body in ("build_steps", "draft_the_spec", "approve", "deliver"):
            assert not any(
                getattr(call.func, "attr", None) == phase_body
                for call in ast.walk(functions[door])
                if isinstance(call, ast.Call)
            ), f"{door} drives `{phase_body}` itself — a second implementation"
    for phase_body in ("build_steps(", "draft_the_spec(", "approval_step(", "delivery_step("):
        assert source.count(f"run_module.{phase_body}") == 1, (
            f"`run_module.{phase_body}` is launched from more than one line"
        )
    # (`--yes` is `test_there_is_no_flag_that_answers_the_approval`'s to
    # refuse, from the parser — a text scan reads the docstring that says
    # there is none as the defect it describes.)


# --- review of 0.7.0, 2026-09-02: three holes the adversarial pass found ---


def test_a_CHANGED_SPEC_STOPS_ONLY_ONCE_THE_APPROVAL_WOULD_BE_REUSED(
    converging_build, tmp_path
):
    """Measured by the reviewer: a run killed AT the approval, then a comment
    appended to the spec, then `resume` → `stopped:spec-changed` forever, the
    approval never asked — the stop's own next move led back to itself. The
    digest decides nothing while the approval is still to be asked live."""
    document = prd(tmp_path)
    code, first = drive(["run", str(document), "--repo", str(converging_build)],
                        "The ones on screen.\nyes\n")
    assert code == 2 and first[-1]["id"] == "stopped:nobody-there"
    spec_path = converging_build / "wringer.spec.yaml"
    # The reviewer's shape: a digest from an EARLIER approval is on the record
    # while the run now stands at the approval again.
    earlier = run_module.spec_digest(converging_build)
    run_module._write_resume(converging_build, approved_spec_sha256=earlier)
    spec_path.write_text(
        spec_path.read_text(encoding="utf-8") + "# a comment\n", encoding="utf-8"
    )
    facts = run_module.resume_facts(converging_build)
    assert facts.phase == "approve"
    assert facts.spec_changed is False, (
        "the approval is pending, so a moved spec is simply what gets approved"
    )
    # And once the record is PAST the approval, the same move is a stop.
    run_module.checkpoint_phase(converging_build, "build")
    assert run_module.resume_facts(converging_build).spec_changed is True


def test_the_preface_NEVER_claims_an_approval_it_is_about_to_ask_for():
    """Reviewer's red-watch: `and past["approve"]` was untested — a spec
    with `approved: true` from an EARLIER approval and a record standing at
    the approval (the operator answered `no` on a re-run) made the preface
    say the approval was reused, and the resume then asked for it."""
    at_approval = run_module.ResumeFacts(
        last_question="approve", phase="approve", prd_inside=True,
        spec_present=True, spec_approved=True, spec_changed=False,
        answers=("which-columns",), gates=("unit",), shows=(), max_iterations=1,
    )
    reused = next(
        line for line in run_module.resume_preface(at_approval).text.splitlines()
        if line.startswith("Reused:")
    )
    assert "your approval of it" not in reused, reused
    past_it = run_module.ResumeFacts(
        last_question=None, phase="build", prd_inside=True,
        spec_present=True, spec_approved=True, spec_changed=False,
        answers=("which-columns",), gates=("unit",), shows=(), max_iterations=1,
    )
    reused = next(
        line for line in run_module.resume_preface(past_it).text.splitlines()
        if line.startswith("Reused:")
    )
    assert "your approval of it (not asked again)" in reused, reused


def test_RESUME_WITH_THE_SPEC_GONE_PAST_DRAFTING_STOPS_BY_NAME(
    converging_build, tmp_path
):
    """Reviewer's scenario A: killed at a question, then `wringer.spec.yaml`
    deleted, then `resume` → a Python traceback out of the interview. Now a
    named stop with the only honest next move."""
    document = prd(tmp_path)
    code, first = drive(["run", str(document), "--repo", str(converging_build)], "")
    assert first[-1]["id"] == "stopped:nobody-there", [s["id"] for s in first]
    assert run_module.read_resume(converging_build).get("phase") == "interview"
    (converging_build / "wringer.spec.yaml").unlink()

    code, steps = drive(["resume", "--repo", str(converging_build)], "")
    assert code == 2
    assert steps[-1]["id"] == "stopped:spec-missing", [s["id"] for s in steps]
    assert "wringer-drive run" in steps[-1]["text"]


# --- bug review 0.7, 2026-09-02 (key `recovery`): killed at every phase ------


def test_RESUME_WITH_THE_SPEC_GONE_PAST_THE_APPROVAL_SAYS_GONE_NOT_CHANGED(
    failing_build, tmp_path
):
    """Bug review 0.7, 2026-09-02: a run stopped at the build, then
    `wringer.spec.yaml` deleted, then `resume` → `stopped:spec-changed`:
    "the plan you approved has changed ... approve it again with
    wringer-drive run, which shows the plan and asks". The plan is not
    changed, it is GONE — and `run` on a project with no plan DRAFTS one,
    which is a paid call the stop just said would only show and ask. The
    spec-missing stop exists for exactly this and was reachable only from a
    record at or before the interview."""
    document = prd(tmp_path)
    _stop_at_the_failed_turn(failing_build, document)
    (failing_build / "wringer.spec.yaml").unlink()

    code, steps = drive(["resume", "--repo", str(failing_build)], "")

    assert [s["id"] for s in steps] == ["stopped:spec-missing"], steps
    assert code == 2
    assert "has changed" not in steps[-1]["text"]
    assert "gone" in steps[-1]["text"]


def test_RESUME_WITH_THE_DOCUMENT_GONE_BEFORE_A_PLAN_EXISTED_DOES_NOT_DENY_THE_RUN(
    converging_build, tmp_path
):
    """Bug review 0.7, 2026-09-02: a run stopped while drafting (no plan
    yet), then the copied document under `.wringer/drive/` deleted, then
    `resume` said "no run of wringer-drive has stopped in this project".
    One had; the record on disk says so. The stop names what is actually
    missing — the document — and the only honest move."""
    (converging_build / "wringer.spec.yaml").unlink()
    subprocess.run(["git", "commit", "-qam", "no plan"], cwd=converging_build, check=True)
    document = prd(tmp_path)
    code, first = drive(["run", str(document), "--repo", str(converging_build)], "")
    assert "drafting" in [s["id"] for s in first], [s["id"] for s in first]
    assert run_module.read_resume(converging_build).get("phase") == "draft"
    (converging_build / run_module.DRIVE_DIRNAME / run_module.PRD_FILENAME).unlink()

    code, steps = drive(["resume", "--repo", str(converging_build)], "")

    assert code == 2
    assert steps[-1]["id"] == "stopped:document-missing", [s["id"] for s in steps]
    assert "no run of wringer-drive has stopped" not in steps[-1]["text"]
    assert str(run_module.DRIVE_DIRNAME / run_module.PRD_FILENAME) in steps[-1]["text"]
    assert "wringer-drive run" in steps[-1]["text"], "the stop names no command to run next"
