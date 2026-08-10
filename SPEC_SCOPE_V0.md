# SPEC — fleet scope (F4 at scale: a task owns its criteria)

*Drafted 2026-08-10 by the planning window from
`~/Claude/WRINGER_FLEET_DOSSIER.md` — every mechanical claim below was
measured that day, on this machine, with the reproduction script named beside
it in the dossier (`~/Claude/fleet-scout/`). Implementation is assigned to a
DIFFERENT window (`~/Claude/WRINGER_SCOPE_PLAN.md`), so the gategen failure
mode — a spec reviewed only by the window that then built to it — is
structurally avoided here; an independent read of THIS spec before build is
still recommended and the plan says where. Marc's delegation stands; rulings
DECIDED.*

[SPEC_SUPERVISION_V0.md](SPEC_SUPERVISION_V0.md),
[SPEC_ACCEPT_V0.md](SPEC_ACCEPT_V0.md),
[SPEC_GATEGEN_V0.md](SPEC_GATEGEN_V0.md) and
[SPEC_VACUITY_V0.md](SPEC_VACUITY_V0.md) bind and are unchanged.
`~/Claude/WRINGER_CITADEL_RULINGS.md` R2 binds and is the door this spec
walks through, carrying all three of its conditions.

## Positioning

> **A human declares which criteria each task proves. A fleet child then
> converges on its own criteria's gates — and nothing else changes what a
> green tick means, because a gate that did not run leaves no result, and
> absence already refuses.** The declaration is the human's, the vocabulary
> is the PM's criteria, and the guard is machinery that shipped months ago.

The measured problem (dossier §3a–3b): every fleet child runs the WHOLE
declared gate set, so a task cannot converge until every other task's work
exists in its tree. The shared tree survives this by an undocumented
mechanism — all but the last task fail their first pass, the retry queue
harvests the work they left behind — and the summary reports those expected
failures as failures. With scripted workers that is waste and noise. With
real agents it is worse than waste: the child's brief names the first failing
gate as the thing to fix, and mid-fleet that is routinely ANOTHER task's
gate, so the harness itself instructs agents to wander into each other's
work, in one shared tree, four at a time.

The one-sentence test this design is held to: **can the harness's own
scoping ever make a green tick claim more than it measured?** It cannot,
and not by policy but by construction: a scoped-out gate leaves no result,
acceptance reads absence as `gate-did-not-run`, and `wring deliver` already
refuses on it. The tick is guarded by the refusal machinery that already
exists, which is the only reason this door can be opened at all.

## 1. What it does

- **`.wringer.yaml` gains `fleet.scope`** — a mapping from task id to the
  criteria that task proves. Human-written, like every gate. When declared,
  `wring fleet` resolves each task's criteria through the shipped `proves:`
  bindings to a set of gates, and dispatches each child to converge on that
  set.
- **`wring run` gains a repeatable `--gate ID`.** The loop verifies only the
  named gates, converges when they are green, and briefs only on them. The
  fleet is the intended caller; a human at a terminal may also use it, and
  it makes the same narrower claim in both mouths. (Verify's own single
  `--gate ID` shipped in v0.1; this lifts the concept to the loop. Stated as
  a requirement, not a description — the flag does not exist today.)
- **Every scoped-out gate is recorded.** The run bundle's `summary.md`
  carries a "scoped out" section naming each gate not run and the scope that
  excluded it; the fleet bundle carries `scope.json`
  (`wringer.fleetscope.v1`, published + frozen same commit) with the resolved
  task→criteria→gates joins and the criteria no task claimed. Machine-
  readable at the fleet level, human-readable at the run level, absence at
  the result level — three records, one truth.
- **Unscoped fleets are untouched, byte for byte.** No `fleet.scope`, no new
  behavior. The retry-harvest mechanism they run on becomes documented
  (`docs/fleet-scale.md`) instead of folklore, and their summary gains one
  honest sentence: in a multi-task fleet, a failure may mean "blocked by a
  gate another task will build".

## 2. Rulings

