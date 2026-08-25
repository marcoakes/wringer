# SPEC — the loopback worker (v0, DRAFT)

*The driving agent connects to the engine, instead of the engine spawning a
worker.*

> **THIS DOCUMENT DECIDES NOTHING AND BUILDS NOTHING.** It is a design sketch
> and a decision tree, authored 2026-08-19 under SPEC_PMPLAN_V0's ruling that
> the auth endgame is spec-only in that window. Nothing here is binding, no
> slice is queued against it, and the fork it describes is **keyed on a
> measurement that has not been taken** (§4). Do not build from it. If it is
> ever ruled, the ruling will say so in its own header.

---

## §1 — The problem, stated narrowly

A product manager who wants to use Wringer today needs an **API key**. Not the
Claude subscription they already pay for and are already signed into — a
separate credential, created in a console, stored in a keychain, and billed
separately.

That is a real barrier and it is worth being precise about where it sits:

- **`wring spec --send` needs a key** to draft the plan. It reuses the judge's
  transport, which posts to a chat-completions endpoint.
- **The worker needs its own auth.** `claude-agent-acp` runs as a subprocess
  and authenticates however that adapter authenticates.
- **The person driving is already authenticated.** They are talking to a
  coding agent — Claude Code, or another — inside a session that already has
  whatever credential that agent uses.

So the machine has a working authentication a metre away from the thing that
cannot authenticate, and the reason it cannot be used is architectural: the
engine SPAWNS its worker, so the worker is a child process with no access to
the parent's session.

## §2 — The shape being sketched

**Invert the direction.** Rather than the engine spawning a worker, the
driving agent connects to the engine as one:

```
  today      wring run ──spawns──> claude-agent-acp ──needs its own auth
  loopback   the agent ──connects──> wring run --worker loopback
```

The engine would open a local endpoint, announce it in a step the runbook
already knows how to relay, and wait. The agent — which is already running,
already authenticated, and already reading DRIVE's steps — attaches and
services turns.

**What this would NOT change**, and the list matters more than the sketch:

- The engine still decides what a turn is, when the loop stops, and what
  counts as progress. A worker that reports its own success is the thing this
  programme exists to refuse, and a worker that is also the driving agent is
  MORE exposed to that, not less.
- Containment (`run.containment`) still applies. The 2026-08-15 refusal —
  *an ACP worker cannot be contained in v0* — became a capability at Phase 3,
  and any loopback worker inherits that requirement rather than escaping it.
- Evidence is unchanged. The loop still writes turns, still runs gates, still
  refuses what it cannot evidence.
- **The drafting call still needs a key.** Loopback addresses the WORKER, not
  `wring spec --send`. Anyone reading this as "no key needed" has read it
  wrong, and §4's decision tree turns on exactly that distinction.

## §3 — What is genuinely hard about it, listed rather than solved

1. **The engine would open a socket.** Today `spec.py`'s docstring can say
   *"this module opens no socket"* and `judge.send` is the single audited
   network path. A listening endpoint is a different security posture and
   would need SECURITY.md to say so — including what binds it, what
   authenticates a connection, and what happens when something else connects.
2. **A worker that is the driving agent can see the whole conversation.** The
   isolation between "the thing being supervised" and "the thing doing the
   supervising" gets thinner. That is a claim-ceiling problem before it is a
   security one: the evidence still says what it says, but the independence a
   reader might assume is reduced, so the docs would have to state it.
3. **Two agents could attach.** Or none, or one that disappears mid-turn. The
   engine currently owns its worker's lifecycle and would stop doing so.
4. **It is a new transport, and this programme has one.** Every network path
   goes through `judge.send` on purpose. A second one is a second set of
   safety rules to keep true.

## §4 — The decision tree, keyed on a measurement NOT YET TAKEN

The fork turns on one question that can only be answered by trying it:

