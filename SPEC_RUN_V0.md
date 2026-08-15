# SPEC — `wring run` v0.2, slice 1: the repair loop

*Adopted 2026-07-30. This is the **binding implementation contract** for the
first executable slice of v0.2. Where it and [ROADMAP.md](ROADMAP.md)
disagree about this slice, this document wins;
[SPEC_VERIFY_V0.md](SPEC_VERIFY_V0.md) remains binding and unchanged for
everything `wring verify` does.*

## Positioning

> **While `wring verify` fails, hand the evidence to your own coding agent
> and let it try again — with receipts for every lap.**

`wring verify` proved a change. `wring run` closes the loop around it. The
worker is **your** agent, spawned as a subprocess; Wringer supplies the
gates, the brief and the evidence. It still makes **no LLM call and no
network call of its own** — the worker's costs and choices are the worker's.

The judge, issue ingestion and MR delivery are later slices. This one is the
loop.

## CLI surface

```bash
wring run                     # loop until converged or stopped
wring run --max-iterations 5  # override the config
wring run --json              # one object on stdout, no human report
```

**Exit codes are contract:**

| code | meaning |
|---|---|
| 0 | converged — every required gate passed |
| 1 | stopped without converging (iterations exhausted, or no progress) |
| 2 | config or environment error (including a missing `run:` section) |
| 3 | unsafe dirty state / refused precondition |
| 4 | interrupted |

These mirror `wring verify`'s table deliberately: `0` is still "the evidence
says yes", `1` is still "it does not".

## Config — the `run:` section

```yaml
run:
  worker: claude -p "$(cat {brief})"
  max_iterations: 3      # optional, default 3, integer >= 1
  worker_timeout: 900    # optional, default 900 seconds, integer >= 1
```

**Rules (binding):**

1. `worker` is **required and never invented**. `wring run` in a repo whose
   config has no `run:` section is exit 2 with a message naming what to add —
   the same law as gates: a wrong command is worse than an absent one.
2. Validation is strict, like the rest of the config: unknown keys under
   `run:` are errors.
3. **Placeholders**, substituted before the shell sees the command:
   `{brief}` — path to this iteration's brief · `{evidence_dir}` — the
   failing verify bundle · `{iteration}` — 1-based iteration number. An
   unknown `{name}` is a config error that names the allowed set. A `{` not
   forming a known placeholder, and anything of the form `${VAR}`, passes
   through untouched to the shell.
4. **The worker command is code**, exactly as a gate is: it runs through a
   shell, in the repo root, with the user's privileges and inherited `PATH`.
   Everything [SECURITY.md](SECURITY.md) says about `.wringer.yaml` applies
   to it with no exceptions.
5. A config carrying `run:` requires Wringer ≥ 0.2 — v0.1's strict loader
   rejects unknown top-level keys. Verify-only configs remain valid forever.

## The loop

Preconditions are `wring verify`'s: inside a git repo (else exit 2), no merge
or rebase in progress (else exit 3), config loads (else exit 2).

Then for iteration *N* = 1 … `max_iterations`:

1. **Verify.** A full `wring verify`, writing an ordinary bundle to
   `.wringer/runs/` — indistinguishable from one a human ran.
2. **Converged?** Every required gate passed → `loop.finished`, exit 0.
3. **Progress?** Fingerprint the tree. If it equals the fingerprint taken
   before the previous worker ran, the worker changed nothing: stop with
   reason `no_progress`, exit 1. No second verify is run — an identical tree
   gives an identical result, and re-running it would be theatre.
4. **Budget?** Iterations exhausted → stop, reason `max_iterations`, exit 1.
5. **Brief.** Write `iterations/NNN/brief.md`: the failing run's `--json`
   object, the diagnosis (failing gate, command, exit code, log tails,
   changed files), and the instruction to fix it, re-check with the printed
   rerun command, and leave `.wringer/` alone.
6. **Worker.** Substitute placeholders and run the command with its own
   process group and `worker_timeout`, capturing both streams to
   `iterations/NNN/worker.{stdout,stderr}.log` — scrubbed before write and
   capped, exactly as gate output is.

