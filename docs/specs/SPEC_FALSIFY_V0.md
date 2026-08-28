# SPEC_FALSIFY_V0 — mechanical falsification

*Binding. Written 2026-08-28. **v0 is MODEL-FREE**: no LLM, no network, no
rival agent. The rival-agent attack is a later field run and is out of scope
here by ruling, not by omission.*

**The question.** Every green in this program was red first — but red-first is
a claim about ONE failure that was recorded. It says nothing about whether the
check would notice a DIFFERENT way of breaking the same code. A check bound to
a requirement, watched failing once, and passing now, can still be blind to
almost everything the change does.

So: break the change on purpose, mechanically, and see whether the checks
notice.

---

## §1 The vocabulary, and every word of it is a limit

**An ATTEMPT** is a bounded, deterministic, mechanical mutation of ONE line
that the delivered diff itself touched. Not a rewrite, not a generated edit,
not a model's idea of a plausible bug — a substitution from a fixed table,
applied to a line the change is responsible for.

**A SURVIVOR** is a mutant that every bound gate still passes.

**Ruling 1 — a survivor is a finding about the CHECKS, never a verdict on the
work.** It says: *these checks could not tell the difference between the code
as delivered and the code with this line broken.* It does not say the change
is wrong, that the requirement is unmet, or that anybody did anything badly.
Every surface that renders a survivor says so in its own sentence, and no
surface may phrase one as a defect in the change.

**Ruling 2 — the claim ceiling, and it is the whole of what this buys.**
Surviving mechanical mutation is **necessary and demonstrably not sufficient**.
The mutations come from a fixed table; a check that catches all of them can
still miss everything that table does not contain, and the table contains
almost nothing compared to the ways real code goes wrong. A run where every
attempt was caught proves that these particular breakages are noticed. It
proves nothing else, and it must never be rendered as a quality score.

**Ruling 3 — v0 REFUSES NOTHING.** No exit code changes, no acceptance row
moves, no delivery is held. This is a hint tier in the same sense
`wringer.diagnosis.v1` is, and for the same reason: the measurement is new,
its false-negative rate is unmeasured, and this project does not add a refusal
before somebody has been hurt by the absence of one. Whether a survivor should
ever refuse a delivery is a named future ruling that wants this v0's field
evidence first.

---

## §2 The budget, and why each bound is there

The measurement runs a full gate suite per mutant. Unbounded, that is a
machine tied up for an afternoon, so every bound is declared rather than
discovered:

- **Only files the delivered diff touched.** Mutating a file the change never
  went near would produce a finding about a check's coverage of somebody
  else's code, which is a real thing and is not this measurement.
- **Only lines that diff ADDED or CHANGED.** The change is not answerable for
  a line it did not write.
- **A ceiling on attempts**, declared in config with a default. Reached, it is
  SAID — a silent truncation reads as "we tried everything".
- **A wall-clock ceiling.** Same rule: reaching it is reported, not hidden.
- **Deterministic.** The mutation table is ordered, the file walk is sorted,
  and nothing samples randomly. Two runs of the same commit attempt the same
  mutations in the same order, or a survivor is not a fact anybody can go and
  reproduce.

---

## §3 The control run, without which the whole measurement is a lie

Before any mutation, the bound gates run **unmutated in the scratch copy**.

A scratch copy is a detached git worktree, which carries **tracked files and
nothing else** — no `.venv`, no `node_modules`, no gitignored build output. In
a repository whose dependencies are gitignored, every gate fails there for
that reason, and every mutant would then be recorded as CAUGHT. That is a
perfect score produced by a broken environment, and it is the same trap
`run.prove_setup` exists to close one layer down for `--prove`.

**Ruling 4 — a failing control makes the run INCONCLUSIVE, never a pass.**
Nothing is attempted, no number is reported, and the record says why in the
engine's own words. An unmeasurable run says so; it does not score zero and it
does not score full marks.

---

## §4 Where it lives

**Ruling 5 — `wring verify --falsify`. No new verb.**

Measured against the two candidates the carrier named:

- **`attest`** assembles a provenance claim out of bundles and runs nothing.
  Falsification runs a gate suite dozens of times. Wrong shape entirely.
- **`verify`** already runs the declared gates, already builds a scratch
  worktree, already writes sibling records, and already has the exact
  precedent: `--prove` runs the gates against a DIFFERENT tree and compares.
  `--falsify` runs them against mutated trees and compares. Same machinery,
  same bundle, same flag shape, same claim-ceiling discipline.

The core is at its nineteen-command ceiling, and a new verb for the third
variation of "run the gates against another tree" would spend it on a synonym.

**Ruling 6 — never the person's tree.** Every mutant is written into the
scratch worktree and nowhere else. The working tree is not touched, not
stashed, not reverted, and not read from after the diff is taken.

---

## §5 The record

`falsification.json` — `wringer.falsification.v1`, a NEW sibling file. No
published schema moves.

It records attempts, caught, survived, and every survivor with the file, the
line, the mutation applied, and the gates that stayed green. Absent when the
flag was not typed, which is the same absence rule every other sibling here
keeps: a run with no record is not a run that scored zero.

**Ruling 7 — a survivor is named with its mutant.** "3 survived" sends a
reader nowhere. The file, the line, what it was, what it became, and which
checks did not notice — that is a thing an engineer can act on in one reading.

---

## §6 The certificate line

The certificate's face renders it, from the sibling record:

> **K mutations of this change were attempted; all K went red.**

or

> **M of K mutations survived: these checks could not tell the difference.**

each survivor named with its mutant and the gates that stayed green.

**The certificate's own record does not grow a key for it.** `wringer.certificate.v1`
is frozen at what version 1 earned; the falsification record travels beside it
as a sibling and the face renders it — exactly as the coverage record does.

---

## §7 Acceptance

- **Two fixtures, watched from both sides.** A mutant that MUST survive — a
  line no gate covers — and one that MUST be caught. Each half of the fix is
  reverted and the corresponding side is watched going the wrong way. A
  falsification lane that reported everything caught, or everything survived,
  would be green against a fixture that only checked one direction.
- The control run's failure produces INCONCLUSIVE and no number.
- Determinism: two runs of one commit produce the same attempts in the same
  order.
- The person's tree is unchanged after a run, byte for byte.
- No exit code, acceptance row, verdict or delivery outcome differs between a
  run with the flag and a run without it.
- Every surface rendering a survivor carries ruling 1's sentence and ruling
  2's ceiling.

## §8 Out of scope, deliberately

- **The rival agent.** A model attacking the claim is a field run, not this.
- **Any refusal** (ruling 3).
- **A mutation score as a quality metric.** Ruling 2 forbids reading it as
  one, and nothing renders it as a percentage.
