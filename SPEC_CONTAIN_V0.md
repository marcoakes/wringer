# SPEC_CONTAIN_V0 — where the WORKER runs

**Binding** for the `run.containment:` section, the capability broker, the
`wringer.execution.v2` record, and what any artifact may claim about worker
isolation.

*Drafted 2026-08-15 by an Opus implementation window under
`~/Claude/WRINGER_PHASE2_RUN_PROMPT_2026-08-15.md`. Inputs, each of which this
spec restates and may not weaken: `WRINGER_RULING_2026-08-14.md` **§Phase 2**
(the stop) and **§5** (the re-test preconditions this phase is a precondition
of); the Fable rulings of 2026-08-15, second block, carried in that prompt's
**§R (R-1 … R-7)**; `SPEC_GATEGEN_V0.md` **§6 W9**, which this spec resolves;
`SPEC_EXEC_V0.md` **§5, §6 and §7**, which own the gate-side boundary this one
deliberately does not touch; and `docs/corpus-2026-08-13.md` **§4**, which is
the contamination channel this phase builds the closure for.
`WRINGER_FACTORY.md` governs the order of work and outranks this file.*

*Every "exists today" claim below was read out of the tree at **`106fb61`** and
carries its `file:line`. Nothing here is recalled. Every mechanism claim was
**executed on this machine** before it was written down, and §8 records the
transcript.*

**INDEPENDENTLY REVIEWED before any code, 2026-08-15**, by one agent that
neither drafted this spec nor built to it (the no-fleets rule). **Verdict on
the first draft: NOT SOUND — 27 findings, 9 HIGH. ALL 27 ARE FOLDED; none is
rebutted.** §9 lists each with its resolution.

**The four findings that make this document worth more than its first draft,
named here rather than buried, because each is this repository's own recurring
defect committed by the document written to close it:**

1. **The first draft's containment record would have carried a sentence
   denying its own claim.** `backend.LIMITS` (`backend.py:393-409`) is one
   module-level tuple stamped into every `execution.json`, and its fourth row
   reads *"run.worker is not contained … worker_execution says so separately,
   and it always says trusted_local."* A v2 record would have shipped that
   sentence **inside the artifact certifying containment** — a green artifact
   carrying somebody else's caveat, in the one field this repository invented
   so that a record could state what it does not claim. Ruling 4 now splits
   `LIMITS_V1` from `LIMITS_V2` and §6 S3 names the guard edit.
2. **The R-1 pin — the single test W9 exists to force — was written against a
   vocabulary this program does not have.** The first draft asserted the
   verdict is `proven` or `not_proven`; `vacuity.py:67-70` publishes
   `proven | gates_vacuous | not_applicable | inconclusive` and there is no
   `not_proven`. The assertion is now `verdict != INCONCLUSIVE`, against
   imported constants.
3. **The first draft assumed one worker spawn path and there are two.** A
   shell worker goes through `gates.run` (`loop.py:920`); an **ACP worker is
   spawned by `acp.py:372`'s own `subprocess.Popen`**, which touches no
   backend. A guard asserting "the only call site" would have passed while the
   second ran uncontained under a config claiming containment — R-3's named
   defect class. Refusal 10 now refuses that combination by name.
4. **Every documented worker command would have failed on its first line.**
   `{brief}` substitutes an absolute **host** path (`loop.py:235-238`), and the
   documented form is `worker: claude -p "$(cat {brief})"`. Inside a container
   with the repo at `/workspace` that path is absent. §4's path-translation
   rule and its test are the fix.

---

## Positioning — and the side this work is on

`WRINGER_FACTORY.md` §5 asks one question of every slice: *does this move a
PM's spec closer to working software, or does it make an existing refusal
sharper?* **This is the second kind, and it is said out loud here as well as in
the finish report.** Containment builds nothing a PM can see. It exists because
the 2026-08-13 corpus run lost to a leak that the audit — not the opponent —
found, and because §5 of the witness ruling makes an uncontained worker a
discountable re-test. **This slice buys the right to spend money on Phase 3.**
Nothing more, and the spec says so rather than letting a security-shaped
document imply a product.

**What it closes, stated precisely** (review finding 22). `docs/corpus-2026-08-13.md`
§3's channel — upstream's fix reachable in `.git` — was closed by history
truncation, `forbidden_shas` and FETCH_HEAD deletion, and **not** by
containment. The residual channel is §4's: *the agent has a shell and a
network*, and three arm-B rows used it to fetch a `.patch`, a PR diff and a
post-fix source file. This phase **builds** the mechanism that closes that one.
It does not apply it: `benchmark/` is untouched (§5 non-goal 5), and wiring
containment into the harness is Phase 3's.

The one-sentence test: **could a run come out of this claiming containment it
did not have?** If yes, the design is wrong. Every ruling below is answerable
to that sentence, and rulings 3 and 4a are the whole of it.

---

## §1 — The Fable mapping: each ruling, where it lands, and how a reviewer catches a violation

A row whose "how to check" says only "see §N" is a failed row. Every check
below names an artifact, a test, or a recorded state that would visibly differ
if the ruling were broken. **Where a check is weaker than it looks, the row
says so** — a row that oversells its own guard is the drift this table exists
to stop. **A guard this spec must WRITE is marked `[new]`; a guard that exists
today is marked `[shipped]`, and the distinction is load-bearing** — the first
draft blurred it three times and the review caught each.

