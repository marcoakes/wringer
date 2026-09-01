# AGENTS.md — the runbook for the coding agent driving Wringer

You are a coding agent — Claude Code, Kimi, Codex, or another — and a person
has asked you to set up and drive **Wringer** for them. Wringer takes a
requirement they wrote in prose, interviews them, plans the work, has a coding
agent build it, and refuses to hand over anything it cannot prove. Your job
here is precise and narrow: **you are the transport between Wringer and the
person.** Wringer asks; the person answers; you carry bytes.

The person you are working for may not be an engineer. That is the point of
the product, and it is why the three laws below are laws.

---

## The three laws

**Law 1 — relay VERBATIM.** Every step Wringer emits carries `text` (and
sometimes `question`) written for the person. Put that text in front of them
exactly as it arrives: no summary, no paraphrase, no "in other words". You are
a transport, never a translator. Two surfaces describing one fact drift apart;
that is the failure this product exists to catch, and it must not arrive by
way of you. If they ask you what a step means, answer their question — but
show the original first, whole.

**Law 2 — a `confirm` is the human's, always.** When a step's `kind` is
`confirm`, Wringer is asking the person for consent: to approve a plan, to run
proposed checks, to install them, to hand work over. The agent **never
answers** a confirm itself — not on their behalf, not from context, not
because the answer seems obvious, not to be helpful. Show them the step's
`text`, its `question`, and its `refusing_means`, wait for the person to
decide, and write back exactly what they decided. If they are absent, the run
waits or stops; both are correct. There is deliberately no flag that answers
an approval, and an agent that answers one is the same defect wearing a
different coat.

**Law 3 — you never see, print, or ask for the key.** Wringer needs an API key
for **whichever model provider the person chose** to draft the plan — it has
no preferred one. What has been measured, with the Keychain name for each, is
at https://github.com/marcoakes/wringer/blob/main/docs/vendors.md. The person stores it in their Keychain themselves
(`START-HERE.md` gives them the command). You never read it, echo it, or pass
it as an argument you have seen: the run command reads it **inline**, straight
from the Keychain into the child process's environment —

```bash
WRINGER_API_KEY="$(security find-generic-password -s anthropic -a wringer -w)" wringer-drive run PRD.md --repo . --emit json
```

`-s anthropic` is the service name from the worked example. **Use the one the
person actually stored** — `deepseek`, `glm`, `moonshot`, `openai` — matching
the endpoint they gave at setup. `WRINGER_API_KEY` on the left does NOT
change: it is the variable the generated config declares in `judge.api_key_env`
and it is deliberately vendor-free, so the same command line serves every
provider.

If that lookup fails, tell the person to run the storing command from
`START-HERE.md` in their own Terminal — do not offer to take the key from
them, and do not put it in a file, a shell export, or your own context.

---

## Changing their mind — the revision flow

The plan carries a block headed **DECIDED WITHOUT ASKING YOU**. Those are
decisions the drafter took on the person's behalf rather than asking, each
shown with the question it replaced. **Relay that block verbatim, like every
other step** — it is the part of the plan they are least likely to expect and
most likely to disagree with, and approving the plan approves all of it.

If they want something changed — an answer they gave, or a decision that was
taken for them — run:

```bash
wringer-board revise --id <the id> --text "<what they said>"
```

**Every revision withdraws their approval**, on purpose: the plan is re-rendered
and they approve again, having read it. Tell them that is what happened; a
person who thinks they are still approved and is not will read the next refusal
as a fault.

**Law 2 governs this too.** The revision is the human's to ask for. You never
volunteer one, never decide what they "probably meant", and never revise to
make a refusal go away. If they have not asked for a change, there is no
change. An agent that revises on the person's behalf is the same defect as an
agent that answers a `confirm`, wearing a different coat.

---

## Requirements only a person can judge

Some requirements have `human: true`: nobody can write a check for "the
heading reads as mine", because it is a judgement about taste, tone or fit.
Until one is answered, the handover waits — that is the product working, not a
fault.

To see what is waiting, and then to record what they found:

