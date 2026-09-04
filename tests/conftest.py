"""Shared fixtures — scratch git repos to run gates in."""

from __future__ import annotations

import subprocess
import webbrowser as _webbrowser
from pathlib import Path

import pytest

from wringer import config, deliver
from wringer import loop as loop_module
from wringer_board import judge as pen_module

# --- D0: every declared refusal must be one a test has actually taken -------
#
# **The lexical guards this replaces could not see reachability.** They parsed
# `deliver.py` with `ast`, counted the `raise Refused(` sites and matched
# their literal `reason=` strings against `REFUSAL_REASONS`. Nothing checked a
# site could be REACHED: `if code != 0 and False:` left both of them green,
# demonstrated on `remote_unreachable`. A whole-suite probe on
# `Refused.__init__` then showed FOUR of the declared reasons were constructed
# by no test at all — including `tracked_contents_differ`, the tracked-diff
# byte check the product's core promise rests on, whose deletion left 199
# tests across five modules passing.
#
# Red-first applies to our own refusals before it applies to anyone's gates. A
# refusal nobody has seen fire is a check green from birth, which is the exact
# thing this program exists to refuse.
#
# The recording is a fact about the RUN, so it lives here and the assertion is
# made once at session end (see `pytest_sessionfinish`). A filtered run — `-k`,
# a node id, `-m` — cannot see the whole set, so it reports what it could not
# check instead of asserting on a partial view; CI runs the suite whole.
CONSTRUCTED_REFUSALS: set[str] = set()

# D0, generalised per refusal family (2026-08-31): the run path's preflight
# refusals get the same discipline the delivery's got. One recorder per
# family, one roster each, both asserted whole at session end.
CONSTRUCTED_RUN_REFUSALS: set[str] = set()

# The third family (0.6.1): the pen's refusals.
CONSTRUCTED_PEN_REFUSALS: set[str] = set()


@pytest.fixture(autouse=True, scope="session")
def _record_every_refusal_constructed():
    """Wrap each refusal constructor for the whole session; remember names."""
    original = deliver.Refused.__init__

    def recording(self, message, exit_code=1, *, reason):
        CONSTRUCTED_REFUSALS.add(reason)
        original(self, message, exit_code, reason=reason)

    original_run = loop_module.RunRefusal.__init__

    def recording_run(self, reason, message):
        CONSTRUCTED_RUN_REFUSALS.add(reason)
        original_run(self, reason, message)

    original_pen = pen_module.PenRefused.__init__

    def recording_pen(self, message, *, reason):
        CONSTRUCTED_PEN_REFUSALS.add(reason)
        original_pen(self, message, reason=reason)

    deliver.Refused.__init__ = recording
    loop_module.RunRefusal.__init__ = recording_run
    pen_module.PenRefused.__init__ = recording_pen
    try:
        yield
    finally:
        deliver.Refused.__init__ = original
        loop_module.RunRefusal.__init__ = original_run
        pen_module.PenRefused.__init__ = original_pen


def pytest_sessionfinish(session, exitstatus):
    """Assert the recorded set equals `deliver.REFUSAL_REASONS`, or say why not.

    Only on a WHOLE run: a filtered one has not had the chance, and failing it
    would train everyone to ignore this. `--co` (collect-only) never
    constructs anything either.
    """
    if exitstatus not in (0, 1):
        return
    options = session.config.option
    filtered = bool(
        getattr(options, "keyword", "")
        or getattr(options, "markexpr", "")
        or getattr(options, "collectonly", False)
        or getattr(options, "file_or_dir", []) not in ([], ["tests"])
    )
    if filtered:
        return
    missing = sorted(set(deliver.REFUSAL_REASONS) - CONSTRUCTED_REFUSALS)
    stray = sorted(CONSTRUCTED_REFUSALS - set(deliver.REFUSAL_REASONS))
    missing_run = sorted(
        set(loop_module.RUN_REFUSAL_REASONS) - CONSTRUCTED_RUN_REFUSALS
    )
    stray_run = sorted(
        CONSTRUCTED_RUN_REFUSALS - set(loop_module.RUN_REFUSAL_REASONS)
    )
    missing_pen = sorted(
        set(pen_module.PEN_REFUSAL_REASONS) - CONSTRUCTED_PEN_REFUSALS
    )
    stray_pen = sorted(
        CONSTRUCTED_PEN_REFUSALS - set(pen_module.PEN_REFUSAL_REASONS)
    )
    if (
        not missing and not stray and not missing_run and not stray_run
        and not missing_pen and not stray_pen
    ):
        return
    session.exitstatus = 1
    reporter = session.config.pluginmanager.get_plugin("terminalreporter")
    if reporter is None:                                # pragma: no cover
        return
    reporter.write_sep("=", "D0: refusals no test has taken", red=True)
    if missing:
        reporter.write_line(
            "declared in deliver.REFUSAL_REASONS and constructed by NO test: "
            + ", ".join(missing)
        )
        reporter.write_line(
            "  a refusal nobody has seen fire is a check green from birth. "
            "Drive it through the command that owes it, or strike the name."
        )
    if stray:
        reporter.write_line(
            "constructed but not declared: " + ", ".join(stray)
        )
    if missing_run:
        reporter.write_line(
            "declared in loop.RUN_REFUSAL_REASONS and constructed by NO "
            "test: " + ", ".join(missing_run)
        )
        reporter.write_line(
            "  a refusal nobody has seen fire is a check green from birth. "
            "Drive it through the command that owes it, or strike the name."
        )
    if stray_run:
        reporter.write_line(
            "run refusals constructed but not declared: " + ", ".join(stray_run)
        )
    if missing_pen:
        reporter.write_line(
            "declared in judge.PEN_REFUSAL_REASONS and constructed by NO "
            "test: " + ", ".join(missing_pen)
        )
        reporter.write_line(
            "  a refusal nobody has seen fire is a check green from birth. "
            "Drive it through the command that owes it, or strike the name."
        )
    if stray_pen:
        reporter.write_line(
            "pen refusals constructed but not declared: " + ", ".join(stray_pen)
        )