1. **Scope is declared in `.wringer.yaml`, in the PM's vocabulary —
   DECIDED.** The map's values are CRITERIA ids, never gate ids: the human
   writes the same vocabulary the spec was approved in, and the gate is
   reached through the `proves:` binding they already installed. One join,
   declared twice nowhere. `fleet.scope` lives beside `fleet.deadline` in
   the only file that puts commands in Wringer's mouth (SPEC_GRAPH ruling 1),
   and it gets there the only way anything does: a person edits it.

2. **This is R2's door, opened as R2 ruled it must be — DECIDED.** All
   three conditions, named and met:
   - *"declared in `.wringer.yaml`, never model-inferred"* — ruling 1. No
     drafter proposes scope in v0 (non-goal 1: a model sorting criteria
     into task buckets is SPEC_ACCEPT's forbidden move one level up, and it
     needs its own ruling if it ever comes).
   - *"the bundle records what was not run and why"* — the summary section,
     `scope.json`, and the absence of result rows. A reader of any single
     artifact can see the run's claim is scoped.
   - *"health's treatment stays exactly as above"* — zero changes to
     `health.py`. A scoped-out gate is a gate that did not run: thinner
     history, `untested`/`zombie` pressure, never a free pass. That pressure
     is DESIRABLE here — a criterion whose owning task never runs decays
     visibly on the vitality table, which is the honest report.

3. **A scoped child's convergence claim is exactly its scope — DECIDED.**
   The loop converges when the scoped gates are green; its `converged` is a
   true statement about what it verified (the frozen loop-manifest reason
   enum is untouched — `converged` does not lie, because the bundle beside
   it says what was measured). The brief's "Fix this" section may only ever
   name a scoped gate, and the criteria list marks which criteria are this
   task's. The instruction pathology measured in the dossier — the harness
   telling an agent to fix another task's gate — becomes unrepresentable.

4. **What scoping deliberately does NOT prevent, stated rather than
   discovered — DECIDED.** Two agents in one shared tree can still collide
   on a file for their own legitimate reasons. Scoping fixes what the
   harness SAYS, not what an agent may DO; the fix for parallel write
   isolation is worktree publish-back, which collides with the
   commit-or-push non-goal (SPEC_SUPERVISION §non-goals) and is a future
   cycle with a law change to argue for. Until then: `concurrency: 1` is
   collision-free and still gets every benefit of scoping; the default
   stays 4 and the limit is printed in the docs beside the feature.

5. **The scope map is total, and every refusal names both sides —
   DECIDED.** If `fleet.scope` is declared, it must cover every task in the
   task file — a fleet where some children are scoped and some run the full
   set would make "succeeded" mean two different things in one summary
   table. Hard errors at `wring fleet` start, before any child spawns, each
   naming the file and the id: a task in the map that is not in the task
   file; a task in the task file missing from the map; an unknown criterion;
   a criterion bound to no gate; a `human: true` criterion (nothing to run —
   the category error `config.check_bindings` already refuses one join
   away); a criterion claimed by two tasks (one criterion, one owner — the
   `proposals()` collision refusal is the precedent and the message shape);
   a task whose criteria resolve to zero gates (its loop would have nothing
   to converge on: bind a gate, or run it outside the scoped fleet). A bound
   criterion claimed by NO task is legal and loud — it lands in
   `scope.json`'s unclaimed list, its gate goes red in the final verify if
   nobody built it, and acceptance refuses delivery exactly as today.

6. **One fleet, one branch, one MR — DECIDED.** Delivery's record is
   acceptance against the WHOLE spec on one tree; splitting branches would
   split the record's meaning, and the bundle that justifies delivery is
   tree-wide by construction. Per-task delivery needs per-task trees, which
   is the publish-back cycle, not this one. The dossier measured the
   one-branch path working end to end (`fleet_deliver.sh`).

7. **The fleet neither verifies nor delivers — DECIDED.** The sequence is
   `wring fleet` → `wring verify` → `wring deliver`, run by the operator (or
   composed by a graph, later — not specified here). The supervisor
   supervises and the evidence compiler compiles; a fleet that ran its own
   final verify would be one flag away from delivering, and the measured
   flow needs no such collapse. The final full verify is also where
   cross-task breakage surfaces: a task that broke another's gate after that
   child converged is caught there, delivery refuses on the record, and the
   refusal names the gate. There is no machinery to route that back into a
   fleet (no fleet resume — banked), and that is a stated limit, not a bug.

