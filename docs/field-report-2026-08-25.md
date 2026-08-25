# Wringer field report — 2026-08-25

**Context.** A product manager (non-engineer) asked a coding agent to set up and
drive Wringer per `docs/drive/AGENTS.md`. Two drive runs were attempted. Neither
reached a proved board. This report records what was measured, with the evidence.

**Environment**

| | |
|---|---|
| wringer | 0.4.0 (editable install from local source) |
| adapter | `@agentclientprotocol/claude-agent-acp` 0.70.0 |
| also installed | `@zed-industries/claude-code-acp` 0.16.2 (deprecated) |
| host | macOS (Darwin 25.5.0), Apple silicon, **IT-managed, org-pinned to first-party OAuth** |
| example | `docs/drive/examples/pipeline` |

**Outcome.** Run 1 stopped at `wring plan`. Run 2 interviewed, planned, installed
a red-first gate correctly, then failed at the build: worker exit 1 after 1.75s,
zero files changed. Wringer correctly refused to deliver.

---

## Finding 1 — The actionable error is thrown away (highest impact)

`src/wringer/acp.py:278-279`

```python
said = found["error"].get("message", "agent error")
raise AcpError(f"{method} was refused: {said}")
```

Only `error.message` survives. `error.code` and `error.data` are discarded.

**What the operator saw**, in `loop.jsonl` and on the board:

```
acp_error: "session/new was refused: Internal error"
```

**What the agent actually sent** (captured by driving the adapter directly with
the same minimal env Wringer constructs at `acp.py:386-402`):

```json
{"jsonrpc":"2.0","id":2,"error":{
  "code": -32603,
  "message": "Internal error",
  "data": {"details": "Claude Code process exited with code 1. stderr: This machine's managed settings require a first-party login, but an Anthropic-issued credential (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or apiKeyHelper) is configured. A non-OAuth Anthropic credential cannot satisfy the org pin.\n\nRemove the credential and run: claude auth login\n\nIf this is a third-party desktop session: forceLoginOrgUUID targets first-party OAuth and should be removed from managed-settings.json."}
}}
```

The precise, actionable remediation — in plain English, naming the exact command —
was present and was dropped. `-32603 Internal error` is JSON-RPC's generic code;
it carries no information on its own.

**Cost of this one line:** an entire session and one paid drafting call, for a
problem whose fix was already written down in the payload.

**Suggested fix:** fold `error.code` and `error.data.details` into `AcpError`.
This is the single highest-value change in this report.

---

## Finding 2 — `wring plan` is not idempotent, and gives a false reason

Re-driving an already-driven project caused `wring plan` to drop its own gate
binding. Verbatim `engine_words` from the `stopped` step:

> `wringer.gates.yaml: 'acceptance-skip-downstream' runs `pytest -q acceptance/test_skip_downstream.py`, which is already what 'acceptance-skip-downstream' runs. A check that already runs cannot be the thing that proves 'skip-transitive-dependents' — it passes today, so it cannot be made to fail by the work. The binding was dropped and the criterion is left unbound`

Two defects in one message:

1. **It compares the gate to itself.** The proposal in `wringer.gates.yaml` and
   the installed gate in `.wringer.yaml` are the same line, because `wring plan`
   applied it on a previous run. The sentence is a tautology and unreadable.