> **Does a Claude subscription credential work against the drafting endpoint
> that `wring spec --send` posts to?**

That is measurable in an afternoon on a fresh machine, and the fresh-install
retest is the natural place to measure it, because it is the only run that
starts from a person who has nothing set up yet.

| if the retest shows | then loopback is | and the next step is |
|---|---|---|
| a subscription credential **can** draft | **a convenience cycle** — the key barrier is already gone for the drafting call, and loopback only saves the worker's separate auth | queue it behind anything with evidence value; it is ergonomics |
| a subscription credential **cannot** draft | **the audience fix** — the product's first step is unreachable for the people it is for, and no amount of worker cleverness helps | take it to Fable as a ruling, with the retest capture attached as the evidence |

**Neither branch is chosen here.** The measurement has not been taken, and
choosing before it is taken is the thing this document exists to avoid.

### §4b — The measurement, TAKEN 2026-08-22. **The fork is still not resolved, and the reason changed.**

Run 3 (`docs/field-report-2026-08-22.md`) answered §4's question, and the
answer is the FIRST row: **an API key drafts.** `wring spec --send` succeeded
twice on the evaluator's Keychain value. What died was the WORKER, every time.

By §4's own table that makes loopback "a convenience cycle". **It does not,
and the table is what is now wrong** — it assumed the worker's auth was a
separate barrier of the same kind. It is not the same kind, and the evidence is
in the adapter's source (`@agentclientprotocol/claude-agent-acp` 0.70.0,
`dist/acp-agent.js`), read on 2026-08-22:

1. **`apiType=native` is not a choice of subscription auth.** The log line
   interpolates `resolvedProvider?.apiType ?? "native"` — it is what prints when
   NO provider config resolved. A provider resolves only from a `providers/set`
   call or a gateway `authenticate` request.
2. **The adapter never reads `ANTHROPIC_API_KEY` as a credential.** It appears in
   a context-window cache-key list, and in `createEnvForProvider`, which sets it
   to `""`. The documented `env_passthrough` remedy was a guess and the field
   falsified it, degrading `Authentication required` to `Internal error`.
3. **Authentication is a protocol act.** `initialize` advertises `authMethods`
   and the client calls `authenticate`. The adapter offers only methods the
   CLIENT declared it can service — and **Wringer declares none, so the
   handshake returns `authMethods: []`.** Measured twice on the author's
   machine.

**So there IS a route and Wringer does not ask for it.** `claude-ai-login`,
`console-login` and `gateway`/`gateway-bedrock` exist; Wringer's handshake is
why none is on offer. That is a third branch §4's table does not have, and it is
cheaper than loopback by a wide margin.

Also settled, and it closes a question this document leaves open: **sequence L
is confirmed structurally, not just empirically.** `authMethods` is gated on a
CLI flag (`--hide-claude-auth`) and on client capabilities, never on login
state, so `initialize` and `session/new` are byte-identical authenticated and
unauthenticated. **No probe below `session/prompt` can see auth.** Any preflight
that intends to stop a run before it spends must reach `session/prompt`.

> ⚑ **SCOPE-CORRECTED 2026-08-24 by Fable's R2.1, and then narrowed again by
> measurement. The paragraph above is true of `claude-agent-acp` and false as
> a statement about ACP agents.**
>
> **The generalisation is wrong.** `kimi-code acp` refuses `session/new` with
> `-32000 Authentication required` and carries its `authMethods` in the error
> data — auth visible two calls below the prompt, for free. `dcode --acp`
> exits 1 before any protocol exchange at all. So *"no probe below
> `session/prompt` can see auth"* holds for one agent in three, and the
> preflight is a LADDER keyed on per-agent measurement rather than one rule
> (`docs/specs/SPEC_ACPAUTH_V0.md` §5).
>
> **And the stated MECHANISM is wrong too, which R2.1 did not know.** This
> paragraph says `authMethods` is gated "on a CLI flag and on client
> capabilities". Measured across three client-capability shapes — `fs` only,
> nothing at all, `fs` plus `terminal` — the advertised set is byte-identical
> on all three agents (`docs/acp-auth-2026-08-24.md`, A2). It is not a
> function of what the client declares, so "this agent offers no methods" is a
> fact about the agent.
>
> **The ruling this document asks for below is ANSWERED**, in
> `SPEC_ACPAUTH_V0`: Wringer reads the methods and shows them, and does NOT
> call `authenticate` — because a successful `authenticate` proves nothing.
> Measured on two vendors: `kimi-code acp` accepts its own advertised method
> id and stays unauthenticated, and `dcode --acp` returns success for a method
> it never offered.

