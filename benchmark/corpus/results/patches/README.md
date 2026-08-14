# The corpus changes, recovered — 2026-08-14

The 52 corpus rows in this directory's parent record **what the agents did not
do**: a cell, a claim, a held-out result. They do not record **the change
itself**. A row's `evidence` is `{tree, base_sha, workdir}`, and `tree` is an
absolute path into a session scratchpad under `/private/tmp`. The ~26 agent
changes per run existed only as uncommitted edits inside those scratch trees,
which evaporate whenever the scratchpad is cleaned.

This directory is those changes, extracted before that happened.

## What was recovered

| | count |
|---|---|
| rows across both runs | 52 |
| evidence trees still reachable | **52** |
| evidence trees already gone | **0** |
| patches extracted | 51 |
| patches verified applying cleanly to their `base_sha` | **51 / 51** |
| rows whose agent changed nothing at all | 1 |
| rows labelled `false_confidence` (the wrong changes) | 15 |

Nothing was lost. The one row without a patch is not a missing patch — see
*The empty one* below.

## How they were extracted

Each row's tree was copied out of `/private/tmp` **before** anything was read
from it. Extraction then ran on the copies, never the originals:

1. `git add -A` — staging matters, because part of every change is *untracked*
   (new test files, new `changelog.d/` fragments). A bare `git diff` silently
   drops those, and a patch that quietly omits the agent's new test is worse
   than no patch.
2. `git diff --cached --binary <base_sha>`.
3. Verification: the patch is `git apply --check`ed against a pristine
   worktree created at `base_sha`. All 51 pass. A patch that is not known to
   apply is not evidence of anything.

`base_sha` is HEAD in every tree — the `declare the repo's own suite as a gate`
commit the harness writes on top of the upstream checkout.

## The empty one

`run2 / packaging-arbitrary-equality-intersection / a_native` has no patch
because **the agent changed nothing and claimed success anyway**. The row
records `claimed: true`, `held_out_passed: false`, `cell: false_confidence`.

This is recorded as `status: empty_diff` rather than dropped. It is a real
data point and arguably the sharpest one here — the degenerate wrong change,
the case `SPEC_BENCHMARK_V0`'s own limits section predicted in writing ("an
agent that exits 0 having done nothing is recorded as claiming success").

## run1 is contaminated, and the manifest says so per entry

Each entry carries `history_depth`. Run 1 trees carry **778–3697 commits** of
real upstream history — the leak `docs/corpus-2026-08-13.md` documents, where
upstream's own fix sat in `.git` of every tree. Run 2 trees carry **2**: the
truncated upstream commit plus the harness's gate commit.

Run-1 patches are still genuine agent output and are kept, but any use of them
as calibration data inherits that contamination. They are not interchangeable
with run-2 patches, and a reader who treats them as such will overstate
whatever they are measuring.

## The wrong changes cluster into five tasks

The 14 wrong changes that have patch content span only **5 distinct tasks** —
`attrs-frozen-exception-mutable-attrs`, `click-help-hint-shadowed-name`,
`marshmallow-constant-required`, `marshmallow-email-idn`, and
`click-zsh-completion-colons`. The other 8 of the 13 corpus tasks produced no
recorded wrong change in either pass.

This bounds what any offline calibration against this set can conclude:
coverage of the *tasks* is not coverage of the *wrong changes*, and a check
that covers nine tasks may still overlap very few of these five.

## Files

- `manifest.json` — `wringer.corpus.salvage.v1`. One entry per row, binding a
  patch to its row by `task` / `arm` / `run` / `base_sha`, with the patch's
  `sha256`, byte length, diffstat, `history_depth`, and whether it was verified
  to apply.
- `run1/<task>__<arm>.patch`, `run2/<task>__<arm>.patch`.
