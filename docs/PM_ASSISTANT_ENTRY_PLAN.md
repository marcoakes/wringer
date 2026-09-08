# Keep your AI coding app. Put the work through Wringer.

## End-to-end product, engineering and marketing implementation plan

**Status: PROPOSED — DO NOT IMPLEMENT.**

Date: 2026-09-08. Product owner: Marc Oakes.

This document records the next proposed direction. Implementation is held until
the pending PM blind-run feedback has been received, reviewed and incorporated,
and Marc explicitly authorizes the revised work. It is not permission to start
coding, install a connector, change account settings, spend on model calls or
publish the proposed marketing claims.

The frozen blind-test product remains `1.0.0-alpha.3` at commit
`2f08ca6b4927a70e96d6c36af82ad1b02b2dafb8`. Repository inspection for this plan
used `e32274e53a0fc96de0a703666b1a476f32d9a264`, whose subsequent changes restore
the README banner and attribution, not product behavior. Do not change the
frozen executable, task, starting pages, controller state or verdict to fit this
proposal. This document is an engineering plan, not an observer's start sheet.

Publishing this plan is not launching the feature. All deliverables below are
pending unless explicitly identified as existing foundations.

## 1. The product decision

A PM should use the AI coding app they already know as Wringer's conversational
front door. They explain the outcome; their assistant handles the mechanics;
Wringer owns the approved execution and evidence; the PM makes the consequential
decisions.

**Your coding app handles the conversation. Wringer controls the work. You
decide whether the result is ready to hand over.**

The first experience must not require a PM to write YAML, manage terminal tabs,
translate recovery commands, repeatedly enter the same keys or interpret agent
logs. The board remains important: it is the source-bound review and decision
surface, not a second dashboard the PM must continually supervise.

Codex, Claude Code and Kimi are candidate front ends, not a statement that all
three integrations work today. A front-end coding app and a contained worker
can be different products. Their credentials, sessions and bills are separate.

### Success from the PM's point of view

- One obvious entry point in the app they already use.
- One understandable proposal, with assumptions and limits visible before work.
- One bounded approval for routine execution; no per-engineering-action loop.
- Clear progress without keeping a chat continuously active.
- A real result to inspect, a simple correction request and preserved feedback.
- An explicit human judgement where the requirement needs one.
- A separate handover decision naming exactly where the change will be sent.
- A portable evidence record someone else can inspect from a fresh clone.

These are acceptance targets, not statements of measured performance.

## 2. First gate: incorporate the blind-run feedback

Before implementation begins:

1. Finish and retain the pending run under the existing
   [blind-test protocol](PM_BLIND_TEST.md). Keep any salvage separate.
2. Attach the actual report and Marc's feedback to this plan. Classify each
   finding as onboarding, comprehension, execution, recovery, evidence,
   authority, spending or display.
3. Distinguish problems this entry point removes from underlying failures it
   would merely conceal. A conversational wrapper must not hide a broken
   delivery, unusable display or uncheckable audit.
4. Amend the scope and acceptance tests below in response to those findings.
   Repair blocking core-workflow defects before building convenience over them.
5. Obtain Marc's explicit go-ahead on the revised plan. Record the decision and
   its date here. No date-based or automatic commencement is authorized.

Feedback report: **pending**. Revised scope: **pending**. Authorization to
implement: **not granted**.

## 3. What exists, and what is new

| Area | Existing foundation | Work required for this experience |
| --- | --- | --- |
| Control plane | Bun CLI; strict YAML/constrained TypeScript plans; shared application services | A stable assistant-facing contract and a single guided entry route |
| Commands | JSON CLI responses; guarded workspace commands; duplicate-request protection; revision and candidate checks | Narrow MCP tools using those same services, not a second orchestration engine |
| Execution | Separate contained ACP roles, verification and recorded authority | A durable local execution owner independent of the chat connection |
| Recovery | Retained journal, reservations, explicit uncertain-effect recovery | Reconnectable jobs and measured process/service-restart behavior |
| PM decisions | Source-bound display/review and separate prepare/publish actions | Front-end permissions that cannot impersonate the PM or obtain the full board authority |
| Limits | Total sessions, per-role turns, session timeout, whole-journey time and approval expiry | Clear two-lane usage reporting; separately gated monetary enforcement |
| Delivery | Shared board/certificate/summary/MR facts and fresh-clone audit | Compact assistant summaries and safe links to those same facts |
| Distribution | Source-build and operator-led setup documentation | One tested connection/setup route per supported front end |