**The ruling this document now needs from Fable** is not the one §4 frames. It
is: does Wringer declare the client-side auth capability and call `authenticate`
— making the worker's login the operator's ordinary act — or does it keep the
narrow honest refusal now on the page and treat loopback as the answer? The
first is a small change to a handshake. The second is a cycle. Nothing here
chooses, and the measurement above is why the choice is finally informed.

### §4b-note — Dated correction, 2026-08-22. **Point 2 above is MEASURED FALSE, and the ruling has since landed.**

*Added the same day §4b was written, after the measurement §4b did not have.
The paragraphs above are left byte-intact: they are the reasoning that was
shipped, and reading them beside what falsified them is the point of a dated
note. This section still decides nothing.*

**§4b was written from a source READ. `docs/auth-probe-2026-08-22.md` is the
turn nobody had SENT.** `scripts/acp-auth-probe.py --prompt`, three runs, same
adapter version (0.70.0):

| run | environment | `session/new` | `session/prompt` |
|---|---|---|---|
| 1 | uncontained, as the user | opened | refused `-32000 Authentication required` |
| 2 | `HOME` = empty dir | opened | refused `-32000 Authentication required` |
| 3 | **`ANTHROPIC_API_KEY` in the child env** | opened | **ANSWERED, `stopReason: end_turn`** |

1. **"The adapter never reads `ANTHROPIC_API_KEY` as a credential" is false.**
   `createEnvForProvider` opens `if (!config) { return {}; }`
   (`dist/acp-agent.js:5323`). Wringer configures no provider, so the branch
   that blanks the variable is the branch Wringer never takes; the variable
   reaches the CLI untouched and the CLI reads it. A conditional had been
   written down as an absolute.
2. **"the field falsified it, degrading `Authentication required` to
   `Internal error`" is NOT REPRODUCED.** Run 3 is exactly that configuration
   and `session/new` opened cleanly. Recorded as not reproduced, not as
   fixed — the evaluator saw something and this run does not explain what.

   > **EXPLAINED 2026-08-25** (field report of that date, finding 4). It
   > reproduces reliably on an IT-managed Mac pinned to a first-party
   > organisation login, and the key is what causes it: with
   > `env_passthrough: [ANTHROPIC_API_KEY]` `session/new` is refused, and with
   > no key in the worker env it succeeds. Every run above was made on an
   > unmanaged machine and every one of them was honest. What was missing was
   > that "this machine" was a variable — a negative result was written down
   > as though the configuration were the only thing that differed between the
   > evaluator's run and this one. The refusal's `error.data` said so in plain
   > English the whole time and Wringer rendered only `error.message`; that is
   > finding 1, and it is fixed in 0.4.7.
3. **What §4b got right and keeps.** Point 3 stands: `authMethods: []` is a
   handshake fact, and sequence L stands — no probe below `session/prompt`
   can see auth, which is why the free surface that CAN is a different
   surface entirely (`claude-agent-acp --cli auth status`, machine-readable,
   costs nothing, and is what `worker_auth.py` preflights on).
4. **The honest limit, unchanged.** This machine's coding-agent CLI is not
   subscription-signed-in, so nothing here measures the subscription
   credential. Run 1's premise ("as the signed-in user") was false.

