# Response to the field report of 2026-08-25

The report itself is [`docs/field-report-2026-08-25.md`](field-report-2026-08-25.md),
landed verbatim and never edited. This file is the disposition: what was done
about each finding, which findings were already dead when the run started, and
what is owed. Where this document disagrees with the report, the report stays
as written and the disagreement is stated here with its evidence.

**The report's verdict is accepted in full.** *"Wringer is trustworthy about
what it cannot prove and unreliable at explaining why it stopped."* Every
blocker in that run was diagnosable from information the tool already had, and
in each case the surface shown to the operator was truncated, self-referential,
or false. That is one defect class with seven faces, and this window is about
that class and nothing else.

---

## The run was made against a version that had moved, and nothing said so

`wringer 0.4.0 (editable install from local source)`. `v0.4.0` was tagged
**2026-08-20 09:28**. Two of the seven findings were fixed on **2026-08-21**
and shipped in `v0.4.1`. So the run measured code that was six releases behind
before the first command was typed, and no surface anywhere reported it.

**This is ours, not the reporter's.** A tool that cannot say which version of
itself is running cannot be field-tested, and it had already been told so once:
the 2026-08-22 report's own ruling was *"if a run is gated on evidence, the
evidence-producing run cannot be gated on unpushed code."* Same disease, a
different vector — this time not unpushed code but an install shadowing the
release it claimed to be.

**Measured on the author's own Mac while writing this**, and it is worse than
the report could have seen:

```
$ wring --version
wring 0.4.6
$ cat ~/.local/share/uv/tools/wringer/lib/python3.12/site-packages/__editable__.wringer-0.4.1.pth
/Users/marc/Claude/wringer/src
```

A `uv tool install`ed `wring` whose distribution metadata says **0.4.1**,
reporting **0.4.6**, read out of a working tree — uncommitted edits included.
The number a person quotes in a report is not the number they installed.

`wring doctor` now says so, on the line it already prints:

```
! wring   wring 0.4.6, and all four commands resolve into /Users/marc/.local/bin
          — running from source at /Users/marc/Claude/wringer/src, not from an
          installed copy, and the installed distribution says 0.4.1. The version
          above is read from that source tree, so it is NOT the version you
          installed
          → Reinstall from the index to run a release: `uv tool install --force
            wringer` …
```

A source install alone is a note on an `OK` line — running from a checkout is
legitimate. A source install whose metadata **disagrees** with the version on
screen is a `WARN`, because at that point every measurement made against it is
a fact about a working tree wearing a release's number.

---

## Every disposition, and how it was established

**No finding below is marked dead on the strength of a commit message.** Each
was re-executed against HEAD before it was written down, and the repro is
quoted where it is short enough to quote. This repository has recorded cases of
a guard passing with its own fix reverted; a commit title is not evidence.

| # | Disposition | Established by |
|---|---|---|
| 1 | **FIXED this window** | the report's own captured payload as a fixture, red-watched four ways |
| 2 | **half DEAD since `v0.4.1`, half FIXED this window** | repro at HEAD found the self-comparison alive on two other arms |
| 3 | **DEAD since `v0.4.1`** | `wring doctor` re-run at HEAD in the report's exact three contexts |
| 4 | **FIXED this window** | one auth section, both routes, machine-class table, doctor line |
| 5 | **FIXED this window** | the report's exact `run.worker: "…"` shape, driven through `doctor` |
| 6 | **LIVE at HEAD — FIXED this window** | reproduced at HEAD; three separate causes, all fixed |
| 7 | **FIXED this window** | derived from the script, so the page cannot drift from it again |

---

## Finding 1 — the actionable error was thrown away

**The report calls this the single highest-value change in it. It was right.**

`acp.py` kept `error.message` and dropped `error.code` and `error.data`. The
org-managed refusal that ended the run carried, in `data.details`, a plain
English remedy naming the exact command to run — and Wringer rendered
`Internal error`, JSON-RPC's generic code, which carries no information at all.
One paid drafting call and a whole session, for a problem whose fix was in the
payload.

