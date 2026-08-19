# SPEC — the PM consent surface (v0)

*Assumptions get a channel, the plan gets two registers, the PM gets a way
back.*

Carrier: `~/Claude/WRINGER_PM_PLAN_2026-08-19.md` (Fable, 2026-08-19, reviewed
the same evening — SOUND WITH FINDINGS, seven findings folded, four
substantive ones marked ⚑ in the carrier and carried into the rulings here).

This spec covers three things that look separate and are one: **what a product
manager approves, and how they change their mind.** It is written before any
code, and it is reviewed before any code.

> **Status, 2026-08-19 — REVIEWED: NOT SOUND. 19 confirmed findings, THE FOLD
> IS IN PROGRESS, AND NO CODE MAY BE WRITTEN AGAINST THIS SPEC YET.** The
> adversarial review ran 8 lanes over 57 agents: 97 raw findings, 54 after
> dedupe, **19 confirmed** by two independent skeptics each, 5 killed, and **30
> below the verification cap and therefore unexamined rather than clear.** The
> full record is [docs/pmplan-review-2026-08-19.md](docs/pmplan-review-2026-08-19.md);
> it is kept verbatim so the fold can be checked against what the review said
> rather than against my summary of it. Slice 1 is DONE when every confirmed
> finding is folded or explicitly rejected with a reason.
>
> Two of the five killed findings were killed for the best possible reason —
> the defect had already been fixed between the lanes reading the spec and the
> skeptics re-reading it. The review also found **two live bugs in shipped
> board code** it was not looking for, both now fixed (board `99b9f25`,
> `2653d25`).
>
> *Earlier status, kept because it dates the work:* before the review ran,
> three HIGH defects in the first draft had already been found by EXECUTION
> against the measurement run's real artifacts — not by re-reading the spec.
> Ruling 4's detector found 4 of the real cases (the review later showed the
> true denominator was 14, not 10, and that the correction was also wrong);
> ruling 9 miscounted `human` criteria against what a real run was actually
> held by (the review then showed it was inverted in a second, worse way);
> and ruling 12's amendment turned out to have three teeth rather than one.
> The pattern those three share is this programme's recurring one, and the
> review is the same pattern at larger scale: **reading the spec found
> nothing; running its evidence found all of it.**
>
> *(Scoping note: an earlier draft of this line said the review must be a
> single agent, citing the 2026-08-09 no-fleet rule. Marc corrected that the
> same day — **the no-fleet rule is Fable-only; an Opus window fans out.** The
> review is a multi-lane adversarial fleet with refutation.)*

---

## §0 — The measured facts this spec is built on

Four parallel drafting calls on the same arcade PRD, plus one end-to-end drive,
on core `c492a7f` / board `fa34957` / drive `bf44aed`. Every claim below was
re-verified against the raw artifacts before this spec was written; the
per-run numbers come from reading the four `wringer.spec.yaml` files, not from
recall.

**0.1 — The question cap held behaviourally, and it is a PROMPT, not a guard.**
Required questions per run: **2, 2, 2, 3, 2**. "AT MOST THREE QUESTIONS" lives
in `render_request`'s prose (`spec.py:661`). Nothing at parse time refuses a
reply with nine. This programme's own law: prompts are not guards — measured
twice already, once when the drafter proposed a binding duplicating a declared
gate *in the same breath the rule forbade it* (`parse_bindings`' docstring,
`spec.py:958-963`), and once when `objective_note` killed a paid draft.

**0.2 — The drafter is already writing assumptions, into a field that is not
for them.** Run 1, `wringer.spec.yaml`, criterion `survives-tab-close`, inside
`guidance`:

> `... and is read back on page load. Reloading the page, or closing and
> reopening the tab, still shows the same recent games in the same order.
> Decision taken without asking: this is per-browser only — there are no
> accounts, so the list does not follow a person to another device or browser,
> and that is acceptable.`

The request tells the drafter to *"write your decision into the criterion it
affects, in plain words, so the person reads and approves it"* (`spec.py:671`),
and gives it **no field to put a decision in**. So it improvised one into test
guidance, where the person approving the plan will never read it as a decision.
**The behaviour exists; the channel does not.**

**It is systematic, not anecdotal, and the carrier understated it.** Measured
across all four raw replies (`.wringer/specs/*/response.json`, the surface the
parser actually sees), a labelled decision buried in `guidance` appears in **14
criteria across ALL FOUR runs** — 4 of 9, 4 of 10, 3 of 12, 3 of 11. Every
drafting call did it. See [docs/variance-2026-08-19.md](docs/variance-2026-08-19.md),
including its dated correction: an earlier version of this paragraph said ten
across three runs, with run 2 as a clean control, and that was wrong.

**0.3 — The silent decisions differ per roll.** Criteria per run: **9, 10, 12,
11**. Run 1 decided per-browser-only *without asking* (its questions were
`what-counts-as-played`, `clearing-history`); run 4 **asked** it
(`memory-scope`, `what-counts-as-played`, `clearing-history`). What a PM
consents to depends on the roll of a die they cannot see.

**0.4 — Even the perfect run ends in a refusal the PM must interpret.** The
full drive converged — acceptance red on iteration 1, a real worker turn, green
on iteration 2 — and the ending was `stopped:acceptance_unevidenced`. Honest,
correct, rendered in the board's own words. But **the best possible outcome of
today's pipeline is a "held" the PM has to decode**, and nothing set that
expectation at the moment they approved.

