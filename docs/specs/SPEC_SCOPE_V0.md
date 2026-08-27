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

**Reviewed 2026-08-10 by R0, a window that did not draft this spec and will
not build it — the independent pass gategen never got, run BEFORE S2 freezes
a schema, because frozen things never move in this repo.** Eleven findings
are folded in below, two HIGH; none needs a redesign, so S1 and S2 may proceed
AMENDED — ruling 5 gains an eighth refusal and DONE boxes 5 and 8 change. The
drafting window's five confessed assumptions were each settled by running
code rather than reading it, and the two that could have broken the cycle
did not: a partial-gate-set bundle DOES arm an acceptance receipt (measured),
and post-failure skipped gates DO leave no result rows (measured). What the
review found instead is that the guard those assumptions rest on is armed by
spec APPROVAL rather than by binding, and that the chain's last DONE box
assumes one gate per task. §6 lists what was checked and held, by name, so
that an absent finding and an unchecked area cannot read the same.

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
- **Unscoped fleets keep their OUTCOMES exactly.** Same children, same whole
  gate set, same `{succeeded, failed, parked}` verdicts, no new behavior when
  no `fleet.scope` is declared. The retry-harvest mechanism they run on
  becomes documented (`docs/fleet-scale.md`) instead of folklore, and their
  summary gains one honest sentence: in a multi-task fleet, a failure may
  mean "blocked by a gate another task will build".

  **Review finding 6 (MEDIUM), folded — this bullet said "byte for byte" and
  then, in its own last clause, changed the bytes.** Two honesty fixes land
  on unscoped fleets by design: the summary sentence above, and ruling 8's
  teardown preservation, which changes what an unscoped `worktree: true`
  fleet leaves on disk. The invariant worth defending was never byte
  identity — it is that no unscoped fleet's OUTCOME moves, and that is what
  the slice must pin. The build plan's S2 rule, *"run the existing fleet
  tests untouched — if any needs editing, the change is wrong, not the
  test"*, is right for S1–S2 and wrong for S3, which changes the summary on
  purpose; no shipped test pins that summary's text today, so the rule costs
  nothing to correct and would otherwise have argued a window out of the
  honesty fix it was sent to make.

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

   **Review finding 1 (HIGH), folded — the guard is armed by APPROVAL, not
   by binding, and this spec claimed it unconditionally.** The structural
   argument above and in Positioning — *"absence already refuses"* — is
   `deliver._check_acceptance` reading `acceptance.json`, and
   `accept.assess` returns None unless `accept.read_spec` finds
   `approved: true` (SPEC_ACCEPT ruling 8). No approval, no artifact, and
   nothing to refuse on. Measured, on shipped code, with `wring verify
   --gate` standing in for a scoped run: with `approved: false` the bundle
   carried NO `acceptance.json` and `wring deliver` proceeded to *"Would
   create branch"* on a bundle in which one of the two required gates had
   never run; flipping the same repo to `approved: true` and re-running
   produced the refusal the spec describes, naming `cb — GATE-DID-NOT-RUN`.
   The route in is open: `config._check_bindings` resolves criteria through
   `spec_module.load(spec_path).criteria` and **never consults `approved`**,
   so `proves:` bindings — and a `fleet.scope` map validated by the same
   precedent this spec names in ruling 5 — are legal against a spec no human
   has approved. **Ruled: `fleet.scope` requires an APPROVED
   `wringer.spec.yaml`, and its absence is the eighth refusal of ruling 5.**
   Without it the tick is guarded by nothing but the operator remembering
   ruling 7's final verify, and this spec would be asserting a guarantee the
   code does not give — the gategen failure class, one cycle later.

   **Review finding 7 (MEDIUM), folded — "decays visibly" is right for a
   gate that sometimes runs and wrong for one that never does.** The wording
   is inherited from R2 verbatim and it is worth correcting where it lands.
   `health.assess` iterates the pairs `history(coverage)` builds out of
   RECORDED gate runs; a declared gate with zero runs anywhere in the window
   produces no `Assessment` at all, so it is ABSENT from the vitality table
   rather than decaying on it. `untested`/`zombie` pressure is real for
   every gate that still runs somewhere — which, under ruling 7's sequence,
   is every gate, because the operator's final verify is unscoped. The
   pressure claim therefore holds for the flow this spec specifies, and the
   invisible case is reachable only by skipping that final verify. Health is
   still untouched, so R2's third condition is met either way; it is the
   description of what that treatment yields that needed the correction.

