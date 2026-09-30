Wringer 1.0.0-alpha.26 runs serial graphs of contained loops. Express scope →
build → fresh check → review → delivery as one workflow with one allowance, one
resumable history and an exact candidate handed from step to step.

```sh
wringer-drive graph plan examples/graphs/serial-repair/graph.yaml
wringer-drive graph run GRAPH.yaml --authority AUTH.json --state DIR
wringer-drive graph status --state DIR
```

A graph has five node kinds. `loop` runs an ordinary contained journey from a
pinned execution plan. `check` re-runs the pinned acceptance checks on the exact
candidate in a fresh contained verifier. `router` selects the next node from a
typed outcome. `human-hold` waits for a decision bound to the graph's exact
revision and held input. `delivery` prepares the portable delivery and waits for
a separate Send. A loop's `plan:` names a plan file that `graph plan` compiles and
pins; no repository code is evaluated on the host.

Invalid graphs are refused before any effect, including cycles, undeclared
outcomes, inputs not available on every path, paths to `done` that skip a
required node, and loops that can write another leaf's acceptance inputs. The
root allowance must reserve every declared leaf, including exclusive branches.
Each node's share is reserved before its effect, and a separate marker is durable
before the effect starts. An effect-free preflight runs first, so a missing
container runtime or publication branch leaves work reserved and resumable. After
a marker, resume reconciles retained evidence only. A completed child is picked
up without a second run, and missing evidence stays `uncertain`, never becoming a
second paid call or push.

A failed required node ends the graph at once; neither a router nor a later human
choice can turn it green. Each child's plan and grant are clipped to the root's
remaining time. Graph authority never grants Send. A Send binds the revision and
the prepared delivery's digest, is recorded before publication and is never
reissued. A lost confirmation is reconciled read-only from the remote branch.

`wringer-drive graph export` writes the exact plan, grant and hash-chained events,
per-node evidence bound to each recorded result, and each delivery's existing
evidence envelope. `read-bundle.mjs` verifies integrity, the chain, graph binding
and loop-to-delivery lineage with Node built-ins only. Child controller journals
and raw verifier output are named omissions. A graph that publishes to a local
bare origin carries that path in its pinned plan, and the export says so.

New sibling records are `wringer.contained-graph-plan.v1`, `-authority.v1`,
`-event.v1`, `-status.v1` and `-export.v1`. Previously published schemas keep
their bytes and meaning, and retired host graph files stay readable with `wring
graph show`. The phase has 81 isolated reversion checks, each classified by what
removing the guard changed. A compiled walkthrough drives 21 public commands.
They cover a missing runtime, a child that completed before a crash was recorded,
a crash right after the dispatch marker, stale decisions, a wrong or repeated
Send, a Node-only export check and a fresh-clone delivery audit. Loop and check
observations in that walkthrough are synthetic and come from a separately
compiled fixture binary. Scripted decisions are engineering checkpoints. Live
agent convergence, real containment, human acceptance and any benefit over a
single job remain unmeasured.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. The required release jobs verify
those archives and their installer/package routes before staging publication.
GitHub publication does not itself publish an npm package, Homebrew tap or MCP
registry listing. The documented cooperative-local operator boundary remains.

[Serial graphs guide](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.26/docs/native/GRAPHS.md)
· [Capabilities and limits](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.26/docs/CAPABILITIES.md)
· [Previous release: improvements from ordinary jobs](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.25)

Bounded parallel branches, broader improvement proposals, tournaments, Temporal
and A2A remain subsequent phases in the restoration plan.
