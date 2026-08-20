# wringer-drive

**One verb. A document in, a page out.**

> ### 👉 New here, and not an engineer? [**START HERE**](START-HERE.md)
>
> Five steps, about ten minutes to seeing it work: install it, run a worked
> example, find out which of your own repositories it can help with, write a
> requirement, drive it.

```
wringer-drive run PRD.md
```

It takes what you wrote about what you want built, asks you the questions
nobody could answer for you, shows you a plan in plain language, and waits.
Nothing is built until you say yes.

## Installing it

```bash
pip install wringer
wringer-drive --help
```

That is the whole install, and it was not always. Until 2026-08-20 this was
its own package declaring `wringer` and `wringer-board` as dependencies —
and `wringer-board` had never been published, so a resolver asked to fetch it
failed outright:

```
Because wringer-board was not found in the package registry and
wringer-drive==0.1.0 depends on wringer-board, we can conclude that
wringer-drive==0.1.0 cannot be used.
```

The documented install was therefore "clone three repositories and
`pip install -e` each of them, siblings first". All three now ship in one
distribution, so the dependency that could not be satisfied is simply the
package this is part of.


## It is meant to be driven by your coding agent

You already have one — Wringer's [install page](https://github.com/marcoakes/wringer/blob/main/INSTALL.md)
is a prompt you paste into it. So this does not give you a new interface to
learn: `--emit json` produces one object per line for your agent to relay, and
your agent asks you the questions in the chat you are already in.

**Your agent is a transport, not a translator.** Every sentence it shows you
came from the engine or the board verbatim, never a summary. If nothing is
driving, the same steps appear at a terminal — the same words, laid out.

## What it will not do

- **There is no `--yes`.** The plan is rendered by this process, and the
  approval is answered by a person, and no flag or environment variable
  substitutes for that.
- **A stream with nobody behind it takes no default.** No answer means it
  stops and says so.
- **Approving the plan does not authorise the handover.** Two acts, two
  answers.
- **It never answers a `human:` criterion for you.** Nothing in any of the
  three packages writes a judgement.
- **It never resolves a refusal.** It shows you what the tool said and stops.

## State

**The whole chain is built** — steps 0 to 10: the document, the interview, the
plan, the approval, installing the approved checks, the repair loop, the
handover, and the page at the end. Measured end to end on 2026-08-17:
**27.5 seconds** of wall clock from a prose file to a rendered board, in
[docs/pm-mode-2026-08-17.md](docs/pm-mode-2026-08-17.md).

**That run exited non-zero, and that is the product working.** `wring deliver`
refused to hand over work it could not evidence, the refusal was rendered in
the board's own words, and the page was still written so the person could see
why. A green exit code was never the thing being sold.

The contract is
[SPEC_DRIVE_V0.md](https://github.com/marcoakes/wringer/blob/main/SPEC_DRIVE_V0.md).
Before any of this was written it went through a one-agent refute pass on
2026-08-17 — **NOT SOUND, 19 findings (9 HIGH), all folded** — recorded in
its §12. **That was not an independent review**, and the spec's §11 says so in
its own state table: a separate, later review by someone who did not then
build to the spec has not begun. It is worth saying plainly here, because a
claim about verification is the worst possible place to round up.

**What this package is NOT yet.** It has no public remote and is not on PyPI,
so today it exists on one machine and in this directory; and no stranger has
yet read a board it produced and said what it means, which is the check that
would make "a PM can use this" something other than a hope.

Filmed both ways: [docs/drive-2026-08-17.md](docs/drive-2026-08-17.md).

Apache-2.0, like the engine. No server, no network, no telemetry.
