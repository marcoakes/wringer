# SPEC — the drive verb (one verb, prose in, board out)

*Drafted 2026-08-17 by the homecoming Opus window, under
`WRINGER_HOMECOMING_RUN_PROMPT_2026-08-17.md` §R **M-3**, which executes
`WRINGER_DIRECTION_RULING_2026-08-16.md` **Postscript P** (P-1 … P-5). Those
rulings are Fable's and Marc's; this document **restates and may not weaken
them**. `WRINGER_RULING_2026-08-15.md` §Q1's claim ceiling binds every
sentence here. `WRINGER_FACTORY.md` governs the order of work and outranks
this file.*

*Every "exists today" claim below was read out of the tree at **`44a61f2`**
and carries its `file:line` or its symbol. Nothing here is recalled.*

> **REVIEWED 2026-08-17. VERDICT: NOT SOUND — 19 findings (9 HIGH). ALL 19
> FOLDED, none rebutted. NOT YET BUILT.**
>
> The one-agent refute review ran the same day this was drafted and is
> recorded in full at §12. **It found two LIVE DEFECTS in shipped code by
> driving the engine's real output through the board's S3 surface**, both now
> fixed in `wringer-board` at `78eed09`, and it found that three of §2's ten
> rows do not compose against the tree at all.
>
> **The fold is done and it changed the shape of the thing.** §12 records
> every finding and where it landed. The three that mattered most:
>
> - **§1a and §9's open question 1 are DELETED.** The B1 "collision" this spec
>   made its central question does not exist: B1's test is about web-server
>   dependencies and one console entry point, says nothing about
>   "long-running", and **is unbuilt**. It would have sent a builder to amend
>   a test that is not there.
> - **§2 grew a step 0 and lost its claim that it composes only shipped
>   things**, because it does not: `wring init` writes no `judge:`, `run:` or
>   `deliver:` section and three later steps hard-refuse without them.
> - **Ruling 4's licence is WIDENED, explicitly and narrowly** (§3a), because
>   the alternative was a spec whose own one-sentence test it fails three
>   times.
>
> A window picking this up starts at §8's DONE box. **Read §3a first**: it is
> the only place this spec permits itself something the drafted version
> forbade, and the reasoning is what makes it not a loophole.

---

## §0 — Positioning

> **One verb takes a prose file and drives the chain that already exists —
> draft, interview, approve, plan, build, deliver, board — so that a product
> manager edits no file and types no second command.**

P-1 states the gap this closes, and states it as a gap in the **operating**
surface rather than the trust surface: the arc as ruled optimises what a PM
can *read, answer, approve and be refused by*, and after all of it, starting a
project still means installing a CLI, shaping a config and typing commands.

**The one-sentence test:** *does any step require the operator to open a file
in an editor, or to know what a gate is?* If yes, that step is not done.

**And the counterweight, which is P-3 and is not negotiable.** Easy never
means unguarded. This verb removes YAML, terminals and exit codes. It removes
no judgement. A "for dummies" product that waved work through would be the
vibe tooling this programme exists to answer, and would be worse than no
product because it would carry this project's name.

---

## §1 — Where it lives, and why that is the claims-less default

**The surface layer, as a THIRD package, `wringer-drive`.** Not a core
command, not a `wringer-board` verb.

**Not core** — B2 and §5's layering ruling. `wring --help` lists 19 commands
and the ceiling is standing law; a 20th is forbidden outright by the
2026-08-17 pack §8. This verb *composes* the nineteen; it adds none.

**Not the board** — `wringer-board`'s package description is *"the
requirements board for a Wringer repository — one page a PM can read"*, and
its `__main__.py` header says in its own words that it is a **separate layer
consuming the engine through what it already emits**. A verb that drafts,
runs a loop and delivers is not a renderer. Folding it in would make the
board's own claim about itself false, which is the sentence-goes-stale defect
this programme has now shipped seven times.

**Separate is the CLAIMS-LESS default and that is the whole argument for it.**
A third package claims only "these things exist beside each other". Any
merger claims something about what the merged thing *is*, and every such claim
is a sentence that can go stale. Where this spec has no strong reason, it
takes the option that claims less.

### 1a — There is no B1 collision, and the drafted version invented one

**DELETED 2026-08-17 by the review (finding 6).** The drafted §1a claimed a
tension with B1's test, described that test as asserting "no long-running
process and no port binding", and made resolving it §9's first open question.

Three things were wrong with that, and they compound:

1. **B1's test says nothing of the kind.**
   `test_the_surface_ships_no_server` asserts (a) the package declares no
   web-server dependency in its metadata or imports, and (b) it registers
   exactly one console entry point that writes a file and exits. Neither
   clause mentions duration.