# Never inherit the developer's identity, hooks, or signing config: a test
# repo must behave the same on every machine and in CI.
_ISOLATED = [
    "-c",
    "user.name=wringer test",
    "-c",
    "user.email=wringer@example.invalid",
    "-c",
    "commit.gpgsign=false",
]


def _git(cwd: Path, *args: str, check: bool = True) -> str:
    """Run git in a scratch repo. `check=False` for commands whose failure is
    the point — a conflicted merge, say."""
    proc = subprocess.run(
        ["git", *_ISOLATED, *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=check,
    )
    return proc.stdout.strip()


@pytest.fixture(autouse=True)
def witness_store(tmp_path_factory, monkeypatch):
    """**Every test's witness store is a scratch directory, never a real one.**

    `witness.store_dir` deliberately resolves OUTSIDE the repository under test
    (SPEC_GATEGEN §6 P4-3): the bytes moved out because an agent found them in
    its own tree and tidied them up. The cost of moving them out is that the
    default location is a developer's real `~/.local/state`, and a suite that
    wrote model-authored Python there would be a test suite with a side effect
    outside its own tmp dir — which is the one thing a scratch fixture exists to
    prevent.

    `autouse`, because opting in per test is a guard that a new test forgets.
    """
    monkeypatch.setenv(
        "WRINGER_WITNESS_STORE", str(tmp_path_factory.mktemp("witness-store"))
    )


@pytest.fixture
def git_run():
    """Run an isolated git command in a scratch repo; returns its stdout."""
    return _git


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A git repo on `main` with one empty commit — a clean starting point.

    The identity is written into the repo's own config, not just passed with
    `-c` on the fixture's calls: `wring deliver` runs `git commit` the way a
    user's git is configured, and a real user has an identity. Without this the
    suite passes on macOS — where git invents `user@host` — and fails on
    GitHub's Linux runners, where the hostname is not fully qualified and git
    refuses to guess. That divergence cost a red build; keep it.
    """
    _git(tmp_path, "init", "-q", "-b", "main")
    _git(tmp_path, "config", "user.name", "wringer test")
    _git(tmp_path, "config", "user.email", "wringer@example.invalid")
    _git(tmp_path, "config", "commit.gpgsign", "false")
    _git(tmp_path, "commit", "-q", "--allow-empty", "-m", "initial commit")
    return tmp_path


@pytest.fixture
def write_config():
    """Write a `.wringer.yaml` into a directory and return its path."""

    def _write(directory: Path, body: str) -> Path:
        path = directory / config.CONFIG_FILENAME
        path.write_text(body, encoding="utf-8")
        return path

    return _write


def flat(text: str) -> str:
    """Collapse whitespace in captured output before matching on it.

    Refusals are wrapped to the terminal (`cli._wrap_message`), so a phrase can
    legitimately straddle a line break. Asserting on the exact line-breaking of
    prose tests the formatter rather than the message — and the formatter has
    its own tests.
    """
    return " ".join(text.split())


# --- no test may ever launch a browser --------------------------------------
#
# 2026-09-03: an agent building P1.13 ("open the board at decision moments")
# ran its tests against the real `webbrowser.open`, and Marc's browser opened
# a window per test run — "a hundred windows". A browser launch is a human
# act on a human's machine; a test that reaches one has escaped its fixture.
# So the suite makes every launch a loud failure, session-wide, regardless of
# which seam the product routes through.

def _no_browser(*args, **kwargs):
    raise RuntimeError(
        "a test tried to open a browser — route the opener through a seam the "
        "test replaces (see wringer_drive.open_board); tests never launch one"
    )


@pytest.fixture(autouse=True, scope="session")
def _tests_never_open_a_browser():
    originals = {
        name: getattr(_webbrowser, name)
        for name in ("open", "open_new", "open_new_tab")
    }
    for name in originals:
        setattr(_webbrowser, name, _no_browser)
    try:
        yield
    finally:
        for name, fn in originals.items():
            setattr(_webbrowser, name, fn)
