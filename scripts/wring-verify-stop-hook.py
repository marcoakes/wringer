#!/usr/bin/env python3
"""A Stop hook that refuses to let an agent finish on an unproven change.

**Wringer's rule, running inside somebody else's harness.** Claude Code and
`dcode` both speak the same hook wire — a `Stop` event, a command handler, and
**exit 2 blocks the agent from finishing, with this process's stderr handed
back to the model as the reason**. So the one sentence this project exists to
say can be installed in a harness that has never heard of Wringer:

    the model stopping is not the same as the work being done.

Read `docs/supervise-their-harness.md` for the two `hooks.json` / `settings.json`
stanzas and what was measured. This file is the whole implementation.

**It fails CLOSED, on purpose, and that is the part to understand before
installing it.** Missing `wring`, missing config, a verifier that crashed —
every one of them blocks, because "I could not check" and "it is fine" are
different answers and only one of them may end a turn. Both harnesses cap
consecutive Stop continuations (dcode at 8), so a hook that can never go green
costs a bounded number of turns and then stops being consulted; it does not
wedge anything forever.

Usage in a hook stanza:

    python3 /path/to/wring-verify-stop-hook.py [--repo PATH] [--wring PATH]

`--repo` defaults to the working directory the harness ran the hook in.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

#: Exit 2 is the wire. Both harnesses read it as "block", and neither reads
#: any other non-zero code that way — 1 is "the hook itself is broken", which
#: is a diagnostic and does NOT stop the agent. Getting this wrong is the
#: difference between a supervisor and a log line.
BLOCK = 2

CONFIG = ".wringer.yaml"

#: Long enough for a real suite, and bounded because the harness has its own
#: ceiling and a hook that outlives it is killed without a verdict.
TIMEOUT = 900


def block(message: str) -> int:
    sys.stderr.write(message.rstrip() + "\n")
    return BLOCK


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".")
    parser.add_argument("--wring", default="wring")
    args = parser.parse_args(argv)

    # The event body is read and discarded. A Stop hook has one question to
    # answer and the answer does not depend on what the agent said — which is
    # the whole difference between a check and a grader.
    try:
        sys.stdin.read()
    except (OSError, ValueError):  # pragma: no cover — a closed stdin
        pass

    repo = Path(args.repo).resolve()
    if not (repo / CONFIG).is_file():
        return block(
            f"BLOCKED: there is no {CONFIG} in {repo}, so there are no gates "
            "to run and nothing has been proved about this change. This hook "
            "does not treat 'I could not check' as 'it is fine'. Add the "
            "gates this project already has (`wring init`), or remove this "
            "hook."
        )

    binary = shutil.which(args.wring) or args.wring
    if shutil.which(binary) is None and not Path(binary).is_file():
        return block(
            f"BLOCKED: {args.wring!r} is not on PATH, so no check ran. "
            "Install Wringer (`uv tool install wringer`) or point this hook "
            "at the binary with --wring."
        )

    try:
        done = subprocess.run(
            [binary, "verify", "--json"],
            cwd=repo,
            capture_output=True,
            text=True,
            timeout=TIMEOUT,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return block(
            f"BLOCKED: the checks did not finish ({exc}). A verifier that ran "
            "out of time proved nothing, and a timeout is not a pass."
        )

    try:
        verdict = json.loads(done.stdout)
    except (json.JSONDecodeError, TypeError):
        return block(
            "BLOCKED: the checks produced no verdict this hook could read.\n"
            f"exit {done.returncode}\n{(done.stderr or '').strip()[-1500:]}"
        )

    if verdict.get("status") == "passed":
        return 0

    failing = verdict.get("failed_gate") or "a required check"
    where = verdict.get("evidence_dir") or "(no bundle)"
    return block(
        f"BLOCKED: '{failing}' is not passing, so this change is not done.\n"
        f"Fix what '{failing}' is telling you and finish again. The evidence "
        f"for this run is at {where}.\n"
        "This is not an opinion about your work: it is the repository's own "
        "check, executed just now, and it said no."
    )


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