2. **It is unbuilt.** `grep -rn 'ships_no_server' wringer-board/tests/`
   returns nothing.
3. **Even its live clause would not bind**, because §1 puts DRIVE in a THIRD
   package, and that clause is about `wringer-board`'s own packaging.

So the drafted spec made its central open question out of a misreading of a
test that does not exist, and would have sent a builder to amend it. **B1
itself is untouched and there is nothing here to rule on.**

What survives, as a plain constraint rather than a collision: **DRIVE binds no
port, serves no request, and exits.** It is a CLI process that runs for
minutes, which is what `wring run` already is.

*That B1's test is unbuilt is a finding against `SPEC_BOARD_V0`, not against
this document, and is recorded in §12 so it is not lost.*

---

## §2 — What it does, in one pass

`wringer-drive run PRD.md`

**Preconditions, which the drafted version left unstated** (finding 16): the
target must be a **git repository** (`wring spec` and `wring run` both refuse
outside one), and the PRD must live **inside** it and under `MAX_PRD_BYTES`
(`spec.read_prd`). A PM's obvious first move — pointing the verb at
`~/Desktop/PRD.md` — is refused today. **Step 0 copies the PRD into the
repository and says it did**, which is the smallest honest fix; it does not
create the git repository, and refuses with that sentence if there is none.

| step | what happens | what it composes | new? |
|---|---|---|---|
| 0 | **Bring the PRD inside.** Copy it to `.wringer/drive/prd.md` and say so. Refuse if the target is not a git repository. | — | **DRIVE** |
| 1 | **Read the prose.** Any prose, no schema, no front matter — subject to step 0. | `spec.read_prd` | |
| 2 | **Generate the workspace**, when there is no `.wringer.yaml`: `wring init`, **then add the `judge:`, `run:` and `deliver:` sections it does not write** (§3a). Refuse if detection found nothing runnable. | `wring init`, `detect.detect`, `detect.is_untouched_template` | **§3a** |
| 3 | **Draft the spec** from the prose. Needs `--send`; see ruling 2a. | `wring spec --send` | |
| 4 | **Interview** — each unanswered required question, one at a time. | `wringer_board.interview.answer` | |
| 5 | **Render the plan and STOP.** | `wringer_board.interview.plan` | |
| 6 | **Approval.** DRIVE renders and prompts ITSELF, then calls `interview.approve` in-process (ruling 2). | `wringer_board.interview.approve` | |
| 7 | **Show the proposed gates as a diff against the config, and INSTALL them on the operator's yes** (§3a). Gates were *proposed* at step 3; `wring plan` prints the diff and stops, because *"Wringer never installs a gate itself"*. | `wring plan` | **§3a** |
| 8 | **Build.** The repair loop, with the operator's declared ACP worker. | `wring run` | |
| 9 | **Deliver, or refuse.** Needs `--send`; see ruling 2a. | `wring deliver --send` | |
| 10 | **Render the board.** | `wringer-board render` | |

**The drafted version claimed every right-hand column was a thing that already
ships. That was false and the review proved it** (findings 3, 4, 12, 16): three
steps needed something new, and saying otherwise made the spec sound cheaper
than it is. The `new?` column is now part of the table so the cost is visible
at a glance rather than discovered during the build.

**Step 7's label was also wrong.** Gates are proposed at step **3** —
`wring spec --send` writes `wringer.gates.yaml`, and it must, because step 5's
plan reads that sidecar to say how each piece will be proved. `wring plan`
prints a *diff* of an existing proposal. The drafted row put "Propose gates" on
step 7 and claimed the diff is "rendered by the S3 surface", which it is not:
`interview.plan()` renders `proves:` bindings and never `wring plan`'s diff.
**That phrase came verbatim from Postscript P-2 and was restated without being
checked** — the stale-sentence class, inside a spec whose §1 names that class
as this programme's seven-time defect.

---

## §3a — The licence, WIDENED — and this is the only place it is

**Findings 3 and 4. The review's closing sentence was that neither is fixable
inside the licence this spec gave itself, and that the spec must either widen
it explicitly or sequence a board-fix commit ahead of the build. This is the
widening, and it is deliberately narrow.**

### The problem, stated as facts

`wring init` writes `version:` and `gates:` on a successful detection, plus
`evidence:` and a **commented-out** `run:` on the blank template. It writes no
`judge:`, no `run:` and no `deliver:`. And:

| step | refuses without | where |
|---|---|---|
| 3 `wring spec` | `judge:` | `cli.py` |
| 7 gates reaching `.wringer.yaml` | a human edit | `spec.py`: *"Wringer never installs a gate itself"* |
| 8 `wring run` | `run:` | `cli.py` |
| 9 `wring deliver` | `deliver:` | `cli.py` |

