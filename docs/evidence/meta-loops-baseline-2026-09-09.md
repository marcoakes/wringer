# Measured loops: baseline and development corpus

9 September 2026 · engineering fixtures, not a PM blind-test verdict

The preserved comparison source is Bun `1.0.0-alpha.9`, commit
`9d909f3bf93fcd545880bd1ed742ce78c1d58ff5`. The
[implementation plan](../META_LOOPS_IMPLEMENTATION_PLAN.md) inspected that source;
its source-level gaps are not retrospective measurements of model performance.
Earlier failed PM verdicts and the 35-check scripted design rehearsal remain
unchanged in their dated reports.

This document maps the plan's failure cases to executable, sanitised fixtures.
They use fabricated observations, isolated scratch Git repositories and scripted
role responses. They are not copies of private agent conversations, customer
designs or credentials, and not an independently held-out live task set.

## Corpus identity and what each case establishes

Test names below are exact searchable identities. Source links identify the test
files; the implementation commit and complete validation transcript belong to
the final implementation measurement report, not an invented commit in this page.

| Original plan case | Executable test identity | Narrow observation |
| --- | --- | --- |
| Inaccessible detailed check output | `strict red/repair/green reaches ready and preserves actionable observations without worker narrative in judge` in [loop-engineering](../../packages/workflow/test/loop-engineering.test.ts) | The next scripted worker receives source-bound failure details, not an unusable controller path |
| Import/syntax failure counted as red; empty tests | `syntax errors, empty/skipped tests, runner errors and contradictory exit never establish assertion evidence` in [loop-engineering](../../packages/workflow/test/loop-engineering.test.ts) | Exit 1 without a valid executed assertion report stays unavailable |
| Unsupported evidence must not buy work | `strict missing report stops before worker spend while generic command-red remains supported` in [loop-engineering](../../packages/workflow/test/loop-engineering.test.ts) | Strict refusal and narrower generic-command compatibility both remain visible |
| A red assertion disappears or is skipped | `formerly red assertion disappearing, skipped, or remapped cannot become green` in [loop-engineering](../../packages/workflow/test/loop-engineering.test.ts) | Candidate green cannot replace the original discovered IDs/mappings |
| Repeated source tree, including A → B → A | `A to B to A stops before a fourth worker and ordinary resume preserves reservations` in [loop-engineering](../../packages/workflow/test/loop-engineering.test.ts) | Exact repeat stops before another worker; Continue does not reset allowance |
| Repeated failing requirement despite changed work | `three changed failing candidates warn, then a legitimate fourth attempt can complete` in [loop-engineering](../../packages/workflow/test/loop-engineering.test.ts) | Equal outcomes warn without inventing a no-progress judgement |
| False equivalence from noisy output or changed environment | `decision fingerprints ignore transport paths and raw output noise, never ignore environment identity` in [loop-engineering](../../packages/workflow/test/loop-engineering.test.ts) | Comparison uses pinned identities and stable outcomes, not incidental text |
| Oversized or credential-bearing failure details | `repair packet truncation is explicit, complete output is hashed and altered packet refuses` and `a secret-shaped value crossing an excerpt boundary is redacted before truncation and retention` in [loop-engineering](../../packages/workflow/test/loop-engineering.test.ts) | Bounded excerpts retain omissions and hashes; recognised secrets are scrubbed before shortening |
| Interrupted repair | `uncertain repaired attempt preserves recorded loop history and charged reservation across resume` in [loop-engineering](../../packages/workflow/test/loop-engineering.test.ts) | An uncertain response does not receive a fresh budget or automatic replay |
| Altered history or omitted decisions | `rehashed loop advice cannot replace the deterministic observation-derived decision` and `local and portable coverage require decisions before later spend or readiness` in [loop-engineering](../../packages/workflow/test/loop-engineering.test.ts) | Rehashed advice and renamed/deleted anchors cannot silently bypass coverage; a retained partial history may remain stopped |
| Negative versus unknown independent review | `judge repairs have separate evidence and an unknown judgement stays an explicit bounded retry` in [loop-engineering](../../packages/workflow/test/loop-engineering.test.ts) | Judge-negative repair is recorded separately; unknown is not approval or an automatic worker retry |
| Visual correction; stale display | `review revision binds current state, preserves feedback and uses a new bounded worker` and `a missing, failed, stale or forged member rejects every decision in a batch` in [contained workflow](../../packages/workflow/test/contained.test.ts) | Existing source-bound human correction/acceptance guards remain exercised by scripted decisions |
| Playbook identity and role boundary | `only the worker receives the pinned playbook and durable use binds its exact request` and `Reports default pins the exact advisory playbook and strict assertion contract` in [loop-engineering](../../packages/workflow/test/loop-engineering.test.ts) | Worker prompt and receipt bind exact selected bytes; this is not secrecy of tracked repo files or efficacy |
| Combined design/playbook replay | `combined design and playbook context replays after worker completion before the next role` in [loop-engineering](../../packages/workflow/test/loop-engineering.test.ts) | Regression first reproduced the browser-rehearsal suffix mismatch; retained request bytes now validate consistently, no worker is replayed, and the human hold remains |
| Approval cannot inherit changed guidance or policy | `v3 selection protects exact playbook and every policy change revokes the old authority` in [playbook-plan](../../packages/plan/test/playbook-plan.test.ts) | Changed selection/policy requires a changed plan approval |
| Handover and fresh-clone consistency | `v4 handover carries strict red/green, pinned worker playbook and deterministic loop decisions into a fresh-clone audit` in [contained delivery](../../packages/delivery/test/contained.test.ts) | Actual local Git bundle/publication/clone and offline audit carry consistent synthetic execution facts; no live agent or real sandbox claim |
| PM disclosure does not replace the next decision | `same-page engineering disclosure is plain text, collapsed and never changes the next decision` in [job-render](../../packages/board/test/job-render.test.ts) | Browser engineering contract; not an independent PM's experience or acceptance |