> **⚠ The carrier gives a CAUSE for that ending, and it is wrong.** It says the
> run was held *"because the other criteria have nothing checking them"*. The
> console says otherwise: `wring deliver` listed **exactly one** criterion —
> `heading-reads-as-yours — HUMAN`, *"nobody has answered this"* — out of nine,
> most of which were unbound (`verify-drive2/console.txt:153-158`).
>
> The engine agrees with the console, explicitly. `accept.py:406-450`: a
> non-human row refuses only when it is required, **COVERED** and not
> evidenced, and *"an uncovered one is a debt the author has not paid yet —
> loud, never fatal … refusing there would refuse the first delivery in every
> repo that ever ran `wring spec`"*. **An unbound criterion CANNOT hold the
> handover.** The first draft of ruling 9 was built on the carrier's sentence
> and had the policy exactly inverted; §2 ruling 9 is rewritten against
> `accept.py` instead.

**0.5 — The oops path is narrower than first measured, and still missing.**
`wring spec --send` **already refuses** over an existing spec
(`cli.py:2713-2720`): *"refusing to overwrite wringer.spec.yaml — it may
already carry your approval and your answers. Move or delete it if you want a
fresh draft."* What remains true: the dry-run path silently builds request
directories; **the refusal's own remedy — "move or delete it" — IS the
answer-eating path, said to the reader**; and a PM who answers a question
wrongly has no path back that is not hand-editing YAML. §3 therefore
**extends** an existing refusal; it does not invent one.

**0.6 — Working as designed, observed in passing.** R3's drop-with-note fired
in the wild (run 4: three `objective_note` keys dropped, each named, the draft
survived where the day before it died whole). The R4 build heartbeat streamed
every phase. The interlock stdin drain held through all five runs.

---

## §1 — P1: assumptions get a channel

### Ruling 1 — the drafter's own phrase becomes the vocabulary

A drafted reply gains a top-level `assumptions` list. The REQUEST asks for it,
so the reply parser knows the key: the reply shape is defined by
`render_request` + `parse_response` together, and **nothing frozen moves**.

Each entry carries four fields and no others:

| field | meaning |
|---|---|
| `id` | a slug, unique within the reply |
| `decision` | one plain sentence: what was decided |
| `why` | one plain sentence: why it was decided that way |
| `instead_of_asking` | the question the PM would otherwise have been asked |

`instead_of_asking` is the field that keeps this channel honest. An assumption
is a question the drafter chose not to ask; carrying the displaced question
means the PM is always **one action away from asking it after all** (§3,
ruling 8). Without it, `assumptions` would be a place to hide decisions, which
is precisely the defect §0.2 names.

**`assumptions` is a FOURTH id-keyed reply section, and the interlock must
cover it** (review C17). `_drop_unknown_reply_keys` walks exactly three —
`open_questions`, `criteria`, `tasks` — and its stated law is that *"the
interlock does not become droppable by moving down a level"*
(`spec.py:780-783`). A new section it does not walk is a new place to smuggle
`approved`, in the one parser whose whole design is that there is no such
place. So, **in the same slice that adds the section**:

- `_ASSUMPTION_KEYS = {"id", "decision", "why", "instead_of_asking"}`, and
  `("assumptions", _ASSUMPTION_KEYS)` joins the sections tuple;
- an unknown key drops with a named note (R3, unchanged);
- **`approved` on an assumption refuses the whole reply**, exactly as on a
  task;
- a *missing required field* drops that one assumption with a note rather than
  refusing the draft — the `objective_note` lesson: a model's proposal survives
  with its losses named;
- the docstring says four sections, not three, and
  `test_a_reply_carrying_approved_on_a_task_is_refused_whole` is parametrised
  over all four.

### Ruling 2 — they land in a NEW SIDECAR, not in a v2 of the spec

`wringer.spec.v1` is frozen and `spec.schema.json` is
`additionalProperties: false` at top level, so `assumptions` cannot go in the
spec file. A **version spend** (`wringer.spec.v2`) ripples through every reader
in the chain — `parse`, `load`, `plan`, the board's `_load`, the drive, every
archived bundle's reader. A sidecar touches only the parser that writes it and
the board that renders it. **Law 7: a new file is always allowed.**

**Filename: `wringer.decisions.yaml`. Schema: `wringer.decisions.v1`.**

It carries `assumptions` (this section), `outcomes` (§2), and `consent` (§3,
ruling 10). The name is defensible for the first and third and is a stretch for
the second — an `outcome` is the drafter deciding, on the person's behalf, what
"done" will mean for them, which is a decision, but not in the same sense.
**The review's first target is this name.** If a better one exists, it costs
nothing now and cannot be changed after publication.

Frozen on publication like every sibling: `schema/decisions.schema.json`, hash
in `schema/frozen.json`, enforced by `tests/test_schema.py`.

```yaml
# wringer.decisions.v1 — the plain-language companion to wringer.spec.yaml.
# Written by `wring spec` from the drafted reply, or by hand. NO AUTHORITY:
# nothing under .wringer/ is written from it and no gate in it ever runs.
schema_version: wringer.decisions.v1
assumptions:
  - id: memory-scope
    decision: The list is remembered per browser only.
    why: >-
      The requirements describe no accounts, so nothing can follow a person
      between devices.
    instead_of_asking: >-
      Should the recent-games list follow a person to another device?
outcomes:
  - task: recent-plays-store
    outcome: >-
      A player who finishes a game sees it at the top of their recent list the
      next time they open the page.
```

`assumptions`, `outcomes` and `consent` are each **optional**; a sidecar
carrying only one of the three is valid.

