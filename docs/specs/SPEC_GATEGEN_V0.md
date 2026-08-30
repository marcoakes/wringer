# SPEC — gate authoring (F2: the factory's constraint)

*Drafted 2026-08-10 by the planning window from `WRINGER_FACTORY.md` F2,
`docs/factory-dry-run.md` §3 (measured: `wring plan` proposed ZERO gates and
every `proves:` line was hand-written), and the Citadel teardown
(`~/Claude/WRINGER_CITADEL_RULINGS.md` R1): the most credible competitor
ships acceptance-criteria-as-executable-check with the verifier in the same
tree as the code and no co-modification guard — the attack this spec exists
to prevent, live at 841 stars. Marc's delegation stands; rulings DECIDED.
**Reviewed 2026-08-10 against the shipped code, and six findings are folded
in below — two of them HIGH, both places where this spec asserted a
capability the code does not have. The review's own limit, stated because it
is the weak part: it was run by the window that then builds to the spec, not
by an independent one. Two background reviewer agents were launched and both
died to the same stream watchdog at 600s having read nothing, so an
independent pass is a DEBT this arc carries rather than a box it ticked. A
self-review catches contradictions with the code — which is where both HIGH
findings came from — and is worth much less against the design's own
assumptions.**
[SPEC_ACCEPT_V0.md](SPEC_ACCEPT_V0.md), [SPEC_INTENT_V0.md](SPEC_INTENT_V0.md)
and [SPEC_VACUITY_V0.md](SPEC_VACUITY_V0.md) bind and are unchanged.*

**Reviewed AGAIN 2026-08-10, independently this time: by R0, a window that
neither drafted this spec nor built G0–G3 and will not build what follows.
The debt the paragraph above names is PAID.** Findings 1–6 were re-checked
against the code as it now stands. The five that assert something about
`src/` — 1, 2, 3, 4 and 5 — all describe behavior the build has since
changed, and each carries a RESOLVED note below, because a folded finding
written in the present tense becomes a false statement about the code the
moment the slice lands, and a later reader acting on one would be acting on a
claim this repo no longer honours. Finding 6 is a clarification of this
spec's own wording, asserts nothing about `src/`, and needed no such note. Four new findings are folded
in. The HIGH one comes from the pass a self-review structurally cannot do —
the design's own assumptions — and it is that **the red run this whole spec
is built around is not the only route to `evidenced`, and the alternative
route can be manufactured by a broken environment rather than earned.** It is
folded rather than left open: it needs no redesign here, it needs its own
cycle to close in code, and ruling 3 now says so rather than implying a
guarantee the machinery does not give.

## Positioning

> **A PM's criterion becomes a proposed gate, a human installs it, and it
> must be caught RED before anyone builds.** The drafter proposes; the
> config decides; the record arms it. A gate written for a feature that does
> not exist yet has one honest colour, and it is not green.

The factory needs N gates for N criteria and today a human hand-writes every
one (dry run, measured). This spec closes that — without ever letting a
model decide what counts as proof, and without inheriting Citadel's hole.

The one-sentence test: **could a worker that writes both the gate and the
code get a criterion evidenced without a human and a red run in between?**
If yes, the design is wrong.

### AMENDED 2026-08-11 — born-red is the pedagogy; the comparison is the mechanism

*Ruled after the first real agent run measured this spec's central assumption
and found it does not hold for agents that work in one pass
([docs/first-contact.md](../first-contact.md)).*

The sentence above describes a gate going red **on the clock**, in a run
somebody watched. That is how a person learns what a gate is for, and it is
how the captured demos read, so it stays. **It is not, and can no longer be,
the mechanism by which a criterion becomes evidenced.**

Measured: `wring verify` stops at the first required failure. A real agent
closed three gates in one turn, so two of them never ran at lap 1 and were
born green at lap 2 — `evidenced: 0`, every criterion refusing delivery, on
a change that genuinely satisfied all three. **A one-shot agent can evidence
at most one criterion per red lap**, and every good agent is one-shot.

**AMENDED 2026-08-27 — the starvation was the defect, and it is fixed.** Run
6's re-run on the main Mac hit exactly this shape once more, and this time in
front of a person: the drive told them "None of them passes today", naming the
gate, and the record then refused delivery because "nothing in the record shows
it can fail". A gate carrying `proves:` is no longer skipped by another gate's
failure, so every bound gate gets its red on the pre-change lap and a one-shot
agent can now evidence every criterion its turn satisfies. The paragraph above
describes what was measured on 2026-08-11 and stays as the record of it; the
sentence it licensed — that `run.prove: true` is effectively required of any
repo that binds criteria — no longer follows.

So the mechanism is the **`sensitive` receipt**: `--prove` re-runs the bound
gate against the pre-change tree, and a gate that fails there and passes here
has demonstrated exactly what a historical red demonstrates — on the same
commit, under a controlled comparison, rather than as an accident of when
somebody happened to look. R0's HIGH finding named this route as an
alternative path to `evidenced` and worried about it. It is now the primary
one, deliberately, and the worry is answered by keeping `cites` mandatory on
such a receipt and by the disclosure ruled below.

Two consequences a reader must not have to infer:

1. **`run.prove: true` is effectively required of any repo that binds
   criteria.** Without it, acceptance can only evidence whichever criterion
   happened to be first in the declared gate order.
2. **A `sensitive` receipt produced with no `run.prove_setup` declares that
   it did not verify the pre-change environment**, in the row's own `reason`.
   A prove worktree carries tracked files only, so in a repo with gitignored
   dependencies every pre-change gate would fail for that reason instead. It
   is disclosed rather than refused: refusing on an absent setup command
   would have refused this program's own first true measurement, whose gates
   are stdlib and need none.

### AMENDED 2026-08-15 — the check may have to be MANUFACTURED

*The corpus measured this spec's central assumption — that the discriminating
check already exists in the repository — and disproved it: `gates_vacuous` on
13 of 13 tasks. **§6 is the amendment that follows**, and it is the largest one
this spec has taken: when a criterion's declared gates cannot discriminate,
Wringer authors a check of its own, proves it red before the work, and pins it.
Read §6 before acting on anything above it.*

### AMENDED AGAIN, same day — the gate must pre-date the change it judges

*The first end-to-end run with a real agent produced, unprompted, the thing
the amendment above was warned about.*

The drafter bound four criteria to tests in a file that did not exist. The
gates failed instantly — red, but because the **test** was missing, not the
feature. The agent then wrote that file along with the code it checks.
`--prove` saw fail-then-pass, issued four `sensitive` receipts, acceptance
counted them, and `wring deliver --send` pushed. **The harness certified work
whose acceptance tests its own worker had written**, which is the shape this
program exists to refuse, on the default path, from an ordinary PRD.

**E1a is not reversed.** The pre-change comparison remains the mechanism by
which a one-shot agent evidences anything. What is added is the one
precondition the born-red story always implied: **a gate that arrived with the
change cannot evidence the change.**

Established **structurally** — from git's own untracked list, asking whether
this change created any name the gate command exercises. Not by reading the
failure message, and not by parsing the command for filenames: both are the
classification §4b refuses, the second merely wearing a structural costume.
Where it cannot be established at all, the receipt does not count and the row
says why. **Un-establishable is unevidenced, never a pass** — this artifact
held to its own standard.

**The cost is accepted rather than softened.** An acceptance gate can no
longer arrive in the same change as the code it checks. A task that
legitimately writes its own test gets that criterion evidenced by the *next*
change, or by a human receipt — not by the same commit. Greenfield work pays
this in full, and that is the trade: a criterion evidenced one change later is
worth more than one evidenced by a check its author wrote in the same breath.

**The drafter now proposes bindings.** The prompt asks for `gate_bindings`
with `proves:` and says a binding that already passes is worth nothing. It
had never asked — the sidecar writer, its parser and its tests all shipped
while the request named only `gates: [{id, run}]`, so the channel was complete
and unreachable, and the first real drafting call returned no binding for
exactly that reason. Everything downstream is unchanged: the proposal is still
a diff a human applies, and `wring plan` still stops.

## 1. What it does

- **`wring spec` (the existing drafter, existing `--send`) also proposes
  per-criterion gates** into a NEW sidecar file, `wringer.gates.yaml`
  (`wringer.gatespec.v1`): entries of `id / run / timeout / proves`, one per
  machine criterion, none for `human: true` ones. A sidecar because
  `wringer.spec.v1` is frozen and its gates section has no `proves` channel
  (SPEC_ACCEPT ruling 2) — a new file with a new schema is the lawful route.
- **`wring plan` renders the sidecar through `gate_diff` — WITH the
  `proves:` lines — and STOPS**, exactly as gate proposals always have. The
  human applies the diff to `.wringer.yaml` by hand or not at all. A1's
  shipped validation then enforces the join (unknown criterion, duplicate,
  optional, human — all still hard errors).

  **Review finding 1 (HIGH), folded:** the sentence above described shipped
  code and was wrong twice. `spec.gate_diff(existing, spec)` emits only
  `id`, `run`, `timeout` and `optional` — there is no `proves:` line in it —
  and it reads `spec.gates`, which `spec.parse` builds through
  `config.parse_gate` with `allow_proves` OFF, so a `Spec` cannot carry a
  binding even in principle. Rendering a sidecar through it is a signature
  change and a new emitted line, not a call. G2 builds both; this spec no
  longer claims they exist.

  **RESOLVED by G2, re-checked 2026-08-10 by R0.** Both halves shipped:
  `spec.gate_diff(existing, proposed)` now takes a sequence of gates rather
  than a `Spec` — its own docstring gives this finding's reason — and it
  emits `proves:` beside `run:`, so one edit installs the command and its
  binding together. `spec.parse_gatespec` / `load_gatespec` read the sidecar
  through `config.parse_gate(..., allow_proves=True)`. Read the finding as
  history, not as a description of `src/`.
- **Nothing new runs.** `wring plan` still runs nothing; the sidecar is a
  draft artifact with zero authority; installation is the human act it
  always was. The first `wring verify` after installation records the gates
  RED (the feature does not exist), which is acceptance's shipped
  discrimination receipt — and the moment a build loop later turns them
  green, the criteria read `evidenced` with the red bundle cited. The
  machinery composes; this spec only fills the authoring gap.

## 2. Rulings

1. **The sidecar is the binding channel — DECIDED.** `wringer.gates.yaml`,
   new schema, published + frozen on ship. The frozen spec schema is
   untouched; the drafter gains a place to say which criterion a proposed
   gate proves, and that place is a proposal, never an instruction.

   **Review finding 2 (HIGH), folded — two sources, and the collision was
   unspecified.** `wringer.spec.v1` ALREADY has a `gates:` block that
   `wring plan` already renders through `gate_diff`
   (SPEC_INTENT_V0.md: *"proposed .wringer.yaml gates, NOT auto-installed"*).
   The sidecar is therefore a SECOND source of proposed gates, and this spec
   said nothing about what happens when both name the same id. **Ruled: the
   sidecar is the only channel that may carry `proves:`; both sources are
   rendered into one diff; and an id declared in both files is a hard error
   at `wring plan` naming both files and the id.** Silently preferring one
   would let a drafter's binding attach to a command the reader believes
   came from the other file.

   **RESOLVED by G2, re-checked 2026-08-10 by R0.** The refusal ships in
   `spec.py`, naming both documents and telling the human which entry to
   drop, and `tests/test_plan.py` pins it from both directions.

   **Review finding 6 (MEDIUM), folded — the sidecar is not a new trust
   category, and the spec should say so.** Because that `gates:` block
   already carries model-drafted `run:` strings, a reader currently infers
   the sidecar opens a door that is already open. It does not. Nothing about
   SPEC_GRAPH ruling 1 changes: `.wringer.yaml` remains the only file that
   puts a command in Wringer's mouth, and the only way into it is still a
   person applying a diff.
