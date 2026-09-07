# PM test preparation: Bun alpha.3

Date: 7 September 2026. This report separates implemented behavior, deterministic
verification, real machine observations and the next observer's blind verdict.
It does not replace or rewrite the earlier alpha.2 report.

## What this checkpoint changes

The CLI and live PM board now use one application boundary. Both read the same
validated journey and candidate; browser actions carry durable request identity
and expected source/revision. Refresh is not authority, retries preserve their
reservations, and a dead controller needs explicit uncertainty reconciliation.
Publication remains a separate decision after preparing the handover.

The workspace is decision-first, with readable criteria and before/after checks,
original intent, changed files, human notes and known usage. Technical identities
remain inspectable. There is no composite score, invented billing, automatic
human verdict or claim that a Git push opened a hosted review request.

Contained delivery v2 carries a shared view for board, certificate, summary and
MR; v1 compatibility remains tested. Audit binds carried records to the exact
source and evidence. Falsification materializes real committed mutations for
read-only contained verification and reports unavailable measurements honestly.
Hosted review reconciliation binds repository, branches and exact evidence head,
and distinguishes open, closed and merged observations.

Before coding, the new environment discovery measures declared setup, tools and
baselines in a credential-free verifier. Missing tools and failed preparation
cannot become red acceptance evidence. A declared ACP planner can propose an
unapproved acceptance contract from a PRD without changing the operator's fixed
scope/runtime/budget. Existing declared Keychain keys are reused, not replaced.

Worker writes are enforced against explicit source scope and protected acceptance
parents; agent descendants are stopped before controller-owned Git capture.
Verification uses locked source. Runtime admission/readback, secret filtering,
source identities and recovery have adversarial regression tests. These changes
do not by themselves prove the behavior of a real platform or provider.

## Browser observations

The actual localhost workspace was exercised with explicitly synthetic
worker/judge/check/display records and a disposable local Git origin:

- Authenticated loading displayed the real fixture journey and known usage.
- Continuing an already reviewed hold reached readiness without another agent
  session; session count remained two.
- Preparation did not publish. A separate checked confirmation and send pushed
  the evidence branch to the local fixture origin. The board reported "Branch
  delivered", not an open hosted request or merge.
- Desktop layout was inspected at 1280px; the 390px layout had a 390px document
  width, with no horizontal page overflow. Action controls preceded evidence on
  the narrow layout. This is not a full accessibility certification.
- The inspection exposed two wording/presentation defects: an already recorded
  human review still asked for another verdict, and publication confirmation
  presented raw JSON first. Both are addressed with regression tests; technical
  records remain available below the primary explanation.

This was implementation QA, **not the next PM blind test**. The fixture's note
is labelled as a fixture observation, not Marc accepting real product work.
No live coding/judging provider calls or hosted MR were used in that exercise.

## Verification and machine gate

The full ten-stage local validation passed after disk cleanup, with its receipt
at `.wringer/native-validation-2026-09-07T18-14-06-504Z/result.json`:
workspace links, native checks, portable Python historical corpus compatibility,
standalone build/contract, compiled contained contract, local delivery fixture,
compiled version, board and drive. The native suite recorded **357 passed,
1 skipped, 0 failed; 358 tests across 36 files, 2,753 assertions**. The skipped
case is the host Linux DAC check on macOS; the separate real Linux guest smoke
below measures its own scoped-write denials. The corpus
stage checks retained compatibility fixtures; it does not reinstall the retired
Python runtime or benchmark cache.

The preceding full run at `2026-09-07T16-40-43-004Z` recorded two ENOSPC failures
while creating test directories. Its 355 passes, one skip and two failures remain
in the local evidence. No test was weakened to address that machine failure.
Obsolete Python environments, generated benchmark cache and two downloadable
Podman base-image caches were deleted; source, reports, receipts, credentials
and the old mutable guest disk were retained. After cleanup the Data volume
measured 10.01 GiB free; after unpacking the current image and validation it
still measured about 7.4 GiB free. These are measured checkpoints, not a promise
of fixed future storage requirements.

Observed on this existing developer account: macOS 26.5.2, Apple Silicon; Apple's
signed container 1.3.1 installer was checksum-verified and its Apple signature
and notarization verified. The installed binary reports 1.3.1 and the API
service is now running. Installation alone is not a passing containment
measurement.

The pinned ACP runtime image has been built locally, not published. Its first
build omitted a promised lockfile and was retired. The corrected image's index
digest is `sha256:c52d11fbdaabf4011c36a99c410e9aa5520215645a439ccc1e73a55d3cbbe474`.
Actual local inspection and a successfully started temporary container confirmed
Bun 1.4.2, Node 24.20.0, all four pinned agent dependencies, and the retained
lockfile. The local inventory is `.wringer/runtime-image-alpha3-r2.inventory.json`.
No provider variables were forwarded or model prompts sent for this inspection.

