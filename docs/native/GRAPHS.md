# Graphs of contained loops

A graph lets you express a whole piece of engineering as one inspectable,
resumable workflow: agree the scope, build in a contained loop, check the exact
candidate afresh, route on the typed outcome, review that candidate, then prepare
a delivery that still needs its own Send.

```text
scope (hold) → build (loop) → verify (check) → route → review (hold) → ship (delivery) → done
                                                   └── otherwise → fail
```

Each step is one of five node kinds. Every executable step runs through the same
contained services as a single job; the graph adds order, one aggregate
allowance and typed handoff between steps. It adds no host execution path.

| Node | What it does | Outcomes |
| --- | --- | --- |
| `loop` | Runs one ordinary contained journey (worker → checks → judge → repair) from a pinned execution plan | `ready`, `stopped` |
| `check` | Re-runs the loop's pinned acceptance checks on the exact candidate in a fresh contained verifier | `passed`, `failed`, `unavailable` |
| `router` | Selects the next node from its input's typed outcome; never from prose | `routed` |
| `human-hold` | Waits for a decision bound to the graph's exact revision and held input | `continued`, `rejected` |
| `delivery` | Prepares the portable delivery for the exact candidate; publication needs a separate Send | `delivered` |

## Run one

```sh
wringer-drive graph plan examples/graphs/serial-repair/graph.yaml
wringer-drive graph authority examples/graphs/serial-repair/graph.yaml \
  --actor 'YOUR NAME' --expires '2026-10-01T18:00:00Z' --output graph-authority.json
wringer-drive graph run examples/graphs/serial-repair/graph.yaml \
  --authority graph-authority.json --state graph-state
wringer-drive graph status --state graph-state
```

`status` prints every node, its outcome and candidate, the reserved allowance and
the exact next command. At a hold, that command already carries the current
revision and the digest of the input being held:

```sh
wringer-drive graph decide --state graph-state --node review \
  --revision REVISION --input INPUT_SHA256 --continue --by 'YOUR NAME' --note 'WHAT YOU CHECKED'
wringer-drive graph resume --state graph-state
wringer-drive graph send --state graph-state --node ship \
  --revision REVISION --prepared PREPARED_SHA256 --by 'YOUR NAME' --note 'WHY THIS MAY BE PUBLISHED'
wringer-drive graph export --state graph-state --output graph-evidence
node graph-evidence/read-bundle.mjs graph-evidence
```

A loop's `plan:` names an execution-plan file beside the graph. `graph plan`
compiles it and pins the result into the graph; the repository's TypeScript is
never evaluated on the host. `--source-bundle FILE` attaches a Git bundle as the
root source transport for a local-only repository; each child still verifies the
pinned commit.

## Parallel branches

A version 2 graph adds `fork` and `join`. A fork opens two to eight branches at
once, up to the graph's declared `parallelism`. Each branch is a private region:
it reads only the fork's input and its own nodes, it must produce its own
candidate, and it can end only at its join or `fail`. The join waits for every
branch.

```text
split (fork) ─┬─ reader (loop) ─┐
              └─ writer (loop) ─┴─ merge (join) → after → review (hold) → ship (delivery)
```

```sh
wringer-drive graph plan examples/graphs/parallel-repair/graph.yaml
```

The join fetches each branch's exact candidate and merges them in declared order
against the fork's source. It uses a fixed identity and time, so the same branches
always integrate to the same commit. Merging writes Git objects only and needs Git
2.38 or later; with Git 2.38 or 2.39 the join accepts Git's own merge base only
when it is exactly the fork's source. It then runs a fresh contained verification
of the merged candidate against **every** branch plan. Its outcome is typed:

| Join outcome | Meaning |
| --- | --- |
| `integrated` | The merge is clean and every branch plan's pinned checks pass on it |
| `failed` | The merge is clean but some branch plan's checks fail on the merged tree |
| `conflict` | The branches edit the same lines; there is no merged candidate |
| `unavailable` | A verification could not run |

Only `integrated` follows the join's `then`. A router over the join can send
`failed` to a repair loop that starts from the merged commit, or `conflict` to a
human hold. A clean textual merge never inherits the branches' passes. In phase 4's
measurement, two candidates that each passed their own check merged cleanly and
then failed the shared check.

