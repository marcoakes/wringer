# Restoration execution record

Started 29 September 2026 from `69f0f304153560861a7f0ecf671eb564f7dae082`
(`1.0.0-alpha.23`). The user authorised implementing and publishing the complete
plan, with routine implementation decisions handled autonomously. Earlier
no-model-call/no-fleet constraints remain; fixture work makes no efficacy claim.

| Phase | State | Release / evidence |
| --- | --- | --- |
| 1. Loops and portable evidence | Published and verified | [alpha.24](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.24), commit `40421292da044b91a7d8b072e64066f4d56d6aa4`; [release verification](evidence/phase-1/release.json) |
| 2. Improvement workflow | Published and verified | [alpha.25](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.25), commit `599ea5f3694035822d214229f6e3bd212dabe455`; [release evidence](evidence/phase-2/release.json) |
| 3. Serial graphs | Published and verified | [alpha.26](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.26), commit `d263c7ef6aed4dc3f11f16cd78ad9b143e44bc4c`; [release evidence](evidence/phase-3/release.json); [measurements](PHASE_3_MEASUREMENTS.md) |
| 4. Parallel branches/integration | Published and verified | [alpha.28](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.28), commit `b7e9827cc94ddcb3521556ea5b2192b5d750b80c`; [release evidence](evidence/phase-4/release.json); [measurements](PHASE_4_MEASUREMENTS.md). The `v1.0.0-alpha.27` tag's release build failed on macOS 14 and was never published |
| 5. Gate/workflow improvement | Published and verified | [alpha.29](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.29), commit `f24a0ca83c09430ca5796142da4fa4283e310419`; [release evidence](evidence/phase-5/release.json); [measurements](PHASE_5_MEASUREMENTS.md). Two earlier remote runs stopped at CI hang guards; see the phase 5 section |
| 6. Tournament/prosecutor | Published and verified | [alpha.30](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.30), commit `615a9308a1c21a03c10214c00f6bd64a2ab0cda9`; [release evidence](evidence/phase-6/release.json); [measurements](PHASE_6_MEASUREMENTS.md). One earlier remote run stopped at a flaky test timeout; see the phase 6 section |
| 7. Temporal durability | alpha.33 local qualification passed; remote release pending | The operator approved the Temporal CLI and SDK downloads. A journal interface for the graph kernel, the local journal unchanged, and an optional Node adapter that runs the kernel as a Temporal workflow; fixture-tested against a local dev server only; [measurements](PHASE_7_MEASUREMENTS.md) |
| 8. Platform interfaces | Published and verified | [alpha.31](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.31), commit `2d2884d7ff568b340cb584ba22ec0329e7ef7439`; [release evidence](evidence/phase-8/release.json); [measurements](PHASE_8_MEASUREMENTS.md). Fixture conformance against a local reference peer only |
| 9. Comparative qualification | Published and verified | [alpha.32](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.32), commit `b183fdbf0e56f398fd5fd337be702e540daa9b6d`; [release evidence](evidence/phase-9/release.json); [record](PHASE_9_MEASUREMENTS.md). A checked capability ledger, a reproducible showcase and the pilot registered before any run; the pilot itself needs live model access, real tasks and independent reviewers |

## Phase 1 measurements

- The original job page already had a collapsed engineering history. Its public
  workspace CLI/MCP routes lacked direct loop inspection.
- Initial loop tests: 19 passed, 3 failed on the missing reader/tool. After the
  shared reader and surfaces: 49 passed across workflow, protocol and page tests.
- The first page test used an undeclared test import and failed to load. That is
  retained as a measurement error, not red-first behavior evidence. The corrected
  test then failed on the unsupported new page record, before implementation.
- The first export measurement exceeded the default five-second test limit.
  A bounded diagnostic run reached the missing delivery-ID assertion after
  19.54 seconds. The export test now has a 120-second whole-test limit for its
  multiple complete source/copy/negative audits; final duration is still pending.
- Local logs are retained under `build/restoration/phase-1/`. Release evidence
  will record final checks, individual revert-red-watch results, CI jobs and hashes.
