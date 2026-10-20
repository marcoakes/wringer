Wringer 1.0.0-alpha.36 lets you read what the agents actually did, and run the
same approved plan several times to see where the attempts disagree.

```sh
wring job loop --job JOB_ID --trajectory
wring experiment replicate register --job JOB_ID --task-family FAMILY --replicate-set ID --k 3
```

**Loop trajectories.** Every role session is shown as numbered lines:
`[ACTION]` for each tool call and its command, `[OBSERVATION]` for its output and
exit code, `[ASSISTANT]` for the agent's own messages, plus the controller's
prompt, permission decisions and usage. It is a projection of the ACP updates
Wringer already retains, so nothing new is recorded. Where to read output from
was measured first, with one live session on each pinned adapter. Claude's
adapter sends output as content and raw output. Codex's sends it as raw output
and terminal metadata, never as content. A view that read only `content` would
have shown Codex doing nothing. Text is redacted again when rendered, items are
cut at 4 KiB and sessions at 512 KiB with every cut counted, and a call with no
output says so rather than inventing one. Connected assistants read the same
lines in 64 KiB pages through `wringer.inspect_loop`.

**Replicate sets.** `wring experiment replicate` runs one approved plan 2 to 5
times under its own finite grant. All attempts are reserved before anything runs,
and every outcome is kept, failures and unstarted attempts included. An
interrupted attempt is reconciled from what it retained, never replayed, and the
set stops there. A budget identity is checked after collection; a violation is
refused, not repaired. The divergence report compares checks, judgements, loop
decisions, candidates and the attempt at which each first failed. It says where
the attempts disagreed, never why, and no model reads it. Replicates are research
evidence: they never enter ordinary failure patterns and are never delivered.

Tested on deterministic fixtures with real journals and validation, and 18
isolated reversions, each red. Not measured: a live replicate set, or anyone
reading a live journey through the trajectory view. Nothing here claims an
improvement.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. GitHub publication does not itself
publish an npm package, Homebrew tap or MCP registry listing. The documented
cooperative-local operator boundary remains.

[Loop inspection](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.36/docs/native/LOOP_INSPECTION.md)
· [Replicate sets](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.36/docs/native/REPLICATES.md)
· [Measurements](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.36/docs/improvement/PHASE_A_MEASUREMENTS.md)
· [Previous release: a Codex connection Codex will actually use](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.35)
