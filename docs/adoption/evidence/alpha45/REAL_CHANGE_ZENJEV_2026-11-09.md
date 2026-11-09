# The first real change through Wringer: ZenJev, 9 November 2026

Until this run, Wringer had delivered only one-line fixes in a four-test fixture. This
is the first real multi-file feature it carried end to end, on a real repository with
real dependencies, live coding agents, an independent judge, a Send and a fresh-clone
audit. It was run by Claude, acting for Marc on his instruction ("you dont need my calls
i want you to run it as me"). That makes it a delegated AI operator's run. No
independent human made or reviewed these decisions.

## What was asked

- **Repository:** [ZenJev](https://github.com/marcoakes/ZenJev) at `04f2154`, a
  Next.js 16, Prisma and Vitest support workbench installed with npm (959 MB of
  dependencies).
- **Copy:** a local clone delivering to a local bare origin. Nothing was pushed to
  GitHub, and Marc's own ZenJev checkout was not touched.
- **Feature:** "In the evaluation lab, show routing precision and recall for each team,
  with a confusion table of actual against routed team, so a support lead can see
  which team's routing is wrong."
- **Failing test first:** committed as `1ea10f8` before the job.
  `tests/routing-breakdown.test.ts` (4 cases) asks for `routingBreakdown` in a new
  `src/domain/routing.ts`, exported from `src/domain`, and its per-team rows in
  `evaluateSaved` as `byTeam`.
- **Gate:** `routing-breakdown` (`node scripts/check.mjs test
  tests/routing-breakdown.test.ts`) was added to ZenJev's `.wringer.yaml`.
- **Checking the test:** before the job, the test was shown to fail today (the module
  is missing) and to pass with a throwaway reference implementation in a scratch copy.
  The worker never saw that implementation.
- **Agents:** worker and judge both `claude-agent-acp` 0.101.1, on Marc's Claude login,
  trusted-local (nothing contained). The coding-assistant side used Wringer's MCP tools
  over stdio.

## What happened

| Attempt | Outcome | Cause | Fixed in |
| --- | --- | --- | --- |
| Setup | Could not run at all | `--dependencies` offered only `none` or `bun-frozen`; an npm project's checks had no `node_modules` | `npm-ci` mode |
| 1 (job `bae983b9…`) | The worker's session completed, then capture failed and the job was stuck | ZenJev tracks files inside folders its `.gitignore` ignores (`evidence/ci/*/work/`). Git refuses `add -A` on those, and capture and delivery both used it. The failure came after a charged session, so the effect was recorded uncertain. Then no retry, page button or recovery could settle it, and `wring job close` refused forever, which would also hold every install. | Capture through `add -u`; a capture failure is a known, retryable stop; close waits only for live operations |
| 2 (job `eaf4bb5b…`) | Checks passed and the judge agreed; then handover preparation stopped | Source-history review found ZenJev's redaction canary (a fake provider key in `tests/domain.test.ts`). The refusal was correct, but it was recorded uncertain, so the page would not prepare again. | Preparation refusals are failures, and the page can retry them |
| 2, continued | Sent and audited | The two findings were recorded as reviewed exceptions, with a reason that does not quote the value (Wringer refused the first reason, which did). Preparation was retried from the page, then the change was sent. | |

Attempt 2 timings (UTC):

- 19:42:19 approved.
- 19:50:00 the page stopped at source review, about 7.7 minutes after approval. In that
  time Wringer ran the red baseline, the worker, the candidate checks and the judge, each
  check in a fresh clone that ran `npm ci`.
- 19:53:33 preparation retried, after the review decisions.
- 19:53:43 Send offered.
- 19:53:53 sent.

It used 2 of 8 agent sessions (1 worker, 1 judge) and 2 of 8 verification attempts.
The coding-app cost is unknown, as Wringer reports it.

## What was delivered

The branch `wringer/job/eaf4bb5b-ac3e-dfc1-b6f2-a234bba853bc` was pushed to the local
origin. On top of the failing test it adds the agent candidate `bcfc709` and the
evidence commit `d269853`. It changes 4 files, +47 −4:

- **`src/domain/routing.ts` (new, 40 lines):** `routingBreakdown`, plus
  `isEligibleAtThreshold` and `routedTeam`. The lab's eligibility rule moved here and
  `evaluateSaved` now uses it, so the two cannot drift apart.
- **`src/domain/index.ts`:** re-exports, and adds `byTeam` and `confusion` to
  `evaluateSaved`.
- **`src/components/workbench.tsx`:** a "Routing by team" table and an "Actual against
  routed team" table in the evaluation lab, each with an `aria-label`.
- **`src/app/globals.css`:** table layout, and colours for correct and misrouted cells.

## How it was checked

- **Wringer:** the declared check failed before the work and passed after, in fresh
  clones with `npm ci`. An independent judge session agreed that the requirement was
  met.
- **Fresh-clone audit:** run as the page printed it, `wringer-drive audit --bundle
  .wringer/deliveries/contained-c28e85e4e7429e6e5c5243b2`. It passed all six checks:
  portable journal and authority; candidate source; red first, then green; independent
  judge; measured engineering; and the source-credential review, with 2 exact
  decisions carried.
- **ZenJev's own gates on the delivered branch** (not run by Wringer): `lint` exit 0,
  `typecheck` exit 0, and `tests/domain.test.ts`, `tests/routing-breakdown.test.ts`,
  `tests/providers.test.ts` and `tests/gitlab.test.ts`, 90 of 90.
- **The person's review:** the page showed the four files and the patch before Send.
  Claude read the domain change and the table markup, acting for Marc.

## What this does not show

- No independent human approved, reviewed or audited it, and nothing was contained.
- The browser, persistence and production-build gates were not run on the change.
- The source-review exceptions are a delegated agent's assertions that the matches
  are fixture strings. They are not a secret-free certificate.
- Attempt 1's stuck job stays recorded as it is.
- These fixes were made after attempt 1 and are in 1.0.0-alpha.45, not in the release
  the run began on. A third attempt on the released alpha.45 has not been made.
