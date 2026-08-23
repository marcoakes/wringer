# SPEC — the hunt: which parts of a change the evidence would notice (v0)

*Drafted 2026-08-23 by the implementing window, from rulings Fable decided in
`WRINGER_HUNT_RUN_PROMPT_2026-08-22.md` §2. **Revision 3**, folding H1–H6, the
ceiling amendment and the endorsements of
`~/Claude/WRINGER_HUNT_RULINGS_2026-08-23.md` (BINDING). Grounded at `main`
`b2485ce`.*

> ## STATUS — **BLOCKED. Reviewed THREE times, NOT SOUND three times. Four rulings are owed to Fable.**
>
> Every verdict was reached by EXECUTION, and each killed something:
>
> | round | mechanism | how it died |
> |---|---|---|
> | 1 | worktree at base + apply every hunk but this one | one binary file and **no tree can be built at all**; three change kinds emit no `@@` header |
> | 2 | copy the candidate, "a copy carries the environment" | an editable install's `.pth` is **absolute**, so the copy's interpreter imports the ORIGINAL source |
> | 3 | clone + overlay, per H1–H6 | **the mechanism holds; the LIFECYCLE BETWEEN LAPS does not** |
>
> **Round 3 is a different kind of failure from rounds 1 and 2, and that is the
> useful part.** Clone-plus-overlay is right, H4's file-level revert is right,
> Appendix A reproduced exactly under an independent rebuild, Appendix B's unit
> arithmetic verified, and the mechanism probe's 36 of 36 is real. What is not
> sound is everything that happens *between* laps — the one region neither the
> probe nor the appendices exercise.
>
> **The finding that stops it:** Ruling 11's rebuild-on-contamination restores
> the working copy from the pristine clone of §2 step 1, and the probe's own R1
> measured that **a clone carries no environment**. So every unit after the first
> contamination runs checks that import the OPERATOR's tree — round 2's exact
> killer, re-entering through a path this document names itself. H1's eligibility
> cannot catch it: eligibility is computed once, at step 4, before any rebuild can
> happen. The result is a page of `unnoticed` rows with intact `evidenced` counts
> and **no state that says anything is wrong** — a clean, confident, wrong page,
> which is the one outcome §5 exists to make impossible.
>
> It is not foldable by an edit. The two available fixes contradict a ruling
> each: re-running `prove_setup` per rebuild contradicts H1's "ONCE per sweep"
> and breaks H5's sum; making the pristine artifact a post-setup snapshot
> contradicts Ruling 11a's "never run in".
>
> **Owed to Fable, and nothing is built until they are ruled** — the four are
> stated in `~/Claude/HUNT_REVIEW_ROUND3_2026-08-23.md` and carried in this
> window's finish report:
>
> 1. the rebuild's environment (above);
> 2. **lap independence** — nothing in this document says a lap is independent of
>    the lap before it, and gitignored caches are deliberately spared by both
>    Ruling 7a and Ruling 11;
> 3. **the sum's missing terms** — clone, `prove_setup` and rebuilds are outside
>    it, and it compares against the whole budget rather than what remains, while
>    `SETUP_TIMEOUT_SECONDS` is 900 against a 900 s default;
> 4. **partially-staged (`MM`) files** — the overlay cannot reproduce them, so the
>    faithfulness precondition reports `inconclusive`; the direction is safe and
>    the case is unnamed.
>
> **What HAS been corrected in place** (factual, mechanism untouched): citation
> drift, a `flaky` mischaracterisation, H2's "structurally unreachable" claim
> which is measurably false, the capture's misattributed output, and §12's
> derivation table — which was itself incomplete, in the defect class the window
> exists to remove.
>
> **The BLOCKED header is lifted only by a passing review, in the same commit
> that starts the build.**

---

## Positioning — what this is, and what it is not

Wringer proves a criterion went **red → green**. That is a claim about the
CHECK. It says nothing about the CHANGE: a delivery candidate can carry twenty
units, one of which the acceptance gate exercises and nineteen of which nothing
in the evidence set would notice if they vanished.

The hunt measures that. For each unit, build the candidate **without that
unit**, run the checks, record whether anything went red.

**The question v0 answers, in the words it must be said in** (H5): *would the
CITED PROOF notice this part missing?* Not "is this part tested" and not "is
this change covered" — the cited proof, meaning the checks bound to criteria
that the board renders and the delivery cites. Those words go in the record, the
docs and the board line, and no page may widen them.

**The differentiator, and the only claim any page may make.** What is not
demonstrated elsewhere *in this programme* is the SCOPE: per delivery candidate,
bound to that delivery's own cited proof, sealed into the tamper-evident bundle
beside the proof it qualifies. No page may say "mutation testing", claim novelty
for the technique, or imply the sweep is exhaustive.