| ruling | what it says | implemented in | how a reviewer catches a violation |
|---|---|---|---|
| **R-1** | containment is WORKER-side; `execution.backend` is never its carrier; the prove pass and the witness lane are untouched **by construction** | §2 ruling 1; §3; the pin test in §6 S4 | Three checks: (a) `_EXECUTION_KEYS` (`config.py:47`) is unchanged — `test_the_execution_section_gained_no_key` `[new]` asserts the set **by value**; (b) `vacuity.py:162`'s condition is byte-unchanged and still reads `cfg.execution`, never `cfg.run`; (c) **the pin**, which is the row's real check: `test_a_contained_worker_still_gets_a_real_vacuity_verdict` `[new]` runs the canary scenario with `run.containment` and `run.prove: true` and asserts `result.verdict != vacuity.INCONCLUSIVE` **and** that it is one of the four published constants, imported from `vacuity` rather than spelled by hand. *(The first draft asserted `proven` or `not_proven`; there is no `not_proven`, and `gates_vacuous` is the verdict this whole programme is built on — review finding 1.)* A violation is any route by which declaring containment changes a vacuity verdict. |
| **R-2** | a broker, not a framework: an env allowlist by NAME, and an egress policy reaching the model API and nothing else, including the corpus mirror path | §4 in full; §5 non-goals | **Structural, because a prose non-goal cannot catch a framework**: `test_the_broker_grew_no_framework` `[new]` asserts the containment module exports no symbol matching `effect`, `inverse`, `plugin`, `lifecycle`, `provides`, `requires`, `hook` or `capability_registry`, and that `_CONTAINMENT_KEYS`/`_EGRESS_KEYS` hold exactly the keys §3 lists. Positive half: `test_the_worker_environment_is_an_allowlist_of_names_and_never_values` `[new]` — a **distinct** test from the shipped gate-side `test_the_environment_is_an_allowlist_of_names_and_never_values` (`tests/test_backend.py:128`), which asserts the property for the *gate* argv and would stay green with `--env NAME=VALUE` in the worker's (review finding 11). **Stated weakness:** "and nothing else" is a claim about the *egress policy*, only as true as the canary that measured it on that platform+runtime+image (R-5), and §7.9 bounds it further — an address allowlist admits everything co-tenanted at those addresses. |
| **R-3** | a containment declaration that cannot be honoured REFUSES at start, with a named reason — never a silent fallback to `trusted_local` | §2 ruling 3; §3's eleven refusals, split static/dynamic | **The load-bearing row.** Eleven refusals, each with a test that fails without it, each naming its reason. The structural check that catches the class: `test_no_route_reaches_a_worker_turn_with_containment_declared_and_unestablished` `[new]` enumerates worker-spawning call sites **from the AST** rather than assuming one — the first draft assumed one and there are two (`loop.py:920` and `acp.py:372`, review finding 5) — and asserts each is either behind a returned `establish()` or behind refusal 10. `establish` has no return path yielding a falsy value without raising. **Watched to fail:** §6 S2's E-list gives, per refusal, the one-line edit that removes it and the test that then reddens. A refusal nobody has watched fail is a refusal nobody has checked. |
| **R-4** | a contained run's bundle records a contained `worker_execution` through a **new schema version or sibling file**; `trusted_local` is never relabelled; the absence of the new record is the compatibility boundary | §2 rulings 4 and 4a; `schema/execution-v2.schema.json` | `wringer.execution.v1` and its schema file are byte-unchanged. `test_a_run_that_declares_no_containment_writes_v1_byte_identical` `[new]` diffs a no-containment record against the pre-change bytes — which is why `LIMITS` **must** split (ruling 4). `test_the_worker_execution_subtree_never_says_trusted_local` `[new]` asserts on `record["worker_execution"]`, **not on the file**: `execution_mode: "trusted_local"` is legitimately present in a v2 record whenever the gates ran locally, which is ruling 7's whole point and which made the first draft's file-wide substring test impossible to pass (review finding 3). A violation is `mode: "trusted_local"` in a v2 subtree, or a v2 record on a run that declared nothing. |
| **R-4a** | declared ≠ established; a record may never claim a containment that was not stood up | §2 ruling 4a; §3's split record | `test_a_lap_that_started_no_holder_writes_no_established_block` `[new]`, driven through the four real callers of `verify.run` — `cli.py:1052` (`wring start`), `cli.py:1637` (`wring verify`), `loop.py:709` (the loop's final verify) and `bench.py:637` (`_verify_baseline`). All four reach one `backend_module.write(…, worker=cfg.run is not None)` at `verify.py:354-359`, and none of them starts a holder. **Absence of `established` is the honest reading**, and the test asserts absence rather than a placeholder. *(The first draft had a single flat object and no answer for these laps — review finding 14 and adjudication 1.)* |
| **R-5** | claims follow canaries, **per platform**; SECURITY.md rows change only with same-commit probes; the `--privileged` control is what upgrades wording toward "measured" | §7 in full; §8's table; `docs/MANUAL_CHECKS.md` Sequence I | (a) `tests/test_security_capabilities.py` `[shipped]` fails any new SECURITY.md row with no probe — **but its `TABLE_HEADING` is `## Who may do what — the authority model` (`test_security_capabilities.py:60`), so it parses the AUTHORITY table only.** "Designed to isolate" lives at `SECURITY.md:168-169`, outside it, and that guard **cannot fire on the one wording R-5 exists to control** (review finding 13). Stated, not glossed. (b) The wording is covered **solely** by `test_no_document_claims_worker_isolation_beyond_the_canaries` `[new]`, which matches *assertions* rather than mentions — a sentence saying "deliberately not `sandboxed`" is a mention and must not redden it (review finding 27), and this spec's own ruling 4 sentence is the fixture that pins the distinction. (c) Classifying an attack `prevented`/`mitigated`/`out_of_scope` is a human's judgement and no test replaces it — Sequence G's standing rule, inherited. |
| **R-6** | the mechanism is party-shaped, not worker-hardcoded; **build only the worker path now** | §2 ruling 6; `establish(party=…)` | `test_the_broker_takes_a_party_and_hardcodes_none` `[new]` asserts `establish()` carries a `party` argument, that no literal `"worker"` appears outside the one call site and the one default, and — the half that stops scope creep — that `witness` and `author` appear **nowhere** in the containment module or its config keys. A violation in either direction is visible. |
| **R-7** | two riders, exactly, and nothing else rides | §6's rider slice; the finish report | The riders land in commits separate from the containment work, and neither touches `containment.py`, `config.py` or `backend.py`. A violation is a third rider, or a rider commit carrying containment code. |
| **W9** | worker containment must not be expressed through `execution.backend`, or the prove pass's worktree handling is fixed first | resolved by ruling 1; the R-1 pin | W9 offered two routes; this spec takes the first. The second — fixing `vacuity.prove` under containers — is **banked, named in §5 non-goal 6, not built here.** A violation is worktree-handling changes in `vacuity.py` in this cycle's diff. |
| **stop (a)** | a run whose bundle records a contained `worker_execution` value | §3's record; §6 S3 | `docs/containment-2026-08-15.md` contains the literal bytes of one such `execution.json`, **including its `established` block**. Absent that file, the stop is NOT HIT and the finish report says so. |
| **stop (b)** | canaries: a planted host credential invisible to scripted probes run as the worker; a fetch to the corpus mirror path fails while the model API remains reachable | §4's canary battery; §8 | `scripts/sequence-i.sh` runs the battery and **refuses rather than skips** with no runtime (`scripts/sequence-g.sh:40-52`) **and refuses when a probe's own tool is absent from the declared image** — Sequence G's third and largest lesson, which the first draft omitted (review finding 9, `docs/MANUAL_CHECKS.md:515-527`). A softened canary is a violation; so is a battery with only passes and no control (§4's control arms). |
| **stop (c)** | Demo C is filmable | §6 S5 | Demo C is recorded as a new `STEP_SETS` group in `scripts/demo_record.py`, **as every other demo in this repository is** — so `test_every_recorded_step_displays_exactly_what_it_executes` (`test_docs.py:613-660`) `[shipped]` covers it, which it would **not** have done for a standalone shell script, because that guard iterates `STEP_SETS` and not the casts (review finding 12). The canvas-width guard globs `docs/*.cast.json` and covers a new cast for free. |