**The schema is AUTHORED COMPLETE in slice 2 — all three blocks declared —
even though two of them get no producer until later** (review C13). Law 2
freezes this file on publication, so declaring only `assumptions` now would
force a version spend the moment `outcomes` arrives; later slices must add
producers and **never a byte**. The consequence is stated out loud rather than
left for a reader to discover: **the frozen schema declares a `consent` block
that, after the review, NOTHING WRITES** — the fingerprint is OWED (ruling 12)
— and §6 DONE says so instead of letting the schema imply it landed. The
`acceptance-v3` precedent covers this: a shape may be declared before its
producer exists, provided the gap is named where a reader will meet it, so the
justification is quoted in the schema's own `description` and its README row.

**It needs the hand-written protection its sibling has ten lines away**
(review C12). `wringer.gates.yaml` carries `GATESPEC_MARKER` and a
`gatespec_is_generated` twin precisely because an offline repo writes that file
BY HAND; the first draft of this ruling gave its new sibling neither, so an
ordinary `wring spec --send` would have silently clobbered a person's
hand-written sidecar. So: a `DECISIONS_MARKER` first line, a
`decisions_is_generated` twin, and the same three-way outcome on **both** the
`--send` and `--redraft` paths:

| sidecar on disk | what happens |
|---|---|
| carries the marker (generated) | overwritten |
| no marker (a person wrote it) | **left alone**, with a console line saying where the drafted assumptions went instead |
| absent | written |

Two rules the core must additionally obey: **it never writes or overwrites a
`consent` block** — that key belongs to `wringer-board approve` alone, in the
window that builds it — and **a redraft never carries `consent` forward**,
because a redrafted spec was never approved. Ruling 13's "copy the previous
documents into the bundle" is *recovery*, not consent, and does not substitute
for any of this.

### Ruling 3 — the parse-time cap, with four binding conditions

A reply carrying **more than three required questions** is refused whole,
naming the count and the rule. A refused draft is a sub-cent re-roll; a PM
facing nine blocking questions is the product failing at its stated purpose.
`MAX_REQUIRED_QUESTIONS = 3`.

Four conditions, all from the carrier's finding 1, all verified against the
code here:

**(i) The cap lives in `parse_response` ONLY, never in `_parse_questions`.**
`_parse_questions` (`spec.py:328`) also runs on every person's on-disk file via
`parse`/`load`. A hand-written spec keeps the existing strictness asymmetry —
`MAX_OPEN_QUESTIONS = 20`, *"a spec that unclear needs a conversation, not a
form"* — and does **not** acquire a question quota. A person who wants five
questions in their own file may have them; a model may not propose them.

**(ii) The cap runs AFTER every interlock refusal**, so their pinned messages
stand. There are three, in order:

1. top-level unknown keys, which is how a reply carrying `approved` is refused
   (`spec.py:856-865`);
2. the self-answered-question refusal (`spec.py:867-885`);
3. `approved` smuggled onto a task, question or criterion, raised inside
   `_drop_unknown_reply_keys` (`spec.py:802-807`).

So the cap is checked **after the `_drop_unknown_reply_keys` call at
`spec.py:887` and before `parse(...)` at `spec.py:889`.** A reply that both
works the interlock and asks nine questions gets the interlock refusal, which
is the more serious of the two.

**(iii) The two archived captures stay BYTE-INTACT.** Verified:
`tests/replies/2026-08-17-pm-mode-drafter-reply.json` carries 8 questions, **5
required**; `tests/replies/2026-08-18-arcade-run2-drafter-reply.json` carries
10, **all 10 required**. Both are over the cap. Five tests feed them through
`parse_response` — `test_spec.py:1047, 1067, 1084, 1156, 1183` — and all five
would start failing on a refusal that has nothing to do with what they check.

**They derive trimmed-question payloads; the fixtures are not edited.** A
capture is evidence, and this programme corrects a capture by dated note, never
by rewriting it. The mechanism is the one those tests already use at
`test_spec.py:1063` and `1081`: load the content, mutate the dict in memory,
re-wrap with the local `reply()` helper. A shared helper — trimming
`open_questions` to the first three required entries and leaving every other
byte alone — serves all five.

Two existing tests assert the fixtures' *content* rather than their parse
result (`test_spec.py:1038`, `1141`); those are untouched and keep guarding
that the captures still carry what the rulings are about.

**(iv) The parser NEVER demotes a question to an assumption.** Inventing
decisions is the one thing it may not do — it is `parse_response` answering its
own open question, which is refusal (2) above wearing a different coat. The cap
refuses; it does not repair.

### Ruling 4 — a decision buried in `guidance` is the drafter misfiling, and the parser notes it

Once the field exists, the request forbids decision prose inside `guidance`.
The parser **detects and notes, never rewrites**: a criterion whose `guidance`
matches the marker produces a `Draft.notes` entry naming the criterion and
quoting the first line, exactly as `_drop_unknown_reply_keys` does for a
dropped key.

It does **not** refuse (the draft is otherwise good, and the decision is at
least visible somewhere), and it does **not** move the text into `assumptions`
(that is ruling 3(iv)). It says, to the operator, that this draft put a
decision where the PM will not read it as one.

**⚠ THE MARKER HAS NOW BEEN GOT WRONG TWICE, AND THE SECOND TIME WAS
PUBLISHED.** Both attempts were written against the same four captured
replies, hours apart, and both were believed sufficient:

| detector | finds | misses |
|---|---|---|
| `decision taken without asking` — run 1's own sentence, this spec's first draft | 4 of 14 | runs 2, 3, 4 entirely |
| `decision taken` — the "correction", committed in `6ccdfaf` as measured fact | 10 of 14 | **run 2 entirely** |

Run 2 labels its four decisions `Decision to approve:`. It was declared a
"negative control" — the run that asked instead of deciding — and it is
nothing of the kind. **Four rolls produced four phrasings, and there is no
reason to expect a fifth roll to reuse any of them.**

