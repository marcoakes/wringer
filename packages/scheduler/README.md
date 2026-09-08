# @wringer/scheduler

This package retains internal/historical graph/fleet APIs and supported offline
history readers. **It is not a production agent execution route.** Public
`wring graph show`, `status` and `explain` are read-only. `wring fleet` and
`wring bench` execution refuse with a contained-plan migration instruction;
public graph execution is retired too.

For new agent work, follow [QUICKSTART.md](../../QUICKSTART.md) and
[HEADLESS.md](../../docs/native/HEADLESS.md). The production plan, authority and
ACP roles use mandatory isolated execution. Retained scheduler calls below use
the older engine semantics and must not substitute for that boundary.

## Retained internal API reference

The following describes the implementation exercised by historical compatibility
tests. Graphs sequence capabilities and fleets schedule independent tasks. It is
not a public setup/run recipe or evidence that host execution is contained.

```ts
import { runGraph, runFleet } from "@wringer/scheduler";

const graph = await runGraph(repo, "graph.yaml");
const resumed = await runGraph(repo, "graph.yaml", { resume: graph.graph_dir });
const fleet = await runFleet(repo, "tasks.jsonl");
```

Graphs support the five existing kinds: `intent`, `human`, `loop`, `router` and
`deliver`. Validation rejects unknown keys, command strings, cycles, unreachable
nodes, multiple entry points and routing state not available on every incoming
path. The list is derived from `graph.GRAPH_KINDS` in `src/graph.ts`, the shared
type/validation enum. Routers parse a small comparison grammar; they do not evaluate JavaScript.

Human nodes record an unapproved decision file and park with exit 5. Resuming an
unchanged parked decision produces no duplicate events. Approved nodes continue
from the hash-chained ledger, ignoring the convenience state snapshot. Completed
nodes are not repeated. A delivery node must hold an actual loop verification
reference; writing a successful string into routing state grants no delivery
authority. Sending requires the current invocation's explicit `send` option and
passes through the shared delivery implementation.

Fleets accept JSONL tasks with `id`, `brief`, optional `dir`, and optional
`depends_on`. `.wringer.yaml` declares `fleet.concurrency`, required `deadline`,
`progress_window`, `retries`, `on_exhausted`, `join`, optional `child` bounds and
optional `worktree`. Bounds nest: a child can never extend its worker, loop or
fleet ceiling. Repeated failure signatures and no-progress outcomes stop retries.
Silence is measured by the child's ledger events, and an expired progress window
aborts the child process group through the engine's runner.

Without worktree mode, every task must name a distinct Git working tree. With it,
the scheduler creates detached worktrees from a clean committed baseline. Their
changes and original evidence remain on disk, indexed by `worktrees.json`; there
is no automatic commit, merge, push or deletion. A dependency controls scheduling
and blocks on failed prerequisites; it does not merge predecessor changes into
the next independent task's tree.

The scheduler writes frozen `wringer.graph.v1` and `wringer.fleet.v1` manifests
and schema-valid chained event logs. Resumed fleets retain their original bounds
and spent attempts and do not rerun successful tasks.

Unsupported legacy modes are explicit: worker fallback ladders and fleet scope
files are refused. This implementation does not claim those modes work.

```sh
bun test ./packages/scheduler/test
```

Tests use real Git repositories, deterministic local worker processes and real
timeouts, not live model calls or platform-isolation measurements. They exercise
human park/resume, state forgery, delivery without proof, DAG validation, retained
worktrees, dependency order, bounded overlap, deterministic stops, liveness reaping
and schema-valid event streams.
## Historical health — supported read-only report

`health(repo, {from: [restoredHistory]})` is an offline, read-only view of existing records. It returns the exact frozen `wringer.health.v1` schema; `renderHealth(report)` and `healthExitCode(report, strict)` share that result. Unknown or malformed bundles are named in coverage, duplicate identities are counted once, and copied examples and bench/worktree exercises are read but never qualify. The fixed window is 25 observations per exact check identity and the negative-evidence floor is 10. No environment variable, gate process, network connection or current clock is consulted.

This is a report of recorded discrimination, never a judgement that a check is good. Missing history is untested; one genuine failure or sensitivity observation is alive; long green-only history is zombie. Current configuration decides requiredness. Without a config, strict mode does not invent it from historical flags.

The public command is `wring health`; use `wring health --help` for explicit
history roots and strict-mode semantics. It does not run or resume an agent.