---

## §2 — The rulings

### Ruling 1 — Containment is declared under `run:`, never under `execution:`

`execution:` answers **where GATES run**. It is the repository's statement
about the commands it declared in `gates:`, and `SPEC_EXEC_V0` §5 says at full
volume that it contains gates and not the worker. Worker containment is a
different question about a different command, so it gets a different key:

```yaml
run:
  worker: my-agent --brief {brief}
  containment:
    runtime: podman
    image: ghcr.io/example/agent:tag
    ...
```

**This is R-1, and it is not a naming preference.** `vacuity.prove` returns
`INCONCLUSIVE` unconditionally when `cfg.execution.backend == "container"`
(`vacuity.py:161-187`), because a detached worktree's `.git` is a file and
mounting it alone is a broken repository. Phase 3's re-test needs
`run.prove: true` on every row. Had containment landed on `execution.backend`,
**every witness in the committed pass would have been `inconclusive` and R2's
$38 would have measured nothing.** Because the key lives elsewhere,
`vacuity.py:162` never sees it and the prove pass is untouched *by
construction* — not by care, which is the property worth having.

The alternative W9 offered — fix the prove pass's worktree handling under
containers — is a real fix and is **banked** (§5 non-goal 6).

### Ruling 2 — A broker, not a framework

Exactly two capabilities and no vocabulary for a third:

1. **An environment allowlist by NAME.** `env: [ANTHROPIC_API_KEY]`. Wringer
   reads the value from its own environment at spawn time and hands it to the
   runtime as `--env NAME`, never `--env NAME=VALUE` — an argv is readable by
   anyone who can run `ps`, and the two forms differ by exactly that
   (`SPEC_EXEC_V0` §4). **Wringer stores no credential**, the standing rule in
   SECURITY.md's *"What Wringer never does"*, unchanged here.
2. **An egress policy.** §4.

No effect/inverse framework, no plugin machinery, no lifecycle vocabulary, no
`requires:`/`provides:` coeffect surface. Cordis §12.4 is adopted as the
2026-08-14 ruling adopted it: *the minimal mechanism Phase 2 needs, and nothing
beside it.*

### Ruling 3 — Declaring is not establishing; an unhonourable declaration REFUSES; and the refusals split STATIC from DYNAMIC

**This is the ruling the spec turns on.** A containment declaration that cannot
be honoured **exits 2 before any gate runs and before any bundle is opened**,
with a reason naming what was missing. It never degrades to `trusted_local`,
never warns and continues, and never writes a bundle. Same shape and same place
as `SPEC_EXEC_V0` ruling 6: `verify.run` calls `engine.preflight()` and raises
`BackendError` before `evidence.Bundle` exists (`verify.py:184-187`).

**The split, and it is a correction the review forced (adjudication 2).** The
first draft said `wring verify` refuses if containment "cannot be established",
which it cannot check without *establishing* it — and establishing an allowlist
means starting a holder and issuing DNS, on a command SECURITY.md promises
makes no outbound connection. So:

- **STATIC refusals (1, 3, 4, 5, 6, 8, 9, 10, 11)** are checked by every
  command that reads the config, `wring verify` included. They cost no process
  and no packet: a `which`, an `image exists`, an `image inspect`, and parse.
- **DYNAMIC refusals (2, 7)** are checked only where a worker is about to run —
  `wring run`, at `establish()`. They are the ones that need the holder.

`wring verify` therefore refuses a *statically* broken declaration in CI, which
is most of them, and never starts a container. **The sentence "REFUSES if
containment cannot be established" is now split into the two things it meant,
because as one sentence it promised a check it could not perform.**

**Why the refusal is load-bearing rather than defensive.** A policy statement
is only worth reading if a repository that cannot honour its policy produces no
bundle at all. **The refusal converts a config line into evidence.** Remove it
and every claim in §3 becomes a claim about a YAML file — precisely the defect
class this programme exists to catch.

### Ruling 4 — `wringer.execution.v1` is frozen; containment arrives as `v2`; and `LIMITS` splits with it

Law 7, and the house precedent for a version bump is a **second schema file**:
`untracked.schema.json` beside `untracked-v2.schema.json`,
`loop-event.schema.json` beside `loop-event-v2.schema.json`,
`bench-event.schema.json` beside `bench-event-v2.schema.json`.

- No `run.containment` → `wringer.execution.v1`, **byte-identical to today**.
  Zero compatibility cost for every repository in the world.
- `run.containment` declared → `wringer.execution.v2`, same `execution.json`,
  `worker_execution` an object rather than a string.

**`LIMITS` splits into `LIMITS_V1` and `LIMITS_V2`, and this is not tidiness.**
`backend.LIMITS` is one module-level tuple written into every record
(`backend.py:381`), and its fourth row states *"run.worker is not contained …
worker_execution says so separately, and it always says trusted_local."*
Leaving it makes the containment record deny its own claim; editing it breaks
v1's byte-identity and the guard that pins it. `LIMITS_V1` keeps the shipped
bytes and keeps `test_the_limits_never_inflate_the_container_claim`
(`tests/test_backend.py:537`, which asserts `"not contained" in joined`) green
unchanged; `LIMITS_V2` states the containment record's own limits, which are
§7's ceiling word for word. **The guard gains a v2 arm in the same commit.**

**`trusted_local` is never relabelled.** The word keeps its exact shipped
meaning in v1 rows and in v2's `execution_mode`, and `backend.TRUSTED_LOCAL`
(`backend.py:63`) is untouched. **The absence of a v2 record is the
compatibility boundary**: a reader that knows only v1 and meets a v2 record
must treat it as a version it does not know and decline to read it — the honest
failure, because the alternative is reading a `trusted_local` that is false.

