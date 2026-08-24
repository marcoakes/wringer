# SPEC — the hunt: which parts of a change the evidence would notice (v0)

*Drafted 2026-08-23 by the implementing window, from rulings Fable decided in
`WRINGER_HUNT_RUN_PROMPT_2026-08-22.md` §2. **Revision 4**, folding R-H1–R-H4
(`~/Claude/WRINGER_ALLIN_RUN_PROMPT_2026-08-23.md` §2, BINDING) on top of
H1–H6, the ceiling amendment and the endorsements of
`~/Claude/WRINGER_HUNT_RULINGS_2026-08-23.md`. **Revision 4 folded 2026-08-24**;
grounded at `main` `746afb2`.*

> ## STATUS — **BLOCKED. Reviewed FOUR times, NOT SOUND four times. THE HUNT IS STOPPED and returns to Fable.**
>
> **The carrier's fork fired**: a fourth NOT SOUND stops the hunt entirely —
> no round 5 in a window. `~/Claude/HUNT_REVIEW_ROUND4_2026-08-24.md` is the
> review; §Owed below is what it leaves with Fable. **Nothing was built.**
>
> Every verdict was reached by EXECUTION, and each killed something:
>
> | round | mechanism | how it died |
> |---|---|---|
> | 1 | worktree at base + apply every hunk but this one | one binary file and **no tree can be built at all**; three change kinds emit no `@@` header |
> | 2 | copy the candidate, "a copy carries the environment" | an editable install's `.pth` is **absolute**, so the copy's interpreter imports the ORIGINAL source |
> | 3 | clone + overlay, per H1–H6 | the mechanism holds; **the LIFECYCLE BETWEEN LAPS does not** |
> | 4 | the same, plus R-H1–R-H4 | the mechanism still holds; **the lifecycle region was OPENED and not FINISHED** — a check writing OUTSIDE the copy produces false `evidenced` and every net in revision 4 is blind to it at once |
>
> ### Round 4's decisive finding, in its own shape
>
> §7 Ruling 12 says, as a safety claim: *"A copy whose checks cannot be trusted
> reports `inconclusive` or `partial`. It never reports `evidenced`."*
> **Measured FALSE.** State a check leaves outside the copy root — a global
> cache, a lock file, a port, `~/.cache` — and:
>
> - Ruling 11's restoration check reads `git status` **in the copy** → clean;
> - Ruling 11b's rebuild restores **the copy** → the outside state survives;
> - Ruling 11c's closing baseline **agrees** with the opening one (with an odd
>   number of unit laps the parity returns) → the canary is silent;
> - Ruling 12's fingerprint watches the **operator's tree** → untouched.
>
> A false `evidenced` is a false proved-red, which Phase 4 ruled **worse than
> an uncovered criterion** — manufactured by the feature built to kill that
> class. **Ruling 11c stated its ceiling in only the safe direction**, and by
> 11c's own reason for existing — *"a canary whose limits are unstated reads as
> a guarantee"* — half a ceiling is the same defect one ruling over.
>
> **Four of the six findings are one-line repairs and are FOLDED below as
> factual corrections** (the round-3 precedent: corrections land, mechanisms do
> not move while blocked). **HIGH-1 is not one of them** — the honest fix may
> narrow what v0 may claim, which is Fable's.
>
> **What round 3 established, and revision 4 does not re-open.** Clone-plus-overlay
> is right, H4's file-level revert is right, Appendix A reproduced exactly under an
> independent rebuild, Appendix B's unit arithmetic verified, and the mechanism
> probe is real and re-runnable. What was not sound is everything that happens
> *between* laps — the one region neither the probe nor the appendices exercised.
> **They exercise it now**: `scripts/hunt-mechanism-probe.py` gained R7, R8 and R9,
> and it is 47 of 47.
>
> ### What the round-4 probe measured, and both findings changed a ruling's shape
>
> **R-H1 as written does not close the trap, and the probe says why.** The ruling
> makes the rebuild source a post-`prove_setup` SNAPSHOT. Measured, three arms on
> one fixture in one run:
>
> | rebuild source | `.venv` | the next lap imports |
> |---|---|---|
> | the bare clone (Ruling 11, un-amended) | absent | **the OPERATOR's tree** — round 3's killer |
> | the snapshot, restored to a DIFFERENT path | present | **the path the snapshot was prepared at** |
> | the snapshot, restored IN PLACE | present | **the copy** ✓ |
>
> The middle row is round 2's killer one level up: an editable install's `.pth`
> is absolute, so *"a snapshot carries the environment"* is the same shape of
> sentence as *"a copy carries the environment"*, and it is false in the same
> way. **R-H1 therefore carries a constraint it did not state — the rebuild
> restores to the working copy's OWN path — and Ruling 11b is that constraint,
> with the measurement beside it.**
>
> **R-H2's canary has a ceiling, and it is measured rather than hoped.** The
> closing baseline catches coupling that moves the baseline's colour; it is blind
> to a cache that never re-reads, which gives a false green in a unit lap while
> both baselines agree. Ruling 11c states the ceiling in the spec, because a
> canary whose limits are unstated reads as a guarantee.
>
> **R-H2 is not hypothetical, and this probe proved it on itself.** R6 became
> flaky while round 4 was being written: `git clean -fd` spares gitignored files
> by design, CPython invalidates a `.pyc` on `(mtime, size)` at one-second
> resolution, and a fast control lap executed the BASELINE lap's compiled test
> module and reported the baseline's colour. The probe now runs the control lap
> warm and cold and prints both, so the coupling is a measurement rather than an
> intermittent failure.
>
> **A third thing the round-4 work found, which no ruling covers and §2d now
> does:** `prove_setup` succeeding does not put the copy's tools on the lap's
> PATH. Measured while building Appendix B2 — a fresh clone, `uv pip install -e
> .[dev]` exit 0, and the very next `wring verify` reported `ruff: command not
> found`, because a gate spawns with `shell=True` and inherits the operator's
> PATH. The environment is not only files in the tree.
>
> **The header stays.** It is lifted only by a passing review, in the same
> commit that starts the build — and there is no fifth review to be had in a
> window. The four decisions in §Owed are Fable's, and the first one may narrow
> what v0 is allowed to claim, so the text after it cannot be written until it
> lands.

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

