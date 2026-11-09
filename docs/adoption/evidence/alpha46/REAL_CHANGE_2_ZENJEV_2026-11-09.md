# The second real change through Wringer: ZenJev, 9 November 2026

The second real feature Wringer carried end to end, about an hour after
[the first](../alpha45/REAL_CHANGE_ZENJEV_2026-11-09.md). Codex was the worker and Claude
the independent judge, so the worker and judge came from different vendors. Claude ran
it acting for Marc on his instruction. That makes it a delegated AI operator's run, and
no independent human made or reviewed these decisions.

## What was asked

- **Repository:** the same local ZenJev clone, delivering to its local bare origin. The
  first change (`bcfc709`) had been merged into its `main`.
- **Feature:** "In the evaluation lab, let a support lead export the saved evaluation as
  a CSV file: one row per saved prediction with its labelled team, the team the lab
  would route it to at the current threshold, the confidence, whether it was right, the
  engineering label and score, and any error. … Cells must be quoted where needed and
  must never start a spreadsheet formula."
- **Failing test first:** committed as `de1c96f` before the job.
  `tests/evaluation-export.test.ts` (4 cases) covers row order and routing, quoting of
  commas, quotes and line breaks, formula prefixes for `=`, `+`, `-` and `@`, an empty
  export and threshold bounds.
- **Gate:** `evaluation-export` was added to ZenJev's `.wringer.yaml`.
- **Checking the test:** a throwaway reference implementation in a scratch copy passed
  it (28 of 28 with the existing domain tests). The worker never saw it.
- **Agents:** the worker was `codex-acp` 2.6.0 on Marc's Codex login; this was the first
  live job at the version alpha.44 pinned. The judge was `claude-agent-acp` 0.101.1 on
  Marc's Claude login. Both ran trusted-local, with nothing contained, and `npm ci`
  ran in each fresh clone.

## What happened

| Time (UTC) | Step |
| --- | --- |
| 20:33:26 | Approved on the job page |
| 20:39:46 | Stopped at source-history review, 6.3 minutes later. By then the red baseline, the worker, the candidate checks and the judge had all run. |
| 20:40:16 | The job page listed both matches as `tests/domain.test.ts · looks like: provider-sk`, without values. A reason was given for each, as a delegated agent, and one click recorded them. |
| 20:40:26 | The handover was prepared again and Send was offered |
| 20:40:31 | Sent |

This was the stop that, in the first run, needed an internal command, a controller
path and a hand-written private decisions file. This time it took one panel and about
30 seconds. The run used 2 of 8 agent sessions (1 worker, 1 judge) and 2 of 8
verification attempts.

## What was delivered

The branch `wringer/job/71250390-310c-8793-b586-f3924d2b54bc` carries the candidate
`ed5c58d` and the evidence commit `78f4a3d`. It changes 4 files, +72 −2:

- **`src/domain/export.ts` (new):** `evaluationCsv`. It uses the lab's own `routedTeam`,
  so the file matches what the lab shows. It quotes as the CSV format requires and
  prefixes formula-like cells, including those behind leading spaces or control
  characters.
- **`src/domain/index.ts`:** the export.
- **`src/server/api.ts`:** `GET /api/evaluation/:id/export`. A demo user sees only
  synthetic runs. The route returns 404 for an unknown run and 400 for a bad threshold,
  sends `text/csv` as a download, and falls back to the current labels when the run
  stored none.
- **`src/components/workbench.tsx`:** an export control in the evaluation lab.

## How it was checked

- **Wringer:** the declared check failed before the work and passed after. The
  independent judge agreed.
- **Fresh-clone audit:** passed all six checks, including the source-credential review
  with 2 exact decisions carried.
- **ZenJev's own gates on the delivered branch** (not run by Wringer): `lint` exit 0,
  `typecheck` exit 0, and the domain, routing, export, provider and GitLab suites, 94
  of 94.

## What this does not show

- No independent human approved, reviewed or audited it, and nothing was contained.
- The new API route was not exercised. ZenJev's persistence and browser gates need its
  database services and were not run.
- The decisions were not offered again from the first run's. Those were recorded with
  the command-line route, in another folder, before the job page kept decisions per
  workspace.
- The run used a build of the alpha.46 source, not a published release.
