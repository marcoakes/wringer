# Start here — two things, then your agent does the rest

You write what you want in ordinary English. A coding agent writes the code. Wringer asks
the questions, demands the proof, and refuses to hand over work it cannot prove. It works
with whichever coding agent and model provider you already use — nothing to switch,
nothing to sign up for — and you need a terminal for exactly one command.

## 1. Paste this into your coding agent (Claude Code, Kimi, Codex, …)

```text
Fetch https://raw.githubusercontent.com/marcoakes/wringer/main/docs/drive/AGENTS.md
and follow it exactly — it is the runbook for setting up and driving Wringer
for me. I am a product manager, not an engineer: tell me what you are about to
do before you do it, and what happened afterwards, in plain language. Do not
use sudo or change system settings. Never ask me for a password or an API key
— the runbook says how the key works without you. If a step fails, stop and
show me the actual error.
```

Your agent installs everything, checks its work with `wring doctor`, sets up a worked
example, and then drives Wringer for you — relaying every question and carrying your
answers back. Every approval is yours: nothing is built, no check is installed, nothing
is handed over until you say yes. [AGENTS.md](AGENTS.md) is the whole runbook, and you
can read it too.

## 2. Store your key — the one Terminal command, and it is yours alone

Drafting the plan calls a model, which costs money and needs **an API key for whichever
provider you choose** — billed per token, pennies per run. The providers measured so far,
and the one Keychain name for each (`anthropic-api-key`, `deepseek-api-key`, …), are in
[the measured vendor list](https://github.com/marcoakes/wringer/blob/main/docs/vendors.md). Give the key to your Mac's Keychain in **Terminal**, not in your agent:

```bash
security add-generic-password -U -s <vendor>-api-key -a wringer -w
```

No value after `-w`, deliberately: your Mac prompts you with the input masked, so the key
never reaches your screen, your history, or anything your agent can read.
**`-U` is not optional.** Without it a second run says *"already exists"* and
**throws away the key you just typed**, keeping the old one — so you believe you have
set a key and have not.

## What to expect

A handful of questions in your own language, one plan to approve, and a page —
`board.html` — showing what is done and what is proved. Expect a refusal the first time
on your own repository; most repositories cannot prove most requirements yet, and a run
that says so is the product working. The endings: [docs/ENDINGS.md](docs/ENDINGS.md).
Writing a requirement that drafts well: [docs/WRITING-A-REQUIREMENT.md](docs/WRITING-A-REQUIREMENT.md).

Two honest warnings. Wringer does not sandbox your agent — it runs with the same access
you have. And if the builder cannot authenticate, its turn ends having changed nothing:
the run says so in words now, and prints its progress as it goes, so a long build looks
like work rather than a silent stall. If nothing moves for several minutes, Ctrl+C is
safe — nothing of yours is touched.
