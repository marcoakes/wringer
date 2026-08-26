"""Assemble the full-run capture from the tee'd files, verbatim.

Written as a script rather than typed, for the reason the run prompt gives:
this capture is the window's centrepiece and it is written by tee, not by
memory. Every fenced block below is a file read off disk unedited.
"""
from __future__ import annotations

import sys
from pathlib import Path

CAP = Path(sys.argv[1])
OUT = Path(sys.argv[2])
# The workspace the run happened in, rewritten out of every capture: it is
# one machine's temporary path and says nothing to a reader. Taken as an
# argument rather than written down — a developer's own directory hardcoded
# into a script is what `test_no_script_hardcodes_one_developers_machine`
# exists to stop, and it caught this one.
SCRATCH = sys.argv[3] if len(sys.argv) > 3 else str(CAP.parent)

parts: list[str] = []


def prose(text: str) -> None:
    parts.append(text.strip("\n") + "\n")


def capture(title: str, name: str, *, limit: int | None = None) -> None:
    body = (CAP / name).read_text(encoding="utf-8")
    # The scratch path is this machine's and says nothing to a reader.
    body = body.replace(SCRATCH, "<workspace>")
    if limit is not None and len(body) > limit:
        body = body[:limit] + f"\n… [{len(body) - limit} more bytes in {name}]\n"
    parts.append(f"**{title}**\n\n```\n{body.rstrip()}\n```\n")


prose("""
# The full run — a PRD in, a delivered branch out

*2026-08-26, on Marc's Mac, driven by Claude as the operator. Every block
below is a file written by `tee` while the thing happened, not a
reconstruction. The scratch path is rewritten to `<workspace>` and nothing
else is edited.*

**Why this document exists.** Nothing in this project had ever run the whole
machine. Run 3B stopped at the pen deliberately. F4-at-scale delivered with
shell-script workers on one slice. Run 5 died at the build. Every field report
since has been a product manager discovering whole-chain breakage that a
ten-minute complete run would have caught first. This is that run.

**What it proves.** A plain-language document goes in; a coding agent that
costs real money builds from it; the checks that prove the work are proposed,
seen to fail, and installed; the loop converges; the one requirement no check
can settle is judged by a person; and a branch carrying the work lands on a
remote. End to end, once, on camera.

**What it does not prove.** One run of one example on one machine. The drafter
is not deterministic: on the same PRD it decided everything and asked nothing
the first time — which the engine refused — and asked two questions the
second. Nothing here says the next run goes the same way. That is exactly why
the chain-completes check now runs on every release
(`scripts/chain-completes.py`): what a release can promise is that the machine
COMPLETES, not that a model drafts well.

**The state it ran against.** `wringer` 0.4.7 installed from PyPI,
`origin/main` at `5d1dfd1`, 3114 tests green. Worker:
`claude-agent-acp` 0.70.0 over ACP, paid with `ANTHROPIC_API_KEY` through
`run.worker.acp.env_passthrough`. Drafter and judge endpoint:
`https://api.anthropic.com/v1/chat/completions`, `claude-opus-5`.

**What it cost.** Two drafting calls, 9,048 and 7,629 tokens. One worker turn,
3m52s, which the agent itself reported as $1.12. No judge call was made: every
machine criterion was proved by a gate and the one human criterion was
answered by a person.

**Six findings came out of it.** They are marked ⚑ where they happened.
""")

prose("""
---

## S0 — the machine stops lying about its install

The state on arrival, measured by Fable the day before and confirmed here: the
`uv tool install`ed `wring` on PATH reported 0.4.7 out of a working tree via
`__editable__.wringer-0.4.1.pth`, and a second pre-merge tool environment
`wringer-drive` still existed carrying three more editable paths.
""")
capture("Before — `wring --version` and `wring doctor`", "s0-before.txt")
prose("""
Doctor was right about the half it could see. `uv tool uninstall wringer
wringer-drive` then `uv tool install wringer`:
""")
capture("The reinstall", "s0-reinstall.txt")
capture("After — one tool environment, no source note", "s0-after.txt")

prose("""
### ⚑ Finding 1 — one directory is not one install

`uv` puts every tool's console scripts into ONE directory. Doctor's
split-install check keys on that directory, so a person running a mixture of
two tool environments has four commands in one place and doctor calls it a
tick. That is the state this Mac was in.

Measured before it was specified, with a fabricated two-tool shim pair — four
shims in one directory, two owned by `envA` and two by `envB`:
""")
capture("What doctor said about a two-environment mixture", "s0-finding1-before.txt")
prose("""
`STATUS: ok`. Each command is now asked which environment it belongs to — the
interpreter its shebang names — rather than where it sits:
""")
capture("The same fixture, after the fix", "s0-finding1-after.txt")
prose("""
The interpreter is compared UNRESOLVED, by the directory holding it, and a
test pins that: every uv environment's `bin/python` is a symlink to the same
base interpreter (measured across `wringer`, `kimi-code` and this repo's own
`.venv`), so a resolved comparison collapses every environment on the machine
into one and the check goes blind again with all its other tests still green.
""")

