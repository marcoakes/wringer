# Contributing to Wringer

Thanks for landing here this early. **Thirty-two releases have shipped** —
`v0.1.0` on July 31, 2026, then `v0.2.0`, `v0.3.0`, `v0.4.0`, `v0.4.1`,
`v0.4.2`, `v0.4.3`, `v0.4.4`, `v0.4.5`, `v0.4.6`, `v0.4.7`, `v0.4.8`,
`v0.4.9`, `v0.4.10`, `v0.4.11`, `v0.4.12`, `v0.5.0`, `v0.5.2`, `v0.5.3`, `v0.5.4`, `v0.5.5`, `v0.5.6`, `v0.5.7`, `v0.5.8`, `v0.6.0`, `v0.6.1`, `v0.6.2`, `v0.6.3`, `v0.6.4`, `v0.6.5`, `v0.6.6` and `v0.6.7`, all on PyPI, with `v0.6.7` the current one. Since `0.4.0` it is ONE
distribution: `uv tool install wringer` gets the engine, the board and the
drive verb together. The ["One Loop" MVP](ROADMAP.md) it was building toward — a
GitHub issue in, a verified merge request with evidence out — landed with
`v0.1.0`, two months inside its own deadline ([ROADMAP.md](ROADMAP.md)).

September 30, 2026 is still the date this project is working to, but it is no
longer a first release: it is the date the whole path has to hold up, and
what stands between here and it is in [ROADMAP.md](ROADMAP.md). The
[build plan](docs/ARCHITECTURE-NORTHSTAR.md) is the architectural north star;
[ROADMAP.md](ROADMAP.md) governs execution order.

## What's valuable right now

- **The open RFCs.** Three abstractions are being locked down in public,
  as issues titled `RFC:` —
  [the loop-contract schema, the gate plugin interface, and the
  evidence-bundle format](https://github.com/marcoakes/wringer/issues?q=is%3Aissue+RFC).
  If you maintain or use LangGraph, Temporal, CrewAI, or Agent Framework,
  your prior art is exactly what these threads need. Comment before the
  schemas freeze.
- **Design review.** Read the plan and open an issue where you disagree —
  especially on the Graph IR node kinds (§4.1), the loop-contract schema
  (§4.2), and the conformance-suite behaviors (§6 Phase 5). Prior art and
  "this will break because…" reports are the highest-value contributions
  at this stage. This is not a lesser form of contribution here — it is
  the preferred one.
- **Landscape corrections.** §2 is a July 2026 snapshot of a fast-moving
  field. If a vendor surface, protocol, or price changed, file it.
- **Adapter interest.** If you'd want to own a runtime/gateway adapter
  (Temporal, AgentCore, Google, Foundry, Anthropic — or one we haven't
  listed), say so in an issue. Conformance-first: the suite is the
  contract, adapters are community-maintainable.

## Now that code exists

- **The gate is green tests, and Wringer is what runs them.** `wring verify`
  on this repository, in CI, on every push — the repository's own
  `.wringer.yaml` declares two gates, `ruff check src tests examples scripts`
  and `pytest -q`, and both must pass ([README](README.md), *Wringer verifies
  Wringer*). Locally, `sh scripts/ci-repro.sh` runs both in a fresh clone and
  prints an exit code for each; read BOTH. No PR merges red.
- Small, reviewable PRs; conventional commits; evidence in the PR
  description.
- Respect the package-boundary matrix (enforced by lint).
- AI-assisted contributions are welcome and expected — this project is
  built with the methodology it encodes. Follow
  [AGENTS.md](AGENTS.md).

## Governance

Apache-2.0 from day zero. A published governance charter, steering
committee, and foundation-donation path are Phase 7 deliverables (plan
§6/§11). Until then: issues and PRs, benevolent-maintainer mode, and
every decision recorded in the issue that made it.
