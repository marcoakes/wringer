#!/usr/bin/env python3
"""Is there ANY pair `spec.same_command` could collapse, PROVABLY?

`spec.same_command` compares a DRAFTED gate proposal against the gates already
in `.wringer.yaml`. The two ways to be wrong are not symmetric: a false NO
installs a duplicate gate (friction), a false YES treats a DIFFERENT command as
already installed and leaves a criterion bound to a check the person never
approved (silent consent damage). So the bar for collapsing any pair is proof,
not plausibility.

Any canonicalizer written in Python is built on `shlex`. Gates run through
`subprocess(..., shell=True)` — `/bin/sh -c` (`gates.py`). So the real question
is whether `shlex` agrees with the shell that will actually run the command.

Method: ONE executable named `probe-argv` on PATH that prints its own argv.
Every candidate string is run through `/bin/sh -c` and split by `shlex`, and
**the same string goes into both lanes** — an earlier version of this script
substituted a two-word python invocation into the shell lane and a one-word
placeholder into the shlex lane, which made quoting look decisive when it was
not. That defect is the reason this note exists.

The capture and the decision are `docs/canonicalization-2026-08-22.md`. Kept so
the measurement can be re-taken on another platform, where `/bin/sh` may be a
different shell.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

BIN = Path(tempfile.mkdtemp(prefix="canon-"))
PROBE = BIN / "probe-argv"
PROBE.write_text(
    f'#!{sys.executable}\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\n',
    encoding="utf-8",
)
PROBE.chmod(0o755)
ENV = dict(os.environ, PATH=f"{BIN}:{os.environ.get('PATH', '')}")

#: Every pair is written against the SAME one-word program name, so the shell
#: lane and the shlex lane are answering a question about the same string.
PAIRS = [
    ("whitespace (already collapsed)", "probe-argv -q", "probe-argv  -q"),
    ("double quotes round a flag", "probe-argv -q", 'probe-argv "-q"'),
    ("single quotes round a flag", "probe-argv -q", "probe-argv '-q'"),
    ("quotes round the program", "probe-argv -q", "'probe-argv' -q"),
    ("trailing semicolon", "probe-argv -q", "probe-argv -q;"),
    ("an unset variable", "probe-argv -q", "probe-argv -q $NOPE"),
    ("tilde vs $HOME", "probe-argv ~/f", "probe-argv $HOME/f"),
    ("backslash-escaped space vs quotes", "probe-argv a\\ b", 'probe-argv "a b"'),
    ("ansi-c quoting", "probe-argv 'a'", "probe-argv $'a'"),
    ("a wrapper the docs call equivalent", "probe-argv -q", "sh -c 'probe-argv -q'"),
    # **Aimed deliberately at the UNSAFE direction.** Everything above was
    # picked for plausibility; these are picked to make `shlex` say SAME where
    # the shell says DIFFERENT, because that is the only direction that can do
    # damage and a sample with none of it proves nothing.
    ("expansion inside double vs single quotes", 'probe-argv "$HOME"',
     "probe-argv '$HOME'"),
    ("escaped dollar, two quotings", 'probe-argv "\\$HOME"',
     "probe-argv '\\$HOME'"),
    ("a glob, two quotings", 'probe-argv "*"', "probe-argv '*'"),
    ("command substitution vs its literal", 'probe-argv "$(echo hi)"',
     "probe-argv '$(echo hi)'"),
    ("backtick substitution vs its literal", 'probe-argv "`echo hi`"',
     "probe-argv '`echo hi`'"),
]


def real_argv(command: str) -> list[str] | str:
    """What the shell gates.py uses ACTUALLY passes."""
    try:
        done = subprocess.run(
            command, shell=True, capture_output=True, text=True, timeout=20, env=ENV
        )
    except subprocess.SubprocessError as exc:  # pragma: no cover
        return f"<error {exc}>"
    if done.returncode != 0:
        return f"<exit {done.returncode}: {(done.stderr or '').strip()[:60]}>"
    try:
        return json.loads(done.stdout.strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        return f"<unparseable {done.stdout!r}>"


def shlex_argv(command: str) -> list[str] | str:
    try:
        return shlex.split(command)
    except ValueError as exc:
        return f"<shlex error {exc}>"


shell = subprocess.run(
    ["/bin/sh", "-c", "ls -l /bin/sh"], capture_output=True, text=True
).stdout.strip()
print("interpreter: subprocess(shell=True) — which is /bin/sh -c")
print(f"/bin/sh is:  {shell}")
print()

verdicts = []
for name, one, other in PAIRS:
    a, b = real_argv(one), real_argv(other)
    sa, sb = shlex_argv(one), shlex_argv(other)
    same_real = a == b and isinstance(a, list)
    same_shlex = sa == sb and isinstance(sa, list)
    verdicts.append((name, same_real, same_shlex, same_real == same_shlex))
    print(f"--- {name}")
    print(f"    {one!r:26} -> sh {a}   shlex {sa}")
    print(f"    {other!r:26} -> sh {b}   shlex {sb}")
    print(
        f"    same under sh: {same_real}   same under shlex: {same_shlex}"
        f"   {'AGREE' if same_real == same_shlex else '*** DISAGREE ***'}"
    )

print()
print("=" * 70)
agree_same = [n for n, r, s, ok in verdicts if r and s and ok]
false_yes = [n for n, r, s, _ in verdicts if s and not r]
false_no = [n for n, r, s, _ in verdicts if r and not s]
print(f"sh and shlex AGREE are the same     : {agree_same}")
print(f"shlex says SAME, sh says NOT (unsafe): {false_yes}")
print(f"sh says same, shlex says NOT (safe)  : {false_no}")
