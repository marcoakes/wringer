Wringer 1.0.0-alpha.27 runs independent work in parallel branches and integrates
it with its own verification. A fork opens private branches of contained loops;
a join merges their exact candidates and re-checks the result against every
branch plan before anything moves on.

```sh
wringer-drive graph plan examples/graphs/parallel-repair/graph.yaml
wringer-drive graph run GRAPH.yaml --authority AUTH.json --state DIR
wringer-drive graph status --state DIR
```

A version 2 graph adds `fork` and `join` to alpha.26's loops, checks, routers,
holds and deliveries. A fork opens two to eight branches, run at once up to the
graph's declared `parallelism`. Each branch is private: it reads only the fork's
input and its own nodes, must produce its own candidate, and ends only at its
join or `fail`. The compiler refuses nested forks, deliveries inside branches,
shared or externally reachable branch nodes and later nodes that read a branch
directly. The allowance must cover every leaf and every join verification.

The join waits for every branch. It merges the exact branch candidates in declared
order against the fork's source, with a fixed identity and time, so the same
branches always integrate to the same commit. It then verifies the merged
candidate afresh against every branch plan. Its outcome is `integrated`, `failed`,
`conflict` or `unavailable`. Only `integrated` continues; a router can send
`failed` to a repair loop or `conflict` to a hold. Phase 4's measurement shows
why: two candidates that each passed their own check merged cleanly in Git and
then failed a shared check.

One hash chain now tracks several active nodes. Every branch preflight runs before
any dispatch marker, so a missing runtime leaves every branch reserved. A failure
in any branch ends the graph, and open nodes in other branches are recorded as
cancelled. Lost and repeated completions reconcile once, and completion order
changes neither the history nor the integration. A delivery of an integrated
candidate publishes an evidence commit on the merged code carrying the graph's
own portable export, which a fresh clone checks with Node alone.

New sibling records are `wringer.contained-graph-plan.v2`, `-event.v2`,
`-status.v2` and `-export.v2`. Version 1 graphs keep their exact bytes, events and
views, and published schemas keep their meaning. The phase has 31 isolated
reversion checks, each classified by what removing the guard changed. A second
compiled walkthrough drives the public binary through a missing runtime, a crash
after both branches finished, integration, a graph-evidence Send, a fresh-clone
Node audit and a refused tampered export. Its role replies are synthetic, from a
separately compiled fixture binary, and its verifier really runs each pinned
check on the exported tree. Scripted decisions are engineering checkpoints. Live
agents, real containment and any benefit of branches over a single job remain
unmeasured.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. The required release jobs verify
those archives and their installer/package routes before staging publication.
GitHub publication does not itself publish an npm package, Homebrew tap or MCP
registry listing. The documented cooperative-local operator boundary remains.

[Graphs and parallel branches](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.27/docs/native/GRAPHS.md)
· [Capabilities and limits](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.27/docs/CAPABILITIES.md)
· [Previous release: serial graphs](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.26)

Gate and workflow improvement proposals, tournaments, Temporal and A2A remain
subsequent phases in the restoration plan.
