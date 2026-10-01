# Wringer — repository operating contract

## Goal and architecture

A PM delegates a bounded specification and returns to useful, review-ready
software with evidence another machine can inspect. Refusal machinery is
necessary, but a refusal is not a successful build.

Wringer is a **Bun/TypeScript harness**. This is the existing repository's full
replacement, developed and published on main. Python is retired as the harness
runtime; do not restore Python packaging, a runtime fallback or a second edition
under `ts/`. Historical source remains in Git. Target repositories and historical
fixtures may use other languages: Bun runs the harness, not every user's project.

The binding architecture is in [docs/REWRITE_PLAN.md](docs/REWRITE_PLAN.md):

1. TypeScript DSL and YAML compile to one validated, versioned execution plan.
2. The Bun CLI scopes, orchestrates, verifies, records and delivers. It does not
   author product code or implement a competing model/tool execution loop.
3. ACP carries work to an agent runtime. It is a protocol, not containment.
4. Worker and judge are isolated runtime instances with separate sessions and
   writable storage. The worker cannot change the judge's authority or evidence.
5. Apple container locally and gVisor-backed Kubernetes contain execution, with
   the repository cloned inside. Never silently downgrade to host execution.
   The one host route is the explicitly declared `trusted-local` runtime (plan v5,
   ruled R-1 on 2026-10-01): roles and checks run as the operator's own processes
   in fresh temporary clones, every record says nothing was contained, and
   protected mode, falsification and design inputs refuse it.

## Three pillars

- **Environmental legibility:** measured repository/context/tool/baseline maps,
  source-linked constraints and acceptance criteria; unknown stays unknown.
- **Repository as system of record:** portable intent, plans, authority, decisions,
  source identities, receipts and delivery lineage. Views derive facts; they
  never manufacture additional authority. A fresh clone can audit the bundle.
- **Mechanical enforcement:** scope, permissions, runtime isolation, resource
  budgets and acceptance are enforced outside worker write authority. Pin the
  active policy; proposed policy changes cannot approve themselves.

Repository configuration is untrusted code/data. The TypeScript DSL must not be
evaluated with host privileges. ACP file/terminal callbacks must stay inside the
correct sandbox. Do not mount host homes, agent control sockets or publication
credentials into workers. Human judgement binds the exact reviewed source.

## Build and verify

Run from the repository root with the Bun version declared in package.json:

```sh
bun install --frozen-lockfile
bun node_modules/playwright/cli.js install --with-deps chromium
bun run check
bun run build
bun run validate
```

The compiled entrypoints are `dist/wring`, `dist/wringer-drive`,
`dist/wringer-board`, `dist/wringer-assistant` and `dist/wringer-figma-broker`.
Python is not required to build or execute them. A target
repository's own checks still require its declared toolchain.

`bun run check` checks generated record types, strict TypeScript and executable
tests. `bun run validate` also exercises compiled distribution and local delivery
fixtures. Fixtures do not prove live agent convergence or real containment.
The optional Temporal adapter has its own suite, run by its own CI job against a
local dev server: `npm ci --ignore-scripts` in `adapters/temporal`, then
`TEMPORAL_CLI=… npm test` there and `bun scripts/graph-temporal-distribution.ts`.
Full validation uses a pinned Chromium test browser to operate the actual PM
forms. Install it once as above; a missing browser must not become a silent skip.
Scripted browser clicks are engineering evidence, never an independent person's
approval or a PM blind-test pass. Do not upload browser cookies, private links,
raw browser traces or controller connection records with public test artifacts.
Keep live platform tests and their exact prerequisites visible as release gates.

## Package boundaries

- `packages/records`: frozen contracts, refusal-aware readers and compatibility.
- `packages/plan`: declarative configuration and environmental legibility.
- `packages/design`: bounded read-only imports, immutable design snapshots and PNG validation; no agent loop or design-account writes.
- `packages/figma-connect`: operator OAuth and server-only broker; no model tool, worker credential access or hosted-service claim.
- `packages/acp`: protocol lifecycle; no model implementation or host tools.
- `packages/runtime`: role environments and sandbox lifecycle/policy.
- `packages/engine`: checks, snapshots, bounded process supervision and receipts.
- `packages/workflow`: durable orchestration, acceptance and authority lifecycle.
- `packages/delivery`: source/evidence anchoring, audit, falsification and forge.
- `packages/board`: derived facts and their human-readable views.
- `packages/scheduler`: bounded graph/fleet orchestration.
- `packages/application`: shared CLI/PM commands, controller queries and guarded effects.
- `packages/mcp`: bounded assistant protocol tools; no approval, publication or agent reasoning loop.
- `packages/cli`: thin command routing and the human pen.
- `adapters/temporal`: an optional Node worker that runs the unchanged graph kernel
  as Temporal workflows; effects go through `wringer-drive graph effect`. No harness
  logic of its own, and not part of the native archives.

## Contracts and evidence

Published files in `schema/` are frozen. Add a new version or sibling record when
semantics change; do not silently reinterpret an existing version. Preserve the
committed historical corpus and its negative cases. Old Python implementation
specs remain historical references for record compatibility, not a requirement
to reproduce retired execution or installation paths.

Capture the source before allocating its evidence bundle. Redact before writing
or truncating. Do not publish secrets, private runtime logs or machine-specific
paths as though another machine can resolve them. Named omissions remain visible.

Passing checks, evidenced requirements, human acceptance and delivery are distinct
facts. Never infer model correctness from a valid JSON shape or green unrelated
tests. Actual observations determine state; absent evidence never becomes zero
cost, success, containment or authenticated identity.

Reserve whole-journey budgets before side effects. On interruption, reconcile
uncertain effects rather than silently replaying paid calls or publication. A
resume does not grant new authority. Never fabricate a human verdict.

## Working authority and delivery

Work on the existing main checkout unless the current task requests isolation.
Historical task permissions do not authorize commits, pushes, releases, spending,
accounts or human decisions for a new task. Obtain the authority required by the
current request and managed environment. Never weaken protection or rewrite tags.

Keep unrelated user edits and inspect coherent diffs. Any authorized publication
must report its exact commit/artifacts and observed remote checks. Local tests
are not CI; a scripted engineering decision is not human acceptance. A candidate
with a dirty source identity is reviewable local work, not a clean tagged release.

Tests accompany behavior changes. Prefer executable adversarial probes over
speculative reviews. Use isolated scratch repositories with repo-local Git
identity and disabled signing; do not alter the user's global config. Retain
failed measurements. Avoid arbitrary recursive deletion of user data.

The root build/release path, current documentation and this file must agree.
Historical measurements remain dated and are not rewritten into success stories.