3. **A scoped child's convergence claim is exactly its scope — DECIDED.**
   The loop converges when the scoped gates are green; its `converged` is a
   true statement about what it verified (the frozen loop-manifest reason
   enum is untouched — `converged` does not lie, because the bundle beside
   it says what was measured). The brief's "Fix this" section may only ever
   name a scoped gate, and the criteria list marks which criteria are this
   task's. The instruction pathology measured in the dossier — the harness
   telling an agent to fix another task's gate — becomes unrepresentable.

   **Review finding 8 (MEDIUM), folded — "a reader of any single artifact"
   is false for two of them, and one can never be fixed.** `acceptance.json`
   records `gate-did-not-run` with the reason *"`X` left no result in this
   run, so this run says nothing about the criterion"* — true, and silent
   about scope being the cause. The loop bundle's manifest is worse and
   permanent: `wringer.loop.v1` is FROZEN and its recorded fields are
   `repo`, `config: {max_iterations, worker}` and
   `result: {status, reason, iterations, final_run}` — no gate list, no room
   for one, ever. A machine reading a scoped child's loop manifest sees
   `converged` unqualified. **Ruled: the claim is narrowed to name the
   artifacts that carry it — the run bundle's `summary.md` scoped-out
   section, `scope.json`, and the absent result rows — and the loop
   manifest's qualification is reachable in exactly one hop, through
   `final_run` to the run bundle that says what it measured.** `converged`
   still does not lie; a reader who stops at the manifest simply has not
   read far enough, and the spec now says where to go rather than implying
   every artifact answers on its own.

   **Review finding 9 (MEDIUM), folded — `run.prove` on a scoped run is not
   out of scope; it composes, and it scopes the verdict too.**
   `vacuity.prove(root, cfg, planned, results, …)` iterates `planned` and
   skips any gate with no changed-tree result, so a scoped run proves
   exactly its scoped gates and needs no new machinery — assumption (d) is
   answered, and the answer is that the interaction is real rather than
   absent. Two consequences, stated rather than discovered: the
   `gates_vacuous` reason is written as *"every required gate passed without
   the change too"*, which in a scoped bundle is a claim about the scoped
   subset and must read that way; and `deliver._check_vacuity` refuses on
   any bundle recording `gates_vacuous`, so a scoped child's verdict can
   refuse a delivery that names it. That direction is safe — it fails
   closed — and it is another reason ruling 7's final unscoped verify is the
   run a delivery should be pointed at. See also SPEC_GATEGEN review finding
   7: a `sensitive` row is a receipt, so `--prove` is a second path to
   `evidenced` that does not pass through a red run at all.

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

   **Review finding 1 (HIGH) adds the EIGHTH refusal — `fleet.scope`
   declared against a spec that is not `approved: true`.** Reasoning above
   under ruling 2; the message names the file and the flag, and the remedy
   is that a person approves the spec. It is a refusal rather than a warning
   because a scoped fleet in an unapproved repo writes no acceptance
   artifact at all, and every other refusal here exists to stop a summary
   table meaning two things at once — this one stops the whole cycle's
   guarantee meaning nothing at all.

   **Review finding 2 (MEDIUM), folded — refusal seven is unreachable
   except in one case, and its remedy is wrong for that case.** *"A task
   whose criteria resolve to zero gates"* can only fire when refusal four
   (*"a criterion bound to no gate"*) did not, and refusal four fires on
   every unbound criterion in the map — so the only surviving path to
   refusal seven is a task mapped to an EMPTY criteria list, for which
   *"bind a gate, or run it outside the scoped fleet"* is advice about a
   problem the human does not have. **Ruled: the empty list is named as its
   own case with its own remedy — give the task a criterion, or drop it
   from the map and from the task file — and the two refusals are ordered so
   the message a reader gets names the defect they actually made.**

   **Review finding 3 (LOW), folded.** A criterion listed twice inside ONE
   task's list is not among the refusals, and the collision refusal covers
   only two different tasks. Harmless to the resolution — a set absorbs it —
   and refused anyway, because every other duplicate in this repo is loud
   and a silent one here would be the exception a reader has to learn.

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

   **Review finding 4 (MEDIUM), folded — a worktree child's evidence cannot
   arm anything, so "honest for tasks with disjoint directories" is true
   about the WORK and false about the RECORD.** `health.Bundle.qualifying`
   is `kind == "run" and not bench_sourced`, and `bench_sourced` is decided
   by POSITION: any bundle whose path contains `.wringer/worktrees/` —
   which is `fleet.WORKTREES_DIRNAME`, the directory `fleet.make_worktree`
   puts every child in. `accept._discriminating_pairs` skips non-qualifying
   bundles outright. Measured: a red run then a green run inside
   `.wringer/worktrees/t1` left the criterion `unevidenced`, both bundles
   reading `bench_sourced=True qualifying=False`. So a scoped worktree fleet
   cannot reach delivery even for perfectly disjoint tasks — its children's
   red runs are invisible to the receipt economy this cycle is built on, and
   the docs beside the knob must say that, not only that composition fails.
   (This also refutes the dossier's §3e parenthetical, which recorded a
   worktree child earning a local receipt. It does not, and this spec relies
   on nothing that did.)

   **Review finding 5 (MEDIUM), folded — the preservation step must not
   LAUNDER the evidence it preserves.** Copying the child loop directories
   out of `.wringer/worktrees/…` into the fleet bundle moves them out from
   under the very marker that disqualifies them: a copy under
   `.wringer/fleets/` reads `bench_sourced=False`. Nothing reads it today —
   `health.search_roots` covers `runs`, `loops`, `benches`, `worktrees` and
   `.wringer.example`, and not `fleets` — so acceptance is unaffected on
   every default path; but `wring health --from <fleet bundle>` is one
   operator command away from turning deliberately-excluded runs into
   receipt-arming ones. **Ruled: the preserved copies are for a human to
   read, they are never a discovery root, and the slice pins that
   `.wringer/fleets` is absent from `health.search_roots` so a later hand
   cannot add it without reddening.** Preserving evidence is worth doing;
   promoting it while preserving it is the guard-that-lies wearing the
   opposite coat.

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
      shipped guard, pinned against scope by name. **Review: this box pins
      behavior that already ships** — driven through `wring verify --gate`,
      which writes the same partial-bundle shape, the un-run criterion read
      `gate-did-not-run refuses=True` and `wring deliver` refused, naming it.
      The box stays: it is what stops a later slice loosening the guard once
      scope has a reason to want it loosened
