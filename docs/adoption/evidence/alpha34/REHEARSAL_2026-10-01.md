# Pre-release rehearsal with the real adapters — 1 October 2026

**What this is:** a rehearsal of the trusted-local journey from the source tree,
before 1.0.0-alpha.34 was cut, to find defects before the beta gate. It is not
the beta gate and not a pass of anything. Marc ruled that the beta gate is two
live journeys run by Claude as the person, by his delegation. This rehearsal was
run the same way:

- **The person:** Claude, delegated tester for Marc, using the built-in browser
  on the job page. Every decision recorded the actor as "Claude (delegated tester
  for Marc), rehearsal".
- **The agent:** a scripted MCP client (one tool call per session), not a coding
  app. Claude wrote each call.
- **The worker and judge:** live, through the pinned ACP adapters on this
  computer.
- **The repository:** a Bun project with a `slugify` function failing 2 of its 4
  tests, a local-only source, and a local bare origin as the handover
  destination.

## Run 1: Claude adapter for both roles, stopped at the worker

Setup, job creation, the owner and MCP calls worked after fixes 1–3 below. After
approval on the page, the worker session opened and its first prompt failed:

> Failed to authenticate: OAuth session expired and could not be refreshed

This is the computer's Claude Code login, which had expired. It is an account
action for Marc, not something the tester may do. The page showed only
"agent-error", twice (fix 5).

## Run 2: Codex adapter for both roles, sent and audited

| Step | Observed |
| --- | --- |
| Setup → workspace → `job new` | Worked; the job asked for a full proposal |
| `inspect_setup`, `validate_proposal`, `revise_proposal` over MCP | Worked after fixes 1–3; decision link returned |
| Opening the decision link | Locked until the private operator link was opened once (by design; the person must have the operator's link) |
| Approve on the page | Recorded with the tester's name; work started |
| Worker (Codex) | About 30 seconds; one-line change to `src/slugify.ts` |
| Checks before and after | Failed before, passed after (4/4), in fresh clones |
| Judge (Codex) | Independently ran the tests; criterion met |
| Approval → review-ready | About 90 seconds; 2 of 8 sessions used |
| The change on the page | Shown as a diff after fix 6 |
| Send on the page | Branch pushed to the local bare origin |
| Fresh-clone audit (the page's printed commands) | **Passed**, with "Ran on this computer under the operator's account; nothing was contained." in the audit, summary and MR text |

## Defects found and fixed before release

Each fix has a test that fails without it.

1. **MCP answers for a trusted-local workspace failed output validation.** The
   frozen `assistant-response-v2` and `delegation-setup-v1` schemas pin the
   boundary to `contained`. Fixed with the siblings `assistant-response-v3` and
   `delegation-setup-v2`; contained workspaces keep the old versions.
2. **Revising a proposal failed.** The frozen `proposal-supersession-v1` embeds
   plans v1–v4 only. Fixed with `proposal-supersession-v2`, which adds plan v5.
3. **`wring job status` said `execution: contained`.** It now reports the
   workspace's recorded boundary.
4. **The approval page said "Delegation · contained roles".** It now says the
   work runs on this computer under your account and nothing is contained.
5. **A stopped role showed only "agent-error".** It now gives the agent's own
   reported error. For a sign-in failure it says how to sign in and to retry.
6. **With check-only requirements, the Send page said "Your result is accepted"
   and showed no change.** Nobody had accepted it. The page now says the checks and the
   independent review agreed and no one has reviewed it for you. It also shows
   what changed: files, line counts and the patch, as text.
7. **Trusted-local deliveries offered the falsification command,** which refuses
   them. The delivery limits and route reason now say so. The frozen delivery
   contract still records the route as `available`.
8. **Setup printed "Ran on this computer…" before anything had run.** It now
   says what will happen.

## Seen, not fixed

- After Send the page kept showing "Your approved work is underway" until it
  was reloaded (about 13 seconds of polling observed).
- While the judge was finishing, status briefly read "Inspect the stopped setup.
  Do not replay an uncertain start."
- A project with no lockfile and no `packageManager` gets `npm run test` as its
  check; the rehearsal project declares `bun@1.4.2`.

## Not established

No coding app was the MCP client, so this does not measure whether Claude Code or
Codex follows the loop or relays the decision link. That is what the gate's two
journeys measure. One person-equivalent ran every step, and it was an AI.
