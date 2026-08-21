# Wringer — PM usability friction log

**Date:** 2026-08-18
**Evaluator:** Marco Oakes (product manager, not an engineer)
**North star being tested:** *a non-technical PM can use this to build things*
**Verdict:** does not meet that bar today. The safety design is strong; the operator
experience is engineer-grade.

This log is written from one real end-to-end attempt: install from source, set up the
shipped `wringer-drive` pipeline example, draft a spec from a PRD, and reach the
approval gate. The run reached the plan and was declined. Nothing was built.

---

## Summary

| Area | Verdict |
|---|---|
| Safety / consent model | **Genuinely good.** Keep it. |
| Honesty about evidence | **Genuinely good**, but unexplainable to a PM |
| Installation | **Fails the bar.** Cannot be done by a PM |
| The interview | **Fails the bar.** Silent data loss, no confirmation |
| Error recovery | **Fails the bar.** Recovery means hand-editing YAML |
| Question content | **Fails the bar.** Asks a PM to read pytest source |

---

## What is genuinely good, and should not be lost

These are real design strengths and the reason the product is worth fixing rather
than abandoning:

1. **The approval interlock.** `approved: false` in the spec, with the comment "there
   is no flag, and no `--yes`." A person must approve, and when approval didn't come,
   the run exited having changed nothing. Verified: no branch was created, no project
   file was touched.
2. **It refuses to invent things that matter.** The source comments that an endpoint
   is a network address, a model is a bill, and a worker is a command — so it asks
   rather than guessing. That is the right instinct.
3. **It never touches the API key.** The key is read from the environment by name
   only; the tool states it cannot read the environment at all.
4. **It refuses to claim unevidenced work is done.** "It will be reported as
   unevidenced and it will not be claimed as done" is exactly right, and rarer than
   it should be.
5. **It says what it is not claiming.** The "WHAT THIS PLAN DOES NOT SAY" section —
   that a green check against a wrongly-worded requirement proves the wrong thing
   perfectly — is honest in a way most tools are not.

---

## Friction, in the order it was hit

### 1. Installation cannot be done by the target user — **blocker**

Getting to a usable state required: `git`, `uv`, cloning three separate
repositories, three `uv tool install` commands that must be run in a specific order
with specific cross-linking flags, Node.js, an `npm install -g` adapter, and manual
PATH work.

- **Node was not mentioned anywhere in the setup instructions** but is a hard
  requirement (the Claude Code adapter is an npm package). It was absent on this
  machine, which stopped the process dead.
- The machine is IT-managed (Workbrew), so the obvious `brew install node` route was
  not available without elevated permissions.
- After installing Node, `claude-code-acp` **still was not on PATH**, because npm's
  global bin directory was not on PATH. That needed a manual symlink to fix.

> **What a PM-grade version looks like:** one installer that reports what is missing
> and installs it, or an explicit, honest prerequisites list that names Node. Today
> the instructions are written as if the reader already has an engineer's machine.

### 2. The keychain step fails silently in a way that hides a stale key — **high**

`security add-generic-password -s anthropic -a wringer -w` prompts for the key twice,
then errors with `The specified item already exists in the keychain`. The newly typed
key is **discarded** and the pre-existing one silently remains in use.

A PM would reasonably believe they had just set their key. They had not. If the old
key were stale, the failure would surface much later as an opaque auth error.

> **Fix:** detect the existing item and offer to replace it, or tell the user plainly
> that the old key was kept.

### 3. The interview silently scatters a multi-line answer across unrelated questions — **blocker, and the worst defect found**

The interview reads **one line per answer**, with no indication that this is the case.
Pasting a multi-line answer caused:

- Question 6 to record only the **first line** of the intended answer, truncated
- Question 7 — a completely different question about dependency cycles — to record
  **line 2 of the answer to question 6**
- The remaining lines to overflow past the interview into the **approval prompt**,
  where the first stray line counted as "not yes" and **declined the whole run**
- The rest to fall through into the shell, which tried to execute them as commands

**At no point did anything echo back what it had recorded, or ask for confirmation.**
The run then produced a full plan built partly on answers belonging to other questions,
and presented it as what would be built.

> **Fix, in priority order:** (a) echo each recorded answer back and ask "is that
> right?"; (b) accept multi-line input with an explicit terminator; (c) never let
> overflow input fall through into an approval decision. A prompt that can silently
> answer the wrong question is a correctness problem, not a polish problem.

### 4. "NOTHING CHECKS THIS YET" is honest but unexplainable — **high**

The plan reported 8 of 9 acceptance criteria as having no check. This is **technically
correct and genuinely good behaviour** — but understanding *why* requires knowing that:

