# Durable runtimes — 30 September 2026

Phase 7 measured the graph kernel first, then, once the operator approved the
downloads, prototyped against a local Temporal service before fixing a design.
The baseline below is kept as it was measured. The prototype, the design it led
to and the qualification follow it.

## Baseline, before any durability interface

Measured on the phase 6 source before any durability interface or Temporal
adapter existed. This record maps decisions and effects. It does not qualify a
second runtime.

### Decisions and effects in the graph kernel

`scripts/restoration-phase7-measure.ts` runs the real graph kernel to completion
with a driver that records every call. The serial graph has a scope hold, a loop,
a check, a review hold and a delivery. The tournament graph has three attempts and
a tournament.

| Graph | Events | Reservations and routes (decisions) | Results (validated outcomes) | Markers before an effect | Human inputs | Effect records (prepared, send) |
| --- | --- | --- | --- | --- | --- | --- |
| Serial | 23 | 10 | 5 | 3 | 2 | 2 |
| Tournament | 30 | 14 | 7 | 5 | 1 | 2 |

The start event is the remaining one in each graph. A result is either an
effect's observation, validated by the kernel, or a hold or fork outcome the
kernel computes inline. Each dispatch and Send
reached the driver only after its durable marker; none arrived without one.

| Driver call | Role | Serial | Tournament |
| --- | --- | --- | --- |
| `preflight` | Effect-free check before a marker | 4 | 6 |
| `dispatch` | External effect: agent session, verifier, integration, tournament or delivery preparation | 3 | 5 |
| `observe` | Read-only reconciliation of retained outcomes | 4 | 6 |
| `send` | External publication | 1 | 1 |

### Replay

- **Identical recorded inputs and clock give byte-identical records.** Two runs
  with the same observations and a fixed clock wrote the same event chain.
- **A live clock changes only time.** With the same observations and a real
  clock, every decision, route and reservation matched. The times, the deadlines
  and the digests that bind them differed. They are recorded, not erased.
- **Reading is pure.** Replaying one history twice gave the same projection.

### What the kernel does besides deciding

A static inventory of the kernel: 9 clock reads through one injected clock, one
random id that names only a staging file, 4 durable writes and 6 reads through the
event store, 4 lock sections and 6 driver call sites. The decisions (`apply`,
`resolveRoute`, `expectedInput`) touch none of these. A second durable runtime
therefore needs the event store, the lock and the clock behind an interface, and
the decisions can move unchanged.

### The loop controller is a different shape

A contained loop is a stage machine that calls agent sessions, the verifier,
candidate capture and source preparation inline, with its own journal and
reconciliation. Replaying it inside deterministic workflow code would re-run
effects. It fits a second runtime only as one bounded activity per loop node,
resumed from its own journal.

### Prerequisites for the Temporal prototype

| Prerequisite | On this machine |
| --- | --- |
| Temporal CLI or local server | Absent |
| `@temporalio/*` SDK packages | Absent |
| Node.js | v24.19.0 |
| Bun as a Temporal worker | Not supported by the official TypeScript SDK, per its documentation |

The plan requires prototyping SDK compatibility and recovery against a local
Temporal service before committing to a design. That needs the Temporal CLI and
SDK downloaded. Downloads need the operator's explicit approval, so nothing was
downloaded and no Temporal behaviour was measured.

### Design inputs, pending the prototype

1. The durability boundary is the graph's event store, lock and clock. Decisions
   stay in one shared transition function.
2. A Temporal workflow would run the graph's decisions and call each driver
   operation as an activity. A loop node is one activity that resumes its own
   journal, never a replayed stage machine.
3. The adapter worker runs on Node; the Bun harness and local install stay
   unchanged.
4. Conformance compares decisions, reservations and outcomes from the same
   recorded observations across both backends, not byte-identical bundles from
   live runs.

### Not measured (at the baseline)

Any Temporal behaviour: SDK compatibility, worker loss, duplicate delivery,
timeouts, cancellation, version upgrades of retained histories and human holds on
a Temporal backend.