**So the ruling is this: the detector is a LOWER BOUND with no known ceiling,
and the spec will not pretend otherwise.**

- The marker is a small set of measured phrasings, not one substring, and the
  set is named in the code with the capture each member came from.
- The note it produces says *at least N* — never a total.
- **Its silence is not evidence.** A run it reports clean has not been shown to
  be clean, and the code carries that sentence as a comment where a maintainer
  would look, next to the two counts above.
- §6 DONE does not claim buried decisions are caught. They are sometimes
  noticed.

**No negative control exists in this corpus**, so the guard is watched red on
the four captures and cannot be watched green on a known-clean draft. That is a
real gap in the evidence and it is recorded rather than papered over: a
detector with no true-negative case has not been shown to discriminate, only to
fire. §7 carries the open question of whether it should exist at all.

All four replies are captured at
`tests/replies/2026-08-19-arcade-run{1..4}-drafter-reply.json`. The guard is
watched against **every phrasing measured** — which, on today's evidence, is
not the same as every phrasing.

### Ruling 5 — the board renders the sidecar verbatim, under board scaffolding

The plan gains an assumptions block **before** the criteria, under the heading

```
DECIDED WITHOUT ASKING YOU
```

The heading is **board scaffolding**, exactly like its pinned siblings
`WHAT I WILL BUILD` and `HOW EACH PIECE WILL BE PROVED`
(`interview.py:306,312`, pinned by `test_interview.py:221`). SPEC_BOARD ruling
1 governs the board **re-describing engine facts**, not its own section
headings; it is not violated by a heading, and it *would* be violated by the
board paraphrasing an assumption's sentences.

The sentences under it are the drafter's field, **verbatim**. Never move the
heading text into the model's reply: per-roll variance in the consent surface
is the defect §0.3 names, not a fix for it.

Each assumption renders as its decision, its reason, and the question it
displaced, with the id a PM would pass to `revise`:

```
DECIDED WITHOUT ASKING YOU

  These were decided for you. Approving this plan approves them.
  If one is wrong, say so — nothing is built until you approve.

  memory-scope
    The list is remembered per browser only.
    Why: the requirements describe no accounts, so nothing can follow a
    person between devices.
    You were not asked: Should the recent-games list follow a person to
    another device?
```

**Approving the plan approves the assumptions.** That sentence is on the plan,
above the block, because it is the whole consent claim.

---

## §2 — P2: the plan gets two registers

### Ruling 6 — one plain-language `outcome` per task, alongside the machine `objective`

The drafter writes, per task, one sentence saying **what the person will be
able to do when this task is done**. It travels inside the task in the same
reply and lands in the same sidecar, keyed by task id.

**`wringer.spec.v1` does not move**, which forces the mechanics (carrier
finding 5, verified: `spec.schema.json`'s `tasks` items are
`additionalProperties: false` with `required: [id, brief, objective]`):

- `outcome` is **extracted from each task on the reply side BEFORE**
  `_drop_unknown_reply_keys` runs — otherwise R3 eats it with a note, which is
  correct behaviour for an unknown key and wrong for this one.
- **`_TASK_KEYS` does not change.** Adding `outcome` to it would make the
  person-file loader (`parse` → `_parse_tasks`) accept a key that the frozen
  `spec.schema.json` refuses — a spec that loads and fails its own schema.

So: `parse_response` lifts `outcome` off each task dict, records it against the
task id, and hands the task on to the existing pipeline unchanged.

### Ruling 7 — a missing outcome is a note; an outcome naming an unknown task is a refusal

Two different failures, two different answers.

**Missing** — a task with no `outcome`. Nothing is being lost; something is
absent. Refusing a whole paid draft over an absent sentence is exactly the
`objective_note` mistake R3 was written to stop. So: a note in `Draft.notes`,
and the plan says plainly *"no plain-language outcome was written for this
task"* and shows the objective. Honest, cheap, visible.

**Dangling** — an `outcomes` row naming a task id the spec does not have. That
is content pointing at nothing, on both the drafted and the hand-written path,
and it is the gates-sidecar precedent exactly (`config.check_bindings` refusing
a binding whose `proves` names no criterion). **Refused whole**, naming the id
and listing the task ids that do exist.

An assumption `id` that collides with an `open_questions` id is likewise
**refused whole**: one draft claiming both to have decided a thing and to be
asking about it is a contradiction the PM should never be shown.

### Ruling 8 — the plan leads with outcomes, and labels the objectives beneath

`WHAT I WILL BUILD` renders, per task, the outcome first and the objective
underneath, labelled as what it is:

```
WHAT I WILL BUILD

  A player who finishes a game sees it at the top of their recent list the
  next time they open the page.
    For the engineer: add a browser-local store keyed by game id, written on
    game end and read on page load...
```

This is D3(a) delivered through D3(c)'s layering: **both registers, prominence
to the person's.** Where an outcome is missing, the person's line is the
sentence from ruling 7 rather than silence.

### Ruling 9 — the approval gate sets the ending expectation, in the board's existing words

The plan gains a block, after the criteria and before
`WHAT THIS PLAN DOES NOT SAY`, stating how many criteria have a check bound and
what happens to the rest:

```
WHAT WILL HAPPEN AT THE END

  2 of 9 requirements have a check bound to them.
  1 is yours to decide — no check can, and you record the answer yourself.
  6 have nothing checking them yet.

  The handover will be held if a bound check cannot show its proof, or if the
  requirement that is yours is left unanswered.

  The 6 with nothing checking them CANNOT hold it. They will be reported and
  not enforced: nothing checks them, so nothing can show they failed either.
  Approving this plan accepts that those 6 will not be proved.
```

