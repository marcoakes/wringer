# Design-aware PM workflow — engineering record

Date: 2026-09-09. Candidate: `1.0.0-alpha.9`, developed on main from `00607a8`.
Verdict: **the scripted design-to-handover engineering journey passed. A live
Figma integration and an independent PM/designer blind pass are not claimed.**

## Implemented

- Fixed, bounded Figma/generic read-only MCP recipes and owned PNG/context imports.
  Explicit credential variable only; no login, Keychain replacement, implicit
  design writes, redirects or private-network endpoint access.
- Private designs stay outside Git. Repository storage needs a deliberate
  disclosure decision. Immutable snapshots retain source/capture/version basis,
  component rules, response hashes and validated PNG bytes.
- Additive execution/planning v2 contracts bind that design to the approval.
  Exact source/hash/reference checks occur before agent work. The snapshot is
  protected; replacing it cannot inherit an old approval or human Yes.
- Separate contained agents receive a controller-owned read-only snapshot MCP
  service. Its environment is cleared. The source reference and component rules
  are available through three read tools, not a live mutable design account.
- The contained verifier exports only approved PNG paths after successful
  showing, process shutdown and source checks. Invalid, missing or stale image
  evidence refuses. Display v2 is additive; historical text displays keep v1.
- The guided PM page compares reference and desktop/mobile output. Images must
  load, hash-check and decode before Yes. Full-size viewing is keyboard accessible;
  closing, locking or changing source clears the viewer. Technical display notes
  are collapsed for visual reviews.
- Correction keeps the person's words, changes the candidate and needs fresh
  captures/review. Human acceptance and Send remain separate. The delivery and
  offline audit carry/check the snapshot, images, candidate and decisions.
- [Design entry page](native/DESIGN.md),
  [Reports target](../examples/reports-design/README.md),
  [optional browser image recipe](../runtime/Containerfile.design), and
  [independent blind protocol](DESIGN_BLIND_TEST.md) are provided. Marketing and
  assistant/PM entry pages now point at the design workflow.

## Measurements before publication

| Measurement | Observed result |
| --- | --- |
| Earlier whole-package sweep during integration | 697 passed, 1 macOS platform skip, 0 failed; 8,126 assertions; 432.68 seconds |
| Finished focused design contract suite | 49 passed, 0 failed; 368 assertions; 26.25 seconds |
| Final snapshot MCP/large-image protocol suite | 6 passed, 0 failed; 79 assertions |
| Final guided board unit tests | 21 passed; 244 assertions |
| Frozen workspace lock + standalone build | Passed |
| Final compiled CLI + contained-delivery contracts | Passed; 10.07 and 39.17 seconds |
| Existing text-only guided PM browser regression | Passed; 105.17 seconds |
| Whole-repo TypeScript + generated schemas | Passed; 80 schema files, old frozen bytes preserved |
| Design browser journey | 34 checks passed; 141.24 seconds overall, 132.58 seconds browser journey |
| Fresh-clone carried audit | Exit 0 |
| Separate breakage test without a real runtime | Inconclusive, not a pass |

The package sweep preceded the last viewer/fixture refinements; the subsequent
focused checks do not turn it into a later full-suite measurement. The standard
CI runs the whole validation envelope, including the new design contract and
design browser journey, on macOS and Linux. Read the checks attached to the
published commit for its remote result; this report does not infer one from
local evidence.

The live browser journey used real Chromium to render an owned Reports reference
and candidate HTML captured from Git. The script approved, requested correction,
accepted, and separately sent to a new local bare origin. It exercised held image
requests, one failed image, full-size keyboard viewing, stale/fresh capture
identity, mobile overflow, optional-note truth, separate Send and fresh-clone
audit. Those browser actions were **scripted**, never a person's judgement.

Fixture identity:

- Job: `12a7aa61-e12a-9cf4-1218-171777b4275d`
- Delivery: `contained-24bfc910c5ce50fc196c2748`
- Candidate: `c28ae67cc53ae42ed0c295894e74c92de70c528a`
- Evidence commit: `f00e85771497e7bf0ad1f81d9decfb21d8ee504c`
- Design: `e38fca19ae392758150e861378462089d25907d3630d27480b648c2696901091`
- Four synthetic role sessions; three required images for each candidate; two
  human requirements recorded only as scripted fixture decisions.
- Provider calls: 0. Credential reads: 0. Actual coding-app spend is not measured;
  production usage fields without provider evidence remain unknown.

[Public scripted-rehearsal result](evidence/design-guided-pm-2026-09-09.json)
retains the implementation hashes, 34 assertions and explicit measurement limits.
It is a result record, not a replacement for the full delivered fixture bundle.

Additional local evidence, not a dependency of a fresh clone:

- [Successful journey](../.wringer/assistant-launch-rehearsal-e37cdafb-db1c-419e-8298-586b9a8da17f/result.json)
- [Transcript](../.wringer/assistant-launch-rehearsal-e37cdafb-db1c-419e-8298-586b9a8da17f/transcript.json)
- [Desktop review](../.wringer/assistant-launch-rehearsal-e37cdafb-db1c-419e-8298-586b9a8da17f/browser-guided-review-desktop.png)
- [Focused validation](../.wringer/native-validation-2026-09-09T08-46-49-259Z/result.json)

Reproduce from the source checkout after installing the pinned engineering test
browser with the documented build prerequisites:

```sh
bun run build
bun scripts/validate.ts design-contract design-pm-rehearsal
```

CI preserves sanitized transcript/result files and screenshots for successes
and failures. It does not upload cookies, control links or private controller
records. Rehearsal scripts and audit binary hashes are in the result record; the
local run honestly identifies its implementation as a modified worktree.

## Failures and repairs retained

The first integrated sweep stopped on a runtime design-field type mismatch and
an invalid test projection property. The wiring and test were corrected; the
failed validation record remains. The first design browser journey stopped on
an assertion that expected a digest inside closed source details to appear in
visible text. Its screenshot showed decoded images and enabled decisions: this
was a test assertion failure, not a claimed product refusal. The assertion now
opens the details. That screenshot also prompted full-size viewing and removal
of duplicated visual sets from the fixture.

Adversarial review additionally found and repaired private-output placement,
duplicate-key inputs, bounded-read races, missing reference IDs before planner
work, Figma's explicit inline screenshot flag, credential echoes, the ACP
large-image ceiling, visual receipt read limits, and portable role receipts
omitting their design capability. Each has executable coverage. Final entry-page
review also exposed missing human-readable reference IDs and an unusable relative
profile-output example; inspect now lists the IDs and the guide names the required
private operator folder. No earlier
blind-test failure was edited into a success.

## Still required for the independent blind test

The feature is prepared for an operator-provisioned blind test, not a new claim
that this machine already has its live prerequisites. Choose the source lane
before the test and freeze a commit after remote checks:

1. **Live Figma lane:** an authorized file/node, repository-storage permission,
   and actual eligible MCP access. A token alone does not prove eligibility.
2. **Owned-reference lane:** the designer's permitted PNGs/context. This can test
   the design workflow but cannot count as a Figma access measurement.
3. A provisioned digest-pinned **browser-capable contained image** and existing
   worker/judge credentials. The new image recipe has not been built or measured
   live here. The host engineering browser is not a substitute.
4. A PM/designer who did not build the feature, using the frozen entry point.

Real agent convergence, containment, Figma access, design quality, full
accessibility and authenticated human presence remain unmeasured by this
rehearsal. The preview's cooperative-local trust limitation, unknown billing
and lack of a hosted interactive preview remain explicit. No public package
release, account change or paid execution was performed by this implementation.