**There is now one renderer**, `acp.refusal_words`, and everything downstream
reads `str(exc)`: the console, `loop.jsonl`, `worker-diagnosis.json`, the
bundle's log, the drive's `stopped` step, and `wring doctor`'s worker-auth
line. Code, message and every `data` key travel, verbatim, through the normal
redaction. Nothing interprets: the code is printed as the number it is, each
value as the agent wrote it, and the reader decides what it means — the same
law the hint tier lives under.

The fixture is the report's captured payload with its `\n` escapes decoded,
reconstructed rather than re-measured, because the machine that produced it is
not this one and no test may depend on a Mac being org-pinned.

**Three things the fix could not have without being built, all found by
building it:**

- **A timeout was decided by reading the message text** — `"deadline" in
  str(exc)`. That was safe only while Wringer wrote every word of the message.
  It now carries the agent's own prose, so an agent whose remedy mentioned a
  deadline would have been recorded as having run out of time, and
  `diagnose_failed_turn` says nothing at all about a timeout — the operator
  would have lost the diagnosis at the moment they needed it. It reads
  `AcpError.timed_out`, a fact, now.
- **The console reflows.** The hint sentence is `textwrap.fill`ed, which
  collapses newlines, so folding the remedy into it would have reflowed
  somebody else's instructions into a paragraph and broken the one line a
  person is meant to copy. A multi-line quote gets its own unwrapped block.
- **The redaction moved upstream.** The agent's words now reach a terminal as
  well as a bundle, and the scrub lived on the file writes — which protects
  every reader except the person watching the run. An agent is handed a
  credential by name through `env_passthrough`; nothing stops it handing the
  value back inside an error.

Each of those four was reverted individually and watched go red on its own
guard.

## Finding 2 — half of it was dead, and the other half was alive at HEAD

**The exact message quoted in the report cannot be produced at HEAD.** The
"it passes today" clause was deleted in `c41526b` on **2026-08-21 19:05**, one
day after `v0.4.0` was tagged, in answer to the *previous* field report's
finding 10. So the run reproduced a fixed defect, and this repository could not
have known that because nothing told the reporter their install was stale.
That is finding 1 of this document's opening section, not a criticism of the
report.

**Then the repro was run at HEAD anyway, and found the tautology alive.**
`c41526b` treats a proposal as already-applied only when the id AND the command
AND the binding all match. Any other combination fell through to a sentence
that names the same gate on both sides of itself:

```
'acceptance-skip-downstream' runs `pytest -q …`, which is already what
'acceptance-skip-downstream' runs
```

Two ways in, and the commoner one is not exotic:

- the gate on disk carries **no `proves:` at all** — somebody wrote the check
  by hand and the drafter proposed binding it;
- the gate on disk proves a **different** criterion.

`parse_gatespec` raises on the first note, so both of those stop the build on a
sentence nobody can act on. Both now say what is true and what to type — *"is
already installed in `.wringer.yaml` and runs the same command. The binding to
'X' is the only new part … add `proves: X` to that gate to bind it"*. The guard
is **derived over every arm**: no note may name one id twice in its own
sentence, whatever the reason for the note. Three examples would have passed
again the next time an arm was added.

**The unverified-assertion half.** The report's second defect — *"it passes
today" is false* — was the claim ceiling being broken, and it is gone. Every
remaining place in the engine that says anything about whether a check passes
was checked: the drive's `None of them passes today` is produced by
`already_passing`, which **runs them**, and the board's born-green sentence
fires only on that measurement. No surviving refusal asserts a gate result
nothing ran.

## Finding 3 — the login line: dead since `v0.4.1`, and the repro is here

`worker_auth.py` and its `wring doctor` line landed in `20c0f02` on
**2026-08-22**, two days after the version the run installed. Re-run at HEAD in
the report's exact three contexts:

| context | `worker auth` line at HEAD |
|---|---|
| outside a repo | `- worker auth   not a git repository — run from your repo to check` |
| a repo with a string `worker:` | `! worker auth   'run.worker' is the string '…', which Wringer runs as a SHELL COMMAND …` |
| a repo with an ACP worker | `! worker auth   claude-agent-acp reports it is not logged in` |

