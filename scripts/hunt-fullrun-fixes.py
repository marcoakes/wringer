"""Hunt the code this window added, by running it against unlucky repositories.

Every probe here asks what a HOSTILE or merely UNLUCKY filesystem does to the
new code — the standing question from the ALL IN window, where three crashes
came from an unlucky machine rather than an attacker.

    python3 hunt_myfixes.py <repo-with-the-venv>
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(sys.argv[1]) / "src"))

from wringer import doctor, loop  # noqa: E402
from wringer_drive import run as drive_run  # noqa: E402

FAILED: list[str] = []


def probe(name: str):
    def wrap(fn):
        try:
            fn()
            print(f"  ok    {name}")
        except Exception as exc:  # noqa: BLE001
            print(f"  FOUND {name}: {type(exc).__name__}: {exc}")
            FAILED.append(name)
        return fn
    return wrap


def a_repo(directory: Path, *, commit: bool = True) -> Path:
    subprocess.run(["git", "init", "-q", "-b", "main", "."], cwd=directory, check=True)
    for key, value in (("user.email", "h@e.invalid"), ("user.name", "h"),
                       ("commit.gpgsign", "false")):
        subprocess.run(["git", "config", key, value], cwd=directory, check=True)
    if commit:
        subprocess.run(
            ["git", "commit", "-q", "--allow-empty", "-m", "base"],
            cwd=directory, check=True,
        )
    return directory


with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)

    @probe("a tree fingerprint on a repo with NO COMMITS (unborn branch)")
    def _() -> None:
        where = a_repo(root / "unborn", commit=False) if (
            (root / "unborn").mkdir() or True
        ) else None
        (where / "a.py").write_text("x\n")
        first = loop._tree_fingerprint(where)
        (where / "a.py").write_text("y\n")
        assert first != loop._tree_fingerprint(where), (
            "an unborn branch fingerprints identically before and after an "
            "edit, so every turn in a fresh repo reads as having done nothing"
        )

    @probe("a tree fingerprint where an untracked path is a BROKEN SYMLINK")
    def _() -> None:
        (root / "broken").mkdir()
        where = a_repo(root / "broken")
        (where / "dangling").symlink_to(where / "nowhere")
        loop._tree_fingerprint(where)

    @probe("a tree fingerprint where an untracked path is a DIRECTORY symlink loop")
    def _() -> None:
        (root / "loopy").mkdir()
        where = a_repo(root / "loopy")
        (where / "self").symlink_to(where)
        loop._tree_fingerprint(where)

    @probe("a tree fingerprint on a NON-REPO directory")
    def _() -> None:
        plain = root / "plain"
        plain.mkdir()
        loop._tree_fingerprint(plain)

    @probe("command_owner on a shebang longer than the read window")
    def _() -> None:
        (root / "long").mkdir()
        shim = root / "long" / "wring"
        shim.write_text("#!/" + "a" * 9000 + "/bin/python\nprint(1)\n")
        doctor.command_owner(str(shim))

    @probe("command_owner on a binary shim (no shebang, invalid utf-8)")
    def _() -> None:
        (root / "binary").mkdir()
        shim = root / "binary" / "wring.exe"
        shim.write_bytes(b"MZ\x90\x00\xff\xfe\x00\x00")
        assert doctor.command_owner(str(shim)) is None

    @probe("command_owner on a shim that is a directory")
    def _() -> None:
        (root / "dir").mkdir()
        (root / "dir" / "wring").mkdir()
        assert doctor.command_owner(str(root / "dir" / "wring")) is None

    @probe("command_owner on an interpreter path containing a space")
    def _() -> None:
        (root / "spacey").mkdir()
        shim = root / "spacey" / "wring"
        shim.write_text("#!/Users/a b/venv/bin/python\n")
        owner = doctor.command_owner(str(shim))
        assert owner == "/Users/a b/venv/bin", (
            f"a space in the interpreter path truncated the owner to {owner!r}, "
            "so two different environments under it collapse into one and the "
            "mixture check goes blind"
        )

    @probe("keeping the board out of git when .gitignore is UNWRITABLE")
    def _() -> None:
        (root / "ro").mkdir()
        where = a_repo(root / "ro")
        ignore = where / ".gitignore"
        ignore.write_text("*.pyc\n")
        ignore.chmod(0o444)
        try:
            drive_run._keep_the_board_out_of_git(where)
        finally:
            ignore.chmod(0o644)

    @probe("keeping the board out of git in a NON-REPO directory")
    def _() -> None:
        plain = root / "notarepo"
        plain.mkdir()
        drive_run._keep_the_board_out_of_git(plain)
        assert not (plain / ".gitignore").exists(), (
            "a .gitignore was written into a directory with no git in it — "
            "`wring init` calls that litter and refuses to do it"
        )

    @probe("keeping the board out of git when the user NEGATED the ignore")
    def _() -> None:
        (root / "negated").mkdir()
        where = a_repo(root / "negated")
        original = "*.html\n!board.html\n"
        (where / ".gitignore").write_text(original)
        drive_run._keep_the_board_out_of_git(where)
        # git is last-match-wins, so appending anything after a negation
        # overrides it. The only safe act is to write nothing.
        assert (where / ".gitignore").read_text() == original, (
            "the operator deliberately un-ignored this file and this wrote "
            "past them: " + (where / ".gitignore").read_text()
        )
        # And the negation still decides, which is the fact that made the
        # append wrong. `check-ignore -v` exits 0 for a NEGATION match too, so
        # the pattern it names is what has to be read, not the exit code.
        shown = subprocess.run(
            ["git", "check-ignore", "-v", "--no-index", "board.html"],
            cwd=where, capture_output=True, text=True,
        )
        assert "!board.html" in shown.stdout, (
            "board.html is ignored despite the operator's negation: "
            + shown.stdout.strip()
        )

print()
if FAILED:
    print(f"{len(FAILED)} probe(s) found something: {', '.join(FAILED)}")
    raise SystemExit(1)
print("nothing found")