**The word for the new mode is `contained`, and the constant is
`WORKER_CONTAINED` — deliberately not `CONTAINED`.** `backend.CONTAINED`
already exists and holds the string `"container"` (`backend.py:67`), which is
the **gate** vocabulary. One letter apart with different meanings is a trap for
a grep and for a bundle reader (review finding 15), so the two constants are
named apart and this paragraph is why. Neither word is `sandboxed`, `isolated`
or `secure` — the rule `backend.py:61-67` sets. The shipped guard is
`test_local_records_trusted_local_and_never_says_sandboxed`
(`tests/test_backend.py:58`) `[shipped]`, which iterates
`properties.execution_mode.enum` of the v1 schema **only**; it is extended to
iterate every mode-bearing enum in every published execution schema, because
otherwise the new field is entirely unguarded for the rule (review finding 4).

### Ruling 4a — `declared` and `established` are separate blocks, and absence is the honest reading

`worker_execution` in v2 is:

- **`declared`** — always present. Repository policy: the mode, the runtime,
  the image, the env allowlist, the egress policy and its declared hosts. This
  is the field's shipped meaning, which `schema/execution.schema.json` states
  in those words: *"a statement about the repository's policy rather than about
  this invocation"*.
- **`established`** — present **only** on a lap that actually stood a
  containment up. It carries the resolved runtime path, the mount, and
  `egress.resolved` — the exact addresses the allowlist admitted.

`backend.write` runs once per verify lap (`verify.py:354-359`), and three of its
four callers never start a holder. Under a single flat object, every one of
them would have recorded addresses that were never admitted — **a run claiming
a containment it did not have**, which is this spec's own one-sentence test
failing inside the spec. Absence is not a gap; it is the record saying *this
lap established nothing*, and R-4a's test asserts absence rather than a
placeholder.

### Ruling 5 — The egress policy has a closed vocabulary, and each value names the mechanism that enforces it

Two values in v0. A third is a spec change, not a config addition.

| `egress.policy` | what the worker gets | what enforces it |
|---|---|---|
| `none` | loopback only | `--network none` on the worker container. The runtime enforces it, and Sequence G measured it prevented on **three** runtimes — DNS *and* a raw IP |
| `allowlist` | TCP to exactly the addresses the declared hosts resolved to, on the declared ports, and nothing else. **No DNS** | a **netns holder**: §4 |

No `all`, no `true`, no way to spell "unrestricted" — a worker that wants the
open network declares no containment and gets `trusted_local` with the record
saying so. **A flag tightens and never loosens** is this repository's standing
rule for `--send` and it applies here.

### Ruling 6 — The mechanism takes a party; only the worker path is built

`establish(party="worker", …)`. The 2026-08-14 ruling §5 requires the witness
author be isolated *identically to the worker* in Phase 3, so the surface is
shaped for a second party from the start — and **the author path is not built
here.** The parameter is the whole of the concession and it costs one argument.

### Ruling 7 — The worker's containment says nothing about the gates', and the record keeps them apart

A repository may declare `execution.backend: container` and `run.containment`,
either, both, or neither. They are independent and the record states both
separately, exactly as `execution.json` already separates `execution_mode` from
`worker_execution` — *"a single `execution_mode` covering both would be the one
field in this file capable of lying, and it would lie in the direction of
claiming more"* (`backend.py:365-369`). Inherited verbatim and extended.

**A consequence worth stating**: a v2 record whose gates ran locally carries
`execution_mode: "trusted_local"` **and** `worker_execution.declared.mode:
"contained"`, and both are true. Any guard reading the file for the string
`trusted_local` is reading the wrong thing (R-4's row).

---

## §3 — The declaration, the record, and the eleven refusals

### The declaration

```yaml
run:
  worker: my-agent --brief {brief}
  containment:
    runtime: podman                       # docker | podman | nerdctl
    image: ghcr.io/example/agent:tag      # REQUIRED — no default, ever
    requires: [my-agent]                  # binaries the image must carry
    env: [ANTHROPIC_API_KEY]              # NAMES only
    user: "1000:1000"                     # optional; digits and one colon
    egress:
      policy: allowlist                   # none | allowlist
      hosts: [api.anthropic.com]          # allowlist only
      ports: [443]                        # allowlist only; default [443]
      broker_image: docker.io/example/broker:tag   # allowlist only
```

`_CONTAINMENT_KEYS = {runtime, image, requires, env, user, egress}` and
`_EGRESS_KEYS = {policy, hosts, ports, broker_image}`, both closed — unknown
keys are errors, because a typo in a containment declaration must not silently
change what "contained" means. `config.py`'s standing rule, inherited.

`ports` exists because the first draft hardcoded 443 with no key for it, and a
self-hosted or proxied model endpoint on another port would have failed closed
with no named reason — the opposite of refusal 7's discipline (review finding
17). It defaults to `[443]`.

**`image` has no default and never will**, the `judge.endpoint` rule
(`SPEC_EXEC_V0` ruling 1). **Wringer ships no agent** — the published image's
Dockerfile says so in its own comment, and that comment is the reason
`SPEC_EXEC_V0` §5 gave for not containing the worker in the first place. The
repository names an image carrying the agent it chose; `requires:` is how it
states what that image must carry, and refusal 4 is how Wringer checks rather
than assumes.

### The record — `wringer.execution.v2`

```json
{
  "schema_version": "wringer.execution.v2",
  "backend": "local",
  "execution_mode": "trusted_local",
  "gates": ["unit"],
  "worker_execution": {
    "declared": {
      "mode": "contained",
      "runtime": "podman",
      "image": "ghcr.io/example/agent:tag",
      "env_allowlist": ["ANTHROPIC_API_KEY"],
      "user": "1000:1000",
      "egress": {
        "policy": "allowlist",
        "hosts": ["api.anthropic.com"],
        "ports": [443],
        "broker_image": "docker.io/example/broker:tag"
      }
    },
    "established": {
      "runtime_path": "/Users/…/.local/bin/podman",
      "mount": "/workspace",
      "egress": {"resolved": ["160.79.104.10"]}
    }
  },
  "limits": ["…"]
}
```

`established` is **absent** on any lap that started no holder (ruling 4a).
`resolved` is not decoration: it is the exact set of addresses the allowlist
admitted, it is what a reader consults instead of trusting a hostname, and it
is what makes a rotation failure legible after the fact.

