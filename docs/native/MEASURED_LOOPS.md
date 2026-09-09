# Better repair attempts, with unchanged approval

Implemented source guide · 9 September 2026

Wringer can now give a contained worker the actual check failure, distinguish an
executed requirement assertion from a failed command, and stop an exact repeat
of unsuccessful work. A plan can also select one repository-owned worker
playbook. None of these changes creates a new agent supervisor, supplies a human
Yes, grants Send, or proves that a playbook improves live results.

The [baseline and fixture corpus](../evidence/meta-loops-baseline-2026-09-09.md)
separates engineering tests from the live repair comparison and independent
PM/design test still required. For separately authorised comparison, proposal,
adoption and rollback, see [Experiments](EXPERIMENTS.md).

The [implementation report](../META_LOOPS_REPORT_2026-09-09.md) records integrated
verification, repaired failures and the separate live-proof limits.

## What changes for the PM

Approve the original plan and finite allowance once. Normal repairs use what
remains of that allowance. The existing job page keeps the next decision first;
the approach and check-history details are a secondary disclosure.

| Observation | What happens |
| --- | --- |
| A new candidate fails an available check | The worker may repair it within the original allowance, with the retained failure details |
| Changed candidates have the same failed outcomes three times | A warning; equal outcomes are not proof that no progress occurred |
| An unsuccessful candidate repeats an earlier tree under the same comparison conditions | Stop before another automatic worker attempt |
| Check evidence is unavailable, a judge cannot decide, or a response may have been lost | Preserve the record and reservations; follow the specific bounded recovery offered by the product |
| Approval is out of date, scope changes, or the allowance is exhausted | New explicit authority is required; refreshing the page does not create it |
| The result needs human judgement | Show this exact candidate, then record the person's decision |
| The result is ready to hand over | A separate Send is still required |

There is no “deliver the best attempt” route. A warning cannot turn a failed
requirement green, and a repeat stop cannot be crossed by ordinary Continue.
Managed operating-system permissions and the cooperative-local trust limit
remain unchanged. See [unattended operation](HEADLESS.md) and the
[assistant threat model](../ASSISTANT_SECURITY.md).

## Select the new contract before approval

New declarations use `version: 3`; the compiled record is
`wringer.execution-plan.v3`. The corresponding planning request is v3 too.
Version 1 and 2 plans and their existing receipts retain their old meaning.
They are not silently upgraded when resumed.

This fragment belongs in a complete declaration:

```yaml
version: 3
loop:
  repeatCandidate: stop
  repeatedOutcomeWarning: 3
```

The v3 default when `loop` is omitted is the same stop/3 policy. The warning
threshold accepts 2–64 observations. There is no scalar quality score, adaptive
vendor switch or extra hard stagnation cap. Comparison binds the approved
requirements, check-input identities, runtime image and measured environment.
Checks and independent judge findings have separate outcome histories.

The [Reports profile](../../examples/reports-design/profile.yaml) now explicitly
selects v3, assertion evidence and the example playbook. It is still a
**compile-only starter**: source revision, image and agent placeholders are not
a supplied live environment. Follow [design-led work](DESIGN.md) to import and
commit an authorised reference and bind the actual design/source before approval.

Compile a real profile without starting an agent:

```sh
wringer-drive plan PROFILE.yaml
```

`PROFILE.yaml` is your complete declaration, not one of this guide's fragments.
Review the compiled plan. Changing evidence level, loop policy, playbook bytes,
source or design produces a changed contract; an earlier approval cannot cover it.

## Make a check report what actually executed

For a protected acceptance check, add this field to that check's declaration:

```yaml
evidence: {kind: assertions, format: wringer-check.v1}
```

Its runner must emit one complete bounded JSON report on stdout. For example:

```json
{"schema_version":"wringer-check.v1","assertions":[{"id":"search-by-title","requirements":["reports-work"],"status":"failed"}],"errors":[]}
```

This is an example format, not a supplied test of your requirement. A failing
assertion uses exit 1. A fully passing report uses exit 0. Diagnostic text belongs
on stderr; extra prose on stdout is not extracted or guessed into a report.

The controller requires these facts:

- Each required linked requirement has an executed failing assertion before work.
- The complete discovered assertion IDs and requirement mappings remain identical
  when the candidate is checked; all must pass for a green result.
- Empty/all-skipped suites, runner errors, missing reports, duplicate identities,
  foreign requirements and contradictory exits cannot establish assertion evidence.
- A fail-fast red report may retain later discovered assertions as skipped. Those
  same assertions must execute and pass before the report can become green.

The report is limited to 256 KiB, 1,024 assertions and 32 bounded runner errors.
The [Reports runner](../../examples/reports-design/checks/acceptance.ts) supplies
the first adapter: ten stable behavior assertions, with runner exceptions kept
separate from assertion failures. Syntax/import failure is not a requirement
proved red.

Without the explicit evidence declaration, a check retains the narrower
**command failed before implementation** claim. Neither kind proves that the
test is honest, complete, nontrivial or sufficient for the whole product.

## What the worker receives

