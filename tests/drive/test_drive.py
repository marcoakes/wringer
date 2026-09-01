"""DRIVE — SPEC_DRIVE_V0's four invariant tests, in their CORRECTED form.

The drafted versions were wrong in ways the refute review caught: test 1's
allow-set was short by five files and would have failed a *correct* build,
test 2 pinned something already false of the chain, test 3 asked for "every
value" over a mapping keyed on pairs with 19 of 45 unreachable, and test 4's
third clause had no hand edit to compare against.

The fifth thing here is the one that makes the transport decision safe:
**every PM-facing sentence came from the engine or the board, verbatim.**
"""

from __future__ import annotations

import ast
import json
import subprocess
from pathlib import Path

import pytest

from wringer_drive import run as run_module
from wringer_drive import steps as steps_module
from wringer_drive.__main__ import build_parser, main

SRC = Path(steps_module.__file__).parent


@pytest.fixture
def project(tmp_path: Path) -> Path:
    """A real git repository with a spec the ENGINE rendered.

    Never a hand-typed fixture. Two live defects in this programme came from
    fixtures written on the same side of the seam as their reader, and the
    third would have been this one.
    """
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
        # `brief` is a PATH `wring plan` writes to, not prose. The derived
        # allow-set caught this: prose here made the chain write a file
        # literally called "Build it" at the repository root.
        tasks=(
            spec.Task(id="build", brief="briefs/build.md", objective="It exports."),
        ),
        path="wringer.spec.yaml",
    )
    (repo / "wringer.spec.yaml").write_text(spec.render(drafted), encoding="utf-8")
    # **A project with the sections the CHAIN needs, not just the ones `wring
    # init` writes.** Steps 3, 8 and 9 each hard-refuse without `judge:`,
    # `run:` and `deliver:` — which is finding 3, and the reason §3a exists.
    # A fixture missing them tests a repository no operator could drive.
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
        '  worker: ": {brief}; true"\n'
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
    """Deliberately OUTSIDE the repository — a PM's obvious first move."""
    path = tmp_path / "PRD.md"
    path.write_text("We need the weekly report as a CSV.\n", encoding="utf-8")
    return path


# --- INVARIANT 2: approval-stop --------------------------------------------


def test_there_is_no_flag_that_answers_the_approval():
    """**Ruling 2, structurally.** There is no `--yes`, and this reads the
    real parser rather than trusting that nobody added one."""
    parser = build_parser()
    flags = list(s for a in parser._actions for s in a.option_strings)
    for action in parser._actions:
        choices = getattr(action, "choices", None)
        if not hasattr(choices, "values"):
            continue
        for sub in choices.values():
            flags += [s for a in sub._actions for s in a.option_strings]
    assert "--emit" in flags, "the parser was not introspected at all"
    banned = ("--yes", "-y", "--auto", "--non-interactive", "--force", "--approve")
    for flag in banned:
        assert flag not in flags, f"{flag} answers an approval a person must give"

    # And no environment variable does either. Structural, with `ast`, for the
    # reason a text scan already failed once here: the module docstring says
    # "no flag or environment variable answers it", which a substring match
    # reads as the defect it is describing. A comment that cannot spell the
    # thing it explains is no use.
    reads = []
    for path in sorted(SRC.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Attribute) and node.attr in ("environ", "getenv"):
                reads.append(f"{path.name}:{node.lineno}")
            if isinstance(node, ast.Name) and node.id in ("environ", "getenv"):
                reads.append(f"{path.name}:{node.lineno}")
    assert reads == [], (
        f"DRIVE reads the environment at {reads}; an approval an environment "
        f"variable can give is not an approval"
    )


def test_a_stream_with_nobody_behind_it_STOPS_rather_than_defaulting(
    project, tmp_path, capsys
):
    """**A default here would be an approval nobody gave.**

    Piped stdin with nothing on it is the shape a CI job or a careless script
    has, and it must stop rather than pick a value.
    """
    import io
    import sys

    document = prd(tmp_path)
    original = sys.stdin
    sys.stdin = io.StringIO("")  # EOF immediately
    try:
        code = main(["run", str(document), "--repo", str(project)])
    finally:
        sys.stdin = original
    assert code == 2
    assert "nobody on the other end" in capsys.readouterr().err
    # And nothing was approved.
    assert "approved: false" in (project / "wringer.spec.yaml").read_text()


def test_a_pasted_answers_overflow_never_reaches_the_approval(
    project, tmp_path, capsys
):
    """**The interlock bug the field run hit, red first.**

    A person pastes a multi-line answer to question 1. `input()` takes line 1;
    the overflow stays buffered — and before this fix, the next buffered line
    answered the APPROVAL. Here the overflow contains a stray `yes`, so the
    plan was approved by leftover paste, not by a person. The real field run
    had the mirror image: a stray line counted as "not yes" and DECLINED the
    run.

    A real pipe, not `io.StringIO`: the defect lives in what the operating
    system and Python have buffered ahead of the prompt, which an in-memory
    stdin does not model. Everything already waiting when a question is asked
    is stale — drained, never read — so the stray lines cannot reach the
    approval, and with nobody left on the line the run STOPS rather than
    defaulting.
    """
    import os
    import sys

    document = prd(tmp_path)
    read_end, write_end = os.pipe()
    os.write(write_end, b"The ones on screen.\nyes\n")
    os.close(write_end)
    original = sys.stdin
    sys.stdin = os.fdopen(read_end, "r")
    try:
        code = main(["run", str(document), "--repo", str(project)])
    finally:
        sys.stdin.close()
        sys.stdin = original

    after = (project / "wringer.spec.yaml").read_text(encoding="utf-8")
    assert "approved: true" not in after, (
        "a stray line from a pasted answer approved the plan — leftover text "
        "answered the one question only a person may answer"
    )
    # With the stale text drained there is nobody on the line at the first
    # question, and a stream with nobody behind it stops rather than defaults.
    assert code == 2
    assert "nobody on the other end" in capsys.readouterr().err


def test_the_worker_is_resolved_BEFORE_ANY_PAID_CALL(
    project, tmp_path, capsys, monkeypatch
):
    """**Field report 2026-08-21 finding 6, and the defect is the ORDER.**

    A product manager answered the interview, spent TWO paid API calls, gave
    THREE approvals and installed a gate — and only then learned the coding
    agent named in the worked example was not on their machine. The error they
    finally got is a good error: it names the package, says plainly that
    Wringer installs nothing, and confirms nothing was created. It arrived
    after everything it could have saved.

    So this asserts the thing that actually matters, which is not the wording:
    **no engine command carrying `--send` may run before the refusal.** Every
    subprocess the chain launches is recorded, and `--send` is the typed flag
    that lets Wringer spend money or write history — SPEC_GRAPH ruling 5's
    own test for whether something irreversible happened.
    """
    # No spec on disk, so step 3 would REALLY draft — the paid call is
    # genuinely reachable here rather than short-circuited by a fixture.
    (project / "wringer.spec.yaml").unlink()
    config_path = project / ".wringer.yaml"
    config_path.write_text(
        config_path.read_text(encoding="utf-8").replace(
            '  worker: ": {brief}; true"\n',
            "  worker:\n"
            "    acp:\n"
            '      command: "wringer-no-such-agent-anywhere"\n',
        ),
        encoding="utf-8",
    )

    launched: list[list[str]] = []
    real = run_module.run_command

    def recording(repo, argv, env=None):
        launched.append(list(argv))
        return real(repo, argv, env)

    monkeypatch.setattr(run_module, "run_command", recording)

    code = main(["run", str(prd(tmp_path)), "--repo", str(project)])
    said = capsys.readouterr()

    assert code == 2, "a run that cannot possibly finish was allowed to start"
    spent = [argv for argv in launched if "--send" in argv]
    assert spent == [], (
        f"money moved before the agent was checked for: {spent}. The whole "
        "finding is that the refusal arrives too late, so a correct message "
        "at the wrong moment fixes nothing"
    )
    assert not (project / "wringer.spec.yaml").exists(), (
        "a spec was drafted for a run that had no agent to build it"
    )

    # The ENGINE's own words reach the operator — this is the message run 2 of
    # the field report praised, moved earlier rather than rewritten.
    printed = said.out + said.err
    assert "wringer-no-such-agent-anywhere" in printed
    assert "never installs an agent" in printed
    assert "nothing has been spent" in printed.lower(), (
        "the operator is not told the one thing that makes this recoverable"
    )


