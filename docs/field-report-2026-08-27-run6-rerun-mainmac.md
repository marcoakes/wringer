# Field report — run 6 RE-RUN on Marc's main Mac, 2026-08-27

Venue: Marc's main Mac (unmanaged — no coding-agent policy file). Sheet:
`WRINGER_RUN6_RERUN_SHEET_2026-08-27.md`. Runbook followed:
`docs/drive/AGENTS.md` @ `d804749` (`v0.4.10`). Driver: Claude Code acting as
the coding agent. Marc kept two acts: the agent login and the judgement pen.

**Outcome: the chain ran end to end — converge → HOLD → pen → refusal.
Delivery was refused because Marc judged the human criterion `not_met`.
That is the product working. The delivered-branch leg is therefore NOT
exercised by this run.**

Wall clock: clone+setup 17:07, drive started 17:22:45, build start 17:33:10,
converged 17:35:30, `--prove` 17:40:30, delivery refused 17:41.
Roughly 34 minutes end to end; the drive itself ~13 minutes.

Cost: the worker reported **$0.729392 USD** for one turn (`usage.json`,
`"verified": false`, `"reported_by": "agent"`). Wringer's own drafting spend
is reported only as tokens — completion 6,542, prompt 2,432, total 8,974 —
and the board says out loud that "Wringer does not price them".

---

## 1. Install — verbatim, at the start

Pre-existing state on this machine, captured BEFORE the forced reinstall
(this Mac carried a stale editable install once, so it was worth knowing):

```
=== which -a wring (BEFORE) ===
/Users/marc/.local/bin/wring

=== wring --version (BEFORE) ===
wring 0.4.10
```

No `.pth` into a working tree, no `.venv`. The stale-editable-install defect
did **not** recur.

```
$ uv tool install --force wringer
Resolved 2 packages in 1.16s
Installed 2 packages in 7ms
 + pyyaml==6.0.3
 + wringer==0.4.10
Installed 4 executables: wring, wringer, wringer-board, wringer-drive
```

```
$ which wring
/Users/marc/.local/bin/wring

$ wring --version
wring 0.4.10
```

Both required by the sheet, both correct. Preflight:

```
git version 2.50.1 (Apple Git-155)
uv 0.12.0 (b88d7c5c4 2026-07-28 aarch64-apple-darwin)
v24.19.0
/Users/marc/.local/bin/claude-agent-acp        (0.70.0)
```

### `wring doctor` — every line, machine level

```
✓ python                Python 3.12.13
✓ wring                 wring 0.4.10, and all four commands resolve into /Users/marc/.local/bin
✓ git                   git version 2.50.1 (Apple Git-155)
! container runtime     no container runtime found (Apple silicon detected)
                        → Install apple/container (needs macOS 26) or Docker Desktop — or skip the container and run wring directly
- git repository        not a git repository — run from your repo to check
- gates                 not a git repository — run from your repo to check
- runnable checks       not a git repository — run from your repo to check
- last verify           not a git repository — run from your repo to check
- pytest parallelism    not a git repository — run from your repo to check
- workspace writable    not a git repository — run from your repo to check
- worker auth           not a git repository — run from your repo to check
✓ managed settings      no coding-agent policy file at /Library/Application Support/ClaudeCode/managed-settings.json (absence here is not proof this machine is unmanaged — it is one path, checked)
! llm key               no LLM API key set — looked for ANTHROPIC_API_KEY, CODEX_API_KEY, KIMI_API_KEY, OPENAI_API_KEY, WRINGER_API_KEY
                        → Only needed for `wring judge --send` and for an agent driving `wring run`; this repo declares no name, so those are the well-known ones. Provide it when you launch, and never paste it to an agent

This machine is ready. The - lines describe a repository and were not checked here — run `wring doctor` from your repo for those.
```

### `wring doctor` inside the example project

