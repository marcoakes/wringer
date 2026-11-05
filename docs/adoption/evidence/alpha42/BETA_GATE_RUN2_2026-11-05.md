# 1.0.0-beta.1 gate, run 2: 5 November 2026

**Result: FAIL.**
- Both journeys failed step 1 (Install). The published alpha.42 installer refuses to install or upgrade on a computer that has already run a job (F10).
- Marc chose to continue on a separate installation. There, steps 2 to 8 passed in both journeys:
  - The Claude Code journey ran for the first time.
  - Codex reached the decision link without a workaround for the first time.
- 1.0.0-beta.1 was not tagged.

**Who ran it:** Claude (Opus 5.5), the delegated AI tester, acting as the person under Marc's ruling of 2026-10-01. This is not an independent human pass and not a blind PM pass. Every decision recorded the actor as "Claude (delegated tester for Marc)".

**Release under test:** v1.0.0-alpha.42 (`630ccdd`), downloaded from its GitHub release: archive sha256 `0d864fed…`, source `630ccdd`, clean. It was installed with `packaging/install.sh` taken from the tag (sha256 `3c94199e…`). That script is byte-identical to the copy GitHub serves at the tag, and unchanged since alpha.41.

**Criteria:** [BETA_GATE.md](../../BETA_GATE.md), unchanged since alpha.41.

## Calls Marc made
- **Rerun both journeys.** On 2026-11-05, before run 2, Marc typed "Yes, after alpha.42" in the gate session: rerun both journeys fresh once alpha.42 ships.
- **Go-ahead for the run.** Before any step, he typed "Yes, go ahead" in the gate session to six listed steps:
  1. Download alpha.42 and install it over the default alpha.34 installation.
  2. Add each project's local bare origin and push `main` to it.
  3. Apply setup for each project.
  4. Connect Claude Code at project scope. Connect Codex with `--auto-approve`, at project scope, or at user scope if Codex would not read the project's configuration.
  5. Run both clients non-interactively, plus each journey's worker and judge, on his Claude and ChatGPT plans.
  6. Approve, review and Send the two gate jobs in his Chrome.
- **Continue after step 1 failed.** He typed "Yes, continue": measure steps 2 to 8 on a separate installation (W1). Step 1 stays FAIL, so run 2 could not pass.

## Fixed before any client turn
- **Job intent:** the same as run 1: "Make slugify collapse runs of separators into a single dash and trim dashes from both ends, so the existing tests pass."
- **First message:** amended before any client turn.
  - alpha.42's `wring job new` now prints: "Tell your coding assistant your request and name this job, for example: "Please delegate this to Wringer on prepared job JOB_ID: YOUR REQUEST"".
  - Both first messages followed that form with run 1's request words: "Please delegate this to Wringer on prepared job JOB_ID: make slugify collapse runs of separators into a single dash and trim dashes from both ends, so the existing tests pass."
- **Later messages:** they said only what the person did: "I approved it on the page." and "I sent it from the page." The page offered no separate acceptance before Send, so run 1's "I accepted it on the page." was not used.

## Set-up
- **Project:** one fresh Bun project per journey, `textkit`, made from run 1's untouched fixture commit. It holds `src/slugify.ts` and four tests, of which `bun test` passes 2 and fails 2. The commits are `a3d6dd8` (Claude Code) and `beeec30` (Codex).
- **Source and destination:** a local-only source, with a bare `origin.git` beside each project holding `main`.
- **App directory:** the default, `~/Library/Application Support/Wringer`. It already held run 1's Codex job and the October attempt's unapproved job.
- **Existing installation:** alpha.34 at the default prefix, from 2026-10-01. Neither client's user configuration had a Wringer entry, because run 1's was removed that morning.
- **How commands ran:** as in run 1.
  - Each person command ran in a clean terminal-like environment, with the installed `bin` first on PATH and the desktop app's bundled Claude Code CLI available as `claude`.
  - Each run was logged with its time and exit code.
  - The raw logs stay on the test computer.
