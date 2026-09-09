<div align="center">

<img src="docs/banner.webp" alt="A vintage wringer washing machine, cranked by hand. Two things feed into the rollers from the left: a git diff with a stream of tangled code, and a handwritten note reading 'I want a button that... downloads as a spreadsheet...'. A red tag on the roller says RED FIRST, and drops marked with red crosses drip into the tub below. Out of the right comes a perforated page headed EVERY GREEN WAS RED FIRST, carrying three cards — DONE — PROVED, NOT YET, NEEDS YOU — on a stack of fanfold paper stamped EVIDENCED. In the corner a terminal shows 'wring deliver' ticking off approved by you, red first, evidence, then REFUSED: 1 -- needs you." width="900">

</div>

# Wringer

## Keep your AI coding app. Put the work through Wringer.

Your assistant handles the conversation. Wringer coordinates the approved work,
runs the checks and records what is—and is not—ready to hand over. The agents
write the product code. You return to one job page: inspect the actual result,
choose Yes or request a correction, then separately Send the reviewed change.

**[Start from your coding app →](ASSISTANT_START.md)**

**For PMs and designers:** bring an approved design and your existing component
library. The design-aware workflow supplies that pinned reference to the contained
agents and shows reference versus actual output for your decision.
[Connect Figma →](docs/native/FIGMA_CONNECT.md) · [Design-led work →](docs/native/DESIGN.md) · [Reports blind-test target →](docs/DESIGN_BLIND_TEST.md)
Paste desktop/mobile frame links in your coding app or PM workspace. The new
Figma API route offers sign-in, private preview, explicit reference-storage
permission and attachment to a new approved plan. A registered Figma app and
deployed connection broker are required; this repository does not supply a hosted
service or claim that Figma's official remote MCP accepts Wringer.
Live Figma access and a real design/PM blind pass remain separate, unclaimed measurements.
[Engineering evidence and remaining prerequisites](docs/DESIGN_WORKFLOW_REPORT_2026-09-09.md).
[Figma API repair evidence](docs/FIGMA_API_REPAIR_REPORT_2026-09-09.md).

**Engineering preview:** the assistant entry point currently requires explicit
cooperative-local setup by an operator. It is not a protected boundary against
an assistant with the same computer access. Protected mode refuses; a complete
live PM journey through a named coding app is not yet claimed. See the
[compatibility record and limits](docs/ASSISTANT_COMPATIBILITY.md) beside this
starting route. Session/time limits are not a cash guarantee.

Wringer is a Bun/TypeScript control plane. You supply the repositories, the outcome you want, and the agents allowed to work on it. Wringer preserves that intent, coordinates bounded work, runs the declared checks, records the human decisions, and prepares a portable handover. **The agents write the product code. Wringer does not.**

This repository now contains one Bun product, not a second edition alongside an active Python implementation. `1.0.0-alpha.10` is a Figma API / design-aware assistant-entry engineering prerelease; source availability and a passing test suite are not claims of production readiness or reliable convergence on arbitrary work.

The first [September 8 PM test failed at planning](docs/PM_BLIND_REPORT_2026-09-08.md). [Blind test 2](docs/PM_BLIND_REPORT_2026-09-08_2.md) built successfully but failed at human review; salvage stopped during handover. [Alpha.7 repairs those measured problems](docs/PM_BLIND2_REPAIR_2026-09-08.md), with a real-browser engineering rehearsal. Neither failed verdict is rewritten as a pass; a new live PM result remains required.

Read the [assistant implementation report](docs/ASSISTANT_IMPLEMENTATION_2026-09-08.md)
for the earlier engineering checkpoint. The [guided PM experience record](docs/PM_GUIDED_EXPERIENCE_2026-09-08.md)
tracks the new single-page flow and its own validation status. Browser
notifications are opt-in while the page is open; native coding-app push and a
hosted reviewer audit service are not claimed.

[Assistant entry point](ASSISTANT_START.md) · [Install](INSTALL.md) · [Quickstart](QUICKSTART.md) · [For product managers](README-PM.md) · [Unattended operation](docs/native/HEADLESS.md) · [Security](SECURITY.md) · [Roadmap](ROADMAP.md)

## Start from source

With Bun, Git and Node.js installed, run from the repository root. Node.js is
needed by the development check/delivery fixtures; it is not the Bun harness's
runtime. CI currently provisions Node.js 24.

