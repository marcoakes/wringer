# SPEC — the ACP auth handshake (v0)

*Drafted 2026-08-24 from Fable's R2
(`~/Claude/WRINGER_LEVELUP_RULINGS_2026-08-22.md`), which rules this the
headline slice and rules it **spec-first, because it touches the consent
boundary**. Grounded at `main` `cc25663`. Every claim below cites
`docs/acp-auth-2026-08-24.md`, which was measured BEFORE this was written.*

> ## STATUS — drafted and built together, with the measurement first and the
> ceiling stated. **Two of R2's three clauses are amended by measurement**, and
> the amendments are in §2 and §3 with the captures beside them.

## Positioning — what this buys, in one line

**One client implementation, every conforming agent**: Wringer reads what an
agent says about its own authentication and puts the agent's own instructions
in front of the operator, instead of a generic wall. That is
vendor-agnosticism as protocol rather than as a roster of special cases, and
it is the anti-lock-in move at the transport layer.

What it is NOT: a way to log an agent in. See §3.

---

## §1 — What R2 asked for, and what the measurement said

| R2's clause | measured | outcome |
|---|---|---|
| declare client auth capability at `initialize` | the advertised set is IDENTICAL across three client-capability shapes, on all three agents | **no capability to declare.** §2 |
| read `authMethods` | two agents advertise none; one advertises an interactive login | **ADOPTED**, and it is the whole value |
| drive `authenticate` with the operator's declared credential | **no agent in the census offers a method that takes one** | **implemented, UNEXERCISED, and said so.** §4 |

---

## §2 — Ruling 1: there is nothing to declare, and the sequence-L belief is corrected

`SPEC_LOOPBACK`'s sequence-L reasoning held that `initialize` advertises
`authMethods` *"based on client capabilities and a CLI flag"*. **Measured
false as a general statement.** Three client shapes — `fs` only, nothing at
all, `fs` plus `terminal` — produce a byte-identical `authMethods` on
`claude-agent-acp`, `dcode --acp` and `kimi-code acp`.

**So "this agent offers no methods" is a fact about the AGENT, not about our
request**, and Wringer's `CLIENT_CAPABILITIES` stays exactly as it is. R2's
"declare client auth capability" clause has nothing to attach to in the
protocol as these three agents implement it, and inventing a field would be
Wringer asserting a shape nobody serves.

⚑ This is a SCOPE CORRECTION, not a contradiction: sequence L measured
`claude-agent-acp` and was right about it. The generalisation was the error,
which is R2.1's own point.

---

## §3 — Ruling 2: a successful `authenticate` is NOT evidence. **This is the load-bearing ruling.**

Measured, on two independent vendors' agents, failing in opposite directions:

- **`kimi-code acp` accepts its OWN advertised method id and stays
  unauthenticated.** `authenticate {"methodId": "login"}` returns no error,
  and the next `session/new` still refuses `-32000 Authentication required`.
- **`dcode --acp` returns `result: {}` for a method it never offered** and does
  not implement.

> **A client may never treat `authenticate` returning without an error as
> evidence that it is authenticated. The evidence is the NEXT call
> succeeding.**

That is red-before/green-after arriving at the transport layer, and it is the
same sentence this project exists to say. A client that trusted the success
would report an authenticated worker and then fail at the paid turn — the
false-green this repository refuses everywhere else.

**Consequence, binding on the build:** the record says what was OBSERVED —
which method was attempted, what the agent answered, and whether `session/new`
then opened — never "authenticated: true".

---

## §4 — Ruling 3: what Wringer does with a method, by kind

| the agent offers | Wringer does | why |
|---|---|---|
| nothing | nothing; the existing prompt-level path stands | there is no handshake to run |
| an INTERACTIVE method (`terminal-auth`, OAuth, a browser) | **SHOWS it. Never runs it.** | a login is somebody's account, and `_meta.terminal-auth` carries a `command` and `args` from the AGENT — running them is arbitrary code from an untrusted party on the operator's machine |
| a method taking a declared credential | calls `authenticate`, with the credential crossing as the declared act | the boundary law, unchanged |

⚑ **AMENDED 2026-08-30: the third row is NOT BUILT.** Nothing calls `authenticate` — `methodId`/`method_id` appear nowhere in `src/` or `tests/`, and the only `send_request` calls in `src/wringer/acp.py` are `initialize`, `session/new` and `session/prompt`. §3's ruling already makes the credential path unnecessary. ~~The third row is IMPLEMENTED AND UNEXERCISED, and no page may say
otherwise. The code exists so that a conforming agent is served the day it
appears.~~ No agent in the census offers such a method; the capture says
nobody has appeared, and the vendors matrix carries the same limit.

**Wringer never runs a `terminal-auth` command.** `worker_auth.refusal`
already states the rule — *"Wringer never installs an agent and it does not log
one in either — and the second is the stronger rule of the two, because a login
is somebody's account"* — and this spec extends it to a command the agent
itself supplies.

---

## §5 — Ruling 4: the preflight LADDER, keyed on measurement (R2.2)

Where an agent's auth is visible below `session/prompt`, the free handshake is
the preflight; where it is not, the prompt-level probe stands. **Which class an
agent is, is a measured row, never a belief.** Three rungs, each measured:

| rung | measured on | cost |
|---|---|---|
| startup-refusal | `dcode --acp` | free — exits 1 before any protocol exchange |
| `session/new`-refusal | `kimi-code acp` | free — the handshake opens and the session request is the refusal |
| prompt-only | `claude-agent-acp` | the paid turn; everything below it is identical signed in or out |

---

## §6 — Non-goals (binding)

1. **No twentieth command.** Nineteen.
2. **No running of any command an agent supplies**, under any `_meta` key.
3. No storing of a credential, and no new place one is written down.
4. No claim that Wringer can log an agent in.
5. No frozen schema moves. What is recorded is recorded in the existing turn
   record.
6. No retry loop around `authenticate`. One attempt; the answer is the answer,
   and a second try would be retry-until-green at the auth boundary.

## §7 — The derivations this spec makes, and the guards they owe

| id | derivation | the guard it owes |
|---|---|---|
| A1 | a method is INTERACTIVE if it carries any `_meta` key naming a command to run | a method with a `terminal-auth` block must never be executed, red-watched by asserting no spawn happens |
| A2 | the evidence of authentication is `session/new`, never `authenticate`'s return | an agent that returns success from `authenticate` and then refuses `session/new` must NOT be reported as authenticated |
| A3 | what the operator is shown is the AGENT's own `description`/`name`, verbatim | a hand-written instruction for a named vendor would be the roster-of-special-cases this spec exists to avoid |
