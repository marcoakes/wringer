# SPEC — the hunt: which parts of a change the evidence would notice (v0)

*Drafted 2026-08-23 by the implementing window, from rulings Fable decided in
`WRINGER_HUNT_RUN_PROMPT_2026-08-22.md` §2. **The rulings are DECIDED; this
document makes them precise, names the schema, and finds what they break.**
Grounded at `main` `ea5ace1`.*

### REVIEW ROUND 1 — verdict NOT SOUND, and the mechanism changed because of it

*The first draft built each tree as a detached worktree at the base with "every
hunk except this unit's" applied. **That does not work**, and the review found
it by executing rather than by reading. Reproduced independently before folding
(`docs/hunt-mechanism-2026-08-23.md`):*

```
error: cannot apply binary patch to 'src/blob.bin' without full index line
error: src/blob.bin: patch does not apply
```

*`git.diff` omits `--binary` on purpose (`git.py:176-179` — "An evidence file
should not be able to grow a megabyte of image"), and `git apply` is
all-or-nothing. **One binary file anywhere in a candidate meant no tree could
be built at all**, so the first draft's own baseline lap would have declared
`inconclusive` on every such repository, for ever.*

*The same probe showed three change kinds — binary, rename, mode-only — produce
**no `@@` header at all**, so the first draft's units-of-nothing were invisible
to a denominator whose count line says "N of M parts of this change". §1 and §2
are rewritten. Twenty-eight findings folded; the ones that changed a ruling are
marked ⚑ where they land.*

---

## Positioning — what this is, and what it is not

Wringer proves a criterion went **red → green**. That is a claim about the
CHECK. It says nothing about the CHANGE: a delivery candidate can carry twenty
units, one of which the acceptance gate exercises and nineteen of which nothing
in the evidence set would notice if they vanished.

The hunt measures that. For each unit, build the candidate **without that
unit**, run the evidence set, record whether anything went red.

**The differentiator, and the only claim any page may make.** What is not
demonstrated elsewhere *in this programme* is the SCOPE: per delivery
candidate, bound to that delivery's own evidence set, sealed into the
tamper-evident bundle beside the proof it qualifies. ⚑ *The first draft said
"not available anywhere else", which is an unfalsifiable market claim in a
repository whose charter is that support is MEASURED, never recalled. No page
may say "mutation testing", claim novelty for the technique, or imply the
sweep is exhaustive.*

**This completes the vacuity family; it does not duplicate it.**

| question | mechanism | verdict lives in |
|---|---|---|
| can the gates fail at all? | `--prove`, pre-change tree | `vacuity.json` |
| is this criterion evidenced? | acceptance, receipt chain | `acceptance.json` |
| **which parts of the change does the evidence notice?** | **`--hunt`, candidate-minus-one-unit** | **`hunt.json`** |

### The witness programme's stop list, cited rather than skirted

`docs/witness-programme.md:147`: *"mutation testing as a merge gate is dead."*

**Note-tier is lawful under that line and this spec claims nothing more.** The
sentence forbids a MERGE GATE. §6 rules the hunt note-tier: `wring deliver`
does not refuse on an unnoticed unit, and no exit code moves because of one.

**Binding on any future window:** an escalation from note to refusal amends
`docs/witness-programme.md` **by dated note FIRST**, and is Fable's on field
evidence. A window that builds the refusal and then updates the programme
document has done it in the wrong order.

---

## §1 — What a UNIT is

The basis is the delivery candidate against the tree verify recorded.

⚑ **Correction the review forced.** The first draft said the diff is taken
"against `state.head_sha`". It is not. `git.py:180` reads
`against = ["HEAD"] if head_sha else []` — the sha is a **presence flag** and
the command is `git diff HEAD`. The distinction is invisible until a worker
commits mid-loop, and `loop.py` never commits but the coding agent it drives
is arbitrary and may. §5's fingerprint is what catches that; the spec no
longer claims a base it does not use.

### Ruling 1 — three unit kinds, and the third exists so the denominator is honest

- **A tracked hunk unit** — one contiguous `@@` block of
  `git.diff(root, state.head_sha)`, with its file header.
- **An untracked file unit** — one whole file from the candidate's untracked
  set, ⚑ **filtered through `evidence.untracked_subject`
  (`evidence.py:215-229`)**. The first draft named the raw `state.untracked`,
  which includes `.wringer/` — that module exists precisely because *"hashing
  it would mean every run digesting every previous run's bundle… describing
  this tool's output rather than the user's change."* Unfiltered, the sweep
  would have enumerated prior run bundles as units of the change.
- ⚑ **A whole-file unit with no hunk** — a binary change, a pure rename, a
  mode-only change. **Measured: these produce zero `@@` headers**, so the
  first draft could not represent them at all. They are units, they count in
  the denominator, and their state is always `unsweepable` with the kind
  named. A change that is entirely a renamed icon must not report "0 of 0".

A unit is never split further (§8).

⚑ **The denominator is a function of `diff.context`, and the record says so.**
Two edits six lines apart collapse into one hunk; a repository that raises
`diff.context` shrinks M in "N of M parts". `git.diff` passes no `-U`
(`git.py:181-185`). `hunt.json` records the context git actually used, so a
reader comparing two sweeps is never comparing different rulers.

### Ruling 2 — ONE copy of the candidate, reverse-applied per unit

⚑ *Rewritten wholesale. The measured mechanism:*

1. **Copy the candidate working tree once**, excluding `.wringer/`.
2. **Baseline lap** (§5) on the untouched copy.
3. Per unit: **reverse-apply** that unit alone (`git apply -R` of its file
   header plus its single `@@` block), run the evidence set, then
   **forward-apply to restore**, then **verify the restoration**.

Measured on an adversarial candidate — two distant hunks in one file, a
deletion, a rename, a mode change, a binary file, an untracked file: every
text hunk reversed and restored, and the copy finished **byte-identical** to
the candidate.

**Why a copy and not a worktree, which is the deeper change.** A worktree
carries tracked files and nothing else — no `.venv`, no `node_modules` — which
is the entire reason `vacuity.py:22-43` needs `run.prove_setup`. A copy of the
candidate carries the environment with it. ⚑ **So `run.prove_setup` is not
used by the hunt at all**, and the review's H8 dies with it: the first draft
ran a 900-second setup *per unit* against a 900-second sweep budget, which no
repository with a real `prove_setup` could ever have completed.

**One copy, N laps** — not N copies. Restoration between laps is what makes
that safe, and §5 is what makes restoration checkable.

**The operator's tree is never touched.** Not reverted, not stashed, not
checked out. ⚑ The copy lives under the scratch root `vacuity` already uses
and is **named for the RUN**, because `vacuity.py:202-207` records what
happens otherwise: a fleet whose children share a root has every child
sweeping into the same path, *"and the collision would be silent."*

---

## §2 — The EVIDENCE SET

### Ruling 3 — the gates that ran and can decide, and that is the whole rule

⚑ *The first draft said two incompatible things two paragraphs apart — that
`proves:`-bound gates join the set, and that scoped-out gates do not. A
`proves:`-bound gate CAN be scoped out (`--gate`, fleet scope), so two
implementers would have built different products.*

The evidence set is exactly: **the gates that ran in this verify** — `planned`
in `verify.run` — **minus optional gates**.

- Scoped-out, skipped and `flaky` gates are **not** in the set. A gate that
  did not run on the operator's tree cannot be asked whether it notices
  something, and asking it would redden the baseline lap on a healthy run.
- ⚑ **Optional gates are excluded by ruling**, following
  `vacuity.py:241-245`: *"Proving an OPTIONAL gate is out of scope by ruling:
  it does not decide the outcome."* A unit certified `evidenced` by a gate
  that cannot fail the run is not evidenced in any sense a reader cares about.
- A `proves:`-bound gate that was scoped out is **recorded as absent**, with
  its criterion id, so a reader sees that the sweep could not ask the question
  that mattered most rather than inferring a clean answer.

It is **not the whole suite**, and that choice is recorded so the ruling after
field use has something to overturn. Widening is a spec-level change, never a
knob somebody adds.

`hunt.json` records the gate ids the sweep ran, so nothing is inferred.

---

## §3 — The unit states, never guessed

### Ruling 4 — EVIDENCED, UNNOTICED, UNSWEEPABLE

| state | means |
|---|---|
| `evidenced` | at least one check in the evidence set went RED without this unit |
| `unnoticed` | every check stayed GREEN without this unit |
| `unsweepable` | the candidate-minus-this-unit tree could not be built |

`unsweepable` is an **honest state, not an error**, and it now has two
distinct causes, both recorded: the unit has no hunk to reverse (binary,
rename, mode), or the reverse-apply failed (entangled hunks). The row carries
git's own message.

Every unit records which check reddened it, so a reader can tell a unit
evidenced by an acceptance gate from one evidenced by a linter.

### Ruling 5 — PARTIAL is said out loud

A sweep that hits its unit cap or wall-clock budget records
`"completeness": "partial"` and the number of units it never reached. Silent
truncation is the defect class this repository refuses; a partial sweep that
reads as complete is worse than none.

---

## §4 — What the sweep refuses to conclude

### Ruling 6 — the hunt runs only on a verify that PASSED

⚑ *Missing from the first draft.* `verify.py:352-358` gates `--prove` the same
way — a failed run gets `not_applicable`, *"there is nothing to prove about a
failure"*. On a red run the baseline lap is red by construction, and the
first draft would have reported `inconclusive` with a reason that misdescribed
the cause. `not_applicable`, with the failing gate named.

### Ruling 7 — THE BASELINE LAP, and it is not optional

**Before any unit is reversed, the evidence set runs on the untouched copy.**
That tree is byte-equivalent to the tree verify just ran green, so the
evidence set must be green there too.

If it is not, the copy is not faithful and **nothing can be concluded from any
unit**. The sweep records `inconclusive` and the baseline's own failing output
is kept, exactly as vacuity's `sensitive` rows cite the failure they rest on.

**This is the mechanism `--prove` does not have.** Vacuity compares two trees
and can be fooled by one being broken. The hunt has a tree it knows the answer
for, so it checks its instrument before taking a measurement. It is also what
keeps the **inverted** environment trap closed: a broken copy turns every
check red, every unit reads `evidenced`, and the sweep would report total
coverage of the whole change — the analogue of the false proved-red that
Phase 4 ruled worse than an uncovered criterion.

### Ruling 8 — restoration is verified, and a failure stops the sweep

After each unit's forward-apply, the sweep confirms the copy matches the
candidate again. If it does not, every later lap would measure a tree nobody
described. The sweep stops, keeps the results it already has, and records
`partial` with the reason. It does not continue and it does not discard.

### Ruling 9 — the container refusal, and where the shared predicate goes

Where `execution.backend` is `container`, the sweep returns `inconclusive`.

⚑ *The first draft said the reason is "inherited verbatim" from
`vacuity.py:162-187`. There is nothing there to inherit — it is an inline `if`
returning a hardcoded string inside `prove()`, so an implementer could only
copy the string, which the same sentence forbade.* This spec licenses **one
shared predicate and reason string, extracted into `vacuity` and called by
both**. That is a change to `vacuity.py`, it is named here, and it is the only
one this spec licenses.

### Ruling 10 — hygiene: fingerprint before and after

The sweep fingerprints the candidate before it starts and before it writes:
`git diff HEAD`'s sha256 and the sorted **subject** untracked list. If they
differ, the results describe a tree that no longer exists and the record says
`inconclusive`.

⚑ **Through `evidence.untracked_subject`, or the check fires on the sweep's
own writes.** `evidence.py:218-222`: a repo that never ran `wring init` has no
gitignore for `.wringer`, *"so it shows up untracked"* — and the bundle is
created after the snapshot. Fingerprinting the raw list would have declared
`inconclusive` on every run in that population, blaming an operator who did
nothing.

**A copy whose checks cannot be trusted reports `inconclusive` or `partial`.
It never reports `evidenced`.**

---

## §5 — Where it lives, and what it may do

### Ruling 11 — a flag on `wring verify`. Never a twentieth command

`wring verify --hunt`. **There are nineteen commands and a twentieth is
forbidden**; the ceiling is stated at `AGENTS.md:177-183`. ⚑ *The first draft
cited "law 7" for it — law 7 is the frozen-schema law (`schema/frozen.json`,
`verify.py:753`, `checks.py:27`). The command ceiling is unnumbered.*

Opt-in in v0; delivery-candidate time is its moment.

### Ruling 12 — the config keys, and the ruling they must answer to

| key | default | what it does |
|---|---|---|
| `run.hunt` | `false` | sweep every iteration |
| `run.hunt_max_units` | `40` | cap; hitting it makes the sweep `partial` |
| `run.hunt_budget_seconds` | `900` | wall clock; hitting it makes it `partial` |

⚑ **`--hunt-max N` is REMOVED.** `cli.py:219-225` states the
flags-may-tighten-never-loosen rule and `cli.py:284-288` states why there is
no `--no-prove`: *"the audited party does not get to choose whether the audit
runs"* — and the invoker *"is increasingly the agent itself."* An "override"
flag is bidirectional and hands the audited party the dial. `--hunt` follows
`wants_prove`'s `declared or flag` shape exactly.

⚑ **`config.py:166-172` carries a standing in-code ruling that there is
deliberately NO ceiling key under `run:`** — *"skipping re-introduces the
vacuity the feature exists to catch, refusing is a worse-timed block, warning
does nothing."* This spec engages it rather than walking past it, because the
first draft did walk past it.

**Why a ceiling is right here and wrong for `prove`.** That ruling is about a
check whose *skipping re-introduces the vacuity it exists to catch* — a
partial `--prove` is a false negative wearing a green tick. A partial hunt is
different in kind: it reports `partial`, names the count it did not reach, and
**every unit it did reach keeps its measured state**. There is no flattering
answer to fall back to. The cost profile also differs by an order: `--prove`
is one extra tree, the hunt is one tree and N gate laps.

**If a reviewer or Fable disagrees, the keys go and the sweep runs uncapped or
not at all — this is the one ruling in this document most likely to be
overturned, and it is flagged rather than buried.**

`run.hunt` exists because a brief is built per iteration and can only quote a
record that exists by then. Absence of every key is today's behaviour byte for
byte. ⚑ The budget nests under `run.wall_clock` — `fleet.py:823`, *"Invariant
8: budgets nest"* — and never extends it.

### Ruling 13 — NOTE-TIER, and the escalation is named not improvised

`wring deliver` does not refuse. No exit code moves. The board renders and
decides nothing. The module names the escalation path in a comment and a
window may not take it: it is Fable's, on field evidence, and it amends the
witness programme by dated note first.

---

## §6 — The record, and who reads it

### Ruling 14 — a new sibling file, written THROUGH the Bundle

`hunt.json`, `wringer.hunt.v1`, `schema/hunt.schema.json`, listed in
`schema/frozen.json` on publication. Adding a new schema file is lawful;
`frozen.json`'s own `_comment` says so. **No frozen schema moves.**

Written inside `verify.run` before `bundle.write_digests()` — which is genuinely
last — so the record is digest-covered and `audit`/`attest` compose with no
new clause.

⚑ **Through the `Bundle`, with the redactor, and that is not a detail.**
`AGENTS.md:545-548`: *"If you add a file to the bundle, add it through the
`Bundle`, or you have quietly opted out of the one guarantee SECURITY.md
makes."* `vacuity.py:152-157` records this repository having already shipped
that defect — *"the pre-change half of a `--prove` run was the one set of
bundle files written with no scrubbing at all."* The first draft repeated it
verbatim by quoting failing gate output into JSON with no redactor named. The
whole payload is scrubbed, on `accept.write`'s pattern
(`accept.py:1184-1191`).

⚑ **`hunt.json` and the log directory join `Bundle._clear_previous`'s list**
(`evidence.py:404`, `436-455`). They are written conditionally, and that
module's own docstring records the survivor bug: a reused directory *"kept the
first run's verdict beside a bundle that never made it."*

⚑ **A log directory, because otherwise the Positioning promise is false.** The
first draft's payload was a state and a check name per unit, while claiming *"a
reader of the bundle can check the sweep."* There was nothing to check.
`vacuity.py:63-65` writes a whole `vacuity/` directory for exactly this
reason. `hunt/` carries the baseline lap's output and each reddening check's
output.

⚑ **Which bytes are "the candidate patch" is now stated:** re-computed by
`git.diff`, never read from `diff.patch` in the bundle. `evidence.py:624-634`
scrubs and truncates that file at `gates.MAX_LOG_BYTES` (1 MiB), so a large
candidate is unappliable and a candidate containing a token-shaped string
would have `***` applied into its source.

⚑ **Untracked bytes are read from the operator's tree**, the only place they
exist — `write_untracked` records `mode:sha256`, not contents, and
`diff_untracked` renders *"Binary files differ"* for a binary one. Reads
follow `hash_untracked`'s documented hazards (`evidence.py:241-255`: symlinks,
dangling links, a FIFO that *"blocked forever"*).