A failure in any branch ends the graph at once; nodes still open in other branches
are recorded as cancelled, never resumed. Every branch preflight runs before any
dispatch marker, so one refusal leaves every branch reserved. A delivery of an
integrated candidate publishes an evidence commit on top of the exact merged code
that carries this graph's own portable export. A fresh clone checks it with
`node .wringer/graph-deliveries/ID/read-bundle.mjs .wringer/graph-deliveries/ID`.

## Tournaments

A version 3 graph can close a fork with a `tournament` instead of a join. The
branches are independent attempts at the same task. A tournament does not merge
them. It tries to falsify every attempt and selects only among the survivors.

```text
split (fork) ─┬─ first  (loop) ─┐
              ├─ second (loop) ─┼─ pick (tournament) → after → review (hold) → ship (delivery)
              └─ third  (loop) ─┘
```

```sh
wringer-drive graph plan examples/graphs/tournament/graph.yaml
```

1. **Eligibility.** An attempt is eligible only if its branch ended with a
   candidate that passed its own checks. A branch that stops for good arrives
   disqualified and does not end the graph. A branch whose child stopped with a
   recovery available is a hold, as for any loop, and the tournament waits.
2. **Prosecution.** One contained session runs the declared prosecutor plan,
   which may write only `wringer/challenges.json`. It sees every eligible
   attempt's change as a patch, labelled by tree id rather than branch order. It
   proposes executable challenges; each cites a requirement the attempts declare,
   and its files live under `wringer/challenges/`.
3. **Validation.** Each challenge runs on every trusted control first. These are
   known-correct commits named in the plan and carried by the graph's root
   source bundle. A challenge that fails a control is `spurious` and is dropped.
   Without a control, challenges are `advisory` and disqualify nobody.
4. **Replay.** The frozen, valid challenges run on every eligible attempt's
   exact tree in a contained verifier, with the challenge files overlaid. One
   reproduced valid challenge disqualifies an attempt. A defect every attempt
   shares is reproduced on each of them; nothing is decided by a vote.
5. **Selection.** One survivor is `selected`. Several survivors tie: the
   tournament returns `no-winner`, or, when `tie: tree-order` is declared, selects
   the survivor with the smallest tree id. That choice is arbitrary, but it does
   not depend on branch order. No survivor is `no-winner`. A prosecutor or run
   that cannot complete makes the tournament `unavailable`.
6. **Assessment.** The selection is written before the final evaluator runs.
   The evaluator's gates are pinned in the plan, and no attempt or prosecutor
   ever sees them. It assesses every eligible attempt for the record and never
   changes the selection.

Phase 6's measurement is why ties need a rule. With three attempts per task,
correct alternatives survive together. Requiring a unique survivor never
selected anything. The tree-id rule selected a correct survivor in every order of
the two tasks that had one, and nothing in the two that did not.

The allowance reserves every attempt's sessions, the prosecutor session, one
validation run per control, and one challenge run and one evaluation per attempt.
A delivery of the selected attempt publishes an evidence commit on its exact code
that carries this graph's export. The Node reader recomputes the selection from
the recorded runs and refuses a record that does not match them.

## What the graph guarantees

- **Refused before any effect.** Cycles, unreachable nodes, undeclared outcomes,
  an input that is not available on every path, a check or hold with no
  contained candidate, a path to `done` that skips a required node, a loop that
  can write another leaf's acceptance inputs, an allowance too small to reserve
  every declared leaf, credentials in the declaration, and publication to a
  default branch or a URL carrying credentials.
- **Allowance before effects.** The root budget must cover every declared loop's
  sessions and verifier attempts, including mutually exclusive branches. Each
  node's share is durably reserved before its effect, and a separate dispatch
  marker is durable before the effect starts.
- **No silent repeat.** After a marker, resume only reconciles retained evidence.
  A child that completed before the parent recorded it is picked up without a
  second run. Missing evidence is an explicit `uncertain` state, never a second
  paid call or push. An effect-free preflight (runtime present, child derivable,
  publication target reachable) runs before the marker, so a missing container
  or branch leaves the node reserved and resumable instead of uncertain.
- **Exact handoff.** Only a loop creates a candidate. A check, hold or delivery
  must act on exactly its input candidate. A loop fed by an earlier candidate
  starts from that commit and pinned plan; its acceptance inputs are compared
  entry for entry with the graph root before a child is derived.