### ⚑ Ruling 2a-i — a partially staged (`MM`) file is `inconclusive-staging`, by name (R-H4)

*Folded 2026-08-24 from R-H4. Measured by the round-3 review (§2.6) and again
by this spec's own probe, R9.*

`git add` stages WORKTREE content, so a candidate built with `git add -p` —
stage this hunk, keep working — **cannot** be reproduced by step 3's replay:

    the candidate's own view:  MM a.txt
    the copy's view:           M  a.txt
    candidate staged blob:     'one STAGED\ntwo\nthree\n'
    copy staged blob:          'one STAGED\ntwo\nthree WORKTREE\n'

The precondition above already catches it and the direction is SAFE. What was
missing is the NAME: §2a presents the precondition as a net for the two
*rejected* overlays, and a reader meeting `inconclusive` on an ordinary
`git add -p` habit has no way to know why. So v0 refuses with a cause of its
own and a one-line remedy:

> `inconclusive-staging` — this candidate has a file that is partly staged and
> partly not, and the sweep cannot reproduce that faithfully. Stage it or stash
> it, then sweep again.

**Faithful index replay is a NAMED v1 item, not an improvisation.**
`git update-index --cacheinfo` from the candidate's staged blobs would
reproduce `MM` exactly; it is more machinery than a v0 refusal, and inventing
it here is the kind of unasked-for mechanism rounds 1 and 2 died to.

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

⚑ **And the copy is SNAPSHOT immediately after setup** — see Ruling 11b. The
snapshot is what a rebuild restores from, and taking it here rather than in §6
is deliberate: it is a fact about how the copy is PREPARED, and a reader
following §2 should not have to reach §6 to learn that the prepared state is
kept.

### ⚑ Ruling 2d — the lap's PATH, which is not a file in the tree

*Added 2026-08-24. Found by measurement while building Appendix B2, not by
reading, and it is the third distinct thing this feature has learned about the
word "environment".*

A gate runs through `gates.run`, which spawns with `shell=True`, and the
operator's `PATH` reaches the lap **in both of that function's branches**:
`env=None` for a gate with no `artifacts:`, and a snapshot of `os.environ` for
one with it (`gates.py:191-201`, `artifacts.py:162-168`). Therefore:

