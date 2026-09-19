# Set up one bounded product run

This page is for the operator preparing Wringer, not a promise that the current machine already meets the execution requirements. Build the Bun product using [INSTALL.md](INSTALL.md). The root workspace is the only active implementation.

## 1. Establish the execution boundary

The production target is mandatory isolation for the planner, coding worker and judge, reached through ACP:

| Environment | Required runtime | What must be established |
| --- | --- | --- |
| Local macOS | Apple Container | Fresh role containers, repository cloned inside, declared resource and network restrictions, successful cleanup |
| Kubernetes | gVisor-backed RuntimeClass | Explicit cluster context/namespace/RuntimeClass, fresh role workloads, effective network policy, no host mounts, successful cleanup |

An ordinary container, a host process, a repository worktree, or an agent's own workspace permission setting is not interchangeable with those requirements. If the named runtime cannot establish the requested boundary, the run must stop; it must not fall back to host execution.

Adapters and controller integration are under active verification. Generated command/manifest tests are not live isolation evidence. Before unattended use with valuable data, require platform-specific measurements of filesystem access, network denial, resource bounds, cancellation and cleanup. [ROADMAP.md](ROADMAP.md) keeps those release gates explicit.

## 2. Declare the input and roles

The execution plan is declarative data, authored as strict YAML or a constrained, literal-only TypeScript plan. Both forms must resolve to one canonical versioned plan. They are not scripts allowed to run arbitrary setup code on the controller.

Start from the [compile-only plan template](packages/plan/examples/contained.yaml). It shows the actual parser's structure, not a provisioned service: replace the repository URL/commit, image digest, agent declarations, tool versions, scope and checks with your own measured values. Its `deny` network intentionally cannot contact a live provider or fetch a remote repository. Do not run that placeholder template as if it were a ready-made agent image or connectivity recipe.

Declare:

- The repository URL and exact commit to clone inside the runtime.
- The original product request and acceptance contract, including requirements only a person can judge.
- The ACP planner, worker and judge programs and arguments. Wringer is their client, not the code-authoring agent.
- The runtime image, CPU/memory limits, network policy and allowed environment-variable names.
- Turn/time ceilings and the operator's bounded authority.

A repository with no remote is named differently: `wringer-assistant prepare --local` pins it as `local://<root commit>` in a version 4 plan and writes its Git bundle beside the profile, which `init` verifies and keeps. The runtime reads that bundle; nothing is fetched. Its approval, environment map, runtime receipts and handover records carry the same local identity. See [ASSISTANT_START.md](ASSISTANT_START.md).

There is no built-in vendor or model recommendation. Agent binaries and dependencies must be present in the selected runtime image. Do not assume a program on the host's `PATH` exists inside it.

The runtime policy names are `apple-container` and `gvisor-kubernetes`. Network is explicit (`deny` or a declared allowlist). Kubernetes also requires its context, namespace and RuntimeClass. These are declarations to be checked, not evidence that the cluster implements the policy.

An allowlist is written with exactly these keys:

```yaml
runtime:
  network:
    policy: allowlist
    allow:
      - cidr: 203.0.113.7/32   # one IPv4 address or prefix, never a hostname
        ports: [443]           # the TCP ports that prefix may be reached on
    dns: [203.0.113.53]        # the resolvers this run may ask, by address
```

`allow` takes IPv4 CIDRs and TCP ports only; a hostname is refused, because the policy is
enforced by address and a name resolved later is not the thing that was reviewed. Every
outbound packet to anything else is dropped, in both IPv4 and IPv6.

**Declared resolvers are admitted on port 53, over both UDP and TCP**, and `/etc/resolv.conf`
inside the boundary is rewritten to name exactly those addresses. Nothing else reaches port
53: a run with an `allow` entry but no `dns` cannot resolve a hostname at all, which is the
usual reason a declared allowlist appears to deny a host it names. Declaring a resolver
admits DNS to that resolver and nothing more — it opens no other port and no other host.

Compile your operator-authored `PLAN.yaml` (or constrained `PLAN.ts`) before granting authority:

```sh
wringer-drive plan PLAN.yaml
```

