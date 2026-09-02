"""**0.7.5 — worker logs sanitised completely, measured through `wring run`.**

Run 4B, 2026-09-01, codex on a clean machine: the vendor rejected a dead
Platform key and its own `401` echoed `sk-proj-`, a run of `*` and the
key's LAST FOUR characters into `worker.stderr.log` — 45 lines of one log
carried that shape — and since 0.6.7 those same words travel to the stop
line, the drive's step and `worker-diagnosis.json`. The redactor owned none
of those bytes: none of them was the declared value.

Every test here plants a fake key under a declared name, runs a REAL fake
worker on `PATH` that echoes it the ways a vendor does — whole, masked, and
wrapped across two lines — through the real `wring run`, and then walks
every file under `.wringer/` and the console for any six-character run of
it. The forgery control runs the same worker with nothing to scrub and
asserts its log came back byte-identical, because a tier that eats prose
is a redactor that destroys the evidence it protects.

Never a real key. `SECRET` is a fixture and is shaped like one on purpose.
"""

from __future__ import annotations

import os
import stat
import sys
from pathlib import Path

from core_helpers import flat

from wringer import cli, config, loop, redact

#: A fake with a vendor's shape, because run 4B's echo kept the shape.
SECRET = "sk-proj-Qm7Vx2Lp9Rt4Wn8Yb3Kc6Hd1Fg5Jz0iW0W"
#: The plan's masked form: first three, an ellipsis, last four.
MASKED = f"{SECRET[:3]}…{SECRET[-4:]}"
#: Run 4B's measured form: the first eight, a run of `*`, the last four.
ECHOED = f"{SECRET[:8]}{'*' * 24}...{SECRET[-4:]}"
#: A token nobody declared, shaped like a key.
UNDECLARED = "sk-proj-NEVERDECLARED0000111122223333"

GATE = (
    "version: 1\n"
    "gates:\n"
    "  - id: fixed\n"
    '    run: "grep -q FIXED calc.txt"\n'
    "run:\n"
    '  worker: "leaky {brief}"\n'
    "  worker_timeout: 30\n"
)


