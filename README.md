# Wringer

![Wringer](docs/banner.webp)

**Coding agents write the change. Wringer coordinates the engineering around it.**

Wringer runs bounded repair loops with independent checks and review, carries
portable evidence with the result, and measures proposed improvements before
selecting them for future work. Keep your coding agent; give its work an
inspectable plan, a finite allowance and a durable history.

```text
request → approved plan → worker → protected checks → independent judge
                            ↑           │                   │
                            └── bounded repair ─────────────┘
                                                            ↓
                            result review → separate Send → portable evidence

scope hold → contained loop → fresh check → typed route → exact review → prepared delivery → Send
fork → private branches in parallel → join: deterministic merge + fresh checks against every branch plan
                  one allowance, reserved before every effect · one resumable history

development failures → predicted improvement → fixed comparison → future adoption
```

## What makes Wringer useful

| Capability | What you can inspect |
| --- | --- |
| **An engineering loop, not just a final answer** | Candidate trees, check and judge outcomes, repair evidence, charged attempts and the reason work continued or stopped. An exact repeat of unsuccessful work stops; repeated outcomes warn without pretending to measure quality. |
| **Independent execution and review** | Separate worker and judge sessions/storage, protected acceptance inputs and Apple Container or gVisor/Kubernetes execution. ACP connects the agent; the sandbox establishes the execution boundary. |
| **Evidence that travels with the change** | Versioned records, source identities, check receipts, loop decisions and human observations. A fresh clone can audit a delivery without the original controller or provider account. |
| **Measured improvement for future work** | Register a prediction and comparison before trials, keep failures in the denominator, and explicitly adopt or undo a qualified worker playbook. A suggestion cannot grade or approve itself. |
| **Durable, bounded work** | One allowance covers the journey. Resume retains reservations and reconciles uncertain effects; it does not silently buy another attempt. |
| **Composable workflows** | A graph of contained loops, fresh checks, typed routers, human holds and deliveries. Each step hands the next an exact candidate; a failed requirement cannot be routed to success; a hold binds the exact revision and input; Send stays separate. Export verifies with Node alone. |
| **Parallel branches with verified integration** | A fork runs private branches at once under one ceiling; a join merges their exact candidates deterministically and re-checks the result against every branch plan. Two changes that each pass can still fail together, and Wringer says so: `integrated`, `failed`, `conflict` or `unavailable`, never a silent merge. |

Explore [graphs and parallel branches](docs/native/GRAPHS.md),
[loops and inspection](docs/native/LOOP_INSPECTION.md),
[portable evidence](examples/evidence/README.md),
[improvements from ordinary jobs](docs/native/JOB_IMPROVEMENTS.md) and
[the execution architecture](docs/REWRITE_PLAN.md).

**The platform direction is composable workflows that improve through evidence.**
Serial graphs of contained loops shipped in 1.0.0-alpha.26; parallel branches with
verified integration ship in 1.0.0-alpha.27. Both are proven with deterministic
fixtures and not yet with live agents. Gate/workflow proposals, candidate
tournaments, Temporal and A2A are the ordered next steps in
the [restoration plan](docs/SOTA_RESTORATION_PLAN.md). Their exact current status
is listed in [capabilities](docs/CAPABILITIES.md); planned features are not
release claims.

```sh
wringer-drive graph plan examples/graphs/serial-repair/graph.yaml   # validate, pin, show the allowance
wringer-drive graph plan examples/graphs/parallel-repair/graph.yaml # two branches, one verified integration
wringer-drive graph run GRAPH.yaml --authority AUTH.json --state DIR
wringer-drive graph status --state DIR                              # every node and the exact next command
```

## Start with your existing coding app

- **Check existing work:** keep Claude Code, Codex or another coding assistant.
  Wringer runs reviewed repository checks locally. No worker account, image or
  extra model call is needed. These commands have your host permissions.
- **Delegate work:** select worker and judge models explicitly, provision Apple
  Container or gVisor Kubernetes, and approve a finite job. Missing containment
  stops delegation. Model/provider billing is separate from the assistant chat.

Start with [installation](INSTALL.md), then try the labelled, no-model simulation:

```sh
wring demo --json
wring setup --repo /absolute/path/to/project --client codex --mode verification --dry-run --json
```

Inspect the proposed changes, apply the selected setup, and use
`wring job new` and `wring job open` to review a job. The
[local bug-fix example](examples/adoption/local-fix/README.md) includes a failing
check, a correction and source-bound evidence. [Agent](docs/START_AGENT.md),
[PM](docs/START_PM.md) and [operator](docs/START_OPERATOR.md) guides describe the
next steps. [CLI reference](docs/CLI.md) lists the actual commands.

## Inspect the work

For a prepared delegation job:

```sh
wring job loop --job JOB_ID --json
wring job improvements --job JOB_ID --json
```

The job page shows the same loop observations. Connected delegation clients can
use the read-only `wringer.inspect_loop` tool. For an existing contained delivery:

```sh
wring bundle export --bundle PATH_TO_DELIVERY --output NEW_DIRECTORY
node NEW_DIRECTORY/read-bundle.mjs NEW_DIRECTORY
wring bundle inspect --bundle NEW_DIRECTORY
```

The Node-only reader checks carried byte integrity and displays recorded facts.
`bundle inspect` also performs Wringer's semantic audit. Neither executes the
acceptance checks again or supplies a human verdict. Unknown provider cost stays
unknown, and fixture success is not a measured live improvement.

To turn recurring failures into a proposed improvement, connect a task family
with `wring experiment connect --job JOB_ID --task-family FAMILY`. The same job
page then shows registered predictions, fixed comparisons and explicit future
adoption/undo. It shows when a changed source no longer matches the evidence.
Collection always needs its own finite allowance; reading never starts it.

## Release and evidence

**Engineering prerelease.** Native archives are published through
[GitHub Releases](https://github.com/marcoakes/wringer/releases). Each release
requires green native macOS arm64 and Linux x64 CI, including extracted archive
and installer checks; inspect its attached claim reports for measured coverage.
Windows is not a release target. Claude Code and Codex scoped adapters are implemented; complete
live journeys and Codex desktop remain unmeasured. See
[compatibility](docs/ASSISTANT_COMPATIBILITY.md) and [evidence](EVIDENCE.md).

Approval, result acceptance and Send are separate. The local review page uses
cooperative trust: another unrestricted process under your OS identity could
impersonate its operator. Protected mode remains unavailable. Read the
[security boundary](SECURITY.md) before using valuable source or credentials.

[Support](SUPPORT.md) · [Contributing](CONTRIBUTING.md) · [Apache-2.0](LICENSE)

Created and directed by [Marc Oakes](https://github.com/marcoakes).