This is a no-spend validation step. Inspect the canonical plan and digest it prints. Old direct-HTTP `judge:` drafting configuration and shell-worker recipes belong to compatibility history, not new production setup.

## 3. Reuse credentials, do not rebuild identity on every run

The plan contains environment-variable names or runtime-managed secret references, never API-key values. Supply only the credentials each role requires. Do not mount a home directory, credential store, Docker socket or agent-login directory into a workload to make authentication convenient.

An existing key can be read once into the launching environment when that is the selected credential route. Wringer does not need you to re-add it to Keychain for each run. Effective authentication is agent-specific: key present, login present, both present, and authenticated are different observations. A successful authentication response alone does not prove the next agent request will succeed.

Do not paste credentials into the plan, PRD, command arguments, chat, captures or bug reports. [HEADLESS.md](docs/native/HEADLESS.md) explains the explicit credential handoff. `wringer-headless` is an alias for the contained driver, not a host-Codex shortcut.

## 4. Authorize routine work once

Use repository/run-scoped authority with named actions, an identified operator and finite ceilings. The controller must preserve that authority and spent/reserved work across interruption and resume. After reviewing the compiled plan, use the [exact authority/run/resume sequence](docs/native/HEADLESS.md); the grant binds the plan and acceptance digests and requires an expiration.

Routine engineering answers may be recorded under that delegation. It does not authorize a human acceptance verdict, account sign-in, new global configuration, a weaker runtime, or a remote push. If the plan changes materially, its exact approval must be reconsidered; a new spelling of the run does not replenish the old budget.

## 5. Read preflight before spend

Keep the preflight record. It should identify the pinned repository, selected runtime, effective policy, role programs, credential observations and ceilings. Missing runtime capability is an environment stop, not a failing product requirement.

```sh
wring --version
wringer-drive --help
wringer-drive doctor --plan PLAN.yaml
wringer-drive doctor --plan PLAN.yaml --probe-agents
```

The contained doctor reuses existing keys and records source-bound ACP session
observations when requested. No model prompt is sent; this does not prove a key
is valid with the provider or that an agent will converge. After a run, use
`wringer-drive doctor --state CONTROLLER_STATE` to read its actual last verify.
The separate bare `wring doctor` reads older standalone records.

For a locally built pinned ACP image and the no-model platform safety probes,
follow [the runtime guide](runtime/README.md). A successful protocol fixture is
not a substitute for running that safety probe on the actual platform.

## 6. Let the run work; intervene where authority ends

A useful stop preserves the evidence and supplies a runnable next action. Capture one that does not. Do not remove an isolation policy or invent a human observation to force a green result.

The person reviews the actual display for a human criterion. The operator separately reviews delivery and chooses whether to send it. Once delivered, follow the bundle's audit and falsification instructions in a fresh clone. [QUICKSTART.md](QUICKSTART.md) explains those surfaces.

## 7. Declare what your checks need, and let the doctor measure it

`wring doctor` used to answer with rows about the repository, the configuration and the Bun runtime, and nothing else. A repository whose checks need a browser, a native PostgreSQL and a filesystem that reads back got five green ticks and `ready` at exit 0 — a claim about things it had never looked at.

Declare those prerequisites and each becomes a measured row:

```yaml
requires:
  - kind: browser              # launches the pinned Playwright browser and opens about:blank
    module: playwright         # optional; the node_modules package that pins it
    engine: chromium           # optional; chromium | firefox | webkit
  - kind: native_database      # runs one identity query against the declared URL
    url_env: DATABASE_URL      # an environment variable NAME — never the URL itself
  - kind: filesystem           # writes, fsyncs and reads back in the workspace and .wringer/
  - kind: container_service    # asks the Apple container client for its service status
```

Each row lands on one ladder — **installed → executable → capability measured**, with **unavailable** and **not measured** as the two honest ends — and carries the measurement it is based on and one bounded next step:

```
◐ browser (chromium) [executable]: The pinned chromium binary is present at … and did not launch: …
    Next: read that launch error; a sandbox, missing system library or seatbelt policy is the usual cause.
◔ container service (container) [installed]: … its service is not running: … This probe does not start it,
  because an auto-start that may or may not have worked is not a measurement.
    Next: container system start
```

