# 1.0.0-beta.1 gate, run 1: 3 and 4 November 2026

**Result: FAIL.**
- The Codex journey failed step 1 (Install) and step 4 (Ask).
- The Claude Code journey was not started. This computer's Claude Code login had expired, and signing in is Marc's action.
- 1.0.0-beta.1 was not tagged.

**Who ran it:** Claude (Opus 5.5), the delegated AI tester acting as the person under Marc's ruling of 2026-10-01. This is not an independent human pass and not a blind PM pass. Every decision recorded the actor as "Claude (delegated tester for Marc)".

**Release under test:** v1.0.0-alpha.41 (`7629796`), downloaded from its GitHub release. It was installed with `packaging/install.sh` taken from the tag (sha256 `3c94199e…`, byte-identical to the copy GitHub serves at the tag).

**Criteria:** [BETA_GATE.md](../../BETA_GATE.md), unchanged.

## Calls Marc made before any result
- BETA_GATE.md lists Claude Code first. Marc chose to run Codex first because the Claude Code login had expired: "Yes, start Codex" (2026-11-03).
- After step 1 failed, he chose to continue the Codex journey on a separate installation, so steps 2–8 would be measured before alpha.42 (2026-11-04). Step 1 stays FAIL.
- In the gate session, in his own words: "Yes: add the Codex project's local origin and push main to it, apply setup, connect Codex with --scope user --replace, run Codex, and approve and Send the gate job in my Chrome."

## Fixed before any client turn
- Job intent: "Make slugify collapse runs of separators into a single dash and trim dashes from both ends, so the existing tests pass."
- First message to the client: "Please delegate this to Wringer: make slugify collapse runs of separators into a single dash and trim dashes from both ends, so the existing tests pass."
- Later messages to the client say only what the person did, for example "I approved it on the page." The one exception is recorded under step 4.

## Set-up
- **Project:** one fresh Bun project per journey, `textkit`. It has one commit: `src/slugify.ts` plus four tests, of which `bun test` passes 2 and fails 2, with `packageManager: bun@1.4.2`.
- **Source and destination:** a local-only source, with a bare `origin.git` beside it holding `main`.
- **App directory:** the default, `~/Library/Application Support/Wringer`. It already held one workspace and one unapproved job from the October attempt. Neither was touched.
- **How commands ran:** each person command ran in a clean terminal-like environment: HOME, USER, LOGNAME, SHELL, LANG, TERM, TMPDIR, and a PATH with the installed `bin` first. None of the desktop app session's own variables were passed. Each run was logged with its time and exit code. The raw logs stay on the test computer, because they contain machine paths and an owner connection path.
- **Tester's own permission check:** it refused to add the local origin until Marc approved it in the gate session. This is not a product issue.

## Pre-journey checks (2026-11-03)

| Check | Observed |
| --- | --- |
| Claude Code login the adapter uses | `claude auth status` (CLI 2.1.309, bundled with the desktop app; `claude` is not on PATH) reports logged in. But a one-line model call at 21:23:52Z returned "Failed to authenticate: OAuth session expired and could not be refreshed". This is the same failure as 2026-10-01, so journey B stops for Marc. |
| Codex login | `codex login status` reports "Logged in using ChatGPT" (Codex CLI 0.153.4). |
| Adapters | Already in the npx cache at the pinned versions: `@agentclientprotocol/codex-acp@1.10.0` (with `@openai/codex` 0.153.4) and `@agentclientprotocol/claude-agent-acp@0.65.0` (with `claude-agent-sdk` 0.3.220). |
| Existing state | alpha.34 at the default prefix, installed 2026-10-01. A user-level `wringer` server in `~/.codex/config.toml` that points at a September development controller. |

## Journey A: Codex (run first)

- **Client:** Codex CLI 0.153.4, run non-interactively with `codex exec --json`. The tester cannot answer the interactive app's prompts. Model and effort came from the user's Codex configuration.
- **Worker and judge:** `codex-acp` 1.10.0.

