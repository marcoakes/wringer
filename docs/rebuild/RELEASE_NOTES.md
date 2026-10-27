Wringer 1.0.0-alpha.37 turns a playbook into a small tree the worker actually finds in
its clone, and lets an agent propose one from what earlier attempts did, citing the
moment behind every change.

```sh
wring experiment evidence --state PROPOSAL_DIR --replicates REPLICATE_DIR
wring experiment propose --state PROPOSAL_DIR --request proposal-request.json --yes
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

**Materialisation.** Before each worker session the controller makes one
deterministic overlay commit: the worker's base plus the tree at its active paths.
Only the worker clones it; the judge and the checks never see it.

- A tracked file at an active path is refused unless the plan names it in `replace`.
- An edit to the playbook stops the worker.
- The worker's change is applied to the base itself, or stopped, never silently
  rebased.
- Every reader re-checks each overlay in Git.

**Proposals from evidence.** `wring experiment evidence` builds `wringer/evidence/` from
a replicate set's validated journals: the task, numbered trajectories, what each
attempt produced, where the attempts disagreed, and today's playbook. Every file is
scanned by name and content for held-out identities, oracle digests and denied paths.

One separately granted session then reads that evidence in its clone and writes only
`wringer/proposals/<id>/`. The result is either a validated tree whose `NOTES.md`
cites a real trajectory line for each change, or `KEEP_BASE`, recorded as no change.
The proposer may run contained or trusted-local. Export, commit and `select-tree` lead
to a registered comparison of version 6 arms that differ only in the playbook.

Tested with real Git sources, overlays, captures and private handovers, and with
scripted agents and checks. 33 guards were each removed alone. 32 tests went red on
the first run. The 33rd stayed green because its test accepted any refusal; the test
now names that guard's own refusal, and it goes red. A compiled walkthrough of the
whole chain runs in validation.

Not measured: a live proposer, a live agent on a tree, or any benefit. Nothing here
claims an improvement. Assistant workspaces still use version 1–5 profiles.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. GitHub publication does not itself
publish an npm package, Homebrew tap or MCP registry listing. The documented
cooperative-local operator boundary remains.

[Proposals](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.37/docs/native/PROPOSALS.md)
· [Replicate sets](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.37/docs/native/REPLICATES.md)
· [Previous release: see the loop](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.36)