Drafted ruling 4 let DRIVE write `.wringer.yaml` only at step 2 and only when
absent. So the verb would stop four times, in an editor's absence, and §0's
one-sentence test would fail four times over.

### What is permitted, exactly

**DRIVE may write `.wringer.yaml` at two moments and no others:**

1. **Step 2, when the file is absent**: `wring init`'s output plus a `judge:`,
   `run:` and `deliver:` section with declared defaults. Unchanged in spirit.
2. **Step 7, on the operator's explicit yes to a rendered diff**: the gates
   `wring plan` proposed, appended to `gates:` and **nothing else touched**.

### The four conditions, which are what stop this being a loophole

- **Step 7 writes only after a rendered diff and an answered yes.** The same
  interlock as approval, for the same reason: the person saw what changed.
  A no leaves the file byte-identical, and there is no flag that skips the
  diff.
- **It appends gates. It never edits or removes one**, and never touches any
  other section. A gate a human wrote is a human's.
- **It does not weaken the red-first rule and cannot.** `wring plan` produces
  the proposal; SPEC_GATEGEN's interlock decides what may be proposed; a gate
  green at birth is still self-refuting and still evidences nothing. DRIVE
  moves bytes a person approved; it does not decide what they are.
- **Byte-equality holds for both writes** (§5 test 4): what DRIVE writes is
  what the hand edit writes.

### What it does NOT permit

Editing a `.wringer.yaml` a person already wrote, beyond appending approved
gates. Writing a judgement — **never, in any of the three packages**. Writing
source. Writing any file at the repository root except the two named. And
`spec.py`'s sentence stays true in the sense that matters: **Wringer still
never installs a gate itself; a person does, through a diff, and DRIVE is the
hands.**

*Recorded as this spec's own decision, per the window law that where nothing
is pre-decided the option that claims less wins — and a spec that failed its
own one-sentence test four times while claiming a narrow licence was claiming
more, not less.*

---

## §3 — Rulings

### Ruling 1 — it drives the CLI as an API, and never reimplements it

Each step is the shipped command, invoked as a subprocess or through its
public entry point. **No step re-implements a refusal, a verdict, or a
format.** The moment this package computes something the engine also computes,
the two can disagree, and a surface disagreeing with the engine is the defect
`SPEC_BOARD_V0` ruling 1 forbids.

**AMENDED 2026-08-17, finding 7 — the audit §10 deferred, done.** `wring init`
has no arguments at all and no `--json`; neither do any of the four board
verbs. `wring spec`, `plan`, `run`, `deliver` do.

So "subprocess and read `--json`" cannot carry step 2, which needs to know
which detection branch fired, and that is prose on stdout across three
branches. Parsing that prose is the format re-implementation this ruling
forbids; adding a `--json` to a core command is what it also forbids.

**Ruled: DRIVE IMPORTS the two packages as LIBRARIES where a command has no
machine-readable output, and shells out where one does.** The permitted
symbols are named, so the seam is a list rather than a habit:

- `wringer.detect.detect`, `wringer.detect.is_untouched_template` (step 2)
- `wringer.spec.read_prd` (steps 0–1)
- `wringer_board.interview.answer`, `.plan`, `.approve`, `.unanswered`,
  `.questions` (steps 4–6)
- `wringer_board.refusals.say`, `.MAPPING` (ruling 3)

Everything else is a subprocess with `--json`. **Importing is not
re-implementing** — it is calling the same code the command calls, which is
the opposite of computing a second opinion. And `wring init` cannot be driven
in-process anyway (finding 19): `cmd_init` reads `Path.cwd()` and takes no
target, so a global `chdir` would be needed, which is unsafe in a verb that
later runs gates. Step 2 therefore shells out to `wring init` and imports
`detect` only to read the FACT of which branch fired.

### Ruling 2 — the verb NEVER auto-approves (P-3, B5)

- No `--yes`, no `--auto`, no `--non-interactive` that skips step 6, and no
  environment variable that does.
- **DRIVE renders the plan and prompts ITSELF, in its own process, and then
  calls `interview.approve` in-process.** It does NOT subprocess
  `wringer-board approve`. Finding 9: that verb takes the CALLER's word that a
  plan was shown — `read_the_plan` is an assertion, and the board's CLI sets it
  by printing. A subprocess with a captured stdout prints the plan into a pipe
  and nobody reads anything, so composition would launder the one interlock
  SPEC_BOARD §5 ruling 20 exists to protect. The prompt is unreachable if
  rendering failed.
- **Approving and answering a question are never the same action**, so a
  single keystroke can never do both.
- On any non-interactive stream, the verb **stops and says why** rather than
  choosing a default. A default here is an approval nobody gave.

`test_the_drive_verb_has_no_flag_that_skips_approval`, structural, over the
real parser — the shape `test_no_flag_no_env_var_and_no_command_can_write_a_judgement`
already uses for the judgement file.