**The first draft of this ruling had the policy inverted, and two independent
review lanes caught it.** It said the run would "HOLD the handover" for the
unbound criteria. `accept.py:406-450` says the opposite, in terms:

- a **non-human** row refuses when it is required, **`covered`** and not
  `evidenced` — where v2 widens `covered` to *bound or witnessed*;
- an **uncovered** row is *"a debt the author has not paid yet — loud, never
  fatal"*, because *"every spec starts with all its criteria required and
  nothing covering them, and refusing there would refuse the first delivery in
  every repo that ever ran `wring spec`"*;
- a **`human`** row refuses when it is required and carries a cause —
  unanswered, said-no, or wording moved — and *"coverage is not the question"*.

The measured run confirms it from the other end: nine criteria, most unbound,
and `wring deliver` named **exactly one** as holding the handover — the human
one (`console.txt:153-158`).

So the block counts **bound / yours to decide / nothing checks it yet**, and it
must say which of those can actually stop the handover. **The unbound line is
the most important sentence on the page for a PM**, and it is the opposite of a
warning: those requirements are not a blocker, they are a silence. Approving
the plan accepts that they will not be proved — which is the consent this whole
document exists to obtain, and which no draft of the plan has ever asked for.

**A PROPOSED gate is not a bound one, and the count must not say it is**
(review C1, second leg). `_bindings()` merges two files and returns an
`installed` flag with each entry: `wringer.gates.yaml` holds gates a drafter
PROPOSED (`installed=False`), `.wringer.yaml` holds ones a human INSTALLED
(`installed=True`). **Acceptance joins on the installed ones only** —
`accept.assess` builds its `bound` map from `cfg.gates`, which is
`.wringer.yaml` and nothing else (`accept.py:775-777`). So a criterion whose
only gate is proposed is `unbound` at acceptance time.

The first draft of this ruling said the counts *"come from the same
`_bindings()` read the criteria block already uses"* and never mentioned the
flag — which would have counted a proposed gate as *"has a check bound to
it"*, a stronger claim than the criteria block makes **eight lines above on the
same page**, where it already says *"(proposed, not installed yet — somebody
has to accept it before it runs)"*. **The count therefore reads `installed`,
and a proposed-only criterion counts as having nothing checking it yet.**

Note for slice 3: the board's own `repo` fixture writes `wringer.gates.yaml`
and no `.wringer.yaml` (`test_interview.py:57-63`) — it is **proposed-only**,
the one shape in which this defect is invisible. The capture must be taken
against a repository that has both, or it will photograph the bug as correct.

**One honest limit the plan must carry:** `covered` is *installed-bound OR
witnessed*, and a witness is written at run time from bytes the board cannot
see when the plan is rendered. So an unbound criterion **can** acquire a
refusal later that the plan could not foresee. The plan says what is true when
it is read, and says that much about it.

**The prediction sentence is not invented.** Where the block states the hold, it
uses the board's own `(DELIVERY_REFUSAL, "acceptance_unevidenced")` saying from
`refusals.py:451-455`, verbatim, confirmed byte-identical against the real run's
console. Where it states what a class of criteria *does*, it is describing
`accept.py`'s policy, and **that description is new prose about an engine fact
— which board ruling 1 forbids.** The build therefore takes the sentences from
the engine or does not write them: §7 open question 5 records that the engine
has no saying for *"an unbound criterion cannot hold the handover"*, and one has
to be added engine-side before the plan may say it. Until then the block renders
the counts and the two hold causes only.

The block renders **only when at least one criterion is unbound or human** — a
plan where every criterion is installed-bound must not carry a warning about an
ending that will not happen.

---

## §3 — P3: the PM gets a way back

### Ruling 10 — revision belongs to the board, and every board-verb revision un-approves

`wringer-board` already carries `render`, `plan`, `answer`, `approve`, and
already writes `wringer.spec.yaml`. The home is lawful and **core's 19-command
ceiling is untouched**.

New verb: **`wringer-board revise <repo> <id> <text>`.**

**The invariant this window builds and watches red: every revision through a
board verb flips `approved: false`.** A PM changing an answer has withdrawn
their approval of the plan that answer produced; leaving `approved: true`
standing would mean a build proceeding on a plan nobody agreed to.

Mechanics, each ruled here so the build has nothing to decide:

- **The flip is unconditional.** Revise always writes `approved: false`, even
  when the file already says false (a no-op edit), and even when the new text
  equals the old (a person saying "change it to X" when it already says X is
  still asking to reconsider). A conditional flip is a branch that can be
  wrong; an unconditional one cannot.
- **One write, both edits.** The answer edit and the interlock edit are
  computed in memory and written in a single `write_text`. There is therefore
  no intermediate state on disk, and in particular no window in which the file
  says `approved: true` beside text nobody approved. If the write fails,
  nothing changed.
- **B5's byte-equality doctrine constrains both edits to line edits.** The
  result must be byte-identical to what a person would have typed.

  **⚠ The mechanism this ruling first named does the OPPOSITE of what `revise`
  needs, and the review caught it.** `_fill_existing` fills an *empty*
  `answer:` and **returns `None` the moment it finds a non-empty one**
  (`interview.py:203-206`) — which is precisely and only the case `revise`
  exists for. Nor can `revise` fall through to `answer`'s append path: that
  appends a *second* `answer:` key, producing the duplicate-key malformation
  the comment at `interview.py:145-153` was written to stop. So `revise` needs
  a REPLACE-in-place sibling — same anchoring helpers (`_within_open_questions`,
  `_sibling_indent`, `_ends_block`, `_scalar`), new decision at the
  already-answered branch. Naming `_fill_existing` as reusable was wrong.

  **The interlock edit is now safe to reuse, and was not when this was
  written.** `approve`'s line edit was a live corruption bug — a hand-written
  `approved: False` came back as `approved: Falsetrue` — found by this same
  review and fixed at board `99b9f25`, splicing on `APPROVED_LINE`'s own
  `span("value")`. `revise` reuses the fixed version.
