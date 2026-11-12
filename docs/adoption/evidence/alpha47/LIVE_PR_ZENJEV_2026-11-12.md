# The first real pull requests opened by Wringer: ZenJev on GitHub, 12 November 2026

On 12 November 2026 the published Wringer 1.0.0-alpha.47 carried a real change to
ZenJev, an npm repository on GitHub, from an approved request to an open pull request
whose description is the job's evidence. It ran twice. The first pull request's CI could
not start because of a mistake in the check Claude wrote before the job; the second,
[marcoakes/ZenJev#2](https://github.com/marcoakes/ZenJev/pull/2), passes ZenJev's own
CI. Claude ran both acting for Marc, with Marc's own logins, on his computer, and
nothing was contained. No independent human approved, reviewed or sent either.

## What was asked

"In the evaluation lab, report the development and held-out splits apart, so a support
lead tuning the routing threshold sees how routing does on tickets it was not tuned
against." A ticket's split is its label's split, else the saved prediction's split,
else the split of its related incident (the label's incident first), else it is
unassigned. The function is `evaluateBySplit(predictions, labels, threshold)` in
`src/domain/splits.ts`, returning the lab's own `evaluateSaved` result for each split
and the IDs of unassigned tickets. The lab shows each split's routing precision,
coverage and ticket count.

Before the job, a failing test and its check were committed on a fresh clone of
GitHub's `main`: `tests/evaluation-splits.test.ts`, gate `evaluation-splits`. It failed
because the module did not exist, and a reference implementation in a throwaway copy
passed all five of its tests, so the test could be met. The commit was not pushed to
`main`; it reached GitHub inside each pull request.

## How it was set up

- **Install:** the published alpha.47 macOS arm64 archive, from the release's own
  verified download, installed with `packaging/install.sh` into a separate prefix and
  application folder. `wring --version` printed `1.0.0-alpha.47`.
- **Setup:** trusted-local, worker `claude-agent-acp` 0.101.1 (Claude), judge
  `codex-acp` 2.6.0 (Codex), `--dependencies npm-ci`, `--writable src`, `--remote
  origin` (`https://github.com/marcoakes/ZenJev.git`) `--base main`, and `--forge github
  --forge-repo marcoakes/ZenJev --forge-token-env WRINGER_ZENJEV_TOKEN`. The preview
  named the pull request Send would open and the variable holding the token.
- **Token:** the computer's existing GitHub CLI login, read into
  `WRINGER_ZENJEV_TOKEN` in the environment of `wring job open` and never printed.
  No token was created.
- `wring job check` started both agents and opened a session with each, with no prompt.

## Run 1: pull request #1

| Time (UTC) | Step |
| --- | --- |
| 15:44:53 | Approved on the job page, as "Claude (acting for Marc)" |
| 15:50:14 | Stopped at source-history review, 5.3 minutes later. By then the red baseline, one worker session, the candidate check and one judge session had run, each accepted on its first turn. |
| 15:51:30 | The page listed two matches, both `tests/domain.test.ts · looks like: provider-sk`, without values. Claude first checked them in the clone with values masked: they are the redaction test's fake key, in the file's two versions, already public on ZenJev's `main`. A reason was given for each, as a delegated agent, and one click recorded them. |
| 15:51:40 | The handover was prepared again. The page asked "Send this exact prepared change to the destination below and open its GitHub pull request?" and showed the change, 6 files. Claude read the patch before sending. |
| 15:52:51 | Sent |
| 15:53:02 | GitHub created pull request #1 (its own timestamp) |
| 15:53:06 | The page showed the handover: "The reviewed change was sent and its pull request is open", with the link and the fresh-clone audit route |

The pull request's body, read back from GitHub, was byte for byte the `mr.md` in a fresh
clone of the pushed branch, and that clone passed `wringer-drive audit`.

**ZenJev's CI failed on it, and the cause was Claude's, not the worker's.** ZenJev's CI
builds Wringer at `7ca2fb5` (alpha.14, September) and verifies the repository with it.
The new check carried an `inputs:` key, which Wringer accepts since alpha.19 and
alpha.14 refuses: `gate: unknown key inputs`. Changing the delivered branch by hand
would have made the pull request differ from what was audited, so the key was removed
from the test commit, the job was run again, and #1 was closed as superseded by #2.

## Run 2: pull request #2

The same workspace, a new job on the corrected commit `ee8459f`.

| Time (UTC) | Step |
| --- | --- |
| 15:58:52 | Approved on the job page |
| 16:01:52 | Stopped at source-history review, 3.0 minutes later; one worker and one judge session, each accepted on its first turn |
| 16:02:22 | **The earlier decision was offered again, not applied.** Both matches showed run 1's reason in the reason field with "Decided before by Claude (acting for Marc) … for these exact bytes. Read it again before you accept it." The reasons still held, and one click recorded them. |
| 16:02:32 | Send was offered; the change, 6 files, was read before sending |
| 16:03:12 | Sent |
| 16:03:23 | GitHub created pull request #2 |

Approval to open pull request took 4 minutes 31 seconds.

The second worker went further than the first: it reads the newest saved run of each
split for the task, so both splits are filled although the lab evaluates one split per
run, and it applies the same synthetic-only rule for demo users as the existing run
listing. The change is 6 files, +45 −7:

- `src/domain/splits.ts` (new): `splitOf` and `evaluateBySplit`, over the lab's
  `evaluateSaved`; `src/domain/index.ts` exports them.
- `src/server/workflows.ts`: `splitMetricsFor(run, syntheticOnly)`, read-only, which
  evaluates the newest run of each split at the current run's threshold.
- `src/server/api.ts`: the evaluation responses add `splitMetrics`.
- `src/components/api-types.ts`, `src/components/workbench.tsx`: a table of overall,
  development and held-out routing precision, coverage and tickets, with unassigned
  tickets counted.

## How it was checked

- **The description is the evidence.** Each pull request's body, read back from GitHub,
  is byte for byte the `mr.md` in a fresh clone of its pushed branch (5,038 bytes each).
- **Audit from a fresh clone of GitHub's branch**, with the published alpha.47
  `wringer-drive audit`: passed for both, six checks each, including the source-history
  review, whose two decisions it recomputed.
- **The token is in no record.** A search for its exact value found it in none of the
  application folder, the clones' Git directories, the audit clones or the run logs.
- **ZenJev's own CI passed on #2,** on the push and the pull request
  ([run](https://github.com/marcoakes/ZenJev/actions/runs/43254479695)), including its
  native persistence, recovery and production browser verification.

## What these runs found

1. **The same public fixture stops each new workspace once.** Source review scans the
   complete history the candidate carries, and ZenJev's redaction test holds a fake
   provider key. Within one workspace, alpha.46's carried decision made the second stop
   a matter of reading the earlier reason and confirming it. A new workspace asks again.
2. **A check file can be newer than the Wringer a project's CI pins.** Wringer alpha.47
   accepted the `inputs:` key; ZenJev's CI, on alpha.14, refused it. Wringer's own
   `wring init` writes `inputs:` too. A project that verifies with an older Wringer
   needs its check file kept to the keys that version reads.
3. **The audit route names `wringer-drive`,** which the installer puts in its prefix but
   not on the PATH, by design. The route works as `PREFIX/bin/wringer-drive`.

## What this does not show

- No independent human approved, reviewed or sent either; Claude acted for Marc.
- Nothing was contained: the roles and checks ran under Marc's account.
- GitLab merge requests remain covered by tests only.
- Pull request #2 is open, not merged; opening a review request is not a merge or a
  deployment.
