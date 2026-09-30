# Wringer's Temporal adapter

An optional Node.js worker that runs Wringer's contained-graph kernel as Temporal
workflows. The Bun harness does not need it, and it is not part of the native
archives. See [durable runtimes](../../docs/native/DURABILITY.md) for what it
guarantees, how to run it and its limits.

```sh
npm ci --ignore-scripts
node src/cli.mjs --help
```

## Layout

| Path | What it is |
| --- | --- |
| `src/graph-workflow.ts` | The workflow: the unchanged kernel over a journal whose durability is Temporal's history |
| `src/workflows.ts` | What a production worker registers |
| `src/activities.mjs` | The mirror into the state directory, the credential screen and the effect command |
| `src/sandbox-crypto.js` | The SHA-256 the workflow sandbox uses in place of `node:crypto` |
| `src/worker-factory.mjs` | The workflow bundle and a worker |
| `src/cli.mjs` | `worker`, `start`, `status`, `decide`, `send` and `cancel` |
| `test/` | Conformance with the local journal, failure modes, versioning and unit tests |
| `test/histories/` | Temporal histories recorded from the current code; every later revision must replay them |

## Tests

```sh
TEMPORAL_CLI=/path/to/temporal npm test
```

Each test file starts its own `temporal server start-dev` on a free loopback
port. The fixtures are built by the Bun kernel, so `bun` must be on `PATH`.
`protobufjs` is pinned at the top level so the SDK's packages share one copy; the
SDK's JSON history reader fails with two.
