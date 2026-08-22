# The vendor probes of 2026-08-22 — five vendors, both lanes, measured

*The capture behind `docs/vendors.md`. Every row below is something that RAN
on one Mac on 2026-08-22. Nothing here claims anything about what did not
run; where a credential was absent the page says so and stops.*

**What this is not.** It is not a bench. `wring bench` puts several workers on
one brief and compares what they produced, and that needs a live arm per
vendor. **One arm was live** — `claude-agent-acp`, the capstone in
`CHANGELOG` 0.4.1 — so what exists is a **baseline**, not a comparison, and
saying otherwise would be the exact defect this project is for. The
comparison waits on credentials, and the last section says precisely which.

**Spend.** The only paid call on this page is one Anthropic brain-lane turn
that answered with the word `ok` (8 max tokens). Every other measurement was
made with a DUMMY key on purpose, because a vendor's authentication refusal
is itself the measurement.

---

## The method, and why a dummy key measures something

Wringer touches a model through exactly one function — `judge.send`, a
chat-completions POST with a Bearer header (`judge.py:297`, one of the two
sockets in the whole engine). Post a request with a key that cannot work and
the vendor answers. **That answer proves three things at once:** the endpoint
accepts the request shape Wringer posts, the `Authorization` header crossed
the wire, and the only absent thing is a real credential.

It proves nothing about whether a real key would be accepted. Rows measured
this way are `BLOCKED-ON-CREDENTIAL` in the matrix — never "working".

Reproduce: `python3 scripts/vendor-brain-probe.py` (no key needed).

---

## The BRAIN lane — the model that drafts the spec and judges the rubric

Endpoints and model names read from each vendor's CURRENT official
documentation on 2026-08-22, never recalled. Alphabetical.

| vendor | endpoint | model | credential | result |
|---|---|---|---|---|
| anthropic | `https://api.anthropic.com/v1/chat/completions` | `claude-opus-5` | **real** | **ANSWERED** |
| deepseek | `https://api.deepseek.com/chat/completions` | `deepseek-v4-pro` | dummy | reached, auth refused |
| glm | `https://api.z.ai/api/paas/v4/chat/completions` | `glm-5.3` | dummy | reached, auth refused |
| moonshot | `https://api.moonshot.ai/v1/chat/completions` | `kimi-k3` | dummy | reached, auth refused |
| openai | `https://api.openai.com/v1/chat/completions` | `gpt-5.2` | dummy | reached, auth refused |

**All five speak the shape Wringer posts.** Five vendors, one function, no
adapter, no branch on vendor name anywhere in the engine.

### The captures, verbatim

`.venv/bin/python scripts/vendor-brain-probe.py`

```
======================================================================
vendor         "anthropic"
endpoint       "https://api.anthropic.com/v1/chat/completions"
model          "claude-opus-5"
credential     "dummy"
reached        false
auth_refusal   true
transport      "HTTP Error 401: Unauthorized"
vendor_said    "{\"error\":{\"code\":\"authentication_error\",\"message\":\"Invalid Anthropic API Key\",\"type\":\"invalid_request_error\",\"param\":null}}"
======================================================================
vendor         "deepseek"
endpoint       "https://api.deepseek.com/chat/completions"
model          "deepseek-v4-pro"
credential     "dummy"
reached        false
auth_refusal   true
transport      "HTTP Error 401: Unauthorized"
vendor_said    "{\"error\":{\"message\":\"Authentication Fails, Your api key: ****-key is invalid\",\"type\":\"authentication_error\",\"param\":null,\"code\":\"invalid_request_error\"}}"
======================================================================
vendor         "glm"
endpoint       "https://api.z.ai/api/paas/v4/chat/completions"
model          "glm-5.3"
credential     "dummy"
reached        false
auth_refusal   true
transport      "HTTP Error 401: Unauthorized"
vendor_said    "{\"error\":{\"code\":\"401\",\"message\":\"token expired or incorrect\"}}"
======================================================================
vendor         "moonshot"
endpoint       "https://api.moonshot.ai/v1/chat/completions"
model          "kimi-k3"
credential     "dummy"
reached        false
auth_refusal   true
transport      "HTTP Error 401: Unauthorized"
vendor_said    "{\"error\":{\"message\":\"Invalid Authentication\",\"type\":\"invalid_authentication_error\"}}"
======================================================================
vendor         "openai"
endpoint       "https://api.openai.com/v1/chat/completions"
model          "gpt-5.2"
credential     "dummy"
reached        false
auth_refusal   true
transport      "HTTP Error 401: Unauthorized"
vendor_said    "{\n  \"error\": {\n    \"message\": \"Incorrect API key provided: sk-dummy***********-key. You can find your API key at https://platform.openai.com/account/api-keys.\",\n    \"type\": \"invalid_request_error\",\n    \"code\": \"invalid_api_key\",\n    \"param\": null\n  },\n  \"status\": 401\n}"
```

