# Next PM blind test: protocol and start gate

This is a test protocol, not a passing verdict. Freeze the implementation and
record its exact Git commit and executable version before the observer starts.
Do not make documentation or implementation edits during the blind phase.

This page is the **operator's preparation sheet**. Start the observer at
[README-PM.md](../README-PM.md), not at internal records or a remembered path.
Preparation may be completed on an existing account. Do not erase saved keys,
agent logins or the operator's repositories to imitate a clean machine.

## What this run measures

A nontechnical PM should be able to understand the request and proposed plan,
delegate bounded work once, follow progress, inspect the actual result, request
a correction, supply a genuine human judgement and approve delivery. Every
surface must tell the same source-bound story.

Use a new controller state and untouched target baseline. Reuse existing keys.
An existing developer account with newly provisioned tools is **not a clean
machine**. Name this condition "pre-provisioned machine, fresh run"; do not
relabel it as the earlier clean-machine experiment. Record whether the observer
is a person or a PM agent, and whether they helped implement this version.

## Before admitting the observer

The implementation operator, not the blind observer, prepares and records:

1. Exact source commit, `wring --version`, Bun build version and passing local
   validation. Confirm the pushed commit and its actual remote CI separately.
2. Actual runtime version and digest-pinned image, including the pinned ACP
   adapters. Run the real-platform smoke in `runtime/README.md`. A fixture is
   not enough; an inconclusive or failed safety measurement blocks a live run.
3. The target repository URL and committed baseline, task PRD, immutable
   acceptance files, runtime/network policy and finite session/time ceilings.
   Test against a dedicated disposable target, never an unrelated checkout.
4. Existing credential availability without printing values, then the product's
   `wringer-drive doctor --plan PLAN.yaml --probe-agents` session-only probe.
   Retain its exact authentication wording. An opened ACP session is **not**
   proof of provider key validity or effective credential selection.
5. Explicit authority for the live model spend and named delivery destination.
   Preparing this release candidate does not itself grant new paid capacity,
   a hosted account, publication, merge or deployment.
6. A display that actually permits the proposed human judgement. The current
   board shows command text, not an embedded browser preview. If the criterion
   needs an application preview that this cannot supply, stop before spending
   and record the gap; do not substitute an unseen-result approval.

Do not use the compile-only example's placeholder image, commit, tools or deny
network as a live configuration. Runtime provisioning is measured separately
from the PM experience. If the test specifically includes self-service setup,
include that work in the blind phase and count an undocumented intervention.

### Prepare one explicit handover folder

Choose a new folder outside the target checkout and place the following there.
The paths below are names within that folder, not machine-specific locations:

| Item | Required content |
| --- | --- |
| `PRD.md` | The original request, unedited by the builder. |
| `TEMPLATE.yaml` or `PLAN.yaml` | Operator-selected repository, full baseline commit, runtime image digest, scope, commands, roles and finite budgets. Use the proposal route below only when a planner is declared. |
| `START.md` | The exact starting directory, executable path/version, actor, expiry, command to begin, and links to the product pages. No keys or private board token. |
| `provisioning/` | Actual platform/image inventories and smoke report; credential **availability/source only**; known limitations and approved network policy. |
| `capture/` | Sanitized observations and transcripts. Keep this separate from the runtime and target source. |

Do not pre-create `planning-state/` or `run-state/` by copying an earlier run.
Those names are the new controller directories the commands below will create.
Record planning and execution as distinct budgets and clocks. A planning-only
grant is not permission to build or publish; it can itself consume model usage.

The target must already have an accessible HTTPS or SSH clone URL and the named
commit. The public plan rejects a local path or `file:` URL as its initial
repository. A local bare origin is supported as a **delivery destination**, not
as a documented initial-source shortcut. Do not seed `prepared-source.json`
manually to bypass this requirement. If avoiding a hosted source is a condition
of the test, record this current front-door limitation before starting.

