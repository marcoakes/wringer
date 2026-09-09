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

The focused Figma contract run passed all 57 tests, including the real-browser
connection/recovery/preview/retention/attachment test and real Git transport.
[Focused validation](../.wringer/native-validation-2026-09-09T19-59-47-363Z/result.json).

The separate v2 visual/handover rehearsal passed: one scripted correction,
source-bound review, separate Send, local test-origin publication and fresh-clone
audit. Its [result and limitations](../.wringer/assistant-launch-rehearsal-6153baaa-9264-47ca-bcee-adb351d3f308/guided-result.json)
identify the injected Figma responses, scripted worker/judge/human decisions and
unmeasured live containment. Browser interaction took 132,489 ms; no provider
calls or credential reads were made by this fixture. TypeScript also passes.

Final whole-product validation and publication remain pending in this first
implementation checkpoint; their result will be recorded before final handoff.

Initial full-suite observation: 838 passed, one platform skip and one failure.
The failed assertion expected 12 MCP tools instead of the newly declared 15.
It was corrected, and all 32 MCP protocol tests then passed. The original
[failed validation record](../.wringer/native-validation-2026-09-09T19-42-03-584Z/result.json)
is retained locally. This was engineering iteration, not a blind test.

Two focused iterations also exposed test-selector/message assumptions: the
new test initially waited for the older page's connection element and later
selected both forms' name fields. Selectors now target the actual design form;
the new reconnect assertion matches the explicit safe stop message. Their
[first](../.wringer/native-validation-2026-09-09T19-57-44-016Z/result.json) and
[second](../.wringer/native-validation-2026-09-09T19-59-03-482Z/result.json) failed
measurements remain retained. No failure was reclassified as a live success.

A final independent code review found three issues before publication: a
provider transport failure during refresh could discard an otherwise valid
connection, and optional research trials could label a v2 design snapshot as a
v1 research display; the PM also needed to see the exact prepared frame links
before authorising retrieval. The fixes preserve credentials on temporary refresh
failure, introduce a versioned research display without changing the old contract,
and show canonical source links before Preview. All receive regression tests.
The superseded
[whole-product run](../.wringer/native-validation-2026-09-09T20-04-37-247Z/result.json)
was deliberately interrupted at its test stage to restart against these fixes;
its SIGTERM is not a product-test verdict.

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