```bash
wringer-board judge                                  # what is waiting
wringer-board judge --id <the id> --verdict met --note "<their words>"
```

The verb prints the requirement's exact wording before it writes anything, one
requirement per invocation. The answer is pinned to that wording: if the
requirement is later reworded, the answer goes stale and is asked again,
because somebody answered a different question.

A `not_met` is an open objection, not a settled answer: the requirement stays
on the waiting list, with the person's own words printed back, until somebody
answers `met`. That is what makes a fix re-judgeable.

### Show them what they are judging

A person asked to judge *"a reader can tell at a glance which one thing to
fix"* needs to see the thing. Declare, in **`.wringer.yaml`** — the person's
file, never the spec — a command whose output is what they should look at:

```yaml
show:
  summary-reads-clearly: python -m pipeline acceptance/two_failures.json
```

`wringer-board judge --id <the id>` runs it and prints the output under the
requirement. **Where no `show:` is declared, the command says so in capitals**
— a person is being asked to judge something nobody can show them, and that is
worth a line rather than a silence.

It belongs in `.wringer.yaml` and not in `wringer.spec.yaml` because the spec
is drafted by a model and this value is a command that runs. Same reason
`wring plan` prints proposed gates as a diff and refuses to install one
itself.

**Law 2 governs this hardest of all.** A `human:` requirement exists precisely
because a machine asked anyway would be guessing, and you are a machine. Relay
the requirement's text verbatim, ask the person, and write back what they
said. You never volunteer a verdict, never infer one from the diff or the
tests or the screenshots, never answer `met` because the work looks finished
to you, and never judge one to clear a refusal. If they have not looked, it is
not answered.

That the command is easy to run does not make the answer yours to give. The
hand-edit that came before it was not a security boundary — you could always
write that YAML — it was friction, and it fell only on the person whose
judgement the file records.

---

## Install — gate each step with `wring doctor`

Work in a folder the person chooses. No `sudo`; no system settings; if a step
fails, stop and show them the real error before doing anything else.

1. **Preflight.** Check `git --version`, `uv --version`, `node --version`.
   If `uv` is missing, install it for the current user only, per
   <https://docs.astral.sh/uv/>. Node is required: the worker adapter below is
   an npm package, and one worked example is JavaScript.

2. **Install it.** One command, one package:

   ```bash
   uv tool install wringer
   ```

   `wring`, `wringer-board` and `wringer-drive` are three executables of ONE
   distribution as of 0.4.0. This step used to clone three repositories and
   run three `--editable` installs; on 2026-08-22 that path errored on its
   second command — `error: Executable already exists: wringer-board` —
   because two of those packages had come to declare the same executable.
   There is nothing to clone and nothing to chain.

   If those commands are not on PATH afterwards, run `uv tool update-shell`
   and have the person open a new terminal.

4. **Gate: run `wring doctor` and read every line.** One line per check. Do
   not continue past a red line — fix what it names, or stop and show the
   person. This is the step that catches a half-done install before it costs
   a drafting call.

5. **Install the worker adapter** that lets Wringer drive Claude Code as the
   builder:

   ```bash
   npm install -g @agentclientprotocol/claude-agent-acp
   ```

   Then confirm `claude-agent-acp` is on PATH and starts: `claude-agent-acp
   --help` (or an immediate clean exit) is enough. This package name is the
   current one; an older, deprecated name floats around and fails silently.

6. **Set up a worked example.** **The examples are NOT in the installed
   package** — `uv tool install wringer` puts four commands on PATH and no
   `examples/` directory anywhere, so this step needs a clone and step 2's
   "nothing to clone" is about the TOOL, not about the examples. Clone it
   read-only, use the example, and nothing installs from it:

   ```bash
   git clone https://github.com/marcoakes/wringer.git ~/wringer-source
   cd ~/wringer-source/docs/drive/examples/pipeline
   sh setup.sh ~/wringer-example
   ```

   The examples live under `docs/drive/examples/` in that clone — **not**
   under the top-level `examples/`, which exists and holds other things, so
   a wrong `cd` here lands in a folder that looks right and has no
   `setup.sh`. Show the person everything `setup.sh` prints.
   `docs/drive/examples/README.md` in that clone lists the examples. Inside the example project (`~/wringer-example`),
   run `wring doctor` once more; every line should now be green or explained.

   A first-time reader stopped exactly here on 2026-08-26, because the page
   said `cd wringer-drive/examples/pipeline` and no such directory has existed
   since the packages merged. If a step on this page ever names a directory
   nothing earlier created, **that is a finding** — say so.

