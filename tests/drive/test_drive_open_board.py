"""0.8.6 (P1.13) — the board opens at decision moments, through ONE seam.

**Runs 4 and 4B, 2026-09-01.** The PM read "green" as "everything proved" and
judged a `human:` requirement on a manual display, because the page that says
which requirement is proved and which is waiting on them was a filename in a
terminal line — and nothing said WHICH card the handover was held on.

What this file pins, each by execution against the real drive:

- json mode NEVER calls the opener — an agent is driving, and a browser window
  is not a step it can relay;
- text mode opens the page at the HOLD on the card the board itself marks
  NEEDS YOU, and before the handover's second yes from the top;
- `--no-open` silences the opener and changes nothing else;
- the step names the path AND the section in both modes, quoting the board's
  one spelling of the anchor;
- `open_board` is the ONLY place the stdlib opener is named, and it hands it
  a `file://` URI with the anchor.
"""

from __future__ import annotations

import ast
import io
import subprocess
import sys
from pathlib import Path

import pytest
from core_helpers import flat

from wringer_drive import run as run_module
from wringer_drive.__main__ import build_parser, main

SRC = Path(run_module.__file__).resolve().parent


@pytest.fixture
def project(tmp_path: Path) -> Path:
    """A real git repository with a spec the ENGINE rendered, carrying one
    `human:` requirement — the card the pen is about."""
    from wringer import spec

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
            spec.Criterion(
                id="reads-at-a-glance",
                title="The summary reads at a glance",
                required=True,
                human=True,
            ),
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


# The answers a person types on this fixture: the interview's one question,
# the read-back confirm, the plan approval, the `show:` command for the human
# requirement, then (only where the handover is reached) the second yes.
TO_THE_PEN = "The ones on screen.\nyes\nyes\necho shown\n"
TO_THE_HANDOVER = TO_THE_PEN + "yes\n"


def opener_recorder(monkeypatch) -> list[tuple[Path, str]]:
    """Replace THE seam and record every call — the guard the plan names."""
    calls: list[tuple[Path, str]] = []
    monkeypatch.setattr(
        run_module, "open_board", lambda path, section="": calls.append((path, section))
    )
    return calls


def recording_session(monkeypatch) -> list:
    made: list = []
    real = run_module.Session

    def build(**kwargs):
        session = real(**kwargs)
        made.append(session)
        return session

    monkeypatch.setattr(run_module, "Session", build)
    return made


def drive(argv: list[str], typed: str, monkeypatch) -> tuple[int, list]:
    made = recording_session(monkeypatch)
    sys.stdin = io.StringIO(typed)
    try:
        code = main(argv)
    finally:
        sys.stdin = sys.__stdin__
    assert made, "the session was never built"
    return code, made[0].steps


def converge_the_handover(monkeypatch) -> None:
    """Substitute ONLY the engine's delivery verdict, so the handover branch
    is reachable on a fixture that cannot honestly converge (no remote, an
    unjudged human requirement). Everything else is real, including
    `wringer-board render`."""
    monkeypatch.setattr(run_module, "delivery_plan", lambda repo: {"would": "send"})
    monkeypatch.setattr(
        run_module,
        "deliver",
        lambda repo, *, answered_yes: {
            "sent": answered_yes,
            "delivery_dir": ".wringer/deliveries/20260903-120000-abcd",
        },
    )


def board_steps(steps) -> list:
    return [step for step in steps if step.id == "board"]


# --- the HOLD: the page opens ON THE CARD the board marks NEEDS YOU -----------


def test_TEXT_MODE_OPENS_THE_CARD_TO_REVIEW_AT_THE_HOLD(project, tmp_path, capsys, monkeypatch):
    calls = opener_recorder(monkeypatch)
    code, steps = drive(
        ["run", str(prd(tmp_path)), "--repo", str(project)], TO_THE_PEN, monkeypatch
    )
    out = flat(capsys.readouterr().out)

    assert code != 0, "an unjudged human requirement holds the handover"
    assert steps[-1].id.startswith("stopped:"), [s.id for s in steps]
    assert calls == [(project / "board.html", "card-reads-at-a-glance")], calls
    # The step says where AND which card, in the board's own spelling.
    (board,) = board_steps(steps)
    assert "board.html#card-reads-at-a-glance" in board.text, board.text
    assert "the card to review is 'The summary reads at a glance'" in board.text
    assert board.detail["section"] == "card-reads-at-a-glance"
    assert "board.html#card-reads-at-a-glance" in out, out


