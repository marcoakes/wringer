"""CLI surface smoke tests."""

import subprocess
import sys

from wringer import __version__, cli


def test_version_flag_reports_package_version(capsys):
    try:
        cli.main(["--version"])
    except SystemExit as exc:  # argparse's version action exits 0
        assert exc.code == 0
    out = capsys.readouterr().out
    assert out.strip() == f"wring {__version__}"


def test_python_dash_m_wringer_help_works():
    proc = subprocess.run(
        [sys.executable, "-m", "wringer", "--help"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert "usage: wring" in proc.stdout


# --- long refusals have to fit a terminal ---------------------------------
#
# `wring deliver`'s vacuity refusal rendered as a SINGLE 402-column line.
# Every message in this program is composed as prose, and prose that runs
# four times past the edge of a terminal is a message people stop reading —
# which for a refusal is the whole point of writing it well.


def test_a_long_message_is_wrapped_to_the_terminal():
    long_line = (
        "refusing to deliver 20260806-204543-046f because it recorded "
        "`gates_vacuous`, and the fix is to write a test that fails without "
        "your change, then verify again"
    )
    wrapped = cli._wrap_message(long_line)

    assert max(len(line) for line in wrapped.splitlines()) <= 80
    # Nothing lost, only re-broken.
    assert " ".join(wrapped.split()) == " ".join(long_line.split())


def test_wrapping_leaves_a_deliberately_structured_message_alone():
    """Half these messages carry an indented example a reader is meant to
    copy — a `judge:` stanza, a git command. Reflowing those would turn
    working YAML into a paragraph."""
    structured = (
        "no 'judge:' section — there is no default endpoint. Add one:\n"
        "\n"
        "  judge:\n"
        "    endpoint: http://127.0.0.1:11434/v1/chat/completions\n"
        "    model: qwen2.5-coder:7b"
    )
    wrapped = cli._wrap_message(structured)

    for line in ("  judge:", "    model: qwen2.5-coder:7b"):
        assert line in wrapped.splitlines(), f"{line!r} was reflowed"


def test_bare_wring_names_a_way_in_before_the_usage_error(capsys):
    """**Field report 2026-08-22 finding 4.**

    A person who has just installed this types `wring`. They got argparse's
    wall — nineteen verbs in registration order, headed by "the following
    arguments are required: command" — and nothing anywhere pointed them at a
    first step. `wring --help` names `wring start` in its description, but
    nothing after the install pointed at `--help` either.

    Driven through `main([])` rather than by reading the source, because the
    thing under test is what a person sees on the path where argparse then
    raises SystemExit.
    """
    import pytest

    from wringer import cli

    with pytest.raises(SystemExit):
        cli.main([])
    printed = capsys.readouterr().err
    assert "wring start" in printed, (
        "bare `wring` still names no way in — the wall is the whole finding"
    )
    assert "wring doctor" in printed
    # The line comes BEFORE argparse's error, or it is under the wall it was
    # added to precede.
    assert printed.index("wring start") < printed.index("usage:")


def test_the_start_here_line_fires_ONLY_on_an_empty_argv(capsys):
    """The other half: this is one line on one path, not a new behaviour.

    A start-here line that also printed above a typo'd flag would be noise on
    every mistake anyone makes, and a `wring` that answered a bare invocation
    with something OTHER than the usage error would be a twentieth command by
    stealth. Neither is what was asked for.
    """
    import pytest

    from wringer import cli

    with pytest.raises(SystemExit):
        cli.main(["--not-a-flag"])
    assert "wring start is the guided launch" not in capsys.readouterr().err, (
        "the start-here line fires on a wrong flag too, which makes it noise"
    )

    # And no verb was added to carry it.
    parser = cli.build_parser()
    verbs = {
        name
        for action in parser._subparsers._group_actions
        for name in action.choices
    }
    assert "start-here" not in verbs and "help" not in verbs, (
        f"a command was added to carry the start-here line: {sorted(verbs)}"
    )