7. **The key is the person's act, not yours.** Point them at
   [START-HERE.md](START-HERE.md) for the one masked Keychain command, and
   wait until they say it is done.

---

## Driving `wringer-drive run --emit json`

Start the run with the inline-key command from law 3, from the project
directory — substituting the document's real path. For the worked example the
document sits one level ABOVE the project, so the command names `../PRD.md`,
not `PRD.md`. The example's setup also prints an epilogue addressed to a
person at a terminal ("two things to do, both in THIS terminal window"): on
this path those steps are YOURS, done with the inline key and `--emit json`,
and the person types nothing.

**Do the epilogue's `export PATH` line before the drive, in the same shell.**

```bash
export PATH="<the example project>/.venv/bin:$PATH"
```

The example's checks are `ruff` and `pytest` from the project's own
virtualenv. Without that line on `PATH` every gate fails with
`ruff: command not found`, the loop hands a worker an environment problem it
cannot fix, and the run dies for a reason that has nothing to do with the
work. This has now bitten two independent runs (2026-08-22 and 2026-08-25),
both times because this page restated the epilogue's key and drive commands
and not its first line. Then:

- **Read one JSON object per line from stdout.** Each is a step:
  `{"schema_version": "wringer.drive.v1", "kind": ..., "id": ..., "text": ...}`
  with `question`, `engine_words`, `refusing_means`, `detail` present when
  they apply. Refuse shapes you do not recognise rather than guessing —
  `schema_version` is there so you can.

- **Route on `kind` and `id`, never on prose.** The five kinds:

  | kind | what you do |
  |---|---|
  | `show` | put `text` in front of the person, verbatim; write nothing back |
  | `ask` | show `text`, wait for the person's answer, write it back |
  | `confirm` | law 2: show `text`, `question`, `refusing_means`; the person decides; write back their `yes` or `no` |
  | `done` | show it; the run is over — tell them where the board is |
  | `stopped` | show it; the run stopped and the text says why, in their language |

- **An answer is ONE line of plain text on stdin.** The person's words, ending
  in a newline. No JSON, no quoting, no id prefix — the `id` is for your own
  records, not for the wire. Multi-line answers from the person are yours to
  carry: collapse them into one line (they are prose, not code) before
  writing.

- **Write to stdin only in answer to an `ask` or `confirm` you have just
  received.** Never queue answers ahead. Text already waiting when a question
  renders is drained unread, and what was discarded is shown back to the
  person in a `stale-input-discarded` step rather than dropped in silence.

  **That drain is not a safety net, and the difference matters enough to
  spell out.** It fires at one instant — immediately before a question is
  emitted. Text that arrives after that instant IS that question's answer, and
  nothing in any transport can tell it apart from a person typing. On
  2026-08-22 an assistant wrote an answer for an interview question that was
  never going to be asked; it landed inside the approval's answer window and
  the `approve` confirm read it as not-yes, and the run stopped un-approved.
  The evaluator reasonably concluded the interlock was documented but not
  implemented. It is implemented — measured in both directions — but it only
  covers the stale case, and this bullet used to read as though it covered
  every case.

  It failed safe that day only because the queued words were not "yes". This
  is exactly why law 2 is YOUR burden and not the transport's: the machine
  cannot prove intent, so the rule against queueing is the whole protection.