def test_the_card_to_review_is_the_one_THE_BOARD_MARKS_needs_you(project, tmp_path, monkeypatch):
    """Read from the board's own partition, never from the refusal's prose:
    `cards.BLOCKED_ON_PERSON` is the tuple the badge and the count line are
    rendered from, so the card the drive points at is the card the page
    marks."""
    from wringer_board import cards, read

    opener_recorder(monkeypatch)
    drive(["run", str(prd(tmp_path)), "--repo", str(project)], TO_THE_PEN, monkeypatch)

    board = read.read(project)
    marked = [
        c.id for c in board.criteria
        if cards.card_for(board, c).state in cards.BLOCKED_ON_PERSON
    ]
    assert marked == ["reads-at-a-glance"], marked
    assert run_module.card_to_review(project) == (
        "reads-at-a-glance",
        "The summary reads at a glance",
    )


def test_with_NO_card_needing_a_person_the_page_opens_from_the_top(tmp_path):
    """No board at all: None, never a guessed card — and the step says so."""
    empty = tmp_path / "nothing"
    empty.mkdir()
    assert run_module.card_to_review(empty) is None
    step = run_module.board_step(empty / "board.html", None)
    assert step.detail["section"] == ""
    assert "Open board.html from the top" in step.text, step.text


# --- the handover: the page opens from the top, before the second yes --------


def test_TEXT_MODE_OPENS_THE_BOARD_BEFORE_THE_SECOND_YES(project, tmp_path, capsys, monkeypatch):
    calls = opener_recorder(monkeypatch)
    converge_the_handover(monkeypatch)
    code, steps = drive(
        ["run", str(prd(tmp_path)), "--repo", str(project)],
        TO_THE_HANDOVER,
        monkeypatch,
    )
    capsys.readouterr()

    assert code == 0, [s.id for s in steps]
    assert calls == [(project / "board.html", "")], calls
    ids = [s.id for s in steps]
    # Opened BEFORE the confirm was asked: the board step precedes `done`, and
    # the opener ran while the board step was the newest thing emitted.
    assert ids.index("board") < ids.index("done")
    (board,) = board_steps(steps)
    assert board.detail["section"] == ""
    assert "Open board.html from the top" in board.text, board.text


# --- json mode: NEVER ---------------------------------------------------------


def test_JSON_MODE_NEVER_CALLS_THE_OPENER_at_the_hold(project, tmp_path, capsys, monkeypatch):
    calls = opener_recorder(monkeypatch)
    code, steps = drive(
        ["run", str(prd(tmp_path)), "--repo", str(project), "--emit", "json"],
        TO_THE_PEN,
        monkeypatch,
    )
    capsys.readouterr()

    assert code != 0
    assert calls == [], f"json mode opened a browser: {calls}"
    # The agent driving still gets the section, in the step it relays.
    (board,) = board_steps(steps)
    assert board.as_json()["detail"]["section"] == "card-reads-at-a-glance"
    assert "board.html#card-reads-at-a-glance" in board.as_json()["text"]


def test_JSON_MODE_NEVER_CALLS_THE_OPENER_at_the_handover(
    project, tmp_path, capsys, monkeypatch
):
    calls = opener_recorder(monkeypatch)
    converge_the_handover(monkeypatch)
    code, _ = drive(
        ["run", str(prd(tmp_path)), "--repo", str(project), "--emit", "json"],
        TO_THE_HANDOVER,
        monkeypatch,
    )
    capsys.readouterr()

    assert code == 0
    assert calls == [], f"json mode opened a browser: {calls}"


# --- `--no-open` --------------------------------------------------------------


def test_NO_OPEN_SILENCES_THE_OPENER_and_changes_nothing_else(
    project, tmp_path, capsys, monkeypatch
):
    calls = opener_recorder(monkeypatch)
    code, steps = drive(
        ["run", str(prd(tmp_path)), "--repo", str(project), "--no-open"],
        TO_THE_PEN,
        monkeypatch,
    )
    out = flat(capsys.readouterr().out)

    assert code != 0
    assert calls == [], f"--no-open still opened a browser: {calls}"
    # The step is byte-identical: the flag is about the window, not the words.
    (board,) = board_steps(steps)
    assert "board.html#card-reads-at-a-glance" in board.text
    assert "board.html#card-reads-at-a-glance" in out


