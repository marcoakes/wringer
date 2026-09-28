# Review a Wringer job

Ask your coding assistant to keep your original request and choose one mode:
checking its changes with trusted-local checks, or delegating a contained job.
Your workspace remembers preferences; it does not grant future jobs permission.

Open the selected job with `wring job open --workspace ID --job ID`.

1. **Approve:** inspect the original words, source, acceptance, selected checks,
   runtime, writable scope, budgets, expiry and destination. Questions and revised
   proposals preserve lineage. Approval never transfers silently to a revision.
2. **Inspect:** read the actual candidate output, check evidence and unmet criteria.
   Missing/failed required display keeps acceptance disabled. A passing command
   need not prove a requirement. Unknown cost is shown as unknown.
3. **Correct or accept:** describe a correction in your own words. Out-of-scope or
   exhausted work needs separate reviewed authority. Accept only the source you
   inspected; a stale tab cannot apply that decision to a later candidate.
4. **Send separately:** review the exact prepared source and destination. Declining
   leaves it prepared. A successful branch push is not a hosted PR, merge or deploy.

Reload and multiple tabs observe the same job. Use Stop if you want further work
halted; an uncertain remote response must be reconciled before retry. If the owner
is gone, follow [recovery](MIGRATION.md); never delete evidence to regain a button.
The page's optional notifications work only within browser permission/lifecycle;
they do not promise an assistant wakeup.

This page is cooperative-local. It does not authenticate physical human presence
against another unrestricted process using your OS account. Automated engineering
review is useful fixture evidence but cannot be recorded as your personal
acceptance or as independent newcomer usability.

[Agent setup](START_AGENT.md) · [Visual example](../examples/adoption/visual-change/README.md)
