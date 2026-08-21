# Install Wringer by asking your coding agent to do it

**You do not need to be an engineer to follow this page.** You need a coding
agent you already use: Claude Code, Codex, Gemini CLI, Cursor, any of them.
It takes about two minutes.

Copy the block below. Paste it into your agent. That is the whole instruction.

*Every step of this prompt was **executed in a clean environment on
2026-08-17** before this page shipped. The unedited transcript is at
[docs/install-2026-08-17.md](docs/install-2026-08-17.md). Running it found
three defects that reading it had not, including one that would have told you
to stop at step 1 for no reason. They are described in the capture.*

---

## The prompt

```text
Please install Wringer on this machine for me. I am a product manager, not an
engineer, so tell me what you are about to do before you do it, and tell me in
plain language what happened afterwards.

Rules I am asking you to follow, and please tell me if any of them stop you:

  - Do not use sudo. Do not change any system setting.
  - Do not install anything except the two tools named below and, if it is
    missing, the `uv` package manager they need.
  - Do not ask me for a password, an API key, or any other secret, and do not
    put one in a file or on a command line. There is one optional credential
    step at the very end and the operating system handles it, not you.
  - If a step fails, stop and show me the actual error. Do not work around it.

Here is what to do.

1. Check the prerequisites and tell me what you found:
     - git   (`git --version`)
     - uv    (`uv --version`)
   If `uv` is missing, install it for the current user only, following the
   official instructions at https://docs.astral.sh/uv/ .
   You do NOT need to check my system Python or upgrade it: `uv` fetches and
   manages its own, and the tools below run on that.

2. Make a folder for this and clone both repositories into it:
     git clone https://github.com/marcoakes/wringer.git
     git clone https://github.com/marcoakes/wringer-board.git

3. Install both from source, so I get the current code:
     uv tool install --editable ./wringer
     uv tool install --editable ./wringer-board
   If the commands `wring` and `wringer-board` are not on my PATH afterwards,
   run `uv tool update-shell` and tell me to open a new terminal.

4. Now show me what this is for, by building a tiny real project. In a NEW
   folder beside the two clones — call it `first-board` — make a git
   repository and write exactly three files.

   `wringer.spec.yaml` — the requirement, in my language:
     schema_version: wringer.spec.v1
     approved: true
     title: Weekly report export
     intent: A manager can export the weekly report as a CSV file.
     tasks:
       - id: build-export
         brief: Add the CSV export
         objective: The report page exports a CSV.
     criteria:
       - id: exports-csv
         title: The report exports as a CSV
         required: true

   `.wringer.yaml` — the check that decides it:
     version: 1
     gates:
       - id: export-works
         run: "grep -q 'text/csv' report.py"
         proves: exports-csv

   `report.py` — the code, deliberately NOT doing it yet:
     def report():
         return "not a csv yet"

   Commit those. Then run, and show me the output of each:
     wring verify                              # this will FAIL, on purpose
     wringer-board render . -o board.html
   Open `board.html` and tell me what it says.

   Then change `report.py` so it does the thing:
     def report():
         return {"Content-Type": "text/csv"}
   and run the same two commands again. Open the new `board.html`.

5. Tell me, in plain language and in about six sentences:
     - what is now installed on my machine, and where
     - how the board changed between those two runs, and what the phrase on
       the finished card means
     - what `wring verify` and `wringer-board render` each do
     - that nothing was published anywhere and nothing left this machine

Do not run `wring deliver --send` or any other command that writes to a git
remote. I have not asked for that.
```

---

## What you should see

Nothing on that page is a sample or a screenshot. The repository in step 5 is
one your agent built on your machine a minute earlier, the check really ran,
and the board is reading the evidence it left.

**The first board** says:

> 1 requirement · 0 done and proved · **1 holding up the handover**
> **NOT YET** — The report exports as a CSV
> *Not built yet — and the check that will decide it is written and failing
> right now.*

**The second**, after three characters of code changed:

> 1 requirement · **1 done and proved** · 0 holding up the handover
> **DONE — AND PROVED** — The report exports as a CSV
> **It was red first.** *This check has been recorded failing — the run that
> failed it is in this repository's evidence.*

**"It was red first" is the whole product.** Anyone can show you a green tick.
This one is on the record having *failed*, before anything made it pass, so you
know the check can tell the difference. A tick that was never red proves
nothing, and most of them were never red.

### One thing this page deliberately does NOT ask your agent to do

An earlier draft had a step in the middle: run `wring verify` inside the cloned
`wringer` repository itself, so you would watch the tool check a real, large
codebase. **It was cut because it does not work from a tool install, and that
was found by running it rather than by reasoning about it.**

Wringer's own gates are `ruff check …` and `pytest -q`. `uv tool install` puts
Wringer on your PATH; it does not put a project's *development* tools there, so
the gate resolves `ruff` through the shell, does not find it, and the first
thing you would see is a check that could not run. Adding `--with ruff --with
pytest` does not fix it either: that installs them into the tool's own
environment, not onto the PATH the gate's shell searches.

Setting up another project's development environment is an engineer's job and
this page is not for that. The tiny project in step 4 is real, runs a real
check, and needs nothing installed.

---

## Using whatever model you want

Wringer does not ship an agent and never will. It talks to *your* agent over
**ACP** (the Agent Client Protocol), so the model that does the work is your
choice.

You declare it in `.wringer.yaml` in whatever project you point Wringer at:

```yaml
run:
  worker:
    acp:
      command: claude-agent-acp
      args: []
```

