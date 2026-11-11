# Review a Wringer job

Ask your coding assistant to keep your original request and choose one mode:
checking its changes with trusted-local checks, or delegating a job, either
contained or trusted-local on this computer.
Your workspace remembers preferences; it does not grant future jobs permission.

Open the selected job with `wring job open --workspace ID --job ID`. It opens in
your default browser. To use another browser, add `--print`: it prints the private
link instead. Anyone who opens that link can act as you on the page, so keep it to
yourself. The page keeps running in the background; `wring job close --workspace ID`
stops it and keeps your jobs.

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
   leaves it prepared. Without a forge, Send pushes a branch only. With one chosen
   at setup, Send also opens a pull (GitHub) or merge (GitLab) request whose
   description is the job's evidence, and the page links it. Neither is a merge or
   deploy. Send needs the token variable the page names, set in the terminal you
   ran `wring job open` from; without it nothing is pushed. If the branch went but
   the request was refused (for example the token cannot open pull requests), fix
   that and Send again: nothing new is pushed and only one request is opened.

If Wringer finds text shaped like a key or token in the history it would send, it
stops before Send and lists each match by file, never by value. Decide each one on
the page: give your reason when it is a test value or an example, and Wringer
prepares the handover again. If one is a real credential, do not send; remove it
from the repository's history first. A later job that finds the same exact bytes
shows your earlier reason for you to confirm.

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
