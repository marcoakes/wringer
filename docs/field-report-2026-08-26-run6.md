# Wringer field report — 2026-08-26 (run 6, the spare Mac; verbatim as delivered by Marc)

Run: the pipeline worked example, driven end to end from docs/drive/AGENTS.md by a coding agent acting as transport, for a product manager. Outcome: reached delivered — branch pushed, one criterion proved, one human criterion answered, six unevidenced and honestly reported as such. Cost: one drafting call, one worker turn (4m 40s). One run was stopped before any spend by a preflight that turned out to be wrong (finding 1).

## Machine

| | |
|---|---|
| Host | macOS 25.5.0, Apple silicon, IT-managed |
| Policy file | /Library/Application Support/ClaudeCode/managed-settings.json — forceLoginMethod: claudeai |
| Builder auth | authMethod: claude.ai, apiProvider: firstParty, enterprise (AlphaSense) |
| wring | 0.4.8, installed via uv tool install wringer |
| claude-agent-acp | 0.70.0 |
| Worker config | acp: claude-agent-acp, bare name, no key |

This is the org-pinned class of machine the runbook's decision table describes, where the login route is the only route that is not refused.

## Finding 1 — worker_env() drops USER, so a logged-in agent reports logged out

Severity: high. It stops every run on any macOS machine restricted to the login route, and the message sends the operator to fix something that is already correct.

wringer/acp.py: worker_env() hands the worker exactly three variables — PATH, HOME, LANG — plus whatever env_passthrough declares. That design is right, and worker_auth.read() correctly asks the question in the same environment the real turn gets.

But on this machine the credential is in the macOS Keychain (item Claude Code-credentials; there is no ~/.claude/.credentials.json), and claude-agent-acp needs USER to find its own Keychain item. Bisected, one variable at a time:

| environment handed to the agent | auth status |
|---|---|
| PATH, HOME, LANG — exactly what worker_env() passes | loggedIn: false, authMethod: none |
| the same plus USER | loggedIn: true, authMethod: claude.ai |
| plus LOGNAME / SHELL / TMPDIR / SSH_AUTH_SOCK / XPC_SERVICE_NAME / __CF_USER_TEXT_ENCODING, each alone | loggedIn: false |

USER alone flips it. Same binary, back to back.

Consequences, in order of severity:

1. The drive stops at stopped:worker-signed-out on a genuinely logged-in agent — a false red. wring doctor reports the same: ! worker auth claude-agent-acp reports it is not logged in.
2. The remedy it prints is wrong for this machine in a way that makes things worse. It offers two routes; the operator has already done the first, so the only apparently-untried route is "declare ANTHROPIC_API_KEY under env_passthrough" — which on an org-pinned machine is the documented cause of session/new refusal. The refusal message walks the operator into the one configuration the rest of the documentation exists to warn them off.
3. Worse than the preflight: run_turn uses the same worker_env(). Even with the preflight bypassed, the real build turn would be equally blind.

Fix (one line, no key):

    run:
      worker:
        acp:
          command: "claude-agent-acp"
          env_passthrough: [USER]

Suggested product fix: add USER to the three names worker_env() always passes. It is not a credential, it carries no authority of its own, and without it a Keychain-stored login is invisible to the worker. If that is too broad, agents.py could declare a per-agent set of environment names required for credential resolution.

Why nobody upstream hit this. On an unmanaged machine people use the key route: the key is declared explicitly, crosses into the worker, and no Keychain read happens. The Keychain read only matters on the login-only route — and that route is exactly the one this class of machine is forced onto. This is the same shape as the runbook's own "Correction to the correction": the machine was the variable nobody was holding still.

Documentation follow-on. AGENTS.md's "THE BUILDER'S CREDENTIAL — the one place this is written down" is the right place for this, and it does not currently mention it. The table's "log the agent's CLI in, and pass NO key" is incomplete: on macOS it needs "and pass USER".

## Finding 2 — a subscription login does serve a build turn (previously unmeasured)

AGENTS.md says outright: "Still unmeasured: whether a subscription login specifically serves a turn through this adapter, because no machine here has one."

Measured here. With env_passthrough: [USER] and no key:

    iteration 1/2   ✓ lint  ✓ test  ✗ gb-skip-downstream   → worker 4m 40s (exit 0)
    iteration 2/2   ✓ lint  ✓ test  ✓ gb-skip-downstream

5 files changed, +203 −6. authMethod: claude.ai, enterprise. The login-only route is not merely the one that isn't refused — it works end to end. That sentence in the runbook can now be replaced with a measurement.

## Finding 3 — the handover surfaces do not carry the unevidenced count

Severity: medium, but it is the product's own thesis. The runbook's Law 1 exists because "two surfaces describing one fact drift apart; that is the failure this product exists to catch." Here two surfaces describe the same run and only one carries the caveat.

