# Contributing to Wringer

The active product is the Bun/TypeScript workspace at the repository root. Read [AGENTS.md](AGENTS.md), [architecture](docs/native/ARCHITECTURE.md), and [ROADMAP.md](ROADMAP.md) before changing a boundary or a public claim.

## Build and test

```sh
bun install --frozen-lockfile
bun run check
bun run build
bun run demo
```

Run from the repository root. Use the root lockfile and scripts; do not create a parallel package tree or a Python runtime fallback. Dependencies needed by test fixtures and runtime adapters are separate from a promise that the host is provisioned for a live isolated run.

For a targeted test during development:

```sh
bun test packages/board/test
```

Use the package you changed, then run the full check before handoff. A passing targeted test is not a passing CI run. Keep unexpected output and classify environment failures separately from product-check failures.

## What a useful change includes

- A concrete improvement to the spec-to-working-software journey, or a clearly identified correctness/security repair.
- An executable regression test. Exercise the real parser, state transition, filesystem or process boundary that failed; do not prove only that two renderers share the same wrong value.
- The unsuccessful path: interrupted work, missing evidence, stale approval, unavailable runtime, refused authentication or exhausted budget as appropriate.
- Updated help and documentation for every public command or next-action change. Execute printed recovery commands in an appropriate fixture.
- A report that distinguishes deterministic protocol tests, live platform tests and live model runs. Do not invent a transcript, benchmark winner, cost or completion claim.

Use temporary repositories and explicit fixture identities. Do not read real keys, call a paid model, alter the user's login/global Git configuration, or publish externally as an incidental test step. A local bare origin is sufficient for delivery tests.

## Boundaries to preserve

Wringer is the control plane and ACP client, not the product-code author. Planner, worker and judge have distinct authority and runtime identities. The production route must not fall back to a local shell or direct provider HTTP when isolated ACP execution is unavailable.

Frozen schemas in `schema/` remain frozen. New facts belong in explicitly versioned records or sibling artifacts. Test old committed fixtures through the real readers; do not regenerate historical evidence to make a new reader pass.

The board, summary, certificate and MR must share derivations. Missing usage is unknown, not free. A person's criterion never becomes an agent-authored verdict. Remote publication needs explicit authority on the invocation that performs it.

## Review and reporting

Keep changes reviewable and describe what actually ran. Conventional commit subjects are useful; an unrun test must be named as unrun. Security reports use [SECURITY.md](SECURITY.md), not public issues containing exploit details or secrets.

Historical specs and reports explain earlier rulings and failure modes. Their old packaging commands, module paths and status tables are not the current build contract. Apache-2.0 applies; see [LICENSE](LICENSE).
