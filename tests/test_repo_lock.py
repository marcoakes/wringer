"""One writer at a time in this repository — the lock, and the script that
takes it.

**The body count, 2026-09-04.** Two release pipelines ran at once. The
older one's `git add -A` swept up the newer one's version bump, and the
commit that reached `main` announced 0.8.11 while carrying `__version__ =
"0.9.0"`. Neither version could be tagged from it; nothing published until
somebody untangled it by hand.

`tests/test_docs.py::test_the_release_commit_names_the_version_it_carries`
is the autopsy — it catches the commit after it exists. These are the
guards over the thing that stops it being made.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


LOCK = repo_root() / "scripts" / "repo-lock.sh"


@pytest.fixture(autouse=True)
def _needs_the_script():
    """The sdist ships the package and its suite, not the repository's
    scripts. Guards over those are meaningful in a checkout and meaningless
    in a tarball."""
    if not LOCK.is_file():
        pytest.skip("scripts/repo-lock.sh is not part of the distribution")
    if not (repo_root() / ".git").exists():
        pytest.skip("this is not a git checkout, so .git/ cannot hold a lock")


NAME = "wringer-selftest"


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["sh", str(LOCK), *args],
        capture_output=True,
        text=True,
        timeout=30,
    )


@pytest.fixture(autouse=True)
def _released_afterwards():
    yield
    run("release", NAME)


def test_a_SECOND_acquire_is_REFUSED_while_the_first_is_held():
    """The whole point. Two holders is the collision."""
    assert run("acquire", NAME).returncode == 0

    second = run("acquire", NAME)
    assert second.returncode == 1, (
        "a second acquire SUCCEEDED while the lock was held — two release "
        "pipelines could run at once, which is the defect this exists for"
    )
    assert "already held" in second.stderr


def test_the_refusal_NAMES_THE_HOLDER_and_ends_in_a_command():
    """A stop that says only "locked" leaves the reader with nothing to do
    but guess. This one names the process, when it took the lock, why two at
    once is a problem, and the exact command to clear it."""
    assert run("acquire", NAME).returncode == 0
    said = run("acquire", NAME).stderr

    assert str(os.getpid()) not in said or "held by process" in said
    assert "held by process" in said
    assert "taken at" in said
    assert "announcing" in said, "the refusal does not say what goes wrong"
    assert f"rm -rf {repo_root() / '.git' / 'wringer-locks' / NAME}" in said


def test_RELEASING_lets_the_next_writer_in():
    assert run("acquire", NAME).returncode == 0
    assert run("release", NAME).returncode == 0
    assert run("acquire", NAME).returncode == 0, (
        "the lock could not be retaken after release — a lock that never "
        "lets go blocks every future release"
    )


def test_a_STALE_lock_is_BROKEN_and_the_break_is_ANNOUNCED():
    """**A stale lock is worse than the collision it prevents.** A machine
    that dies mid-release would otherwise block every release afterwards,
    with no way forward but a command nobody wrote down.

    The holder is identified by pid, so a pid that is gone means the lock is
    a leftover. Breaking it is correct; breaking it SILENTLY is not — a lock
    that quietly evaporates is not a lock.
    """
    directory = repo_root() / ".git" / "wringer-locks" / NAME
    directory.mkdir(parents=True, exist_ok=True)
    # A pid that cannot be running: pid 0 is never a live user process, and
    # `kill -0 0` addresses the process GROUP rather than a process, so the
    # script must not be fooled into thinking it is alive.
    (directory / "pid").write_text("999999999\n", encoding="utf-8")
    (directory / "since").write_text("2026-09-04T00:00:00+0100\n", encoding="utf-8")

    taken = run("acquire", NAME)
    assert taken.returncode == 0, (
        "a lock held by a process that no longer exists blocked a new "
        "writer for ever"
    )
    assert "breaking a stale" in taken.stderr, (
        "the lock was broken without saying so — a silent break is not a lock"
    )
    assert "999999999" in taken.stderr


def test_the_LOCK_LIVES_UNDER_GIT_so_it_can_never_be_committed():
    """A lock file in the working tree would be swept up by the very
    `git add -A` this exists to make safe — the defect wearing a hat."""
    assert run("acquire", NAME).returncode == 0
    assert (repo_root() / ".git" / "wringer-locks" / NAME).is_dir()

    dirty = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=repo_root(), capture_output=True, text=True, timeout=30,
    ).stdout
    assert "wringer-locks" not in dirty, (
        "the lock is visible to git, so a release commit could contain it"
    )


def test_a_NAME_WITH_A_SLASH_is_refused():
    """`<name>` is one path segment. Without this, `../..` reaches out of
    `.git/` and `rm -rf` in the release branch removes something else."""
    assert run("acquire", "../escape").returncode == 2
    assert run("release", "../escape").returncode == 2


def test_SHIP_takes_the_lock_BEFORE_it_stages_anything():
    """`scripts/ship.sh` runs `git add -A`, which is the exact operation
    that swept up another pipeline's edits. The lock has to be taken before
    the gate, not just before the commit: the gate takes ten minutes and the
    window is open for all of it."""
    ship = (repo_root() / "scripts" / "ship.sh").read_text(encoding="utf-8")
    if "repo-lock.sh" not in ship:
        pytest.fail("scripts/ship.sh does not take the lock at all")

    # **By LINE, and skipping comments.** Searching the whole text for
    # "git add -A" found the sentence in this file's own header explaining
    # why the lock is there, and reported the lock as too late.
    lines = [
        line for line in ship.splitlines() if line and not line.startswith("#")
    ]

    def first(fragment: str) -> int:
        for index, line in enumerate(lines):
            if fragment in line:
                return index
        pytest.fail(f"scripts/ship.sh no longer runs {fragment!r}")

    acquire = first("acquire ship")
    assert acquire < first("check.sh"), (
        "ship.sh takes the lock after running the gate — the ten minutes "
        "the gate takes is precisely the window this closes"
    )
    assert acquire < first("git add -A")
    assert "trap" in ship, (
        "ship.sh never releases the lock, so one interrupted ship blocks "
        "every later one"
    )
