# One bounded run without repeated permission questions

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

The equivalent alias is:

```sh
wringer-headless run PLAN.yaml --authority AUTHORITY.json --state CONTROLLER_STATE
```

For developers running the source helper, use `bun run scripts/headless.ts` followed by those same driver arguments. The retired `--task`/`--api-key-service` host-Codex helper is not part of this route.

## Finish the same contained journey

Use the recorded controller state throughout. The standalone `wringer-board`
and `wring doctor` readers do not read contained journey state.

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

For an operator who already uses macOS Keychain services `anthropic-api-key` or `openai-api-key` under account `wringer`, these retrieval commands read existing items; they do not create or replace them:

```sh
export ANTHROPIC_API_KEY="$(security find-generic-password -s anthropic-api-key -a wringer -w)"
export CODEX_API_KEY="$(security find-generic-password -s openai-api-key -a wringer -w)"
```

Use only the variable actually supported by your declared ACP agent and list it in the allowed runtime/agent environment. These examples are not a claim that every adapter accepts those names. They select no model and do not authenticate an agent. On Kubernetes, use the declared secret-reference route when required by runtime policy. Never place secret values in YAML, arguments, captures or chat.

macOS may still ask whether a process may access a protected Keychain item. Wringer cannot override that decision, provider authentication, cluster administration, or host-managed policy. Provision the permitted access once rather than turning each stopped run into another key-entry exercise.

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