### Ruling 2a — `--send` is a SECOND authorisation, and the drafted spec never mentioned it

**Finding 9's other half.** Steps 3 and 9 are no-ops without `--send`, which is
the typed flag that lets Wringer contact a model endpoint or write git history;
SPEC_GRAPH ruling 5's reason is that *"a file is not a typed flag"*. A
`wringer-drive run PRD.md` that quietly passed `--send` to `wring deliver`
would be a file-driven authorisation wearing a flag — precisely what that rule
refuses.

**Ruled: two separate authorisations, neither implying the other.**

- **Step 3's `--send`** (drafting: money, a model endpoint) is authorised by
  the operator having run the verb and been told the cost is about to be
  incurred, before the call.
- **Step 9's `--send`** (git history, a merge request) is authorised
  SEPARATELY, at the end, against the rendered board. **Approving the plan at
  step 6 does not authorise the delivery at step 9.** They are different acts
  about different things and a single yes may not cover both.
- **No flag, environment variable or config gives either in advance.**

### Ruling 3 — refusals RENDER, they never resolve (P-3, B6)

Every stop the engine makes — a delivery refusal, a vacuous gate, an
unanswered human criterion, an environment stop — surfaces as a card or a
question in the operator's language, taken from `wringer_board.refusals`,
which is the ONE place a PM-facing sentence may come from.

**The verb may not dismiss, snooze, soften, retry-around or auto-resolve any
of them.** It may not translate one either: it renders `refusals.say(...)` and
the engine's own words verbatim beside it, exactly as the board does.

**Three branches, not two** (finding 11). `refusals.say` needs a family AND a
value, and the stops DRIVE meets FIRST have neither: `wring spec`'s "no
`judge:` section", `wring plan`'s `approved: false`, every
`interview.InterviewError` — all are stderr prose with an exit code and no
named value at all. "Unmapped" presupposes a key.

1. **Mapped** — render `refusals.say(family, value)`'s sentence and its
   unblocking question.
2. **A named value with no sentence** — UNTRANSLATED, with the engine's words
   verbatim. Ruling 17: a PM seeing an ugly string files a bug report; a PM
   seeing nothing has been lied to.
3. **A CLI refusal with no named value** — the command's stderr verbatim,
   under a heading that says these are the engine's own words. Not
   paraphrased, not summarised, not swallowed.

**And step 9 will use branch 2 for every real delivery refusal, which this
spec states rather than discovers** (finding 8). The engine writes
`.wringer/refusals/<id>/refusal.json` carrying one of **23** names in
`deliver.REFUSAL_REASONS`. `wringer_board.refusals` has **three**
`delivery-refusal` entries and **none of them is one of the 23** — that file
says so itself — and nothing in the board reads `.wringer/refusals/` at all.

So today the most likely PM-visible end of the whole chain is a raw token like
`gates_did_not_pass`. That is honest under ruling 17 and it is **not** what
§2 row 9 promises, and it defeats §0's *"without needing to know what a gate
is"*. **Mapping the 23 is SPEC_REFUSAL's work and a board slice, not DRIVE's**,
and §8's DONE box now depends on it rather than pretending otherwise.

### Ruling 4 — it edits no file of the operator's except the two it is for

It writes `wringer.spec.yaml` (steps 4 and 6) and `.wringer.yaml` (step 2 when
absent, and step 7 on an approved gate diff — **§3a, which is the whole of the
widening and states its four conditions**). It writes its own output under
`.wringer/drive/`. It writes nothing else, and in particular:

- **never `wringer.judgements.yaml`.** A `human: true` criterion is answered
  by a person, and there is no flag, no verb and no code path in any of the
  three packages that writes one.
- never a source file. The WORKER writes code; this verb never does.
- never `.wringer/` except through the commands that own it.

### Ruling 5 — greenfield defaults are generated, never demanded

Step 2 generates a config with sane defaults so the operator edits no file. It
uses `detect.py`, whose standing rule is that it renders **commented
suggestions rather than being clever** when detection is uncertain — and that
rule is inherited rather than relaxed. A generated config that invented a
command nobody wrote would be a gate whose green means nothing.

**If detection finds nothing runnable, the verb says so and stops.** It does
not invent a gate so that the run has something to pass.

