Wringer 1.0.0-alpha.32 says plainly what the restoration has proven, at which
level, and what it has not. It adds no new mechanism.

```sh
bun run build && bun scripts/showcase.ts
bun scripts/capability-ledger.ts --check
```

A [capability ledger](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.32/docs/CAPABILITY_LEDGER.md)
judges every capability separately at four levels: implemented, fixture-tested,
live-qualified and comparatively beneficial. Each level cites the repository
files that evidence it. The checker, now a validation stage, refuses a missing
citation, a live claim without a live run record, and a benefit claim without a
registered comparison result. Today nine capabilities are implemented, eight are
fixture-tested, and none is claimed live-qualified or comparatively beneficial.

A reproducible showcase runs four compiled public journeys and writes a path-free
record of what they did. Together they carry a graph, all candidate and
integration evidence, a restart after a killed process, a source-bound review
and delivery, an offline audit with Node alone, and a future-improvement proposal
with its comparison results. They also carry an external A2A task verified
before review. Each journey uses a separately compiled fixture binary for role
replies or verifiers. The showcase demonstrates the mechanisms, not live agent
behaviour, real containment or any benefit.

The 20-task pilot is
[registered](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.32/docs/qualification/PILOT_REGISTRATION.md)
before any run. It compares Wringer's orchestration with the same builder and
model used directly, across three repositories. It adds secondary comparisons for
a single loop against a graph, a single attempt against a tournament, and a
baseline against an adopted gate. The registration fixes the arms, the task
allocation, the primary endpoint and a minimum useful effect of four more
accepted tasks. It also fixes the regression limits, an exact sign test with a
bootstrap interval, and a fixed sample, all under a digest that a test enforces.
Running the pilot needs live model access, real tasks and independent reviewers;
it has not run.

New sibling records are `wringer.capability-ledger.v1` and
`wringer.pilot-registration.v1`. Published schemas keep their bytes.

Phase 7's Temporal runtime is still not included. Its prototype against a local
Temporal service needs the Temporal CLI and SDK downloaded, which awaits the
operator's approval.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. The required release jobs verify
those archives and their installer/package routes before staging publication.
GitHub publication does not itself publish an npm package, Homebrew tap or MCP
registry listing. The documented cooperative-local operator boundary remains.

[Capability ledger](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.32/docs/CAPABILITY_LEDGER.md)
· [Showcase](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.32/docs/showcase/SHOWCASE.md)
· [Previous release: external A2A tasks](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.31)