- **Failure stays failure.** A node's `then` is followed only on its success
  outcome. A failed required node ends the graph at once, before any later hold,
  preparation or Send could act on it. A human decision cannot convert it.
- **One clock.** The root wall clock and the grant's expiry bound the graph; each
  child's plan and authority are clipped to what remains. An expired graph can
  still be inspected and reconciled; it starts no new work.
- **Separate Send.** Graph authority never grants Send. A Send binds the revision
  and the prepared delivery's digest, is recorded before publication, is never
  reissued, and reconciles a lost confirmation read-only from the remote branch.

## Where state lives

```text
graph-state/plan.json, authority.json   immutable contract and grant
graph-state/events/NNNN.json            hash-chained, append-only history
graph-state/children/NODE/state         each loop: an ordinary contained journey
```

A child is a normal contained state directory, so `wringer-drive status`, `loop`,
`show`, `review` and `resume --state graph-state/children/NODE/state` all work on
it. If a child stops with a recovery available under its own authority, or waits
for its own human review, the graph reports a hold that names the child's next
command. A graph decision never satisfies a child's own human criteria.

## Evidence

`graph export` writes the exact plan, grant and events, a portable summary per
node bound to its recorded result, each delivery's existing evidence envelope, and
`read-bundle.mjs`. The reader uses Node built-ins only. It checks every carried
byte, the event chain, that every event belongs to this graph, that each node's
evidence is the one its result recorded, and that the delivered bundle is the
controller journal state its loop recorded. Child controller journals and raw
verifier output are named omissions. The plan is carried verbatim because its
digest binds the grant; a graph that publishes to a local bare origin therefore
names that path, so share exports of graphs that publish over HTTPS or SSH.

## Limits

- No nested forks, no delivery inside a branch, and one repository per graph.
- A tournament needs trusted controls for its challenges to count; it has no
  way to judge a challenge without one. It runs one prosecutor session, and its
  selection is only as good as the challenges that session writes.
- No evidence yet that a tournament beats one attempt on real tasks; the
  measurement is on constructed candidates.
- A join verifies with each branch plan's pinned checks. It does not run a model
  judge of the integration; review it at a human hold or route it through a loop.
- A `conflict` has no automatic repair: route it to a hold or `fail`.
- No read-only MCP graph tool yet; the CLI is the interface.
- A crash between the dispatch marker and a child's first durable write leaves
  the node `uncertain`. No external effect can have happened in that window, but
  this release has no command to re-dispatch it; start a new graph run.
- A check whose verifier fails without recording an observation (for example,
  the container service stops mid-run) also stays `uncertain`; graphs have no
  verifier-retry route yet. A loop child keeps its own `--retry-*` recovery.
- The graph actor is recorded, not authenticated.
- The packaged walkthroughs use deterministic worker and judge observations from a
  separately compiled fixture binary, a real Git source and a local bare origin;
  the parallel walkthrough's verifier really runs each pinned check on the exported
  tree, and the tournament walkthrough's verifier runs every challenge and evaluator
  gate the same way. They measure the mechanism, not live agent convergence, real
  containment, independent human acceptance or any benefit over a single job.

Contracts: [`contained-graph-plan-v1`](../../schema/contained-graph-plan-v1.schema.json),
[`v2`](../../schema/contained-graph-plan-v2.schema.json) and [`v3`](../../schema/contained-graph-plan-v3.schema.json),
[`authority`](../../schema/contained-graph-authority-v1.schema.json),
[`event`](../../schema/contained-graph-event-v1.schema.json), [`v2`](../../schema/contained-graph-event-v2.schema.json) and [`v3`](../../schema/contained-graph-event-v3.schema.json),
[`status`](../../schema/contained-graph-status-v1.schema.json), [`v2`](../../schema/contained-graph-status-v2.schema.json) and [`v3`](../../schema/contained-graph-status-v3.schema.json),
[`export`](../../schema/contained-graph-export-v1.schema.json), [`v2`](../../schema/contained-graph-export-v2.schema.json) and [`v3`](../../schema/contained-graph-export-v3.schema.json),
[`tournament`](../../schema/contained-graph-tournament-v1.schema.json) and its [`assessment`](../../schema/contained-graph-tournament-assessment-v1.schema.json).
The retired host graph format stays readable with `wring graph show|status|explain`.
