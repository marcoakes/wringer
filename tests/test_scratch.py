"""`scripts/scratch.sh` — the one line in this repo that deletes things.

Five scripts source it and point `rm -rf` or `find -delete` at what it
returns. It shipped in the first pass with no tests at all, and the bug that
found is the reason this file exists: the original tried to be safe by
*refusing* dangerous answers, which is a blacklist over unnormalised path
strings, and blacklists over unnormalised strings lose.

    scratch_dir "//"        -> /              exit 0
    scratch_dir "$HOME//"   -> /Users/marc/   exit 0
    scratch_dir "$HOME/."   -> /Users/marc/.  exit 0

All three were live recursive deletes. The `/*` branch stripped exactly one
trailing slash *after* the `case` had already decided the path was fine, so a
second slash both dodged the literal-match arm and was then removed.

The rewrite does not judge answers, it constructs them: the leaf is always
`wringer-<name>`, chosen by the function. These tests hold that property
against every spelling anyone has thought of, because the property is the
only reason the delete is safe.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

SCRATCH = Path(__file__).resolve().parent.parent / "scripts" / "scratch.sh"

# These guard the repository's own shell scripts, which the sdist does not
# ship — a packager running the packed suite must not fail over a developer
# tool that was never in their tarball. In a checkout the file is always
# there, so the guard never silently disappears where it matters.
pytestmark = pytest.mark.skipif(
    not SCRATCH.is_file(), reason="scripts/ is not part of the distribution"
)


def scratch_dir(base: str, name: str = "probe", env: dict | None = None):
    """Call the real shell function. Returns (exit_code, stdout)."""
    proc = subprocess.run(
        ["sh", "-c", '. "$1"; scratch_dir "$2" "$3"', "sh", str(SCRATCH), base, name],
        capture_output=True,
        text=True,
        env=env,
    )
    return proc.returncode, proc.stdout.strip()


# Every spelling of a path you must never hand to `rm -rf`, including the
# three that defeated the first version.
DANGEROUS_BASES = [
    "/",
    "//",
    "///",
    "/.",
    "/..",
    "/../..",
    "$HOME",
    "$HOME/",
    "$HOME//",
    "$HOME/.",
    "$HOME/..",
    "/Users",
    "/etc",
]


@pytest.mark.parametrize("base", DANGEROUS_BASES)
def test_the_result_always_ends_in_a_directory_we_named(base: str, monkeypatch):
    """The whole safety argument in one assertion.

    Whatever the base, the thing that gets deleted is a directory called
    `wringer-<name>`. It does not matter whether the base was sane, because
    the base is never the delete target.
    """
    home = str(Path.home())
    code, out = scratch_dir(base.replace("$HOME", home))

    if code != 0:
        return  # refusing outright is also a correct answer
    assert out.endswith("/wringer-probe"), (
        f"scratch_dir({base!r}) returned {out!r}, whose final component is "
        "not one this function chose — a recursive delete points here"
    )
    # The parent may be anything; the target may never BE the parent.
    assert out not in ("/", home, f"{home}/"), out
    assert Path(out).name == "wringer-probe"


def test_the_original_three_bypasses_are_dead():
    """Named explicitly so a future refactor cannot quietly reopen them."""
    home = str(Path.home())
    for base in ("//", f"{home}//", f"{home}/."):
        code, out = scratch_dir(base)
        assert code != 0 or out.endswith("/wringer-probe"), (
            f"scratch_dir({base!r}) -> {out!r}: this exact input returned a "
            "live rm -rf target in the first version of this file"
        )
        assert out not in ("/", home, f"{home}/", f"{home}/."), out


def test_the_default_is_tmpdir():
    code, out = scratch_dir("", "setup-selftest")
    assert code == 0
    assert out.endswith("/wringer-setup-selftest")
    assert out.startswith("/")


def test_it_falls_back_to_tmp_with_no_tmpdir():
    import os

    env = {k: v for k, v in os.environ.items() if k != "TMPDIR"}
    code, out = scratch_dir("", "demo", env=env)
    assert code == 0
    assert out == "/tmp/wringer-demo"


def test_a_relative_base_is_refused():
    """Relative would put the tree under the caller's cwd, which for these
    scripts is usually the repo itself."""
    code, out = scratch_dir("relative/path")
    assert code == 2, out


@pytest.mark.parametrize("name", ["..", "a/b", "../../etc", "has space", "x;rm"])
def test_a_name_that_is_not_one_path_component_is_refused(name: str):
    """The name becomes a path component, so it may not contain one — a
    caller passing `../..` would otherwise walk the leaf back out."""
    code, _ = scratch_dir("/tmp", name)
    assert code == 2


def test_a_missing_name_aborts_rather_than_guessing():
    """`${2:?}` kills the subshell instead of returning 2. That is louder,
    not weaker: the caller's `WORK=$(scratch_dir …) || exit 2` still fires,
    and a scratch tree named after nothing never gets built."""
    code, out = scratch_dir("/tmp", "")
    assert code != 0
    assert not out


# A deleting script that does NOT use `scratch_dir`, with the reason it is
# safe anyway — and the reason has to be MECHANICAL, because a sentence in a
# dict is not a constraint. Each entry names the fixed root the script
# deletes under, and the guard below checks the script really does root
# every deletion there and really does refuse a name that could climb out.
_NOT_A_SCRATCH_TREE: dict[str, str] = {
    "repo-lock.sh": (
        "the lock must live under .git/ — a lock in the working tree would "
        "be swept into a commit by the very `git add -A` it makes safe — so "
        "it cannot be a scratch tree. The same constraint is provided in "
        "the same shape: one fixed root, and a <name> validated as a single "
        "path segment before it is joined."
    ),
}


def test_every_caller_uses_it():
    """A script that computes its own scratch path is outside this safety
    argument entirely, which is how the last five got it wrong."""
    scripts = sorted((SCRATCH.parent).glob("*.sh"))
    deleters = [
        path
        for path in scripts
        if path.name != "scratch.sh"
        and any(
            token in path.read_text(encoding="utf-8")
            for token in ("rm -rf", "-delete")
        )
    ]
    assert deleters, "no deleting scripts found — this guard is not guarding"
    for path in deleters:
        text = path.read_text(encoding="utf-8")
        if path.name in _NOT_A_SCRATCH_TREE:
            continue
        assert "scratch_dir" in text, (
            f"{path.name} deletes recursively but does not use scratch_dir, "
            f"so nothing constrains what it deletes. If it genuinely cannot "
            f"use one, add it to _NOT_A_SCRATCH_TREE WITH A REASON — and the "
            f"exemption is checked, not taken on trust"
        )


@pytest.mark.parametrize("name", sorted(_NOT_A_SCRATCH_TREE))
def test_an_EXEMPT_deleter_still_ROOTS_and_VALIDATES_what_it_removes(name):
    """**An exemption with a prose reason and nothing behind it is a hole.**

    `repo-lock.sh` (0.9.1) cannot use a scratch tree — its lock has to be
    under `.git/`, or `git add -A` would sweep a held lock into a commit,
    which is the defect the lock exists to prevent wearing a hat. That is a
    real reason, and on its own it buys nothing: what made `scratch_dir`
    safe was a fixed root plus a name that cannot climb out of it, and the
    exemption is only sound if the script provides both itself.

    So the reason is checked. Every recursive delete in an exempt script
    must be rooted at a variable, and the script must refuse a name carrying
    a path separator — the `../..` walk-out `scratch_dir` refuses.
    """
    path = SCRATCH.parent / name
    if not path.is_file():
        pytest.skip(f"{name} is not part of this checkout")
    text = path.read_text(encoding="utf-8")

    removes = re.findall(r"rm -rf ([^\s;|&]+)", text)
    assert removes, f"{name} is exempt from scratch_dir but deletes nothing"
    for target in removes:
        assert target.startswith(('"$', "$")), (
            f"{name} runs `rm -rf {target}` against a literal path — an "
            "exempt deleter must root every removal at a computed variable"
        )

    assert re.search(r"case\s+\"\$\w+\"\s+in", text) and "*/*" in text, (
        f"{name} never refuses a <name> containing a path separator, so a "
        "caller passing '../..' walks the delete out of its root"
    )
