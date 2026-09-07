# Wringer for product managers

Write what you want built. Give the run a clear scope and budget. The result
must distinguish what was built, what was checked, what was proved, and what
still needs your judgement.

Wringer coordinates the agents and preserves the evidence. The agents write the product code. It cannot guarantee that a model understands an incomplete request or will finish every job.

The live PM workspace puts your next decision first. Ask your operator to open
`wringer-drive board --state CONTROLLER_STATE`, then use the private local URL
it prints. The workspace follows the same durable run as the command line;
refreshing the page does not buy a new run or reset the budget.

You can inspect the original request, current outcome, changed files, acceptance
and check evidence, session usage and outstanding decisions. Expand details when
you need the technical receipts. Unknown cost is labelled unknown, not £0.

## What you should not have to do repeatedly

You should not need to re-enter the same keys, approve each routine engineering choice, or start the whole drafting process again after one invalid response. A bounded authority record and durable run state exist to make those ordinary steps resumable.

That is different from giving unlimited permission. Publishing a change, changing the agreed scope, weakening isolation and recording something only a person can judge are not routine background decisions.

## What the board keeps separate

The workspace and the portable delivery keep six different facts visible:

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

In the workspace, use **Show the result** before recording your own verdict and
note. The display is currently the declared command's text output, not a browser
preview of the built application. If that output cannot support the judgement,
do not approve it: that is a display limitation to fix in the plan.

Use **Request a revision** to describe what should change. The request becomes
part of the record; the worker may continue within the remaining authority.
Changing the candidate withdraws its previous human acceptance. You do not need
to give routine engineering permission again, but you do need to review the new
result before a source-bound human requirement can pass.

Delivery has two decisions: prepare the handover, then confirm publication to the
named repository and review branch. A pushed branch is not automatically a hosted
pull request, and neither means merged or deployed. The board uses those exact
distinctions. An uncertain operation stays visible; clicking repeatedly does not
start duplicate work. A stale or disconnected page disables decisions.

Keep the server running while you use it. Its private URL grants local control,
so do not send it to others. A saved HTML snapshot is read-only. The older
standalone board remains available without `--state`, but is not a route to
resume or approve this contained journey.

## Start here

Ask your operator or coding agent to follow [INSTALL.md](INSTALL.md), then [SETUP.md](SETUP.md). These pages describe the one Bun product and the required isolated execution environment. Existing keys can be reused; setup should not turn into an account-registration exercise on every run.

[QUICKSTART.md](QUICKSTART.md) includes a no-spend developer demonstration. It uses deterministic fixtures; a successful demo is not a live-model success claim. Real Apple Container/gVisor isolation and fresh-machine journeys remain separately measured acceptance work, tracked in [ROADMAP.md](ROADMAP.md).

Earlier reports and cold reads remain historical evidence of the problems this product must fix. They are not the current installation guide or proof that a new user will find today's experience clear.

Implementation operators preparing an evaluation should use the
[PM blind-test start gate](docs/PM_BLIND_TEST.md). It does not pre-judge a run.