**A worker's exit code is recorded and never ends the loop.** The evidence
decides, not the worker's opinion of itself: a worker that crashed after
fixing the bug converges on the next lap, and one that exited cleanly
without changing anything stops on `no_progress`. A worker that overruns
`worker_timeout` is killed, recorded as timed out, and the loop continues.

**Ctrl-C** kills the worker's process group, finishes the loop bundle
honestly — a `worker.started` with no `worker.finished`, mirroring verify's
treatment of an interrupted gate — and exits 4.

### The fingerprint

sha256 over: HEAD sha · `git diff` output · `git status --porcelain -z`
output · and for each untracked path in sorted order, its path and the hash
of its contents (files over 10 MB contribute path and size only).

This is deliberately the degenerate form of the anti-thrash machinery in the
roadmap's Days 31–60. Failure-signature hashing, oscillation detection and
plateau scoring are **not** this slice.

## Loop evidence — `.wringer/loops/<loop_id>/`

A new artifact with its own schema version, **`wringer.loop.v1`**. Verify
bundles are *referenced by path*, never copied or nested: one run, one
bundle, one place.

```
.wringer/loops/20260731-091500-4b2a/
  manifest.json
  loop.jsonl
  summary.md
  iterations/
    001/
      brief.md
      worker.stdout.log
      worker.stderr.log
```

`loop.jsonl` is append-only, one JSON object per line, every event carrying
`type` and a millisecond `ts`:

```json
{"type":"loop.started","ts":"...","loop_id":"...","wringer_version":"0.2.0","repo":"wringer","sha":"abc123","max_iterations":3}
{"type":"iteration.started","ts":"...","iteration":1}
{"type":"verify.finished","ts":"...","iteration":1,"status":"failed","failed_gate":"test","evidence_dir":".wringer/runs/..."}
{"type":"worker.started","ts":"...","iteration":1,"command":"claude -p ..."}
{"type":"worker.finished","ts":"...","iteration":1,"exit_code":0,"duration_ms":134201}
{"type":"iteration.started","ts":"...","iteration":2}
{"type":"verify.finished","ts":"...","iteration":2,"status":"passed","evidence_dir":".wringer/runs/..."}
{"type":"loop.finished","ts":"...","status":"converged","reason":"converged","iterations":2}
```

Optional keys appear only in the case they describe — `failed_gate` on a
failing verify, `timed_out` on a worker that overran — the same convention
the evidence bundle uses.

`manifest.json`:

```json
{
  "schema_version": "wringer.loop.v1",
  "loop_id": "20260731-091500-4b2a",
  "started_at": "2026-07-31T09:15:00+01:00",
  "repo": {"root": ".", "head_sha": "abc123", "branch": "main", "dirty": true},
  "config": {"max_iterations": 3, "worker": "claude -p ..."},
  "result": {"status": "converged", "reason": "converged", "iterations": 2,
             "final_run": ".wringer/runs/..."}
}
```

## The console

```
$ wring run
iteration 1/3
✓ lint passed        0.1s
✗ test failed        9.2s
→ worker             2m 14s (exit 0)
iteration 2/3
✓ lint passed        0.1s
✓ test passed       11.0s

Converged in 2 iterations.
Loop evidence: .wringer/loops/20260731-091500-4b2a/
```

Gate lines are `wring verify`'s, unchanged. `wring run --json` emits one
object, keys always present:

```json
{"status":"converged","reason":"converged","iterations":2,"loop_dir":".wringer/loops/...","final":{"status":"passed","failed_gate":null,"rerun":null,"evidence_dir":".wringer/runs/..."}}
```

`status` is `converged | stopped | interrupted`; `reason` is
`converged | max_iterations | no_progress | interrupted`; `final` is the last
verify's `--json` object, or `null` if none completed.

## AMENDED 2026-08-15 — the staleness rider: what a loop was briefed with

*`WRINGER_RULING_2026-08-14` Phase 1's rider, sliced by Marc on 2026-08-15 into
**detection and refusal now, the stale-marking ledger event deferred**. The
ruling says the rider marks landed work stale *via a new ledger event*, and
`loop-event-v2.schema.json` is a closed `oneOf` of eight branches — so that
event costs `loop-event-v3`, and once v3 freezes, adding the witness pin to it
later is an edit to a frozen file. v3 is therefore designed **once**, carrying
both, when the witness lane's own future is decided. This half needs no event
at all: `wringer.loop.v2` froze `reason` as an OPEN string precisely so a new
stop reason never costs a bundle-format version.*

