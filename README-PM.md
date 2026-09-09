# Wringer for product managers

## Keep your AI coding app. Put the work through Wringer.

Describe the result you want in the coding app you already use. Your assistant
handles the mechanics; Wringer keeps the approved work and evidence together;
you decide whether the result is ready to hand over.

**[Start here](ASSISTANT_START.md).** The assistant entry point is an engineering
preview for a cooperative-local evaluation. An operator must set it up once.
It is not yet a protected delegation product or a passed independent PM test.
[What is and is not measured](docs/ASSISTANT_COMPATIBILITY.md) is part of the
starting page, not fine print after an approval.

Once the preview is connected, the delegation request is:

> Use Wringer for this request and repository. Show me the proposed work,
> assumptions and session/time limits before starting. Keep routine work inside
> what I approve. Bring me back for a real result to inspect, any changed scope
> and a separate handover decision. Do not record human judgements for me.

This request is not an approval and does not connect an unconfigured app. The
result must distinguish what was built, what was checked, what was proved, and
what still needs your judgement. Your coding app's usage is separate from the
contained agents' usage; unknown billing is never £0.

Wringer coordinates the agents and preserves the evidence. The agents write the product code. It cannot guarantee that a model understands an incomplete request or will finish every job.

The assistant's private job page puts your next decision first and keeps the
whole job in one place. Your operator opens it during setup; reopening or
refreshing it does not buy a new run or reset the budget. Enter your name when
approving the bounded work, not again at each later decision. That recorded
name is not proof of authenticated human presence in this cooperative preview.

You see the original request, requirements, scope, actual displayed result and
the decision needed now. Technical evidence stays in expandable details.
Coding-app and managed-development costs are separate; missing billing is
labelled unknown, not £0.

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

Review whether the requirements still mean what you asked for. Approving them
also approves the shown source, scope and finite session/time limits. Routine
work starts automatically inside that allowance; it does not grant a cash cap
or publication permission.

The contained pen requires a successful display of the exact candidate. If the
display fails, the observation cannot be recorded by using the standalone
board's independent-inspection option. No PM delegation supplies a person's
actual observation.

The delivery includes instructions for someone else to audit it from a fresh clone. This is how the result travels without depending on the builder's explanation or workstation.

Wringer opens the actual result for you. The display is the declared command's
text output, not a browser preview of the built application. If that output
cannot support the judgement, do not approve it: that is a display limitation
to fix in the plan. A failed, missing or old display cannot enable Yes.

Choose **Yes, this is right** after reviewing the displayed requirements and
result. You may add a comment, but you do not have to invent a sentence to make
the button work. Wringer records the decision separately from any genuine
words you supplied.

Use **Request correction** to describe what should change in your own words.
The request becomes part of the record; the worker may continue within the remaining authority.
Changing the candidate withdraws its previous human acceptance. You do not need
to give routine engineering permission again, but you do need to review the new
result before a source-bound human requirement can pass.

After acceptance, Wringer prepares the handover without another routine click.
You then inspect the preset destination and branch and separately choose
**Send this reviewed change**. Acceptance does not authorize sending. A pushed
branch is not automatically a hosted pull request, and neither means merged or
deployed. An uncertain operation stays visible; clicking repeatedly does not
start duplicate work. A stale or disconnected page disables decisions.

The sent result supplies the actual handover and copyable fresh-clone audit
instructions. A public review-request link appears only if one was created.
That link is not a hosted audit service and the private job page is not a
reviewer link. The recipient follows the carried instructions to audit the
delivery; seeing those instructions does not mean the audit has run.

You can opt into browser notifications while this page is open. A connected
assistant can also wait for a meaningful update through a bounded read-only
tool. Neither is native push to a closed coding app. You can leave the page
running without asking a model to narrate every poll.

Keep the local execution owner running while you use it. Its private URL grants local control,
so do not send it to others. A saved HTML snapshot is read-only. The older
standalone board remains available without `--state`, but is not a route to
resume or approve this contained journey. The direct operator workspace,
`wringer-drive board --state CONTROLLER_STATE`, remains a separate advanced
route with explicit showing and preparation controls; it is not a required
detour from the assistant's job page.

## Start here

For assistant-led evaluation, give your operator or coding agent
[ASSISTANT_START.md](ASSISTANT_START.md). For direct operator-led execution,
follow [INSTALL.md](INSTALL.md), then [SETUP.md](SETUP.md). Both use the same Bun
product and required isolated worker environment. Existing keys can be reused;
connecting the assistant is not a reason to replace them or copy them into chat.

[QUICKSTART.md](QUICKSTART.md) includes a no-spend developer demonstration. It uses deterministic fixtures; a successful demo is not a live-model success claim. Real Apple Container/gVisor isolation and fresh-machine journeys remain separately measured acceptance work, tracked in [ROADMAP.md](ROADMAP.md).

Earlier reports and cold reads remain historical evidence of the problems this product must fix. They are not the current installation guide or proof that a new user will find today's experience clear.

Implementation operators preparing an evaluation should use the
[PM blind-test start gate](docs/PM_BLIND_TEST.md). It does not pre-judge a run.
