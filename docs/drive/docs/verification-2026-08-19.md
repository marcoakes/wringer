# The verification drive — 2026-08-19

*One drive of `examples/arcade`, through a relay obeying [`AGENTS.md`](../AGENTS.md),
after the field run's fixes landed. Console pasted verbatim:
[`verification-2026-08-19-console.txt`](verification-2026-08-19-console.txt).
The relay is beside it: [`verification-2026-08-19-relay.py`](verification-2026-08-19-relay.py).*

**What this run is evidence about, and what it is not.** It measures the
MECHANISM — how many questions the drafter asks, whether the build's progress
reaches the operator, whether the ending reads honestly. The answers were
scripted by an engineer in a product manager's register, so this is **no
evidence at all about how a real product manager answers**, which is the same
correction [`demo-2026-08-19.md`](demo-2026-08-19.md) now carries about itself.
One real PM drive has happened, on 2026-08-18, and it is what produced the
fixes measured here.

## What it shows

| | before | this run |
|---|---|---|
| interview questions | **12** on this same PRD (2026-08-18) | **2** |
| build progress | nothing on screen between "Building now" and the ending | `iteration 1/2`, three gate lines and `→ worker 1m 49s` as they happened |
| a worker that changed nothing | `no_progress`, and no way to tell "tried and failed" from "never engaged" | the ending carries the engine's diagnosis |
| consent gates | held | held — three of them, all answered by the script, none by the tool |

The two questions were both real product decisions (what counts as played;
whether a person can clear the list). Neither was a lookup.

## The build was visible, and the timestamps are the evidence

```
[  79.2s]   ⋯ iteration 1/2
[  79.8s]   ⋯ ✓ lint passed        0.5s
[  80.1s]   ⋯ ✓ test passed        0.3s
[  80.2s]   ⋯ ✗ acceptance failed  0.1s
[ 189.5s]   ⋯ → worker             1m 49s  (exit 0)
[ 189.5s]   ⋯ iteration 2/2
[ 190.6s] show     building
```

The `⋯` lines are the ENGINE's own, relayed from stderr as they arrived. The
step stream's `building` step lands at 190.6s — **111 seconds after the loop
actually started**, which is exactly the silence the field run hit. A PM
watching this run saw the loop working the whole time.

## The empty-turn diagnosis fired on a real turn

The worker called the model, spent 1m 49s, exited 0 and wrote nothing. The
loop stopped on `no_progress` — unchanged — and the ending carried:

> the agent finished its turn without changing a file or reporting an error;
> this usually means it could not authenticate, or could not see the work.
> what a worker is given is declared by the operator, in
> `run.worker.acp.env_passthrough`; nothing else crosses that boundary

`worker-diagnosis.json` in the loop bundle records the facts it was read from:
`stop_reason: end_turn`, `files_written: 0`, `refusals: 0`, and the agent's own
last words beside them.

**And the hint was wrong about the cause, which is worth saying plainly.** The
agent authenticated fine — it reached the model and thought for nearly two
minutes; what it returned was not something it could write. The sentence is
hint-tier and phrased as a possibility for exactly this reason, and the agent's
own account travels beside it as `engine_words` rather than being replaced by
the guess. But the two causes it names did not include the one that happened,
and a third clause naming "or produced nothing it could use" would have been
truer. **Flagged, not fixed: the wording is Fable's.**

> **Ruled same day, 2026-08-19:** the third clause was adopted exactly as
> flagged — the hint now reads *"…could not authenticate, could not see the
> work, or produced nothing it could use"* (core `c492a7f`, guard red-watched
> against the two-cause wording). The quotes above are the capture and are
> unchanged; this note is the correction.

## What the drive FOUND

**In `--emit json` the ending went to stderr, so an agent following
`AGENTS.md` would never see it.** `main` sent a non-zero stop to the error
channel — right for a person at a terminal, wrong for the transport this
package exists for, because stdout IS the step stream and the refusal is the
last and most important object in it. It only appeared in this capture because
the relay happens to pump stderr as well; a strict reader would have shown the
person a board and silence. Fixed the same day with a guard that was red on
the real shape, and its other half pins that a terminal user's refusal still
goes to stderr.

**The relay answered one question with the other's answer.** Its table matches
on the question's words, and "played" matched both. That is a defect in this
harness, not in the product — and it is the concrete argument for `AGENTS.md`
law 1: a transport relays the question and lets the person answer it, instead
of matching prose to a script.

## What it cost

One drafting call: **2,196 in + 6,013 out = 8,209 tokens** (`claude-opus-5`),
from `.wringer/specs/…/response.json`. One worker turn, 1m 49s, through a
minimal ACP agent written for these captures that reports no usage — so its
tokens are not recorded here and are not claimed. Nothing else called a model.

## What it does not show

No vendor agent was driven — the worker is the same minimal ACP agent the
2026-08-19 captures used, not Claude Code, Gemini CLI, Goose or Kimi. No
handover was made: the script answered `no` at the delivery gate, and the
engine was refusing anyway because the acceptance check was still red. One
repository, one scenario, one machine, one run, and the drafter is
non-deterministic — the question count will move.
