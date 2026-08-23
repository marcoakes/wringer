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

## What this capture does NOT show

It was run on one machine, on a scratch repository, with `git` 2.x on macOS. It
shows the mechanism is workable on these shapes; it is not a claim about every
patch git can emit. Submodules, symlink changes and `core.autocrlf`
repositories were not exercised. The sweep's own guards — not this page — are
what make an unswept unit visible rather than absent.

The probe script that produced this is reproduced by the suite's own fixtures
(`SPEC_HUNT_V0` §2), so the finding cannot rot silently.
