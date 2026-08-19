# SPEC — the PM consent surface (v0)

*Assumptions get a channel, the plan gets two registers, the PM gets a way
back.*

Carrier: `~/Claude/WRINGER_PM_PLAN_2026-08-19.md` (Fable, 2026-08-19, reviewed
the same evening — SOUND WITH FINDINGS, seven findings folded, four
substantive ones marked ⚑ in the carrier and carried into the rulings here).

This spec covers three things that look separate and are one: **what a product
manager approves, and how they change their mind.** It is written before any
code, and it is reviewed before any code.

> **Status, 2026-08-19 — THE INDEPENDENT REVIEW IS OWED.** This document is
> authored and self-corrected; it has **not** yet been through an independent
> review. Three HIGH defects in the first draft were found by EXECUTION against
> the measurement run's real artifacts — not by re-reading it — and are folded
> in below: ruling 4's detector found 4 of 10 real cases, ruling 9 miscounted
> `human` criteria against what a real run was actually held by, and ruling
> 12's amendment turned out to have three teeth rather than one. **No code may
> be written against this spec until the review has landed and its findings are
> folded** (slice 1 is not done). The pattern those three share is this
> programme's own recurring one: reading the spec found nothing, running its
> evidence found all three.
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
on iteration 2 — and the ending was `stopped:acceptance_unevidenced`, because
the other criteria have nothing checking them. Honest, correct, rendered in the
board's own words. But **the best possible outcome of today's pipeline is a
"held" the PM has to decode**, and nothing set that expectation at the moment
they approved.

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
carrying only one of the three is valid. (A consent-only sidecar is the normal
case for a repository whose spec was written by hand — §3, ruling 10.)

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

  The handover is being held because at least one requirement cannot show its
  proof. That is this tool working, not failing: it will not hand over work
  it cannot prove.
```

**Three classes, not two, and a real run is why.** The full drive of §0.4 ended
`stopped:acceptance_unevidenced`, and the criterion that held it was
`heading-reads-as-yours — HUMAN` — *"nobody has answered this — a person
decides it"* (`verify-drive2/console.txt:150-158`). A `human: true` criterion
is **unbound by design**: nothing ever will check it. Folding it into "nothing
checking them yet" would be false, and would contradict the board's own correct
sentence eight lines above it on the same page — *"A PERSON decides this. No
check can, and none will be written for it"* (`interview.py:329-332`). Two
surfaces describing one fact, inside one surface.

So the block counts **bound / yours to decide / nothing checks it yet**, and
its prediction covers **both** causes that can hold the handover — an unbound
criterion and an unanswered human one. The measured run was held by the second,
which the first draft of this ruling omitted entirely.

**The prediction sentence is not new.** It is the board's own
`(DELIVERY_REFUSAL, "acceptance_unevidenced")` saying, reused verbatim from
`refusals.py:451-455`, and confirmed byte-identical against the real run's
console. Two surfaces describing one fact drift apart; that is the failure this
product exists to catch, and it must not arrive by way of the plan. The counts
come from the same `_bindings()` read the criteria block already uses, plus the
`human` flag it already reads.

The block renders **only when at least one criterion is unbound or human** — a
plan where every criterion is bound must not carry a warning about an ending
that will not happen.

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
- **B5's byte-equality doctrine constrains both edits to line edits**, reusing
  `_fill_existing`/`_scalar` for the answer and `APPROVED_LINE` for the
  interlock. The result must be byte-identical to what a person would have
  typed.
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

**The fix:** `wringer-board approve` records, into the sidecar's `consent`
block, a fingerprint over the canonical serialisation of every question id with
its answer and every assumption id with its decision. `wring plan` recomputes
it and refuses when it differs, saying that the spec was edited after it was
approved and that the answers are no longer the ones approved. That is a core
**behaviour** on an existing command — lawful, and not a 20th command.

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

Judgement: still BUILD. The change is mechanical and the invariant ends up
stronger than it started. The escape hatch below stands if the review disagrees.

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
  which criteria will hold the handover — counting bound, human and unbound as
  three separate classes, because the measured run was held by a human one.
- Every board-verb revision flips `approved: false`, watched red. The hand-edit
  fingerprint lands, or ships as an OWED ruling with its design attached.
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
5. **Should ruling 4's detector exist at all?** It has been got wrong twice,
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
