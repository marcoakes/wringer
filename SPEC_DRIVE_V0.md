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

> **REVIEWED 2026-08-17. VERDICT: NOT SOUND — 19 findings (9 HIGH). NOT YET
> BUILT, and NOT YET FOLDED.**
>
> The one-agent refute review ran the same day this was drafted and is
> recorded in full at §12. **It found two LIVE DEFECTS in shipped code by
> driving the engine's real output through the board's S3 surface**, both now
> fixed in `wringer-board` at `78eed09`, and it found that three of §2's ten
> rows do not compose against the tree at all.
>
> **Nothing below §12 has been rewritten yet.** The rulings and the tables in
> §0–§11 are as drafted, and several of them are now known to be wrong. §12
> says which. **A window picking this up starts at §12, folds, and only then
> builds** — and it must read finding 3, 4 and 9 before it writes a line,
> because two of them cannot be fixed inside DRIVE's own licence at all.

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

### 1a — The B1-row collision, NAMED and not resolved here

`SPEC_BOARD_V0.md` §1's **B1** row is Fable's, and it is untouchable by this
document. What this spec may say is that **B1's TEST** — as it is currently
written — and this verb's shape are in tension, and that the tension is real
rather than a misreading:

- B1 is *local, no server*. This verb is local and has no server: it is a CLI
  process that exits. **On B1 itself there is no conflict at all.**
- **The collision is with the TEST**, which asserts the surface layer contains
  no long-running process and no port binding. A verb that drives a repair
  loop runs for minutes and streams progress. Nothing about that binds a port
  or serves a request — but a test that keys on "long-running" rather than on
  "listening" would refuse it.

**This spec does not amend B1 and does not amend its test.** It names the
collision so the review has to rule on it. §11's open question 1 is where that
lands. **If the review upholds the separate package, the test's wording is
what may be amended — with the review's reasoning recorded — and B1 itself is
untouched.**

---

## §2 — What it does, in one pass

`wringer-drive run PRD.md`

| step | what happens | the existing thing it composes |
|---|---|---|
| 1 | **Read the prose.** A file, any prose. No schema, no front matter. | — |
| 2 | **Generate the workspace**, if the target repository has no `.wringer.yaml`: detect what the repo already declares and write a config. **The operator edits nothing.** | `wring init`, `detect.py` — which renders a *commented template* when it finds nothing rather than inventing a command nobody wrote |
| 3 | **Draft the spec** from the prose: criteria, and the questions the drafter could not answer. | `wring spec` |
| 4 | **Interview.** Every unanswered required question is asked, one at a time, in the operator's language. Answers are written as `answer:` lines. | `wringer-board answer` |
| 5 | **Render the plan and STOP.** What will be built, and how each piece will be proved. | `wringer-board plan` |
| 6 | **Approval.** The operator says yes. Nothing before this point wrote code. | `wringer-board approve` |
| 7 | **Propose gates**, through the existing human-diff interlock, rendered by the S3 surface — a generated gate green at birth is self-refuting and must be RED first. | `wring plan`, SPEC_GATEGEN's interlock |
| 8 | **Build.** The repair loop, with the operator's declared ACP worker. | `wring run` |
| 9 | **Deliver, or refuse.** Every refusal renders as a card, never as an exit code. | `wring deliver` |
| 10 | **Render the board.** | `wringer-board render` |

**Every row's right-hand column is a thing that already ships.** This verb
invents no capability. If a row needs something new, that is a finding against
this spec, not a licence to build it here.

---

## §3 — Rulings

### Ruling 1 — it drives the CLI as an API, and never reimplements it

Each step is the shipped command, invoked as a subprocess or through its
public entry point. **No step re-implements a refusal, a verdict, or a
format.** The moment this package computes something the engine also computes,
the two can disagree, and a surface disagreeing with the engine is the defect
`SPEC_BOARD_V0` ruling 1 forbids.

Where a step needs a machine-readable answer, it uses the `--json` the command
already has. Where one does not exist, that is a finding: this spec does not
add flags to the core.

### Ruling 2 — the verb NEVER auto-approves (P-3, B5)

- No `--yes`, no `--auto`, no `--non-interactive` that skips step 6, and no
  environment variable that does.
- **The plan is rendered before the approval prompt exists**, in the same
  process, and the prompt is unreachable if rendering failed.
- **Approving and answering a question are never the same action**, so a
  single keystroke can never do both.
- On any non-interactive stream, the verb **stops and says why** rather than
  choosing a default. A default here is an approval nobody gave.

