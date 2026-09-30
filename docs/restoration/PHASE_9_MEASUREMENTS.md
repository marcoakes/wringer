# Qualification — 30 September 2026

Phase 9 asks what the restoration has shown, at which level, and what it has not.
It adds no new mechanism. It adds a reproducible showcase, a checked capability
ledger and a registration for the pilot that could show a benefit.

## Evidence inventory

| Phase | Release | Isolated reversions | Packaged public walkthrough |
| --- | --- | --- | --- |
| 1. Loops and portable evidence | alpha.24 | 26 | Loop histories and export/reader checks |
| 2. Improvement workflow | alpha.25 | 36 | Improvement rehearsals |
| 3. Serial graphs | alpha.26 | 81 | Serial graph, two crash probes, Node-only audit |
| 4. Parallel branches | alpha.28 | 31, plus 4 for the Git fix | Parallel graph, crash, integration, Send, audit |
| 5. Gate and workflow proposals | alpha.29 | 48 | Proposal, oracle, evaluation, change, Send, adoption |
| 6. Tournaments | alpha.30 | 40 | Tournament, crash, prosecutor, selection, Send, audit |
| 7. Temporal durability | None | Measurement only | None |
| 8. External A2A tasks | alpha.31 | 27 | Public binary as A2A client, check, Send, audit |
| 9. Qualification | alpha.32 | 7 | Showcase: four compiled journeys, 81 stages |

Every reversion removes one guard in an isolated copy, is watched red, restored
and watched green; misses are kept in the records. Every walkthrough uses the
compiled public binary with a separately compiled fixture binary for role
replies or verifiers. None involves a live model, real containment, a real
external peer or an independent person.

## What the evidence supports

- The records, refusals, reservations, crash recovery and offline audits behave
  as documented on deterministic fixtures, on macOS and Linux CI.
- The selection and qualification rules do what the constructed measurements
  predicted: a weakened gate fails its comparison, a shared defect leaves no
  tournament winner, and a clean merge of two passing branches can fail a shared check.

## What it does not support

- That any feature helps on real work. No comparison with fair baselines has run.
- That live agents converge through these mechanisms.
- That containment holds on any platform in these runs.
- That a real A2A agent or a Temporal service works with Wringer.
- Any "state of the art" claim.

## Added in this phase

- **Showcase.** `bun scripts/showcase.ts` runs four compiled journeys and writes
  a path-free record. Its committed run passed all four, 81 stages in about 96
  seconds. See [the showcase](../showcase/SHOWCASE.md).
- **Capability ledger.** Each capability is judged separately as implemented,
  fixture-tested, live-qualified and comparatively beneficial. A checker refuses
  a missing citation, a live claim without a live run record and a benefit claim
  without a registered comparison result. See [the ledger](../CAPABILITY_LEDGER.md).
- **Pilot registration.** The 20-task pilot's arms, endpoints, minimum useful
  effect, regression limits, uncertainty rule and stopping rule are registered,
  with a digest a test enforces, before any run. See
  [the registration](../qualification/PILOT_REGISTRATION.md).

## Reversions

`scripts/restoration-phase9-reversions.ts` removes each of the checker's seven
rules alone in an isolated copy. All seven went red and were restored
([record](evidence/phase-9/reversions.json)).

## Not measured

The pilot itself. It needs live model access, three repositories with real tasks
and independent reviewers, none of which this restoration can supply.
