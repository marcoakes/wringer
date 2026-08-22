# Vendors — what has been MEASURED, per vendor, per lane

Wringer works with **any coding agent you can start from a terminal, and any
model behind an OpenAI-compatible endpoint.** That is a structural fact about
this repository, not a partnership: the worker contract is a shell command or
an ACP agent, and the engine talks to a model through exactly one
chat-completions POST. Nothing in the engine branches on a vendor's name, and
nothing defaults to one.

This page is the receipt. **A row says only what somebody ran.**

## The two lanes

| lane | what it is | how a vendor plugs in |
|---|---|---|
| **brain** | the model that drafts the spec from a PRD and judges the rubric | `judge.endpoint` + `judge.model` + `judge.api_key_env` in `.wringer.yaml` |
| **worker** | the coding agent that does the building | `run.worker` — a shell command, or `acp:` for an agent that speaks the Agent Client Protocol |

## The four statuses, and nothing else

| status | what it means |
|---|---|
| `MEASURED-WORKING` | somebody ran it and it worked. The capture is linked, and the linked file exists in this repository — a guard checks both. |
| `BLOCKED-ON-CREDENTIAL` | the route was measured up to the credential and no further. Nobody here holds a key for this vendor. |
| `BLOCKED-ON-AUTH-ROUTE` | the route needs an interactive login, which is a person's act and not a machine's. |
| `NO-AGENT-CLI` | this vendor shipped no coding-agent CLI of its own on the date named. |

There is no "supported" and no "coming soon". A cell that cannot be one of
those four is a cell nobody measured.

## The matrix

Alphabetical by vendor. **No vendor is listed above any other**, and a guard
enforces the order so nobody can quietly promote one.

| vendor | lane | status | measured | capture |
|---|---|---|---|---|
| anthropic | brain | MEASURED-WORKING | 2026-08-22 | [bench-vendors-2026-08-22.md](bench-vendors-2026-08-22.md) |
| anthropic | worker | MEASURED-WORKING | 2026-08-22 | [auth-probe-2026-08-22.md](auth-probe-2026-08-22.md) |
| deepseek | brain | BLOCKED-ON-CREDENTIAL | 2026-08-22 | [bench-vendors-2026-08-22.md](bench-vendors-2026-08-22.md) |
| deepseek | worker | NO-AGENT-CLI | 2026-08-22 | [bench-vendors-2026-08-22.md](bench-vendors-2026-08-22.md) |
| glm | brain | BLOCKED-ON-CREDENTIAL | 2026-08-22 | [bench-vendors-2026-08-22.md](bench-vendors-2026-08-22.md) |
| glm | worker | NO-AGENT-CLI | 2026-08-22 | [bench-vendors-2026-08-22.md](bench-vendors-2026-08-22.md) |
| kimi | brain | BLOCKED-ON-CREDENTIAL | 2026-08-22 | [bench-vendors-2026-08-22.md](bench-vendors-2026-08-22.md) |
| kimi | worker | BLOCKED-ON-AUTH-ROUTE | 2026-08-22 | [bench-vendors-2026-08-22.md](bench-vendors-2026-08-22.md) |
| openai | brain | BLOCKED-ON-CREDENTIAL | 2026-08-22 | [bench-vendors-2026-08-22.md](bench-vendors-2026-08-22.md) |
| openai | worker | BLOCKED-ON-CREDENTIAL | 2026-08-22 | [bench-vendors-2026-08-22.md](bench-vendors-2026-08-22.md) |

**Read the capture before reading a status.** Two rows say
`BLOCKED-ON-CREDENTIAL` for quite different reasons — openai's worker got as
far as proving which environment variable the CLI actually reads, and glm's
brain got as far as a well-formed authentication refusal from the documented
endpoint. Neither is a guess and neither is a working row.

## Your key, whichever vendor you chose

**One convention, and it is the same shape for every vendor.** Store the key
in your Mac's Keychain under `-s <vendor>-api-key`, and read it INLINE into
the command that needs it. Wringer never stores a key, and no agent driving
Wringer should ever see one.

