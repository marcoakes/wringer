"""Core test helpers, named uniquely.

Both this suite and the board's have a `conftest.py`, and both did
`from conftest import ...`. Once the board merged in on 2026-08-20 both
directories went on `sys.path` and `conftest` became ambiguous — twenty
core modules failed at collection importing the BOARD's helpers.

Fixtures stay in `conftest.py`, which pytest auto-loads per directory and
which nothing imports by name. Anything imported BY NAME lives here, on
both sides, so there is no shared name left to collide.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

from wringer import config

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


# --- the scope a document guard runs over, DISCOVERED ------------------------
#
# **The QUICKSTART defect, and why this exists.**
#
# `test_a_document_naming_the_released_version_names_the_newest_tag` was
# parameterised over a hardcoded list of two documents. Both were the right two
# when the list was written. Neither survived `0.4.0`, so `QUICKSTART.md` told
# readers for weeks that the release was `0.3.0`, that it shipped seventeen
# commands, and that they should install from source instead — and no test
# could see it, because the page was not on the list. A person found it.
#
# Every guard in this suite that takes a hand-kept list of documents carries
# that defect latently: the list is a snapshot of the repository on the day
# somebody typed it, and the repository grows. So the rule for a guard over
# what this project SAYS is that its scope is discovered here, and a guard that
# keeps a hand list instead says in its own docstring why a list is right
# there. None silently — that is the whole point of the audit that produced
# this function.

#: Directories holding nothing a reader ever follows: evidence stores, build
#: output, vendored dependencies, and the cold-read corpus.
NOT_READER_FACING = frozenset(
    {
        ".git",
        ".pytest_cache",
        ".venv",
        ".wringer",
        ".wringer.example",
        "benchmark",
        "build",
        "coldread",
        "dist",
        "m3",
        "node_modules",
    }
)

#: A CAPTURE records what a command did on a date. Rewriting one to match today
#: destroys the evidence it exists to be (law 8), so a capture is exempt from
#: the guards that hold live prose to today's facts — and only from those.
_CAPTURE_NAME = re.compile(r"field-re(port|sponse)|install-2026|-2026-\d\d-\d\d\.md")


def repo_root() -> Path:
    """The checkout this suite is running inside."""
    return Path(__file__).resolve().parent.parent


def is_capture(path: Path) -> bool:
    """Is this page a dated capture rather than live prose?"""
    return bool(_CAPTURE_NAME.search(path.as_posix()))


def reader_facing_pages(*, captures: bool = True, root: Path | None = None):
    """Every markdown page this repository ships to a reader, discovered.

    `captures=False` drops the dated records, for guards that hold prose to
    what is true TODAY — a capture is allowed, and required, to say what was
    true when it was taken.

    Returned sorted and relative-path-stable so a failure message names the
    same page in the same place on every machine.
    """
    base = root or repo_root()
    found = []
    for path in sorted(base.rglob("*.md")):
        relative = path.relative_to(base)
        if any(part in NOT_READER_FACING for part in relative.parts):
            continue
        if not captures and is_capture(relative):
            continue
        found.append(path)
    return found