> **CORRECTED 2026-08-24 by the round-4 review, HIGH-3, and the citation
> proved it.** This ruling first said `gates.run` *"passes no `env=`
> (`gates.py:196-202`)"* — and `gates.py:201`, inside the range it cited, is
> `env=env,`. The CONCLUSION was right and measured; the MECHANISM was wrong,
> which matters because D14 would have owed a guard against a mechanism that
> does not exist: an implementer told there is no `env=` threads one in at
> line 201, where it either overwrites `artifacts.environment()`'s result and
> silently breaks the artifacts feature, or is overwritten by it and silently
> drops the PATH fix — the exit-127 false red this ruling itself calls worse
> than a red. **The seam this spec did not know existed:**
> `artifacts.environment()` already takes a `base` parameter
> (`artifacts.py:162`), which is where a copy-first PATH belongs without
> disturbing either branch.
>
> Noted for the guard that let it through: `tests/test_spec_citations.py`
> checks that a citation RESOLVES and that a QUOTED phrase lands in the range.
> It cannot check that a PARAPHRASE about the cited code is true, and that is
> exactly how this got in. A limit, not a defect — and worth knowing before
> anyone treats that guard as covering claims.

> `run.prove_setup` exiting 0 does NOT mean the lap that follows can find what
> it installed.

Measured on this repository: a fresh clone, `uv venv` and `uv pip install -e
'.[dev]'` both exit 0, and the very next `wring verify` reports

    /bin/sh: ruff: command not found

— a `lint` gate that never ran, in a copy whose environment had just been built
successfully. That is F6's own failure class arriving through the hunt's front
door, and on a bypassed lap it is worse than a red: `health.genuine_failure`
already discounts 127 because *nothing ran, so nothing discriminated*.

**So the unit lap's environment carries the copy's own tool directory ahead of
the operator's.** The probe has always done this (`copy_env` in R2 and R7); the
spec never said it, which is how it would have been left out of the build.

⚑ **This does not weaken §2b and it is not the same fact.** §2b is about which
SOURCE the interpreter imports (the `.pth`); this is about which BINARIES the
shell finds. The bypass in §2b survives a correct PATH, and a missing PATH
survives a correct `.pth`. Two mechanisms, two measurements, both required.

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
7. ⚑ **The CLOSING BASELINE lap** (Ruling 11c) — the full evidence set once
   more, on the restored copy. Disagreement with step 3 is
   `inconclusive-lap-coupling`, and no unit state survives it.

⚑ **Inside step 2: SNAPSHOT the prepared copy** (Ruling 11b), after setup and
before the baseline lap. It belongs to preparing the copy rather than being a
step of its own, and a rebuild that restores anything but the post-setup state
is the defect R-H1 exists to close.

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

### ⚑ Ruling 9 — THE SUM, computed BEFORE the first unit runs (H5, AMENDED by R-H3)

The spec gains the arithmetic as a **precondition**, because neither earlier
draft did the sum.

> **AMENDED 2026-08-24 by R-H3, and the amendment is the whole term list.**
> H5's form was `baseline + control + N × bound-set-lap ≤ budget`. Ruling 7's
> own order puts the clone (1), `prove_setup` (2), the baseline (3) and the
> control (4) all BEFORE the sum is evaluated (5), so four terms had already
> been spent when the comparison was made — and the comparison was against the
> WHOLE budget rather than what remained. `vacuity.SETUP_TIMEOUT_SECONDS` is
> 900 and `run.hunt_budget_seconds` defaults to 900, so a setup running to its
> own ceiling consumes the entire budget and the sum could still read "it
> fits". **Appendix B cannot detect this** — the capstone declares no
> `prove_setup`, so every omitted term is zero there, and a zero-term blindness
> is how the last gap hid.

**The sum, in full, and every term counted:**

> clone + `prove_setup` + snapshot + opening baseline + control + N × bound-set-lap
> + closing baseline + one pessimistic rebuild  ≤  budget × 0.9

Four things about that line, each of which was a way to be wrong:

1. **`prove_setup`'s term exists even when the repository declares none** — at
   zero. A term that disappears when it is zero is a term nobody notices when
   it stops being zero.
2. **The snapshot's copy cost is in** (Ruling 11b). It is a whole-tree copy
   including the environment, and on a repository with a large `.venv` it is
   not small.
3. **The closing baseline is in** (Ruling 11c) — one extra full-evidence-set
   lap, which on a slow suite is the largest single addition R-H2 makes.