**And the composed step already does the thing this forbids** (finding 13),
which the drafted ruling never mentioned. `wring init` NEVER stops: on empty
detection it writes a placeholder gate `run: "true"`, and `detect.py` states
the motive in the ruling's own words — *"It passes, so `wring init && wring
verify` exits 0 in a repo nobody has configured yet."*

The mechanism that makes the ruling achievable is **`detect.is_untouched_template`**,
which exists precisely to recognise that state. Step 2 calls it after
`wring init` and refuses when it is true. Naming the mechanism is the
difference between a ruling and a wish.

### Ruling 6 — F6 lands first, and it already has

P-2 sequences R-ENV/F6 first inside this cycle, because the environment-error
class is the *minute three* killer of exactly this path: a PM's first run
against a machine missing a dependency used to brief a worker to repair
something no edit could affect. **F6 shipped on 2026-08-17** (`e93a243`), so
this precondition is discharged before this spec is built rather than during
it. The verb surfaces `environment` as a card like any other stop.

### Ruling 7 — the version, and what it may not spend

The drive verb writes **one** new artifact: a session record, so a run is
reconstructible. **It spends no version of any existing schema and adds no
field to a frozen one.**

**AMENDED, finding 14.** Law 7 says a new *schema file* is always allowed; the
drafted ruling widened that to "file" and never said where either lands.

- The schema lives in **`wringer-drive`'s own `schema/`**, not the core's. The
  core's `schema/` is under `frozen.json` and `tests/test_schema.py`, and
  SPEC_BOARD's B2 — which this spec inherits — spent the one engine change on
  S4's artifact slot. `wringer-drive` ships its own freeze test so the new
  file is pinned rather than unguarded.
- The record is written to **`.wringer/drive/`**, never the repository root,
  so it cannot trip §5 test 1 on the verb's own artifact.
- **The review's second question stands and is answered NO for now**: if a run
  is reconstructible from the bundles the chain already writes, this file
  earns nothing. §8 requires the builder to demonstrate what it adds before
  writing it, and to delete this ruling if it cannot.

---

## §4 — Non-goals (binding)

A server, a daemon, a port, a hosted anything (B1) · a 20th core command ·
any flag that skips approval · resolving, softening or retrying around a
refusal · writing a judgement · writing source code · re-implementing any
engine verdict, refusal or format · a progress bar that claims a percentage
nothing measures · a "quick mode" that skips the interview · installing or
bundling an agent.

---

## §5 — The four invariant tests (M-3's DONE gate)

These are the tests the ruling names. **Each is a property, not a scenario.**

1. **no-file-edited.** Drive a full run against a fixture and assert that no
   file changes outside the set the chain is entitled to touch.

   **CORRECTED, finding 5: the drafted set was wrong by five files and the
   test would have failed against a CORRECT implementation.** The composed
   chain also writes, at the repository root, `.gitignore` (`wring init`),
   `wringer.gates.yaml` (`wring spec --send`), and `tasks.jsonl`,
   `wringer.rubric.yaml` and one brief per task (`wring plan`). Ruling 4's
   "it writes nothing else" is false of the CHAIN, as against the verb.

   And the drafted test forbade an allow-list in the same sentence that
   required one, since a tree diff cannot tell the verb from its own
   subprocesses. **So the set is DERIVED from the commands' own filename
   constants** — `spec.SPEC_FILENAME`, `spec.GATESPEC_FILENAME`,
   `spec.TASKS_FILENAME`, `spec.RUBRIC_FILENAME`, `config.CONFIG_FILENAME` —
   never typed out. A new file any of them starts writing joins the set
   automatically; one DRIVE invents does not.

2. **approval-stop.** With no approval given, the run stops before any worker
   is invoked and **before any gate is INSTALLED** — and no flag, environment
   variable or config makes it not stop. Structural, over the real parser and
   the module source.

   **CORRECTED, finding 12:** the drafted wording said "before any gate is
   *proposed*", which is already false of the chain — gates are proposed at
   step 3 by `wring spec --send`, four steps before approval, and they must be,
   because step 5's plan reads that sidecar. As written the test would fail on
   a correct build. Installation is the act approval gates, and installation is
   what this now pins.

   **Two authorisations, two assertions** (ruling 2a): no approval means no
   gate installed and no worker; no SECOND yes at step 9 means no `--send`,
   no branch, no merge request.

3. **refusal-surface.** For every `(family, value)` pair in
   `wringer_board.refusals.MAPPING` **that DRIVE's chain can actually
   produce**, the verb renders that pair's sentence and its unblocking
   question rather than an exit code; a named value with no sentence renders
   UNTRANSLATED with the engine's words; and a CLI refusal with no named value
   renders stderr verbatim (ruling 3's three branches).

   **CORRECTED, finding 10, twice.** `MAPPING` is keyed on `(family, value)`
   PAIRS, deliberately — *"one sentence for five facts is precisely the
   collapse ruling 15 exists to prevent"* — so "every value" was the collapse
   the board forbids by name. And **19 of its 45 pairs are unreachable by
   construction**: signature, identity, integrity, health-verdict and
   fleet-outcome come from `wring attest`/`audit`/`health`/`fleet`, none of
   which appears in §2. The reachable FAMILY SET is derived from §2's command
   list rather than typed, so a step added later widens the test by itself.

   Note the first half is already proved and is not DRIVE's property:
   `test_every_saying_has_a_sentence_and_exactly_one_question` exists in the
   board.

4. **byte-equality.** What this verb writes is byte-identical to what a hand
   edit writes: `wringer.spec.yaml` at steps 4 and 6, and `.wringer.yaml`'s
   appended gates at step 7.

   **CORRECTED, finding 18:** the drafted clause said this "covers the
   generated config too", and there is no hand edit of a generated config to
   compare against. The honest property for step 2 is byte-identity against
   `wring init`'s own output plus the three sections §3a permits — i.e.
   against the command, not against a person.

   **And the multi-line hole this exposes is the board's** (finding 15):
   `interview._scalar` claims to round-trip exactly and folds newlines, so a
   multi-line PM answer silently becomes one line. §5's byte-equality cannot
   catch it, because both sides go through the same function. **Fixing it is a
   board slice sequenced before this build**, with the answer emitted as a
   block scalar or multi-line answers refused by name.

---

## §6 — The PM-mode quickstart (P-4), which is the DONE gate

**Wall-clock from a prose PRD to the first honest green, with the operator
editing no file and opening no terminal beyond the one verb.** Measured
through the recorder, filmed, and — P-4, verbatim — **the target is stated
only after it has been measured once.** No number appears in any launch claim
before its capture exists.

The capture **names what drove it**: the real drafting endpoint, and the
contained ACP worker where the runtime allows. A capture that does not say
which agent produced the work is a capture of nothing.

**One ending is pre-blessed and it must be the RIGHT one** (finding 17). The
drafted sentence blessed "a `no_progress` ending on a missing module" as F6
working, which is loose enough to hide a regression in F6's fact tier.

Precisely: a gate whose PATH-resolved command does not exist (exit 127,
pre-worker, unbound) stops as **`environment`** after one iteration having
briefed nobody — that is F6's fact tier, and a capture ending `no_progress`
there is a REGRESSION, not the hint tier. Only a missing *import behind a
present command* (exit 1 or 2) reaches the worker and may honestly end
`no_progress`, with the diagnosis legible in the record.

The capture states which of the two it filmed. **Never widen the stop tier to
make a demo look better.**

---

## §7 — What this spec does not license

- **No claim about intent.** Q1's ceiling binds every string: a witness proves
  the stated criterion could fail and was made to pass; it does not certify
  agreement with an unstated intended fix. **Nothing here claims wrong fixes
  are caught**, and no sentence this verb renders may imply it.
- No claim that the PM-mode path is *safe*, only that it is *guarded*: every
  refusal that fires at the terminal fires here.
- No claim about any agent this repository has not driven. The ACP census
  ships with "not exercised in this repository" on six of seven rows and this
  verb changes none of them.
- No timing claim before §6's capture.

---

## §8 — Definition of DONE

- [x] The one-agent refute review has RUN, and every finding is folded or
      rebutted in writing. **19 findings, all folded, none rebutted**, 2026-08-17.
- [x] **THE TWO BOARD SLICES THAT MUST LAND FIRST** — both landed at the
      board's `ccf117f`, 2026-08-17:
      - `interview._scalar` folded newlines, so a PM's multi-line answer was
        silently flattened (finding 15). Literal block scalar now, round-trip
        checked against the ENGINE's loader over seven shapes.
      - `wringer_board.refusals` mapped three `delivery-refusal` values, none
        among the engine's 23, and nothing read `.wringer/refusals/` at all
        (finding 8). All 23 mapped and DERIVED from `deliver.REFUSAL_REASONS`;
        `read.latest_refusal` reaches them; verified against a real refused
        delivery.
- [ ] §5's four invariant tests, each derived rather than scenario-shaped.
- [ ] §6's capture, filmed, naming what drove it.
- [ ] `wring --help` still lists 19 commands.
- [ ] No frozen schema changed a byte; the diff adds at most one new schema
      file.
- [ ] Nothing in any of the three packages writes `wringer.judgements.yaml`,
      re-checked across all three rather than in this one.
- [ ] The session record earns its existence, demonstrated rather than
      assumed — or ruling 7 is deleted (finding 14, and the review's own
      second question).
- [ ] The finish report states the PM-mode number **in one sentence a PM
      could read**, and says what drove it.

---

## §9 — Open questions — ANSWERED, and the one that remains

1. ~~**The B1-row TEST.**~~ **DEAD.** There is no collision: the test says
   nothing about duration, does not bind a third package, and **is unbuilt**
   (§1a). The question was made out of a misreading.
2. **The session record.** Answered provisionally NO — §8 makes the builder
   demonstrate what it adds before writing it, and delete ruling 7 if it
   cannot.
3. **Step 2's trigger.** Answered: **absence, not staleness.** A
   `.wringer.yaml` a person wrote is theirs, and a verb that decided somebody
   else's config was out of date and rewrote it would be the vibe tooling this
   project answers. §3a's step-7 append is the only touch of an existing file
   and it needs a rendered diff and a yes.
4. **The interview's transport — DECIDED 2026-08-17, by Marc, and the answer
   changes what gets built.**

   **The transport is the PM's OWN CODING AGENT.**

   The reasoning starts from Marc's own directive, which this spec had not
   read back to itself: *a non-technical PM installs Wringer by pasting one
   prompt into their coding agent.* **The PM's interface therefore already
   exists.** It is the chat they are in. They did not ask for a terminal, and
   building them a new surface would be answering a question nobody asked.

   The alternatives, and why each loses:

   - **A local web page.** Forbidden outright: B1's test names `http.server`
     among the banned dependencies, so not even a stdlib server is available.
     Nor should it be — a server is a thing to run, secure and keep alive.
   - **A raw terminal prompt as the primary.** It works, and it is what a
     developer would build. But it makes the PM's experience a shell session,
     which is the thing P-1 identifies as the operating-surface gap in the
     first place.
   - **A file the operator edits.** That is today, and it is what DRIVE exists
     to remove.

   **So DRIVE is built to be DRIVEN.** It emits the questions, the plan and
   the refusals as structured, verbatim text on stdout; the agent relays them
   and returns the operator's answers; DRIVE does the writing. Two things make
   that safe rather than a hand-off of judgement:

   - **The agent is a TRANSPORT, not a TRANSLATOR.** Every PM-facing sentence
     is `refusals.say`'s or `interview.plan`'s, verbatim. An agent that
     paraphrased would be a second surface deciding what the engine said,
     which ruling 3 forbids. **Testable, and tested**: the text DRIVE emits is
     byte-identical to the text it writes and renders.
   - **The approval interlock does not move.** Ruling 2 stands whole: DRIVE
     renders the plan and takes the answer, and an agent relaying a yes is the
     operator's yes only because the operator saw the plan DRIVE rendered. No
     flag, and no agent, can produce that yes without it.

   **A plain terminal prompt is the FALLBACK**, used when nothing is driving —
   same text, same order, same interlocks. It is not a second implementation:
   both read the same emitted structure, which is why they cannot drift.

   *Recorded as Marc's decision on 2026-08-17. The one thing it costs is
   stated: a PM without a coding agent gets the terminal, and that is a worse
   experience than the one this spec is optimising for. It is not a worse
   PRODUCT — it is the same product with a plainer front door.*

---

## §10 — What this spec has NOT checked

Stated per the gategen precedent, because a spec that hides its own limits is
the artifact this programme exists to refuse:

- It was written by a window that had just built S3, S4 and F6, so it is worth
  **least** against its own assumptions about how those compose.
- **No step in §2 has been driven end to end.** The right-hand column names
  commands that exist; nobody has run them in that order from one process.
- The `--json` availability in ruling 1 was **not** audited command by
  command. If a step needs one that does not exist, that is a finding.
- No measurement of any kind supports §6. There is no number.

---

## §11 — State of this document, precisely

| | |
|---|---|
| authored | **2026-08-17**, this window |
| independently reviewed | **NO.** Not begun |
| built | **NO.** No line of DRIVE exists in any repository |
| findings folded | **19 of 19**, none rebutted, 2026-08-17 |
| the two board slices it was blocked on | **BOTH LANDED**, board `ccf117f`, 2026-08-17 |
| §9's question 4, the interview transport | **DECIDED** — the PM's own coding agent, with a terminal fallback |
| blocked on | **nothing. The next act is the build.** |
| F6, its precondition | **YES** — landed `e93a243`, 2026-08-17 |
| S3, its precondition | **YES** — landed `d095463`, 2026-08-17 |
| S4 | **YES**, engine half — landed `4704521` |

**The next act is the BUILD.** Both blocking board slices landed, every
finding is folded, and the one open question is decided. There is nothing left
that a builder would hit and have no lawful move for — which was the
reviewer's closing worry.

H-5(ii) is satisfied: this document and the two board slices are the committed
checkpoint between review and build. Build in small committed increments,
because a killed build leaves a tree that looks finished.


---

## §12 — The review record

**Ran 2026-08-17, one refute-instructed agent, against the tree at `4b534bc`.
Verdict: NOT SOUND. 19 findings — 9 HIGH, 7 MEDIUM, 3 LOW.** It checked the
claims by EXECUTING the code rather than reading it, which is how the first
two were found.

### The two it found by execution, which were live defects in shipped code

Both are fixed in `wringer-board` at `78eed09`; **neither was a DRIVE defect**,
and a build agent hitting them would have gone looking in the wrong package.

1. **`wringer-board approve` refused every spec `wring spec` drafts.** The
   engine renders `approved: false        # <- the interlock. …` and the
   board's pattern ended `\s*$`. §11 recorded S3 as a discharged precondition;
   it was not.
