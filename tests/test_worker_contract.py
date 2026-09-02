"""The worker contract (0.6.0): brief transport, auth state, termination.

Run 3 — the codex blind test, 2026-08-31 — measured what the absence of a
contract costs, end to end and on a real account: a published worker command
with no brief channel sat on an inherited terminal for fifteen minutes per
iteration (F5), nothing validated that a channel existed (F6), a dead env key
silently displaced a working login (F7), the documented command could not
edit a file (F8), and a shell worker's auth state arrived as None so the run
path said nothing at all (F10).

Everything here drives the REAL commands — `cli.main`, `loop.run`,
`bench.preflight` — with real fake executables on PATH, per the
test_worker_auth.py pattern: a patched subprocess would answer none of the
questions these exist to ask.
"""

from __future__ import annotations

import json
import os
import re
import stat
import sys
from pathlib import Path

import pytest
from core_helpers import flat

from wringer import bench, cli, config, diagnose, gates, loop, worker_auth

REPO_ROOT = Path(__file__).resolve().parent.parent
VENDORS_PAGE = REPO_ROOT / "docs" / "vendors.md"


def fake_vendor(directory: Path, name: str) -> Path:
    """A fake vendor CLI: answers its login probe, banks its brief, edits.

    One body for every vendor, because the harness measures WRINGER'S side
    of the contract — that the brief really arrives through the published
    command shape, that an edit really lands, that the process really ends.
    The vendor's own binary is deliberately not run: that spends somebody's
    account, and it is run 4's canary, not CI's.

    What it does: `login status` answers logged-in (so the auth preflight is
    exercised and passes); any other invocation writes its LAST argv — which
    is where every published shell recipe puts the brief — into
    `received.txt`, writes FIXED into `calc.txt` (the edit the gate wants),
    and exits 0.
    """
    path = directory / name
    path.write_text(
        f"#!{sys.executable}\n"
        "import sys\n"
        "if sys.argv[1:3] == ['login', 'status']:\n"
        "    print('Logged in using ChatGPT')\n"
        "    raise SystemExit(0)\n"
        "open('received.txt', 'w').write(sys.argv[-1] if len(sys.argv) > 1 else '')\n"
        "open('calc.txt', 'w').write('FIXED\\n')\n",
        encoding="utf-8",
    )
    path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return path


GATE = (
    "version: 1\n"
    "gates:\n"
    "  - id: fixed\n"
    '    run: "grep -q FIXED calc.txt"\n'
)


def a_broken_repo(repo: Path) -> Path:
    (repo / "calc.txt").write_text("BROKEN\n", encoding="utf-8")
    return repo


def only_loop(repo: Path) -> Path:
    entries = sorted((repo / ".wringer" / "loops").iterdir())
    assert len(entries) == 1, f"expected exactly one loop, found {entries}"
    return entries[0]


def shell_recipes() -> list[str]:
    """Every shell worker command the vendors page publishes, verbatim.

    DERIVED from the page, the `WELL_KNOWN_KEY_ENVS` guard's rule: the page
    is the source, and a recipe added there is exercised here the same day
    or this fails to find a fake for its binary.
    """
    text = VENDORS_PAGE.read_text(encoding="utf-8")
    section = text.split("## The worker commands", 1)[1]
    section = section.split("\n## ", 1)[0]
    found = []
    for line in section.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 3 and "shell" in cells[1]:
            command = cells[2].strip("`")
            if command:
                found.append(command)
    assert found, "the vendors page lists no shell recipes — the parse broke"
    return found


# --- the capability stamp: every published recipe, proven mechanically ------