- [ ] **`fleet.scope` against an unapproved spec is refused** (ruling 5's
      eighth refusal, review finding 1): a test declares scope in a repo
      whose `wringer.spec.yaml` is `approved: false` and asserts `wring
      fleet` stops before any child spawns, naming the file. Without it the
      whole absence-guards-the-tick argument is conditional on a fact
      nothing checks
- [ ] `fleet.scope` parsing and the seven refusals of ruling 5, each with a
      test that reddens without it, each naming both sides in its message
- [ ] `scope.json` (`wringer.fleetscope.v1`) in the fleet bundle: resolved
      joins plus unclaimed criteria, **plus the whole declared gate set as
      the run saw it, so each task's EXCLUDED gates are computable from this
      file alone** — **Review finding 10 (LOW), folded:** as first
      described, a reader had to fetch `.wringer.yaml` at that commit to
      learn what a child did not run, and `wringer.fleetscope.v1` can never
      grow a field afterwards, which is the whole reason this review was
      sequenced before the freeze; schema published + frozen same commit
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
      \`wring deliver\``, the same string F4 probes, on purpose.
      **At least one task in that capture MUST own two or more gates**
      (review finding 11, HIGH, below), and if the chain stops there, the
      node stays red and the doc says where — that result is worth more than
      a green capture of the easy shape
- [ ] the roadmap gains the at-scale node probed on this spec AND
      `docs/fleet-scale.md` with the `contains` probe above — added in the
      capture slice, so it is born meaning something, red until then

**Review finding 11 (HIGH), folded — DONE box 8's chain assumes one gate per
task, and scoping does not change that.** `verify.run` stops at the first
required failure, and this spec's own non-goals keep that behavior. So a
scoped child whose task owns two gates arms them ONE PER RED ITERATION, and
only if its worker fixes them one at a time. Measured on shipped code: two
required gates both red, one verify recorded a result row for the first only;
a worker that then satisfied the WHOLE task in one call left the second gate
green having never been red — `unevidenced`, `refuses: true`, delivery
refused, with the summary's born-green warning firing correctly beside it.
Nothing here is unsafe: the guard does its job and the tick does not inflate.