prose("""
---

## S1 — the full run

`sh docs/drive/examples/pipeline/setup.sh <workspace>/fullrun`, then the
document is driven with `wringer-drive run ../PRD.md --repo . --emit json`.
The operator is Claude; a driver script relays each step and types the
answers, because `wringer-drive` drains anything already waiting on stdin and
a pre-piped `yes` is an approval nobody gave.

### Before any money moved

The example says to check the agent's own credential first. It answers free:
""")
capture("`claude-agent-acp --cli auth status`", "s1-authstatus.txt")
prose("""
`loggedIn: false`. So the first drive stopped — correctly, and before
spending:
""")
capture("Lap 1, verbatim", "s1-lap1.transcript.txt")
prose("""
That stop is the product working. It names both routes, it says nothing has
been spent, and it says plainly that the check cannot tell whether a
credential still works. As operator I took the second route it offered and
declared `env_passthrough: [ANTHROPIC_API_KEY]` in `.wringer.yaml`. The
preflight then answers green, before the first paid call:
""")
capture("`wring doctor` in the project, with the credential present",
        "s1-workerauth-green.txt")

prose("""
### ⚑ Finding 2 — the cost was said after the spend, and not at all when it failed

Lap 2 drafted. The endpoint was paid. The engine refused the draft — correctly:
the drafter had decided `extend-existing-summary`, which shapes a criterion
marked `human: true`, and an assumption may not displace the one judgement no
check is allowed to make.
""")
capture("Lap 2, verbatim — one paid call, three steps", "s1-lap2.transcript.txt")
prose("""
Three steps: `prd-copied`, `resuming`, `stopped`. **There is no step saying a
paid call was about to happen**, and one was made. `draft_the_spec`'s docstring
says the sentence "is here, before the subprocess, because after it the money
is already spent" — and it was not: `Session.emit` appends to a list, and the
caller rendered that list's last entry after the function returned. When the
call refused, the function raised and the render line was never reached.

Every test of it passed throughout, because each asked `session.steps` rather
than asking what the operator saw.

### The drafter asked, the second time

The refusal's first remedy is "draft again — the drafter is free to ask
instead of deciding, and usually does". Lap 3 tested that claim, and it held:
where lap 2 asked nothing and decided everything, lap 3 asked two questions.
""")
capture("Lap 3, verbatim — the whole run", "s1-lap3.transcript.txt")

prose("""
### ⚑ Finding 3 — a false sentence on a converged run

Read the `build:converged` step above. The loop converged: iteration 1 red,
one worker turn of 3m52s, iteration 2 green including the acceptance check.
The agent changed seven files and 174 lines. And the step carries:

> the agent finished its turn without changing a file or reporting an error;
> this usually means it could not authenticate, could not see the work, or
> produced nothing it could use

`files_written` counts writes that crossed Wringer's own `fs/write_text_file`
channel, and an agent holding its own filesystem uses none. The counter is
honest; the inference is not.

This repository had already found this, on 2026-08-22, and fixed the CONSOLE —
with a test that explicitly permitted the RECORD to keep the face. The record
has a second reader: `wringer-drive` quotes it into the step a product manager
reads. One surface was fixed and the fact stayed wrong, so the next surface
inherited it. It is now settled where the fact is made.

### The pen

`wring deliver` held, exactly as it should, on the one requirement no check can
settle:
""")
capture("What was waiting for a person", "s1-judge-waiting.txt")
prose("""
The card said how to tell: read a run with two failures and several skipped
steps. That is what was run, against the code the agent had just written:

```
  FAILED   build  build-cmd blew up
  FAILED   lint  lint-cmd blew up
  ok       notes
  skipped  docs  depends on lint (FAILED)
  skipped  test  depends on build (FAILED)
  skipped  release  depends on build, lint (FAILED)

Run did not succeed: 2 failed (build, lint), 3 skipped
```

Each skipped step names the failure at the root of its own chain rather than
the skipped step above it, and `release` names both of its blockers — the two
answers given in the interview, built. Judged `met`:
""")
capture("`wringer-board judge`", "s1-judged.txt")

