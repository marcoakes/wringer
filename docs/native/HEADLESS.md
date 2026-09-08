# One bounded run without repeated permission questions

For the assistant-led entry point, start with
[ASSISTANT_START.md](../../ASSISTANT_START.md). Its engineering preview uses a
local execution owner separate from the MCP conversation; closing that
conversation is not a new grant. This does not imply automatic restart at login,
operation during machine sleep, a measured named-client journey or protection
from another program with the same OS permissions. Protected assistant mode is
unavailable, not silently replaced by cooperative-local execution.

`wringer-drive` is the production controller. `wringer-headless` is an alias for that same contained driver, with the same plan, authority and runtime requirements. It is not a host-Codex launcher and does not provide a weaker route around isolation.

There are still distinct boundaries: the operator's authority for this job, the runtime's enforced access, and the agent's own authentication/permission behavior. A request to work unattended does not erase any of them.

## Prepare once

Build from the repository root and put `dist/` on the current shell's `PATH`, as described in the [guide](README.md). Provision the selected Apple Container or gVisor Kubernetes environment and the declared ACP agents. The controller will not install an agent, sign in, mount your home directory or silently run it on the host.

Author a strict YAML or constrained TypeScript plan. It must name the pinned repository, intent, acceptance, runtime, separate agent roles and finite budgets. Keep the controller's state outside the target repository clone.

## Compile, authorize, run

The uppercase fields below are placeholders you choose: `PLAN.yaml` is your plan, `YOUR NAME` is the operator, `EXPIRY_IN_ISO_8601` is a future expiration timestamp, and the authority/state paths belong to the controller. Do not paste the placeholders unchanged and expect a valid plan or grant.

```sh
wringer-drive plan PLAN.yaml
wringer-drive authority PLAN.yaml --actor 'YOUR NAME' --expires 'EXPIRY_IN_ISO_8601' --output AUTHORITY.json
wringer-drive run PLAN.yaml --authority AUTHORITY.json --state CONTROLLER_STATE
```

The first command compiles and displays the exact plan/digest without spending. Review it before the second command explicitly grants authority tied to that plan's acceptance and budgets. The run does not ask you to approve each ordinary engineering action again.

After interruption, keep the same controller state and authority:

```sh
wringer-drive resume --state CONTROLLER_STATE --authority AUTHORITY.json
```

Use `.ts` instead of `.yaml` only for the constrained plan form, not a general program. Resume does not acquire new authority, reset budgets, or silently repeat an uncertain paid action. Follow any printed recovery instruction and preserve the whole stop if recovery cannot proceed.

`wringer-drive status --state CONTROLLER_STATE` validates and reads that journey's
authoritative journal without starting another agent session. A printed
`--retry-stopped` route retries a known stopped role within the remaining budget.
`--retry-uncertain` is a separate acknowledgement that an interrupted agent
request may already have spent; it is not an automatic retry policy.

`--retry-verification` explicitly reserves a new attempt after a known unavailable
verification; `--retry-judge` re-enters an unsettled independent review. Neither
resets the whole-journey ceilings. When a dead board process retained application
ownership, the workspace prints `recover-command` with the real command UUID and
`--acknowledge-uncertain`. That command releases only the application lock after
checking the owner is dead. Orphan runtimes and domain reservations remain;
follow the subsequently offered domain recovery action, never delete state.

### When the grant is spent, or planning has questions

`wringer-drive status --state CONTROLLER_STATE` also understands planning-only
state. `planning-status` and `planning-questions` show the retained questions,
note and remaining planning allowance without keys, a container or a model call.
A stopped grant is not renewed by `resume`, and `--retry-uncertain` refuses when
no current attempt is genuinely unresolved.

The following previews are read-only (replace the state placeholders):

```sh
wringer-drive planning-new-grant --state PLANNING_STATE
wringer-drive new-grant --state CONTROLLER_STATE
```

Each explains the next explicit approval and retains the old history and cost
unknowns. Planning questions need answers in a revised intent file before a new
planning grant. Confirmation may start another paid planning attempt. A confirmed
execution grant creates fresh state but does not itself start agents; its later
run starts from the originally approved baseline, not an implied free continuation
of the prior candidate. A changed contract requires compiling and approving its
new digest. Neither route supplies human judgement or publication approval.

An authentication-rejected worker or unchanged source stops automatic retries.
Inspect the recorded provider diagnostic and existing credential setup before
an explicit bounded retry. An absent tool-call event does not prove zero tools
ran, and successful ACP transport does not prove successful development.

