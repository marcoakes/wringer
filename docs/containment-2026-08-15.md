# Containing the worker — 2026-08-15

**This is evidence, not a spec.** It records the first time Wringer ran a
worker somewhere other than the machine you typed on, and what eight scripted
attacks found when they tried to get out. It is not rewritten; corrections
arrive as postscripts.

Contract: [specs/SPEC_CONTAIN_V0.md](../SPEC_CONTAIN_V0.md). The gap it closes was
recorded, at full volume and deliberately unclosed, in
[specs/SPEC_EXEC_V0.md](../SPEC_EXEC_V0.md) §5: *"`run.worker` runs on the host.
Always. The container backend contains gates."* What it cost is in
[docs/corpus-2026-08-13.md](corpus-2026-08-13.md) §4 — three arm-B rows of a
$77 run fetched a `.patch`, a PR diff and a post-fix copy of the very source
file the task asked to change.

**Platform: macOS 26.5.2 `Darwin arm64`, rootless podman 6.1.0, `applehv`
provider, installed in `~/.local` with no admin rights. Worker image
`localhost/wringer-canary-worker:probe` (`python:3-slim` + `iptables`); broker
image `localhost/wringer-broker:probe` (`alpine` + `iptables`). No LLM call was
made; every network probe is a TCP connect; the whole capture cost $0.**

**Read the caveat before the table.** On macOS a Linux VM sits between the
container and the host, so these are facts about container ⇢ VM isolation.
Sequence G's macOS row carries the same caveat for the same reason, and its
Linux-guest arm is what made the equivalent claim worth more. Sequence I's
Linux arm has not been run.

---

## 1. The stop, all three parts

The 2026-08-14 ruling's Phase 2 stop is three things. All three are **HIT**.

### (a) A run whose bundle records a contained `worker_execution` value

