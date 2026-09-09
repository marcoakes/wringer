# Measured loops — implementation and verification

9 September 2026. Bun/TypeScript implementation on the existing main branch.

Implementation is complete, with local regression and end-to-end browser
verification recorded below. This is an engineering report, **not a live performance
comparison or an independent PM blind-test result**.

## What changed for a PM

Wringer can give a worker useful observed failure details, stop an exact repeated
unsuccessful version, and explain progress without asking the PM to manage each
repair. The existing result decision and separate Send remain the main actions.
An optional, collapsed improvement card can review separately authorised research
and select an evidenced approach for future work. It never changes an active job.

| Area | Delivered behaviour |
| --- | --- |
| More precise checks | Opt-in executed assertion evidence distinguishes a failing requirement from a command/import/runner failure. Missing, skipped, renamed or remapped previously executed assertions cannot become completion proof. Generic commands retain their narrower historical claim. |
| Actionable repairs | Bounded, redacted observations reach the worker with source/check identities, excerpts and explicit omissions. Judge findings and human correction remain distinct. No new model supervisor runs. |
| Measured engineering loop | Deterministic decisions stop exact unsuccessful candidate repeats, including A → B → A. Repeated outcomes warn; changed work is not rejected merely for an equal failure count. Journal replay preserves decisions and whole-journey reservations. |
| Repository playbook | One explicitly pinned, inert worker guide can describe a repository-specific approach. Source/applicability are validated before work; no scripts, implicit discovery, new tools, permissions or execution authority are granted. |
| Ordinary failure patterns | Explicitly selected private job histories produce bounded development patterns without copying conversations, raw outputs or human notes. Research controllers refuse, including moved controllers with retained research identity. |
| Bounded proposal | One separately authorised ACP proposal produces an inactive playbook artifact captured from actual Git state. Prepared requests can be reused only when identical; interrupted reservations do not replay paid work. |
| Preregistered comparison | Fresh paired baseline/candidate trials pin source, acceptance, runtime and agent controls. Fixed sample and allowance, retained failures, independent task accounting, regression vetoes and uncertainty determine eligibility. Fixtures cannot qualify as live benefit. |
| Future adoption and rollback | Explicit, revision-bound decisions select only eligible evidence. New proposals pin the selected guide and receipt; restoring no guide also retains the rollback receipt. Every new execution still needs its own approval. |
| Same-page PM experience | Ordinary next action remains first. Engineering disclosure and optional research stay collapsed. Stale/malformed research cannot authorise collection, adoption, Yes or Send; locking clears private content. |
| Portable ending | New v4 deliveries carry engineering observations, exact playbook/use and selection lineage. Certificate, board, summary and reviewer instructions derive from the same facts and can be checked in a fresh clone. |
| Private research boundary | The research-purpose marker is reserved before source/role work. Research acceptance permits only the exact private local ending, never a different remote or forge. Portable receipts and views label it non-production. Human research completion uses no new agent sessions and does not renew the original approval. |

## Compatibility and architecture

The baseline remains alpha.9 at
`9d909f3bf93fcd545880bd1ed742ce78c1d58ff5`. The 80 previously published schema
files are byte-for-byte unchanged. This implementation adds 33 sibling/versioned
contracts; it does not reinterpret old Python or Bun receipts as stronger proof.
Existing main-branch history, banner and prior failed measurements are preserved.
No release tag, package publication or deployment is part of this change.

YAML and constrained TypeScript still configure the plan. Bun orchestrates;
ACP connects the agent runtime; the runtime performs the work in its declared
containment. Worker and judge retain separate runtime instances. No Python
harness, global skill marketplace, hosted service, general policy evolution or
second model/tool loop was introduced.

The Reports/design starter now explicitly selects v3 strict checks and a pinned
advisory playbook. It is **unevaluated starter advice**, not automatic adoption of
a proven improvement. Its presence is not evidence that it helps an agent.

## Verification record

The first full envelope passed 20 stages and then failed its combined-design
browser stage. Its repository-wide suite recorded **782 passed, one
platform-specific Linux check skipped on macOS, zero failed; 8,903 assertions**.
The failed browser result is retained, not rewritten into a pass.

After the integration repairs, the final corrective envelope passed all six
selected stages: executable build; assistant contract (118 tests / 1,713
assertions); measured-loop contract (101 tests / 892 assertions); portable v4
handover (one test / 16 assertions); full design browser journey (**44 checks**);
optional improvement browser journey (**14 checks**). The design journey took
132.3 seconds and executed actual local Git handover and a fresh-clone audit,
with scripted agents, verifier observations and human clicks.

Its single Send received a durable 202/running acknowledgement in 13.6 seconds,
then the page observed completion without a second Send. Validated-read reuse
and pending-read coalescing remove redundant audits. The browser now allows a
finite 30 seconds for reads and 45 seconds for decision admission; those network
windows do not renew approval or replace operation deadlines. Final board,
duplicate-Send and cancellation regressions passed 35 tests / 349 assertions.

