# Contained PM journey

For the supported operator route, follow [QUICKSTART.md](../../QUICKSTART.md)
and [the unattended guide](../../docs/native/HEADLESS.md): `wringer-drive plan`,
`authority`, `run`, `status`, `show`/`review`, `resume`, `deliver`, `audit` and
`falsify`. Keep the same explicit controller state. The API details below are
for implementers, not a separate host execution recipe.

The production entry point is `runContainedJourney`, also exported as
`resumeContainedJourney`. It consumes a canonical `@wringer/plan` execution plan,
exact-plan authority and source-linked environment map. All model work uses
`@wringer/runtime` ACP roles. There is no host shell-agent or direct-HTTP model
fallback. The earlier alpha implementations now exist only in `test/legacy` to
keep their regression evidence; their public entry points return a migration
instruction rather than contacting a model.

## Authority and evidence

The controller stores an immutable plan, original acceptance contract, authority
and environment map before agent work. Each role session is reserved durably
before invocation. Worker, judge and optional planner have fresh, distinct runtime
and ACP session identities. The judge receives the candidate and original machine
criteria with supervisor-recorded check results, never the worker's private text.

Controller records belong outside agent clones. Files under
`STATE/.wringer/contained/events` are sequenced, hash-linked state transitions.
`result.json` is a derived view, not a source of authority. Exact scrubbed role
requests/results carry digests; replay checks them. A result captured before a
crash but not yet journalled is reconciled without another agent invocation.
An effect with no conclusive result remains charged and refuses automatic retry.
`retryUncertain` explicitly acknowledges the risk of duplicate spend; it does not
refund the earlier reservation.

A known stopped role or invalid final answer offers `--retry-stopped`. That
records a new bounded session without deleting its earlier paid reply. Ordinary
resume keeps valid successful work and does not quietly repay a failed result.

Session and per-role turn ceilings apply to the entire frozen journey. The
wall-clock ceiling includes downtime. A changed plan, source map or authority
cannot silently become a continuation of an approved journey. Known token usage
is summed; absent or uncertain usage is null, not zero. Turn ceilings are not
provider-enforced token or dollar caps.

## Acceptance and PM stops

The controller services prepare the pinned source, capture the runtime's actual
patch, and run the original checks in an independent runtime. A worker cannot
alter the approved write scope or the protected check/dependency files. Required
checks must fail before building, pass on the candidate, and retain the same
declared check-input identity. Environment/command failures are not red receipts.
Verifier and judge findings can trigger another bounded worker turn.

A required human criterion reaches HOLD with a candidate-specific display route.
Its verdict requires a successful display receipt and the person's exact note,
both tied to the candidate tree and acceptance digest. Every candidate change
invalidates earlier human judgements. Routine operating authority never writes a
human verdict or publishes. Delivery is a separate controller operation.

## Boundaries

The injected services are trusted controller code, not repository callbacks. Their
production implementation must establish containment and source/check identity;
a JSON provenance object alone is not independent proof of isolation. Acceptance
semantics remain a review obligation: exact quotes and check bindings cannot prove
that a requirement captures all the user's meaning. A planner review is explicitly
fallible. The initial production interface requires a declared acceptance plan;
it does not silently invent or approve one from arbitrary prose.

`bun test ./packages/workflow/test/contained.test.ts` exercises the production
state machine with synthetic ACP/runtime outcomes, no paid calls. These fixtures
do not measure live adapters, provider authentication or real containment.
`test/legacy` preserves historical alpha tests but is outside production imports.

Contained state currently has text/JSON status and portable delivery records,
not the standalone HTML board or certificate. Those readers handle a different
record format and must not be used to approve or resume this journey.