`limits` carries `LIMITS_V2` (ruling 4), whose content is §7's ceiling.

### The eleven refusals (R-3), each named, each with a test

**S** = static, checked wherever the config is read, `wring verify` included.
**D** = dynamic, checked only at `establish()`, which only `wring run` reaches.

| # | | condition | the refusal says |
|---|---|---|---|
| 1 | S | `runtime` not on PATH | which binary is missing, which runtimes Wringer knows, and that dropping `run.containment` runs the worker on this machine — which is what every run did before |
| 2 | **D** | the runtime is present but cannot start a container here | the runtime's own stderr, quoted, and that Wringer will not guess past it |
| 3 | S | the declared `image` is not present locally | the image, and **the `pull` command to type** — Wringer does not fetch it, because *"nothing leaves this machine without a flag you typed"*, and an implicit pull is a fetch nobody typed |
| 4 | S | the image lacks a binary named in `requires:` | which binary, in which image. **R-3's named case**: Wringer never bundles an agent, so an image that cannot run the declared worker is a declaration that cannot be honoured |
| 5 | S | `egress.policy: allowlist` with no `broker_image` | that an allowlist needs a netns holder, and the holder needs an image carrying `iptables` |
| 6 | S | the broker image lacks `iptables` | which image, which binary, and that the policy therefore cannot be established |
| 7 | **D** | the allowlist cannot be armed — the holder fails to start, a declared host resolves to nothing, or the rules do not apply | which host, or the holder's stderr. **Never a partial allowlist** |
| 8 | S | containment beside a **worktree-based run** — `fleet.worktree: true`, or `wring bench`, whose contenders always run in detached worktrees | that a detached worktree's `.git` is a file, so mounted alone it is a broken repository for a worker exactly as it is for a gate. **Keyed on the worktree and not on `fleet.worktree`**, because `bench._for_contender` (`bench.py:820-828`) carries `cfg.run` — and therefore `run.containment` — into every contender, and `bench._verify_baseline` (`bench.py:637`) calls `verify.run` with the repo's own config. A refusal keyed on the config key alone is blind to both (review finding 7) |
| 9 | S | the repository path contains `:` | that `-v` splits on it and a mount nobody named is worse than a refusal (`backend.py:317-333`, inherited) |
| 10 | S | `run.containment` beside an **ACP worker** | that an ACP worker is a stdio JSON-RPC session `acp.py:372` spawns directly, with its own env allowlist and no backend; carrying that session across a container boundary is a real design and is **not v0's**. Refused by name where the two keys meet, rather than running uncontained under a config claiming containment (review finding 5). **Phase 3 must read this**: the re-test's worker is a shell worker, or Phase 3 builds the ACP path |
| 11 | S | `hosts`, `ports` or `broker_image` declared under `policy: none` | that the keys are known but inert, and a declaration reading *"these hosts are reachable"* beside `--network none` is the silent meaning-change closed key sets exist to prevent (review finding 18) |

**Every refusal exits 2 and writes no bundle.** A bundle that proves nothing is
worse than none — `SPEC_EXEC_V0` ruling 6, inherited verbatim.

### `wring doctor` moves with them

`doctor._runtime` FAILs rather than warns only when `execution.backend:
container` is declared (`doctor.py:146-192`), and `_declared_execution`
(`doctor.py:197-208`) reads `cfg.execution` and nothing else. A repo declaring
`run.containment` and no `execution:` section would get **OK or WARN from
`wring doctor` while `wring verify` exits 2** — silently narrowing
`SPEC_EXEC_V0` §9's shipped invariant to gates (review finding 10). Both
functions read `run.containment.runtime` too, with a test.

---

## §4 — The broker

### `egress.policy: none`

The worker container gets `--network none`. No holder is started, and **no
name is resolved**. This is the cheap path and the one Demo C films, because a
scripted worker needs no model API and the demo therefore costs **$0**.

### `egress.policy: allowlist` — the netns holder

Measured on this machine before it was written down (§8):

1. Wringer starts a **holder** container from `broker_image` with
   `--cap-add NET_ADMIN --cap-add NET_RAW`, a network, and one mount: a Wringer
   scratch directory.
2. Inside the holder, Wringer resolves each declared host **in the container**,
   not on the Wringer host. Not fussiness: on macOS the runtime's containers
   live inside a Linux VM with its own resolver, so a host-side answer can name
   an address the container's resolver never returns, and the allowlist would
   then block the very API it was written to admit.
3. Wringer writes the resolved addresses into a `hosts` file in the scratch
   directory and arms the allowlist: `OUTPUT` policy `DROP`, `lo` accepted, one
   `ACCEPT` per resolved address per declared port.
4. The **worker** container starts with `--network container:<holder>`,
   **no `NET_ADMIN`**, the repository mounted at `/workspace`, the `hosts` file
   mounted read-only at `/etc/hosts`, and its command path-translated (below).

**Four properties follow, each a canary rather than an argument:**

- **The worker cannot disarm the rules.** It shares the namespace but holds no
  `NET_ADMIN` in it. The boundary is not inside the thing being bounded, which
  is why the holder is a separate container at all.
- **There is no DNS.** Nothing in the allowlist admits udp/53, so name
  resolution over the network fails entirely; the worker reaches the declared
  hosts through the mounted `hosts` file and no name Wringer did not write there.
- **A raw IP does not route around it.** The rule is on the address.
- **The corpus mirror is not reachable, and not for a network reason.**
  `~/.cache/wringer-corpus/mirrors/*.git` is a **local path**
  (`benchmark/corpus/build.py:55,102-104`); the worker container mounts the
  repository and the hosts file and nothing else, so `git fetch` at that path
  fails because the path is absent.

`--add-host` is **not** the mechanism, and that is measured rather than
preferred: podman refuses it on a container joined to another container's
network namespace (§8). The mounted `hosts` file is what works.

### Path translation — `{brief}` and `{evidence_dir}`

`bundle.write_brief` returns an **absolute host path**
(`loop.py:235-238`), and `config.substitute` puts that string into the worker
command; the documented form is `worker: claude -p "$(cat {brief})"`. Inside a
container with the repository at `/workspace`, that path does not exist, so
**every documented worker command would fail on its first line** (review
finding 6). `{evidence_dir}` survives — `verify.bundle_path` is repo-relative —
but `{brief}` does not, and `gates.run` is also handed `cwd=root`, a host path.

