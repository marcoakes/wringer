# Measured improvements for future work

Wringer can compare one worker playbook against the current approach, retain
every planned trial, and record an operator's decision to use or undo a specific
version for future plans. It cannot declare its own improvement approved.

The ordinary PM loop is unchanged: approve the plan, inspect the result, give
your judgement, then make a separate handover decision. Improvement work is
optional and receives a **separate finite allowance**. No background experiment,
automatic paid analysis, model supervisor or automatic promotion is enabled.

## What is implemented

| Operation | What happens | What does not happen |
| --- | --- | --- |
| Register a comparison | Freeze tasks, source trees, both plans, one changed variable, prediction, sample size, ordering, limits and holdout policy | No model or runtime call; no execution approval |
| Review results | Offline comparison over exact retained records, including failures and missing trials | No provider, runtime or credential-store calls |
| Collect trials | Fresh source transport, measured contained discovery, normal bounded worker/judge journey, exact human displays, and a generated private Git handover/fresh-clone audit when ready | No host fallback, production Send, forge credential or hosted MR |
| Record research judgement | Bind a real or fixture-labelled observation to an actual carried display and exact candidate | No production human acceptance or publication authority |
| Finish research review | Separately confirm an actual retained research review for that private workflow and its generated local ending | Zero new agent sessions; no original-clock renewal, production approval or changed trial |
| Adopt / undo | Append a revision-checked future-selection record | No edits to active plans, approval, old evidence or source files |
| Find recurring failures | Group structured **development-only** observations by comparable source, requirements, environment and runtime | No private conversation, exception prose or held-out feedback enters a proposal |
| Suggest an approach | One separately authorised contained ACP worker proposes one inert playbook and prediction artifact | No grader, policy, budget, current playbook or active-run changes |

The new commands are under `wring experiment --help`. Public `bench` and fleet
execution remain unsupported; this is a narrow comparison, not their revival.

## Prepare an honest comparison

Choose baseline and candidate playbook bytes already committed in the source
repository. Compile a plan for each arm. The **only** permitted plan difference
is its worker playbook selection and resulting plan digest. Source revision,
intent, check and grader identities, runtime image, role commands, model/adapter
selection, scope and budget stay fixed. Both playbook paths must be protected in
both plans; do not weaken acceptance protection to make the comparison compile.

A task entry contains `id`, `sourceTree`, `split`, `baseline` and `candidate`.
`baseline` and `candidate` are complete compiled v3 plans, not paths or executable
templates. `sourceTree` is the exact observed Git tree (`git rev-parse COMMIT^{tree}`),
not just a branch name. Collection checks it against the fresh source map.
Renaming an identical source/intent/acceptance contract cannot create a new task.
Both plans need an explicit applicable playbook where selected; the no-playbook
baseline uses `baselinePlaybook: null` and the same protected input paths.

The complete input contract is `ExperimentPlanInput` in
`packages/application/src/experiment-types.ts`; the inert construction example
is `examples/improvements/prepare-comparison.ts`. Its output is an unapproved
registered comparison, not a build or spending approval.

Keep held-out answers, private solutions and hidden grader internals in the
evaluator's private domain **outside every repository cloned for a proposer or
trial worker**. Declared task requirements must still be understandable. The
`candidateAuthorSawHeldOutSolutions: false` field is an operator attestation,
not a magical scan proving absence of solutions in a repo. Wringer confines the
proposal's writes and includes only development patterns in its prompt, but a
coding runtime can read its cloned repository. Do not put hidden answers there.
Changing a model, image, check family or task family makes prior efficacy evidence
out of scope. Holdout reuse is limited by the registered candidate-iteration
ceiling; repeated tuning needs a new untouched corpus, not a renamed task.

## One allowance, durable accounting

Create a private directory with mode `0700`, outside Git and outside production
controller state. Register the immutable input before any trial exists:

```sh
wring experiment register --input comparison.json --state /PRIVATE/experiments/reports
wring experiment grant --state /PRIVATE/experiments/reports \
  --actor "Research operator" --expires 2026-10-01T12:00:00Z --output grant.json
wring experiment collect --state /PRIVATE/experiments/reports --grant grant.json --yes
wring experiment evaluate --state /PRIVATE/experiments/reports
```

