"""Guards on what this package SAYS about itself, and on the ordering it ships.

`wringer-drive/tests/` had no doc guards at all until 2026-08-18, and on that
day this package's own README claimed steps 7 to 10 were not built while the
code drove all four of them, the core's roadmap listed the whole cycle as
queued, and a public README claimed an independent review the spec's own state
table denies. **One fact, three documents, three different answers.**

The two doc guards below are split the way `wringer-board`'s are: the
cross-repository half lives in the DEPENDENT repository and reaches back,
because this package imports `wringer` and the core does not import this. That
is the structural answer to the failure `wringer/docs/MANUAL_CHECKS.md:723-744`
recorded — a correction that landed in one repository and never crossed the
boundary to the other.

Neither guard keeps a list of what is built. The first reads the verbs this
package really drives; the second reads the core's README on disk.
"""

from __future__ import annotations

import ast
import io
import re
import subprocess
import sys
from pathlib import Path

import pytest
from core_helpers import reader_facing_pages

from wringer_drive import run as run_module

# **`docs/drive/` since the packages collapsed (2026-08-20).** These tests came
# from the `wringer-drive` repository, where the documents they read sat at the
# repository root. Inside one distribution they cannot: `AGENTS.md`,
# `README.md` and `START-HERE.md` all collide with the engine's own. They live
# under `docs/drive/` and this is the one place that knows it.
REPO = Path(__file__).resolve().parent.parent.parent / "docs" / "drive"
SRC = Path(run_module.__file__).parent


def flattened(text: str) -> str:
    """Whitespace and emphasis markers flattened.

    The core's `tests/test_docs.py:785` rule. Re-stated rather than imported
    because the core's test module is not part of its installed package, and
    it is not optional: every document here wraps its sentences, and a
    line-wise search across a wrapped sentence matches nothing and cannot
    fail.
    """
    return " ".join(text.replace("*", "").split())


def own_voice(text: str) -> str:
    """A document's own claims, with `>` quoted material removed."""
    return "\n".join(
        line for line in text.splitlines() if not line.lstrip().startswith(">")
    )


# --- what is built, DERIVED from what this package drives -------------------
#
# SPEC_DRIVE_V0 §2's late steps, each mapped to the thing in this package that
# IS that step. Never a hand-kept "built: yes" list — that is the drift these
# guards exist to refuse.
#
# `ENGINE_VERBS` is a safe source because it is itself derived and checked:
# `test_the_reachable_refusal_families_are_derived_from_what_DRIVE_DRIVES`
# parses `run.py` with `ast` and fails if the declared verbs are not the verbs
# actually shelled out to. So this reads a fact the suite already pins.
LATE_STEPS: dict[int, str] = {
    7: "install the approved gates",
    8: "build — the repair loop",
    9: "hand over — `wring deliver`",
    10: "render the board",
}


def steps_the_code_performs() -> set[int]:
    """Which of §2's late steps this package demonstrably performs."""
    built = set()
    if callable(getattr(run_module, "install_gates", None)):
        built.add(7)
    if "run" in run_module.ENGINE_VERBS:
        built.add(8)
    if "deliver" in run_module.ENGINE_VERBS:
        built.add(9)
    if "render" in run_module.ENGINE_VERBS:
        built.add(10)
    return built


NOT_BUILT = re.compile(
    r"\b(?:are|is)\s+not\b(?!\s+(?:yet\s+)?(?:the|a|an)\b)"
    r"|\bnot\s+(?:yet\s+)?built\b"
    r"|\bremains?\s+unbuilt\b"
    r"|\bstill\s+to\s+(?:be\s+)?(?:built|come)\b",
    re.I,
)
STEP_RANGE = re.compile(r"\bsteps?\s+(\d+)\s*(?:to|through|and|[-–—])\s*(\d+)", re.I)
STEP_ONE = re.compile(r"\bstep\s+(\d+)\b", re.I)


def steps_claimed_unbuilt(text: str) -> dict[int, str]:
    """Step numbers a document says, in its own voice, are not built."""
    claimed: dict[int, str] = {}
    for sentence in re.split(r"(?<=[.!?])\s+", flattened(own_voice(text))):
        if not NOT_BUILT.search(sentence):
            continue
        numbers: set[int] = set()
        for low, high in STEP_RANGE.findall(sentence):
            numbers.update(range(int(low), int(high) + 1))
        numbers.update(int(n) for n in STEP_ONE.findall(sentence))
        for number in numbers:
            claimed.setdefault(number, sentence)
    return claimed


def test_the_readme_does_not_claim_unbuilt_what_the_code_drives():
    """**Red on the real defect, 2026-08-18.**

    `README.md:39-41` said *"Steps 7 to 10 (install gates, build, deliver,
    render the board) are not [built]"* while `ENGINE_VERBS` declares `run`,
    `deliver` and `render` — verbs the suite separately proves are really
    shelled out to — and `install_gates` is a function in `run.py` with three
    tests of its own.

    The fact is read off the code every time this runs. A step that is later
    REMOVED makes this guard permit the sentence again, which is the correct
    direction: the document may say what the code does, whichever way it
    moves.
    """
    built = steps_the_code_performs()
    assert built, (
        "no late step could be derived from the code at all, so this guard "
        "would pass while checking nothing — `ENGINE_VERBS` or "
        "`run.install_gates` moved"
    )

    readme = (REPO / "README.md").read_text(encoding="utf-8")
    claimed = steps_claimed_unbuilt(readme)
    contradicted = {n: s for n, s in claimed.items() if n in built}

    assert not contradicted, (
        "this package performs "
        + ", ".join(f"step {n} ({LATE_STEPS[n]})" for n in sorted(built))
        + " — and its own README says otherwise:\n"
        + "\n".join(f"  step {n}: {s}" for n, s in sorted(contradicted.items()))
    )


REVIEW_OVERCLAIM = re.compile(r"\bindependently\s+reviewed\b", re.I)


def test_the_readme_does_not_call_the_specs_review_independent():
    """**The worst class of contradiction a trust product can carry: a claim
    about verification itself.**

    `SPEC_DRIVE_V0.md`'s header records a review; its §11 state table says
    `independently reviewed | NO. Not begun`; and this README said
    *"independently reviewed"* in public — resolving the contradiction in the
    flattering direction.

    Ruled 2026-08-18 from §12's own text: the review was a same-day,
    one-agent refute pass by the window that then built to the spec — real,
    NOT SOUND, 19 findings, all folded — and *independent* is this house's
    word for a separate later review, which has not begun. The README may
    describe what the record shows and not a word more.

    Derived, not pinned: the core's §11 row is read at test time, so if a
    genuinely independent review ever runs and flips that row, this guard
    stops forbidding the word rather than having to be remembered.
    """
    spec = spec_drive_text()
    says_no = re.search(
        r"independently\s+reviewed\s*\|[^|\n]*\bNO\b", flattened(own_voice(spec)), re.I
    )
    assert says_no, (
        "SPEC_DRIVE_V0 §11 no longer carries an `independently reviewed | NO` "
        "row, so this guard would pass while checking nothing. If a real "
        "independent review ran, delete this guard and say so; if the row was "
        "merely reworded, re-derive the pattern"
    )

    readme = flattened(own_voice((REPO / "README.md").read_text(encoding="utf-8")))
    hit = REVIEW_OVERCLAIM.search(readme)
    assert hit is None, (
        "SPEC_DRIVE_V0 §11 says the spec has NOT been independently reviewed, "
        "and this public README claims it has: "
        f"…{readme[max(0, hit.start() - 70) : hit.end() + 70]}…"
    )