2. **"it passes today" is false.** Measured three ways on the same commit:
   - `pytest -q acceptance/test_skip_downstream.py` → **6 failed, 3 passed**
   - `wring verify` → `✗ acceptance-skip-downstream failed`
   - Run 2's own gate-trial step → `None of them passes today.`
   The example's `setup.sh` also prints `the acceptance check RED - the feature
   does not exist yet`.

**Effect.** The plan went from 1 bound criterion to **0 of 9**, so the run could
prove nothing — on a false premise, with no way for a non-engineer to detect it.

**Suggested fix:** treat "already installed" as already-satisfied rather than a
reason to unbind; and never assert a check's pass/fail state without running it —
run 2 shows the machinery to try a gate already exists.

---

## Finding 3 — `wring doctor` does not report builder login

`docs/drive/AGENTS.md` states:

> `wring doctor` reads this and the drive preflights it.

Measured: `wring doctor` was run three times — outside a repo, inside a repo with
a string worker, and inside a repo with a properly configured ACP worker. **No
line about the builder's login appeared in any of them.** The blocker was found
only by running `claude-agent-acp --cli auth status` by hand.

**Effect.** The documented pre-spend safeguard does not exist. Drafting is paid
for, then lost at the build step — exactly the failure the paragraph promises to
prevent.

---

## Finding 4 — `env_passthrough` guidance is wrong on org-pinned machines, and self-contradictory across docs

`docs/drive/AGENTS.md` (Correction, 2026-08-22) says the `env_passthrough` route
**does** work, and records `session/new was refused: Internal error` as
**"NOT REPRODUCED"**.

`INSTALL.md:190` says of the same path: *"The authentication path is a live gap,
not a solved one."*

**Measured 2026-08-25, same machine, same adapter, back to back:**

| configuration | `session/new` |
|---|---|
| `env_passthrough: [ANTHROPIC_API_KEY]`, key present | **refused** — org pin rejects non-OAuth credential |
| no key in worker env | **succeeds**, returns a session id |

So on this host the documented remedy is not merely ineffective — **it is the
cause of the failure**, and removing it is the fix. The `session/new … Internal
error` marked NOT REPRODUCED reproduces reliably here.

**Compounding false green:** `claude-agent-acp --cli auth status` with the key
present reports `loggedIn: true, authMethod: api_key,
apiKeySource: ANTHROPIC_API_KEY` — while `session/new` refuses. AGENTS.md's own
caveat ("presence is not validity") is correct but understated: here presence is
*worse* than absence.

**Suggested fix:** state that on a machine with managed settings pinning
first-party OAuth, `env_passthrough` of an Anthropic key must **not** be used.
Detect the org-pin case and say so.

---

## Finding 5 — A string `worker:` silently is not an ACP worker

The project carried `run.worker: "claude-code-acp"`. Per `config.py:1797-1831`, a
string parses as a **shell command**; only a mapping with an `acp:` key is an ACP
worker. Consequences, none of them surfaced:

- the adapter is never spoken to over ACP at all;
- `env_passthrough` is not available on that shape, so the documented remedy
  cannot even be expressed;
- the value named the **deprecated** package (`claude-code-acp`), which
  `INSTALL.md:180` records as answering an unauthenticated turn with an empty
  result "which a client cannot tell from a turn that did nothing".

**Suggested fix:** warn when a string worker's command matches a known ACP
adapter name — the misconfiguration is silent and its symptom ("changed nothing")
points nowhere near the cause.

---

## Finding 6 — Re-rendering a plan from an existing approved spec degrades it

Run 1 (existing spec, `approved: true`) produced a plan where:

- all four tasks read `(no plain-language outcome was written for this task)`;
- there was **no DECIDED WITHOUT ASKING YOU block at all**;
- two tasks deferred to open questions "once … is answered" — while the spec on
  disk had **answers for all 7**.

Run 2 (fresh project) produced all of these correctly: outcomes written, six
disclosed decisions with the questions they replaced, no stale deferrals. The
degradation is specific to the re-render path.

**Effect.** The operator was asked to approve a plan that misrepresented its own
decision state, in the direction of appearing *less* settled than it was.

---

## Finding 7 — `AGENTS.md` omits the PATH step its own epilogue prints

The example's `setup.sh` epilogue instructs:

```
export PATH=".../project/.venv/bin:$PATH"
```

`AGENTS.md` says the epilogue's steps are the driving agent's to perform, but
restates only the key and the drive command. Without the PATH export every gate
fails with `ruff: command not found` / `pytest: command not found`. Cheap to fix
by restating it in the driving section.

---

## What works, and is worth protecting

These are not filler — they are the parts that behaved better than most tools in
this space:

- **It refused to deliver.** `wring deliver: refusing to deliver … its gates did
  not pass. An unverified change does not get a branch.` No overclaiming.
- **`NOTHING CHECKS THIS YET`** — unevidenced criteria are reported as such and
  explicitly not claimed as done, with the count stated up front (`0 of 6 have a
  check bound`).
- **`DECIDED WITHOUT ASKING YOU`** — six decisions, each printed with the exact
  question it replaced. This is a genuinely good disclosure pattern.
- **Red-first gate trial.** Offering to run a proposed check *before* installing
  it, and reporting `None of them passes today`, is the right shape — and is what
  Finding 2's message got wrong by assertion instead.
- **Credentials as names, never values.** `env_passthrough` rejects values with a
  clear error; `judge.api_key_env` names a variable. The inline-from-Keychain
  pattern kept the key out of the driving agent's context throughout.
- **Auditable record.** `loop.jsonl` is hash-chained and recorded
  `acp_error`, `exit_code` and `duration_ms` accurately — it is only the
  *rendering* of that error that lost information.
- **`needs_workspace` respects a human-written config** and says why in the
  source. Correct instinct.

---

## The one-line summary for the team

Wringer is trustworthy about *what* it cannot prove and unreliable at explaining
*why* it stopped. Every blocker hit today was diagnosable — the information
existed, in `error.data`, in the gate runner, in the adapter's own status verb —
and in each case the surface shown to the operator was truncated, self-referential,
or false. The judgement layer is the hard part and it is built. The diagnostic
layer is the easy part and it is what makes "a PM can use this" untrue today.
