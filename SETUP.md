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