The controller derives a repair packet from the exact retained verification
observation, not from the worker's account of its work. It includes the source
identity, approved command, requirement IDs, outcomes, output hashes and bounded
stdout/stderr excerpts. Failed checks come first. Baseline failures are supplied
before the first attempt; later repairs also receive recent recorded outcomes.

Credentials are redacted before persistence and truncation. Packet excerpts also
mask recognised credential shapes and private host paths. Limits are visible:
at most 32 check rows, 2,048 bytes per output stream and three recent loop
decisions in the prompt, with omitted counts. Full retained output hashes remain
separate from shortened text. Output is untrusted task data, not instructions or
permission. Redaction is not a guarantee that every possible secret is recognisable.

The independent judge does not receive the worker's private conversation or its
advisory playbook prompt. It retains its own acceptance and verification context.

## Pin one repository playbook

A playbook is an inert `wringer.playbook.v1` JSON manifest, not an executable skill
package. It declares a worker role, task family, required context/tools/checks,
scope, design applicability, bounded guidance, limits and evaluation references.
It cannot declare new credentials, tools, commands, models, budget or approvals.

An explicit plan selection identifies the repository path and the SHA-256 of the
**exact UTF-8 file bytes**, plus its task family. The Reports profile already
contains the hash of
[reports-component-first.json](../../examples/reports-design/wringer/playbooks/reports-component-first.json).
When authoring a different committed playbook, measure its bytes locally:

```sh
shasum -a 256 wringer/playbooks/YOUR_PLAYBOOK.json
```

Use the measured value in your complete declaration. There is no automatic
directory search or remote fetch. The compiler protects the selected path. The
worker loads it from the **approved original source commit**, not a candidate's
edits. Missing, changed or inapplicable guidance stops before worker dispatch;
declared tool prerequisites must have passed actual environment measurement.

The controller retains the snapshot and records use against the reserved
worker's exact request. That proves which context the controller supplied, not
that the model understood or followed it. **Worker-only injection is not byte
secrecy:** a tracked playbook remains readable in a judge's repository clone.
Do not store confidential worker-only material in it or claim it is hidden from
the judge.

The Reports playbook is a deliberately selected, unevaluated starter. Its empty
evaluation references are honest. Including it in an approved example is not a
promotion decision or evidence that it outperforms no playbook. Learned future
selection requires the separate [experiment and adoption path](EXPERIMENTS.md).

## Use ordinary job history as development evidence

The operator can explicitly select private ordinary job controllers for a
sanitised failure-pattern report. It retains candidate failures even when later
repaired, independent negative or not-established findings, uncertain effects,
and explicit negative human verdicts. Repeated journal snapshots do not multiply
one observation. Expected baseline-red and simply waiting for a person are not
counted as failed implementation or human dislike.

```sh
wring experiment patterns --from ORDINARY_CONTROLLER --from ANOTHER_CONTROLLER --task-family FAMILY --json
```

Use real private controller directories and one explicit task-family name;
omit the second `--from` when selecting one job. `--json` prints the bounded
structured report; without it the command prints a short summary. Neither starts
an agent. Do not pass an experiment trial through this route.

Only structured identities and outcomes enter the report: no worker conversation,
check output, human review words, actor names or controller paths. Known
experiment/proposal directories, research-purpose markers and experiment
authority are refused by this ordinary-job route, even when a controller has
moved outside its original research directory. The experiment route separately
restricts patterns to development-split records.
The operator still must not copy held-out answers into an ordinary source clone
and call them development evidence. These reports suggest questions worth
testing; they do not authorise a proposal, comparison, adoption or paid call.

## Resume and portable handover

Loop decisions are journaled before another attempt. Resume validates their
observations, order and required coverage. Missing, renamed or changed decision
anchors cannot be used to buy another repair. Completed effects are reused;
uncertain ones retain their reservations. No automatic paid replay is introduced.

V3 work produces verification v2 and delivery v4 records. The bundle includes
`engineering.json`, selected playbook bytes when present, worker-use identities,
loop decisions, and the verification/observation files under `receipts/`.
Certificate, board, summary and MR derive the same engineering facts. Older
delivery versions are not reinterpreted as carrying these new proofs.

Follow the **actual delivery's `mr.md`**, in the fresh clone and branch it names.
Its offline audit reconstructs structured-check classification, repair excerpts
and loop decisions from carried data, and checks the selected playbook source
and use identities. It does not read the original controller's private directory.

One important limit remains: `observationSha256` in a repair packet is an opaque
commitment to the original controller observation. Host-specific runtime
provenance is projected for the portable receipt, so audit does **not** recreate
the complete original envelope byte for byte. It validates the carried outputs
and reconstructed packet while retaining that original digest as a commitment.
These consistency checks are not signatures proving an honest controller,
live isolation, model understanding or measured playbook benefit. A carried
adoption receipt likewise names a decision and private evidence revision; it
does not rerun the comparative trials.

The extra breakage test printed by `mr.md` is a separate execution requiring the
declared verifier. Offline audit is not that test. Unknown billing is still
unknown, and an inconclusive live comparison leaves the current approach in place.