An installed browser that cannot launch is `executable`, not ready. A portable or in-memory database does not satisfy `native_database` — the probe says so rather than accepting it. A cloud placeholder that does not read back its own bytes is `unavailable`. A stopped container service is a row with a next step; nothing is started, installed or switched for you.

Credentials read the same way everywhere they appear, on three states: **exists** (an entry or variable name is there, value unread) → **retrievable** (a read succeeded; the value is never shown) → **accepted** (a session opened with it). `wring doctor` and `wringer-assistant setup` never reach `accepted`, because neither opens a session; only `wringer-drive doctor --probe-agents` can, and it sends no model prompt.

## 8. Let the runner's own report answer, not just the exit code

An exit code says whether a command succeeded. It does not say whether a single assertion ran. Two measurements, both real:

```
node --test --test-reporter=tap  over two skipped tests   → exit 0, "# pass 0 / # skipped 2"
playwright test --reporter=json  with no browser binary   → exit 1, two specs "failed", errors []
```

The first passes a gate. The second is indistinguishable, in the runner's own JSON, from two product assertions that failed — the only trace of the real cause is inside an error message.

Declare the runner and Wringer reads its report:

```yaml
gates:
  - id: persistence-workflow
    run: npx vitest run --reporter=json --outputFile=.wringer/vitest.json
    proves: [SW-03]
    evidence:
      kind: assertions
      adapter: vitest            # vitest | playwright | node-test
      report: .wringer/vitest.json   # omit to read the gate's stdout
```

Then: **zero executed assertions cannot pass**, whatever the command exited. A report that contradicts the exit code is refused. A declared requirement the report never mentions is refused. Each gate's observation lands in `gates/NNN_id/check-observation.json` as `wringer.check-observation.v1` — the same record the contained lane's runners produce — with the counts and the runner's own test names in `gate-assertions.json` beside it.

`node --test` prints `spec` format on a pipe, so declare `--test-reporter=tap`; the adapter says so rather than guessing.

**Environment failures are classified from measurements, never from log text.** A shell that exited 126 or 127, a timeout, a gate that produced no readable report, or — for a `playwright` gate — the browser launch probe from `requires:` reporting that the engine does not start here. An environment failure is also excluded from red-first receipts: a browser that never launched has not demonstrated that a check can fail.

## 9. One requirement, several kinds of evidence

A requirement can reasonably need unit, persistence and browser evidence. Bind it in every gate that must pass:

```yaml
gates:
  - id: fresh-offline-setup
    run: node scripts/check-fresh-setup.mjs
    proves: [SW-01]
  - id: persistence-workflow
    run: node scripts/check.mjs test tests/backend.test.ts
    proves: [SW-01, SW-03]
  - id: browser
    run: node scripts/check.mjs browser tests/browser/workbench.spec.ts
    proves: [SW-01, SW-02]
  - id: integration-smoke
    run: node scripts/smoke.mjs
    corroborates: [SW-01]      # supporting evidence; can never override a failure
```

The relation is **all required**: every gate whose `proves:` names `SW-01` must pass, and each needs its own recorded earlier failure. One that did not run leaves the requirement unproved; one that failed fails it, and the reason names which. `corroborates:` is recorded with its outcome and never decides — it cannot fail a requirement and cannot rescue one. `acceptance.json` still names the first binding gate as the owner because its frozen field holds one value; `evidence-layers.json` beside it carries the rest.

A criterion that is corroborated and proved by nothing is refused by name: supporting evidence cannot carry a requirement on its own.

## 10. Declare the services and phases instead of scripting them

A typical application needs more than a list of shell checks: migrate, seed, start dependencies, wait for readiness, run several suites, stop what you started. ZenJev did all of that in a **117-line CI coordinator** beside a 104-line workflow, and that coordinator re-implemented detached spawn, `SIGTERM` then `SIGKILL`, timeouts, per-label log capture and an owned-children set — machinery Wringer already had for bounded commands.