**Ruled: when a containment is established, `{brief}` and `{evidence_dir}` are
substituted relative to `WORKSPACE`, and the working directory is `/workspace`.**
`test_no_host_absolute_path_survives_substitution_under_containment` `[new]`
asserts the substituted command contains no path outside `/workspace`.

### The worker's uid

`--user` is not defaulted, inheriting `SPEC_EXEC_V0` ruling 3 — but the
consequence differs in kind and §7.4 says so. The record states the declared
`user`, and where none is declared the image's own user applies.

### Cleanup and reaping

The holder is torn down through the total-by-construction discipline
`backend.Container.cleanup` uses (`backend.py:262-292`): every failure is
swallowed, because this runs on the way out of a worker turn and an exception
here would replace the turn's real outcome with a cleanup error.

**The holder is reaped by `<runtime> rm --force <cid>` from a cidfile
(`backend.py:282-291`), not by a process group.** The first draft cited
`loop.py:383-405`, which reads `worker.pgid` files and signals **host** process
groups — a container has no host pgid, and on macOS it lives inside the podman
VM (review finding 20). The cidfile goes in the loop's iteration directory, so
a reader can follow it and `wring resume` can reap an orphaned holder whose
allowlist is still armed.

### The canary battery — `scripts/sequence-i.sh`

Sequence I, beside Sequence G, built on **three** of G's lessons — the first
draft took two and dropped the largest:

1. It drives every probe **through the real mechanism**, not a bespoke command
   line.
2. It **refuses rather than skips** when no runtime is present
   (`scripts/sequence-g.sh:40-52`).
3. **It refuses when a probe's own tool is absent from the declared image.**
   `docs/MANUAL_CHECKS.md:515-527` records why: *two of Sequence G's seven
   attacks measured NOTHING the first time and the run reported seven attacks*,
   because the image had no `curl` and no `ps`. Under this spec the image is
   the **repository's**, and `requires:` checks only the worker binary — so
   nothing otherwise stops a probe that could not execute from being counted as
   a pass. **The control arm does not rescue this**: a missing binary fails
   identically in both arms, so the control shows "no difference" and reads as
   a canary proving nothing rather than as a broken probe. Probes use
   `python3`, `getent` and `/proc` — the fix G already made — and every row
   records its tool-present state.

| # | canary | must show |
|---|---|---|
| I1 | a host credential planted in `$HOME` before the run | not readable by probes run as the worker |
| I2 | a host credential planted in the **environment** and not named in `env:` | absent from the worker's environment |
| I3 | `git fetch` and `ls` at the corpus mirror path | fails; the path is absent |
| I4 | TCP connect to a declared model API host | **succeeds** |
| I5 | TCP connect to `github.com` by name **and** by raw address | fails, both ways |
| I6 | resolution of a name Wringer did **not** write into the hosts file, and any udp/53 egress | fails. *(The first draft said "DNS resolution of any name fails", which contradicts I4 — the mounted hosts file is what makes I4 possible, so `getent hosts api.anthropic.com` succeeds via `files`. A probe written to the first draft's letter reddens a working mechanism — review finding 23.)* |
| I7 | the worker attempting to disarm the allowlist | fails |
| I8 | the host process table, from inside | **no host argv and no credential value visible.** R-2's whole rationale for `--env NAME` is that an argv is readable by anyone who can run `ps`, so this row has a criterion and states it — the first draft said "recorded, whatever it shows", which is a measurement in a column headed "must show" (review finding 24) |

**I4 is not a formality.** R-2's policy is *"the model API and nothing else"*,
and a battery demonstrating only the "nothing else" half is indistinguishable
from `--network none`, which proves nothing about a broker. **No LLM call is
made** — I4 is a TCP connect, and the battery costs $0.

### The control run (the phase's ruled rider)

The same battery with the boundary removed. **The attacks are expected to
SUCCEED**; if they do not, the canaries prove nothing and that is a finding to
chase rather than a pass (R-5, §F). Two arms:

- **`trusted_local`** — the worker as it runs today. Every probe should
  succeed: the credential readable, the mirror reachable, github reachable.
  The arm that shows the canaries measure containment rather than a broken probe.
- **`--privileged`, allowlist off** — the container arm with the boundary
  removed. `docs/MANUAL_CHECKS.md`'s Sequence G names this as the cheapest
  honest way to show the flags are what stopped the attacks, and records that
  it has never been done.

---

## §5 — Non-goals (binding)

1. **The gate backend is not touched.** No key is added to `_EXECUTION_KEYS`
   (`config.py:47`); the argv, the refusals and the record shape are unchanged.
2. **No witness-lane code.** The party parameter is the entire concession to
   Phase 3; `witness` and `author` appear nowhere in the containment module.
3. **No 20th command.** The declaration is config; the mechanism lives inside
   `wring run` and `wring verify`. The ceiling is 19.
4. **`wringer.execution.v1` is not edited** — no field, no enum value, no
   description change, and `LIMITS_V1` keeps its shipped bytes.
5. **`benchmark/` is untouched.** The corpus mirror is a canary *target*.
   Wiring containment into the harness is Phase 3's, and refusal 10 is what
   Phase 3 must read first.
6. **The prove pass's worktree handling under containers stays broken and
   banked.** W9's second route, named so a future window finds it.
7. **No image digest and no runtime version is recorded** — `SPEC_EXEC_V0` §8's
   reasoning inherited: resolving a digest means asking the runtime, and
   nothing in a verification should spawn a process to decorate a record.
8. **No `--user` default.** `SPEC_EXEC_V0` ruling 3, inherited — with §7.4's
   correction that the consequence differs for a worker.
9. **Nothing restricts the uncontained worker.** A repo declaring no
   containment gets today's behaviour, byte for byte.
10. **No egress value beyond `none` and `allowlist`, and no ACP path.** Both
    are spec changes.
11. **`wring bench` is not given containment**; refusal 8 refuses it. SPEC_EXEC
    §8 deliberately kept bench out of the gate backend and this spec keeps it
    out of the worker one, rather than handing it containment by inheritance.

---

## §6 — The slice plan, and what each slice captures

Each slice names its capture. A slice with no capture is a slice whose claim
nobody can check.

**S1 — the declaration.** `run.containment` parsed, closed key sets, and every
static config-level refusal (5, 8, 9, 10, 11). No mechanism yet.
*Capture: `tests/test_containment_config.py`, and a transcript of `wring verify`
refusing each malformed declaration by name.*

**S2 — the refusals that need the world.** Static refusals 1, 3, 4, 6 and
dynamic 2, 7, wired into `verify.run`'s preflight beside the gate backend's;
`wring doctor` extended.
*Capture: a transcript per refusal, and **the E-list** — for each refusal, the
one-line edit that removes it and the test that then reddens. A refusal with no
demonstrated red is a refusal nobody has watched fail.*

**S3 — establish, spawn, record.** The broker (§4), path translation, the
worker container, `wringer.execution.v2`, the `LIMITS` split.
*Capture: the literal bytes of one contained run's `execution.json` —
`declared` and `established` both — in `docs/containment-2026-08-15.md`.*
***This is stop (a)**, and it is a file or the stop is not hit.*
*Also owed in this slice, and named because the first draft called them free
(review finding 21): a `schema/frozen.json` entry for
`execution-v2.schema.json` (`test_schema.py:1038-1045` requires one) and a row
in `schema/README.md` (`test_schema.py:1665-1680` requires one).*

**S4 — the R-1 pin.** A contained worker with `run.prove: true` yields a real
vacuity verdict.
*Capture: the `vacuity.json` from that run, verdict quoted, in the same
document. A slice shipping without this reopened W9.*

**S5 — measure and film.** Sequence I, the two control arms, Demo C as a new
`STEP_SETS` group in `scripts/demo_record.py`.
*Capture: `docs/containment-2026-08-15.md`'s canary table **per (platform,
runtime, image)** — §7.1 says a result is a fact about all three and the first
draft's §8 named no image (review finding 25) — the control table beside it,
`docs/containment.cast.json`, `docs/containment.svg`, and a
`docs/MANUAL_CHECKS.md` coverage row.*