**This completes the vacuity family; it does not duplicate it.**

| question | mechanism | verdict lives in |
|---|---|---|
| can the gates fail at all? | `--prove`, pre-change tree | `vacuity.json` |
| is this criterion evidenced? | acceptance, receipt chain | `acceptance.json` |
| **would the cited proof notice this part missing?** | **`--hunt`, candidate-minus-one-unit** | **`hunt.json`** |

### The witness programme's stop list, cited rather than skirted

`docs/witness-programme.md:147`: *"mutation testing as a merge gate is dead."*

**Note-tier is lawful under that line and this spec claims nothing more.** The
sentence forbids a MERGE GATE. §8 rules the hunt note-tier: `wring deliver` does
not refuse on an unnoticed unit, and no exit code moves because of one.

**Binding on any future window:** an escalation from note to refusal amends
`docs/witness-programme.md` **by dated note FIRST**, and is Fable's on field
evidence. A window that builds the refusal and then updates the programme
document has done it in the wrong order.

---

## §1 — What a UNIT is

The basis is the delivery candidate against the tree verify recorded.

**The diff is `git diff HEAD`, not a diff against a recorded sha.** `git.py:180`
reads `against = ["HEAD"] if head_sha else []` — the sha is a **presence flag**.
The distinction is invisible until a worker commits mid-loop; `loop.py` never
commits, but the coding agent it drives is arbitrary and may. §7's fingerprint is
what catches that.

### Ruling 1 — three unit kinds, and the denominator counts all of them

- **A tracked hunk unit** — one contiguous `@@` block of
  `git.diff(root, state.head_sha)`, with its file header.
- **An untracked file unit** — one whole file from the candidate's untracked
  set, filtered through `evidence.untracked_subject` (`evidence.py:215-229`).
  The raw `state.untracked` includes `.wringer/`, and that module exists
  precisely because *"hashing it would mean every run digesting every previous
  run's bundle… describing this tool's output rather than the user's change."*
  Unfiltered, the sweep would enumerate prior run bundles as units of the change.
- **A no-hunk tracked unit** — a binary change, a pure rename, a mode-only
  change. **Measured: these produce zero `@@` headers**, so round 1's mechanism
  could not represent them at all.

⚑ **H4 upgrades the no-hunk kinds out of `unsweepable`.** Round 1 could only
count them because its per-unit procedure was `git apply`. §2's copy has its own
history, so a file-level revert from the copy's own HEAD is exact — measured on
all three kinds. They are **swept**, not merely counted.

A unit is never split further (§10).

**The denominator is a function of `diff.context`, and the record says so.** Two
edits six lines apart collapse into one hunk; a repository that raises
`diff.context` shrinks M. `git.diff` passes no `-U` (`git.py:181-185`).
`hunt.json` records the context git actually used, so a reader comparing two
sweeps is never comparing different rulers.

⚑ **Units are enumerated from the CANDIDATE and never re-derived in the copy.**
Measured: an overlay changes the copy's own `git diff HEAD` — under one
construction the untracked candidate files appear in it as added files, which
would double-count them. The unit list is computed once, on the operator's tree,
before the copy exists. (Derivation D4.)

---

## §2 — The COPY: a local clone plus overlay (H2)

### Ruling 2 — `git clone --local`, then an overlay that replays the index

1. **`git clone --local` the candidate repository** into the scratch root
   `vacuity` already uses, **named for the RUN** — `vacuity.py:202-207` records
   what happens otherwise: a fleet whose children share a root has every child
   sweeping into the same path, *"and the collision would be silent."*
2. **Overlay the candidate onto the clone**, by FILE COPY driven by
   `git diff HEAD --name-status -M` plus the untracked subject list. **No
   `git apply` anywhere** — that is what killed round 1 on the first binary file,
   and `git.diff` omits `--binary` by decision (`git.py:175-178`).
