# Canonical execution plans

The public compile-only route is `wringer-drive plan PLAN.yaml` (or `PLAN.ts`).
Follow [QUICKSTART.md](../../QUICKSTART.md) and
[HEADLESS.md](../../docs/native/HEADLESS.md) for explicit authority, contained
run/resume, review and delivery. The APIs below describe the same compiler;
there is no direct-HTTP or host-agent shortcut.

`compileExecutionPlan(text, {format: 'yaml' | 'typescript'})` produces a frozen
versioned execution plan. Equivalent declarations produce the same canonical
JSON and digest. Unknown fields, duplicate YAML keys, custom tags, unsafe paths,
floating source/image references, unbound required criteria and undeclared secret
channels refuse compilation. Configuration does not execute a command or open a
provider connection.

The TypeScript DSL is deliberately restricted:

```ts
import { definePlan } from '@wringer/plan';
export default definePlan({ /* literal declaration fields */ });
```

The compiler reads its AST; it never imports or evaluates the file. Only JSON-like
literal properties and arrays are supported. Spreads, calls, callbacks, getters,
computed keys, environment access and additional imports are rejected. An advanced
executable DSL would require a separately contained evaluator; none is implied.

The parser-aligned [YAML template](examples/contained.yaml) is compile-only. Its
repository revision, runtime image and tool-version placeholders must be replaced
with measured values. Its deny network cannot reach a live provider. Neither the
example nor a successful compile proves that an adapter or runtime exists.
The source build also copies this template to `dist/docs/examples/contained.yaml`.

`discoverEnvironment(repoOrBareStore, plan)` reads the exact commit's Git objects.
It records source inventory, context/rules, declared tools and baseline commands,
scope and protected acceptance. Bare controller object stores need no checkout.
Ordinary checkouts must be clean at the pinned revision. Tool/baseline observations
default to null; only source/image/command-bound supervisor observations can fill
them. No repository command is run on the host. `assertEnvironmentFresh` rejects
changed source and altered map content.

`createExecutionAuthority` and `validateExecutionAuthority` bind the actor,
repository, plan, acceptance digest, allowed routine actions, expiry and budgets.
Authority cannot enlarge the frozen plan ceiling or delegate human judgement.
These versioned declarations do not authenticate a person's identity or establish
a sandbox by themselves. The contained runtime and controller enforce that boundary.
# Design-bound plans

Version 1 remains byte-compatible and does not accept a design declaration.
Version 2 adds `design.snapshotPath`, `design.snapshotSha256` and exact visual
review declarations. The snapshot is a protected regular Git blob, must explicitly
permit repository disclosure, and is independently validated before discovery is
ready. Every referenced image must exist in those approved snapshot bytes.

Each visual review names a required human requirement, its reference IDs and
bounded PNG capture paths inside approved writable output directories. The show
command must actually produce those captures. Capture dimensions are at most
4096 per axis and eight million pixels. The acceptance hash includes both the
acceptance contract and the design declaration, so changing a reference, capture
size or snapshot invalidates the previous approval.

`wringer.planning-request.v2` retains the design declaration while acceptance is
still being proposed. Synthetic criteria used for strict compiler validation are
discarded: they are never shown as an approved plan, run, or retained in a request.
A planner must return real source-linked human requirements/show commands or ask
a question. Planning authority remains `plan` only, never build or human approval.

Large snapshot/image bytes do not enter the general environment text context.
The contained runtime receives only the exact path, hash and reference IDs, then
validates and serves the pinned reference through its read-only design channel.

## Measured loops and worker playbooks

Version 3 preserves the old v1/v2 contracts and adds three explicit declarations:

- `loop: {repeatCandidate: stop, repeatedOutcomeWarning: 3}`. Missing v3 loop
  policy normalizes to this default; old plans gain no new default. Warning
  thresholds are integers from 2 to 64. An exact repeated unsuccessful candidate
  cannot be configured to grant delivery.
- A check may select `evidence: {kind: assertions, format: wringer-check.v1}`.
  That declaration is part of acceptance identity. The compiler does not infer
  executed assertions from an exit code; the verifier must establish them.
- `playbook: {path, sha256, taskFamily}` selects one exact tracked JSON artifact.
  Its path is protected and excluded from shared environment text. The full raw
  UTF-8 file digest, not an ID or a mutable version label, binds the selection.

Design is optional on v3; when present it retains the same source-bound visual
review constraints. Execution-authority v1 still binds the exact plan/acceptance
digests and unchanged finite actions/budgets; no playbook can renew authority.
Planning-request v3 carries loop/playbook/design selection without synthetic
acceptance or permission to build.

An optional `playbook.adoption` retains the complete stamped future-only
adoption receipt. Its repository, task family and selected digest must match
the plan; any change changes plan identity and needs fresh execution approval.
This validates provenance content only: a delivery retaining the receipt does
not independently rerun the private experiment or authenticate the reviewer.

Offline comparison can use `validateExecutionPlan(plan,
{credentialEnvironment: {}})` (also supported by `compileDeclaration`). All
structural, semantic and digest validation remains active, including generic
credential-pattern detection; no caller environment credential values are read.

`readPinnedPlaybook(repoOrBareStore, plan, {environment})` reads only Git objects
from the approved base commit. It refuses changed bytes, symlinks, wrong task
family, incompatible scope/context/checks and unmeasured required tools. A
`wringer.playbook.v1` manifest is inert advisory data, capped at 64 KiB: worker
role, ID/revision, applicability, guidance, limits and evaluation digests. No
script hooks, remote fetching, template expansion, implicit discovery or new
tool authority exists. `validatePlaybookSnapshot` independently checks retained
content and snapshot identities. Without an environment argument, applicability
checks declarations only; it does not claim measured readiness.

The [Reports playbook](../../examples/reports-design/wringer/playbooks/reports-component-first.json)
is an unselected, unpromoted example, not evidence of performance benefit.
Guidance is not injected into the judge's instruction packet. As a tracked
repository artifact it may remain readable through source/history; worker-only
injection is not a secrecy boundary. The existing independent role, protected
acceptance and source checks remain responsible for authority separation.