All defined validation stages have passing local measurements across the full
envelope and corrective runs. This is **not** a claim that the failed first
envelope passed, or that the entire suite was rerun after every final edit.
GitHub runs the complete fresh Linux/macOS envelope on the pushed source; its
outcome must be read from that commit's checks, not inferred from these local
results. The [portable evidence index](evidence/meta-loops-implementation-2026-09-09.json)
carries exact source hashes and successful/failed validation records. Raw local
artifacts remain separately retained; private links and browser traces are not
published by this index.

Focused measurements before the full envelope included:

- 41 plan, future-selection, engineering-view and board tests; 437 assertions;
  all passed after no-guide rollback provenance was added.
- 23 comparison/private-handover tests; 158 assertions; all passed. Actual local
  Git endings and fresh clones were used, with scripted roles and decisions.
- 19 proposal/comparison tests; 113 assertions; all passed after prepared-request
  reuse and exact mismatch refusal were added.
- 36 plan/loop/ordinary-pattern tests; 244 assertions; all passed, including
  moved-research-controller refusal and no credential/runtime calls by the
  ordinary history reader.
- New v4 handover/tamper test passed in a retained validation envelope. It
  reconstructs engineering receipts from the carried source and journal, then
  rejects altered evidence even after its superficial hashes are updated.

These sets overlap. Their counts must not be summed into a unique-test total.
Browser clicks, role replies and local human decisions used by these engineering
fixtures are scripted. Real browser/Git/audit execution does not turn them into
live model, sandbox, independent person or efficacy measurements.

### Failures found and repaired during this implementation

- Frozen-format readers and example paths initially knew only older versions;
  new records now have explicit dispatch/schema support while old semantics stay.
- The prepared-proposal path initially tried to overwrite its own immutable
  request. Exact existing bytes now reuse safely; changed requests refuse before
  reservation, source preparation or a provider call.
- A research acceptance could otherwise reach the ordinary publication route.
  The entrypoint now checks the private-purpose boundary before remote inspection
  or forge work. Alternate prepare/send destinations and missing markers refuse.
- Known research history could be moved away from its registered directory.
  Ordinary-pattern readers now check both purpose markers and retained authority.
- Restoring no playbook initially lost its decision from a future plan. The
  rollback is now pinned, visible and portable without granting execution.
- The first combined design/playbook browser run exposed a replay-context
  mismatch. One shared context builder/validator now preserves the exact request
  order and resumes only the remaining work, without replaying the worker.
- The next browser run reached an actual successful private Send in 24.5 seconds,
  but the page abandoned its request after 15 seconds. Three repeated audits per
  refresh also delayed status. Send now acknowledges its durable command and is
  observed separately; simultaneous reads share pending validation, not a stale
  result cache, and one PM refresh reuses the same audited facts. Later reads
  revalidate. No new Send is inferred from a lost response.
- New schema generation and the validation stage's test-name selector exposed
  integration errors. Those failures remain in their dated local measurements;
  they are not relabelled as successful runs.

## Claims this report does not make

- No paid comparison, live provider convergence, new credential provisioning,
  Figma account operation, independent PM/designer verdict or live Sigstore
  signing was performed for this implementation.
- Playbook-use receipts establish controller-supplied guidance, not model
  understanding or improvement. The judge is not given worker guidance as an
  instruction, but can still read tracked repository bytes.
- Retained names and receipts do not prove physical human presence or protect
  against a hostile same-user controller owner. Hosted/hostile-user isolation
  has not been added by renaming an approval.
- Session/time ceilings are not a universal hard cash cap. Missing provider
  billing stays unknown, never zero. No savings percentage is claimed.
- The rehearsal's extra-breakage route remained inconclusive because its live
  runtime was unavailable. That is retained explicitly, not counted as a passed
  live falsification measurement.
- Portable output excerpts can be reconstructed; the original host-specific
  observation digest remains a named opaque commitment. Selection receipts bind
  private evidence revisions, not a fresh rerun of their private trial corpus.
- Held-out answers must stay outside proposer and worker source clones. That
  corpus boundary is operator-attested, not enforced by prompt wording.

## The next measurement

Use [the prepared independent PM protocol](PM_MEASURED_LOOPS_BLIND_TEST.md) and
freeze the exact installed commit and entry pages before starting. Reuse existing
credentials and label the machine pre-provisioned unless cleanliness is measured.
Record correction, result review, separate Send and the literal fresh-clone audit;
publish a failed stop if that is what happens.

Live comparative benefit additionally needs an actual pinned contained runtime,
a separately approved finite trial allowance, held-out tasks and independent
design review for visual claims. None is silently borrowed from a product job.

Implementation references: [plan and source map](META_LOOPS_IMPLEMENTATION_PLAN.md),
[measured-loop guide](native/MEASURED_LOOPS.md),
[research commands and boundaries](native/EXPERIMENTS.md),
[preserved baseline/corpus](evidence/meta-loops-baseline-2026-09-09.md).
