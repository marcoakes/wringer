# Wringer: full-repository Bun rewrite

Date: 6 September 2026.
Status: execution plan, not a completion or release claim.
Owner: Codex acting as implementation lead and PM for Marc.

## The product promise

Give Wringer a bounded change and an operating budget. Return to a review-ready
merge request, an intelligible explanation of the change, and evidence another
machine can check. Routine supervision should not be the operator's job.

An honest stop is necessary, but it is not a successful build. The product must
be measured by useful changes delivered, acceptance quality, and human time saved.

## Architectural decision

This is a rewrite of the existing Wringer repository on main. It is not a second
product under `ts/`, a permanent Python/Bun split, or a new development branch.
The current native alpha is reusable implementation material, not the target
architecture. Earlier staged-port recommendations do not define this destination.

```text
TypeScript DSL / YAML
          |
          v
Validated, versioned execution plan
          |
          v
Bun CLI: scope, orchestrate, verify, record, deliver
          |
          +-- ACP --> worker agent runtime --> its contained repository clone
          |
          +-- ACP --> judge agent runtime  --> separate contained candidate clone
          |
          +-- independent verification --> fresh contained candidate clone
          |
          +-- controller-owned records --> delivery bundle and hosted MR

Containment: Apple container locally; gVisor-backed Kubernetes remotely.
```

Bun is the JavaScript/TypeScript runtime running the harness. No Java or JVM is
part of this choice. The CLI can write orchestration records and assemble a
delivery; it does not invent or implement the requested product code. Agent
runtimes own the read/tool/result/repeat loop. Planning or judging that requires
a model is delegated to an agent role, not a competing model loop inside the CLI.

ACP is the vendor-neutral communication boundary, not a sandbox or a guarantee
that every tool action produces a permission request. Any client-provided file
or terminal operations must also execute inside the appropriate sandbox; they
must never turn an agent request into host execution. Use pinned, tested ACP
implementations/adapters for Claude Code and Codex, with capability negotiation
and explicit unsupported-capability errors, not a silent shell fallback.

The DSL and YAML resolve to the same canonical, inspectable execution plan.
Repository TypeScript is executable, so evaluating it must itself be contained,
without host credentials or authority. Neither syntax can smuggle arbitrary
host-side callbacks into the control plane. Configuration cannot enlarge its
parent's authority. Freeze the resolved plan before paid work starts.

## The three pillars, expressed as obligations

| Pillar | Product obligation | Release evidence |
| --- | --- | --- |
| Environmental legibility | Give the agent a measured map of repository structure, ownership, architectural rules, dependencies, working commands, baseline failures, acceptance criteria and permitted actions. Link context back to source and regenerate it when the source changes. | On an unfamiliar repository, both agent backends can locate the relevant subsystem, execute the declared baseline and explain constraints without operator-supplied hidden paths. Deliberately stale maps are detected. |
| Repository as system of record | Preserve intent, decisions, resolved plans, policy, source identities, acceptance and delivery lineage in versioned, portable records. The board and MR are views of those records, not additional authorities. | A fresh clone plus its declared delivery bundle reconstructs the run and checks every published claim without the original workstation or chat. |
| Mechanical enforcement | Enforce scope, filesystem access, network access, resource budgets, protected acceptance, stage transitions and publication authority in code and infrastructure, outside the worker's write authority. | Adversarial attempts to change policy, forge receipts, reuse stale approval, cross sandboxes or publish directly are denied and recorded on both real backends. |

Legibility is designed to help understanding; it is not a claim to inspect a
model's internal comprehension. A populated requirement table is not proof that
the user's intent was captured. Independent acceptance evaluation must test that.

## Trust boundaries

- Worker and judge have separate sandbox instances, process trees, sessions,
  writable storage and role credentials. The judge receives the original
  acceptance contract, candidate and relevant evidence, not the worker's private
  conversation. It can build/test in scratch space but cannot modify the candidate
  being accepted or publish a replacement.
- Clone the repository inside each environment. Do not bind-mount the user's
  working checkout, home directory, credential stores, container control socket
  or Kubernetes credentials into an agent sandbox.