4. **The 10% reserve.** Comparing against the whole budget leaves nothing for
   the rebuild path, and a sweep that runs out of wall clock mid-unit has to
   discard a measurement it already paid for.

Computed **from the lap times the baseline and control laps just measured**,
not from an estimate. If it does not fit, **PARTIAL is declared UP FRONT** with
H6's counting: the sweep runs the units it can afford, M stays the true count,
and the remainder are `unswept`. **Never discovered at the cap mid-sweep.**

Measured on the capstone (Appendix B) it fits with two orders of magnitude to
spare. **Measured on this repository (Appendix B2) it does not fit at all** —
847.7 s of already-spent terms against an 810 s ceiling, before a single unit
— which is the answer the amended sum exists to produce and the old one could
not.

⚑ **A rebuild after contamination (§6) is inside the sum as ONE pessimistic
term, and no further.** The sum is computed before any check has had the
chance to contaminate, so the true number is unknowable; reserving one is the
difference between a budget that binds and one that is decoration. A repository
whose checks contaminate repeatedly gets a `partial` sweep with the reason
recorded, never a silently longer one. (Derivation D7.)

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
unignored untracked file, measured against the post-`prove_setup` SNAPSHOT of
Ruling 11b** — using `git status --porcelain` in the copy, which H2 makes
meaningful and which already excludes ignored files.

> **CORRECTED 2026-08-24 by the round-4 review, HIGH-2. It read "the
> post-overlay snapshot", and revision 4 has no such thing.** Revision 4
> defines exactly one snapshot and takes it AFTER setup (Ruling 2b, Ruling 7,
> Ruling 11b), and the two states are not interchangeable — measured on a
> stock Python repository, `uv pip install -e .` writes `src/pkg.egg-info/`,
> untracked and unignored. Under the old words a unit lap **that did nothing
> at all** reports `unsweepable-dirty`; the rebuild restores the post-setup
> snapshot, which still contains the trigger, so the next unit fires again —
> every unit `unsweepable-dirty`, forever, against a sum that budgets exactly
> one pessimistic rebuild.
>
> **This repository's own `.gitignore` carries `*.egg-info/` at line 4, which
> is why the author would never have hit it here.** That is Appendix B's
> zero-term blindness one floor down, and it is the second time in two
> revisions that this document's home repository hid a defect from it.
>
> **The guard this owes is UNBUILT** and belongs to whichever window builds:
> `prove_setup`'s own output may never count as contamination, on a fixture
> whose `.gitignore` does *not* carry `*.egg-info/`. Recorded as D16 below.

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

> **AMENDED 2026-08-24 by R-H1, in its own words, and this amendment is what
> round 3's NOT SOUND bought.** *"The rebuild source is the PREPARED SNAPSHOT,
> never the bare clone."* The clone stays, and it is no longer what a rebuild
> restores from: R1 measured that a clone carries no environment, so every unit
> after the first contamination ran checks importing the OPERATOR's tree, with
> nothing in the record saying so. Ruling 11's *"REBUILT from the pristine
> clone"* is superseded by Ruling 11b.

### ⚑ Ruling 11b — the snapshot, and the constraint the ruling did not state

*R-H1, folded — and folded with a constraint R-H1 does not contain, because the
probe measured that the ruling as written does not close the trap.*

**After `prove_setup` runs once in the copy (§2b), the whole prepared copy is
SNAPSHOT** — tree and environment together. That snapshot, never the bare
clone, is what every contamination rebuild restores from, so one act restores
both.

⚑ **And the rebuild restores it to the working copy's OWN absolute path.**
Measured, three arms, one fixture, one run (`scripts/hunt-mechanism-probe.py`
R7):

| rebuild source | `.venv` | the next lap imports |
|---|---|---|
| the bare clone | absent | **the OPERATOR's tree** |
| the snapshot, at a DIFFERENT path | present | **the path the snapshot was prepared at** |
| the snapshot, IN PLACE | present | **the copy** ✓ |

The middle row is round 2's killer wearing a new hat. An editable install's
`.pth` is ABSOLUTE, so a snapshot of a prepared copy carries a pointer to where
it was prepared; restore it anywhere else and the interpreter still imports the
old location. *"A snapshot carries the environment"* is the same sentence as
*"a copy carries the environment"*, and it is false in the same way — which is
precisely why it was measured rather than reasoned about.

