Wringer 1.0.0-alpha.33 lets the same contained graph run under a second durable
runtime, Temporal, through an optional Node adapter. The Bun harness, its local
journal and its records are unchanged.

```sh
wringer-drive graph init graph.yaml --authority authority.json --state DIR
node adapters/temporal/src/cli.mjs worker --task-queue wringer-graphs
node adapters/temporal/src/cli.mjs start --state DIR --task-queue wringer-graphs
```

The graph kernel's decisions now sit behind a journal interface, in a module with
no host imports. The local file journal is one implementation. The
[Temporal adapter](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.33/docs/native/DURABILITY.md)
runs the unchanged kernel inside Temporal's deterministic workflow sandbox and
mirrors every event, create-once, into the graph's state directory. Every
`wringer-drive graph` command still reads that directory. Each effect is one
activity with one attempt that runs `wringer-drive graph effect`. That command
acts only for the durable marker the directory records, at most once per marker.
Decisions and Sends are workflow updates bound to the exact revision and input.

Tested against a local Temporal dev server (Temporal CLI 1.9.1, SDK 1.24.0), on
deterministic fixtures:

- The same captured observations give byte-identical event files on both
  journals with the same clock, for graph versions 1 to 4, a rejected review and a
  failed check. On Temporal's clock every decision, reservation and outcome
  matches.
- A killed worker, or a dispatch that stops heartbeating, leaves the effect
  uncertain. The workflow observes it and never starts it again. Cancellation
  does the same, and a new workflow from the directory only observes.
- Stale, forged, duplicate and credential-bearing decisions record nothing.
- A second controller on the same directory stops the workflow at its first
  divergent event.
- Retained workflow histories replay against the current code. An unguarded
  change to the workflow's commands fails replay, and the same change under
  `patched()` continues an open workflow. A history started locally continues on
  Temporal. Continue-as-new carries the history without repeating work.

Two fixes came from measuring first. Replaying a retained history used to consult
the reading host's environment for credentials, so a valid record could become
unreadable on another machine. Replay now checks shapes only. Credentials the
writing host holds are still refused when a decision, Send, hold reason, plan or
grant is written. `wringer-drive graph init` admits a graph without running
anything.

Not measured: a production cluster, Temporal Cloud, live agents or real
containment under the adapter, and any reliability benefit over the local
journal. Workers must share the state directory. The adapter is source in the
repository, not part of the native archives. Published schemas keep their bytes.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. The required release jobs verify
those archives and their installer/package routes before staging publication.
GitHub publication does not itself publish an npm package, Homebrew tap or MCP
registry listing. The documented cooperative-local operator boundary remains.

[Durable runtimes](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.33/docs/native/DURABILITY.md)
· [Capability ledger](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.33/docs/CAPABILITY_LEDGER.md)
· [Previous release: what is proven, at which level](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.32)
