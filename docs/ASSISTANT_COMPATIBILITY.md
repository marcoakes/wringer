# Adoption client compatibility — 1 October 2026

Every client is named with `--client`; none is a default (ruling R-7). A recipe is
a connection, checked against the client's official documentation on
2026-10-01. It is not a measured journey: that column says what was observed.

| Client | Connection | Recipe source | Full journey | Notes |
| --- | --- | --- | --- | --- |
| Claude Code | `wring connect --client claude-code` applies a reviewed project or user entry (`claude mcp add` / `.mcp.json`) | Official docs | Unmeasured for this candidate | Distinct from Claude as an ACP worker |
| Codex CLI 0.153.4 | `wring connect --client codex` applies a reviewed TOML entry | Official docs | Unmeasured for this candidate | Codex desktop is a separate, unmeasured surface |
| Cursor | Printed `mcpServers` entry for `~/.cursor/mcp.json` or `.cursor/mcp.json` | Official docs | Unmeasured | No add command |
| Gemini CLI | Printed `mcpServers` entry for `settings.json` | Official docs | Unmeasured | Its add command is not printed |
| Kimi CLI | Printed `kimi mcp add` command | Official docs | Unmeasured | |
| VS Code | Printed `code --add-mcp` command or `.vscode/mcp.json` (`servers` key) | Official docs | Unmeasured | |
| Windsurf | Generic stanza only | Not verified | Unmeasured | Its MCP documentation could not be checked |
| Generic MCP client | `wring mcp --connection PATH` over STDIO | MCP docs | No named-client claim | No approval, verdict or Send tool |

The worker and judge are chosen separately from the client. A
[trusted-local](native/TRUSTED_LOCAL.md) profile runs them through
`@agentclientprotocol/claude-agent-acp@0.65.0` or
`@agentclientprotocol/codex-acp@1.10.0` on this computer, with nothing contained.

Use [START_AGENT](START_AGENT.md) for preview/apply/remove. Standard scoped config
locations are supported; custom CODEX_HOME/CLAUDE_CONFIG_DIR configurations refuse
rather than writing unused defaults. The client may still require project trust
and reload. These are client decisions, not setup side effects.

The complete live procedure is [LIVE_ACCEPTANCE.md](rebuild/LIVE_ACCEPTANCE.md).
Historical stages remain below; they cannot qualify this changed candidate.

---

## Historical observations (retained)

# Assistant preview: compatibility and claim gates

This page separates an implemented interface from an observed user experience.
The [starting page](../ASSISTANT_START.md) is a cooperative-local engineering
preview. It is not a production launch, a clean-machine result or a passed PM
blind test.

## Client compatibility

| Candidate | Current status | Evidence required before calling it supported |
| --- | --- | --- |
| Codex | CLI 0.153.4 connected and reached live worker/judge completion in blind test 2; review failed and handover was not completed | Repaired full PM journey, including human review, delivery and fresh-clone audit; desktop app remains separately unmeasured |
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
| “Push notifications in every coding app” | The page offers opt-in browser notifications while open; the MCP wait tool is bounded read-only polling, not protocol push |
| “A hosted audit link for every delivery” | The result carries fresh-clone audit instructions; a public review-request URL exists only when that publication is recorded |
| “A successful blind test” | Alpha.3 failed at planning; alpha.6 failed at human review and salvage stopped at preparation; repairs and laboratory tests are separate evidence |
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

The [alpha.6 launch checkpoint](ASSISTANT_LAUNCH_CHECKPOINT_2026-09-08.md) adds
read-only setup diagnosis, preparation from an existing measured profile,
instructions-only maintenance, handover consistency/replay guards and a complete
scripted delivery rehearsal. Codex connection inspection checks the named
command, transport, environment and tool settings; it does not measure client
behavior. Profile preparation does not select a vendor/runtime policy for an
outsider. Protected service integration and real PM/client proof remain open.

The [alpha.6 blind test 2](PM_BLIND_REPORT_2026-09-08_2.md) recorded real Codex
worker and Claude judge completion, but the PM could not record Yes through the
browser. Salvage could not prepare handover. [Alpha.7's repair record](PM_BLIND2_REPAIR_2026-09-08.md)
adds actual browser form regressions and bounded large-history delivery scanning;
it is not a successful live-client end-to-end measurement.

The [guided PM experience checkpoint](PM_GUIDED_EXPERIENCE_2026-09-08.md)
tracks a single private job page, automatic showing/preparation under existing
authority, one source-bound result decision with an optional authored comment,
and a separate Send action to the preset destination. Its implementation and
scripted browser evidence do not clear the named-client, protected-mode or
independent-PM gates. Historical source-inspection findings are not globally
approved by simplifying this interface.

Next evidence must be attached under its own frozen build and
[assistant test protocol](PM_ASSISTANT_BLIND_TEST.md). A builder-operated fixture
can be called a fixture. A cooperative-local PM evaluation can be called that.
Neither is a protected-mode pass or an independent outsider install.

External GitHub About/topics, a package release, promotional demonstration and
named-client support announcement are separate publication decisions after
claim review. The README can put the preview proposition first while keeping
these limitations directly beside its entry point.
