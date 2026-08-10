# SPEC — environment stops (F6: route on facts, hint on text, claim on neither)

*Drafted 2026-08-10 by the planning window from `WRINGER_FACTORY.md` F6 and
the F6 dossier (`~/Claude/WRINGER_F6_DOSSIER.md`, measured on this machine
that day; reproduction scripts in `~/Claude/f6-scout/`). Every ruling below
is DECIDED; the reasoning is inline so the build window has no approval
pauses. **Reviewed adversarially by the window that drafted it, against the
corpus and the shipped code — four findings folded below as D1–D4 — and NOT
yet reviewed independently. That debt is named here per the gategen
precedent, and the build plan charters it before any slice lands.**
[SPEC_RUN_V0.md](SPEC_RUN_V0.md),
[SPEC_SUPERVISION_V0.md](SPEC_SUPERVISION_V0.md) (its invariants bind; its
reason vocabulary grows here by the lawful post-release route),
[SPEC_VACUITY_V0.md](SPEC_VACUITY_V0.md) §4b,
[SPEC_GATEGEN_V0.md](SPEC_GATEGEN_V0.md) ruling 4 and
[SPEC_SCOPE_V0.md](SPEC_SCOPE_V0.md) bind and are unchanged.*

## Positioning

> **When a gate fails because the environment is broken rather than because
> the code is wrong, the loop stops briefing workers to repair it — but only
> where the brokenness is a fact the shell reported, never where it is a
> guess read out of stderr.**

The one-sentence test: **no stop may ever fire on a failure a worker could
have caused or could repair.** If a design would stop such a loop, the
design is wrong — a false stop refuses the exact repair the loop exists to
deliver, and that is the expensive direction (ruling 5).

The motto the whole spec compresses to: **route on facts, hint on text,
claim on neither.**

What F6 measured (dossier §3a, reproduced unchanged on `main` 962894d): a
fresh repo whose first gate dies on a missing dependency gets a worker
briefed to repair it — a condition no tree edit can affect — and the loop
then files `no_progress`, blaming the worker. In a fleet, every child does
this first. The classifier that already understands the failure ships today
in `cli._diagnose_failure` (cli.py:1068) behind exactly one door,
`wring start`. This cycle decides what that knowledge may DO — it does not
build a classifier.

## 1. What it does

- **The loop gains a stop tier built on a shell fact.** A verify that fails
  before any worker has ever acted in this loop's life, with exit 127 on a
  PATH-resolved command, stops the loop immediately — reason `environment`,
  no worker briefed, one iteration spent.
- **Everything else gains a hint, and only a hint.** Where the failing
  gate's output matches a face the shipped classifier knows, the diagnosis
  becomes VISIBLE — in the worker's brief, on the console, and in the
  record — always labeled as a guess, never routing anything.
- **The record spends `wringer.loop.v2`** — the lawful route through the
  frozen-schema regime — so a stopped loop finally has a true thing to say,
  and every stop that ships a diagnosis shows its working.
- **Under `wring fleet`, an environment stop parks immediately**, spending
  no retry: a retry re-runs the same command in the same environment.