def test_no_open_is_on_BOTH_verbs_and_answers_nothing():
    parser = build_parser()
    verbs = next(a for a in parser._actions if hasattr(a.choices, "values")).choices
    for name in ("run", "resume"):
        flags = [s for a in verbs[name]._actions for s in a.option_strings]
        assert "--no-open" in flags, f"{name} has no --no-open: {flags}"
    # `test_there_is_no_flag_that_answers_the_approval` reads the same parser
    # for the banned names; this only pins that the flag defaults OFF, so an
    # absent flag can never mean "opened nothing".
    assert parser.parse_args(["run", "PRD.md"]).no_open is False
    assert parser.parse_args(["resume"]).no_open is False


def test_the_resume_verb_carries_the_flag_to_the_same_sequence(
    project, tmp_path, capsys, monkeypatch
):
    """`resume` joins `_drive` at the recorded phase; a `--no-open` typed on
    it reaches the same two moments. Driven: a run stopped at the pen, then
    resumed with the flag — the resume redoes the handover and must stay
    silent."""
    calls = opener_recorder(monkeypatch)
    drive(["run", str(prd(tmp_path)), "--repo", str(project)], TO_THE_PEN, monkeypatch)
    assert len(calls) == 1, "the run itself opened the page once, at the hold"
    calls.clear()
    capsys.readouterr()

    code, steps = drive(
        ["resume", "--repo", str(project), "--no-open"], "", monkeypatch
    )
    capsys.readouterr()
    assert [s.id for s in steps if s.id == "board"], [s.id for s in steps]
    assert calls == [], f"resume --no-open opened a browser: {calls}"


# --- the seam itself ------------------------------------------------------------


def test_open_board_hands_the_stdlib_a_FILE_URI_with_the_anchor(tmp_path, monkeypatch):
    import webbrowser

    opened: list[str] = []
    monkeypatch.setattr(webbrowser, "open", lambda url, *a, **k: opened.append(url))
    page = tmp_path / "board.html"
    page.write_text("<p>x</p>", encoding="utf-8")

    run_module.open_board(page, "card-reads-at-a-glance")
    run_module.open_board(page, "")
    assert opened == [
        page.resolve().as_uri() + "#card-reads-at-a-glance",
        page.resolve().as_uri(),
    ], opened
    assert opened[0].startswith("file://")


def test_an_opener_that_fails_changes_NOTHING_about_the_run(tmp_path, monkeypatch):
    import webbrowser

    def refuse(url, *a, **k):
        raise webbrowser.Error("no browser on this machine")

    monkeypatch.setattr(webbrowser, "open", refuse)
    page = tmp_path / "board.html"
    page.write_text("<p>x</p>", encoding="utf-8")
    assert run_module.open_board(page, "card-x") is None


def test_the_opener_is_named_in_EXACTLY_ONE_place_across_the_shipped_tree():
    """The seam is only a seam if nothing goes around it. Every module in the
    three shipped packages is read with `ast`; `webbrowser` may be imported
    inside `run.open_board` and nowhere else."""
    root = SRC.parent
    sites: list[str] = []
    for package in ("wringer", "wringer_board", "wringer_drive"):
        for path in sorted((root / package).glob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                names = []
                if isinstance(node, ast.Import):
                    names = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom):
                    names = [node.module or ""]
                if any(n == "webbrowser" or n.startswith("webbrowser.") for n in names):
                    sites.append(f"{package}/{path.name}:{node.lineno}")
    assert len(sites) == 1, f"the opener is named at {sites}; the seam is one place"
    assert sites[0].startswith("wringer_drive/run.py")

    source = (SRC / "run.py").read_text(encoding="utf-8")
    fn = next(
        n for n in ast.walk(ast.parse(source))
        if isinstance(n, ast.FunctionDef) and n.name == "open_board"
    )
    assert fn.lineno < int(sites[0].rsplit(":", 1)[1]) < fn.end_lineno, (
        f"webbrowser is imported outside open_board: {sites[0]}"
    )


def test_the_step_quotes_the_boards_ONE_spelling_of_the_anchor(tmp_path):
    """One renderer per fact: the anchor the step prints is
    `render.card_anchor`'s, and the page's card carries the same id — so a
    change to either spelling reddens here rather than opening the page at
    the top while the sentence claims a card."""
    from wringer_board import render

    step = run_module.board_step(tmp_path / "board.html", ("exports-csv", "It exports"))
    assert step.detail["section"] == render.card_anchor("exports-csv")
    assert f"board.html#{render.card_anchor('exports-csv')}" in step.text
    assert "the card to review is 'It exports'" in step.text