8. **Worktree teardown stops destroying the evidence its own summary cites —
   DECIDED.** Before `git worktree remove --force`, the child's loop
   directories are copied into the fleet bundle. The summary's existing
   sentence — "parked work kept its evidence… in the child loop
   directories" — becomes true instead of being the guard-that-lies the
   dossier measured (§3d). Worktree mode itself remains: it is honest for
   tasks with disjoint directories, and structurally unable to compose
   multi-task work in one tree (measured, §3c) — the docs say so beside the
   knob, and this spec does not refuse the combination, because a refusal
   would claim to know the tasks' goals, which the harness cannot.

## 3. Non-goals (binding)

The drafter proposing scope (a model sorting criteria into buckets — its own
cycle, if ever) · per-task branches or MRs · worktree publish-back, or any
commit/push by the fleet · fleet resume · the fleet running verify or
deliver itself · gate ids as scope vocabulary · any change to unscoped
`wring verify`'s stop-at-first-required-failure · any change to `health.py`
· F5 multi-repo · F6 env≠repair · distributed fleets · Windows.

## 4. Definition of DONE

- [ ] `wring run --gate ID` (repeatable): the loop verifies only the named
      gates, converges when they are green, and the brief's "Fix this" never
      names an unscoped gate — pinned by a test that declares two gates,
      scopes to one, makes the OTHER fail, and asserts the brief and the
      convergence both ignore it
- [ ] the scoped run bundle's `summary.md` carries the scoped-out section
      naming each excluded gate and the scope that excluded it, pinned by
      content; scoped-out gates leave NO result rows (absence, as post-
      failure skips do today)
- [ ] a scoped child bundle can never evidence an unscoped criterion:
      a test binds criterion X to a gate, scopes the child away from it, and
      asserts acceptance reads `gate-did-not-run` with `refuses` true — the
      shipped guard, pinned against scope by name
- [ ] `fleet.scope` parsing and the seven refusals of ruling 5, each with a
      test that reddens without it, each naming both sides in its message
- [ ] `scope.json` (`wringer.fleetscope.v1`) in the fleet bundle: resolved
      joins plus unclaimed criteria; schema published + frozen same commit
      (the derived freeze guards already redden if either half is missed)
- [ ] worktree teardown preserves child loop directories into the fleet
      bundle BEFORE removal; a test deletes the preservation step's effect
      and the summary's evidence claim reddens
- [ ] unscoped multi-task fleets: the summary's failure vocabulary gains the
      blocked-by-another-task sentence, and `docs/fleet-scale.md` documents
      the retry-harvest mechanism with the dossier's measured numbers
- [ ] end to end through real processes, captured through the recorder into
      `docs/fleet-scale.md`: a multi-task approved spec → gates installed
      through the human diff → `wring fleet` with scope, each child red on
      its OWN gates first then green → final `wring verify` green →
      `acceptance.json` reads `evidenced` citing the children's red bundles
      → `wring deliver` succeeds. The probe string is `reached
      \`wring deliver\``, the same string F4 probes, on purpose
- [ ] the roadmap gains the at-scale node probed on this spec AND
      `docs/fleet-scale.md` with the `contains` probe above — added in the
      capture slice, so it is born meaning something, red until then

## 5. The factory question, answered in advance

This cycle makes Wringer better at BUILDING. It takes the path a real
multi-task spec must travel — many agents, one tree, one delivery — and
removes the harness-inflicted waste (children burning iterations on gates
they cannot fix) and the harness-inflicted interference (briefs instructing
agents into each other's work), while the claim-side machinery is not
loosened anywhere: nothing new passes, nothing green means more than it did,
and the one place scoping touches evidence is guarded by a refusal that
shipped in the acceptance cycle. The DONE box that matters is the last one:
the chain, at scale, reaching `wring deliver` on the record.