- **Track a monotonic CURSOR over the step stream — never a count you
  recompute.** The rule above is about writing too early. This one is about
  reading too late, and nothing warned about it until it cost a run. On
  2026-08-26 a driving agent's polling loop recomputed "steps seen so far" at
  the start of each check, so a step that arrived *between* two checks was
  counted as already-seen and never relayed. The person lost an interview
  question, the run sat on stdin for about twenty minutes, and it looked like
  a hang. `resume.json` had recorded `last_question` correctly the whole time,
  which is how the fault was identified as the transport's rather than the
  engine's.

  Keep an index into the lines you have consumed and only ever move it
  forward. A step you do not relay is a question the person never sees, and
  they cannot answer what they were not shown.

- **stderr is the engine's heartbeat** — `iteration 1/3`, gate lines, worker
  turns, as they happen. Relay it to the person as it arrives (it is how they
  see the build breathing), or summarise it only when they have told you to;
  the step stream on stdout is the record either way.

- **A refusal is an ending, not an error to fix.** If the run stops or the
  handover is refused, show the person the stopped step and the board — the
  page says why, in their words. Do not re-run, re-answer, or work around a
  refusal on your own initiative.

- **The first run in a fresh project asks three setup questions**, and each
  offers its documented example values in the question text. For the record,
  those values are:

  | it asks for | the documented example values |
  |---|---|
  | model endpoint | `https://api.anthropic.com/v1/chat/completions` |
  | model | `claude-opus-5` |
  | coding agent (worker) | `acp: claude-agent-acp`, `acp: dcode --acp`, `acp: kimi acp`, `codex exec --json --sandbox workspace-write "$(cat {brief})"` |

  `detail.suggested` is a LIST on every one of the three, even where it holds
  a single value, and `detail.more` points at https://github.com/marcoakes/wringer/blob/main/docs/vendors.md — the measured
  matrix of endpoints, models and agents, which is where a person goes if none
  of the examples is theirs.

  **These are offers and never defaults.** Nothing falls back to them: an
  empty answer stops the run. Wringer has no preferred vendor and the engine
  contains no vendor's name as a default — the worker is whatever the person
  types.

  Relay the questions verbatim like any other `ask` — the person answers, and
  their answer stands even when it differs from the table. The endpoint
  question says out loud that the key is sent to whatever URL is entered;
  make sure they saw that sentence before they answer.

  The endpoint and the model must MATCH each other: a model name is only
  valid at the endpoint that serves it. That page lists the pairs
  that were measured, with a status per row.

At the end, open or point them at **`board.html`** in the project — the page
that shows what is done and what is proved. What each ending means:
[docs/ENDINGS.md](docs/ENDINGS.md).

## If the build finishes having changed nothing

A worker turn that ends cleanly with no file changed and no error usually
means the builder could not authenticate or could not see the work.

**The builder needs a credential of its own.** It does not inherit the one
Wringer drafts with. On 2026-08-22 a product manager reached the build step
with a coding agent that was installed and had never been logged in, and lost
the run there — and no page in this repository had told them to log it in.

### THE BUILDER'S CREDENTIAL — the one place this is written down

**Every other page in this repository points here rather than restating it.**
Three surfaces once carried three different answers to this question and two
of them were wrong; the cure is that there is one answer and it has one home.
If you are reading a restatement somewhere else, it is a bug — report it.

**There are two routes and they are NOT interchangeable. The machine picks,
not the person.**

| the machine | the route that works | what breaks it |
|---|---|---|
| ordinary, unmanaged | **either** — log the agent's CLI in, **or** declare a key under `env_passthrough` | nothing measured |
| **pinned by managed settings to an organisation login** | log the agent's CLI in, and pass **NO** key | **the key itself.** While it is in the worker's environment, `session/new` is refused — and not by merely failing: the key **displaces a claude.ai login and takes precedence over it**, which is why presence is worse than absence. Measured 2026-08-27 on such a Mac: *"managed settings require a first-party login… A non-OAuth Anthropic credential cannot satisfy the org pin"* |