def _acp_worker_answering(project: Path, tmp_path: Path, monkeypatch, payload):
    """Point the project at a fake ACP agent that answers `auth status`.

    A real executable on a real `PATH`, spawned the real way. The name comes
    from `agents.py` so a roster edit takes this with it.
    """
    import os
    import stat
    import sys

    agents = pytest.importorskip("wringer.agents")
    command = agents.find("claude-code").command
    binaries = tmp_path / "fake-bin"
    binaries.mkdir(exist_ok=True)
    binary = binaries / command
    binary.write_text(
        f"#!{sys.executable}\nimport json\nprint(json.dumps({payload!r}))\n",
        encoding="utf-8",
    )
    binary.chmod(binary.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    monkeypatch.setenv("PATH", f"{binaries}{os.pathsep}{os.environ['PATH']}")

    config_path = project / ".wringer.yaml"
    config_path.write_text(
        config_path.read_text(encoding="utf-8").replace(
            '  worker: ": {brief}; true"\n',
            f"  worker:\n    acp:\n      command: {command}\n",
        ),
        encoding="utf-8",
    )
    return command


def test_a_PASSING_AUTH_PREFLIGHT_IS_SHOWN_not_merely_decided(
    project, tmp_path, capsys, monkeypatch
):
    """**Fable's ruling on Q1, 2026-08-26, and the full run's finding 2.**

    The drive has always preflighted the worker's login before spending —
    `stopped:worker-signed-out` proved it in the field. What it never did was
    say so when the answer was YES, so the one precondition a product manager
    is told to check was invisible at the moment it became checkable, and the
    documents sent them to `wring doctor` before a config existed for doctor
    to read.

    **Asserted against what was WRITTEN TO THE STREAM, never against
    `session.steps`.** That distinction is the whole of the full run's finding
    2: emitting a step and showing one are different acts, and every test of
    the drafting warning passed while the operator saw nothing. So this parses
    stdout.
    """
    import os
    import sys

    _acp_worker_answering(
        project, tmp_path, monkeypatch,
        {"loggedIn": True, "authMethod": "api_key"},
    )

    # An EMPTY stdin, so the run stops at the first question rather than
    # hanging. The preflight is long over by then, which is the point.
    read_end, write_end = os.pipe()
    os.close(write_end)
    original = sys.stdin
    sys.stdin = os.fdopen(read_end, "r")
    try:
        main(["run", str(prd(tmp_path)), "--repo", str(project), "--emit", "json"])
    finally:
        sys.stdin.close()
        sys.stdin = original
    printed = capsys.readouterr().out

    shown = [
        json.loads(line)
        for line in printed.splitlines()
        if line.startswith("{")
    ]
    auth = [step for step in shown if step["id"] == "worker-auth"]
    assert auth, (
        "the auth preflight passed and nothing was put in front of the "
        f"person. Steps written to the stream: {[s['id'] for s in shown]}"
    )
    assert auth[0]["kind"] == "show"
    assert "api_key" in auth[0]["text"], (
        "the step does not say HOW the agent is authenticated, which is the "
        "half a person on a pinned machine has to check"
    )
    assert "spent" in auth[0]["text"], (
        "the step does not say the question was answered before anything was "
        "spent, which is the reason it is worth showing at all"
    )


def test_AN_UNANSWERABLE_AUTH_PREFLIGHT_IS_SHOWN_TOO(
    project, tmp_path, capsys, monkeypatch
):
    """Silence reads as a tick, and this preflight is often silent.

    `worker_auth` answers UNKNOWN for every agent nobody here has measured,
    for an answer it cannot parse, and for a containment — and none of those
    may stop a run. What they may not do either is pass without a word: the
    person then believes a question was answered that nobody could ask, and
    the first thing that can tell them is the step that costs money.
    """
    import os
    import sys

    _acp_worker_answering(project, tmp_path, monkeypatch, {"nothing": "useful"})

    read_end, write_end = os.pipe()
    os.close(write_end)
    original = sys.stdin
    sys.stdin = os.fdopen(read_end, "r")
    try:
        main(["run", str(prd(tmp_path)), "--repo", str(project), "--emit", "json"])
    finally:
        sys.stdin.close()
        sys.stdin = original

    shown = [
        json.loads(line)
        for line in capsys.readouterr().out.splitlines()
        if line.startswith("{")
    ]
    auth = [step for step in shown if step["id"] == "worker-auth"]
    assert auth, (
        "the preflight could not answer and said nothing, which reads as a "
        f"tick. Steps written: {[s['id'] for s in shown]}"
    )
    assert "could not be settled here" in auth[0]["text"]
    assert "costs money" in auth[0]["text"], (
        "the step does not say where the person will find out instead"
    )


def test_a_SHELL_WORKER_GETS_A_TYPED_AUTH_STEP_TOO(project, tmp_path, capsys):
    """0.6.0 inverts the old rule here, and run 3 is why (F10).

    This test used to assert a shell worker got NO auth step — "there is no
    login to report on, so reporting one would be noise". Run 3 measured
    what that silence costs on the run path: a shell worker's state arrived
    as None, every renderer returned early, and silence read as a tick on
    the run where the worker's credential was the thing that broke. The
    state is typed now — this fixture's plain shell command renders
    `not_applicable`, which never refuses and never passes without a word.
    """
    import os
    import sys

    read_end, write_end = os.pipe()
    os.close(write_end)
    original = sys.stdin
    sys.stdin = os.fdopen(read_end, "r")
    try:
        main(["run", str(prd(tmp_path)), "--repo", str(project), "--emit", "json"])
    finally:
        sys.stdin.close()
        sys.stdin = original

    shown = [
        json.loads(line)
        for line in capsys.readouterr().out.splitlines()
        if line.startswith("{")
    ]
    auth = [step for step in shown if step["id"] == "worker-auth"]
    assert auth, "a shell worker's auth state passed in silence again (F10)"
    assert auth[0]["detail"]["state"] == "not_applicable"
    assert "authenticates on its own account" in auth[0]["text"]


def test_the_drive_and_the_engine_share_ONE_agent_preflight():
    """A second PATH check would be a second opinion, and SPEC_DRIVE_V0 ruling
    1 exists to stop exactly that: *importing is not re-implementing*.

    If the drive grew its own `shutil.which`, the two front doors could
    disagree about whether an agent is present — and the operator would get a
    different answer depending on which one they used.
    """
    import inspect

    source = inspect.getsource(run_module.require_worker)
    assert "loop.missing_agent" in source, (
        "the drive no longer calls the engine's own preflight"
    )
    assert "shutil.which" not in source, (
        "the drive grew a second PATH check beside the engine's"
    )


@pytest.fixture
def two_questions(tmp_path: Path) -> Path:
    """A project asking TWO questions — the shape the scatter needs.

    The one-question fixture cannot show this defect: an answer's second line
    has to have somewhere wrong to land, and that somewhere is the NEXT
    question. The field run's line 2 was recorded against question 7, which
    was about dependency cycles and had nothing to do with what was typed.
    """
    spec = pytest.importorskip("wringer.spec")
    repo = tmp_path / "twoq"
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
            spec.Question(
                id="which-columns", question="Which columns?", required=True
            ),
            spec.Question(
                id="cycle-policy",
                question="What should happen when two steps depend on each other?",
                required=True,
            ),
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
        "version: 1\ngates:\n  - id: unit\n    run: \"true\"\n\n"
        "judge:\n  endpoint: http://127.0.0.1:1/v1/chat/completions\n"
        "  model: none\n  rubric: wringer.rubric.yaml\n\n"
        "run:\n  worker: \": {brief}; true\"\n  max_iterations: 1\n\n"
        "deliver:\n  branch: \"wringer/{run}\"\n",
        encoding="utf-8",
    )
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "base"], cwd=repo, check=True)
    return repo