The first real smoke stopped inconclusively on Apple's nested status response;
its failure and successful cleanup remain at
`.wringer/runtime-smoke-alpha3-20260907-01/report.json`. The adapter now validates
the observed image descriptor and nested running state before credentials can
cross. The new smoke on the corrected image **passed**, with its actual report at
`.wringer/runtime-smoke-alpha3-20260907-02/report.json`, measured from
18:19:53.421 to 18:20:19.204 UTC on 7 September. It exercised scoped-write denials,
host/peer checks, a network positive-control comparison, resource admission,
no-model ACP, cancellation and cleanup. The source fixture commit was
`fc2ed263f8ae7fcf05d1890f2f9a67bd18217391`. Zero model prompts were sent and no
provider credentials crossed. Its limitations explicitly exclude universal
escape resistance, resource-stress coverage, real provider authentication and
model convergence. Neither this smoke nor local validation is the next PM
blind-test verdict.

Final review reproduced an expiry defect with the real ACP client and an
in-memory agent: delayed startup could send one prompt after authority expired.
The fix caps discovery, verification and role deadlines by expiry and rechecks
authority immediately before prompting, including after a slow progress
observer. Three focused regressions now pass and interrupted reservations stay
charged. The final full validation after this fix is recorded separately below.

The final run at `.wringer/native-validation-2026-09-07T18-45-29-316Z/result.json`
passed all ten stages after the expiry fix. Its native suite recorded **360
passed, 1 platform-specific skip, 0 failed; 361 tests across 36 files and 2,787
assertions**. The final [source-and-measurement checkpoint](evidence/pm-alpha3-final-20260907.json)
retains all three selected validation runs and the separately measured runtime
smoke/image inventory. The earlier summary remains immutable historical evidence.

### Existing-key adapter preflight

An operator-only session probe against the already published `3981e9a` source
opened three real contained ACP sessions: Claude planner, Codex worker and
Claude judge. Both declared keys were loaded from the existing Keychain items;
none were printed, replaced or re-entered. Adapter identities were Claude ACP
0.65.0 and Codex ACP 1.10.0. No model prompt was sent. This setup probe is not the
new PM task, an execution approval, provider-key validation or model convergence.

The exact worker line was:

> worker ACP preflight: session opened. Declared noninteractive authentication method returned successfully. Declared role credential/environment names: CODEX_API_KEY. Provider-key validity and effective credential are not attested by ACP session creation. No model prompt sent; usage is not inferred.

Claude planner and judge each reported an opened session with
`ANTHROPIC_API_KEY`, no successful explicit authentication method observed, and
the same provider-validity limitation. Claude's selected adapter uses the key
without an `api-key` ACP method. Host login directories were not copied. No model
override was chosen; effective adapter defaults were not established by this
protocol-only check. The private handover retains its complete sanitized doctor
result; the portable summary intentionally omits raw session events and paths.
The [portable adapter preflight](evidence/adapter-preflight-alpha3-20260907.json)
records those exact authentication lines and explicit limitations.

The [portable checkpoint summary](evidence/pm-alpha3-20260907.json) records source
hashes, the failed disk-full validation and subsequent pass, the successful
runtime smoke, and the observed image inventory. It references separately
retained raw artifacts by path and hash; it does not claim those raw artifacts
are bundled in the summary, nor that earlier measurements used the newly
collected source snapshot. Remote CI and a live-provider journey are not
inferred from this local checkpoint.

## Limits the next test must retain

- This is a **fresh run on a pre-provisioned existing account**, not a clean
  machine. Keys and the user's account/login state were not replaced for it.
- A runtime version, passing manifest fixture or ACP session is not a live
  containment or provider-validity result. gVisor has not been exercised on a
  real cluster in this implementation session.
- The display currently presents the declared command's text output, not an
  embedded application preview. A visual requirement that cannot be inspected
  through that display is a blocker, not permission to approve unseen software.
- Planning proposes against a declared bounded template. It is not unrestricted
  check authoring or proof that every part of a PRD was captured.
- Live model spend, a task/destination and the observer's genuine acceptance must
  be explicitly in scope for the next run. No new paid capacity, external hosted
  review request, merge, deployment or public release is implied by this build.

Use [the predeclared PM blind-test protocol](PM_BLIND_TEST.md). Do not begin its
blind phase until the real local runtime prerequisites are measured. The first
undocumented repair ends that verdict; any continuation is separately labelled
salvage. A useful completed change—not a clean refusal or the Bun rewrite
itself—is the product outcome being tested.