Use an actual future expiry and replace private paths with your own directory.
The grant names exactly the configured runtime credential **names**, never their
values. It does not read a Keychain or log in. Normal runtime credential plumbing
is used only when the explicitly authorised collection runs. The complete
schedule's maximum role sessions is reserved **before** source preparation or
runtime activity. Reservations are not refunded or reset per task, arm or retry.
The global clock includes preparation, comparison work, displays and downtime.
Session and wall-clock limits are **not a universal hard cash cap**; billing stays
unknown unless actual provider evidence is available (this comparison stores
cost as unknown).

The order alternates baseline/candidate within paired tasks and repetitions.
Each trial has its own source store, contained discovery and fresh role state;
there is no shared mutable agent memory. Trial output stays private. A genuinely
ready check-only trial exercises the normal delivery service against a generated
private bare `origin.git`, then clones its experimental branch into a fresh
directory and audits every carried claim. Only repo-local Git identity is used;
no caller-selected remote, forge credential, hosted MR or production branch is
accepted. `handovers/<trial-id>.json` records passed, failed or unknown with exact
source, branch and audit identities. Source, role and verifier records remain in
each private `journeys/<trial-id>` directory. A human hold is unknown until a
separate actual research review and private ending have been completed.

Every experimental controller receives an immutable `experiment-purpose.json`
before source preparation or agent activity. The ordinary delivery command also
enforces that purpose: using the regular CLI cannot turn a research Yes into
production approval or send to a different remote. Portable evidence is marked
private research too. This is enforcement inside the product, not a claim that a
hostile same-user owner cannot rewrite their own files and program.

An infrastructure failure stops further collection and records remaining slots
as not-started. A resumed dispatched trial is reconciled from retained evidence
only; uncertain model calls are not replayed. Uncertainty and missing records
stay in the denominator. A completed-but-missing record is a refusal, not a fresh
paid attempt. Fixture/live mode is durable and cannot change on resume.

## What the comparison can conclude

The first implementation supports `worker-attempts` and `functional-completion`.
The prediction fixes a minimum useful improvement and a one-sided sign-test
threshold of at most `0.05`. Repetitions are averaged **within each task** before
the sign test, so repeating one easy task cannot manufacture independent evidence.
The result includes every task pair, source family, regression and denominator.
Distinct task contracts do not prove statistical independence; generalisation
still depends on the corpus design.

For example, four tasks with two repetitions per arm is 16 journeys. Even eight
positive pairs are only four task units: the sign probability is `0.0625`, so
that pilot cannot automatically satisfy a `0.05` gate. It is useful engineering
evidence, not permission to widen the sample after seeing the result. A new
comparison and finite grant are required if the fixed experiment is insufficient.

Adoption eligibility requires all planned trials, live-contained evidence,
matching observed adapter identities, usable measurements, the predeclared
benefit and uncertainty threshold, and no per-requirement or bounded-contract
regression. Both arms also need a matching passed private handover and literal
fresh-clone audit. Unknown infrastructure, uncompleted human endings or safety
observations prevent eligibility.
Assertions in strict plans retain their red/green identity checks. The safety
columns mean the exact measured contract predicates: validated authority,
paired protected acceptance observations, independent contained provenance,
an explicit bounded credential/pattern scan of retained worker patches/evidence,
and the exact private Git handover/fresh-clone audit.
They are **not** proof of total security, perfect tests or absence of all possible
secret encodings. Effective opaque provider revisions and billed cost remain
unknown even with pinned runtime/adapter/model configuration.

Deterministic fixtures can prove that eligible, harmful, no-op, stale and missing
cases are distinguished. They **cannot** make a candidate eligible for live
adoption. Synthetic live-shaped records in unit tests are labelled as unit-test
mechanism probes in the test source, never published as actual live trials.

## Human and visual research observations

A human-hold captures the declared output through the existing contained display
service. `displays/<trial-id>.json` carries the actual source-bound output and,
for visual plans, pinned references and decoded PNG captures. A claimed hash
without a matching carried display is refused. A failed, stale or replaced image
cannot make the observation eligible. No result is automatically judged Yes.

`wring experiment review --input REVIEW.json --state PRIVATE_DIR --yes` records an
explicit research observation. It must name the trial digest, exact candidate,
actual retained display digest, actor, real-versus-fixture status, independent/
blinded status and every human requirement with the observer's note. Only real,
independent blinded observations qualify for a human/visual comparison. Those
attributes are recorded research attestations, not protected human-presence
identity. A research observation never enters the production Yes/Send store.