Relevant implementation seams:

- [Application exports](../packages/application/src/index.ts),
  [controller services](../packages/application/src/controller.ts) and
  [guarded commands](../packages/application/src/commands.ts).
- [CLI output](../packages/cli/src/app.ts),
  [contained command routing](../packages/cli/src/contained-cli.ts) and
  [current workspace HTTP boundary](../packages/cli/src/workspace.ts).
- [Plan/authority validation](../packages/plan/src/compile.ts),
  [current budget fields](../packages/plan/src/types.ts) and
  [contained workflow](../packages/workflow/src/contained.ts).
- [Current headless contract](native/HEADLESS.md) and
  [current PM guide](../README-PM.md).

There is no app-facing MCP server today. An existing CLI route does not prove
native client integration, and a durable journal does not by itself keep a
foreground process running when its parent app exits.

## 4. The complete intended PM journey

| Moment | Assistant and Wringer behavior | What the PM sees or decides |
| --- | --- | --- |
| Connect once | Identify a supported client; verify installation/runtime; connect a restricted capability | What is being installed or connected and what it can access |
| Describe the job | Capture the original request and selected repository; draft an inert proposal | Their request in their own words; essential questions only |
| Establish context | Measure the selected source, tools, existing checks and constraints through approved bounded inspection | What is known, what is missing and material assumptions |
| Propose the work | Validate requirements, scope, checks, roles, limits and destination choices | A plain-language plan, not raw YAML |
| Approve execution | Record a trusted approval bound to the exact plan and ceilings | One deliberate decision to start the bounded work |
| Work | Run contained roles and checks; persist progress and reservations | Meaningful changes and the next useful action, not a stream of internal logs |
| Stop or reconnect | Reattach to the same job; preserve unknown effects and remaining limits | A truthful reason and supported recovery, without starting over |
| Review or correct | Show the exact candidate and evidence; record a correction request | What changed, what remains unproved and how to request a revision |
| Human judgement | Require a successful display of that candidate and the person's own observation | A real result to judge; never a prefilled invented verdict |
| Prepare handover | Produce a preview of the exact change, evidence and destination | The work and destination they are being asked to approve |
| Publish | Require separately confirmed publication authority; record uncertain outcomes | Sent, not sent or uncertain; branch, hosted request and merge remain distinct |
| Audit | Offer the delivery's exact fresh-clone audit route and optional bounded breakage test | A handover record with resolvable evidence and visible limitations |

The PM may stop or refuse at any decision. Missing tools, invalid credentials,
unproved requirements and exhausted limits remain real outcomes. A friendly
assistant must not narrate them into success.

The current board displays declared command text, not a live application
preview. Use the blind-run feedback to determine which result displays the PM
actually needs. If text cannot support a requirement, add a source-bound,
isolated preview or artifact route before claiming that requirement is
reviewable. Untrusted application content must not inherit the controller's
credentials or approval access. An assistant's description of an unseen result
is not a substitute for the person's inspection.

## 5. Architecture: an integration, not another rewrite

Retain the existing chain:

- TypeScript DSL and YAML configure a canonical plan.
- Bun runs the control plane and its deterministic policy/record operations.
- MCP lets the PM's coding app request permitted Wringer operations.
- ACP connects Wringer to the isolated agent runtimes doing the work.
- Apple Container locally, or the separately validated gVisor Kubernetes path,
  contains workers and judges with repositories cloned inside.
- CLI, assistant tools and board use the same application services and facts.

Do not implement model/tool reasoning loops in the controller, route coding
through MCP sampling as an alternative production worker, or use the outer
assistant as its own independent judge. The outer assistant may prepare an
unapproved proposal; it must not directly author the approved candidate outside
the contained workflow.

### Proposed code ownership

- `packages/mcp` — a proposed thin protocol adapter: schemas, connection handling,
  tool/result mapping and redaction. No independent policy decisions.
