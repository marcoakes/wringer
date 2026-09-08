# Blind test 2 — FAIL; salvage INCOMPLETE

Date: 2026-09-08. This is a public, path-redacted account of the report Marc
supplied as `blind test 2 report.md`. The original report and captures remain
unchanged. Repairs below are **not** a revision of the blind verdict.

## Frozen condition

- Wringer `1.0.0-alpha.6`, commit
  `fbb8bb0abdbd191a7aaf7cd56673b560f45e9af9`; compiled at 19:13:05 UTC.
- Pre-provisioned Mac, fresh run, cooperative-local. Not clean-machine,
  protected-mode or independent outsider evidence.
- Person: Marc Oakes, the product author. Operator: Claude Code, builder-involved.
- Conversational front end: Codex CLI 0.153.4, model reported as `gpt-6-astra`.
  The product's printed MCP connection was used; per-server auto-approval was not.
- Apple Container; reused alpha.3 image. Codex ACP 1.10.0 worker and Claude ACP
  0.65.0 judge. No planner session.
- Approval: seven sessions, four worker/three judge, 300 seconds per session,
  1,800 seconds whole job. Only two sessions were used.
- Destination: a newly created local bare mirror, separate review branch into
  `main`. **Nothing was sent.**

## What happened

The documented credential preparation first produced a rejected OpenAI key.
The operator reported that the hidden `security` prompt had truncated the long
project key to 128 characters. A shell-variable route restored a successful
metadata response at 19:51 UTC. This is reported preparation evidence, not a
new credential measurement by the repair author.

The run clock began at 19:52:21. Setup had accepted an existing 0755 controller
directory which initialization rejected; the operator corrected it to 0700.
The assistant's first proposal was refused for intent mismatch and recovered
through the documented route. Its exact initial cause was not established.
Marc approved at 20:05:35 after two navigation hesitations. Accidentally closing
the coding-app window did not stop the execution owner or replay work.

Red-first checks recorded **0/6 before → 6/6 after**, with regression checks
passing. The worker took 57 seconds; the separate judge took 91 seconds and its
reply parsed on the first attempt. Human hold was reached at 20:10:46. The
display succeeded and showed both reports.

The console disconnected/reopening flow and the review page then cost the
person roughly twenty minutes of attention. His feedback included:

> how do i open these this needs to be more user friendly

> this needs to be a lot more simple and easy to use for a pm

At approximately 20:23, Marc supplied his name and the note **“it works”**, but
the browser had no Yes option. The blind phase ended **FAIL at the human verdict**.

Marc explicitly permitted salvage. The CLI recorded his actual positive
verdict and note; no extra agent session ran. At 20:25:13, handover preparation
failed with **“Runtime command output exceeded 64 MiB”**. The mirror was
unchanged, and a partial local delivery remained. The printed next command was
only `wringer-drive --help`. Salvage ended **INCOMPLETE**. End clock: 20:26:35;
the owner was stopped and the test's client connection removed at 20:27:03.

Elapsed: approximately 34 minutes, including 31 minutes to the blind stop.
Handover, send, carried fresh-clone audit and falsification were not reached by
this live PM run. Doctor read its last verification as passed.

## Findings and repair scope

| Finding | Cause or observation | Repair checkpoint |
| --- | --- | --- |
| F1: no positive human verdict | Malformed opening `option` tag in generated HTML. Earlier tests injected a verdict without using the real browser form. | Explicit, initially unselected Yes/No choices; real Chromium form-to-record regression. |
| F2: disconnected console/review | The fragment credential was removed from the address and retained only in a page closure, so reload lost access. | Bounded owner-lifetime browser session, explicit lock/logout, one-click console-to-review navigation. |
| PM decision buried | Evidence and controls competed with the one current decision. | Decision first; result beside the review; secondary evidence collapsed; single requirement needs no picker. |
| S-A: handover history overflow | Full `cat-file` contents crossed a generic 64 MiB capture buffer; `--all` also included unrelated/private delivery refs. | Bounded streaming inspection of the exact candidate's complete reachable history; secret checks remain fail-closed; repeated preparation tested. |
| S-A: unhelpful stop route | Generic help instead of the retained run. | Inspect the same run's status; never automatically resend an uncertain publication. |
| O1: long-key entry | Hidden system prompt reportedly truncated the key. | Remove that provisioning recipe; existing keys remain untouched; explain safe operator-only alternatives and their unmeasured limits. |
| O2: setup/init mismatch | Setup did not enforce the existing directory's ownership/0700 constraint. | Read-only setup reports the same prerequisite before initialization. |

Other observations stay visible: ACP session/authentication success did not
prove provider acceptance (O3); preparation needed a complete execution plan,
not a planning template (O4); the reused image's shell entrypoint affected an
operator's direct container invocation (O5). These are not silently converted
into proof of successful provider authentication or a newly measured image.

## Usage, not guessed cost

| Lane | Reported observation |
| --- | --- |
| Managed development/review | Two of seven sessions. Provider tokens not reported; cost unknown. |
| Coding app | 805,454 input tokens, including 791,936 cached; 1,189 output; six tool calls. Cost unknown. |
| Operator app | Not measured. |

## After the test

Marc authorized a repair pass. The [alpha.7 repair record](PM_BLIND2_REPAIR_2026-09-08.md)
separates its engineering measurements from this failed live test. A passing
scripted browser rehearsal is useful regression protection, not a person's
observation, successful live falsification, or a blind-test pass.