**So the rebuild is: delete the contaminated working copy, restore the snapshot
to that same path.** Not "make a fresh copy from the snapshot somewhere
convenient". The path is load-bearing and the spec says so in one line rather
than leaving an implementer to find it.

**The snapshot's copy cost is in the sum** (Ruling 9). It is a whole-tree copy
including `.venv`, and on a repository with a large environment it is the
largest single term the rebuild path adds.

### ⚑ Ruling 11c — lap independence is an ASSUMPTION, so it is MEASURED (R-H2)

*R-H2, folded — with its ceiling stated, because the probe measured that too.*

Nothing in earlier revisions said a lap is independent of the lap before it,
and Rulings 7a and 11 deliberately spare gitignored files — 7a so the
environment survives, 11 so noise does not fire restoration. Together they
GUARANTEE that every incremental build and test cache carries state from one
lap into the next, and those caches are what decide what a lap executes.

**Gitignored caches stay spared. The protection is a second baseline:**

> The BASELINE lap re-runs at the sweep's END. If the closing baseline
> disagrees with the opening baseline, the sweep reports
> **`inconclusive-lap-coupling`** — and never unit states from a coupled
> sequence.

One extra full-evidence-set lap, and it is in the sum.

⚑ **This is not hypothetical and the probe demonstrated it on ITSELF.** While
revision 4 was being written, R6 became intermittently red: `git clean -fd`
spared the baseline lap's `tests/__pycache__`, CPython invalidates a `.pyc` on
`(mtime, size)` at ONE-SECOND resolution, and a fast control lap executed the
BASELINE's compiled test module and reported the baseline's colour. R6 now runs
the control lap warm and cold and prints both, so the coupling is a measurement
rather than a flake — and on a run where they disagree it prints
*"the lap took its colour from the lap before it"*.

⚑ **THE CEILING, and it is stated because a canary whose limits are unsaid
reads as a guarantee.** Measured in R8, second fixture: a check that caches its
verdict and never re-reads gives a false green in the UNIT lap **while both
baselines agree**. The canary compares baselines; it cannot see a coupling that
never moves one.

    opening 0   unit 0 (a false `unnoticed`)   closing 0   -> canary silent

So `inconclusive-lap-coupling` firing means *this sequence was coupled*; it NOT
firing does not mean the sequence was independent. **v0 claims exactly the
first.** Anything stronger — clearing derived caches between laps, requiring
hash-based invalidation, declaring caches part of restoration — is a ruling
with a cost against Ruling 7a's reason for sparing ignored files, and it is
Fable's, on field evidence.

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

> ⚑ **MEASURED FALSE, 2026-08-24, round-4 review HIGH-1 — and this sentence
> stays here, struck rather than deleted, because it is the claim the hunt
> stopped on.** A check that writes OUTSIDE the copy root produces false
> `evidenced` rows and every net in revision 4 is blind to it at once: the
> restoration check reads the copy, the rebuild restores the copy, the closing
> baseline agrees with the opening one, and the fingerprint watches the
> operator's tree. Measured on a fixture whose unit laps read RED from a
> global cache slot, with both baselines green and the canary silent.
>
> **The fix is OWED to Fable and is not an implementer's call**, because the
> honest version may narrow what v0 is allowed to claim: require containment
> (the machinery exists in `SPEC_CONTAIN_V0`, and Refusal 10 already says an
> ACP worker cannot be contained in v0); or carry a named limit in `hunt.json`
> and on the board where a reader sees it; or narrow v0's claim below
> `evidenced` altogether. **No page may repeat the sentence above until that
> ruling lands.**

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
| ⚑ D12 | the rebuild restores the SNAPSHOT to the copy's own path (§6 Ruling 11b) | a rebuild pointed at the bare clone, and one pointed at a different path, must both be caught — the probe's R7 is the shape, and the build owes the same three arms as a fixture |
| ⚑ D13 | the closing baseline is the SAME lap as the opening one (§6 Ruling 11c) | a second implementation of "the full evidence set" would let the two baselines differ for a reason that is not coupling, which is a canary that fires on itself |
| ⚑ D14 | the unit lap's PATH puts the copy's tool directory first (§2 Ruling 2d) | a lap whose tools resolve to the OPERATOR's install must be caught; `ruff: command not found` in a copy whose setup exited 0 is the measured shape |
| ⚑ D15 | the sum's term list is derived from Ruling 7's ORDER **and from §6's contingency terms** (§5 Ruling 9) | adding a step to the order, or a contingency to §6, must change the sum, or the sum silently stops counting it — which is exactly how R-H3's four missing terms got there |
| ⚑ D16 | `inconclusive-staging` is reported BY NAME, not as a bare `inconclusive` (§2 Ruling 2a-i) | an `MM` candidate must produce the named cause; D3 covers §2a's precondition and covers nothing about §2a-i's name |
| ⚑ D17 | the copy has no remote that can reach the candidate (§2) | dropping the `origin` a `git clone --local` leaves is the only SAFETY requirement in this document, and until round 4 it was the only one with no guard — measured: `git push origin` from the copy SUCCEEDS and the operator's repository gains the branch |