**The hole.** `deliver.py` wrote `spec_sha256` at three sites and compared it
at **none**, and `spec.authorising_sha256` hashes the spec *as it is now* — so
a delivery manifest said "authorised by spec S" where S was whatever sat on
disk at delivery time. `spec.py`'s own docstring named the gap.

**The capture.** Before the first worker turn, `wring run` writes
`briefed.json` (`wringer.briefed.v1`) into the loop bundle: the sha256 of
`wringer.spec.yaml`, `wringer.rubric.yaml` and `.wringer.yaml`, with `null`
for a document that was not there. A sibling file rather than a manifest key,
on the `digests.json` pattern, and written **before** `digests.json` so the
loop's own tamper-evidence covers it. **A resumed loop keeps its first
capture** — re-hashing on resume would quietly bless anything edited while the
loop was dead.

**The comparison, and it is deliberately asymmetric.**

| where | documents compared | what happens |
|---|---|---|
| **iteration boundary** | spec, rubric | the loop stops, `reason: authority_moved` |
| **`wring deliver`** | spec, rubric, **and `.wringer.yaml`** | `Refused`, exit 1, by name |

`.wringer.yaml` is left out of the boundary check on purpose. `verify` re-reads
it on **every lap**, so a change to it is observed and acted on rather than
silently assumed; the spec and the rubric are never re-read by the loop at all,
and that is the drift this rider is about. It is also what keeps `wring resume`
usable: `run.worker` lives in `.wringer.yaml`, and editing the worker between a
kill and a resume is a documented, tested workflow — comparing the config at
the boundary would stop every resumed loop for doing what the manual says.
Delivery compares all three, because delivery is where the combined claim
("authorised by spec S, verified by gates G") is actually made.

**Three rulings inherited verbatim from `deliver.py`, none of them negotiable.**
*Invalidate after landing* — the check runs at an iteration boundary, after a
worker's turn has completed. *Never abort in flight* — no worker is ever
killed for this; a turn that has run cannot be un-run. *Revert nothing* — the
work stays exactly where the worker left it, and the refusal's wording does not
suggest otherwise, because an agent reading "revert" in a refusal is an agent
about to undo work nobody asked it to undo.

**The compatibility boundary is the absence of the file.** A run no loop
produced records no brief, so the join finds nothing and the check compares
nothing — every `wring verify` run, and every loop bundle written before this
existed, delivers exactly as it did before. There is no flag to wave it
through: flags tighten, never loosen.

**Still open, and named rather than discovered later:** the ruling's
stale-MARKING event, which waits on `loop-event-v3`.

## Non-goals for this slice (binding)

LLM judge and rubrics · issue ingestion · branch, commit, push, PR or MR
creation of any kind · durable resume · cost ledger · OpenTelemetry ·
anti-thrash beyond the fingerprint above · parallelism · ACP · Temporal ·
`wring explain` for loops (the loop's `summary.md` serves) · Windows.

`wring run` **never writes to git.** It runs gates and a worker; committing
what came out is the human's decision, and delivery is a later slice.

## Definition of DONE for this slice

- [ ] `wring run` converges on a repo with a scripted worker that fixes a
      planted bug, exit 0
- [ ] stops with `max_iterations` when the worker never fixes it, exit 1
- [ ] stops with `no_progress` when the worker changes nothing, having run
      exactly one verify
- [ ] converges even when the worker exits non-zero, because the evidence
      decides
- [ ] a worker that overruns its timeout is killed and recorded, loop continues
- [ ] Ctrl-C exits 4 and leaves an honest loop bundle
- [ ] `--json` keys stable across every outcome
- [ ] secrets never reach `worker.stdout.log`
- [ ] loop bundle validates against `schema/loop-*.schema.json`, enforced by
      the suite the same dependency-free way the evidence schemas are
- [ ] docs carry a real captured transcript of a loop converging