- All 26 isolated revert-red-watch cases caught the intended behavior change;
  every individual restoration and the final control passed. See the
  [result record](evidence/phase-1/reversions.json),
  [control](evidence/phase-1/isolated-control.log) and
  [restored control](evidence/phase-1/restored-green.log). The mutation script
  records each exact source edit and targeted command.
- Packaged local rehearsals passed five loop histories and four export/reader
  checks with zero provider calls. These are deterministic engineering fixtures,
  not live containment or human acceptance measurements.
- An explicit failed-role probe exposed a private controller path in the stop
  display. Its red-first case failed; display-only scrubbing fixed it, and its
  own isolated reversion caught the leak again before passing after restoration.
- The first full check observed 1,188 pass, one Linux-only skip and one failure:
  an older construction fixture mutated a plan while retaining its old digests.
  Recompiling that fixture preserves the new reader's strict validation; all 12
  affected PM tests then passed. The following full native check passed 1,189
  tests, skipped the Linux-only DAC probe, and failed none. All 25 local core
  stages passed; see the [local validation record](evidence/phase-1/local-validation.json)
  for the exact coverage and late-change qualification limit.
- A subsequent real workspace probe found that a question-only request could
  display its template as a compiled job plan. CLI and MCP now require the job's
  actual plan; the six route tests passed and both individual fallback reversions
  were detected. Before execution, the actual plan remains inspectable with
  unknown measurements rather than invented zero usage.
- The first design-browser rehearsal failed its old collapsed-history assertion.
  The new contract requires history open by default, with the same available
  human decision. The main browser run then passed six stages and stopped at a
  second obsolete collapsed-history assertion in the improvement card rehearsal.
  After correcting that assertion, the remaining three browser stages passed.
  All nine distinct stages are now green locally; both failed measurements remain
  in this phase's evidence. No product guard was relaxed to pass the rehearsals.

The first candidate push `1ab172b41df1d697ad50cefd4063efaf8e419709` had two
red browser jobs for the stale collapsed-history assertion. Its other three
test jobs and Linux DAC job passed. Corrected commit
`40421292da044b91a7d8b072e64066f4d56d6aa4` passed all five test jobs
and the DAC job. All six release jobs also passed before public publication.
These historical reds are retained, not rewritten into a green first push.

Alpha.24 was published at 2026-09-29T11:44:28Z. All 14 public assets matched
the clean tagged source. Signed provenance verified for both native archives.
The public macOS download passed 17 extracted-route and 13 installer checks.
Linux execution was observed in native Linux CI. Downloads used authenticated
GitHub access; anonymous-install qualification was not measured. The
[release record](evidence/phase-1/release.json) carries exact hashes and job URLs.

## Phase 2 measurements

- Existing experiments/improvements baseline: 21 pass, 0 fail, 135 assertions.
- Ordinary jobs had no improvement CLI/MCP/page route, required manual private
  controller/root/registry setup, and typed composition bypassed future selection.
- Initial three behavior probes failed. The first sandboxed run could not bind
  loopback; its rerun with loopback access confirmed the missing page route.
- Job handles now select owned research/registry paths. The same projection
  supplies CLI, authenticated MCP and the selected job's operator card. No
  collection or adoption is exposed through MCP.
- Dedicated probes caught allocation before argument validation, a registration
  input reread race, caller-input mutation, and changed future selection breaking
  same-key proposal/revision replay. Each correction preserves the original
  prediction or retained proposal and receives an isolated reversion check.
- A test incorrectly treated the existing missing-trial list as a count; it was
  corrected to assert the actual list length. The first new schema assembly
  missed a local reference, and the first browser harness used the wrong helper
  return shape. These measurement errors are retained separately from behavior
  defects.
- Local application checks: 36 pass, 0 fail. The packaged walkthrough passed
  seven observations. The actual Chromium walkthrough passed eight observations,
  including delayed responses during job switching, an expired research grant,
  mobile layout and locking. No model calls or actual human decisions occurred.
