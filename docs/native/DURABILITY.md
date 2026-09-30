# Durable runtimes for contained graphs

A contained graph's kernel makes every decision: reservations, routes, holds,
Sends and the refusals between them. A **journal** makes those decisions durable.
Wringer has two, and both run the same kernel code.

| Journal | Where the history lives | Controller | Use it for |
| --- | --- | --- | --- |
| Local (default) | Create-once event files in the graph's state directory, under a directory lock | `wringer-drive graph run` and `graph resume`, one process at a time | Everything, on one machine |
| Temporal adapter (optional) | Temporal's workflow history, mirrored event by event into the same state directory | A Node worker polling a Temporal task queue | A long-lived controller that survives a lost worker process, waits on holds with durable timers and takes decisions and Sends as workflow updates |

The Temporal adapter is an adapter, not a second harness. It lives in
[`adapters/temporal`](../../adapters/temporal/README.md), is not part of the
native archives, and the Bun harness does not need it.

## What both journals guarantee

These are tested properties, on deterministic fixtures:

- **The same decisions.** Captured observations replayed through both journals
  with the same fixed clock produce byte-identical event files, for graph
  versions 1 to 4, a rejected review and a failed check. On Temporal's own clock
  every decision, reservation and outcome matches; only times and the digests
  that bind them differ.
- **Every effect after its durable marker, at most once per marker.** A lost or
  timed-out effect is left uncertain and only observed afterwards, never started
  again.
- **Holds bind the exact revision and input.** A stale, forged, duplicate or
  credential-bearing decision records nothing.
- **A retained history reads the same on every host.** Credentials the writing
  host holds are refused when a record is written; replaying a record never
  consults the reading host's environment.

## The local journal

Nothing to install. `wringer-drive graph run` admits the graph and advances it;
`graph resume` continues it; `graph status`, `decide`, `send` and `export` work on
the directory at any time. See [graphs](GRAPHS.md).

## The Temporal adapter

Requirements, as tested: Node.js 24 (22.18 or later is required), the pinned
Temporal TypeScript SDK 1.24.0, and a Temporal service. The tests and the
walkthrough use `temporal server start-dev` from Temporal CLI 1.9.1 on loopback.
No Temporal Cloud or TLS connection is offered or claimed.

```sh
cd adapters/temporal && npm ci --ignore-scripts && cd ../..
wringer-drive graph plan graph.yaml
wringer-drive graph authority graph.yaml --actor 'YOUR NAME' --expires 2026-10-01T18:00:00Z --output authority.json
wringer-drive graph init graph.yaml --authority authority.json --state /srv/wringer/graph-1
# On the host that holds /srv/wringer/graph-1, with wringer-drive on PATH:
node adapters/temporal/src/cli.mjs worker --task-queue wringer-graphs
node adapters/temporal/src/cli.mjs start --state /srv/wringer/graph-1 --task-queue wringer-graphs --workflow-id graph-1
node adapters/temporal/src/cli.mjs status --workflow-id graph-1
node adapters/temporal/src/cli.mjs decide --workflow-id graph-1 --node review --revision SHA --input SHA --continue --by 'YOUR NAME' --note 'Why'
node adapters/temporal/src/cli.mjs send --workflow-id graph-1 --node ship --revision SHA --prepared SHA --by 'YOUR NAME' --note 'Why'
```

`graph init` admits the graph with no effect. `start` hands the directory's
retained history to a workflow; `status` prints the revision and each hold's
input or prepared digest that `decide` and `send` must bind. At any time,
`wringer-drive graph status` and `graph export` read the mirrored directory.

How it works:

- **Decisions** run in Temporal's deterministic workflow sandbox. The kernel has no
  host imports, so the sandbox bundles it unchanged. Its one digest routine is
  substituted there by a pure SHA-256 that tests compare with Node's.
- **Every event** is mirrored, create-once and in the local byte format, into the
  state directory before the kernel acts on it. A second controller advancing
  the same directory is refused at its first divergent event: the workflow stops
  and nothing is overwritten.
- **Every effect** is one activity that runs
  `wringer-drive graph effect OPERATION --state DIR --node ID`. A dispatch or Send
  runs only for the durable marker in that directory, and claims it once; an
  observation only reads. Dispatch and Send activities have one attempt,
  heartbeat while they run, and are bounded by the graph's own wall clock. A lost
  worker or a timeout leaves the effect uncertain; the workflow then observes it.
- **Credentials** in a decision, a Send or a child's hold reason are screened
  against the worker host's environment by an activity, because workflow code
  cannot see an environment.
- **Cancellation** stops the effect in flight and leaves it uncertain. A new
  workflow started from the directory observes it and never starts it again.
- **Long runs** continue as new with the retained events when Temporal suggests
  it.

### Versioning

The workflow's command sequence is versioned by `WORKFLOW_REVISION` and Temporal's
`patched()`. Histories recorded from the current code are committed under
`adapters/temporal/test/histories/` and must replay against every later revision.
A test shows that an unguarded change to the commands fails that replay and that
the same change under `patched()` passes and continues an open workflow.
Wringer's own graph and event versions are unchanged: a Temporal run writes the
records a local run writes.

### Limits

- Effects and their evidence stay in the state directory on the worker host. Run
  one worker per directory, or put the directory on storage every worker shares.
  Temporal makes the controller durable; it does not move evidence.
- The workflow's input carries the graph, its grant and its retained events. The
  test graphs measured 4–11 KiB at start and 16–30 KiB with every event, well
  under Temporal's default 2 MB payload limit. Wringer's own bounds (a 2 MiB graph,
  1 MiB events) are larger; a graph near them would be refused by Temporal. That
  has not been measured.
- The adapter has been tested only on a local dev server with deterministic
  fixtures and synthetic role replies. Live agents, real containment, a
  production cluster, Temporal Cloud and any reliability benefit over the local
  journal are unmeasured.
- The Bun runtime is not supported by the Temporal SDK as a worker; the adapter
  runs on Node.
