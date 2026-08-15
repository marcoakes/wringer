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
disproved it ([docs/corpus-2026-08-13.md](docs/corpus-2026-08-13.md)). The
ruling delegates two choices to the implementation — which existing command
hosts the author, and how the witness is packaged — and both are DECIDED here,
against the tree rather than in the abstract. Nothing here is built by the
slice that writes it: the author is Phase 1, delivery consumption is Phase 3,
standard emission is Phase 4.*

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

`gates_vacuous` stops being a terminal verdict Wringer *reports* and becomes
the condition on which Wringer *acts*: vacuity triggers manufacture.

### The one-sentence test, restated

§Positioning asks whether a worker that writes both the gate and the code can
get a criterion evidenced without a human and a red run in between. That test
survives and gains a second — the one the corpus failed:

> **Does the bundle contain a check that Wringer authored, proved RED on the
> pre-change tree, and the worker could not edit?**

Today: no. W1–W5 make it yes.

### W1 — The witness is Wringer's own check, not a repo gate — DECIDED

A **witness** is a fail-to-pass check that Wringer authors for one criterion
when that criterion's declared gates cannot discriminate. It is deliberately
**not** an entry in `.wringer.yaml`, and the distinction is load-bearing in
both directions:

- A gate in `.wringer.yaml` is the **repository's** claim, installed by a
  person applying a diff. Ruling 2 and SPEC_GRAPH ruling 1 are untouched:
  nothing here writes that file, and no witness is ever proposed into it.
- A witness is **Wringer's** manufactured evidence about a criterion the
  repository left uncovered. Wringer owns, pins and executes it, and it lives
  under `.wringer/` rather than in the source tree.

This is why a witness needs no human install and does not contradict ruling 2.
It also bounds the claim: a witness evidences the criterion it was authored
for and says nothing about the rest of the change.

**Why not "generated gate".** A generated gate is a proposal into the sidecar —
ruling 1's channel, requiring a human. The witness is a different object with a
different trust story, and reusing the gate vocabulary would collapse the two.

### W2 — Authoring is a SEND, hosted on `wring spec` — DECIDED

The author is an LLM call, so under the typed-send law it is a flag typed on
the invocation and carried by no file: **`wring spec --send --witness`**.

**The host was chosen by elimination against a law, not by preference.**

> *"No LLM and no network in any command that **proves** anything — `verify`,
> `run`, `resume`, `fleet` and `plan` cannot reach one."* — README.md:98

| candidate | verdict |
|---|---|
| a new top-level command | refused — 19 is the ceiling this cycle |
| `wring run` | **refused by law.** `run` proves. The first draft of this amendment hosted the author here and was wrong; the claim above is published, and `tests/test_docs.py` fails when a file that counts senders stops naming one |
| `wring verify` | same law, and verify is the floor the program stands on |
| `wring plan` | same law; also runs nothing and has no ledger |
| `wring deliver --send` | a sender, but it runs after the work — far too late to pre-date it |
| `wring attest --sign` | post-hoc by construction |
| `wring judge --send` | judge is ruled dead and stays dead |
| **`wring spec --send`** | **chosen** — already a sender, already the authoring surface, and it runs before any work exists |

Three properties make this strictly better than hosting it on the loop:

