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
([docs/first-contact.md](docs/first-contact.md)).*

The sentence above describes a gate going red **on the clock**, in a run
somebody watched. That is how a person learns what a gate is for, and it is
how the captured demos read, so it stays. **It is not, and can no longer be,
the mechanism by which a criterion becomes evidenced.**

Measured: `wring verify` stops at the first required failure. A real agent
closed three gates in one turn, so two of them never ran at lap 1 and were
born green at lap 2 — `evidenced: 0`, every criterion refusing delivery, on
a change that genuinely satisfied all three. **A one-shot agent can evidence
at most one criterion per red lap**, and every good agent is one-shot.

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