The equivalent alias is:

```sh
wringer-headless run PLAN.yaml --authority AUTHORITY.json --state CONTROLLER_STATE
```

For developers running the source helper, use `bun run scripts/headless.ts` followed by those same driver arguments. The retired `--task`/`--api-key-service` host-Codex helper is not part of this route.

## Finish the same contained journey

Use the recorded controller state throughout. Open the live PM workspace with
`wringer-drive board --state CONTROLLER_STATE` (also `wringer-board serve
--state CONTROLLER_STATE`). It offers the same guarded application actions as
the CLI: show, review, request revision, bounded recovery, preview and separately
confirmed publication. A stale/disconnected board cannot approve old source.
The private URL grants local control; do not share it. A static `--output` file
has no active controls. `wringer-drive doctor --state CONTROLLER_STATE` reads
this run's last verification; bare `wring doctor` remains the legacy reader.

If a human criterion is waiting, the person must inspect its real display:

```sh
wringer-drive show --state CONTROLLER_STATE --criterion HUMAN_CRITERION_ID
wringer-drive review --state CONTROLLER_STATE --criterion HUMAN_CRITERION_ID --display DISPLAY_UUID --verdict met --by 'YOUR NAME' --note 'YOUR OWN OBSERVATION'
wringer-drive resume --state CONTROLLER_STATE
wringer-drive status --state CONTROLLER_STATE
```

Replace the criterion and display placeholders with the actual IDs. Use
`not_met` for an objection. A failed/missing display refuses recording; there is
no contained `--without-display` bypass. Skip this step if the plan has no human
criterion. Delegation does not make a machine's opinion a person's observation.

When the validated state is review-ready, choose the remote and branches and
preview delivery. The uppercase values below are operator choices:

```sh
wringer-drive deliver --state CONTROLLER_STATE --remote REMOTE_URL_OR_BARE_PATH --source-branch NEW_REVIEW_BRANCH --target-branch TARGET_BRANCH
wringer-drive deliver --state CONTROLLER_STATE --remote REMOTE_URL_OR_BARE_PATH --source-branch NEW_REVIEW_BRANCH --target-branch TARGET_BRANCH --send
```

Only the second command authorizes the push. It does not authorize a merge or
deployment. For a hosted pull/merge request, add the same `--forge-config
FORGE.json` on both calls. That file declares `kind` (`github` or `gitlab`), the
API `endpoint`, repository `repo`, and credential variable `token_env`; it must
not contain a key value. Push and hosted-request outcomes are separate, and an
uncertain hosted request is reconciled before another create is considered.

Clone the chosen remote into a fresh directory and check out the printed review
branch. From that clone root, run the exact command in its `mr.md`:

```sh
wringer-drive audit --bundle .wringer/deliveries/REAL_DELIVERY_ID
```

Use the real ID, not this placeholder. The audit is offline and checks the
carried source/authority/check/review records; it does not rerun the software or
prove live isolation. Then use the real falsification command printed beside it:

```sh
wringer-drive falsify --bundle .wringer/deliveries/REAL_DELIVERY_ID
```

Falsification needs the declared isolated verifier on this machine or cluster,
but calls no coding/judging agent. It challenges supported committed-line
mutations under explicit bounds (24 attempts and 60 seconds by default), naming
the source range, commit and caught/survived/unavailable results. Optional
`--max-attempts`, `--wall-seconds` and `--output` control that bounded measurement.
An unavailable runtime or failed control is inconclusive, not a pass; this is
not a full mutation analysis or correctness proof. Do not apply standalone
`wring deliver` or `wring verify --falsify --delivery` to this different format.

## Reuse the credentials you already have

Plans name environment variables or runtime-managed secret references, never key values. Retrieve an existing key into the launching environment only if the selected agent/runtime needs that variable. Do not re-store it merely because a run stopped.

On macOS the controller automatically reads an existing `wringer` account item
when a declared role needs `CODEX_API_KEY` / `OPENAI_API_KEY` (service
`openai-api-key`) or `ANTHROPIC_API_KEY` (service `anthropic-api-key`). An existing
launching-shell value takes precedence. Values stay in memory and are not
printed, stored in plans or replaced. Run `wringer-drive doctor --plan PLAN.yaml`
to see availability and its source without exposing the value.

For an operator who already uses macOS Keychain services `anthropic-api-key` or `openai-api-key` under account `wringer`, these retrieval commands read existing items; they do not create or replace them:

