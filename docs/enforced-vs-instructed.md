# Enforced, not instructed

*The longer form of the sentence in the README's top fold. Written 2026-08-22,
after a teardown of OpenAI's Codex found Wringer's own thesis already written
down — as a prompt.*

## The claim, in one line

Every agent harness now tells its model to verify its own work before declaring
victory. Wringer records the check **red before the work** and green after, and
refuses the handover when that transition is absent. An instruction is a hope.
A recorded transition is evidence.

## Why the distinction is not rhetorical

`openai/codex` at `343074d` ships
`prompts/templates/goals/continuation.md`, whose "Completion audit" section
reads, in part:

> Before deciding that the goal is achieved, treat completion as unproven and
> verify it against the actual current state […] The audit must prove
> completion, not merely fail to find obvious remaining work.

That is a good paragraph. It is also **instructions to a model that then grades
itself**: in that harness, "done" is the model calling
`update_goal(status="complete")`, with nothing in the tree checking that any
command ran or that any check changed state. Goals are bounded by token budget,
not by evidence. 112 crates, and none named for verification, evidence,
acceptance, or attestation of work.

So the problem is real enough that the most-watched harness on earth writes a
paragraph about it, and prompting is what it has. **The gap is not awareness.
It is enforcement.**

## What "enforced" means here, concretely

Three mechanisms, none of which is a prompt:

1. **Red before the work, recorded.** A criterion is `evidenced` only when the
   bound gate passes NOW **and** the record shows the same gate failing on a
   run that pre-dates the change. A gate that has only ever been green has
   never told satisfied from unsatisfied, and Wringer says so by name rather
   than counting it.
2. **A refusal, not a warning.** `wring deliver` stops when the transition is
   missing. There is no flag that answers it and no config key that turns it
   off — the interlock only tightens.
3. **A record a stranger can re-check offline.** `digests.json` is sealed over
   every bundle, every ledger event carries the previous line's hash, and
   `wring audit` names the changed file and the broken link. It is
   tamper-**evident**, not tamper-proof: an edit is DETECTED, not prevented
   (see [SECURITY.md](../SECURITY.md)).

The words that appear nowhere in a competitor's tree are **red-BEFORE**. That
is the load-bearing one, and it is the one a prompt cannot supply, because it
is a fact about a run that already happened.

## What this page does NOT claim

- Not that instructing a model is worthless. It raises the floor, and
  continuation.md is a better prompt than most.
- Not that Wringer's checks are good checks. A gate passing says the gate
  passed; it does not say the criterion is met in every case the criterion
  could describe. That limit ships inside every acceptance record.
- Not that a recorded transition proves the fix is the RIGHT fix. A witness
  proves the stated criterion could fail and was made to pass. It certifies no
  agreement with an unstated intended fix, and nothing on any Wringer surface
  may say otherwise.
- Not that any of this constrains the agent. Wringer does not sandbox your
  worker; it runs with the access you have.

## The other half of the sentence

Enforcement is only adoptable if it costs nothing to try, which is why the top
fold pairs it with the structural fact: **any coding agent you can start from a
terminal, any model behind an OpenAI-compatible endpoint.** Nobody has to
switch tools to find out whether their greens are honest.
[docs/vendors.md](vendors.md) is the measured receipt for that half, per vendor,
per lane.

Provenance: `~/Claude/WRINGER_CODEX_DOSSIER_2026-08-22.md`, scouted against
`github.com/openai/codex` at `343074d` on 2026-08-22. The dossier decides
nothing; this page states a positioning claim and names its limits.
