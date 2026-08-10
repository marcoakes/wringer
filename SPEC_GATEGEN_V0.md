# SPEC — gate authoring (F2: the factory's constraint)

*Drafted 2026-08-10 by the planning window from `WRINGER_FACTORY.md` F2,
`docs/factory-dry-run.md` §3 (measured: `wring plan` proposed ZERO gates and
every `proves:` line was hand-written), and the Citadel teardown
(`~/Claude/WRINGER_CITADEL_RULINGS.md` R1): the most credible competitor
ships acceptance-criteria-as-executable-check with the verifier in the same
tree as the code and no co-modification guard — the attack this spec exists
to prevent, live at 841 stars. Marc's delegation stands; rulings DECIDED.
**Review: NOT YET RUN — a debt, and the build plan's first slice is a
single-agent adversarial review (token rule: no fleets). Do not build G1 on
an unreviewed spec.**
[SPEC_ACCEPT_V0.md](SPEC_ACCEPT_V0.md), [SPEC_INTENT_V0.md](SPEC_INTENT_V0.md)
and [SPEC_VACUITY_V0.md](SPEC_VACUITY_V0.md) bind and are unchanged.*

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
2. **Drafter proposes, human installs, zero authority until applied —
   DECIDED.** `gate_diff` renders and stops; there is no `--apply`, no
   auto-merge, and the sidecar is never read by `verify`, `run`, `fleet`,
   `graph` or `deliver`. Only `.wringer.yaml` puts commands in Wringer's
   mouth (SPEC_GRAPH ruling 1), and only a person edits it.
3. **A generated gate green at birth is SELF-REFUTING — DECIDED.** The
   criterion is unmet (the feature does not exist), so a correct gate MUST
   fail at baseline; one that passes is testing something else. No new
   machinery needed: SPEC_ACCEPT ruling 3 already renders it `unevidenced`
   and refuses delivery. This spec adds the words — `gate_diff`'s output and
   `docs/gategen.md` say "these gates should be RED on your next verify; a
   green one is wrong, not lucky" — and a DONE box pins that the summary of
   that first verify says so beside each born-green bound gate.
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
5. **The drafter is the EXISTING drafter — DECIDED.** Same `wring spec`,
   same `--send`, same endpoint config, no new network surface. An offline
   repo writes the sidecar by hand in the same format; the flow from there
   is identical, which keeps the no-LLM path first-class.

## 3. Non-goals (binding)

Auto-applying gates · any command that runs gates at plan time · parsing
commands to discover file dependencies · mutation testing · more than one
gate per criterion (SPEC_ACCEPT holds) · gate selection (BINDING NON-GOAL
per Citadel R2) · editing `wringer.spec.v1` or any frozen schema · a
`--send` on `wring plan` · Windows.

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
      ruling-3 warning beside it in that run's summary, pinned by content
- [ ] no consumer outside `spec.py`/`plan` reads `wringer.gates.yaml` —
      the import-parsing method, so the sidecar can never quietly become a
      second config
- [ ] `gatespec.schema.json` published + frozen same commit, drift test,
      schema README row (derived guards already fire)
- [ ] `wring spec --send` emits the sidecar when criteria are machine;
      offline, the printed next-steps name the hand-written path
- [ ] docs/gategen.md carries the captured flow (recorder, 80 cols); the F2
      rail node probes on THIS DOC, not the spec — the P6 trap, avoided in
      the same commit that creates the file it would have tripped on
- [ ] the finish report answers the factory question; for this arc the
      answer must be "moved the spec closer", with the dry-run rerun as proof
