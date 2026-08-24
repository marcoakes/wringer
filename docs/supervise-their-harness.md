# Supervise their harness — `wring verify` as a Stop hook

*Measured 2026-08-23 on the author's Mac against `deepagents-code 0.1.59`.
The capture below is what the commands printed. Law 8: this page is not
edited to match a later tree; a correction goes below it with a date.*

Claude Code and LangChain's `dcode` speak the same hook wire, closely enough
that one script serves both: a `Stop` event, a command handler, and **exit 2
blocks the agent from finishing, with the hook's stderr handed back to the
model as the reason**. That is enough to install Wringer's one sentence
inside a harness that has never heard of Wringer:

> the model stopping is not the same as the work being done.

The whole implementation is `scripts/wring-verify-stop-hook.py`. It runs
`wring verify --json` in the project, exits 0 on `passed`, and otherwise exits
2 naming the check that said no and the bundle that recorded it.

## What was measured

One arcade example, built by `docs/drive/examples/arcade/setup.sh`, with the
capstone's `.wringer.yaml` and its one bound acceptance check. Two runs of
`dcode`, **identical in every respect except the colour of the check** — same
agent, same hook, same prompt, same repository, same credential.

The prompt was chosen to make the agent do nothing at all, so that anything it
did was the hook's doing and not the prompt's:

    dcode -n "Reply with the single word ok. Do not read or change any file." \
          -q --trust-project-hooks

### Run 1 — the check is RED

    $ wring verify --json
    {"status": "failed", "failed_gate": "acceptance-recently-played", ...}

The agent replied `ok`. The Stop hook ran, exited 2, and handed back:

    BLOCKED: 'acceptance-recently-played' is not passing, so this change is
    not done.
    Fix what 'acceptance-recently-played' is telling you and finish again.
    The evidence for this run is at .wringer/runs/20260824-150434-6d4e.
    This is not an opinion about your work: it is the repository's own check,
    executed just now, and it said no.

**The agent did not finish. It built the feature.** Verbatim from its own
output, after the block:

> The gate was right: the feature genuinely did not exist — `src/cabinet.js`
> had no `recordLaunch`/`recentlyPlayed` at all, so all 8 acceptance tests
> failed on the `required()` guard.

It then wrote `src/history.js`, extended `src/cabinet.js`, changed the heading
in `index.html` to the approved wording, and added two test files. Afterwards:

    $ wring verify --json
    {"status": "passed", "failed_gate": null, ...}

### Run 2 — the control, with the check GREEN

Same command, same hook, same prompt, on the tree run 1 left behind.

    ok

The agent replied `ok` and stopped. `git status` was unchanged. The hook
exited 0 and said nothing.

**That pair is the whole claim.** An agent told to do nothing did nothing when
the repository's own check passed, and built a feature when it did not — and
the only thing that differed between the two runs was the check.

## The stanzas

### dcode — `{project}/.deepagents/hooks.json`

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 /path/to/wringer/scripts/wring-verify-stop-hook.py --repo /path/to/project"
          }
        ]
      }
    ]
  }
}
```

Project-scoped hooks need a trust grant. `--trust-project-hooks` gives it
without a prompt, which is what the measurement above used; interactively the
agent asks once and remembers. A user-scoped `~/.deepagents/hooks.json` needs
no grant and applies everywhere, which is usually not what you want.

### Claude Code — `.claude/settings.json`

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 /path/to/wringer/scripts/wring-verify-stop-hook.py"
          }
        ]
      }
    ]
  }
}
```

**Not measured here.** The wire is the same one and the script is unchanged,
but this page only claims what somebody ran, and nobody has run this half.
Treat the Claude Code stanza as the obvious translation of a measured recipe
rather than as a measured recipe.

## What it does not do, and what it costs

- **It fails CLOSED.** Missing `wring`, missing `.wringer.yaml`, a verifier
  that crashed or ran out of time — every one of them blocks, because "I
  could not check" and "it is fine" are different answers and only one of
  them may end a turn. Install it knowing that.
- **A hook that can never go green costs turns.** Both harnesses cap
  consecutive Stop continuations — dcode at 8 — so it is bounded, and then
  the hook stops being consulted and the agent finishes anyway. **The cap is
  the ceiling on this recipe: it makes an agent try, it does not make it
  impossible to stop.** A hook is the harness's guest.
- **It is not the loop.** `wring run` drives a worker through verify → brief
  → worker → verify with a bundle, a ledger and a refusal at the end. This is
  one check at one moment, inside somebody else's turn loop, with no record
  beyond the bundle `wring verify` writes anyway. It is the cheapest way to
  feel the difference between instructed and enforced; it is not a
  replacement for the thing that can refuse a delivery.
- **The agent's own summary is not evidence.** In run 1 the agent said it had
  verified its work "in the JS sandbox" because it had no shell tool. That
  claim is exactly what this project exists not to accept — and it did not
  have to be accepted, because the hook ran the real check afterwards and the
  bundle is on disk.