Recording the review does not run anything. A positive review can separately
complete **only its private research ending**:

```sh
wring experiment research-finish --state /PRIVATE/experiments/reports \
  --trial TRIAL_SHA --expected-review REVIEW_SHA --actor "Research operator" \
  --seconds 120 --yes
```

This reserves at most 120 seconds and **zero** agent sessions. It requires the
original journey approval still to be valid; the new operation cannot renew an
expired clock, change a source tree, run another check or start another worker.
The actual carried display and observer's unchanged words are evaluated in that
private journey. Its only possible publication is another generated private
local experimental branch, audited in a literal fresh clone. A negative review
stays a negative result, not an instruction to manufacture approval.

The original trial and its original unknown ending stay immutable. A
`research-completions/<trial-id>.json` supplement binds the exact trial, review,
display, separate allowance and new handover result. Offline evaluation requires
this matching supplement for human trials. A crash consumes the local reservation
and remains unknown; it does not replay approval or publication. Plan enough time
for actual reviewers before preregistering the whole-journey clock. Scripted
reviews may exercise this path only for fixture-labelled trials, never qualify
live benefit, and never become production human approval.

## Adopt, inspect and undo

An eligible report is still not approval. The operator reviews it, then supplies
the exact evidence revision, expected current selection and registry revision:

```sh
wring experiment adoptions --registry /PRIVATE/playbook-adoptions
wring experiment promote --state /PRIVATE/experiments/reports \
  --registry /PRIVATE/playbook-adoptions --actor "Research operator" \
  --note "My assessment of this exact comparison" \
  --expected-revision REGISTRY_SHA --expected-current none \
  --expected-evidence EVIDENCE_SHA --yes
```

The empty registry revision is 64 zeroes. After adoption use its actual digest
and revision, not these placeholders. A registry is scoped to one repository and
task family. Stale evidence, duplicate/concurrent decisions and a changed current
approach refuse rather than overwrite it. The result is a future-selection
receipt that a **new, separately reviewed plan** can bind. Promotion itself does
not modify the repo or start/approve a job.

`wring experiment rollback` uses the same actor/note/expected-current/revision/
evidence guards and restores the previous approved digest (or no playbook).
It appends a decision; it never rewrites an old plan, completed delivery or active
approval. Future plan/delivery lineage carries the selected adoption receipt.

## Optional proposal, not an always-on meta-agent

`patterns` extracts structured development observations. A proposal request then
binds that report, the exact baseline playbook snapshot, one separate authorising
actor, one session, finite turns/time, worker credential names and a fixed output
such as `wringer/proposals/reports-next.json`. The proposal plan's only writable
scope must be that exact inactive artifact; it cannot replace the current playbook.
The contained worker's output is `{manifest,prediction}`. Identity, worker role and
applicability must match the baseline; a new revision is required. The controller
validates the exact captured artifact, not model prose. No analysis model loop is
implemented inside Bun.

Use `prepare-proposal` to validate and retain this separate grant without running
anything, then `propose --yes` if the operator has authorised the bounded work.
One reservation remains charged after a crash or invalid result. The outcome is
only a hypothesis: review/commit its proposed playbook bytes, register a new
comparison, collect under its separate allowance and review eligibility. No
automatic experiment, scheduling, adoption or execution follows a proposal.

## Evidence and remaining release gates

Deterministic and local record tests exercise failure accounting, no-op/harmful
comparisons, fixture refusal, stale prediction/evidence, corrupted history,
duplicate clicks, mode laundering, source/task identity, bounded reservations,
actual display binding, future-only CAS and rollback. Actual local Git fixtures
exercise normal private delivery, a literal fresh-clone v4 audit, corrupt-receipt
refusal and the separately authorised human ending without additional roles.
The roles, verifier observations and human reviewer in those fixtures are
explicitly scripted; the local Git delivery/audit itself is executed. Offline
evaluation has instrumented no-spawn/no-fetch tests. These are engineering
checks, not live efficacy or an independent PM/design test.

Still required before claiming measured live improvement: a separately funded
held-out comparison on a real digest-pinned contained image; independent PM/
designer observations where applicable; live integration and recovery evidence;
and publication of the actual result even when harmful or inconclusive. The
cooperative-local owner trust limitation remains explicit. Do not rewrite older
blind-test verdicts or turn a fixture into that missing measurement.
