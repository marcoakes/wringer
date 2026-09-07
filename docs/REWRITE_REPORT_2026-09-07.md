# Bun replacement: implementation and acceptance report

Date: 7 September 2026. Version: `1.0.0-alpha.2`.

## Decision

This is the root repository's Bun/TypeScript replacement, not a second product
under `ts/` and not a new development branch. Python harness source, packaging,
CI/release entrypoints and benchmark drivers are retired. Old published packages
and the user's installed tools/credentials are not changed by this repository
migration. The [retirement inventory](python-retirement.json) identifies every
removed tracked runtime file and the Git baseline from which to recover it.

**This checkpoint is not a production-readiness or “game-changing” verdict.**
Real Apple container, gVisor and provider journeys remain unmeasured. The new
contained journey also lacks an integrated HTML board and certificate. Those
are explicit unfinished acceptance gates, not features inferred from the
standalone legacy-format board tests.

## What changed

- One root Bun workspace, pinned lockfile, native executables and Bun CI. No
  Python harness fallback, Python build dependency or new PyPI publication path.
- YAML and a constrained literal TypeScript DSL compile to the same validated
  plan. Repository TypeScript is not evaluated with controller privileges.
- The CLI scopes and orchestrates. ACP connects separate agent runtime sessions;
  it contains no competing direct-model coding loop. Public host-worker,
  graph/fleet/benchmark launch routes are retired rather than silently retained.
- Each role declares an Apple container or gVisor/Kubernetes boundary with an
  internally cloned repository. Missing containment refuses; no host downgrade.
- Source-linked environmental maps preserve unknown observations as unknown.
  Protected acceptance inputs and explicitly declared writable dependency-output
  directories remain separate; workers cannot approve their own scope changes.
- Finite authority, reservations and a hash-linked controller journal govern
  resume. State views are validated against that journal. Human judgement binds
  a successful display of the exact candidate; withdrawing it blocks delivery.
- Contained delivery carries source, plan, authority, receipt and review records.
  A fresh clone can audit the carried bundle offline. Bounded committed-line
  mutation challenges run only through the declared contained verifier.
- Git publication and hosted review-request publication are separate facts.
  Explicit send, immutable request intent and reconciliation avoid blindly
  repeating an uncertain create. Tests use synthetic forge responses; no real
  hosted review request was created during this implementation.

## Lessons tested, not merely translated

Run 5B showed that correct refusals were not enough: recovery instructions,
spending descriptions, stable history and requirement coverage mattered as much
as the coding turn. The replacement's tests retain failure cases, including:

1. Edited status views cannot manufacture readiness.
2. Interrupted verification recovers an identity-bound observation without
   running it again; mismatched or incomplete observations refuse.
3. A checkpoint immediately after candidate verification resumes without
   rejecting its own previously recorded runtime identity.
4. A human changing `met` to `not_met` invalidates readiness immediately, even
   if a stale derived file still contains the earlier approval. Publication
   shares the journey lock.
5. A fresh human-display runtime performs declared setup and retains its outputs;
   setup failure cannot count as a successful display.
6. Dependency outputs can be created without making protected acceptance files
   replaceable through their parent directories.
7. Legacy public host execution refuses before a configured worker can run.
8. Audit detects changed journal/receipt/source data; publication refuses branch
   conflicts; falsification distinguishes caught, surviving and unavailable work.

The adversarial review found issues after an earlier full suite had passed.
Those failures were retained as regressions before the final combined check.
Passing tests demonstrate the cases they execute, not the absence of all bugs.

## Reproduce the local checks

Use Bun `1.4.2`, Git and Node.js (the target-language integration fixtures need
Node). From the repository root:

```sh
bun install --frozen-lockfile
bun run validate
```

The validation envelope checks generated contracts, strict TypeScript, package
tests, the committed historical record corpus, native compilation, standalone
execution away from the checkout, and a trusted-local delivery fixture with a
temporary bare origin and fresh-clone audit. Each stage saves its actual result
and output under the printed validation directory. CI uploads those measurements
even when a stage fails.

The local delivery fixture uses an explicitly labelled synthetic human note and
a deterministic target edit. It is not a person accepting real product work, a
live ACP build, a clean-machine test or evidence that containment resists escape.
Runtime tests use controlled drivers; forge tests use synthetic transports.
No live provider usage or model prices are inferred from these fixtures.

Final local validation passed all nine stages: **248 tests, zero failures, 1,747
assertions**, followed by portable corpus, native build, standalone distribution
and local delivery checks. Measurements and a source-file checksum manifest are
in the [portable validation receipt](evidence/rewrite-validation-2026-09-07.json).
Remote CI status must be checked against the published commit; local results
are not a substitute for it.

## Remaining exit gates

| Gate | Status at this checkpoint |
| --- | --- |
| Real Apple container boundary, setup, network denial, cancellation and cleanup | Unmeasured; required tool was absent on this host |
| Real gVisor Kubernetes isolation and enforced network/resource policy | Unmeasured; no configured cluster was exercised |
| Live Claude/Codex ACP authentication and convergence | Unmeasured; no paid provider calls made |
| Clean-machine, product-only path from intent to accepted delivery | Unmeasured; this is an existing development account |
| Integrated contained HTML board/certificate agreeing with every delivery view | Not implemented; contained status is text/JSON |
| Comparative real-task completion, cost and human-attention improvement | Unmeasured; no SOTA or benchmark win claimed |
| Full behavioral parity with all retired Python tests | Not claimed; frozen record contracts and carried corpus are retained |

Controller records are integrity-checked, not a trusted third-party signature.
A person controlling the controller storage is still in the trust boundary.
Lexical mutation coverage is bounded and incomplete, and an unavailable runtime
is inconclusive. The [threat model](../THREAT_MODEL.md), [architecture](native/ARCHITECTURE.md)
and [migration notes](MIGRATION.md) describe those limits.

The next product acceptance exercise must measure useful completed changes per
unit of human attention. A safe stop is necessary; it is not a successful build.
