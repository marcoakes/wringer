#!/usr/bin/env python3
"""The verification relay — a coding agent OBEYING `AGENTS.md`, 2026-08-19.

It reads one JSON object per line from DRIVE's **stdout**, prints each step's
text VERBATIM, and writes one plain-text line back on stdin. Law 1 holds
literally: nothing here paraphrases, summarises or composes a sentence about a
criterion, a refusal or a gate.

**stdout and stderr are kept SEPARATE, and that is the point of this run.**
The 2026-08-17 relay merged them, which is precisely how the silent build hid:
the engine's heartbeat was thrown into the step stream where nobody looked for
it. Here stderr is pumped on its own thread and printed as it arrives, marked
`⋯`, so the capture shows whether a PM would see the build breathing.

**What this harness is NOT, said out loud so the capture cannot over-claim.**
Law 2 says the agent never answers a `confirm` itself, and no human is sitting
here. So this process plays BOTH parts: the agent (the transport above) and
the person (the `ANSWERS` table below, written in a product manager's
register — short, plain, no file names). Those answers are scripted by an
engineer. This run is evidence about the MECHANISM — how many questions,
whether progress arrives, how the ending reads — and is no evidence at all
about how a real product manager answers, which is exactly the correction
`docs/demo-2026-08-19.md` now carries.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

# The three setup answers are the documented ones the questions now offer.
SETUP = {
    "setup:endpoint": "https://api.anthropic.com/v1/chat/completions",
    "setup:model": "claude-opus-5",
    "setup:worker": (
        f"acp: {sys.executable} {HERE}/acp_model_agent.py "
        f"https://api.anthropic.com/v1/chat/completions claude-opus-5 "
        f"{HERE}/.key"
    ),
}

# A product manager's answers: short, about the product, naming no file and no
# module. Matched on the question's own words, because question ids are the
# drafter's and change from run to run.
ANSWERS = [
    (("recently played", "counts as played", "what event", "records a play",
      "played"),
     "Clicking a game's tile. That is the moment someone chose it."),
    (("store", "storage", "persist", "survive", "where"),
     "Whatever the browser keeps on its own. No accounts, no server."),
    (("empty", "nothing", "first visit", "no games"),
     "Show nothing at all. An empty heading looks broken."),
    (("heading", "title", "label", "call"),
     "Continue. One word."),
    (("how many", "limit", "most recent", "order", "fewer"),
     "Most recent first, and only what they actually played. Never pad it."),
    (("look", "appearance", "same tiles", "differ"),
     "The same tiles as the grid below. Same games, same look."),
    (("catalogue", "source of truth", "exists", "retired"),
     "Yes, that list is what exists. A retired game is one taken out of it."),
    (("corrupt", "unreadable", "invalid", "broken data"),
     "Treat it as nothing played. Do not show the visitor an error."),
    (("new test", "added", "written alongside", "may.*checks",
      "acceptance", "already executed", "runner"),
     "No. I would rather be told a thing is unproved than shown a check "
     "written next to the change it judges."),
    (("shared", "per visitor", "device", "sync", "account"),
     "Per browser only. Nothing shared."),
]

CONFIRMS = {"approve": "yes", "try-gates": "yes", "install-gates": "yes",
            "deliver": "no"}


def answer_for(step: dict) -> str:
    """The person's answer for one step. Never a paraphrase of the step."""
    if step["id"] in SETUP:
        return SETUP[step["id"]]
    if step["kind"] == "confirm":
        # Scripted, and the docstring says whose script it is.
        return CONFIRMS.get(step["id"], "no")
    asked = (step.get("text", "") + " " + (step.get("question") or "")).lower()
    for needles, said in ANSWERS:
        if any(needle in asked for needle in needles):
            return said
    return ("I do not mind — pick whatever is simplest and tell me what you "
            "chose.")


def main() -> int:
    prd = sys.argv[1]
    started = time.monotonic()
    proc = subprocess.Popen(
        [sys.executable, "-m", "wringer_drive", "run", prd, "--repo", ".",
         "--emit", "json"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, bufsize=1, env=os.environ.copy(),
    )

    def pump_stderr() -> None:
        """The ENGINE's heartbeat, relayed as it arrives — R4's whole point."""
        for line in proc.stderr:
            if line.strip():
                print(f"[{time.monotonic() - started:6.1f}s]   ⋯ "
                      f"{line.rstrip()}", flush=True)

    heartbeat = threading.Thread(target=pump_stderr, daemon=True)
    heartbeat.start()

    asked = confirmed = 0
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            step = json.loads(line)
        except json.JSONDecodeError:
            print(f"  [NOT JSON — the contract broke] {line}", flush=True)
            continue
        clock = time.monotonic() - started
        print(f"[{clock:6.1f}s] {step['kind']:8} {step['id']}", flush=True)
        for field in ("text", "question", "engine_words", "refusing_means"):
            if step.get(field):
                label = {"refusing_means": "If you say no: "}.get(field, "")
                for index, row in enumerate(str(step[field]).splitlines()):
                    print(f"          {label if index == 0 else ''}{row}",
                          flush=True)
        if step["kind"] in ("ask", "confirm"):
            if step["kind"] == "confirm":
                confirmed += 1
            elif not step["id"].startswith("setup:"):
                asked += 1
            said = answer_for(step)
            print(f"   --> {said}", flush=True)
            proc.stdin.write(said + "\n")
            proc.stdin.flush()

    code = proc.wait()
    heartbeat.join(timeout=5)
    total = time.monotonic() - started
    print(f"\n=== exit {code} · {asked} interview questions · {confirmed} "
          f"consent gates · {total:.0f}s ===", flush=True)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