And the one real call, on the one credential this machine holds:

```
======================================================================
vendor         "anthropic"
endpoint       "https://api.anthropic.com/v1/chat/completions"
model          "claude-opus-5"
credential     "real"
reached        true
auth_refusal   false
answered       true
reply_text     "ok"
```

---

## The WORKER lane — the coding agent that does the building

### codex — `codex-cli 0.149.0`, installed this window

`npm install -g @openai/codex`. Verified from `codex exec --help` on this
machine, not from a README: `--json` (JSONL events on stdout), prompt from
argv or stdin `-`, `--ephemeral` (no session files), `--oss --local-provider
lmstudio|ollama` (the zero-auth local arm). That is the existing SHELL worker
form — no adapter, no engine change.

**The documented trap, MEASURED rather than read.** Three arms, same command,
same machine, only the environment differing. `CODEX_HOME` pointed at an empty
directory so no `auth.json` could serve any of them.

| arm | environment | what the server said |
|---|---|---|
| A | no credential at all | `401 Unauthorized: Missing bearer or basic authentication in header` |
| B | `OPENAI_API_KEY=<dummy>` | `401 Unauthorized: Missing bearer or basic authentication in header` |
| C | `CODEX_API_KEY=<dummy>` | `401 Unauthorized: Incorrect API key provided: sk-dummy***********-key` |

**B is byte-identical to A.** The header is MISSING, not rejected — so
`OPENAI_API_KEY` is not merely refused, it is never sent. **C's answer is a
different error entirely**: the key was read, put in the header, transmitted,
and rejected by OpenAI as a bad key. That is the discriminator, and it
settles which variable authenticates `codex exec` without anyone holding a
real credential.

Exact command:

```
env -u OPENAI_API_KEY -u CODEX_ACCESS_TOKEN CODEX_API_KEY=sk-dummy-not-a-real-key \
  CODEX_HOME=$PWD/home codex exec --json --ephemeral --skip-git-repo-check \
  -C . 'Reply with the single word OK and stop.'
```

**Credential mechanics, and the correction that matters.** `env_passthrough`
exists ONLY on the ACP worker form (`config.py:180`). A shell worker inherits
the operator's launch environment (`gates.py:191`, `env=None`), so
`CODEX_API_KEY` rides that environment, or the containment env allowlist where
containment is in play. The docs say THAT, never a passthrough the shell form
does not have.

**Arms not run.** No OpenAI credential exists on this machine and `ollama` is
not installed, so neither the paid arm nor the zero-auth local arm produced a
turn. Recorded BLOCKED-ON-CREDENTIAL, not silently skipped.

### kimi — `kimi 1.49.0`, installed this window

Installed from the vendor's own index package rather than by piping a remote
script into a shell: `uv tool install kimi-code`. `MoonshotAI/kimi-cli`'s
README says it "is evolving into Kimi Code CLI"; both PyPI packages publish
the same version, `1.49.0`. The vendor's documented alternative is
`curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash`, which installs
the same binary under the name `kimi`.

