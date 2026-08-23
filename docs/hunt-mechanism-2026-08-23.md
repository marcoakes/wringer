# The hunt's mechanism, measured — 2026-08-23

*A capture. Executed on this Mac against a scratch repository built to be
adversarial on purpose, while `SPEC_HUNT_V0.md` was under review. **The output
below is what the commands printed**, and the spec's §1 and §2 were rewritten
because of it. Law 8: this page is not edited to match a later tree; a
correction goes below it with a date.*

## Why this was run

The spec's first draft built each candidate-minus-one-unit tree by taking a
detached worktree at the base and applying **every hunk except this unit's**.
The independent review called that unworkable. Rather than take either the
spec's word or the review's, the mechanism was executed.

The scratch candidate carries, deliberately, every shape a real delivery has
and a toy one does not: two independent hunks far apart in one file, a file
deletion, a rename, a mode-only change, a binary file, and an untracked file.

## What `git diff HEAD` produces for that candidate

    @@ hunks: 3
    diff --git a/src/blob.bin b/src/blob.bin
    Binary files a/src/blob.bin and b/src/blob.bin differ
    diff --git a/src/gone.txt b/src/gone.txt
    deleted file mode 100644
    @@ -1 +0,0 @@
    diff --git a/src/many.txt b/src/many.txt
    @@ -1,5 +1,5 @@
    @@ -16,5 +16,5 @@ o
    diff --git a/src/mode.sh b/src/mode.sh
    old mode 100644
    new mode 100755
    diff --git a/src/renamed_from.txt b/src/renamed_to.txt
    rename from src/renamed_from.txt
    rename to src/renamed_to.txt

**Six changed paths, three `@@` hunks.** The binary change, the rename and the
mode change produce no hunk at all.

## Mechanism A — the first draft. It does not work

    === A: worktree at base, apply the WHOLE candidate patch ===
      error: cannot apply binary patch to 'src/blob.bin' without full index line
      error: src/blob.bin: patch does not apply

`git.diff` omits `--binary` by decision, not oversight — `git.py:176-179`:
*"An evidence file should not be able to grow a megabyte of image on someone
else's say-so."* `git apply` is all-or-nothing, so **nothing applied**: not the
binary file, and not the three text hunks either.

The consequence for the first draft was total. Its baseline lap required a
fully-applied candidate, so **one binary file anywhere in a change meant the
sweep could never be built**, and every such repository would have received
`inconclusive` for ever with a reason about its environment.

## Mechanism D — copy the candidate, reverse one hunk, restore

    === D: copy the CANDIDATE tree, reverse-apply one hunk, then restore ===
      units discovered: 6
      - src/blob.bin: NO-HUNK (rename/mode/binary) -> cannot be a hunk unit
      - src/gone.txt @@ -1 +0,0 @@: reverse OK, restored
      - src/many.txt @@ -1,5 +1,5 @@: reverse OK, restored
      - src/many.txt @@ -16,5 +16,5 @@ o: reverse OK, restored
      - src/mode.sh: NO-HUNK (rename/mode/binary) -> cannot be a hunk unit
      - src/renamed_to.txt: NO-HUNK (rename/mode/binary) -> cannot be a hunk unit

    === is the copy byte-identical to the candidate after all that? ===
      (no lines above = identical)

Every text hunk — **including the file deletion** — reverse-applied and then
restored, and after all six units the copy was byte-identical to the
candidate. A single `@@` block plus its file header is a valid patch in both
directions, which "every hunk except one" is not.

## The three things this changed in the spec

1. **The tree is a COPY of the candidate, not a worktree at the base.** A
   worktree carries tracked files and nothing else, which is the whole reason
   `vacuity.py` needs `run.prove_setup`. A copy brings `.venv` and
   `node_modules` with it, so the hunt does not use `prove_setup` at all — and
   the first draft's per-unit setup, at `SETUP_TIMEOUT_SECONDS = 900` against
   a 900-second sweep budget, was unreachable arithmetic nobody had done.
2. **One copy, N laps, with restoration verified between them** — not N trees.
3. **A third unit kind.** Binary, rename and mode-only changes are units with
   no hunk. They are `unsweepable` and they stay in the denominator, because a
   count line reading *"N of M parts of this change"* must not quietly drop
   the parts it cannot reverse.

---

## Second measurement, same day — **the copy does not carry the environment**

*Round 2 of the review returned NOT SOUND on the rewritten mechanism, for a
reason the first round did not reach. Reproduced here by hand before anything
was decided on it. **This is the finding that stopped the window building the
sweep.***

The rewrite's load-bearing sentence was *"A copy of the candidate carries the
environment with it"*, and that is how `run.prove_setup` was removed from the
path. It is false for an editable install, which is how this repository — and
most Python projects — are developed.

    $ cat .venv/lib/python3.12/site-packages/__editable__.wringer-0.4.1.pth
    /Users/marc/Claude/wringer/src