- A source-scope probe found that an unevaluated registration could reuse an
  adopted playbook digest on a new source. Selection now follows the exact
  comparison named by the adoption receipt. Its red and green measurements are
  retained. The final **36 individual reversions** all failed as intended, and
  all 36 restorations plus the initial/final controls passed. Earlier successful
  34- and 35-case runs are retained alongside the [final record](evidence/phase-2/reversions.json).
  The final Chromium control has nine observations, including a delayed action
  reply during job switching.
- Full local validation passed all 26 core stages and 10 browser stages. The
  native suite recorded 1,197 pass, one Linux-only DAC skip, zero fail and 12,190
  assertions. A final rebuild and seven-check packaged walkthrough passed after
  the late source-scope correction. The [local validation record](evidence/phase-2/local-validation.json)
  retains that timing limit: clean-commit CI still must qualify the final source.
  Existing published schema bytes are unchanged; one sibling was added.
- First-commit CI observed a Linux Figma rehearsal failure: Chromium could not
  capture the corrected mobile image, and the product correctly blocked review.
  The other four test jobs and Linux DAC passed. The same Figma flow passed
  locally without code changes; one targeted Linux job rerun also passed.
  The underlying Chromium/runner cause was not established. No timeout,
  acceptance requirement or product guard was relaxed. Both attempts remain
  retained; GitHub's reused green jobs are not described as independent reruns.
- All six release jobs passed. Alpha.25 was published at
  `2026-09-29T17:15:56Z`. All 14 public assets match the exact clean tagged source;
  both archives' signed provenance verified. The public macOS download passed
  17 extracted-route and 13 installer checks. Linux execution ran in native CI.
  Downloads were authenticated; anonymous installation remains unmeasured.
  The optional download of successful native CI artifacts was declined; retained
  job records and local measurements were used instead. See the
  [complete release record](evidence/phase-2/release.json).
  Live benefit remains unmeasured; fixture evidence cannot qualify adoption.

## Phase 3 measurements

- Baseline: four historical graph tests passed; public `graph run` refused before
  loading a graph; the old scheduler ran host workers and routed on prose. Reusing
  an old authority or environment map for a changed source was refused, so handoff
  derives a new child plan and grant. See the [baseline](PHASE_3_MEASUREMENTS.md).
- The previous sandbox could not install dependencies (`EPERM`). On this machine
  the install linked both new workspace dependencies. The targeted suite then
  failed for behaviour: 27 pass, one compiler red, seventeen kernel stubs.
- Measurement changed the design eight times. Holds are not outcomes. Each binding
  guard lives once, in the shared transition. A failed required node stops the
  graph at once. An effect-free preflight precedes each marker. The preflight
  reads the current `PATH`, because this machine has `container` installed and the
  first live-driver test wrote a marker before failing. A failed bare-origin check
  counts as not bare. The export links loops through the controller journal head.
  A local origin in the pinned plan is disclosed rather than redacted.
- The first reversion run found three masked tests; each test was sharpened. Every
  red is classified by what removing its guard changed, and layered guards are
  listed with the guard that masks them.
- Measurement errors are retained separately: a re-chaining helper that broke a
  hold link, a wrong node count and three CLI expectations, two of which were
  product gaps.
- The packaged walkthrough drives 21 public commands and three fixture-binary
  steps, including two crash probes. Loop and check observations are synthetic;
  scripted decisions are engineering checkpoints, not human acceptance.
- All **81 individual reversions** failed as intended and every restoration and
  both controls passed. Removing a guard made a refusal vanish in 55 cases,
  changed recorded state in 21, let a different guard refuse in 3, and turned a
  named refusal into a crash in 2. See the [reversion record](evidence/phase-3/reversions.json)
  and [effects](evidence/phase-3/effects.json).
- The first full validation stopped at its build stage on a directory link; the
  second passed all 27 core and 10 browser stages. The native suite recorded
  1,276 pass, one Linux-only DAC skip, zero fail and 12,651 assertions. Existing
  published schema bytes are unchanged; five siblings were added.