- **No extra instructions:** no `CLAUDE.md` or `AGENTS.md` exists in any parent folder or user folder.

## Pre-journey checks (2026-11-05)

| Check | Observed |
| --- | --- |
| Claude Code login | CLI 2.1.317. `claude auth status` reports logged in (claude.ai, Max), and a one-line `claude -p` call answered "OK" at 13:08:51Z. |
| Codex login | Codex CLI 0.153.4: "Logged in using ChatGPT". |
| Adapters | alpha.42 pins the same versions as alpha.41, already in the npx cache: `@agentclientprotocol/claude-agent-acp@0.65.0` and `@agentclientprotocol/codex-acp@1.10.0`. |
| Tools and disk | Bun 1.4.2, Git 2.50.1. 1.2 GiB free. |

## Journey A: Claude Code

- **Client:** Claude Code CLI 2.1.317, run non-interactively with `claude -p --output-format stream-json`. Each later message resumed the same session. The session reported model `claude-opus-5-5`.
- **Tool approval:** `-p` cannot answer tool prompts, so each run allowed only the Wringer server's tools (M2).
- **Worker and judge:** `claude-agent-acp` 0.65.0.

| # | Step | Result | What happened |
| --- | --- | --- | --- |
| 1 | Install | **FAIL** | **Preview (13:09Z):** the download and checksums verified, but it reported `"eligible": false` with the hold `unreadable-state-record`. Its Next said: "Stop running owners and reconcile the uncertain or unfinished work the holds name (wring recover --help)". No owner was running and no work was unfinished.<br>**Apply** with the preview's identity: exit 2, "STOP: Installation is held: unreadable-state-record". `wring --version` still reported alpha.34, and `wring recover --help` offers nothing for this hold. See F10.<br>**Workaround W1** (Marc's call): the same verified download went into a separate `--prefix`, with `--app-dir` pointed at a new empty folder. That preview was eligible with no holds and applied. `wring --version` then reported "Wringer native 1.0.0-alpha.42 (Bun 1.4.2)". |
| 2 | Setup | PASS | **Preview:** the documented trusted-local preview named `claude-agent-acp@0.65.0` for both roles and the `bun run test` check. It protected the test file and `package.json`, made `src` the only writable path, set 8 sessions and 3600 s, and said nothing is contained. It did not show the `--remote`/`--base` destination (N1).<br>**Apply:** with its identity and the tester's name, it recorded the workspace, the destination `origin`/`main` and the actor.<br>**`wring job check`:** started both agents and opened a session for each in 6 s, with no prompt. |
| 3 | Connect | PASS | **Job:** `wring job new` prepared the job and printed how to ask for it.<br>**Preview and apply:** the project-scope preview showed the two files it would create, `.mcp.json` and the skill. Applied, it reported `"verified": "exact-config-and-skill-bytes"`.<br>**Client trust:** after `wring job open`, `claude mcp list` showed the server as "⏸ Pending approval (run `claude` to approve)". This is Claude Code's own trust step, which Wringer's "Client trust/reload may still be required" leaves to the person (M1).<br>**Tool listing:** a separate `claude -p` session then loaded the server from the project and listed all 16 Wringer tools, calling none. |
| 4 | Ask | PASS | **Session:** fresh, given the first message only (13:20:07–13:21:08Z, 15 turns, no permission refusals).<br>**What the client did:** loaded the Wringer skill, called `inspect_setup`, read the prepared job with `get_status` and ran the tests itself (2 failing). It then validated the plan and recorded it on the prepared job with `revise_proposal`.<br>**Refusals:** its first two `revise_proposal` calls were refused, and it fixed both itself. It had lower-cased "Make" from the chat message ("A revision must preserve the original request verbatim"). Its criteria quotes then no longer matched the intent (N2).<br>**Link:** it gave the decision link once, exactly as the tool returned it. |
| 5 | Approve | PASS | The page showed the request, both outcomes, the pinned source, the file scope, the trusted-local warning and the destination. Approved at 13:22:14Z, 66 s after the link. The decision records "Claude (delegated tester for Marc)". |
| 6 | Work | PASS | Approval started the work by itself. The carried journal shows:<br>• 13:22:16Z: the check failed on the approved source (`acceptance-red`).<br>• 13:22:34Z: the worker finished, and the check passed, with 4 pass and 0 fail.<br>• 13:22:59Z: the judge marked both outcomes met.<br>Review-ready came 43 s after approval, using 2 of 8 sessions. |
| 7 | Review and Send | PASS | **Page:** "Ready to send this change?", with the one-file diff (`src/slugify.ts`, +4 −1, compared with the approved source), both outcomes met, and "Before the work, on the approved source, it failed."<br>**Send:** the tester read the diff, which was correct and in scope. It sent from the page at 13:25:15Z, 136 s after review-ready. The review branch reached the local origin, and `main` was unchanged.<br>**Warning:** Claude Code warned the person, before and after Send, that two identifiers in the report "don't match" (F11). |
| 8 | Audit | PASS | The page prints a fresh-clone route: clone the review branch with `--no-local`, then run `wringer-drive audit --bundle …`. It printed "Trusted-local delivery audit passed", and checked red first then green and the independent judge. It carried "Ran on this computer under the operator's account; nothing was contained." |