- `packages/application` — job registry, execution-owner interface, operation
  lifecycle and capability-checked access to existing services.
- `packages/workflow` and `packages/plan` — authoritative approval, reservation,
  stop and recovery behavior. Extend here only where evidence demands it.
- `packages/cli` — installation/connection diagnostics and local runner lifecycle;
  preserve a usable CLI over the same services.
- `packages/board` — trusted approval/review presentation and compact PM wording.
- `packages/records` / `schema` — additive, versioned job, capability, approval
  and optional spend records. Never reinterpret a frozen schema in place.

Package and tool names here are proposed interfaces, not commands to run now.

## 6. The assistant-facing contract

Use service-issued workspace, proposal, job, operation and evidence handles.
Do not accept arbitrary controller directories, shell commands, executable
snippets, secret values or destinations supplied through evidence text.

| Proposed operation | Permitted behavior | Must not imply |
| --- | --- | --- |
| `wringer.inspect_setup` | Read declared tool/runtime availability and supported client capabilities | Installing tools, reading key values or spending on a model |
| `wringer.propose` | Submit an inert intent/plan proposal and return validation/assumptions | Approval or an implicit paid planner invocation |
| `wringer.get_approval_request` | Return the exact pending plan/limits for trusted PM confirmation | A transferable full-control board token or assistant-issued approval |
| `wringer.start` | Enqueue the exact already-approved job once | New authority, a changed plan or a reset budget |
| `wringer.get_status` | Return compact recorded state, limits, uncertainty and permitted next actions | A model call or polling-triggered continuation |
| `wringer.get_evidence` | Return bounded, redacted source-bound evidence | Instructions to the assistant, filesystem escape or complete log dumps |
| `wringer.request_revision` | Record requested changes; continue only within unchanged authorized scope | Silently changing requirements, checks, policy or the destination |
| `wringer.continue` | Apply one explicitly eligible recovery/continuation under existing authority | Replaying an uncertain paid effect without the required acknowledgement |
| `wringer.cancel` | Stop future dispatch and request bounded active cancellation | Reversing charges or guaranteeing an in-flight remote request never ran |
| `wringer.prepare_handover` | Produce a preview for an authorized, source-bound destination | Publishing, merging or deploying |

Do not expose `grant_authority`, `increase_budget`, `record_human_verdict`,
`publish`, arbitrary execution or credential retrieval as ordinary assistant
tools. The human confirmation channel performs those permitted decisions under
separate authority. Requesting a decision is distinct from making it.

Requests carry a unique idempotency key and expected revision/candidate where
applicable. Responses include protocol/schema version, job/operation identity,
state revision, candidate identity, factual outcome, uncertainty, remaining
limits and eligible next actions. Distinguish a malformed request from an honest
not-ready outcome. Do not make clients infer success from prose or process exit
alone.

## 7. Authority and containment must be real

The current local operator can create authority JSON and owns the controller's
files. A coding app with that same unrestricted OS access can also do so. Hash
chains, a private file mode, a prompt saying "do not edit" or a signing key
accessible to that app do not establish protection from it.

### Required first-platform security decision

Start with a local macOS design. Before advertising enforced assistant
delegation, select and demonstrate either a separately protected controller
service/OS identity or an equivalently enforced restriction on the front app.
The preferred design is a protected local controller with narrowly scoped
assistant access; the exact installation/permission mechanism is an early
security spike, not a solved prerequisite.

The measured boundary must prevent the front app from:

- Writing controller state, grants, receipts, signing material or spend records.
- Reading worker/provider keys or publication credentials.
- Accessing runtime-control sockets or service administration to escape its role.
- Creating a new job or grant to bypass an exhausted parent job budget.
- Calling the human approval/publication channel with its assistant capability.
- Forging a human observation through a name field, browser automation or an
  accessible approval token.

Human decisions bind the exact plan, source, scope, limits, expiry and, for
publication, the actual destination and candidate. Any material change requires
a fresh explicit decision. A revision may consume existing execution authority
without inheriting a stale human acceptance.