- **`answer`'s refusal to overwrite STAYS** (`interview.py:135-140`, pinned at
  `test_interview.py:124`). Revise is a separate verb with separate consent
  semantics, and **this window may not unify them.** `answer` is for a question
  nobody has answered; `revise` is a person changing their mind, and it says so
  by un-approving.

### Ruling 11 — revising an ASSUMPTION promotes it to an answered question

This is what stops `assumptions` from becoming a place to hide decisions.

`revise <assumption-id> <text>` appends to the spec's `open_questions`:

```yaml
  - id: memory-scope
    question: Should the recent-games list follow a person to another device?
    required: true
    answer: "No — one browser is fine."
```

`question` is the assumption's own `instead_of_asking`, verbatim. The answer is
the PM's. And the same unconditional un-approve applies.

**The append has TWO anchor-less cases, both predictable from `render()` and
neither named in the first draft of this ruling** (verified by driving
`spec.render` directly):

1. **`open_questions: []`** — what the engine emits when a draft asked nothing
   (flow style, one line). There is no sibling entry, so `_sibling_indent` has
   nothing to measure, and the edit is not an append at all: the `[]` must be
   replaced by a block sequence. Byte-equality still holds, because a person
   adding their first question by hand would delete the `[]` too. The indent is
   `render()`'s own — two spaces, then `- id:`.
2. **the key absent entirely** — possible in a hand-written spec, since
   `open_questions` is not in `spec.schema.json`'s `required` list. `revise`
   **refuses** here rather than inventing the key: `approve`'s own precedent is
   *"this surface edits what is there; it does not invent structure"*
   (`interview.py:474-477`).

A drafted spec always has the key, so case 1 is the one a PM actually meets.

It lands in `open_questions` and nowhere else because that is **the channel
`wring plan` already reads into the briefs**. An override recorded only in the
sidecar would be a PM correcting a decision that the builder never hears —
strictly worse than the hole it was meant to fix.

Three refusals on this path:

- the assumption id already exists as an `open_questions` id → refused
  (ruling 7 makes this unreachable for a drafted spec; a hand-written sidecar
  can still do it);
- the promotion would take `open_questions` over `MAX_OPEN_QUESTIONS` (20) →
  refused, naming the limit;
- the sidecar has no such assumption id → refused, naming the ids it does have,
  as `answer` already does for questions (`interview.py:130-134`).

**Fallback, named now rather than discovered mid-build:** if the append cannot
be done as a line edit that stays byte-equal to a hand edit, the question path
(ruling 10) ships and **the assumption path ships as OWED** with this design
attached. It does not ship as a YAML round-trip; B5 is not negotiable for a
file that is the artifact of record.

### Ruling 12 — the hand-edit hole is named, and the fix costs a SPEC_BOARD amendment

Today a hand-edited answer leaves `approved: true` standing. No board verb can
see that, and no frozen shape can carry an approval fingerprint —
`spec.schema.json` is `additionalProperties: false`.

> ### ⛔ RULED OUT OF THIS WINDOW — the fingerprint ships as OWED
>
> This ruling shipped with its own escape hatch: *"it is BUILT only if the spec
> review finds it as small as it looks; otherwise it ships as an OWED ruling
> with the design attached."* **The review found it is not.** Two independent
> HIGH findings, C3 and C4, and neither is a wording problem:
>
> - **C3 — it must exist twice.** `wringer-board` does not depend on
>   `wringer`; the engine is `importorskip`-optional in its tests and cloned
>   separately in its CI, because the board is a separate layer consuming
>   bundles and the CLI as its API. So the fingerprint would have two
>   implementations in two packages with no shared code and no dependency
>   edge, over a "canonical serialisation" this spec never defined. **Any
>   normalisation difference makes `wring plan` accuse an honest PM of editing
>   their spec after approving it** — a refusal that renders and never
>   resolves, whose only escape is deleting the sidecar.
> - **C4 — nothing can refresh a stale one.** The check dead-ends the exact
>   hand-edit remedy that both the engine and the board print to the PM, and
>   it is silently off for the flow SPEC_INTENT blesses.
>
> Fixing C3 means either making the engine a hard dependency of the board or
> adding a core entry point that prints the fingerprint — an architectural
> change to the layer boundary, which is not this window's to make. **So the
> hand-edit hole stays open and named, and the design below is the record of
> what would close it.** The reviewers' own conditions are attached: name the
> canonical form byte-exactly (a version tag, `id\x1fvalue\x1e` pairs sorted
> by id, questions then assumptions, UTF-8), make ONE implementation the
> source, and guard it with a cross-package test computing it through both
> entry points on a `spec.render()` fixture carrying a multi-line answer and a
> unicode answer, watched red by mutating one side.
>
> **Two consequences, both good.** The SPEC_BOARD §8 non-goal 9 amendment is
> no longer needed — nothing in this window writes the sidecar from the board,
> so the three-teeth invariant at `test_interview.py:229-283` stands
> **untouched**. And §6 DONE drops the fingerprint rather than claiming it.

**The design, for the window that builds it.** `wringer-board approve` records,
into the sidecar's `consent` block, a fingerprint over the canonical
serialisation of every question id with its answer and every assumption id with
its decision. `wring plan` recomputes it and refuses when it differs, saying
that the spec was edited after it was approved. `approve` must also be the
REFRESH path (C4): when the fingerprint is stale it re-renders the plan and
rewrites `consent` rather than raising already-approved, because re-approving
after reading the plan *is* the consent act — and the mismatch refusal must
name that command as its remedy.