> **⚑ CORRECTED 2026-08-24 by the round-4 review, MEDIUM-2/3/4, and the pattern
> is the finding.** Revision 4 added five rulings (2a-i, 2d, 11b, 11c, and the
> amendment to 9) and four derivations, mapping D12→11b, D13→11c, D14→2d,
> D15→9. **Ruling 2a-i had none** — a named cause shipped with nothing
> guarding that the name is used, which is precisely the law this section
> states. Round 3's review found four derivations missing from this table;
> revision 4 found three of its own four and missed the fifth ruling entirely.
>
> **D15's rule provably could not derive its own eighth term.** The
> pessimistic rebuild is not a step in Ruling 7's order — it is a §6
> contingency — so a guard written to D15 as stated would ship with the same
> hole, and Appendix B2 omitted exactly that term. The derivation source now
> names both.
>
> **§12's own closing paragraph asked for the guard that would have caught
> this** — *"a derivation table needs a guard that the table is complete"* —
> and revision 4 did not build one. It is owed by whichever window builds, and
> the shape is derivable: every ⚑ ruling id in this document appears in the
> `where` column of some row.

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

---

## ⚑ Appendix B2 — R-H3's sum on a repository where NO term is zero

*Measured 2026-08-24 on the author's Mac, against this repository at `746afb2`.
Demanded by R-H3 in its own words: **"Appendix B gains a second worked example
with NONZERO prove_setup — this repository itself — because the capstone's
zero-term blindness is how the last gap hid."***

The capstone declares no dependencies and no `prove_setup`, so every term R-H3
says the sum omitted is **zero** there, and Appendix B fits by a factor of 154
whether or not the amendment lands. That is what makes it useless as a test of
the amendment.

**The terms, each timed on the real command:**

| term | ms | how |
|---|---|---|
| clone (`git clone --local`) | 2 397 | a full local clone of this repository |
| `prove_setup` | 623 | `uv venv --python 3.12 && uv pip install -e '.[dev]'` |
| full evidence set lap | 422 351 | the engine's own `duration_ms`: `lint` 66 + `test` 422 285 |
| bound check set lap | — | **this repository declares no `proves:` gate** |

**The sum, both ways:**

    H5 as ruled          422 351 + 422 351 + N x bound-lap   <=  900 000
                         -> "it fits", with N unbounded, because the two
                            laps are the only terms it counts and it
                            compares against the whole budget

    R-H3 as amended      2 397 + 623 + 422 351 + 422 351  =  847 722 ms
                         already spent before the first unit
                         ceiling with the 10% reserve      =  810 000 ms
                         -> IT DOES NOT FIT. Not "N is small" — there is no
                            room for a single unit, and the closing baseline
                            (Ruling 11c) has not been added yet.

**That difference is the amendment, on one repository, in one table.** The old
sum reads "it fits" on a repository where the sweep cannot afford to run at
all.

> ⚑ **CORRECTED 2026-08-24 by the round-4 review, MEDIUM-2 — the table above
> itemises FOUR of Ruling 9's EIGHT terms.** The snapshot and the pessimistic
> rebuild appear nowhere in it, in an appendix titled *"a repository where NO
> term is zero"* and written to demonstrate the amended list. That is R-H3's
> own failure — a term list that silently stops counting — reproduced inside
> the fix for it, one revision after D6's absence taught the same lesson.
>
> **Measured, the missing terms are not small:**
>
> | term | ms | how |
> |---|---|---|
> | snapshot (`cp -a` of the prepared copy) | **4 820** | 173 MB tree, 109 MB of it `.venv` |
> | one pessimistic rebuild | **4 820** | the same copy, restored in place |
>
> The snapshot term alone is **larger than clone + `prove_setup` combined**,
> both of which this appendix itemises and makes a point of itemising.
>
> **The honest eight-term figure is 1 279 713 ms** — 142% of the whole budget,
> before a single unit. The verdict is unchanged and the direction is safe: it
> did not fit at 847 722 and it fits less now. The defect was in the
> demonstration, not the conclusion.

