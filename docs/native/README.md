# Wringer: the Bun product guide

Wringer coordinates agents, checks and evidence. The agents author the product code; the CLI does not. The active implementation is the Bun workspace at the source repository root, not a parallel edition or a wrapper around Python.

This is prerelease software. Deterministic integration tests are not proof of live-agent convergence or real platform isolation.

## Build from a source checkout

Run at the Wringer repository root with Bun, Git and Node.js installed. The
development verification fixtures use Node.js (CI provisions version 24); the
harness itself runs on Bun or as its compiled executable.

```sh
bun install --frozen-lockfile
bun run check
bun run build
./dist/wring --version
./dist/wringer-drive --help
./dist/wringer-board --help
```

Keep `dist/` together. The compiled binaries do not require a separately installed Bun runtime, but their agents and target repositories still require the declared tools. No published registry package or execution image is implied by these instructions.

From that same source root, put the build on the current shell's `PATH`:

```sh
export PATH="$PWD/dist:$PATH"
command -v wring
wring --version
```

No global configuration or existing installation is changed by this export.

## One declared, isolated run

A production execution plan pins a repository revision, preserves intent, names ACP agents and acceptance, and declares runtime/credential/resource policy. YAML and constrained literal-only TypeScript resolve to one canonical plan; a plan is not code to evaluate on the host.

Compile your own plan without spending. The distribution includes a compile-only
template at `docs/examples/contained.yaml` beside the installed guides; in a
source checkout that template is `packages/plan/examples/contained.yaml`.
Its placeholder image/revision/tools and deny network are not a ready-made live
agent environment.

```sh
wringer-drive plan PLAN.yaml
```

Replace `PLAN.yaml` with your actual plan file. Review its canonical contents and digest. Follow [unattended operation](HEADLESS.md) for explicit authority, run and resume commands.

The production boundary is a fresh Apple Container or gVisor-backed Kubernetes runtime per role. The repository is cloned inside, with no host checkout/home mount. ACP is the agent protocol, not the isolation mechanism. An unavailable runtime must stop the run, never downgrade it to host execution.

Live platform enforcement is a separate acceptance gate. Command/manifest fixtures do not prove a real runtime's filesystem, network, credential, resource or cleanup behavior.

## Read and review the contained result

Retain the controller state path selected for the run:

```sh
wringer-drive status --state CONTROLLER_STATE
```

This validates the authoritative journal and reports the state and next action.
Add `--json` for candidate/check/review details and recorded session/token usage;
the frozen plan and authority retain the ceilings. The standalone HTML board
does not yet render contained journey records. Missing observations remain
missing, not zero or pass.

When a human criterion is waiting, run its declared display and use the real
receipt ID printed by that command:

```sh
wringer-drive show --state CONTROLLER_STATE --criterion HUMAN_CRITERION_ID
wringer-drive review --state CONTROLLER_STATE --criterion HUMAN_CRITERION_ID --display DISPLAY_UUID --verdict met --by 'YOUR NAME' --note 'YOUR OWN OBSERVATION'
wringer-drive resume --state CONTROLLER_STATE
```

These uppercase values are placeholders. The person supplies the observation;
`not_met` records an objection. Showing must succeed for the same candidate and
criterion. There is no contained `--without-display` route, and routine authority
cannot substitute a human verdict. Skip the pen if no human criterion exists.

## Deliver and audit

After the contained status is review-ready, choose a real remote and branches:

```sh
wringer-drive deliver --state CONTROLLER_STATE --remote REMOTE_URL_OR_BARE_PATH --source-branch NEW_REVIEW_BRANCH --target-branch TARGET_BRANCH
wringer-drive deliver --state CONTROLLER_STATE --remote REMOTE_URL_OR_BARE_PATH --source-branch NEW_REVIEW_BRANCH --target-branch TARGET_BRANCH --send
```

The preview does not push. The separate `--send` decision authorizes publication,
not merge or deployment. Add an explicit `--forge-config FORGE.json` declaration
to both invocations for a hosted pull/merge request; that result is recorded
separately from Git push.

The actual `mr.md` says to clone the remote, check out the delivered review branch
and run its exact `wringer-drive audit --bundle .wringer/deliveries/REAL_ID`
command from the clone root. The audit is offline and reads carried observations,
not the old controller directory. Source code commit, verification base and later
evidence publication commit are separate facts.

From that same clone root, `mr.md` also prints the actual
`wringer-drive falsify --bundle .wringer/deliveries/REAL_ID` command. This is a
separate execution, not an offline audit: it requires the declared contained
verifier, calls no coding/judging agent, and tests supported committed-line
mutations under explicit time/attempt bounds. The record names the exact range
and commit and reports caught, survived or unavailable. A missing runtime or
failed control is inconclusive; no complete mutation score or correctness proof
is claimed. The standalone `wring verify --falsify --delivery` command reads a
different format.

## Separate standalone tools

`wring verify`, `wringer-board`, `wring deliver` and `wring doctor` still support
the older repository-local verification record format. Its board derives Built ·
Checks passing · Requirements proved · Human judgement complete · Ready to deliver ·
Delivered. Those tools do not resume the contained journey above. Local checks
and displays are trusted host execution, not an isolation fallback. Public
graph execution, fleet execution and host-worker benchmarks are retired; retained
graph/fleet APIs and readers are internal or historical tools.

## No-spend development exercise

```sh
bun run demo
```

Run this from the source checkout, not from an unrelated customer repository. It is a deterministic evidence/delivery fixture with a local origin, not a full isolated ACP journey. Keep its printed transcript and artifact paths; do not present fixture observations as a person's real acceptance.

[Architecture](ARCHITECTURE.md) describes the boundaries. The [first rewrite report](IMPLEMENTATION_REPORT.md) is historical and preserves its original measurements rather than silently updating them into new claims.