- the repo ships `acceptance/test_skip_downstream.py`, which **does** assert most of
  those criteria; and
- `pyproject.toml` sets `testpaths = ["tests"]`, deliberately excluding `acceptance/`
  from `pytest -q`; so
- the gates Wringer actually runs never execute those tests, so they count as no
  evidence.

A PM cannot be expected to reach that conclusion. It required reading Python packaging
configuration.

> **Fix:** say it in the output. "These tests exist but are excluded from the gate that
> runs (`pytest -q`, `testpaths = ["tests"]`), so they cannot count as evidence. Accept
> the proposed `acceptance-skip-downstream` gate to change that."

### 5. One interview question is unanswerable by the target user — **high**

> *"Which of the listed criteria does `acceptance/test_skip_downstream.py` (with
> `acceptance/chain.json`) actually assert, so the remaining criteria can be given
> checks of their own?"*

Answering this correctly requires reading a 145-line pytest file and mapping ten test
functions onto nine acceptance criteria. **This is a question for an engineer.** Asking
it of a PM, as a required blocking question, contradicts the product's stated audience.

> **Fix:** the tool can compute this itself. It has the file, and it already parses the
> criteria. If it genuinely cannot, it should be asked of the coding agent, not the PM.

### 6. Three questions were already decided by the code, but asked anyway — **medium**

The existing acceptance test already pins the answers to three of the seven questions:
the overall failure signal (exit code `1` **and** the string `Run did not succeed`),
the attribution rule (**nearest** ancestor), and the summary format (**human-readable
lines** of a specific shape).

A PM answering from intuition can easily contradict the test they are trying to turn
green — and in this run, one answer did exactly that.

> **Fix:** pre-fill these from the test and ask for confirmation, flagging the conflict
> when an answer would contradict an existing check.

### 7. Recovery from any mistake means hand-editing YAML — **high**

Once wrong answers are recorded, there is no "go back" or "edit answers" path. The
only route found was opening `wringer.spec.yaml` in an editor and rewriting the
`answer:` fields by hand — including getting YAML quoting right.

> **Fix:** an "amend answers" command, or re-asking questions on decline.

### 8. The endpoint question offers no default — **medium**

*"Paste the URL your team uses"* is asked with no suggestion, no validation hint and no
example, even though the repo's own documentation and recorded demo transcripts contain
the exact working answer. This is also the single field with a real security
consequence, since it determines where the API key is sent.

> **Fix:** offer the documented default, and state plainly that the key goes to
> whatever URL is entered.

### 9. The approval screen — the most important screen in the product — is written for engineers — **blocker**

The final screen asks **"Is that what you meant? Nothing is built until you say yes."**
That is the correct question. But what it asks the PM to check is this:

> *"Done means the graph module exposes this reachability information as a tested,
> side-effect-free helper… and the helper is expressed in terms the runner can use
> without re-walking dependency edges itself."*

A PM cannot meaningfully approve or reject that. It names source files
(`src/pipeline/graph.py`), and uses "transitively", "reachability", "side-effect-free
helper". The product is asking its stated audience to sign off on implementation detail
they have no basis to judge — at the exact moment it insists only a human can decide.