```
✓ python                Python 3.12.13
✓ wring                 wring 0.4.10, and all four commands resolve into /Users/marc/.local/bin
✓ git                   git version 2.50.1 (Apple Git-155)
! container runtime     no container runtime found (Apple silicon detected)
✓ git repository        /Users/marc/wringer-example/project
! gates                 no .wringer.yaml here yet
                        → Run: wring init
✓ runnable checks       2 could be detected from pyproject.toml
! last verify           never run here, so nothing is known yet
                        → Run: wring verify
- pytest parallelism    no config to read
✓ workspace writable    /Users/marc/wringer-example/project/.wringer is writable
- worker auth           no .wringer.yaml
✓ managed settings      no coding-agent policy file at /Library/Application Support/ClaudeCode/managed-settings.json (absence here is not proof this machine is unmanaged — it is one path, checked)
! llm key               no LLM API key set — ...
```

Every `!` here is an expected pre-run state, not a red line.

---

## 2. The credential

`claude-agent-acp --cli auth status` before Marc logged in:

```json
{
  "loggedIn": false,
  "authMethod": "none",
  "apiProvider": "firstParty"
}
```

After Marc's own `claude-agent-acp --cli auth login --claudeai`:

```json
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "email": "oakesmarc4@gmail.com",
  "orgId": "deea4411-b175-403f-925a-a408714c9ec2",
  "orgName": "oakesmarc4@gmail.com's Organization",
  "subscriptionType": "max"
}
```

**No `env_passthrough` anywhere.** The generated `.wringer.yaml` contains no
such line; `grep -rn env_passthrough .wringer.yaml` returns nothing. The
worker's built environment carried `USER` on its own and the Keychain login
was visible to the builder with nothing declared — the 0.4.9 fix, holding.

### The `worker-auth` step, exact words, before anything was spent

```
The coding agent that will do the building says it is logged in (claude.ai) —
checked before anything was spent. That is the agent's own word for it and not
a promise the credential still works: a revoked key and a lapsed subscription
both report being logged in, and both fail at the build step.
```

`detail: {"state": "logged_in", "method": "claude.ai"}`. Present, and it
arrived before the `drafting` step. **No regression.**

---

## 3. The run, in order

Setup answers given (three `ask` steps, documented example values, each
answered only after its question had rendered — never queued):

| question | answer |
|---|---|
| `setup:endpoint` | `https://api.anthropic.com/v1/chat/completions` |
| `setup:model` | `claude-opus-5` |
| `setup:worker` | `acp: claude-agent-acp` |

Gates detected from `pyproject.toml`: `ruff check .`, `pytest -q`.
`max_iterations: 2`.

Interview: **one** question, `question:multi-failure-attribution`:

> When a step was waiting on two or more different failures at once, should the
> summary name every failure it was waiting on, or just one of them (and if
> one, the nearest upstream failure)?