- Commit `d263c7e` passed all five test jobs and the Linux DAC job on the first
  attempt, then all six release jobs. Alpha.26 was published at
  `2026-09-30T01:12:00Z`. All 14 public assets match the exact clean tagged
  source; both archives' signed provenance verified. The public macOS download
  passed 17 extracted-route and 13 installer checks. Linux execution ran in native
  CI. Downloads were authenticated; anonymous installation remains unmeasured.
  Successful native CI artifacts were not downloaded. See the
  [release record](evidence/phase-3/release.json).

## Phase 4 measurements

- Baseline (commit `6da68e9`): two independent single-loop branches took 7.2 s
  serially and 3.6 s concurrently in one process (harness overhead only), with no
  cross-branch references. Each candidate passed its own check and `git
  merge-tree` merged them cleanly, yet the merged tree failed the shared check.
  Same-line edits conflicted. See the [baseline](PHASE_4_MEASUREMENTS.md).
- The baseline commit's first CI attempt had one failure: the macOS full-suite job
  timed out a pre-existing Git test at 5,019 ms against the 5 s default (0.63 s
  locally). One targeted rerun passed with no change. Both attempts are in the
  [CI record](evidence/phase-4/ci-measurement-commit.json).
- The phase 4 design follows those measurements: fork and join in a version 2
  graph, private branch regions, one hash chain with several active nodes, a
  declared parallelism ceiling, and a join that merges deterministically and then
  verifies afresh against every branch plan, with typed outcomes.
- Measurement found three compiler faults in my own first cuts, each fixed with
  its test first: a router arriving at a join must be read through its input;
  version 2 must not reinterpret version 1 declarations; a check fed by a join is
  refused as redundant and ambiguous.
- Measurement errors are retained: malformed refusal fixtures that failed for the
  wrong reason, a determinism test comparing two different repositories, a
  privacy assertion that asserted nothing, a single-quoted test name that broke a
  file, and a fixture judge scoring the serial plan's criterion. In that last case
  the product correctly refused the verdict and reported both children as holds.
- All **31 individual reversions** failed as intended and every restoration and
  both controls passed: a refusal vanished in 11, recorded state changed in 14,
  a different guard refused in 5 and a named refusal became a crash in 1. Six
  layered guards are listed with what masks them, including the fork–join pairing
  checks that stayed green alone. See the [reversion record](evidence/phase-4/reversions.json)
  and [effects](evidence/phase-4/effects.json).
- Full local validation passed all 28 core and 10 browser stages, including both
  packaged graph walkthroughs. The native suite recorded 1,321 pass, one Linux-only
  DAC skip, zero fail and 12,852 assertions. Existing published schema bytes are
  unchanged; four siblings were added.

- The `v1.0.0-alpha.27` tag passed every tests-workflow job, then its release build
  failed on macOS 14: Apple Git 2.39 there lacks `merge-tree --merge-base`
  (Git 2.40). It was never published. The join now integrates with Git 2.38 and
  2.39 when Git's own merge base is exactly the fork's source, and refuses older
  Git before dispatch. Four isolated reversions went red and were restored. The
  tests workflow now also runs on macOS 14. The fix ships as alpha.28; see the
  [phase 4 record](PHASE_4_MEASUREMENTS.md). Full local validation of the fix
  passed all 38 stages: 1,325 pass, one Linux-only skip, zero fail and 12,870
  assertions ([record](evidence/phase-4/local-validation-alpha28.json)).

## Phase 5 measurements