| # | Step | Result | What happened |
| --- | --- | --- | --- |
| 1 | Install | **FAIL** | **Preview (21:48Z):** the download and checksums verified, but it reported `"eligible": false` with the hold `target-lacks-compatible-record:schema/frozen.json`.<br>**Apply** with the preview's identity: exit 2, "STOP: Installation is held: target-lacks-compatible-record:schema/frozen.json", then "Next: wring --help". `wring --version` still reported 1.0.0-alpha.34.<br>**Workaround W1** (next day, on Marc's call): the same verified download, installed into a separate `--prefix`. That preview was eligible and applied, and `wring --version` then reported "Wringer native 1.0.0-alpha.41 (Bun 1.4.2)". See F1. |
| 2 | Setup | PASS | The documented trusted-local preview used `codex-acp` for both roles and `--source local --dependencies none --writable src --remote origin --base main`. It named the adapters and the `bun run test` check, protected `package.json` and the test file, set 8 sessions and 3600 s, and said nothing is contained.<br>Applied with its identity and the tester's name, it registered the workspace and profile.<br>`wring job check` then started both agents and opened a session for each in 4 s, with no prompt. |
| 3 | Connect | PASS | `wring job new` prepared the job.<br>The project-scope `connect` preview warned, before writing anything, that the existing user-level `wringer` entry would win. It named both documented ways out.<br>The `--scope user --replace` preview showed the old and new entries and the two files it would write. Applied, it reported `"verified": "exact-config-and-skill-bytes"`, and a diff of the config showed only the `wringer` section had changed.<br>After `wring job open`, a separate Codex session listed all 16 Wringer tools and called none. |
| 4 | Ask | **FAIL** | **Attempt 1** (fresh session, the fixed message): Codex read the skill, called `inspect_setup`, then `validate_proposal` (valid), then `wringer.propose`. Codex itself refused the last call: "MCP tool call requires approval, but approval policy is never". No link was given.<br>**Attempt 2** (fresh session, tester override `default_tools_approval_mode="auto"`, which is the value `wring connect --auto-approve` writes): Codex found the prepared job through `list_jobs` and `get_status`, then called `revise_proposal`. It was refused the same way.<br>**Attempt 3** (attempt 2 resumed with the override `"approve"` and "I've allowed Wringer's tools now. Please try again."): `revise_proposal` was refused once for a non-UUID idempotency key, then succeeded, superseding the prepared job with an approvable one. Codex gave the decision link once, exactly as the tool returned it.<br>Workaround W2 is not in the documentation. See F2 and F3. |
| 5 | Approve | PASS | `wring job open` had opened the private page in the computer's default browser (Chrome), which unlocked it there, and the decision link opened in that same browser.<br>The page showed:<ul><li>the request and two required outcomes</li><li>the pinned source</li><li>writable `src/slugify.ts` and the protected files</li><li>the limits: 4 sessions, 15 minutes</li><li>the destination</li><li>"on this computer, nothing contained"</li></ul>Approved at 14:51:07Z, 65 s after the link. The page records "Claude (delegated tester for Marc)". See F4. |
| 6 | Work | PASS | Work started on approval (see F9). The `codex-acp` worker took about a minute and the judge under a minute. The job was review-ready about 108 s after approval, using 2 of 4 sessions and 2 of 4 check runs.<br>The candidate's `bun run test`: 4 pass, 0 fail. The audit's `red-first-and-green` check: "Every declared command failed before work and passed afterward." The page itself shows only the passing run (see F5).<br>After "I approved it on the page.", Codex waited with two bounded `wait_for_update` calls, then sent the person back to the page. |
| 7 | Review and Send | PASS | The page showed the one-line diff of `src/slugify.ts`. The tester read it: it collapses runs of non-alphanumerics and trims dashes from both ends.<br>Sent from the page at 14:54:28Z, about 90 s after review-ready. The page showed "Your handover is recorded" without a reload. The local bare origin gained the review branch, and `main` was unchanged. See F6 and F7. |
| 8 | Audit | PASS | The page's three printed commands ran in a new folder: `git clone --no-local --branch … 'reviewed-change'`, `cd 'reviewed-change'`, `wringer-drive audit --bundle …`.<br>The audit printed "Contained delivery audit passed", five checks, and "Ran on this computer under the operator's account; nothing was contained." See F6. |

**Decision waits on the person:** 65 s for approval and about 90 s for Send. Blind test 2's baseline was about 20 minutes.

**Sessions:**
- **Wringer roles:** 2 of 4 sessions (worker 1, judge 1) and 2 of 4 check runs.
- **Codex as the client:** five turns in three sessions (the tool list, attempt 1, and attempt 2 with its two resumes). That came to 1,612,209 input tokens, 1,504,512 of them cached, and 8,173 output tokens.
- **Worker and judge tokens:** not reported to Wringer; the page shows them as unknown.

## Journey B: Claude Code

**Not started.** The pre-journey check found the stored Claude Code login expired, and the gate stops for Marc to sign in. No step ran, and no client was connected.