# --- the cross-repository half ----------------------------------------------


def core_root() -> Path:
    """The CORE repository, found through the engine this package drives."""
    wringer = pytest.importorskip(
        "wringer.accept",
        reason="the core is not importable, so its README and SPEC_DRIVE_V0 "
        "cannot be located. Nothing else checks that the core's roadmap and "
        "this package agree about whether this package exists, and this is "
        "that gap being named",
    )
    return Path(wringer.__file__).resolve().parents[2]


def core_readme() -> str:
    path = core_root() / "README.md"
    if not path.is_file():
        pytest.skip(f"the core is importable but {path} is absent")
    return path.read_text(encoding="utf-8")


def spec_drive_text() -> str:
    path = core_root() / "SPEC_DRIVE_V0.md"
    if not path.is_file():
        pytest.skip(f"the core is importable but {path} is absent")
    return path.read_text(encoding="utf-8")


QUEUE_CLOSER = "Nothing above is claimed as existing"


def queued_rows(readme: str) -> list[str]:
    """The rows of the core README's "what is queued now" table.

    Located by its own closing sentence rather than by line number: the table
    is whatever `|`-rows stand between the last table header before that
    sentence and the sentence itself.
    """
    lines = readme.splitlines()
    closing = next((i for i, line in enumerate(lines) if QUEUE_CLOSER in line), None)
    assert closing is not None, (
        f"the core README no longer contains {QUEUE_CLOSER!r}, which is how "
        f"this guard finds the queue. It moved — re-derive the anchor rather "
        f"than deleting this assertion"
    )
    rows = []
    for line in reversed(lines[:closing]):
        stripped = line.strip()
        if not stripped:
            if rows:
                break
            continue
        if not stripped.startswith("|"):
            break
        rows.append(stripped)
    return list(reversed(rows))


def test_the_core_roadmap_does_not_deny_this_package_exists():
    """**Red on the real defect, 2026-08-18.**

    `wringer/README.md:711-724` listed *"The drive cycle — the operating gap —
    one verb from a prose file to a rendered board"* under **what is queued
    now**, closed by *"Nothing above is claimed as existing."* This package is
    that cycle, it is built through step 10, and its wall clock is measured in
    `docs/pm-mode-2026-08-17.md`.

    The other direction of the same fact as the README guard above, and it is
    here rather than in the core for the same reason the board's publication
    guard is in the board: the dependent repository can see both sides.
    """
    built = steps_the_code_performs()
    assert built, "nothing derivable from the code, so this checks nothing"

    rows = queued_rows(core_readme())
    assert rows, (
        "no table rows were found above the core README's queue closer, so "
        "this guard would pass while checking nothing"
    )

    denied = [row for row in rows if re.search(r"\bdrive\b", row, re.I)]
    assert not denied, (
        "the core README lists this package under what is QUEUED, closed by "
        f"{QUEUE_CLOSER!r} — while it drives "
        + ", ".join(f"step {n}" for n in sorted(built))
        + ":\n"
        + "\n".join(f"  {row}" for row in denied)
    )


def test_the_core_roadmap_TABLE_does_not_mark_this_cycle_queued():
    """**A thirteenth contradiction, found by reading rather than by a guard —
    which is exactly why it is now a guard.**

    `ROADMAP.md`'s cycle table had **The drive cycle** in a row whose state
    cell read `queued`, under a heading saying *"nothing in it is claimed as
    existing"*, on 2026-08-18. The README guard above could not see it: it
    reads the README's queue table and stops at the file boundary. Same
    class, one document over.

    Derived the same way: the state cell of any row naming this cycle may not
    say `queued` while the code performs the steps.
    """
    built = steps_the_code_performs()
    assert built, "nothing derivable from the code, so this checks nothing"

    path = core_root() / "ROADMAP.md"
    if not path.is_file():
        pytest.skip(f"the core is importable but {path} is absent")

    rows = [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip().startswith("|")
    ]
    assert rows, "no table rows in the core ROADMAP at all"

    named = [row for row in rows if re.search(r"\bdrive cycle\b", row, re.I)]
    assert named, (
        "the core ROADMAP no longer has a row naming the drive cycle, so this "
        "guard would pass while checking nothing. If the row was renamed, "
        "re-derive the pattern; if the table went, say so here"
    )

    queued = [
        row
        for row in named
        if re.search(r"\|\s*(?:queued|planned|not started)\s*\|?\s*$", row, re.I)
    ]
    assert not queued, (
        "the core ROADMAP marks this cycle queued while it drives "
        + ", ".join(f"step {n}" for n in sorted(built))
        + ":\n"
        + "\n".join(f"  {row}" for row in queued)
    )


# --- the board-path ordering, pinned on BOTH endings ------------------------


def recording_session(monkeypatch) -> list:
    """Capture the `Session` `main()` builds, so its ordered steps are readable.

    `session.steps` is the ordered record of everything emitted, including the
    final stop — which is the only place the two streams (`stdout` for steps,
    `stderr` for a non-zero stop) can be compared as one sequence.
    """
    made: list = []
    real = run_module.Session

    def build(**kwargs):
        session = real(**kwargs)
        made.append(session)
        return session

    monkeypatch.setattr(run_module, "Session", build)
    return made


