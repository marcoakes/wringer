# PM and design workflow — implementation and exit plan

Date: 2026-09-09. Baseline: alpha.8, `00607a8`.
Status: implementation and scripted design/handover rehearsal complete;
publication checks and independent live gates remain distinct. See the
[engineering record](DESIGN_WORKFLOW_REPORT_2026-09-09.md), not a live Figma or blind-test pass.

## Outcome

A PM supplies a request, repository and design reference. Wringer retains the
approved design, the worker uses the existing components, and the person sees
reference versus actual desktop/mobile output on the same private job page.
Correction, renewed review of changed source, separate Send, and a fresh-clone
audit complete the journey. Routine reads and execution stay inside the initial
bounded authority. Product choices, external design writes and human judgement
are not silently delegated.

## Architectural decisions

1. Bun remains the control plane; ACP agents write code. MCP is the agent's
   tool/data interface, not another harness or a substitute for containment.
2. Capture design inputs through a bounded read-only connector, then pin the
   snapshot in the selected source before execution approval. Retain exact
   retrieved bytes, source identifiers, capture time and response hashes. A
   missing remote version is explicitly capture-only, never an invented revision.
3. Worker and judge receive the same approved snapshot through a read-only MCP
   server inside their separate sandboxes. Do not copy host Figma sessions or
   give the worker unrestricted Figma credentials. Do not repeatedly fetch a
   changing external design during an approved build.
4. Support Figma's remote MCP read workflow and explicit compatible read recipes,
   plus owned reference snapshots for repositories without Figma. Merely speaking
   MCP does not establish Figma client eligibility or authentication. Fail these
   checks honestly; do not impersonate another client or auto-create accounts.
5. A v2 execution plan binds snapshot path/hash and required visual reviews.
   Preserve all published v1 schema bytes. The design input is protected from
   the worker, and replacement invalidates approval. Private snapshots are not
   silently copied into source or a published handover.
6. Capture actual PNGs inside the source-bound verifier after declared showing
   succeeds. Export only declared regular output files, bounded by size and
   dimensions. No privileged host execution of repository preview code. An
   image filename or generated mockup is not an observed running application.
7. Add visual display receipts without reinterpreting historical text receipts.
   Show reference versus observed images with dimensions and provenance. Missing,
   failed, stale or undecodable images cannot enable acceptance. Never serve
   agent-authored HTML under the controller's authenticated origin.
8. Human design acceptance remains explicit and exact-source-bound. Automated
   responsive, accessibility and component/token checks are evidence, not an
   automatic claim of design quality. The current cooperative-local identity
   limitation remains visible; distinct people are not cryptographically proved.
9. Carry the approved design and visual evidence through delivery and independently
   verify their hashes, source binding and decisions in a fresh clone. Respect
   explicit repository-storage/publication permission for design assets.

## Work packages

- Design snapshot contracts, PNG validation, immutable imports, read-only MCP
  connector, credential/SSRF/redirect/byte/time/call guards and negative tests.
- Versioned plan binding, source protection, contained read-only design MCP,
  runtime capability errors, CLI setup/import/inspect route and documentation.
- Contained visual capture, new display receipt, human-review and delivery/audit
  validation, including missing/stale/forged evidence refusals.
- Guided reference/result review, image-load gating, safe authenticated asset
  serving, correction and existing separate Send. Keep non-design runs compatible.
- Reproducible Reports example, scripted browser rehearsal, and a separate
  independent PM+designer blind-test protocol.

## Blind-test subject

A small Reports application built on an existing component library. The request
is to turn a repository's report data into a responsive reports workspace, with
filtering, an empty state and a report detail view. Desktop and mobile references
must be supplied by the test owner (Figma in the live connector condition).
An intentionally unsatisfactory first visual result must be corrected without
starting over or inventing a human approval. The reference, behaviour checks and
final result should be understandable without reading code.

Two conditions are explicitly separate:

- Engineering rehearsal: owned reference design, scripted roles/decisions and
  isolated test transport. Real browser rendering, Git delivery and audit are
  measured; live Figma, model convergence and human usability are not inferred.
- Independent blind run: a real eligible Figma connection, measured contained
  runtime, a fresh bounded run and a person who did not build the implementation.
  No changes to the product while running; first undocumented repair ends the
  blind verdict. Subsequent salvage is labelled separately.

## Exit gates

1. Plan, connector and media validation reject changed references, excess scope,
   private disclosure without permission, malformed/oversized images, missing
   credentials, unsupported transports and external write requests.
2. Worker and judge can query the exact same snapshot via the session MCP route;
   no host login directory or design credential crosses into either agent.
3. Reference and actual desktop/mobile images render on the job page. A failed
   asset load cannot record a Yes. Changed source requires new capture/review.
4. Correction retains original words and uses the remaining authority. No
   uncertain spend or publication is silently replayed.
5. Delivery and fresh-clone audit agree on design hash, actual capture hashes,
   candidate, decisions and omissions. Tampered/missing visual evidence refuses.
6. Existing non-design validation remains green. The new browser rehearsal runs
   in CI on Mac and Linux, preserving sanitized successes and failures.
7. Commit/push main and observe its checks. Publish precise engineering evidence
   and the blind-test entry point. Live Figma/PM results remain unmeasured until
   those separate conditions are actually run.

## Explicit limits

This work does not authorize Figma canvas writes, library publication, new paid
subscriptions, provider spend, credential replacement or a public release.
Account consent may require its owner once; routine calls within the approved
read scope should not. Interactive preview, if exposed, needs its own isolated
origin and lifecycle; static measured screenshots must never be labelled as an
interactive prototype. A live Figma test needs an authorized file, eligible
client/token and actual access — fixtures cannot remove those dependencies.