## Workarounds
- **W1 (step 1):** install into a separate `--prefix`. The flag is documented, but neither the hold nor its "Next" points to it.
- **W2 (step 4):** a per-run Codex override, `mcp_servers.wringer.default_tools_approval_mode="approve"`, plus a request to try again. Neither is in Wringer's documentation.
- **Method, not product:**
  - commands ran in a clean environment;
  - Codex ran as `codex exec`;
  - Claude in Chrome operated the page in Marc's own Chrome, where `wring job open` put it.

## Findings for the next release

| # | Step | Finding | What would fix it |
| --- | --- | --- | --- |
| F1 | 1 | **Every upgrade across a release that added a schema is held.** `compatibility()` in `packages/cli/src/installation.ts` byte-compares every installed `schema/` file, including the index `schema/frozen.json`. That index grew in alpha.36, .37 and .38, so anyone on alpha.35 or earlier cannot upgrade. The STOP's "Next: wring --help" names no next step. | Fixed on main after this run but unreleased: `7895148`, guards `36c51b1`, and CI upgrading from every published release in `2e92891`. Still to check: that the STOP names a real next step. |
| F2 | 4 | **`codex exec` cannot record a proposal.** Under its non-interactive approval policy, Codex refuses Wringer's write tools. The documented connect writes no approval setting. `wring connect --auto-approve` writes `default_tools_approval_mode = "auto"`, and Codex 0.153.4 still asks under `"auto"` (attempt 2). Only `"approve"` worked (attempt 3). No page mentions client approvals. | Have `--auto-approve` write `"approve"` for the `wringer` server only, and test the value. Say in TRUSTED_LOCAL.md and START_AGENT.md that interactive Codex asks before each write tool and that `codex exec` needs `--auto-approve`. Show this in the connect preview. |
| F3 | 4 | **The assistant is not told about the job `wring job new` prepared.** `inspect_setup` returns no pending jobs. In attempt 1, Codex called `propose`, which would have added a second job beside the prepared one; in attempt 2, it found the job only through `list_jobs`. The never-proposed job's status reads phase `questions`, "Answer the recorded questions", though none were recorded. | Return the workspace's unapproved jobs (ID and revision) from `inspect_setup`, or print a sentence after `job new` for the person to give their assistant. Give a never-proposed job a status of its own. |
| F4 | 4–5 | **The private page opens only in the default browser.** `wring job open` hands the private link to `open` or `xdg-open` and never prints it, and `job serve` prints only the connection path. Any other browser stays locked, including whichever one opens the assistant's decision link. | Print the private link, marked private, or add a `--print` option, and say so in START_PM.md. |
| F5 | 6 | **The review page does not show the failing run before the work.** Only the candidate's passing run appears; the red-first evidence surfaces only in the audit. | Show the baseline result beside the candidate's under "What the checks establish". |
| F6 | 7–8 | **Trusted-local deliveries are named "contained".** The delivery is `contained-a218338…`, the evidence commit says "Wringer contained evidence …", and the audit headline reads "Contained delivery audit passed" directly above "nothing was contained". | Give trusted-local work a neutral delivery name and audit headline, with a sibling record if the frozen contract needs one. |
| F7 | 7 | **One result is shown with two identities.** The page shows "Candidate 7e1dbed1…: test passed" (the candidate commit) and "This sends the exact reviewed result: 587fede6…" (its tree), without saying which is which. | Label them, or show one. |
| F8 | 3–4 | **The workflow skill describes delegation as contained.** It says "propose a bounded contained Wringer job" and "A missing contained runtime is a provisioning decision, never permission to run managed roles on the host". Codex was not misled, but the text is wrong for a trusted-local workspace. | Add a trusted-local sentence to the skill. |
| F9 | 6 | **START_AGENT.md's loop says to call `wringer.start` after approval.** In fact approval started the work by itself; the page says "Work will start automatically". | Correct the loop text. |

## What worked
- Setup, `job check` and both connect previews were exact and readable, and connect caught the conflicting user entry before writing.
- Approval to review-ready took about 108 s and two sessions.
- The page updated immediately after Send. The October rehearsal saw a stale "underway" until the page was reloaded.
- The fresh-clone audit passed offline and says nothing was contained.

## Not established
- Whether interactive Codex, which asks before each write tool, lets a person complete step 4 unaided.
- Anything about Claude Code, as client or adapter, in this run.
- An independent person's experience: one AI tester ran every step.
