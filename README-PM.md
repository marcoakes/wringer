# Wringer for product managers

Write what you want built. Give the run a clear scope and budget. The result
must distinguish what was built, what was checked, what was proved, and what
still needs your judgement.

Wringer coordinates the agents and preserves the evidence. The agents write the product code. It cannot guarantee that a model understands an incomplete request or will finish every job.

This checkpoint's contained journey has a validated status report and portable
delivery records, not an integrated HTML board. Ask your operator to show
`wringer-drive status --state CONTROLLER_STATE` and explain the recorded next
action; `--json` provides the detailed candidate, checks, reviews and usage.
The human display/review and delivery commands in [QUICKSTART.md](QUICKSTART.md)
continue that same journey. A page presenting these contained records remains
an open product gap, not a feature inferred from an older board.

## What you should not have to do repeatedly

You should not need to re-enter the same keys, approve each routine engineering choice, or start the whole drafting process again after one invalid response. A bounded authority record and durable run state exist to make those ordinary steps resumable.

That is different from giving unlimited permission. Publishing a change, changing the agreed scope, weakening isolation and recording something only a person can judge are not routine background decisions.

## What the separate standalone board means

The existing HTML board reads standalone repository-verification records. It
does not read or approve a contained journey. Within that separate format it
keeps six separate facts:

1. **Built:** a completed build is recorded for the relevant run; otherwise it says what is missing.
2. **Checks passing:** the declared checks passed in this verification.
3. **Requirements proved:** the evidence supports the requirements as written.
4. **Human judgement complete:** the required observations have been recorded by a person.
5. **Ready to deliver:** the required evidence and decisions are satisfied.
6. **Delivered:** a recorded delivery names the committed change.

There is no single percentage to confuse those facts. “Checks passing” is not shorthand for “everything I asked for is done.” Open a requirement to see its original words, check, receipt or human note.

## Where your attention matters

Review whether the requirements still mean what you asked for. If a requirement needs a person's eye, look at the displayed result and record your own observation. Review the ready handover before authorizing publication.

The contained pen requires a successful display of the exact candidate. If the
display fails, the observation cannot be recorded by using the standalone
board's independent-inspection option. No PM delegation supplies a person's
actual observation.

The delivery includes instructions for someone else to audit it from a fresh clone. This is how the result travels without depending on the builder's explanation or workstation.

## Start here

Ask your operator or coding agent to follow [INSTALL.md](INSTALL.md), then [SETUP.md](SETUP.md). These pages describe the one Bun product and the required isolated execution environment. Existing keys can be reused; setup should not turn into an account-registration exercise on every run.

[QUICKSTART.md](QUICKSTART.md) includes a no-spend developer demonstration. It uses deterministic fixtures; a successful demo is not a live-model success claim. Real Apple Container/gVisor isolation and fresh-machine journeys remain separately measured acceptance work, tracked in [ROADMAP.md](ROADMAP.md).

Earlier reports and cold reads remain historical evidence of the problems this product must fix. They are not the current installation guide or proof that a new user will find today's experience clear.
