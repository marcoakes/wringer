# Playbook proposals from evidence

A **playbook** is how a coding agent works on one kind of task in one repository: an
always-on instructions file, on-demand skills, small scripts. Wringer can have an agent
*propose* a better playbook from what earlier attempts actually did, and then test the
proposal against the current way of working. Nothing changes on the proposer's word.

This page covers the tree playbook (`wringer.playbook.v2`), how it reaches the worker,
and the proposer that writes one. For the comparison that decides whether a proposal
helps, see [EXPERIMENTS.md](EXPERIMENTS.md).

## A playbook tree

A tree lives in the repository at `wringer/playbooks/<id>/`, committed like any other
source, with a manifest listing every file and its digest:

| File in the tree | Kind | Where the worker finds it (claude-code / codex / generic) |
| --- | --- | --- |
| `CLAUDE.md`, `AGENTS.md` or `PLAYBOOK.md` | always-on, exactly one, at most 8 KiB | the repository root |
| `skills/<name>/SKILL.md` | skill | `.claude/skills/<name>/` · `.agents/skills/<name>/` · `.playbook/skills/<name>/` |
| `skills/<name>/scripts/<file>` | script | inside the skill's directory |
| `scripts/<file>.sh` (or `.mjs`, `.js`, `.ts`, `.py`) | script | `scripts/wringer/<file>` |
| `agents/<name>.md` | subagent (claude-code only) | `.claude/agents/<name>.md` |
| `NOTES.md`, `notes/…` | notes | not materialised |

Validation refuses, before anything runs:

- a second always-on file, or one over 8 KiB;
- a skill whose name the always-on file never mentions (it would never trigger);
- front matter carrying anything but `name` and `description`: **no hooks, tool grants
  or permissions** (ruling R-B);
- a reference to a script the tree does not contain, or to a tree path instead of its
  materialised path;
- a script that does not parse (`sh -n`, Bun's parser; Python only when the plan
  declares a `python` tool);
- a detected credential, more than 64 files or more than 256 KiB.

A version 6 plan selects a tree. Its `playbook` names the manifest, the adapter
`surface`, every file with its digest, and any `replace` paths. Every listed file is
added to the plan's protected paths, so a worker cannot edit its own playbook. Get the
exact selection from a committed tree with:

```sh
wring experiment select-tree --source CHECKOUT --manifest wringer/playbooks/ID/manifest.json
```

Version 6 plans run through `wringer-drive`, replicate sets and registered comparisons.
An assistant workspace still uses a version 1 to 5 profile in this release.

## How the worker gets it

The committed tree is inert. Before each worker session the controller makes an
**overlay commit**: the worker's base (the approved source, or the previous candidate),
plus the tree's files at their active paths, written with a fixed identity and date so
the same base and tree always give the same commit. Only the worker clones the
overlay. The judge and the verifier never see it.

- A tracked file at an active path (your team's own `CLAUDE.md`, say) is refused unless
  the plan names it in `playbook.replace`. A replacement applies to the worker's clone
  only; the judge still reads your file.
- The worker's change is read against the overlay. A change to any overlay path stops
  the worker (`playbook-overlay-edited`), with no candidate. The change is then applied
  to the base itself. A change that only applies with the overlay is stopped, never
  silently rebased.
- `wringer.playbook-materialisation.v1` records each overlay before the worker's
  request, and every reader of the journey re-checks it in Git: one parent, the base;
  differences only at the active paths; exactly the approved bytes.
- The worker's prompt names where its playbook is and the digests. It does not repeat
  the playbook's content.

## Proposing a tree

The proposer reads evidence, not a summary. From a [replicate set](REPLICATES.md):

```sh
wring experiment evidence --state PROPOSAL_DIR --replicates REPLICATE_DIR
wring experiment prepare-proposal --state PROPOSAL_DIR --input PROPOSAL_GRANT.json --output proposal-request.json
wring experiment propose --state PROPOSAL_DIR --request proposal-request.json --yes
wring experiment proposal-result --state PROPOSAL_DIR
```

`evidence` builds `wringer/evidence/` offline from the validated journals:

| Path | What it holds |
| --- | --- |
| `TASK.md` | the intent, quoted, with criteria, checks and scope |
| `REPLICATES/<label>/trajectory.md` | what each attempt did: numbered lines from [loop trajectories](LOOP_INSPECTION.md) |
| `REPLICATES/<label>/produced.md` | what came of it: checks, judgement, the change |
| `DIVERGENCE.md` | where the attempts disagreed |
| `PLAYBOOK/` | today's playbook, or `NONE.md` |
| `LESSONS/` | what earlier comparisons established (none yet) |
| `MISSION.md` | the proposer's job |

Before anything is written, every file is scanned **by name and by content** for
held-out item identities, oracle digests and denied paths (`labels.json`,
`oracle.json`, `held-out/`, plus any you add with `--fence` or `--held-out-from`). A
match refuses the build and names the file and the record it was read from. Fix the
leak; the fence is never widened.

`PROPOSAL_GRANT.json` names `{plan, proposalId, surface, dimension, prediction, actor,
expiresAt, maxTurns, wallClockSeconds}`. The proposer's own plan may be contained or
trusted-local (ruling R-A) and may write only `wringer/proposals/<proposalId>`. The
session clones the approved source with the evidence overlaid. Its prompt points at the
evidence and states the rules:

1. Every edit traces to a moment in a trajectory. `NOTES.md` gives each changed file a
   line `<path>: <label> line <N> — why`, citing a real, non-empty line.
2. Prefer the cheapest lever: a script, then a skill, then a subagent; always-on prose
   is the most expensive.
3. A playbook changes how the work is done, never the deliverable's shape.
4. `KEEP_BASE` is a real answer: `NOTES.md` alone, first line `KEEP_BASE`.

The result is `wringer.playbook-proposal-result.v2`, with one of three statuses:

- `proposed`: a tree that passed every validation above, and whose changed files are all
  cited.
- `no-change-proposed`: `KEEP_BASE`, still one spent reservation.
- `stopped`: with the reason. Examples are writing outside the proposal directory, an
  untriggered skill, or an uncited change.

## From proposal to comparison

```sh
wring experiment export-proposal --state PROPOSAL_DIR --into CHECKOUT
git -C CHECKOUT add wringer/playbooks/ID && git -C CHECKOUT commit -m "Proposed playbook, for comparison"
wring experiment select-tree --source CHECKOUT --manifest wringer/playbooks/ID/manifest.json
```

`export-proposal` refuses to overwrite a playbook. Register a comparison whose arms are
both version 6 plans at that commit, identical except the playbook. Add the printed
`protect` paths to the baseline arm too. Such a comparison is recorded by the
`experiment-plan.v2` and `experiment-registration.v2` siblings. Collect and evaluate it
as in [EXPERIMENTS.md](EXPERIMENTS.md).

## Limits

- The proposer is one session. A different-dimension variant, or a composer, is a later
  experiment *about the proposer*, not a vote.
- Fixture proposals and fixture comparisons test the mechanism only. No proposal has been
  written by a live agent here, and no improvement is claimed until a registered
  comparison runs live and is published, win or lose.
- Tool output appears in a trajectory only where the adapter carried it
  ([measured](../improvement/PHASE_A_MEASUREMENTS.md)).
