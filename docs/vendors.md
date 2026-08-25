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

## The agents whose vendor is not a model vendor

The matrix above is keyed on VENDOR, and that shape carries an assumption this
page held silently until 2026-08-24: **that a coding agent belongs to the
company whose model it runs.** `dcode` breaks it. LangChain ships the agent,
ships no model, and the credential the agent wants is somebody else's. There
is no honest cell for it in the matrix — LangChain has no brain lane at all,
and inventing a status for a lane a vendor does not have is the inflation this
page exists to refuse.

So it gets its own table, held to the same four statuses and the same rule:
**a row says only what somebody ran.**

| agent | ships it | lane | status | measured | credential | capture |
|---|---|---|---|---|---|---|
| dcode | langchain | worker | MEASURED-WORKING | 2026-08-23 | `ANTHROPIC_API_KEY` | [dcode-capture-2026-08-23.md](dcode-capture-2026-08-23.md) |

**Exactly as far as the capture, and no further.** That row stands on one arm
of one binary:

- **The Anthropic arm is measured.** `dcode --acp`, with `ANTHROPIC_API_KEY`
  declared in `run.worker.acp.env_passthrough`, handshook without an auth
  dance, answered a prompt, and then drove a full `wring run` to `converged`
  on the arcade example — the same example, judge, gates and boundary
  `claude-agent-acp` converged on the day before.
- **The OpenAI and Google arms are wired and UNMEASURED.** The binary's own
  startup refusal names two more variables beside the one that was measured.
  Nobody here holds those keys, so neither variable is in the row.
- **It force-enables its own internal auto-approve.** Said here because a
  reader deserves to know what they are starting: `dcode --acp` waves through
  its own tool calls. It does not change what Wringer proves — every worker is
  an untrusted builder and the consent surface is Wringer's gates, never the
  agent's — but a row that left it out would be describing a different program.
- **It was slower on the one example both agents ran.** One worker turn of
  15m01s, which hit the 900s ceiling having already written the feature,
  against `claude-agent-acp`'s 7m48s. The loop absorbed it and the next verify
  converged.

Installing it is not npm: `uv tool install deepagents-code`, measured at
`deepagents-code 0.1.59`.

**What this row banks.** Two different vendors' agents have now converged the
same example under the same judge, the same gates and the same boundary.

## Where each agent's authentication becomes visible

**R2.2's ladder, and every rung is a measurement rather than a belief.** An
ACP agent surfaces its auth state at a different depth depending on how it was
built, and the depth decides what a preflight can cost. Sequence L once held
that no probe below `session/prompt` could see auth; that is true of one agent
in three and false as a statement about ACP
([docs/acp-auth-2026-08-24.md](acp-auth-2026-08-24.md)).

| agent | where auth becomes visible | what a preflight costs | measured |
|---|---|---|---|
| claude-agent-acp | `session/prompt` only | **the paid turn** — every call below it is identical signed in or out | 2026-08-22 |
| dcode | process start | **free and instant** — exits 1 before any protocol exchange, naming the variables it wanted | 2026-08-23 |
| kimi-code | `session/new` | **free** — the handshake opens and the session request is the refusal, carrying `authMethods` in its error data | 2026-08-24 |

**What Wringer does with the third row is show it, never drive it.** Kimi's
one advertised method is an interactive terminal login, and its `_meta` block
hands the client a command to run. Wringer prints that command for the person
and runs nothing: a login is somebody's account, and a command supplied by the
agent is arbitrary code from an untrusted party
([docs/specs/SPEC_ACPAUTH_V0.md](specs/SPEC_ACPAUTH_V0.md) §4).

**A successful `authenticate` is not evidence, and no row here rests on one.**
Measured on two of these three agents: one accepts its own advertised method id
and stays unauthenticated, the other returns success for a method it never
offered.

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
| langchain | ACP | `acp: dcode --acp` |
| openai | shell | `codex exec --json -` |
| openai | shell, zero-auth | `codex exec --json --oss --local-provider ollama -` |

## Measure it yourself

**These two live in the source tree, not in the installed package.** `uv tool
install wringer` ships the four commands and no scripts, so re-taking the
measurement means cloning first:

```bash
git clone https://github.com/marcoakes/wringer && cd wringer
```

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

Nothing else on this page needs a clone: the four statuses, the Keychain
conventions and the endpoints are the answers, and the scripts are only how
they were obtained.

## What this page does not claim

- A `MEASURED-WORKING` brain row means one turn was answered. It says nothing
  about the quality of that vendor's drafting or judging, which is what
  `wring bench` is for and which nobody has run across vendors yet.
- A `BLOCKED-ON-CREDENTIAL` row is not a prediction that a real key will
  work. It records how far the route was followed and where it stopped.
- Nothing about a vendor's presence here relaxes a gate, a refusal, or the
  record. A worker is the same untrusted thing whoever built it.