- **Decision waits:** approval 66 s. Send came 136 s after review-ready, and 108 s after Claude Code reported it.
- **Wringer sessions:** 2 of 8 (1 worker, 1 judge).
- **Claude Code client:** four `-p` runs (tool listing 1 turn, ask 15, after approval 8, after Send 5), plus the one-line login check. Together they used 58 input tokens, 932,542 cache-read, 49,121 cache-write and 7,922 output tokens.
- **Worker and judge usage:** not reported to Wringer.

## Journey B: Codex

- **Client:** Codex CLI 0.153.4, run non-interactively with `codex exec --json`. Each later message resumed the same session with `codex exec resume`.
- **Worker and judge:** `codex-acp` 1.10.0.

| # | Step | Result | What happened |
| --- | --- | --- | --- |
| 1 | Install | **FAIL** | The same default-prefix preview, repeated at 13:27Z, now held on two counts:<br>• `unreadable-state-record`: journey A's job had added two more hard-linked records, so alpha.42 makes them itself (F10).<br>• `owner-running-close-before-switch`: journey A's owner was running, and no documented command stops it (F12).<br>The journey continued on the W1 installation. |
| 2 | Setup | PASS | The same documented preview with `codex-acp@1.10.0` for both roles, applied. `wring job check` opened both sessions in 3 s. |
| 3 | Connect | PASS | **Job:** `wring job new` prepared the job.<br>**Project scope:** the preview with `--auto-approve` showed `.codex/config.toml` with `default_tools_approval_mode = "approve"` (F2's fix) and the skill. It applied and verified. But `codex mcp list` did not list the server: Codex reads a project's configuration only in a trusted folder, and this folder was new. TRUSTED_LOCAL says `wring connect` "says so before writing anything", but the preview only said "Client trust/reload may still be required" (F13).<br>**User scope:** the tester took the documented route (M3). It removed the project entry with `wring connect … --remove`, then connected with `--scope user --auto-approve` (preview, apply, verified).<br>**Tool listing:** Codex then listed the server, and a separate session listed all 16 Wringer tools, calling none. |
| 4 | Ask | PASS | **Session:** fresh, given the first message only (13:30:41–13:32:55Z).<br>**What the client did:** read the skill, then called `get_status` on the prepared job, `inspect_setup`, `list_jobs`, `get_evidence` and `validate_proposal`, then `revise_proposal`. Every write tool ran without an approval refusal.<br>**Refusal:** one `revise_proposal` was refused for a non-UUID idempotency key, as in run 1, and Codex corrected it.<br>**Link:** it gave the decision link once, exactly as the tool returned it. |
| 5 | Approve | PASS | The page showed the request, both outcomes, source `beeec30`, the file scope and the destination. Approved at 13:33:40Z, 45 s after the link. The decision records "Claude (delegated tester for Marc)". |
| 6 | Work | PASS | The journal shows:<br>• 13:33:42Z: the check failed on the approved source.<br>• 13:34:34Z: the worker finished, and the check passed, with 4 pass and 0 fail.<br>• 13:35:24Z: the judge marked both outcomes met.<br>Review-ready came 102 s after approval, using 2 of 8 sessions. Codex's last status read came just before that. It ended its turn at 13:35:42Z, saying the job continues independently (N3). The person saw it was ready with `wring job status`. |
| 7 | Review and Send | PASS | The page showed the one-line diff (`src/slugify.ts`, +1 −1), both outcomes met, and the failing run before the work. Sent from the page at 13:36:38Z, 74 s after review-ready. The review branch reached the local origin, and `main` was unchanged. |
| 8 | Audit | PASS | The page's printed fresh-clone route printed "Trusted-local delivery audit passed", with the same checks and the trusted-local sentence. |

- **Decision waits:** approval 45 s. Send came 74 s after review-ready.
- **Wringer sessions:** 2 of 8 (1 worker, 1 judge).
- **Codex client:** four runs (tool listing, ask, after approval, after Send). Together they used 802,825 input tokens (711,552 cached), 3,924 output and 1,329 reasoning tokens.

## Workarounds and method notes
- **W1 (step 1, both journeys): a separate installation that skips the state check.**
  - The same verified download went into a separate `--prefix`, with `--app-dir` pointed at a new empty folder so the installer's state check passed.
  - Both flags are documented, but pointing the check at an empty folder skips it. This was safe only because the real check had found nothing else wrong. Neither the hold nor its Next points to this route.
  - The journeys used the default application directory, and the default installation stayed at alpha.34.
- **M1 (Claude Code step 3): approving the project's server.**
  - Claude Code asks the person to approve a project's MCP server in its interactive app. The tester cannot answer that prompt.
  - Instead, it recorded the same choice in the project's own `.claude/settings.local.json` (`"enabledMcpjsonServers": ["wringer"]`).
  - `claude mcp list` still said pending, but every `-p` session loaded the server. Whether `-p` needed the setting was not measured.
- **M2 (Claude Code, every run): allowing only the Wringer tools.** `--allowedTools mcp__wringer` stands in for the person approving each tool prompt. Wringer leaves Claude Code's tool approval to the client.
- **M3 (Codex step 3): user scope.** The tester used the documented user scope instead of project scope, because the folder was not trusted. This is not a workaround: TRUSTED_LOCAL and CLIENTS.md both describe it.

## Findings for the next release

| # | Step | Finding | Evidence and fix |
| --- | --- | --- | --- |
| F10 | 1 | **The installer refuses every computer that has run a job.**<br>• Each captured candidate is published by `link(pending, recordPath)` (`packages/runtime/src/source.ts:208-210`). That leaves `capture.json` and `attempt-*/capture.pending.json` as one file with two names.<br>• The installer's state check reads every state record through `ownedFile`, which refuses a link count other than 1 (`packages/cli/src/installation.ts:29`). It reports this as `unreadable-state-record`, without the path (line 84).<br>• alpha.41 has the same code. Run 1 missed it because its separate installation ran before the job.<br>• The state check runs for every action, so by the code, rollback and uninstall are held too (not measured).<br>• CI's upgrade check starts from an empty home folder, so it cannot see this. | **Evidence:** a read-only replay of the check named exactly the two names of run 1's capture, and later also journey A's.<br>**Fix:**<br>• Publish the record by rename, or remove the pending name after linking.<br>• Let the state check accept the pairs already on people's computers.<br>• Name the path in the hold, and give a next step that applies.<br>• Add an installer test and a CI upgrade case that carry a finished job's state. |
| F11 | 7 | **Internal controller IDs reach the person.**<br>• The evidence view gives a workspace ID (`579c568d…`) that is not the connected workspace (`f499fb75…`).<br>• Each review branch is named after an internal job ID (`job-1ff33a59…`, `job-afbf8ab5…`) that appears nowhere else.<br>• Claude Code warned the person, before and after Send, that these "don't match" and are "unexplained". | Name branches and views after the person's job, or explain the internal IDs where they appear. |
| F12 | 1 | **No documented command stops an owner**, though the installer's hold says "Stop running owners". `wring job open` starts a detached owner that keeps running. | Add a command that stops a workspace's owner, and name it in the hold's Next. |
| F13 | 3 | **`wring connect --client codex --scope project` does not say the folder is untrusted.** TRUSTED_LOCAL says connect "says so before writing anything". The preview gave only the general "Client trust/reload may still be required", and Codex then ignored the entry. | Check whether Codex trusts the folder, and say so in the preview with the two ways forward. Or correct the documentation. |
| F6 | 7–8 | **Still partly open.** The audit headline now says trusted-local. But each delivery is still named `contained-…`, and its evidence commit message reads "Wringer contained evidence contained-…". | Name trusted-local deliveries and their evidence commits for what they are. |
| F14 | — | **`wring connect --remove` leaves things behind.**<br>• After a removal it still prints connect's next step: "Start the operator owner with wring job open, then reload the client and inspect its MCP tools".<br>• It leaves behind what connect created: empty skill folders, and a project `.codex/config.toml` reduced to a single newline. | Print a next step that fits a removal. Remove what connect created when nothing else is in it. |

Smaller notes:
- **N1 (step 2):** the setup preview does not show the `--remote`/`--base` destination it will record. The approval page does.
- **N2 (step 4):** Claude Code rewrote the request in the person's chat wording ("make", not "Make"). It was refused twice before it matched the request exactly, and it recovered unaided.
- **N3 (step 6):** Codex stopped watching after two 25-second waits, just before the job was ready, as the skill allows. The person had to look at the page or the status.
- **N4 (step 4):** Codex again used a non-UUID idempotency key first. The tool's schema could say that it must be a UUID, or accept any string. Codex also asked `get_evidence` for 16000 characters, was refused (the limit is 8192), and corrected it.

## Fixed since run 1 (observed in this run)
- **F1:** the default-prefix preview from alpha.34 raised no `target-lacks-compatible-record` hold. F10 held the upgrade before it could apply.
- **F2:** `--auto-approve` writes `"approve"`, and `codex exec` ran every Wringer write tool.
- **F3:** `wring job new` prints the job and how to ask for it, and the prepared job's status names `revise` as the next action. Both clients recorded the plan on the prepared job instead of adding a second job.
- **F4:** `wring job open --print` is documented. It was not needed, because the default browser was used.
- **F5:** the page states "Before the work, on the approved source, it failed."
- **F7:** the Send section explains which tree and commit it sends.
- **F8:** the skill says not to call a trusted-local job or its delivery contained.
- **F9:** neither client called `wringer.start`. Codex read that approval had already started the work.

## What worked
- **Claude Code**, for the first time, went from a plain request to a sent, audited change with no help: 5 minutes from the first message to Send.
- **Codex** needed no workaround after the install, and gave the decision link once, unedited.
- **Judges and audits:** both judges marked both outcomes met. Both audits passed from fresh clones, including the red-first-then-green check.
- **Decision waits:** no decision waited more than 136 s on the person. Blind test 2's baseline is about 20 minutes.

## Not established
- Interactive Claude Code or Codex: whether a person answering the client's own prompts completes steps 3 and 4 unaided.
- Codex with project scope in a trusted folder.
- Whether `claude -p` needed M1's setting.
- Installer rollback and uninstall with hard-linked records.
- An independent person's experience. One AI tester ran every step.
