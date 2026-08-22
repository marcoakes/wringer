# Response to the field report of 2026-08-22

The report itself is [`docs/field-report-2026-08-22.md`](field-report-2026-08-22.md),
landed verbatim and never edited. This file is the disposition: what was done
about each finding, what was already done before the run and could not be seen,
and what is owed. Where this document disagrees with the report, the report
stays as written and the disagreement is stated here with its evidence.

**Every "already fixed" claim below was re-executed against HEAD before it was
written down.** That rule exists because this repository has four recorded
cases of a guard passing with its own fix reverted, and a commit title is not
evidence. Where a repro is quoted, it was run.

---

## The finding the evaluator could not have made, and it is ours

Finding 1 is correct and it is the most important one in the report. Run 3
installed `origin/main` = `v0.4.0` = `9009d08`. Eleven commits — the 2026-08-21
friction purge, run 2's report inside them — existed only on the author's
machine and were reachable from no remote. At least five of run 3's findings
were already dead in that unpushed work.

The evaluator's sentence is the ruling: *"if a run is gated on evidence, the
evidence-producing run cannot be gated on unpushed code."*

Three separate things went wrong here and they are one thing: unpushed code,
unpushed report, stale front pages. In every case the truth existed on exactly
one machine and nothing made it travel. The version half is now derived from
the tags rather than remembered
(`test_the_front_page_advertises_the_version_that_IS_PUBLISHED`), and it fails
in both directions — a page naming a version older than the latest tag is
stale, and a page naming one newer is claiming a release that does not exist.

**A `v*` tag push IS publication.** `release.yml` publishes on it. It is never
part of staging, and it waits for a person.

---

## Findings already fixed before run 3, confirmed by re-execution

| # | Disposition | Evidence |
|---|---|---|
| F7 | FIXED@`c41526b` | repro executed, red-watched |
| F5 (legibility half) | FIXED@`703c1cf` | `worker-diagnosis.json`, `FACE_TURN_REFUSED`, PATH preflight |
| F8 (re-ask half) | FIXED@`887de08` | garbage at a confirm re-asks instead of spending the decision |
| F11, F12 | FIXED@`696f261` | `NEEDS YOU` reserved for `human:` states |

**F7 — re-running is safe again.** The field's message made three false claims
at once: it named the same id on both sides of the sentence, it asserted "it
passes today" about a command that exits 1, and it said the criterion was left
unbound while `.wringer.yaml` carried its `proves:` line. A repro was built at
the CLI with the field's own gate id, command and criterion, and with a
genuinely red acceptance check — because "it passes today" is the claim at
issue and a green check could not measure it. At HEAD `wring plan` exits 0 and
the binding survives. With the `already applied` branch reverted from a file
copy, the repro reproduces the field's message verbatim.

**F11/F12 — the badge.** `NEEDS YOU` is now reserved for rows where a person is
genuinely the blocker. A criterion nothing checks reads `NOTHING CHECKS THIS`;
one whose check cannot yet evidence anything reads `NEEDS AN ENGINEER`. The
word "you" is deliberately absent from both. The evaluator's recommendation —
*"the single change that would most improve the board"* — is what landed.

---

## F8, the drain half: the mechanism works, the sentence did not

The plan for this window recorded this half as UNEXPLAINED, because the
evaluator measured it failing at a commit where the drain demonstrably exists.
It was reconstructed against a real subprocess pipe, in both timings, driving
the shipped `_ask`/`_confirm` rather than a copy.

- Text queued **before** the confirm renders is drained, and what was discarded
  is shown back in a `stale-input-discarded` step. Measured: it works.
- Text written **after** the confirm renders is read as the answer. Measured:
  it is, and no transport can distinguish it from a person typing.

E1 landed in the second window. **So the interlock is implemented and the
report's inference — "documented but not implemented" — is not what happened.**

That is not a defence of the page, because the page is what produced the
inference. The bullet read as a total protection, so a careful reader who
watched a queued line reach an approval had no other conclusion available. The
bullet now names the answer window and says why the burden is law 2's: the
machine cannot prove intent, so the rule against queueing ahead *is* the
protection. Guard:
`test_the_stdin_bullet_does_not_promise_more_than_the_drain_does`.

It failed safe that day only because the queued words were not "yes".

---

## F5 root and F6: the auth wall, answered from the adapter's source

The remedy this repository documented — `run.worker.acp.env_passthrough` with
`ANTHROPIC_API_KEY` — was a guess, it was mine, and the field falsified it:
applying it moved `session/prompt was refused: Authentication required` to
`session/new was refused: Internal error`, with `apiType=native` unchanged.

The facts now on the page come from `@agentclientprotocol/claude-agent-acp`
0.70.0, `dist/acp-agent.js`:

1. **`apiType=native` is not a choice of subscription auth.** The log line
   interpolates `resolvedProvider?.apiType ?? "native"`, so it is what prints
   when *no provider resolved at all*. A provider resolves only from a
   `providers/set` call or a gateway `authenticate` request. Wringer sends
   neither, so the adapter falls through to the Claude Code CLI's own on-disk
   credential store.
2. **The adapter never reads `ANTHROPIC_API_KEY` as a credential.** The name
   occurs twice: in a list used to build a context-window cache key, and in
   `createEnvForProvider`, which sets it to `""`. When a provider *is*
   configured the adapter deliberately blanks it. `env_passthrough` could never
   have worked, and the degraded error the evaluator measured is consistent
   with handing the CLI a variable it treats as routing state rather than a
   credential.
