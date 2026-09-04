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
from core_helpers import reader_facing_pages, repo_root

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
        run_module,
        "deliver",
        lambda repo, *, answered_yes: {
            "sent": answered_yes,
            "delivery_dir": ".wringer/deliveries/20260901-120000-abcd",
        },
    )

    code, steps = drive(
        project, tmp_path, "The ones on screen.\nyes\nyes\ndeliver\nyes\n",
        monkeypatch
    )
    capsys.readouterr()

    assert code == 0, f"a converged run should exit 0, got {code}"
    ids = [step.id for step in steps]
    assert "board" in ids, f"a converged run never announced the board: {ids}"
    assert ids[-1] == "done", f"a converged run ended on {ids[-1]!r}: {ids}"
    assert (project / run_module.BOARD_FILENAME).is_file()
    # 0.6.5: the orchestrator threads the delivery's own record into the done
    # step, so the falsify command the human console prints reaches the drive
    # lane too — with the REAL id, from the payload it used to throw away.
    assert (
        "wring verify --falsify --delivery 20260901-120000-abcd"
        in steps[-1].text
    ), steps[-1].text


def test_both_endings_render_the_board_in_the_orchestrator_itself():
    """The structural half, and it is what stops a refactor from removing one
    branch while the other stays green.

    `__main__._drive` — the ONE step sequence `run` and `resume` share since
    0.7.1; it was `_run` before — renders the board on the refused branch
    (inside the `except run_module.Stop`) and on the converged one (after
    it). Both call sites are read out of the source with `ast`, so deleting
    either reddens this even if a live test happens not to reach that path.

    *Amended 2026-09-03 (0.8.6):* both moments now go through
    `__main__._show_board`, the helper that renders, emits and opens the
    page, so a call to it counts as rendering — and the helper is read too,
    because a helper that stopped calling `render_board` would otherwise
    satisfy this by name alone.
    """
    source = (SRC / "__main__.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    run_fn = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "_drive"
    )
    show_fn = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "_show_board"
    )
    assert any(
        isinstance(call, ast.Call)
        and getattr(call.func, "attr", None) == "render_board"
        for call in ast.walk(show_fn)
    ), "`_show_board` no longer renders the board, so calling it proves nothing"

    handlers = [n for n in ast.walk(run_fn) if isinstance(n, ast.ExceptHandler)]
    assert handlers, "`_drive` no longer catches a Stop around delivery"

    def _is_render(call) -> bool:
        return isinstance(call, ast.Call) and (
            getattr(call.func, "attr", None) == "render_board"
            or getattr(call.func, "id", None) == "_show_board"
        )

    def renders_board(node) -> bool:
        return any(_is_render(call) for call in ast.walk(node))

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
        if _is_render(call) and call.lineno not in handler_lines
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
def test_the_front_door_OPENS_with_no_coding_agent_anywhere(name, tmp_path):
    """**Run 3 F1, EXECUTED rather than read — and it INVERTS the guard that
    stood here.**

    Until 0.6.4 both scripts hard-stopped when `claude-agent-acp` was not on
    PATH: a vendor's agent was a precondition of the vendor-neutral product's
    own front door, and run 3's operator — Codex only, deliberately — met a
    wall telling them to install a competitor's tool. The 2026-08-21 finding
    the old check fixed (saying "Ready" and THEN recommending a missing
    agent) is closed differently now: the epilogue recommends no agent at
    all, and the worker contract (0.6.0) validates whatever agent the person
    answers with after selection, before anything is spent.

    So the law executed here: with everything the script needs on PATH and
    NO coding agent anywhere, setup completes, says Ready, and its epilogue
    names no vendor's worker — it points at the measured recipes instead.
    """
    import os
    import shutil
    import subprocess
    import sys

    script = EXAMPLES / name / "setup.sh"
    # Everything the script legitimately needs, and nothing else — the
    # stripped PATH is what makes "no agent anywhere" a fact of the run
    # rather than an assumption about this machine.
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    needed = (
        "git", "node", "npm", "sh", "env", "chmod",
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
        "pass on a script that never runs"
    )
    # `uv` is a STUB, not the real tool: the real one would reach for PyPI
    # to install pytest and ruff, and this suite is offline by construction.
    # The stub makes `.venv/bin/python` this suite's own interpreter — which
    # carries both — so every later line of the script (the seeded suite
    # green, ruff clean, acceptance red) still executes for real. The real
    # `uv` route is what a person runs, and run 4's clean machine is the
    # named measurement of it.
    # An exec shim, not a symlink: a symlink into another venv defeats
    # CPython's pyvenv.cfg discovery and lands on the bare base interpreter,
    # measured while writing this ("No module named pytest").
    (bin_dir / "uv").write_text(
        "#!/bin/sh\n"
        'if [ "$1" = venv ]; then\n'
        "  mkdir -p .venv/bin\n"
        "  cat > .venv/bin/python <<SHIM\n"
        "#!/bin/sh\n"
        f'exec "{sys.executable}" "\\$@"\n'
        "SHIM\n"
        "  chmod +x .venv/bin/python\n"
        "  exit 0\n"
        "fi\n"
        'if [ "$1" = pip ]; then exit 0; fi\n'
        "exit 1\n",
        encoding="utf-8",
    )
    (bin_dir / "uv").chmod(0o755)
    # No agent anywhere is the condition under test — assert it rather than
    # assuming the stripped PATH did it.
    assert shutil.which("claude-agent-acp", path=str(bin_dir)) is None

    done = subprocess.run(
        ["sh", str(script), str(tmp_path / "target")],
        capture_output=True,
        text=True,
        check=False,
        env={**os.environ, "PATH": str(bin_dir)},
    )
    printed = done.stdout + done.stderr

    # The wrong-reason-red rationale, kept from the guard this replaces (the
    # CI red of 2026-08-22): a machine missing one of the script's OWN
    # prerequisites never reaches the behaviour under test, and a red about
    # THAT would be a tick that is not evidence. The script's own message is
    # the detector, so a machine without `node` can still measure `pipeline`.
    if "and this needs it." in printed:
        pytest.skip(
            f"{name}'s setup.sh stopped on its own prerequisite check "
            f"({', '.join(missing) or 'unknown tool'} absent from this "
            f"machine), so it never reached the behaviour under test"
        )

    assert done.returncode == 0, (
        f"{name}'s setup.sh failed with no coding agent installed — the "
        f"front door still has a vendor's tool as a precondition:\n{printed}"
    )
    assert "Ready" in done.stdout, (
        f"{name}'s setup.sh completed but never said Ready:\n{printed}"
    )
    assert "claude-agent-acp" not in printed, (
        f"{name}'s setup.sh still names a vendor's agent — the neutral front "
        "door recommends none and points at the measured recipes"
    )
    assert "docs/vendors.md" in done.stdout, (
        f"{name}'s epilogue does not point at the measured per-vendor "
        "recipes, so the person has nowhere to take the worker question"
    )
    # BOTH Keychain commands pinned individually: run 6's rerun lost a
    # stored key to two surfaces naming two services, and one epilogue
    # carrying a diverged pair is the same defect with a shorter walk.
    assert "find-generic-password -s <vendor>-api-key" in done.stdout, (
        f"{name}'s reading command left the one Keychain convention"
    )
    assert "add-generic-password -U -s <vendor>-api-key" in done.stdout, (
        f"{name}'s storing command left the one Keychain convention"
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
    # Run 3 P1.3, where credentials LIVE: the person holding a key learns
    # HERE that it can displace a stored login (measured 2026-08-27; the
    # precedence fact's home stays drive/AGENTS.md, which the script points
    # at — this is the pointer's summary, not a second home).
    assert "DISPLACE" in script and "take precedence" in script, (
        f"{name}'s setup.sh no longer says an environment key can displace "
        "a stored login — the reader with the key never learns precedence"
    )
    assert "docs/drive/AGENTS.md" in script, (
        f"{name}'s setup.sh does not point at the one page where the "
        "credential story is written down"
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


def test_the_acceptance_posture_is_EXACTLY_the_one_the_riders_pinned(tmp_path):
    """**Run 3's code-review riders, held against the seeded source.**

    "Red overall" is too coarse to protect the riders: the acceptance file
    fails with the seeded `SKIPPED` export deleted, with the constructor's
    invariants gone, and with the report no longer deriving the cause from
    `blocked_by` — an import error fails everything, and 'red' stays red.
    So the EXACT posture is pinned: the seven behaviour specs are red
    because the feature is unbuilt, and the seven conventions the riders
    seeded (the exported vocabulary, the refused illegal states, the derived
    rendering, exactly-once, the run outcome) hold against the shipped tree.
    A rider reverted moves a name across this line, and that is the red.
    """
    import shutil
    import subprocess
    import sys

    project = tmp_path / "project"
    shutil.copytree(EXAMPLE / "project", project)
    done = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "--tb=no",
         "acceptance/test_skip_downstream.py"],
        cwd=project, capture_output=True, text=True, check=False,
    )
    failed = {
        line.split("::", 1)[1].split(" ")[0].strip()
        for line in done.stdout.splitlines()
        if line.startswith("FAILED ")
    }
    assert failed == {
        "test_a_job_that_depends_on_a_failure_is_not_attempted",
        "test_skipping_carries_all_the_way_down_the_chain",
        "test_the_summary_names_each_skipped_job_and_the_failure_that_caused_it",
        "test_a_deeper_chain_is_blamed_on_the_nearest_failure",
        "test_two_failed_roots_converging_through_skips_blame_both_once",
        "test_the_command_line_still_exits_non_zero_and_does_not_crash",
        "test_the_real_process_skips_too",
    }, (failed, done.stdout[-1500:])
    assert "7 failed, 7 passed" in done.stdout, done.stdout[-300:]
    # Rider 1's other half: the vocabulary is PACKAGE API, not a private
    # name a consumer happens to reach — `__all__` is where that promise is
    # written, and the acceptance file importing from `pipeline.runner`
    # cannot see it.
    exported = subprocess.run(
        [sys.executable, "-c",
         "import pipeline; assert 'SKIPPED' in pipeline.__all__"],
        cwd=project, capture_output=True, text=True, check=False,
        env={"PYTHONPATH": "src", "PATH": "/usr/bin:/bin"},
    )
    assert exported.returncode == 0, (
        "pipeline.__all__ no longer exports SKIPPED beside OK and FAILED:\n"
        + exported.stderr
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

    Derived over every document and script here, not a spot check — and the
    NAMES are derived too, from `agents.SUPERSEDED_COMMANDS`, since 2026-08-25.
    They used to be a copy typed into this file, which is the same
    hand-kept-list defect one layer down: a rename recorded in one place and
    re-typed in another is exactly how the original week of staleness
    happened. The engine's config check reads that same mapping, so a document
    and a warning cannot disagree about which name is dead.
    """
    agents = pytest.importorskip("wringer.agents")
    assert agents.SUPERSEDED_COMMANDS, (
        "the mapping this guard derives from is empty, so it is watching "
        "nothing"
    )
    offenders: dict[str, list[str]] = {}
    for path in list(ROOT.rglob("*.md")) + list(ROOT.rglob("*.sh")):
        if ".engine" in path.parts or ".board" in path.parts:
            continue
        body = path.read_text(encoding="utf-8", errors="replace")
        found = sorted(
            stale for stale in agents.SUPERSEDED_COMMANDS if stale in body
        )
        if found:
            offenders[str(path.relative_to(ROOT))] = found
    assert not offenders, (
        f"{offenders} name a deprecated adapter; the current names are "
        f"{sorted(set(agents.SUPERSEDED_COMMANDS.values()))}"
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


def _clone_of_this_repository(url: str) -> bool:
    """Whether a `git clone` URL names THIS repository.

    Derived from the remote rather than from a literal, so a rename moves the
    check with the project. Falls back to the name of the repository
    directory, which is what a fresh clone with no remote has.
    """
    import subprocess

    remote = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=ROOT, capture_output=True, text=True, check=False,
    ).stdout.strip()
    slug = remote.removesuffix(".git").rsplit("/", 1)[-1] if remote else ROOT.name
    return url.removesuffix(".git").rsplit("/", 1)[-1] == slug


def test_EVERY_cd_AND_sh_TARGET_COMES_FROM_A_PRIOR_STEP():
    """**Field report 2026-08-26, finding 4 — and it is the cheapest kind of
    unfollowable.**

    Step 2 is emphatic that the three-repo era is over: *"There is nothing to
    clone and nothing to chain."* Step 6 then said

        cd wringer-drive/examples/pipeline
        sh setup.sh ~/wringer-example

    After `uv tool install wringer` there is no `wringer-drive/` anywhere, and
    the installed distribution ships no `examples/`. A first-time reader
    following the runbook exactly stops at the step where a non-engineer has
    nothing to fall back on. The field run only got past it because a source
    clone from three weeks earlier happened to be on the machine.

    `test_every_path_the_runbook_names_exists_in_this_repository` was green
    throughout: it strips a `wringer-drive/` prefix and checks the remainder
    against THIS tree, which is a fact about the repository and not about the
    reader's machine. This guard asks the reader's question instead — **does
    every directory this page walks into get created by one of this page's own
    earlier steps?** — and it walks the commands in document order, carrying a
    working directory, the way somebody typing them would.

    Two escapes, both narrow and both deliberate: a target rooted at `~`, `/`
    or a variable is a place the person chose, and a `<placeholder>` is not a
    path at all. Everything else has to be produced.

    **Amended 2026-08-27, after the defect class shipped a THIRD time with
    this guard green on it** (field report 2026-08-27, finding 3). The page
    said `cd ~/wringer-source/examples/pipeline`; the example lives at
    `docs/drive/examples/pipeline`. This guard walked that step and stayed
    green, because its clone mapping resolved against `ROOT` — `docs/drive/`,
    the documents' home INSIDE the checkout — while the page's own clone
    command creates the checkout itself. In `ROOT`'s coordinate system
    `examples/pipeline` exists (it is the example's real home), so the wrong
    path in the document resolved to the right directory in the guard's
    model: the document and the guard dropped the same `docs/drive/` prefix
    from opposite ends, and the errors cancelled. The guard was green not
    despite the defect but because it SHARED it. Worse in the field than the
    2026-08-26 form: `examples/` does exist at a real clone's top, without
    the example in it, so an operator gets a folder that looks right instead
    of a clean failure. Every path a clone produces is now resolved against
    `repo_root()` — the layout `git clone` actually creates.
    """
    import posixpath

    # What the page has created so far, mapped to the directory in THIS
    # repository it corresponds to — or None where the guard cannot see
    # inside (an unrelated clone, a bare `mkdir`). A clone of this repository
    # maps to `"."` — the top of the CHECKOUT, anchored at `repo_root()`
    # below, never at `ROOT`: `ROOT` is `docs/drive/`, and resolving a
    # clone's paths there is the 2026-08-27 amendment's whole story.
    produced: dict[str, str | None] = {}
    cwd: tuple[str, str | None] | None = None
    unfollowable: list[str] = []
    #: Every target this guard actually decided about. A walker that silently
    #: found nothing to walk is a green that means "the parser broke", and
    #: this file has already shipped one guard that only saw what it expected.
    walked: list[str] = []

    def resolve(target: str) -> tuple[str, str | None] | None | bool:
        """(prefix, repo-relative path) for a target, None for the person's
        own place, or False when nothing on this page created it."""
        target = target.strip("'\"")
        # **Produced first, and the order is the whole of it.** A clone
        # destination is usually written `~/somewhere`, so testing the `~`
        # escape before the produced set would throw away the one fact this
        # guard exists to follow — and `sh setup.sh` two lines later would
        # then be unverifiable for the good reason instead of the bad one.
        for prefix in sorted(produced, key=len, reverse=True):
            if target == prefix or target.startswith(prefix + "/"):
                inside = produced[prefix]
                rest = target[len(prefix):].lstrip("/")
                if inside is None:
                    return (prefix, None)
                return (prefix, posixpath.normpath(posixpath.join(inside, rest)))
        if target.startswith(("~", "/", "$")) or "<" in target:
            return None
        return False

    for command in _fenced_shell_commands(agents_md()):
        words = command.split()
        if not words:
            continue
        if words[0] == "git" and len(words) > 2 and words[1] == "clone":
            arguments = [w for w in words[2:] if not w.startswith("-")]
            url = arguments[0]
            destination = (
                arguments[1] if len(arguments) > 1
                else url.removesuffix(".git").rsplit("/", 1)[-1]
            )
            produced[destination.strip("'\"")] = (
                "." if _clone_of_this_repository(url) else None
            )
            continue
        if words[0] == "mkdir":
            for made in (w for w in words[1:] if not w.startswith("-")):
                produced.setdefault(made.strip("'\""), None)
            continue
        if words[0] == "cd" and len(words) > 1:
            walked.append(command)
            where = resolve(words[1])
            if where is False:
                unfollowable.append(
                    f"`{command}` — nothing earlier on this page creates "
                    f"`{words[1].split('/')[0]}`"
                )
                cwd = None
                continue
            if where is not None and where[1] is not None:
                if not (repo_root() / where[1]).is_dir():
                    unfollowable.append(
                        f"`{command}` — a fresh clone has no "
                        f"`{where[1]}` directory, so the clone the reader "
                        "was told to make does not contain it"
                    )
            cwd = where
            continue
        if words[0] in ("sh", "bash") and len(words) > 1:
            script = words[1].strip("'\"")
            if "<" in script:
                continue
            walked.append(command)
            if "/" in script or script.startswith(("~", "/", "$")):
                continue
            if cwd is None or cwd[1] is None:
                unfollowable.append(
                    f"`{command}` — run in a directory this page never "
                    "established, so there is no telling whether the script "
                    "is there"
                )
                continue
            if not (repo_root() / cwd[1] / script).is_file():
                unfollowable.append(
                    f"`{command}` — a fresh clone has no "
                    f"`{cwd[1]}/{script}`"
                )

    assert not unfollowable, (
        "AGENTS.md tells a reader to walk into somewhere its own earlier "
        "steps never make:\n" + "\n".join(f"  {row}" for row in unfollowable)
        + "\n\nA runbook is followable or it is decoration. This is the step "
        "where a non-engineer has nothing to fall back on."
    )
    assert walked, (
        "this guard walked no `cd` or `sh` at all, so its green says the "
        "command parser found nothing — not that the runbook is followable"
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
    # **Field report 2026-08-25, finding 4.** The limit above was true and
    # understated. On a machine whose managed settings pin the coding agent to
    # an organisation login, the key is what breaks the run, and the free
    # check reports `loggedIn: true, authMethod: api_key` the whole time it is
    # breaking it — so presence is not merely unproven, it is the cause.
    # Case-insensitive: the page emphasises the word in capitals and pinning
    # its typography would make this a guard about shouting.
    assert "worse than" in body.lower(), (
        "the page states the free check's limit as 'presence is not validity' "
        "and stops there. On an org-pinned machine presence is WORSE than "
        "absence, and a reader acting on the softer sentence adds the key"
    )
    assert "managed settings" in body, (
        "the page does not name the machine class where the remedy it offers "
        "is the cause of the failure"
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


def test_the_page_warns_about_READING_LATE_and_not_only_WRITING_EARLY():
    """**Field report 2026-08-26, the transport note — not a product defect,
    and the page is still where it belongs.**

    A driving agent's polling loop recomputed "steps seen so far" at the start
    of each check, so a step that arrived between two checks was counted as
    already-seen and never relayed. The person lost an interview question, the
    run blocked on stdin for about twenty minutes, and it presented as a hang.
    `resume.json` had `last_question` right throughout, which is what proved
    the fault was the transport's.

    The page had a whole paragraph about writing an answer too early and not
    one sentence about reading a step too late — and only one of those two has
    ever been hit twice. Both are the transport's burden, so both are here.
    """
    body = flattened(own_voice(drive_agents_md()))

    assert "Never queue answers ahead" in body, (
        "the writing-side rule is gone, so the pair this guard checks is "
        "half missing"
    )
    assert "cursor" in body.lower(), (
        "the page warns about writing too early and says nothing about "
        "reading too late. A step that is never relayed is a question the "
        "person never sees"
    )
    assert "recompute" in body.lower() or "recomputed" in body.lower(), (
        "the page names a cursor without naming the thing it replaces — a "
        "count sampled at read time, which is the shape that actually lost a "
        "question"
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


def test_the_pm_page_scope_is_wider_than_the_five_names_it_replaced():
    """**Found by sweeping this window's own change, 2026-08-23.**

    `pm_pages()` replaced five hand-written names and reverting it to them
    reddened nothing, so the derivation was itself unevidenced.

    `README.md` is named because it is the specific page the tuple missed —
    the package's own front page, outside both guards below until the day
    this scope was derived.
    """
    scope = set(pm_pages())
    assert {"START-HERE.md", "AGENTS.md", "examples/README.md"} <= scope
    assert "README.md" in scope, (
        "docs/drive/README.md is outside the PM guards again — it is the "
        "package's front page and the tuple never listed it"
    )
    assert len(scope) > 8, (
        f"only {len(scope)} PM pages discovered; the tuple had five"
    )


@pytest.mark.parametrize("name", [row[0] for row in ALL_EXAMPLES])
def test_the_driving_section_restates_every_EXPORT_the_epilogue_prints(name):
    """**Field report 2026-08-25, finding 7 — and it is the second run it bit.**

    The example's `setup.sh` epilogue tells a person at a terminal to put the
    project's own virtualenv on `PATH`. `AGENTS.md` says the epilogue's steps
    are the driving agent's to perform on this path, and then restates the key
    and the drive command and not that line. Without it every gate fails with
    `ruff: command not found` / `pytest: command not found`, the loop hands a
    worker an environment problem no worker can fix, and the run dies for a
    reason with nothing to do with the work.

    **Derived from the script, not from a memory of it.** The last version of
    this relationship was three sentences a person kept in step by hand, which
    is how one of the three fell out of step. A second variable added to any
    epilogue fails here until the page carries it too.

    **One principled exclusion, and it is derived as well.** A CREDENTIAL is
    never restated here, because law 3 makes the key the person's own act and
    inline at the launch — a driving agent that exported one would be holding
    it. The excluded names are the engine's own list of LLM key variables
    (`doctor.WELL_KNOWN_KEY_ENVS`), so the exclusion cannot quietly widen to
    cover the next `PATH`-shaped line somebody forgets.
    """
    doctor = pytest.importorskip("wringer.doctor")
    script = (EXAMPLES / name / "setup.sh").read_text(encoding="utf-8")
    exported = sorted({
        variable
        for line in script.splitlines()
        if line.strip().startswith("export ") and "=" in line
        for variable in [line.strip().split("=", 1)[0]
                         .removeprefix("export ").strip()]
        if variable not in doctor.WELL_KNOWN_KEY_ENVS
    })
    if not exported:
        # Nothing to restate — but that has to be EARNED, not assumed. An
        # example that builds a virtualenv and exports nothing has the same
        # `command not found` waiting in it, one layer earlier.
        assert ".venv" not in script, (
            f"{name}/setup.sh creates a virtualenv and never puts its bin "
            "directory on PATH, so the example's own checks cannot run"
        )
        return

    driving = drive_agents_md().split("## Driving")[1]
    missing = [name_ for name_ in exported if f"export {name_}" not in driving]
    assert not missing, (
        f"{name}/setup.sh tells the reader to export {missing} and AGENTS.md's "
        "driving section — which says those steps are the driving agent's — "
        "does not restate it"
    )


def test_ONLY_ONE_PAGE_TELLS_ANYONE_HOW_TO_AUTHENTICATE_THE_BUILDER():
    """**The three-drifted-surfaces disease, killed by single-sourcing.**

    Field report 2026-08-25, finding 4. On 2026-08-25 three surfaces carried
    three different answers to "how does the builder get a credential":
    `docs/drive/AGENTS.md` said the `env_passthrough` route works and recorded
    a refusal as NOT REPRODUCED; `INSTALL.md` said *"the authentication path
    is a live gap, not a solved one"*; and on the reporter's actual machine
    the route named by the first was the CAUSE of the refusal recorded by it.
    Every one of those sentences was written honestly. None of them could stay
    in step, because there were three of them.

    So there is one page that tells a person what to DO about it, and every
    other page points at it. **Derived over every reader-facing page**, and
    deliberately keyed on the imperative half — `auth login` is an instruction
    to a human. Pages may name the config field, describe the mechanism, or
    record a capture; what they may not do is grow a second set of
    instructions that can fall behind the first.
    """
    home = "docs/drive/AGENTS.md"
    offenders = []
    for path in reader_facing_pages(captures=False):
        relative = str(path.relative_to(repo_root()))
        if relative == home:
            continue
        body = own_voice(path.read_text(encoding="utf-8"))
        if "auth login" in body and "drive/AGENTS.md" not in body:
            offenders.append(relative)
    assert not offenders, (
        f"{offenders} tell a reader how to log the builder in, and do not "
        f"point at {home}, which is where that answer lives. Three surfaces "
        "carrying this answer is how two of them came to be wrong"
    )


def test_the_credential_table_carries_the_PRECEDENCE_fact():
    """**Presence is worse than absence, and the WHY is banked.**

    Measured on the org-pinned Mac, 2026-08-27 (that day's field report): an
    `env_passthrough` Anthropic key does not merely get refused there — it
    DISPLACES a claude.ai login and takes precedence over it, so the one
    route the machine permits is invisible while the key is present. That is
    the mechanism behind every "remove the key — that is the fix" remedy in
    this repository, and it lives in the one credential home every other
    page points at. This guard pins the fact and the measured refusal it was
    read from to that home, so neither can be silently dropped.
    """
    body = flattened(agents_md())
    assert "displaces a claude.ai login and takes precedence" in body, (
        "the credential table no longer states that a passed-through key "
        "displaces the login — the measured mechanism behind presence "
        "being worse than absence"
    )
    assert (
        "A non-OAuth Anthropic credential cannot satisfy the org pin" in body
    ), "the measured refusal is no longer quoted beside the fact it proves"


def test_the_runbooks_SHOW_COMMAND_runs_against_the_shipped_two_failures_fixture():
    """F11's fix, guarded from the page (0.6.1).

    Run 3 reached the pen with NOTHING to show, and the runbook's own worked
    example quoted a `show:` command over a fixture that existed nowhere —
    `acceptance/two_failures.json` was hand-made in a field run and never
    shipped. The fixture ships now, and this drives the runbook's QUOTED
    command (derived from the page, so the page and the fixture cannot
    drift) against the example's own tree:

    - the raw pipeline run exits 1 and reports BOTH failures — that is the
      thing the person is shown;
    - the quoted command's `|| [ $? -eq 1 ]` tail declares that outcome an
      EXPECTED display, exiting 0 — so the closed pen accepts it;
    - a genuinely broken display (the fixture missing) still exits non-zero.

    The venv path in the page (`.venv/bin/python`) is setup.sh's; here the
    suite's own interpreter stands in — the page's PYTHONPATH and fixture
    path are the parts under test.
    """
    page = (repo_root() / "docs" / "drive" / "AGENTS.md").read_text("utf-8")
    quoted = re.search(r"summary-reads-clearly: \"([^\"]+)\"", page)
    assert quoted, "the runbook no longer quotes the worked example's show:"
    command = quoted.group(1)
    assert "two_failures.json" in command
    assert "|| [ $? -eq 1 ]" in command, (
        "the quoted command lost the declared-exit tail — a pipeline that "
        "reports failures exits 1, and without the tail the closed pen "
        "refuses the example's own display"
    )

    example = repo_root() / "docs" / "drive" / "examples" / "pipeline" / "project"
    runnable = command.replace(".venv/bin/python", sys.executable)

    raw = subprocess.run(
        f"PYTHONPATH=src {sys.executable} -m pipeline acceptance/two_failures.json",
        shell=True, cwd=example, capture_output=True, text=True, timeout=60,
    )
    assert raw.returncode == 1, "the fixture no longer shows a failing run"
    assert "build" in raw.stdout and "lint" in raw.stdout
    assert raw.stdout.count("FAILED") == 2, (
        f"the fixture must show exactly the two failures: {raw.stdout}"
    )

    declared = subprocess.run(
        runnable, shell=True, cwd=example, capture_output=True, text=True,
        timeout=60,
    )
    assert declared.returncode == 0, (
        "the runbook's quoted command exits non-zero on the example's own "
        f"tree, so the closed pen would refuse it: {declared.stdout}"
        f"{declared.stderr}"
    )

    broken = subprocess.run(
        runnable.replace("two_failures.json", "no-such-fixture.json"),
        shell=True, cwd=example, capture_output=True, text=True, timeout=60,
    )
    assert broken.returncode != 0, (
        "a genuinely broken display must still exit non-zero — the declared-"
        "exit tail may excuse exit 1 and nothing else"
    )


def test_the_drive_WIRES_the_show_question_and_writes_the_answer(
    project, tmp_path, capsys, monkeypatch
):
    """0.6.7, runs 4 and 4B: the orchestrator asks what shows each human
    requirement after the plan is approved and before the build, and the
    person's exact line lands under `show:`. Wired here, not only unit-tested:
    a question the orchestrator never asks is the defect both runs met."""
    from wringer import config, spec

    drafted = spec.load(project / "wringer.spec.yaml")
    with_human = spec.Spec(
        approved=drafted.approved, title=drafted.title, intent=drafted.intent,
        questions=drafted.questions,
        criteria=drafted.criteria + (
            spec.Criterion(
                id="reads-at-a-glance", title="The summary reads at a glance",
                required=True, human=True,
            ),
        ),
        gates=drafted.gates, tasks=drafted.tasks, path=drafted.path,
    )
    (project / "wringer.spec.yaml").write_text(spec.render(with_human), encoding="utf-8")
    subprocess.run(["git", "commit", "-qam", "human criterion"], cwd=project, check=True)

    code, steps = drive(
        project, tmp_path,
        "The ones on screen.\nyes\nyes\necho SHOWN-TO-ME\nyes\n", monkeypatch,
    )
    capsys.readouterr()
    ids = [step.id for step in steps]
    assert "show:reads-at-a-glance" in ids, ids
    assert "show-installed:reads-at-a-glance" in ids, ids
    assert config.load(project / config.CONFIG_FILENAME).show == {
        "reads-at-a-glance": "echo SHOWN-TO-ME"
    }


def test_the_runbook_names_the_RESUME_verb_and_what_it_reuses():
    """**Run 4B, 2026-09-01.** The operator's stop said an attempt changed
    nothing, and the runbook the driving agent follows named no way to
    continue — so the agent had nothing to relay but the stop. The bullet
    must name the verb at command position (the verbs guard then checks it
    exists), the preface step, both of its stops, and the three labels, each
    cross-checked against the SOURCE so the page cannot drift from it."""
    import re

    body = drive_agents_md()
    assert re.search(r"^[ \t]*wringer-drive[ \t]+resume\b", body, re.MULTILINE), (
        "the runbook never puts `wringer-drive resume` where a command is typed"
    )
    facts = run_module.ResumeFacts(
        last_question=None, phase="build", prd_inside=True,
        spec_present=True, spec_approved=True, spec_changed=False,
        answers=("which-columns",), gates=("unit",), shows=(), max_iterations=1,
    )
    preface = run_module.resume_preface(facts)
    assert f"`{preface.id}`" in body, f"the runbook does not name the {preface.id} step"
    for label in ("Preserved:", "Reused:", "Will spend:"):
        assert label in preface.text and f"`{label}`" in body, (
            f"the runbook and the preface disagree about the label {label!r}"
        )
    for stop in (run_module.spec_changed_step(), run_module.nothing_to_resume_step()):
        assert f"`{stop.id}`" in body, f"the runbook does not name {stop.id}"
    assert "never re-asked" in body and "no drafting call" in body, (
        "the runbook does not say what a resume reuses"
    )


def test_the_drive_INSTALLS_a_proposed_display_with_the_gate_yes_and_asks_nothing(
    project, tmp_path, capsys, monkeypatch
):
    """P0.3 (2026-09-02), wired end to end: with a sidecar proposing what to
    show for the human requirement, the orchestrator renders it in the gate
    diff, the person's yes installs it, and the 0.6.7 question is NOT asked
    — the settings already carry the command. The unit tests prove each
    piece; this proves the orchestrator strings them in that order."""
    from wringer import config, spec

    drafted = spec.load(project / "wringer.spec.yaml")
    with_human = spec.Spec(
        approved=drafted.approved, title=drafted.title, intent=drafted.intent,
        questions=drafted.questions,
        criteria=drafted.criteria + (
            spec.Criterion(
                id="reads-at-a-glance", title="The summary reads at a glance",
                required=True, human=True,
            ),
        ),
        gates=drafted.gates, tasks=drafted.tasks, path=drafted.path,
    )
    (project / "wringer.spec.yaml").write_text(spec.render(with_human), encoding="utf-8")
    (project / "wringer.gates.yaml").write_text(
        "schema_version: wringer.gatespec.v2\n"
        "show:\n"
        '  reads-at-a-glance: "echo PROPOSED-BY-PLAN"\n',
        encoding="utf-8",
    )
    subprocess.run(["git", "add", "-A"], cwd=project, check=True)
    subprocess.run(["git", "commit", "-qm", "human criterion"], cwd=project, check=True)

    code, steps = drive(
        project, tmp_path, "The ones on screen.\nyes\nyes\ndeliver\nyes\n",
        monkeypatch,
    )
    capsys.readouterr()
    ids = [step.id for step in steps]
    assert "gate-diff" in ids, ids
    assert "show:reads-at-a-glance" not in ids, (
        f"the drive asked for a display the plan had proposed and the yes "
        f"installed: {ids}"
    )
    assert ids.index("gate-diff") < ids.index("building"), ids
    assert config.load(project / config.CONFIG_FILENAME).show == {
        "reads-at-a-glance": "echo PROPOSED-BY-PLAN"
    }


def _with_human_criterion(project: Path) -> None:
    from wringer import spec

    drafted = spec.load(project / "wringer.spec.yaml")
    with_human = spec.Spec(
        approved=drafted.approved, title=drafted.title, intent=drafted.intent,
        questions=drafted.questions,
        criteria=drafted.criteria + (
            spec.Criterion(
                id="reads-at-a-glance", title="The summary reads at a glance",
                required=True, human=True,
            ),
        ),
        gates=drafted.gates, tasks=drafted.tasks, path=drafted.path,
    )
    (project / "wringer.spec.yaml").write_text(spec.render(with_human), encoding="utf-8")


def test_the_drive_SAYS_a_DECLINED_display_was_declined_and_then_asks(
    project, tmp_path, capsys, monkeypatch
):
    """P0.3: a no to a diff carrying ONLY a proposed display is not a no to
    the checks — the orchestrator says nothing was added, the 0.6.7 question
    follows with the person's own command, and the build still runs. Wired,
    because the `declined` branch lives in `__main__` and a unit test of the
    step cannot see whether the orchestrator ever reaches it."""
    from wringer import config

    _with_human_criterion(project)
    (project / "wringer.gates.yaml").write_text(
        "schema_version: wringer.gatespec.v2\n"
        "show:\n"
        '  reads-at-a-glance: "echo PROPOSED-BY-PLAN"\n',
        encoding="utf-8",
    )
    subprocess.run(["git", "add", "-A"], cwd=project, check=True)
    subprocess.run(["git", "commit", "-qm", "human criterion"], cwd=project, check=True)

    code, steps = drive(
        project, tmp_path,
        "The ones on screen.\nyes\nyes\nno\necho MINE\nyes\n", monkeypatch,
    )
    capsys.readouterr()
    ids = [step.id for step in steps]
    assert "gate-diff" in ids, ids
    assert "show-proposal-declined" in ids, ids
    assert "show:reads-at-a-glance" in ids, f"the fallback question went missing: {ids}"
    assert ids.index("show-proposal-declined") < ids.index("show:reads-at-a-glance")
    assert "building" in ids, f"a declined display stopped the build: {ids}"
    assert config.load(project / config.CONFIG_FILENAME).show == {
        "reads-at-a-glance": "echo MINE"
    }, "the plan's declined command was installed, or the person's was not"


def test_the_drive_SAYS_when_the_settings_CANNOT_TAKE_a_proposed_display(
    project, tmp_path, capsys, monkeypatch
):
    """P0.3: the settings already have a `show:` section, so the engine lists
    the proposal in words (`show_not_installable`) and the orchestrator says
    so before asking the 0.6.7 question — a proposal that vanished would look
    like one never made."""
    from wringer import config

    _with_human_criterion(project)
    settings = project / config.CONFIG_FILENAME
    settings.write_text(
        settings.read_text(encoding="utf-8") + 'show:\n  other: "true"\n',
        encoding="utf-8",
    )
    (project / "wringer.gates.yaml").write_text(
        "schema_version: wringer.gatespec.v2\n"
        "show:\n"
        '  reads-at-a-glance: "echo PROPOSED-BY-PLAN"\n',
        encoding="utf-8",
    )
    subprocess.run(["git", "add", "-A"], cwd=project, check=True)
    subprocess.run(["git", "commit", "-qm", "human criterion"], cwd=project, check=True)

    code, steps = drive(
        project, tmp_path, "The ones on screen.\nyes\nyes\necho MINE\nyes\n", monkeypatch,
    )
    capsys.readouterr()
    ids = [step.id for step in steps]
    assert "show-proposal-not-installable" in ids, ids
    assert "show:reads-at-a-glance" in ids, ids
    assert ids.index("show-proposal-not-installable") < ids.index("show:reads-at-a-glance")
    blocked = next(s for s in steps if s.id == "show-proposal-not-installable")
    assert "reads-at-a-glance" in blocked.text and "by hand" in blocked.text
    assert config.load(settings).show == {"other": "true"}, "somebody's section moved"


def test_the_runbook_says_the_plan_may_PROPOSE_the_display():
    """The judging section is where an agent learns what `show:` is; it has
    to say the plan may propose one and that the person approves it with the
    gates, or an agent reading it tells the person to invent a command the
    plan already offered."""
    text = " ".join(drive_agents_md().split())
    assert "may propose" in text and "same yes" in text, (
        "the runbook's judging section no longer says the plan may propose "
        "the display and that the gate yes approves it"
    )
