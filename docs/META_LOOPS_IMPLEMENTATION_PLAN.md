# Wringer: measured improvement loops

Implementation plan - 9 September 2026

Baseline: Bun `1.0.0-alpha.9`, source `9d909f3bf93fcd545880bd1ed742ce78c1d58ff5`

Status: **implemented in source; live release gates remain pending**. The user
subsequently authorised implementation. This document does not authorise new
paid trials, account changes or a public release. Sections 1–10 preserve the
original design, baseline findings and proposed sequencing; they are not all
current command documentation. [Section 11](#11-implementation-checkpoint---9-september-2026)
maps the delivered source paths and explicit limits. Use the
[measured-loop guide](native/MEASURED_LOOPS.md) and
[experiment guide](native/EXPERIMENTS.md) for the implemented operator routes.

## 1. Decision

**Yes: bring back bounded loop contracts, useful failure feedback, evaluated repository playbooks and prediction-gated improvement. Do not bring back the entire old architecture.**

The product opportunity is specific: Wringer should get better at completing a particular repository's work, with evidence of which approach helped, without asking the PM to manage agent retries or trusting a model to grade its own improvement.

The first win is a better existing loop, not a permanent extra supervisor agent. The eventual meta-loop should produce a tested proposal for a future run. It must never rewrite the rules of the run currently in progress.

North star: **better attempts now; proved improvements for next time; unchanged human control over what matters.** This is a direction, not a claim that the current release learns across runs.

## 2. What to keep from the old architecture

| Old idea | Decision | Concrete product benefit | Boundary |
| --- | --- | --- | --- |
| Structured repair feedback | Build first | The worker sees the actual failure it must repair, rather than an inaccessible evidence path | Controller-retained observations, bounded and redacted; no new model call |
| Loop contracts and anti-thrash | Build next | Detect exact repeated unsuccessful work and make repeated failures visible | No fake quality score, no automatic best-effort delivery |
| Repository readiness | Extend existing maps, do not rebuild onboarding | Explain missing tools/context/check evidence before wasting a worker attempt | Measured facts and source-linked suggestions, not an opaque readiness percentage |
| Skills registry | Reduce to repo-owned, evaluated playbooks | Reuse a working approach for this repo and task family | One pinned, worker-only advisory playbook initially; no marketplace or scripts |
| Falsifiable prediction contracts | Build after the measurement base | A proposed improvement must predict a benefit and survive comparison | Fixed tests, held-out tasks, separate experiment allowance, uncertainty visible |
| Harness self-evolution / meta-loop | Narrow to proposing and evaluating playbook changes | Repeated failure evidence can become a reusable improvement | No automatic engine, acceptance, policy, agent, permission or budget changes |
| Per-loop observability | Build as ordinary portable records | Explain attempts, regressions, stops and remaining allowance on the existing job page | No new dashboard or telemetry service required |
| Graph/fleet, best-of-N, cloud/gateway sprawl | Defer | No demonstrated need for the next PM loop | No revival of currently refused public execution paths |
| Plateau-to-delivery, judge score convergence | Reject | A plateau does not make unfinished work acceptable | Never convert stuck work, model consensus or a higher score into handover authority |

The old design's dollar/token caps, automatic approval by task category, configuration evolution and live signing are not inherited as implemented capabilities. Each would require a separate supported contract and proof. [S1, S2]

## 3. Current code gives us a useful starting point

Already present: red-first command checks, isolated worker/judge, deterministic candidate verification, bounded repairs, human correction, source-bound display/Yes, separate Send, durable reservations and portable audit. No-progress handling already stops an unchanged candidate. We should extend these paths rather than introduce a second orchestrator. [S3-S5]

Two source-level findings determine the first increment:

1. **Repair feedback is too thin.** `CandidateVerification` exposes check IDs, status, exit code and hashes. Its `evidenceRef` points into controller storage. `previousFindings` passes that summary into the contained worker prompt, but the detailed controller output is not thereby readable inside the worker sandbox. Supply actionable observed failure details directly, with provenance. This is a source-level gap; a live A/B improvement has not yet been measured. [S3, S4]
2. **A nonzero exit is not always an assertion failure.** The current service excludes known infrastructure exit codes, but most other nonzero exits become `failed`. A syntax/import/discovery error returning exit 1 can therefore look like a red acceptance check. Add a truthful distinction between “command failed” and “the requirement's assertion failed.” Do not retrospectively upgrade old receipts. [S3]

The latest 35-check design rehearsal is valuable engineering evidence, but its role replies, runtime provenance and human decisions were scripted. It cannot establish that a new retry strategy or playbook improves genuine agent performance. Live browser-capable containment and independent PM/design measurement remain dependencies. [S9]

## 4. Architecture: three different loops, not one self-authorising agent

| Loop | What changes | Where it runs | What can authorise it |
| --- | --- | --- | --- |
| Agent's inner loop | The candidate implementation | Existing ACP coding runtime in its sandbox | The approved role, scope and remaining journey allowance |
| Wringer engineering loop | Which already-approved attempt comes next, or whether to stop | Bun workflow using measured check/source observations | The pinned plan and deterministic loop policy; no new model supervisor |
| Improvement meta-loop | A candidate worker playbook for future runs | A separate isolated proposal job and evaluation controller | A separate finite experiment allowance, then a distinct promotion decision |

The meta-loop lifecycle is: **retained outcomes -> proposed explanation -> predicted improvement -> fresh comparative trials -> evidence review -> approved playbook version -> future run**.

The proposer does not modify its own grader. An experiment does not publish its candidate. Promotion does not change an active run. Every deployed playbook remains a normal repository artifact with an exact identity and a reversible adoption decision.

Keep the current chain: YAML / constrained TypeScript configure; Bun orchestrates; ACP transports; the runtime executes; the sandbox contains. No model/tool reasoning loop moves into the CLI. The same-user cooperative-local limitation remains explicit; this plan does not solve hostile-controller isolation by naming an approval record. [S2, S8]

## 5. Delivery increments

### Increment 0 - freeze the comparison and define success

Deliverables:

- Preserve alpha.9 and existing failed/successful measurements. Do not improve an app while counting it as the baseline blind run.
- Create a small, sanitised development corpus from actual failures: inaccessible check output, import error counted as red, empty tests, repeated source tree, repeated failing requirement, visual correction, stale display, interrupted retry and handover/audit consistency.
- Record task/fixture source, runtime image, agent/adapter/model identifiers, check identities, plan, start/end and role reservations. Unavailable provider versions or billing remain explicitly unknown.
- Establish a baseline report for completed handovers, attempts, operator interventions, PM decisions, blocked reasons and audit outcomes. Deterministic fixtures and live model trials have separate labels and denominators.
- Freeze the independent PM entry point before its run. A developer cannot act as the independent PM merely to finish the measurement.

Exit: the comparison can be reproduced from its record and a failed run cannot disappear from the denominator. No new paid call is necessary for this instrumentation/fixture increment.

### Increment 1 - give the worker better evidence; make red-first precise

Deliverables:

1. Add a pure repair-packet builder in `packages/workflow/src/repair-packet.ts`. Through `packages/application/src/services.ts`, load only the exact retained observation envelope for the current source, check inputs and effect ID.
2. Include command/check ID, linked requirement IDs, assertion or command outcome, bounded stdout/stderr excerpts, candidate identity, recent attempt outcomes and portable receipt digest. Include baseline diagnostics as well as later repair failures.
3. Redact the entire input before truncation. Bound bytes and history; label omitted evidence. Never pass an arbitrary host path as though the worker can open it. Treat tool output as untrusted data, not instructions or permission.
4. Keep executed checks distinct from judge findings and human correction. Worker conversation stays absent from judge input. A malformed or unavailable packet must not silently trigger another paid repair with fabricated or empty details.
5. Introduce a structured check-observation contract and one declared adapter for the Reports starter's protected check runner. Track discovery, executed assertions, failures, skips and runner errors separately from process exit. No large parser ecosystem in this increment.
6. Generic commands keep their narrower “command failed before implementation” claim. An opt-in strict plan requires an executed failing requirement assertion before saying “assertion-proved red.” The same pinned requirement-linked assertion identities must execute successfully on the candidate before claiming assertion-proved completion. Exit 0 with a formerly failing assertion missing, undiscovered or skipped is not green evidence for that requirement. Missing/invalid/contradictory reports are not proof; empty or all-skipped suites cannot earn either claim.
7. Add source-linked readiness explanations from existing environment observations. A proposed context or check change is a draft for a new contract, not an automatic AGENTS.md rewrite.

Tests: secret at a truncation boundary; huge or missing output; tampered envelope; wrong source/check hash; prompt-injection text; correct protected command; import/syntax error exit 1; all-skipped/zero-test suite; truncated or contradictory structured report; genuine executed failing assertion; red assertion disappears or becomes skipped; valid paired green result; preserved historical semantics.

Exit: an isolated worker receives useful authenticated-by-controller observations without host paths or extra model calls; the board, delivery and audit distinguish command-red from assertion-red. These identities provide consistency, not a cryptographic guarantee that the controller is honest or a test is sufficient.

### Increment 2 - stop repeated waste without stopping legitimate progress

Deliverables:

- Add a pure `packages/workflow/src/loop-analysis.ts`, evaluated after verification and before another worker reservation.
- Detect **exact repeated unsuccessful candidate trees**, including A -> B -> A, only under comparable pinned acceptance, check inputs, runtime image and relevant environment identity. Record the earlier matching attempt. The existing unchanged-source stop stays.
- Record outcome vectors per requirement/check. Same failing checks after several changed candidates is a warning, not proof that no progress occurred. Do not equate fewer failed checks with success when other checks regressed.
- Do not hash raw output as the primary failure signature: timestamps and incidental wording are not stable identities. Use stable test IDs when actually available, never invented from model prose.
- Default policy: exact-repeat stop; repeated-outcome warning after three candidate attempts; no new hard stagnation cap unless explicitly selected in the plan. A selected cap is a retry-policy limit, not a scientific quality judgement.
- Persist the decision before dispatch, with input/history digests and remaining allowance. Resume must validate/recompute consistently; correction, a new page or rewritten model text cannot reset history or whole-journey limits.
- The PM sees “The same requirement still fails” or “This repeats an earlier unsuccessful version,” followed by one safe available action. Ordinary Continue must not silently spend through an exact-repeat stop. Existing explicitly bounded retry may be offered if still authorised; increased scope/limits require a new grant.

Tests: A -> B -> A; different commits/same tree; false positives from legitimate multi-step repairs; new pass plus regression; noisy output; changed check/environment identity; unknown judge result; crash before/after decision and reservation; duplicate clicks; correction preserves usage; corrupted history; expired approval; no remaining sessions.

Exit: seeded exact repeats stop before another automatic role dispatch; the same source history produces the same decision on resume; legitimate changed candidates are not stopped merely for equal failure counts. Final acceptance and Send remain unchanged.

### Increment 3 - add one repo-owned, evaluated worker playbook

This is the useful first slice of the old “skills registry,” not a global agent-skill loader.

Deliverables:

- A committed playbook has a versioned manifest, stable ID, content hash, supported task family, required context/tool/check capabilities, bounded advisory instructions, known limits and evaluation references. Use a tracked directory such as `wringer/playbooks/`, not ignored local run state under `.wringer/`.
- The plan binds exact playbook bytes and selected scope. Selection occurs before approval, based on declared applicability and existing observations; no online LLM selector is needed. Ambiguity is shown in the proposal rather than guessed silently. Only an explicitly selected artifact loads: no wildcard discovery, executable metadata, remote fetch or template interpolation.
- Start with **one worker-only Reports/design-system playbook**: inspect the approved component library/tokens and design reference; use the declared data contract; repair the named functional failure before changing presentation; preserve requirements and request fresh captures through the existing workflow.
- Playbooks cannot declare new tools, shell scripts, network access, secrets, models, roles, acceptance checks, capture paths or budget. They cannot issue an approval. Prompt text cannot enforce these rules, so the compiler/runtime must retain mechanical boundaries.
- Snapshot the selected playbook into controller-owned read-only role context using the existing protected-context pattern. Record which exact version was used; do not accidentally share the worker playbook or worker repair conversation with the judge.
- Existing runs without a playbook continue unchanged. A changed playbook hash cannot inherit an old approval. Unknown or incompatible playbooks refuse before worker spend.

Tests: invalid/oversized manifest, path traversal/symlinks, unapproved edits, missing context, applicability mismatch, malicious instructions requesting tools or a human Yes, judge isolation, old plan compatibility, snapshot/delivery/audit binding and no undeclared environment access.

Exit: one frozen playbook can be included in a newly approved run, its bytes survive handover/audit, and it cannot enlarge authority. **Its presence alone is not evidence of benefit.** Default adoption waits for Increment 4.

### Increment 4 - implement prediction-gated comparison and promotion

Separate two operations:

- **Review recorded results:** offline, no provider calls; reads retained trials and reports what can and cannot be inferred.
- **Collect comparison trials:** fresh contained baseline/candidate runs under a separate explicit experiment grant. This may spend and must reserve the whole experiment allowance, not reset it per arm, task or retry.

The experiment contract pins:

- Baseline and candidate playbook digests; one declared changed variable.
- Task corpus and held-out split; check/grader identities; runtime, agent/adapter/model selection and platform stratum.
- A falsifiable prediction, target metric, minimum useful change, regression vetoes and maximum trials/role sessions/wall clock.
- Trial order/randomisation, comparison method, failure/timeout accounting, stopping rule and what “inconclusive” means, all before results are known.
- Separate authorising actor, data-use scope and credential names. No forge publication credentials and no automatic reuse of a product-build grant.

Example prediction, explicitly a proposed threshold rather than a promised result: “On the Reports task family, this playbook reduces median worker attempts by at least one without reducing functional completion, weakening any safety case, or increasing required PM interventions.” For tasks already completing in one attempt, choose a different measurable target before evaluation; do not fabricate headroom.

Start with low-cost deterministic control tests. An initial live pilot can use four representative tasks, both arms and two repetitions: **16 complete journeys**, within a separately agreed allowance. This detects obvious regressions and measurement faults; it is not a default-promotion claim. Expand held-out trials only under the experiment's predeclared sequential rule and finite grant. Insufficient evidence stays inconclusive rather than quietly growing the run.

Baseline and candidate start in separate fresh clones/sandboxes with independent state; no previous solution branches, shared mutable memory or warm conversation leaks. Alternate/randomise trial order; record infrastructure failures rather than selecting only successes. Do not change vendor/model/runtime while attributing gains to the playbook. Model nondeterminism and infrastructure noise remain part of the comparison.

Candidate authors may inspect the development corpus, not held-out answers, private solutions or grader internals. Test requirements remain understandable to trial workers; hidden expectations must not make valid solutions fail. The evaluator's retained corpus and grader bytes are outside candidate write authority. Limit candidate iterations and holdout queries; repeated tuning against one holdout requires a new untouched validation set.

Promotion has two gates:

1. **Mechanical eligibility:** exact identities; all trials accounted for; no acceptance/authority/secret/handover regression; the predeclared benefit and uncertainty threshold are met. Report per-task and per-requirement results, not just an aggregate score. Deterministic fixtures never establish model-performance gains. Worker attempts are not a dollar-saving claim when billing is unknown.
2. **Explicit adoption:** an operator reviews the evidence and promotes the specific digest for future plans. One decision per evaluated version, not per repair attempt. The action checks the expected current version and evidence revision; a stale or concurrent promotion refuses. Adoption neither starts a job nor approves its execution. A visual-quality claim also requires independent blinded designer judgement; an LLM score or screenshot distance is insufficient. Simulated human decisions are labelled fixtures and excluded from independent-human metrics. Real blinded designer judgements remain real research observations, not production Send authority. Experiment bundles retain experiment/fixture status and use private local delivery targets; neither kind of decision can silently authorise a production handover.

Rejection/inconclusive means retain the result and keep the current default. Promotion records the previous digest and applicable task family. Rollback selects the previous approved version for **future** runs; it does not rewrite active plans, old receipts or completed handovers. Model/runtime/check-family changes mark prior efficacy evidence out of scope until re-evaluated.

Exit: a seeded beneficial candidate is distinguishable from a no-op and harmful candidate; benefit claims include their evidence limits; injected rule weakening cannot become eligible; promotion/rollback is explicit, digest-bound and auditable. At least one real held-out comparison is required before saying a playbook measurably improves live work.

### Increment 5 - add the narrow meta-loop; prove the PM experience

Only after the previous increments work:

- Produce an offline failure-pattern report from selected, sanitised run records. Group by comparable repository/task/plan/runtime/check family; distinguish tool/environment failures, product-check failures, agent findings and human preferences.
- An optional separately authorised, finite ACP proposal job can suggest **one playbook patch plus a prediction**. Reuse the existing contained worker execution substrate; do not add an always-on meta-agent or give it the live controller's write access.
- Its writable output is the candidate playbook/proposal only. Engine, policies, budgets, approved requirements, test corpus, graders and current-run records are outside scope. Config evolution from the old architecture is excluded.
- The proposal cites observed failures and names uncertainty. A model's explanation is a hypothesis, not a causal finding. Raw private role conversations, credentials and unrelated designs are not the learning corpus. Repository-specific material does not flow to other repos or a global registry without explicit disclosure.
- Route the proposal through Increment 4. Stop on no benefit, exhausted allowance, invalid evidence or human rejection. No automatic scheduling, paid analysis or promotion is on by default.
- Keep the PM on the same job page and coding-app entry. Ordinary runs show their selected approach and exact allowance. Improvements appear as an optional “Test this improvement” / “Use for future work” card with evidence, not another dashboard. These are proposed labels, not existing commands.

Exit: a recorded recurring failure can produce a bounded candidate, be tested, and either be rejected or explicitly adopted without changing the active run's rules. The PM's ordinary happy path remains approve plan -> inspect result -> Yes -> separate Send. No meta-loop prompt is added to each build attempt.

## 6. Schema and package implementation map

Use the current packages. Avoid a new generic graph, memory service or agent framework.

| Area | Changes |
| --- | --- |
| `packages/records`, `schema/` | Add versioned check observations, repair packets, loop decisions, playbook manifests, experiment plans/results and promotion records where they cross persistence/audit boundaries. Derived display-only views do not each need a public schema. |
| `packages/plan` | Compile a proposed execution-plan v3 and matching planning-request version carrying loop policy, check-evidence level and optional pinned worker playbook. Establish this contract for the strict-check increment, not only when playbooks arrive. Preserve frozen v1/v2 bytes and semantics; unsupported new records refuse clearly. |
| `packages/engine` | Bounded structured-report adapters and redaction helpers; no model inference. |
| `packages/application/src/services.ts` | Resolve exact retained verifier observations; build provenance-bound feedback and readiness explanations. |
| `packages/workflow` | Pure repair-packet and loop-analysis modules; existing stage/reservation/journal integration; preapproved context snapshots. |
| `packages/runtime`, `packages/acp` | Reuse contained read-only context patterns; retain role isolation and existing ACP transport. No blanket skill execution or host filesystem callbacks. |
| `packages/application`, `packages/cli`, `packages/mcp` | Shared read-only observations and guarded experiment proposal/status operations. Spend and promotion remain explicit operator authority; assistant tools cannot impersonate that authority. |
| `packages/board` | One current-action summary, per-requirement progress and optional future-improvement card; familiar correction/Yes/Send semantics. |
| `packages/delivery` | Add a proposed delivery v4 for playbook use, check-evidence level and loop-decision identities, with redacted portable evidence and audited inventory. Preserve frozen v3 and older readers/claims rather than extending their meaning silently. |
| Existing test/validation scripts | Add deterministic adversarial fixtures, real process/restart checks, compiled CLI contracts, browser interactions and separately labelled live experiment collection. Do not turn public historical `bench`/fleet execution back on. |

The existing execution-authority v1 may continue binding a new plan digest only if its action and budget meanings remain unchanged. A new experiment's aggregate grant must be explicit and separately represented; never overload “build” to silently fund analysis or many evaluation arms. Decide exact schema names during the contract design, before implementation, and freeze them thereafter.

The original design snippets and proposed UI labels in Sections 1–10 are retained
as design history, not a substitute for current command help. Section 11 and the
operator guides distinguish the implementation from that original proposal.

## 7. Fewer interruptions, not fewer boundaries

| Event | Does the PM need another decision? |
| --- | --- |
| Normal verification failure and permitted worker repair | No; use the original remaining allowance |
| Passing approved playbook/context to a worker | No; it was included in the plan they approved |
| Outcome-history warning | No; informational unless the plan's retry policy stops work |
| Exact repeat, unavailable evidence, expired grant or exhausted allowance | Stop with the reason and available bounded next step; no silent bypass |
| New scope, design reference, requirements, permissions or extra allowance | Yes; this is a changed contract |
| Actual human result acceptance | Yes; show evidence and record their judgement |
| Publication | Separate Send |
| Paid comparative experiment | One separate finite experiment authorisation, never repeated permission for each already-approved trial |
| Adoption of an evaluated playbook | One explicit promotion for a specific version and applicability scope; future ordinary repairs do not ask again |

Managed OS/application permissions still apply. The product must not promise to suppress approval prompts it does not control. Protected human-presence deployment remains separate security work; until it exists, retain the cooperative-local warning.

## 8. Success measures and release gate

Primary product measure: **the share of frozen-scope tasks reaching a valid handover and fresh-clone audit, with acceptable PM effort and no safety regression**. Track human design acceptance separately; a stop correctly enforced is a safety result, not a completed task.

Supporting measures:

- Worker/judge attempts and session reservations per task, including failures and cancellations.
- Time in verification, agent work, human waiting and total wall clock, separately.
- Undocumented operator repairs, unnecessary approval prompts, substantive PM decisions and clarification questions, separately.
- Exact repeated-tree dispatches prevented; legitimate-repair false-positive stops.
- Command-red versus assertion-red, unavailable checks, skipped/discovered/executed assertions and baseline regressions.
- Benefit by playbook/task/runtime family, with baseline/candidate denominators and uncertainty. Unknown cost and telemetry stay unknown.

Core-loop release window (Increments 0-2):

1. Existing frozen contracts and standard validation remain green on macOS/Linux; no weakened tests or reclassified historic successes.
2. New negative fixtures fail closed; resume/duplicate-click tests preserve authority, history and reservations.
   Offline result review is demonstrated to make zero runtime, provider and credential calls. A prediction recorded after its trials cannot qualify as preregistered.
3. A live contained repair comparison demonstrates actionable feedback; no scripted convergence claim.
4. An independent PM/designer completes the frozen Reports journey, including one meaningful correction and fresh review, separate Send and a literal fresh-clone audit. Choose live Figma versus owned-reference lane before starting and state which was measured. Freeze the entry point; first undocumented repair ends the blind verdict, salvage is separately labelled.
5. Handover, board and audit agree on source, loop decisions and human notes. New automation must not introduce additional routine approval prompts.

Playbook/meta-loop release window (Increments 3-5):

1. All core-loop compatibility, safety and PM-surface gates still pass.
2. A real held-out playbook comparison is published honestly as beneficial, harmful or inconclusive. Only a beneficial eligible candidate may be promoted.
3. A separate independent operator/PM review demonstrates promotion, refusal and rollback without altering active runs or granting production publication authority.
4. Fresh-clone audit resolves the exact selected playbook and its use/promotion lineage. Experiment status, real research judgements and simulated decisions remain distinct.

Do not hold the next PM blind test hostage to the entire meta-loop roadmap. After Increments 1-2, freeze and test the improved core; Increments 3-5 are a second measured release window. If comparison shows no benefit, stop expanding that mechanism and retain the smaller working loop.

## 9. Dependencies and execution order

Critical path: **baseline -> better observations/repair packets -> loop policy and recovery -> pinned playbook -> comparative evaluation -> proposal meta-loop -> independent validation**.

Can run in parallel after contracts are pinned: check adapter/repair packet work; loop-analysis adversarial fixtures; board progress-copy tests; design playbook content using owned inputs. Integration must pass before any comparison is attributed to a feature.

External dependencies for live proof, not for writing the first increments:

- An actual digest-pinned browser-capable contained image on the chosen platform, adequate disk/resources, and existing worker/judge credentials.
- A separately authorised finite trial allowance. Current controls limit sessions/time, not a universal hard cash ceiling. No price or zero-cost claim without provider evidence.
- Owned reference material, or actual eligible and authorised live Figma/MCP access; a token alone is not integration proof.
- A held-out task set and an independent PM/designer. Reusing training examples as “blind” invalidates the claim.
- Protected controller/human-presence provisioning before claiming hostile same-user resistance. Not required to label a cooperative-local pilot honestly.

Do not add Temporal, a hosted service, a vector database, a skill marketplace or a new cloud adapter as a dependency of this work. Commit the implementation in normal reviewable main-branch checkpoints under the repository contract, and update entry pages only when the named functionality actually exists.

Recommended first implementation checkpoint: **repair packets + truthful structured check evidence**, followed by the exact-repeat detector. This improves the foundation before asking a meta-loop to learn from it.

## 10. Source basis

Current implementation sources, pinned to the inspected baseline:

- S1: [Historical loop contracts, skills and evolve proposals](https://github.com/marcoakes/wringer/blob/9d909f3bf93fcd545880bd1ed742ce78c1d58ff5/docs/ARCHITECTURE-NORTHSTAR.md#L151). Historical inspiration only; its old timelines, vendor claims and runtime choices are not adopted.
- S2: [Current repository architecture and authority contract](https://github.com/marcoakes/wringer/blob/9d909f3bf93fcd545880bd1ed742ce78c1d58ff5/AGENTS.md).
- S3: [Retained verifier observations and summary classification](https://github.com/marcoakes/wringer/blob/9d909f3bf93fcd545880bd1ed742ce78c1d58ff5/packages/application/src/services.ts#L92).
- S4: [Worker feedback and repair stages](https://github.com/marcoakes/wringer/blob/9d909f3bf93fcd545880bd1ed742ce78c1d58ff5/packages/workflow/src/contained.ts#L809).
- S5: [Existing unchanged-source and telemetry handling](https://github.com/marcoakes/wringer/blob/9d909f3bf93fcd545880bd1ed742ce78c1d58ff5/packages/workflow/src/worker-outcome.ts#L103).
- S6: [Current plan, budget and authority types](https://github.com/marcoakes/wringer/blob/9d909f3bf93fcd545880bd1ed742ce78c1d58ff5/packages/plan/src/types.ts#L33).
- S7: [Read-only contained snapshot pattern](https://github.com/marcoakes/wringer/blob/9d909f3bf93fcd545880bd1ed742ce78c1d58ff5/packages/runtime/src/design.ts#L8).
- S8: [Current supported scope and trust limits](https://github.com/marcoakes/wringer/blob/9d909f3bf93fcd545880bd1ed742ce78c1d58ff5/README.md).
- S9: [Design-aware engineering record and unmeasured prerequisites](https://github.com/marcoakes/wringer/blob/9d909f3bf93fcd545880bd1ed742ce78c1d58ff5/docs/DESIGN_WORKFLOW_REPORT_2026-09-09.md).

External design grounding, not proof that this plan will work:

- Anthropic distinguishes predefined workflows from agent-directed execution and describes evaluator/optimizer patterns as useful when feedback can improve a clearly evaluated task. Our application is narrower: retain the coding runtime and make the outer workflow measurable, rather than inserting another agent at every step. [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents).
- Agent evaluation needs actual outcomes, fresh isolated trials, repeated measurements and graders suited to the claim. Human judgement remains important for subjective quality, and noisy or contaminated comparisons can mislead. This supports the plan's separation of deterministic fixtures, live performance trials and independent PM/design acceptance; it does not supply Wringer's promotion thresholds. [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

The feature choices, ordering, contracts and trial design above are engineering recommendations based on this repository, not imported performance guarantees. No old paper's benchmark gains are being presented as predicted Wringer gains.

## 11. Implementation checkpoint - 9 September 2026

The source implementation now covers the core loop and the separately authorised
improvement path. The preserved baseline is still alpha.9 at the commit above;
new fixtures are not retroactively counted as baseline or live success. The
[baseline/corpus record](evidence/meta-loops-baseline-2026-09-09.md) maps original
failure cases to exact test identities and separates their denominators.
Final integrated validation and repaired failures belong to the
[implementation report](META_LOOPS_REPORT_2026-09-09.md). Commit/publication and
live release measurements must not be inferred from this source-status update.

| Delivered area | Actual source/contract files | Verification or remaining boundary |
| --- | --- | --- |
| V3 approval contract | `packages/plan/src/compile.ts`, `planning.ts`, `types.ts`; `schema/execution-plan-v3.schema.json`, `planning-request-v3.schema.json` | Loop policy, evidence level and optional playbook bind before approval; v1/v2 meanings remain unchanged |
| Truthful strict checks | `packages/workflow/src/check-evidence.ts`; `schema/assertion-report-v1.schema.json`, `check-observation-v1.schema.json`; `examples/reports-design/checks/acceptance.ts` | Executed failing requirement assertions and unchanged complete assertion identities; runner errors/skips/absence cannot become green |
| Useful repair evidence | `packages/application/src/services.ts`, `packages/workflow/src/repair-packet.ts`; `schema/repair-packet-v1.schema.json` | Exact controller observation, redaction before truncation, bounded excerpts and named omissions; no extra model call |
| Repeat stops and durable history | `packages/workflow/src/loop-analysis.ts`, `contained.ts`, `contained-query.ts`; `schema/loop-decision-v1.schema.json` | Exact unsuccessful repeats stop; repeated outcomes only warn; replay recomputes decisions and requires source-observation coverage |
| Selected worker playbook | `packages/plan/src/playbook.ts`; `schema/playbook-v1.schema.json`, `playbook-snapshot-v1.schema.json`; `examples/reports-design/wringer/playbooks/reports-component-first.json` | Exact approved-source snapshot, measured applicability and worker request receipt; guidance is advisory, not new authority |
| Reports default contract | `examples/reports-design/profile.yaml` | Explicit v3/strict evidence/stop-3 policy and pinned unevaluated starter playbook; live source/image/agent/design provisioning remains necessary |
| Private comparison, proposal and adoption | `packages/application/src/experiments.ts`, `experiment-collect.ts`, `experiment-store.ts`, `experiment-types.ts`; `packages/cli/src/experiment-cli.ts`; `schema/experiment-*.schema.json`, `playbook-proposal-*.schema.json`, `playbook-adoption-v1.schema.json` | Offline review is separate from separately granted collection/proposal. Fixtures never qualify as real performance benefit. Adoption/rollback apply only to future proposals |
| Ordinary-job development patterns | `packages/application/src/journey-patterns.ts`, `packages/application/test/journey-patterns.test.ts` | Explicit private-controller selection retains earlier failures without copying conversations, output or human notes; known research ancestors, retained purpose markers and experiment authority refuse, including moved controllers |
| Existing PM surface and assistant observations | `packages/application/src/improvements.ts`, `assistant.ts`; `packages/board/src/job-model.ts`, `job-render.ts` | Same next-action page with secondary engineering disclosure; assistant improvement inspection does not grant experiments, adoption, human review or Send |
| Portable delivery and audit | `packages/delivery/src/engineering.ts`, `contained.ts`, `projection.ts`; `schema/contained-delivery-v4.schema.json`, `contained-delivery-event-v3.schema.json`, `contained-delivery-view-v2.schema.json`, `engineering-evidence-v1.schema.json` | Carried `engineering.json`, paired red/green receipts, playbook/use and deterministic loop reconstruction; older deliveries keep their prior claims |
| Regression and validation paths | `packages/workflow/test/loop-engineering.test.ts`, `packages/plan/test/playbook-plan.test.ts`, `packages/application/test/experiments.test.ts`, `packages/delivery/test/contained.test.ts`, `packages/board/test/job-render.test.ts`; `scripts/validate.ts` stage `meta-loop-contract` | Deterministic contract/negative/replay/portable evidence coverage. Independent PM, real runtime and live benefit remain separate gates |

### Resolved design choices

- The implemented comparison uses fixed paired trials, alternating arm order,
  no sample extension, and a one-sided sign test on within-task means. It does
  not implement the earlier illustrative median/sequential-rule language.
  A four-task/two-repeat pilot may be useful engineering research but does not
  clear the 0.05 sign threshold merely by repeating the same tasks. Unknown or
  insufficient evidence stays inconclusive.
- Source-tree/intent/acceptance identity prevents renamed copies of one task
  from becoming independent evidence. Fixture/live collection mode is fixed at
  initial reservation; resume cannot relabel fixture results or refresh spend.
- Safety status requires explicit bounded observations, not just absence of a
  stop. Research human observations must resolve actual candidate-bound displays.
  A human research note is never production handover authority.
- The Reports starter deliberately selects one unevaluated advisory playbook.
  This is an explicit starter choice, not measured default adoption. Its presence
  and empty evaluation references do not establish benefit. An evaluated future
  selection requires a distinct digest-bound adoption decision and a new plan
  approval before execution.
- One optional proposal writes an inactive artifact; it does not rewrite the
  active policy, approval, engine, grader or current playbook. The outer coding
  assistant can inspect improvements but cannot silently authorise the paid
  comparison, adopt a result, supply human Yes or Send.

### Limits that must remain in the handover

Worker-only playbook injection does **not** hide tracked repository bytes from
the judge's clone. The receipt establishes controller-supplied context, not model
understanding or measured efficacy. Private held-out answers and grader internals
must be outside all proposer source clones: current separation is
operator-attested, not mechanically established by “do not read” instructions.

Portable repair excerpts are reconstructed from carried redacted outputs. The
original `observationSha256` is an opaque controller commitment because
host-specific runtime provenance is projected for portability; audit does not
reconstruct that original envelope byte for byte. A carried adoption receipt
binds a selection and private evidence revision, not a rerun of its trial corpus.

The next release evidence still needs a real contained repair comparison, an
independent frozen PM/design journey through correction/Yes/Send/fresh-clone
audit, and a real preregistered held-out playbook comparison before any benefit
claim. No live trial, real design acceptance, protected human presence, hard cash
cap, automatic policy evolution or live Sigstore success is claimed by this
implementation checkpoint. The existing section 8 gates remain open until
measured; completing source work does not waive them.