Do not hand the current unrestricted workspace bearer to the outer assistant.
Use least-privilege, revocable capabilities bound to the allowed workspace/job
and actions. Keep trusted confirmation out of assistant-readable URLs and
transcripts. A checkbox in a browser is not automatically proof of human
presence; establish the confirmation mechanism and its automation threat model
before claiming the assistant cannot approve for the PM.

The actual owner/administrator remains outside the tamper-resistance claim.
One-time OS permissions may still be necessary. Do not bypass client or macOS
security controls to promise "never asks permission". If the required boundary
cannot be established, refuse the protected mode. A cooperative CLI experiment
may be labelled as such in a laboratory; it is not a silent production fallback.

## 8. Reliable background work and recovery

The local runner, not the chat connection or MCP process, owns accepted work.
Persist the request and reservation before acknowledging acceptance. The assistant
receives a handle promptly and may disconnect. Closing the chat should not
cancel or duplicate an already accepted job.

On reconnect, discover the existing authorized job, read its current revision
and continue only eligible actions. Do not ask an LLM to reconstruct state from
its memory of the conversation.

Required behavior:

- Concurrent clients and repeated clicks attach to one operation.
- A lost response after dispatch remains uncertain until reconciled; it is not
  permission to submit another paid request or publish twice.
- Runner/process restart revalidates authority, state, pending effects and
  reservations before dispatch. Never replay ambiguous side effects blindly.
- Machine sleep, reboot, elapsed time and approval expiry have explicit behavior.
  Time ceilings do not reset during downtime.
- Cancellation is recorded; new work stops; active work and descendants receive
  bounded cancellation; orphan outcomes remain visible.
- A CLI, board and assistant reopening the same job agree on its state.

Use event-driven updates or bounded status waits. Return compact changes and
decision links, not a continuous LLM loop reading unchanged status. Notifications
must be authenticated and free of secrets; their transport cannot grant authority.

## 9. Spending: two lanes, one honest view

### Lane A — the PM's coding app

This is the conversation and coordination lane. Its subscription, quota or
usage-based bill belongs to the app/provider; Wringer cannot promise to control
that account's total usage.

Minimize avoidable work by accepting a validated proposal from the existing
conversation, not automatically buying a second drafting conversation. Missing
semantics still require clarification. If a contained planner is needed, request
its explicit budget before calling it. Use compact results and on-demand evidence
instead of copying full repositories and logs into chat. No LLM is needed to
read status, count recorded reservations or run an offline audit.

Report outer-app usage only when the client supplies a trustworthy observation.
Otherwise display "Coding-app usage: not available to Wringer". An existing
subscription is not proof that contained agents use it, or that either lane is
free.

### Lane B — Wringer-managed planning, development and review

Preserve current mechanical session/role/time/expiry limits first. Label them as
execution limits, not a cash guarantee. An ACP session can contain many model
calls. Report known tokens, unknown usage and unresolved reservations separately.

Create a parent job budget spanning planning, worker/judge activity, revisions,
retries and any other paid subordinate work. Separate stage grants must not
silently become fresh aggregate spending allowances. Approval to inspect status,
verify existing evidence or reconnect must never buy another model call.

### Separately gated strict-money mode

A genuine monetary ceiling is not implemented today. Add it only for a measured
agent/provider route that can enforce all of the following:

1. Pin the billing currency, model identity, supported billable operations,
   pricing revision and a defensible worst-case charge per dispatch. GBP display
   is only an estimate unless conversion risk is explicitly bounded.
2. Reserve that maximum atomically before every underlying paid request, including
   concurrent requests, retries and internal agent calls. Counting ACP sessions
   is insufficient.
3. Prevent alternate provider credentials or direct network routes from bypassing
   the charging boundary. Keep the agent runtime's reasoning loop in the runtime;
   a metering boundary must not become another harness-written agent loop.
4. Reconcile authoritative usage with reservations. Keep in-flight or uncertain
   charges reserved; cancellation does not refund work already accepted remotely.
5. Refuse another dispatch when remaining funds cannot cover its maximum. Changing
   models, prices or supported billable tool behavior must invalidate assumptions.
6. If the route cannot establish an upper bound, refuse a strict-cash request
   before spending. Offer clearly labelled session/time limits only through a
   fresh user choice; never downgrade silently.

Do not sum unknown costs into a pretend known total. Do not claim cash savings,
an exact provider invoice or a universal budget cap from estimated token prices.

