# Serial graphs of contained loops

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

- Serial only in this release: no fan-out, fan-in or integration node yet.
- No read-only MCP graph tool yet; the CLI is the interface.
- A crash between the dispatch marker and a child's first durable write leaves
  the node `uncertain`. No external effect can have happened in that window, but
  this release has no command to re-dispatch it; start a new graph run.
- A check whose verifier fails without recording an observation (for example,
  the container service stops mid-run) also stays `uncertain`; graphs have no
  verifier-retry route yet. A loop child keeps its own `--retry-*` recovery.
- The graph actor is recorded, not authenticated.
- The packaged walkthrough uses deterministic worker, judge and check
  observations from a separately compiled fixture binary, a real Git source and a
  local bare origin. It measures the mechanism, not live agent convergence, real
  containment, independent human acceptance or any benefit over a single job.

Contracts: [`contained-graph-plan-v1`](../../schema/contained-graph-plan-v1.schema.json),
[`authority`](../../schema/contained-graph-authority-v1.schema.json),
[`event`](../../schema/contained-graph-event-v1.schema.json),
[`status`](../../schema/contained-graph-status-v1.schema.json) and
[`export`](../../schema/contained-graph-export-v1.schema.json).
The retired host graph format stays readable with `wring graph show|status|explain`.
