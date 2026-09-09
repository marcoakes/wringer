# Figma connection repair — alpha.10 engineering report

Date: 2026-09-09. This is an implementation and engineering verification report,
not an independent PM blind-test verdict or a live Figma access claim.

## Delivered behavior

Wringer now has its own Figma REST connection lane. The coding app can prepare
one or two frame links and read safe progress. The private PM page owns sign-in,
private preview, explicit repository-retention permission and attachment for a
new proposal. Actual visual acceptance and sending remain separate decisions.

The sign-in service implements registered-app OAuth, PKCE, expiring state,
single-use proof-bound token handoff, refresh and local disconnect. Its app
secret stays server-side. The macOS implementation writes credentials through
Keychain stdin, never command arguments; portable operator storage is private
but not encrypted. No existing builder/judge keys are changed by this repair.

The reader selects nodes, requests PNGs at the reported Figma version, rejects
unsafe/partial responses, and records actual byte hashes in a new
`design-snapshot.v2`. All previously frozen schema files stay unchanged. V1
owned-reference and MCP records continue to work.

Attachment adds exactly one content-addressed data file in a new private Git
commit using bare Git plumbing. The target checkout and original remote remain
unchanged; attachment does not push. An immutable per-import profile selects
that new source for future proposals only. Checks, protected paths, scope,
runtime, agents, limits and declared visual capture contracts are preserved.
Changed reference/source identity requires new execution approval.

Worker and judge receive separate read-only snapshot MCP services, not access
to Figma. The existing contained verification, real-output human hold, correction
and portable handover machinery remains the authority boundary.

## Verification status

The clean implementation commit `cdab913e7ed8233df48328a6d0b77caca07086ee`
passed all 25 local validation stages. The main suite recorded **857 passes,
one Linux-only skip on macOS, zero failures and 9,686 assertions** across 94
files. Strict TypeScript and all 115 generated schema contracts pass. The
focused Figma contract recorded **63 passes and 612 assertions**, including
the real-browser connection/recovery/preview/retention/attachment test, real Git
transport and research-record compatibility.

The [portable evidence index](evidence/figma-api-repair-2026-09-09.json) carries
the source manifest, stage results, parsed test counts and hashes of seven retained
validation runs, including failures and the deliberate interruption. The final
run is `.wringer/native-validation-2026-09-09T20-15-58-558Z`; its sequential
stage durations total 1,176,848 ms (19 minutes 37 seconds). This is validation
time, not total development time or model billing. Raw local artifacts are not
copied into this public summary. For remote measurements, inspect the exact
published commit in [GitHub checks](https://github.com/marcoakes/wringer/actions/workflows/tests.yml);
local results do not establish a CI outcome.

The separate v2 visual/handover rehearsal passed: one scripted correction,
source-bound review, separate Send, local test-origin publication and fresh-clone
audit. Its [portable result and limitations](evidence/figma-api-rehearsal-2026-09-09.json)
identify the injected Figma responses and scripted worker/judge/human decisions.
Browser interaction took 130,635 ms; no provider calls or credential reads were
made by this fixture. The extra breakage test honestly remained inconclusive
because live containment was unavailable. The earlier successful rehearsal is
also retained; its success is not substituted for the final clean-commit run.

Initial full-suite observation: 838 passed, one platform skip and one failure.
The failed assertion expected 12 MCP tools instead of the newly declared 15.
It was corrected, and all 32 MCP protocol tests then passed. The original
failed validation record is retained locally at
`.wringer/native-validation-2026-09-09T19-42-03-584Z/result.json` and indexed
above. This was engineering iteration, not a blind test.

Two focused iterations also exposed test-selector/message assumptions: the
new test initially waited for the older page's connection element and later
selected both forms' name fields. Selectors now target the actual design form;
the new reconnect assertion matches the explicit safe stop message. Their
first (`.wringer/native-validation-2026-09-09T19-57-44-016Z`) and second
(`.wringer/native-validation-2026-09-09T19-59-03-482Z`) failed measurements remain
retained and indexed above. No failure was reclassified as a live success.

A final cross-check by separate coding agents found three issues before publication: a
provider transport failure during refresh could discard an otherwise valid
connection, and optional research trials could label a v2 design snapshot as a
v1 research display; the PM also needed to see the exact prepared frame links
before authorising retrieval. The fixes preserve credentials on temporary refresh
failure, introduce a versioned research display without changing the old contract,
and show canonical source links before Preview. All receive regression tests.
The superseded
whole-product run (`.wringer/native-validation-2026-09-09T20-04-37-247Z`)
was deliberately interrupted at its test stage to restart against these fixes;
its SIGTERM is not a product-test verdict.

The [first published CI run](https://github.com/marcoakes/wringer/actions/runs/34402174210)
then passed Linux validation and the repository Action, but failed the macOS main
suite: 855 passes, two skips and one failure. The
[observed failure](evidence/figma-api-initial-ci-2026-09-09.json) is retained.
An active-correction cancellation could save both cancellation markers, then
return `refused` because a new status audit saw the journal advance. A
deterministic regression reproduced that exact post-effect `state-advanced`
refusal. The repair returns the durable cancellation acknowledgement without
inventing a current revision or claiming remote execution/charges have stopped.
Stale admission still refuses before either marker is written. The formerly
failing case passed ten consecutive focused runs after repair, and the
correction/cancellation tests now run in the early assistant validation stage.
This is a real PM cancellation repair, not a CI timeout increase or test skip.
The [repair evidence index](evidence/figma-cancellation-repair-2026-09-09.json)
retains the macOS failure and the corrected build, assistant, Figma and packaged
distribution checks. All four corrected local stages passed. Remote CI remains
an independently observed measurement at the published commit, not inferred
from those local checks.

The new source-attachment tests use real Git and a fresh bundle clone, with
explicitly injected API responses. They check single-artifact attachment,
unchanged source checkout and remote identity, preserved limits/protection,
repeated/concurrent attachment, stale/no consent, tampered bundle refusal and
new-proposal approval. The connection tests use fake provider responses and
fake Keychain commands, not the operator's credentials.

## What remains genuinely unmeasured

- A registered real Figma app, eligible account and deployed HTTPS broker.
  No domain, app registration, deployment or public release was performed.
- Real browser OAuth, macOS Keychain round trip, live frame access, current
  render-host compatibility and actual Figma PNG exports. These must not be
  inferred from injected transports or protocol tests.
- An independent PM/designer using the coding app from the frozen entry point
  through a live contained build, correction, review and sent handover.
- Production multi-instance brokerage, high-availability token storage or a
  protected same-user human-confirmation boundary. This is cooperative-local.
- Cash guarantees: session/time ceilings remain separate from actual provider
  billing. These deterministic engineering fixtures make no model API calls;
  coding-app usage and any external account spend are not measured here.

An operator must provision a design-ready contained renderer and matching
capture dimensions. Missing prerequisites refuse; the assistant cannot invent
a trustworthy renderer or widen approval. Retention permission is recorded
operator attribution, not verified legal ownership. Offline audit proves carried
identities and records, not a fresh Figma read or design correctness.

## Next live measurement

Use [Connect Figma](native/FIGMA_CONNECT.md) and the
[new Figma API blind-test protocol](FIGMA_API_BLIND_TEST.md), after the external
prerequisites exist. Freeze the actual commit/version at that point. Do not
reuse the old official-MCP verdict: REST support does not establish eligibility
for Figma's official remote MCP server.