A line appears in all three. The middle row is new **this** window and is
finding 5 — at the start of it that context said *"the worker is not an ACP
agent"*, which is true, useless, and silent about the fact that the command it
was looking at IS one.

## Finding 4 — the machine was the variable nobody was holding

The report is right that `docs/drive/AGENTS.md` and `INSTALL.md` contradicted
each other, and right that on its host the documented remedy was the CAUSE of
the failure. It is also the finding that explains a note this repository has
been carrying since 2026-08-22.

**`session/new was refused: Internal error` was recorded as NOT REPRODUCED.**
That was honest and it was a statement about one machine. It reproduces
reliably on a host whose managed settings pin the coding agent to a first-party
organisation login — a class of machine nobody here had ever measured. Every
re-run behind that note was made on an unmanaged Mac. What was missing was not
a measurement; it was noticing that *"this machine"* was a variable. Corrected
in place, dated, in both places it was written down (`AGENTS.md` and
`SPEC_LOOPBACK_V0.md` §4b).

**There is now one page that tells anyone how the builder gets a credential**,
and it carries a two-row table keyed on the machine rather than on preference:

| the machine | the route that works | what breaks it |
|---|---|---|
| ordinary, unmanaged | either — log the agent's CLI in, or declare a key under `env_passthrough` | nothing measured |
| pinned by managed settings to an organisation login | log the agent's CLI in, and pass **no** key | **the key itself** |

`INSTALL.md` cites that section and deliberately restates none of it — its own
*"the authentication path is a live gap, not a solved one"* is gone, three days
stale by the report's date. A derived guard now fails if any second
reader-facing page grows its own copy of the instructions.

**The false green is sharpened rather than softened.** `Presence is not
validity` was true and understated: on the report's machine `auth status`
reported `loggedIn: true, authMethod: api_key` while every session was refused
— the green light was produced BY the thing that was breaking it. The page says
presence can be **worse** than absence, in those words, and a guard holds it
there.

**`wring doctor` gains a presence-only `managed settings` line.** It reports
that a coding-agent policy file exists at the documented path. It never opens
one: that is somebody's employer's configuration, and the only fact worth
having about it is whether it is there.

> **Stated plainly, because the fork in this window's plan asked for it: no
> machine available to this repository has such a file.** The PRESENT branch
> has never been seen in the field — only driven against a path in a test — and
> the paths themselves are the vendor's documented ones rather than measured
> ones. **Absence from that check is one path checked, not proof that a machine
> is unmanaged**, and the line says so in the words it prints. The measured
> answer to "am I on such a machine" is the agent's own refusal, which names
> itself in plain English and which finding 1's fix now carries whole.

## Finding 5 — a string worker that is silently not an ACP worker

`run.worker: "claude-code-acp"` parses as a shell command. Nothing speaks ACP,
`env_passthrough` cannot be expressed on that shape at all, and the only
symptom is a turn that changed nothing — which points nowhere near the cause.

`wring doctor` now warns when a string worker's first word is a binary this
repository knows speaks ACP, prints both forms, and says the string shape stays
supported. It fires on the current adapter name too: the shape is what is
wrong, not the spelling.

The deprecated name the report's config also carried has become a real single
source — `agents.SUPERSEDED_COMMANDS`. The document guard that forbids that
name across every page and script used to keep its own typed copy of it, which
is the same hand-kept-list defect one layer down; it derives from the mapping
now, and so does the warning.

## Finding 6 — the re-render, and it was LIVE at HEAD

Reproduced at HEAD before anything was changed: the same spec, rendered with
and without its sidecar beside it, produces the report's page exactly — no
`DECIDED WITHOUT ASKING YOU` block, every task reading *"(no plain-language
outcome was written for this task)"*.

**Three causes, and the report found the compound of all three.**

1. **Absence was rendered as silence.** An *unreadable* decisions sidecar has
   raised since 2026-08-19, for exactly the reason the report gives — it would
   otherwise render as "no decisions were taken for you", a false and
   reassuring sentence on the page a person approves from. An *absent* one was
   still being rendered as that same silence. The plan now says the file is not
   there, and says that its absence is not evidence that nothing was decided.
   The per-task line stops making a claim about the drafter that the renderer
   has no file to support.