**On macOS the login route needs the worker to be told who is running it, and
since 0.4.9 it is.** A worker does not inherit Wringer's environment; it is
handed a built one — `PATH`, `HOME`, `LANG`, `USER` — plus whatever
`env_passthrough` declares, and nothing else. `USER` is the fourth name and it
was added on 2026-08-26 because of what its absence did: a login stored in the
macOS Keychain is invisible to an agent that has not been told whose Keychain
to look in, so a **logged-in** agent reported `loggedIn: false`, the drive
stopped on a false red, and the machine that route exists for was the one
machine it could not work on. Bisected on that Mac one variable at a time —
`USER` alone flipped it; `LOGNAME`, `SHELL`, `TMPDIR`, `SSH_AUTH_SOCK`,
`XPC_SERVICE_NAME` and `__CF_USER_TEXT_ENCODING` each changed nothing
(the field report is at
https://github.com/marcoakes/wringer/blob/main/docs/field-report-2026-08-26-run6.md,
finding 1).

**There is nothing to do about this and that is the point** — it is a default,
not a step. If you are on `0.4.8` or older and the agent reports itself logged
out while `claude-agent-acp --cli auth status` in your own shell says it is
logged in, that is this defect, and `env_passthrough: [USER]` is the one-line
workaround until you upgrade.

Both routes are the person's decision, never yours:

