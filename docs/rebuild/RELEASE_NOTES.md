Wringer 1.0.0-alpha.40 makes both front doors lead somewhere, lets a person see that
the coding agents start before approving a job, and tells each retry what the earlier
attempts did.

```sh
wring job open --workspace ID
wring job check --workspace ID
```

**The doors, walked.** Both doors were followed as written in a scratch project, and
13 dead ends were repaired ([the review](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.40/docs/adoption/DOOR_REVIEW_2026-10-31.md)).
Among them:

- The agent door's steps now start the owner and choose where accepted work is sent.
- The docs and tool descriptions say a new requirement needs a check that fails today.
- The locked job page names the command that unlocks it.
- A worker adapter that cannot start shows what its launcher printed, redacted.
- MCP refusals name the field at fault, never the value.
- `wring start`, `verify`, `deliver`, `explain` and `demo` lead with the answer and a
  next step that fits it.

**Check the agents before approving.** `wring job check --workspace ID` starts each
trusted-local role's adapter in a throwaway clone and opens a session. No prompt is
sent. The approval page shows the latest result, and says when approving now would
stop at that step. With codex-acp 1.10.0 and claude-agent-acp 0.65.0 the whole check
took 7 s. Opening a session cannot show that a sign-in still works.

**A stopped worker's edits are kept.** When a worker times out or stops unfinished,
its diff is saved beside its result and anchored in the journal, and the next attempt
is offered it. It is never a candidate, never checked and never delivered. A diff
that looks like it holds a credential, or is over 8 MiB, is named but not kept.

**Retries know what came before.** Each later attempt is told how earlier ones ended,
the paths they changed and which checks and judge findings failed. This is rebuilt
from the journal, not from the agent's own account.

**Off macOS 14.** GitHub retired its macOS 14 runners on 2 November 2026. The macOS
archive is now built on macOS 15, whose system Git is still Apple Git 2.39, and the
tests run there on every push. The archives' minimum macOS is set by Bun and did not
change.

**Known issue: Send can be slow on a slow Mac.** On GitHub's macOS 15 runners, Send
on a design job took 24–28 s, and over 40 s with a local source. On macOS 26 it took
14–15 s. The job page gives up on a decision after 45 s, so on a slow enough machine
it can show an error while the Send is still being accepted. That is why this
release's rehearsals ran on macOS 26. It is not fixed in this release.

**How it was tested.** Scripted agents and checks on real Git; a journey with a real
worker process that stops, a retry, Send and a fresh-clone audit; and the job page in
Chromium. 55 guards were each removed alone:

- 54 turned their tests red on the first run.
- One stayed green because its test read the text without checking it was shown.
  The test now checks, and it goes red.

**Not measured:** a live model run, or whether kept edits and the attempt record save
any turns. On Apple Container and gVisor the stop-and-keep route is covered only with
a scripted driver.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. GitHub publication does not itself
publish an npm package, Homebrew tap or MCP registry listing. The documented
cooperative-local operator boundary remains.

[Start from your coding agent](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.40/docs/START_AGENT.md)
· [Trusted-local](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.40/docs/native/TRUSTED_LOCAL.md)
· [Previous release: learn and show](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.39)
