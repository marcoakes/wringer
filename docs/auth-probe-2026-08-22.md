# The auth probe of 2026-08-22 — the turn nobody had sent

Three field runs inferred the wall's name. Nobody had ever sent
`session/prompt`. This is that measurement.

Agent: `claude-agent-acp` 0.70.0, wrapping `@anthropic-ai/claude-agent-sdk`
0.3.232 (Claude Code CLI 2.1.232). Probe: `scripts/acp-auth-probe.py --prompt`.

## The free surface nobody had looked at

`claude-agent-acp --cli` spawns the real Claude Code CLI (`dist/index.js`
forwards every argument to `claudeCliPath()`). That CLI has an auth surface,
and it is machine-readable and free:

    $ claude-agent-acp --cli auth status
    {"loggedIn": false, "authMethod": "none", "apiProvider": "firstParty"}

**`loggedIn: false`.** The coding agent's CLI on this machine has never been
logged in, and no Wringer page has ever told anyone to log it in. Under
`HOME=$(mktemp -d)` it reports the same. With `ANTHROPIC_API_KEY` in the
environment it reports:

    {"loggedIn": true, "authMethod": "api_key", "apiProvider": "firstParty",
     "apiKeySource": "ANTHROPIC_API_KEY"}

## The three prompt runs

| run | environment | `session/new` | `session/prompt` | route |
|---|---|---|---|---|
| 1 | uncontained, as the user | opened | **refused** `-32000 Authentication required` | `apiType=native` |
| 2 | `HOME` = empty dir | opened | **refused** `-32000 Authentication required` | `apiType=native` |
| 3 | `ANTHROPIC_API_KEY` in child env | opened | **ANSWERED** `stopReason: end_turn` | `apiType=native` |

Run 3's usage: 2 input, 4 output, 16141 cached-read, 5835 cached-write
tokens. The verbatim captures are below, exactly as the script printed them.

## What this proves, and what it does not

**Proved by execution.** A worker turn through this adapter succeeds on the
native route when a credential is present. The wall was a missing credential,
not a missing route. `ANTHROPIC_API_KEY` in the worker's environment IS a
working credential.

**Falsified.** Three sentences shipped on 2026-08-22 in
`docs/drive/AGENTS.md`:

1. *"Do not tell anyone to pass `ANTHROPIC_API_KEY` through … It does not
   work."* — it works. Run 3.
2. *"The adapter never reads `ANTHROPIC_API_KEY` as a credential … when a
   provider IS configured the adapter deliberately BLANKS it."* The second
   half is true and the conclusion drawn from it is not:
   `createEnvForProvider` opens `if (!config) { return {}; }`
   (`dist/acp-agent.js:5323`). Wringer configures no provider, so the branch
   that blanks the variable is the branch Wringer never takes. The variable
   passes through untouched to the CLI, which reads it. A conditional was
   written down as an absolute.
3. *"a machine whose Claude Code is signed in by subscription cannot
   currently be driven through this adapter by Wringer."* The reasoning that
   produced it is dead. See the limit below before replacing it.

**Not reproduced.** Field-report finding 6 claimed `env_passthrough`
DEGRADED the failure from `session/prompt … Authentication required` to
`session/new … Internal error`. Run 3 is that configuration and `session/new`
opened cleanly. Recorded as not reproduced, not as fixed — the evaluator saw
something, and this run does not explain what.

**The honest limit.** This machine's coding-agent CLI is not subscription-
signed-in, so no run here measures the subscription credential specifically.
Run 1 was refused, but its premise ("as the signed-in user") was false, so it
does not decide the subscription question either way. What run 3 settles is
the general claim the subscription sentence rested on: native auth CAN serve
an SDK-driven turn. Anyone wanting the subscription answer must log the CLI
in once (`claude-agent-acp --cli auth login --claudeai`, an interactive act)
and re-run `--prompt`.

## The captures, verbatim

### Run 1 — uncontained, as the signed-in user

```
agent                  "claude-agent-acp"
authMethods_present    true
authMethods            []
session_new_opened     true
session_new_is_error   false
session_new_error      null
stderr_tail            "/.local/lib/node_modules/@agentclientprotocol/claude-agent-acp/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs:118:21828)\n    at ClaudeAcpAgent.closeQueryStream (file:///Users/marc/.local/lib/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js:3677:23)\n    at ClaudeAcpAgent.runConsumer (file:///Users/marc/.local/lib/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js:3415:22)\n    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)\n"
prompt_sent            true
prompt_answered        false
prompt_is_error        true
prompt_error           {"code": -32000, "message": "Authentication required"}
prompt_transport       null
prompt_result          null
stderr_apiType_lines   ["[session/query] sessionId=db917d2a-f5b1-4808-93dc-d5961a229b2d resume=none apiType=native baseUrl=native"]
```

### Run 2 — `HOME` pointed at an empty directory

```
agent                  "claude-agent-acp"
authMethods_present    true
authMethods            []
session_new_opened     true
session_new_is_error   false
session_new_error      null
stderr_tail            "/.local/lib/node_modules/@agentclientprotocol/claude-agent-acp/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs:118:21828)\n    at ClaudeAcpAgent.closeQueryStream (file:///Users/marc/.local/lib/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js:3677:23)\n    at ClaudeAcpAgent.runConsumer (file:///Users/marc/.local/lib/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js:3415:22)\n    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)\n"
prompt_sent            true
prompt_answered        false
prompt_is_error        true
prompt_error           {"code": -32000, "message": "Authentication required"}
prompt_transport       null
prompt_result          null
stderr_apiType_lines   ["[session/query] sessionId=af02aec4-88df-4dda-8bd2-e4eb991b9f36 resume=none apiType=native baseUrl=native"]
```

### Run 3 — `ANTHROPIC_API_KEY` in the child environment

```
agent                  "claude-agent-acp"
authMethods_present    true
authMethods            []
session_new_opened     true
session_new_is_error   false
session_new_error      null
stderr_tail            "[session/query] sessionId=069dba5c-d719-4b8b-986c-cdd56185cda0 resume=none apiType=native baseUrl=native\nUnexpected case: {\"type\":\"system\",\"subtype\":\"post_turn_summary\",\"summarizes_uuid\":\"080f0d18-0fcb-441f-a155-d07ba35a96a6\",\"status_category\":\"review_ready\",\"status_detail\":\"starting work\",\"needs_action\":\"\",\"uuid\":\"ca54bcd7-8fcf-4f07-b710-e3ff1362bb88\",\"session_id\":\"069dba5c-d719-4b8b-986c-cdd56185cda0\"}\n"
prompt_sent            true
prompt_answered        true
prompt_is_error        false
prompt_error           null
prompt_transport       null
prompt_result          {"stopReason": "end_turn", "usage": {"inputTokens": 2, "outputTokens": 4, "cachedReadTokens": 16141, "cachedWriteTokens": 5835, "totalTokens": 21982}}
stderr_apiType_lines   ["[session/query] sessionId=069dba5c-d719-4b8b-986c-cdd56185cda0 resume=none apiType=native baseUrl=native"]
```

Reproduce with `python3 scripts/acp-auth-probe.py --prompt claude-agent-acp`.
Without `--prompt` the script is handshake-only and sends no paid call.
