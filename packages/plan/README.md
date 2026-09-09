# Canonical execution plans

The public compile-only route is `wringer-drive plan PLAN.yaml` (or `PLAN.ts`).
Follow [QUICKSTART.md](../../QUICKSTART.md) and
[HEADLESS.md](../../docs/native/HEADLESS.md) for explicit authority, contained
run/resume, review and delivery. The APIs below describe the same compiler;
there is no direct-HTTP or host-agent shortcut.

`compileExecutionPlan(text, {format: 'yaml' | 'typescript'})` produces a frozen
`wringer.execution-plan.v1`. Equivalent declarations produce the same canonical
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