An **absolute path into the operator's tree**. Copying the tree copies that
file verbatim, so the copy's own interpreter resolves the package to the
original:

    $ rsync -a --exclude '.wringer/' --exclude '.git/' ./ $S/cand/
    $ cd $S/cand && ./.venv/bin/python -c "import wringer; print(wringer.__file__)"
    /Users/marc/Claude/wringer/src/wringer/__init__.py

End to end, with redaction turned off **in the copy only** —
`MIN_SECRET_LENGTH = 6` → `600`, a mutation eight tests are written to catch:

    $ ./.venv/bin/python -m pytest -q tests/test_redact.py     # the lap as specified
    8 passed in 7.75s                       -> the unit reads UNNOTICED, falsely

    $ PYTHONPATH=$S/cand/src ./.venv/bin/python -m pytest -q tests/test_redact.py
    7 failed, 1 passed in 0.10s             -> the unit reads EVIDENCED, truly

### Why this is worse than the trap it replaced, and why the baseline lap cannot see it

The trap `--prove` guards is the **inverted** one: a broken scratch tree turns
every check red, and a red pre-change gate reads as proof. The baseline lap in
§4 Ruling 7 was written to close it, and it does.

This is the **forward** trap and the baseline lap is blind to it by
construction: the baseline is green because the ORIGINAL is green. Every unit
then reads `unnoticed`, and the sweep reports that nothing in the change is
covered — which is note-tier, so nothing refuses, and is indistinguishable
from a true and alarming result.

**It is not even uniform, which is what makes it unreadable.** Path-based
checks do read the copy: `ruff check src tests` walks the copy's files, and
`tests/core_helpers.py`'s `repo_root()` resolves to the copy, so the document
guards read the copy. Import-based checks read the original. On this
repository the sweep would report documentation and lint units `evidenced` and
every `src/` unit `unnoticed` — a page no reader could tell from a real
measurement.

The class is general: editable installs, `.pth` files, `tox`/`conda`
prefixes, absolute build caches. `node_modules` largely survives a copy
because its shebangs and internal links are relative — so the failure is
**silent and language-dependent** rather than loud, which is the worst
available shape.

### What it does not settle

That the approach is wrong. Restoring `run.prove_setup` — once per sweep now,
not once per unit — would re-point the environment at the copy, and one setup
against one copy is affordable in a way the first draft's per-unit setup never
was. What it does settle is that **no version of this may ship without a
POSITIVE check that the checks read the copy**, because a repository that
declares no setup gets a green baseline, a fully bypassed sweep, and a
confident page. Choosing that check is a ruling, not an implementation detail,
and the window stopped rather than improvise it.

---

## What this capture does NOT show

It was run on one machine, on a scratch repository, with `git` 2.x on macOS. It
shows the mechanism is workable on these shapes; it is not a claim about every
patch git can emit. Submodules, symlink changes and `core.autocrlf`
repositories were not exercised. The sweep's own guards — not this page — are
what make an unswept unit visible rather than absent.

The probe script that produced this is reproduced by the suite's own fixtures
(`SPEC_HUNT_V0` §2), so the finding cannot rot silently.

---

## THIRD measurement, 2026-08-23 — the mechanism H1–H6 constrains

*Fable's rulings arrived and constrained a third mechanism: local clone plus
overlay, per-check eligibility from a whole-revert control lap, `prove_setup`
once per sweep, restoration measured under the copy's own git. **Two
mechanisms have already died to measurement in this window, so this one was
executed before a line of the spec was rewritten.** `scripts/hunt-mechanism-probe.py`
is what produced everything below; it takes no arguments and builds its own
fixtures.*

The candidate is deliberately harder than round 1's: it adds a **staged/unstaged
mixture** — a staged rename and a staged edit alongside unstaged hunks, an
unstaged deletion, an unstaged mode change and an unstaged binary change, plus
two untracked files.

### The clone does NOT carry the environment either — `prove_setup` is load-bearing

The round-2 finding was that a *copy* does not carry the environment. A
**clone carries even less**, and this had to be measured rather than assumed:

    the clone does NOT carry .venv          -> .venv absent from the clone
    the clone DOES carry a self-contained gitdir
    bare `pytest -q` in the clone: exit 0
    `import pkg` resolves to: …/h2-mech2/cand/src/pkg/core.py     <- the OPERATOR's tree

**Exit 0 there is the forward trap firing.** The gate is green in the copy
because it never read the copy. So H1's restoration of `run.prove_setup` is not
belt-and-braces; without it this mechanism reproduces round 2's failure exactly.

Running the repository's own declared setup inside the copy closes it:

    the copy's own .pth -> …/h2-mech2/r1/src                       <- the COPY
    `import pkg` now resolves to: …/h2-mech2/r1/src/pkg/core.py
    baseline lap: GREEN   control lap: RED
    `git clean -fd` SPARES the ignored .venv it just built