Declare it and the run carries it:

```yaml
setup:                                 # ordered, bounded, project-owned. Never retried.
  - id: migrate-demo
    run: node node_modules/prisma/build/index.js migrate deploy
  - id: migrate-test
    run: node node_modules/prisma/build/index.js migrate deploy
    env: { DATABASE_URL: ZENJEV_TEST_DATABASE_URL }   # a variable NAME, never a value
services:                              # started once, for the first phase that needs them
  - id: worker
    run: node --import tsx src/worker/index.ts        # no URL of its own: not measured, and said so
  - id: production-app
    run: node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
    readiness: { url: 'http://127.0.0.1:3000/api/health', body_path: worker.status, equals: healthy, timeout: 60 }
  - id: authenticated-app
    run: node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001
    readiness: { url: 'http://127.0.0.1:3001/api/settings', status: 401, timeout: 60 }
phases:                                # once declared, these ARE the running order
  - id: build
    gates: [lint, typecheck, production-build]
  - id: workflows
    needs: [worker, production-app]
    gates: [fresh-offline-setup, branding, persistence-workflow, browser]
teardown:                              # always runs
  - id: stop-fixtures
    run: node scripts/teardown.mjs
```

**Three rules worth knowing before you rely on it.**

A setup step that failed, or a service that never answered its declared readiness, is an **environment outcome at exit 2** — not a gate failure at exit 1. No gate ran, so nothing was asked of the application, and `orchestration.json` names the step or service and what it last answered. That distinction is the whole point: reading a database that never started as "the application is broken" is how a day disappears.

**Nothing under `setup:` or `services:` is retried.** A retry could repeat a paid call or an external write. If your setup is safe to repeat, repeat it yourself in the command.

**Teardown always runs** — after a failed gate, after an environment refusal, and after you cancel. Cancellation and teardown signal only the process groups this run started, by the leader pid it holds; nothing else on your machine is touched.

`env:` maps a variable name to **another variable's name**, never to a literal. A literal there would put a credential in the repository, and it is refused.

Once `phases:` are declared, every declared gate must belong to exactly one: a gate in two phases would be two outcomes for one check, and a gate in none would silently never run. Both are refused by name. `wring verify --gate` still selects within that order, and `selection.json` becomes `wringer.selection.v2`, which says which phase ran what.

## 11. Verify in phases without losing the whole

A project whose checks need different services verifies in phases: `wring verify --gate build --gate lint`, then the database phase, then the browser phase. Each phase writes its own sealed bundle, and each one legitimately reports `passed` — for its selection. It stays exit 0, because a deliberately narrow run is a useful act.

What a subset run cannot do is stand in for the verification. Every bundle carries `selection.json` (`wringer.selection.v1`) naming what was declared, selected, executed, passed, failed and **not run**, and both the bundle's `summary.md` and the board Wringer prints say it in one sentence:

```
Incomplete: 9 required checks were not run (fresh-offline-setup, domain-provider-contracts, …).
```

Completeness there is about execution, never outcome: a run in which everything ran and one check failed is complete and failed. A gate with no `proves:` still counts — `lint` proves no requirement, and omitting it still means the verification did not cover what you declared.

Combine the phases into one result:

```sh
wring audit --set .wringer/runs/FIRST --set .wringer/runs/SECOND --set .wringer/runs/THIRD
```

That writes `wringer.verification-set.v1` and a generated `HANDOFF.md` under `.wringer/sets/`, and exits 1 while the set is incomplete. Bundles join only when their revision, their `.wringer.yaml` bytes and each gate's check identity agree; a damaged bundle, a second revision or two outcomes for one gate is refused by a sentence naming the bundle, never resolved by picking one. `wring verify --set` is the same combiner under the verb you may already be holding.

The generated handoff separates the tested commit from the evidence commit, lists complete and incomplete checks, states which gates you declared with `--live-check` and what a live check does not establish, and keeps agent review apart from owner judgment. Where no person recorded a judgement it says so; nothing in a machine result ever becomes one. Name earlier decision documents with `--supersedes FILE` and each gets a dated superseded line rather than being quietly contradicted.