## 10. Setup, distribution and compatibility

Ship one blessed local path first: official entry page, verified source build or
one explicitly released artifact, prerequisite diagnosis, supported runtime,
credential reuse and client connection. Select the artifact strategy after the
blind-run installation findings; do not publish several unproved alternatives.

The coding app can guide setup, but must not treat repository text as permission
to execute arbitrary installers, elevate privileges or export private files.
Display the publisher, artifact identity and permission purpose. Preserve
existing keys and logins; do not imply that connecting an app automatically
shares its subscription with contained workers.

Connection setup must be idempotent: detect an existing entry, inspect it, and
change only the named Wringer entry after consent. Never overwrite the client's
whole configuration or change its global approval posture. Include diagnosis,
upgrade, disconnection and uninstall paths that preserve retained run evidence.

Candidate compatibility matrix, initially all **unmeasured**:

| Front end | Evidence needed before naming it supported |
| --- | --- |
| Codex | Exact app/CLI version, connection method, tool permissions, setup, disconnect/reconnect and complete observed PM journey |
| Claude Code | The same measurements, independently; worker ACP compatibility is not front-end compatibility |
| Kimi | Identify the exact client/version first; verify its supported connection and long-running behavior rather than assuming parity |

Prove the first supported client end to end, then run the same conformance and
PM-task checks for the next. Keep front-end version, MCP adapter version, ACP
backend version and effective model/authentication observations separate.

## 11. Front-and-centre marketing and product language

This is the intended primary proposition, not a small integration note at the
bottom of a technical README. Publish it only when the relevant release gates
below pass. Until then, this section is draft copy.

### Proposed primary copy

**Headline:** Keep your AI coding app. Put the work through Wringer.

**Subhead:** Describe what you want in the coding app you already use. Wringer
coordinates the approved work, runs checks in isolated environments and brings
you back to the decisions that need you—with evidence attached to the change.

**Primary call to action:** Start from your coding app.

**Secondary call to action:** See a complete PM run.

**GitHub About description:** Run bounded software jobs from your AI coding app,
with isolated agent work, human review and evidence that travels with the change.

**Short explanation:** Your assistant helps you ask for the work. Wringer records
what was approved, coordinates the build and independent review, and makes clear
what is—and is not—ready to hand over.

**Draft starter request:** "Use Wringer for this request and repository. Check
what is ready, show me the proposed work and limits, and ask me to approve before
starting. Keep me informed when a decision is needed. Bring me back to review
the result before anything is published."

Do not present that request as executable onboarding until the printed route
has been tested from the declared starting state.

### Surfaces to update together after the release gates

| Surface | Required change |
| --- | --- |
| README opening | Preserve Marc's original banner and attribution. Put the PM proposition and one coding-app CTA before architecture/build details. Link measured compatibility and limitations beside the CTA. |
| GitHub About | Replace the historical standalone-only description with the verified new proposition. Do not keep misleading "no LLM" wording as the whole-product description. |
| GitHub topics | Review for the current product; candidate topics include `bun`, `typescript`, `yaml`, `mcp`, `ai-agents`, `software-verification` and `product-management`. Do not use client topics as unearned compatibility badges. |
| PM guide | Begin with the one delegation request, setup expectations, real approval moments and example result. Put technical configuration in drill-down. |
| Install/setup/quickstart/headless docs | Make their entry points agree. Separate front-app connection, contained-worker authentication and actual model spending. Print tested recovery routes. |
| Board | Lead with "What should I do now?" and the exact pending decision. Link safely back to the same job; show known/unknown usage in both lanes. |
| CLI/MCP descriptions | Use plain-language operations and explicit side effects. A tool description cannot supply authority or claim functionality its handler lacks. |
| Demo and release notes | Show the actual entry route, limits, refusal, correction, human review, handover and fresh-clone audit. State the measured client/version and remaining gaps. |
| Website/social/package descriptions | Reuse the same proposition wherever those surfaces actually exist; do not create a new website or package release solely to complete this checklist. |

Keep technical field names stable where required by record compatibility. In PM
copy prefer requirement, check, not ready to hand over, approval is out of date,
try to break the change, and handover record. Avoid calling a certificate proof
of software correctness.

