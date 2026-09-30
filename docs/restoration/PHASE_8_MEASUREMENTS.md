# Platform interfaces baseline — 30 September 2026

Measured on the phase 7 source before any A2A code existed. This record is read
from the source and one compiler probe. It does not qualify an interface.

## What Wringer exercises today

`scripts/restoration-phase8-measure.ts` reads the interfaces from the source.

| Interface | Measured | Reading |
| --- | --- | --- |
| ACP client | `initialize`, `authenticate`, `session/new`, `session/prompt`, `session/cancel`, `session/close`, mode and option setting; it handles `session/update` and permission requests | It advertises no file or terminal capability, so an agent works only with its own tools inside the contained runtime |
| MCP assistant tools | 18 tools, none of which approves, records a verdict, sends, merges or adopts | Inspection, proposal, starting approved work and handover preparation only |
| Runtimes | Apple Container and gVisor on Kubernetes | Declared in the plan contract |
| Model | Chosen by the agent command and its declared credential names | The harness names no model |
| Identity | An actor string on grants, decisions and Sends | Recorded, not authenticated |
| Gateway, memory | None | No agent state persists between sessions except the repository and retained evidence |

## What an external task needs

No A2A client exists, and the graph compiler refuses an external task node with
"Unsupported graph node kind". An external agent's result has no route into a
graph, and nothing could tell it apart from a locally contained agent.

The pinned protocol is A2A 1.0, read from its specification on 30 September 2026:

- JSON-RPC methods `SendMessage`, `GetTask` and `CancelTask`;
- an `A2A-Version` header on every request;
- the Agent Card at `/.well-known/agent-card.json`;
- task states from `TASK_STATE_SUBMITTED` to `TASK_STATE_REJECTED`;
- error codes such as -32001 for an unknown task and -32002 for a task that
  cannot be cancelled.

## The chosen integration

Delegate one bounded source change to an external A2A agent that returns a patch
artifact. Apply it to the exact input source in controller storage. Verify it
afresh in a contained verifier before anything can hold, route or deliver it.

| Case | Expected outcome |
| --- | --- |
| The peer completes with one patch artifact | A candidate owned by the delegation, checked afresh by a following check node |
| The peer is unreachable before sending | Refused in preflight; nothing sent; the node stays reserved |
| The Agent Card differs from the pinned digest | Refused before sending; a card that changes by completion makes the outcome unavailable |
| The peer reports failed, rejected, or input or authentication required | `failed`, carrying the peer's state, with no candidate |
| The peer cancels, or the declared timeout passes | One `CancelTask`; `canceled`, with no candidate |
| A repeated terminal response | The first terminal state is recorded once |
| A missing, extra, mistyped, non-patch, out-of-scope or non-applying artifact | `unavailable` with a named reason, with no candidate |
| A crash after sending, before the task id is retained | `uncertain`; never re-sent |

## Design inputs

1. A version 4 graph adds a `delegate` node that pins the peer's endpoint, the
   digest of its Agent Card and the skill it asks for. The approved plan is the
   allowlist: the endpoint and card cannot change without a new grant.
2. The delegate also pins a verification plan. The patch may touch only that
   plan's writable scope and none of its protected paths.
3. A delegate's candidate can be read only by a check node, which verifies it
   afresh with that plan. An Agent Card or a completion claim never grants access
   and never counts as acceptance.
4. One external task counts as one role session in the graph's allowance.
5. External delegation stays distinct from a locally contained ACP agent: a
   separate node kind, record and evidence path.

## Not measured

Any real A2A peer. A local reference peer can establish only fixture conformance.
Interchangeability needs two independent implementations passing the same
contract.

# Implementation — 30 September 2026

The design follows the inputs above.

## What was built

- **Version 4 graphs.** The compiler accepts a `delegate` node that pins an A2A
  peer by endpoint and Agent Card digest, an instruction, a verification plan on
  the graph's source and a timeout of at most a day. A plain HTTP endpoint other
  than loopback, credentials in the URL, a delegate inside a branch, and any node
  other than a check or router reading its candidate before a check are refused.
- **Kernel.** Only a `returned` delegation carries a candidate, owned by the
  delegate; the other outcomes carry none. Version 1 to 3 graphs are unchanged.
- **A2A client.** Bounded JSON-RPC over HTTP with the `A2A-Version` header, no
  redirects, a 1 MiB response limit and a deadline on every call. The card is
  read from `/.well-known/agent-card.json` and pinned by its canonical digest.
- **Delegation driver.** Preflight checks the base source and the card. Dispatch
  records the request and then the task id, polls to a terminal state, sends one
  cancellation at the deadline, applies the one returned patch in controller
  storage within scope, and re-checks the card. Observation reconciles a retained
  task id by reading it.
- **Evidence.** The export carries each delegation record, bound to the recorded
  result; the Node reader checks it. A delivery of a delegated candidate carries
  the graph's own export.
- **Interfaces.** A new page lists every boundary Wringer exercises, its contract,
  evidence level and what is pending.

## Reversions

`scripts/restoration-phase8-reversions.ts` removes each guard alone in an isolated
copy. All 27 went red and were restored: a refusal vanished in 14 and recorded
state changed in 13 ([record](evidence/phase-8/reversions.json),
[effects](evidence/phase-8/effects.json)). Four guards are listed as layered or
unmeasured, including a peer redirect or over-large response, which the
reference peer never produces.

The first reversion run stopped at its isolated control: the
[reconciliation test failed there](evidence/phase-8/initial/reversion-control-flaky-resume.log).
It assumed one resume would find the task finished, but a resume reads the task
once, and whether the peer had finished depended on timing. The product was
right: a still-working task stays uncertain. The test now resumes until the
task ends and checks at each step that nothing is sent again.

## Measurement errors retained

The compiler, kernel and driver were written before their tests; the reversion
checks below are their red evidence. The adapter tests'
[first run](evidence/phase-8/initial/adapter-first-run.log) passed seven of eight;
the eighth failed because the Node reader did not yet read version 4 exports.
The packaged walkthrough passed on its first run.