```yaml
consent:
  fingerprint: sha256:0f3c...
  approved_at: 2026-08-19T14:02:11Z
  questions: 3
  assumptions: 2
```

**Absence is not evidence of tampering.** No sidecar, or no `consent` block →
no check, silently. A repository whose spec was written and approved by hand
never claimed a fingerprint, and refusing it would be inventing a claim.

**⚠ This contradicts an existing pinned invariant, and that invariant has THREE
teeth, not one.** SPEC_BOARD §8 non-goal 9 — *"the surface writes
`wringer.spec.yaml` and nothing else"* — is pinned by
`test_no_verb_writes_anything_but_the_spec_file`
(`test_interview.py:229-283`), which enforces it three separate ways. A consent
write breaks two of them, and a builder told this was a one-line filename edit
would hit two red tests unannounced:

| # | tooth | where | consent write |
|---|---|---|---|
| 1 | the repo's directory listing is unchanged after `answer` + `approve` | `:234-236` | **breaks** — the `repo` fixture (`:59-63`) creates only `wringer.spec.yaml` and `wringer.gates.yaml`, so a new sidecar adds a name |
| 2 | AST: no judgements path in any executable string | `:243-264` | **unaffected, and must stay so** |
| 3 | AST: every `write_text`/`write_bytes` receiver has the exact source segment `path` | `:266-283` | **breaks** — a sidecar write targets a different name |

The amendment, all three parts:

- (1) becomes *"the listing changes by at most `{wringer.decisions.yaml}`"*;
- (2) is untouched;
- (3) becomes *"every write targets one of exactly two named path builders"*.

**And because loosening (3) weakens the inference that `.wringer/` and
`.wringer.yaml` are never written, the compensating tightening is not a nicety
— it is what keeps the invariant's teeth.** The test must now name
`wringer.judgements.yaml`, anything under `.wringer/`, and `.wringer.yaml`
explicitly, the way (2) already names judgements, rather than inferring them
from a one-file rule. A surface that could answer a `human` criterion is still
the thing this programme exists to answer, and a consent record is not one.

**Judgement, after the review: NOT NEEDED IN THIS WINDOW, and the table above
is now a record rather than a plan.** With the fingerprint OWED, no board verb
writes the sidecar, so all three teeth stand untouched and
`test_interview.py:229-283` needs no amendment at all. The analysis is kept
because the window that builds the fingerprint will need it — and because it is
the reason that window is not this one.

If the review finds the fingerprint bigger than it looks here, it **ships as an
OWED ruling with this design attached**, and the plan does not claim "no
exceptions" until it lands.

### Ruling 13 — `--redraft`, and the remedy that stops pointing at the answer-eating path

`wring spec --send --redraft` (a **flag** on `cmd_spec`, precedent `--witness`
— a flag is not a command) is the supported way to draft again over an existing
spec.

- **Every previously answered question is preserved.** Matching ids in the new
  draft get their answer restored. An answered question whose id is **absent**
  from the new draft is appended to the new spec's `open_questions` with its
  answer intact and a note saying it came from the previous draft. **No answer
  is ever discarded**, which is the ruling; what a re-draft may *overwrite* is
  everything else.
- **The previous documents are kept.** `wringer.spec.yaml`,
  `wringer.decisions.yaml` and `wringer.gates.yaml` are copied into the
  drafting bundle (`.wringer/specs/<id>/`) before anything is overwritten, so
  nothing a person had is unrecoverable.
- **No interaction with the cap.** Carried-over questions are already answered;
  ruling 3 counts *required* questions in the reply, before this merge. The
  merge can still trip `MAX_OPEN_QUESTIONS`, which refuses with its existing
  message.
- **`approved` needs no special handling**: `parse_response` writes
  `approved: false` unconditionally (`spec.py:894`), and a fresh draft is
  exactly the case where that is right.
- **Without `--redraft`, the existing refusal stands**, with its remedy
  reworded. Today it says *"Move or delete it if you want a fresh draft"* —
  which is, verbatim, the answer-eating path recommended to the reader. It now
  points at `--redraft` and says what that preserves.

### Ruling 14 — AGENTS.md documents the flow, and the revision stays the human's

The drive's runbook gains the revision flow under its existing three laws:
relay the plan verbatim, including the assumptions block; **the agent never
volunteers a revision and never decides one.** A PM says "change my answer to
X" and the agent runs the verb. Law 2 already forbids an agent answering a
`confirm`; this is the same act, and an agent that revises on the person's
behalf is that defect wearing a different coat.

**DRIVE gains no new step kind.** Asks are asks.

---

## §4 — Slice plan

Whole slices only, in this order. Each names its guard and its capture.

| # | slice | lands in | guard watched red by |
|---|---|---|---|
| 1 | this spec + one-agent review, findings folded | core | — |
| 2 | P1: `assumptions` sidecar, parse cap, misfiling note | core | fixture with 4 required questions; run-1 capture |
| 3 | P2: `outcome` extraction, plan layering, ending block | core + board | plan render capture; dangling-task refusal |
| 4 | P3: `revise` verb + un-approve; core `--redraft` rider | board + core | mutation on the flip; `--redraft` answer-preservation |
| 5 | polish: live board, cost line, harness honesty, runbook test | drive + board | AGENTS.md conformance test in CI |

**Slice 4 touches two repositories, and its label says so** (carrier finding 6):
the board gains the verb, and the core gains the `--redraft` flag and the
reworded refusal. A slice labelled "board-side" that edits `cli.py` is a slice
disclaiming the repo it touches.