### Claims require evidence

| Proposed claim | Gate before publication |
| --- | --- |
| "Use it through [named app]" | A complete observed journey with that exact client/version and documented starting state |
| "Approve routine work once" | A normal run plus correction/reconnect that does not request repeated engineering approval; genuine scope/human/publication decisions remain visible |
| "Works after you close the chat" | A live disconnect and independent-runner test, plus recorded restart/uncertain-effect behavior |
| "Controls development spending" | Name the actual enforced units; session/time control must not be presented as a cash ceiling |
| "Never exceeds your cash budget" | All strict-money tests pass for the advertised backend and billable operations; otherwise do not use this claim |
| "Less supervision" or "lower cost" | Comparable runs measuring human attention, interventions and both usage lanes; unknown cost prevents an exact savings claim |
| "Evidence travels with the change" | Delivery projections agree and the real bundle audits from a fresh clone |
| "Cannot approve for you" | Proven authority and confirmation boundary, including the front app's shell/filesystem/browser capabilities |

Do not promise universal client support, guaranteed completion, zero-cost
coordination, invisible permission bypass, automatic human judgement or SOTA
from a demo. The short competitive explanation is: a coding agent writes code;
Wringer controls the approved workflow and records the evidence for handover.

## 12. Implementation work packages and stop gates

No package below has started. Implement approved changes on the existing main
line in reviewable checkpoints; preserve the frozen test commit and all earlier
evidence. No force-push, Python fallback or second product tree.

| Package | Deliverables | Exit evidence |
| --- | --- | --- |
| P0 — Feedback and scope | Actual blind-run findings; revised acceptance; Marc's go-ahead | Linked report, scope decision and authorization date |
| P1 — Contract and security spike | Tool/response schemas; job identity; protected-controller and trusted-confirmation design; pinned dependency choices | Threat model and demonstrated separation; unresolved separation blocks enforcement claims |
| P2 — Durable runner | Persist-before-ack queue, ownership, status, cancellation, restart and reconciliation over existing services | Real process-kill, disconnect and duplicate-request tests without paid models |
| P3 — Narrow MCP adapter | Validated tools, handles, scoped capabilities, compact facts and version negotiation | Protocol tests plus denial of every forbidden action and path |
| P4 — Intake and PM decisions | Original intent, assumptions, inert proposal import, source-bound approval/display/correction/handover | A person can operate the full fixture without raw configuration or invented decisions |
| P5 — Spending and credentials | Shared job ceilings, two-lane reporting, secret isolation; optional strict-money route kept separately gated | Concurrent/resumed limit tests; unknown remains unknown; unsupported cash cap refuses |
| P6 — One outsider install | Single published starting route and first measured client integration; upgrade/disconnect guidance | Independent setup transcript from the declared machine state; every stop has a tested route |
| P7 — Live evaluation | Contained worker/judge journey, genuine PM review, correction, delivery, fresh-clone audit and interruption drill | Public-safe evidence dossier with exact versions, costs/unknowns, failures and intervention counts |
| P8 — Marketing release | Coordinated README/About/topics/guides/demo updates; preserved banner and credits | Claim-to-evidence review, exact pushed commit and passing remote checks; explicit launch approval |

Session/time-bounded operation may ship without strict-money mode only if its
copy and interface make that distinction unmissable. A user asking for a strict
cash cap must receive a refusal, not a misleading equivalent setting.

## 13. Verification and acceptance suite

### Deterministic and adversarial coverage

- Tool payload validation, unknown versions, oversized input, duplicate keys,
  secret redaction and untrusted result text.
- Wrong/revoked capability, another job's handle, filesystem traversal, symlink
  escape, arbitrary-command injection and a forged human or publication request.
- Attempts to mint new authority, increase limits, change source/checks/destination
  or reuse stale candidate approval.
- Duplicate/concurrent submissions, a response lost after dispatch, client
  reconnect, runner kill before/after reservation, and restart during publication.
- Expiry before dispatch and during work; cancellation; machine downtime; orphan
  ownership; uncertain spend that survives every restart.
- Exhausted aggregate planning/build/judge/revision limits across both interfaces;
  unsupported cash-budget requests; strict-money races and unmetered bypasses if
  that mode is implemented.