2. **Drafter proposes, human installs, zero authority until applied —
   DECIDED.** `gate_diff` renders and stops; there is no `--apply`, no
   auto-merge, and the sidecar is never read by `verify`, `run`, `fleet`,
   `graph` or `deliver`. Only `.wringer.yaml` puts commands in Wringer's
   mouth (SPEC_GRAPH ruling 1), and only a person edits it.

   **Review finding 4 (MEDIUM), folded — the named enforcement technique is
   the wrong one.** This spec called the guard "import-parsing", and imports
   cannot express it: no module needs to import anything to open a file by
   name. The shipped `ast` guards (`tests/test_health.py` walks
   `health.py`'s tree for forbidden imports AND banned call attributes) are
   the precedent, and the expressible form here is a **filename-constant
   guard**: the literal `wringer.gates.yaml` and the module constant that
   holds it appear in `spec.py` and the plan path and nowhere else in
   `src/wringer/`. **Its limit, stated rather than discovered later:** it
   catches a module that names the file — which is the realistic regression,
   someone adding a read to `verify.py` — and cannot catch a module handed
   the path as a parameter by a caller. No guard in this codebase can catch
   the latter, and claiming otherwise would be the guard-that-lies this
   repository exists to refuse.

   **RESOLVED by G1/G2, re-checked 2026-08-10 by R0.** The filename-constant
   guard ships as an `ast` walk in `tests/test_plan.py`, in the shape
   `test_health.py` set. Its stated limit is still its real limit and the
   finding's wording of it needed no change.
3. **A generated gate green at birth is SELF-REFUTING — DECIDED.** The
   criterion is unmet (the feature does not exist), so a correct gate MUST
   fail at baseline; one that passes is testing something else. No new
   machinery needed: SPEC_ACCEPT ruling 3 already renders it `unevidenced`
   and refuses delivery. This spec adds the words — `gate_diff`'s output and
   `docs/gategen.md` say "these gates should be RED on your next verify; a
   green one is wrong, not lucky" — and a DONE box pins that the summary of
   that first verify says so beside each born-green bound gate.

   **Review finding 7 (HIGH), folded — the red run is NOT the only route to
   `evidenced`, and the other route can be manufactured by a broken
   environment.** This spec's one-sentence test asks whether a worker can get
   a criterion evidenced *"without a human and a red run in between"*. The
   human half holds: only a person edits `.wringer.yaml`. The red-run half
   does not. `accept._discriminating_pairs` arms a receipt from a genuine
   failure **or from a `sensitive` row**, and `accept._REMEDY` — the text a
   born-green gate prints — sends the reader to `wring verify --prove`, which
   is exactly how a sensitivity gets recorded. SPEC_VACUITY §4b is then the
   whole problem: the prove worktree is `git worktree add --detach`, tracked
   files ONLY, so any gate touching a gitignored path fails in the pre-change
   tree for reasons that have nothing to do with the criterion.

   Measured on shipped code, in a repo with ONE bundle on disk and no red run
   anywhere in its history: a gate reading `test -f vendored/installed`, with
   `vendored/` gitignored, reached `evidenced` on a single `wring verify
   --prove`. The receipt was `kind: sensitive`, its entire citation the
   string *"exit 1, and it printed nothing"*, and the vacuity verdict read
   `proven`. The born-green warning did not fire — correctly, and
   unhelpfully: the state was `evidenced`, not `unevidenced`, so the one
   place this spec put its words is silent in precisely the case that
   defeats it.

   **Ruled, and stated rather than left for a field report to find:**
   sequencing (ruling 4) is what this spec offers against Citadel and it
   remains more than Citadel has — but the mechanical guarantee is the
   RECEIPT, not the sequence, and a sensitivity receipt is only as strong as
   `run.prove_setup` being set and its `cites` line being read. Where this
   flow recommends `--prove` as the remedy for a born-green gate it must say
   that a repo whose dependencies are not committed sets `run.prove_setup`
   FIRST, and that a citation of the shape above is what a receipt proving
   nothing looks like. Closing it in code — a sensitivity whose pre-change
   failure looks environmental should not arm acceptance — touches
   `accept.py` and `vacuity.py`, is not this spec's build, and is named here
   as the next cycle's candidate rather than folded into a slice that would
   then ship an unreviewed design.

   **Review finding 8 (MEDIUM), folded — "should be RED" is an imperative,
   and its reader is increasingly a machine.** The shipped sentence is
   *"⚠ `X` should be RED. It proves `c`, and nothing in the record shows it
   can fail…"*. This ruling wrote it for the person who has just applied a
   diff. Under `wring run` and `wring fleet` the party who opens that bundle
   is an agent — `loop._repair_brief` ends by telling it *"The whole evidence
   bundle — diff, status, every gate's logs — is at `<dir>`"* — and the
   literal way to satisfy "should be RED" is to break the gate or delete the
   feature. That is the harness instructing a worker to damage the evidence:
   the same pathology SPEC_SCOPE exists to remove from briefs, arriving
   through a different door. **Ruled: the warning must not be actionable by a
   worker.** It states a fact about the record, and the remedy it names is a
   record-side one — the gate had to be red BEFORE the feature existed, and
   that moment is either in the history or it is not. The DONE box that pins
   this text by content also pins that it carries no instruction addressed to
   whoever is reading it.
4. **Isolation is by SEQUENCING — DECIDED.** Gates are drafted at spec time,
   installed by a human, and recorded red BEFORE any build task is briefed
   (the graph shape: spec → human → verify → build). The gate author (the
   drafter + the installing human) and the build worker are different
   parties separated by a recorded red run, which is the co-modification
   guard Citadel lacks. What sequencing cannot stop — a worker weakening the
   TEST FILE mid-loop while the command string stays identical — is vacuity
   §5a's inherited blind spot, stated in limits, answered by the human diff
   at delivery and by health across time. No file-tracking is attempted:
   Wringer cannot honestly derive "which files a command depends on" in a
   language-agnostic way, and a guess would be a guard that sometimes lies.

   **Review finding 9 (MEDIUM), folded — the sequencing argument is sound
   and it is a PROCESS guarantee, which this ruling reads as a mechanical
   one.** Re-checked against the code: nothing in `src/` enforces the order.
   `accept._discriminating_pairs` accepts any qualifying bundle from the
   history, in any order, with no notion of "before the build task was
   briefed"; the graph shape that produces the order is a shape an operator
   or a graph file chooses. That is not a defect — the alternative is
   file-dependency tracking, which this ruling refuses for good reasons that
   still stand — but it means the co-modification guard Citadel lacks is
   **the recorded receipt**, which is checkable, rather than the sequence,
   which is not. Finding 7 is what that distinction costs when the receipt
   can be earned another way. The wording is corrected here so a reader does
   not go looking for the enforcement and conclude the spec lied to them.
5. **The drafter is the EXISTING drafter — DECIDED.** Same `wring spec`,
   same `--send`, same endpoint config, no new network surface. An offline
   repo writes the sidecar by hand in the same format; the flow from there
   is identical, which keeps the no-LLM path first-class.

6. **Reusing A1's validation means EXTRACTING it, and that is still reuse —
   review finding 3 (MEDIUM), folded.** `config._check_bindings(cfg, root)`
   takes a parsed `Config` for `.wringer.yaml` and re-reads
   `wringer.spec.yaml` from disk itself. A sidecar that nobody has applied
   is neither of those, so the DONE box below — the three failures firing at
   `wring plan` — cannot be met by calling it as it stands. **Ruled: the
   per-gate rule loop is extracted into one function that takes (gates,
   criteria, where), and BOTH `_check_bindings` and the plan-time sidecar
   check call it.** That is one validator with two callers, which is what
   the no-second-validator rule was protecting; a copy of the rules under a
   new name is what it forbids, and the DONE box's test is what tells them
   apart.

   **RESOLVED by G1, re-checked 2026-08-10 by R0.** `config.check_bindings(
   gates, criteria, where)` is the extracted function, and it has exactly the
   two callers ruled: `config._check_bindings`, which still reads
   `wringer.spec.yaml` from disk for the loader's path, and the plan-time
   sidecar check. `where` names the file the GATES came from, which is what
   makes one validator serve two documents.

7. **Adding a schema is additive, and the guards already prove it — review
   finding 5 (LOW), folded; axis clean.** `gatespec.schema.json` requires no
   edit to any frozen schema. `test_the_freeze_covers_every_published_schema`
   asserts the frozen manifest and the published directory are the SAME set,
   so shipping the file without recording it reddens the suite, and
   `test_the_schema_readme_lists_every_published_schema` derives the README
   row the same way. Recording a new entry in `schema/frozen.json` is the
   lawful route and is not an edit to a frozen file — the freeze is over the
   schema files, and `test_a_new_schema_may_be_added_without_touching_the_freeze`
   says so by name.

   **RESOLVED by G2, re-checked 2026-08-10 by R0.**
   `schema/gatespec.schema.json` is published, its digest is recorded in
   `schema/frozen.json`, and the README carries its row. The axis was clean
   and stayed clean.

## 3. Non-goals (binding)

Auto-applying gates · any command that runs gates at plan time · parsing
commands to discover file dependencies · mutation testing · more than one
gate per criterion (SPEC_ACCEPT holds) · gate selection (BINDING NON-GOAL
per Citadel R2) · editing `wringer.spec.v1` or any frozen schema · a
`--send` on `wring plan` · Windows.

**Review finding 10 (LOW), folded — one of these non-goals now reads as a
contradiction with a spec sitting beside it on main.** *"gate selection
(BINDING NON-GOAL per Citadel R2)"* was written when R2's door had never
been opened. [SPEC_SCOPE_V0.md](SPEC_SCOPE_V0.md) has since opened it, by the
route R2 itself named and carrying all three of its conditions. The non-goal
stands as written for THIS cycle — gategen selects nothing, and the sidecar
proposes gates rather than choosing which ones run — and the citation now
points at what happened next, so a stranger reading both specs is not left
to work out which one the repository means.

## 4. Definition of DONE

- [ ] end to end through real processes: a hand-written sidecar (no LLM on
      this machine) → `wring plan` renders the diff with `proves:` lines and
      stops, `.wringer.yaml` untouched → human applies → verify records the
      gates RED → a scripted worker builds → verify green →
      `acceptance.json` reads `evidenced` citing the red bundle → deliver
      succeeds. The dry-run scenario, re-driven, completing this time
- [ ] the sidecar with an unknown criterion id, a `proves:` on a human
      criterion, and a duplicate claim each fail at `wring plan` with both
      sides named — reusing A1's validation, not duplicating it, pinned by
      a test that reddens if a second validator appears
- [ ] a sidecar entry whose gate is green at first verify renders the
      ruling-3 warning beside it in that run's summary, pinned by content —
      **and the pinned content carries no instruction addressed to its
      reader** (review finding 8), because under `wring run` that reader is
      a worker and "should be RED" is a thing a worker can do
- [ ] no consumer outside `spec.py`/`plan` reads `wringer.gates.yaml` — the
      filename-constant guard of ruling 2, not import-parsing, and its limit
      stated beside it
- [ ] `gatespec.schema.json` published + frozen same commit, drift test,
      schema README row (derived guards already fire)
- [ ] `wring spec --send` emits the sidecar when criteria are machine;
      offline, the printed next-steps name the hand-written path
- [ ] docs/gategen.md carries the captured flow (recorder, 80 cols). The F2
      rail node probes on the spec AND this doc — both, which is stronger
      than the "not the spec" this box used to claim and is what
      `scripts/roadmap_render.py` actually declares; the node cannot go
      green on a spec alone, which is the P6 trap it was written to avoid
- [ ] the sidecar and the spec's own `gates:` block declaring one id is a
      hard error at `wring plan` naming both files (ruling 1, finding 2)
- [ ] the finish report answers the factory question; for this arc the
      answer must be "moved the spec closer", with the dry-run rerun as proof

## 5. What the independent review checked and found SOUND

Named, so that an area nobody looked at and an area that held cannot read the
same. All six original findings are RESOLVED above, each re-checked against
today's `src/` rather than against the review that wrote them.

- **The one-sentence test's HUMAN half holds.** Only a person edits
  `.wringer.yaml`; the sidecar is read by `spec.py` and the plan path and by
  nothing that runs, guarded by the `ast` walk of ruling 2, and no drafter
  output reaches a gate runner without a diff a human applied. Finding 7 is
  about the other half of that sentence.
- **Ruling 1's channel argument holds.** `wringer.spec.v1` is frozen, has no
  `proves` channel, and the sidecar is the lawful route — re-checked, not
  taken on trust.
- **Ruling 5 (the drafter is the existing drafter) holds.** No new network
  surface, and the offline hand-written path is first-class:
  `parse_gatespec` cannot tell a drafted file from a typed one, which is why
  the no-LLM path stays real.
- **Ruling 6's one-validator-two-callers rule holds in the code**, and the
  test that reddens if a second validator appears is the thing that keeps it
  true rather than the ruling's wording.
- **Ruling 7's schema axis is clean.** Published, frozen, README row, all
  three derived guards live.
- **The `wringer.gates.yaml` sidecar is not a new trust category** (finding
  6's point, re-verified): the spec's own `gates:` block already carried
  model-drafted `run:` strings, and nothing about SPEC_GRAPH ruling 1 moved.

## 6. AMENDED 2026-08-15 — the witness: Wringer authors the discriminating check

*Ruled in `~/Claude/WRINGER_RULING_2026-08-14.md` ("the witness ruling"), R1,
after the first corpus run measured this program's operating assumption and
disproved it ([docs/corpus-2026-08-13.md](../corpus-2026-08-13.md)). The
ruling delegates two choices to the implementation — which existing command
hosts the author, and how the witness is packaged — and both are DECIDED here,
against the tree rather than in the abstract.*

***INDEPENDENTLY REVIEWED before any code, 2026-08-15**, by one agent that
neither drafted this section nor will build it (the no-fleets rule). Seventeen
findings, four HIGH, all folded — §6a lists each with its resolution. Two of
the HIGH ones were this repository's own named recurring defects, in the
document that names them: **the first draft claimed a composition that does not
exist** ("the proving mechanism is already shipped" — it is not; nothing can
execute a witness today), and **its central integrity claim was contradicted by
the shipped code's own docstring** (`prev_hash` is tamper-EVIDENCE, not
tamper-proofing, and `evidence.py:462-476` says so in those words). Both are
corrected in place below rather than annotated, because a wrong claim left
standing with a footnote is still a wrong claim. The review's verdict on the
design itself was that it is right and worth building.*

*Nothing here is built by the slice that writes it: the author and its offline
calibration are Phase 1, execution/receipt/delivery are Phase 3, standard
emission is Phase 4.*

***AMENDED AGAIN 2026-08-15 — W10 added**, by `WRINGER_RULING_2026-08-15` (the
fork ruling), after Phase 1's offline calibration ran and its single
prevention-style catch turned out to be location-luck. W1–W9 are untouched.
**Phase 1 is now CLOSED** on stop conditions (a) and (b), both hit; the third
was retired as an invalid measurement and the prevention question moved to
Phase 3, where a loss now fires the bug-fix de-scope automatically. The
schedule, the trigger and the Phase 3 stop are recorded in the repository at
[docs/witness-programme.md](../witness-programme.md); the measurement is
[docs/witness-calibration-2026-08-15.md](../witness-calibration-2026-08-15.md).*

### What the measurement disproved

This spec has always assumed the discriminating check **already exists in the
repository** and needs only to be bound, sequenced and caught red. The corpus
measured that assumption in the regime the product targets — changes whose
correctness the declared gates do not cover — and it does not hold:
`wring verify --prove` afterwards returns **`gates_vacuous` on 13 of 13
tasks**, `sensitive: false` throughout. The repo's own suite was green before
each change and green after it. `wring deliver` said yes on 26 of 26 supervised
rows, including every wrong change.

The declared gates carried **zero information about the change**: constant yes
without `--prove`, constant no with it. The verdict was set by a config flag
rather than by the work. A binding channel, a human diff and a red run are
worth nothing when there is nothing red to catch.

**The replacement, in one sentence:**

> **Evidence is manufactured, not found.** A check is evidence about a change
> only if it was demonstrated able to fail in that change's absence with
> respect to the criterion it proves; Wringer's job is to ensure such a check
> exists — authoring it when the repository lacks one — to prove the red, pin
> it, and to refuse or route to a human when it cannot.

### The one-sentence test, restated

§Positioning asks whether a worker that writes both the gate and the code can
get a criterion evidenced without a human and a red run in between. That test
survives and gains a second — the one the corpus failed:

> **Does the bundle contain a check that Wringer authored, proved RED for the
> right reason on the pre-change tree, and the worker could not edit?**

Today: no. W1–W10 make it yes. *"For the right reason" is not decoration — it
is W8, and the review is why it is in the sentence. Nor is "the criterion" —
that is W10, and a measured location-lucky catch is why it is in the
sentence.*

### W1 — The witness is Wringer's own check, not a repo gate — DECIDED

A **witness** is a fail-to-pass check that Wringer authors for one machine
criterion. It is deliberately **not** an entry in `.wringer.yaml`:

- A gate in `.wringer.yaml` is the **repository's** claim, installed by a
  person applying a diff. Ruling 2 and SPEC_GRAPH ruling 1 are untouched:
  nothing here writes that file, and no witness is ever proposed into it.
- A witness is **Wringer's** manufactured evidence. Wringer owns, pins and
  executes it, and it lives under `.wringer/` rather than in the source tree.

This is why a witness needs no human install and does not contradict ruling 2.
It also bounds the claim: a witness evidences the criterion it was authored
for and says nothing about the rest of the change.

**Why not "generated gate".** A generated gate is a proposal into the sidecar —
ruling 1's channel, requiring a human. The witness is a different object with a
different trust story, and reusing the gate vocabulary would collapse the two.

### W2 — Authoring is a SEND, hosted on `wring spec`, and it is UNCONDITIONAL — DECIDED

The author is an LLM call, so under the typed-send law it is a flag typed on
the invocation and carried by no file: **`wring spec --send --witness`**.

**The host was chosen by elimination against a law, not by preference.**

> *"No LLM and no network in any command that **proves** anything — `verify`,
> `run`, `resume`, `fleet` and `plan` cannot reach one."* — README.md:98

| candidate | verdict |
|---|---|
| a new top-level command | refused — 19 is the ceiling this cycle |
| `wring run` | **refused by law.** `run` proves. The first draft hosted the author here and was wrong |
| `wring verify` / `wring plan` / `wring resume` | same law |
| `wring deliver --send` | a sender, but it runs after the work — too late to pre-date it |
| `wring attest --sign` | post-hoc by construction |
| `wring judge --send` | judge is ruled dead and stays dead |
| **`wring spec --send`** | **chosen** — already a sender, already the authoring surface, runs before any work exists |

1. **No new socket.** `spec.py:25`: *"This module opens no socket. `wring spec
   --send` reuses `judge.send`."* The two real openers are `forge.py:221` and
   `judge.py:329`; the author adds none. *(The customary phrasing of this
   property — "`grep -rn build_opener src/` returns exactly two" — is **not
   literally true**: that grep returns five, because three docstrings name it.
   `grep -rn "urllib.request.build_opener" src/` is the one that returns two.
   The first draft repeated the inaccurate form and promoted it to a DONE box.)*
2. **The sender count does not move.** It stays **five**.
3. **Reusing `judge.send` is not reviving the judge.** The stop-list kills the
   `wring judge` command and judge *calibration*; `judge.send` is the transport
   `wring spec` has always used.

**Authoring is unconditional over machine criteria, and vacuity SELECTS.** The
first draft said a witness is authored "when the criterion's declared gates
cannot discriminate". **At `wring spec` time that is unknowable**: the gates for
these criteria do not exist yet — they are proposed into the sidecar and
installed later by a human — and vacuity's verdict comes from `--prove`, which
is `not_applicable` on a clean tree (`vacuity.py:190-194`) and runs only after
every required gate has already passed (`verify.py:308-309`).

So: **the author writes a candidate witness for every machine criterion, and
vacuity decides later which witnesses are CONSULTED.** Manufacture is
unconditional; consultation is triggered. The cost is one authoring call per
machine criterion per `wring spec --send --witness`, always, and that is the
honest price of putting the author in a command that cannot run anything.

**Temporal independence is the load-bearing property.** A check authored before
the work exists cannot have been written to flatter the work.

**Isolation of the author.** The author gets the criterion and the pre-change
tree, isolated as the corpus isolates a worker: truncated history, no upstream
reachability, the criterion statement only. Never upstream's fix, never the
held-out tests, never the worker's session.

**The sequencing consequence.** The witness lane requires `wring spec` to have
run. A flow that goes straight to `wring run` from a bug report has no criteria
and therefore no witness. Wiring that for the re-test is Phase 3's input.

### W3 — What is shipped, and what is NOT — DECIDED

**The first draft said "the proving mechanism is already shipped; only the
author was missing." That is false, and it was the review's first HIGH.** Both
ends of the pre-change comparison are closed over `.wringer.yaml` gates, which
W1 rules the witness deliberately is not:

- `vacuity.prove` builds its comparison set by iterating `planned` — the
  declared gates — and looking each up in the changed-tree results
  (`vacuity.py:236-246`). A `sensitive` row can only exist for a gate in
  `cfg.gates`.
- `verify.run` executes `planned` and nothing else (`verify.py:308-320`), so
  the *pass* half of a fail→pass comparison has no producer for a witness.
- Acceptance binds through `{gate.proves: gate for gate in cfg.gates}`
  (`accept.py:288-290`) and finds receipts by `(gate.id, command)`
  (`accept.py:405-441`). A criterion covered only by a witness returns
  `UNEVIDENCED — "no gate proves this criterion"` (`accept.py:317-324`).

**The honest decomposition:**

| piece | state |
|---|---|
| the pre-change worktree (`git worktree add --detach HEAD`, tracked files only) | **shipped** — `fleet.py:763` via `vacuity.py:207` |
| `run.prove` / `run.prove_setup` config, the `sensitive` row shape, `cites` | **shipped** |
| executing a witness on the changed tree | **does not exist** |
| comparing a witness across the two trees | **does not exist** |
| a receipt acceptance will consume for a witness | **does not exist** — and costs `wringer.acceptance.v2`, because `accept.py:100-112` rules that even an optional new key is a silent break for existing readers |

**Phase 1 does not build any of the three missing pieces.** It builds the
author and calibrates it **offline, in the benchmark harness's own executor**,
where a witness is just a file run against a tree. That is enough to answer the
ruling's three numbers and costs no change to the proving path. Wiring the
witness into `verify`/`vacuity`/`accept` is Phase 3, and W6 now names the
`acceptance.v2` cost so Phase 3 does not discover it.

Two shipped `--prove` behaviours the witness lane inherits: it **skips
`optional` gates** (`vacuity.py:241-246`), and HEAD does not move during a
loop.

### W4 — Pinning: what it is, and what it is not — DECIDED

**Authoring is a send; pinning and proving are offline.**

1. **`wring spec --send --witness` authors.** Bytes written under
   `.wringer/witness/`, digest recorded in the spec bundle. Nothing trusted yet.
2. **The next `wring run` pins, before the first worker turn.** Offline: it
   verifies the bytes still match the digest the author recorded, writes the pin
   as a ledger event, and establishes the born red (W8). No LLM, no network.

**The integrity claim, corrected.** The first draft called the `prev_hash`
chain *"the one integrity structure in this program that a consistent local
edit cannot forge"* and dismissed any other location as *"security theatre"*.
**The shipped code's own docstring says the opposite**, and the review was
right to lead with it:

> *"This is **tamper-evidence**, not tamper-proofing — anyone who can write the
> file can rewrite the whole chain — but it turns silent edits into detectable
> ones."* — `evidence.py:462-476`

The worker runs on the host, always (SPEC_EXEC §5), and `.wringer/` is
protected by an instruction in the brief rather than by a boundary
(`loop.py:1336`). A worker that sets out to forge the pin can rewrite the chain
from genesis. So, stated at its true strength: **the ledger is the best
available location and the pin is tamper-EVIDENT — against accident, against
drift, and against a worker that is not trying. It becomes a boundary only
under Phase 2's containment.** That is still worth building; it is not what the
first draft claimed.

**One cheap step the review earned:** `wring run` calls `attest.check_chain` on
its own `loop.jsonl` before trusting a pin, and a broken chain VOIDs the run
exactly as a digest mismatch does. Today the chain is walked only by
`attest.audit` (`attest.py:194-231`, reached from `:379`/`:473`), i.e. after
someone attests and then audits — never at the moment the pin is read.

**The comparison, and what it covers.** At every execution Wringer hashes the
bytes it is about to run and compares to the pin. **The pin covers the file
bytes, the command string, and the materialisation path** — pinning bytes alone
would let a worker rewrite `run:` to `true` while the file stayed
byte-identical, which is the forgery this ruling rejects, one field over.

**A mismatch VOIDs the run.** Not a failing gate — no run at all. Exit
`EXIT_REFUSED` (3, `cli.py:47`): not 1, which would file it as evidence about
the change, and not 2, which would blame a configuration that is fine.

**Materialisation is ruled, not left to the implementation.** Wringer refuses
to follow a symlink at the materialisation path, refuses to overwrite an
existing entry there, and VOIDs on any write or removal failure. Left
unspecified, a symlink planted at that path makes the write land elsewhere and
the cleanup delete something else.

**Packaging is derived, not chosen.** The pre-change tree carries tracked files
only, so an untracked witness in the working tree would be *absent* there and
would "fail" for file-not-found — §4b's false `proven` wearing this
amendment's badge. Committing it instead is refused by law 6. **Therefore the
bytes of record live under `.wringer/witness/` and are materialised into
whichever tree is executing, digest-checked, run, and removed.**

**What this closes that nothing else does.** Acceptance identity is
`(id, command)` (SPEC_ACCEPT §3), so rewriting a *test file* while the command
string holds resets nothing — the inherited blind spot in SPEC_VACUITY §5a and
ruling 4. **A pinned witness is the first check in this program whose identity
covers its own content.** Closed for the witness, not for repo gates.

### W5 — The worker sees the failure, never the source — DECIDED

The loop brief carries the witness's **failure output**. Never its source,
path, or command. Finding 8 above binds: the brief must carry no instruction a
worker can satisfy by damaging the evidence.

**The precedent, described correctly this time.** Human criteria appear in the
brief **by id alone** — not id and title — with guidance withheld
(`loop.py:1263-1270`), and `tests/test_run.py:591` asserts the title-bearing
line is absent. The witness section follows that shape: name-only.

**The honest limit: this is a rule about what Wringer hands over, not a
sandbox.** A worker with a shell can read `.wringer/`, and `worker_execution`
is `trusted_local` (SPEC_EXEC §5).

- **The threat model this closes is TAMPERING, not disclosure.**
- **Disclosure is not benign here, and the first draft was too comfortable
  about it.** Calling a worker that reads the witness "a worker doing its job"
  is right in ordinary TDD and wrong in this regime: the witness is the *only*
  check carrying information about the change, so a worker that reads it can
  special-case exactly it and produce red→green on a change that is still
  wrong. That is the corpus's headline finding — the answer leaked into the
  worker's reach — relocated from `.git` to `.wringer/`.
- **Phase 1's numbers cannot see this**, because they are scored offline
  against patches produced by workers that never saw a witness. So (a)/(b)/(c)
  are an **upper bound** on live Phase-3 behaviour by an unknown margin. This
  does not change the phase order — containment already precedes the re-test —
  but it changes what a passing Phase 1 licenses, and W7 says so.

### W6 — The schema is frozen once, and R3's mapping is designed with it — DECIDED

A new published schema, `witness.schema.json` / **`wringer.witness.v1`**, a
sibling artifact on the `vacuity.json` pattern: absent from runs with no
witness lane, covered by `digests.json`, written through the redactor, recorded
in `schema/frozen.json` in the same commit.

**Two other version costs, named now rather than found later:**
`loop-event-v2.schema.json` is a **closed `oneOf` of eight branches**, so the
pin event needs `loop-event-v3.schema.json` / `wringer.loop.v3` with v2 still
published and a test proving a v2 bundle on disk still reads. And Phase 3's
receipt needs **`wringer.acceptance.v2`** (`accept.py:100-112`).

**The fields are designed together with R3's in-toto mapping so the witness
schema freezes once:**

| witness field | why it exists | R3 destination |
|---|---|---|
| `id`, `proves` | which criterion this manufactures evidence for | custom predicate |
| `authored.at`, `authored.by.model` | temporal independence is the claim | custom predicate |
| `authored.base_sha`, `authored.tree_dirty` | the tree it was authored against, and whether that tree was clean (W8) | custom predicate |
| `authored.criterion_sha256`, `authored.prompt_sha256` | what the author was given — digests, never the text | custom predicate |
| `authored.isolation` | truncated history / no upstream reachability | custom predicate |
| `pinned.sha256`, `pinned.run`, `pinned.path` | **the pin**, over all three (W4) | predicate + `configuration` |
| `proved_red.outcome` | `assertion` / `collection_error` / `green` — W8's structural discriminator | custom predicate |
| `proved_red.receipt`, `.exit_code`, `.first_line` | the receipt and its mandatory citation | custom predicate |
| `proved_red.verdict` | `proven` / `inconclusive` / `not_established` | custom predicate |
| `executed.sha256`, `.matches_pin` | the comparison that VOIDs a run | custom predicate |
| `executed.result` | passed / failed on the changed tree | `result`, `passedTests`, `failedTests` |

`wringer.attestation.v1` stays frozen and gains no v2 dialect. Phase 4 builds
the emission; this amendment builds none of it.

### W8 — A witness must be red for the RIGHT REASON — DECIDED

*The review's fourth HIGH, and the one that would have re-opened the hole this
document closed 340 lines above.*

A witness is by construction a file absent from the pre-change tree, written by
a model that has never seen the source — `wring spec` is handed a PRD and, at
most, the repo's existing gate *commands* (`spec.py:564`). Such a model will
write a check that imports a plausible-sounding symbol. That witness is red on
the pre-change tree for **`ModuleNotFoundError`**, gets pinned, and turns green
the moment the worker creates any file of that name with any content.

This is not hypothetical. It is the measured event that produced the
"AMENDED AGAIN" section above, and `accept.py`'s own call-site comment records
it: *"four criteria came back `evidenced` on the strength of an import
error."*

**Ruled: a witness whose pre-change failure is the runner failing to LOAD it is
discarded, exactly as a born-green witness is.** The criterion is then reported
uncovered. Specifically:

- `proved_red.outcome` is `assertion` only when the runner collected the check
  and the check then failed. `collection_error` — import failure, syntax error,
  no such test — is **not a proved red**.
- This is **structural, from the runner's own outcome**, and is not the
  classification §4b refuses. The document already draws exactly this line at
  lines 113-119: establish it from structure, *"not by reading the failure
  message"*. Distinguishing "the runner never ran this" from "the runner ran it
  and it failed" is a fact the runner reports; guessing whether a message
  *looks* environmental is not.
- **The first draft got this wrong in the other direction too**, saying a
  failure that "looks environmental" is not a proved red. That is
  auto-classification, which `vacuity.py:39-44` refuses by name (*"deliberately
  NOT auto-classified: a verdict that shows its working is the product"*). The
  environmental question stays disclosed, exactly as E1a ruled; the
  *collection* question is decided.
- **`run.prove_setup` becomes a hard precondition for the witness lane only.**
  This is a genuine tightening of E1a's disclosure ruling, scoped to witnesses,
  and it is declared as a tightening rather than dressed up as an inheritance.
  E1a's reasoning for repo gates is undisturbed.

**Born red is established on a HEAD worktree, not on the working tree.** The
first draft said the working tree "*is* the pre-change tree because the worker
has not run", and then said the HEAD worktree at proving time is the same tree.
Those agree only if the tree is clean, and nothing enforces that — `dirty` is
recorded everywhere and gated nowhere. Using the same
`git worktree add --detach HEAD` mechanism for born-red makes the identity true
by construction; `authored.tree_dirty` records the working tree's state so a
reader can see when they differed.

### W9 — The container collision is a binding input to Phase 2 — DECIDED

W3 makes `run.prove: true` a precondition of the witness lane. But
`vacuity.prove` returns `INCONCLUSIVE` unconditionally when
`execution.backend == "container"` (`vacuity.py:161-187`), because a detached
worktree's `.git` is a file and mounting it alone is a broken repository —
SPEC_EXEC §6 is titled for this collision.

Phase 2's containment mechanism is "the worker runs on the container backend".
**If containment lands on the existing `execution.backend` key, every witness
in the re-test is `inconclusive` and R2's committed pass measures nothing.**

**Ruled: worker containment must not be expressed through
`execution.backend`, or the prove pass's worktree handling is fixed first.**
Phase 2 owns the choice; it does not own the option of discovering this late.

### W10 — A witness may not pick WHERE the fix lives — DECIDED

*Added 2026-08-15 by `WRINGER_RULING_2026-08-15` (the fork ruling),
sub-ruling 2, through the amendment machinery this section already carries.
W1–W9 are untouched. Ruled on evidence rather than in the abstract: it is the
question the Phase 1 capture's §"The one catch, read honestly" left hanging.*

> **W10 — a witness must observe the criterion's stated symptom at the
> interface the criterion names; when the criterion states no location, the
> witness must not pin an implementation locus. A catch obtained by
> location-guessing is not creditable prevention.**

The measured case, from
[docs/witness-calibration-2026-08-15.md](../witness-calibration-2026-08-15.md)
Postscript 1. Issue #2703 describes a symptom **at the shell**: a completion
value containing a colon is mangled. It never says where the escaping belongs.
Upstream escapes in `format_completion` (Python); the salvaged agent change
escaped in the generated zsh script. The authored witness happened to test
`format_completion`, so it stayed red on the agent's change and was scored as
the calibration's single catch.

That is a coin landing the right way up, not prevention. A witness that had
probed the symptom end to end — the interface the criterion actually names —
would have had to decide the same question the criterion leaves open, and
would likely have gone green. **Under W10 the honest score for that stop
condition is 0, and the retired number was inflated rather than deflated.**

Why this is a rule and not a preference: a witness that pins a locus the
criterion does not state has silently added a requirement the PM never wrote,
and then evidences *that*. It manufactures false refusals against every
correct fix that lands somewhere else — which is the (b) failure mode, on
purpose this time — and its occasional catch cannot be distinguished from
luck by anyone reading the bundle. Both halves are the same defect: the
witness is no longer a check on the criterion.

**What this binds, concretely:**

- The authoring prompt must not be given, and must not infer, a fix location
  that the criterion does not state. Where the criterion names an interface —
  a CLI invocation, a shell completion, an HTTP response, a public function —
  the witness exercises *that* interface.
- A criterion that genuinely names an implementation locus is not caught by
  this: W10 forbids **inventing** a locus, never honouring a stated one.
- **This is authoring discipline, not a new runtime check**, and nothing here
  claims a mechanism enforces it. There is no automatic way to tell an
  interface-level witness from an implementation-level one, and pretending
  otherwise would be this repository's own recurring defect. It governs the
  author's instructions and the review of an authored witness, and it is the
  reason a location-lucky catch may never be reported as prevention.
- **Companion, from the same capture and the same ruling:** a witness that is
  red on *everything it is ever shown* — including upstream's own fix — is a
  witness defect, not a strict check. W8 governs it at authoring time. Live, a
  witness that never goes green across a whole run must surface through the
  existing refusal machinery rather than loop forever; Phase 3's design
  watches for it. Guidance, not a new mechanism.

### Non-goals of this amendment (binding)

Auto-installing a witness into `.wringer.yaml` · proposing witnesses through
the sidecar · a witness for a `human: true` criterion · more than one witness
per criterion · witness selection by a model · mutation testing of any kind
(the sole sanctioned future use is DEFERRED and not authorised this cycle) · a
`--no-witness` or any bypass, because flags tighten and never loosen · a new
top-level command · a third socket · wiring the witness into
`verify`/`vacuity`/`accept` (Phase 3) · emitting in-toto (Phase 4) · caching ·
judge calibration.

### Definition of DONE for the authoring slice (Phase 1)

- [ ] `wring spec --send --witness` authors a candidate witness per machine
      criterion, isolated per W2 — pinned by a test that reddens if the author
      is handed a reachable upstream or the worker's session
- [ ] `--witness` without `--send` refuses by name
- [x] **DONE 2026-08-15** — the two-socket property is enforced by
      `tests/test_network_surface.py`, which does **not** grep. This box asked
      for a grep on the fully-qualified call and **that repair does not work
      either**: correcting the three docstrings to name the qualified form
      made the qualified grep return five as well. *A grep count over a string
      is unstable under documenting the string, in every spelling.* The guard
      therefore parses each module, resolves every call through that module's
      own imports, and asserts both the owning functions
      (`{forge.request, judge.send}`) and the call count (2). Watched to fail
      three ways: a network call planted in a third module, a second call
      inside `judge.send` (which the owner assertion alone does not catch),
      and a document promising the grep again. No document promises a grep
      count now; they name the test
- [x] **DONE 2026-08-15** — the sender count derives from the CLI:
      `tests/test_docs.py::test_the_documented_sender_count_is_the_one_the_parsers_carry`
      walks the parser tree for `--send`/`--sign` (a subtree hit counts once,
      so `graph run`/`graph resume` make `graph` one sender) and compares
      every number-word count any document states, **in both directions and
      with no ceiling**. The capped regex it replaces is deleted from
      `test_nothing_claims_the_network_surface_is_smaller_than_it_is`, which
      keeps only the hand-kept phrasings that name no number. Watched to fail:
      `--send` added to an existing command — the command count stays 19, the
      whole rest of the suite stays green, and only this guard reddens; the
      old capped regex on the same tree returns no offenders at all
- [ ] the pin covers **bytes, command and materialisation path**; re-checked
      before every execution; a mismatch exits 3 and writes no verdict — pinned
      by a test per element, each mutating one and watching the run refuse
- [ ] `wring run` walks its own `loop.jsonl` with `attest.check_chain` before
      trusting a pin; a broken chain VOIDs
- [ ] materialisation refuses a symlink or an existing entry at the path, and
      VOIDs on write/removal failure
- [ ] **W8:** a witness whose pre-change failure is `collection_error` is
      discarded and its criterion reported uncovered — pinned by a test whose
      witness imports a module that does not exist, watching it NOT be accepted
      as a proved red
- [ ] born red is established on a HEAD worktree, and `authored.tree_dirty`
      records whether the working tree differed
- [ ] `witness.schema.json` published + frozen in the same commit; drift test;
      schema README row
- [ ] the loop brief carries the witness's failure output and **not** its
      source, path or command — pinned against a **witness-present fixture**
      whose full outline is asserted. The first draft named
      `tests/test_run.py:596` as the tripwire; that test is the *no approved
      spec* case, so no witness can ever appear in its brief and the box could
      not fire. The real ones are `tests/test_run.py:767` and `:791`
- [ ] the offline calibration result, published whichever way it lands: the
      ruling's three numbers, **with the 5-task ceiling on (c) and the
      contaminated/clean split stated beside them** — 14 wrong changes with
      patch content, of which only **7 come from the uncontaminated run 2**, so
      (c) is scored on single digits where 80% moves in large steps

### Limits, stated here rather than discovered later

- **A manufactured fail-to-pass witness is necessary and demonstrably not
  sufficient.** UTBoost found 345 erroneous patches passing curated tests;
  PVBench found >40% of patches failing the developer's own PoC tests. *(Both
  figures are inherited from the ruling and were not independently verified
  here.)* The witness raises the floor. It does not license "delivery is safe".
- **A witness evidences one criterion**, and says nothing about the rest.
- **The author is a model, and a model can write a witness that passes for the
  wrong reason.** W8 closes the loudest case (red for a load failure). It does
  not close a witness that collects, fails, and tests something adjacent to the
  criterion.
- **Phase 1's numbers are an UPPER BOUND on live behaviour** (W5), because
  offline calibration scores witnesses against workers that never saw one.
- **The pin is tamper-evident, not tamper-proof** (W4), and becomes a boundary
  only under Phase 2.
- **There is an unprotected window between authoring and pinning.** R1.3 says
  the bytes are pinned "at authoring time"; `wring spec` has no hash-chained
  ledger — `prev_hash` appears in `loop`, `deliver`, `fleet`, `graph`, `bench`
  and `evidence`, and not in `spec.py`. The authored digest is recorded in the
  spec bundle and `wring run` refuses when the bytes differ, which satisfies
  the intent; the window itself is a limit and is declared in W7.
- **Nothing here enforces sequencing.** Finding 9's correction stands: the
  guarantee is the recorded pin and the recorded receipt, not the order.

### W7 — Where this amendment corrects the ruling document — DECIDED

Named rather than silently reconciled. The first draft declared three; the
review found two more, and an undeclared divergence is the drift this
repository exists to catch.

1. **The author cannot live on `wring run`.** The ruling leaves the host open
   and names the no-20th-command ceiling and the typed-send law. A third
   constraint decides it: `run` proves, and the published claim is that it
   cannot reach a model.
2. **"Vacuity triggers manufacture" is not implementable as written.** The
   ruling's §2 sentence, quoted verbatim in the first draft, requires knowing
   at authoring time that a criterion's gates cannot discriminate — unknowable
   at `wring spec` time (W2). **Manufacture is unconditional; vacuity triggers
   CONSULTATION.** The ruling's intent survives; its trigger wording does not.
3. **The pin cannot happen "at authoring time".** R1.3 says the ledger; `spec`
   has none (see Limits). Pinning moves to the first `wring run`, with a
   digest recorded at authoring to cover the window.
4. **`not_evidenced` is not a state in this program.** The taxonomy is
   `evidenced` / `unevidenced` / `gate-failed` / `human` / `gate-did-not-run`
   (`accept.py:54-63`). The word is **`unevidenced`**. This applies in **two**
   places in the ruling, not one: Phase 3's text *and* **R2's README sentence**
   — the copy R2 commits to publishing. Fixing only the first would ship the
   wrong word in the README.
5. **"Six known-wrong changes" was low, and the useful number is smaller than
   the correction.** The salvage recovered **15 rows labelled
   `false_confidence`, 14 with patch content**, spanning **5 of 13 tasks** — but
   only **7 of the 14 come from the uncontaminated run 2**
   (`benchmark/corpus/results/patches/README.md`). Stop condition (c) is scored
   on that overlap.
6. **The pre-dating guard fails OPEN for a witness, and the first draft called
   it neutral.** `created_stems` reads `state.untracked` (`accept.py:236-241`);
   `.wringer/` is gitignored, so a witness never appears there,
   `_arrived_with_the_change` returns None (`accept.py:244-256`) and
   `_assess_one` falls through to EVIDENCED. Temporally that answer is
   *correct* — the witness genuinely did not arrive with the change — but it
   establishes nothing about **why** the witness was red, which is all that
   guard was ever about. W8 is the witness's version of it. "The pin plus
   `authored.base_sha` is strictly more checkable" was the wrong comparison:
   those establish *that* and *when*, never *why*.
7. **`wring resume` is in scope and the first draft never mentioned it.** It
   proves, and a resumed loop that neither pins nor re-verifies would execute an
   unpinned witness. Resume re-checks the pin before any execution, on the same
   VOID rule.

### §6a — The independent review, folded

*One agent, 2026-08-15, neither the drafter nor the builder. Seventeen
findings. Its verdict on the design was that it is fundamentally right; every
finding below is about a claim, a guard, or a gap, not about the shape.*

| # | severity | finding | resolution |
|---|---|---|---|
| 1 | HIGH | "the proving mechanism is already shipped" is false — nothing can execute a witness on either tree, and no receipt source exists | W3 rewritten as an honest shipped/missing table; Phase 1 calibrates in the benchmark harness and builds none of the missing pieces; `acceptance.v2` cost named in W6 |
| 2 | HIGH | the `prev_hash` integrity claim is contradicted by `evidence.py:462-476`; the chain is tamper-evidence, and it is not walked at pin-read time | W4 rewritten and downgraded to its true strength; `attest.check_chain` added to the pin path and to DONE |
| 3 | HIGH | trigger and host are temporally incompatible — coverage is unknowable at `wring spec` time | W2 ruled: authoring unconditional, vacuity selects. Declared as W7.2 |
| 4 | HIGH | a witness red for `ModuleNotFoundError` re-opens the hole this document closed; the guard fails open, not neutral | **W8** added; W7.6 corrects the "neutral" claim |
| 5 | MED-HIGH | "looks environmental" mandates the auto-classification `vacuity.py:39-44` refuses | W8 replaces it with the structural collection/assertion distinction; the `prove_setup` precondition is declared as a scoped tightening |
| 6 | MEDIUM | born-red on the working tree ≠ the HEAD worktree when the tree is dirty | W8: born red runs on a HEAD worktree; `authored.tree_dirty` recorded |
| 7 | MEDIUM | the named brief tripwire cannot fire — `test_run.py:596` is the no-approved-spec case | DONE box rewritten to name `:767`/`:791` and to require a witness-present fixture |
| 8 | MEDIUM | the sender-count guard only catches understatement and its regex stops at "four" | DONE box now requires a guard deriving the count from the CLI |
| 9 | MEDIUM | `grep -rn build_opener src/` returns five, not two; nothing enforces it | W2.1 corrected to the literal-call grep; DONE box adds the missing test. **BUILT 2026-08-15, and the correction was itself wrong**: the literal-call grep returns five once the docstrings name it. The property cannot be a grep in any spelling and is now parsed — `tests/test_network_surface.py` |
| 10 | MEDIUM | container backend makes `--prove` `INCONCLUSIVE`, killing the lane in exactly Phase 2's configuration | **W9** added as a binding input to Phase 2 |
| 11 | MEDIUM | the authored→pinned window is unprotected; `spec` has no chained ledger | declared in W7.3 and in Limits; authored digest recorded and re-checked at pin |
| 12 | MEDIUM | the pin covers bytes but not the command or path; materialisation failures unruled | W4 extends the pin to all three and rules the symlink/overwrite/failure cases |
| 13 | MEDIUM | the contamination split was imported without its warning | W7.5 and the DONE box now carry 7-of-14 uncontaminated |
| 14 | MEDIUM | disclosure is not benign here, and Phase 1 cannot measure it | W5 rewritten; "upper bound" added to Limits |
| 15 | LOW | six citation ranges point at the wrong lines | corrected throughout |
| 16 | LOW | human criteria appear by id ALONE, not id and title | W5's precedent corrected |
| 17 | LOW | `not_evidenced` also appears in R2's README sentence; `wring resume` unaddressed | W7.4 and W7.7 |

**What the review checked and found SOUND**, named so that an unexamined area
and a held one do not read alike: `spec.py:25` verbatim and the no-new-socket
property; `README.md:98` verbatim and every row of the host-elimination table;
`loop-event-v2` as a closed eight-branch `oneOf` and the v3 route as
well-aimed; `--prove` skipping optional gates; the prove worktree's
tracked-files-only invariant and the packaging derived from it; acceptance
identity as `(id, command)` and the claim that a pinned witness is the first
check whose identity covers its content; `.wringer/` gitignored; `EXIT_REFUSED`
= 3 and the reasoning for it over 1 and 2; the 19-command ceiling (counted:
exactly 19); W7's taxonomy correction; W7's salvage arithmetic (recomputed
independently from the manifest); W6's schema-additivity claim and its three
named guards; stop-list compliance including the `judge.send`-transport
distinction; and that W1 contradicts neither ruling 2 nor SPEC_GRAPH ruling 1.

### §6b — What Phase 3 BUILT, and what it deliberately did not — 2026-08-15

*Appended by the implementing window rather than woven in, so a reader can see
the boundary between what W1–W10 specified and what exists. Nothing above is
edited.*

**Built and driven end to end** (`witness.py`, plus its wiring in `cli.py` and
`loop.py`):

| clause | state |
|---|---|
| W1 — Wringer's own check, never a repo gate, lives under `.wringer/` | **built** |
| W2 — authoring is a send on `wring spec --send --witness`, unconditional over machine criteria; `--witness` without `--send` refuses by name | **built** |
| W3 — Phase 1 built no proving path; this window built execution and comparison | **built** |
| W4 — the pin covers bytes, command AND materialisation path; re-checked before every execution; a mismatch VOIDs; `attest.check_chain` walks the ledger before a pin in it is trusted; materialisation refuses a symlink and refuses to overwrite | **built** |
| W5 — the brief carries the failure OUTPUT, never the source, path or command | **built** |
| W6 — `witness.schema.json` / `wringer.witness.v1` as a sibling artifact | **partial — the record is written and versioned; it is not yet in `schema/` with a drift test** |
| W8 — born red on a HEAD worktree; a `collection_error` is not a proved red | **built, and strengthened** — see below |
| W10 — the authoring instruction forbids inventing a fix location | **built** |
| Phase 3 — delivery consumes the witness through the SPEC_ACCEPT taxonomy | **NOT BUILT** — see below |

**W8 gained a second half that the spec did not anticipate, and it matters.**
W8 derives "the runner could not LOAD it" from the runner's structure, and the
exit code delivers that for a module-level import error (exit 2) against a real
assertion (exit 1). **An import inside the test body defeats it**: the module
collects fine and the test fails at exit 1, indistinguishable by exit code,
while carrying exactly the property W8 refuses — it turns green the moment any
file of that name exists with any content. This was not theoretical: the first
draft of the authoring instruction *told* the author to move imports into the
body in order to dodge collection errors, which would have converted every
witness W8 discards into one it accepts. The discriminator is now the exception
CLASS taken off the runner's own report object, which is a fact the runner
states about its run in the same sense the exit code is — **not** the failure
message, whose auto-classification `vacuity.py:39-44` refuses by name.

**Delivery is NOT wired, and the reason is a version, not an oversight.** A
criterion covered only by a witness must be able to REFUSE delivery or the lane
is decorative. `acceptance.json`'s published v1 says in its own field
description that only a *bound* criterion can refuse, and the row shape is
`additionalProperties: false` — so a row reading `gate: null, refuses: true`, or
a receipt of a new kind, is a silent break for every existing reader. **W6
already named this: Phase 3's receipt costs `wringer.acceptance.v2`.** That is
the next slice and it is specified; landing it under time pressure would mean
freezing a schema in a hurry, which is the one mistake in this repository that
cannot be walked back.

**So the live re-test did not run, and no money was spent.** The hard gate it
sits behind was PASSED — sequence I is green against a contained ACP worker
with both control arms beside it — but a pass over the corpus measures §5's
clauses only if delivery consumes the witness, and it does not yet. A pass run
now would have spent the one authorised pass to measure nothing, which is §5.5's
own warning arriving one slice early.

### §6c — The independent review, and the four HIGH findings it folded

*One agent, 2026-08-15, over the finished slice, instructed to refute; neither
the drafter nor the builder (the no-fleets rule). **Verdict on the witness lane:
NOT SOUND — three of its four load-bearing claims did not hold as built.** Every
finding below is folded; none is rebutted. The review is recorded here in full
rather than summarised, because a NOT SOUND verdict that gets paraphrased into
a footnote is the drift this repository exists to catch.*

| # | sev | the finding | resolution |
|---|---|---|---|
| 1 | HIGH | **The pin was a tautology.** `pin()` built its digest from the in-memory `Witness` and `check_pin()` compared that same object's digest back against it — the same field of the same object, so it could not fail. The source was read from disk exactly once, before the first worker turn; every later "re-check" re-checked a value against itself. Measured: a worker that rewrote the witness mid-loop passed (`9065b312e262` pinned, `e0d5bd480a37` on disk, `check_pin: PASSED`). `executed.matches_pin` was the literal `True`, which W6 calls "the comparison that VOIDs a run" | `witness.on_disk_sha256` added; `check_pin` takes `root` and re-hashes the FILE immediately before it runs; `matches_pin` is now measured. Pinned by `test_the_pin_is_compared_against_the_BYTES_ON_DISK`, which rewrites the file on disk and watches the VOID |
| 2 | HIGH | **The lane emitted two event types the frozen `loop-event-v2` forbids.** `type` is a closed enum of eight with `additionalProperties: false` on every branch, so every bundle with a witness lane wrote a ledger failing its own published schema. `loop.py` says this itself 375 lines above, declining a containment event for that exact reason, and W6 named the cost in advance | both events removed. The facts live in the sibling `witness.json`, on the `vacuity.json` pattern, which costs no version. `loop-event-v3` is still owed and is still to be designed ONCE, carrying this and the staleness rider's stale-marking event. Pinned by `test_the_lane_emits_no_event_the_frozen_ledger_schema_forbids`, which derives the permitted set from the schema |
| 3 | HIGH | **W8 accepted `FileNotFoundError`, and W10 was steering authors into it.** W10 mandates exercising the interface the criterion names; on a pre-change tree a witness that shells out to a tool which does not exist yet raises `FileNotFoundError` at exit 1 — classified `assertion`, while carrying W8's defining property verbatim: green the moment any binary of that name exists | `FileNotFoundError` and `NotADirectoryError` added to `LOAD_FAILURES`. `AttributeError` stays out, deliberately. The asymmetry is stated: discarding costs a criterion its coverage and sends it to a human, which is safe; accepting a bad witness manufactures evidence, which is not |
| 4 | HIGH | **The lane was inert under containment — the one configuration the re-test needs.** `RUNNER[0]` is `sys.executable`, a host path absent from the image, so the contained branch exited 127, `classify` read that as `collection_error`, every witness was silently discarded and every criterion reported uncovered — while the docstring claimed the lane ran inside the boundary | `CONTAINED_RUNNER` resolves `python3` on the image's PATH; a 127 under containment now RAISES by name rather than being classified, because a criterion must never be reported uncovered for a reason that is not about the criterion |
| 5 | HIGH | **The isolation-ledger guard's key collapsed two rows**, so the contained-ACP run was absent from `SECURITY.md` and the guard did not fire — the counter-example landing one commit after the guard | the key gained a fifth part, the spawn shape; `SECURITY.md`'s table gained the ACP row and a `worker` column. This was my own guard failing at exactly the thing it was written to catch |
| 6 | MED | the brief's "failure output" is a pytest progress bar, and W5's "carries the failure" half has no assertion | **open, and named** — see §6d |
| 7 | MED | a containment widens the ACP agent's environment beyond `env_passthrough`, and A-6 says the opposite | **open, and named** — the union may be right, but the spec must say so; §6d |
| 8 | MED | `README.md:298` says the witness lane is "not in this code yet", which this slice made false | **open, and named** — §6d |
| 10–11 | MED | A-5 has no test; refusal 4 starts a container while `preflight`'s docstring says it starts none | **open, and named** — §6d |
| 12 | MED | `witness.json` is written without the redactor and is not in `schema/frozen.json` | **open, and named** — §6d |
| 13 | MED | "the constant-yes broken" is not supported: nothing outside the lane reads a witness | **accepted, and it is the same fact §6b already records.** Delivery is not wired, so a failing witness changes no verdict. The claim belonged in a commit that could support it |
| 14–20 | LOW | fail-open digest when `authored.sha256` is absent; a `//` path edge; laundering windows in `HISTORY_MARKERS`; an AST guard whose name outruns its body; a misattributing refusal message; an unused `redactor` argument; `.wringer-witness/` not gitignored | **open, and named** — §6d |

**What the review checked and found correct**, recorded so an unexamined area
and a held one do not read alike: the containment boundary is built once and
both tails derive from it; path translation genuinely leaves confinement
unchanged under `..`, symlinks, absolute paths and the `/workspacex` prefix; no
shipped route runs a contained ACP worker uncontained; sequence I's ACP arm
drives the shipped mechanism and wraps the same probe rather than a second copy;
`backend.LIMITS_V1`'s new sentence is TRUE against the coverage record; the
ledger guard's completeness forcing is real in both directions; Q1's claim
ceiling is respected in every artifact it looked at; `vacuity.py:162` and
`execution.backend` are untouched; and the two defects found by driving the lane
— the `__pycache__` cleanup bug and the body-import hole — are correctly fixed
and pinned.

### §6d — What is still open, named rather than left to be found

The five HIGH findings are folded. **The MEDIUM and LOW ones are not**, and
they are listed here rather than quietly carried:

1. `_first_meaningful_line` returns pytest's progress bar, so the brief's
   witness line and the mandatory `proved_red.first_line` citation are both
   uninformative. W5's *"carries the failure"* half has no assertion.
2. The env union under containment contradicts A-6's text. The union is
   probably right; the spec has to say so, or the code has to narrow.
3. `README.md` still says the witness lane is not in this code.
4. A-5's derived `worker_requires` has no test; deleting it reddens nothing.
5. `containment.preflight` starts a container while its docstring says it does
   not, and A-5 made that universal for ACP repositories — every verify lap.
6. `witness.json` bypasses the redactor and is absent from `schema/frozen.json`.
7. The `authored.sha256` check fails open when the field is absent or empty.
8. `.wringer-witness/` is not gitignored, so a SIGKILL mid-execution leaves
   model-authored Python in the working tree where `created_stems` reads it.

**None of these is a claim this repository is currently making.** Each is a gap
between what the lane does and what a careful reader would assume — which is
exactly the register this file is supposed to keep.

### §6e — What the FIRST real corpus task found, 2026-08-15

*Recorded before any money was spent on a full pass, because one task's
validation found two things that would have destroyed it. Both are measured,
not predicted.*

**1. A real agent read Wringer's witness and rewrote it.** On
`marshmallow-constant-required`, the agent opened
`.wringer/witness/test_witness_issue.py` and replaced `pytest.warns(None)` —
removed in pytest 8 — with a `catch_warnings` block, adding the import. A
helpful, competent edit. The pin caught it and the run VOIDed by name:

    the witness for `issue` does not match the digest its author recorded
    (1bc9b81aeffc != 53b57acc1df2)

**W4 worked.** The tamper-evidence this lane was built around fired on the
first real agent it ever met, which is the strongest evidence the mechanism has
ever had. It is also unusable as-is: §5's void rule invalidates a pass at three
VOID rows, and an agent that tidies a check it can see will do this on most
tasks. W5 always said the worker gets the failure output and never the source,
and said in the same breath that this is *a rule about what Wringer hands over,
not a sandbox*. That sentence was exactly right and the agent proved it.

Fixed for the CONTAINED case: the worker container now gets an empty anonymous
volume where the witness bytes live, so `ls` shows nothing, `cat` finds
nothing, and a write lands in a volume that is discarded. Measured.

**2. The fix is not enough, because the turn that matters is not contained.**
`benchmark/harness.py`'s arm B runs the agent through `do_the_work` FIRST —
the identical call arm A makes, deliberately, so that *"the arms differ only in
supervision"* is a fact about the code — and only then runs `wring run`.
**Containment therefore covers the repair loop's worker turns and not the
primary turn**, which is the one that does the work, holds the shell, and has
the network.

For R-C that is decisive: the contamination channel it exists to close is open
during exactly the turn the channel matters in, and the witness bytes are
reachable from it on the host, where no mount can shadow them.

**Two options, and the choice is not an implementer's.**

- **Contain arm B's primary turn too.** Honest, and arguably right —
  containment IS part of supervision. It changes what the arms differ by, which
  is a change to the experiment's design and belongs to whoever owns the
  experiment.
- **Move the witness bytes out of the repository entirely.** W4 put them under
  `.wringer/` because the pre-change worktree carries tracked files only; a
  path outside the repo satisfies that reasoning better and is unreachable by a
  contained worker AND by an uncontained one that stays in its tree. Packaging
  is explicitly free under the 2026-08-14 ruling §6, so this one IS an
  implementer's — but it does not by itself close R-C's channel, which is the
  first option's job.

**No corpus pass was run and the $38 was not spent.** Validating one task cost
a few cents and found both of these. A pass launched without it would have
produced VOID rows on most tasks and burned the single authorised run.

### §6f — What Phase 4 BUILT, and the four rulings it executed — 2026-08-16

*Appended rather than woven in, like §6b, so the boundary between what W1–W10
specified and what exists stays visible. Nothing above is edited. The rulings
executed here are P4-1 through P4-6 of the 2026-08-15 Fable block; they are
restated where they land rather than paraphrased.*

**P4-1 — the loop engages while a pinned witness is red.** This is the largest
item and it is the one that made the money worth spending.

`loop.py`'s continuation predicate was `final.passed` — gates only. `CORPUS.md`
§3 selects tasks whose declared gates do NOT cover the issue, so on every corpus
task the gates are green at base, so every loop converged at iteration 1 having
briefed nobody. **`WRINGER_RULING_2026-08-14` §5.3 was therefore unsatisfiable
as built**: it requires a row where the repair loop ran ≥1 worker turn with a
red witness converting to green, and the shipped loop could not produce one on
this corpus in any circumstance. The measured zero-worker-turns-in-26-attempts
result, rebuilt one layer up, and it would have consumed the single authorised
pass measuring nothing.

A usable witness that is red on the changed tree is now **work to do**. What
changed, exactly:

| | |
|---|---|
| the predicate | `final.passed and not outstanding`, where `outstanding` is every REQUIRED criterion whose usable witness has not converted |
| where `required` comes from | the acceptance row, never recomputed — `accept.Row` already decides it, and a second reader of one fact is a second thing to keep in step |
| `verify.Outcome` | gains `acceptance`, for the same reason it carries `vacuity` and `stability`: a caller cannot say what a run did if the outcome does not tell it |
| the brief | carries the CURRENT failure, not the born-red one. A worker on lap 3 needs what the check says about lap 3's tree |
| budgets | **unchanged.** `max_iterations`, the wall clock and the worker timeout are the same numbers doing the same job |
| new stop reasons | **none**, and this is asserted against `cli._LOOP_ENDINGS` rather than by inspection |

**Anti-thrash covers this path, and it is the constraint the ruling attaches.**
`failure_signature` returned None whenever `failed_gate` was None — which is
every lap of a red-witness-green-gate run. Without a signature the breaker is
blind, `no_progress` is the only stop left, and a worker that changes something
irrelevant every turn runs to the ceiling every time. The witness's failure now
feeds the same signature the gates feed, normalised by the same `_normalize`.
So a witness that never converts ends through `no_progress` or `oscillating`,
and then refuses at delivery — which is W10's companion clause ("surface through
the existing refusal machinery rather than loop forever") made concrete rather
than restated.

**The two required drives, both offline, both in `tests/test_witness_loop.py`:**

1. vacuous gate green + witness red → ≥1 real worker turn → the witness converts
   → `wring deliver` says yes;
2. the same scenario with a mid-loop tamper → **VOID, exit 3, refused by name**,
   with a second test proving the tamper landed on the SECOND lap so that what
   is measured is the re-check rather than the first-lap check.

*One thing found while driving them, recorded because it would otherwise be
invisible: `accept.read_spec` is total by construction — a spec it cannot parse
is treated as one that is not there, silently. A `tasks: []` typo in the fixture
sent every test in the file down `_unconverted`'s no-acceptance fallback, where
the loop still engages, so they all passed while measuring the wrong branch. The
only symptom was a delivery that said yes. The fixture now asserts the spec
parses before anything else runs.*

**P4-2 — arm B's PRIMARY turn is contained; arm A stays uncontained.** §6e
measured that containment reached the loop's repair turns and not the agent's
own turn — the one that does the work, holds the shell and has the network.
`benchmark/harness.py` now establishes the declared boundary around the primary
turn, through the same `session_argv` path `loop.py` uses, and tears it down
before `wring run` establishes its own. Arm A is deliberately untouched: it is
the control, what a caller without a harness gets, and containing it would make
it a different arm rather than a fairer one.

**The registered meaning of the arms changed, and every row says so.** The
deviations no longer carry *"the arms differ only in supervision"* unqualified.
They carry, in both arms: *arm B's supervision INCLUDES the boundary; arm A runs
uncontained on the host by design.*

**P4-3 — the witness store leaves the repository; the shadow mount is removed.**
The bytes of record lived at `<root>/.wringer/witness/`. W4's reasoning for that
was right about the constraint — the pre-change worktree carries tracked files
only — and wrong about the destination: `.wringer/` is inside the repository,
and the repository is what an agent is pointed at. §6e measured the consequence
on the first real task.

The bytes now live in a store outside every repository root, keyed
deterministically off the resolved repo path (`witness.store_dir`;
`WRINGER_WITNESS_STORE` overrides the base, and the suite sets it so no test
writes into a developer's real state directory). Materialisation moved from a
top-level `.wringer-witness/` to `.wringer/witness` — already gitignored by
`wring init`'s own entry, already outside anything `created_stems` reads — which
closes §6d item 8 as a consequence of the move rather than as a separate patch.

**The anonymous-volume shadow mount is GONE**, and its absence is the fix. It
protected the witness from a CONTAINED worker only, while arm B's primary turn
ran on the host where no mount of that container's reaches. A boundary over a
path that no longer holds bytes is dead code that reads as protection.
`containment.py` imports nothing from the witness lane again, which makes R-6
whole: it carried one narrow exception for exactly this mount.

*The honest residual, kept where the mount's comment was: an uncontained worker
on the host can still reach the store if it goes looking. Deriving a path is not
hard and a path is not a boundary. What the move buys is that no agent reaches
the witness by tidying up its own tree, which is the failure that was measured.
The pin stays tamper-EVIDENCE; the container is the boundary.*

**P4-4 — the containment flag tells the truth per turn.** A row reported
containment by searching its own `.wringer.yaml` for the substring
`"containment"`. That is a statement about a config file: it says the repository
ASKED for a boundary, not that one existed — *"a run claiming a containment it
did not have"* is the exact shape SPEC_CONTAIN_V0 ruling 4a was written against.

A row now carries `containment: {primary, loop, declared}`, reported as
ESTABLISHED and per turn: `primary` from what the harness actually stood up,
`loop` read off `execution.json`'s `worker_execution.established` block. A
`DECLARED_BUT_NOT_ESTABLISHED` in either **stops the pass** —
`check_containment_is_real` raises, and it is a gate failure rather than a
deviation, because an uncontained row can be discounted by a reader and a row
that misreports cannot be. The row schema moves to `wringer.benchmark.v6`: every
v5 row was produced while the primary turn ran on the host, and the field a v5
row is missing is the §5 PRECONDITION.

**P4-5 — the eight §6d items, closed.**

| # | what it was | what closed it |
|---|---|---|
| 1 | `first_line` was pytest's progress bar, so the mandatory `proved_red` citation and the brief both read `F [100%]` | the citation is the `E` line out of the runner's own log — the failure as pytest renders it — with the path and filename SCRUBBED rather than merely avoided. Citation text, not classification: W8's discriminator is still the exit code and the exception class |
| 2 | the env union under containment contradicted A-6 | A-6 AMENDED, dated, original preserved. The union is ruled and the code is right; an intersection makes a name a human typed silently inert, which is refusal 11's defect class through the back door |
| 3 | `README.md` said the lane was not in this code | corrected as a truth correction in its own commit, BEFORE any of this — and corrected in both directions, because it now also says the live re-test has not happened |
| 4 | A-5's derived `worker_requires` had no test; deleting it reddened nothing | three tests, asserting the set handed to the PROBE rather than a refusal string — a guard on the message would still pass if the derived name were checked and then dropped |
| 5 | `containment.preflight` starts a container while its docstring said it does not | corrected where it lives, in the docstring and in ruling 3, dated. STATIC means **no packet and no DNS**, which is what `SECURITY.md`'s row and §7's promise actually rest on, and both remain true |
| 6 | `witness.json` was published-in-effect and absent from `schema/` | `schema/witness.schema.json` written, frozen in `frozen.json`, rowed in `schema/README.md`, and drift-tested against records a REAL run wrote — both shapes, converted and discarded. (The redactor half of this item was already fixed.) |
| 7 | the `authored.sha256` check failed OPEN when the field was absent or empty | it VOIDs. Deleting a field is strictly easier than forging a digest, so a fail-open check is one that anyone who can edit the record switches off by removing a line |
| 8 | `.wringer-witness/` was not gitignored | subsumed by P4-3's materialisation move |

*One thing tightened beyond the list: `materialise` checked for a symlink at the
leaf only, and P4-3 made the path nested. A symlink at `.wringer` redirects the
write exactly as one at `.wringer/witness` does, and `mkdir(parents=True)` would
follow it. Every component is checked, with one test per component.*

**P4-6 — the witness author needs no containment machinery, and this is
recorded so nobody builds it.** `establish(party="author")` is NOT built and is
not owed. The author's isolation is what it is SHOWN: the criterion, a filtered
path listing, no tools, no tree access, no fetch capability. It is one LLM call
that returns text. The `party` parameter stays on `establish` because removing
it would be a rewrite, and the held-out filter on the path listing stands as
shipped. There is nothing here for a boundary to bound.

**What is NOT in this slice, named rather than left to be found:**

- R3's in-toto emission. Unbuilt at the time of writing; it is Phase 4's own
  later step and rides the release path.
- `loop-event-v3`. Still owed, still to be designed ONCE, carrying the witness
  facts and the staleness rider's stale-marking event together. Nothing in this
  slice emits a new event type; `test_the_lane_emits_no_event_the_frozen_ledger_schema_forbids`
  still derives the permitted set from the schema.
- The flaky-witness limit. A witness that is nondeterministic across laps ends
  through the existing stops — the signature moves, the breaker does not fire,
  and `max_iterations` bounds it — but nothing DETECTS it the way
  `stability.py` detects a flaky gate, and no row would say so. Banked and
  named; not built.

### §6g — The independent review of the Phase 4 slice, and its fourteen findings

*One agent, 2026-08-16, over `ef07f97`, instructed to refute; neither the
drafter nor the builder (the no-fleets rule). **Verdict: NOT SOUND — two of the
four load-bearing claims did not hold as built.** Every finding is folded; none
is rebutted. Recorded in full rather than summarised, on §6c's precedent: a NOT
SOUND verdict paraphrased into a footnote is the drift this repository exists to
catch.*

**What the reviewer did that reading could not.** It applied nine mutations —
deleting or neutering each mechanism in turn and running the suite — and the two
HIGH findings against §6f's own claims both came out of that, not out of
reading. This is now the second review in a row where mutation found what
inspection did not.

| # | sev | the finding | resolution |
|---|---|---|---|
| 1 | HIGH | **The W5 scrub was live and entirely untested.** Replacing the body of `_without_the_witness` with `return line.strip()` left the witness suite at 51 passed, 0 failed. `test_the_brief_carries_the_failure_and_never_the_path_or_command` asserts the path is absent — but its fixture fails on `assert 1 == 2`, a line that never contains a path, so it pinned the COINCIDENCE its own docstring says it refuses to rely on | a fixture whose failure MESSAGE carries the path and the filename, which is the one arrival no choice of line can dodge. Mutation-checked: neutering the scrub now turns it red |
| 2 | HIGH | **The citation regressed to `F [100%]` under `FORCE_COLOR`/`PY_COLORS`.** `execute` passes `{**os.environ, …}`, so pytest wraps its progress line in ANSI, and an ANSI-prefixed line matched neither pattern. §6d item 1 reopened by one environment variable — and many CI images set it by default | `--color=no` on both runners AND an ANSI strip before any pattern is applied: the flag closes the environment's route in, the strip closes every other. Pinned for both variables |
| 3 | HIGH | **An honest VOID arm aborted the task and threw away the other arm's paid row.** A failed primary turn means no `wring run`, so no loop record, so `no_record` — which the guard's allowlist rejected. §5 tolerates three VOIDs per pass; this turned the first into a hard stop, and `main` returned before `write_rows`, discarding an agent turn that had already been billed | the guard fires on the SCORED path only, its allowlist admits every state that means *no worker turn ran* (`no_loop`, `no_worker_turns`, `no_record`), and `main` writes the rows it already measured before stopping |
| 4 | HIGH | **`loop_containment` accused `wring verify` of running an uncontained worker.** It globbed every `execution.json` in the tree, and `backend.py` says in its own words that three of its four callers never start a holder — so a bare `wring verify` writes `declared` with no `established` and is indistinguishable, to a glob, from a loop that failed to contain its worker. One verification in the tree, by the agent or by a person, would have stopped the pass | the join goes through the LOOP's own ledger — `verify.finished`'s `evidence_dir`, required by `loop-event-v2.schema.json` — so it reads the laps that loop ran and nothing else |
| 5 | MED | **`**item.record` re-opened the drift failure §6f cites as its own reason to exist.** The store's record is splatted into a bundle row closed with `additionalProperties: false`, so one extra key in the store writes a bundle failing its own published, frozen schema | named fields, never a splat. The schema being frozen is what would have made a future store field trigger this |
| 6 | MED | `primary = "established"` was set without checking what `establish_for_primary` returned — a fail-open on the one field P4-4 exists to make honest | derived from the return value |
| 7 | MED | **Nothing enforced that the store is outside the repository**, and the mount that used to cover that case was deleted on the strength of it. `HOME`, `XDG_STATE_HOME` or the override pointing at the repo root all put the bytes back inside — and `HOME=<repo>` is an ordinary container shape | `store_dir` REFUSES, naming the variable to change. Not a silent relocation: moving bytes somewhere the operator did not choose is its own surprise |
| 8 | MED | **The console said something false on the witness path.** Three `_LOOP_ENDINGS` sentences say *"the gates still fail"*; on the corpus shape P4-1 exists for the gates are GREEN and only the witness is red. Observed verbatim over a `run: "true"` gate | the sentences name "the checks", which covers both and stays true in the case they were written for; and `_report_loop` now NAMES the outstanding criterion, so nothing is lost to the generality |
| 9 | MED | `_normalize`'s comment claimed it strips "a timestamp or a path"; it strips neither UUIDs nor absolute paths outside three prefixes | the comment now states exactly what is stripped and what is not, and points at the flaky-witness limit §6f already banks. The behaviour is bounded by the iteration ceiling and is unchanged |
| 10 | MED | `pytest.fail(msg, pytrace=False)` and a strict `xfail` emit no `E` line, so the citation fell back to pytest's `____ test_it ____` separator — always present, never says anything, and `pytest.fail` is a plausible idiom for a model-authored witness | separators are noise; the body line is preferred; the short-summary line is the last resort. (pytest TRUNCATES its own short summary — measured while writing the test — which is why the body outranks it) |
| 11 | MED | A criterion id containing `/` or `..` escaped both the store and the tree, and `clean()` would then delete outside the tree — exactly what `materialise`'s own comment warns of | refused by name. Not slugified: a silent rewrite would break the id-keyed join to `acceptance.json` |
| 12 | LOW | A row where NO worker ran carried *"THE WORKER RAN UNCONTAINED"* | the deviation appears only when a worker actually ran outside a boundary |
| 13 | LOW | Arm A and arm B rows carried different `containment` key sets, so `row["containment"]["declared"]` raised on every arm A row | the same keys in both arms |
| 14 | LOW | ~~test_a_repository_with_no_witness_lane_is_byte_for_byte_unmoved~~ (**UNGUARDED 2026-08-30** — this name resolves to no test; the claim above is stated and not checked. Not re-pointed at a near-miss, which would close the hole in the reader's mind and not on disk) compared no bytes | renamed to what it actually pins, and a second test compares the signature against a REIMPLEMENTATION of the pre-P4-1 algorithm — written out rather than imported, because importing the shipped one is how the pin became a tautology last time |

**What the review checked and found CORRECT**, recorded so an unexamined area
and a held one do not read alike. **P4-1 holds**, and by mutation rather than by
reading: reverting the predicate turns six tests red; removing the `required`
filter turns one red; making `failure_signature` blind to witnesses turns the
breaker test red and the loop then runs to its ceiling. Every exit from the loop
is bounded and a nondeterministic witness costs the budget and terminates — it
cannot wedge. Absence is absence: `failure_signature` with no lane produces a
hash byte-identical to a reimplementation of the pre-commit algorithm. **P4-3
holds** for the shipped configuration — the mount is gone from both spawn
shapes, `containment.py` carries no witness identifier at all, `store_dir` is
stable under a symlinked root and a relative path, and reverting it turns eleven
tests red across three files. The corpus trees resolve outside every mount.
**Law 7 holds**: addition only, and the recorded digest matches the bytes. **The
Q1 ceiling holds** in every artifact the review looked at, and both truth
corrections are correct in both directions.

**What it could not reach**, named rather than left to be assumed: the full
suite (it timed out waiting; the three files under review ran 106 passed), live
containment under podman, `wring resume` end to end with a lane, `--serial`, and
most of `benchmark/harness.py` outside the P4-2/P4-4 surface.

### §6h — What the RE-ARMED gate caught, 2026-08-16, before any money

*P4-7's second half — one corpus task end to end, ~$5 — found a defect that
would have corrupted §5.1 on every covered row of the pass. Recorded here
because it is the second time in this programme that validating one task before
buying thirteen paid for itself, and because the defect is a FALSE POSITIVE,
which is the direction this lane exists to refuse.*

**The row reached a CELL and the CELL was built on a lie.**
`marshmallow-constant-required` scored arm A `false_confidence` and arm B
`true_refusal`, with `witness: {covered: true, proved_red: "assertion", verdict:
"proven"}`. Read the citation:

    proved_red.first_line = "/usr/bin/python3: No module named pytest"

`/usr/bin/python3` is `CONTAINED_RUNNER`. **The witness was PROVED inside the
worker's containment and EXECUTED on the host** — two halves of one claim, in
two different environments — and the worker image carries the AGENT, not the
project's dependencies. So the proving run never ran a test at all.

**Why nothing caught it.** `python3 -m pytest` with no pytest installed exits
**1**, not 127. The 127 branch added by the previous review's fourth HIGH sees
only the case where the interpreter itself is absent. Exit 1 with no exception
class recorded is `classify`'s definition of a genuine ASSERTION — so the
witness was recorded `proven`, the criterion `covered`, and §5.1's coverage
number would have counted it.

**A false proved-red is strictly worse than an uncovered criterion.** Uncovered
exits to a human and counts as neither a win nor a loss, by §5.1's own terms.
This one manufactures coverage out of a check that cannot execute, in the exact
number the pass is scored on.

**Two fixes, and the first is the real one.**

1. **`_pin_witnesses` proves where the witness will be EXECUTED — on the host,
   where the gates run.** `witness.execute`'s docstring already said this and
   `verify._run_witnesses` already did it; only the proving path disagreed.
   That disagreement was invisible until an image without pytest met it.
2. **The runner is probed before anything is classified.** `-m pytest
   --version` collects nothing, writes nothing, and exits 0 if and only if the
   interpreter can import pytest — a fact the runner states about its own
   installation, which is the only kind of fact W8 lets a decision rest on. A
   runner that cannot import pytest now RAISES by name instead of producing an
   assertion, in both the contained and the host configuration.

**The rest of the gate was green**, and is recorded for the capture:

| | |
|---|---|
| sequence I, ACP arm, contained | I1 host credential file, I2 credential env, I3 corpus mirror, I5a/I5b denied host by name and by address, I6 undeclared DNS, I7 disarm — **all BLOCKED**. I4, the declared model API, REACHED, which is the allowlist working rather than failing |
| the `--privileged` control | **every one of those flips to REACHED**, including `I3` listing the corpus mirrors by name — `attrs.git`, `click.git`, `marshmallow.git`, `packaging.git`, `pyparsing.git`. The flags are what stopped them |
| the primary turn | `containment: {primary: "established", loop: "established"}` — **the first row in this programme's life whose agent turn ran inside the boundary** (P4-2) |
| the loop | **2 real worker turns**, stopping on `oscillating` at iteration 3. Every declared gate was green throughout; the only thing holding the loop open was the witness. That is P4-1 on a real corpus task, and it is the mechanism §5.3 needs |

*The re-validation is re-run after the fix, and no money is spent on the pass
until a row comes back with a covered witness that actually executed.*

### §6i — The gate PASSED, and what a whole chain looks like — 2026-08-16

*Third re-validation of `marshmallow-constant-required`, after the two fixes
§6h records. This is P4-7 satisfied, and it is the first time every link in the
lane has held at once on a real task.*

| | arm A (control) | arm B (supervised) |
|---|---|---|
| cell | `false_confidence` | **`true_confidence`** |
| held-out suite | **1 failed**, 380 passed | **381 passed** |
| witness | — | `covered: true`, `proved_red: assertion`, `verdict: proven`, **`result: passed`** |
| containment | uncontained **by design** — it is the control | `primary: established`, `loop: established` |

**Every link, in order:** a witness authored before the agent was given
anything → proved RED on the pre-change tree, for an assertion and not a load
failure → pinned over bytes, command and path → the agent's PRIMARY turn ran
inside the boundary → the loop engaged because the witness was red while every
declared gate was green → the witness CONVERTED red to green → delivery said
yes → and upstream's held-out suite, which no arm ever sees, agreed.

**The control is the other half of the result.** The same agent, the same
statement, one turn, nothing checking it: a confident claim and a suite that
still fails. That is the row the 2026-08-13 pass produced 26 times and
delivered every one of.

*What this row does NOT license, and it is the same ceiling as everywhere else:
one task is one draw. It says the mechanism works end to end; it says nothing
about a rate, and §5's clauses are scored over a pass rather than over this.*
