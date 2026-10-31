# Newcomer door review, 2026-10-31

An end-to-end walk of both doors on the 1.0.0-alpha.39 source, following the
written instructions literally in a scratch project with a scratch `HOME`, then
reading the code behind each thing that broke or dragged.

**What this is:** one engineering walk by Claude, driving the CLI, MCP over stdio
and the real job page in a browser. **What it is not:** a blind test, a human
pass, or a live model run. No model was called: the walk stopped at the worker
stage with the adapter launcher stubbed. Worker, judge, review, Send and audit
after that point are covered only by the scripted rehearsals, which passed.

## Findings and repairs

| # | What a newcomer met | Repair |
|---|---|---|
| 1 | The agent door never started the owner. The client's first call died with a raw `ENOENT … lstat …/owners`. | `wring mcp` names `wring job open --workspace ID`; `wring connect` says so in its JSON too; the docs carry the step. |
| 2 | The door's first command refused any repository without `src`, `app` or `lib`, and pointed at `wring --help`. | The refusal names `--writable PATH`, lists what is tracked and points at `wring setup --help`. |
| 3 | The door's command chose no destination. A person could finish and accept a job, then read "Nothing can be sent". | Setup's preview says so before anything is kept, the approval page says so, the help lists `--remote` and `--base`, and the docs use them. |
| 4 | Nothing said a new requirement needs a check that fails today. `validate_proposal` said eligible, the person approved, then the job stopped. | The docs and tool descriptions say so first. The stop tells the person what to do, without controller paths. Committing a failing test before `wring job new` was walked and reaches a red baseline. |
| 5 | The decision link opened a locked page that did not say how to unlock it, and reopening the private link in that tab did nothing. | The locked page names the command, and the same tab unlocks on a fragment-only navigation. |
| 6 | `wring job new` then an immediate `wringer.propose`, with an owner running, failed as `response-unconfirmed`: a one-second connection race hidden behind a message about uncertain work. | A newly prepared job is connected on demand. |
| 7 | The door's `wringer.propose` left the placeholder from `wring job new` beside the real job, with an identical name. | The docs revise that job. A replaced proposal leaves the picker, and repeated names carry a time. |
| 8 | A worker adapter that could not start showed only "The worker stopped (transport-closed)". | The stop quotes what the launcher printed, redacted, and says what to check. Once an agent has answered, its console stays private. |
| 9 | MCP shape refusals named no field, though the tool description promised they would. | They name the missing, unknown or invalid field and never repeat the supplied value. |
| 10 | The job page showed each stop twice and kept "Checking the recorded outcome…" after the outcome was on screen. | Each is shown once, and the notice clears. |
| 11 | `wring start` wrote `.wringer.yaml` and `.gitignore` without saying so, and always ended on `wringer-drive authority --help`. | It says what it wrote and gives the next step for the current state. A failed run no longer gets a tick. |
| 12 | `wring verify` buried the result, named no failed check, printed empty sections and sent both red and green runs to `wringer-drive plan --help`. | The answer comes first, red points at `wring explain`, green at `wring setup --help`. |
| 13 | `wring deliver` refused a green record with no reason. `wring explain` printed its next step twice. `wring demo` printed an evidence path relative to a folder the reader was not in. | Each is fixed. |

Every repair went red first and is guarded by
[isolated reversions](../rebuild/evidence/door-guards/reversions.json), 27 of 27
caught, run by `bun scripts/door-guards.ts`.

## Still open

- **No live run.** The beta gate and live measurements still wait on a signed-in
  Claude Code and Codex. This review does not move them.
- **Other stops read like records.** Only the already-passing-check stop has
  person-first wording on the job page. The card under a stop still says "Read the
  recorded next action above" when there may be none.
- **Unknown rows remain.** A plain `wring verify` keeps its four "unknown" rows,
  which are accurate and long.
- **`QUICKSTART.md` leads with the contained operator route**, not the
  trusted-local door.
- **An agent cannot see a born-green check before approval.** Setup and validation
  run no project code, by design, so the stop still comes after the person approves.
  It costs no worker turn, but it does cost their attention.