```sh
export ANTHROPIC_API_KEY="$(security find-generic-password -s anthropic-api-key -a wringer -w)"
export CODEX_API_KEY="$(security find-generic-password -s openai-api-key -a wringer -w)"
```

Use only the variable actually supported by your declared ACP agent and list it in the allowed runtime/agent environment. These examples are not a claim that every adapter accepts those names. They select no model and do not authenticate an agent. On Kubernetes, use the declared secret-reference route when required by runtime policy. Never place secret values in YAML, arguments, captures or chat.

For the pinned `@agentclientprotocol/codex-acp` 1.10.0 adapter, a key-only
agent declaration also needs `authMethod: api-key`. The adapter reads
`CODEX_API_KEY` during that non-interactive handshake; it creates no host login.
For `claude-agent-acp` 0.65.0 with `ANTHROPIC_API_KEY`, leave `authMethod`
omitted: its SDK reads the environment key and it does not implement an
`api-key` ACP authentication method. A completed handshake or opened session
does not prove either provider will accept or bill the key. These are
[Codex adapter](https://github.com/agentclientprotocol/codex-acp/blob/v1.10.0/src/CodexAcpClient.ts#L177)
and [Claude adapter](https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.65.0/src/acp-agent.ts#L1633)
version-specific settings, not a universal ACP authentication convention.

macOS may still ask whether a process may access a protected Keychain item. Wringer cannot override that decision, provider authentication, cluster administration, or host-managed policy. Provision the permitted access once rather than turning each stopped run into another key-entry exercise.

Do **not** use `security add-generic-password ... -w` with no value to enter a
new long API key. Blind test 2 reported that this hidden prompt truncated the
project key to 128 characters. The earlier recipe on this page was wrong for
that run. Supplying the key as a command argument is not our replacement: it can
expose the value in process arguments, even if shell history hides it.

If an item is genuinely missing, provision a generic password through macOS
Keychain Access: service/item name `anthropic-api-key` or `openai-api-key`, account
`wringer`, and the complete key in the password field. Do not replace an existing
item just to retry a run. This is one-time operator setup, not a coding-app tool;
keep the password display hidden and out of screen captures. Keychain Access and
the Passwords app are different surfaces; see [Apple's Keychain Access guide](https://support.apple.com/guide/keychain-access/welcome/mac).

For a temporary launching-shell value instead of storage, an operator can use
this **zsh** hidden prompt in a private Terminal. Choose only the needed vendor;
enter the value when prompted, never in the coding app's chat or command text:

```zsh
set +x
if read -rs 'CODEX_API_KEY?OpenAI API key (hidden): '; then
  export CODEX_API_KEY
else
  unset CODEX_API_KEY
fi
printf '\n'
```

For Anthropic, replace both occurrences of `CODEX_API_KEY` above and the `unset`
name with `ANTHROPIC_API_KEY`, and use that vendor's key. This stores nothing in
Keychain and applies only to that shell and its children. Launch the owner from
that shell; another already-running owner does not inherit the value. Neither
route has been re-measured with a new real key during this repair pass; existing
working keys were left untouched.

The vendor-specific variable must be supported by the selected adapter; neither
key presence nor ACP session creation proves effective provider authentication.
`wringer-drive doctor --plan PLAN.yaml --probe-agents` opens contained ACP
sessions **without sending a model prompt** and reports that precise limit.

## What remains a real stop

- The required runtime cannot establish the declared isolation or network policy.
- An agent is absent, unauthenticated, refuses a tool, or cannot complete within its ceiling.
- The plan/acceptance changed, authority expired, or an interrupted side effect is unresolved.
- A criterion genuinely requires the person's observation.
- Remote publication has not been explicitly authorized.

The remedy is the recorded next action, not a host fallback, a larger hidden budget or an invented human note. Routine authority can carry ordinary work; only a person can supply a person's observation.

## Read the actual outcome

Keep the controller's frozen plan/authority, sequenced events, runtime/session provenance, reservations, resulting source identity and stop/result records. Usage is reported when known, not priced by guesswork. No receipt is a promise that a live model will converge.

Apple/gVisor protocol fixtures do not establish live isolation. Before a valuable unattended workload, require the platform-specific boundary and cancellation/cleanup tests. [Architecture](ARCHITECTURE.md) explains the separation; the [historical alpha.1 report](IMPLEMENTATION_REPORT.md) documents an earlier helper and must not be followed as current setup.
