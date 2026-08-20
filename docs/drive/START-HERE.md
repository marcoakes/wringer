# Start here — two things, then your agent does the rest

You write what you want in ordinary English. A coding agent writes the code.
Wringer asks the questions, demands the proof, and refuses to hand over work
it cannot prove. You do not need a terminal for any of it except one command.

## 1. Paste this into your coding agent (Claude Code, Kimi, Codex, …)

```text
Fetch https://raw.githubusercontent.com/marcoakes/wringer-drive/main/AGENTS.md
and follow it exactly — it is the runbook for setting up and driving Wringer
for me. I am a product manager, not an engineer: tell me what you are about to
do before you do it, and what happened afterwards, in plain language. Do not
use sudo or change system settings. Never ask me for a password or an API key
— the runbook says how the key works without you. If a step fails, stop and
show me the actual error.
```

Your agent installs everything, checks its work with `wring doctor`, sets up a
worked example, and then drives Wringer for you — relaying every question and
carrying your answers back. Every approval is yours: nothing is built, no
check is installed, nothing is handed over until you say yes when asked.
[AGENTS.md](AGENTS.md) is the whole runbook, and you can read it too.

## 2. Store your key — the one Terminal command, and it is yours alone

Drafting the plan calls a model, which costs money and needs an **Anthropic
API key** (the `sk-ant-…` string from console.anthropic.com → API keys; billed
per token, pennies per run). Give it to your Mac's Keychain in **Terminal**,
not in your agent:

```bash
security add-generic-password -s anthropic -a wringer -w
```

There is deliberately no value after `-w`: your Mac prompts you and hides what
you type, so the key never reaches your screen, your history, or anything your
agent can read. The run command reads it from the Keychain directly, and the
setup questions say where it will be sent. If it answers that the item
**already exists**, you stored it before and it is still there — you are done.

## What to expect

A handful of questions in your own language, one plan to approve, and a page —
`board.html` — showing what is done and what is proved. Expect a refusal the
first time on your own repository; most repositories cannot prove most
requirements yet, and a run that says so is the product working. The endings:
[docs/ENDINGS.md](docs/ENDINGS.md). Writing a requirement that drafts well:
[docs/WRITING-A-REQUIREMENT.md](docs/WRITING-A-REQUIREMENT.md).

Two honest warnings. Wringer does not sandbox your agent — it runs with the
same access you have. And if the builder cannot authenticate, its turn ends
having changed nothing: the run says so in words now, and prints its progress
as it goes, so a long build looks like work rather than a silent stall. If
nothing moves for several minutes, Ctrl+C is safe — nothing of yours is touched.