```bash
security add-generic-password -U -s deepseek-api-key -a wringer -w
```

That prompts for the value with no echo; nothing lands in your shell history.
Swap `deepseek` for whichever vendor you chose.

| vendor | Keychain service | brain lane: the variable Wringer reads | worker lane: the variable the AGENT reads |
|---|---|---|---|
| anthropic | `anthropic-api-key` | whatever `judge.api_key_env` names (`WRINGER_API_KEY` by convention) | `ANTHROPIC_API_KEY` |
| deepseek | `deepseek-api-key` | whatever `judge.api_key_env` names (`WRINGER_API_KEY` by convention) | — no agent CLI |
| glm | `glm-api-key` | whatever `judge.api_key_env` names (`WRINGER_API_KEY` by convention) | — no agent CLI |
| kimi | `moonshot-api-key` | whatever `judge.api_key_env` names (`WRINGER_API_KEY` by convention) | `KIMI_API_KEY` (shell form); the ACP form wants `kimi login` |
| openai | `openai-api-key` | whatever `judge.api_key_env` names (`WRINGER_API_KEY` by convention) | `CODEX_API_KEY` — **and `OPENAI_API_KEY` does NOT work, measured** |

**The brain-lane column is the same sentence five times, and that is the
point.** Wringer does not know which vendor is behind `judge.endpoint`; it
reads the variable your config names. The vendor-specific column is the
WORKER's, because a coding agent reads its own variable and Wringer does not
get a vote.

**How the key crosses the boundary.** For an `acp:` worker, name the variable
in `run.worker.acp.env_passthrough` — the declared act, recorded in the run.
For a SHELL worker there is no passthrough and none is needed: the worker
inherits the environment you launched from (`gates.py:191`), so export it
there, or list it in the containment env allowlist when containment is on.

## The endpoints and models, from each vendor's own documentation

Read on 2026-08-22 from the vendor's current docs, never from recall. A model
name nobody could verify from official docs is not printed here.

| vendor | OpenAI-compatible endpoint | model measured |
|---|---|---|
| anthropic | `https://api.anthropic.com/v1/chat/completions` | `claude-opus-5` |
| deepseek | `https://api.deepseek.com/chat/completions` | `deepseek-v4-pro` |
| glm | `https://api.z.ai/api/paas/v4/chat/completions` | `glm-5.3` |
| kimi | `https://api.moonshot.ai/v1/chat/completions` | `kimi-k3` |
| openai | `https://api.openai.com/v1/chat/completions` | `gpt-5.2` |

## The worker commands, in the two forms the engine has

Nothing here is a default. These are the commands an operator writes down;
`wringer-drive` offers them as examples and still makes the person answer.

| vendor | form | `run.worker` |
|---|---|---|
| anthropic | ACP | `acp: claude-agent-acp` |
| kimi | ACP | `acp: kimi acp` |
| kimi | shell | `kimi --print --output-format stream-json` |
| openai | shell | `codex exec --json -` |
| openai | shell, zero-auth | `codex exec --json --oss --local-provider ollama -` |

## Measure it yourself

```bash
python3 scripts/vendor-brain-probe.py
```

No key needed: it posts to every vendor's documented endpoint with a dummy
credential and reports the vendor's own refusal. Add a real one in
`WRINGER_PROBE_KEY` to send one minimal turn instead.

```bash
python3 scripts/acp-auth-probe.py "kimi acp"
```

The handshake only — it never sends the paid call unless you add `--prompt`.

## What this page does not claim

- A `MEASURED-WORKING` brain row means one turn was answered. It says nothing
  about the quality of that vendor's drafting or judging, which is what
  `wring bench` is for and which nobody has run across vendors yet.
- A `BLOCKED-ON-CREDENTIAL` row is not a prediction that a real key will
  work. It records how far the route was followed and where it stopped.
- Nothing about a vendor's presence here relaxes a gate, a refusal, or the
  record. A worker is the same untrusted thing whoever built it.