### Ruling 15 — the board renders structurally, in the engine's words

- A count line: *"N of M parts of this change are evidenced."*
- Unnoticed units as `file:line` rows behind the existing summary machinery.
- Sentences from the record verbatim. **No prose explaining the number** — the
  cold reads measured that explanation makes a page worse (68 → 82).
- Board ruling 1 and the transport rule byte-intact.

⚑ *The first draft said "the disclosure shape F14 already ruled". F14 is
listed under **Owed** in `docs/field-response-2026-08-22.md:302-305`; there is
no ruled shape to conform to. The existing summary disclosure is the
precedent.*

### Ruling 16 — the brief hook is hint-tier

Unnoticed rows contribute as **hint-tier** content, the tier the brief's gate
logs already occupy, in the engine's words.

**Pre-decided fork, binding:** if this needs a `loop-manifest` reason, a change
to any frozen enum, or new loop routing — **STOP, record it OWED, ship the
sweep without it.**

---

## §7 — Non-goals (binding)

1. No sub-hunk splitting. Entangled hunks report `unsweepable`.
2. No whole-suite sweep. §2 states the route to change it.
3. No refusal, no exit-code change, no merge gate.
4. No new command. Nineteen.
5. No claim of exhaustiveness, and no coverage metric.
6. No auto-classification of a red. §4 is why the baseline lap exists rather
   than a classifier.
7. ⚑ No parallel unit laps in v0. One copy is the safety property; N copies is
   a different cost model and a different spec.

---

## §8 — What this spec does not license

Deciding that unnoticed units should block; a twentieth command; widening the
evidence set; moving a frozen schema; parallelising the laps; or any sentence
claiming the sweep proves a change is covered. Each is a ruling, and rulings
are Fable's.