- Successful and failed display; inaccessible preview; changed candidate;
  genuine negative judgement; refused publication and repeated confirmation.
- Exact agreement between assistant facts, board, journal and delivered artifacts;
  malicious receipt text never becomes a tool instruction or source of authority.
- Read-only status and audit cause zero model dispatches and do not mutate budgets.

Use fixture agents and isolated repositories first. Real keys, external
publication and live model calls require separately approved test authority.
Run the normal repository validation and observe remote CI for every published
implementation checkpoint. Keep failures; do not regenerate them into passes.

### Live PM evaluation

Use the same task and comparable starting conditions as the baseline where
possible, but give the new entry route its own frozen candidate and protocol.
Do not retrofit it into the pending blind run. Record observer independence and
all prior familiarity. An agent that built the product is not a stranger.

Measure task completion, page/command detours, undocumented interventions,
hesitation, active PM attention, wall time, routine versus consequential approval
requests, known tokens/cost per lane and unknown billing. Report setup separately
from steady-state use. One favorable run is not proof of a general savings rate.

Required journey: original request, context/assumptions, approved scope/limits,
red-first evidence, contained build, a truthful stop, requested correction,
green evidence, real human judgement, separate handover confirmation, delivered
bundle and literal fresh-clone audit. Test chat closure and resume without
additional authority or duplicate model work. If the model cannot complete within
limits, report that outcome rather than manufacturing a successful demo.

The short demonstration should be under five minutes for viewers. If the actual
run takes longer, label the edit/time compression and link the complete sanitized
transcript. Do not claim a five-minute execution without measuring it.

## 14. Release, rollback and explicit non-goals

Release only after the first supported front end completes the measured journey,
its permission boundary is demonstrated, meaningful failures recover truthfully,
and the proposed public claims have evidence. Add other clients one at a time.
Keep gVisor claims gated on its own real-cluster evidence; a macOS result cannot
stand in for them.

Before launch, obtain approval for external metadata edits and any actual public
release. Publish measured limitations alongside the main CTA. Disable or revoke
the connector if its boundary fails; stop new dispatch, retain reservations and
evidence, and preserve read-only inspection. Never roll back by deleting the
journal, widening privileges or silently reverting to host execution.

Out of scope: another harness rewrite, a home-grown agent runtime, multi-tenant
SaaS, enterprise RBAC, a marketplace project, broad integrations, a graph explorer,
model leaderboards, replacing the PM's coding app, moving all inference into the
outer subscription, or merging/deploying without separate authority. Live
signing is a separate delivery-assurance workstream; it is not solved by MCP.

## 15. Completion checklist

- [ ] Pending blind-run report and Marc's feedback incorporated.
- [ ] Revised implementation explicitly authorized.
- [ ] One front-end contract and one guided installation path selected.
- [ ] Protected authority and genuine human confirmation boundary demonstrated.
- [ ] Existing Bun/application/ACP/runtime architecture reused without a bypass.
- [ ] Durable jobs, disconnect, cancellation and uncertain recovery measured.
- [ ] Session/time controls and two-lane unknown/known usage represented honestly.
- [ ] Strict-money mode either proven for a named route or explicitly unavailable.
- [ ] First client/version passes a complete independent PM journey.
- [ ] Delivery and every public projection agree; fresh-clone audit resolves.
- [ ] Original artwork, creator credit and truthful historical attribution retained.
- [ ] Front-door marketing updated together, with supported claims and limitations.
- [ ] Exact implementation commit pushed; local validation and remote CI observed.
- [ ] Public release separately approved; later client support remains unclaimed.

## References

These explain protocol roles, not Wringer implementation or client compatibility:

- [MCP tools: structured operations exposed to model applications](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
- [ACP introduction: communication with coding agents](https://agentclientprotocol.com/get-started/introduction).
- [Wringer's binding architecture](REWRITE_PLAN.md),
  [threat model](../THREAT_MODEL.md) and [security policy](../SECURITY.md).

Recheck applicable protocol versions, SDKs and each client's actual configuration
instructions at implementation time. Do not assume a future client supports a
feature merely because the protocol specifies it.