```sh
bun install --frozen-lockfile
bun node_modules/playwright/cli.js install --with-deps chromium
bun run check
bun run build
./dist/wring --version
./dist/wring --help
```

Chromium is required by the harness's engineering tests. This host test browser
does not provision the contained browser used for a real design job.

Keep the generated `dist/` directory together. It contains `wring`, `wringer-drive`, `wringer-board`, `wringer-assistant`, `wringer-headless`, the administrator-only `wringer-figma-broker`, and accompanying records/documentation assets. Compiled executables do not require a separate Bun installation; the repositories and agents they run still need their own tools.

These are source-build instructions. No package-registry release, downloaded binary, container image, or hosted service is implied by this page.

To inspect the deterministic development journey without spending on a model:

```sh
bun run demo
```

Read the transcript and paths that command prints. The fixture uses deterministic check/delivery data and a local Git origin. It is evidence about the evidence/delivery integration, not a full ACP journey, live-agent benchmark or platform-isolation test.

## What the product must keep separate

Built · Checks passing · Requirements proved · Human judgement complete · Ready to deliver · Delivered

A passing suite is not a completed product. A machine requirement needs a declared check and resolvable evidence; missing evidence is not zero and is not a pass. A human requirement stays human. Delivery is a separate, explicit decision.

The [assistant entry point](ASSISTANT_START.md) keeps approval, progress, actual
result, human review and a separate Send action on one private job page. The
destination is selected once during setup. The direct operator route remains
`wringer-drive board --state DIRECTORY`; both use the same application layer
and validated journal. The delivery's board,
certificate, summary and MR derive from one carried fact record. Its `mr.md`
names the exact offline audit command and where to run it. Older standalone
verification records keep their separate, read-only-compatible views.

## Three product pillars

- **Environmental legibility.** Source-linked context, tool and baseline observations, constraints and acceptance criteria make the work understandable. Unknown observations stay unknown.
- **Repository as the system of record.** Intent, plans, authority, decisions, source identity and receipts travel with the handover. Views derive one story; there is no composite quality score.
- **Mechanical enforcement.** Scope, permissions, role isolation, budgets and acceptance are enforced outside worker write authority. An agent cannot approve its own policy changes.

ACP connects the separately declared agents. Production roles use fresh Apple Container or gVisor-backed Kubernetes environments, with repositories cloned inside. Authorize routine work once within finite ceilings; resume preserves completed work and unresolved spend rather than buying a fresh budget.

MCP is the narrow wire from the PM's coding app to Wringer; ACP is the separate
wire from Wringer to the contained agents. The outer assistant does not become
the worker, the independent judge or the human pen. The cooperative-local
preview's host trust limits are explained in the [assistant threat model](docs/ASSISTANT_SECURITY.md).

## Implemented behavior and remaining acceptance work

The Bun codebase contains strict record readers, contained workflow records, source/authority checks, portable delivery and audit, and standalone verification/board/pen tools. Public graph access is read-only (`wring graph show`, `status`, `explain`). `wring fleet` and `wring bench` execution refuse with a contained-plan migration route; retained graph/fleet implementation APIs are internal/historical, not supported host-worker alternatives. Deterministic tests exercise these seams, including unsuccessful paths.

[Measured repair loops](docs/native/MEASURED_LOOPS.md) now give workers the actual
check failure, distinguish assertion evidence from command failure, stop exact
unsuccessful repeats and record a selected repository playbook. Optional
[experiments](docs/native/EXPERIMENTS.md) can evaluate a future approach under a
separate allowance; adoption never changes active work or grants approval.
These mechanisms are implemented, but live playbook benefit is not yet claimed.

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

Created and directed by [Marc Oakes](https://github.com/marcoakes). The current Bun/TypeScript rewrite and PM workspace were built with **OpenAI Codex** ([rewrite](https://github.com/marcoakes/wringer/commit/3981e9a42f023be2855501c3b07020179d84f4df), [PM workspace](https://github.com/marcoakes/wringer/commit/2f08ca6b4927a70e96d6c36af82ad1b02b2dafb8)). Earlier work with Claude remains credited in Git history.

[Contributing](CONTRIBUTING.md) describes the root workspace and verification discipline. [Architecture](docs/native/ARCHITECTURE.md) describes package ownership and authority boundaries. Historical specifications, reports and release notes remain useful evidence, but their old installation commands and completion claims are not current setup instructions. The [first rewrite report](docs/native/IMPLEMENTATION_REPORT.md) is explicitly historical.

Apache-2.0. See [LICENSE](LICENSE).