- **The capture films the chain meeting a missing dependency** — the first
  capture in this corpus to do so. Every prior capture selected gates that
  could not hit one (`docs/gategen.md` runs `python3 g_hdr.py`;
  SPEC_SCOPE's S4 mandates stdlib-only gates by name). Green-by-scenario-
  selection is the defect class this program exists to catch, and this box
  is what closes it.

## 2. Rulings

1. **A classification may ROUTE, and may never CLAIM — DECIDED.**
   SPEC_VACUITY §4b governs a verdict: whether a pre-change failure counts
   as proof about a gate. Its words — "do not try to auto-classify the
   failure — make it visible" — protect what the record ASSERTS. Stopping,
   parking, and briefing change what happens NEXT, and the product already
   ships this exact classification as a console hint without anyone reading
   §4b as forbidding it. The repo has also already ruled the adjacent
   question once: `health.genuine_failure` excludes exit 127 from deciding a
   verdict — "nothing ran, so nothing discriminated" — which is a claim-side
   exclusion this spec now mirrors on the routing side.

   The boundary, stated so it cannot drift: everything this spec adds lives
   in routing records — the loop result and its `diagnosis`, a fleet park's
   `why`, brief text, console text. None of it may enter or influence a
   verdict: not acceptance's receipts, not vacuity, not health. Health's own
   127 discount stays derived from the exit code it reads itself, never from
   this cycle's records. §4b is untouched.

2. **Stop AND brief better, tiered by witness — DECIDED.**

   **The stop tier is a fact, and it is deliberately small.** The loop stops
   with reason `environment`, briefing no worker, exactly when ALL of:
   - no worker has acted in this loop's whole life (`already == 0` and this
     is the first verify — a resumed life re-observes a tree a worker may
     have touched, so it never qualifies);
   - the failing gate's exit code is `COMMAND_NOT_FOUND` (127);
   - the failing gate's first command word (first non-assignment token of
     the `run` string) contains no `/`, i.e. it was PATH-resolved.

   Why each leg: pre-worker, because after a worker has edited the tree a
   127 is plausibly worker-caused (a broken shebang on a tracked script) and
   worker-revertable — the one-sentence test forbids stopping it. Exit 127,
   because the shell itself is the witness that nothing ran, and health has
   already ruled such a lap is not evidence — a loop that briefs workers on
   laps its own evidence chain discounts is burning money generating
   non-evidence. PATH-resolved, because of **finding D1 (HIGH), folded from
   the drafting review: the factory's own arming pattern can legitimately
   exit 127 at baseline.** A gate of `./bin/tool --selftest`, red because
   the deliverable does not exist yet, is gategen's armed-red gate — a
   worker creating `./bin/tool` is the repair the loop exists for, and a
   stop tier keyed on bare 127 would refuse it. First-word-has-no-slash is
   shell resolution semantics — a fact, not a text guess — so GATEGEN
   ruling 4 is honored. The residual it cannot see (an inner file missing
   behind an on-PATH interpreter, `bash scripts/check.sh` with the script
   absent) stops as environment, and that is correct under house rules: gate
   scripts are human-installed (gategen rulings 2 and 4), so their absence
   is an install defect, and the diagnosis line makes it legible.

   **The hint tier is words, and it may be generous.** The face detection in
   `cli._diagnose_failure` is extracted into ONE shared helper — one
   detector, two callers (`wring start`'s console hint and the loop), the
   gategen-ruling-6 shape, with a guard test that reddens if a second
   detector appears. The helper knows three faces: command-not-found
   (127 / `command not found`), missing-module (`No module named`), and
   not-executable (126 / `Permission denied`). On any continue-tier failure
   matching a face, the brief gains a labeled diagnosis section and the
   manifest records the same diagnosis (ruling 3). 126 stays hint-only: a
   worker can `chmod +x` a tracked script, so it fails the one-sentence
   test for stopping. Timeouts are untouched everywhere.

   `COMMAND_NOT_FOUND` gets ONE definition site importable by both the loop
   and `health.genuine_failure` without an import cycle (health already
   imports loop, so the constant moves down, not up), pinned by a guard
   test in the house shape. The dossier's sharp edge stands as the reason
   text never routes: a broken environment and a genuine bad import are the
   same words at the same exit code (dossier §3d), and SPEC_GATEGEN ruling 4
   already refused the language-specific tell as "a guard that sometimes
   lies".

   **The flagship case, priced out loud:** a fresh repo whose gate is
   `python3 -m pytest -q` (exit 1, `No module named pytest`) still briefs a
   worker once and still ends `no_progress` — that reason is TRUE by
   definition (the worker left the tree byte-identical), and ruling 5 says
   this is the direction to err. What changes is legibility: the brief says
   what the failure may be, the console says it, and the record carries the
   diagnosis beside the true reason, so a fleet summary can finally tell
   "went in circles" from "was sent against a wall".

3. **The record spends the version, and shows its working — DECIDED.**
   `wringer.loop.v2`. **Finding D2 (MEDIUM), folded: the frozen wall is two
   schemas thick, not one.** The dossier counted `loop-manifest`'s reason
   enum; `loop-event.schema.json`'s `loop.finished` carries the same frozen
   enum, so the lawful route is TWO new files —
   `schema/loop-manifest-v2.schema.json` and `schema/loop-event-v2.schema.json`
   (the `untracked` → `untracked-v2` precedent) — published and recorded in
   `schema/frozen.json` in the same commit, existing schema files
   byte-identical, which the existing derived guards already enforce.

   v2 is v1 plus: `reason` gains `environment`; `result` gains `diagnosis`
   — `{face, gate, evidence}`, the evidence being the first matching stderr
   line, truncated — required when `reason` is `environment`, present on any
   stop whose final failing run matched a face, absent otherwise. Its schema
   description says what it is: *a routing diagnosis, never a verdict* —
   §4b's "shows its working", applied to routing. The `status` enum is
   unchanged; an environment stop is `stopped`.

   The writer emits v2 unconditionally — one writer, one format. Every
   reader accepts BOTH versions, and the reader set is DERIVED, not named:
   every match on `loop.SCHEMA_VERSION` or the version literal, found by
   grep. **Finding D3 (MEDIUM), folded: the naive bump silently orphans
   every existing bundle** — `health._KINDS` is keyed off
   `loop.SCHEMA_VERSION`, so changing the constant without widening the map
   makes health forget every v1 loop on disk, wordlessly. The DONE box feeds
   a v1 fixture through every derived reader and demands today's behavior.

   `graph.LOOP_REASONS` gains `environment` — its existing agreement test is
   the drift guard — and a loop node ending `environment` maps to node
   status `parked`, which is already graph's own word for "neither success
   nor failure: a person has to act". A loop that stopped `environment`
   wrote `loop.finished` and is therefore not resumable, unchanged law; the
   remedy is fix-then-rerun, and the console says so.

4. **Under `wring fleet`, an environment stop parks, immediately, spending
   nothing — DECIDED.** In `_maybe_retry`, reason `environment` parks
   before the ladder: no retry is spent, because a retry re-runs the same
   command in the same environment — SPEC_SUPERVISION invariant 2
   generalized from "same signature observed twice" to "deterministic with
   respect to anything a retry can change". `task.parked` with
   `why: environment`; the task row's free-string `reason` carries the
   diagnosis evidence, so the summary table is legible without opening a
   child bundle (no frozen fleet schema is touched — measured: both the
   fleet manifest's and fleet events' `reason` are plain strings).

   Parked, not failed, regardless of `on_exhausted`: park is the fleet's
   word for "a person must act", it keeps the evidence, and the shipped
   console guidance for parked ids — re-run them after acting — is exactly
   the remedy. **No fleet-wide abort of unstarted siblings**: children may
   have genuinely different environments (per-task `dir`, worktree mode),
   so one child's environment proves nothing about another's — invariant 6
   says never fail two hundred because three died — and detection costs one
   verify lap with zero worker spend, so per-child detection is both correct
   and cheap. The stampede F6 measured becomes: every child stops on its
   first lap, no worker is ever invoked, and every row says why.

5. **It errs toward CONTINUE, and the asymmetry is priced — DECIDED.** A
   false stop is a real bug never repaired because the harness decided it
   was the environment — the product silently refusing its job, cost
   unbounded. A false continue is bounded by machinery that already ships:
   the no-progress check and the breaker end it within about two laps, and
   ruling 3 makes the record legible even then. So: text never routes; only
   the pre-worker, PATH-resolved 127 stops; everything ambiguous continues,
   hinted. The brief's hint obeys GATEGEN finding 8's discipline — its
   reader is increasingly a machine, so it states facts and permits exactly
   one imperative: *if you conclude the fix is outside this tree, stop
   changing files and say why.* A worker that obeys hands the loop a clean
   `no_progress` on the next lap, which is the honest end. It must not
   instruct an install: a worker mutating the environment mid-loop would
   turn gates green for a reason no record carries.

   **Finding D4 (LOW), folded: the rail pre-declared this cycle's probe.**
   `scripts/roadmap_render.py`'s F6 node probes `tests/test_run.py` for
   `test_a_loop_does_not_brief_a_worker_against_a_broken_environment` — a
   name that only the fact tier can honestly satisfy. The DONE box pairs it
   with a counterweight test pinning that the missing-module face STILL
   briefs, so the probe cannot be satisfied by widening the stop tier.

## 3. Non-goals (binding)

Routing on stderr text or any language-specific tell (GATEGEN ruling 4
holds) · classifying 126 or timeouts into the stop tier · the harness
running `run.prove_setup` or any environment repair (it is NAMED in console
guidance when declared, never run) · the diagnosis entering acceptance,
vacuity, or health verdicts · fleet-wide abort of unstarted siblings on one
child's environment stop · new `wring doctor` probes · resuming an
environment-stopped loop · multi-machine environments · Windows.

## 4. Definition of DONE

Boxes are phrased against the spec's own definitions — the stop predicate,
the shared helper's faces, the grep-derived reader set — never against
hand-counted lists, because a hand-named set is the narrowing bug this repo
has shipped three times.

- [ ] **The rail's own probe, honored by the fact tier:**
      `test_a_loop_does_not_brief_a_worker_against_a_broken_environment` in
      `tests/test_run.py` — a scratch repo whose gate's PATH-resolved
      command does not exist: the loop stops with reason `environment`,
      `iterations: 1`, the ledger holds zero worker events, the manifest
      validates against v2, and `diagnosis` names the gate and quotes the
      evidence line. Beside it, the counterweight: the missing-module face
      (exit 1, `No module named`) still briefs a worker, hint present — the
      probe cannot go green by widening the stop.
- [ ] **The err-direction boxes, one per leg of the stop predicate:** a 127
      appearing after a worker has acted (a scripted worker breaks a tracked
      script's interpreter) does not stop as environment; an armed-red gate
      invoking its deliverable by path (`./bin/tool`, absent at baseline)
      does not stop as environment and a worker is briefed — D1's case,
      pinned so the factory's arming pattern survives this spec.
- [ ] **One fact, one helper:** `COMMAND_NOT_FOUND` has one definition site
      in `src/`, imported by both `health.genuine_failure` and the stop
      tier, pinned by a guard test in the house shape that reddens on a
      second definition; face detection has one definition with two callers
      (`wring start`'s hint, the loop), and a second detector reddens the
      guard.
- [ ] **The record:** both v2 schema files published and recorded in
      `schema/frozen.json` in the same commit, every existing schema file
      byte-identical (the shipped derived guards enforce this); a v1
      manifest fixture fed through every reader that matches on the loop
      schema version — the set derived by grep, not named — behaves exactly
      as today, health's kind-map included.
- [ ] **The vocabulary:** `graph.LOOP_REASONS` gains `environment` and its
      existing agreement test is what forces it; a loop node ending
      `environment` reads node status `parked`.
- [ ] **The fleet:** two or more tasks over a broken environment — every
      child parks with `why: environment`, zero worker invocations
      fleet-wide, zero `task.retried` events, the summary rows carry the
      diagnosis; after the environment is repaired, re-running the parked
      ids converges, and the counts stay honest at every step.
- [ ] **The brief's hint, pinned by content:** labeled a guess; quotes the
      evidence line; its sole imperative is stop-and-say-why; no instruction
      a worker could satisfy by damaging the tree or mutating the
      environment (GATEGEN finding 8's discipline, applied at birth rather
      than folded later).
- [ ] **The console on an environment stop names the remedy:** the evidence
      line, `wring doctor`, and — when the repo declares it —
      `run.prove_setup` quoted verbatim as the command a human may run.
      Named, never run.
- [ ] **The capture, `docs/env.md`, filmed on the machine trap itself**
      (system `python3` with no pytest — the condition `~/Claude/f6-scout/`
      scripts depend on): one scenario per tier this spec defines — the
      fact tier stopping with zero worker calls, the hint tier briefing once
      and ending `no_progress` with the diagnosis legible in the record —
      then the repaired environment converging. The first capture in this
      corpus in which the chain meets a missing dependency.
- [ ] **The finish report answers the factory question**, and names what
      stayed unfixed on purpose: the missing-module fresh-repo case still
      files `no_progress` — legible now, not different — because ruling 5
      priced a false stop above a false continue.

## 5. The factory question, answered in advance

F6 is what stopped the first end-to-end drive (`docs/factory-dry-run.md`
never reached delivery), and in a fresh repo it is the first thing that
happens — so this is factory-path work by measurement, not refusal-side
work: it converts a fresh repo's first hour from budget-burning
misattribution into either an honest stop costing zero worker calls or one
hinted lap with a legible record. It is also the cycle SPEC_SCOPE's S4
names as out of scope for the at-scale capture — this spec is the named
restoration that FACTORY §1's rule demands of that narrowing.

## 6. What the drafting review checked, and its limit

Checked against the shipped code and the corpus, not read hopefully: §4b's
actual scope (verdict-side, confirmed at its own text); GATEGEN rulings 4
and 6 and findings 8 and 9; SUPERVISION invariants 1, 2, 6, 7, 8; the
frozen regime (two schemas deep — D2 was found by opening
`loop-event.schema.json` rather than trusting the dossier's count); the
fleet's actual retry ladder (`_maybe_retry`, free-string reasons measured
in both fleet schemas); `graph.LOOP_REASONS` and its agreement test; the
roadmap's pre-declared F6 probe; and the armed-red arming pattern that
produced D1. Its structural limit, stated per the gategen precedent: it was
run by the window that drafted the spec, so it is worth most against
contradictions with the code and least against the design's own
assumptions. The independent pass is chartered in the build plan, sequenced
before any slice, one reviewer.