One stanza per agent. The settled census as of **2026-08-16** is Gemini CLI,
Goose, Kimi CLI, Qwen Code, Cursor CLI and Copilot CLI, alongside Claude Code.

| agent | `command` | exercised in this repository? |
|---|---|---|
| Claude Code | `claude-agent-acp` | **yes, under an API key**: sequence I, 2026-08-15 and 2026-08-16, including under containment. **NOT exercised on a subscription login**, and a product manager's field run on 2026-08-18 could not authenticate that way — see the note below |
| Gemini CLI | `gemini` | **not exercised in this repository** |
| Goose | `goose` | **not exercised in this repository** |
| Kimi CLI | `kimi` | **not exercised in this repository** |
| Qwen Code | `qwen` | **not exercised in this repository** |
| Cursor CLI | `cursor-agent` | **not exercised in this repository** |
| Copilot CLI | `copilot` | **not exercised in this repository** |

> **CORRECTED 2026-08-18.** This table named `claude-code-acp` until today.
> That package was **deprecated and renamed** to
> `@agentclientprotocol/claude-agent-acp` — `docs/MANUAL_CHECKS.md` recorded it
> on **2026-08-11** and this table was not updated with it, so the name shipped
> stale for a week and a field run installed the deprecated adapter on its
> instruction. The deprecated one answers an unauthenticated turn with an empty
> **result**, which a client cannot tell from a turn that did nothing; the
> renamed one returns a proper error.
>
> **The authentication path is a live gap, not a solved one.** Driven by hand on
> 2026-08-18 with the environment Wringer actually gives a worker — `PATH`,
> `HOME`, `LANG` and whatever `env_passthrough` names — `initialize` and
> `session/new` both succeed and `session/prompt` returns
> `Authentication required`. Whether a normally-logged-in Claude Code on a
> user's own machine clears that has **not** been established.
>
> **What changed on 2026-08-19.** A turn that ends cleanly having written no
> file and raised no refusal is now diagnosed as such — in the loop's record
> (`worker-diagnosis.json`), on the console, and in `wring run --json` — with
> the remedy pointing at `run.worker.acp.env_passthrough` as the operator's
> channel. It names no variable, deliberately: that field exists so a secret
> crossing into a worker is a declared act by the person who owns it. The gap
> above is unchanged; what changed is that it can no longer present as silence.

> **Driving Wringer for somebody else?** `wringer-drive`'s
> [`AGENTS.md`](https://github.com/marcoakes/wringer-drive/blob/main/AGENTS.md)
> is the runbook for a coding agent doing exactly that — the same install
> gated by `wring doctor`, then how to drive `--emit json` and the three laws
> that keep an agent a transport rather than a second opinion: relay every
> step's text verbatim, never answer a `confirm` on the person's behalf, and
> never see or ask for their key. The block above installs; that page drives.

**"Not exercised" means exactly that.** Nobody has run Wringer against that
agent here and written down what happened. The rows are not a compatibility
claim; a row loses that label only when a capture in this repository shows it
running. The capability sentence is unchanged: Wringer is the ACP *client* and
never the agent, and it can drive anything that speaks the protocol.

---

## The token, in one masked step

**Optional.** Wringer's core needs no credential to run gates, verify, or render
a board. You need one only for the parts that call a model: drafting a spec,
judging a bundle, or driving an ACP worker.

### macOS

Run this yourself, in your own terminal. **Do not paste your key into your
coding agent, and do not put it on the command line:**

```bash
security add-generic-password -U -s anthropic -a wringer -w
```

Note there is **no value after `-w`**. That is deliberate: the operating system
prompts you for the secret with the input masked, and the key never appears in
your shell history, your scrollback, or anything your agent can read.

`-U` means "replace the one already stored", and it is not optional. Without
it, a second run fails with *"The specified item already exists in the
keychain"* and **discards the key you just typed**, leaving the old one in use
— so you believe you have set a key and you have not. Measured on a real
machine, 2026-08-21 (`docs/field-report-2026-08-21.md`, finding 2).

### Other platforms

There is no equivalent one-liner shipped for Linux or Windows yet, and rather
than pretend otherwise: use your platform's own secret store, or set the
environment variable in your shell profile, and be aware that a profile file is
plain text on disk.

### What is true about how Wringer handles it

Stated precisely, because the loose version of this sentence would be false:

- **Wringer never persists your credential.** It does not write it to any file,
  any bundle, or any config. Config files carry variable *names*, never values.
- **It is never printed and never placed on a command line.** Every value of a
  variable matching `*TOKEN*`, `*SECRET*`, `*KEY*` is erased from captured
  output before anything is written to disk.
- **Core Wringer reads environment variables, and that is all it reads.** A
  keychain read is a declared non-goal of the core (`docs/specs/SPEC_START_V0.md` §7).
- **At the moment of use, the key IS transmitted**, in an `Authorization`
  header to whatever endpoint your config names. It could not call a model
  otherwise. Anything claiming Wringer "never sees or transports" your
  credential would be false, and this project does not ship sentences like
  that.

---

## What this page does not claim

- **It does not claim the install is quick.** Step 4 runs a real test suite.
- **It does not claim your agent will get it right.** It is a prompt, and your
  agent is a model. If it goes wrong, the errors are real errors and the
  cloned repositories are ordinary folders you can delete.
- **It does not install an agent for you**, and Wringer never will.
- **It installs from source on purpose.** The published PyPI package is `0.3.0`
  and pre-dates a great deal of what the README describes; see the dated note
  at the README's install path. When a release is cut, this page's install step
  becomes `uv tool install wringer` and this paragraph goes away.