2. **`wringer-board answer` wrote a duplicate `answer:` key**, because
   `wring spec` renders `answer: ''` unconditionally and the board appended.

Cause in both: every fixture in the board's `test_interview.py` was hand-typed,
i.e. written on the same side of the seam as the reader. **That is the third
occurrence of that exact failure mode in this programme.**

### The seven other HIGH findings, unfolded

3. **`wring init` writes no `judge:`, `run:` or `deliver:` section**, and steps
   3, 8 and 9 each hard-refuse without one (`cli.py:2620`, `:1715`, `:3292`).
   Ruling 4 forbids the verb from adding them. §0's one-sentence test therefore
   fails three times. **This needs a design decision, not an edit.**
4. **Gate installation requires a hand edit that Ruling 4 forbids.**
   `wring plan` prints a diff and stops; `spec.py:901` states *"Wringer never
   installs a gate itself"*. And §2 row 7's *"rendered by the S3 surface"* is
   false — `interview.plan()` renders `proves:` bindings, never `wring plan`'s
   diff. **That phrase was inherited verbatim from Postscript P-2 and restated
   without being checked**, which is the stale-sentence class §1 names.
5. **§5 test 1's allow-set is wrong by five files** — the chain also writes
   `.gitignore`, `wringer.gates.yaml`, `tasks.jsonl`, `wringer.rubric.yaml` and
   a brief per task. The test fails against a *correct* implementation.
