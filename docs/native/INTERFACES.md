# Service interfaces and their conformance

Wringer meets other software at a few boundaries. This page lists each one, the
exact version or contract it follows, what is exercised and how, and what is
still pending. A boundary appears here only after something actually exercises
it. "Fixture conformance" means deterministic tests against a local stand-in; it
says nothing about a real counterpart.

| Boundary | Contract | Exercised by | Evidence level | Pending |
| --- | --- | --- | --- | --- |
| Agent runtime (ACP) | Agent Client Protocol, protocol version 1: `initialize`, `authenticate`, `session/new`, `session/prompt`, `session/cancel`, `session/close`; permission requests answered by policy | Every contained loop, the prosecutor session and the playbook proposer | Fixture-tested with synthetic replies in this restoration | A second independent agent implementation passing the same lifecycle suite |
| Agent callbacks | The client offers no file or terminal capability | Every ACP session | Measured from the source: `clientCapabilities` is empty | — |
| Assistant tools (MCP) | 18 bounded tools; none approves, records a verdict, sends, merges or adopts | `wringer-assistant` | Fixture-tested | — |
| External agents (A2A) | A2A 1.0 over JSON-RPC: `SendMessage`, `GetTask`, `CancelTask`, the `A2A-Version` header, the Agent Card at `/.well-known/agent-card.json` | Version 4 graph `delegate` nodes | Fixture conformance only, against a local reference peer on loopback | A real peer completing a bounded task; streaming, push notifications and peer authentication schemes; interchangeability, which needs two independent peers passing the same suite |
| Contained execution | Apple Container locally; gVisor on Kubernetes | Every verifier and role session | Platform-specific; see the release notes | Live isolation claims per platform |
| Durable orchestration | A `GraphJournal`: hash-chained graph events on the local file system, or Temporal workflow history through an optional Node adapter (Temporal TypeScript SDK 1.24.0), each event mirrored create-once into the state directory; effects through `wringer-drive graph effect` | Every graph; the adapter by its conformance, failure-mode and versioning suites and a compiled walkthrough | Local journal fixture-tested with crash and reconciliation probes. Temporal adapter fixture-tested against a local dev server (Temporal CLI 1.9.1): byte-identical records with the local journal on the same recorded inputs and clock, worker loss, timeout, cancellation, duplicate and stale decisions, divergence, versioned replay; see [durable runtimes](DURABILITY.md) | A production cluster or Temporal Cloud; live agents and real containment under the adapter; any reliability benefit over the local journal |
| Publication | Git push of an exact evidence commit to a non-default review branch | Graph and job deliveries | Fixture-tested against local bare origins | Opening a merge request on a forge |

## A2A in detail

The external task contract is the [delegation record](../../schema/contained-graph-delegation-v1.schema.json)
plus these outcomes, each exercised by `packages/application/test/graph-delegate.test.ts`
against the reference peer:

| Case | Documented outcome |
| --- | --- |
| The peer completes with one in-scope patch | `returned`; a check verifies it afresh |
| The peer is unreachable | Refused before sending; the node stays reserved |
| The Agent Card differs from the pinned digest | Refused before sending |
| The card changes by completion | `unavailable` |
| The peer ends the task failed, rejected or needing input | `failed` |
| The peer answers with a message and no task | `failed` |
| The declared timeout passes | One `CancelTask`; `canceled` |
| The peer cancels | `canceled` |
| No artifact, several, a wrong media type, not a patch, or a patch outside scope | `unavailable`, with the reason |
| A run interrupted after sending | Reconciled by reading the retained task id; never re-sent |
| A repeated terminal response | Recorded once |

Neither an Agent Card nor a completion state grants anything. A peer is
allowlisted only by being pinned in an approved graph. See
[external tasks](GRAPHS.md) for the graph rules.