**Two caveats this capture must carry, both of which make it CONSERVATIVE:**

1. **`prove_setup` at 623 ms is a WARM `uv` cache**, on a machine that has
   built this environment many times. A cold cache is minutes, not
   milliseconds — so the real gap between the two sums is wider than the table
   shows, never narrower. `SETUP_TIMEOUT_SECONDS` is 900 and the default budget
   is 900 s: a setup running to its own ceiling spends **100%** of the budget,
   which is R-H3's own example and is reachable on a first run.
2. **The closing baseline is not in the 847 722.** Adding Ruling 11c's lap
   takes it to 1 270 073 ms — 141% of the whole budget — which is the honest
   cost of the protection R-H2 buys and is stated here rather than discovered
   by an operator.

**What actually happens on this repository, and it fires first.** §3c already
rules the sweep `inconclusive` here, because `.wringer.yaml` declares no
`proves:` gate and `bound ∩ eligible` is empty. So this repository never
reaches the sum — and that is the point of measuring it anyway: **a
precondition that is unreachable on the one repository whose numbers we know is
a precondition nobody has run.** The arithmetic above is what the sum WOULD say,
computed from real lap times, and it is the second worked example R-H3 asked
for.

**And one thing this appendix found that no ruling covers** — see §2 Ruling 2d.
The first attempt at this measurement reported `lint` FAILING in the fresh
clone. The cause was not the code: `prove_setup` had exited 0, and the very
next gate got `/bin/sh: ruff: command not found`, because a gate spawns with
`shell=True` and inherits the operator's `PATH` rather than the copy's. The
term above is 66 ms only because the second attempt put `<copy>/.venv/bin`
first.

---

## ⚑ Owed to Fable — the four decisions that stop the hunt

*From the round-4 review, 2026-08-24. **Nothing in this document may be built
until item 1 lands**, because the honest answer to it may narrow what v0 is
allowed to claim, and the text that follows cannot be written before then.*

1. **May the hunt claim `evidenced` at all, given that a check can write
   OUTSIDE the copy?** Three options with real costs, and it is a positioning
   decision rather than an implementation detail: require containment
   (`SPEC_CONTAIN_V0`'s machinery exists, and refusal 10 already says an ACP
   worker cannot be contained in v0); carry a named limit in `hunt.json` and on
   the board so the claim is bounded where a reader sees it; or narrow v0's
   claim below `evidenced` altogether.
2. **What a flaky or `stability:`-declared gate does in the two baselines.**
   Measured: two baselines can disagree with provably ZERO state carried
   between them, because the gate was nondeterministic — and
   `inconclusive-lap-coupling` discards every unit state, which on this
   repository is ~1 270 s already spent. This document does not mention
   flakiness at all, while the repository ships `SPEC_STABILITY_V0` in which a
   tolerated mixture is `passed`, is in `planned`, is not `optional`, and is
   therefore in §3's full evidence set. Discard, exclude such gates from the
   canary, or compare verdicts rather than colours?
3. **Whether `inconclusive-lap-coupling` may be reported under that name at
   all**, given the canary provably cannot tell coupling from flakiness.
   Naming a cause the mechanism cannot establish is the defect Ruling 2a-i was
   written to fix, pointing the other way.
4. **Anything stronger than the canary** — clearing derived caches between
   laps, hash-based invalidation, caches as part of restoration. Already
   recorded as Fable's on field evidence; the review found no reason to move it.

**What the review found CORRECT, so the next cycle does not re-litigate it:**
the probe (47/47, twice, byte-identical modulo tmpdir); Ruling 11b's three arms
reproduced on the reviewer's own fixture rather than on the probe;
clone-plus-overlay; H4's file-level revert; the untracked delete/re-place lane;
Ruling 2a-i's direction (it refuses rather than answering wrongly); §3c's
empty-set refusal, which correctly fires on this very repository; the
nineteen-command ceiling; and every `file:line` citation hand-checked — **no
drift this round**, against four last round.