At approval time the plan is admirably blunt:

      0 of 8 have a check bound to them.
      1 is yours to decide — no check can, and you record the answer yourself.
      7 have nothing checking them yet.

After delivery, the record is evidenced: 1, unevidenced: 6, human: 1. Where each surface says so:

| surface | discloses the 6 unevidenced? |
|---|---|
| board.html | yes — "NOTHING CHECKS" ×6, criteria named |
| acceptance.json | yes — full per-criterion detail |
| bundle summary.md | no — 16 lines, 0 mentions; says "result: passed — all required gates passed" |
| mr.md (travels to the reviewer) | no — 0 mentions; gate table only |

Both are literally true: all gates passed. But mr.md and summary.md are the two surfaces that travel with the code to whoever merges it, and neither says that six of eight required criteria have nothing checking them. mr.md points at summary.md as "the human-readable report", and that file omits it too.

A reviewer reading the merge request sees three green gates and the word "passed". The unevidenced: 6 lives only on the board, which stays on the machine that ran it.

Suggested fix: put the acceptance counts in both mr.md and the bundle's summary.md — one line would do, e.g. "Acceptance: 1 evidenced, 6 unevidenced, 1 human-judged. Six required criteria have no check bound and are not proved."

## Finding 4 — AGENTS.md step 6 cannot be followed after a clean install

Step 2 is emphatic that the three-repo era is over: "There is nothing to clone and nothing to chain." Step 6 then says:

    cd wringer-drive/examples/pipeline
    sh setup.sh ~/wringer-example

After uv tool install wringer there is no wringer-drive/ directory, and the installed distribution ships no examples/ (checked: no examples directory and no setup.sh anywhere under the tool's site-packages). A first-time reader following the runbook exactly stops here.

This run only got past it because a source clone from 2026-08-04 happened to exist on the machine. Severity: high for a first-time user — it is the step where a non-engineer has nothing to fall back on.

Suggested fix: either ship examples/ in the distribution and point at its installed location, or say plainly in step 6 that the examples require a clone and give the git clone command.

## Transport note (not a product defect)

The agent driving this run lost one interview question in transit: its polling loop recomputed "steps seen so far" at the start of each check, so a step that arrived between two checks was counted as already-seen and never relayed. The run was blocked on stdin for ~20 minutes and looked hung. resume.json recorded last_question correctly throughout, which is what identified the fault as the transport's rather than the engine's.

Worth a sentence in AGENTS.md beside the never-queue-ahead rule: an agent relaying these steps must track a monotonic cursor over the step stream, not a count sampled at read time. The existing text warns about writing too early; nothing warns about reading too late.

## What worked, and is worth not breaking

- The preflight stopped before spending. Even though its answer was wrong (finding 1), it refused before the drafting call, and said so: "Nothing was built and nothing has been spent."
- wring deliver diagnosed its own staleness. Asked to deliver after the human verdict was recorded, it refused — and then explained why the refusal was about to be wrong: "You HAVE answered summary-readable-at-a-glance … This record was written before that, and it is the record this refuses on. Run wring verify again." A refusal that names its own remedy is the best thing in this run.
- The human criterion held the handover. Gates green, work done, and it still would not deliver until a person judged the one thing no check can. That is the product's central claim and it behaved exactly as advertised.
- --verdict printed the exact wording first, and said the answer is pinned to it and goes stale if the requirement is reworded.
- DECIDED WITHOUT ASKING YOU surfaced six decisions the drafter took unasked, each with the question it replaced. This is the block a PM is least likely to expect and most likely to disagree with, and it is impossible to approve the plan without being shown it.

## Suggested priority

1. Finding 1 — USER in worker_env(). Blocks every org-pinned macOS machine, and its error message points at the one configuration that makes things worse.
2. Finding 4 — the unfollowable install step. Cheapest fix, stops first-time users cold.
3. Finding 3 — unevidenced count absent from mr.md and bundle summary.md. The gap is in the product's own thesis.
4. Finding 2 — replace the "still unmeasured" sentence with the measurement.
5. Transport cursor note in AGENTS.md.

## Covering note (the evaluator's own)

The honest headline is that Wringer did the thing it claims: it built working code, passed every gate it had, and then refused to say "done" because one requirement needed a human. It only handed over once you'd answered. And the single best moment in the run was a refusal that diagnosed itself — when I asked it to deliver after recording your verdict, it declined and explained that its own evidence predated your answer, naming the command to fix it.

Housekeeping: the demo lives at ~/wringer-example-3; the copies from the 18th and 25th are untouched. One thing that looked like a hang was the transport's bug, not the product's — nobody should chase it.