**Slices 1–2 alone are a successful window.** If context runs short, land whole
slices and name the seam.

### The guard evidence

The variance harness from §0 is the guard evidence for slice 2: a fixture reply
with four required questions is refused at parse; a fixture reply with
`assumptions` lands them in the sidecar and renders the block; **mutation
proves each detector can fail** — restored from file copies, never
`git checkout`.

---

## §5 — Non-goals (binding)

1. **No 20th core command.** New verbs, if any, belong to the board's own CLI.
2. **Nothing frozen moves a byte.** `wringer.spec.v1`, `spec.schema.json`,
   `_TASK_KEYS`, `_QUESTION_KEYS`, `judge-request.schema.json`. The new sidecar
   freezes on publication like every sibling.
3. **Nothing writes `wringer.judgements.yaml`.** Still true after ruling 12's
   amendment, and now pinned by name.
4. **Refusals render, never resolve.** The ending block (ruling 9) *predicts* a
   refusal; it does not soften, suppress or pre-empt one.
5. **The parser never invents a decision** (ruling 3(iv)).
6. **The board paraphrases no engine fact.** Ruling 9 reuses the engine-side
   saying verbatim rather than writing a second one.
7. **No shell-worker empty-turn parity.** Not buildable on facts: a shell
   worker has no Turn ledger, and exit-0-plus-unchanged-tree is `no_progress`'s
   own definition, so any "never engaged" claim for shell would be a guess.
   F6's law forbids it. Said in a comment where a maintainer would look.
8. **No release.** The bump and changelog are staged unpushed; the HOLD at
   0.3.0 is Marc's to lift.

---

## §6 — DONE

- SPEC_PMPLAN_V0 authored, one-agent reviewed, findings folded.
- A reply with more than three required questions is refused AT PARSE, watched
  red on a fixture, with the two archived captures byte-intact.
- Assumptions land in a frozen-on-publication sidecar and render as their own
  block on the plan; approving the plan approves them.
- A decision buried in `guidance` is **sometimes noticed** — the detector is a
  measured-phrasing heuristic watched against all four captured replies,
  including run 2 as the negative control, and its silence proves nothing.
  (It is not claimed that buried decisions are caught. They are not.)
- The plan leads with outcomes, labels objectives beneath, and says at approval
  which criteria **can** hold the handover — counting bound, human and unbound
  as three separate classes, and saying that the unbound ones cannot hold it
  and will simply go unproved. Verified against `accept.py`'s `refuses`, not
  against the carrier's description of it, which was inverted.
- Every board-verb revision flips `approved: false`, watched red.
- **The hand-edit fingerprint does NOT land. It ships OWED** (ruling 12, after
  review C3/C4), so: the hand-edit hole stays open, `wringer.decisions.yaml`'s
  frozen schema declares a `consent` block **nothing writes**, and SPEC_BOARD
  §8 non-goal 9 is left untouched. DONE means those three sentences are true
  and said, not that a fingerprint exists.
- `--redraft` preserves every answer, and the old refusal's remedy stops
  pointing at the answer-eating path.
- Live board at phase boundaries; cost line, facts only; the harness says when
  a reply had no files; the AGENTS.md conformance test is green in CI.
- All three repos: suites green, ruff clean, pushed, CI green.

---

## §7 — Open questions, for a Fable cycle and not for this window

1. **The sidecar's name.** `wringer.decisions.yaml` covers assumptions and
   consent well and outcomes poorly (ruling 2). Freezing is permanent.
2. **Does an assumption need a `criterion` back-reference?** Run 1's decision
   was *about* `survives-tab-close`. Rendering which criteria an assumption
   touches would be more useful and is more shape to freeze.
3. **Should the cap be 3 for `required` questions and unbounded for optional
   ones?** As ruled, an optional question is uncapped below
   `MAX_OPEN_QUESTIONS`. A drafter could route around the cap by marking
   questions optional — measured behaviour says it does not, but the cap is a
   guard precisely because prompts are not.
4. **What does `revise` do after work has already started?** As ruled it
   un-approves, and a fleet mid-run does not read the spec again. The honest
   answer may be that revision after handover is a different act with a
   different name.
5. **The engine has no saying for "an unbound criterion cannot hold the
   handover".** `refusals.py` maps refusals that HAPPENED; this is a statement
   about one that will not. Ruling 9 needs it and board ruling 1 forbids the
   board from writing it. Either the engine gains the sentence (a new saying,
   engine-side, which the board then renders) or the plan cannot say it and
   the PM is left to infer the most consequential fact on the page. The spec
   builds the counts now and holds this sentence until the saying exists.
6. **Should ruling 4's detector exist at all?** It has been got wrong twice,
   it has no true-negative case in this corpus, and its output is a lower
   bound that no reader can turn into a total. The case FOR keeping it: the
   operator sees *something* rather than nothing, and every phrasing it learns
   is one the next drafter cannot hide behind. The case AGAINST: a note that
   fires on 10 of 14 and is silent on a whole run trains its reader to believe
   silence, which is the exact failure this programme names — and unlike a
   gate, nothing here can ever be shown to have caught everything. A ruling
   either way is Fable's; the spec builds it as a lower bound in the meantime
   because the alternative is that the misfiling stays completely invisible.

---

## §8 — What this spec does not license

It does not license a `--yes`, in any repository, under any name. It does not
license the board answering a `human` criterion, writing a judgement, or
touching a gate. It does not license the parser inventing an assumption, a
question, or an answer. It does not license moving a frozen byte. It does not
license a second sentence for a fact the engine already has words for. And it
does not license a release.