> **Fix:** show two layers. A plain-language statement of the **behaviour change** for
> approval ("if a step fails, anything waiting on it won't run, and the summary will say
> which failure stopped it"), with the engineering detail available underneath but not
> the thing being approved.

### 10. "NOTHING CHECKS THIS YET" reads as failure, eight times over — **high**

Repeated eight times in a row down the approval screen, this reads as though the plan is
broken. It is not. It describes the state **right now, before anything is built** — and
the plan's own task list says new checks will be written into `tests/test_report.py` and
`tests/test_cli.py` during the build, both of which *do* run under the `pytest -q` gate.

Nothing on the screen tells the reader that. The one line that would defuse it — "these
will gain checks as part of the work" — is absent.

> **Fix:** distinguish "has no check and never will" from "has no check yet, and the plan
> writes one." They currently look identical and alarming.

### 11. The screen never says what to type — **high**

"Is that what you meant?" does not say that the expected input is the single word `yes`,
on its own line. Given that an earlier run in this same session was lost precisely
because stray text reached this prompt and counted as "not yes", the omission is
material.

> **Fix:** state the accepted inputs on the prompt line.

### 12. The build hangs silently and indefinitely, with no way to tell hung from working — **critical**

After all three approvals, the run reached the build step and **stopped dead**, printing
nothing. Measured over three samples spanning more than three minutes:

- `claude-code-acp` had consumed **0.25 seconds of CPU in 3m 08s**, sitting at 0.0%
- it had opened **no network connection at all**, so no model call was ever attempted
- no file in the project was touched, and `diff.patch` stayed at 0 lines
- Claude Code itself was installed **and authenticated**, so this was not a credentials problem
- the adapter's stdin was attached to the terminal rather than a pipe from its parent —
  consistent with the two processes waiting on each other

**From the operator's chair, this is indistinguishable from working.** There is no
spinner, no elapsed timer, no "starting the coding agent", no heartbeat, no timeout, and
no log file written anywhere on disk. The evaluator's own words: *"seems to have hung"* —
and there was no way to find out without inspecting process CPU time and open file
descriptors, which no PM can be expected to do.

This is the single most serious finding in this log. Everything before it is friction;
this one silently ends the run with no explanation and no recovery path.

> **Fix, in priority order:** (a) print something the moment the worker is launched, and
> a heartbeat while it runs; (b) apply a timeout to the worker handshake and fail loudly
> when it elapses; (c) write the worker's stdout/stderr to a log under `.wringer/runs/`
> so a stall can be diagnosed after the fact. The `timeout: 600` already configured for
> the judge has no equivalent guarding the worker.

---

## The one-line version for a product review

> The consent and honesty model is excellent and worth building on. But the product
> currently assumes an operator who can install a Python toolchain, read `pyproject.toml`,
> interpret a pytest suite, and recover from mistakes by editing YAML. Until the
> interview confirms what it recorded, the install names all its prerequisites, and the
> questions stop requiring source-code knowledge, the north star is not reachable.

---

## Note on this session

Some of the friction above was made worse by the assistant, not the product: the
multi-line block that broke the interview was supplied without warning that the prompt
takes one line per answer. That specific incident is an assistant error. The underlying
defect — that the interview accepted it silently, mis-filed it, and let the overflow
decline the run without confirming anything — is the product's.

---

# Second run — Wringer 0.4.0 (single bundled package)

**Date:** 2026-08-21
**Scope:** upgrade over an existing 0.3.0 install, then drive the `arcade` example
end to end. The run reached the build step and **stopped there**: the coding agent
was not on PATH. Nothing was built. Everything below is from that run.

## Fixed since 2026-08-18

- **The install is now one package and it is clean.** `uv tool install wringer` put
  0.4.0 down and all four commands resolve into a single tool dir
  (`~/.local/share/uv/tools/wringer/bin/`). Before, `wring`/`wringer` came from
  `wringer` 0.3.0, and `wringer-board`/`wringer-drive` from two separate 0.1.0 tools.
  `uv tool uninstall wringer wringer-board wringer-drive` removed all 4 executables
  cleanly and left no stragglers in `~/.local/bin`. This part now passes the bar.

## New findings

### 1. `DECIDED WITHOUT ASKING YOU` — passes, and is the best thing in the release

Nine entries, each with three parts: the decision, `Why:`, and `You were not asked:`
carrying the exact question it replaced. A PM can read that block and understand what
was assumed on their behalf without knowing anything about the codebase. Keep it.

### 2. The count line is honest — including about proposed-but-uninstalled checks

Before the gate was installed: `0 of 10 / 1 yours to decide / 9 nothing checking them`.
After: `1 of 10 / 1 / 8`. Both sum to 10, which is exactly the number of criteria in
`wringer.spec.yaml`. Nothing is omitted. Notably, when the acceptance check existed but
its gate was not yet installed, the summary refused to count it as coverage even though
the line above it named the check. That is the right call and it self-corrects once the
gate lands.

### 3. `revise` does what it claims — passes

`wringer-board revise --id heading-copy --text "something else"` printed
*"updated, and your approval was withdrawn"*, `wringer.spec.yaml` really flipped to
`approved: false`, and `wring plan` then refused with exit code 1. Overruling an
*assumption* is rendered well in the replotted plan:

    limit-of-three
      NO LONGER DECIDED FOR YOU — you answered this: make it five, three feels tight now
      (it had been: The cap is exactly three entries, ...)

### 4. **BUG — overruling a decision leaves the criterion derived from it contradicting you**

Overruling `limit-of-three` to *"make it five"* left criterion `capped-at-three`
untouched in **both** `wringer.spec.yaml` and `wringer.rubric.yaml`:

    - id: capped-at-three
      title: At most three games are ever shown

So the repo simultaneously records "make it five" as the PM's answer and "at most three"
as the thing the work will be judged against. Nothing warns about this. The plan's own
disclaimer — *"if a requirement is worded wrongly, a green check against it proves the
wrong thing perfectly"* — describes this exactly, except here **Wringer created the
inconsistency itself**, and a PM has no way to notice it.

> **Fix:** when a revision overrules an assumption, flag every criterion whose text was
> derived from it as stale, and make `plan` show them as needing re-wording before
> approval.

### 5. BUG (cosmetic) — duplicate id in the not-found list

`wringer-board revise --id no-such-id` lists known ids and prints `limit-of-three`
twice, because after being overruled it exists both as a decision in
`wringer.decisions.yaml` and as an open question in `wringer.spec.yaml`. Harmless, but
it looks like corruption to anyone who notices.

### 6. **BLOCKER — `setup.sh` says "Ready" without checking for the coding agent**

`setup.sh` preflights `git` and `node`, and validates the whole starting state
(tests green, lint clean, acceptance red). It then prints **"Ready"** and tells you to
answer `acp: claude-agent-acp`. It never checks that agent exists. The run therefore
gets all the way through the interview, **two paid API calls** (spec draft, then plan),
approval, and gate installation — and only then dies:

    wring run: the ACP agent 'claude-agent-acp' is not on PATH, so there is nothing
    to hand the brief to.
    Install it with: npm install -g @agentclientprotocol/claude-agent-acp
    Wringer never installs an agent. Nothing has been created.

The error message itself is good — it names the package, says plainly that Wringer
installs nothing, and confirms nothing was created. The defect is *when* it arrives.
On this Mac the installed ACP agent is `claude-code-acp`
(`@zed-industries/claude-code-acp` 0.16.2); the example hardcodes the name of a
different one. `@agentclientprotocol/claude-agent-acp` does exist on npm (0.70.0), it
is simply not installed here.

> **Fix:** add the ACP agent to `setup.sh`'s existing `for tool in git node` preflight,
> and have `wringer-drive run` check the agent resolves **before** the first paid call
> rather than after approval.

### 7. board.html with nothing built — passes, and passes well

Read cold, before any documentation, the board says one thing in a red box:

> There is no evidence here yet. Nothing has been verified in this repository, so
> there is nothing this board can honestly show.

There is no ambiguity about whether the work is done. It refuses to imply progress it
cannot evidence — no empty checklist, no 0% bar, no partial credit. This is the
behaviour the rest of the product should be measured against.

**Not yet tested:** the board in a *finished* state. The build never ran, so whether a
PM can tell "done" from "nearly done" on a populated board is still an open question.

## Note on a diagnostic that misleads

`uv tool list | grep -i wringer` **hides** the `wring` executable, because the line
reads `- wring` and does not contain the string "wringer". Anyone auditing an old
install this way will miss a shadowing binary. Separately, `pip` does not exist on this
Mac at all (only `/usr/bin/pip3`), so any instruction to run `pip uninstall wringer`
returns `command not found` — and a `pip list | grep` check returns empty for that
reason, not because nothing is installed.

---

# Second run, continued — reaching the build

The ACP agent was installed and the run was taken as far as it will go. **The build
executed, the coding agent did nothing, and Wringer refused to deliver.** Findings
below are in the order they were hit.

### 8. Fixed: worker output is now captured

The single most serious finding in the first log — a worker that stalls with no
diagnosable output — is **fixed**. `.wringer/loops/<id>/iterations/001/worker.stdout.log`
and `worker.stderr.log` now exist, and the root cause of this run was readable from them.
Gate output is captured per-gate too (`.wringer/runs/<id>/gates/00N_<name>/`). Credit
where due; this is exactly what was asked for.

### 9. Following Wringer's own install instruction still leaves the agent unusable

`npm install -g @agentclientprotocol/claude-agent-acp` succeeded, and
`claude-agent-acp` was **still not on PATH**. npm's global bin
(`~/.local/node-v24.19.0/bin`) is not on PATH on this machine; node binaries are
hand-symlinked into `~/.local/bin`. A symlink matching the existing convention was
needed before Wringer could see the agent. The error message names the package to
install but not the possibility that installing it is insufficient.

### 10. **BUG — re-running `wringer-drive run` is not idempotent, and it lies about why**

The first run installed the gate `recently-played-acceptance` into `.wringer.yaml` and
left its proposal in `wringer.gates.yaml`. On the second run this happened:

    wring plan: wringer.gates.yaml: 'recently-played-acceptance' runs `node --test
    acceptance/recently-played.test.js`, which is already what
    'recently-played-acceptance' runs. A check that already runs cannot be the
    thing that proves 'recent-section-above-grid' — it passes today, so it cannot
    be made to fail by the work. The binding was dropped and the criterion is left
    unbound

Three things wrong with this, all verified:

1. It compares the gate **to itself** — the same id on both sides of the sentence. It
   is seeing its own previously-installed gate as a pre-existing conflict.
2. **"it passes today" is false.** `node --test acceptance/recently-played.test.js`
   exits **1**. Wringer itself had reported "None of them passes today" one run earlier.
3. "the criterion is left unbound" does not match disk either — `.wringer.yaml` still
   carries `proves: recent-section-above-grid`.

It then **stopped the build**. Recovery required moving the already-applied
`wringer.gates.yaml` proposal out of the way by hand — a PM would be dead here.

> **Fix:** treat an installed gate whose id and `run` match the proposal as *already
> applied* and skip it silently. Never compare a gate to itself. And derive the
> "already passes" claim from an actual run, not an assumption.

### 11. **BLOCKER — the coding agent never sees `WRINGER_API_KEY`, and nothing says so**

With the gate proposal moved aside the loop ran properly: lint ✓, test ✓, acceptance ✗,
worker launched, worker exit 1, second iteration, stopped. The cause, from
`worker.stderr.log`:

    [session/query] sessionId=... resume=none apiType=native baseUrl=native
    ... RequestError: Authentication required
    [wringer: ACP turn failed] session/prompt was refused: Authentication required

The ACP agent authenticates **independently of Wringer** (`apiType=native`). It does not
read `WRINGER_API_KEY`, and setting `ANTHROPIC_API_KEY` as well made no difference — it
wants an interactive Claude login. Meanwhile `setup.sh` states:

> Put your key in the environment. Wringer reads it from there and nowhere else

True of Wringer. **False of the coding agent Wringer launches**, which is the thing that
does the actual work. The PM sets one key, every visible signal looks correct, two paid
API calls succeed, and the build then fails for a reason never mentioned anywhere in the
interview, the plan, or the example.

What the PM is told when it happens:

> The work stopped because an attempt changed nothing at all. Running it again
> unchanged would not help. Nothing is needed from you; an engineer has to look at
> why it is stuck.

The word "authentication" appears nowhere. The one actionable fact in the whole failure
is in a log file under a timestamped directory.

> **Fix:** preflight the agent's own authentication before the first paid call, and when
> a worker turn is refused for auth, say so in the PM-facing message.

### 12. The populated board — can a PM tell whether the work is done?

**Yes, on the headline. No, on the detail.** The summary is unambiguous:

> 0 of 10 proved · 2 still needs you · 8 will not be proved — nothing checks them

and it leads with a disclaimer that nothing was demonstrated able to fail first. Good.

But **the badges contradict both their own body text and the summary.** Eight rows are
badged `NEEDS YOU`, and each one's body reads:

> Nothing is needed from you — an engineer has to bind a check to this before it can
> be proved.

Those same eight rows are counted in the summary's *"8 will not be proved"*, not in its
*"2 still needs you"*. So a PM scanning badges sees **nine** things demanding their
attention; the bodies say eight of them need nothing; the summary says two. Three
different answers to "what do I have to do?" on one page.

> **Fix:** the eight unbound criteria are not `NEEDS YOU`. They are `NOT PROVABLE`, or
> similar. Reserve `NEEDS YOU` for the rows the summary counts as needing a person.

### 13. The one human criterion is still only answerable by editing YAML

`heading-reads-as-mine` says:

> write your answer into `wringer.judgements.yaml` in the project. Nothing else can put
> it there, and until it is there the handover waits.

There is no `wringer-board` subcommand for it — the five are `render`, `plan`, `answer`,
`revise`, `approve`, and `answer` only takes open-question ids. The file does not exist,
so the PM must create it, guess its schema, and hand-write YAML to unblock a handover.
This is the same defect as the first log's "recovery means hand-editing YAML", now sitting
on the critical path of every delivery.

### 14. Still good, still worth keeping

- **The refusal to deliver.** `wring deliver: refusing to deliver ... its gates did not
  pass. An unverified change does not get a branch.` Exactly right.
- **Token disclosure on the board**, with an explicit note that Wringer does not price
  them.
- **Resuming does not re-spend.** The second run replayed the existing plan without a
  third paid spec call, and `wringer.spec.yaml` was byte-identical afterwards (verified
  by checksum).
- **`approve` reprints the whole plan** before writing `approved: true`, and says
  plainly that answering and approving are never the same action.

### 15. "What this page does not claim" is unreadable for the audience

Nine dense paragraphs on the board covering `demonstrated_able_to_fail` semantics,
sensitivity receipts, witness sufficiency, tamper-evident pins and `run.containment`.
Every sentence is defensible and the honesty is the point — but this is written for
someone implementing Wringer, not someone deciding whether a feature shipped.