Kimi ships BOTH worker forms, verified from `kimi-code --help` on this
machine: `kimi acp` (an ACP server — Wringer's `acp:` worker form) and
`--print` with `--output-format stream-json` (a headless shell form).

**Finding, and it corrects a generalisation this repository was carrying.**

```
======================================================================
agent                  "kimi-code acp"
authMethods_present    true
authMethods            [{"_meta": {"terminal-auth": {"command": ".../kimi-code", "args": ["login"], "label": "Kimi Code Login", "env": {}, "type": "terminal"}}, "description": "Run `kimi login` command in the terminal, then follow the instructions to finish login.", "id": "login", "name": "Login with Kimi account"}]
session_new_opened     false
session_new_is_error   true
session_new_error      {"code": -32000, "message": "Authentication required", "data": {"authMethods": [{"id": "login", "name": "Login with Kimi account", "description": "Run `kimi login` command in the terminal, then follow the instructions to finish login.", "type": "terminal", "args": ["login"], "env": {}}]}}
stderr_tail            ""
```

Two things here are NOT what `claude-agent-acp` taught:

1. **`authMethods` is non-empty.** Kimi advertises a route (`login`, a
   terminal act) at `initialize`. The Anthropic adapter returns
   `authMethods: []` because it offers only methods the CLIENT declared, and
   Wringer declares none.
2. **`session/new` REFUSES.** Auth is visible one call BEFORE the paid turn.
   `docs/specs/SPEC_LOOPBACK_V0.md` records *"No probe below `session/prompt`
   can see auth"* — that sentence is true of the Anthropic adapter, which is
   what it was measured on, and **it is false as a general statement about
   ACP agents**. On this agent a free preflight is possible. The honest
   statement is per-agent, and this is the measurement that makes it so.

**The bounded attempt, and where it stopped.** A dummy `KIMI_API_KEY` — with
and without `KIMI_BASE_URL` — changes the ACP handshake not at all: the same
`Authentication required` with the same `login` method attached. The ACP form
wants the documented interactive route (`kimi login`, browser OAuth or an API
key typed into its own UI). That is an account login, which is a person's act
and not this window's. Recorded **BLOCKED-ON-AUTH-ROUTE**.

**The shell form is a different answer, and it is a better one.** With the
three variables the installed package reads — `KIMI_API_KEY`,
`KIMI_BASE_URL`, `KIMI_MODEL_NAME`, found in its own source, not guessed —
the dummy key reaches Moonshot and comes back:

```
Error code: 401 - {'error': {'message': 'Invalid Authentication', 'type': 'invalid_authentication_error'}}
```

The header was sent. So Kimi's SHELL form takes an environment credential
end-to-end and is BLOCKED-ON-CREDENTIAL only — exactly like codex, and for
exactly the same structural reason: a shell worker inherits the launch
environment.

### deepseek and glm — no agent CLI, and that is an honest cell

Neither vendor shipped a coding-agent CLI of its own as of 2026-08-22, read
from their own documentation:

- DeepSeek: *"DeepSeek Harness is now in developer preview for agent harness
  developers worldwide"*, and their integration page directs users to point
  existing tools — it names Claude Code, GitHub Copilot and OpenCode — at
  their API.
- Z.ai: the GLM Coding Plan *"can be applied to coding tools such as Claude
  Code, Cline, and OpenCode"*.

**That is not a gap in the matrix; it is the thesis.** Both vendors' own
answer to "how do I code with this" is *use somebody else's agent and point it
at our endpoint*, which is the same structural fact Wringer's worker contract
rests on. Their worker rows read NO-AGENT-CLI and their brain rows carry the
measurement above.

---

## What a full comparison still needs

The bench this page could not run needs one live arm per vendor. Named, so
nobody has to reconstruct the list:

| to make this row live | what is needed | who can provide it |
|---|---|---|
| codex worker (paid) | an OpenAI key stored `-s openai-api-key`, exported as `CODEX_API_KEY` at launch | the operator |
| codex worker (zero-auth) | `ollama` installed, then `--oss --local-provider ollama` | anyone; no credential |
| kimi worker (ACP) | `kimi login` run once, interactively | the person, at their keyboard |
| kimi worker (shell) | a Moonshot key stored `-s moonshot-api-key`, exported as `KIMI_API_KEY` | the operator |
| deepseek brain | a key stored `-s deepseek-api-key` | the operator |
| glm brain | a key stored `-s glm-api-key` | the operator |

Each of those is one credential away from a measured row, and none of them is
a change to Wringer. That is what the matrix means by BLOCKED-ON-CREDENTIAL.
