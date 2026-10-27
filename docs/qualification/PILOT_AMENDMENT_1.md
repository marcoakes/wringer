# Pilot qualification — amendment 1: a proposer-written playbook

Registered 27 October 2026, before any of its trials has run. This page and
[pilot-amendment-1.json](pilot-amendment-1.json) add one secondary comparison to the
[pilot registration](PILOT_REGISTRATION.md). The JSON cites the registration's
digest and carries its own; a test refuses either if it changes. Nothing here is a
result.

## The comparison

| Comparison | Arm A | Arm B | Tasks |
| --- | --- | --- | --- |
| No playbook versus proposed playbook | The builder with no worker playbook | The builder with a playbook tree written by Wringer's proposer | The pilot's 7 ordinary repair tasks, 2 repetitions per arm |

Both arms are version 6 plans at the same commit with the same protected paths;
they differ only in the worker playbook. Everything else the registration fixes
applies unchanged: the same builder, model and resource ceilings in both arms; the
primary endpoint (tasks accepted review-ready by an independent reviewer within
budget); the minimum useful effect; the regression limits; the exact sign test with
its bootstrap interval; and the fixed-sample rule.

## How the proposal is made

1. Replicate sets of development tasks from the same repositories, never the seven
   pilot tasks.
2. `wring experiment evidence`: the seven tasks' identities and source trees are in
   its fence, so evidence that names one is refused before any proposer reads it.
3. One separately granted proposer session and one proposal iteration, frozen before
   the first comparison trial. A `KEEP_BASE` answer ends the comparison before any
   trial, and is reported as such.
4. The proposal is exported, committed and selected with `select-tree`. The
   comparison decides nothing beyond this report; no playbook is adopted for future
   work because of it.

## Limits

Seven tasks at two repetitions is pilot-sized. Live runs need a signed-in builder
and the pilot's prerequisites. Until it runs and is reported, no improvement from a
proposer-written playbook is claimed.
