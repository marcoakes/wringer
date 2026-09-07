# Wringer

Turn a product specification into a checked change, with evidence someone else can inspect.

Wringer is a Bun/TypeScript control plane. You supply the repositories, the outcome you want, and the agents allowed to work on it. Wringer preserves that intent, coordinates bounded work, runs the declared checks, records the human decisions, and prepares a portable handover. **The agents write the product code. Wringer does not.**

This repository now contains one Bun product, not a second edition alongside an active Python implementation. `1.0.0-alpha.2` is a prerelease; source availability and a passing test suite are not claims of production readiness or reliable convergence on arbitrary work.

Read the [current acceptance and status report](docs/REWRITE_REPORT_2026-09-07.md)
for this checkpoint's measured results and remaining gaps.

[Install](INSTALL.md) · [Quickstart](QUICKSTART.md) · [For product managers](README-PM.md) · [Unattended operation](docs/native/HEADLESS.md) · [Security](SECURITY.md) · [Roadmap](ROADMAP.md)

## Start from source

With Bun, Git and Node.js installed, run from the repository root. Node.js is
needed by the development check/delivery fixtures; it is not the Bun harness's
runtime. CI currently provisions Node.js 24.

```sh
bun install --frozen-lockfile
bun run check
bun run build
./dist/wring --version
./dist/wring --help
```

Keep the generated `dist/` directory together. It contains `wring`, `wringer-drive`, `wringer-board`, the `wringer-headless` alias for the same isolated driver, and accompanying records/documentation assets. Compiled executables do not require a separate Bun installation; the repositories and agents they run still need their own tools.

These are source-build instructions. No package-registry release, downloaded binary, container image, or hosted service is implied by this page.

To inspect the deterministic development journey without spending on a model:

```sh
bun run demo
```

Read the transcript and paths that command prints. The fixture uses deterministic check/delivery data and a local Git origin. It is evidence about the evidence/delivery integration, not a full ACP journey, live-agent benchmark or platform-isolation test.

## What the product must keep separate

Built · Checks passing · Requirements proved · Human judgement complete · Ready to deliver · Delivered

A passing suite is not a completed product. A machine requirement needs a declared check and resolvable evidence; missing evidence is not zero and is not a pass. A human requirement stays human. Delivery is a separate, explicit decision.

The contained journey reports its validated state through `wringer-drive status --state DIRECTORY` and carries its checks, source identities, review records and red-first receipts into delivery. Its `mr.md` names the exact offline audit command and where to run it. The standalone board, summary and certificate share requirement wording for the older verification record format; that board does not yet render contained journey state.

## Three product pillars

- **Environmental legibility.** Source-linked context, tool and baseline observations, constraints and acceptance criteria make the work understandable. Unknown observations stay unknown.
- **Repository as the system of record.** Intent, plans, authority, decisions, source identity and receipts travel with the handover. Views derive one story; there is no composite quality score.
- **Mechanical enforcement.** Scope, permissions, role isolation, budgets and acceptance are enforced outside worker write authority. An agent cannot approve its own policy changes.

ACP connects the separately declared agents. Production roles use fresh Apple Container or gVisor-backed Kubernetes environments, with repositories cloned inside. Authorize routine work once within finite ceilings; resume preserves completed work and unresolved spend rather than buying a fresh budget.

## Implemented behavior and remaining acceptance work

The Bun codebase contains strict record readers, contained workflow records, source/authority checks, portable delivery and audit, and standalone verification/board/pen tools. Public graph access is read-only (`wring graph show`, `status`, `explain`). `wring fleet` and `wring bench` execution refuse with a contained-plan migration route; retained graph/fleet implementation APIs are internal/historical, not supported host-worker alternatives. Deterministic tests exercise these seams, including unsuccessful paths.

The mandatory ACP and Apple Container/gVisor execution path is being integrated into the same product. Protocol fixtures and generated runtime manifests **do not establish** that a real host or cluster enforces its declared isolation. Live runtime, credential, cancellation, network-denial and fresh-machine journeys remain separately measured release gates. Legacy shell/direct-HTTP paths are compatibility material, not an alternative production trust boundary. See [setup](SETUP.md), [architecture](docs/native/ARCHITECTURE.md), and the [threat model](THREAT_MODEL.md).

## A handover you can check

[Quickstart](QUICKSTART.md) carries one path from plan compilation through bounded authority, run, status, human review and delivery. After that contained journey is review-ready, use the same controller state. These uppercase values are explicit operator choices, not supplied destinations or branches:

```sh
wringer-drive deliver --state CONTROLLER_STATE --remote REMOTE_URL_OR_BARE_PATH --source-branch NEW_REVIEW_BRANCH --target-branch TARGET_BRANCH
wringer-drive deliver --state CONTROLLER_STATE --remote REMOTE_URL_OR_BARE_PATH --source-branch NEW_REVIEW_BRANCH --target-branch TARGET_BRANCH --send
```

The first invocation prepares a preview. The second authorizes that branch publication; neither a saved plan nor a human review note silently grants it. A hosted pull/merge request additionally requires the explicit `--forge-config` declaration. Follow the actual delivery's `mr.md` from the root of a fresh clone of the remote on the delivered review branch. Its audit uses `wringer-drive audit --bundle` and the real carried bundle path.

The source change commit and the later commit carrying the evidence are different facts. Offline audit checks the carried observations; it does not rerun the product or establish live isolation. The same `mr.md` prints `wringer-drive falsify --bundle` with its real bundle path. That separate challenge executes bounded, supported committed-line mutations in the declared isolated verifier, records the exact source range and caught/survived/unavailable outcomes, and needs a provisioned runtime. No agent is called; a missing runtime is inconclusive, not a pass. The standalone `wring verify --falsify --delivery` command reads a different format.

## Optional standalone checks and older evidence

`wring init`, `wring verify`, `wringer-board`, `wring doctor`, and `wring deliver` remain available for repository-local verification and its existing record format. These are separate from contained journey state. Local checks and displays execute trusted repository commands on the host; using them is not a way to resume or approve a contained run. See `wring --help` and `wringer-board --help` before choosing this route.

## Development and history

[Contributing](CONTRIBUTING.md) describes the root workspace and verification discipline. [Architecture](docs/native/ARCHITECTURE.md) describes package ownership and authority boundaries. Historical specifications, reports and release notes remain useful evidence, but their old installation commands and completion claims are not current setup instructions. The [first rewrite report](docs/native/IMPLEMENTATION_REPORT.md) is explicitly historical.

Apache-2.0. See [LICENSE](LICENSE).
