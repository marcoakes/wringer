# Serial graph baseline — 29 September 2026

Measured after alpha.25 was published and verified, from commit
`599ea5f3694035822d214229f6e3bd212dabe455`. This record precedes the
contained graph contract. It does not qualify graph execution.

## Observations

The four historical graph tests passed, with 21 assertions. Their worker writes
`result.txt` directly into a host Git working tree. Public `dist/wring graph run
--json` exits 2 with the explicit retired-execution refusal before loading a
graph. Historical fleet tests were filtered out of this measurement.

The old scheduler validates a DAG and replays its hash-chained ledger, including
human parking. It invokes the old engine's `run(repo, ...)` and `deliver(repo,
...)`. A loop writes its outcome's prose into string routing state. `finalRun`
selects the most recent loop evidence; there is no typed candidate handoff or
newly approved source derivation between contained children. Its root allowance
is wall clock only. Node limits narrow old loop limits, without reserving an
aggregate role/verifier allowance before effects. These semantics cannot be
made contained by changing the public command's dispatch target alone.

The current contained controller already provides source-bound plans and
authority, durable role/verifier reservations, identity-bound observation
reconciliation, source snapshots and independent worker/judge storage. An
executable no-model probe changed only the source commit of a compiled plan:

| Supplied records | Observation |
| --- | --- |
| New source, old authority | Refused: authority belongs to another source/plan |
| New source and authority, old environment map | Refused: environment map is stale |
| Role dispatch count across both probes | Zero |

Consequently, graph handoff must be an explicitly approved derivation of a new
child plan from a validated predecessor source. It must retain the predecessor
reference, derive a bounded child authority once, measure a matching environment
and preserve the pinned acceptance inputs. Reusing an old authority or map is
not a supported shortcut.

Existing `containedServices` verifies commands in a fresh contained verifier and
binds retained observations to source, plan, phase and acceptance source. Existing
delivery requires a validated review-ready child journal and separate Send.
Its publication reader can distinguish preparation, confirmed publication and
uncertainty. These are the reusable effect boundaries, rather than the old host
graph loop.

## Reproduction and limits

```sh
bun test packages/scheduler/test/scheduler.test.ts \
  --test-name-pattern 'graph validation and durable execution'
dist/wring graph run --json
```

The [legacy test output](evidence/phase-3/measurements/legacy-graph-baseline.log),
[public refusal](evidence/phase-3/measurements/public-execution-baseline.json) and
[source-binding probe](evidence/phase-3/measurements/source-binding-baseline.json) retain outputs and the
source-binding observations. The first CLI probe incorrectly searched stderr;
the command correctly emitted its refusal JSON on stdout. The corrected probe
parsed that record. This diagnostic mistake did not change product behavior.

No model, container, fleet, human decision or external delivery ran in these
measurements. Historical fixture success is not qualification for new execution.

# Implementation measurements — 29–30 September 2026

Recorded while implementing the contained serial graph from the baseline above.
All observations are deterministic fixtures: no model, container, fleet, human
decision or external delivery ran. Logs quoted here are retained, with local
paths replaced, in `evidence/phase-3/initial/`.

## Starting position

The first workspace install had failed in the previous sandbox (`EPERM` on its
temporary directory). Run again on this machine, it linked the two new scheduler
dependencies and added exactly those two lines to `bun.lock`. The targeted suite
then loaded and failed for behaviour, not module errors: 27 pass, 18 fail. One
failure was the retained compiler red (a human hold fed by a router); seventeen
were the kernel's explicit unimplemented stubs.

## What measurement changed in the design

- **A hold is not a result.** A loop's outcomes are now `ready` and `stopped`. A
  child waiting for its own human review is reported as a graph hold with the
  child's next command; a router cannot branch on it.
- **One guard per property.** The entry points first duplicated checks that the
  shared transition function also made. Removing either alone would have stayed
  green and proved nothing. Revision, input, node and prepared-digest binding now
  live only in the transition function, which both writing and reading use.
- **A required failure stops at once.** A router could carry a failed required
  check on to review, preparation and Send, with only the completion check
  refusing at the end. The kernel now ends the graph when a required node records
  a non-success outcome.
- **Preflight before the marker.** A missing container runtime would have left a
  durable dispatch marker and an uncertain node for work that never started. The
  driver now has an effect-free preflight between the validated transition and
  its marker; a refusal leaves the node reserved and resumable.
- **The operator's current PATH.** On this machine `container` is installed. The
  first runtime-refusal test changed `PATH`, but `Bun.which` used the process-start
  path, so the live driver wrote a dispatch marker and then failed inside the
  child. The preflight now reads the current `PATH` explicitly.
- **A non-bare origin fails Git.** `rev-parse --is-bare-repository` exits non-zero
  on a working tree; that is now treated as "not a bare origin".
- **The right journal head.** The first export failed its own reader: the delivery
  manifest's `headSha256` is the redacted portable journal head. The controller
  journal head a loop records is `sourceHeadSha256`, which the delivery audit
  already binds.
- **A local origin in the pinned plan.** The export's leak scan found the local
  bare origin's path in `graph/plan.json`. The plan is carried verbatim because
  its digest binds the grant and every event, so it is disclosed in the export
  index and the guide rather than redacted.

## Reversions

`scripts/restoration-phase3-reversions.ts` removes each guard alone in an isolated
copy, requires its targeted test to fail, restores it and requires green. The
first run found three guards whose tests were masked by another guard: the check
candidate guard (masked by the new hold guard), the SSH password guard (masked by
the HTTPS username guard) and the event digest (masked by transition validation).
Each test was sharpened, not the harness. The script classifies every red by its
effect — refusal vanished, recorded state changed, a different guard refused, or
a named refusal became a crash — and lists guards kept as defence in depth with
the guard that masks them. Final counts are in the [reversion record](evidence/phase-3/reversions.json)
and its [effects](evidence/phase-3/effects.json).

## Measurement errors retained

- The re-chaining helper in the export test re-hashed decision events without
  re-linking hold results, so a forgery aimed at loop lineage was caught by the
  hold check instead. The helper now re-links; the product was unchanged.
- The packaged walkthrough first expected four exported nodes; the graph has five.
- The first full validation stopped at its build stage: the packaged documentation
  closure refuses links to directories, and the measurements page linked the
  baseline directory. The page now links the three baseline files.
- The first CLI run exposed two product gaps (graph help routed to the general
  drive help; `--continue`/`--reject` parsed as value options) and one wrong test
  expectation (the legacy reader renders a flowchart, not the graph id).

## Packaged walkthrough

`scripts/graph-distribution.ts` (validation stage `compiled-graph-contract`)
drives 21 public `wringer-drive` commands in an isolated `PATH` with no container
runtime, plus three steps of a separately compiled fixture binary for the loop
and check. It observes: named refusal of a retired host graph; a hold at the
root scope; runtime refusal leaving the loop reserved; a child that completed
before a simulated crash, reconciled with exactly two child sessions; a stale
decision refused without an event; public delivery preparation; a wrong and a
repeated Send refused; the default branch unchanged; a Node-only export check and
refusal of an altered event; a fresh-clone delivery audit; and a second graph
killed right after its dispatch marker, which resume keeps `uncertain` without
starting the child. The public binary is checked not to contain the fixture crash
hook.

## Not measured

Live agent convergence, real containment, a live publication remote, any benefit
of a graph over a single job, and independent human acceptance. The graph actor is
recorded, not authenticated. A crash between a dispatch marker and a child's
first durable write leaves the node uncertain with no re-dispatch command.