prose("""
### ⚑ Finding 4 — the remedy that could not clear its own refusal
""")
capture("`wring deliver --send`, immediately after judging", "s1-deliver.txt")
prose("""
The refusal says to record the decision in `wringer.judgements.yaml`. The
decision had just been recorded in `wringer.judgements.yaml`, by the tool whose
own output is two blocks above. The identical refusal came back.

Nothing is wrong with the mechanism — acceptance is computed at verify time and
recorded in the bundle, and deliver reads the record. But the printed remedy
had been followed to the letter and the refusal did not move, and no surface
said what would. `wring verify` is what moves it, and now the refusal says so
when the answer is genuinely on file.

### The handover
""")
capture("`wring verify` then `wring deliver --send`", "s1-deliver3.txt")
capture("On the remote", "s1-remote.txt")
prose("""
A PRD went in. A branch carrying the work is on a remote, with an executable
acceptance check that was seen to fail first, five decisions the operator
approved knowing they had been taken without asking, and one requirement a
person judged with their name on it.
""")

prose("""
---

## S2 — run 5's two death scenarios, through the shipped verb

0.4.7 fixed both at the renderer and parser level. Nobody had driven either
through the verb a person actually types.

### (a) Re-driving the same project

Expected: `spec-reused` renders, no gate unbinding, no self-comparison, the
plan carries the same decisions block.
""")
capture("S2(a), verbatim", "s2a.transcript.txt", limit=9000)
prose("""
Clean. `spec-reused` says nothing is sent and nothing is spent; the answers are
read back and NOT re-asked (`answers-already-confirmed`); the decisions block
is carried identically; the binding count moves 0-of-6 to 1-of-6 rather than
unbinding, and the criterion line drops "proposed, not installed yet" because
it is installed. The gate step is `gates-none-proposed` — nothing is proposed,
so there is nothing to diff and no self-comparison happens. The run ends
"there is nothing to hand over: no files were changed", which is true: the
work was delivered on the previous lap.

### (b) A spec carried across without its sidecar
""")
capture("S2(b), verbatim", "s2b.transcript.txt", limit=6000)
prose("""
The absence is named twice, and both times where a person is looking. In the
step stream, on `spec-reused`:

> `wringer.decisions.yaml` is not beside it, so the plan below cannot show what
> was decided without asking you, or the plain-language outcome of each task.

And in the plan itself, at each place the missing content would have been:

```
WHAT I WILL BUILD

  (no plain-language outcome — wringer.decisions.yaml is not in this project)
    For the engineer: In src/pipeline/graph.py and src/pipeline/runner.py, …
```

Both scenarios re-drive clean at HEAD. No deviation.
""")

prose("""
---

## ⚑ Finding 5 — the board was holding up the handover

Found by the chain-completes check the moment it was written, in a project
whose `.gitignore` had no line for `board.html`:

```
{"kind": "stopped", "id": "stopped:untracked_file_moved",
 "text": "The handover is being held because a newly added file changed after
          it was checked.",
 "engine_words": "wring deliver: board.html is not what 20260826-085344-3cb5
                  verified — its contents, its file mode or its symlink target
                  has changed. git never saw these files, so nothing else would
                  have caught it — run 'wring verify' again"}
```

The board is rendered BEFORE the loop, so every verify records it in
`untracked.json`. It is rendered again after the loop, because showing the
result is what it is for. So the file always differs from what the verify saw,
and the refusal is correct — about a file that is not the operator's work.

**The shipped example escapes only because its `.gitignore` was written with
`board.html` already in it.** No repository a product manager starts from has
one. `wring init` already keeps `.wringer/` out of git for exactly this
reason; the board is the one file Wringer writes outside that directory, and
it was simply left out.

Reverting the fix and re-running the chain stops it at `deliver` with no branch
on the remote. Restoring it completes. Every unit test passes either way —
which is the whole argument for the next section.

---

## ⚑ Finding 6 — nothing checked that the machine completes

Five of the six findings above were found by RUNNING the thing. None was found
by reading it, and the suite was green throughout. That is the structural
finding, and it is the one this window exists to close.

`scripts/chain-completes.py` drives the real verb against the INSTALLED
package: a document in, the interview, the plan, the gate diff, the red trial,
a scripted worker standing in for the paid agent, convergence, and a delivered
branch on a remote. It refuses if any step is missed, if the acceptance check
was not red first, or if no branch carrying the work reaches the remote. It
touches no network, needs no key, and makes no model call — the paid seams stay
manual, because a model drafting well is not a thing a release can promise.

`scripts/release-check.sh` runs it, and a test holds it there.

```
  ok    the chain reached prd-copied
  ok    the chain reached spec-reused
  ok    the chain reached plan
  ok    the chain reached approve
  ok    the chain reached gate-diff
  ok    the chain reached try-gates
  ok    the chain reached gates-tried
  ok    the chain reached install-gates
  ok    the chain reached building
  ok    the chain reached board
  ok    the chain reached deliver
  ok    the chain reached done
  ok    the acceptance check was red before the work
  ok    a delivered branch is on the remote: wringer/20260826-092249-434a
  ok    the delivered branch carries the work
chain: the machine completed, end to end
```
""")

OUT.write_text("\n".join(parts), encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