6. **§1a mischaracterises B1's test, and that test does not exist.**
   `test_the_surface_ships_no_server` is about web-server dependencies and one
   console entry point, says nothing about "long-running", and is unbuilt.
   **§9's open question 1 is a non-question** and would send a builder to amend
   a test that is not there.
7. **The `--json` audit §10 deferred: `wring init` and all four board verbs
   have none.** Step 2 is fatal — Ruling 5 needs to know which detection branch
   fired and that is prose on stdout. The spec must rule on whether DRIVE
   imports the packages as libraries.
8. **Step 9's rendering path does not exist.** The board never reads
   `.wringer/refusals/`, and its three `delivery-refusal` values are not among
   the engine's 23 `REFUSAL_REASONS`. So 100% of real delivery refusals would
   reach a PM through the UNTRANSLATED escape hatch as a raw token.
9. **Ruling 2's interlock is launderable by composition.** `interview.approve`
   takes the caller's word that a plan was rendered; a subprocess with captured
   stdout prints the plan into a pipe and nobody reads anything. **And the spec
   never rules on `--send` at all**, which steps 3 and 9 both need.

### MEDIUM and LOW, in one line each

10. §5 test 3 is not derivable: `MAPPING` is keyed on `(family, value)` pairs,
    and 19 of 45 are unreachable by DRIVE's chain.