**S6 — the SECURITY.md correction.** `egress.policy: allowlist` causes Wringer
to start a holder and issue a DNS query on `wring run`. SECURITY.md's shipped
promise names that command among those that *"make no outbound connections"*
(`SECURITY.md:233-238`), and `tests/test_network_surface.py` cannot catch it —
it walks the Python AST for `urllib` call sites, and this is a subprocess
(review finding 8). The enumeration is corrected, in the house pattern that
restates it whenever a command changes it. **Any capability-table row that
changes carries its probe in the same commit** (Q3's guard forces it).
*Capture: the diff, and the probe.*

**Riders (R-7), separate commits, no containment code.**

---

## §7 — What this does NOT license

**This is the section to read before quoting anything above as a security
property.** `SPEC_EXEC_V0` §7's discipline applied to a boundary that is now
measured rather than merely asked for — which changes what may be said by less
than a reader expects.

1. **A canary result is a fact about one platform, one runtime, one image.**
   R-5. A macOS run cannot speak for Linux; the Linux guest of a podman machine
   cannot speak for Docker. Sequence G learned this three times.
2. **Eight scripted probes are not an escape suite.** Nothing attempts a kernel
   exploit, a capability abuse, a cgroup or `/proc/sys` write, or a container
   escape. `prevented` means *the thing cannot be done*, not *it failed this
   time*, and the classification is a human's.
3. **SECURITY.md's "designed to isolate" does not change on the strength of
   this spec.** It changes, if at all, on §8's table plus the control run, in a
   commit carrying its probe. **And the guard that forces probes parses the
   AUTHORITY table only** — that sentence lives outside it, so the guard cannot
   fire on it (§1's R-5 row).
4. **The privilege the worker has inside the container is the IMAGE's choice,
   and the residue lands in your real repository.** Wringer sets no `--user`
   unless a config asks, and Sequence G's Docker row measured that a root image
   gives root. For a *gate* that mostly reads the mount, `SPEC_EXEC_V0` ruling
   3's "offered, not applied" was affordable. **A worker's whole job is to
   write the mount**, so a root image leaves root-owned files in the developer's
   tree — the case ruling 3 itself names, now the default outcome (review
   finding 19). It also degrades the R-1 pin: a vacuity pass over a tree with
   unreadable files yields a verdict that is "not inconclusive" and means
   nothing.
5. **The mount is read-write by design.** The worker's job is to change the
   tree. A hostile worker can corrupt the tree it was given, and container
   escapes exist. The difference between a mistake and a disaster, not
   permission to run something you actively distrust.
6. **Containment does not make a delivery trustworthy.** It closes a
   contamination channel so a *measurement* is worth reading. The claim it
   licenses is that the corpus re-test is not discountable the way run 1 was —
   **not** that a contained agent's change is correct. The witness lane makes
   that claim, under `WRINGER_RULING_2026-08-15` Q1's ceiling, and this spec
   does not extend it.
7. **`resolved` is a snapshot.** The addresses were correct when the allowlist
   was armed. An API rotating addresses mid-run loses the worker's connection —
   which fails **closed** and is visible in the worker's own log. Nothing here
   claims the allowlist tracks DNS.
8. **No claim is made about egress on a platform where the holder could not be
   established.** Refusal 7 fires and the run does not happen.
9. **It is an ADDRESS allowlist, so everything co-tenanted at those addresses
   is reachable.** On shared CDN infrastructure that can be a large set, and
   **no canary in §4 can see it** — §8's measured address happens to be
   Anthropic-owned, which is exactly why the limit would otherwise stay
   invisible (review finding 16). An allowlist of hostnames is not what is
   enforced; an allowlist of the addresses they resolved to is.

---

## §8 — What was measured, before any of this was written

Run on this machine, 2026-08-15, **rootless podman 6.1.0, `applehv` provider,
no admin rights**, macOS 26.5.2 `Darwin arm64`, **image
`docker.io/library/alpine:latest` with `iptables` added**. Recorded because a
spec proposing a mechanism nobody has run is a spec proposing a hope.

**The caveat first, because it decides what the table is worth.** On macOS a
Linux VM sits between the container and the host, so these are facts about
container ⇢ VM isolation. Sequence G's macOS row carries the same caveat for
the same reason. The Linux-guest arm and the published-image arm are Sequence
I's to run.

| probe | result |
|---|---|
| `--cap-add NET_ADMIN` in a rootless container's own netns | works (`ip link add` succeeds) |
| a holder arms `OUTPUT DROP` + per-address `ACCEPT` | works |
| a joiner on `--network container:<holder>` is subject to those rules | **yes** — allowed address reached, denied address blocked |
| the joiner, without `NET_ADMIN`, tries `OUTPUT ACCEPT` | **CANNOT_DISARM** |
| `--add-host` on the joiner | **refused by podman** — *"cannot set extra host entries when the container is joined to another containers network namespace"*. This is why §4 mounts a `hosts` file |
| resolution inside the holder, allowlist armed to those addresses, DNS blocked, `hosts` mounted read-only into the joiner | `DNS_BLOCKED` · `api.anthropic.com:443` **API_REACHED** · github raw address **GITHUB_BLOCKED** · **CANNOT_DISARM** · corpus mirror **MIRROR_ABSENT** |

**No LLM call was made and no money was spent.** Every network probe is a TCP
connect.

---

## §9 — The independent review

**One agent, 2026-08-15, over the finished first draft, instructed to refute.
Verdict: NOT SOUND — 27 findings, 9 HIGH, 12 MEDIUM, 6 LOW. All 27 folded;
none rebutted.**

| # | sev | the finding | where it landed |
|---|---|---|---|
| 1 | HIGH | the R-1 pin asserted `proven`/`not_proven`; there is no `not_proven` and `gates_vacuous` is legitimate | §1 R-1 row — `verdict != INCONCLUSIVE`, imported constants |
| 2 | HIGH | `backend.LIMITS` row 4 would deny the containment record's own claim, and ruling 4 forbade the only fix | ruling 4 — `LIMITS_V1`/`LIMITS_V2`; §6 S3 names the guard edit |
| 3 | HIGH | the `trusted_local` guard was file-wide and cannot pass — `execution_mode` legitimately holds it | §1 R-4 row — asserted on the `worker_execution` subtree; ruling 7's consequence paragraph |
| 4 | HIGH | `test_no_execution_mode_reads_as_isolation` does not exist; the real guard reads one enum in one schema | ruling 4 — real name cited, extension committed |
| 5 | HIGH | two worker spawn paths; ACP bypasses every backend | refusal 10; §1 R-3 row's AST enumeration; header item 3 |
| 6 | HIGH | `{brief}` is a host-absolute path; every documented worker command breaks | §4 path translation + its test; header item 4 |
| 7 | HIGH | `wring bench` inherits containment and refusal 8 was blind to it | refusal 8 rekeyed on the worktree; §5 non-goal 11 |
| 8 | HIGH | the allowlist makes an outbound query from `wring run`; SECURITY.md says it makes none | ruling 3's static/dynamic split; §6 **S6** |
| 9 | HIGH | the battery inherited two of Sequence G's lessons and dropped the largest — probes that measure nothing | §4's three lessons; per-probe tool-present state |
| 10 | HIGH/MED | `wring doctor` would disagree with `wring verify` | §3's doctor subsection |
| 11 | MED | R-2 cited a gate-side test for a worker property | distinct `[new]` test name; `[shipped]`/`[new]` marking throughout §1 |
| 12 | MED | the cast guard iterates `STEP_SETS`, not casts | Demo C recorded as a `STEP_SETS` group |
| 13 | MED | the Q3 guard parses the authority table, not the isolation sentence | §1 R-5 row and §7.3, both stated |
| 14 | MED | the record mixed policy with establishment and had no value for a lap that established nothing | **ruling 4a** — `declared`/`established`; absence is the reading |
| 15 | MED | `contained` collides with `CONTAINED = "container"` | `WORKER_CONTAINED`, with ruling 4's paragraph saying why |
| 16 | MED | no limit for address co-tenancy | §7.9 |
| 17 | MED | 443 hardcoded with no key | `egress.ports`, default `[443]` |
| 18 | MED | `hosts`/`broker_image` legal and inert under `policy: none` | refusal 11 |
| 19 | MED | `--user`'s consequence differs in kind for a worker — host-side root residue | §7.4 |
| 20 | MED | holder reaping cited a pgid mechanism that cannot reach a container | §4 cleanup — cidfile, `backend.py:282-291` |
| 21 | MED | `frozen.json` and `schema/README.md` edits called free | §6 S3's capture |
| 22 | MED | the header claimed corpus §3's channel, which containment did not close | header and Positioning — §4, and *builds* rather than *closes* |
| 23 | LOW/MED | I6 contradicted I4 | I6 reworded |
| 24 | LOW/MED | I8 had no pass/fail criterion | I8 given R-2's implied criterion |
| 25 | LOW | §8 named no image while §7.1 says a result is a fact about one | §8's header; S5's capture per (platform, runtime, image) |
| 26 | LOW | three citation defects — a dangling "§7 ruling 12", `sequence-g.sh:41-52` off by one, a stitched quotation presented as verbatim | all three corrected; the quotation replaced with a paraphrase that says it is one |
| 27 | LOW | the R-5 grep would redden on this spec's own "deliberately not `sandboxed`" | the guard matches assertions, not mentions; this spec is its fixture |

**What the review could not check**: whether a probe is the *right* probe for
its canary, and whether the mechanism holds on any platform other than the one
in §8. Both are Sequence I's to answer, and neither is a document's to claim.

---

## §10 — Definition of DONE

- [ ] `run.containment` parses, with closed key sets and named refusals
- [ ] all eleven refusals fire, each with a test, each watched to redden
- [ ] no key added to `_EXECUTION_KEYS`; `vacuity.py:162` byte-unchanged
- [ ] `wringer.execution.v2` written **only** where containment is declared;
      v1 byte-identical everywhere else, `LIMITS_V1` included
- [ ] `worker_execution.declared` always present; `established` present only on
      a lap that stood a containment up
- [ ] `mode: "trusted_local"` appears in no v2 `worker_execution` subtree
- [ ] `frozen.json` and `schema/README.md` carry the new schema
- [ ] the broker establishes an allowlist the worker cannot disarm
- [ ] `{brief}` and `{evidence_dir}` translate; no host-absolute path survives
- [ ] `wring doctor` FAILs where `wring verify` would refuse
- [ ] contained worker + `run.prove: true` → a verdict that is **not**
      `inconclusive`
- [ ] Sequence I runs; refuses without a runtime; refuses when a probe's tool
      is absent; records what it found per (platform, runtime, image)
- [ ] the control run's attacks **succeed**
- [ ] Demo C filmed as a `STEP_SETS` group, `$0`
- [ ] SECURITY.md's outbound enumeration corrected, with its probe in the same
      commit
- [ ] no document claims more than §8's table plus the control support
