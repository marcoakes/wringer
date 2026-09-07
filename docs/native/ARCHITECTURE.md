# Wringer architecture

The active harness is Bun/TypeScript at the repository root. Python is retired as the harness runtime; historical records and contracts are retained for compatibility. There is one product and one active build path.

Wringer scopes, orchestrates, verifies, records and delivers. It does not author product code, evaluate arbitrary TypeScript on the host, or implement a competing model/tool loop. ACP delegates that work to separately declared agents.

## Three pillars

**Environmental legibility:** the plan and source-linked environment map identify repositories, context, tools, baselines, constraints and acceptance. A declared tool is not a measured tool; null observations stay null.

**Repository as system of record:** intent, exact plans, authority, decisions, source identities, receipts and delivery lineage remain portable. Views derive facts, not additional authority.

**Mechanical enforcement:** scope, permissions, role isolation, budgets and acceptance are enforced outside the worker's write authority. A proposed change to policy cannot approve itself.

## Packages

| Root workspace package | Responsibility |
| --- | --- |
| `packages/records` | Frozen versioned contracts, generated types and refusal-aware readers |
| `packages/plan` | Strict YAML/constrained TypeScript, canonical execution plans and environment maps |
| `packages/acp` | Agent protocol lifecycle, sessions, requests, permissions and cancellation |
| `packages/runtime` | Apple Container/gVisor Kubernetes role lifecycle, execution policy and provenance |
| `packages/engine` | Configuration, snapshots, checks, process supervision and evidence |
| `packages/workflow` | Controller-owned plan/authority state and durable orchestration |
| `packages/board` | Shared HTML/Markdown/certificate derivations for standalone verification records; not a contained-state reader |
| `packages/delivery` | Source/evidence anchoring, explicit publication, audit and falsification |
| `packages/scheduler` | Internal/historical graph/fleet APIs, read-only public graph inspection and historical gate health |
| `packages/cli` | Thin command routing, acquisition, review pen and operator-facing diagnostics |

## Plans and isolation

Strict YAML and literal-only `definePlan` TypeScript are authoring forms for the same canonical `wringer.execution-plan.v1`. Compilation must not run imports, calls or expressions with host privileges. The plan pins the repository commit, intent, acceptance, allowed scope, agents, runtime policy and budgets.

The controller keeps its state separately from the target repository clone. Role execution clones the pinned repository inside a fresh runtime. Worker source is writable within its scope; planner/judge source is read-only. Roles do not share writable storage or sessions. ACP file and terminal callbacks remain inside the selected role boundary.

Two runtime policies are named: `apple-container` and `gvisor-kubernetes`. They declare image, CPU/memory, network and environment names; Kubernetes also declares context, namespace and RuntimeClass. Credentials cross only through declared environment/secret mechanisms, never a host-home or control-socket mount.

The adapter must establish the requested boundary before execution and preserve provenance and cleanup outcomes. It must not silently substitute host execution. Runtime availability, generated manifests, live policy enforcement and resistance to adversarial workloads are different claims.

## Authority and recovery

The authority names the actor, exact plan and acceptance digests, permitted actions, finite budgets and expiration. It is created explicitly, before side effects. The driver checks the frozen authority again on resume; an old routine-authority format does not authorize a new execution plan.

Spend and worker/session reservations belong to the whole journey. An uncertain effect is reconciled or reported, not replayed as if it never happened. Changed plan/acceptance invalidates old authority. A model reply cannot grant itself more scope, a human verdict or publication.

Planner, worker and judge responses remain agent reports. Independent controller-supervised observations establish check outcomes. A role's claim that it obeyed a boundary is not runtime evidence that it did.

## Evidence and delivery

Built, passing checks, proved requirements, human judgement, readiness and delivery
remain separate facts. `packages/application` is the shared command boundary for
the CLI and live PM workspace: durable idempotency, expected journal revision and
candidate identity accompany every browser action. The localhost API has an
ephemeral bearer token, strict Host/Origin checks, no cross-origin access and no
private facts in its unauthenticated HTML. The board is a projection, never a
second authority or an agent execution loop.

Contained delivery v2 carries one validated `view.json`; its certificate, board,
summary and MR are derived from that shared portable fact model. Old delivery v1
remains on its frozen audit/render path. An independent later verification does
not inherit a completed build unless lineage is established. Display/approval
binds the candidate tree; a revision withdraws earlier readiness.

Checks carry commands, exit/time observations and frozen source/check identities. A historical failure must resolve to the same relevant check; an environment failure is not an assertion receipt. Known secrets are scrubbed before evidence writes, but unknown/transformed secrets and sensitive business data remain risks.

Delivery uses an isolated Git index, a new branch and explicit publication authority. The source code commit and later evidence publication commit are separate because a bundle cannot contain the hash of its own enclosing commit. Portable receipt mappings let audit use a fresh clone rather than the original workstation.

Audit reconciles inventories, hashes, schemas, counts, source claims and human notes. Falsification measures supported mutations of the committed range after a clean control run. Neither a valid audit nor a surviving mutation is a universal software-quality verdict.

## Status and compatibility

The native record/evidence/delivery surfaces have deterministic test coverage. Mandatory isolated ACP orchestration is under integration and platform-specific verification. No generated Apple command or Kubernetes manifest is a substitute for live filesystem/network/resource/cancellation tests on the exact runtime and image.

Frozen schemas remain frozen. New facts use declared versions and sibling records. Old source-language installation/execution recipes are retired; historical artifacts remain readable where their contracts are supported. The [first rewrite report](IMPLEMENTATION_REPORT.md) is a dated snapshot, not current setup or proof of the new boundary.

Public graph access is read-only (`wring graph show`, `status`, `explain`).
`wring fleet` and `wring bench` execution refuse with a contained-plan migration
route. Their retained implementation APIs are internal/historical; they do not
provide a supported host-worker path around mandatory contained execution.