1. **No new socket.** `spec.py:25`: *"This module opens no socket. `wring spec
   --send` reuses `judge.send`."* Every socket in the program lives in
   `judge.send` and `forge.request`, and `grep -rn build_opener src/` must
   return exactly two answers. The author reuses the same transport and that
   grep still returns two.
2. **The sender count does not move.** It stays **five**. Nothing in
   README/SECURITY/SPEC_GET §7/SPEC_START §3e-i needs restating, and the
   derived guard keeps it honest.
3. **Reusing `judge.send` is not reviving the judge.** The stop-list kills the
   `wring judge` command and judge *calibration*; `judge.send` is the HTTP
   transport `wring spec` has always used. A test should pin that distinction
   so a later reader does not mistake one for the other.

**Temporal independence is the load-bearing property.** A check authored before
the work exists cannot have been written to flatter the work. That is this
spec's own amended precondition — *a gate that arrived with the change cannot
evidence the change* — applied to authorship rather than to arrival.

**Isolation of the author, and it is not optional.** The author gets the
criterion and the pre-change tree, isolated exactly as the corpus isolates a
worker: truncated history, no upstream reachability, the criterion statement
only. Never upstream's fix, never the held-out tests, never the worker's
session. An author that can reach the answer measures nothing — the finding the
corpus audit produced the hard way.

**The sequencing consequence, named because it is a real cost.** The witness
lane requires `wring spec` to have run. A flow that goes straight to `wring
run` from a bug report has no criteria and therefore no witness. Wiring that
for the re-test is Phase 3's problem and is named here as its input, not solved
here.

### W3 — Proving stays free of network and LLM — DECIDED

**The proving mechanism is already shipped; only the author was missing.** The
2026-08-11 amendment above made pre-change execution via the `--prove`
`sensitive` receipt the *primary* route to `evidenced`. A witness reuses it
unchanged: it is executed against the pre-change tree and **must fail there**.

1. `run.prove: true` is required for the witness lane, for the reason E1a
   already gives. A repo that has not opted in gets no witness lane and is told
   so by name rather than getting a witness nobody can prove.
2. A witness whose pre-change failure looks environmental is **not** a proved
   red. Ruling 3's finding 7 is the precedent and binds harder here, because a
   witness Wringer authored and Wringer scored would otherwise be marking its
   own homework. `run.prove_setup` and the mandatory `cites` line are
   preconditions of a witness receipt, not decorations on it.
3. **It dissolves the `--prove` asymmetry.** SPEC_VACUITY's pre-change tree
   drops the agent's new tests, so a correct fix that brought its own tests is
   refused as fast as a tautological one — which is why "just turn `--prove`
   on" was never the answer to the corpus. The witness is present in the
   pre-change tree **because it is not the agent's**: Wringer materialises it
   there from the pin. A correct fix is no longer refused for having brought
   its own tests, because the thing proved red is Wringer's check.

**There are TWO red proofs and they are not the same claim.** Conflating them
is how this would quietly become weaker than it sounds:

| | when | mechanism | what it establishes |
|---|---|---|---|
| **(a) born red** | at pin time, before the first worker turn | Wringer executes the witness directly on the working tree, which *is* the pre-change tree because the worker has not run | the check could fail, **on the clock, before the work existed**. This is the strong claim and the one temporal independence rests on |
| **(b) the receipt** | after the fix, on a passing verify | the existing `--prove` comparison: passes on the changed tree, fails on the HEAD worktree → `sensitive` row | the artefact acceptance actually consumes (SPEC_ACCEPT §3 clause 2) |

Both are offline. **(a) is not `--prove`** — `--prove` runs only when every
required gate already passed (`verify.py:307`), which is precisely not the
state of the world before the work. A witness that is *green* at (a) is
self-refuting exactly as ruling 3 says a born-green gate is: the criterion is
unmet, so a correct witness must fail. It is discarded and the criterion is
reported uncovered rather than being handed a witness that proves nothing.

*Two shipped `--prove` behaviours the witness lane inherits and must not
quietly diverge from:* it **skips `optional` gates** (`vacuity.py:241-246`),
and HEAD does not move during a loop, so the HEAD worktree at (b) is the same
tree as (a).

### W4 — Pinning is the "could not edit"; author and pin are separate steps — DECIDED

**Authoring is a send; pinning and proving are offline.** They happen in
different commands and that separation is the design, not an accident of it:

1. **`wring spec --send --witness` authors.** The model call happens, the bytes
   are written under `.wringer/witness/`, and nothing is trusted yet.
2. **The next `wring run` pins, before the first worker turn.** Offline: it
   hashes the bytes, writes the pin as a ledger event, and proves the witness
   red on the pre-change tree. No LLM, no network — `run`'s law is intact.

**The pin goes in the ledger because the ledger is hash-chained.** A witness
manifest sitting on disk beside the bytes would be no protection at all: a
worker with a shell could edit the witness and the manifest together and keep
them consistent. The ledger's `prev_hash` chain is the one integrity structure
in this program that a consistent local edit cannot forge, and `wring audit`
already verifies it offline. Pinning anywhere else would be security theatre.

**The cost of that, stated: it is a new schema version.**
`schema/loop-event-v2.schema.json` is a **closed `oneOf` of eight branches**,
so a `witness.pinned` event is not something an existing published format
admits. Law 7's route is the one loop v1→v2 and untracked v1→v2 already took:
a new `loop-event-v3.schema.json` and `wringer.loop.v3`, with **v2 still
published, still frozen, and a test proving a v2 bundle already on disk is
still read**. The version moves because an event type was added — not because
a field was edited, which would be the unlawful move.

**At every execution, on either tree, Wringer hashes the bytes it is about to
run and compares them to the chained pin. A mismatch VOIDs the run.** It is not
a failing gate — it is no run at all, because the artifact that was supposed to
be immutable was not, and nothing interpretable happened. The run exits
`EXIT_REFUSED` (3, `cli.py:47`): not `EXIT_GATE_FAILED` (1), which would file
it as evidence about the change, and not `EXIT_CONFIG` (2), which would blame a
configuration that is fine.

**Packaging is derived, not chosen.** The ruling left layout free under the
pinned-bytes invariant; against this tree the invariant leaves one honest shape:

- The pre-change tree is `git worktree add --detach HEAD` — **tracked files and
  nothing else** (SPEC_VACUITY §4b). An untracked witness written into the
  working tree would be *absent* there and would "fail" for file-not-found,
  which is §4b's false `proven` wearing this amendment's badge.
- Committing it instead is refused: git history is written only on a typed
  `--send`, onto a branch Wringer created (law 6).

**Therefore the bytes of record live under `.wringer/witness/` (gitignored,
`.gitignore:18`), and Wringer materialises them into whichever tree is being
executed immediately before execution, verifies the digest, runs, and removes
them.** Between executions there is no witness file in the source tree.

**What this closes that nothing else in the program does.** Acceptance identity
is `(id, command)` (SPEC_ACCEPT §3, health ruling 2), so editing a gate's
command resets its history — but rewriting the *test file* while the command
string stays identical does not, and that is named as an inherited blind spot
in both SPEC_VACUITY §5a and ruling 4 above. **A pinned witness is the first
check in this program whose identity covers its own content.** The blind spot
is not closed for repo gates; it is closed for the witness, and the difference
is worth saying rather than letting a reader generalise it.

### W5 — The worker sees the failure, never the source — DECIDED

The loop brief carries the witness's **failure output**. It never carries the
witness source, its path, or its command. Finding 8 binds without restatement:
the brief must carry no instruction a worker can satisfy by damaging the
evidence.

**The honest limit, stated here rather than found in the field: this is a rule
about what Wringer hands over, not a sandbox.** A worker with a shell can read
`.wringer/`, and `worker_execution` is `trusted_local` today (SPEC_EXEC §5).
So:

- **The threat model this closes is TAMPERING, not disclosure.** A worker that
  reads the witness and writes code that passes it is a worker doing its job —
  that is test-driven development, and the pre-change red is what makes the
  test meaningful. A worker that *edits* the witness is what the pin catches.
- Disclosure is closed by Phase 2's containment, not by this amendment, and
  any artifact claiming otherwise is overclaiming.
- **The brief's pointer is already unbounded and stays that way.** It ends by
  naming the whole evidence directory (`loop.py:1332-1334`) and telling the
  worker *"Do not edit anything under `.wringer/`"* (`loop.py:1334-1337`) —
  an instruction, not a boundary. The witness adds nothing to that exposure and
  removes nothing from it.

**The precedent for naming a thing without showing it already ships.** Human
criteria appear in the brief by id and title with their `guidance` deliberately
withheld (`loop.py:1256-1262`). The witness section follows that shape
exactly.

### W6 — The schema is frozen once, and R3's mapping is designed with it — DECIDED

A new published schema, `witness.schema.json` / **`wringer.witness.v1`**, a
sibling artifact in the run bundle on the `vacuity.json` pattern: absent
entirely from runs with no witness lane, covered by `digests.json`, written
through the bundle's redactor, recorded in `schema/frozen.json` in the same
commit. Law 7's axis is clean — adding a schema is additive, and
`test_a_new_schema_may_be_added_without_touching_the_freeze` says so by name.

**The fields are designed together with R3's in-toto mapping so the schema
freezes once rather than twice.** Phase 4 emits in-toto `test-result` v0.1 plus
exactly one custom predicate; those consumers are listed now so no field has to
be added later:

| witness field | why it exists | R3 destination |
|---|---|---|
| `id`, `proves` | which criterion this manufactures evidence for | custom predicate |
| `authored.at`, `authored.by.model` | temporal independence is the claim; the model is provenance | custom predicate |
| `authored.base_sha` | the tree it was authored against, so "before the work" is checkable | custom predicate |
| `authored.criterion_sha256`, `authored.prompt_sha256` | what the author was given — digests, never the text, which may carry repo content | custom predicate |
| `authored.isolation` | truncated history / no upstream reachability (W2) | custom predicate |
| `pinned.sha256` | **the pin** | custom predicate |
| `pinned.run`, `pinned.path` | how it executes and where it materialises | `configuration` |
| `proved_red.receipt`, `.exit_code`, `.first_line` | the `sensitive` receipt and its mandatory citation (W3.2) | custom predicate |
| `proved_red.verdict` | `proven` / `inconclusive` / `not_established` | custom predicate |
| `executed.sha256`, `.matches_pin` | the comparison that VOIDs a run | custom predicate |
| `executed.result` | passed / failed on the changed tree | `result`, `passedTests`, `failedTests` |

`wringer.attestation.v1` stays frozen and gains no v2 dialect. **Phase 4 builds
the emission; this amendment builds none of it** — it fixes the field list so
Phase 4 is a mapping exercise and not a schema migration.

### W7 — Where this amendment corrects the ruling document — DECIDED

Named rather than silently reconciled, because a spec that quietly diverges
from the ruling it cites is the drift this repository exists to catch.

1. **The author cannot live on `wring run`.** The ruling leaves the host open
   and names only the no-20th-command ceiling and the typed-send law. A third
   constraint decides it and is not in the ruling: `run` is a command that
   proves, and the published claim is that it *cannot reach* a model. W2 is
   the resolution; no ruling is overturned.
2. **`not_evidenced` is not a state in this program.** The ruling's Phase 3
   says an uncovered criterion "exits `not_evidenced`". SPEC_ACCEPT §2's
   taxonomy is `evidenced` / `unevidenced` / `gate-failed` / `human` /
   `gate-did-not-run`, and the ruling elsewhere instructs "no new verdict
   vocabulary". **The word is `unevidenced`**, which already means what the
   ruling describes and already refuses delivery when required.
3. **The pre-dating guard must be taught about witnesses, and that is Phase 3.**
   `accept._arrived_with_the_change` (`accept.py:355-393`, entered for a
   `sensitive` receipt at `accept.py:369`) establishes structurally, from git's
   untracked list, that a gate did not arrive with the change. A witness is
   never in that list — it is materialised and removed, and `.wringer/` is
   gitignored — so the guard neither passes nor fails it meaningfully. The
   witness's equivalent of that guard is the *pin* plus `authored.base_sha`,
   which is strictly more checkable; wiring acceptance to read it is Phase 3's
   work and is named here so Phase 3 does not discover it.
4. **"Six known-wrong changes" was low, and the useful number is different.**
   The salvage recovered **15 rows labelled `false_confidence`, 14 with patch
   content** — spanning only **5 of the 13 tasks**
   (`benchmark/corpus/results/patches/README.md`). Stop condition (c) is scored
   on the overlap between the witness's covered tasks and those five. The rule
   is retained unchanged; the count it was estimated against is corrected.

### Non-goals of this amendment (binding)

Auto-installing a witness into `.wringer.yaml` · proposing witnesses through
the sidecar · a witness for a `human: true` criterion · more than one witness
per criterion · witness selection · mutation testing of any kind (the sole
sanctioned future use — mutating the *fixed* tree at the fix site to test
whether the witness can kill — is DEFERRED and not authorised this cycle) · a
`--no-witness` or any bypass, because flags tighten and never loosen · a new
top-level command · a third socket · emitting in-toto (Phase 4) · consuming the
witness at delivery (Phase 3) · caching · judge calibration.

### Definition of DONE for the authoring slice (Phase 1)

- [ ] `wring spec --send --witness` authors a witness per uncovered machine
      criterion, isolated per W2 — pinned by a test that reddens if the author
      is handed a reachable upstream or the worker's session
- [ ] `grep -rn build_opener src/` still returns exactly two answers, and a
      test pins that the author reuses `judge.send` rather than reviving the
      judge
- [ ] the sender count is still **five** everywhere it is stated, enforced by
      the existing `tests/test_docs.py` guard
- [ ] the pin: bytes hashed offline at the start of `wring run`, written as a
      ledger event before the first worker turn, re-hashed before every
      execution; **a mismatch exits 3 and writes no verdict**, pinned by a test
      that mutates the bytes between pinning and execution
- [ ] the witness file is absent from the source tree except during its own
      execution, pinned by a test that inspects the tree during the worker's
      turn
- [ ] `witness.schema.json` published + frozen in the same commit, drift test,
      schema README row (three derived guards already fire)
- [ ] `--witness` without `--send` refuses by name — the author is an LLM call
      and no flag may reach a model without the send somebody typed
- [ ] the loop brief carries the witness's failure output and **not** its
      source, path or command — pinned by content, and the pinned content
      carries no instruction its reader can satisfy by damaging the evidence.
      **`tests/test_run.py:596` pins the repair brief's exact heading sequence
      and any new section breaks it**; that test is updated deliberately, in
      the same commit, or the brief is not changed
- [ ] `loop-event-v3.schema.json` published + frozen beside an untouched v2,
      with a test proving a v2 loop bundle already on disk is still read
- [ ] `run.prove: false` with a witness present refuses by name rather than
      proceeding with a witness nobody can prove
- [ ] the offline calibration result, published whichever way it lands: the
      three numbers of the ruling's Phase 1 stop, against the salvaged corpus,
      with the 5-task ceiling on (c) stated beside them

### Limits, stated here rather than discovered later

- **A manufactured fail-to-pass witness is necessary and demonstrably not
  sufficient.** UTBoost found 345 erroneous patches passing curated tests;
  PVBench found >40% of patches failing the developer's own PoC tests. The
  witness raises the floor. It does not license "delivery is safe", and every
  artifact that mentions it carries this sentence.
- **A witness evidences one criterion**, and says nothing about the rest of the
  change. A bundle with one green witness is not a verified change.
- **The author is a model, and a model can write a witness that passes for the
  wrong reason.** Red-then-green is consistent with a witness testing something
  adjacent to the criterion. This is why W3.2's environmental-failure rule is a
  precondition rather than advice.
- **Disclosure is not closed here** (W5), and `worker_execution` remains
  `trusted_local` until Phase 2.
- **Nothing here enforces sequencing.** Finding 9's correction stands and now
  applies to the witness: the guarantee is the recorded pin and the recorded
  receipt, both checkable, and not the order in which things happened, which is
  not.
