# Assistant preview: compatibility and claim gates

This page separates an implemented interface from an observed user experience.
The [starting page](../ASSISTANT_START.md) is a cooperative-local engineering
preview. It is not a production launch, a clean-machine result or a passed PM
blind test.

## Client compatibility

| Candidate | Current status | Evidence required before calling it supported |
| --- | --- | --- |
| Codex | First documented STDIO connection candidate; complete PM journey unmeasured | Exact app/CLI version, generated connection, setup, tool permissions, disconnect/reconnect, real review, delivery and audit |
| Claude Code | Unmeasured front end | Independent measurements of the same journey; Claude as an ACP worker is not this measurement |
| Kimi | Exact front-end product/version and connection route unmeasured | Establish the actual client and supported transport, then measure the complete journey |

The adapter's protocol and fixture tests are not a named-client compatibility
badge. An app listing the tools does not prove that it interprets refusals,
respects required human decisions or resumes without repeated work. Record the
MCP version, front-end version and ACP agent/runtime version separately.

## What the preview is for

- Exercise an inert proposal followed by explicit bounded approval, then have
  the assistant use the same application services as CLI and board.
- Measure durable operation identity, duplicate-request protection, status,
  cancellation, interruption and recovery without paid agents first.
- Test that the narrow assistant contract excludes authority creation, human
  verdicts, secret retrieval, arbitrary commands and publication.
- Identify PM wording, setup and review problems before a separate live test.

The implementation's validation record must give exact counts, commands and
commit. Do not infer a test pass from this list of intended measurements.

## Claims that remain unavailable

| Claim | Why it is not claimed |
| --- | --- |
| “The assistant cannot approve for you” | The same-user OS and human-presence boundary is not established; protected mode refuses |
| “No technical setup” | A real contained plan/profile and runtime still require operator preparation |
| “Automatically handles every later task” | The root pins one source/profile and destination; it does not advance source or allocate new delivery branches automatically |
| “Works with Codex, Claude and Kimi” | Named-client end-to-end measurements are not complete |
| “Runs through sleep and reboot” | No automatic login/reboot service is installed; downtime consumes elapsed-time/expiry limits |
| “Never exceeds your cash budget” | Session/time limits do not bound every provider charge; unsupported strict-cash requests refuse |
| “Free coordination” or “lower total cost” | The coding app uses its own account; unknown billing prevents an exact savings claim |
| “A successful blind test” | The original alpha.3 blind run failed; repairs and laboratory tests are separate evidence |
| “Safe production containment everywhere” | Real Apple Container and gVisor enforcement each require their own platform evidence |

“The local execution owner is independent of the MCP connection” describes the
architecture. Stronger reliability statements need the exact measured process
failure and named-client disconnect conditions, not a promise of never stopping.

## Release ledger

The baseline [alpha.3 blind result](PM_BLIND_REPORT_2026-09-08.md) remains FAIL.
The alpha.4 repair checkpoint is separately recorded in that report; it did not
establish assistant integration. Marc authorized the implementation of the
[assistant plan](PM_ASSISTANT_ENTRY_PLAN.md) on 2026-09-08.

The [alpha.5 implementation report](ASSISTANT_IMPLEMENTATION_2026-09-08.md)
records the actual engineering validation and remaining gates. Its fixture
results must not be substituted for the client observations above.

Next evidence must be attached under its own frozen build and
[assistant test protocol](PM_ASSISTANT_BLIND_TEST.md). A builder-operated fixture
can be called a fixture. A cooperative-local PM evaluation can be called that.
Neither is a protected-mode pass or an independent outsider install.

External GitHub About/topics, a package release, promotional demonstration and
named-client support announcement are separate publication decisions after
claim review. The README can put the preview proposition first while keeping
these limitations directly beside its entry point.
