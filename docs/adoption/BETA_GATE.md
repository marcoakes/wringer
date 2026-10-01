# The 1.0.0-beta.1 gate

Ruled by Marc on 2026-10-01 (amending ruling R-4 of the adoption plan): the beta
gate is two live journeys, one per named client, **run by Claude acting as the
person under Marc's delegation**. That makes it a delegated AI tester's pass. It is
not an independent human or blind PM pass, and must never be reported as one.
1.0.0 still needs protected mode or a live human PM pass.

Written before either journey ran. The criteria do not change after a result.

## Each journey

One client per journey: Claude Code, then Codex. Both use a fresh Bun project
whose `slugify` fails 2 of 4 tests, a local-only source, a local bare origin as
the destination, and the default application directory. The tester runs only
commands and pages the documentation names, from the **published alpha
release**, installed with the reviewed installer.

| # | Step | Passes when |
| --- | --- | --- |
| 1 | Install | The installer previews and applies the published archive; `wring --version` names the release |
| 2 | Setup | A trusted-local profile and workspace are applied from the printed preview |
| 3 | Connect | `wring connect --client NAME` applies the reviewed entry; the client lists the Wringer tools |
| 4 | Ask | Given only the request in plain words, the client proposes through MCP and gives the decision link once, unedited, without being told tool names |
| 5 | Approve | The tester approves on the job page; the decision records "Claude (delegated tester for Marc)" |
| 6 | Work | Live worker and judge, through the client's own ACP adapter, reach review with every check failed before and passed after |
| 7 | Review and Send | The page shows the change; the tester reads it, then sends from the page |
| 8 | Audit | The page's printed fresh-clone audit passes and carries the trusted-local sentence |

Recorded for every journey: the client and adapter versions, each command and its
outcome, how long each decision waited on the person (blind test 2's baseline is
about 20 minutes), sessions used, and every place the tester had to work around
the product. A workaround that a person could not find in the documentation fails
the step. Editing a record, using an undocumented internal command, or retrying a
step on someone else's behalf fails the journey.

**The gate passes only if both journeys pass.** Then the release is
1.0.0-beta.1, and its notes say: "Beta gate passed by a delegated AI tester
(Claude) on Marc's ruling; no independent human has run this journey."

## What the tester may not do

- Sign in to an account, enter or read a password or key, or change a client's
  account settings. An expired login stops the journey for Marc.
- Approve, accept or send anything outside the two gate jobs.
- Push anywhere but the journey's own local bare origin.