The meta-loop's separate seeded-benefit, harmful/no-op, missing-trial,
preregistration, fixture/refusal, adoption and rollback cases live in
[experiments.test.ts](../../packages/application/test/experiments.test.ts).
Its fabricated trial facts test the evaluator, not the empirical benefit of a
playbook. See [Experiments](../native/EXPERIMENTS.md) for the actual operator route
and the later validation report for its final test count.

Ordinary-job input is exercised separately in
[journey-patterns.test.ts](../../packages/application/test/journey-patterns.test.ts):
`ordinary histories retain repaired failures once and omit private narratives and expected baseline red`,
`empty human hold is not negative feedback and uncertain reservations remain observed`,
and explicit research/private-path refusal cases. Its real retained stopped-job
reader test prohibits provider/runtime calls and current credential lookup. These
are additional application tests, not extra live journeys in the table below.

## Measured denominators at this checkpoint

The following local commands were executed during implementation on 9 September
2026 with Bun 1.4.2. They do not measure an old-versus-new performance comparison.

```sh
bun test packages/workflow/test/loop-engineering.test.ts packages/workflow/test/contained.test.ts packages/workflow/test/worker-outcome.test.ts
bun test packages/delivery/test/contained.test.ts --test-name-pattern 'engineering|strict|v3|v4|playbook'
```

| Measurement | Denominator and result | Excluded inference |
| --- | --- | --- |
| New core engineering tests | 17 test cases passed; 108 assertions in the focused file | Not 17 tasks or 17 live journeys; some tests contain multiple synthetic runs |
| Core plus existing contained/worker-outcome regression suite | 73 tests passed, 0 failed; 475 assertions across three files | Includes the 17 new tests; do not add them again |
| Targeted v4 portable audit test | 1 test passed, 0 failed; 16 assertions; 9 other tests filtered out | Not the whole delivery suite, remote CI or a live handover |
| Ordinary-job failure-pattern tests | 6 tests passed, 0 failed; 28 assertions | Pure outcome fixtures, a real retained pre-dispatch stopped job, and moved research-controller purpose/authority refusals; no live agent or independent human |
| Live model comparison in this corpus | 0 live baseline/candidate trials | No completion-rate uplift, attempt reduction or cost savings measured |
| Independent PM/designer observations in this corpus | 0 | Scripted human decisions do not count as independent acceptance |

Full-suite/compiled/browser validation has a separate denominator in the final
measurement report. A green unit-test total cannot be divided into a live
handover rate. No genuine provider price, billed spend or agent version is
inferred from fixture identities. Controller observations deliberately keep
missing token/billing telemetry unknown.

## Live prerequisites and the next frozen measurement

Before a live repair comparison or PM blind run, record the actual source commit,
full plan/authority identities, runtime image digest, platform, worker/judge
adapter and reported model identities, structured check inputs, design reference,
start/end timestamps and all reserved/uncertain sessions. Missing vendor metadata
remains unknown. Preserve failed, cancelled and unavailable trials in their
denominator.

Required but not supplied by this corpus:

- A working, digest-pinned browser-capable Apple Container or gVisor environment;
  actual tool/version observations, network and credential policy, enough disk
  space, and worker/judge credentials already provisioned through the product route.
- A separate finite allowance for any comparative agent runs. Session/time bounds
  are not a hard cash cap. No provider spending is authorised by this document.
- Owned reference material, or authorised live Figma/MCP access. Choose and record
  the lane before starting; an owned reference does not prove a live Figma call.
- A genuinely independent PM/designer using a frozen entry point, with one real
  correction, fresh display/decision, separate Send and a fresh-clone audit.
- For improvement claims: distinct frozen development/held-out tasks, identical
  non-playbook conditions across arms and sufficient preregistered evidence.
  Held-out answers must stay outside every proposer source clone; the present
  separation is operator-attested, not proven by a prompt or an absence scanner.

The blind phase ends at its first undocumented hand repair. Record that stop
verbatim; any later salvage is separately labelled. Do not change the app during
the frozen test or relabel the operator's own scripted run as independent.

## Evidence boundaries retained

Guidance is worker-only in controller injection, not hidden repository bytes.
Check/assertion identities establish consistency, not test sufficiency. The
portable repair packet is reconstructed from carried redacted output; its
original observation digest remains an opaque controller commitment because
host-specific provenance is projected, not reproduced byte for byte. Audit does
not establish a hostile-owner trust boundary, live isolation, human presence,
model understanding or improvement benefit.
