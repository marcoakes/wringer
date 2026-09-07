# Roadmap: one Bun product, a measured end-to-end result

The goal remains: a product manager supplies a serious specification and repositories, and returns to working software with reviewable evidence. Wringer coordinates the work; ACP agents author the product code. Improving a refusal is useful, but it is not the same as completing that journey.

This is the execution roadmap for the Bun product at the repository root. Earlier release dates, status rails and Python implementation plans are historical, not the current release checklist.

## Present baseline

The codebase includes native records, contained workflow/authority state,
delivery/audit/falsification, and standalone local verification, board/pen and
historical health. `wringer-drive board --state DIRECTORY` is the live PM
workspace; the same run can be inspected through `status`. CLI and board share
guarded application commands, and contained delivery v2 carries a shared fact
projection for its board, certificate, summary and MR.
Deterministic integration fixtures exercise both successful and unsuccessful
flows without real keys or model spend.

Public graph access is read-only: `wring graph show`, `status` and `explain`.
`wring fleet` and `wring bench` execution refuse with a contained-plan migration
route. Retained graph/fleet implementation APIs are internal/historical, not
supported host-worker execution alternatives.

These capabilities do not establish live-provider convergence, fresh-machine usability or runtime isolation. A language rewrite does not settle any of those questions.

## Required execution architecture

The active integration work is one production path:

1. Strict YAML and constrained TypeScript resolve to the same canonical execution plan.
2. A plan pins repositories and separates planner, worker and judge ACP declarations.
3. Each role runs in a fresh Apple Container or gVisor-backed Kubernetes environment. Repositories are cloned inside; there are no host checkout/home mounts.
4. Declared network, credentials, resources, turn/time budgets and cleanup are established before work.
5. The controller freezes plan and authority, records the journey, and never falls back to host shell/direct provider HTTP when the boundary is unavailable.

Compatibility readers preserve old evidence. Compatibility execution is not a second supported product or a substitute for this architecture.

## Exit criteria, not release adjectives

| Gate | Evidence required |
| --- | --- |
| One install story | Root Bun install/check/build works in a fresh checkout; `dist/` runs without Python; every shipped documentation link and printed recovery command resolves. |
| Declarative plans | YAML/TypeScript equivalence; no arbitrary import/expression execution; unknown keys, ambiguous values, mutable references and secret values refused. |
| Real ACP roles | Initialize/session/prompt/cancel exercised against a real declared agent; authentication state described from observations; distinct role identities retained. |
| Apple Container | Live filesystem/network/resource/cancellation/cleanup checks on the named macOS/runtime/image; no host mounts or local fallback. |
| gVisor Kubernetes | Live RuntimeClass, cluster policy, secret scoping, role separation and cleanup checks; ordinary container execution cannot masquerade as gVisor. |
| Durable autonomy | One authority survives resumes and revisions; completed work reused; all uncertain reservations remain charged; no invented human verdict or automatic publication. |
| One delivery story | Board, certificate, summary and MR agree; portable passing/red receipts; audit in a fresh clone; falsification measures the printed committed range. |
| Usable first run | A person outside the implementation team can follow only product pages and printed commands; capture every stop and any hand repair. |
| Release readiness | Full tests, packaging and published-interface checks pass for the exact candidate commit; open limitations remain explicit in release notes. |

Protocol/manifest fixtures and live platform tests must be reported separately. A missing runtime is a named unrun test, not a reason to mark the isolation gate complete. A deterministic agent is not a live-model acceptance run.

## After the required path holds

Measure recovery rate, discarded/reused work, correctness against independent task-specific checks, operator interruptions and audit completeness. Report both drafting and building usage when available; do not manufacture prices or crown a benchmark winner from speed alone.

Expand integrations only after their authority, credentials, cancellation and evidence contracts have conformance tests. Add convenience without weakening the separation between what was built, what passed, what was proved, what a person judged and what was delivered.

Historical experiments and the [first rewrite report](docs/native/IMPLEMENTATION_REPORT.md) explain why these gates exist. They are not evidence that the gates above have already passed.

The [next PM blind-test protocol](docs/PM_BLIND_TEST.md) keeps provisioning,
simulated contracts, real containment and the observer's verdict separate.