**The route table, ruled.** `~/Claude/WRINGER_4B_RULING_2026-08-22.md` (Fable,
2026-08-22) settles the branch space this section was holding open. The
decision belongs to that ruling; it is cited here so the table stops being
wrong:

| route | ruling |
|---|---|
| 1. Native login | **PRIMARY** — and measured working via `ANTHROPIC_API_KEY` through the boundary (run 3 above) |
| 2. The gateway route (`x-api-key` via the adapter's LLM-gateway mapping) | second route, unmeasured |
| 3. `codex exec --json` as a shell worker | **ADOPTED**, two roles: capstone fallback, and a standing roster/bench seat |
| 4. The app-server supervised worker | **BANKED** — its own cycle, its own spec and review; not licensed |
| 5. Loopback proper | **REFUSED for now** — three cheaper measured routes exist before any protocol inversion is justified |

The ruling's own limit applies to route 3 and is repeated here because it is
the one a roster slice could quietly loosen: *a codex worker is a WORKER — the
same untrusted thing every worker is; nothing about vendor choice relaxes a
gate, a refusal, or the record.*

### §4a — A dated sub-finding, 2026-08-21. **NOT the fork's own measurement.**

A product manager's second field run, and a probe run on the maintainer's Mac
in the same window, measured facts ADJACENT to the fork. Recorded here because
they strengthen §1's premise and because leaving them in a field report would
mean this page's reader never sees them — not because they answer anything.

**What was measured, on `@agentclientprotocol/claude-agent-acp` 0.70.0:**

- The stock ACP adapter reports `apiType=native baseUrl=native` and
  authenticates **entirely on its own account**. It ignored `WRINGER_API_KEY`
  and it ignored `ANTHROPIC_API_KEY`; both were set, and the turn was still
  refused with `Authentication required`. It wants an interactive login.
- **Auth state is not readable before the paid turn.** An authenticated and an
  unauthenticated agent are byte-for-byte indistinguishable across the whole
  handshake — `authMethods: []` in both, `session/new` opens a session in
  both, no error in either. The refusal appears only at `session/prompt`,
  which is the call that costs money. `scripts/acp-auth-probe.py`,
  `docs/MANUAL_CHECKS.md` sequence L.

**What that means, and what it does not.** The spawned-worker path can neither
reuse the person's existing session NOR be fed a credential non-interactively,
which is a stronger version of the premise §1 already states. It says nothing
about the fork: the fork is about the DRAFTING endpoint and a subscription
credential, and nobody has posted one at `wring spec --send` yet. **Loopback
stays unruled**, and the two rows above are unchanged.

The near-term fix shipped instead is honest failure rather than a workaround:
`wringer-drive` refuses before the first paid call when the agent is not on
PATH, and a refused turn now names authentication to the operator with the
agent's own words and the log path (`diagnose.FACE_TURN_REFUSED`). That is
correct under either branch of the fork and does not prejudge it.

## §5 — What would falsify this sketch

- If the drafting endpoint accepts a subscription credential, §1's framing is
  half wrong and this document should be rewritten around the worker alone.
- If `claude-agent-acp` gains subscription auth of its own, the worker half
  dissolves and nothing here is needed.
- If a measurement shows PMs do not in fact stall at the key — that they stall
  somewhere earlier, or later — then this is solving a step nobody reached.
  **Nobody has measured where they stall.** That is the largest unexamined
  assumption in this document and it is named here rather than buried.

## §6 — Status

Authored 2026-08-19. **Not reviewed. Not ruled. Not built. No slice queued.**
Amended 2026-08-21 with §4a, a dated sub-finding that measured the WORKER half
and left the fork exactly where it was.
It exists so that the retest on a fresh machine collects the one fact the
decision needs, instead of that machine being set up, working, and the
question going unasked for another cycle.