3. ⚑ **Replay the candidate's STAGED set** (`git diff --cached --name-status -M
   HEAD`) into the copy's index.

**Why the clone, and what it buys** (H2): the copy's gitdir is SELF-CONTAINED —
a real directory, not a `.git` file pointing into someone else's `worktrees/`.
**The worktree case dies here**: a clone from a worktree yields a real gitdir.
The repository's own git-using checks (`git show`, `git tag`, `git check-ignore`)
work, reading only the copy's own history.

⚑ **But "the operator's gitdir is structurally unreachable" is FALSE as H2
states it, and this spec must not repeat it.** Measured: `git clone --local`
leaves a live `origin` remote pointing at the candidate — **fetch and push** —
and `git ls-remote --heads origin` from the copy succeeds:

    origin  /tmp/f6check/cand (fetch)
    origin  /tmp/f6check/cand (push)
    f3343ddc…  refs/heads/main        <- ls-remote exit 0

So a check running `git push origin` or `git fetch` in the copy reaches the
operator's repository. The clone makes the operator's gitdir unreachable **by
path**, which is what kills the worktree case; it does not make it unreachable
**by remote**. Closing that gap is a build-time requirement — the sweep drops
the remote after cloning — and it is recorded here rather than assumed, because
§2c's "the operator's tree is never touched" is a safety claim and a safety
claim that is merely aspirational is the kind of sentence this repository
corrects by dated note.

⚑ **A clone also takes git's stock `.git/info/exclude`, not the operator's.** A
repository using local excludes therefore has a different untracked set in the
copy. That is caught rather than silent: Ruling 2a's faithfulness precondition
compares `git status --porcelain` and reports `inconclusive` when they differ.

**A candidate with no commits at all is `inconclusive`, honestly.**

### ⚑ Ruling 2a — why step 3 is not a detail, and the precondition it buys

Three overlays were measured against the candidate's own git view. Two are
unfaithful, **in opposite directions**:

| overlay | `git status --porcelain` | `git ls-files` (check SCOPE) |
|---|---|---|
| index left at HEAD | staged rename reads as `D` + `??` | **misses** the renamed-to path |
| `git add -A` | untracked files read as `A` | **gains** the untracked files |
| **replay the staged set** | **matches** | **matches** |

The `git ls-files` column decides it. Several checks in this repository take
their SCOPE from `git ls-files`. Under either unfaithful overlay a check would
examine a different set of files in the copy than it examined on the operator's
tree — **so a unit could read `unnoticed` because the check never looked at it.**
That is the false-`unnoticed` class this whole feature exists to kill, re-entering
through the overlay.

**The faithfulness precondition, and it is one command:**

> the copy's `git status --porcelain` **equals** the candidate's.

If it does not, the copy is not the candidate and the sweep is `inconclusive`
before any check runs. (Derivation D3.)

### Ruling 2b — `run.prove_setup`, restored, once per sweep

⚑ **Revision 2's load-bearing sentence — "a copy of the candidate carries the
environment with it" — is RETRACTED.** It is false for an editable install, and a
clone carries even less than a copy did. Measured: the clone has no `.venv` at
all, and a bare gate lap in it **passes** while importing the operator's source.

So `run.prove_setup` returns, and H1 places it: **once per sweep, in the copy,
before the control lap.** Measured to close the bypass — after setup the copy's
own `.pth` points at the copy, and the control lap discriminates. One setup per
sweep is what §5's arithmetic can afford; round 1's one-per-unit
(`SETUP_TIMEOUT_SECONDS = 900` against a 900s budget) never was.

**A repository declaring no setup is not left unguarded** — that is the whole
point of ruling eligibility the way §3 rules it.

### Ruling 2c — ONE copy, N laps

Restoration between laps is what makes that safe, and §6 is what makes
restoration checkable. **The operator's tree is never touched**: not reverted,
not stashed, not checked out.

---

## §3 — The two check sets, and ELIGIBILITY (H1, H5)

Round 2 had one "evidence set". H1 and H5 split it, because the two roles have
different costs and answer different questions.

### Ruling 3 — the FULL EVIDENCE SET, and it runs exactly twice

The full evidence set is: **the gates that ran in this verify** — `planned` in
`verify.run` — **minus optional gates**.

- Scoped-out and skipped gates are **not** in the set. A gate that did
  not run on the operator's tree cannot be asked whether it notices something,
  and asking it would redden the baseline lap on a healthy run.
- **Optional gates are excluded by ruling**, following `vacuity.py:241-245`:
  *"Proving an OPTIONAL gate is out of scope by ruling: it does not decide the
  outcome."*
- A `proves:`-bound gate that was scoped out is **recorded as absent**, with its
  criterion id, so a reader sees that the sweep could not ask the question that
  mattered most rather than inferring a clean answer.

It runs **exactly twice**: the baseline lap and the control lap (§5).
Declared-but-unbound gates participate there — they decide eligibility and the
honest ending — and are **not run per unit**.

### Ruling 3a — the BOUND CHECK SET is the per-unit scope (H5)

Per-unit laps run **the checks bound to criteria** — the gates carrying
`proves:`, the proof the board renders and the delivery cites. That is the
question v0 answers, in §Positioning's words, claim ceiling enforced.

Per-unit laps of the full suite are economically impossible: measured ~432s ×
40 units on this repository. Widening per-unit scope beyond bound checks is a
future ruling with field data, named in the module like every escalation.

### Ruling 3b — ELIGIBILITY, per check, per sweep (H1)

The all-unnoticed rule round 2 offered is necessary but cannot catch the
measured MIXTURE — path-based checks reading the copy while `src/` checks read
the original would show some units evidenced and pass it. The stronger form:

- **A check that stays GREEN under the whole-change-revert control lap is
  NON-DISCRIMINATING for this candidate.** Vacuous for this change, or
  environment-bypassed — indistinguishable from inside, and the consequence is
  identical: **its green can evidence nothing.**
- Only checks that **reddened** under the control lap participate as evidencers.
- **The record names each check's eligibility**, so the board can render
  "these checks could not vote" structurally.

⚑ **The per-unit set is `bound ∩ eligible`.** H5 scopes per-unit laps to bound
checks; H1 rules that ineligible checks evidence nothing. A bound check that
stayed green under whole-revert is in neither role, and running it per unit would
manufacture `unnoticed` rows from a check that could never have gone red.
(Derivation D2.)

### ⚑ Ruling 3c — an empty per-unit set is `inconclusive`, never a page of `unnoticed`

If `bound ∩ eligible` is empty, **the sweep reports `inconclusive`** and names
which of the two causes emptied it:

- **no gate carries `proves:`** — the repository binds no check to any criterion,
  so there is no cited proof to ask the question of. **This is not hypothetical:
  this repository's own `.wringer.yaml` declares no `proves:` gate.** Without
  this rule, the flagship demo of a coverage feature would report every part of
  every change `unnoticed`, and be right in a way that means nothing.
- **no bound check reddened under whole-revert** — H1's case, which is also the
  environment bypass.

Silence here would be the exact defect this feature exists to name, produced by
the feature itself. (Derivation D1.)

`hunt.json` records both sets by gate id, so nothing is inferred.

---

## §4 — The unit states, never guessed

### Ruling 4 — EVIDENCED, UNNOTICED, UNSWEEPABLE, UNSWEPT

| state | means |
|---|---|
| `evidenced` | at least one check in `bound ∩ eligible` went RED without this unit |
| `unnoticed` | every check in `bound ∩ eligible` stayed GREEN without this unit |
| `unsweepable` | the candidate-minus-this-unit tree could not be built, or the lap contaminated the copy |
| ⚑ `unswept` | the unit was never reached — cap, budget, or the sum in §5 Ruling 9 |

`unsweepable` is an **honest state, not an error**, and it has two recorded
causes: the lone revert failed (entangled hunks — the row carries git's own
message), or H6's `unsweepable-dirty` (§6).

⚑ **`unswept` is a first-class state, not an absence** (H6). A unit nobody
reached must be visible as such; the alternative is a denominator that quietly
shrinks, which is arithmetic's version of the silent truncation this repository
refuses.

Every unit records which check reddened it, so a reader can tell a unit
evidenced by an acceptance gate from one evidenced by a linter.

### Ruling 5 — the count line, with M as the TRUE count (H6)

> **swept N of M parts — K evidenced, the rest by state**

M is **always the true unit count**, never the reached count. A capped or
budget-limited sweep records `"completeness": "partial"` and renders M−N as
`unswept`. **A partial page must be unmistakable as partial at a glance.**

---

## §5 — The sweep, in order, with the sum as a precondition

### Ruling 6 — the hunt runs only on a verify that PASSED

`verify.py:352-358` gates `--prove` the same way — a failed run gets
`not_applicable`, *"there is nothing to prove about a failure"*. On a red run the
baseline lap is red by construction. `not_applicable`, with the failing gate
named.

### Ruling 7 — the order of operations, and none of it is optional

1. **Build the copy** (§2) and check the faithfulness precondition (2a).
2. **`run.prove_setup` once**, in the copy, where declared (2b). Failure →
   `inconclusive`, on `vacuity.py:221-234`'s wording.
3. **The BASELINE lap** — the full evidence set on the untouched copy. That tree
   is the tree verify just ran green, so it must be green here too. If it is
   not, the copy is not faithful and **nothing can be concluded from any unit**:
   `inconclusive`, keeping the baseline's own failing output, exactly as
   vacuity's `sensitive` rows cite the failure they rest on.
4. **The CONTROL lap** — the whole candidate reverted in the copy, the full
   evidence set run again, each check's red/green recorded as its eligibility
   (3b). Then the overlay is restored and §6 verifies it.
5. **The SUM** (Ruling 9), computed before the first unit runs.
6. **The unit laps** — `bound ∩ eligible` per unit, restoration verified after
   each (§6).

The baseline lap closes the **inverted** trap: a broken copy turns every check
red, every unit would read `evidenced`, and the sweep would report total
coverage — the analogue of the false proved-red Phase 4 ruled worse than an
uncovered criterion. The control lap closes the **forward** trap, which is the
one that killed round 2 and which no baseline can see.

### ⚑ Ruling 7a — the control lap uses the copy's own git, and spares the environment

The whole-change revert is `git read-tree --reset -u HEAD` followed by
`git clean -fd` — **never `-fdx`**. Measured: this restores HEAD's content
exactly, leaves the copy clean under its own git, and **spares gitignored files,
so the environment `prove_setup` just built survives into every unit lap.** It
needs no patch machinery, so it is exact for binary, rename and mode-only changes
alike. (Derivation D5.)

### Ruling 8 — the per-unit revert, by kind (H4)

| unit kind | revert | restore |
|---|---|---|
| tracked hunk | `git apply -R` of its file header + single `@@` block | forward-apply |
| no-hunk tracked | file-level, from the copy's own HEAD | re-overlay that path |
| **untracked** | **delete the file** (H4) | **re-place it from the manifest** |

**No hunk machinery touches the untracked lane.** Round 2 had no procedure for it
at all: it declared the kind, counted it in the denominator, and offered only a
`git apply -R` that an untracked file has neither header nor hunk for.

### ⚑ Ruling 9 — THE SUM, computed BEFORE the first unit runs (H5)

The spec gains the arithmetic as a **precondition**, because neither earlier
draft did the sum:

> baseline + control + N × bound-set-lap ≤ budget

computed **from the lap times the baseline and control laps just measured**, not
from an estimate. If it does not fit, **PARTIAL is declared UP FRONT** with H6's
counting: the sweep runs the units it can afford, M stays the true count, and the
remainder are `unswept`. **Never discovered at the cap mid-sweep.**

Measured on the capstone (Appendix B): 2254 + 2254 + 8 × 169 ms = **5.9 s against
a 900 s budget**. It fits with two orders of magnitude to spare — and the same
arithmetic on this repository under round 1's design gives 432 + 432 + 40 × 432 ≈
**18 144 s**, which is the shape H5 removes.

⚑ **A rebuild after contamination (§6) is not in the sum.** It cannot be — the
sum is computed before any check has had the chance to contaminate. Rebuild time
counts against the wall-clock budget like everything else, so a repository whose
checks contaminate repeatedly gets a `partial` sweep with the reason recorded,
never a silently longer one. (Derivation D7.)

### Ruling 10 — the container refusal, and where the shared predicate goes

Where `execution.backend` is `container`, the sweep returns `inconclusive`.

There is nothing to "inherit verbatim" from `vacuity.py:162-187` — it is an
inline `if` returning a hardcoded string inside `prove()`, so an implementer
could only copy the string. This spec licenses **one shared predicate and reason
string, extracted into `vacuity` and called by both**. That is a change to
`vacuity.py`, it is named here, and it is the only one this spec licenses.

---

## §6 — Restoration: clean under the COPY's own git, modulo ignored (H3)

### Ruling 11 — what "restoration matches" means, at last

After each unit lap the copy must show **no tracked modification and no new
unignored untracked file, measured against the post-overlay snapshot** — using
`git status --porcelain` in the copy, which H2 makes meaningful and which
already excludes ignored files.

- Files the copy's own `.gitignore` covers (`.pyc`, coverage, caches) are
  **exempt**. A check writing IGNORED noise is normal.
- A check writing a **tracked** or **unignored** file is a real contamination:
  that unit reports **`unsweepable-dirty`** by name, and **the copy is REBUILT
  from the pristine clone before the next unit.**
- **Never a whole-tree byte comparison** — it fires on the first unit of any
  Python repository. **Never `git diff` alone** — it is blind to a new file.

Measured, all three directions: gitignored noise does not fire it, a tracked-file
write does, an unignored new file does.

### Ruling 11a — the sweep holds a pristine clone

The rebuild in Ruling 11 needs something to rebuild from, so the clone of §2
step 1 is kept pristine and never run in; the working copy is made from it and
re-made from it on contamination.

---

## §7 — Hygiene, and what the sweep refuses to conclude

### Ruling 12 — fingerprint before and after

The sweep fingerprints the candidate before it starts and before it writes:
`git diff HEAD`'s sha256 and the sorted **subject** untracked list. If they
differ, the results describe a tree that no longer exists and the record says
`inconclusive`.

**Through `evidence.untracked_subject`, or the check fires on the sweep's own
writes.** `evidence.py:218-222`: a repo that never ran `wring init` has no
gitignore for `.wringer`, *"so it shows up untracked"* — and the bundle is
created after the snapshot. Fingerprinting the raw list would declare
`inconclusive` on every run in that population, blaming an operator who did
nothing.

**A copy whose checks cannot be trusted reports `inconclusive` or `partial`. It
never reports `evidenced`.**

### ⚑ Ruling 12a — an unignored dependency directory is counted, not special-cased

A repository whose `node_modules` (or equivalent) is untracked and **not**
gitignored contributes one unit per file. That is not a new defect — the bundle
already hashes those paths — and v0 does not special-case it: the unit cap and
`unswept` make the outcome honest and visible rather than silently sampled. The
sweep says how many parts it never reached. (Derivation D8; a heuristic here
would be a ruling, not an implementation detail.)

---

## §8 — Where it lives, and what it may do

### Ruling 13 — a flag on `wring verify`. Never a twentieth command

`wring verify --hunt`. **There are nineteen commands and a twentieth is
forbidden**; the ceiling is stated at `AGENTS.md:177-183`. (The command ceiling
is unnumbered — "law 7" is the frozen-schema law: `schema/frozen.json`,
`verify.py:751`, `checks.py:27`.)

Opt-in in v0; delivery-candidate time is its moment.

### Ruling 14 — the config keys, and the ruling they answer to

| key | default | what it does |
|---|---|---|
| `run.hunt` | `false` | sweep every iteration |
| `run.hunt_max_units` | `40` | cap; hitting it makes the sweep `partial` |
| `run.hunt_budget_seconds` | `900` | wall clock; hitting it makes it `partial` |

**`--hunt-max N` is REMOVED.** `cli.py:219-225` states the
flags-may-tighten-never-loosen rule and `cli.py:284-288` states why there is no
`--no-prove`: *"the audited party does not get to choose whether the audit
runs"* — and the invoker *"is increasingly the agent itself."* An "override"
flag is bidirectional and hands the audited party the dial. `--hunt` follows
`wants_prove`'s `declared or flag` shape exactly.

**The ceiling question — Ruling 12 of revision 2 is UPHELD, with the amendment
duty discharged.** `config.py:161-165` carries a standing in-code ruling that
there is deliberately NO ceiling key under `run:`. The disanalogy holds: that
ruling protects against a partial measurement **wearing a green tick** — a
partial `--prove` is a false negative. A partial hunt is not a verdict at all: it
reports `partial`, keeps every measured state, and H6 makes M's honesty
structural. **A standing in-code ruling is not overridden silently**, so
`config.py` gains a dated note citing this ruling — the same discipline the
witness programme's stop list gets.

`run.hunt` exists because a brief is built per iteration and can only quote a
record that exists by then. Absence of every key is today's behaviour byte for
byte. The budget nests under `run.wall_clock` — `fleet.py:823`, *"Invariant 8:
budgets nest"* — and never extends it.

### Ruling 15 — NOTE-TIER, and the escalation is named not improvised

`wring deliver` does not refuse. No exit code moves. The board renders and
decides nothing. The module names the escalation path in a comment and a window
may not take it: it is Fable's, on field evidence, and it amends the witness
programme by dated note first.

---

## §9 — The record, and who reads it

### Ruling 16 — a new sibling file, written THROUGH the Bundle

`hunt.json`, `wringer.hunt.v1`, `schema/hunt.schema.json`, listed in
`schema/frozen.json` on publication. Adding a new schema file is lawful;
`frozen.json`'s own `_comment` says so. **No frozen schema moves.**

Written inside `verify.run` before `bundle.write_digests()` (`verify.py:501` —
genuinely last) so the record is digest-covered and `audit`/`attest` compose with
no new clause.

**Through the `Bundle`, with the redactor, and that is not a detail.**
`AGENTS.md:548-550`: *"If you add a file to the bundle, add it through the
`Bundle`, or you have quietly opted out of the one guarantee SECURITY.md
makes."* `vacuity.py:152-157` records this repository having already shipped that
defect. The whole payload is scrubbed, on `accept.write`'s pattern
(`accept.py:1184-1191`).

**`hunt.json` and the log directory join `Bundle._clear_previous`'s list**
(`evidence.py:404`, `436-455`). They are written conditionally, and that module's
docstring records the survivor bug: a reused directory *"kept the first run's
verdict beside a bundle that never made it."*

**A log directory**, because otherwise the Positioning promise is false: a
payload of one state per unit gives a reader nothing to check. `hunt/` carries
the baseline lap's output, the control lap's output — **which is now evidence,
because eligibility rests on it** — and each reddening check's output.

**Which bytes are "the candidate patch" is stated:** re-computed by `git.diff`,
never read from `diff.patch` in the bundle. `evidence.py:624-634` scrubs and
truncates that file at `gates.MAX_LOG_BYTES` (1 MiB), so a large candidate is
unappliable and a candidate containing a token-shaped string would have `***`
applied into its source.

**Untracked bytes are read from the operator's tree**, the only place they exist
— `write_untracked` records `mode:sha256`, not contents. Reads follow
`hash_untracked`'s documented hazards (`evidence.py:241-255`: symlinks, dangling
links, a FIFO that *"blocked forever"*).

### Ruling 17 — the board renders structurally, in the engine's words

- The count line of §4 Ruling 5, verbatim.
- Unnoticed units as `file:line` rows behind the existing summary machinery.
- **Ineligible checks rendered as "these checks could not vote"** (H1), because a
  reader who cannot see that a check was non-discriminating cannot read the page.
- Sentences from the record verbatim. **No prose explaining the number** — the
  cold reads measured that explanation makes a page worse (68 → 82).
- Board ruling 1 and the transport rule byte-intact.

(The disclosure shape F14 is still listed under **Owed** in
`docs/field-response-2026-08-22.md:302-305`; the existing summary disclosure is
the precedent.)

### Ruling 18 — the brief hook is hint-tier

Unnoticed rows contribute as **hint-tier** content, the tier the brief's gate
logs already occupy, in the engine's words.

**Pre-decided fork, binding:** if this needs a `loop-manifest` reason, a change
to any frozen enum, or new loop routing — **STOP, record it OWED, ship the sweep
without it.**

---

## §10 — Non-goals (binding)

1. No sub-hunk splitting. Entangled hunks report `unsweepable`.
2. No whole-suite sweep, and no per-unit widening beyond bound checks. §3 states
   the route to change it.
3. No refusal, no exit-code change, no merge gate.
4. No new command. Nineteen.
5. No claim of exhaustiveness, and no coverage metric.
6. No auto-classification of a red. §5 is why the baseline and control laps exist
   rather than a classifier.
7. No parallel unit laps in v0. One copy is the safety property; N copies is a
   different cost model and a different spec.
8. ⚑ No heuristic for large untracked trees (§7 Ruling 12a).

## §11 — What this spec does not license

Deciding that unnoticed units should block; a twentieth command; widening the
evidence set or the per-unit set; moving a frozen schema; parallelising the laps;
special-casing any directory; or any sentence claiming the sweep proves a change
is covered. Each is a ruling, and rulings are Fable's.

## §12 — The derivations this spec makes, and the guards they owe

Standing law from the self-hunt (`docs/hunt-2026-08-23.md`): **nine scopes were
derived and only four guarded**, and the five unguarded ones could have been
silently narrowed with the suite green. So **every derivation ships with a guard
that the derivation is USED**, or a docstring saying why not. This spec's
derivations, each owed a guard in the build:

| id | derivation | the guard it owes |
|---|---|---|
| D1 | empty `bound ∩ eligible` → `inconclusive` (§3c) | a repo with no `proves:` gate must not produce a page of `unnoticed` |
| D2 | the per-unit set is `bound ∩ eligible` (§3b) | a bound-but-ineligible check must not be run per unit |
| D3 | the overlay replays the staged set; faithfulness is `git status --porcelain` equality (§2a) | the two unfaithful overlays must be red-watched, `git ls-files` included |
| D4 | units come from the candidate, never the copy (§1) | re-deriving in the copy must change the count and be caught |
| D5 | control lap is `read-tree --reset -u` + `clean -fd`, never `-fdx` (§7a) | an ignored environment directory must survive the control lap |
| ⚑ D6 | the BOUND CHECK SET is derived from `proves:` bindings (§3a) | adding a `proves:` binding must widen the per-unit set; a hand-kept copy of it must be impossible |
| D7 | rebuild time is unbudgeted and lands in `partial` (§9) | a contaminating check must produce `unsweepable-dirty` + rebuild, and the budget must still bind |
| D8 | large untracked trees are capped, not sampled (§7 Ruling 12a) | the cap must render `unswept`, never a shrunken M |
| ⚑ D9 | the FULL EVIDENCE SET is derived from `planned`, minus optional (§3) | `verify.py:477-480` already carries this exact lesson — *"a hand-kept second copy of 'what was left out'"* — and the sweep must not make a second copy |
| ⚑ D10 | the untracked unit set is derived through `evidence.untracked_subject` (§1) | a bundle directory must never become a unit of the change |
| ⚑ D11 | `hunt.json` and `hunt/` join `Bundle._clear_previous` (§9 Ruling 16) | see below — the list this joins is itself hand-kept |

⚑ **D6 was ABSENT from this table in the revision that went to review, and it is
the most load-bearing derivation in the document.** D9, D10 and D11 were absent
too. That is the self-hunt's own finding — *nine scopes derived, only four
guarded* — reproduced inside the spec written to fix it, one revision after the
window recorded the lesson as standing law. It is recorded here rather than
quietly corrected, because the pattern is the point: **a derivation table needs a
guard that the table is complete, or it is one more hand-kept list.**

⚑ **D11 exposes a live defect in the tree, and it is not the hunt's.**
`Bundle._clear_previous` (`evidence.py:436-455`) clears a **hand-kept tuple of
twelve filenames**. `evidence.py` defines thirteen `*_FILENAME` constants;
`RESULT_FILENAME` is correctly absent because `gates/` is cleared as a directory.
**No test derives that list.** A future bundle file whose author forgets the
tuple leaves a survivor from a previous run — precisely the failure the
function's own docstring exists to prevent (*"kept the first run's verdict beside
a bundle that never made it"*). This spec would add the thirteenth name and owed
no guard for it. Fixed in this window, independently of the hunt, because guard
hygiene does not wait.

---

## Appendix A — H1's duty: the SHIPPED vacuity lap's failure direction under the `.pth` bypass

*H1: "my reading is that it fails safe … but two windows just died to reading —
measure it, one capture, in the spec's own appendix."*

Two fixtures, **identical but for one committed line**, same candidate, same gate
string, same interpreter. HEAD is committed RED (`f()` returns 1, the committed
test asserts 2); the candidate makes it return 2, so a faithful pre-change tree
must FAIL.

    bypassed:  no `pythonpath` setting -> `import pkg` resolves through
               site-packages' __editable__ .pth, an ABSOLUTE path into the
               operator's tree
    genuine:   pythonpath = ["src"]    -> pytest prepends the tree's own src

| fixture | vacuity verdict | `wring deliver` |
|---|---|---|
| **bypassed** | **`gates_vacuous`** | **REFUSES, exit 1** |
| genuine | `proven` | passes the vacuity check |

The refusal, verbatim:

    wring deliver: refusing to deliver 20260823-112238-cf53 — it recorded
    `gates_vacuous`. `test` passed on the pre-change tree too, so they proved
    nothing about this change. … There is no flag for this — make the evidence
    better, not the check weaker

**The direction is SAFE, and H1's reading is confirmed by measurement.** A
bypassed environment yields a false `gates_vacuous`, which HOLDS a delivery
rather than flattering one. There is no live product defect here, so §3's fork —
*"the shipped lap fails UNSAFE → that outranks the hunt"* — does not fire.

**The same measurement is positive evidence for §3b.** Vacuity's
insensitive-everything under bypass IS the control lap's ineligible-everything:
the pre-change tree's checks stop discriminating, in exactly the direction H1's
eligibility rule reads as "this check can evidence nothing". The tree
construction differs — vacuity builds a worktree, the hunt a clone plus overlay
— but the bypass lives in the interpreter's `.pth`, not in the tree, and the
answer was the same in both directions when the hunt's own mechanism was measured
(`docs/hunt-mechanism-2026-08-23.md`, third measurement, R6).

**What this does not settle:** it is one repository shape (Python, editable
install, `uv`-built venv) on one machine. It does not show that every bypass in
every language fails safe.

---

## Appendix B — H5's sum, on the capstone repository

*H5: "the SUM as a precondition … computed from measured lap times BEFORE the
first unit runs."*

The capstone at `~/Claude/round3b-artifacts/capstone-repo/project`, candidate
uncommitted, loop `20260822-135739-9fcf`, `repo.head_sha: 14fdf0b`.

**The units:** `git diff HEAD` gives **4 tracked hunks** across 2 files; the
untracked subject list gives **4 files** (`board.html`, `src/history.js`,
`tests/history.test.js`, `tests/recent-row.test.js`); no binary, rename or
mode-only change. **M = 8.**

**The check sets**, measured by `wring verify --serial` (the engine's own
`duration_ms`, not shell timing):

| gate | ms | in the full set | `proves:` |
|---|---|---|---|
| `lint` | 1270 | yes | — |
| `test` | 815 | yes | — |
| `acceptance-recently-played` | 169 | yes | `recent-row-order-and-cap` |
| **full evidence set lap** | **2254** | | |
| **bound check set lap** | **169** | | |

**The sum:**

    baseline + control + N × bound-set-lap
      = 2254 + 2254 + 8 × 169
      = 5860 ms   against a 900 000 ms budget   (0.65%)

**It fits**, by a factor of about 154, so §3's fork — *"the sum does not fit even
the capstone → PARTIAL-up-front is the demo"* — does not fire.

**The caveat this capture must carry, and it is the carrier's own:** the capstone
**has no dependencies**. Its gates are pure `node`, so it **cannot exercise the
environment trap**, and it must never be cited as evidence that the trap is
closed. The trap's fixture is this repository and the probe's editable-install
fixtures, not this one.

**The contrast that shows what H5 bought.** The same sum under round 1's design —
the full evidence set per unit, on this repository's measured 432 s lap and 40-unit
cap — is 432 + 432 + 40 × 432 ≈ **18 144 s against 900 s**. Both earlier drafts had
the same arithmetic shape and a smaller constant; **neither did the sum**, which is
why it is now a precondition rather than a hope.