@pytest.fixture
def project(tmp_path: Path) -> Path:
    """The same real repository `test_drive.py`'s fixture builds.

    Duplicated rather than imported so this file stands alone; the shape is
    the engine's, written through `wringer.spec.render`, never hand-typed
    YAML.
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


def drive(project: Path, tmp_path: Path, answers: str, monkeypatch) -> tuple[int, list]:
    from wringer_drive.__main__ import main

    made = recording_session(monkeypatch)
    sys.stdin = io.StringIO(answers)
    try:
        code = main(["run", str(prd(tmp_path)), "--repo", str(project)])
    finally:
        sys.stdin = sys.__stdin__
    assert made, "the session was never built"
    return code, made[0].steps


def test_a_refused_run_still_emits_the_board_AND_SAYS_THE_REFUSAL_LAST(
    project, tmp_path, capsys, monkeypatch
):
    """**Deliberate ordering, pinned so a tidy-up cannot reverse it.**

    This fixture has no remote, so `wring deliver` refuses — the common
    ending, and the product working. Two things must hold together and it is
    easy to break one while fixing the other:

    - the board is still rendered and still announced, because the page is
      how a person finds out WHY;
    - the refusal is the LAST thing said, because the refusal is the news. A
      run that ends on "your page is at board.html" reads as a success.
    """
    code, steps = drive(project, tmp_path, "The ones on screen.\nyes\nyes\n", monkeypatch)
    capsys.readouterr()

    assert code != 0, "a refused handover is not a success"
    ids = [step.id for step in steps]
    assert "board" in ids, f"a refused run never announced the board: {ids}"
    assert (project / run_module.BOARD_FILENAME).is_file()
    assert ids[-1].startswith("stopped"), (
        f"a refused run ended on {ids[-1]!r} rather than on the refusal; the "
        f"refusal is the news and it must be the last word: {ids}"
    )
    assert ids.index("board") < len(ids) - 1


def test_a_converged_run_emits_the_board_TOO_and_ends_on_the_page(
    project, tmp_path, capsys, monkeypatch
):
    """The other ending, and the reason the ordering is not an accident.

    **What is substituted, stated rather than hidden:** only the engine's
    delivery VERDICT. `delivery_plan` and `deliver` are replaced so the
    converged branch is reachable — this fixture cannot honestly converge,
    since nothing evidences its criterion and there is no remote to push to.
    Everything else is real, including `wringer-board render`, which writes
    the page this asserts exists.

    What is being pinned is DRIVE's ordering, not the engine's answer, and
    the engine's answer is exactly the input a test is entitled to choose.
    """
    monkeypatch.setattr(run_module, "delivery_plan", lambda repo: {"would": "send"})
    monkeypatch.setattr(
        run_module, "deliver", lambda repo, *, answered_yes: {"sent": answered_yes}
    )

    code, steps = drive(
        project, tmp_path, "The ones on screen.\nyes\nyes\nyes\n", monkeypatch
    )
    capsys.readouterr()

    assert code == 0, f"a converged run should exit 0, got {code}"
    ids = [step.id for step in steps]
    assert "board" in ids, f"a converged run never announced the board: {ids}"
    assert ids[-1] == "done", f"a converged run ended on {ids[-1]!r}: {ids}"
    assert (project / run_module.BOARD_FILENAME).is_file()


def test_both_endings_render_the_board_in_the_orchestrator_itself():
    """The structural half, and it is what stops a refactor from removing one
    branch while the other stays green.

    `__main__._run` renders the board on the refused branch (inside the
    `except run_module.Stop`) and on the converged one (after it). Both call
    sites are read out of the source with `ast`, so deleting either reddens
    this even if a live test happens not to reach that path.
    """
    source = (SRC / "__main__.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    run_fn = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "_run"
    )

    handlers = [n for n in ast.walk(run_fn) if isinstance(n, ast.ExceptHandler)]
    assert handlers, "`_run` no longer catches a Stop around delivery"

    def renders_board(node) -> bool:
        return any(
            isinstance(call, ast.Call)
            and getattr(call.func, "attr", None) == "render_board"
            for call in ast.walk(node)
        )

    inside = [h for h in handlers if renders_board(h)]
    assert inside, (
        "no `except Stop` handler in `_run` renders the board — a refused run "
        "would leave the person without the page that explains why"
    )
    for handler in inside:
        assert any(isinstance(n, ast.Raise) for n in ast.walk(handler)), (
            "the refusal-branch handler renders the board and then swallows "
            "the Stop; the refusal must still be the last word"
        )

    handler_lines = {
        line
        for h in inside
        for line in (getattr(n, "lineno", None) for n in ast.walk(h))
        if line is not None
    }
    outside = [
        call
        for call in ast.walk(run_fn)
        if isinstance(call, ast.Call)
        and getattr(call.func, "attr", None) == "render_board"
        and call.lineno not in handler_lines
    ]
    assert outside, (
        "the board is rendered only on the refused branch — a converged run "
        "would finish without a page"
    )


# --- the install a stranger will actually run -------------------------------


def declared_dependencies() -> list[str]:
    """`pyproject.toml`'s runtime dependencies, read off the file.

    Parsed with `tomllib`, so the fact comes from the packaging metadata a
    resolver will really use rather than from a sentence somebody kept up to
    date by hand.
    """
    import tomllib

    # The SHARED pyproject since the collapse — the drive no longer has one
    # of its own, which is the point of shipping in a single package.
    shared = Path(__file__).resolve().parent.parent.parent / "pyproject.toml"
    data = tomllib.loads(shared.read_text(encoding="utf-8"))
    raw = data.get("project", {}).get("dependencies", [])
    names = []
    for entry in raw:
        name = re.split(r"[<>=!~\[; ]", entry.strip(), maxsplit=1)[0]
        if name:
            names.append(name)
    return names


def test_the_readme_tells_a_stranger_how_to_install_every_dependency():
    """**Red on a real defect, found by RUNNING rather than by reading.**

    On 2026-08-18 a clean clone of this repository was installed into a fresh
    virtual environment to check that it could be, and it could not:

      Because wringer-board was not found in the package registry and
      wringer-drive==0.1.0 depends on wringer-board, we can conclude that
      wringer-drive==0.1.0 cannot be used.

    Neither sibling is on PyPI, so `pip install -e .` — the first command a
    stranger types — fails with a resolver error that says nothing about what
    to do. The README said nothing about installing anything.

    Derived from `pyproject.toml`, so a dependency added later drags the
    README with it: every declared dependency must be named in a runnable
    block here. It cannot check that PyPI lacks them (these tests send
    nothing over the network), and it does not need to — naming them is
    right either way.
    """
    declared = declared_dependencies()
    assert declared, (
        "`pyproject.toml` declares no runtime dependencies, so this guard "
        "would pass while checking nothing"
    )

    readme = (REPO / "README.md").read_text(encoding="utf-8")
    runnable = "\n".join(re.findall(r"```bash\s*\n(.*?)```", readme, re.DOTALL))

    # **What this checks CHANGED on 2026-08-20, because what is true changed.**
    #
    # It used to require every declared dependency to be NAMED in a runnable
    # block, because two of them were sibling packages that had never been
    # published and a resolver could not fetch them. That is no longer the
    # situation: all three ship in one distribution, so the install is
    # `pip install wringer` and the dependencies come with it.
    #
    # The PURPOSE is unchanged and is what is asserted now — a stranger
    # following this README must not be handed a command that cannot work.
    # Retiring the guard when its subject moved would have been the easy
    # option and the wrong one.
    assert "pip install wringer" in runnable, (
        "the README's runnable blocks never install the package. A stranger "
        "following it gets nothing"
    )
    stale = [
        line
        for line in runnable.splitlines()
        if "pip install -e" in line
        and ("../wringer" in line or "wringer-board" in line)
    ]
    assert not stale, (
        f"the README still teaches the pre-collapse install: {stale}. Those "
        "siblings are not separate packages any more, and one of them was "
        "never on PyPI — which is exactly the resolver error this guard was "
        "written for"
    )


# --- the example a stranger is told to run ----------------------------------
#
# `examples/pipeline/` is the first thing anybody who is not me will run, and
# its whole value rests on one fact being true of the copy they get: the
# project's own suite is GREEN and the acceptance check is RED. If that ever
# stops being true the example still "works" — it just quietly stops
# demonstrating anything, which is the failure mode this programme keeps
# finding.

EXAMPLES = Path(__file__).resolve().parent.parent.parent / "docs" / "drive" / "examples"
EXAMPLE = EXAMPLES / "pipeline"

# Every example, so a second one cannot be added without meeting the same bar.
# `red` is the acceptance check that must fail, and `green` is the command that
# must pass, as the example's own README tells a reader to run them.
ALL_EXAMPLES = (
    (
        "pipeline",
        ["-m", "pytest", "-q"],
        ["-m", "pytest", "-q", "acceptance/test_skip_downstream.py"],
    ),
    (
        "arcade",
        ["--test", "tests/catalogue.test.js", "tests/cabinet.test.js"],
        ["--test", "acceptance/recently-played.test.js"],
    ),
)


@pytest.mark.parametrize("name", [name for name, _, _ in ALL_EXAMPLES])
def test_every_example_ships_a_setup_script_that_refuses_a_broken_copy(name):
    script = (EXAMPLES / name / "setup.sh").read_text(encoding="utf-8")
    assert 'if [ -e "$TARGET" ]' in script, f"{name} would overwrite a directory"
    assert "PASSES already, and it must not" in script, (
        f"{name}'s setup does not check that its acceptance check is red, so it "
        f"can hand over a copy that demonstrates nothing"
    )
    assert (EXAMPLES / name / "PRD.md").is_file()
    assert not (EXAMPLES / name / "project" / ".git").exists()


@pytest.mark.parametrize("name", [name for name, _, _ in ALL_EXAMPLES])
def test_no_setup_script_can_say_READY_past_a_MISSING_CODING_AGENT(
    name, tmp_path
):
    """**Field report 2026-08-21 finding 6, EXECUTED rather than read.**

    `setup.sh` preflighted `git` and `node`, validated the whole starting
    state, printed "Ready", and told the reader to answer
    `acp: claude-agent-acp` — having never checked that agent existed. On the
    evaluator's Mac it did not, and the run reached the build step only after
    the interview, two paid API calls, three approvals and a gate install.

    Run with a PATH holding everything the script needs EXCEPT the agent, so
    the check under test is the one that fires. Reading the script for a
    string would pass on a script where the check sits after the banner —
    which is the exact defect, one position over.
    """
    import os
    import shutil
    import subprocess

    script = EXAMPLES / name / "setup.sh"
    # Everything the script legitimately needs, and nothing else, so a missing
    # agent is the ONLY reason it can fail here.
    #
    # **This list is longer than it looks like it needs to be, and the reason
    # is a defect this test had while being written.** With only `git` and
    # `node` linked, removing the agent check made the script die on
    # `dirname: command not found` — so it still exited non-zero and still
    # never printed "Ready", and the first two assertions below passed while
    # the behaviour under test was absent. A guard that goes red for the wrong
    # reason is a guard that will go green for the wrong reason later. The
    # script must be able to run PAST the agent check for this to measure
    # anything.
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    needed = (
        "git", "node", "npm", "uv", "sh", "env",
        "dirname", "basename", "cp", "mkdir", "rm", "cat", "sed", "tr", "pwd",
    )
    missing = []
    for tool in needed:
        found = shutil.which(tool)
        if found:
            (bin_dir / tool).symlink_to(found)
        else:
            missing.append(tool)
    if shutil.which("git") is None:
        pytest.skip("git is absent, so this example cannot be set up at all")
    assert shutil.which("dirname", path=str(bin_dir)) is not None, (
        "the sandbox PATH cannot run the script at all, so this test would "
        "pass on a script with no agent check in it"
    )
    # The agent must be genuinely unreachable, which is the condition under
    # test — assert it rather than assuming the stripped PATH did it.
    assert shutil.which("claude-agent-acp", path=str(bin_dir)) is None

    done = subprocess.run(
        ["sh", str(script), str(tmp_path / "target")],
        capture_output=True,
        text=True,
        check=False,
        env={**os.environ, "PATH": str(bin_dir)},
    )
    printed = done.stdout + done.stderr

    # **Why this can skip after the script has already run — the CI red of
    # 2026-08-22.** The symlink loop above drops a tool it cannot find. On this
    # maintainer's Mac every name in `needed` resolves, the sandbox reaches the
    # agent check, and the guard measures what it says it measures. On GitHub's
    # ubuntu runner `uv` is not installed; `pipeline`'s own prerequisite loop
    # demands it and exited on "'uv' is not on your PATH, and this needs it."
    # — before the agent check ever ran. `assert "claude-agent-acp" in printed`
    # then failed for a reason with nothing to do with the behaviour under test,
    # and main went red on a defect that was not there.
    #
    # A guard that goes red for the wrong reason is the same defect as one that
    # goes green for the wrong reason: in both cases the tick is not evidence.
    # So say plainly that the sandbox could not be built and name what is
    # missing. This is deliberately checked from the script's OWN prerequisite
    # message rather than from `missing` — a machine without `uv` can still
    # measure `arcade`, which does not need it, and a blanket skip would throw
    # that coverage away. `tests.yml` installs `uv` so this does not fire in CI.
    if "and this needs it." in printed:
        pytest.skip(
            f"{name}'s setup.sh stopped on its own prerequisite check "
            f"({', '.join(missing) or 'unknown tool'} absent from this "
            f"machine), so it never reached the agent check under test"
        )

    assert done.returncode != 0, (
        f"{name}'s setup.sh succeeded with no coding agent installed — the "
        "operator is sent to spend money on a run that cannot finish"
    )
    assert "Ready" not in done.stdout, (
        f"{name}'s setup.sh printed 'Ready' while the agent it goes on to "
        "recommend is missing. That is the finding: not a wrong message, a "
        "correct one in the wrong order"
    )
    assert "claude-agent-acp" in printed
    assert "npm install -g" in printed, "the reader is not told how to fix it"
    # Finding 9: installing it is not always sufficient, and the message that
    # stops at the install line starts a second search on a machine like the
    # evaluator's, where npm's global bin was not on PATH.
    assert "npm bin -g" in printed, (
        "the message does not name the case where the install succeeds and "
        "the command is still not found"
    )


@pytest.mark.parametrize("name", [name for name, _, _ in ALL_EXAMPLES])
def test_no_setup_script_claims_wringers_key_reaches_the_coding_agent(name):
    """**Field report 2026-08-21 finding 11.** The scripts said:

        Put your key in the environment. Wringer reads it from there and
        nowhere else

    True of Wringer. False of the coding agent Wringer launches, which is the
    thing that does the actual work: it needs a credential of its own, and
    `WRINGER_API_KEY` is not it. A PM sets one key, every visible signal looks
    correct, two paid calls succeed, and the build fails for a reason named
    nowhere in the interview, the plan or the example.

    A half-true sentence about credentials is worse than no sentence: it
    answers the reader's question wrongly and stops them asking again.

    **Re-derived 2026-08-22, because the correction over-corrected.** These
    scripts went on to say the agent *"signs in on its own account, and this
    key never reaches it — setting it does not log the agent in, and no other
    variable does either"*. The last clause is false: `ANTHROPIC_API_KEY`
    declared under `run.worker.acp.env_passthrough` authenticates the builder,
    measured (`docs/auth-probe-2026-08-22.md`). So what is pinned now is not
    a denial. It is that the script separates the two credentials, and then
    tells the reader how to give the agent one and how to check for free
    whether they need to — because a reader who is told only what does NOT
    work is still stuck.
    """
    script = (EXAMPLES / name / "setup.sh").read_text(encoding="utf-8")
    assert "NOT FOR THE CODING AGENT" in script, (
        f"{name}'s setup.sh does not say the key it asks for is not the "
        "agent's credential"
    )
    assert "credential of its own" in script, (
        f"{name}'s setup.sh no longer says the builder needs its own "
        "credential, which is the whole distinction this guard exists for"
    )
    assert "auth login" in script and "env_passthrough" in script, (
        f"{name}'s setup.sh names the problem without naming either route out "
        "of it"
    )
    assert "auth status" in script, (
        f"{name}'s setup.sh does not give the reader the free check that says "
        "which route they need before they spend anything"
    )
    for killed in ("never reaches it", "no other variable does either"):
        assert killed not in script, (
            f"{name}'s setup.sh asserts {killed!r} — measured false on "
            "2026-08-22"
        )


@pytest.mark.parametrize("name,green,red", ALL_EXAMPLES)
def test_every_example_is_GREEN_where_it_claims_and_RED_where_it_claims(
    name, green, red, tmp_path
):
    """**The fact every example rests on, measured rather than asserted.**

    Run against the shipped files, in a copy. The arcade needs `node`; where it
    is absent this SKIPS with the claim it could not check named out loud,
    rather than passing quietly.
    """
    import shutil
    import subprocess
    import sys

    source = EXAMPLES / name / "project"
    if not source.is_dir():
        source = EXAMPLES / name
    work = tmp_path / name
    shutil.copytree(source, work)

    runner = sys.executable if green[0] == "-m" else "node"
    if runner == "node" and shutil.which("node") is None:
        pytest.skip(
            f"node is not installed, so THE CENTRAL CLAIM of the {name} example "
            "is UNCHECKED here: that its own suite is green and its acceptance "
            "check is red"
        )

    passed = subprocess.run(
        [runner, *green], cwd=work, capture_output=True, text=True, check=False
    )
    assert passed.returncode == 0, (
        f"the {name} example's own suite is not green at the start, so it "
        f"demonstrates nothing:\n{(passed.stdout + passed.stderr)[-2000:]}"
    )
    failed = subprocess.run(
        [runner, *red], cwd=work, capture_output=True, text=True, check=False
    )
    assert failed.returncode != 0, (
        f"the {name} example's acceptance check PASSES against the shipped "
        "project. It claims to be red until the feature is built, and a check "
        "that is green at the start cannot show the difference the work makes"
    )


def test_the_example_ships_the_files_its_setup_script_copies():
    """Derived from the script, not from a list kept beside it."""
    script = (EXAMPLE / "setup.sh").read_text(encoding="utf-8")
    for named in ("$HERE/project", "$HERE/PRD.md"):
        assert named in script, named
    assert (EXAMPLE / "project").is_dir()
    assert (EXAMPLE / "PRD.md").is_file()
    assert (EXAMPLE / "project" / "acceptance" / "test_skip_downstream.py").is_file()


def test_the_examples_project_is_NOT_a_git_repository():
    """A repository inside a repository is a submodule nobody asked for, and
    `setup.sh` is what makes the real one."""
    assert not (EXAMPLE / "project" / ".git").exists()


def test_the_acceptance_check_is_RED_and_the_suite_is_GREEN(tmp_path):
    """**The fact the whole example rests on, measured rather than asserted.**

    Run against the shipped files, in a copy, with this suite's own
    interpreter. `pytest -q` is scoped by the project's `testpaths` to
    `tests/`, so the acceptance directory is deliberately outside it.
    """
    import shutil
    import subprocess
    import sys

    project = tmp_path / "project"
    shutil.copytree(EXAMPLE / "project", project)

    def run(*args):
        return subprocess.run(
            [sys.executable, "-m", "pytest", "-q", *args],
            cwd=project,
            capture_output=True,
            text=True,
            check=False,
        )

    green = run()
    assert green.returncode == 0, (
        "the example's own suite is not green at the start, so the example "
        f"demonstrates nothing:\n{green.stdout[-2000:]}"
    )
    red = run("acceptance/test_skip_downstream.py")
    assert red.returncode != 0, (
        "the acceptance check PASSES against the shipped project. The example "
        "claims it is red until the feature is built, and a check that is "
        "green at the start cannot show the difference the work makes"
    )


def test_the_setup_script_refuses_to_overwrite_something_of_yours():
    """The failure path, because a setup script that clobbers a directory is
    the one thing a stranger cannot forgive."""
    script = (EXAMPLE / "setup.sh").read_text(encoding="utf-8")
    assert 'if [ -e "$TARGET" ]' in script
    assert "already exists" in script


def test_the_example_readme_does_not_promise_a_delivered_handover():
    """Q1's ceiling, and the specific over-claim available here: this example
    ends in a REFUSAL, and a README promising a merge request would be
    describing a run nobody has had."""
    readme = (EXAMPLE / "README.md").read_text(encoding="utf-8").lower()
    for phrase in (
        "merge request is opened",
        "delivers the change",
        "hands it over automatically",
    ):
        assert phrase not in readme, phrase
    assert "refuses" in readme, (
        "the README does not tell the reader the run ends in a refusal, which "
        "is the ending they will actually get"
    )


# --- the PM front door, and the pages it sends people to --------------------

ROOT = Path(__file__).resolve().parent.parent.parent / "docs" / "drive"


# **DISCOVERED since 2026-08-23**, in the hand-kept-list audit. This was five
# page names, and `docs/drive/README.md` — the package's own front page — was
# not one of them, nor was `docs/the-whole-arc.md`, nor either example's PRD.
# Ten pages a product manager can reach were outside both guards below.
#
# The examples' `project/` trees are IN scope on purpose. They are pages
# shipped in this repository that a reader opens while following the example,
# so a dead link in one costs exactly what a dead link in the front door
# costs. Captures are out, by the same rule as everywhere else: a dated
# transcript records what was true on its date.
def pm_pages() -> list[str]:
    """Every page the PM front door can send somebody to."""
    return [
        path.relative_to(ROOT).as_posix()
        for path in reader_facing_pages(captures=False, root=ROOT)
    ]


@pytest.mark.parametrize("page", pm_pages())
def test_every_pm_page_links_only_to_pages_that_exist(page):
    """A dead link on the first page somebody reads is the cheapest possible
    way to lose them."""
    import re

    path = ROOT / page
    body = path.read_text(encoding="utf-8")
    targets = re.findall(r"\]\((?!https?:)([^)#]+)", body)
    if page == "START-HERE.md":
        assert targets, "no relative links found, so this checks nothing"
    for target in targets:
        assert (path.parent / target).exists(), f"{page} links to {target}"


@pytest.mark.parametrize("page", pm_pages())
def test_no_pm_page_promises_containment_it_does_not_have(page):
    """**Q1's ceiling on the pages a stranger reads FIRST.**

    Driving with one verb runs the coding agent uncontained and there is no
    channel to change that. Of every over-claim available here this is the one
    that could actually cost somebody something.
    """
    body = (ROOT / page).read_text(encoding="utf-8").lower()
    for phrase in (
        "sandboxed",
        "safely isolated",
        "runs securely",
        "cannot touch your",
        "in a container",
    ):
        assert phrase not in body, f"{page} claims {phrase!r}"


def test_the_front_door_says_out_loud_that_the_agent_is_uncontained():
    """The other direction, because a page that merely avoids the word would
    pass the test above while telling the reader nothing."""
    body = (ROOT / "START-HERE.md").read_text(encoding="utf-8").lower()
    assert "does not sandbox your agent" in body, (
        "the front door never tells the reader their agent runs with their own access"
    )


def test_the_front_door_never_tells_a_pm_to_paste_a_key_into_an_agent():
    body = (ROOT / "START-HERE.md").read_text(encoding="utf-8")
    assert "not in your agent" in body
    # **Was `assert "sk-ant" in body` until 2026-08-22, and the guard itself
    # was the vendor lock.** Its intent is right — a page that says "store
    # your key" without saying WHICH secret leaves a person guessing — but it
    # enforced that intent by pinning one company's key prefix, so the only
    # way to satisfy it was to tell every reader to go and get an Anthropic
    # key. The author's test convenience had become the user's constraint,
    # which is the charter's own failure mode.
    #
    # The intent, stated without a vendor: the page must say the secret is an
    # API key, say it belongs to a provider the reader CHOOSES, and point at
    # the matrix that lists them.
    flat = " ".join(body.split()).lower()
    assert "api key" in flat, "it never says which secret is actually wanted"
    assert "provider you choose" in flat, (
        "the page names a secret without saying it is the reader's choice of "
        "provider — which is how a front door acquires a default vendor"
    )
    assert "vendors.md" in body, (
        "the page asks for a provider's key and never points at the list of "
        "providers that have been measured"
    )
    # Field-run finding 2, and the fix CHANGED what this page has to say.
    #
    # Until 2026-08-21 the documented command had no `-U`, so on a machine
    # that had stored the key once it failed with "already exists" — and the
    # page's job was to warn the reader not to read that as failure. That
    # advice was wrong in a way nobody had measured: the newly typed key is
    # DISCARDED and the old one silently stays in use, so a reader who
    # followed it believed they had set a key and had not.
    #
    # Reproduced in an isolated keychain on 2026-08-21: second add without
    # `-U` exits 45 and the original value is still there; with `-U` it
    # updates, and it creates when nothing is there. So the command now
    # carries `-U`, and the page must explain WHY rather than tell a person
    # to shrug at an error.
    assert "-U` is not optional" in body, (
        "the page does not say why -U is required, so a reader who drops it "
        "loses the key they just typed and is told nothing"
    )
    assert "already exists" in body and "throws away" in body, (
        "the page never says what happens without -U"
    )


def test_the_examples_listing_names_every_example_that_exists():
    """A listing that goes stale is worse than none: a reader trusts it to be
    complete. Derived from `ALL_EXAMPLES`, which is itself checked against the
    shipped files above."""
    listed = (EXAMPLES / "README.md").read_text(encoding="utf-8")
    for name, _, _ in ALL_EXAMPLES:
        assert f"{name}/" in listed, (
            f"examples/{name} exists and examples/README.md does not mention it"
        )


@pytest.mark.parametrize("name", [name for name, _, _ in ALL_EXAMPLES])
def test_no_example_prd_names_a_source_file(name):
    """Rule 2 of the requirement guide, applied to the two documents it cites
    as evidence. A PRD naming a module is a product manager making an
    engineering decision, and these two are held up as how to avoid that.
    """
    import re

    prd = (EXAMPLES / name / "PRD.md").read_text(encoding="utf-8")
    offenders = re.findall(r"\b[\w/-]+\.(?:py|js|mjs|ts|json|html|yaml|toml)\b", prd)
    assert not offenders, (
        f"{name}/PRD.md names {sorted(set(offenders))} — the guide it is cited "
        f"in says a requirement names no files"
    )


def test_no_document_names_the_deprecated_acp_adapter():
    """**Shipped stale for a week, and a field run installed it.**

    `@zed-industries/claude-code-acp` was deprecated and renamed to
    `@agentclientprotocol/claude-agent-acp`; the engine's own
    `docs/MANUAL_CHECKS.md` recorded that on 2026-08-11. The name was copied
    into this package's front door anyway on 2026-08-18 and a product manager
    installed it on that instruction. The deprecated adapter answers an
    unauthenticated turn with an empty *result*, which a client cannot tell
    from a turn that simply did nothing — so the failure presented as a hang.

    Derived over every document and script here, not a spot check.
    """
    stale = "claude-code-acp"
    offenders = []
    for path in list(ROOT.rglob("*.md")) + list(ROOT.rglob("*.sh")):
        if ".engine" in path.parts or ".board" in path.parts:
            continue
        body = path.read_text(encoding="utf-8", errors="replace")
        if stale in body:
            offenders.append(str(path.relative_to(ROOT)))
    assert not offenders, (
        f"{offenders} name the deprecated adapter; it is "
        f"`claude-agent-acp` from `@agentclientprotocol/claude-agent-acp`"
    )


def test_the_front_door_warns_that_the_build_can_stall_silently():
    """The most serious thing a first-time reader can hit, and it is live.

    A page that sent somebody into a fifteen-minute silence without saying so
    would be repeating the exact failure the field run reported.
    """
    body = (ROOT / "START-HERE.md").read_text(encoding="utf-8").lower()
    assert "stall" in body, "the front door does not warn about the stall"
    assert "ctrl+c" in body, "it does not say what to do about it"
    assert "authenticate" in body, "it does not name the cause"


# --- the agent runbook, which R5 made the real front door --------------------


def agents_md() -> str:
    return (ROOT / "AGENTS.md").read_text(encoding="utf-8")


def test_the_agent_runbook_states_the_three_transport_laws_as_laws():
    """**R5's three laws, greppable, because each one was violated or nearly
    violated somewhere already:** paraphrase is the drift SPEC_BOARD ruling 1
    exists for; an agent that answers a confirm itself is the interlock
    laundered; and a key an agent has seen is a key in a transcript.
    """
    body = flattened(agents_md()).lower()
    assert "verbatim" in body, "law 1 (relay verbatim) is not stated"
    assert "never answers" in body, (
        "law 2 (a confirm is the human's — the agent never answers yes "
        "itself) is not stated"
    )
    assert "inline" in body, (
        "law 3 (the key is read inline by the run command; the agent never "
        "sees it) is not stated"
    )
    assert "security find-generic-password" in agents_md(), (
        "the runbook never shows the inline Keychain read the law requires"
    )


def test_the_agent_runbook_documents_the_protocol_the_code_implements():
    """The runbook says one object per line OUT and one line per answer IN —
    the contract `_ask`/`_read_line` really implement. An id-echo convention
    appeared in a docstring once with no reader behind it; the runbook may
    not repeat it."""
    body = flattened(agents_md()).lower()
    assert "one json object per line" in body
    assert "--emit json" in agents_md()
    assert "one line" in body, "how an answer goes back is never said"


def test_the_agent_runbook_and_the_questions_offer_the_same_documented_values():
    """**Finding 8: the endpoint question offered nothing to a person with no
    way to know.** The three setup questions now carry their documented
    example values IN the question text — and this pins the runbook and the
    questions to the SAME values, because two documents describing one fact
    is the drift this suite keeps refusing. The person still answers;
    nothing is defaulted silently."""
    runbook = agents_md()
    for question in run_module.SETUP_QUESTIONS:
        suggested = question.detail.get("suggested")
        assert suggested, f"{question.id} offers no documented value in its detail"
        # **A LIST, always — extended 2026-08-22 when the worker question grew
        # a second and third measured form.** One shape, so an agent reading
        # `detail` never has to tell a string from a list; and EVERY value is
        # held to both documents, not just the first, because a value the
        # runbook does not carry is a value the person cannot check.
        assert isinstance(suggested, list), (
            f"{question.id}'s `suggested` is {type(suggested).__name__}, not a "
            "list — the two shapes are how one of these questions quietly "
            "stops being held to the runbook"
        )
        for value in suggested:
            assert value in question.text, (
                f"{question.id} does not offer its documented value {value!r} "
                f"in the question text itself: {question.text!r}"
            )
            assert value in runbook, (
                f"{question.id}'s documented value {value!r} is not one "
                f"AGENTS.md documents"
            )


def test_the_worker_question_offers_MORE_THAN_ONE_VENDORS_AGENT():
    """**The charter, at the one question where it is decided.**

    A person meets exactly one moment where the tool could imply which
    company's agent it is for, and this is it. One offered command reads as
    THE command. The guard is deliberately about COUNT and about DISTINCT
    vendors rather than about particular strings, so it keeps holding as the
    roster changes.
    """
    worker = next(
        q for q in run_module.SETUP_QUESTIONS if q.detail["key"] == "worker"
    )
    offered = worker.detail["suggested"]
    assert len(offered) >= 2, (
        f"the worker question offers one command, {offered!r} — which reads "
        "as the command a person is supposed to use"
    )
    # Distinct first words: three spellings of one vendor's binary would
    # satisfy a count and satisfy nothing else.
    binaries = {value.replace("acp:", "").strip().split()[0] for value in offered}
    assert len(binaries) >= 2, (
        f"every offered worker command starts the same binary: {binaries}"
    )
    text = " ".join(worker.text.split())
    assert "any agent you can start from a terminal" in text.lower(), (
        "the question never states the structural fact that makes the offers "
        f"examples rather than a menu: {worker.text!r}"
    )


def test_the_endpoint_question_says_where_the_key_goes():
    """R5.4: the key is sent to whatever URL is entered, said AT the question
    — the one moment the person is choosing the URL."""
    endpoint = next(
        q for q in run_module.SETUP_QUESTIONS if q.detail["key"] == "endpoint"
    )
    text = " ".join(endpoint.text.split()).lower()
    assert "key" in text and "whatever" in text, (
        "the endpoint question never says the key goes to the URL entered: "
        f"{endpoint.text!r}"
    )


def test_start_here_is_one_screen_and_hands_everything_else_to_the_agent():
    """**R5.1: two acts — paste one block into your agent, store your key.**
    A page a PM must scroll through is a page they will half-read; the PhD
    stays in AGENTS.md, where the reader is software. Fifty-five lines is a
    screen with room to breathe; the old page was three times that."""
    body = (ROOT / "START-HERE.md").read_text(encoding="utf-8")
    assert len(body.splitlines()) <= 55, (
        f"START-HERE.md is {len(body.splitlines())} lines — no longer one "
        "screen; the detail belongs in AGENTS.md"
    )
    assert "AGENTS.md" in body, "the paste block never points the agent at it"
    assert "add-generic-password" in body, "the key act is missing"


# --- the runbook's own commands, executed ----------------------------------
#
# **`bf44aed` fixed a runbook command that 404s on the example's own layout.**
# The document said `PRD.md` where the example puts it one level up, and no
# test could see it because a doc that only a real run falsifies is a doc
# nothing checks. This is the permanent guard for that class.


def _fenced_shell_commands(body: str) -> list[str]:
    """Every command inside a ```bash / ```sh fence in the runbook."""
    found, inside = [], False
    for line in body.splitlines():
        if line.strip().startswith("```"):
            inside = line.strip().lstrip("`").strip() in ("bash", "sh", "shell")
            continue
        if inside and line.strip() and not line.strip().startswith("#"):
            found.append(line.strip())
    return found


def test_every_path_the_runbook_names_exists_in_this_repository():
    """The `../PRD.md` class of defect: a path in a command that is simply
    not there. Checked against the tree rather than against the sentence."""
    missing = []
    for command in _fenced_shell_commands(agents_md()):
        for token in command.split():
            if token.startswith(("~", "-", "$", "|", "&")) or "=" in token:
                continue
            if "/" in token and not token.startswith(("http", "@")):
                candidate = token.strip("'\"")
                # Only paths the runbook claims live HERE.
                if candidate.startswith(("wringer-drive/", "examples/", "docs/")):
                    if not (ROOT / candidate.split("wringer-drive/")[-1]).exists():
                        missing.append((command, candidate))
    assert not missing, (
        f"AGENTS.md names paths this repository does not have: {missing}. A "
        "runbook only a real run can falsify is a runbook nothing checks"
    )


def test_the_runbook_names_the_example_PRD_where_the_example_puts_it():
    """The exact defect `bf44aed` fixed, pinned so it cannot come back.

    The worked example's setup places the document one level ABOVE the
    project, so the drive command must name `../PRD.md`. A runbook that says
    `PRD.md` sends the agent at a file that is not there — and the person
    watching sees the tool fail on its own instructions."""
    for example in ("arcade", "pipeline"):
        target = ROOT / "examples" / example
        if not target.is_dir():
            continue
        assert (target / "PRD.md").is_file(), (
            f"examples/{example}/PRD.md is gone — the runbook's `../PRD.md` "
            "would now be wrong in the other direction"
        )
        assert (target / "project").is_dir(), (
            f"examples/{example}/project is gone, so `--repo .` no longer "
            "means what the runbook says"
        )

    body = agents_md()
    assert "../PRD.md" in body, (
        "the runbook stopped saying `../PRD.md`. The example puts the "
        "document one level above the project; `PRD.md` 404s there, which is "
        "what bf44aed fixed"
    )


def test_the_runbook_only_names_verbs_the_tools_actually_have():
    """A runbook naming a verb that does not exist is a runbook that fails on
    its first instruction. Checked against the real CLIs.

    **Extracted from the document, never from a list kept here.** The first
    version of this guard checked a hardcoded tuple of verbs, so renaming one
    in the runbook to something that does not exist slipped straight through:
    the fake verb was not in the list, and the real verb was no longer in the
    document, so nothing was checked either way. A guard that only sees what
    it already expects cannot catch the thing it exists for.
    """
    import re
    import subprocess
    import sys

    body = agents_md()
    for module, command in (
        ("wringer_board", "wringer-board"),
        ("wringer_drive", "wringer-drive"),
    ):
        # Anchored to COMMAND POSITION — start of a line, optionally indented.
        # A loose `\b...\s+` spanned newlines, so `--with-editable
        # ./wringer-board` followed by the next line's `uv` read as the verb
        # `uv`. It must match where a command is typed, not wherever the name
        # appears in prose or in a path.
        named = set(
            re.findall(
                rf"^[ \t]*{re.escape(command)}[ \t]+([a-z][a-z-]*)",
                body,
                re.MULTILINE,
            )
        )
        if not named:
            continue
        listed = subprocess.run(
            [sys.executable, "-m", module, "--help"],
            capture_output=True,
            text=True,
            check=False,
        ).stdout
        for verb in sorted(named):
            assert verb in listed, (
                f"AGENTS.md tells the agent to run `{command} {verb}`, and "
                f"{command} has no such verb. Its verbs are in the --help "
                "above; a runbook that names one that does not exist fails on "
                "its own first instruction"
            )


def test_the_capture_harness_never_reports_emptiness_SILENTLY():
    """**A tool used to check for silence must not be silent itself.**

    `tools/acp_model_agent.py` is the model-backed ACP worker that produced
    the measurements the PM-plan work rests on. It had three paths that
    returned an empty file list without a word — no JSON in the reply, no
    `files` key, and entries dropped for having no `path` — and downstream an
    empty list is indistinguishable from a worker that looked and found
    nothing to change, which is what `no_progress` means.

    So it carried the exact silent-emptiness class that this programme spent
    a window removing from the engine, in the harness used to measure it."""
    import ast

    harness = (
        Path(__file__).resolve().parent.parent.parent / "tools" / "acp_model_agent.py"
    )
    source = harness.read_text(encoding="utf-8")
    tree = ast.parse(source)

    def says_something(statement: ast.stmt) -> bool:
        call = getattr(statement, "value", None)
        return (
            isinstance(statement, ast.Expr)
            and isinstance(call, ast.Call)
            and isinstance(call.func, ast.Name)
            and call.func.id == "print"
            and any(
                kw.arg == "file" and "stderr" in (ast.unparse(kw.value))
                for kw in call.keywords
            )
        )

    # **Checked on the RETURN's own block, not on the enclosing function.**
    # The first version searched the whole function's source for a stderr
    # print, so once ONE branch explained itself the others could stay silent
    # — and reverting a branch to a bare `return []` left this green. A guard
    # whose subject is a particular statement must look at that statement.
    bare = []
    for node in ast.walk(tree):
        for field in ("body", "orelse", "finalbody"):
            block = getattr(node, field, None)
            if not isinstance(block, list):
                continue
            for index, statement in enumerate(block):
                if not isinstance(statement, ast.Return):
                    continue
                value = statement.value
                if not (isinstance(value, ast.List) and not value.elts):
                    continue
                before = block[index - 1] if index else None
                if before is None or not says_something(before):
                    bare.append(f"line {statement.lineno}")
    assert not bare, (
        f"these return an empty list with nothing said: {bare}. Downstream "
        "that is indistinguishable from 'the worker found nothing to change'"
    )


# --- what this page may not promise about authentication or about stdin -----
#
# Both guards below exist because this page told a product manager something
# that was not true, and they went and did it. Prose is the product here: an
# agent reads these words and relays them to a person as instructions.


def drive_agents_md() -> str:
    return (REPO / "AGENTS.md").read_text(encoding="utf-8")


def test_the_page_states_what_the_AUTH_REMEDY_COST_AND_LIMIT_are():
    """**Field report 2026-08-22 finding 6, RE-DERIVED 2026-08-22 after the
    turn was finally run.**

    The shape of this guard has now been wrong twice, in opposite directions,
    and both times because prose ran ahead of a measurement.

    First the page offered `run.worker.acp.env_passthrough` as the answer to a
    builder that could not authenticate, with nothing said about what it
    spends. Then — correcting that — it went further than the evidence and
    said in bold that passing `ANTHROPIC_API_KEY` *does not work*, reasoning
    from `createEnvForProvider` blanking the variable without noticing that
    the function returns `{}` before it blanks anything when no provider is
    configured, which is Wringer's case every time.

    `scripts/acp-auth-probe.py --prompt` settled it by execution: with the key
    passed through, `session/prompt` returns `stopReason: end_turn`; with
    nothing passed through, `-32000 Authentication required`.

    So what this guard pins is neither "offer it" nor "forbid it". It is the
    two things a person needs before they act on it — that it SPENDS, and
    that a free check exists — plus the refusal to re-assert, in the page's
    own voice, the sentence execution killed. The verbatim old claim lives on
    in a `>` block, which `own_voice` strips, so quoting history stays legal
    and repeating it as advice does not.
    """
    body = flattened(own_voice(drive_agents_md()))

    assert "ANTHROPIC_API_KEY" in body, (
        "the page no longer mentions the variable at all, so this guard is "
        "checking nothing. If the section was rewritten, re-derive it against "
        "whatever it says now — do not delete it"
    )
    assert "spends against that key" in body, (
        "the page offers ANTHROPIC_API_KEY as the way to authenticate the "
        "builder without saying that every worker turn then bills to it. A "
        "remedy whose cost is unstated is how the last two versions of this "
        "section went wrong"
    )
    assert "auth status" in body, (
        "the page names the remedy but not the free check that says whether "
        "it is needed. `claude-agent-acp --cli auth status` costs nothing and "
        "answers in machine form; a page that omits it sends people to spend "
        "drafting money to discover an unauthenticated builder"
    )
    assert "Presence is not validity" in body, (
        "the free check is offered without its limit. A revoked key and a "
        "lapsed subscription both report loggedIn true and both die at the "
        "turn — a check sold as proof is worse than no check"
    )
    # The claim execution killed. Quoting it under `>` is history and is
    # stripped by `own_voice`; asserting it again in the page's own voice is
    # the regression.
    for killed in (
        "It does not work",
        "cannot authenticate anything",
        "never reads ANTHROPIC_API_KEY",
    ):
        assert killed not in body, (
            f"the page asserts {killed!r} in its own voice again. That was "
            "measured false on 2026-08-22 — see docs/auth-probe-2026-08-22.md"
        )


def test_the_stdin_bullet_does_not_promise_more_than_the_drain_does():
    """**Field report 2026-08-22 finding 8 — the half that was UNEXPLAINED.**

    The bullet read: *"Anything written before a question was asked is stale
    by design and is discarded unread — that is the interlock protecting the
    person from leftover text answering an approval."* A careful evaluator
    read that as a guarantee, watched a queued line reach an `approve`
    confirm, and reported the protection as documented but not implemented.

    It IS implemented. Measured both directions against a real subprocess
    pipe: text queued before the confirm rendered is drained and reported in a
    `stale-input-discarded` step; text written after it rendered is read as
    the answer, because no transport can distinguish that from a person
    typing. `test_an_answer_written_after_the_question_renders_is_never_drained`
    pins the second half deliberately — it is a property, not a gap.

    What was wrong was the promise. The bullet had to gain the answer window,
    because a reader who believes the drain is a safety net has no reason to
    obey the rule that actually protects them.
    """
    body = flattened(own_voice(drive_agents_md()))

    assert "Never queue answers ahead" in body, (
        "law 2's rule for this transport is gone from the page, and it is the "
        "only thing that actually protects the person"
    )
    assert "answer window" in body, (
        "the stdin bullet does not name the window in which text IS taken as "
        "an answer. Without it the drain reads as total protection, which is "
        "the reading that produced finding 8"
    )
    assert "cannot prove intent" in body or "cannot tell it apart" in body, (
        "the page does not say that the machine cannot tell a queued line "
        "from a typed one. That is the whole reason the burden is the "
        "agent's, and it is why this is a law and not a feature"
    )


def test_the_PASTE_BLOCK_points_at_THIS_repositorys_current_runbook():
    """**Found by the bug hunt, 2026-08-22, and it would have broken run 5.**

    The paste block is the single thing a product manager hands their agent.
    It pointed at

        raw.githubusercontent.com/marcoakes/wringer-drive/main/AGENTS.md

    which is the PRE-MERGE repository. That URL still returns HTTP 200 — so
    nothing looked broken — and it serves a runbook 7KB behind this one,
    missing the auth remedy, the vendor worker forms, the multi-value
    suggestions and every key-wording change of the last three windows. A PM
    following the front door would have been driven by a stale runbook while
    every page here said otherwise.

    It is the round-3 lesson in a new place: *what the evaluator installs is
    not what the author is looking at.* There it was unpushed commits; here it
    is a URL nobody re-derived after the packages merged.

    **Derived, not pinned.** The URL must name the path AGENTS.md actually
    occupies in this tree, so moving the file again fails here instead of
    silently serving the old copy. Checked offline — the live fetch is
    `docs/MANUAL_CHECKS.md`, because this suite opens no sockets.
    """
    body = (ROOT / "START-HERE.md").read_text(encoding="utf-8")
    here = (ROOT / "AGENTS.md").resolve()
    repo_root = ROOT.parents[1]
    relative = here.relative_to(repo_root).as_posix()

    urls = [
        word.strip().rstrip(".,)")
        for word in body.split()
        if "raw.githubusercontent.com" in word
    ]
    assert urls, "the paste block fetches nothing at all"
    for url in urls:
        assert url.endswith(relative), (
            f"the paste block fetches {url}, and this repository's runbook "
            f"lives at {relative}. A URL that 200s from somewhere else is "
            "worse than one that 404s: nothing looks wrong and the person is "
            "driven by a stale runbook"
        )
        assert "/marcoakes/wringer/" in url, (
            f"the paste block fetches from another repository: {url}. The "
            "packages merged into this one — wringer-drive is not published "
            "or pushed to any more"
        )


def test_the_runbook_links_NOTHING_a_reader_fetching_it_RAW_cannot_resolve():
    """AGENTS.md is FETCHED, not browsed.

    The agent reads it from `raw.githubusercontent.com`, where a relative
    markdown link resolves against that host and 404s. Every location this
    document hands an agent has to be absolute — the same defect class as the
    paste block above, one level down.
    """
    import re

    body = agents_md()
    relative = re.findall(r"\]\((?!https?://|#)([^)]+)\)", body)
    # Sibling files the agent is TOLD to open locally after cloning nothing —
    # `docs/ENDINGS.md` and friends live beside this file in the same fetch
    # tree and are named as paths on purpose. What may not appear is a link
    # climbing OUT of that directory, which is what `../` does.
    climbing = [link for link in relative if link.startswith("..")]
    assert not climbing, (
        f"the runbook links {climbing}, which resolve against "
        "raw.githubusercontent.com when an agent fetches this file and 404 "
        "there. Use the full https:// URL"
    )