@pytest.mark.parametrize("recipe", shell_recipes(), ids=lambda r: r.split()[0])
def test_EVERY_PUBLISHED_SHELL_RECIPE_briefs_edits_and_terminates(
    repo, monkeypatch, capsys, recipe
):
    """The stamp on the vendors page, earned rather than asserted (F5/F8).

    Run 3's finding, verbatim: "The census measured codex as an AGENT; it did
    not measure that string as a WRINGER WORKER." So every shell row the page
    publishes is here declared as `run.worker` in a real repo and driven
    through the real `wring run` — with a fake standing in for the vendor's
    binary — and must show all three capabilities the stamp names: the brief
    RECEIVED (the fake banks its last argv, and it must be the brief's own
    text), the repo EDITED (the gate goes green on the fake's write), and the
    turn TERMINATED (the loop converges rather than riding the timeout).
    """
    a_broken_repo(repo)
    binary = recipe.split()[0]
    fake_vendor(repo / "bin", binary) if (repo / "bin").mkdir() is None else None
    monkeypatch.setenv("PATH", f"{repo / 'bin'}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.delenv("CODEX_API_KEY", raising=False)
    monkeypatch.delenv("KIMI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    (repo / config.CONFIG_FILENAME).write_text(
        GATE + f"run:\n  worker: '{recipe}'\n  worker_timeout: 30\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK, capsys.readouterr().out
    capsys.readouterr()

    received = (repo / "received.txt").read_text(encoding="utf-8")
    brief = (
        only_loop(repo) / "iterations" / "001" / "brief.md"
    ).read_text(encoding="utf-8")
    assert received.strip() == brief.strip(), (
        "the worker did not receive the brief's text through this recipe — "
        "the stamp on the vendors page would be a lie"
    )
    assert "FIXED" in (repo / "calc.txt").read_text(encoding="utf-8")


def test_the_exec_form_hands_the_brief_text_as_one_argv_element(
    repo, monkeypatch, capsys
):
    """The declarative form's `argument` transport — the same bytes the shell
    form's `"$(cat {brief})"` reads, without a shell in between."""
    a_broken_repo(repo)
    (repo / "bin").mkdir()
    fake_vendor(repo / "bin", "codex")
    monkeypatch.setenv("PATH", f"{repo / 'bin'}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.delenv("CODEX_API_KEY", raising=False)
    (repo / config.CONFIG_FILENAME).write_text(
        GATE
        + "run:\n"
        "  worker:\n"
        "    exec:\n"
        '      argv: ["codex", "exec", "--json", "{brief}"]\n'
        "      brief: argument\n"
        "  worker_timeout: 30\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK, capsys.readouterr().out
    capsys.readouterr()

    received = (repo / "received.txt").read_text(encoding="utf-8")
    brief = (
        only_loop(repo) / "iterations" / "001" / "brief.md"
    ).read_text(encoding="utf-8")
    assert received == brief, (
        "under `brief: argument` the {brief} element must carry the brief's "
        "exact text"
    )
    # And the ledger records the PATH, never the text: a worker.started line
    # quoting kilobytes of prose describes the run worse than the path to
    # the same bytes one directory over.
    events = (only_loop(repo) / "loop.jsonl").read_text(encoding="utf-8")
    started = next(
        json.loads(line)
        for line in events.splitlines()
        if '"worker.started"' in line
    )
    assert "brief.md" in started["command"]
    assert brief[:80] not in started["command"]


def test_the_exec_form_can_hand_the_brief_as_a_path(repo, monkeypatch, capsys):
    a_broken_repo(repo)
    (repo / "bin").mkdir()
    fake_vendor(repo / "bin", "codex")
    monkeypatch.setenv("PATH", f"{repo / 'bin'}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.delenv("CODEX_API_KEY", raising=False)
    (repo / config.CONFIG_FILENAME).write_text(
        GATE
        + "run:\n"
        "  worker:\n"
        "    exec:\n"
        '      argv: ["codex", "{brief}"]\n'
        "      brief: path\n"
        "  worker_timeout: 30\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK, capsys.readouterr().out
    capsys.readouterr()

    received = Path((repo / "received.txt").read_text(encoding="utf-8"))
    assert received.name == "brief.md" and received.is_absolute()


# --- worker_unbriefable: refused for the price of a string check ------------


def test_wring_run_REFUSES_an_unbriefable_worker_before_anything_exists(
    repo, monkeypatch, capsys
):
    """F5/F6's taken path: the run that would have sat in silence for
    fifteen minutes per iteration is now a refusal that costs nothing and
    leaves nothing behind."""
    a_broken_repo(repo)
    (repo / config.CONFIG_FILENAME).write_text(
        GATE + 'run:\n  worker: "codex exec --json -"\n', encoding="utf-8"
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_CONFIG

    said = capsys.readouterr().err
    assert "no channel for the brief" in said
    assert "{brief}" in said
    assert not (repo / ".wringer" / "loops").exists(), (
        "a refused loop must leave nothing behind"
    )


def test_wring_resume_asks_the_same_question(repo, monkeypatch, capsys):
    a_broken_repo(repo)
    (repo / config.CONFIG_FILENAME).write_text(
        GATE + 'run:\n  worker: "codex exec --json -"\n', encoding="utf-8"
    )
    monkeypatch.chdir(repo)

    assert cli.main(["resume"]) == cli.EXIT_CONFIG
    assert "no channel for the brief" in capsys.readouterr().err


def test_a_bench_with_an_unbriefable_contender_measures_nothing(repo):
    """A row for a worker that was never briefed is a measurement of
    nothing, presented beside real ones — refused like an absent binary."""
    with pytest.raises(bench.BenchError) as caught:
        bench.preflight(
            (
                config.Contender(id="mute", worker="codex exec --json -"),
                config.Contender(id="fine", worker='sh fix.sh "$(cat {brief})"'),
            )
        )
    assert "mute" in str(caught.value)
    assert "{brief}" in str(caught.value)
    assert "fine" not in str(caught.value)


def test_the_exec_form_cannot_even_be_written_without_a_brief_channel(tmp_path):
    """Parse-time, because the declarative form is NEW: no existing config
    can break, so the contract is enforced where the author is looking."""
    path = tmp_path / config.CONFIG_FILENAME
    path.write_text(
        GATE
        + "run:\n"
        "  worker:\n"
        "    exec:\n"
        '      argv: ["codex", "exec"]\n'
        "      brief: argument\n",
        encoding="utf-8",
    )
    with pytest.raises(config.ConfigError) as caught:
        config.load(path)
    assert "{brief}" in str(caught.value)


def test_the_exec_form_requires_its_transport_spelled_out(tmp_path):
    path = tmp_path / config.CONFIG_FILENAME
    path.write_text(
        GATE
        + "run:\n"
        "  worker:\n"
        "    exec:\n"
        '      argv: ["codex", "{brief}"]\n',
        encoding="utf-8",
    )
    with pytest.raises(config.ConfigError) as caught:
        config.load(path)
    assert "brief" in str(caught.value)
    assert "no default" in str(caught.value)


# --- worker_auth_rejected: the vendor's own definite no, before spend -------


def test_a_codex_worker_with_no_login_and_no_key_is_REFUSED_before_spend(
    repo, monkeypatch, capsys
):
    """F7/F10's taken path, the shell lane: the vendor's own status command
    says "Not logged in", no key is set, so there is nothing this run could
    spend against — refused for free, before the first gate."""
    a_broken_repo(repo)
    (repo / "bin").mkdir()
    signed_out = repo / "bin" / "codex"
    signed_out.write_text(
        f"#!{sys.executable}\n"
        "import sys\n"
        "print('Not logged in')\n"
        "raise SystemExit(1)\n",
        encoding="utf-8",
    )
    signed_out.chmod(signed_out.stat().st_mode | stat.S_IEXEC | stat.S_IXOTH)
    monkeypatch.setenv("PATH", f"{repo / 'bin'}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.delenv("CODEX_API_KEY", raising=False)
    (repo / config.CONFIG_FILENAME).write_text(
        GATE + "run:\n  worker: 'codex exec \"$(cat {brief})\"'\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_CONFIG

    said = capsys.readouterr().err
    assert "Not logged in" in said, "the vendor's own words must lead"
    assert "codex login" in said
    assert "CODEX_API_KEY" in said
    assert not (repo / ".wringer" / "loops").exists()


def test_a_SET_KEY_never_reads_as_a_green_and_the_displacement_is_named(
    repo, monkeypatch, capsys
):
    """F7's exact shape: a working login, and a key exported beside it. The
    key is what the turn will spend against (measured precedence), its
    validity is unknowable from here — so the state is UNKNOWN with the
    displacement named, never `verified` on the strength of the login the
    key displaces."""
    a_broken_repo(repo)
    (repo / "bin").mkdir()
    fake_vendor(repo / "bin", "codex")
    monkeypatch.setenv("PATH", f"{repo / 'bin'}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("CODEX_API_KEY", "sk-proj-notarealkey")
    (repo / config.CONFIG_FILENAME).write_text(
        GATE + "run:\n  worker: 'codex exec \"$(cat {brief})\"'\n"
        "  worker_timeout: 30\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    said = capsys.readouterr().out

    assert "worker auth: unknown" in said
    assert "takes precedence over the stored login" in said
    assert "presence is not validity" in said.lower()


def test_the_verified_state_is_RENDERED_on_the_run_path_before_spend(
    repo, monkeypatch, capsys
):
    """F10's fix, positive half: silence no longer reads as success — the
    typed state is a line the operator sees before iteration 1."""
    a_broken_repo(repo)
    (repo / "bin").mkdir()
    fake_vendor(repo / "bin", "codex")
    monkeypatch.setenv("PATH", f"{repo / 'bin'}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.delenv("CODEX_API_KEY", raising=False)
    (repo / config.CONFIG_FILENAME).write_text(
        GATE + "run:\n  worker: 'codex exec \"$(cat {brief})\"'\n"
        "  worker_timeout: 30\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    said = capsys.readouterr().out

    assert "worker auth: verified" in said
    assert "Logged in using ChatGPT" in said, "the vendor's own words travel"
    assert said.index("worker auth:") < said.index("iteration 1"), (
        "the state must render BEFORE the first spend, not after"
    )


def test_a_plain_shell_worker_renders_NOT_APPLICABLE_never_silence(
    repo, monkeypatch, capsys
):
    a_broken_repo(repo)
    (repo / config.CONFIG_FILENAME).write_text(
        GATE + "run:\n  worker: 'sh -c \"echo FIXED > calc.txt\" - {brief}'\n"
        "  worker_timeout: 30\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    said = capsys.readouterr().out

    assert "worker auth: not applicable" in said
    assert "authenticates on its own account" in said


# --- worker_read_only: the stop that carries the worker's own words ---------


def test_a_clean_turn_that_wrote_nothing_stops_WORKER_READ_ONLY_with_words(
    repo, monkeypatch, capsys
):
    """F8's taken path: run 3's read-only codex turn, replayed in miniature.
    The worker completes, explains itself on stdout, and writes nothing —
    the stop names the shape and the worker's own words travel in the
    record instead of sitting unquoted in a log."""
    a_broken_repo(repo)
    (repo / config.CONFIG_FILENAME).write_text(
        GATE
        + "run:\n"
        "  worker: ': {brief}; echo \"blocked by a read-only policy\"'\n"
        "  worker_timeout: 30\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    said = capsys.readouterr().out

    assert "read-only turn" in said
    # `flat`, the repo's own rule: never assert on where the wrapper chose
    # to break a line.
    assert "blocked by a read-only policy" in flat(said), (
        "the worker's own words must reach the operator, not only the log"
    )
    record = only_loop(repo) / loop.WORKER_DIAGNOSIS_FILENAME
    assert record.is_file()
    payload = json.loads(record.read_text(encoding="utf-8"))
    assert payload["face"] == diagnose.FACE_TURN_CHANGED_NOTHING
    assert "blocked by a read-only policy" in payload["engine_words"]
    manifest = json.loads(
        (only_loop(repo) / "manifest.json").read_text(encoding="utf-8")
    )
    assert manifest["result"]["reason"] == loop.WORKER_READ_ONLY


def test_a_FAILED_empty_turn_keeps_no_progress_because_read_only_would_claim(
    repo, monkeypatch, capsys
):
    """The refinement's boundary, red-watched from the other side: a turn
    that FAILED and changed nothing is not a read-only turn, and naming it
    one would claim a shape the facts do not show."""
    a_broken_repo(repo)
    (repo / config.CONFIG_FILENAME).write_text(
        GATE
        + "run:\n"
        "  worker: ': {brief}; echo tried >&2; exit 1'\n"
        "  worker_timeout: 30\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    manifest = json.loads(
        (only_loop(repo) / "manifest.json").read_text(encoding="utf-8")
    )
    assert manifest["result"]["reason"] == "no_progress"


def test_a_MUTE_clean_turn_keeps_no_progress_too(repo, monkeypatch, capsys):
    """No words, no read-only claim: a worker that said nothing left nothing
    to carry, and `no_progress` is the honest name for that silence."""
    a_broken_repo(repo)
    (repo / config.CONFIG_FILENAME).write_text(
        GATE + "run:\n  worker: ': {brief}'\n  worker_timeout: 30\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    manifest = json.loads(
        (only_loop(repo) / "manifest.json").read_text(encoding="utf-8")
    )
    assert manifest["result"]["reason"] == "no_progress"


# --- non-interactive termination: stdin is closed, structurally -------------


def test_a_worker_that_waits_on_stdin_terminates_instead_of_hanging():
    """F5's mechanism, tested at the seam: the worker's stdin is /dev/null,
    so a command that reads it gets EOF now rather than a terminal to wait
    on for fifteen minutes.

    The parent's own fd 0 is replaced with a PIPE for the duration — the
    shape an interactive terminal has from a child's point of view — because
    under pytest and most CI, fd 0 is already /dev/null and a revert of the
    fix would otherwise stay green for the wrong reason.
    """
    read_end, write_end = os.pipe()
    saved = os.dup(0)
    os.dup2(read_end, 0)
    try:
        import tempfile

        with tempfile.TemporaryDirectory() as scratch:
            result = gates.run(
                config.Gate(
                    id="worker",
                    run=(
                        'python3 -c "import sys; '
                        "sys.exit(0 if sys.stdin.read() == '' else 3)\""
                    ),
                    timeout=10,
                ),
                cwd=Path(scratch),
                stdout_path=Path(scratch) / "out.log",
                stderr_path=Path(scratch) / "err.log",
                closed_stdin=True,
            )
    finally:
        os.dup2(saved, 0)
        os.close(saved)
        os.close(read_end)
        os.close(write_end)

    assert not result.timed_out, (
        "the worker waited on stdin — the contract's termination leg is off"
    )
    assert result.exit_code == 0, (
        "the worker read something from stdin; it must read EOF from "
        "/dev/null and nothing else"
    )


# --- the roster rows are measured, not invented -----------------------------


def test_the_codex_roster_row_matches_what_the_page_documents():
    """The vendors page and the roster may never disagree about the codex
    lane — the F4 disease was one line serving two lanes; the cure must not
    become two sources serving one lane."""
    from wringer import agents

    vendor = agents.shell_vendor_by_command("codex")
    assert vendor is not None
    assert vendor.key_env == "CODEX_API_KEY"
    assert vendor.login_probe == ("login", "status")
    assert vendor.login_command == "codex login"
    page = VENDORS_PAGE.read_text(encoding="utf-8")
    assert "codex login status" in page
    assert "CODEX_API_KEY" in page


def test_every_run_refusal_reason_is_declared_exactly_once():
    assert len(set(loop.RUN_REFUSAL_REASONS)) == len(loop.RUN_REFUSAL_REASONS)
    for reason in loop.RUN_REFUSAL_REASONS:
        assert re.fullmatch(r"[a-z][a-z_]*", reason)


# --- 0.6.7, run 4B: a FAILED shell turn carries the worker's words ----------


def test_a_FAILED_shell_turn_carries_the_workers_own_words_to_the_stop(
    repo, monkeypatch, capsys
):
    """Run 4B, 2026-09-01: codex exited 1 on a dead Platform key, its output
    carried `401 invalid_api_key`, and the operator read only "an attempt
    changed nothing at all" — the actionable line sat in the worker log.
    The reason stays `no_progress` (the fact); the words now travel with it,
    to the console and to the loop's own record."""
    a_broken_repo(repo)
    (repo / config.CONFIG_FILENAME).write_text(
        GATE
        + "run:\n"
        "  worker: ': {brief}; echo \"ERROR: HTTP 401 invalid_api_key\" >&2; "
        "exit 1'\n"
        "  worker_timeout: 30\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    said = flat(capsys.readouterr().out)

    assert "401 invalid_api_key" in said, (
        "the worker's own refusal must reach the operator, not only the log"
    )
    assert "exit 1" in said
    record = only_loop(repo) / loop.WORKER_DIAGNOSIS_FILENAME
    assert record.is_file(), "a failed turn wrote no diagnosis"
    payload = json.loads(record.read_text(encoding="utf-8"))
    assert payload["face"] == diagnose.FACE_TURN_REFUSED
    assert "401 invalid_api_key" in payload["engine_words"]
    assert "401 invalid_api_key" in payload["description"]
    manifest = json.loads(
        (only_loop(repo) / "manifest.json").read_text(encoding="utf-8")
    )
    assert manifest["result"]["reason"] == "no_progress"


def test_the_failed_shell_diagnosis_routes_on_facts_never_text():
    """Exit 0 is the read-only sibling's; a timeout is its own ending; a
    changed tree did something. Only a non-zero, non-timeout, empty turn
    composes — and the words are carried, never read."""
    assert diagnose.diagnose_failed_shell_turn(
        exit_code=0, timed_out=False, changed_tree=False, engine_words="x"
    ) is None
    assert diagnose.diagnose_failed_shell_turn(
        exit_code=1, timed_out=True, changed_tree=False, engine_words="x"
    ) is None
    assert diagnose.diagnose_failed_shell_turn(
        exit_code=1, timed_out=False, changed_tree=True, engine_words="x"
    ) is None
    found = diagnose.diagnose_failed_shell_turn(
        exit_code=2, timed_out=False, changed_tree=False,
        engine_words="[... 3 earlier lines, see the bundle ...]\nboom: no\n",
    )
    assert found is not None and found.face == diagnose.FACE_TURN_REFUSED
    assert "exit 2" in found.description
    assert "`boom: no`" in found.description, found.description
    mute = diagnose.diagnose_failed_shell_turn(
        exit_code=3, timed_out=False, changed_tree=False
    )
    assert "printed nothing to quote" in mute.description


# --- 0.7.1, P0.1: every stop names its next move, and it is a command -------
#
# Run 4B, 2026-09-01: a shell worker exited 1 on a dead key, the pre-spend
# line had already said which credential the turn would spend against and
# that it displaced a working stored login, and the stop said "an attempt
# changed nothing at all". Two facts, each shown, joined by nobody. The
# tests below hold the JOIN: the stop names the variable, says what to do
# with it, and ends in the command that continues.


def key_over_login(directory: Path, name: str, failure: str) -> Path:
    """A fake vendor CLI in run 4B's exact shape: its login probe answers
    LOGGED IN, and every other invocation — the turn — prints the vendor's
    refusal to stderr and exits 1, writing nothing. The key's displacement
    of that login is the environment's fact (`monkeypatch.setenv`), not the
    fake's."""
    path = directory / name
    path.write_text(
        f"#!{sys.executable}\n"
        "import sys\n"
        "if sys.argv[1:3] == ['login', 'status']:\n"
        "    print('Logged in using ChatGPT')\n"
        "    raise SystemExit(0)\n"
        f"print({failure!r}, file=sys.stderr)\n"
        "raise SystemExit(1)\n",
        encoding="utf-8",
    )
    path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return path


def a_run_4b_repo(repo: Path, monkeypatch, *, login_stored: bool = True) -> Path:
    """Run 4B on the maintainer's bench: a codex worker, a key exported
    beside a stored login the vendor calls valid (or, for the control, no
    stored login at all), and a turn the vendor refuses."""
    a_broken_repo(repo)
    (repo / "bin").mkdir()
    if login_stored:
        key_over_login(repo / "bin", "codex", "ERROR: HTTP 401 invalid_api_key")
    else:
        signed_out = repo / "bin" / "codex"
        signed_out.write_text(
            f"#!{sys.executable}\n"
            "import sys\n"
            "if sys.argv[1:3] == ['login', 'status']:\n"
            "    print('Not logged in')\n"
            "    raise SystemExit(1)\n"
            "print('ERROR: HTTP 401 invalid_api_key', file=sys.stderr)\n"
            "raise SystemExit(1)\n",
            encoding="utf-8",
        )
        signed_out.chmod(signed_out.stat().st_mode | stat.S_IEXEC | stat.S_IXOTH)
    monkeypatch.setenv("PATH", f"{repo / 'bin'}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("CODEX_API_KEY", "sk-proj-deadkey")
    (repo / config.CONFIG_FILENAME).write_text(
        GATE + "run:\n  worker: 'codex exec \"$(cat {brief})\"'\n"
        "  worker_timeout: 30\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)
    return repo


def test_RUN_4B_the_stop_names_the_displacing_key_and_the_resume_command(
    repo, monkeypatch, capsys
):
    """The taken path, end to end on the console: the turn fails on the key,
    the vendor still calls the stored login valid, and the stop says which
    variable to unset and what to run next — the join run 4B lacked."""
    a_run_4b_repo(repo, monkeypatch)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    out = capsys.readouterr().out
    said = flat(out)

    assert "Next: The credential this turn spent against — CODEX_API_KEY —" in said
    assert "overriding a stored login that reports itself valid" in said
    assert "Unset it, then: wringer-drive resume" in said
    # ONE unwrapped line, because it ends in a command a person copies —
    # and never composed from the worker's text: it does not repeat the
    # vendor's own line, which the description already quotes.
    next_line = next(row for row in out.splitlines() if row.startswith("Next:"))
    assert "401" not in next_line
    assert next_line.endswith("Unset it, then: wringer-drive resume")


def test_RUN_4B_the_next_move_rides_a_NEW_sibling_beside_the_frozen_record(
    repo, monkeypatch, capsys
):
    """`wringer.workerdiagnosis.v3` is frozen and closed, so the next move
    and the facts it was composed from ride `next-move.json` — validated
    here against its own published schema — and the frozen record stays
    byte-valid: no new key reaches it."""
    jsonschema = pytest.importorskip("jsonschema")
    a_run_4b_repo(repo, monkeypatch)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    bundle = only_loop(repo)
    recorded = json.loads(
        (bundle / loop.NEXT_MOVE_FILENAME).read_text(encoding="utf-8")
    )
    schema = json.loads(
        (REPO_ROOT / "schema" / "next-move.schema.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(recorded, schema)
    assert recorded["schema_version"] == loop.NEXT_MOVE_SCHEMA_VERSION
    assert recorded["face"] == diagnose.FACE_TURN_REFUSED
    assert recorded["lane"] == "shell"
    assert recorded["key_env"] == "CODEX_API_KEY"
    assert recorded["login_stored"] is True
    assert recorded["exit_code"] == 1
    assert "Unset it, then: wringer-drive resume" in recorded["next_move"]
    assert "sk-proj-deadkey" not in (bundle / loop.NEXT_MOVE_FILENAME).read_text()
    frozen = json.loads(
        (bundle / loop.WORKER_DIAGNOSIS_FILENAME).read_text(encoding="utf-8")
    )
    assert "next_move" not in frozen
    assert "key_env" not in frozen
    assert "login_stored" not in frozen


def test_RUN_4B_wring_run_JSON_carries_the_same_next_move_for_the_drive(
    repo, monkeypatch, capsys
):
    """The drive reads `wring run --json`; the sentence it quotes has to be
    the console's, byte for byte, and it rides BESIDE the frozen diagnosis
    object rather than inside it."""
    a_run_4b_repo(repo, monkeypatch)

    assert cli.main(["run", "--json"]) == cli.EXIT_GATE_FAILED
    payload = json.loads(capsys.readouterr().out)

    assert "Unset it, then: wringer-drive resume" in payload["next_move"]
    assert "CODEX_API_KEY" in payload["next_move"]
    assert "next_move" not in payload["worker_diagnosis"]
    recorded = json.loads(
        (only_loop(repo) / loop.NEXT_MOVE_FILENAME).read_text(encoding="utf-8")
    )
    assert recorded["next_move"] == payload["next_move"]


def test_a_KEY_ONLY_failure_never_says_unset_it(repo, monkeypatch, capsys):
    """Forgery control: with no stored login behind the key, "unset it" would
    leave the worker with nothing to spend against. The move is to store a
    valid key or log in — and it still ends in the command."""
    a_run_4b_repo(repo, monkeypatch, login_stored=False)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    out = capsys.readouterr().out

    next_line = next(row for row in out.splitlines() if row.startswith("Next:"))
    assert "CODEX_API_KEY" in next_line
    assert "no stored login behind it" in next_line
    assert "Unset it" not in next_line
    assert next_line.endswith("then: wringer-drive resume")


def test_wring_explain_reads_the_stops_next_move_back_from_a_LOOP_directory(
    repo, monkeypatch, capsys
):
    """The console prints the next move once and the terminal loses it.
    `wring explain <loop dir>` quotes the recorded sentence — the same one,
    verbatim — so the move survives the scrollback."""
    a_run_4b_repo(repo, monkeypatch)
    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    bundle = only_loop(repo)
    recorded = json.loads(
        (bundle / loop.NEXT_MOVE_FILENAME).read_text(encoding="utf-8")
    )

    assert cli.main(["explain", str(bundle)]) == cli.EXIT_OK
    said = capsys.readouterr().out

    assert f"Next: {recorded['next_move']}" in said
    assert "the worker changed nothing" in flat(said), "the ending is quoted"
    assert "401 invalid_api_key" in flat(said), "the diagnosis is quoted"


def test_wring_explain_on_a_loop_recorded_BEFORE_the_sibling_says_so(
    repo, monkeypatch, capsys
):
    """A loop written by an older engine has the frozen record and no
    `next-move.json`. The honest blank, in words — never silence."""
    a_run_4b_repo(repo, monkeypatch)
    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    bundle = only_loop(repo)
    (bundle / loop.NEXT_MOVE_FILENAME).unlink()

    assert cli.main(["explain", str(bundle)]) == cli.EXIT_OK
    said = capsys.readouterr().out

    assert "Next: this loop's record carries no next-move file" in said


# --- the D0-style roster: every shape composes a move or the honest blank ---


def every_worker_shape():
    """Every (face, auth state, lane, credential facts, words) the engine
    can hand `WorkerDiagnosis`, DERIVED from the rosters — a new face or a
    new auth state joins this product the day it is declared."""
    states = ("", *worker_auth.STATE_WORDS)
    for face in diagnose.WORKER_FACES:
        for state in states:
            for lane in ("", "shell"):
                for key_env in ("", "A_VENDOR_KEY"):
                    for login_stored in (None, True, False):
                        for words in ("", "the worker said this"):
                            yield diagnose.WorkerDiagnosis(
                                face=face,
                                auth_state=state,
                                lane=lane,
                                key_env=key_env,
                                login_stored=login_stored,
                                engine_words=words,
                                exit_code=1 if lane == "shell" and face
                                == diagnose.FACE_TURN_REFUSED else None,
                            )


def test_EVERY_worker_shape_composes_a_next_move_or_the_exact_honest_blank():
    """D0 turned on the next move: a shape the property has no sentence for
    must say the literal blank, and a shape it has a sentence for must end
    in the command. Nothing in between — a sentence with no command is a
    stop the product has not finished writing (the plan's second new law)."""
    for shape in every_worker_shape():
        move = shape.next_move
        assert move.strip(), f"{shape} composed nothing at all"
        assert move == diagnose.NEXT_MOVE_UNKNOWN or move.endswith(
            f"then: {diagnose.RESUME_COMMAND}"
        ), f"{shape} composed a move with no command: {move!r}"


def test_the_blank_is_never_composed_where_the_FACTS_point_somewhere():
    """The other half of the roster, and the half a revert reddens: the
    blank is honest only when no fact points anywhere. A set key names the
    credential the turn spent against; a signed-out agent names the login;
    a clean-and-empty turn names its lane's channel. Each has a move."""
    for shape in every_worker_shape():
        # A set key is a SHELL-lane fact: `worker_auth._shell_lane` is the
        # one composer that types it, and the ACP lane's record never
        # carries one to point with.
        points = (
            shape.face == diagnose.FACE_TURN_CHANGED_NOTHING
            or (bool(shape.key_env) and shape.lane == "shell")
            or shape.auth_state == worker_auth.LOGGED_OUT
        )
        if points:
            assert shape.next_move != diagnose.NEXT_MOVE_UNKNOWN, (
                f"{shape} has facts that point somewhere and composed the blank"
            )
        if (
            shape.key_env
            and shape.lane == "shell"
            and shape.face == diagnose.FACE_TURN_REFUSED
        ):
            assert shape.key_env in shape.next_move, (
                "the credential the turn spent against must be named"
            )
            displaced = shape.login_stored is True
            assert ("Unset it" in shape.next_move) == displaced, shape


def test_the_next_move_is_composed_from_FACTS_never_from_the_workers_text():
    """F6, on the new sentence: two diagnoses whose facts agree compose the
    same move whatever the worker printed; only the PRESENCE of words is a
    fact, and it decides between a pointer at them and the blank."""
    facts = dict(
        face=diagnose.FACE_TURN_REFUSED, lane="shell", exit_code=1,
        auth_state=worker_auth.UNKNOWN, key_env="A_VENDOR_KEY",
        login_stored=True,
    )
    one = diagnose.WorkerDiagnosis(engine_words="401 invalid_api_key", **facts)
    two = diagnose.WorkerDiagnosis(engine_words="rate limited, retry", **facts)
    assert one.next_move == two.next_move
    assert "401" not in one.next_move
    assert "rate limited" not in two.next_move
    # The words' presence: a pointer at them over an empty log is a pointer
    # at nothing, so that shape composes the blank instead.
    held = dict(
        face=diagnose.FACE_TURN_REFUSED, lane="shell", exit_code=1,
        auth_state=worker_auth.LOGGED_IN,
    )
    assert diagnose.WorkerDiagnosis(engine_words="x", **held).next_move.endswith(
        diagnose.RESUME_COMMAND
    )
    assert (
        diagnose.WorkerDiagnosis(engine_words="", **held).next_move
        == diagnose.NEXT_MOVE_UNKNOWN
    )