The historical [pipeline example](drive/examples/pipeline/README.md) has
useful source and a PRD, but its setup script describes the retired uncontained
drive and installs Python tools on the host. It is **not** the current contained
starter. Reusing its task requires a precommitted target and a runtime image
containing that target's Python/check dependencies. The Bun/Node ACP image alone
does not establish that toolchain. Do not run the old setup epilogue as a recovery
route for this test.

The new [Bun pipeline task](../examples/pm-blind-task/README.md) is the supported
source-only preparation example for this checkpoint. It has its own PRD,
dependency-free target, green regressions, six intentionally red protected
acceptance checks and a real text display. Its normal source URL is the public
Wringer repository at an exact newly pushed commit; a separately prepared local
bare mirror can receive delivery without a hosted forge account. It still needs
the actual image/policy/credential/spend prerequisites above. A prepared example
does not itself pass the blind test.

### Reuse this account's credentials

The default route is automatic retrieval, not another key-entry exercise. The
declared role names determine what is read:

| Declared variable | Existing macOS Keychain service | Account |
| --- | --- | --- |
| `CODEX_API_KEY` | `openai-api-key` | `wringer` |
| `ANTHROPIC_API_KEY` | `anthropic-api-key` | `wringer` |

The launching environment takes precedence over Keychain. The controller reads
existing items into process memory and passes only each role's allowed names.
It does not copy the host's login directories into an agent. Do not run login,
replace an item, or print an exported key to make a retry work. Record an OS
Keychain-access prompt as provisioning, rather than asking for the secret again.
The [credential guide](native/HEADLESS.md#reuse-the-credentials-you-already-have)
contains the optional existing-item retrieval commands and the missing-item
route. Do not use `WRINGER_API_KEY` or a remembered shell-worker recipe for ACP.

The selected adapter must actually support each declared variable. A present
variable or opened session does not prove the effective provider identity,
available quota, selected model or valid key. Keep the exact doctor wording.
Do not infer a model from an adapter's name; record the operator's explicit,
adapter-supported selection, or record that its default was not established.

### Exact launch sequence after provisioning

Run from the handover folder with the build selected by
[INSTALL.md](../INSTALL.md) already on `PATH`. Uppercase values below are explicit
operator choices; replace them once in `START.md` before admitting the observer.

If an operator-authored execution plan is already ready for review:

```sh
wring --version
wringer-drive plan PLAN.yaml
wringer-drive doctor --plan PLAN.yaml
wringer-drive doctor --plan PLAN.yaml --probe-agents
wringer-drive authority PLAN.yaml --actor 'OPERATOR' --expires 'FUTURE_ISO_EXPIRY' --output execution-authority.json
wringer-drive run PLAN.yaml --authority execution-authority.json --state run-state
```

If acceptance must first be proposed from the PRD, copy the
[planning-only template](../packages/plan/examples/planning.yaml) to
`TEMPLATE.yaml` and fill its actual task/runtime values. The template must declare
`agents.planner` with ACP and `budget.max_planner_turns` of at least one. The
ordinary execution example has neither; using it unchanged is not a planning
recipe. The fixed repository, role/runtime policy and scope are operator inputs,
not questions a planner can silently answer or enlarge.

```sh
wringer-drive propose TEMPLATE.yaml --intent PRD.md --actor 'OPERATOR' --expires 'FUTURE_ISO_EXPIRY' --state planning-state --output proposed-plan.json
wringer-drive plan proposed-plan.json
wringer-drive doctor --plan proposed-plan.json
wringer-drive doctor --plan proposed-plan.json --probe-agents
wringer-drive authority proposed-plan.json --actor 'OPERATOR' --expires 'FUTURE_ISO_EXPIRY' --output execution-authority.json
wringer-drive run proposed-plan.json --authority execution-authority.json --state run-state
```

Only continue after the proposal is produced and reviewed. A genuine planning
question or missing precommitted acceptance check is a stop, not permission to
invent an answer or have the controller write product/check code. The proposal
command may spend; it validates its template before starting but is not a free
authentication probe. A planning-only template without `acceptance` is not an
execution plan for `doctor --plan`: preflight the chosen adapter/policy during
operator provisioning, then probe the resulting proposed plan before execution.

After the first durable run record exists, open a second terminal in the same
handover folder and run:

```sh
wringer-drive board --state run-state
```

Open its private URL, but do not put the fragment token into the transcript or
screenshots. Keep the board process alive while it owns an action. The workspace
can continue, show, review, request a revision, prepare and separately publish
that same bounded journey; it does not start an unconfigured task from a blank
page. If a stop happens before the first run journal, preserve its discovery or
planning record and printed route; the board is not yet a substitute for it.

### Remaining choices must be resolved, not guessed

Before declaring this sheet ready to run, fill in the actual task/repository,
baseline commit, measured image digest, agent/model configuration, provider
egress allowlist and DNS, spend ceiling/expiry, display criterion and publication
destination. The current network policy accepts explicit IPv4 CIDRs and ports,
not hostname rules; do not replace an unresolved provider allowlist with broad
unrestricted access. An installed or running Apple service, a built image, local
unit tests and a passed offline delivery audit do not by themselves complete the
real-platform smoke or authorize a model call.

## Blind phase

Give the observer only the PRD, prepared machine/task location and product front
door: the root `README-PM.md`, `INSTALL.md`, `SETUP.md`, `QUICKSTART.md` and the
installed product guide. Record every page touched. Do not give the observer
implementation knowledge, a hidden recovery path or this implementation report.

Follow product pages and exact printed routes:

- Review a declared plan or request an unapproved proposal through the declared
  ACP planner. A planner's genuine question is allowed; silently inventing a
  product decision is not. Record planning attempts and usage separately.
- Grant one bounded execution authority. Record measured environment and the
  authentication wording before model work. No routine per-tool approval loop.
- Observe red-first checks, isolated coding, independent candidate verification
  and the separate judge. An unavailable tool is not a red acceptance receipt.
- Open the live PM workspace for the same controller state. Ask the observer
  what is happening, what changed, what is evidenced, what remains, what is
  known about cost and what action is required. Record hesitation and errors.
- Exercise one requested revision within the original authority. Earlier human
  acceptance must not follow changed source. Count any repeated known work.
- At the human hold, run the offered display. The real observer records their
  own verdict and note, tied to that display and exact candidate. No fabricated
  human verdict or missing-display bypass.
- Prepare the delivery, inspect the destination and evidence, then make the
  separate publication decision. A branch push, hosted request and merge are
  different facts; a local bare-origin test does not establish a hosted MR.
- Certificate, board, `view.json`, summary and MR must agree on journey,
  candidate, delivery, counts and the observer's exact note. Check all promised
  receipt files, including before-change failures.
- From a fresh clone on the delivered branch, run the delivery's literal audit
  and falsification commands from the directory its `mr.md` names. Audit must
  have no failed/uncheckable claims. Falsification must name the committed range
  and each measured mutant; surviving or unavailable results stay visible.
- Last, run the contained doctor against this controller state. Its last-verify
  line must name this journey's actual record.

An interruption drill may be predeclared as part of the same run: stop the
controller, reopen the board and follow the offered recovery route. The
application must not replay an uncertain paid or remote effect automatically.
Retained spend remains charged; a refresh is not new authority.

## Verdict and capture

The blind verdict ends at the **first hand repair**: an implementation/config
edit, undocumented flag or path obtained outside the product's offered route.
Capture that whole stop before changing anything. A printed recovery command
is the product speaking; taking it is not hand repair. Honest model failure
within the budget is a completion result, not automatically a harness defect.

Any later continuation is **salvage**, explicitly separated. Log every repair
verbatim. The blind verdict comes only from the blind phase; later findings
can still improve the dossier.

Retain commands, outputs, exit status, timestamps, pages, stop records, display
receipts, the journal, all delivery projections, fresh-clone audit, falsification
table/reason, doctor report, session/token observations, unknown billing,
wall-clock time and active human attention. Redact secrets **before** capture;
do not capture the private board URL token. Never replace an unknown cost with
zero. Publish a result table with pass/fail/unavailable and the evidence path,
not a composite quality score or an inferred SOTA claim.