Answered (by the driver, with Marc's explicit delegation of the `ask` steps):

> Name every failure it was waiting on, not just one: a step blocked by two
> broken things needs both fixed, and naming only one would send the reader off
> to fix half the problem and come back puzzled. Attribute each to the nearest
> upstream failure it was directly waiting on, never to whichever failure
> happened first in the run.

Marc answered all four `confirm` steps himself: `answers-ok`, `approve`,
`try-gates`, `install-gates`.

### The checks, as a diff

```diff
--- a/.wringer.yaml
+++ b/.wringer.yaml
@@ -22,6 +22,11 @@
   - id: test
     run: pytest -q
     timeout: 300
+  - id: acceptance
+    run: pytest -q acceptance
+  - id: skip-downstream-acceptance
+    run: pytest -q acceptance/test_skip_downstream.py
+    proves: downstream-steps-not-attempted
 
 judge:
   endpoint: https://api.anthropic.com/v1/chat/completions
```

Trial before install, verbatim:

```
I ran them against the project as it stands: acceptance, skip-downstream-acceptance.
None of them passes today.
detail: {"tried": ["acceptance", "skip-downstream-acceptance"], "already_passing": []}
```

**`None of them passes today` — exactly as the sheet predicted.** Hold on to
this sentence; finding 1 is about what happened to it.

### The build

```
iteration 1/2
✓ lint passed        0.0s
✓ test passed        0.2s
✗ acceptance failed  0.2s
→ worker             2m 17s  (exit 0)

iteration 2/2
✓ lint passed        0.0s
✓ test passed        0.1s
✓ acceptance passed  0.2s
✓ skip-downstream-acceptance passed 0.2s
```

One worker turn, 2m 17s, exit 0, converged at iteration 2. Faster than the
4m 40s of the 2026-08-26 run. **A claude.ai subscription login builds** —
second independent confirmation, now on an unmanaged machine.

### The stop, whole

```
The handover is being held because at least one requirement cannot show its proof.

wring deliver: refusing to deliver 20260827-163530-e7f5 — its gates passed,
but the spec is not satisfied by the record:

  downstream-steps-not-attempted — UNEVIDENCED
    `skip-downstream-acceptance` passed, but nothing in the record shows it can fail — a gate born green evidences nothing. run `wring verify --prove` to record whether it can fail, or install the gate first and watch it go red
  summary-reads-clearly — HUMAN
    nobody has answered this — a person decides it, and records the decision in `wringer.judgements.yaml`

A criterion is evidenced when its gate passed AND the record shows that gate
can fail. Make the evidence better, not the check weaker.
```

**The stop's first sentence points at proof, not at a login** — correct, and
the worker's log agrees (the turn succeeded, exit 0). The 0.4.10 failed-build
stop was not exercised, because the build did not fail.

`worker.stdout.log` — 144 lines, ACP session updates. Top of file:

```
[available_commands_update] {"sessionUpdate": "available_commands_update", "availableCommands": [...]}
[usage_update] {"sessionUpdate": "usage_update", "used": 24430, "size": 1000000}
[agent_message_chunk] {..., "text": "I"}
[agent_message_chunk] {..., "text": "'ll start by looking at the"}
[agent_message_chunk] {..., "text": " failing test and the current impl"}
[agent_message_chunk] {..., "text": "ementation."}
[tool_call] {"_meta": {"claudeCode": {"toolName": "Bash"}}, ...}
```

No authentication error anywhere in it.

### The pen

```
$ wringer-board judge
These requirements are waiting for a person to judge them:

  summary-reads-clearly
    A reader can tell at a glance which one thing to fix

    How to tell: A person reads a summary from a run with two failures and several skips and judges whether the wording makes the real failures and their knock-on skips immediately distinguishable without opening the logs.
```

To let Marc judge that against the real thing rather than a description, the
driver ran the built pipeline over a chain with two failures and four skips:

```
  FAILED   build  compiler crashed: missing header stdio.h
  ok       docs
  FAILED   lint  3 style violations in src/api.py
  skipped  format  stopped by lint
  ok       notify
  skipped  test  stopped by build
  skipped  package  stopped by build
  skipped  publish  stopped by build

Run did not succeed: 2 failed (build, lint), 4 skipped (format, test, package, publish)
```

(exit 1). `publish` waits on both `package` (blocked by `build`) and `format`
(blocked by `lint`); only `build` is named. See finding 3.

Marc's verdict, recorded:

```
$ wringer-board judge --id summary-reads-clearly --verdict not_met --note "..."
You are answering this requirement:

  summary-reads-clearly
    A reader can tell at a glance which one thing to fix
  ...
------------------------------------------------------------
wringer-board: recorded 'not_met' for 'summary-reads-clearly' in wringer.judgements.yaml
wringer-board: this is your answer, recorded against the wording above. If that wording later changes, the answer goes stale and you will be asked again.
```

And it bites:

```
"reason": "a person judged this NOT met (Pipeline team). The work is not done; nothing here can overrule that",
"cause": "human-said-no"
```

### The ending

```
$ wring deliver --send
wring deliver: refusing to deliver 20260827-164029-3214 — its gates passed,
but the spec is not satisfied by the record:

  summary-reads-clearly — HUMAN
    a person judged this NOT met (Pipeline team). The work is not done; nothing here can overrule that
---- exit: 1 ----
```

---

## FINDINGS

### 1. A gate the person watched go red is recorded as "born green"

The drive said, to the person's face: **"None of them passes today."** Minutes
later the record refused with **"nothing in the record shows it can fail — a
gate born green evidences nothing."** Both statements are true, which is the
problem.

Mechanism, confirmed from the run directories:

| run | gate directories that exist |
|---|---|
| `20260827-163311-41dc` (iteration 1) | `001_lint`, `002_test`, `003_acceptance` — **stops here** |
| `20260827-163519-1c9e` (iteration 2) | all four, all green |
| `20260827-163530-e7f5` (final verify) | all four, all green |

The gate runner is fail-fast. `acceptance` failed at iteration 1, so
`skip-downstream-acceptance` **never ran inside any recorded run while it was
red**. And the pre-install trial that did see it red is persisted **nowhere**:
`.wringer/` contains `drive/`, `loops/`, `refusals/`, `runs/`, `specs/` and no
trial record at all.

So the product performed the red-first ritual for the human and threw the
witness away before writing the record that refuses for its absence. The
approved plan had promised, in writing: *"it must be seen to FAIL first"*.

Not fatal — the engine names its own remedy and the remedy works (see below) —
but it is friction the product manufactured for itself, and it lands on the
one surface (`board.html`) a PM reads.

**Suggested shape of a fix:** persist the `try-gates` trial as a witness, or
run the bound gates independently of fail-fast ordering when they are being
tried for the first time.

### 2. `board.html` contradicts the record and the engine's own refusal

After the pen moved and `wring verify --prove` ran, `wringer-board render` was
run again. The board still says:

```
0 of 8 proved · 1 needs you · 7 cannot be proved yet — they have no working check

NEEDS AN ENGINEER  A step whose dependency failed is never executed
  The check passes, but it has never been recorded failing — so its passing proves nothing yet.

NEEDS YOU  A reader can tell at a glance which one thing to fix
  No check can decide this one — it needs a person to look and say. Nobody has yet.
  Is this requirement met? Only you can answer it — no check and no agent can. Run
  `wringer-board judge` to see it and record what you found, and until you do, the
  handover waits.
```

The record says otherwise. `20260827-164029-3214/acceptance.json`:

```json
"counts": {"evidenced": 1, "unevidenced": 6, "gate-failed": 0, "gate-did-not-run": 0, "human": 1}
```

and `summary-reads-clearly` there carries
`"judgement": {"verdict": "not_met", "by": "Pipeline team", "stale": false, ...}`.
`wringer.judgements.yaml` holds the verdict with its `criterion_digest`, and
`wring deliver` refused **citing that very verdict** — so the engine reads it.

The board renders `20260827-163530-e7f5` (counts `0/7/1`, matching exactly),
which is the loop's final run. `wring verify --prove` wrote a standalone run
outside the loop, and the board does not follow. `wringer-board render` has
**no `--run` flag** (`usage: wringer-board render [-h] [-o OUT]
[--health-report PATH] [--audit-report PATH] [repo]`) and there is no `latest`
pointer in `.wringer/runs/`.

**Consequence:** the hero surface tells a person to go and do a thing they
have already done, and stays silent about a `not_met` verdict that is at that
moment blocking the handover. Two surfaces describing one fact, drifted apart,
on the page the whole product points at. Note this also bites anyone following
the sheet's own recipe (`judge` → `wring verify` → `wring deliver`), because
`wring verify` likewise writes a standalone run.

### 3. The build did not implement the only interview answer it was given

The single interview question was about multi-failure attribution. The answer
was recorded, echoed back, and the approved plan referenced it explicitly
("follow the answer to the open question on multi-failure attribution").
The built code does not do it. `src/pipeline/runner.py`:

```python
cause = next((blame[need] for need in job.needs if need in blame), None)
```

`next()` takes the first blamed dependency and discards the rest, and
`Result.detail` is a single `str` — the data model cannot hold more than one
cause. Which failure a doubly-blocked step names depends on the order its
dependencies happen to be declared in. The docstring claims the opposite of
what it does for this case: *"not the nearest skip, and not some other failure
elsewhere in the run."*

The criterion that would have caught it, `report-names-cause` ("Each skipped
step is labelled with the failure it was waiting on"), is one of the seven
with **no gate bound**. The defect landed exactly where nothing was watching.
This is the clearest concrete demonstration to date of what "7 unevidenced"
costs — and the board and `summary.md` both disclosed it honestly in advance.

### 4. Unevidenced-but-unbound criteria do not refuse delivery

Of 7 unevidenced criteria, only one (`downstream-steps-not-attempted`,
`cause: born-green`) had `refuses: true`. The other six have `"refuses": false`
and `"cause": "unbound"`. So a delivery can proceed with six required criteria
unproven, as long as none is born-green and no human said no.

This is loudly disclosed — `summary.md` leads with *"⚠ 7 of these 8 criteria
are UNEVIDENCED"* — so it is a design point, not a lie. Flagging it because
the gap between "disclosed" and "refused" is exactly where finding 3 lived.

### 5. The sheet names the wrong Keychain service

`WRINGER_RUN6_RERUN_SHEET_2026-08-27.md` §3 says:

```bash
security add-generic-password -U -s anthropic-api-key -a wringer -w
```

Three other surfaces say `-s anthropic`, and `-s anthropic` is what actually
works:

| surface | service |
|---|---|
| sheet §3 | `anthropic-api-key` — **not found in the Keychain** |
| `docs/drive/AGENTS.md` law 3 | `anthropic` — found |
| `docs/drive/START-HERE.md:34` | `anthropic` |
| `setup.sh` epilogue | `anthropic` |

A person following the sheet literally would store a second entry under a name
nothing reads, then watch the drive fail to find a key. The sheet is the
outlier and should be corrected to `anthropic`.

### 6. Smaller notes

- **One interview question, not "a handful"** (sheet §7.1). Not wrong, just
  worth recording that the drafter asked once.
- **No `mr.md` exists.** The sheet's bring-back list item 5 asks for it, but
  it is produced by a completed `wring deliver`, and delivery was refused.
  `summary.md` exists inside each run directory, not at the project root.
- **The runbook path defect did NOT recur.**
  `~/wringer-source/docs/drive/examples/pipeline` exists and holds `setup.sh`;
  the decoy `~/wringer-source/examples/` holds `claude-code-hook`,
  `github-actions`, `graphs`, `tasks` and no `pipeline`. Third attempt,
  correct. No directory was entered that this page's own earlier steps had not
  created.

---

## CONFIRMED WORKING (no regressions in what the sheet said was settled)

- **Logged-in is shown before anything is spent** — the `worker-auth` step
  arrived ahead of `drafting`, with the exact words quoted above.
- **The false "signed out" is gone, with no workaround applied** — no
  `env_passthrough` anywhere, and the builder authenticated on the login route.
- **`summary.md` discloses the unproved work** — verbatim:

  > ⚠ **7 of these 8 criteria are UNEVIDENCED: nothing in this run shows they
  > are met.** Every gate passing means the change is mergeable. It does not
  > mean the thing that was asked for was built, and these are the difference.

  and separately:

  > ⚠ **`skip-downstream-acceptance` should be RED.** It proves
  > `downstream-steps-not-attempted`, and nothing in the record shows it can
  > fail. If the criterion is unmet, a gate that proves it must fail here —
  > green means it tests something else, not that the work is done.

- **A subscription login builds.** Second confirmation, first on an unmanaged
  machine: one turn, 2m 17s, exit 0, converged at iteration 2.
- **`wring verify --prove` works, and states its own limit.** It reverted the
  change, ran the gate against the pre-change tree and recorded a real red:

  ```json
  "receipt": {"kind": "sensitive", "bundle": ".wringer/runs/20260827-164029-3214", "cites": "6 failed, 3 passed in 0.12s"},
  "demonstrated_able_to_fail": true,
  "reason": "`skip-downstream-acceptance` passed, and the record shows it can fail. unverified — this run declared no 'run.prove_setup', so a pre-change tree missing its dependencies would have failed for that reason instead. Read 'cites' to tell the two apart"
  ```

  The caveat is volunteered, not hidden, and `cites` (3 still passing) is what
  distinguishes the two cases.
- **The judgement is pinned to the wording** via `criterion_digest`, and
  `wringer.judgements.yaml` says in its own header that no flag, no environment
  variable and no coding agent writes it.
- **The refusal is grounded in the person, not the machine**: *"a person judged
  this NOT met (Pipeline team). The work is not done; nothing here can overrule
  that."*

---

## WHERE THE DRIVER HESITATED

Worth more than a crash, per the sheet.

1. **Whether the three setup `ask` steps were mine to answer.** The runbook
   says relay every `ask` verbatim and let the person answer; Marc's launch
   prompt said only two acts were his. I relayed the first question and asked;
   Marc then explicitly delegated the `ask` steps ("answer all questions
   sensibly"). I took that as authority over `ask` only, and said so before
   proceeding.

2. **Whether "ok what next" was a yes.** It arrived where the `answers-ok`
   confirm was waiting. I did not write it. The 2026-08-22 incident is exactly
   this shape with the polarity reversed — text that was not "yes" landing in
   an approval window — and the transport cannot prove intent. I asked for the
   word and got it.

3. **Whether running `wring verify --prove` was "working around a refusal on
   my own initiative"**, which the runbook forbids. The engine names `--prove`
   as its own remedy, which argues it is not a workaround; the prohibition
   argues the choice is not mine either way. I asked Marc rather than deciding.

4. **Whether telling Marc that `publish` names only one of its two blocking
   failures was volunteering a verdict.** The runbook forbids volunteering,
   inferring, or judging to clear a refusal. I judged the distinction to be
   fact-versus-verdict: I stated what the summary does and what the code does,
   said explicitly that it was not a verdict, and left `met`/`not_met` to him.
   I still think that is the right line, but it is the thinnest one in this
   report — a driver that reports the fact most damaging to a criterion is
   steering, even when every sentence is true.

5. **Building the two-failure summary at all.** The criterion's "How to tell"
   requires a person to read a summary from a run with two failures and several
   skips. No such summary existed. Manufacturing one is transport work — it
   puts the thing in front of the person — but I chose the fixture, and the
   fixture is what exposed finding 3. A different fixture would have produced a
   different verdict.

---

## GATE 1 STATUS

| leg | result |
|---|---|
| fresh install, right binary, right version | **PASS** |
| every stop legible | **PASS** — the stop led with proof, not a login, and the record agreed |
| converge | **PASS** — 1 turn, 2m 17s, 2 iterations |
| HOLD | **PASS** — refused on born-green + unanswered human |
| the pen | **PASS** — moved, pinned to wording, and it bit |
| a delivered branch | **NOT EXERCISED** — delivery correctly refused because the pen said `not_met` |

The honest reading: **five of six legs pass, and the sixth was not reached
because the product did the right thing.** Exercising it requires the
multi-failure defect (finding 3) to be fixed and the criterion re-judged on the
corrected summary — not the verdict flipped, which the runbook forbids and
which would prove nothing anyway.

---

## ARTEFACTS

- `~/Claude/WRINGER_RUN6_RERUN_RUNS_2026-08-27.zip` — the whole `.wringer/`
  tree (91K): `runs/` ×4, `loops/`, `refusals/`, `specs/`, `drive/`.
- `board.html` — `/Users/marc/wringer-example/project/board.html` (stale by
  finding 2; its text is quoted above).
- `summary.md` — inside each run directory, e.g.
  `.wringer/runs/20260827-163530-e7f5/summary.md`.
- `wringer.judgements.yaml` — in the project root, quoted in full above.
- Two-failure fixture used for the pen:
  `two_failures.json` (build/lint both fail; test, package, format, publish
  skipped; docs, notify unaffected).