**AMENDED 2026-08-27.** The measurement above stands as the record of what
shipped then. It no longer describes the engine: a gate carrying `proves:` is
no longer skipped by another gate's failure (SPEC_VERIFY rule 2, amended the
same day, after field report 2026-08-27 finding 1), so a scoped child whose task
owns two bound gates arms BOTH on one red iteration. The finding's conclusion
— that the tick does not inflate — is unaffected either way.
What breaks is the cycle's headline deliverable, because a capture built from
one-gate tasks would go green while demonstrating strictly less than the box
claims — a check that narrowed while still passing, which is the defect class
this program exists to catch. **Ruled: the capture carries a multi-gate task
or it does not count, and the limit is documented beside the feature** — a
real agent handed a scoped brief is MORE likely to satisfy its whole task in
one call, not less, because scoping is what finally tells it what its whole
task is. The underlying "one `wring verify` arms one gate" finding is
F4's, already recorded in `~/Claude/WRINGER_FACTORY.md` and unfixed; this
spec does not fix it and now says so instead of inheriting it silently.

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

**Review, on that paragraph:** it survives, with one word conceded. *"The one
place scoping touches evidence is guarded by a refusal that shipped in the
acceptance cycle"* is true **in a repo whose spec a human approved** — that
is finding 1, and the eighth refusal is what makes the sentence
unconditional again rather than merely usually right.

## 6. What this review checked and found SOUND

Named, because an area nobody looked at and an area that held must not read
the same. Every line below was settled by running the shipped code, not by
reading it hopefully.

- **Scoped child bundles DO qualify for acceptance receipts — the drafting
  window's assumption (a), the one that could have broken the cycle.**
  `Bundle.qualifying` is `kind == "run" and not bench_sourced`; gate-set
  completeness is not part of it and no reader downstream re-imposes it.
  Measured end to end: a bundle in which ONE of three gates ran, red, later
  armed that gate's criterion to `evidenced` in a full green run, the receipt
  citing the partial bundle by path. DONE box 8's chain is intact.
- **Post-failure skipped gates leave no result rows — assumption (c).**
  Measured: with the second gate failing, the third left no directory under
  `gates/` at all and read `gate-did-not-run`. Absence is already the record;
  scoping needs no new mechanism to produce it.
- **The loop CAN verify a subset cleanly — assumption (b).** `loop.run`
  calls `verify.plan(cfg, None)` once and hands the result to `verify.run`,
  which iterates exactly that list; `plan` already narrows to one gate and
  raises `ConfigError` on an unknown id. A repeatable `--gate` is one
  signature widened at one seam, not a second verification path — and
  `skipped` falls out correctly, because a gate removed from `planned` is
  never a post-failure skip either.
- **The brief renderer CAN know the scope — assumption (e).**
  `loop._criteria_lines` already computes `{gate.proves: gate.id}` from the
  config, so "this task's criteria" is the criteria whose bound gate is in
  the scoped set — the ruling-1 join read backwards, needing no new
  vocabulary. The scoped ids reach it the same way `WRINGER_TASK_ID` already
  reaches `loop._task`. Ruling 3's marking is implementable as ruled.
- **Absence guards the tick even when the operator is sloppy.** Attacked
  adversarially: `wring deliver` defaults to `evidence.latest_run`, which
  after a scoped fleet is a CHILD's scoped bundle — so the tempting shortcut
  of delivering straight from the fleet without ruling 7's final verify is
  refused, by name, on the other tasks' criteria. Measured. The failure mode
  is a refusal, which is the direction this repo wants to fail in.
- **R2's three conditions are genuinely met**, with finding 1's precondition
  attached to the second and finding 7's correction to the third's wording.
  Condition one is met outright: scope is human-written in `.wringer.yaml`
  and non-goal 1 keeps a model out of it.
- **The seven refusals of ruling 5 contain no CONTRADICTION** — findings 2
  and 3 are a redundancy and an omission, not a conflict, and no two of them
  can fire on the same well-formed document with opposite advice.
- **Ruling 6 (one fleet, one branch, one MR) and ruling 7 (the fleet neither
  verifies nor delivers) were re-read against the code and stand.** `wring
  fleet` has no `--send` and no delivery step; delivery reads one bundle and
  one tree, so splitting branches really would split the record's meaning.
