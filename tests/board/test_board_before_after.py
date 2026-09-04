"""Before and after, at the pen (P1.10, 0.8.9).

**Marc's brief:** *"the board should show the old noisy pipeline summary
beside the new skipped-step summary. That is far more useful to a PM than
file counts."* A person judging "the summary reads at a glance" is comparing
it against something, and until now that something existed only in their
memory of a terminal.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from wringer_board import judge as judge_module


def _repo(tmp_path: Path) -> Path:
    repo = tmp_path / "project"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=repo, check=True)
    for key, value in (("user.email", "t@e.invalid"), ("user.name", "T"),
                       ("commit.gpgsign", "false")):
        subprocess.run(["git", "config", key, value], cwd=repo, check=True)
    (repo / "summary.txt").write_text("THE OLD NOISY SUMMARY\n", encoding="utf-8")
    (repo / ".wringer.yaml").write_text(
        'version: 1\ngates:\n  - id: t\n    run: "true"\n'
        'show:\n  reads-well: "cat summary.txt"\n',
        encoding="utf-8",
    )
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "base"], cwd=repo, check=True)
    return repo


def _work(repo: Path) -> None:
    (repo / "summary.txt").write_text("THE NEW CLEAR SUMMARY\n", encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "the work"], cwd=repo, check=True)


def test_THE_SAME_COMMAND_AT_THE_BASE_SHOWS_WHAT_IT_REPLACED(tmp_path):
    repo = _repo(tmp_path)
    _work(repo)

    base = judge_module.base_ref(repo)
    assert base, "no base commit was found to compare against"

    before = judge_module.shown_before(repo, "reads-well", base)
    after = judge_module.shown(repo, "reads-well")

    assert before.state == judge_module.SHOWN
    assert "THE OLD NOISY SUMMARY" in before.text
    assert after.state == judge_module.SHOWN
    assert "THE NEW CLEAR SUMMARY" in after.text
    assert "THE NEW CLEAR SUMMARY" not in before.text, (
        "the base capture read the working tree, so before and after are the "
        "same thing twice"
    )


def test_THE_OPERATORS_CHECKOUT_IS_NEVER_TOUCHED(tmp_path):
    """The worktree is read-only and removed; a person's own tree, branch and
    files are exactly as they were."""
    repo = _repo(tmp_path)
    _work(repo)
    before_head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True,
        check=True).stdout
    working = (repo / "summary.txt").read_text(encoding="utf-8")

    judge_module.shown_before(repo, "reads-well", judge_module.base_ref(repo))

    assert (repo / "summary.txt").read_text(encoding="utf-8") == working
    assert subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo,
                          capture_output=True, text=True,
                          check=True).stdout == before_head
    trees = subprocess.run(["git", "worktree", "list", "--porcelain"], cwd=repo,
                           capture_output=True, text=True, check=True).stdout
    assert trees.count("worktree ") == 1, trees


def test_A_COMMAND_THAT_CANNOT_RUN_AT_THE_BASE_IS_ABSENCE_NOT_AN_ERROR(tmp_path):
    """The feature's files did not exist yet — that is the normal case, and
    it must read as "nothing to show there", never as a failure the person
    has to act on."""
    repo = _repo(tmp_path)
    (repo / ".wringer.yaml").write_text(
        'version: 1\ngates:\n  - id: t\n    run: "true"\n'
        'show:\n  reads-well: "cat only-after.txt"\n',
        encoding="utf-8",
    )
    (repo / "only-after.txt").write_text("NEW THING\n", encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "the work"], cwd=repo, check=True)

    before = judge_module.shown_before(repo, "reads-well",
                                       judge_module.base_ref(repo))

    assert before.state == judge_module.FAILED
    assert "nothing to show at" in before.text
    assert "did not exist yet" in before.text


def test_A_BASE_THIS_REPOSITORY_DOES_NOT_HAVE_IS_SAID_NOT_GUESSED(tmp_path):
    repo = _repo(tmp_path)

    before = judge_module.shown_before(repo, "reads-well", "0" * 40)

    assert before.state == judge_module.FAILED
    assert "could not make a copy of the tree there" in before.text


def test_NO_BASE_AT_ALL_LEAVES_THE_AFTER_STANDING_ALONE(tmp_path):
    """A repository with one commit has nothing to compare against, and the
    pen must still show what is being judged rather than refusing."""
    repo = _repo(tmp_path)

    assert judge_module.base_ref(repo) == ""
    assert judge_module.shown(repo, "reads-well").state == judge_module.SHOWN


def test_NO_SHOW_COMMAND_MEANS_NO_BEFORE(tmp_path):
    repo = _repo(tmp_path)
    _work(repo)
    assert judge_module.shown_before(
        repo, "not-declared", judge_module.base_ref(repo)
    ).state == judge_module.MISSING