`wringer.execution.v2`, written only where `run.containment` is declared. Every
other run in the world still writes v1, byte-identical.

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
      "image": "localhost/wringer-canary-worker:probe",
      "env_allowlist": [],
      "user": null,
      "egress": {
        "policy": "allowlist",
        "hosts": ["api.anthropic.com"],
        "ports": [443],
        "broker_image": "localhost/wringer-broker:probe"
      }
    },
    "established": {
      "runtime_path": "/Users/marc/.local/bin/podman",
      "mount": "/workspace",
      "egress": {"resolved": ["160.79.104.10"]}
    }
  },
  "limits": ["…"]
}
```

Two things in that record are worth more than the mode word.

**`execution_mode` says `trusted_local` and that is correct.** The gates ran on
this machine; the worker did not. A single field covering both would be the one
field in this file capable of lying, and it would lie in the direction of
claiming more — SPEC_EXEC's sentence, inherited. Any guard reading this *file*
for the string `trusted_local` is reading the wrong thing.

**`established` is a separate block, and its absence is the honest reading.**
`backend.write` runs once per verify lap and three of its four callers —
`wring verify`, `wring start`, `wring bench`'s baseline — never start a
container. Under one flat block every one of them would have recorded an
address that was never admitted. A lap that stood nothing up has no
`established` key at all.

### (b) The canaries

Eight probes, run **as the worker**, through the real mechanism — the probe
script *is* `run.worker`, so what is measured is the argv Wringer ships rather
than a command line written for the occasion. `scripts/sequence-i.sh`.

Two host secrets were planted before each run so the probes had something real
to find: a file at `~/.wringer-canary-secret` mode 600, and the same value in
the environment, unnamed in `containment.env`.

| # | probe | **contained** | control: `--privileged`, no allowlist, `--pid host` | control: `trusted_local` |
|---|---|---|---|---|
| I1 | host credential file | **BLOCKED** `FileNotFoundError` | **REACHED** — read the value | **REACHED** |
| I2 | host credential in env | **BLOCKED** not in environment | **REACHED** — read the value | **REACHED** |
| I3 | corpus mirror path | **BLOCKED** `FileNotFoundError` | **REACHED** — 5 mirrors | **REACHED** — 5 mirrors |
| I4 | model API, TCP 443 | **REACHED** | REACHED | REACHED |
| I5a | `github.com` by name | **BLOCKED** `gaierror -3` | **REACHED** | **REACHED** |
| I5b | github by raw address | **BLOCKED** `TimeoutError` | **REACHED** | **REACHED** |
| I6 | DNS for an undeclared name | BLOCKED | BLOCKED | BLOCKED |
| I7 | disarm the allowlist | **BLOCKED** `Permission denied (you must be root)` | **REACHED** `exit 0` | TOOL_ABSENT |
| I8 | host process table | **BLOCKED** 2 pids | **REACHED** 167 pids | ERROR — no `/proc` |

**The ruling's canary, in its own words**: *a planted host credential is
invisible to scripted probes run as the worker* — I1 and I2. *A fetch to the
corpus mirror path fails while the model API remains reachable* — I3 beside I4.
Both hold, and the control arms show both would have succeeded without the
mechanism.

**I4 is not a formality.** R-2's policy is *"the model API and nothing else"*,
and a battery demonstrating only the "nothing else" half would be
indistinguishable from `--network none`, which proves nothing about a broker.

### What the control run settles, and what it does not

**The `--privileged` control had never been run in this repository.** Sequence
G's own closing paragraph named it as the cheapest honest way to show the flags
are what stopped the attacks, and recorded that nobody had done it. Six of the
eight probes flip. That is the difference between a table of passes and a
measurement.

**Two rows measured nothing, and they are recorded as such rather than
counted.**

- **I6 is BLOCKED in all three arms**, and for different reasons: contained,
  `gaierror -3` (no DNS at all); privileged, `gaierror -2` (the name genuinely
  does not exist). A probe whose control cannot distinguish it proves nothing
  about the flags. **The DNS-blocking evidence is I5a**, which fails with `-3`
  under containment and connects in both controls.
- **I7 and I8 in the `trusted_local` arm** are `TOOL_ABSENT` and `ERROR` —
  macOS has no `iptables` and no `/proc`. The script says so instead of
  counting them, and the `--privileged` arm is the valid control for those two.

**The first run of this script committed the failure it was written to
refuse**, and it is recorded here because that is the more useful half:

- **I7 reported `BLOCKED  FileNotFoundError: iptables`.** The worker image had
  no `iptables`, so nothing was attempted — a probe that could not execute,
  counted as a boundary holding. That is Sequence G's third and largest lesson
  (*"two of the seven attacks measured NOTHING the first time, and the run
  reported seven attacks"*) committed inside the script written to inherit it.
  It is now `TOOL_ABSENT`, which is an error and not a pass.
- **I8 reported `credential value visible: True`.** The probe searched for the
  prefix `wringer-canary-`, which matched the canary *file path* in the probe's
  own argv. A false positive is as useless as a false negative. It now matches
  the suffix only the value carries.

Neither was caught by a reviewer. Both were caught by running the thing.

### (c) Demo C is filmable — and filmed

`docs/containment.cast.json` and `docs/containment.svg`, 48 lines, regenerable
with `sh scripts/demo.sh "" contained`, **$0**: `egress.policy: none` and a
shell worker, so there is no agent, no credential and no network. Recorded as a
`STEP_SETS` group in `scripts/demo_record.py` like every other demo here, which
is what puts it under the existing displayed-equals-executed guard.

Two steps, because the arc has two: the loop converges exactly as it always
did, and then the record says where the worker was while it happened. **The
second step is the one that could not be filmed before this cycle** — a
converged run looks identical whether the worker ran in a box or on your
laptop, which is the whole reason `execution.json` is written unconditionally.

---

## 2. The R-1 pin — W9, resolved by construction and demonstrated

`SPEC_GATEGEN_V0` §6 W9 ruled that worker containment must not be expressed
through `execution.backend`, because `vacuity.prove` returns `INCONCLUSIVE`
unconditionally for that value (`vacuity.py:161-187`) — so containment carried
there would have made **every witness in Phase 3's committed re-test
`inconclusive`, and the $38 would have measured nothing.**

A contained worker, `run.prove: true`, a gate red until the worker builds the
thing:

```json
{
  "schema_version": "wringer.vacuity.v1",
  "verdict": "proven",
  "reason": "feature failed on the pre-change tree, so the gates test this change",
  "gates": [
    {
      "gate_id": "feature",
      "changed": "passed",
      "pre_change": "failed",
      "sensitive": true,
      "cites": "exit 1, and it printed nothing"
    }
  ]
}
```

**`proven`, with `sensitive: true`.** Not `inconclusive`. The worker ran in a
container, wrote `/workspace/feature.txt`, the file landed in the mounted repo,
the gate turned green, and the prove pass ran exactly as it does for an
uncontained worker — because `vacuity.py` never sees `run.containment`.

*The pin's assertion is `verdict != INCONCLUSIVE` rather than `== "proven"`.
The independent review caught the first draft asserting `proven` or
`not_proven`; there is no `not_proven` in this program, and `gates_vacuous` is
the verdict the whole witness programme is built on.*

---

## 3. What was found by running it, that reading it did not find

Three defects, all in this cycle's own work, all surfaced by execution.

1. **The hosts file was mounted from the wrong directory.** The holder is
   established once for the whole loop and writes its `hosts` file into the
   loop's directory; the mount path was recomputed from the per-turn iteration
   directory. podman refused with `statfs …: no such file or directory` and the
   worker exited **125 having attacked nothing** — while `execution.json` said
   `established`. That is precisely the *"claiming a containment it did not
   have"* shape this spec is answerable to, and no reviewer found it. The path
   is now carried on `Established` rather than derived.
2. **I7 measured nothing** (above).
3. **I8's leak check matched its own argument** (above).

---

## 4. What this does NOT license

[SPEC_CONTAIN_V0 §7](../SPEC_CONTAIN_V0.md) is the ceiling and it is not
repeated here. The four that matter most for a reader of this page:

- **A result is a fact about one platform, one runtime, one image.** macOS via
  podman, with a VM in the path. The Linux arm is unrun; docker is unrun.
- **Eight scripted probes are not an escape suite.** No kernel exploit, no
  capability abuse, no cgroup or `/proc/sys` write, no container escape.
  `prevented` means *the thing cannot be done*, not *it failed this time*.
- **`SECURITY.md`'s "designed to isolate" does not change on the strength of
  this page.** What it would take is written in `docs/MANUAL_CHECKS.md`, and
  this is one platform of the several that sentence covers.
- **Containment does not make a delivery trustworthy.** It closes a
  contamination channel so that a measurement is worth reading. The claim it
  licenses is that the corpus re-test is not discountable the way run 1 was —
  not that a contained agent's change is correct.

**And it closes nothing yet.** `benchmark/` is untouched: this cycle builds the
mechanism, and wiring it into the harness is Phase 3's. Refusal 10 is what
Phase 3 must read first — an ACP worker cannot be contained in v0, so the
re-test's worker is a shell worker or Phase 3 builds that path.

---

## Postscript, 2026-08-15 — the ACP arm, and three repaired probes

*Appended, never a rewrite: the page above recorded what was true when it was
written, and the last paragraph in particular — "an ACP worker cannot be
contained in v0" — is the sentence this postscript answers. Captures are
evidence.*

**Refusal 10 became a capability** (`SPEC_CONTAIN_V0` §11). The page above ends
by telling Phase 3 that the re-test's worker is a shell worker *or Phase 3
builds that path*. Phase 3 built that path, because the corpus tasks are real
upstream bug fixes and a shell script does not fix them.

### Sequence I, re-run against a contained ACP worker

**macOS 26.5.2 `Darwin arm64` · rootless podman 6.1.0 `applehv`, no admin ·
worker `localhost/wringer-canary-worker:probe` (`python:3-slim` + `iptables`) ·
broker `localhost/wringer-broker:probe` (`alpine` + `iptables`).** Same
mechanism, same probes, the OTHER spawn path — a stdio JSON-RPC session held
open across the container boundary rather than a shell string handed to
`gates.run`.

The session reported its own working directory back over the wire as the first
thing it did: `ACP-CWD /workspace`. That is the path translation measured in
the real mechanism rather than asserted in a test.

| # | probe | contained (ACP) | `--privileged` control | `trusted_local` control |
|---|---|---|---|---|
| I0 | probe can run | TOOL_PRESENT | TOOL_PRESENT | TOOL_PRESENT |
| I1 | host credential file | **BLOCKED** | REACHED — read the secret | REACHED |
| I2 | host credential in env | **BLOCKED** | REACHED — read the secret | REACHED |
| I3 | corpus mirror | **BLOCKED** | REACHED — **listed 5 mirrors** | REACHED — 5 mirrors |
| I4 | model API | **REACHED** | REACHED | REACHED |
| I5a | denied host by name | **BLOCKED** | REACHED | REACHED |
| I5b | denied host by address | **BLOCKED** | REACHED | REACHED |
| I6 | DNS for an undeclared name | **BLOCKED** | REACHED | REACHED |
| I7 | worker disarms the allowlist | **BLOCKED** | REACHED (exit 0) | NOT_APPLICABLE |
| I8 | process table | **BLOCKED** — 2 pids | REACHED — 161 pids | REACHED — 554 pids |

**Seven of the eight attack probes flip when the boundary is removed. The
eighth is I4, and it is not supposed to flip** — a battery demonstrating only
the "nothing else" half would be indistinguishable from `--network none`, which
proves nothing about a broker.

**I3 is the row this whole phase exists for.** With the boundary removed the
probe lists the corpus mirrors by name — `attrs.git`, `click.git`,
`marshmallow.git`, `packaging.git`, `pyparsing.git` — which is the
contamination channel `docs/corpus-2026-08-13.md` §4 recorded in use. With the
boundary on, the path is not there.

### The three probes that measured nothing, repaired

The page above records honestly that two probes measured nothing and says which.
All three are fixed, and each fix is about the CONTROL rather than the probe:

- **I6** asked for `example.invalid.wringer-canary.test`, which resolves
  nowhere — so the control returned BLOCKED too and the row distinguished
  nothing. It now asks for the denied host, which genuinely resolves on an
  unrestricted machine.
- **I7** reported `TOOL_ABSENT` in the `trusted_local` arm because macOS has no
  `iptables`. That reads as a broken probe when the question is actually
  meaningless — there is no boundary to disarm where none was established. The
  arm now says `NOT_APPLICABLE` with that reason, and **I7's real control is the
  `privileged` arm**, where the image has `iptables` and the container has
  `NET_ADMIN`: the disarm succeeds there, exit 0.
- **I8** read `/proc` only, so on the macOS host it raised and was recorded
  `ERROR`. It now falls back to `ps`, and both arms answer the same question
  about the same thing.

### What this still does not license

Everything in §7 and in the section above stands unchanged. In particular: this
is one platform, one runtime, one image, with a Linux VM in the path; ten
scripted probes are not an escape suite; and **a contained agent is not a
trustworthy agent** — containment closes a contamination channel so that a
measurement is worth reading, and says nothing about whether the agent's change
is correct.
