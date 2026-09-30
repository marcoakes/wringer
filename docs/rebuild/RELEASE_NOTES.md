Wringer 1.0.0-alpha.31 lets a graph hand one bounded task to an external agent
over A2A without trusting what the agent says.

```sh
wringer-drive graph plan examples/graphs/external-task/graph.yaml
wringer-drive graph run GRAPH.yaml --authority AUTH.json --state DIR --source-bundle SOURCE.bundle
```

A version 4 graph adds a `delegate` node. It sends one task to an agent that
speaks A2A 1.0 over JSON-RPC: `SendMessage`, `GetTask` and `CancelTask`, with the
`A2A-Version` header on every request. The approved graph pins the agent's
endpoint, HTTPS or a loopback address for local fixtures, and the sha256 of its
Agent Card. The card is checked in preflight, before anything is sent, and again
when the task completes. A changed card needs a new approved graph.

The request is recorded before it is sent and the task id as soon as it is known.
At the declared timeout Wringer sends one `CancelTask`. An interrupted run is
reconciled by reading the retained task id and is never sent again.

A completed task must return exactly one artifact with one `text/x-diff` part.
Wringer applies it to the exact base in controller storage. It may touch only the
delegate's verification plan's writable scope, never its protected checks. The
compiler lets only a check node read that candidate, and the check verifies it
afresh in a contained verifier with the delegate's plan. The agent's completion
claim never counts as acceptance. The outcomes are `returned`, `failed`,
`canceled` and `unavailable`, each recorded with the task states observed and a
reason. A fresh clone's Node reader checks the delegation record against the
graph's recorded result.

A new [service interfaces](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.31/docs/native/INTERFACES.md)
page lists each boundary Wringer exercises: ACP, MCP, A2A, contained execution,
durable orchestration and publication. It gives each boundary's contract and
evidence level, and what is pending.

New sibling records are `wringer.contained-graph-plan.v4`, `-event.v4`,
`-status.v4`, `-export.v4` and `wringer.contained-graph-delegation.v1`. Version 1
to 3 graphs keep their records, and published schemas keep their bytes. The phase
has 27 isolated reversion checks. A compiled walkthrough uses the public binary
itself as the A2A client, over real HTTP to a local reference peer. It covers a
changed card refused before sending, one task sent, the returned patch held for
its check, a missing runtime refused, the check, review, Send, a fresh-clone Node
audit and a refused edited record. A local peer establishes fixture conformance
only. No real A2A agent has completed a task, and no claim is made that services
are interchangeable.

Phase 7's Temporal runtime is not in this release. Its measurement found that
graph decisions are a pure function of recorded events and every effect sits
behind a durable marker. The prototype against a local Temporal service needs
the Temporal CLI and SDK downloaded, which awaits the operator's approval.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. The required release jobs verify
those archives and their installer/package routes before staging publication.
GitHub publication does not itself publish an npm package, Homebrew tap or MCP
registry listing. The documented cooperative-local operator boundary remains.

[External tasks](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.31/docs/native/GRAPHS.md)
· [Capabilities and limits](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.31/docs/CAPABILITIES.md)
· [Previous release: tournaments](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.30)