- Baseline (on alpha.27's source): the playbook comparison correctly refuses any
  change to checks. On one labelled corpus a weakened gate had the highest pass
  rate (100%) and caught none of four seeded defects; a noisy gate caught three
  and failed two of three correct controls; a property gate caught all four with
  no false positive. See the [baseline](PHASE_5_MEASUREMENTS.md).
- The design follows those measurements: a sibling experiment contract with a
  frozen oracle registered by digest, gates pinned by content and overlaid on
  every item, a fixed sample judged on the held-out split, and proposal,
  evaluation, change, Send and future-only adoption as separate records.
- Measurement found one product defect in my own first cut: `wring experiment
  gate --help` answered with the general experiment help, because the generic
  help ran first. The first help test was vacuous; it matched text both helps
  contain. The route and the test were fixed.
- Measurement errors are retained: a first red run that needed stubs to fail on
  behaviour, 5 s timeouts, a fixture push to an unqualified refname, a
  case-sensitive message match and a walkthrough compiled from the wrong
  directory. A full validation run inside a Git worktree failed 15 delivery tests
  because `.git` is a file there; that is a separate, pre-existing defect.
- All **48 individual reversions** failed as intended and every restoration and
  both controls passed: a refusal vanished in 21, recorded state changed in 23
  and a different guard refused in 4. Four layered guards are listed with what
  masks them. See the [reversion record](evidence/phase-5/reversions.json) and
  [effects](evidence/phase-5/effects.json).
- Full local validation stopped once, at the CLI reference check: `docs/CLI.md`
  still named alpha.28 after the version bump. It was regenerated, and the build
  and every stage from that check on passed on the corrected commit. All 39
  stages passed across the two runs: 1,352 pass, one Linux-only skip, zero fail
  and 12,994 assertions ([record](evidence/phase-5/local-validation.json)). One
  attempt at the rerun is kept as a [harness error](evidence/phase-5/validation-rerun-harness-error.log):
  the validation clone had not moved to the corrected commit.
- The first remote run of `c1860cd` passed five of six test jobs. The `action` job,
  which runs the repository's full declared checks, was cancelled at its
  15-minute hang guard: it had measured 12.7, 13.8 and 14.1 minutes for
  alpha.26 to alpha.28, and phase 5's tests pushed it over. No tag was created.
  The guard is now 30 minutes, and alpha.29 is released from that commit. The
  [cancelled run](evidence/phase-5/ci-attempt1-action-timeout/ci-tests.json) and
  its [job log](evidence/phase-5/ci-attempt1-action-timeout/action-job.log) are kept.
- The second remote run, of `ea15142`, passed five of six jobs. On the
  macOS-latest runner the native suite passed validation's own 1,200-second hang
  guard (it took 1,135 s locally) and was stopped; macOS 14 passed. That guard is
  now 2,400 seconds. The [run](evidence/phase-5/ci-attempt2-native-timeout/ci-tests.json)
  and its [job log](evidence/phase-5/ci-attempt2-native-timeout/macos-latest-job.log) are kept.

## Phase 6 measurements

- Baseline (on the phase 5 source): over four constructed tasks and all 24
  candidate orders, the first attempt that passed its own check shipped a defect
  in 16; a majority vote shipped the shared defect in 6; a unique-survivor rule
  never shipped a defect but never selected. A tree-id tie rule selected a correct
  survivor in every order of the two tasks that had one. See the
  [baseline](PHASE_6_MEASUREMENTS.md).
- The design follows those measurements: a version 3 `tournament` closing a fork,
  one prosecutor session, challenges that count only after passing on trusted
  controls, replay on every attempt's exact tree, selection among survivors with
  `no-winner` or a declared tree-id rule, and a final evaluator recorded after
  the selection.
- The compiler, kernel and driver were written before their tests; the reversions
  are their red evidence. First adapter runs failed on fixture errors, kept in
  the evidence folder. A child that stops with a recovery available is a hold, as
  for any loop; only a terminal stop arrives disqualified.
- The first full reversion run caught **38 of 40**. Two probes stayed green: the
  tree-order selection's probe ran only a test whose survivors were already in
  tree order, and the reader's recomputation was masked by the evidence-digest
  check in a single-file forgery. A test of a dishonest adapter that restamps
  every digest now reaches the recomputation. With that test and the branch-order
  test in their patterns, both went red ([first run](evidence/phase-6/reversions.json),
  [follow-up](evidence/phase-6/followup/reversions.json)). Effects across both:
  a refusal vanished in 18, recorded state changed in 21 and a different guard
  refused in 1. Six layered guards are listed with what masks them.
- Full local validation's first run stopped when the native suite passed its own
  1,200-second hang guard, with no failure recorded; the tournament tests had
  pushed it over. With the guard at 2,400 seconds, the build and every stage from
  the native suite on passed. All 40 stages passed across the two runs: 1,392
  pass, one Linux-only skip, zero fail and 13,131 assertions
  ([record](evidence/phase-6/local-validation.json)). Both packaged tournament
  and earlier graph walkthroughs passed.
- The first remote run of `df63003` passed five of six test jobs. On the
  macOS-latest runner a pre-existing Git test,
  `rehearsal-clone-audit.test.ts`, timed out at Bun's 5-second default; the same
  file had timed out at 5,019 ms in phase 4. No tag was created. Its tests now
  allow 30 seconds each, and alpha.30 is released from that commit. The
  [run](evidence/phase-6/ci-attempt1-clone-audit-timeout/ci-tests.json) and its
  [job log](evidence/phase-6/ci-attempt1-clone-audit-timeout/macos-latest-job.log) are kept.

## Phase 7 measurements

- Measured on the phase 6 source with a recording driver: the graph kernel's
  decisions are a pure function of its recorded events. Every dispatch and Send
  reached the driver only after its durable marker. Identical recorded inputs
  and clock replayed to byte-identical event chains; with a live clock only the
  times, deadlines and the digests that bind them differed. See the
  [baseline](PHASE_7_MEASUREMENTS.md).
- The durability boundary is the event store, the lock and the clock; a
  contained loop fits a second runtime only as one bounded activity per node.
- No Temporal CLI, server or SDK is installed here, and the official TypeScript
  SDK does not support Bun workers. The prototype the plan requires before any
  design commitment needs the Temporal CLI and SDK downloaded. Downloads need the
  operator's explicit approval, so nothing was downloaded, no Temporal behaviour
  is claimed, and phase 7 has no release. Phase 8 shipped before it.
- Later on 30 September the operator approved the two named downloads: Temporal
  CLI 1.9.1 (43 MB, its digest matched the published checksums) and the Temporal
  TypeScript SDK 1.24.0. The prototype measured a lost worker during an effect
  with one attempt (a timeout, observed once, never repeated) and three (the effect
  ran twice). It found that the sandbox refused the unchanged kernel, which pulled
  in 11 Node modules. It also found that replay consulted the reading host's
  environment for credentials, so a valid history could become unreadable on
  another machine. Red-first tests reproduced that before the fix. See the
  [prototype record](evidence/phase-7/prototype.json).
- The design follows it: the decisions moved unchanged into a module with no
  host imports behind a `GraphJournal`; the local file journal keeps the same
  public functions and record bytes; replay checks credential shapes only while
  the writing host's credentials are still refused on write; `wringer-drive graph
  init` admits a graph with no effect and `graph effect` runs one marker-bound
  effect for an external controller; an optional Node adapter runs the kernel as
  a Temporal workflow and mirrors every event into the state directory.
- The same captured observations gave byte-identical event files on both journals
  with the same clock, for six scenarios covering graph versions 1 to 4. The
  failure-mode, versioning and unit suites and the compiled walkthrough passed
  against a local dev server. See the [measurements](PHASE_7_MEASUREMENTS.md).
- The first reversion run caught 24 of 26 probes, and every control and
  restoration passed. Two probes were not red. Removing the plan's own admission
  check changed nothing, because the grant's validator re-checks the plan against
  the same credentials; that probe was dropped. A dispatch on a reserved node
  without its marker had no test, so the test was added. The second run hung in
  teardown after a reverted guard's test failed; it was a harness error, it was
  stopped and [kept](evidence/phase-7/reversions-attempt2-interrupted/run.log), and
  Node test runs are now bounded. The third run caught 24 of 25
  ([record](evidence/phase-7/reversions/reversions.json)). Its miss was a
  classification error: the reverted divergence guard made the workflow livelock,
  and Node reports the resulting timeout as cancelled, which the harness did not
  count. It now does, and the
  [follow-up](evidence/phase-7/reversions-followup/reversions.json) was red and
  restored green. All 25 probes of the final set were caught; the first run is
  [kept](evidence/phase-7/reversions-attempt1/reversions.json).
- Full local validation passed all 42 stages: 1,433 pass, one Linux-only skip, zero
  fail and 13,341 assertions. The adapter suite passed 26 of 26 and the compiled
  Temporal walkthrough passed ([record](evidence/phase-7/local-validation.json)).

## Phase 8 measurements

- Baseline (on the phase 7 source), read from the source: the ACP client offers
  no file or terminal capability; none of the 18 MCP tools approves, records a
  verdict, sends, merges or adopts; no A2A client existed and the compiler
  refused an external task node. See the [baseline](PHASE_8_MEASUREMENTS.md).
- The design follows it: a version 4 `delegate` node pinning an A2A 1.0 peer by
  endpoint and Agent Card digest, one task sent once and reconciled by reading,
  one cancellation at the deadline, a returned patch applied within the
  verification plan's scope and verified by a following check, and a
  [service interfaces](../native/INTERFACES.md) page listing every boundary.
- The compiler, kernel and driver were written before their tests; the reversions
  are their red evidence. The adapter's first run passed seven of eight tests; the
  eighth failed because the Node reader did not yet read version 4 exports.
- All **27 individual reversions** failed as intended and every restoration and
  both controls passed: a refusal vanished in 14 and recorded state changed in
  13. The first attempt stopped at its isolated control because a
  reconciliation test assumed one resume would find the task finished; the test
  now resumes until it ends. See the [reversion record](evidence/phase-8/reversions.json).
- Full local validation passed all 41 stages in one run, including the packaged
  delegation walkthrough in which the public binary is the A2A client: 1,417
  pass, one Linux-only skip, zero fail and 13,248 assertions
  ([record](evidence/phase-8/local-validation.json)).
- A local reference peer establishes fixture conformance only. No real A2A agent
  has completed a task.

## Phase 9 measurements

- An inventory of the restoration's evidence: every phase from 1 to 8 except 7
  has a release, isolated reversions and a packaged public walkthrough; none
  involves a live model, real containment, a real external peer or an
  independent person. See the [record](PHASE_9_MEASUREMENTS.md).
- The [capability ledger](../CAPABILITY_LEDGER.md) judges each capability at four
  levels. Nine are implemented and eight fixture-tested; none is claimed
  live-qualified or comparatively beneficial. Its checker, a validation stage,
  refuses a missing citation, a live claim without a live run record, a benefit
  claim without a registered comparison result, a changed pilot registration and
  an incomplete or path-bearing showcase record.
- The [showcase](../showcase/SHOWCASE.md) ran four compiled journeys, 81 stages,
  all passed. Building it first failed twice, both documentation closure errors:
  the showcase page links its own not-yet-written record, and a ledger citation
  pulled in an older page whose link target no longer exists. The record is
  written by the run, and the citation now names current pages.
- The 20-task pilot is [registered](../qualification/PILOT_REGISTRATION.md) with a
  digest a test enforces. It has not run.
- All **7 individual reversions** of the checker's rules went red and were
  restored ([record](evidence/phase-9/reversions.json)).
- Full local validation passed all 42 stages in one run, including the new
  capability-ledger stage: 1,422 pass, one Linux-only skip, zero fail and
  13,284 assertions ([record](evidence/phase-9/local-validation.json)).
- alpha.32's six test jobs, the Linux DAC job and all six release jobs passed on
  the first attempt. The publication process stopped with its operator session
  while the release build ran; it was resumed from the recorded dispatch, found
  the one release run already green and did not dispatch again. All 14 public
  assets matched the clean source, both archives' signed provenance verified, and
  public macOS extraction/installation passed 17/13 checks
  ([release evidence](evidence/phase-9/release.json)).

Historical failures remain evidence. No phase is marked published until its
actual release and all required jobs and artifact checks have been observed.