- A repository with no remote is identified by the single root commit of its
  history (`local://<root>`, plan v4) and travels only as the Git bundle
  prepared beside its profile, which the controller verifies and keeps. The
  URL was always an identity string, never dialled. Records downstream of the
  plan that still pin a hosted URL (authority, environment map, runtime
  provenance, playbook snapshot, planning request) are not yet versioned, so a
  local-only source stops at approval.
- Enforcement and tests are repository-owned, but the active policy and acceptance
  contract are pinned from an approved revision. A worker may propose policy or
  test changes; its candidate changes cannot silently redefine the rules that
  accept that same candidate. Independent verification uses a fresh environment.
- Evidence is captured by a controller-owned supervisor, not trusted because a
  worker wrote a JSON file. Carry portable records in a dedicated repository
  evidence namespace/bundle. Agents cannot write the authoritative publication
  refs. Keep credentials and unsanitized private logs out of Git.
- Bind verification, check inputs, environment image, resolved dependency state,
  human display and judgement to the exact candidate. Initially invalidate human
  acceptance on any candidate-tree change; narrower invalidation requires proof
  of a sound dependency boundary. Criterion wording alone is insufficient.
- The controller holds scoped delivery credentials. Agent sandboxes cannot push,
  approve themselves, alter the authority record or merge. Record the verified
  source commit separately from the later evidence/publication commit.
- A sandbox is one boundary, not total security. Egress restrictions and resource
  limits need their own enforced policy. Repository content, agent output and
  candidate code remain untrusted data at every privileged control-plane entry.

## Implementation order and exit gates

### 1. Establish one product and publish its real starting point

Review the existing native changes, exclude secrets/local-only artifacts, retain
a portable validation summary, and commit/push a clearly labelled checkpoint to
the existing main branch. Never label the checkpoint a finished rewrite. Confirm
the remote commit and actual CI outcome; do not infer either from local tests.

Make the root workspace, package metadata, commands, CI, examples and documentation
point to Bun. Move reusable native packages into the root product layout. Preserve
published record schemas and compatibility fixtures. Retire the Python runtime
and its packaging from the active product once replacement gates pass; retain
history and explicitly mapped compatibility evidence, not a permanent fallback.

Exit: a fresh clone builds and invokes one Bun harness with no Python runtime
dependency. Existing records have declared compatibility; changed interfaces have
an explicit migration, not an accidental regression or two conflicting manuals.

### 2. Deliver one real ACP/contained vertical slice

Build configuration compilation, environmental discovery, the ACP client and a
sandbox lifecycle interface. Start with Apple container to shorten local feedback;
implement gVisor/Kubernetes against the same contract before release. Integrate
both required agent backends; unsupported adapter capabilities fail preflight.

Exit: each backend receives the resolved plan over ACP, edits only its clone,
streams causal progress, respects cancellation and produces a candidate inspected
by a separate judge. Inject unavailable credentials, broken transport, tool
failures and process crashes. Demonstrate real host/peer isolation and cleanup;
mock container tests do not satisfy this gate.

### 3. Make acceptance and recovery authoritative

Promote the useful existing record/verification work into a durable state machine.
Journal external effects before execution; reconcile completion after crashes.
Keep paid successes and previous decisions. Reserve budgets over the whole
journey, not each retry. Never silently repeat an uncertain spend or publication.

Protect acceptance and source-bound evidence. Independently evaluate requirement
coverage, red-first receipts, regression tests, judge findings and human criteria.
Keep unknown, failed, unproved and not-yet-reviewed states distinct.

Exit: interruption tests at each effect boundary resume without duplicated known
effects, authority expansion or false completion. Seeded omitted requirements,
unrelated green tests, changed check dependencies, forged receipts and post-review
edits cannot pass acceptance by manipulating the evidence machinery.

### 4. Finish the PM journey and actual delivery

One guided entry path should take intent through plan, permitted build/review
iterations, any genuine human acceptance, and hosted MR creation. The board must
answer: what is happening, what changed, what is evidenced, what remains, what it
cost, and whether the operator must act. All views derive from one fact model.

MR creation is a real provider operation with a recorded URL and reconciliation
after uncertainty, not just a file named `mr.md`. Wringer's own rewrite stays on
main; the product can still create scoped delivery branches/MRs in target repos.
No implicit merge, deployment or public release follows from creating an MR.