def test_A_PASTED_MULTILINE_ANSWER_CANNOT_ANSWER_THE_NEXT_QUESTION(
    two_questions, tmp_path
):
    """**Field report finding 3 — the worst defect in the first run.**

    A product manager pasted a multi-line answer. What happened:

    - question 6 recorded only the FIRST line, truncated;
    - question 7 — a different question, about dependency cycles — recorded
      LINE 2 of the answer to question 6;
    - the remaining lines ran past the interview into the approval prompt,
      where the first stray line counted as "not yes" and DECLINED the run;
    - the rest fell through to the shell, which tried to execute them.

    *"At no point did anything echo back what it had recorded."*

    Driven over real pipes against a real subprocess, and the paste is written
    AFTER the question renders — which is the actual scenario. Pre-filling the
    pipe would test the stale-input drain instead, which is a different guard
    that already exists.
    """
    import sys
    import threading

    proc = subprocess.Popen(
        [sys.executable, "-m", "wringer_drive", "run", str(prd(tmp_path)),
         "--repo", str(two_questions)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    # The shape of the real paste: an answer whose author used line breaks.
    PASTE = "The ones on screen\nand also the totals row\nand the date column\n"
    seen: list[str] = []
    wrote = {"paste": False, "second": False, "rest": 0}

    watchdog = threading.Timer(120, proc.kill)
    watchdog.start()
    try:
        for line in proc.stdout:
            seen.append(line)
            if not wrote["paste"] and "Which columns?" in line:
                proc.stdin.write(PASTE)
                proc.stdin.flush()
                wrote["paste"] = True
            elif wrote["paste"] and not wrote["second"] and "depend on each other" in line:
                proc.stdin.write("They should be reported as an error.\n")
                proc.stdin.flush()
                wrote["second"] = True
            elif wrote["second"] and wrote["rest"] < 4 and (
                "Type yes or no" in line
            ):
                proc.stdin.write("yes\n")
                proc.stdin.flush()
                wrote["rest"] += 1
        proc.wait(timeout=60)
    finally:
        watchdog.cancel()
        proc.kill()

    printed = "".join(seen)
    spec_text = (two_questions / "wringer.spec.yaml").read_text(encoding="utf-8")

    # **The defect itself**: a line of the FIRST answer became the SECOND
    # answer. This is the one that made a plan out of answers to other
    # questions and presented it as what would be built.
    assert "and also the totals row" not in spec_text, (
        "line 2 of a pasted answer was recorded as the answer to a different "
        "question — the exact scatter the field report measured:\n" + spec_text
    )
    assert "and the date column" not in spec_text

    # It is DECLARED that only one line is taken, so a truncated answer is
    # now a thing the person was warned about rather than one they discover.
    assert "ONE line" in printed, (
        "the interview never says it reads one line per answer"
    )
    # And what was thrown away is SHOWN, rather than vanishing silently.
    assert "were NOT recorded" in printed, (
        "the discarded lines were dropped in silence — the fix for overflow "
        "reaching the approval must not trade one invisible loss for another"
    )
    assert "and also the totals row" in printed, (
        "the person is not shown WHICH lines were discarded"
    )


def test_GARBAGE_AT_A_CONFIRM_RE_ASKS_INSTEAD_OF_DECIDING(project, tmp_path, capsys):
    """**A stray line must never be able to spend a person's decision.**

    Field report finding 3's last clause: overflow reached the approval, was
    not the word `yes`, and so counted as a refusal — declining a build
    nobody declined. Fail-closed is right and stays; silently TAKING a
    decision from unreadable input is not the same thing as fail-closed.
    """
    import io
    import sys

    original = sys.stdin
    # answer · garbage at the echo-back · then a real yes · then approve
    sys.stdin = io.StringIO("The ones on screen.\n~~~\nyes\nyes\n")
    try:
        main(["run", str(prd(tmp_path)), "--repo", str(project)])
    finally:
        sys.stdin = original

    printed = capsys.readouterr()
    said = printed.out + printed.err
    assert "did not understand" in said, (
        "unreadable input was silently taken as a decision"
    )
    assert "'~~~'" in said, "the person is not shown what was received"
    # The garbage did NOT decide: the run went on to approve the plan.
    assert "approved: true" in (
        project / "wringer.spec.yaml"
    ).read_text(encoding="utf-8"), (
        "a stray line declined a run the person then approved"
    )


def test_a_confirm_that_can_never_be_read_STOPS_rather_than_deciding(
    project, tmp_path, capsys
):
    """The bound, and why it exists. Re-asking forever against a stream that
    keeps producing text would never terminate. After a fixed number of tries
    the verb stops having decided NOTHING — which is different from deciding
    no."""
    import io
    import sys

    original = sys.stdin
    sys.stdin = io.StringIO("The ones on screen.\n" + "~~~\n" * 10)
    try:
        code = main(["run", str(prd(tmp_path)), "--repo", str(project)])
    finally:
        sys.stdin = original

    assert code == 2
    said = capsys.readouterr()
    assert "could not read one" in (said.out + said.err)
    assert "approved: true" not in (
        project / "wringer.spec.yaml"
    ).read_text(encoding="utf-8")


def test_EVERY_ask_says_it_takes_one_line(project, tmp_path, capsys):
    """Totality, and it is checked by RUNNING rather than by reading.

    **This test was written as a source-substring check first, and the revert
    probe caught it passing vacuously**: commenting the line out left the
    string `answering=ONE_LINE` sitting in the comment, so the guard was
    satisfied by the very edit that removed the behaviour. Structural checks
    over source text answer "is this string present", which is not the
    question. Both assertions below are about what a person is shown.
    """
    import io
    import sys

    from wringer_drive import __main__ as drive_main

    original = sys.stdin
    sys.stdin = io.StringIO("")  # EOF at the first question
    try:
        main(["run", str(prd(tmp_path)), "--repo", str(project)])
    finally:
        sys.stdin = original

    said = capsys.readouterr()
    printed = said.out + said.err
    assert "Which columns?" in printed, "the run never reached an ask"
    assert drive_main.ONE_LINE in printed, (
        "an `ask` was put in front of a person without saying it takes one "
        "line — which is the condition that scattered a pasted answer across "
        "three questions"
    )
    assert "ONE line" in drive_main.ONE_LINE


def test_the_answers_are_read_back_BEFORE_the_plan_is_built_from_them(
    project, tmp_path, capsys
):
    """*"At no point did anything echo back what it had recorded."*

    That sentence is the field report's own summary of the interview, and it
    is why a scattered answer survived into a plan that was then presented as
    what would be built. The answers are read back beside the questions they
    belong to, and it happens BEFORE the plan — the cheapest moment to catch
    a mismatch, and before anything is decided.

    It is NOT an approval (ruling 2: answering and approving are different
    acts). The step says so in as many words, and the plan approval still
    happens separately afterwards.
    """
    import io
    import sys

    original = sys.stdin
    sys.stdin = io.StringIO("The ones on screen.\nyes\nyes\n")
    try:
        main(["run", str(prd(tmp_path)), "--repo", str(project)])
    finally:
        sys.stdin = original

    printed = capsys.readouterr()
    said = printed.out + printed.err
    echo = said.index("exactly as they are recorded")
    assert "you were asked: Which columns?" in said
    assert "you answered:   The ones on screen." in said
    # BEFORE the plan and its approval — the ordering is the whole point.
    assert echo < said.index("Is that what you meant?"), (
        "the answers are read back after the plan was already built from them"
    )
    # And it does not pretend to be the approval.
    assert "nothing has been decided yet" in said.lower()


def test_every_confirm_prompt_says_the_accepted_inputs():
    """Field-run finding 11: the approval prompt never said what to type, and
    the evaluator's guess became a decline. Every `confirm` DRIVE constructs
    says the accepted inputs ON the prompt line — in both transports, since
    the text IS the step."""
    confirms = (
        run_module.approval_step(),
        run_module.delivery_step(),
        run_module.trial_step({"gates_proposed": ["g-x"]}),
        run_module.gate_approval_step({"gates_proposed": ["g-x"]}),
    )
    for step in confirms:
        assert step.kind == "confirm"
        assert "yes or no" in step.question.lower(), (
            f"confirm {step.id!r} never says what to type: {step.question!r}"
        )


def test_an_answer_written_after_the_question_renders_is_never_drained(
    project, tmp_path
):
    """The drain must discard only STALE text — its guard against overreach.

    The designed transport (an agent, or a person actually typing) writes each
    answer AFTER reading the question. A drain that ran after the render, or a
    reader that buffered past the newline, would eat those answers too; this
    drives the verb over real pipes exactly as `AGENTS.md` says to, and the
    run must still reach approval.
    """
    import sys

    document = prd(tmp_path)
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "wringer_drive",
            "run",
            str(document),
            "--repo",
            str(project),
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    answers = [
        ("Which columns?", "The ones on screen.\n"),
        # Step 4a, added 2026-08-21: the answers are read back before the plan
        # is drafted from them. A separate act from approving the plan, and it
        # is answered here separately.
        ("Are those your answers", "yes\n"),
        ("Is that what you meant?", "yes\n"),
    ]
    # A drain that eats a live answer leaves both sides blocked on a read; the
    # watchdog turns that hang into a loud failure instead of a stuck suite.
    import threading

    watchdog = threading.Timer(120, proc.kill)
    watchdog.start()
    try:
        for line in proc.stdout:
            if answers and answers[0][0] in line:
                proc.stdin.write(answers.pop(0)[1])
                proc.stdin.flush()
        code = proc.wait(timeout=60)
    finally:
        watchdog.cancel()
        proc.kill()

    assert answers == [], f"never asked: {[a[0] for a in answers]}"
    after = (project / "wringer.spec.yaml").read_text(encoding="utf-8")
    assert "approved: true" in after, (
        "an answer given after the question rendered was lost — the drain is "
        "eating live answers, not stale ones"
    )
    # The chain then runs on to the delivery refusal (no remote), which is the
    # fixture's honest ending — not a hang, not a success.
    assert code != 0


def test_a_no_at_the_plan_builds_nothing_and_changes_nothing(project, tmp_path, capsys):
    import io
    import sys

    document = prd(tmp_path)
    sys.stdin = io.StringIO("The ones on screen.\nyes\nno\n")
    try:
        code = main(["run", str(document), "--repo", str(project)])
    finally:
        sys.stdin = sys.__stdin__
    assert code == 0, "declining is not an error"
    out = capsys.readouterr()
    assert "did not approve" in (out.out + out.err)
    after = (project / "wringer.spec.yaml").read_text(encoding="utf-8")
    assert "approved: false" in after
    # The ANSWER was written — answering and approving are different acts.
    assert "The ones on screen." in after


def test_REUSING_AN_EXISTING_SPEC_IS_SAID_OUT_LOUD(project, tmp_path, capsys):
    """**Field report 2026-08-25, finding 6 — the drive's half.**

    Run 1 found an approved spec already in the project and drafted nothing.
    That is correct behaviour and it was completely silent, so the operator
    read a re-rendered plan believing they were reading what a drafter had
    just produced — and the plan was thinner than the one that spec came from,
    because the sidecar holding the outcomes and the decisions was not beside
    it. Two silences compounding: this is the first one.

    It also names what is NOT there. A person cannot be expected to notice an
    absent block on a page they are seeing for the first time.
    """
    import io
    import sys

    document = prd(tmp_path)
    assert (project / "wringer.spec.yaml").is_file()
    assert not (project / "wringer.decisions.yaml").is_file()
    sys.stdin = io.StringIO("The ones on screen.\nyes\nno\n")
    try:
        main(["run", str(document), "--repo", str(project)])
    finally:
        sys.stdin = sys.__stdin__

    out = capsys.readouterr()
    said = out.out + out.err
    assert "already in this project rather than drafting a new one" in said, (
        "the drive reused a spec and said nothing, so a re-render is "
        "indistinguishable from a fresh draft"
    )
    assert "nothing is sent and nothing is spent" in said
    assert "wringer.decisions.yaml is not beside it" in said, (
        "the plan below this is about to be missing its decisions block and "
        "its outcomes, and nothing said why"
    )


def test_a_yes_approves_only_after_the_plan_was_rendered(project, tmp_path, capsys):
    import io
    import sys

    document = prd(tmp_path)
    sys.stdin = io.StringIO("The ones on screen.\nyes\nyes\n")
    try:
        main(["run", str(document), "--repo", str(project)])
    finally:
        sys.stdin = sys.__stdin__
    out = capsys.readouterr().out
    assert "HOW EACH PIECE WILL BE PROVED" in out
    assert out.index("HOW EACH PIECE") < out.index("Is that what you meant?")
    assert "approved: true" in (project / "wringer.spec.yaml").read_text()


def test_the_run_ends_at_a_refusal_rendered_in_the_boards_words(
    project, tmp_path, capsys
):
    """**The whole chain, and the ending it really has.**

    This fixture has no remote, so `wring deliver` refuses. That refusal is
    the product working, and what this pins is that a PM reads the BOARD's
    sentence for it rather than an exit code — through the record, which is
    the only place the name of the "which no" exists.
    """
    import io
    import sys

    from wringer_board import refusals

    document = prd(tmp_path)
    sys.stdin = io.StringIO("The ones on screen.\nyes\nyes\n")
    try:
        code = main(["run", str(document), "--repo", str(project)])
    finally:
        sys.stdin = sys.__stdin__
    assert code != 0, "a refused handover is not a success"

    saying = refusals.say(refusals.DELIVERY_REFUSAL, "default_branch_unknown")
    shown = capsys.readouterr()
    assert saying.sentence in (shown.out + shown.err), (
        "the refusal did not reach the operator in the board's words"
    )
    # And the board was still rendered — the page is how a person finds out
    # why, so a refusal may not cost them it.
    assert (project / "board.html").is_file()


# --- INVARIANT 1: no-file-edited, with the set DERIVED ----------------------


def test_it_writes_only_what_the_chain_is_entitled_to_write(project, tmp_path):
    """**CORRECTED, finding 5.** The drafted allow-set was short by five files
    and would have failed a correct build. It is derived from the commands'
    own filename constants, never typed out."""
    import io
    import sys

    spec = pytest.importorskip("wringer.spec")
    config = pytest.importorskip("wringer.config")

    entitled = {
        spec.SPEC_FILENAME,
        config.CONFIG_FILENAME,
        ".wringer",  # the bundle root, including drive's own output
        ".git",
        ".gitignore",  # `wring init`
        "briefs",  # `wring plan`, one brief per task
        run_module.BOARD_FILENAME,  # step 10, and DERIVED rather than typed
    }
    for attr in ("GATESPEC_FILENAME", "TASKS_FILENAME", "RUBRIC_FILENAME"):
        value = getattr(spec, attr, None)
        if value:
            entitled.add(value)

    before = {p.name for p in project.iterdir()}
    document = prd(tmp_path)
    sys.stdin = io.StringIO("The ones on screen.\nyes\nyes\n")
    try:
        main(["run", str(document), "--repo", str(project)])
    finally:
        sys.stdin = sys.__stdin__

    after = {p.name for p in project.iterdir()}
    new = after - before
    assert new <= entitled, (
        f"wrote files nothing entitles it to: {sorted(new - entitled)}"
    )


def test_the_prd_is_copied_inside_and_the_original_is_untouched(project, tmp_path):
    """Finding 16: `spec.read_prd` refuses a PRD outside the repository, so a
    PM pointing at their Desktop is refused today."""
    document = prd(tmp_path)
    original = document.read_text(encoding="utf-8")
    session = run_module.Session(repo=project)

    inside = run_module.bring_prd_inside(session, document)

    assert inside.is_file()
    assert inside.read_text(encoding="utf-8") == original
    assert document.read_text(encoding="utf-8") == original
    assert project in inside.parents
    # And it SAYS it did, rather than moving a person's files quietly.
    assert "copied your document" in session.steps[-1].text


def test_a_target_that_is_not_a_git_repository_stops_in_plain_language(tmp_path):
    session = run_module.Session(repo=tmp_path)
    with pytest.raises(run_module.Stop) as stopped:
        run_module.bring_prd_inside(session, prd(tmp_path))
    assert "not a git repository" in stopped.value.step.text
    assert "engineer" in stopped.value.step.text


# --- INVARIANT 4: byte-equality, including §3a's gate append -----------------


@pytest.fixture
def proposing(project: Path) -> Path:
    """The same project, with a gate PROPOSED that is not yet installed.

    The sidecar is the engine's own channel for a per-criterion binding, and
    the file is written the way `wring spec`'s own message tells an operator
    to write it by hand — never a shape invented here.

    **This binding ran `true` until 2026-08-19, and the engine now refuses
    that.** The project fixture declares `unit: run: "true"`, so the proposed
    binding was byte-identical to a check that already ran and passed — a gate
    that could not have gone red whatever a worker did, which is precisely the
    thing `spec.parse_bindings` started refusing that day. The engine's new
    rule found it in this package's own fixture, which is the cross-repo guard
    working rather than a test being tidied.

    It is RED here, and red is the correct colour for a check that proves a
    criterion nobody has built yet.
    """
    (project / "wringer.gates.yaml").write_text(
        "schema_version: wringer.gatespec.v1\n"
        "gates:\n"
        "  - id: acc-exports-csv\n"
        '    run: "test -f exports.csv"\n'
        "    proves: exports-csv\n",
        encoding="utf-8",
    )
    approve_the_plan(project)
    return project


def approve_the_plan(repo: Path) -> None:
    """Answer and approve through the BOARD's own writers, never by hand."""
    from wringer_board import interview

    for question in interview.unanswered(repo):
        interview.answer(repo, question.id, "The ones on screen.")
    interview.approve(repo, read_the_plan=True)


def added_lines(diff: str) -> list[str]:
    """The `+` lines of a unified diff, without its `+++` header."""
    return [
        row[1:]
        for row in diff.splitlines()
        if row.startswith("+") and not row.startswith("+++")
    ]


def test_installing_the_gates_adds_the_diffs_lines_AND_TOUCHES_NOTHING_ELSE(
    proposing,
):
    """**§3a's byte-equality, checked against the diff rather than the writer.**

    The property is not "some YAML with the gate in it" — it is that the
    file after equals the file before with exactly the rendered diff's added
    lines inserted, and nothing else moved. That is what makes it identical
    to a hand edit, and it is what a `yaml.safe_load`/`dump` round-trip would
    fail: it would reformat the document and silently drop every comment in
    it, while still producing a file that loads.
    """
    config = pytest.importorskip("wringer.config")
    before = (proposing / config.CONFIG_FILENAME).read_text(encoding="utf-8")

    proposal = run_module.gate_proposal(proposing)
    assert proposal["gates_proposed"] == ["acc-exports-csv"], proposal
    installed = run_module.install_gates(proposing, proposal, answered_yes=True)
    assert installed is True

    after = (proposing / config.CONFIG_FILENAME).read_text(encoding="utf-8")
    expected = added_lines(proposal["gate_diff"])
    assert expected, "the engine rendered no additions to check against"

    # **Positional, not set-wise.** An earlier draft of this removed the added
    # lines by value and compared what was left, which a writer appending them
    # to the END of the file would have passed — the check has to know WHERE
    # they landed, or it is not checking the thing its name claims.
    import difflib

    ops = difflib.SequenceMatcher(
        a=before.splitlines(), b=after.splitlines(), autojunk=False
    ).get_opcodes()
    inserted: list[str] = []
    for tag, _, _, start, end in ops:
        assert tag in ("equal", "insert"), (
            f"installing the gates {tag}d lines the diff never claimed to touch"
        )
        if tag == "insert":
            inserted += after.splitlines()[start:end]
    assert inserted == expected, (
        "the lines installed are not the lines the person was shown"
    )
    # And the result is a config the ENGINE still loads, with the gate live.
    loaded = config.load(proposing / config.CONFIG_FILENAME)
    assert "acc-exports-csv" in [gate.id for gate in loaded.gates]


def test_RUNNING_IT_A_SECOND_TIME_IS_A_SAFE_ACT(proposing):
    """**Field report 2026-08-21 finding 10, end to end.**

    The first run installs the gate and leaves the proposal in
    `wringer.gates.yaml` — which is what a run that SUCCEEDED leaves behind,
    not a mess. The second run then read both, compared the installed gate to
    itself, called it a pre-existing conflict, and stopped the build. The
    evaluator recovered by moving the proposal file aside by hand; a product
    manager has no way to know that is the fix.

    This drives the real chain twice, through the real `wring plan --json`
    subprocess, because the refusal lived in the engine and reached the
    operator through the drive. A parser unit test alone would not have caught
    the stop.
    """
    config = pytest.importorskip("wringer.config")

    first = run_module.gate_proposal(proposing)
    assert first["gates_proposed"] == ["acc-exports-csv"]
    assert run_module.install_gates(proposing, first, answered_yes=True) is True
    after_install = (proposing / config.CONFIG_FILENAME).read_text("utf-8")
    assert "acc-exports-csv" in after_install
    # The proposal stays where the successful run left it — nothing tidies it
    # away, and nothing should have to.
    assert (proposing / "wringer.gates.yaml").is_file()

    # THE SECOND RUN. Before the fix this raised `Stop` out of `_json_or_stop`,
    # because `wring plan` exited non-zero refusing its own installed gate.
    second = run_module.gate_proposal(proposing)

    assert second.get("gates_proposed") in ([], None), (
        "the already-installed gate was proposed again for installation"
    )
    assert not (second.get("gate_diff") or "").strip(), (
        "a diff was rendered for a change that is already on disk — applying "
        "it would add the gate twice"
    )
    # And the binding is still there. "the criterion is left unbound" was the
    # third false claim in that message, and the file is what refutes it.
    assert "proves: exports-csv" in (
        proposing / config.CONFIG_FILENAME
    ).read_text("utf-8"), "the second run dropped a binding the first installed"

    # The step the operator actually sees says the calm true thing, and none
    # of the three false ones.
    step = run_module.nothing_to_install_step(second)
    assert step.kind == "show", "a settled re-run is not an error state"
    assert "passes today" not in step.text
    assert "left unbound" not in step.text


def test_a_no_to_the_gate_diff_leaves_the_config_BYTE_IDENTICAL(proposing):
    """§3a condition 1: a no leaves the file byte-identical, and there is no
    flag that skips the diff."""
    config = pytest.importorskip("wringer.config")
    path = proposing / config.CONFIG_FILENAME
    before = path.read_bytes()

    proposal = run_module.gate_proposal(proposing)
    with pytest.raises(run_module.Stop) as stopped:
        run_module.install_gates(proposing, proposal, answered_yes=False)

    assert path.read_bytes() == before
    assert stopped.value.exit_code == 0, "declining is not an error"


def test_no_approval_means_no_gate_is_INSTALLED_and_no_worker_runs(
    proposing, tmp_path, capsys
):
    """**INVARIANT 2, corrected (finding 12).** Gates are PROPOSED at step 3,
    four steps before approval; installation is the act approval gates.

    Two authorisations, two assertions: no yes at the gate diff means the
    config is untouched, and the loop never ran.
    """
    import io
    import sys

    config = pytest.importorskip("wringer.config")
    path = proposing / config.CONFIG_FILENAME
    before = path.read_bytes()

    # **The fixture already answered and approved, so the FIRST prompt this
    # run reaches is the plan's.** An earlier draft fed an answer first; that
    # answer was read as the approval, the run stopped at step 6, and the test
    # passed having never reached step 7 at all — green while asserting
    # nothing. Watched to fail before being trusted.
    document = prd(tmp_path)
    sys.stdin = io.StringIO("yes\nyes\nno\n")
    try:
        main(["run", str(document), "--repo", str(proposing)])
    finally:
        sys.stdin = sys.__stdin__

    shown = capsys.readouterr()
    assert "Shall I add those checks" in (shown.out + shown.err), (
        "the run never reached the gate question, so this asserts nothing"
    )
    assert path.read_bytes() == before, "a gate was installed without a yes"
    assert not (proposing / ".wringer" / "loops").exists(), (
        "the loop ran without the gates that would have proved it"
    )


# --- INVARIANT 3: refusal-surface, three branches ---------------------------


@pytest.mark.parametrize("emit", ["text", "json"])
def test_the_build_is_never_silent_in_either_emit_mode(project, tmp_path, capsys, emit):
    """**R4: between "Building now" and the ending, the operator saw NOTHING.**

    The engine's own iteration/gate/worker lines were captured and discarded,
    so a working build and a hung one looked identical for up to fifteen
    minutes — the field run's evaluator killed a healthy-looking process at
    three. The loop invocation now relays the ENGINE's stderr to DRIVE's
    stderr AS IT ARRIVES, verbatim: DRIVE writes no progress sentence of its
    own, and stdout keeps its contract in both modes — the step stream in
    text, one object per line in json.
    """
    import io
    import sys

    document = prd(tmp_path)
    sys.stdin = io.StringIO("The ones on screen.\nyes\nyes\n")
    try:
        main(["run", str(document), "--repo", str(project), "--emit", emit])
    finally:
        sys.stdin = sys.__stdin__

    out, err = capsys.readouterr()
    assert "iteration 1/" in err, (
        "the engine's heartbeat never reached the operator — the build ran silent"
    )
    assert "iteration 1/" not in out, "progress leaked into the step stream"
    if emit == "json":
        for line in filter(None, out.splitlines()):
            json.loads(line)  # the contract survives the relay


def test_in_json_mode_the_ENDING_arrives_on_STDOUT_like_every_other_step(
    project, tmp_path, capsys
):
    """**Found by driving it, 2026-08-19 — not by reading.**

    `main` rendered a non-zero stop to STDERR, which is right for a person at
    a terminal and wrong for the transport this package was built for: an
    agent following `AGENTS.md` reads steps from stdout, so the LAST step —
    the refusal, the news, the reason the run ended — was the one step it
    never saw. In the verification drive the ending only appeared because the
    relay happened to pump stderr too; a strict reader would have shown the
    person nothing at all about why their build stopped.

    stdout is the step stream in json mode. Every step, including the last.
    """
    import io
    import sys

    document = prd(tmp_path)
    sys.stdin = io.StringIO("The ones on screen.\nyes\nyes\n")
    try:
        code = main(["run", str(document), "--repo", str(project), "--emit", "json"])
    finally:
        sys.stdin = sys.__stdin__

    assert code != 0, "this fixture has no remote, so delivery must refuse"
    out, _ = capsys.readouterr()
    steps = [json.loads(line) for line in out.splitlines() if line.strip()]
    assert steps, "no steps reached stdout at all"
    assert steps[-1]["kind"] == "stopped", (
        "the run ended on a refusal and the step stream does not carry it — "
        f"an agent reading stdout saw {steps[-1]['id']!r} last and never "
        "learned why the run stopped"
    )


def test_in_text_mode_a_non_zero_ending_still_goes_to_stderr(project, tmp_path, capsys):
    """The other half, so the fix above cannot quietly move a person's error
    output: at a terminal a failure belongs on the error channel, and that is
    unchanged."""
    import io
    import sys

    document = prd(tmp_path)
    sys.stdin = io.StringIO("The ones on screen.\nyes\nyes\n")
    try:
        code = main(["run", str(document), "--repo", str(project)])
    finally:
        sys.stdin = sys.__stdin__

    assert code != 0
    out, err = capsys.readouterr()
    assert "handover is being held" in err, (
        "a terminal user's refusal left the error channel"
    )
    assert "handover is being held" not in out


def test_a_worker_that_never_engaged_reaches_the_operator_as_ENGINE_WORDS():
    """**R1's last mile: the diagnosis has to arrive where the PM is.**

    The engine now says, on a loop whose worker finished having changed
    nothing, that the agent could not authenticate or could not see the work,
    and points at the operator's channel. DRIVE renders it through the
    EXISTING mapped `no_progress` sentence — the board's wording byte-intact
    — with the engine's account beside it as `engine_words`.

    The payload here is the engine's real `--json` shape for that ending; what
    is pinned is that DRIVE carries the engine's strings verbatim and composes
    none of its own.
    """
    from wringer_board import refusals

    saying = refusals.say(refusals.LOOP_ENDING, "no_progress")
    engine = {
        "status": "stopped",
        "reason": "no_progress",
        "iterations": 1,
        "loop_dir": ".wringer/loops/x",
        "worker_diagnosis": {
            "face": "turn_changed_nothing",
            "description": "the agent finished its turn without changing a "
            "file or reporting an error; this usually means it "
            "could not authenticate, or could not see the work",
            "remedy": "what a worker is given is declared by the operator, in "
            "`run.worker.acp.env_passthrough`; nothing else crosses "
            "that boundary",
            "stop_reason": "end_turn",
            "files_written": 0,
            "refusals": 0,
        },
    }

    words = run_module._worker_words(engine)
    assert words is not None
    assert engine["worker_diagnosis"]["description"] in words
    assert engine["worker_diagnosis"]["remedy"] in words
    # The board still owns the ending's sentence, unchanged.
    ending = run_module.stop_for(refusals.LOOP_ENDING, "no_progress")
    assert ending.text == saying.sentence

    # And an ending the engine did NOT diagnose carries nothing extra.
    assert run_module._worker_words({"reason": "no_progress"}) is None
    assert (
        run_module._worker_words({"reason": "no_progress", "worker_diagnosis": None})
        is None
    )


def test_a_mapped_refusal_renders_the_boards_sentence_and_its_question():
    from wringer_board import refusals

    step = run_module.stop_for(refusals.DELIVERY_REFUSAL, "gates_did_not_pass")
    saying = refusals.say(refusals.DELIVERY_REFUSAL, "gates_did_not_pass")
    assert step.text == saying.sentence
    assert step.question == saying.question


def test_a_named_value_with_no_sentence_renders_UNTRANSLATED():
    from wringer_board import refusals

    step = run_module.stop_for(
        refusals.DELIVERY_REFUSAL,
        "a-24th-nobody-mapped",
        engine_words="the tool said this",
    )
    assert "a-24th-nobody-mapped" in step.text
    assert step.engine_words == "the tool said this"


def test_a_refusal_with_NO_named_value_renders_the_engines_words_verbatim():
    """**The third branch, which the drafted spec forgot** (finding 11). The
    stops DRIVE meets first are stderr prose with an exit code and no key at
    all, so "unmapped" presupposes something they do not have."""
    step = run_module.stop_for(
        "", "", engine_words="no 'judge:' section in .wringer.yaml"
    )
    assert step.engine_words == "no 'judge:' section in .wringer.yaml"
    assert "exactly what the tool said" in step.text


def test_the_reachable_refusal_families_are_derived_from_what_DRIVE_DRIVES():
    """**INVARIANT 3, corrected (finding 10).**

    The reachable set is not typed out: it is checked against the verbs this
    package actually shells out to, read out of the source with `ast`. A step
    that starts driving `wring health` either declares the family it can now
    surface or reddens this.
    """
    from wringer_board import refusals

    source = (SRC / "run.py").read_text(encoding="utf-8")
    driven = set()
    for node in ast.walk(ast.parse(source)):
        # The shape `[engine("wring"), "<verb>", ...]` — the verb is the
        # element after the resolved executable, never a name matched on prose.
        if not isinstance(node, ast.List) or len(node.elts) < 2:
            continue
        head, verb = node.elts[0], node.elts[1]
        if (
            isinstance(head, ast.Call)
            and getattr(head.func, "id", None) == "engine"
            and isinstance(verb, ast.Constant)
            and isinstance(verb.value, str)
            and not verb.value.startswith("-")
        ):
            driven.add(verb.value)

    assert driven, "the source was not introspected at all"
    assert driven == set(run_module.ENGINE_VERBS), (
        f"DRIVE drives {sorted(driven)} but declares "
        f"{sorted(run_module.ENGINE_VERBS)} — a verb whose refusals nothing "
        f"claims to render is a stop a PM meets as an exit code"
    )

    reachable = {f for fams in run_module.ENGINE_VERBS.values() for f in fams}
    assert reachable <= set(refusals.FAMILIES), reachable

    # Every reachable PAIR renders the board's sentence AND its question.
    for family, value in refusals.MAPPING:
        if family not in reachable:
            continue
        step = run_module.stop_for(family, value)
        assert step.text and step.question, (family, value)
        assert "no wording for yet" not in step.text, (family, value)

    # And the families that come from verbs §2 never names stay out of it, so
    # this cannot quietly become "every family" and claim more than it proves.
    for absent in (
        "signature",
        "identity",
        "integrity",
        "health-verdict",
        "fleet-outcome",
    ):
        assert absent not in reachable, absent


def test_every_delivery_refusal_the_engine_can_emit_reaches_a_sentence():
    """Derived, both directions, from the engine's own closed tuple."""
    deliver = pytest.importorskip("wringer.deliver")
    from wringer_board import refusals

    for reason in deliver.REFUSAL_REASONS:
        step = run_module.stop_for(refusals.DELIVERY_REFUSAL, reason)
        assert step.question, reason
        assert "no wording for yet" not in step.text, reason


# --- THE TRANSPORT RULE: a transport, never a translator --------------------


def test_every_sentence_drive_emits_came_from_the_board_or_the_engine():
    """**The rule the whole transport decision rests on.**

    An agent relays what DRIVE emits. If DRIVE wrote its own sentences about
    criteria, refusals or gates, the agent would be relaying a SECOND surface's
    opinion — which SPEC_BOARD ruling 1 forbids, and which is the drift this
    programme keeps finding.

    Checked structurally: no string literal in `run.py`'s refusal paths may
    contain a refusal sentence of its own. The mapped branch assigns
    `saying.sentence` and `saying.question` and nothing else.
    """
    source = (SRC / "run.py").read_text(encoding="utf-8")
    tree = ast.parse(source)

    mapped = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "stop_for"
    )
    # The MAPPED branch — the last return — must take its PM-facing sentence
    # and question from the board's `Saying`, never from a literal here.
    # **Sorted by line, because `ast.walk` is breadth-first, not source
    # order** — the unsorted version picked branch 2's f-string and reported
    # the mapped branch as a literal, which is the guard being wrong about
    # the code rather than the code being wrong.
    returns = sorted(
        (n for n in ast.walk(mapped) if isinstance(n, ast.Return)),
        key=lambda n: n.lineno,
    )
    final = returns[-1]
    assigned = {kw.arg: kw.value for kw in final.value.keywords}

    sentence = assigned["text"]
    assert isinstance(sentence, ast.Attribute) and sentence.attr == "sentence", (
        "the mapped branch's `text` is not `saying.sentence` — DRIVE is "
        "writing its own sentence about a refusal, which makes an agent "
        "relaying it a second surface"
    )
    question = assigned["question"]
    assert isinstance(question, ast.Attribute) and question.attr == "question"

    # And no refusal-shaped prose anywhere in this package's own literals.
    for path in sorted(SRC.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                low = node.value.lower()
                assert "handover is being held" not in low, (
                    f"{path.name}:{node.lineno} writes a delivery-refusal "
                    f"sentence; that wording is the board's"
                )


def test_BOTH_TRANSPORTS_INSTALL_BYTE_IDENTICAL_GATES(proposing, tmp_path, capsys):
    """**Driven both ways, with a byte-identical result** — through step 7.

    The terminal is a layout of the same `Step` objects, not a second
    implementation, so what a person's run WRITES must equal what an agent's
    run writes. This drives the same project twice from the same state and
    compares the file §3a lets DRIVE touch, byte for byte.

    Steps 0-6 were filmed this way already; this is the half that installs a
    gate, which is the half where a divergence would change what "verified"
    means for the repository.
    """
    import io
    import shutil
    import sys

    config = pytest.importorskip("wringer.config")
    written = {}
    for transport in ("text", "json"):
        clone = tmp_path / f"clone-{transport}"
        shutil.copytree(proposing, clone)
        # **Three answers now**: approve the plan, decline the trial run of
        # the proposed checks (step 7a), install. The trial is declined so
        # this test keeps measuring exactly one thing — the bytes the two
        # transports write.
        sys.stdin = io.StringIO("yes\nyes\nno\nyes\n")
        try:
            main(["run", str(prd(tmp_path)), "--repo", str(clone), "--emit", transport])
        finally:
            sys.stdin = sys.__stdin__
        written[transport] = (clone / config.CONFIG_FILENAME).read_bytes()
        capsys.readouterr()

    assert written["text"] == written["json"], (
        "the two front doors installed different gates — they have drifted "
        "into two products with two vocabularies"
    )
    assert b"acc-exports-csv" in written["text"], "neither installed anything"


def test_the_terminal_and_the_json_carry_the_SAME_text():
    """The fallback is a layout, not a second wording. That is the only reason
    the two front doors cannot drift into two products."""
    step = steps_module.Step(
        kind=steps_module.CONFIRM,
        id="x",
        text="The sentence.",
        question="The question?",
        refusing_means="nothing happens.",
    )
    rendered = step.as_terminal()
    payload = step.as_json()
    for value in (payload["text"], payload["question"], payload["refusing_means"]):
        assert value in rendered
    assert payload["schema_version"] == steps_module.SCHEMA_VERSION


def test_an_unknown_step_kind_is_refused_at_construction():
    with pytest.raises(ValueError, match="unknown step kind"):
        steps_module.Step(kind="whatever", id="x", text="y")


def test_the_json_mode_is_one_object_per_line(project, tmp_path, capsys):
    """What an agent reads. One line, one step, no framing to parse."""
    import io
    import sys

    document = prd(tmp_path)
    sys.stdin = io.StringIO("The ones on screen.\nyes\nyes\n")
    try:
        main(["run", str(document), "--repo", str(project), "--emit", "json"])
    finally:
        sys.stdin = sys.__stdin__

    lines = [row for row in capsys.readouterr().out.splitlines() if row.strip()]
    assert lines
    for line in lines:
        payload = json.loads(line)
        assert payload["schema_version"] == steps_module.SCHEMA_VERSION
        assert payload["kind"] in steps_module.KINDS
        assert payload["id"] and payload["text"]


# --- nothing writes a judgement, in any of the three packages ---------------


def test_nothing_in_drive_writes_a_judgement():
    """A `human:` criterion is a person's. Checked here as well as in the
    other two packages, because the DONE box requires all three."""
    for path in sorted(SRC.glob("*.py")):
        text = path.read_text(encoding="utf-8")
        assert "judgements.yaml" not in text, path.name
        assert "judgement" not in text.lower() or "judgements.yaml" not in text


# --- step 7a: a check that already passes, said while it still matters ------
#
# **The defect, measured twice.** On 2026-08-17 a product manager was shown a
# check, told it "must be seen to FAIL first", said yes — and five seconds
# later the handover was held because that check could never have failed. The
# fact existed at the moment of the question and nothing used it.


@pytest.fixture
def proposing_green(project: Path) -> Path:
    """A proposed binding whose command PASSES against the tree as it stands.

    `git rev-parse HEAD` succeeds in any repository with a commit, and this
    fixture is one. It is not `true`, because a binding byte-identical to the
    project's declared `unit` gate is refused by the engine before it ever
    reaches a diff — which is the other half of this pair of guards.
    """
    (project / "wringer.gates.yaml").write_text(
        "schema_version: wringer.gatespec.v1\n"
        "gates:\n"
        "  - id: acc-exports-csv\n"
        '    run: "git rev-parse HEAD"\n'
        "    proves: exports-csv\n",
        encoding="utf-8",
    )
    approve_the_plan(project)
    return project


def test_the_trial_reads_the_proposed_gates_through_the_ENGINES_parser(
    proposing_green,
):
    """Never by parsing the diff: that is an engine format, and ruling 1
    forbids re-implementing one. The diff is applied to a COPY and read back
    with `config.load`, so what runs is what the engine would run."""
    proposal = run_module.gate_proposal(proposing_green)
    gates = run_module.proposed_gates(proposing_green, proposal)

    assert [gate.id for gate in gates] == ["acc-exports-csv"]
    assert gates[0].run == "git rev-parse HEAD"
    # And the real file was not touched to find that out.
    config = pytest.importorskip("wringer.config")
    assert "acc-exports-csv" not in (
        proposing_green / config.CONFIG_FILENAME
    ).read_text(encoding="utf-8")


def test_a_check_that_already_passes_is_named_AT_THE_DIFF_in_the_BOARDS_words(
    proposing_green,
):
    from wringer_board import refusals

    proposal = run_module.gate_proposal(proposing_green)
    gates = run_module.proposed_gates(proposing_green, proposal)
    green = run_module.already_passing(proposing_green, gates)
    assert green == ("acc-exports-csv",), "the trial did not find it green"

    step = run_module.trial_result_step(gates, green)
    saying = refusals.say(refusals.GATE_AT_INSTALL, "born-green")

    assert saying.sentence in step.text, (
        "DRIVE wrote its own sentence about a check instead of the board's"
    )
    assert step.question == saying.question
    assert "acc-exports-csv" in step.text


def test_a_check_that_is_RED_today_is_not_reported_as_born_green(proposing):
    """The other direction, and the reason this pair exists: a guard that
    said "already passes" about everything would satisfy the test above while
    describing every check in the world."""
    from wringer_board import refusals

    proposal = run_module.gate_proposal(proposing)
    gates = run_module.proposed_gates(proposing, proposal)
    green = run_module.already_passing(proposing, gates)

    assert gates and green == (), "the fixture's check is not red after all"
    step = run_module.trial_result_step(gates, green)
    saying = refusals.say(refusals.GATE_AT_INSTALL, "born-green")
    assert saying.sentence not in step.text
    assert "None of them passes today" in step.text


def test_the_trial_RUNS_NOTHING_until_a_person_says_yes(project, tmp_path, capsys):
    """**The reason this is a separate question at all.**

    A proposed `run:` string was written by a model, and `.wringer.yaml` is
    the only file that puts a command in Wringer's mouth. Executing one before
    anybody approved anything would run unapproved, model-authored shell — and
    would have run it even if the answer turned out to be no.

    Observed rather than asserted about: the proposed command writes a file,
    and the file's existence is the record of whether it ran.
    """
    import io
    import sys

    sentinel = project / "the-proposed-command-ran"
    (project / "wringer.gates.yaml").write_text(
        "schema_version: wringer.gatespec.v1\n"
        "gates:\n"
        "  - id: acc-exports-csv\n"
        f'    run: "touch {sentinel.name}"\n'
        "    proves: exports-csv\n",
        encoding="utf-8",
    )
    approve_the_plan(project)

    # **Two fresh copies, never the same tree driven twice.** A second run in
    # an approved tree asks a different number of questions, so re-using the
    # tree would shift every answer by one and the test would be measuring
    # its own stdin rather than the feature.
    import shutil

    document = prd(tmp_path)
    for answers, should_have_run in (
        # answers-ok · approve · decline trial · decline install
        ("yes\nyes\nno\nno\n", False),
        # answers-ok · approve · TRY · decline install
        ("yes\nyes\nyes\nno\n", True),
    ):
        clone = tmp_path / f"clone-{int(should_have_run)}"
        shutil.copytree(project, clone)
        ran = clone / sentinel.name
        sys.stdin = io.StringIO(answers)
        try:
            main(["run", str(document), "--repo", str(clone)])
        finally:
            sys.stdin = sys.__stdin__
        shown = capsys.readouterr()
        assert "Shall I try them" in (shown.out + shown.err), (
            "the run never reached the trial question, so this asserts nothing"
        )
        if should_have_run:
            assert ran.exists(), "a yes to the trial ran nothing"
        else:
            assert not ran.exists(), (
                "a command nobody approved was executed on the operator's machine"
            )


# --- no diff: THREE reasons, and they are not the same news -----------------


def test_NOTHING_PROPOSED_is_never_reported_as_already_installed():
    """**The false sentence, measured on 2026-08-19.**

    Driving a real PRD, the drafter proposed no binding at all — nine
    criteria, nothing checking any of them — and this package told the
    operator "the checks that will prove this work are already part of the
    project". They had just read "NOTHING CHECKS THIS YET" nine times in the
    plan. That is not a missing sentence, it is a false one.
    """
    step = run_module.nothing_to_install_step(
        {"gates_proposed": [], "gates_already_declared": [], "gate_diff": ""}
    )
    assert step.id == "gates-none-proposed"
    assert "already part of the project" not in step.text
    assert "No checks were proposed" in step.text


def test_ALREADY_DECLARED_is_the_only_case_that_says_already_installed():
    step = run_module.nothing_to_install_step(
        {"gates_proposed": [], "gates_already_declared": ["acc-csv"], "gate_diff": ""}
    )
    assert step.id == "gates-already-installed"
    assert "already part of the project" in step.text
    assert "acc-csv" in step.text, "it does not say WHICH checks"


def test_PROPOSALS_THAT_COULD_NOT_BE_WRITTEN_are_never_silent():
    """The engine returns no diff when appending would risk a second `gates:`
    key, and prints the gates in words instead. Reporting that as "nothing to
    add" would silently drop real checks."""
    step = run_module.nothing_to_install_step(
        {"gates_proposed": ["acc-csv"], "gates_already_declared": [], "gate_diff": ""}
    )
    assert step.id == "gates-not-installable"
    assert "acc-csv" in step.text
    assert "already part of the project" not in step.text


def test_the_setup_step_names_where_the_key_has_to_be(project, tmp_path, capsys):
    """**Found by running it.** DRIVE asks for an endpoint, a model and a
    worker, and never mentions that the endpoint needs a key — so the first
    real drive died at step 3 with `'judge.api_key_env' names WRINGER_API_KEY,
    which is not set in this environment`, a sentence about an environment
    variable said to the reader least able to act on it.

    DRIVE cannot check whether it is set — it may not read the environment at
    all, which `test_there_is_no_flag_that_answers_the_approval` enforces — so
    the honest fix is to say what it wrote down, when it writes it.
    """
    import io
    import sys

    config = pytest.importorskip("wringer.config")
    (project / config.CONFIG_FILENAME).unlink()  # force the setup branch
    # `wring init` stops outright in a project that declares no runnable
    # check, so the fixture needs one for the setup branch to be reachable
    # at all. This is the same file the demo repository is detected from.
    (project / "pyproject.toml").write_text(
        '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n'
        "\n[tool.ruff]\nline-length = 100\n",
        encoding="utf-8",
    )

    sys.stdin = io.StringIO("http://127.0.0.1:1/v1/chat/completions\nnone\ntrue\n")
    try:
        main(["run", str(prd(tmp_path)), "--repo", str(project)])
    finally:
        sys.stdin = sys.__stdin__

    shown = capsys.readouterr()
    said = shown.out + shown.err
    assert run_module.DECLARED_DEFAULTS["api_key_env"] in said, (
        "the operator is never told where the key has to be"
    )
    # Derived, not typed: whatever the generated config names is what is said.
    generated = (project / config.CONFIG_FILENAME).read_text(encoding="utf-8")
    assert run_module.DECLARED_DEFAULTS["api_key_env"] in generated


@pytest.mark.parametrize(
    "key", ["rubric", "api_key_env", "max_output_tokens", "branch", "timeout"]
)
def test_every_declared_default_reaches_the_generated_file(
    key, project, tmp_path, capsys
):
    import io
    import sys

    config = pytest.importorskip("wringer.config")
    (project / config.CONFIG_FILENAME).unlink()
    (project / "pyproject.toml").write_text(
        '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n'
        "\n[tool.ruff]\nline-length = 100\n",
        encoding="utf-8",
    )
    sys.stdin = io.StringIO("http://127.0.0.1:1/v1/chat/completions\nnone\ntrue\n")
    try:
        main(["run", str(prd(tmp_path)), "--repo", str(project)])
    finally:
        sys.stdin = sys.__stdin__
    capsys.readouterr()

    written = (project / config.CONFIG_FILENAME).read_text(encoding="utf-8")
    value = str(run_module.DECLARED_DEFAULTS[key])
    assert value in written, (
        f"DRIVE declares {key}={value} and never writes it into the config it "
        f"generates, so the default it decided on does not exist"
    )
    # And the ENGINE agrees it is a real key rather than one this package made up.
    loaded = config.load(project / config.CONFIG_FILENAME)
    assert loaded.judge is not None


def test_the_board_is_written_at_each_PHASE_BOUNDARY_not_only_at_the_end():
    """**A run takes minutes and the page is the person's only window into
    it.** A board written once, at the end, is a page not worth opening while
    the thing it describes is still happening. Rendering is idempotent and
    reads bytes already on disk, so the extra passes cost a file write and no
    engine work.

    Counted rather than asserted-once, because the failure mode is "it still
    renders, just not until the end" — which a presence check cannot see."""
    from wringer_drive import __main__ as drive_main

    source = Path(drive_main.__file__).read_text(encoding="utf-8")

    # The call sites are what this guard is about; driving a whole run here
    # would test the harness rather than the boundaries.
    # **Each WINDOW is checked, not a total count.** A count of call sites
    # passes with a boundary removed, because the ending renders the board
    # several times — this guard's first version did exactly that and stayed
    # green when the post-approval render was deleted.
    windows = (
        (
            'id="approved"',
            "Step 7 — the proposed gates",
            "between the approval and the gate question",
        ),
        (
            "Step 7 — the proposed gates",
            "Step 8 — the loop",
            "between the gates settling and the build",
        ),
    )
    for start_marker, end_marker, where in windows:
        start = source.index(start_marker)
        end = source.index(end_marker)
        assert "run_module.render_board(repo)" in source[start:end], (
            f"nothing renders the board {where}; the page a person watches is "
            "stale for that whole phase"
        )


# --- the warning must arrive before the spend (full run, 2026-08-26) --------
#
# Emitting a step and SHOWING one are different acts, and every test of this
# sentence asked the wrong one. `Session.emit` appends to a list; `_run`
# rendered that list's last entry AFTER `draft_the_spec` returned. So the
# order that actually ran was: warn (into a list nobody reads) → spend → print
# the warning. And when the drafting call REFUSED — which is what the full run
# met — `draft_the_spec` raised, the render line was never reached, and the
# operator watched money move with no sentence about it anywhere in the
# transcript. Verbatim, from that run's capture: `prd-copied`, `resuming`,
# `stopped`. Three steps, one paid call, no warning.


def _reaches_the_paid_call(project, monkeypatch, capsys, *, returncode=0):
    """Drive as far as the drafting call, with the call itself faked.

    The `--send` subprocess is intercepted rather than run: this test is about
    the ORDER of two things, and finding out by spending money at a live
    endpoint would be an odd way to test a guard against spending money.
    Returns `(launched, printed_before_each_launch)`.
    """
    spec_path = project / "wringer.spec.yaml"
    drafted = spec_path.read_text(encoding="utf-8")
    spec_path.unlink()
    launched: list[list[str]] = []
    before: list[str] = []
    real = run_module.run_command

    def recording(repo, argv, env=None):
        # Everything printed so far, snapshotted at the moment of the launch.
        before.append(capsys.readouterr().out)
        launched.append(list(argv))
        if "--send" in argv:
            if returncode == 0:
                # What a call that succeeds leaves behind, so the run can
                # carry on into the interview exactly as a real one does.
                spec_path.write_text(drafted, encoding="utf-8")
            return subprocess.CompletedProcess(
                argv, returncode,
                stdout="{}" if returncode == 0 else "",
                stderr="" if returncode == 0 else
                       "wring spec: the drafted assumptions decide something "
                       "only a person can settle.",
            )
        return real(repo, argv, env)

    monkeypatch.setattr(run_module, "run_command", recording)
    return launched, before


def test_THE_COST_SENTENCE_IS_PRINTED_BEFORE_THE_PAID_CALL_STARTS(
    project, tmp_path, capsys, monkeypatch
):
    """Not "is emitted". Printed, before, where somebody can read it."""
    import io
    import sys

    launched, before = _reaches_the_paid_call(project, monkeypatch, capsys)

    original = sys.stdin
    sys.stdin = io.StringIO("")  # the interview beyond the call is not the point
    try:
        main(["run", str(prd(tmp_path)), "--repo", str(project)])
    finally:
        sys.stdin = original

    paid = [i for i, argv in enumerate(launched) if "--send" in argv]
    assert paid, "the paid call was never reached, so this proves nothing"
    seen = "".join(before[: paid[0] + 1])
    assert "usually costs a small amount" in seen, (
        "the drafting call started before the operator was told it costs "
        "money — the warning is a report of a spend rather than a warning "
        f"about one. What HAD been printed by then: {seen!r}"
    )


def test_a_DRAFTING_CALL_THAT_REFUSES_STILL_WARNED_FIRST(
    project, tmp_path, capsys, monkeypatch
):
    """The full run's shape exactly: the call is made, the engine refuses, the
    verb stops. The spend happened, so the sentence about it must have."""
    launched, before = _reaches_the_paid_call(
        project, monkeypatch, capsys, returncode=1
    )

    code = main(["run", str(prd(tmp_path)), "--repo", str(project)])
    printed = capsys.readouterr()

    assert code != 0, "the fixture no longer refuses, so this tests nothing"
    assert [argv for argv in launched if "--send" in argv], (
        "no paid call was made, so the missing warning would not matter"
    )
    everything = "".join(before) + printed.out + printed.err
    assert "usually costs a small amount" in everything, (
        "money was spent and no surface anywhere said it would be — this is "
        "the full run's finding 2, verbatim"
    )
    assert "only a person can settle" in everything, (
        "the engine's own refusal did not reach the operator"
    )


# --- the page that held up the handover (full run, 2026-08-26) -------------


def test_THE_BOARD_IS_KEPT_OUT_OF_GIT_SO_THE_HANDOVER_CAN_COMPLETE(project):
    """**Measured stopping the whole chain.**

    The board is rendered BEFORE the loop, so every verify records it in
    `untracked.json`. It is rendered again after the loop, because showing the
    result is what it is for. `wring deliver` then refuses:

        board.html is not what 20260826-085344-3cb5 verified — its contents,
        its file mode or its symlink target has changed

    A correct refusal about a file that is not the operator's work. The
    handover cannot complete and nothing says why. The shipped example escapes
    only because its `.gitignore` was written with this line already in it,
    and no repository a person starts from has one.
    """
    run_module._keep_the_board_out_of_git(project)

    ignored = (project / ".gitignore").read_text(encoding="utf-8")
    assert run_module.BOARD_FILENAME in ignored.split(), (
        "the page Wringer writes is not ignored, so the verify records it and "
        "the delivery refuses on it"
    )


def test_it_never_writes_the_same_line_twice(project):
    """Rendered several times per run — at the plan, after the loop, and at the
    ending — so a version that appended each time would grow the operator's
    `.gitignore` by three lines a run."""
    for _ in range(3):
        run_module._keep_the_board_out_of_git(project)

    body = (project / ".gitignore").read_text(encoding="utf-8")
    assert body.split().count(run_module.BOARD_FILENAME) == 1


def test_it_leaves_what_somebody_else_wrote_alone(project):
    """A `.gitignore` is theirs. This adds a line and touches nothing."""
    (project / ".gitignore").write_text(
        "# ours\n.venv/\n*.pyc\n", encoding="utf-8"
    )

    run_module._keep_the_board_out_of_git(project)

    body = (project / ".gitignore").read_text(encoding="utf-8")
    assert body.startswith("# ours\n.venv/\n*.pyc\n")
    assert run_module.BOARD_FILENAME in body.split()


def test_it_writes_NO_gitignore_into_a_directory_with_no_git_in_it(tmp_path):
    """`wring init` calls that litter and refuses to do it, because a
    `.gitignore` in a plain directory implies a repository that is not there.
    Found by hunting this function on the day it was written."""
    plain = tmp_path / "plain"
    plain.mkdir()

    run_module._keep_the_board_out_of_git(plain)

    assert not (plain / ".gitignore").exists()


def test_a_NEGATED_ignore_is_left_exactly_as_the_operator_wrote_it(project):
    """git is last-match-wins, so appending after `!board.html` silently
    overrules somebody who deliberately chose to track this file. If they did,
    the delivery refusal downstream is a true statement about their own choice,
    and overriding them to avoid it would be the worse act."""
    original = "*.html\n!board.html\n"
    (project / ".gitignore").write_text(original, encoding="utf-8")

    run_module._keep_the_board_out_of_git(project)

    assert (project / ".gitignore").read_text(encoding="utf-8") == original


def test_an_unwritable_gitignore_never_stops_the_run(project):
    """A repository whose `.gitignore` cannot be written is not a reason to
    stop a build; the delivery refusal downstream says its own piece."""
    ignore = project / ".gitignore"
    ignore.write_text("*.pyc\n", encoding="utf-8")
    ignore.chmod(0o444)
    try:
        run_module._keep_the_board_out_of_git(project)
    finally:
        ignore.chmod(0o644)