def leaky_worker(directory: Path, stderr_lines: list[str], stdout_lines: list[str]):
    """A real executable on PATH that prints what it was told to and exits 1.

    Exit 1 and no edit, so the turn is a FAILED empty turn: the shape whose
    words travel furthest (`diagnose_failed_shell_turn`, 0.6.7).
    """
    directory.mkdir(exist_ok=True)
    path = directory / "leaky"
    body = ["#!" + sys.executable, "import sys"]
    for line in stderr_lines:
        body.append(f"sys.stderr.write({line + chr(10)!r})")
    for line in stdout_lines:
        body.append(f"sys.stdout.write({line + chr(10)!r})")
    body.append("raise SystemExit(1)")
    path.write_text("\n".join(body) + "\n", encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return path


def arrange(repo: Path, monkeypatch, stderr_lines, stdout_lines=()) -> None:
    (repo / "calc.txt").write_text("BROKEN\n", encoding="utf-8")
    (repo / config.CONFIG_FILENAME).write_text(GATE, encoding="utf-8")
    leaky_worker(repo / "bin", list(stderr_lines), list(stdout_lines))
    monkeypatch.setenv("PATH", f"{repo / 'bin'}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.chdir(repo)


def only_loop(repo: Path) -> Path:
    entries = sorted((repo / ".wringer" / "loops").iterdir())
    assert len(entries) == 1, entries
    return entries[0]


def six_character_runs(secret: str, root: Path, console: str) -> list[str]:
    """Every file under `.wringer/` and the console, for any six-character
    window of the secret. A list, so the failure names where it survived."""
    windows = {secret[i : i + 6] for i in range(len(secret) - 5)}
    found = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        data = path.read_bytes()
        hit = next((w for w in sorted(windows) if w.encode() in data), None)
        if hit is not None:
            found.append(f"{path.relative_to(root)}: {hit!r}")
    hit = next((w for w in sorted(windows) if w in console), None)
    if hit is not None:
        found.append(f"console: {hit!r}")
    return found


def test_a_key_echoed_WHOLE_leaves_no_six_character_run_anywhere(
    repo, monkeypatch, capsys
):
    monkeypatch.setenv("WRINGER_TEST_API_KEY", SECRET)
    arrange(repo, monkeypatch, [f"401 Incorrect API key provided: {SECRET}"])

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    captured = capsys.readouterr()
    console = captured.out + captured.err

    assert six_character_runs(SECRET, repo / ".wringer", console) == []
    # The words around the key travelled — this is not a silent worker.
    assert "Incorrect API key provided" in flat(console), console
    assert redact.PLACEHOLDER in flat(console)


def test_a_key_echoed_MASKED_the_way_a_vendor_masks_it_is_gone(
    repo, monkeypatch, capsys
):
    """Run 4B's shape verbatim in form (`sk-proj-` + `*`s + last four), and
    the first-three/last-four form. Neither contains six characters of the
    key in a row, so only the SHAPE tier can take them — and it must."""
    monkeypatch.setenv("WRINGER_TEST_API_KEY", SECRET)
    arrange(
        repo,
        monkeypatch,
        [f"401 Incorrect API key provided: {ECHOED} invalid_api_key"],
        [f"the service said {MASKED}"],
    )

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    captured = capsys.readouterr()
    console = captured.out + captured.err

    assert six_character_runs(SECRET, repo / ".wringer", console) == []
    survivors = []
    for path in sorted((repo / ".wringer").rglob("*")):
        if path.is_file():
            text = path.read_text(encoding="utf-8", errors="replace")
            for form in (ECHOED, MASKED, SECRET[-4:]):
                if form in text:
                    survivors.append(f"{path.relative_to(repo)}: {form!r}")
    for form in (ECHOED, MASKED, SECRET[-4:]):
        if form in console:
            survivors.append(f"console: {form!r}")
    assert survivors == [], survivors
    assert "invalid_api_key" in flat(console)


def test_a_key_WRAPPED_ACROSS_TWO_LINES_leaves_no_six_character_run(
    repo, monkeypatch, capsys
):
    """Each half is a fragment, neither is the value, and the shape tier
    sees only the head — the tail is the FRAGMENT tier's alone."""
    monkeypatch.setenv("WRINGER_TEST_API_KEY", SECRET)
    arrange(repo, monkeypatch, [f"key: {SECRET[:19]}", f"  {SECRET[19:]}"])

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    captured = capsys.readouterr()
    console = captured.out + captured.err

    assert six_character_runs(SECRET, repo / ".wringer", console) == []
    log = only_loop(repo) / "iterations" / "001" / "worker.stderr.log"
    assert log.is_file(), sorted(str(p) for p in only_loop(repo).rglob("*"))
    assert log.read_text(encoding="utf-8").count(redact.PLACEHOLDER) == 2


def test_a_VENDOR_SHAPED_token_nobody_declared_is_scrubbed_from_the_log(
    repo, monkeypatch, capsys
):
    """No declared value at all. The shape alone decides."""
    monkeypatch.delenv("WRINGER_TEST_API_KEY", raising=False)
    arrange(repo, monkeypatch, [f"found in a file: {UNDECLARED}"])

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    captured = capsys.readouterr()
    console = captured.out + captured.err

    log = only_loop(repo) / "iterations" / "001" / "worker.stderr.log"
    assert UNDECLARED not in log.read_text(encoding="utf-8")
    assert UNDECLARED not in console
    record = only_loop(repo) / loop.WORKER_DIAGNOSIS_FILENAME
    assert UNDECLARED not in record.read_text(encoding="utf-8")
    assert f"found in a file: {redact.PLACEHOLDER}" in flat(console), console


def test_ORDINARY_OUTPUT_comes_back_BYTE_IDENTICAL(repo, monkeypatch, capsys):
    """The forgery control, and the six-character floor measured live: a
    five-character head and tail of the declared key are words and survive,
    as do `task-`, `risk-` and a bare `sk-`."""
    monkeypatch.setenv("WRINGER_TEST_API_KEY", SECRET)
    lines = [
        f"head {SECRET[:5]} tail {SECRET[-5:]} bare sk- and sk-pr",
        "task-1234 done; risk-based; desk-99; 401 Unauthorized invalid_api_key",
    ]
    arrange(repo, monkeypatch, lines)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    log = only_loop(repo) / "iterations" / "001" / "worker.stderr.log"
    assert log.read_bytes() == ("\n".join(lines) + "\n").encode()