2. **Reusing a spec was silent.** The drive skips drafting when a spec already
   exists — correct, and it said nothing, so a re-render was indistinguishable
   from a fresh draft. It now says which files the plan is about to be built
   from, and names the sidecar when it is missing.
3. **The stale-deferral detector had one field run's phrasing in it.** The
   guard added on 2026-08-22 matches `(if unanswered, …)`, which is what *that*
   drafter wrote. This report's drafter wrote *"once … is answered"*, and the
   detector scored zero hits on it — measured before the line was changed. Both
   phrasings are matched now, both taken from a real drafter, and a second
   guard holds the pattern narrow enough that ordinary prose about answering
   questions still passes.

The property the report really named — *"the degradation is specific to the
re-render path"* — is now pinned as byte equality: the same documents rendered
from two directories are the same bytes. A second renderer, or a branch keyed
on how the spec arrived, fails there.

## Finding 7 — the PATH export

Restated in `AGENTS.md`'s driving section, and **derived** so it cannot fall
out again: every non-credential `export` an example's `setup.sh` prints must
appear in that section. A credential is the one principled exclusion, taken
from the engine's own list of key variables rather than from a hand-kept one,
because law 3 makes the key the person's own act. An example that builds a
virtualenv and exports nothing fails too.

Both examples' epilogues were corrected in the same pass: *"one of these two,
whichever you prefer"* is measured-false on an org-pinned machine, so they now
say the machine decides, name the failure mode, and point at the one page.

---

## What the report got right that must not be lost

Its own §"What works, and is worth protecting" is the best summary and is not
paraphrased here. Two things are load-bearing and easy to erode:

- **The refusal to deliver.** `An unverified change does not get a branch.`
- **`NOTHING CHECKS THIS YET`, with the count stated up front.**

And one methodological point the report makes better than this repository has:
*"Offering to run a proposed check before installing it, and reporting `None of
them passes today`, is the right shape — and is what finding 2's message got
wrong by assertion instead."* Measuring and asserting are different acts, and
the tool already owns the machinery to do the first everywhere it does the
second.

## Found by shipping this, and it is the same disease

`scripts/release-check.sh` exercises the **installed** package — the thing
`pip install wringer` gives a stranger — and that is its entire reason for
existing. Run as the last gate before this release, its `the suite is green`
step came back **FAIL**: nine tests failing and one module skipping, because
four test files located `schema/` as
`Path(<some_module>.__file__).parents[2] / "schema"`. From a source tree that
lands on the repository root and everything passes. From a wheel it lands on
`<venv>/lib/pythonX.Y/schema`, which does not exist — `schema/` is a
repository artefact and ships in no wheel.

**Reproduced at `v0.4.6` too.** So the release bar has been red for at least
one release, and it went unnoticed for the same reason every finding in this
report went unnoticed: the check was there, the information was there, and the
surface said something other than what was true. Fixed at the source, with a
guard derived over every test file — matched on the code shape rather than on
the word, so a docstring explaining the rule cannot trip it. **30 of 30 now.**

## Owed

- **A gate whose binding is the only new part cannot be installed.** Finding
  2's case B now says so and names the one-line hand edit, because
  `gate_diff` is purely additive and will not edit a gate that already exists.
  Teaching it to add a `proves:` line to an existing gate is a real capability
  with a real interlock question attached, and it is larger than this window.
- **The managed-settings PRESENT branch is unexercised in the field.** No
  machine here can exercise it. It is guarded against a path in a test and
  should be confirmed on a real org-pinned host the next time one is available
  — the retest sheet asks for it.
- **Whether a subscription login serves a turn through this adapter** is still
  unmeasured, unchanged since 2026-08-22.
- **Four more test modules degrade quietly under a wheel.** They locate the
  core repository through the installed core and `pytest.skip` when the file
  is absent — an honest degradation designed when the board and the drive were
  separate repositories, and stale since the packages collapsed into one on
  2026-08-20. They are the same repository now, so `repo_root()` is available
  and stronger. Not changed here: they skip rather than lie, which is the
  difference between this and the four that were fixed.