`test_the_drive_verb_has_no_flag_that_skips_approval`, structural, over the
real parser — the shape `test_no_flag_no_env_var_and_no_command_can_write_a_judgement`
already uses for the judgement file.

### Ruling 3 — refusals RENDER, they never resolve (P-3, B6)

Every stop the engine makes — a delivery refusal, a vacuous gate, an
unanswered human criterion, an environment stop — surfaces as a card or a
question in the operator's language, taken from `wringer_board.refusals`,
which is the ONE place a PM-facing sentence may come from.

**The verb may not dismiss, snooze, soften, retry-around or auto-resolve any
of them.** It may not translate one either: it renders `refusals.say(...)` and
the engine's own words verbatim beside it, exactly as the board does.

**An unmapped refusal renders UNTRANSLATED with the engine's words**, never
generically. Ruling 17: a PM seeing an ugly string files a bug report; a PM
seeing nothing has been lied to.

### Ruling 4 — it edits no file of the operator's except the two it is for

It writes `wringer.spec.yaml` (steps 4 and 6) and `.wringer.yaml` (step 2,
**only when absent**). It writes its own output. It writes nothing else, and
in particular:

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
field to a frozen one.** Law 7: a new file is always allowed.

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

1. **no-file-edited.** Drive a full run against a fixture and assert that the
   set of files changed under the operator's repository is exactly
   `{wringer.spec.yaml, .wringer.yaml}` plus what the WORKER wrote plus
   `.wringer/`. Derived by diffing the tree, never by an allow-list somebody
   maintains.
2. **approval-stop.** With no approval given, assert the run stops before any
   worker is invoked and before any gate is proposed — and that **no flag, no
   environment variable and no config makes it not stop.** Structural, over
   the real parser and the module source.
3. **refusal-surface.** For every value in `wringer_board.refusals`'
   mapping, assert the verb renders that value's sentence and its unblocking
   question rather than an exit code — and that an UNMAPPED value renders the
   engine's own words under an UNTRANSLATED heading. Both directions, derived
   from the mapping.
4. **byte-equality.** The files this verb writes are byte-identical to what a
   hand edit writes. Inherited from B5's shape and already proved for
   `wringer-board answer` and `approve`; here it covers the generated config
   too.

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

**A `no_progress` ending on a missing module is F6's hint tier working, not a
failure of this capture.** The capture shows the legible diagnosis and says
so. Never widen the stop tier to make a demo look better.

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

- [ ] The one-agent refute review has RUN, and every finding is folded or
      rebutted in writing. **No code before this.**
- [ ] §5's four invariant tests, each derived rather than scenario-shaped.
- [ ] §6's capture, filmed, naming what drove it.
- [ ] `wring --help` still lists 19 commands.
- [ ] No frozen schema changed a byte; the diff adds at most one new schema
      file.
- [ ] Nothing in any of the three packages writes `wringer.judgements.yaml`,
      re-checked across all three rather than in this one.
- [ ] The finish report states the PM-mode number **in one sentence a PM
      could read**, and says what drove it.

---

## §9 — Open questions the review must answer

1. **The B1-row TEST** (§1a). Uphold the separate package and amend the test's
   wording with reasoning recorded, or reject the separate package — in which
   case the argued alternative must say where the verb lives and what claim
   that makes.
2. **The session record's shape**, and whether it is needed at all. A run that
   is reconstructible from the bundles the chain already writes needs no new
   file, and ruling 7 should then delete itself.
3. **Whether step 2 may run at all in a repository that has a `.wringer.yaml`
   it did not write.** The spec says "only when absent". The review should
   check that absence is the right trigger rather than staleness.
4. **The interview's transport.** Step 4 asks questions one at a time; the
   spec does not say through what. A terminal prompt contradicts P-1's "opens
   no terminal beyond the one verb" only if the verb is not itself the
   terminal. The review should rule on whether that is a distinction or a
   dodge.

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
| built | **NO.** No line of DRIVE exists in either repository |
| F6, its precondition | **YES** — landed `e93a243`, 2026-08-17 |
| S3, its precondition | **YES** — landed `d095463`, 2026-08-17 |
| S4 | **YES**, engine half — landed `4704521` |

**The next act is §9's review, by one refute-instructed agent, before any
code.** H-5(ii): review and build of the same artifact are separated by a
committed checkpoint, and a killed build is more dangerous than a killed
review because a killed build leaves a tree that looks finished.


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
