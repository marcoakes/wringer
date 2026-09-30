# Durable runtime baseline — 30 September 2026

Measured on the phase 6 source before any durability interface or Temporal
adapter existed. This record maps decisions and effects. It does not qualify a
second runtime.

## Decisions and effects in the graph kernel

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

## Replay

- **Identical recorded inputs and clock give byte-identical records.** Two runs
  with the same observations and a fixed clock wrote the same event chain.
- **A live clock changes only time.** With the same observations and a real
  clock, every decision, route and reservation matched. The times, the deadlines
  and the digests that bind them differed. They are recorded, not erased.
- **Reading is pure.** Replaying one history twice gave the same projection.

## What the kernel does besides deciding

A static inventory of the kernel: 9 clock reads through one injected clock, one
random id that names only a staging file, 4 durable writes and 6 reads through the
event store, 4 lock sections and 6 driver call sites. The decisions (`apply`,
`resolveRoute`, `expectedInput`) touch none of these. A second durable runtime
therefore needs the event store, the lock and the clock behind an interface, and
the decisions can move unchanged.

## The loop controller is a different shape

A contained loop is a stage machine that calls agent sessions, the verifier,
candidate capture and source preparation inline, with its own journal and
reconciliation. Replaying it inside deterministic workflow code would re-run
effects. It fits a second runtime only as one bounded activity per loop node,
resumed from its own journal.

## Prerequisites for the Temporal prototype

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

## Design inputs, pending the prototype

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

## Not measured

Any Temporal behaviour: SDK compatibility, worker loss, duplicate delivery,
timeouts, cancellation, version upgrades of retained histories and human holds on
a Temporal backend.