The last line matters: the control lap is `git clean -fd`, never `-fdx`, so the
environment the setup just built survives into every unit lap. One setup per
sweep is what H5's arithmetic can afford; one per unit never was.

### H1's eligibility rule reads the bypass correctly, in both directions

The same fixture in two environment shapes, one committed line apart:

| shape | baseline lap | **control lap** | H1 verdict |
|---|---|---|---|
| bypassed (absolute `.pth`) | GREEN | **GREEN** | **INCONCLUSIVE** — no check discriminates |
| genuine (`pythonpath = ["src"]`) | GREEN | **RED** | the check is ELIGIBLE |

This is the positive check round 2 said no version may ship without. A
bypassed copy cannot reach a clean page: every check stays green under
whole-revert, so no check is eligible to evidence anything, and the sweep
reports `inconclusive` rather than a confident page of `unnoticed`.

### The overlay must reproduce the candidate's INDEX, not just its files

Three overlay constructions were measured against the candidate's own git view.
Both obvious ones fail, **in opposite directions**, and the failure is not
cosmetic:

| overlay | `git status --porcelain` == candidate's | `git ls-files` == candidate's | files on disk == candidate's |
|---|---|---|---|
| **A** index left at HEAD | no — staged rename renders as `D` + `??` | **no** — misses `renamed_to.txt` | yes |
| **B** `git add -A` | no — untracked files render as `A` | **no** — GAINS the untracked files | yes |
| **C** replay the candidate's staged set | **yes** | **yes** | yes |

The `git ls-files` column is the one that decides it. Several checks in this
repository take their SCOPE from `git ls-files`, so under A or B a check would
examine a different set of files in the copy than it examined on the operator's
tree — and a unit could read `unnoticed` because **the check never looked at
it**. That is the false-`unnoticed` class this whole window exists to kill,
re-entering through the overlay.

Option C is a clean sweep, 7 of 7, and it hands the spec a faithfulness
precondition that is a single command: *the copy's `git status --porcelain`
equals the candidate's.*

### Every unit kind reverts and restores

Ten units — 5 hunk (including a file deletion and a STAGED edit), 3 no-hunk
(binary, mode-only, rename) and 2 untracked — each reverted alone and restored,
with the copy byte-identical to the candidate after every lap:

    units: 5 hunk, 3 no-hunk, 2 untracked = M 10
    PASS  R4 hunk revert+restore gone.txt @@ -1 +0,0 @@
    PASS  R4 hunk revert+restore many.txt @@ -1,6 +1,6 @@
    PASS  R4 hunk revert+restore many.txt @@ -33,7 +33,7 @@ line
    PASS  R4 hunk revert+restore src/pkg/core.py @@ -1,2 +1,2 @@
    PASS  R4 hunk revert+restore staged_edit.txt @@ -1 +1 @@
    PASS  R4 no-hunk file-level revert+restore blob.bin
    PASS  R4 no-hunk file-level revert+restore mode.sh
    PASS  R4 no-hunk file-level revert+restore renamed_to.txt
    PASS  R4 untracked delete+re-place dead_untracked.txt
    PASS  R4 untracked delete+re-place new_module.py

> **Correction, 2026-08-23, same day, found by the third review.** The block
> above first read *"Nine units… 4 hunk"* with rows prefixed `Q4`. That was the
> output of an EARLIER probe, quoted under a page whose opening sentence is
> *"The output below is what the commands printed"* and which cites
> `scripts/hunt-mechanism-probe.py`. The landed script prints ten rows prefixed
> `R4`; the missing row is the **staged-edit hunk**, which is the shape
> `SPEC_HUNT_V0` §2 Ruling 2a exists for. Corrected to the landed script's
> actual output rather than left standing with a note, because the defect was a
> misattribution made the same day and not a capture overtaken by a later tree —
> Law 8 protects the second, and this was the first.

**H4 upgrades the no-hunk kinds out of `unsweepable`.** Round 1 could only
record them as unsweepable because the mechanism was `git apply`; the copy's
own history makes a file-level revert exact, so binary, rename and mode-only
changes are now measured units rather than counted-but-unanswerable ones.

### H3's restoration check fires on contamination and ignores noise

    gitignored noise does NOT fire the restoration check    PASS  (.pyc, coverage.out)
    a tracked-file write FIRES the restoration check        PASS
    an unignored new file FIRES the restoration check       PASS

Measured under the copy's own git, against the post-overlay snapshot — never a
whole-tree byte comparison, which is what H3 forbids and what would fire on the
first unit of any Python repository.

### What this third measurement does NOT show

One machine, `git` 2.x on macOS, `uv`-built Python 3.12 environments. Submodules,
symlinks, `core.autocrlf` and non-Python environment shapes are still
unexercised — and `node_modules` was reasoned about, not measured, so the spec
claims nothing about it. The measurements above establish the mechanism is
workable on these shapes and that two alternatives to it are not; they are not
a claim that the sweep is correct, which is what the spec's own guards and the
review are for.