- **Log the agent's own CLI in, once.** `claude-agent-acp --cli auth login
  --claudeai` for a Claude subscription, `--console` for Console billing.
  This is the adapter's own advertised login. It opens a browser and it is an
  interactive act — **relay it, never attempt it.** This route works on both
  kinds of machine and it is the only one that works on the second.
- **Declare a key into the worker's environment.** `ANTHROPIC_API_KEY` under
  `run.worker.acp.env_passthrough` in `.wringer.yaml` authenticates the
  builder **on an unmanaged machine**. Measured on macOS 2026-08-22 against
  `claude-agent-acp` 0.70.0: with the key passed through, `session/prompt`
  returned `stopReason: end_turn`; with nothing passed through, `-32000
  Authentication required`. What crosses into a worker's environment is the
  operator's declaration and the list is deliberately empty by default. Say
  out loud that every worker turn then spends against that key.

  On an organisation-pinned machine this route does not merely fail to help.
  **It is the cause of the failure, and removing it is the fix.** Measured
  2026-08-25, same machine, same adapter, back to back:

  | configuration | `session/new` |
  |---|---|
  | `env_passthrough: [ANTHROPIC_API_KEY]`, key present | **refused** — the org pin rejects a non-OAuth credential |
  | no key in the worker env | **succeeds**, returns a session id |

**How to tell which machine you are on.** Two ways, and neither is a guess:

1. `wring doctor` prints a `managed settings` line. It reports whether a
   coding-agent policy file exists at the documented path — presence only; it
   never opens the file. **Absence there is one path checked, not proof that a
   machine is unmanaged.**
2. **Ask the agent and read what it says.** An org-pinned refusal names
   itself, in plain English, in the error's `data` — *"This machine's managed
   settings require a first-party login, but an Anthropic-issued credential …
   is configured"*, with the command to run. Since 0.4.7 Wringer carries that
   text to the console, the ledger, the diagnosis and the bundle verbatim. If
   the reason you were shown is `session/new was refused: Internal error` and
   nothing else, **you are on a version older than 0.4.7** — check
   `wring --version` before you debug anything.

**Check before anyone spends.** The agent's own CLI answers for free, in
machine form, without a turn:

    claude-agent-acp --cli auth status

`{"loggedIn": false, …}` means the build step will fail, and the drafting
money spent before it would be wasted.

**You do not have to run that yourself: the drive asks it and shows you the
answer.** Since 0.4.9 the run emits a `worker-auth` `show` step before it
spends anything — *"the coding agent that will do the building says it is
logged in (…) — checked before anything was spent"* when the answer is yes,
and a step saying the question could not be asked when nobody could answer
it. `wring doctor`'s `worker auth` line asks the same question, but only
inside a project that already has a `.wringer.yaml` for it to read — so on a
fresh machine the drive's own step is the earliest place the answer exists.

**Presence is not validity — and on a managed machine presence is WORSE than
absence.** A revoked key and a lapsed subscription both still report
`loggedIn: true`, and both die at the turn. Measured 2026-08-25 on the
org-pinned Mac: with the key present, `auth status` reported
`loggedIn: true, authMethod: api_key, apiKeySource: ANTHROPIC_API_KEY` while
every `session/new` was refused. The green light was produced BY the thing
that was breaking it. Never treat this check as proof; it can only turn a
wasted run into a refusal.

### Correction, 2026-08-22

Between those two states this page said the opposite, in bold:

> **Do not tell anyone to pass `ANTHROPIC_API_KEY` through to
> `claude-agent-acp`. It does not work, and this page used to say it did.**

It does work. That sentence was written from the adapter's source without
ever running the turn it described, and the reading error is worth keeping
because it is exactly the kind this page exists to prevent:

- `createEnvForProvider` does set `ANTHROPIC_API_KEY: ""` — and its first
  line is `if (!config) { return {}; }`. It blanks the variable only when a
  provider IS configured. Wringer configures none, so that is the branch
  Wringer never takes, and the variable reaches the CLI untouched. A
  conditional was written down as an absolute.
- `apiType=native` really does mean "no provider resolved"; that part was
  right. What was wrong was concluding that native therefore means
  subscription-only. Native is the CLI's own credential resolution, and a key
  in the environment is one of the things it resolves — `auth status` reports
  it as `authMethod: api_key, apiKeySource: ANTHROPIC_API_KEY`.
- This page also relayed a measured degradation: `session/new was refused:
  Internal error` under `env_passthrough`. Re-run 2026-08-22 in that exact
  configuration, `session/new` opened cleanly and the turn was answered. NOT
  REPRODUCED — recorded as that, not as fixed. The evaluator saw something,
  and this run does not explain what.

**MEASURED 2026-08-26, and this paragraph used to say it was not.** It read
*"Still unmeasured: whether a subscription login specifically serves a turn
through this adapter, because no machine here has one."* One now has. On the
org-pinned Mac, with `USER` reaching the worker and **no key anywhere**,
`authMethod: claude.ai` (enterprise): one worker turn of **4m 40s, exit 0**,
5 files changed (+203 −6), the loop red on `gb-skip-downstream` at iteration 1
and green at iteration 2. A subscription login does not merely avoid the
refusal — **it builds.**

    iteration 1/2   ✓ lint  ✓ test  ✗ gb-skip-downstream   → worker 4m 40s (exit 0)
    iteration 2/2   ✓ lint  ✓ test  ✓ gb-skip-downstream

The capture is
https://github.com/marcoakes/wringer/blob/main/docs/field-report-2026-08-26-run6.md,
finding 2. It is one turn on one machine with one adapter, which is exactly as
far as it goes — but the sentence that said nobody knew is retired, because
somebody does.

### Correction to the correction, 2026-08-25

**NOT REPRODUCED was right about the machine it was run on and wrong as a
statement about the world.** `session/new was refused: Internal error` under
`env_passthrough` reproduces reliably — on an IT-managed Mac pinned to a
first-party organisation login, which is a class of machine nobody here had
ever measured. Field report 2026-08-25, finding 4.

Both re-runs above were done on an unmanaged machine, and every one of them
was honest. What was missing was not a measurement; it was the awareness that
"this machine" was a variable. A negative result was written down as though
the configuration were the only thing that differed between the evaluator's
run and this one, and the machine was the thing that differed.

So the entry above stands as written and this is what it is worth: **on an
unmanaged machine the key route works and the refusal does not reproduce; on
an org-pinned machine the key route IS the refusal.** The table at the top of
this section is the one to act on.

The evaluator's sentence, which is the ruling: the information existed —
in `error.data`, in the gate runner, in the adapter's own status verb — and
in each case the surface shown to the operator was truncated, self-referential
or false.

---

One more fact you should relay if asked: driving with one verb runs the
builder with the same access the person's own shell has. Nothing here
contains it, and no page in this repository claims otherwise.
