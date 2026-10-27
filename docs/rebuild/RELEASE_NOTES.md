Wringer 1.0.0-alpha.38 lets an agent propose a better way of working from what earlier
attempts actually did, puts it where the worker finds it, and keeps a record of what
each test of it established. It carries the never-published alpha.37 as well.

```sh
wring experiment evidence --job JOB_ID --replicate-set ID --proposal ID
wring experiment propose --job JOB_ID --proposal ID --request proposal-request.json --yes
wring experiment select-tree --source CHECKOUT --manifest wringer/playbooks/ID/manifest.json
```

**Playbook trees.** A version 6 plan selects `wringer/playbooks/<id>/`: one always-on
file (`CLAUDE.md`, `AGENTS.md` or `PLAYBOOK.md`, at most 8 KiB), skills, scripts and
subagents for one adapter surface, every file pinned by digest and protected. It is
refused before any run if:

- a skill is never named in the always-on file;
- front matter carries more than a name and description (no hooks, tools or permissions);
- a referenced script is missing or does not parse;
- the tree holds anything its manifest does not list.

**Only the worker sees it.** Before each worker session the controller makes one
deterministic overlay commit: the worker's base plus the tree at its active paths.
The judge and the checks never see it.

- A tracked file at an active path is refused unless the plan names it in `replace`.
- An edit to the playbook stops the worker.
- The worker's change is applied to the base itself, or stopped, never silently
  rebased.
- Every reader re-checks each overlay in Git.

**Proposals from evidence.** `wring experiment evidence` builds `wringer/evidence/` from a
replicate set's validated journals: the task, numbered trajectories, what each attempt
produced, where the attempts disagreed, today's playbook and earlier lessons. Every
file is scanned by name and content for held-out identities, oracle digests and denied
paths. From a job, every held-out task of its comparisons is fenced, and replicates
that ran a held-out source are refused.

One separately granted session reads that evidence in its clone and writes only
`wringer/proposals/<id>/`. The result is either a validated tree whose `NOTES.md` cites
a real trajectory line for each change, or `KEEP_BASE`, recorded as no change. The
proposer may run contained or trusted-local. Export, commit and `select-tree` lead to a
registered comparison of version 6 arms that differ only in the playbook.

**Lessons.** When a comparison is decided with every planned trial recorded,
`evaluate` records a lesson: the prediction, the held-out counts, and the exact
playbook difference the trials used. An inconclusive comparison records nothing. No
model writes a lesson, and a fixture comparison can refute but never qualify. The next
proposer reads lessons, but not the per-task findings that would name held-out tasks.

**The job's research view.** The job page and `wringer.inspect_improvements` show:

- replicate sets and where they disagreed;
- each proposal, with its status and the trajectory lines it cites;
- how many comparisons qualified or were refuted.

None of it can collect, propose or adopt.

**A registered live test.** [Pilot amendment 1](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.38/docs/qualification/PILOT_AMENDMENT_1.md)
registers "no playbook versus a proposer-written playbook" on the pilot's seven repair
tasks, with the pilot's endpoint, minimum effect, regression limits and fixed-sample
rule. It is registered, not run.

**How it was tested.** With real Git sources, overlays, captures and private
handovers, scripted agents and checks, and a Chromium rehearsal of the job page. A
compiled walkthrough of the whole chain runs in validation. 44 guards were each removed
alone:

- 43 turned their tests red on the first run.
- One stayed green because its test accepted any refusal. The test now names that
  guard's refusal, and it goes red.

**Why there is no alpha.37.** Its CI stopped twice before publication: first on time
limits the new tests outgrew, then on a stale budget test. By then the next release
had already landed. The limits are now raised, with the measurements recorded.

**Not measured:** a live proposer, a live agent on a tree, a live comparison or lesson,
or any benefit. Nothing here claims an improvement. Assistant workspaces still use
version 1–5 profiles.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. GitHub publication does not itself
publish an npm package, Homebrew tap or MCP registry listing. The documented
cooperative-local operator boundary remains.

[The improvement route in ten steps](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.38/docs/improvement/README.md)
· [Proposals](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.38/docs/native/PROPOSALS.md)
· [Previous release: see the loop](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.36)
