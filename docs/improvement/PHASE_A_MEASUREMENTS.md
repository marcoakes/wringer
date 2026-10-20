# Phase A measurements — 20 October 2026

Taken before any product change, as step A of the improvement build: trajectory
views, replicate sets and trajectory-grounded playbook proposals. Each figure has
its record under `evidence/phase-a/`.

## 1. What each adapter actually sends

One live worker session per pinned adapter, on the trusted-local runtime, against a
throwaway repository whose one check failed: read the README, run the check, edit
one file, run the check again. Measured with
[`scripts/improvement-adapter-measure.ts`](../../scripts/improvement-adapter-measure.ts),
which records field names, counts and byte sizes, never content. Both sessions
completed and produced a change.

The plan assumed the alpha.34 rehearsal records could be read for this. They no
longer exist: the rehearsal ran in a scratch directory that has since been
cleared, and only its written summary was kept. So these are fresh sessions: one
on Claude Code's own login, one on Codex's.

### `@agentclientprotocol/claude-agent-acp@0.65.0` ([record](evidence/phase-a/claude-agent-acp.json))

17 s, 51 updates, 31 KB of retained events.

| Update | Count | Fields present (count, bytes) |
| --- | --- | --- |
| `tool_call` | 6 | `title`, `kind`, `status`, `rawInput` (6), `locations` (4), `content` (6, empty), `_meta.claudeCode.toolName` |
| `tool_call_update` | 21 | `content` (12: 7 text, 2 diff), `rawOutput` (6, 445 B), `rawInput` (10), `title` (10), `status` (6), `locations` (7), `_meta.claudeCode` |
| `agent_message_chunk` | 11 | `content` (text), `messageId` |
| `usage_update` | 12 | `used`, `size`, `cost` (1) |
| `available_commands_update` | 1 | `availableCommands` (11 KB) |

**Tool output is carried.** A completed tool reports its result twice: as
`content` (text, or a diff with `path`, `oldText` and `newText`) and as
`rawOutput` (the tool result the model saw). Wringer advertises no terminal
capability, so shell output arrives as text content, not terminal metadata.

### `@agentclientprotocol/codex-acp@1.10.0` ([record](evidence/phase-a/codex-acp.json))

28 s, 91 updates, 50 KB of retained events.

| Update | Count | Fields present (count, bytes) |
| --- | --- | --- |
| `tool_call` | 7 | `title`, `kind`, `status`, `rawInput` (5), `content` (6: 5 terminal, 1 diff), `locations` (1), `_meta.terminal_info` (5) |
| `tool_call_update` | 7 | `status`, `rawOutput` (6, 524 B), `_meta.terminal_output_delta` (3), `_meta.terminal_exit` (5) |
| `agent_message_chunk` | 65 | `content` (text), `messageId`, `_meta.codex` |
| `agent_thought_chunk` | 2 | content omitted by Wringer's client, as designed |
| `usage_update` | 6 | `used`, `size` |
| `session_info_update` | 3 | `title`, `_meta.codex` |
| `available_commands_update` | 1 | `availableCommands` (18 KB) |

**Tool output is carried, in a different place.** Codex never puts output in
`tool_call_update.content`. A command's output is in `rawOutput.formatted_output`
with `rawOutput.exit_code` (read from the adapter's source: some tools use
`rawOutput.output`). It is also in `_meta.terminal_output_delta.data` and
`_meta.terminal_exit.exit_code`. File edits appear as a `diff` item on the
initial `tool_call`.

### What this means for the trajectory view (§8 B)

- Both adapters carry tool output, so the plan's fallback, "(output not carried
  by this adapter)", is for an individual call with no output field, not for a
  whole adapter. A renderer that read only `content` would show Codex as having no
  output at all.
- Output fields, in the order the renderer reads them: `content` text and diff
  items; `rawOutput` (a string, a list of text blocks, or an object with
  `formatted_output`, `output`, `stdout` or `stderr`); `_meta.terminal_output` or
  `terminal_output_delta` data; and the exit code from `rawOutput.exit_code` or
  `_meta.terminal_exit.exit_code`.
- `available_commands_update` is 11–18 KB of the agent's own slash commands, not
  part of the work. The renderer leaves it out and counts it as an omission.

## 2. What today's proposer is given

Captured from the real request builder and prompt with a capturing fixture
executor; no model was called
([`scripts/improvement-phase-a-baselines.ts`](../../scripts/improvement-phase-a-baselines.ts)).

| Failure groups | Prompt | Baseline manifest | Pattern report | Prediction | Trajectory | Produced output | Prior proposals |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1,948 B | 401 B | 574 B | 194 B | **0** | **0** | **0** |
| 8 | 4,407 B | 401 B | 3,033 B | 194 B | **0** | **0** | **0** |
| 32 | 12,491 B | 401 B | 11,117 B | 194 B | **0** | **0** | **0** |

The proposer gets hashes, counts and requirement ids. It never sees what any
worker did or produced. Its only output is one JSON file with one Markdown
string. This is the baseline for "did the proposer get more".

## 3. Overlay commit and clone cost

Median of 7 runs on this machine (macOS arm64): a 200-file repository, an 8-file
overlay (one always-on file and seven skills), built with the same git steps the
tournament's overlay helper uses, then bundled and freshly cloned as the
trusted-local runtime does.

| Step | Median |
| --- | --- |
| Overlay commit (read-tree, 8 blobs, write-tree, commit-tree) | 186 ms |
| Bundle | 36 ms |
| Fresh clone and checkout | 60 ms |

About a quarter of a second per role. Materialisation (§8 E) does not need a
cheaper mechanism.

## Not measured

- Adapter behaviour on other tasks, adapter versions or settings; a contained
  runtime's overlay cost.
- Whether a richer proposer input produces better proposals. That is what a
  registered comparison measures later, not this sheet.