Exit: the printed fresh-clone audit and committed-range falsification commands
work as printed. Certificate, board, summary and hosted MR agree on exact source,
run, counts and review notes. Falsification survivors remain visible findings.

### 5. Earn the release claim with independent runs

Predeclare 20 bounded tasks across three representative repositories, including
a user-facing application. Cover both agent backends and both supported sandbox
backends, with pinned versions, recorded starting conditions and published task
allocation. Include a fresh operator who did not implement Wringer. Repeat with
the same underlying builder/model directly as the comparison condition.

Proposed release targets, not results already achieved:

- At least 16/20 tasks reach independently accepted, review-ready delivery within
  declared budgets. Count model non-convergence and honest stops separately, but
  keep them in the completion denominator.
- Zero undocumented repairs or repeated routine approval prompts. Distinguish
  one-time provisioning, genuine product choices and required human verdicts.
- Every published delivery passes its portable audit with zero failed or
  uncheckable claims. No seeded evidence/authority attack produces false acceptance
  in the declared adversarial suite; this is not a universal security guarantee.
- Target at least 50% lower active human supervision on matched tasks without
  worse independent acceptance. Publish sample size, failures, usage uncertainty,
  wall clock and raw measurement method; do not market a fixture as a benchmark.

The launch demonstration is one uncut real journey: understand an unfamiliar
repo, implement a meaningful change, expose an injected defect through independent
review, repair it within budget, open the MR, then audit it from a fresh clone.
Publish misses as well as the successful demonstration. Broad fleet features and
extra providers do not displace this release gate.

## Unattended operation without repeated routine approvals

Provision a scoped execution environment once. Reuse existing authorized
credentials without asking Marc to re-enter them. Record allowed repositories,
actions, network destinations, resource ceilings, expiry and publication rights.
ACP permission requests inside that envelope are handled mechanically. Requests
outside it are denied with an exact reason or become one meaningful escalation;
they do not gain authority because the agent asks repeatedly.

Budget enforcement must match measured capabilities. Hard process/time/resource
caps are separate from provider billing. If an adapter cannot expose or enforce
required cost limits, preflight must disclose that and refuse that policy rather
than advertise an imaginary hard dollar cap. Unknown usage is never zero.

This does not bypass the current desktop task's managed host permissions or
fabricate a human review. OS installation, unavailable infrastructure, new paid
capacity or genuinely missing authority can still require an operator. Batch
provisioning decisions; do not delegate routine PM questions back to Marc.

## Current baseline and outstanding environment work

As inspected on 6 September, local main contains an uncommitted native alpha.
Its reported local result includes 169 native tests and a deterministic delivery
fixture, not a live-provider/real-containment result. Shell workers, a direct-HTTP
judge, simulated container integration and an MR document do not meet this plan.
See [the historical implementation report](native/IMPLEMENTATION_REPORT.md).

This Mac reports macOS 26.5.2. Neither `container` nor `kubectl` resolved on the
current PATH during planning. That is an observation, not proof that no binaries
or cluster exist elsewhere. Verify/provision actual local and remote backends;
do not silently replace either with ordinary host execution.

Primary implementation references checked during planning:

- [ACP protocol lifecycle](https://agentclientprotocol.com/protocol/v1/overview):
  initialize, sessions, prompts, progress, permissions and cancellation. Negotiate
  optional features; do not assume session resume or complete tool observability.
- [Apple container](https://github.com/apple/container): Linux containers in
  lightweight VMs on supported Apple-silicon/macOS hosts; pin the tested release.
- [gVisor Kubernetes integration](https://gvisor.dev/docs/user_guide/quick_start/kubernetes/)
  and [security model](https://gvisor.dev/docs/architecture_guide/security/): verify
  the selected runtime and separately enforce networking and resource policy.

## Definition of done

A milestone is delivered only when its scoped changes are committed and pushed
to the existing repository, remote checks are observed, documentation matches,
and its reproducible evidence and limitations are available from the repository.
If branch protection prevents direct main publication, report that blocker;
do not force-push, disable protection or invent a development branch.

The rewrite is complete only when Bun is the root product, ACP is the supported
agent path, both real containment backends pass, the three pillars are enforced,
the hosted-MR journey passes, and the independent release evaluation is reported.
Code written locally, mock tests, a new language and the label “SOTA” are not
substitutes for those outcomes.
