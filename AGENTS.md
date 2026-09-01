# AGENTS.md

Guidance for AI agents (and humans) working in this repository. Wringer
dogfoods its own principle: *the repo is the agent-experience surface.*

Read this file, then [docs/specs/SPEC_VERIFY_V0.md](docs/specs/SPEC_VERIFY_V0.md) end to
end. The spec is the binding contract for everything in `src/wringer/`.

## What this repo is

**THE GOAL. Read this before deciding what to work on.**

> A product manager writes an advanced spec, hands it to Wringer, it takes in
> the repositories, and hours later there is working software at enterprise
> quality.

Everything here serves that. Wringer never writes the code — an agent does —
so Wringer's job is to make it impossible for work that does not actually
satisfy the spec to get through: it runs the repo's own gates, keeps evidence
a stranger can audit, and refuses anything it cannot evidence. The refusal
machinery is not the product. It is the reason the product's output can be
trusted, which makes it necessary and not sufficient.

**This has drifted before, and the drift is the defect class this program
exists to catch.** The goal above was approved on 2026-07-31 and then lived
outside the repository, so four spec cycles in a row (vacuity, bench, health,
acceptance) each made Wringer better at REFUSING, none made it better at
BUILDING, and no cycle said it was narrowing — every session reported green
while measuring the wrong axis. That is a check that narrowed while still
passing. `~/Claude/WRINGER_FACTORY.md` carries the blocker list;
`test_the_goal_is_stated_where_every_window_actually_looks` keeps this
section honest.

**The test for any slice:** does it move a PM's spec closer to working
software, or does it only sharpen an existing refusal? Both are legitimate.
Only the first is the goal, and a session that spends itself entirely on the
second must say so in its finish report.

Wringer (`wring`) is open-source and control-plane-agnostic: it compiles
intent (issues, PRDs, Slack messages) into verified outcomes (reviewed MRs
with evidence), using graphs of loop-bearing agents. Nineteen commands are
registered; `wring verify` — the standalone evidence compiler that shipped
as v0.1.0 — is the floor the rest of it stands on. No LLM calls and no
network in anything that proves.

### Document hierarchy

