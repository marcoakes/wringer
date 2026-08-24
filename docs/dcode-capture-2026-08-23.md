# dcode as a Wringer ACP worker — measured 2026-08-23, on the author's Mac

*The adoption Marc directed ("let's take that acp worker"), measured the same
hour with the repo's own probe (`scripts/acp-auth-probe.py`) and one live
loop. `deepagents-code 0.1.59` installed user-level (`uv tool install
deepagents-code`), from LangChain's deepagents monorepo (`23b83ad`). Captures
verbatim; nothing summarized that a reader could re-measure.*

## Why this worker matters to the charter

One ACP worker, powered by ANY model LangChain speaks (frontier, open-weight,
local), credentialed by PLAIN ENV VARS — the declared-act boundary working as
designed, with no login state, no subscription trap, no auth-methods dance.
Three vendors' keys accepted by one binary. This is "works with anything"
compounding: worker-lane agnosticism × brain-model agnosticism in a single
roster row.

## The probe ladder — four runs

**RUN 0 — no credential, startup (free).** `dcode --acp` with no key exits 1
before any protocol exchange:

    Error: No credentials configured. Please set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY

The most legible refusal in the census, and a THIRD measured rung for the
per-agent preflight ladder: startup-refusal (dcode) · session/new-refusal
(Kimi) · prompt-only (claude-agent-acp). A free, instant preflight exists for
this agent: spawn, read exit 1 and the sentence.

**RUNS 1/2 — the probe's crash finding (free).** Against the credential-less
agent, `acp-auth-probe.py` itself died with `BrokenPipeError` at
`session/new` rather than reporting — the probe assumes the agent survives
the handshake. A robustness gap in our own instrument, found by pointing it
at a new agent; owed to the repo as a small fix (report agent-died-at-<step>
instead of crashing).

**RUN 3 — handshake WITH `ANTHROPIC_API_KEY` in env (free).**

    authMethods_present    false
    authMethods            null
    session_new_opened     true
    session_new_is_error   false
    session_new_error      null

**RUN 4 — `--prompt` WITH the key (one mini paid turn).**

    prompt_sent            true
    prompt_answered        true
    prompt_is_error        false
    prompt_result          {"stopReason": "end_turn"}
    stderr_apiType_lines   []

(Noise on stderr: two `Cannot load skills from …: path_not_found` lines —
harmless, and worth knowing the agent looks for `.claude/skills`.)

**Conclusion of the ladder:** with the key in the environment, Wringer's
EXISTING ACP client drives dcode with ZERO code changes. Without it, the
failure is instant, free, and self-explaining.

## The live loop

`.wringer.yaml` worker block (the capstone's proven config, one swap):

    run:
      worker:
        acp:
          command: dcode
          args: [--acp]
          env_passthrough: [ANTHROPIC_API_KEY]
      max_iterations: 2

Fresh arcade example (setup.sh verified: suite GREEN, acceptance RED),
capstone's approved spec + rubric + gates. `wring run --json` launched with
the key in the parent environment — `env_passthrough` carrying it across the
boundary as the declared act. RESULT, verbatim from `wring run --json`:

    {"status": "converged", "reason": "converged", "iterations": 2,
     "loop_dir": ".wringer/loops/20260823-112726-19cc",
     "final": {"status": "passed", "failed_gate": null, ...}}

Iteration 1: lint ✓, test ✓, acceptance-recently-played ✗ (RED) → one dcode
worker turn, **15m01s, TIMED OUT at the 900s ceiling — having already
written the feature**. Iteration 2: lint ✓, test ✓,
**acceptance-recently-played ✓ (GREEN). CONVERGED.**

Two honest notes: the turn's timeout means dcode's turn is slower than
claude-agent-acp's measured 7m48s on the same example, and a turn that
times out AFTER doing its work still converges on the next verify — the
loop's design absorbing a slow worker. And per the deepagents scout:
`dcode --acp` force-enables its own internal auto-approve — fine for a
Wringer worker (every worker is an untrusted builder; the consent surface
is Wringer's), but it must be SAID in the worker's matrix row.

**THE FACT THIS CAPTURE BANKS: two different vendors' agents —
`claude-agent-acp` (2026-08-22) and `dcode --acp` (2026-08-23) — have now
each converged the SAME arcade example under the SAME judge, gates and
boundary. "One neutral judge over any vendor's agent" is a measured PAIR.**

## What this does NOT claim

One agent, one model measured (LangChain's Anthropic default under
`ANTHROPIC_API_KEY`). The OpenAI/Google arms of the same binary are wired by
its own error message but UNMEASURED here — they need keys this Mac does not
hold. The vendors-matrix row this capture backs says exactly that and no
more.

---

*Correction below the capture, not an edit to it (Law 8).*

**2026-08-24, the next day — the OWED in RUNS 1/2 is PAID.** The probe's
`BrokenPipeError` on a credential-less agent is fixed: `scripts/acp-auth-probe.py`
now reports `agent_died_at` and `agent_exit_code` and prints the agent's own
sentence from `stderr_tail`, instead of raising out of `probe()`. The crash was
reproduced before the fix and the guard is
`tests/test_worker_auth.py::test_THE_PROBE_REPORTS_AN_AGENT_THAT_DIED_INSTEAD_OF_CRASHING`,
red-watched by restoring the old script. The death lines are appended only when
there is a death, so every capture this script has already printed reproduces
byte for byte.
