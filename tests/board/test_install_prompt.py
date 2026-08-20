"""The board's half of the install-prompt guard, split by dependency direction.

`INSTALL.md` lives in the CORE repository and its prompt invokes both `wring`
and `wringer-board`. Neither repository can parse both: the core does not depend
on this package, and this package's tests can reach the core only when it is
importable.

So the guard is split, and **each half states what it does not cover rather
than quietly covering less than it looks**:

- the core's `test_docs.py` parses the `wring` lines, and skips the
  `wringer-board` ones with a named reason;
- this file parses the `wringer-board` lines with this package's real parser,
  and skips entirely — with a named reason — when the core repository is not
  beside it.

A `wringer-board` line that argparse would reject is a stranger's install
failing at the one step they cannot debug.
"""

from __future__ import annotations

from pathlib import Path

import pytest


def install_md() -> Path:
    """`INSTALL.md` in the CORE repository, found through the engine."""
    accept = pytest.importorskip(
        "wringer.accept",
        reason="the core is not importable, so INSTALL.md cannot be located. "
        "The core's own suite still parses the `wring` half; what is skipped "
        "here is the `wringer-board` half, and this is that skip being named",
    )
    path = Path(accept.__file__).parents[2] / "INSTALL.md"
    if not path.is_file():
        pytest.skip(f"the core is importable but {path} is absent")
    return path


def prompt_lines() -> list[str]:
    text = install_md().read_text(encoding="utf-8")
    inside = False
    found = []
    for line in text.splitlines():
        if line.startswith("```"):
            inside = line.strip() == "```text"
            continue
        if inside and line.strip().startswith("wringer-board "):
            found.append(line.strip().split("#")[0].strip())
    return found


def test_every_wringer_board_line_in_the_install_prompt_parses():
    """Through THIS package's real parser, not a copy of its flags."""
    import shlex

    from wringer_board.__main__ import main  # noqa: F401  (import proves it loads)

    lines = prompt_lines()
    assert lines, "INSTALL.md's prompt invokes `wringer-board` nowhere"

    for line in lines:
        argv = shlex.split(line)
        assert argv[0] == "wringer-board", argv
        # `main` builds the parser inline, so the honest check is to run it
        # against a directory that cannot exist and assert argparse got past
        # ARGUMENT parsing — a usage error exits 2 from `parse_args`.
        try:
            main(argv[1:] + [])
        except SystemExit as stopped:
            assert stopped.code != 2, (
                f"INSTALL.md's prompt cannot run `{line}` — argparse rejected "
                f"the arguments"
            )
        except Exception:
            # Any non-SystemExit failure is a RUNTIME problem (no such repo),
            # which means the arguments parsed. That is all this guard claims.
            pass


def test_the_prompt_only_uses_verbs_this_package_actually_has():
    """A verb rename would otherwise leave the install page pointing at a
    command that no longer exists, and the page is the thing a stranger runs
    without reading."""
    import shlex

    from wringer_board.__main__ import main

    verbs = set()
    for line in prompt_lines():
        argv = shlex.split(line)
        if len(argv) > 1:
            verbs.add(argv[1])
    assert verbs, "no verbs found"

    for verb in sorted(verbs):
        with pytest.raises(SystemExit) as stopped:
            main([verb, "--help"])
        assert stopped.value.code == 0, (
            f"INSTALL.md's prompt uses `wringer-board {verb}`, which this "
            f"package does not have"
        )


def test_the_prompt_never_tells_an_agent_to_write_anything(argv=None):
    """The install page uses `render` and nothing that writes.

    `answer` and `approve` DO write — into `wringer.spec.yaml` — and they are
    S3's, driven by a person who has read a plan. An install prompt pasted into
    an agent is not that, and must not reach them.
    """
    import shlex

    for line in prompt_lines():
        verb = shlex.split(line)[1]
        assert verb == "render", (
            f"INSTALL.md's prompt runs `wringer-board {verb}`, which is not a "
            f"read-only verb. An install must not write to a person's spec"
        )