| Document | Authority |
|---|---|
| [docs/specs/SPEC_VERIFY_V0.md](docs/specs/SPEC_VERIFY_V0.md) | **binding** for v0.1 implementation — CLI surface, exit codes, bundle format, build order, release bar |
| [docs/specs/SPEC_RUN_V0.md](docs/specs/SPEC_RUN_V0.md) | **binding** for v0.2 slice 1 — `wring run`, the `run:` config section, the loop's rulings and `wringer.loop.v1` |
| [docs/specs/SPEC_INTENT_V0.md](docs/specs/SPEC_INTENT_V0.md) | **binding** for `wring spec` / `wring plan` — `wringer.spec.v1`, the approval interlock, and why there is no `--yes`. The captured loop is [docs/pm-loop.md](docs/pm-loop.md) |
| [docs/specs/SPEC_GET_V0.md](docs/specs/SPEC_GET_V0.md) | **binding** for `wring get` / `wring issue` / `wring deliver` — and for the amended law 6: the five conditions that buy the power to write git history |
| [docs/specs/SPEC_ACP_V0.md](docs/specs/SPEC_ACP_V0.md) | **binding** for the `acp:` worker form — Wringer is the ACP *client* and never the agent, and it neither bundles nor installs one |
| [docs/specs/SPEC_ACPAUTH_V0.md](docs/specs/SPEC_ACPAUTH_V0.md) | **binding** for the ACP auth handshake — Wringer reads `authMethods` and puts the AGENT's own instructions in front of the operator instead of a generic wall. **The load-bearing ruling is that a successful `authenticate` is NOT evidence**: measured on two vendors, `kimi-code acp` accepts its own advertised method id and stays unauthenticated, and `dcode --acp` returns `result: {}` for a method it never offered. The evidence is the NEXT call succeeding — red-before/green-after arriving at the transport layer. **Wringer never runs a `terminal-auth` command**: a login is somebody's account, and the `_meta` block carries a command from the AGENT, which is arbitrary code from an untrusted party. The credential-driven branch is **NOT BUILT** — *AMENDED 2026-08-30: this row said it was implemented and unexercised, and nothing calls `authenticate` at all.* No agent in the census offers a method that takes one, §3's ruling makes the path unnecessary, and the capture says so ([docs/acp-auth-2026-08-24.md](docs/acp-auth-2026-08-24.md)) |
| [docs/specs/SPEC_JUDGE_V0.md](docs/specs/SPEC_JUDGE_V0.md) | **binding** for `wring judge` — the closed-list packet, the rubric, exit 5, and why a dry run is the default |
| [docs/specs/SPEC_SUPERVISION_V0.md](docs/specs/SPEC_SUPERVISION_V0.md) | **binding** for `wring fleet` and the supervision invariants — every budget nests, every child is reapable |
| [docs/specs/SPEC_VACUITY_V0.md](docs/specs/SPEC_VACUITY_V0.md) | **binding** for `wring verify --prove` and `run.prove` — a green tick that could not have been red is worth nothing |
| [docs/specs/SPEC_PROVENANCE_V0.md](docs/specs/SPEC_PROVENANCE_V0.md) | **binding** for `wring attest` / `wring audit` — what an attestation does and does not claim. Its ruling 1 (unsigned) is SUPERSEDED by [docs/specs/SPEC_SIGN_V0.md](docs/specs/SPEC_SIGN_V0.md); the header amendment carries the history, and unsigned remains the ordinary *local* result |
| [docs/specs/SPEC_START_V0.md](docs/specs/SPEC_START_V0.md) | **binding** for `wring start` — the guided launch: the credential ruling, the non-interactive contract, and why a clone stops before any gate runs |
| [docs/specs/SPEC_GRAPH_V0.md](docs/specs/SPEC_GRAPH_V0.md) | **binding** for `wring graph` — graphs name capabilities never commands, state routes while only bundles gate, a parked graph is exit 5, and `--send` is typed on the invocation and carried by no file. The captured park→resume is [docs/graphs.md](docs/graphs.md) |
| [docs/specs/SPEC_BENCH_V0.md](docs/specs/SPEC_BENCH_V0.md) | **binding** for `wring bench` — contenders declared in config and selected never defined by flags, serial in-process loops under identical ceilings, cost measured-or-reported never priced, and no winner anywhere: bench measures, it does not crown (its ruling 6 is why) |
| [docs/specs/SPEC_HEALTH_V0.md](docs/specs/SPEC_HEALTH_V0.md) | **binding** for `wring health` — a gate that cannot fail is not a gate, said across time: verdicts claim the RECORD and never the gate, positive evidence decides at any depth while only silence needs a history floor, bench-sourced runs are read and decide nothing, skipped bundles are itemised or the tool is the defect it hunts, and the report is a derived view rather than a second source of truth. Adversarially reviewed 2026-08-09 — four lanes, thirty-three findings, twelve HIGH, all folded; fifteen rulings |
| [docs/specs/SPEC_ACCEPT_V0.md](docs/specs/SPEC_ACCEPT_V0.md) | **binding** for acceptance evidence — the bridge from "gates pass" to "the spec is satisfied": a `proves:` key binds a gate to the criterion it evidences, installed only through the human diff; a criterion is evidenced when its gate passed now AND has demonstrably failed before; unevidenced required acceptance refuses delivery by the vacuity precedent; a model never sorts a criterion into a bucket; v0 scopes to an existing repo with a real gate suite, greenfield stated out |
| [docs/specs/SPEC_GATEGEN_V0.md](docs/specs/SPEC_GATEGEN_V0.md) | **binding** for gate authoring (F2) — the drafter proposes per-criterion gates into a `wringer.gates.yaml` sidecar, `wring plan` renders them through the human diff WITH their `proves:` lines and stops, and a generated gate green at birth is self-refuting: the criterion is unmet, so a correct gate must be RED before anyone builds. Reviewed twice: six findings folded by the window that then built to it, then INDEPENDENTLY on 2026-08-10 by R0 — the debt that arc carried is PAID. That pass re-checked all six against the shipped code (five had gone stale and now say so) and added one HIGH: the red run this spec is built around is not the only route to `evidenced`, because a `sensitive` row is also a receipt and SPEC_VACUITY §4b can manufacture one. The captured flow is [docs/gategen.md](docs/gategen.md), which is `docs/factory-dry-run.md`'s scenario re-driven and reaching delivery. **AMENDED 2026-08-11, after the first real agent run:** that HIGH finding is now the ANSWER rather than a worry — born-red is the pedagogy, the `sensitive` comparison is the mechanism. A real agent closes several gates in one turn, `wring verify` stops at the first required failure, so the rest are born green and evidence nothing; `run.prove: true` is therefore effectively required of any repo that binds criteria, and a `sensitive` receipt with no `run.prove_setup` says so in its row. **AMENDED AGAIN 2026-08-27, after the run-6 re-run:** the starvation that made `--prove` effectively required is gone — a gate carrying `proves:` is no longer skipped by another gate's failure, so the historical red is reachable again for every bound gate in one lap. `--prove` remains the mechanism where history cannot supply the red |
| [docs/specs/SPEC_SCOPE_V0.md](docs/specs/SPEC_SCOPE_V0.md) | **binding** for `fleet.scope` and `wring run --gate` (F4 at scale) — a human declares which criteria each task proves, a child converges on its own criteria's gates, and the tick cannot inflate because absence already refuses: scoped-out gates leave no result and acceptance reads that as `gate-did-not-run`. Opens Citadel R2's door carrying all three of its conditions. Independently REVIEWED 2026-08-10 before any code — eleven findings folded, two HIGH: the absence that guards the tick is written only when a human has approved the spec (ruling 5 gained an eighth refusal), and the chain's last DONE box assumed one gate per task. BUILT 2026-08-10/11 in four slices, review folded: the flag, the map with its ten refusals and frozen `wringer.fleetscope.v1`, the honesty fixes (worktree teardown preserves the evidence its summary cites, and the preserved copies are never a discovery root), and the capture. The captured flow is [docs/fleet-scale.md](docs/fleet-scale.md) — one spec, two tasks, a scoped fleet reaching `wring deliver`, with a task owning TWO gates because one gate per task would demonstrate less than the box claims. It also documents, at the same volume, the four things a scoped fleet still cannot do |
| [docs/specs/SPEC_ENV_V0.md](docs/specs/SPEC_ENV_V0.md) | **binding** for environment stops (F6) — route on facts, hint on text, claim on neither: a gate that could not run is not a gate that failed. **BUILT 2026-08-17** (`e93a243`), after the independent pass its own header chartered finally ran: **NOT SOUND, 16 findings, and rulings 3 and 4 turned out to be UNBUILDABLE** — `result` is `additionalProperties: false` on a frozen schema, `task.parked`'s `why` is a closed enum, and a graph loop node cannot reach `parked`. Two of the three walls had been built by a LATER cycle citing this spec's own argument. Folded as dated amendments; `diagnosis.json` is a sibling and NO version was spent |
| [docs/specs/SPEC_DRIVE_V0.md](docs/specs/SPEC_DRIVE_V0.md) | one verb, prose in, board out — the PM's OPERATING surface, which the arc so far did not touch (Postscript P). A THIRD package: not core (19 is the ceiling), not the board (a renderer that drafts and delivers would make the board's own claim about itself false). It composes the nineteen and invents nothing. **AUTHORED, REVIEWED (NOT SOUND, 19 findings, ALL FOLDED) and BUILT WHOLE** in `wringer-drive`, 2026-08-17 — steps 0 to 10, and §6's number MEASURED at **27s from a prose PRD to the first honest green**, ten answers, no editor ([docs/drive/docs/pm-mode-2026-08-17.md](docs/drive/docs/pm-mode-2026-08-17.md) in that repository). The transport is RULED: the PM's own coding agent, with a terminal fallback reading the same steps. Easy never means unguarded: no `--yes`, refusals render and never resolve, nothing writes a judgement, and the run that produced the number EXITS NON-ZERO because `wring deliver` refused work whose proof it could not show. §3a is the one licence it takes — DRIVE installs the gates `wring plan` proposed, by `git apply` on the engine's own rendered diff, after a yes. **Building it found two live defects by execution: a PM answering "yes" wrote a YAML boolean and broke their own spec (fixed, board `fe53027`), and `wring spec --send` could not reach any current-generation Anthropic model because `spec.build_request` always sent `temperature: 0` — **FIXED 2026-08-18**, the key removed with no knob replacing it, proved live in both directions (`claude-opus-5` HTTP 400 → exit 0; `claude-sonnet-4-6` still drafts), [docs/temperature-2026-08-18.md](docs/temperature-2026-08-18.md)** |
| [docs/specs/SPEC_PERF_V0.md](docs/specs/SPEC_PERF_V0.md) | **binding** for `gates[].concurrent`, `wring verify --serial` and `wringer.concurrency.v1` — gates may run at once, but only where a repository declared it, in maximal CONSECUTIVE groups so declared order stays a contract. **The reason it needed a spec: `duration_ms` is not private to a run** — health flags 2× drift off it, so a contended wall clock would report the instrument moving as the gate slowing. Recorded in a sibling, EXCLUDED from the drift trend, and the exclusion is counted rather than silent. The ledger stays single-writer (two threads at `prev_hash` would break the chain and `wring audit` would cry tampering on an honest run); a group FINISHES before the stop is decided, so the contract holds at group granularity; interrupts kill the gates in flight through `on_spawn`. Answers all four of WRINGER_SPEED_PLAN §4's open rulings, diverging on R3 with a reason: a per-gate declaration, never a job count, because only the repo knows which gates interfere. §7 says why caching and judge calibration are NOT here |
| [docs/specs/SPEC_BENCHMARK_V0.md](docs/specs/SPEC_BENCHMARK_V0.md) | **binding** for `benchmark/` — the harness for the one experiment that can LOSE: *`delivery_eligible` is a better predictor of actually-correct than the agent's own say-so*, measured as a 2×2 against upstream's held-out tests. Lives outside `src/wringer/` and is pruned from the distribution: it runs Wringer and may never be reached for by it. Held-out tests are refused if reachable from the tree, a gate command or the statement, and scoring happens in a THIRD copy. **VOID contributes to no rate, and rule 2 is the one to read**: arm B counts a refusal only on `wring deliver` exit 1 (refused on the EVIDENCE) — exit 2/3 is the machine, and a constant refuser would otherwise score perfect precision on an accident. No aggregation, on purpose. **BUILT and proven on two scripted tasks at zero cost; NO corpus run** (~$80–400, Marc's to approve). §9 carries its first real finding, and it is not flattering: Wringer's precision is bounded by the quality of the gates the repo wrote down — one demo task is a Wringer LOSS and ships anyway |
| [docs/specs/SPEC_ATTEMPTS_V0.md](docs/specs/SPEC_ATTEMPTS_V0.md) | **binding** for `bench.attempts` / `bench.parallel` and `wringer.bench.v2` — N **independent attempts** per contender, each with its own worktree, loop bundle and ledger, from one checked baseline under one ceiling. Closes bench's own first stated limit (*"one run per contender; agents are stochastic"*) with a measurement instead of a warning. **It still does not rank**: `agreement` compares a contender with ITSELF, `insufficient` is the default and expected verdict, and `inconsistent` — different outcomes on the same tree from the same commit — is the agent's own nondeterminism, the same finding a flaky gate is one level down. Serial stays the default and builds no pool; `parallel` spends the wall-clock column and the artifact says so. **The ledger is written by one thread**, because two appending to `prev_hash` would break the chain silently and `wring audit` would later cry tampering on an honest run. A Ctrl-C reaps through `loop.worker_pgids`, or a thread pool would revoke reapability |
| [docs/specs/SPEC_SIGN_V0.md](docs/specs/SPEC_SIGN_V0.md) | **binding** for `provenance:`, `wring attest --sign` and the three axes `wring audit` reports — *a signature binds the identity of the runner, never the correctness of the work*. Reopens the 2026-08-05 UNSIGNED ruling on the one ground that changed: keyless holds no long-lived key. **CI-only**, because a laptop has no ambient OIDC identity and the fallback is an interactive login — so `signature_missing` is the ORDINARY case, exits 0, and is marked `·` not `!`. Integrity, signature and identity are never collapsed into one boolean; `signature_unverified` is a fourth status added because "present and nobody checked" cannot honestly be called valid, invalid or missing; `identity_trusted` needs a repo to have named whose signature to expect. `audit` stays offline by default and reads NO config, so two auditors agree. Wringer signs nothing itself — it shells to `cosign`/`gh`, holds no key (a test greps for `--key`), and is the **fifth** sender. `provenance.require_signature: true` refuses delivery from an environment that cannot sign, with no flag to bypass. §9: the logic is exercised against a real stub signer; Sigstore itself is argv-only |
| [docs/specs/SPEC_EXEC_V0.md](docs/specs/SPEC_EXEC_V0.md) | **binding** for `execution:` and `wringer.execution.v1` — WHERE a gate runs. `local` is today's behaviour and is recorded as `execution_mode: trusted_local`, **never `sandboxed`**; `container` runs the gate inside an image the repo NAMED (no default, the `judge.endpoint` rule) with one explicit mount, an env allowlist by NAME (`--env NAME`, never `NAME=VALUE`, because an argv is readable by `ps`), the network off unless typed on, and a cidfile so a timeout kills the container and not just the client. `execution.json` is written on **every run, opt-in or not** — the only unconditional sibling, because a reader who is not told where a command ran supplies the flattering answer. §5: the WORKER is never contained and `worker_execution` says so separately. §6: `--prove` under a container is `inconclusive` (a worktree's `.git` is a file, and §1 of vacuity would read the resulting failures as PROOF). **§7 was the half that was not measured when the spec was written** — every property is a flag with a test behind it, and it PREVIOUSLY said no container has ever run through this backend and that sequence G is one command and still unrun. **Corrected 2026-08-23: sequence G has since been RUN and classified three times** — macOS/podman and a shared-kernel Linux guest on 2026-08-13, Docker on 2026-08-14 — and `docs/MANUAL_CHECKS.md`'s coverage record carries all three. SECURITY.md's "designed to isolate" is still deliberately unchanged, and the spec's own §7 now carries a dated note saying so |
| [docs/specs/SPEC_CONTAIN_V0.md](docs/specs/SPEC_CONTAIN_V0.md) | **binding** for `run.containment:` and `wringer.execution.v2` — WHERE THE WORKER runs, the half SPEC_EXEC_V0 §5 recorded and left open. **The key is `run.containment` and never `execution.backend`, by ruling** (SPEC_GATEGEN_V0 §6 W9): `vacuity.prove` returns `inconclusive` for the latter, so containment carried there would have made every witness in Phase 3's committed re-test `inconclusive` and the money would have measured nothing. **Declaring is not establishing** — eleven named refusals, split STATIC (checked by `wring verify` too, no process and no packet) from DYNAMIC (checked where a worker is about to run, because arming an allowlist means issuing a DNS query). The broker is two capabilities and no vocabulary for a third: an env allowlist by NAME, and an egress policy of `none` (`--network none`) or `allowlist` (a netns holder the worker joins **without** `NET_ADMIN`, so it is subject to the rules and cannot disarm them). `worker_execution` splits `declared` (policy, always) from `established` (what this lap stood up, **absent when it stood up nothing**). §7 is the ceiling: eight scripted probes are not an escape suite, it is an ADDRESS allowlist so co-tenants are reachable, and nothing here upgrades SECURITY.md's "designed to isolate" |
| [docs/specs/SPEC_STABILITY_V0.md](docs/specs/SPEC_STABILITY_V0.md) | **binding** for flaky gates — a nondeterministic gate is indistinguishable from a failing one, so without this the loop hands it to an agent, the agent edits source that was never wrong, and the next green draw reads as a fix. A gate declares `stability: {attempts, require_consistent}`; classification comes from the OBSERVATIONS and from no gate's output (`stable_pass` / `stable_fail` / `flaky` / `unknown`); every attempt keeps its own directory, because a gate run three times reporting one clean result is what a hidden flake looks like; and a `flaky` gate is **never handed to a worker** — `wring run` stops `flaky_gate` having called nobody, and a fleet child is not retried, because a retry buys a coin flip. `require_consistent` defaults to TRUE and is refused outright beside `proves:`. The absence of the key is the compatibility boundary: one attempt, byte-identical bundle. BUILT 2026-08-12; §8 names the six things it does not do, and §9 is why `wringer.loop.v2` exists |
| [docs/specs/SPEC_BOARD_V0.md](docs/specs/SPEC_BOARD_V0.md) | **binding** for the PM surface (the requirements board) — the first cycle of `WRINGER_PM_ARC.md`'s arc, authored under its rulings B1–B8 and L1–L5 and under the fork ruling's Q1 claim ceiling. A SEPARATE LAYER consuming bundles and the CLI as its API: the core stays headless, Apache-2.0 and at **19 commands**, and gains exactly one thing — a gate-artifact slot as a NEW sibling file, never a relabel of the closed nine-field `gate-result.schema.json`. The board renders and never decides: every card state is a function of bytes the engine wrote, "every green on this board was red first" renders only when every row CLAIMING `evidenced` resolves its receipt chain, and missing data is UNKNOWN rather than green. **PM_ARC's own state names are not the tree's** and the spec says so in its header (`not_evidenced` does not exist; `gate-did-not-run` has no PM_ARC state; PROVEN-RED is refused as underivable from disk). Grounded at `d23d7ca` against the A-probe, which rendered five real bundles and found thirteen gaps — including that a required `human` criterion never refuses delivery, and that delivery's 23 refusals have no names at all. **INDEPENDENTLY REVIEWED 2026-08-15 before any code — the debt SPEC_GATEGEN carried is paid up front here — verdict SOUND WITH FINDINGS, 27 findings (5 HIGH), all folded and none rebutted;** the HIGH ones are why the board resolves BOTH receipt kinds (a `sensitive` receipt cites a run where the gate PASSED, so the first draft would have rendered UNKNOWN for every criterion in a `run.prove: true` repo), why `unevidenced`'s FOUR causes never collapse into one sentence (the first draft rendered the anti-circularity refusal as its exact opposite), and why NOT REACHED asserts no cause — two captures in this repo have `gate-did-not-run` with no failing bound gate at all. BUILT — `src/wringer_board/{cards,read,render,refusals,judge,interview}.py`, twelve test modules under `tests/board/`, and S4's engine change at `src/wringer/artifacts.py`. *AMENDED 2026-08-30: this row said UNBUILT.* §9's four slices sit UNDER §8a's priority rule, so board work never delays a containment or witness window |
| [docs/specs/SPEC_CERTIFICATE_V0.md](docs/specs/SPEC_CERTIFICATE_V0.md) | **binding** for `certificate.json` / `certificate.md` (`wringer.certificate.v1`, a NEW sibling) — the proof that TRAVELS, written by `wring deliver` beside `mr.md`, and re-checkable offline against a clone by `wring audit certificate.json`. Every requirement BY TITLE with what the record can honestly say about it; the check is AUTHOR-BLIND and a test moves every name to prove it. Shipped 0.5.0. *Row added 2026-08-30: this table listed no row for it, and the guard could not tell — it searched the whole file, and the module map mentions it.* |
| [docs/specs/SPEC_COVERAGE_V0.md](docs/specs/SPEC_COVERAGE_V0.md) | **binding** for `coverage.json` (`wringer.coverage.v1`, a NEW sibling) and the ONE renderer four surfaces quote. TWO sentences over two DISJOINT populations, never blended (ruling MR1). Shipped 0.5.1, and reaches the console since 0.5.6. *Row added 2026-08-30.* |
| [docs/specs/SPEC_FALSIFY_V0.md](docs/specs/SPEC_FALSIFY_V0.md) | **binding** for `wring verify --falsify` and `falsification.json` — mechanical, MODEL-FREE mutation of the delivered diff, reporting which breakages the bound checks did not notice. A survivor is a finding about the CHECKS. Shipped 0.5.2, and reaches the console and `--json` since 0.5.6. *Row added 2026-08-30.* |
| [docs/specs/SPEC_REFUSAL_V0.md](docs/specs/SPEC_REFUSAL_V0.md) | **binding** for refusal legibility — the engine names what it refuses and why, so a surface never has to parse English prose to find out. Discharges `SPEC_BOARD_V0`'s OQ-1..4 and records OQ-5 as already landed at `ab884b5`. Three NEW schema files, no frozen one touched: `wringer.acceptance.v3` (a closed `cause` enum over `unevidenced`'s **FIVE** causes — the fifth was found on real data by the board, not by reading — plus a three-valued `demonstrated_able_to_fail`, where `null` means *not asked* and is not `false`), `wringer.refusal.v1` (a record beside a refused delivery; `deliver.REFUSAL_REASONS` names all 23 sites and `Refused.__init__` REQUIRES the name, so a new site cannot omit one), and `wringer.judgement.v1` (a sibling file, because the spec schema is frozen and closed). **The one policy change is OQ-1**: a required `human` criterion refuses delivery unless a person recorded it met — three distinct causes, never collapsed (unanswered / said-no / stale). A judgement is pinned to the criterion's wording and to NOTHING ELSE, and that limit ships in `acceptance.json`'s own `limits[]` rather than being hidden. **`wringer.acceptance.v2` was already spent by the witness lane at `f310b7f`**, which is why the spend is v3. Nothing here judges, scores or lets any model answer a `human` criterion |
| [docs/specs/SPEC_WORKER_V0.md](docs/specs/SPEC_WORKER_V0.md) | **binding** for the 0.6.0 worker contract — the `exec:` worker form (argv, declared brief transport, no shell), `{brief}` required of every shell worker at preflight (`worker_unbriefable`), the typed worker-auth state for EVERY worker (verified / rejected / unknown / not-applicable, rendered on the run path before spend), `worker_auth_rejected` with the displacement named (a set key DISPLACES a stored login — measured on two vendors), the `worker_read_only` stop carrying the worker's own words, and the capability stamp: every published shell recipe driven through a real `wring run` in CI with a fake vendor binary — brief received · repo editable · terminates. **The real-vendor canary is a STOP for run 4, never CI's.** Authored from run 3's F4–F10, each clause measured failing before it was written |
| [docs/specs/SPEC_LOOPBACK_V0.md](docs/specs/SPEC_LOOPBACK_V0.md) | **A DRAFT THAT DECIDES NOTHING AND BUILDS NOTHING** — the auth endgame, sketched. Today a product manager needs an API key, not the Claude subscription they already pay for and are already signed into, and the machine has a working authentication a metre from the thing that cannot authenticate: the engine SPAWNS its worker, so the worker is a child with no access to the driving agent's session. Loopback inverts that — the agent connects to the engine as the worker. Says loudly what it does NOT change: the engine still decides what a turn is and when the loop stops, containment still applies, evidence is unchanged, and **the drafting call still needs a key** — loopback addresses the worker, not `wring spec --send`. §4's fork is keyed on a measurement NOT YET TAKEN (does a subscription credential work against the drafting endpoint?): if yes it is a convenience cycle, if no it is the audience fix and goes to Fable with the retest capture as evidence. §5 names the largest unexamined assumption in it — **nobody has measured where PMs actually stall** |
| [docs/specs/SPEC_HUNT_V0.md](docs/specs/SPEC_HUNT_V0.md) | **AUTHORED 2026-08-23, REVIEWED TWICE, NOT SOUND TWICE — BLOCKED, DO NOT BUILD TO IT.** The idea is per-hunk vacuity: revert each unit of a delivery candidate ALONE and record which units the delivery's own evidence set would not notice — the axis `--prove` (the GATES) and acceptance (the CRITERIA) do not cover. Note-tier by ruling; `docs/witness-programme.md:147` kills mutation testing as a MERGE GATE and an escalation amends that document by dated note FIRST. **Both mechanisms died to MEASUREMENT, not to reading** ([docs/hunt-mechanism-2026-08-23.md](docs/hunt-mechanism-2026-08-23.md)): draft 1 built the tree as a worktree-at-base with every hunk but one applied, and ONE binary file anywhere makes `git apply` refuse the lot; draft 2 copied the candidate, and **a copy does not carry the environment** — an editable install's `.pth` is an absolute path into the operator's tree, so redaction disabled in the COPY still gave `8 passed` and every `src/` unit would have read `unnoticed`. The baseline lap cannot see it: it closes the INVERTED trap, and this is the FORWARD one. Six things are OWED to Fable before a line is written, listed in the spec's own STATUS block — chief among them a POSITIVE check that the checks read the copy, and an arithmetic that closes (measured 432s per evidence lap against a 900s budget and a cap of 40) |
| [docs/specs/SPEC_PMPLAN_V0.md](docs/specs/SPEC_PMPLAN_V0.md) | the PM CONSENT surface — what a product manager approves, and how they change their mind. Three things that look separate and are one: **assumptions get a channel** (the drafter already writes them, into `guidance`, where the approver never reads them as decisions — the behaviour exists and the field does not), **the plan gets two registers** (a plain-language `outcome` per task beside the machine `objective`, person's register first), and **the PM gets a way back** (a board `revise` verb where every revision structurally un-approves). Nothing frozen moves: assumptions, outcomes and an approval fingerprint land in a NEW sidecar (`wringer.decisions.v1`), because `wringer.spec.v1` is closed and a version spend ripples through every reader in the chain. The "at most three questions" rule becomes a PARSE-TIME guard rather than a sentence in the request — prompts are not guards, measured twice on this repo. **AUTHORED 2026-08-19, then adversarially REVIEWED — verdict NOT SOUND: 8 lanes, 57 agents, 97 raw findings, 54 after dedupe, 19 CONFIRMED by two independent skeptics each, 5 killed, and 30 below the verification cap and so unexamined rather than clear. The fold is DONE** — *AMENDED 2026-08-30: this row said the fold was in progress and forbade code against the spec. The spec's own Status block reads "All 19 confirmed findings are now FOLDED; slice 1 is done and slice 2 may begin", and the code shipped: `spec.MAX_REQUIRED_QUESTIONS = 3` enforced at parse, `_BURIED_DECISION_MARKERS`, `wringer.decisions.v2`, and the board's `revise` verb.* (§Status; full record at [docs/pmplan-review-2026-08-19.md](docs/pmplan-review-2026-08-19.md), kept verbatim so the fold can be checked against what the review said). **The review also found TWO LIVE BUGS in shipped `wringer-board` code it was not looking for** — the interlock line edit corrupted a hand-written `approved: False` into `approved: Falsetrue`, and a spec saying `approved: no` (valid YAML the ENGINE accepts) could not be approved at all, with an error telling the person their file had no `approved:` line. Both fixed, board `99b9f25` and `2653d25`, thirteen guards watched red first. Three HIGH defects in the first draft were found by EXECUTION against the measurement run's own artifacts, not by re-reading it: the buried-decision detector matched run 1's literal sentence and so found 4 of the 14 real cases while calling three runs clean — and **the correction to it was ALSO wrong and was published before an adversarial review caught it** (`decision taken` finds 10 of 14 and misses run 2's four entirely, which were labelled `Decision to approve:`), so the detector is now ruled a LOWER BOUND with no known ceiling and no true-negative case in the corpus; the ending block was INVERTED against `accept.py` — it told a PM that unbound criteria would hold their handover, when `accept.py:406-450` says an uncovered row is "a debt the author has not paid yet — loud, never fatal" and the measured drive named exactly ONE criterion out of nine as holding it, the `human:` one (**the carrier's own §0.4 states the wrong cause for that ending, and this spec repeated it before two review lanes caught it**); and the SPEC_BOARD non-goal 9 amendment it needs turned out to have three teeth rather than one. Grounded on [docs/variance-2026-08-19.md](docs/variance-2026-08-19.md) |
| [docs/variance-2026-08-19.md](docs/variance-2026-08-19.md) | **the measurement, not a spec** — four `wring spec --send` calls on ONE unchanged PRD, captured byte for byte at `tests/replies/2026-08-19-arcade-run{1..4}-drafter-reply.json`. `prompt_tokens` is 2206 on all four, so every difference is sampling variance rather than a different question. What they disagree about: 9/10/12/11 criteria, and **run 2 ASKED whether history is per-browser while run 1 DECIDED it silently** and wrote the decision into a criterion's test guidance. **Fourteen criteria across ALL FOUR runs** carry such a buried decision, and each run labels it its own way — four rolls, four phrasings. **What a person consents to depends on a die they cannot see** — the fact SPEC_PMPLAN_V0 exists to answer. **Carries a dated same-day CORRECTION: its first version claimed ten across three runs with run 2 as a clean "negative control", and run 2 in fact buries four under `Decision to approve:`.** The correction is left visible because the mistake IS the finding — a phrase was matched against these four files twice, hours apart, and believed sufficient both times. Also records what it does NOT say: four runs are a sample not a distribution, 14 is what was LABELLED rather than what was decided, and a detector's silence is not evidence that a draft took no silent decisions |
| [docs/field-report-2026-08-21.md](docs/field-report-2026-08-21.md) | **the measurement, not a spec, and the only one written by someone who is not the author** — two real end-to-end runs by a product manager on a second Mac (2026-08-18 against an old install, 2026-08-21 against released 0.4.0), preserved byte-intact. **It outranks every proxy cold read this repo has**, because a cold read asks a model to imagine being a stranger and this is a stranger. The verdict: *"The consent and honesty model is excellent and worth building on. But the product currently assumes an operator who can install a Python toolchain, read `pyproject.toml`, interpret a pytest suite, and recover from mistakes by editing YAML."* Neither run built anything. What it confirms as GOOD is as load-bearing as what it breaks — the approval interlock, the refusal to deliver unevidenced work, `DECIDED WITHOUT ASKING YOU`, an empty board that refuses to imply progress, and a resume that does not re-spend. What it broke is the PM FRICTION PURGE window (`~/Claude/WRINGER_PM_FRICTION_PLAN_2026-08-20.md`), whose §1 dispositions **every** finding to a slice or to a deferral with a checkable reason |
| [docs/corpus-2026-08-13.md](docs/corpus-2026-08-13.md) | **the measurement, not a spec** — the first corpus: 13 real upstream bug fixes, 5 repositories, TWO full passes, 52 rows, $76.99. **The claim LOST, and the artifacts say why:** `wring deliver` said yes on 26/26 arm-B rows including every wrong change, the repair loop ran ZERO worker turns in 26 attempts, and `wring verify --prove` afterwards returns `gates_vacuous` on 13/13 — the repo's own suite was green before each change and green after it, so it could not testify either way. The verdict was set by a config flag, not by the change. Also the headline finding an adversarial audit produced: **the corpus leaked the answer** — a `git clone` carries the whole history, so upstream's fix sat in `.git` of every tree, and 9 of 26 run-1 rows are contaminated. Closed by truncating to one commit and now REFUSED by `check_isolation` via `forbidden_shas`; the network channel cannot be closed and is recorded per row instead |
| [docs/benchmark-first-run.md](docs/benchmark-first-run.md) | **the measurement, not a spec** — 2026-08-13, the first real model through `benchmark/harness.py`. Both arms `true_confidence` on the same honest one-line fix, $0.135 reported: **the plumbing works and the task decided nothing**, which is CORPUS.md §3's rule demonstrated by being broken. Also carries three defects the run found — `wring deliver` crashing with a `UnicodeDecodeError` on an untracked latin-1 file (exit 1 with a traceback, indistinguishable from a failed gate, so the harness scored a refusal Wringer never made), the harness handing ACP a relative `cwd`, and a fixture planting a bare repo inside the tree — plus one that is nobody's defect: **the agent verified its own work with the stale `wring 0.2.0` on PATH**, writing bundles with no `execution.json` into a 0.3.0 repo |
| [docs/first-contact.md](docs/first-contact.md) | **the measurement, not a spec** — 2026-08-11, the first cycle with a real model at both ends of the goal sentence. Read it before assuming what an agent does here: the drafting half produced a valid spec carrying **zero installable gates and zero criterion bindings** (still true, ruled as its own slice), and the agent half never opened a session because `session/new` omitted `mcpServers`. **FILMED — [docs/first-contact.svg](docs/first-contact.svg) is the goal sentence end to end with a real model at both ends: a PRD in, a real drafter, a person approving and installing the checks, a red gate, a real agent's turn, `evidenced: 3`, a pushed branch. Filmed once and not regenerable — it needs a credential, and `demo.sh` refuses rather than filming a stub.** The wire defect is fixed and the probe was re-run: an agent has now taken a turn. It converged in 4m37s for $0.75 — and closed three acceptance gates in one turn, two of which had never been red, so acceptance reads `evidenced: 0, unevidenced: 3` and every criterion refuses. That is the one-verify-arms-one-gate hole, measured. Also measured: the agent uses its OWN filesystem calls, never `fs/write_text_file`, so `acp._inside`'s path-escape refusal never runs. The page is evidence and is not rewritten — its two postscripts carry what changed |
| [ROADMAP.md](ROADMAP.md) | execution order (90-day compression) |
| [docs/ARCHITECTURE-NORTHSTAR.md](docs/ARCHITECTURE-NORTHSTAR.md) | architectural north star (post-v0.1) |
| README · [QUICKSTART.md](QUICKSTART.md) | landing pages — transcripts are now **real captured output**; if you change console or bundle shape, recapture them rather than editing the numbers by hand |
| [examples/claude-code-hook/](examples/claude-code-hook/) | the agent loop as a Claude Code `PostToolUse` hook — an *example*, not part of the package; it ships no code into `src/` and adds no dependency |
| [SECURITY.md](SECURITY.md) | the execution model (`.wringer.yaml` is code), what a bundle may contain, reporting channel |

Where they disagree about v0.1, the spec wins.

## Current state — v0.6.2 shipped; unreleased work on `main`

**`v0.1.0` through `v0.4.7` are tagged and on PyPI**
(`uv tool install wringer` — one distribution, four executables, since 0.4.0). `wring init`, `wring verify` and `wring explain` were
the first of those: `verify` runs a repo's whole declared gate set and writes
a real bundle, `--json` feeds agents, and secrets never reach the disk.

Since v0.1: `wring run` closes the loop, `wring
resume` continues a killed one, `wring fleet` supervises hundreds, `wring
judge` weighs a finished bundle against a rubric, `wring doctor` checks this
machine's preconditions, the `acp:` worker form talks to any agent that speaks
the protocol, and `wring spec` / `wring plan` are the front door — a PRD in,
a spec a human approves, work a fleet can run; P3 brings work in as a URL and
sends it back out as a reviewed branch; P5 turns a finished run into an
attestation `wring audit` checks offline; and P4's `wring start` is the guided
launch a new user meets first; `wring bench` compares workers without crowning
one, `wring health` reads a repo's gate history, `wring graph` sequences the
whole thing, and `fleet.scope` lets a human declare which criteria each task
proves. 1400+ tests on Python 3.11–3.13 plus macOS in CI.

**2026-08-13 — six slices landed in one arc, and the order they are listed in
is the order to read them.** Each has its own spec; each names what it did NOT
do, and two of them say the honest answer was "not this".

| slice | what now works that did not | and what it does not |
|---|---|---|
| flaky gates ([SPEC_STABILITY_V0](docs/specs/SPEC_STABILITY_V0.md)) | a gate can declare `stability: {attempts}`, its attempts are classified from OBSERVATIONS alone, every attempt is on disk, and a `flaky` gate is **never handed to a worker** — `wring run` stops rather than asking an agent to fix nondeterminism | `wring health --json` says nothing about stability (frozen schema); a flaky fleet child is `failed` rather than `parked` |
| where gates run ([SPEC_EXEC_V0](docs/specs/SPEC_EXEC_V0.md)) | `execution: {backend: container}`, and **every bundle now says where its gates ran** — `trusted_local`, never `sandboxed` | **AMENDED 2026-08-13: sequence G HAS now run**, twice — podman on macOS and again inside a shared-kernel Linux guest — 7 attacks, 6 prevented / 1 mitigated, classified in docs/MANUAL_CHECKS.md. **RE-AMENDED 2026-08-16: the previous sentence here said "SECURITY.md is STILL unchanged … and docker remains unmeasured", and both halves are now false.** Docker was measured on 2026-08-14, and SECURITY.md was corrected on 2026-08-15 with a dated note saying understatement is also a stale claim — this row was the sibling that did not follow, which is the same defect a third time. What survives unchanged: seven scripted reads are not an escape suite, there is still no `--privileged` control for the GATE path, and the first run found two of the seven attacks measuring NOTHING (no `curl`, no `ps` in the published image) |
| signed provenance ([SPEC_SIGN_V0](docs/specs/SPEC_SIGN_V0.md)) | `wring attest --sign` in CI via keyless OIDC, and `wring audit` reports integrity / signature / identity **separately** with `signature_missing` as the ordinary case | Sigstore itself is argv-only — neither cosign nor gh is on this machine |
| independent attempts ([SPEC_ATTEMPTS_V0](docs/specs/SPEC_ATTEMPTS_V0.md)) | `bench.attempts` / `bench.parallel`: N independent attempts per contender, and `agreement` — which compares a contender **with itself** and still crowns nobody | no aggregate over attempts, ever: a mean is a score wearing a statistic |
| the benchmark ([SPEC_BENCHMARK_V0](docs/specs/SPEC_BENCHMARK_V0.md)) | `benchmark/` runs a task through two arms against upstream's held-out tests and writes a 2×2 row. **Proven on two scripted tasks at zero cost** | **AMENDED 2026-08-13: the corpus RAN, twice** — 13 real upstream fixes, 52 rows, $76.99, [docs/corpus-2026-08-13.md](docs/corpus-2026-08-13.md). **The claim LOST**: `wring deliver` said yes on 26/26 supervised rows including every wrong change, the repair loop ran 0 worker turns in 26 attempts, and `--prove` afterwards is 13/13 `gates_vacuous`. A repo's own suite is green before a fix and green after, so it cannot adjudicate the fix. An adversarial audit also found the corpus had LEAKED THE ANSWER through `.git`; closed, and now refused by `check_isolation` |
| gate parallelism ([SPEC_PERF_V0](docs/specs/SPEC_PERF_V0.md)) | `gates[].concurrent: true`, `wring verify --serial`, and health excluding contended durations from its drift trend — answering all four of WRINGER_SPEED_PLAN §4's open rulings | **no caching**: no cache key can enumerate the environment, the toolchain or the clock, so every hit can be a false green (§7 has the analysis). **No judge calibration**: its precondition was that the benchmark show judge quality load-bearing, and the evidence shows the opposite |

Three bundle formats moved, each with v1 still published and still frozen, and
each with a test proving a v1 bundle already on disk is still read:
**`wringer.loop.v2`** (an OPEN `reason` string, so no future stop reason costs a
version), **`wringer.bench.v2`** (a per-row `attempt`), and four new siblings —
`execution.json`, `stability.json`, `concurrency.json` and `attestation.json.sig`.
`wring attest --sign` makes the senders **five**, and every count in the docs says
so.

**2026-08-14 — `wringer.benchmark.v4`: a row now carries the change it is
about.** Until v4 a row's `evidence` was `{tree, base_sha, workdir}`, and
`tree` is a path into a `/private/tmp` session scratchpad. So the 52 published
corpus rows described 52 agent changes of which this repository held **no
copy**, and the only copies were uncommitted edits in scratch directories that
are deleted without warning. They were still there and are now in
[`benchmark/corpus/results/patches/`](benchmark/corpus/results/patches/):
**52/52 trees reachable, 0 gone, 51 patches, all 51 verified to apply to their
`base_sha`**; the 52nd is an agent that changed nothing and claimed success
anyway. v1–v3 are named as PAST and the published v2/v3 rows are untouched.

Two things in `change_patch` are load-bearing and each has a test that has been
watched to fail: it stages before diffing, because part of a real change is
*untracked* and a bare `git diff` drops the agent's new test files
(`deliver.py` shipped that exact bug once); and it stages into a **throwaway
index** under `GIT_INDEX_FILE`, because the arm's tree is the exhibit and a
harness that rewrote its index while recording would be editing the evidence.
`patch: None` with `patch_error: None` means the agent changed nothing —
never conflated with a failed capture, which is an instrument malfunction and
says so.

**2026-08-15/16 — the trust arc ran to its end, and the claim it was testing
LOST.** Read this before proposing anything in the witness area; more than one
window has inherited a sentence from before the retreat.

| what landed | where | what it means for you |
|---|---|---|
| **Containment** ([SPEC_CONTAIN_V0](docs/specs/SPEC_CONTAIN_V0.md), `f002bd0`) | the worker joins a network-namespace holder **without `NET_ADMIN`**, so it cannot disarm its own boundary | containment is worker-side. It is not `execution.backend`, and that shape was considered and refused (W9) |
| **The witness lane wired to delivery** (`f310b7f`, `wringer.acceptance.v2`) | a red witness refuses a delivery over a green vacuous gate | the schema spend of `acceptance.v2` is **already made**. A cycle needing a new acceptance shape spends the NEXT version |
| **The loop engages while a witness is red** (`ef07f97`) | the loop's continuation predicate is no longer gate-only | it ran live on exactly the three corpus rows whose witness stayed red |
| **In-toto beside the bundle** (`f27681a`) | R3 discharged | `wringer.attestation.v1` is frozen and gains no dialect. The standard is emitted alongside, never inside |
| **THE RE-TEST LOST** (`039bebc`) | one pass, 13 real upstream bug fixes, both arms, $53.34; three of six pre-registered clauses missed ([docs/corpus-2026-08-16.md](docs/corpus-2026-08-16.md)) | **the bug-fix claim came out of the README automatically**, on a trigger set before the run. **No 0.4.0 on R4's terms** — R4 gated that release on a win, and tags stopped at `v0.3.0`. *Dated note, 2026-08-22: `0.4.0` shipped later for a different reason — the packages merging into one — with `0.4.1` and `0.4.2` after it. R4's bar was never met and was never what released it.* |

**The one sentence a window in this area must not get wrong.** The witness lane
is still in the tree and it is a **measured capability whose wide claim was
withdrawn** — it covered 11 of 13 rows and refused one genuinely wrong change.
It is **not** a supplier of the red-first seam and no document here may present
it as one. That seam is served by gate authoring alone
([docs/specs/SPEC_GATEGEN_V0.md](docs/specs/SPEC_GATEGEN_V0.md)), and every sentence you write must
read correctly under that. [docs/witness-programme.md](docs/witness-programme.md)
carries the phases and the pre-commitment that executed;
`tests/test_docs.py::test_the_readme_and_the_witness_programme_agree_about_the_de_scope`
keeps the two documents from disagreeing about it again.

**The surface layer is a SEPARATE LAYER and ships in this distribution.**
`wringer-board` renders `acceptance.json` and the bundles as one page per
criterion, built to [docs/specs/SPEC_BOARD_V0.md](docs/specs/SPEC_BOARD_V0.md).
The core stays headless at nineteen commands and **the surface is never a
subcommand** — a proposal for a twentieth command is refused before it is read.

*AMENDED 2026-08-30.* This paragraph said the surface "is not in this
repository" and was "not published anywhere, so no document here may link to
a page or tell anyone to install it". Both stopped being true long before
this: `src/wringer_board/` is in this tree and in the one distribution
`uv tool install wringer` fetches, and the page is live — README.md links it
twice. The rule the sentence was protecting still stands and is stated above
it: nineteen commands, and the surface is never one of them.

**What is queued** — [ROADMAP.md](ROADMAP.md) is authoritative, and the order
is a ruling rather than a preference: the gate-artifact slot, then the drive
cycle (the environment-error class first, then one verb from a prose file to a
rendered board), then the launch cycle. Until the board's definition of done is
met, surface work outranks any NEW cycle that only sharpens an existing
refusal — truth corrections, security fixes and the first-run environment gate
excepted.

**2026-08-21 — THE PM FRICTION PURGE. The first operator who is not the author
drove it, and every finding is dispositioned.** Read
[docs/field-report-2026-08-21.md](docs/field-report-2026-08-21.md) before
proposing anything on the PM surface; it outranks every proxy cold read here,
because a cold read asks a model to imagine being a stranger and this is a
stranger. The carrier is `~/Claude/WRINGER_PM_FRICTION_PLAN_2026-08-20.md`.

| what changed | why it existed |
|---|---|
| **Nothing is paid for before the agent is checked.** `wringer-drive` resolves the worker through the engine's OWN `loop.missing_agent` (never a second `shutil.which`) before the first `--send` | a PM spent two paid calls, three approvals and a gate install, then learned the coding agent was not on their machine |
| **A refused turn names authentication**, with the agent's own words and the log path — `diagnose.FACE_TURN_REFUSED`, `wringer.workerdiagnosis.v2` | `loop.py`'s `except acp.AcpError` returned early with NO diagnosis, so the loop's most common real failure was the ending nothing could describe. The word "authentication" appeared nowhere |
| **Re-running is a safe act.** A proposal matching an installed gate by id, command AND binding is already applied, not a conflict | run 2 compared a gate to ITSELF, asserted "it passes today" about a command that exits 1, said the criterion was unbound while `.wringer.yaml` carried its `proves:` — then stopped the build |
| **The interview cannot lose an answer.** Every ask says it takes one line, answers are read back before the plan, a confirm re-asks on garbage, drained overflow is shown | a pasted answer put line 1 under question 6 truncated, line 2 under question 7, and the overflow declined the run at the approval prompt |
| **Overruling a decision flags the requirements it worded** STALE, and `wring plan` refuses past them — `wringer.decisions.v2` | overruling `limit-of-three` with "make it five" left `capped-at-three` standing in the spec AND the rubric. **Wringer manufactured the inconsistency itself** |
| **`wringer-board judge`** — the person's pen, disciplined like `approve` | the one `human:` criterion required hand-writing YAML including a sha256, on the critical path of a delivery. That friction never stopped an agent; it stopped only the human |
| **One arithmetic** across badges, bodies and the summary — `cards.BLOCKED_ON_*` | nine badges said NEEDS YOU, eight bodies said "nothing is needed from you", the summary said two |
| **A blocking question naming a tracked file is refused at parse** | a required question asked a PM which criteria a 145-line pytest file asserts |
| **The keychain command carries `-U`**, and `wring doctor` reports all four executables and their directories | without `-U` a second run discards the key just typed and keeps the old one — measured, exit 45 |

**The one law that moved, and the one that did not.** `wringer-board judge`
writes `wringer.judgements.yaml`. The ENGINE still writes no judgement and
neither does `wringer-drive` —
`test_no_flag_no_env_var_and_no_command_can_write_a_judgement` is byte-untouched
and still passes. What moved is whose hand holds the pen. The three teeth were
AMENDED rather than deleted: at most that one file may appear, the file PATH
may be named only inside `judge.py`, and every write still goes through one
writer.

**Read this before trusting a guard here.** Three guards written in this window
passed for a reason unrelated to the thing they named, and all three were found
by reverting the fix and watching, never by reading: a setup-script guard that
went red because a stripped PATH broke `dirname`; a totality check satisfied by
its own string sitting in a comment; and a board invariant that compared two
counts which — after the fix — read the same field and agreed trivially.
Operating rule 7's discipline is not optional and it is not finished at "the
test passes".

**What this window did NOT do**, each with its reason: the wheel still ships no
docs or examples (**measured: 56 files, none of them `START-HERE.md`**), so
`pip install wringer` leaves a person with no way to find the guide; the
populated-board cold read is unrun, so whether a PM can tell "done" from
"nearly done" is still open; and the board's limits block is still nine dense
paragraphs.

**Wringer verifies Wringer**: [`.wringer.yaml`](.wringer.yaml) declares this
repo's own gates, CI runs `wring verify` and uploads the bundle, and a real
one is committed at [`.wringer.example/`](.wringer.example/).

| Bolt | Spec day | State |
|---|---|---|
| 1 — skeleton | Day 1 | ✅ packaging, config loader, `wring init`, `wring verify` running one gate, `evidence.jsonl` + `manifest.json`, exit codes 0/1/2 |
| 2 — gate runner | Day 2 | ✅ every gate in declared order, `timeout` enforced (process-group kill), stop-on-first-required-failure, optional-gate semantics, per-gate `gates/NNN_id/{stdout.log,stderr.log,result.json}`, `summary.md`, CI |
| 2.5 — review hardening | — | ✅ gate ids validated as slugs, internal git calls bounded, POSIX-only kill declared, ruff lint gate + macOS CI, real transcripts, SECURITY.md |
| 3 — git evidence | Day 3 | ✅ changed/untracked lists, `diff.patch`, `status.txt`, `git.status` event, timestamps on every event, `wring verify --json`, `wring explain` |
| 4 — redaction & safety | Day 4 | ✅ env redaction before write, capped logs with a declared note, binary + textconv exclusion, exit 2 outside a repo, exit 3 mid-merge/rebase, exit 4 on SIGINT with the gate killed |
| 5 — dogfood | Day 5 | ✅ `wring init` detects real commands (pyproject / package.json / Makefile) and gitignores `.wringer/`, `wring verify --output`, Wringer's own `.wringer.yaml`, CI runs `wring verify` + uploads the bundle, committed bundle in `.wringer.example/` |
| v0.2 slice 1 — the loop | — | ✅ `wring run`: `run:` config, verify→brief→worker→verify, plateau fingerprint, `wringer.loop.v1` bundle, loop schemas ([docs/specs/SPEC_RUN_V0.md](docs/specs/SPEC_RUN_V0.md)) |
| 5.5 — pre-publish hardening | — | ✅ interrupted runs named in `summary.md` and diagnosed by `explain`, `latest_run` ordered by time not name, reused `--output` cleared before writing, post-kill drain bounded, event lists scrubbed, `evidence.include` shape-checked |
| P3 — repos in, changes out | — | ✅ `wring get` · `wring issue` · `wring deliver`: the amended law 6 and its five refusals, `wringer.delivery.v1` and `wringer.acquired.v1` ([docs/specs/SPEC_GET_V0.md](docs/specs/SPEC_GET_V0.md)) |
| P4 — the guided launch | — | ✅ `wring start`: preflight, the first config WRITER in the program, agent detection that never installs, the credential ruling, the clone that stops before any gate, and a launch that refuses to call a placeholder gate a pass ([docs/specs/SPEC_START_V0.md](docs/specs/SPEC_START_V0.md)) |
| P2 — the front door | — | ✅ `wring spec` / `wring plan`: `wringer.spec.v1`, the approval interlock, questions instead of guesses, gates proposed as a diff, `human: true` criteria a judge is never asked ([docs/specs/SPEC_INTENT_V0.md](docs/specs/SPEC_INTENT_V0.md), [docs/pm-loop.md](docs/pm-loop.md)) |

The `v0.1.0` tag is gated on the spec's
[Definition of PROVEN](docs/specs/SPEC_VERIFY_V0.md#definition-of-proven--the-repo-must-show-its-own-receipts),
not on the code compiling.

## Build, test, run

Python **3.11+**. Dependencies: PyYAML at runtime, pytest for dev —
nothing else without asking.

```bash
python3 -m venv .venv                          # any Python 3.11+
.venv/bin/python -m pip install -e '.[dev]'
```

With [uv](https://docs.astral.sh/uv/) instead (what the maintainer's Mac
uses — its `.venv` is uv-made and has **no pip**, so use `uv pip`):

```bash
export PATH="$HOME/.local/bin:$PATH"
uv venv --python 3.12
uv pip install -e '.[dev]' --python .venv/bin/python
```

Then:

```bash
.venv/bin/pytest                # the gate: all tests, ~10s, must be green
.venv/bin/wring --help
.venv/bin/wring start             # the guided launch: preflight, config, first build
.venv/bin/wring init              # writes .wringer.yaml (refuses to overwrite)
.venv/bin/wring verify            # runs every gate, writes .wringer/runs/<run_id>/
.venv/bin/wring verify --gate ID  # one gate, numbered as if the full run happened
.venv/bin/wring verify --json     # one object on stdout, no human report
.venv/bin/wring explain           # diagnose the latest run (no LLM)
.venv/bin/wring spec PRD.md       # draft wringer.spec.yaml (dry run: sends nothing)
.venv/bin/wring plan              # an approved spec -> tasks.jsonl, briefs, rubric
.venv/bin/wring get URL           # clone into the declared workspace
.venv/bin/wring issue 42          # write a forge issue to a markdown file
.venv/bin/wring deliver           # dry run: patch, message, branch, MR body
```

**`wring verify` on this repo is the law** — it runs the two gates
[`.wringer.yaml`](.wringer.yaml) declares, which are exactly:

```bash
.venv/bin/ruff check src tests examples   # must be clean
.venv/bin/pytest                 # must be green
```

Run them however you like, but `wring verify` is what CI runs and what the
committed bundle proves. Gates inherit your `PATH`, so the venv has to be on
it (`export PATH="$PWD/.venv/bin:$PATH"`) or `ruff` will not be found — the
same rule as any `Makefile`.

CI mirrors exactly this:
[`.github/workflows/tests.yml`](.github/workflows/tests.yml) runs ruff
once and pytest on 3.11 / 3.12 / 3.13 plus macOS, for every push and PR.
Bolt 5 upgrades that workflow to run `wring verify` and upload the bundle —
and these two commands are the gates Wringer's own `.wringer.yaml` will
declare. Ruff config lives in `pyproject.toml` (`E,F,W,I,UP,B`,
line-length 88); there is still no `Makefile`, and any further dependency
is a decision to ask about.

Gate output is **captured, never teed**: streams go to the bundle's log
files, and only a failing required gate gets a 20-line tail on the
console. If you are tempted to add `--verbose`, read the spec's demo
block first — the clean console is the product.

## Module map (`src/wringer/`)

| Module | Does | Deliberately does not (yet) |
|---|---|---|
| `cli.py` | argparse surface, subcommands, exit codes, the console report, `--json`, `--output`, and `wring explain`'s rendering | register `--changed-only` — see below |
| `config.py` | strict `.wringer.yaml` loader → frozen `Config`/`Gate` dataclasses; validates `evidence.redact` because a typo there must not silently disable redaction | consume `evidence.include` (still shape-only) |
| `detect.py` | find the commands a repo already declares — ruff/mypy/pytest in `pyproject.toml`, npm scripts, Makefile targets — and render `.wringer.yaml`; fall back to a commented template when nothing is found | invent a command nobody wrote down (*"if detection is uncertain, generate comments rather than being clever"*) |
| `artifacts.py` | **the gate-artifact slot** (SPEC_BOARD_V0 §10, S4): make `gates/NNN_<id>/artifacts/` for a gate that OPTED IN, hand it over as `WRINGER_ARTIFACTS_DIR`, then record name / size / sha256 / media-type into the sibling `artifacts.json` (`wringer.gate-artifacts.v1`). Over-cap and unknown-type files are OMITTED AND NAMED with a reason | caption, label or interpret an artifact — it records that a file exists, never what it shows; touch `result.json`, which is frozen and closed; redact a BINARY (substring replacement changes length, so scrubbing a compressed format yields a corrupt file that still reads as evidence — each row states which kind it is); or let an artifact leave the machine, in an MR body, an attestation or anything `--send` transmits |
| `diagnose.py` | **route on facts, hint on text, claim on neither** (SPEC_ENV_V0, F6): the ONE face detector — `command_not_found`, `missing_module`, `not_executable` — with two callers (`wring start`'s console hint, the loop), and the four-leg stop predicate (pre-worker · exit 127 · PATH-resolved · no `proves:` binding), none of which reads the failure's text | CLAIM anything. Everything here feeds routing records only — the loop's reason, `diagnosis.json`, a fleet row's reason, brief and console text. It may never enter acceptance, vacuity or health, and `health.genuine_failure` keeps discounting 127 from the exit code it reads itself |
| `git.py` | root detection, HEAD SHA, branch, dirty flag, changed/untracked lists, `diff`/`status` capture, and the refusal checks (`is_repo`, `in_progress`); read-only, bounded, never fatal | write anything — every call here is a read |
| `gates.py` | run one gate through the shell in the repo root: own process group, `timeout` enforced by SIGTERM→SIGKILL on the group, output captured **through a pipe** so it can be scrubbed and capped before it is written, duration in ms | decide anything about *which* gates run — that is `cli.py`'s sequencing |
| `evidence.py` | allocate `.wringer/runs/<run_id>/`, append timestamped `evidence.jsonl`, write `manifest.json`, `gates/NNN_id/` + `result.json`, capture files, and read a finished bundle back (`latest_run`, `read_*`) — scrubbing every write, because the `Bundle` holds the redactor | decide *what* counts as a secret — that is `redact.py` |
| `redact.py` | turn env-var name patterns into the set of secret values, and erase them from text or bytes | look anywhere but the environment |
| `summary.py` | render `summary.md`: repo line, gate table with statuses and log links, the exact rerun command | anything an agent parses — machines read `evidence.jsonl` / `manifest.json` |
| `verify.py` | one verification as a **callable**: snapshot git, open a bundle, run the planned gates, stop on the first required failure — AMENDED 2026-08-27: that stop decides the OUTCOME, and a gate carrying `proves:` is no longer skipped by another gate's failure, so its red reaches the record — write manifest + summary, return an `Outcome`. Also `plan()` and the `--json` shape both commands share | print anything, or decide an exit code — that is `cli.py`'s |
| `judge.py` | `wring judge`: the closed-list `Packet`, the request, the verdict, and `send()` — **one of the two** functions in the program that opens a socket (`forge.request` is the other; it was "the only" until P3, and docs/specs/SPEC_GET_V0.md §7 restates it rather than quietly keeping the claim) | see a worker's output; there is no field in `Packet` that could carry one |
| `forge.py` | the issue tracker and MR host: **every vendor string in Wringer**, behind one mapping table, plus `request()` — the second and last socket | appear in `cli.py`; the CLI says "the forge" and never "GitHub" |
| `acquire.py` | `wring get` and the record of where a working copy came from (`wringer.acquired.v1`); the URL and scheme refusals | run anything it cloned — a fresh clone is untrusted input, and `.wringer.yaml` is code |
| `deliver.py` | `wring deliver`: **the only module that writes git history**, and the five refusals that buy that power (docs/specs/SPEC_GET_V0.md §1) | force-push, delete a branch, rewrite history, touch the default branch, or roll back a half-delivered one |
| `rubric.py` | `wringer.rubric.v1` — its own file because its bytes travel, so it gets its own size and shape limits | live under `.wringer/` (a rubric is source, not evidence) |
| `bench.py` | `wring bench`: the same job through every declared worker, each in its own bench-scoped worktree at one checked baseline, under one shared ceiling — and **no winner**, because a tautological "fix" converges fastest and reads `proven` (SPEC_BENCH_V0 ruling 6). Since SPEC_ATTEMPTS_V0 also N independent attempts per contender (`bench.attempts`) and concurrency (`bench.parallel`, serial by default), plus `agreement`, which compares a contender with itself and nothing else | rank, score, order rows, price a token, judge, delete a worktree the evidence lives in, emit a ledger event from a worker thread (the `prev_hash` chain is single-writer), or aggregate attempts into a statistic — a mean or a pass rate is a score wearing a number, and a reader with three rows can count |
| `fleet.py` | `wring fleet`: a bounded pool of child `wring run` subprocesses, the self-healing ladder, reaping by ledger growth, honest partial-success counts | do the work itself — it is only a supervisor |
| `loop.py` | v0.2's `wring run`: verify → brief → worker → verify, the plateau fingerprint, and the `wringer.loop.v2` bundle under `.wringer/loops/` — v2 because v1 froze `reason` as a closed enum and `flaky_gate` is a seventh way to stop that none of the six describes (SPEC_STABILITY_V0 §9). `loop.SCHEMA_VERSIONS` is the derived list every reader accepts | call an LLM, touch git, nest a verify bundle inside a loop bundle (runs are referenced by path), or hand a flaky gate to a worker — it stops instead, because re-verifying a nondeterministic gate until it draws green is retry-until-green one level up |
| `acp.py` | the Agent Client Protocol client: spawn the agent, JSON-RPC over stdio, one session per iteration, kill on timeout through the same process-group machinery. Wringer is the ACP *client*, never the agent (docs/specs/SPEC_ACP_V0.md) | bundle, install or recommend an agent |
| `worker_auth.py` | the free question `loop.unauthenticated_agent`, `wring run` and `wring doctor` all ask before anything is paid for: **is the coding agent logged in?** Since 0.6.0 the answer is a TYPED state for EVERY worker form — verified / rejected / unknown / not-applicable (SPEC_WORKER_V0 §3) — rendered on the run path before spend; the shell lane composes the vendor's own login probe (`agents.SHELL_VENDORS`) with the key variable's presence, under the measured precedence that a set key DISPLACES a stored login. Asked on the agent's OWN command line (`agents.Agent.auth_probe`), which is not ACP — sequence L proved the ACP handshake cannot see auth, and that finding is about ACP only. Asked in `acp.worker_env`, the same environment the real turn gets, so a key visible to Wringer but not declared across cannot read as a green | infer a "no" from a timeout, a missing binary, an unmeasured agent or a containment — all of those are `UNKNOWN` and never refuse; or claim a credential WORKS, which only the turn can say |
| `graph.py` | `wring graph`: the graph document — schema, strict validation (DAG, reachability, dataflow), the three router forms parsed by grammar, the Mermaid renderer — and the executor, which **wraps** `loop.run` and `deliver.plan`/`send` in process and adds sequencing and stopping. A graph names capabilities; there is no `command:` key and a key that looks like one is a hard error (SPEC_GRAPH_V0 ruling 1) | evaluate an expression (there is no `eval` and never will be), reimplement a loop or a delivery, gate on state rather than a bundle (ruling 2), or take `--send` from any file (ruling 5) |
| `doctor.py` | `wring doctor`: machine-checkable preconditions, one line per check, `--json`, exit 1 on anything blocking. Since 0.6.0 the credential lanes are SPLIT (run 3, F4/F10b): `drafting key` reads `judge.api_key_env` alone, and `worker credential` is derived from `run.worker` | repair anything — it diagnoses and stops |
| `spec.py` | `wring spec` / `wring plan`: `wringer.spec.v1`, the drafting request — which since 2026-08-11 asks for `gate_bindings` and not only `gates`, because the sidecar is written from that key alone and the prompt had never named it, so the whole binding channel was complete and unreachable — the strict reply parser, the file renderer, and what `wring plan` compiles out of an approved spec — `tasks.jsonl`, the briefs, `wringer.rubric.yaml`, and the proposed gate diff | open a socket (it calls `judge.send`), install a gate, touch git, run anything, or read `approved` from a reply |
| `vacuity.py` | `wring verify --prove` / `run.prove`: re-run the gates against the pre-change tree in a scratch worktree, and record the verdict — a gate that passes on both proved nothing about the change | decide what the caller does about a vacuous verdict; `attest` refuses over one |
| `accept.py` | Acceptance evidence: per criterion, whether the record evidences it. **Green is not evidence** — `evidenced` needs the bound gate to pass NOW and the record to show it can fail, because a gate born green has never told satisfied from unsatisfied (SPEC_ACCEPT_V0 §3). Opt-in is an APPROVED spec (ruling 8); only BOUND criteria refuse (ruling 9) | score a criterion, ask a model anything, classify a citation, count a bench-sourced or exit-127 row as a receipt, or write an artifact for an unapproved spec |
| `checks.py` | **the checker under trust** (2026-08-22): hash what each declared gate's check WAS — its `run` string, plus any file the command NAMES and that exists in the tree — into the bundle sibling `checks.json` (`wringer.checks.v1`), and DERIVE the note when today's identity differs from the one in the bundle a criterion's receipt cites. A command naming no file records `coverage: command-only` and says so | refuse anything. v0 is a HINT tier and changes no verdict, no state and no exit code; whether a changed check should join the delivery interlock's refusals is a named future ruling that wants this v0's field evidence first. It also may not write onto `acceptance.json`, which is frozen |
| `health.py` | `wring health`: a derived, offline read over the evidence bundles that already exist — discovery from named search roots, a coverage ledger where `discovered == read + skipped + duplicate`, and `(id, command)` history with sensitivity joined from each bundle's own `vacuity.json`. Vacuity says a gate cannot fail about one run; this says it across time (docs/specs/SPEC_HEALTH_V0.md) | write a bundle, read a clock or an environment variable, count bench-sourced runs toward a verdict (ruling 9), resolve a loop through `final_run`, or skip a bundle without naming it |
| `attest.py` | `wring attest` / `wring audit`: assemble the provenance claim from bundles that re-verify against their own digests and ledger chains, and check one offline — no config, no network, no LLM | sign anything, or let a passing audit read as a stronger claim than "unaltered since written" |
| `falsify.py` | **break it on purpose** (docs/specs/SPEC_FALSIFY_V0.md): `wring verify --falsify` mutates lines the change itself touched — one mechanical substitution at a time, from a fixed ordered table — runs the BOUND checks against each mutant in a scratch worktree, and reports which breakages nothing noticed. **v0 is MODEL-FREE**: no LLM, no network, no rival agent. Every green was red first, and red-first is a claim about ONE recorded failure; this asks whether the check would notice a different way of breaking the same code. Field result on run 2's real delivered change: 23 of 24 survived | claim anything about the WORK (a survivor is a finding about the CHECKS), refuse anything or move any outcome (ruling 3, and a guard runs the same repository with and without the flag), touch the person's tree, report an unmeasurable run as either a zero or full marks (the control run exists for exactly that), mutate prose or this repository's own declaration files, or let the number be read as a score |
| `coverage.py` | **the number, and its twin** (docs/specs/SPEC_COVERAGE_V0.md): `coverage.json` (`wringer.coverage.v1`, a NEW sibling file) and the ONE renderer four surfaces quote — the bundle summary, the merge request, the certificate and the board. Two sentences, over two DISJOINT populations, and ruling MR1 is that they are never blended: *"N of M requirements carry a check that can prove them"* and *"K of H requirements that need a person have something to show them"*. The binding half is a rendering of what `acceptance.json` already holds; the visibility half has no home anywhere, because `show:` is declared in the person's own `.wringer.yaml` and recorded by nothing — which is the whole reason a file exists. Field case: run 2 delivered with 5 of 8 unwatched, and the defect that run existed to fix landed on one of them | blend the two numbers (the remedies are different jobs done by different people), count a requirement only a person can settle as uncovered, report a missing record as a coverage of zero, refuse anything, or claim a bound check covers what the requirement MEANS — the ceiling rides on every surface that carries the number |
| `certificate.py` | **the proof that TRAVELS** (docs/specs/SPEC_CERTIFICATE_V0.md): `certificate.json` (`wringer.certificate.v1`, a NEW sibling file) and `certificate.md`, written by `wring deliver` into the delivery beside `mr.md` — every requirement BY TITLE with what the record can honestly say about it, the proved ones named with their check and where it is on record failing, and a person's verdict with their NOTE. `check` re-verifies one offline against a clone: counts against rows, requirements against the clone's spec, commit against the clone, one line per receipt through `health.gate_runs` — the same reader that wrote the receipt | assess anything (every row is copied from `acceptance.json`; a second assessor would drift), render a machine word at a reader, hold an empty key for a fact a later slice earns, report an unchecked claim as either a pass or a failure, or read who produced the branch — the check is author-blind and a test moves every name to prove it |
| `backend.py` | Where a gate's command runs (docs/specs/SPEC_EXEC_V0.md): the `Spawn` seam, `Local` (`shell=True`, recorded as `trusted_local`), `Container` (the whole argv as one pure function of config + gate + two paths, so every flag is testable on a machine with no runtime), the preflight refusal, cidfile cleanup, and `execution.json` | contain the WORKER (the published image ships no agent, so an agent worker cannot run in it — §5), claim isolation in any word a bundle carries, resolve an image digest or a runtime version (that means spawning a process to decorate a record), or generate argv for a runtime whose flags are unverified — Apple's `container` is refused by name, because a silently-ignored `--network none` would record `network: false` over a live network |
| `containment.py` | Where the WORKER runs (docs/specs/SPEC_CONTAIN_V0.md): the `run.containment` preflight (STATIC refusals — runtime on PATH, image present locally, image carries what `requires:` names, broker image carries `iptables`, no `:` in the repo path), `establish` (DYNAMIC — the runtime can actually start a container, and the allowlist arms), the worker argv as one pure function so every flag is testable with no runtime, `translate` (which rewrites `{brief}`'s host-absolute path into the mount, without which every documented worker command fails on its first line), `session_argv` (the ACP shape — `--interactive` so the stdio session survives, never `--tty` because a tty corrupts JSON-RPC framing), `inbound` (the other direction: a contained agent names container paths, translated BEFORE `_inside` resolves so confinement is unchanged), and `teardown` by cidfile | fetch an image (an implicit pull is a fetch nobody typed — it prints the command), return a falsy answer from `establish` or arm a PARTIAL allowlist (both are the silent fallback the ruling forbids), reach `execution.backend` in any way, or claim a boundary sequence I has not measured on that platform, runtime and image |
| `sign.py` | Keyless signing and the three axes `wring audit` reports (docs/specs/SPEC_SIGN_V0.md): ambient-OIDC detection, the signer table, the sign/verify command lines, and `assess` — `signature_missing` is the ORDINARY case for local work, `signature_unverified` is the fourth status that exists because "present and nobody checked" cannot honestly be called valid, invalid or missing, and `identity_trusted` requires a repo to have written down whose signature to expect | hold, store or generate a key (no `--key` in either dialect, and a test greps for it), sign anything itself — it shells to a signer the user already has, so the runtime dep list is still PyYAML alone — reach a network from `audit` unless `--verify-signature` was typed, or let `signature_missing` read as a failure |
| `concurrency.py` | Which gates ran beside which (docs/specs/SPEC_PERF_V0.md): `wringer.concurrency.v1`, written only when a group of more than one actually ran. It exists because `duration_ms` is not private to a run — health compares it across a window, so a contended wall clock has to be excluded from that comparison rather than treated as the gate slowing | decide anything, touch a verdict (concurrency changes a duration and never a pass/fail, which is why the acceptance receipt survives it), or raise on a record it cannot read — a guess here means a real duration compared against a contended one |
| `stability.py` | Flaky gates: a gate's `stability:` policy runs it N times, and `classify` turns the observations — and only the observations — into `stable_pass` / `stable_fail` / `flaky` / `unknown`. Owns `wringer.stability.v1`, the routing word `wring run` reads instead of guessing from a red tick, and the rule that every attempt keeps its own directory (docs/specs/SPEC_STABILITY_V0.md) | read a gate's OUTPUT (a classifier a gate can talk to is one the supervised party controls), decide a gate's pass/fail on its own — `verify` acts on `Observed.verdict` — or hide a retry: `attempts/` is complete or the record is a lie |
| `intoto.py` | R3's emission (`WRINGER_RULING_2026-08-14`): the in-toto `test-result` v0.1 Statement, plus **exactly one** custom predicate carrying what the standard structurally cannot — the witness provenance (authored / proved-red / pinned digest) and the vacuity verdict. Written by `wring attest` as SIBLINGS beside `attestation.json`, on the `digests.json` and `vacuity.json` pattern. The subject's digest comes from `attest.check_digests`, so the number here and the number in the attestation cannot disagree — and a bundle that has moved raises rather than being described | give `wringer.attestation.v1` a v2 dialect (Law 7, and R3 verbatim: it is frozen and gains none), write into a run bundle whose `digests.json` already committed to its contents, emit a SECOND custom predicate, sign anything, or let an in-toto envelope read as evidence that somebody stood behind it |
| `witness.py` | Wringer's own manufactured evidence (docs/specs/SPEC_GATEGEN_V0.md §6, W1–W10). **Evidence is manufactured, not found**: the corpus measured the declared gates at `gates_vacuous` 13 of 13 and `wring deliver` said yes 26 of 26, so where the repository has no discriminating check Wringer authors one. `wring spec --send --witness` authors (one call per MACHINE criterion, unconditionally — coverage is unknowable at spec time, so manufacture is unconditional and vacuity SELECTS); the next `wring run` pins bytes, command AND materialisation path, establishes the born red on a HEAD worktree, and a mismatch VOIDs the run rather than failing a gate. **W8 is the load-bearing part**: a red the runner could not COLLECT is discarded, and so is an `ImportError`/`NameError` raised inside the test body — which the exit code alone cannot tell from an assertion, and which turns green the moment any file of that name exists | author for a `human:` criterion, write more than one witness per criterion, propose anything into `.wringer.yaml` or the sidecar (a witness is Wringer's check, never the repository's), let the worker see the source, path or command (only the failure OUTPUT), read a failure MESSAGE to classify it (the exit code and the exception class are facts the runner reports; guessing whether a message looks environmental is what `vacuity.py` refuses by name), or claim it catches wrong fixes — Q1's ceiling binds every artifact |
| `staleness.py` | What a loop was BRIEFED with (`wringer.briefed.v1`): the digests of `wringer.spec.yaml`, `wringer.rubric.yaml` and `.wringer.yaml` captured before the first worker turn, written as a sibling `briefed.json` because `wringer.loop.v2`'s manifest is frozen. A mismatch stops the loop `authority_moved` at an ITERATION BOUNDARY and refuses delivery by name. It exists because `deliver.py` wrote `spec_sha256` at three sites and compared it at none, and `authorising_sha256` hashes the spec as it is NOW — so "authorised by spec S" named whatever was on disk at delivery time (WRINGER_RULING_2026-08-14 Phase 1's rider) | abort a worker in flight, revert anything, emit a ledger event (the ruling's stale-MARKING event is deferred until `loop-event-v3` can be designed once, carrying it and the witness pin together), compare `.wringer.yaml` at the boundary — `verify` re-reads it every lap, and `run.worker` lives there, so a resumed loop would stop for doing what the manual says — or refuse over a brief it could not read |
| `start.py` | `wring start`: **the only config WRITER in the program** — an existing `.wringer.yaml` is read and appended to, never replaced, and every emission round-trips through `config.parse` before it can be written. Also the prompt seam and the console width the demo canvas needs | store a credential, write a shell worker, keep state of its own in `.wringer.yaml`, or run a gate in a repo it just cloned |
| `agents.py` | the ACP agent table AND the shell-vendor roster (`SHELL_VENDORS`, 0.6.0): **every coding-agent vendor string in Wringer**, behind one mapping — id, binary, args, the variable its credential lives in, its install command, and for a measured shell vendor its login probe and login verb | run anything; it imports nothing that could start a process, so the install command it holds cannot be executed |

Every module in the spec's layout now exists.

### `wring spec` — the three rules that are not negotiable

1. **`approved: false` is written as a constant**, not derived from anything.
   No flag, environment variable or model reply may set it; a reply carrying
   an `approved` key is refused outright rather than quietly ignored, and
   `wring plan` re-reads the file from disk every time. There is deliberately
   **no `--yes`**: it is the slice.
2. **`intent` is quoted from the PRD by Wringer**, never taken from the reply.
   A model paraphrasing the human's own words inside the artifact the human is
   about to approve is the failure this slice exists to prevent.
3. **Everything proposed goes through the real parser** — criteria through
   `rubric.parse_document`, gates through `config.parse_gate` — so Wringer
   cannot propose a rubric the judge would reject or a gate `.wringer.yaml`
   would refuse. That is also what makes "the criteria block is a
   `wringer.rubric.v1` document by construction" true rather than hoped for.

And two safety rules that come from writing files a model named: every
spec-declared path is refused if it could leave the repo (as a string *and*
after resolving, which is what catches a symlink), and `wring plan` refuses to
overwrite anything it did not itself generate — briefs carry a marker,
`tasks.jsonl` is checked with `fleet.load_tasks`.

### Do not add these early

v0.1's [Non-goals](docs/specs/SPEC_VERIFY_V0.md#non-goals-for-v010-binding) still bind
everything under `wring verify`. `wring run` now exists, but only the slice
[docs/specs/SPEC_RUN_V0.md](docs/specs/SPEC_RUN_V0.md) defines: still **no issue ingestion, no PR
creation, no commits or pushes, no Temporal, no OpenTelemetry, no multi-agent
anything**, and no anti-thrash beyond the plateau fingerprint.

**Five commands SEND and three FETCH, and only those eight.** SEND:
`wring judge --send`, `wring spec --send`, `wring deliver --send`,
`wring graph run --send` (or `wring graph resume --send`), which reaches a
network only by calling the same `deliver.send` — a `git push` in a
subprocess, through delivery's six refusals, with no socket and no merge
request of its own (SPEC_GRAPH_V0 §5.5: the flag is typed on the invocation,
authorises the deliver node that invocation reaches once, and no file may
carry it) — and **`wring attest --sign`**, the fifth, added by SPEC_SIGN_V0:
it shells to a keyless signer which reaches Sigstore, so like the graph's push
it opens no socket of Wringer's own, holds no key, and only ever runs in CI
where an OIDC identity is ambient. Each requires a section the repo wrote
down — `judge:`, `forge:`, `deliver:` or `provenance:` — each writes
the exact bytes to disk before any socket opens, and each is dry-run or
explicit by default. FETCH, not behind a flag because fetching is the entire
purpose: `wring get` clones a repository, `wring issue` reads one issue, and
**`wring start --clone`** clones one — the third fetcher, added in P4, and the
only one of the six that a new user meets first. It opens a socket under
exactly one condition: the user asked it to clone. It then **stops**, because
a fresh clone is untrusted input and running its gates in the same invocation
would be the most dangerous command in the program aimed at the least
technical user it has (docs/specs/SPEC_START_V0.md §3e).

**Every socket lives in `judge.send` or `forge.request`** — derived and enforced by `tests/test_network_surface.py`, never by a grep count, which is unstable under documenting the string it greps for, and there are
exactly two such calls in the program — a clone is `git` in a subprocess, not
a socket this program opens. Enforced since 2026-08-15 by
`tests/test_network_surface.py`, which parses every module, resolves each call
through that module's own imports, and asserts both the owning functions and
the count. **Until then the claim was in four documents and three docstrings
and in no test**, and the form it was published in — a grep for the function
name, promising exactly two answers — was false: the command counted its own
documentation and returned five. Qualifying the name does not repair it, since
the correction becomes a hit as well. **A grep count over a string is unstable
under documenting the string**, so no document here promises one. Everything
that *proves* anything still makes no LLM call and no network call: the worker
is the user's own program, and every worker in the test suite is a shell
one-liner or the repo's own fake ACP agent.

**Wringer never stores a credential.** `wring start` will ask for your API key
so it can hand it to the build it launches; it keeps it in memory for that
session, folds it into the redactor so it cannot reach a bundle, and writes it
nowhere. Your config records the *name* of an environment variable, never a
key. Nothing else in Wringer ever asks.

**Wringer writes git history in exactly one place.** `deliver.py`, only on
`--send`, only onto a branch it created, never the default branch, never a
force push, with a ledger event appended before each write. That is handover
law 6 as Marc amended it on 2026-08-01; docs/specs/SPEC_GET_V0.md §1 is the contract and
every one of its five conditions has a test that fails without it. Since P7
there are **two ways to reach that one place** — `wring deliver --send` and a
graph's `deliver` node under `wring graph run --send` — and the module, the
refusals and the typed flag are the same ones in both. `wring
run`, `wring verify`, `wring spec` and `wring plan` still touch git not at
all, and the fleet's `worktree add/remove` is still metadata.

`wring spec` and `wring plan` add their own non-goals, binding
([docs/specs/SPEC_INTENT_V0.md](docs/specs/SPEC_INTENT_V0.md) §5): no multi-turn refinement (edit
the file), no auto-applying gate changes, **no auto-approval in any form**, no
effort or cost estimation, no design output, no issue-tracker ingestion, and
neither command runs a gate or touches git.

Also: a flag that half-works is worse than a missing flag, because agents
consume this CLI. `--changed-only` stays **unregistered**.
`--changed-only` is deliberately deferred: the spec names it but never
defines it, and the plausible readings (skip a clean tree · scope gates to
changed files · limit what is captured) are different products. Pin the
semantics in the spec before building it.

## Contracts you must not break

**Exit codes** (the spec's table — all five are live now):

| code | meaning |
|---|---|
| 0 | all required gates passed |
| 1 | a required gate failed |
| 2 | config or environment error |
| 3 | unsafe dirty state / refused precondition |
| 4 | interrupted |
| 5 | `wring judge` only: needs a human — nothing competent scored the evidence |

**The evidence bundle is the product** — boring, stable, grep-friendly,
and the interface future judges and agents consume ([RFC #2](https://github.com/marcoakes/wringer/issues/2)).
`manifest.json` carries `"schema_version": "wringer.evidence.v1"`;
`evidence.jsonl` is append-only, one JSON object per line, `type` first.
Changing either shape is a spec change, not an implementation detail —
bump the schema version and say so in the commit.

That shape is now **published as JSON Schema** in [`schema/`](schema/), and
[tests/test_schema.py](tests/test_schema.py) fails if the code writes a key
the schema does not declare. Adding a field therefore means editing the
schema in the same commit — which is the point: the version string is what a
new field costs.

Three conventions inside the bundle are load-bearing:

- **`evidence.jsonl` grows no event type.** Its `type` is a closed enum and
  every branch sets `additionalProperties: false`, so a new fact arrives as
  its own SIBLING FILE — `digests.json`, `untracked.json`, `vacuity.json`,
  `stability.json`, `concurrency.json`, `execution.json` — and a reader that
  does not know the file ignores it. Four of those schemas say so in their own
  descriptions. It was broken once anyway: `--prove` appended a
  `vacuity.finished` line for the whole life of the feature, after
  `run.finished`, described by nothing, seen by no test because the drift
  tests never proved and the vacuity tests never read the ledger (removed
  2026-08-15, SPEC_VACUITY §2).
- **`gates/NNN_<id>/` numbering follows the *declared* order, not the run.**
  `wring verify --gate test` on a three-gate config still writes
  `gates/003_test/`, so a directory name means the same thing in a full
  run, a partial run and a single-gate run.
- **Every event carries `ts`** (local ISO-8601, milliseconds). The spec's
  example was amended in Bolt 3 to match; keep them in step.
- **`git.status` carries `untracked` only when there is something
  untracked**, so the common case stays exactly the spec's shape.
- **The git capture happens before the bundle directory exists**, or
  Wringer's own `.wringer/` would show up as an untracked file in its own
  evidence. Order matters in `cmd_verify`; do not reshuffle it.
- **A `log` field appears on `gate.finished` for failing gates only** —
  it is a pointer to where the reader is being sent, not an inventory
  (every gate's logs are on disk and linked from `summary.md`).
- **Skipped gates leave no trace in `evidence.jsonl` and no directory.**
  They were not run, so claiming otherwise would be a lie; `summary.md`
  is the one place the full declared set appears, marked `skipped` — or
  `interrupted` for the one gate a Ctrl-C caught mid-flight, which is
  neither passed nor skipped and still gets no invented `gate.finished`.
- **One directory describes one run.** `--output` reuses the directory it
  is given, so `Bundle.at` first clears the previous bundle (`evidence.jsonl`,
  `manifest.json`, `summary.md`, `diff.patch`, `status.txt`, `gates/`) and
  nothing else — the directory is the caller's. Leaving a stale
  `gates/NNN_id/result.json` behind is how a bundle comes to say a gate
  passed on the same screen its summary calls it skipped.
- **`latest_run` orders by time, never by name.** A `--output` directory can
  be called anything, and as text `manual-001` outranks every real run id
  forever. Ids are dated from their timestamp prefix, other names from their
  mtime.

**Gate ids are slugs** (`[A-Za-z0-9][A-Za-z0-9_-]*`, ≤64 chars) because
they become directory names: `gates/NNN_<id>/`. A config saying
`id: ../../x` is a parse error, not a path traversal. Widening that
pattern means re-checking every place an id reaches the filesystem.

**v0.1 supports macOS and Linux.** Timeout enforcement needs process
groups (`os.killpg`), which is POSIX-only; `gates.py` degrades to killing
just the shell elsewhere and pyproject's classifiers say so. Windows is a
v0.2 conversation, not a silent failure.

**Redaction happens before the write, never after.** The `Bundle` owns a
`Redactor` so every write path scrubs by construction; gate output travels
through a pipe for the same reason. If you add a file to the bundle, add it
through the `Bundle`, or you have quietly opted out of the one guarantee
SECURITY.md makes. Scrub first, *then* truncate — truncation must never be
what saves a secret.

**Config semantics:** validation is strict — unknown keys are errors,
because a typo in a gate definition must not silently change what
"verified" means. `optional` is the canonical field; `required` is
accepted as its negation (the spec spells it both ways); both together
is an error.

**Bundle location:** `.wringer/` is gitignored — real runs stay local
(nothing uploads, ever). The one committed bundle lives in
`.wringer.example/runs/…` and is sanitized by hand.

## Operating rules

1. **AI-DLC discipline.** One bolt at a time: short plan → maintainer's
   approval → execute → verify → commit → report → pause. Do not start
   the next bolt on your own initiative.
2. **Never claim a bolt done unless its checks actually ran.** Paste the
   real command output — `pytest` summary and a `wring` transcript — into
   the report. Fabricated or "should work" output is the one unforgivable
   sin in a repo whose entire product is evidence.
3. **Tests come with the commit that needs them**, not later. The existing
   suite is the shape to match: contract assertions (event sequence,
   manifest and `result.json` fields, exit codes, `summary.md` rows),
   scratch-repo fixtures in [tests/conftest.py](tests/conftest.py), and no
   mocking of git or subprocess — a timeout test really spawns `sleep 30`
   and really kills it.
4. **Small conventional commits** — `feat:`, `fix:`, `test:`, `docs:`,
   `chore:`. Evidence in the PR description.
5. **Vendor strings behind mapping layers.** Any external API surface,
   protocol attribute, or vendor identifier goes behind the designated
   mapping module. Pin versions.
6. **Update this file** whenever build/test/run behavior, the module map,
   or the bolt state changes. It is the first thing the next agent reads.
7. **HUNT BUGS WITH SCRIPTS, NOT WITH FLEETS** (ruled 2026-08-19, from
   measurement). Two adversarial review fleets ran that day. The second
   checked 26 findings and reproduced 26 — but the thing that produced those
   findings was not the parallelism. **Every defect found that day, more than
   thirty of them, came from EXECUTING something. Not one came from reading.**
   A fleet is parallel execution with a 3.4M-token bill and no artifact left
   behind.

   So the practice is: **write a probe script, run it, and keep it.**

   - Put probes in `scratch/` or a scratchpad, drive the REAL functions and
     the REAL CLIs, and round-trip anything written through the loader that
     will actually read it. `spec.render()` wrote files `spec.load()` refused
     for months; nothing but a round-trip could have found it.
   - **A probe that finds something becomes a test in the same commit.** That
     is the whole advantage over a fleet: the finding arrives with its
     reproduction already written.
   - Feed a probe the values a person really types, not the ones a fixture
     contains. `no`, `yes`, `on`, `123`, `False`, a colon, a `#`, a blank line
     inside a multi-line answer, CRLF. Four separate defects that day were
     YAML resolving a bare scalar as a non-string, and every one of them was
     invisible to a fixture written on the same side of the seam as its
     reader.
   - **Revert each fix INDIVIDUALLY and watch its own guard go red.** Four
     guards written that day passed with their fix reverted — all four
     asserting a property of a whole file when the claim was about one line
     in it. Mutation proves a guard CAN fail; it says nothing about whether it
     fails for the reason you think.

   A fleet is still the right instrument for something a script cannot do —
   reading a page as a stranger, or judging whether prose claims too much. It
   is the wrong instrument for finding bugs in code you can simply run.

## Repo-specific gotchas

- **The maintainer's Mac may have no git push credential** (no `gh`, no
  SSH keys, no Homebrew). Try `git push`; if it fails, commits queue
  locally and the maintainer pushes, or publishing happens through the
  browser against his logged-in GitHub session — his call, per bolt.
  Never work around it, never handle a token — surface the block and ask.
- **`.wringer.yaml` is arbitrary code execution by design** — gates run
  through a shell with the user's privileges. Never add a feature that
  widens that (no fetching a config over the network, no running a gate
  from an untrusted source) without a spec change and a SECURITY.md
  update. Bundles are redacted before write, but redaction only knows about
  values in the environment — a secret a gate reads from a file and prints
  is still yours to catch, so read a bundle before pasting it anywhere.
- **A red CI build here CAN be read, without auth.** The logs are login-walled
  (403 on the API, a login wall on the web), which is why `tests.yml` pipes
  pytest's failures into a `::error::` annotation — and annotations are public:

  ```bash
  curl -s "https://api.github.com/repos/marcoakes/wringer/commits/<sha>/check-runs"
  # then, per failing run id:
  curl -s "https://api.github.com/repos/marcoakes/wringer/check-runs/<id>/annotations"
  ```

  Read that BEFORE forming a hypothesis. On 2026-08-07 a day went into guessing
  at five red builds, and two production changes were made on hypotheses that
  turned out to be wrong, while the actual failing assertions were sitting in
  that endpoint the whole time. Run status is readable the same way
  (`/actions/runs?per_page=5`), but it is **60 requests/hour per IP** — poll
  once, never in a loop.

- **`scripts/ci-repro.sh` passing is NOT CI passing.** It was green through
  five red builds and got quoted three times as evidence. It reproduces a
  fresh clone and a missing git identity; it now also pins `TMPDIR=/tmp` and
  `init.defaultBranch=master`, because both were deciding the outcome:
  a bare repo made without `-b main` breaks `git remote set-head -a` wherever
  git defaults to `master`, and every stderr message is wrapped to the
  terminal, so a shorter tmp path moves where a line breaks and a multi-word
  assertion fails. **Assert on flattened output** — `conftest.flat` — never on
  where the formatter chose to break a line.

- **Revert the fix and watch the test go red.** It costs a minute and it has
  now caught three tests in one week that passed against broken code: a
  descriptor count that moved with GC timing, a leak test that passed because
  the command REFUSED and wrote nothing, and one asserting a phrase the
  wrapper had started breaking. A test written after the fix proves nothing
  until it has failed once.

- **Don't run `wring verify` on this repo casually while iterating** — each
  run writes a new `.wringer/runs/<id>/`. Harmless (gitignored), just noisy.
- **Test repos must be isolated from the developer's git config.**
  `tests/conftest.py` pins `user.name`, `user.email` and
  `commit.gpgsign=false` for exactly this reason.
- Unicode `✓`/`✗` in console output is intentional (it is the spec's demo
  shape). Keep the report format aligned with the spec, and update the
  spec first if it must change.

## Conventions

- Python 3.11+, `src/` layout, `from __future__ import annotations`,
  frozen dataclasses for value types, argparse for the CLI, no third-party
  deps beyond PyYAML.
- Comments explain *why*, especially where a spec ruling is non-obvious;
  they do not narrate *what*.
- Apache-2.0; DCO sign-off not required at this stage.
- Docs in Markdown; diagrams as Mermaid or fenced ASCII (both render on
  GitHub).
- The TypeScript monorepo (Node 22, pnpm workspaces, package-boundary
  lint matrix) remains the plan's shape for the **later graph engine** —
  revisit at v0.2. It does not apply to v0.1's Python code.