## Prototype, after approval

The operator approved two downloads: Temporal CLI 1.9.1 for macOS arm64 (43 MB,
its digest matched the release's published checksums) and the Temporal TypeScript
SDK 1.24.0 from npm. See the [prototype record](evidence/phase-7/prototype.json).

- **Runtime.** The SDK's worker runs on Node 24.19. Under Bun it starts with a
  warning that a V8 hook is missing; the SDK documents Node workers only, so the
  adapter runs on Node.
- **A lost worker during an effect.** With one attempt, killing the worker
  mid-effect gave a timeout. The workflow observed one start and no end, and
  nothing ran twice. With three attempts the same effect ran twice. Retries
  repeat external effects, so no effect may be retried.
- **The sandbox.** Temporal's deterministic workflow sandbox refused the unchanged
  kernel: its imports pulled in 11 Node modules. The sandbox has no
  `structuredClone`, `Buffer`, `process` or Node `crypto`; it has `TextEncoder`
  and a deterministic clock.
- **A latent defect.** The kernel's text checks and the plan and grant validators
  refused a record containing any credential the reading host's environment
  held, on replay as well as on write. A valid history could therefore become
  unreadable on another machine, and could never be replayed deterministically.
  Red-first tests reproduced it ([red](evidence/phase-7/red/replay-env-red.log),
  [plan and grant red](evidence/phase-7/red/plan-grant-replay-env-red.log)).

## Design

1. **A journal interface.** The decisions moved, unchanged, into
   `packages/scheduler/src/contained-kernel.ts`, which has no host imports. Storage,
   exclusion and admission of the plan and grant belong to a `GraphJournal`. The
   local file journal is `packages/scheduler/src/contained.ts`, with the same
   public functions and the same record bytes.
2. **Replay reads the record, not the host.** A retained record is checked for
   credential shapes only. The writing host's credentials are refused when a
   decision, Send, hold reason, plan or grant is written, through a write-time
   screen and an `admit` purpose that the replay path never uses.
3. **An effect route for an external controller.** `wringer-drive graph effect`
   runs one driver operation for the durable marker the state directory records,
   and claims a dispatch or Send once. `wringer-drive graph init` admits a graph
   with no effect.
4. **The Temporal adapter**, a Node worker in `adapters/temporal`. The workflow
   runs the unchanged kernel over a journal whose durability is Temporal's history.
   Each event is mirrored, create-once and in the local byte format, into the state
   directory before the kernel acts on it, and a divergent event stops the workflow.
   Each effect is one activity with one attempt and a heartbeat, running the effect
   route. Decisions and Sends are updates whose validators refuse before anything
   enters the history. Credentials are screened by an activity on the worker host.
   `node:crypto` is replaced in the sandbox by a pure SHA-256 compared with Node's.

## Qualification

All against a local Temporal dev server with deterministic fixtures:

- **Conformance.** The local journal ran six scenarios with a fixed clock and a
  deterministic driver: graph versions 1 to 4, a rejected review and a failed
  check. Its observations were captured. Replayed through the Temporal adapter with
  the same clock, every scenario wrote **byte-identical event files**. On
  Temporal's own clock the serial and tournament graphs made the same decisions,
  reservations and outcomes, differing only in times and the digests that bind
  them.
- **Failure modes.** A worker killed mid-dispatch, and a dispatch that stopped
  heartbeating, each left the effect uncertain. It was observed afterwards and
  never started again, and the chain matched the local journal's decisions.
  Cancellation left the effect uncertain, and a new workflow from the directory
  only observed it. Stale, forged, duplicate and credential-bearing decisions
  recorded nothing; a refused one left no trace in Temporal's history. A second
  controller stopped the workflow at the first divergent event with nothing
  overwritten. A tampered plan or grant was refused before any effect. A preflight
  refused through the real CLI left the node reserved.
- **Versions.** Histories recorded from the current workflow code are committed
  and replay. An unguarded change to the workflow's commands fails replay; the
  same change under `patched()` replays and finishes an open workflow held at a
  decision. A history the local journal advanced to a hold continued on Temporal,
  byte-identical to a local run. Continue-as-new carried the history into a new
  run without repeating an effect.
- **The compiled walkthrough** (`scripts/graph-temporal-distribution.ts`). The
  public binary planned, granted and admitted a graph. The adapter's command line
  ran the worker and answered the holds, refusing a stale decision and a wrong
  Send. Effects went through a separately compiled fixture binary that wraps the
  real driver. The public binary then read, resumed without effect, and exported
  the mirrored directory; the Node-only reader and a fresh clone of the review
  branch audited it ([record](evidence/phase-7/walkthrough.json)).

Full local validation passed all 42 stages: 1,433 pass, one Linux-only skip, zero
fail and 13,341 assertions. The adapter suite passed 26 of 26 in 80 seconds
([validation record](evidence/phase-7/local-validation.json),
[adapter log](evidence/phase-7/adapter-tests.log)).

## Reversions

`scripts/restoration-phase7-reversions.ts` removes each guard alone in an isolated
copy, watches the named test fail, restores it and watches it pass. It covers the
journal, the effect route, the workflow, the worker and the sandbox digest. Adapter
cases run with Node against a private dev server.

- **Attempt 1:** 24 of 26 probes were red, and every control and restoration
  passed ([record](evidence/phase-7/reversions-attempt1/reversions.json)). Two
  were not red:
  - Removing the plan's own admission check changed nothing, because the grant's
    validator re-checks the plan against the same host credentials. That probe was
    dropped as redundant.
  - A dispatch on a reserved node without its marker had no test; one was added.
- **Attempt 2** was interrupted, a harness error rather than a behaviour result.
  With the divergence guard removed, its test failed as intended but its Node
  process never exited, most likely held by the workflow's pending result poll.
  It was stopped after 18 minutes
  ([kept](evidence/phase-7/reversions-attempt2-interrupted/run.log)). The harness
  now bounds each Node test at four minutes and forces exit, as does the adapter's
  `npm test`.
- **Attempt 3** caught 24 of 25, and every control and restoration passed
  ([record](evidence/phase-7/reversions/reversions.json)). The miss was
  misclassified. With the divergence guard removed, the workflow spun on its wait
  condition without completing a workflow task, so the update never returned and
  the test timed out. Node reports a timed-out test as cancelled; the harness only
  counted failures. It now counts a cancelled test as not passing, and a
  follow-up of that probe was red and restored green
  ([follow-up](evidence/phase-7/reversions-followup/reversions.json)).

All 25 probes of the final set were caught.

## Not measured

- A production Temporal cluster, Temporal Cloud, TLS or namespaces other than a
  dev server's default.
- Live agents, real containment or real publication under the adapter; every
  effect here was a deterministic fixture.
- The crash window between a mirrored dispatch marker and the scheduling of the
  dispatch activity. Temporal records whether it scheduled the effect, but these
  tests lose the worker during the effect, not in that window.
- Graphs near Wringer's own size bounds, which exceed Temporal's default 2 MB
  payload limit.
- Any reliability or throughput benefit of a Temporal controller over the local
  journal.

## Earlier reversion scripts

The kernel's decisions moved into `contained-kernel.ts`, the graph's pure helpers
into `graph-shape.ts`, and three validators gained an options parameter. As a
result, the reversion scripts of phases 3, 4, 6 and 8 no longer find every target
in the current source. They stop at their first missing target: phase 3 at
`compiler-declaration-version`, phase 4 at `compiler-join-reserves-branch-checks`,
phase 6 at `compiler-tournament-needs-version-3` and phase 8 at
`compiler-delegate-reservation`. They remain the records of their own releases and
run at those tags. The phase 5, phase 4 Git-compatibility and phase 9 scripts still
find every target.