3. **Authentication is a protocol act.** `initialize` advertises `authMethods`
   and the client calls `authenticate` with one of their ids. The adapter only
   offers methods the *client* declared it can service.

Point 3 is the part that is new, and it is more useful than "no mechanism
exists". A route does exist — `claude-ai-login`, `console-login`, and
`gateway`/`gateway-bedrock` — but **Wringer's handshake declares no auth
capability, so the adapter offers it none.** Measured here twice, on this
machine, with `claude-agent-acp` on PATH: `authMethods: []`.

**Sequence L is confirmed, and now for a reason rather than an observation.**
The probe was re-run as the signed-in user and again with `HOME` pointed at an
empty directory. The two handshakes are byte-identical through `initialize` and
`session/new`: `authMethods: []`, `session_new_is_error: false`,
`apiType=native` in both. The structural reason is in the source —
`authMethods` is gated on a CLI flag (`--hide-claude-auth`) and on client
capabilities, never on login state. **No probe below `session/prompt` can see
auth**, and this is why.

The honest sentence is now on the page: a machine whose Claude Code is signed
in by subscription cannot currently be driven through this adapter by Wringer.
What works is drafting, which uses Wringer's own key and never touches the
adapter. Guard:
`test_the_page_does_not_offer_env_passthrough_as_an_AUTH_REMEDY`.

---

## Fixed in this window

**F2 — the front page advertised the wrong version.** README's headline said
`0.3.0, seventeen commands` two days after `0.4.0` was published, and its dated
caveat insisted the release was behind the repository. Both corrected, and both
now derived: the headline is checked against the latest published tag, and a
separate guard refuses any page that calls a command this distribution ships a
separate unpublished package. That second guard is not redundant — README:478's
`wringer-board` "not on PyPI" sentence was false about *packaging*, not about a
version number, and a guard reading only the version would have walked past it,
as one did.

**F3 — the documented install path errored.** INSTALL.md's step 3 ran two
`--editable` installs; the second now fails outright on the executable
collision, because both packages came to declare `wringer-board`. There is one
install page and one command: `uv tool install wringer`. INSTALL.md's promise
that "when a release is cut … this paragraph goes away" — which outlived the
release by two days — is gone, and the paragraph that replaced it says why.
`docs/drive/AGENTS.md`'s three-repository variant, F3's second head, is gone
the same way.

**F4 — bare `wring` gave a wall and no way in.** It now prints
`wring start is the guided launch; wring doctor checks this machine.` before
argparse's usage error. Argv-empty only, no twentieth command, no change to any
other invocation — both halves guarded, including one that fails if a verb was
added to carry it.

---

## Not reproduced

**The nine empty bullets under "What this page does not claim".** The renderer
was executed against `LIMITS_V3` and every `<li>` carries its full text — 261
characters in the first. The count matches exactly (`LIMITS_V3` is nine
entries), so what the dump captured was that section; but the emptiness is an
artifact of text-extracting a collapsed `<details>` element, not something the
page renders. Recorded here rather than "fixed", because claiming a fix for
something that is not broken is the same class of false claim as the ones this
report is about.

**F15 — the token counts.** They are rendered as a sibling *after* the
`</details>`, not inside it, so they are not filed under the disclaimer in the
DOM. But with the section collapsed they sit directly beneath its summary line
with no intervening heading, which is exactly how they read. The finding is
real as a matter of layout even though the markup is not what it looked like.
OWED — see below.

---

## Owed

- **F15's layout.** Give the spend paragraph its own heading, or move it above
  the collapsed disclaimer. Not done in this window.
- **F13** — two identical blocking states carrying different badges. One badge
  rule for refused states. Not done in this window.
- **F14** — the failing-test output reading as a contradiction. The board's own
  cold-read measurements say structural changes helped (85→68) and explanatory
  prose made it worse (→82), so this is owed a *structural* answer or none.
  Nobody adds a paragraph to fix a confusion here.
- **F9** — an assumption may never displace a human-judged criterion. Ruled;
  not built in this window.
- **F10** — an answered question may not render as an "if unanswered"
  conditional. Ruled; not built in this window.
- **A `session/prompt`-level preflight.** Sequence L proves presence cannot
  vouch for auth, so the existing PATH preflight cannot stop the wall. A probe
  that reaches `session/prompt` before any drafting money is spent is designed
  and not built.
- **`docs/specs/SPEC_LOOPBACK_V0.md`** needs run 3's evidence folded into its
  §4 fork, including the `authMethods: []` finding, and then a ruling. It is a
  draft that decides nothing and it stays that way until it is ruled on.

## What the report got right that must not be lost

The evaluator's own list is the best summary of what is working, and it is not
paraphrased here — see §2 of the report. Two things are worth naming because
they are load-bearing and easy to erode: `refusing_means` on every confirm, and
the `DECIDED WITHOUT ASKING YOU` block, which in this very run caught the plan
intending to build `"Recently played"` when the tester had twice said
`"Where you left off"`. Neither is decoration.

The report also records the evaluator's own errors in §6, unprompted, including
the one that surfaced F8. That is the same discipline this file is trying to
keep.