11. Ruling 3 has no branch for a CLI refusal that carries no named value, which
    is most of the ones DRIVE meets first.
12. §5 test 2's "before any gate is proposed" is already false — gates are
    proposed at step 3, not step 7.
13. Ruling 5 omits that `wring init` always writes a placeholder gate
    `run: "true"`, the exact thing the ruling forbids. `is_untouched_template`
    is the mechanism and the spec never names it.
14. Ruling 7 widens law 7's "new schema file" to "new file", and never says
    which repository it lands in or where the record is written.
15. `interview._scalar` folds newlines: a multi-line answer does not round-trip
    and nothing errors.
16. §2 row 1 overclaims — the PRD must be inside the repository, under a byte
    ceiling, and in a git repo.
17. §6 pre-blesses `no_progress` in a way that would hide an F6 regression: the
    "no pytest" case stops as `environment`, not `no_progress`.
18. §5 test 4's third clause has no hand edit to compare against.
19. `wring init` reads `Path.cwd()` and cannot be driven in-process safely.

### What the reviewer could not check

`wringer-drive` itself (there is none), `wring spec --send` and `wring run` end
to end (both need a live endpoint and a credential), `wring deliver --send`,
and §6's number (there is none, correctly).

### The reviewer's own summary of what mattered

> Findings 1 and 2 would have had a build agent hit exit 2 on step 6 with a
> message that reads as a DRIVE bug and is not one. Finding 3 would have hit it
> three more times. **None of these is fixable inside DRIVE's own licence: they
> are core and board defects that DRIVE's rulings forbid it from touching. The
> spec must either widen its licence explicitly or sequence a board-fix commit
> ahead of the build.**
