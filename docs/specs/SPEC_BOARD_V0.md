# SPEC — the requirements board (the PM surface, v0)

*Drafted 2026-08-15 by an Opus implementation window under
`WRINGER_BOARD_RUN_PROMPT_2026-08-15.md`. Inputs: `WRINGER_PM_ARC.md` —
including **§8a rulings B1–B8** and **§11 rulings L1–L5**, which are Fable's,
which this spec **restates and may not weaken**; `WRINGER_RULING_2026-08-15.md`
**§Q1**, whose claim ceiling binds every sentence here; and the A-probe capture
`~/Claude/board-probe/BOARD_PROBE.md` (sha256 `fc1c68eec4cb7dba…`), whose
thirteen-item gap inventory §3–§10 answer item by item. `WRINGER_FACTORY.md`
governs the order of work and outranks this file.*

*Every "exists today" claim below was read out of the tree at **`d23d7ca`** and
carries its `file:line`. Nothing here is recalled.*

**INDEPENDENTLY REVIEWED 2026-08-15, before any code, by an agent that neither
drafted this spec nor will build to it. Verdict: SOUND WITH FINDINGS —
27 findings (5 HIGH, 16 MEDIUM, 6 LOW). ALL 27 ARE FOLDED; none is rebutted.**
§14 records what the review checked, what it could not, and the one place a
finding was folded into this spec rather than into the artifact it named. **The
five HIGH findings are the reason this document is worth more than its first
draft, and each is named where it landed** — the first draft would have shipped
a board that renders UNKNOWN for every criterion in any repo using
`run.prove: true` (H1), rendered the engine's anti-circularity refusal as its
exact opposite (H2), asserted a causal fact two captures in this repo falsify
(H3), overclaimed that refusal in the README (H4), and pointed its own
anti-drift table at the wrong section thirteen times (H5).

**Three findings from the grounding pass, named here rather than reconciled
quietly, because a spec that improvises over a contradiction hides it:**

1. **`PM_ARC` §3.2's state vocabulary is not the tree's.** The board states
   PM_ARC names are `PROVEN-RED`, `GREEN with receipt`, `NEEDS YOU
   (not_evidenced)`, `STALE` and `REFUSED`. `acceptance.json`'s enum is
   `evidenced | unevidenced | gate-failed | gate-did-not-run | human`
   (`schema/acceptance.schema.json:49-55`). `not_evidenced` does not exist —
   the spelling is `unevidenced`, and it means *unbound, or bound but born
   green, or a receipt that could not be established*, not *a human decides*;
   the state that means a human decides is `human`. `gate-did-not-run` has no
   PM_ARC state at all and fired on 5 of the 20 criterion-rows the probe
   rendered. **This spec specs against the tree** (§3, ruling 4).
2. **`PROVEN-RED` cannot be rendered from the files that exist.** It is the
   state PM_ARC leads with. `gate-failed` carries `receipt: null`
   (`accept.py:338-343`); whether the check has ever been *demonstrated* able to
   fail is computed across all bundles by `accept._discriminating_pairs`
   (`accept.py:405-439`) and written to disk only for rows that reach
   `evidenced`. Ruling 4 refuses to render it rather than derive it.
3. **The run prompt's §3 list names two reasons the product does not have.**
   `contamination` and `forbidden_shas` appear only under `benchmark/` and
   never in `src/wringer/`. They are corpus-harness concepts. The refusal
   mapping (§4) is total over the product's named reasons and says so.

---

## Positioning

> **One screen a product manager can read without help, and every green on it
> can show the moment it was red.** The board renders what the engine already
> wrote. It adds no verdict, softens no refusal, and where the files cannot
> support a state it says UNKNOWN rather than something plausible.

Wringer's engine is largely built and honest, and a non-technical person can
touch none of it (`PM_ARC` §2). The arc is the surface, not the engine. This
spec is the first cycle of that arc and it is deliberately the smallest real
one: **the board ships from artifacts that exist today, with no engine change
at all.** One engine change appears in this cycle — the gate-artifact slot,
**§10** — and it is sequenced last, on its own, for the reason B2 gives.

The one-sentence test: **could this surface make a delivery look better than
the evidence says it is?** If yes, the design is wrong.

---

## §1 — The Fable mapping: each ruling, where it is implemented, and how a reviewer catches a violation

A row whose "how to check" says only "see §N" is a failed row. Every check
below names an artifact, a test, or a rendered state that would visibly differ
if the ruling were broken. **Where a check is weaker than it looks, the row
says so** — a row that oversells its own guard is the drift this table exists
to stop (review H5, M3, M4, M5, M10, M12, M13).

| ruling | what it says | implemented in | how a reviewer catches a violation |
|---|---|---|---|
| **B1** | v0 is local and single-user: filesystem bundles, no server, auth, hosting or SaaS | §2 ruling 2; §8 non-goals 1–2 | **Structural, because a page test cannot catch a server** (M3): the package declares no web-server dependency (`flask`, `fastapi`, `uvicorn`, `aiohttp`, `starlette`, `http.server`) in its metadata or its imports, and registers **exactly one** console entry point, which writes a file and exits. `test_the_surface_ships_no_server` asserts both. Secondary: `test_the_page_makes_no_request` asserts the emitted HTML contains no `fetch(`, `XMLHttpRequest`, remote `src=`/`href=` stylesheet, or URL `import(` — scoped to the board's own chrome, since a rendered gate command or check message may legitimately contain a URL. |
| **B2** | separate layer; core stays at 19 commands; the ONLY engine change is the gate-artifact slot | §2 ruling 2; §10; §9 slice plan | Three checks, because the count alone catches only half the ruling (M13): (a) `wring --help` lists exactly 19 top-level commands — verified at `d23d7ca`: start, graph, init, verify, run, fleet, health, bench, resume, judge, spec, plan, get, issue, deliver, doctor, attest, audit, explain; (b) `schema/frozen.json` and `tests/test_schema.py` already byte-freeze the shipped schemas, so a new field on a frozen one fails in the core's own suite; (c) **S4's diff is scope-asserted**: it adds exactly one file under `schema/`, adds no `_TOP_LEVEL_KEYS` entry (`config.py:42-45`) and no CLI flag. A violation is a 20th `add_parser`, a frozen-schema field, or a core module importing the surface. |
| **B3** | never overclaim: every state from a real artifact; the promise only where the chain resolves; missing data is UNKNOWN, never green; unknown schema versions refused loudly | §3 rulings 4, 5, 6, 15 | Three rendered states must be **reachable** and are pinned by fault-injection fixtures — the probe built all three: (a) an unrecognised `schema_version` renders a refusal banner and **zero cards** (`board-refusals.png`); (b) a row claiming `evidenced` whose receipt does not resolve renders **UNKNOWN** with the header promise **absent** (`board-broken-receipt.png`); (c) a criterion whose gate left no `result.json` renders NOT REACHED. Three must be **impossible**: green without a resolved receipt chain, green from an unknown schema version, and any card state not in §3 ruling 4's table. Guards: `test_every_rendered_state_is_reachable_from_a_real_fixture` and `test_no_card_renders_green_without_a_resolved_chain`. |
| **B4** | plain language on every PM surface: no YAML, exit codes or paths reach the PM | §3 ruling 7 | `test_no_card_chrome_contains_machinery` greps the card region for `exit_code`, `.yaml`, `.json`, `.wringer/`, path separators, gate ids and backticked identifiers. **Stated weakness, because the row would otherwise oversell itself** (M4): ruling 7 licenses the check's own message **verbatim**, and real gate output routinely carries paths, filenames and tracebacks — so that region is *excluded* from the grep and B4 is not enforced inside it. The check that is real there is `test_the_checks_own_words_are_visually_quoted`: the verbatim message renders in a distinct block attributed to the check, never as the board's own sentence. |
| **B5** | the approval interlock survives with identical semantics; no `--yes` equivalent; the approve button writes exactly what the hand-edit writes; answers land where hand-edited `answer:` lines land | §5 | **The strong half is byte equality**: `test_the_button_and_the_hand_edit_produce_identical_bytes` drives the approve action and a hand edit against one fixture and asserts the resulting `wringer.spec.yaml` files are byte-identical. Two structural invariants beside it (M5): the surface **never writes `approved: true` in the same action that answers a question**, and it surfaces `wring plan`'s **unanswered-questions** refusal (`cli.py:2728-2744`) unchanged. *(The earlier draft pointed this row at `cli.py:2717-2726`, which is unreachable once `approved: true` is written — the review caught it.)* |
| **B6** | refusals are rendered, never overridden: named reason + the one unblocking question; the surface can never suppress or auto-resolve one | §4 in full | `test_every_named_reason_has_a_mapping` enumerates the reasons from the engine's own **public** tables (§4 ruling 16 lists them, and names the two values that have no table) and fails when one has no entry — the shape `tests/test_run.py:73` already uses in this repo. A violation is also visible: an unmapped reason renders its raw name inside an UNTRANSLATED chip (ruling 17), so a PM sees an ugly string rather than nothing. Structural: any `except` around a `wring` invocation that neither re-raises nor renders is a violation, and is greppable. |
| **B7** | the ratchet seam is oracle-agnostic: GATEGEN's red-first path today, the witness lane when Phase 3 lands it; must read correctly under a re-test win AND the automatic de-scope | §6 ruling 21 | **A test, not a reading** (M10): `test_the_seam_names_no_oracle` asserts the supplier-interface module imports nothing named `witness` and that the string "witness" appears in **no** rendered surface string. Plus the reading check, kept because it catches prose: read §6 twice — once assuming Phase 3 wins, once assuming Q1's automatic de-scope fires — and find no sentence that becomes false. A violation is any sentence naming the witness lane as a dependency rather than as one of two suppliers. |
| **B8** | still out: live preview (own future cycle), F5 multi-repo (banked) | §8 non-goals 1, 3 | Neither appears in the slice plan (§9) or the definition of DONE (§11). A violation is a slice that serves an app or reads a second repo root. |
| **L1** | the core README's first screenful positions against the three wrong shelves | the README edit landing in this cycle's second commit, `README.md:43-48` | The three sentences appear with "what it IS instead" attached to each. **They sit immediately below the goal paragraph and not above it**, because `tests/test_docs.py::test_the_goal_is_stated_where_every_window_actually_looks` requires "advanced spec" and "working software at enterprise" inside the first 45 lines and the first placement pushed them out. The guarded sentence is a contract and the edit was reshaped around it. |
| **L2** | the two objections are answered in the README adjacent to the claims section, bounded by Q1's ceiling | same commit, `README.md:305-329` | The block sits after the claims section's status paragraph and before `## Is your green still worth anything?`. Q1's limit sentence is **untouched and verbatim** at `README.md:289-292`. `tests/test_docs.py` and `tests/test_doctor.py` pass (100 passed, 2 skipped). |
| **L3** | no launch until the first run is honest: F6 is a LAUNCH GATE, and the quickstart is a measured, filmed number | §7 ruling 22 — **defined here, owned by the launch cycle** | Honest scope (M12): this spec **defines** the number and its method; no slice here measures it and no DONE item requires it, because L3 is a launch gate and `~/Claude/WRINGER_ENV_PLAN.md` owns F6's build. A reviewer catches a violation by finding a claimed quickstart figure with no capture behind it, or by finding F6 work inside this spec's slices. |
| **L4** | open-sourcing is not launching; the launch moment is spent once, when the story has its ending | §7 ruling 23 | §7 names Demo R, names the slice that makes it filmable, and states that launch timing is ruled in PM_ARC §11/L4 and is not this spec's to move. A violation is any sentence here proposing a launch date or gating launch on a board slice. |
| **L5** | the board is open source; the play is standard-setting; §5's "sold on top" is superseded | §2 ruling 3; every line of positioning language in this document and the README edit | **Three real checks** (M10): `test_the_licence_is_the_cores` byte-compares the surface's `LICENSE` against the core's Apache-2.0; the package contains no entitlement, licence-key or feature-flag-by-tier code path, which is greppable; and `test_no_rendered_string_uses_house_jargon` fails on any rendered surface string containing a term only this programme knows — `vacuity`, `gategen`, `witness`, `ratchet`, `red-first`, `B3`, `Q1`, `fork ruling`. That last one serves B4 and L5 at once and is the strongest of the three. |
| **Q1** (fork ruling) | the claim ceiling: *a witness proves the stated criterion could fail and was made to pass; it does not certify agreement with an unstated intended fix, and where the criterion under-describes the intent, the witness inherits that gap.* No artifact may claim the witness "catches wrong fixes." | §3 ruling 9 (the board's own limit line); §6; the README edit | The board's footer carries `acceptance.json`'s `limits[]` **verbatim** plus one sentence saying a check proves the requirement *as it was written down*. `test_no_surface_string_claims_a_wrong_fix_was_caught` greps the surface's rendered strings **and this spec** for "catches wrong", "wrong fix", "wrong change", "guarantees correct" and fails on a hit. A violation is also catchable by reading: any sentence promising the board knows what you *meant*. |

---

## §2 — Architecture

**Ruling 1 — the board renders; it never decides.** Every card state is a
function of bytes the engine wrote. The surface computes exactly three things
that are not reads, and all three are named: the receipt chain walk (§3 ruling
5), the staleness digest comparison (§3 ruling 12), and the discrimination of
`unevidenced`'s four causes (§3 ruling 15). Nothing else. In particular the
surface never re-implements `accept.py`, never scans bundles to form its own
view of what a gate can do, and never scores anything.

*Why so absolute:* a hand-kept second copy of the engine's judgement is the
exact defect class this repository exists to catch, and it would drift the week
after it shipped.

**Ruling 2 — a separate layer, consuming the engine through what it already
emits** (B1, B2). Its inputs are the bundle tree under `.wringer/`
(`runs/`, `loops/`, `deliveries/`), `wringer.spec.yaml`, `wringer.gates.yaml`,
`.wringer.yaml`, and the `wring` CLI as its API. It is local, single-user, and
static-first: **the probe's single self-contained HTML file is the existence
proof** — `~/Claude/board-probe/board.html`, 17,969 bytes, inline CSS and JS,
no network, rendered from five real bundles. The core repo gains nothing but
§10's artifact slot and stays at 19 commands.

**Ruling 3 — the layer is open source, Apache-2.0, same as the core** (L5).
Every line of language in it is written for a stranger with no context.

**Proposed name: `wringer-board`** — the package, the repo, and the entry point
`wringer-board render`. Rationale: it says what it renders, it namespaces under
the engine without implying it is part of it, and it leaves room for
`wringer-*` siblings later. **DECISION PENDING — Marc's call**, and nothing in
this spec depends on the answer.

---

## §3 — The board (slice S1)

One screen. One card per criterion, in the order the approved spec declares
them — **never sorted by state**, which would be the surface deciding which
debts matter (`schema/acceptance.schema.json:30` makes the same call for the
same reason).

### Ruling 4 — the six card states, REFUSED is a badge, and PROVEN-RED is not there

| card state | derived from | the sentence a PM reads |
|---|---|---|
| **DONE — AND PROVED** | `state == "evidenced"` **and** the receipt resolves per ruling 5 | The check for this passes — and the same check has been recorded failing. |
| **NOT YET** | `state == "gate-failed"` | Not built yet — and the check that will decide it is written and failing right now. |
| **NOT REACHED** | `state == "gate-did-not-run"` | Not checked in this run, so nothing here says anything about it. *(Causal clause only under the condition in ruling 4b.)* |
| **NEEDS YOU** | `state == "human"`, or `state == "unevidenced"` | four distinct sentences, per ruling 15 — the four causes are **not** interchangeable |
| **UNKNOWN** | anything else, including an unresolved receipt chain and any `state` value not in the enum | This record says something this board does not understand, so it is showing nothing rather than something it cannot stand behind. |
| **REFUSED** | **a badge, not a state** — `refuses == true` on the row | This one is holding up the handover. *(plus the mapped sentence and the one unblocking question, §4)* |

**Ruling 4a — REFUSED is a badge because `refuses` overlaps three other states**
(review M8). `Row.refuses` is true for any criterion that is required AND bound
AND not `evidenced` (`accept.py:146-150`), so a NOT YET card, a NOT REACHED card
and a bound NEEDS YOU card are all simultaneously refusing rows. Six mutually
exclusive states with no precedence rule would be a lie about the data. It is
also the honest model: **it is the delivery that was refused, not the
criterion.**

**Ruling 4b — NOT REACHED asserts no cause it cannot support** (review H3, HIGH).
The card's sentence is `accept.py:333-336`'s own: *nothing here says anything
about it.* The board may add *"«criterion X» failed first and the run stopped
there"* **only when** the run's `manifest.result.failed_gate` names a gate that
is bound to a criterion in this same record. It frequently does not:

- `docs/factory-dry-run.md:126` records `gate-failed: 0` with
  `gate-did-not-run: 3` — the gate that stopped the run was the unbound `test`
  gate, which appears in no criterion row at all;
- `docs/fleet-scale.md:374-377` records `gate-did-not-run` where **no gate
  failed**, because the run was scoped (`wring run --gate` and `fleet.scope`,
  shipped in `29861a3`).

A scoped run has its own honest sentence — *"this run was only asked to check
some of the requirements"* — read from the `Scoped out` block `summary.md`
already writes (`verify.py:408-409`), never inferred.

**PM_ARC's PROVEN-RED is deliberately absent.** The board says the check is
written and failing right now, which is what `gate-failed` supports. The
stronger claim — *demonstrated able to fail, work simply not done* — needs
`accept._discriminating_pairs`' cross-bundle computation, which is not written
to disk for a non-evidenced row (header finding 2). The two ways to get it are
for the surface to recompute it, which ruling 1 forbids, or for the engine to
write it, which B2's one-engine-change budget is spent on §10. **So v0 does not
render it**, §8 carries it as a binding non-goal, and OQ-3 carries the engine
change that would earn it.

### Ruling 5 — the promise is earned, computed over CLAIMS, and resolves BOTH receipt kinds

"Every green on this board was red first" renders only when **every row that
claims `evidenced` resolves its receipt**. There are **two receipt kinds** and
they resolve differently (review H1, HIGH — the first draft handled only one,
and would have rendered UNKNOWN for every criterion in any repo using
`run.prove: true`, which is the mechanism the README's own objections block
advertises):

| `receipt.kind` | where the failure is | what the card shows |
|---|---|---|
| `failure` (`accept.py:431`) | the cited bundle's `gates/NNN_<id>/`, whose `result.json` says `failed` | which attempt, when, and the message the check printed, from that gate's `stderr.log` |
| `sensitive` (`accept.py:432-438`) | the cited bundle's **`vacuity/`** subdirectory (`evidence.VACUITY_DIRNAME`) — on the changed tree the gate **passed**, so `gates/NNN_<id>/result.json` says `passed` and reading it would resolve nothing | the `cites` line the schema already carries verbatim (`acceptance.schema.json:78-81`), **plus** the environment disclosure from `receipt.environment` (`accept.py:400`, `_environment_of`) when present |

**The two card sentences differ, because the two facts differ.** A `failure`
receipt says *this check has been recorded failing*. A `sensitive` receipt says
*this check failed on the code as it was before this change, and passes on it
now* — which is a real and sufficient red-first demonstration and is not the
same sentence. Rendering the second as the first would be an overclaim, and
`acceptance.json`'s fourth limit exists to caveat exactly it (`accept.py:75-78`).

*This ruling has the shape it has partly because the probe's own
implementation got the other half wrong* (`BOARD_PROBE.md` gap 13). Demoting a
broken-chain card to UNKNOWN removed it from the set of greens, and the promise
then fired over the survivors — a page reading "every green was red first"
beside a card that could not show its red. **A row that claims `evidenced` and
cannot resolve vetoes the promise, whatever state the card ends up rendering.**
The fault-injection fixture that caught it is a required test, and a second
fixture covers the `sensitive` path.

### Ruling 6 — an unknown schema version is refused loudly and renders zero cards

(B3.) The board knows `wringer.acceptance.v1`. Anything else produces a banner
naming the version it does not know, and **no cards at all** — not best-effort
parsing, not partial rendering. Same rule for every artifact it reads. A new
version is a code change in the surface, deliberately.

### Ruling 7 — plain language, and the two things that are not

(B4.) No YAML, no exit codes, no paths, no gate ids, no run ids in the board's
own chrome. Two deliberate exceptions, both on the card, both because removing
them would cost the PM information they need:

- **the message the check printed**, verbatim (`reports.to_csv() does not
  exist`). It is the one place a machine's words earn their seat: it makes the
  receipt concrete rather than a badge, and a PM reads it as *"the thing you
  asked for isn't there yet."* Verbatim, never paraphrased — the surface does
  not get to improve a check's own words. **It renders in a visually distinct
  block attributed to the check**, never as the board's own sentence, because
  B4 cannot be enforced inside it (§1's B4 row says so plainly).
- **the attempt ordinal and timestamp** ("attempt 1, 15 Aug 2026, 13:04:32"),
  which is how a chain becomes a story instead of an assertion.

Everything else technical lives in one page-level collapsed block addressed to
engineers, never on a card.

### Ruling 8 — ordering comes from the loop, never from the ids

Run ids are `<date>-<HHMMSS>-<4 random hex>` and do not sort chronologically:
in the probe's capture four of five runs shared one second, lexical order gave
56dc, 85fa, ba27, e40f, and the truth was 56dc, e40f, 85fa, ba27
(`BOARD_PROBE.md` gap 4). `manifest.started_at` is second-precision and ties
too.

**The order is read from the loop bundle's `loop.jsonl` `verify.finished`
events**, whose `evidence_dir` field is required by
`schema/loop-event-v2.schema.json` and written at `loop.py:721` — so the join is
real, not hopeful. Where no loop bundle covers a run, the board renders the runs
as an **unordered set** and uses no "first"/"then"/"attempt N" language about
them. Sorting by id, or by `started_at` alone, is forbidden and is a test
(`test_the_board_never_orders_runs_by_id`).

### Ruling 9 — the honest limits render verbatim, in the engine's own voice

`acceptance.json`'s `limits[]` (`accept.py:67-79`; schema requires at least
four) render **complete and unedited**, in a block labelled as the engine's own
words, plus **one** sentence of this spec's own: *a check proves the requirement
as it was written down; where the wording does not capture what you meant, a
green card inherits that gap.* That sentence is Q1's ceiling in PM language and
it may not be softened or dropped.

*The tension with B4 is real and it is resolved toward B3.* Those limits say
`evidenced`, "the bound gate" and "`wring health`" — engineer's language on a
PM surface, and in the probe's screenshot it is the only part of the page that
reads like a tool (`BOARD_PROBE.md` gap 9). Translating them is **a non-goal for
v0** (§8): a translated limit is a weakened limit unless the translation is
itself guarded, and building that guard is a cycle, not a slice. Dropping them
is not on the table.

### Ruling 10 — the board names what nobody judged, and never implies it was blocked

A `human` criterion has `gate: null`, so `Row.refuses` is false
(`accept.py:146-150`) and it cannot stop a delivery. In the probe's capture the
criterion "The export button's label reads well" was `required: true`,
`human: true`, never judged by anyone, and `wring deliver` branched, committed
and pushed (`BOARD_PROBE.md` gap 8).

The board renders that fact at the top of any board carrying a delivery: **"N
requirements needed a person and were handed over unanswered."** It states it;
it does not imply the delivery was held, because it was not.

**Whether `refuses` should be true for an unanswered required human criterion
is an engine question and is NOT decided here** — it changes `accept.py`'s
ruling 9 semantics, it is outside B2's one-engine-change budget, and it is a
policy call. **Recorded as OQ-1** (§12). The board's job meanwhile is to make
the situation impossible to miss, which it does.

### Ruling 11 — vacuity and health render only where their artifacts exist; absence is *not measured*

- **Vacuity** (`vacuity.json`) is written only under `run.prove: true` or
  `--prove`. The probe's delivered bundle carries none. Absent → the board says
  nothing about vacuity for that run, and never renders absence as *fine*
  (`BOARD_PROBE.md` gap 6).
- **Health** writes no file — it is a derived view
  (`schema/health-report.schema.json`). The board obtains it by running
  `wring health --json` through the CLI-as-API, or renders nothing.

### Ruling 12 — staleness is recomputed, is BOARD-level, and follows DELIVERY's document set

Nothing writes a stale verdict anywhere: the comparison runs live at the loop's
iteration boundary (`loop.py:854-856`) and at delivery
(`deliver.py:507-521`), and `briefed.json` holds only the digests captured at
brief time (`schema/briefed.schema.json`; `staleness.py:52-58`).

The board hashes the authorising documents as they are **now** and compares to
`briefed.json`, rendering **OUT OF DATE across the whole board** — not per
card, because the documents authorise the whole loop rather than one criterion.

**It follows delivery's document set, and the asymmetry is real and must not be
smoothed over.** Delivery compares all three (`staleness.AUTHORITY_DOCUMENTS`
at `staleness.py:53-57`: the spec, the rubric, `.wringer.yaml`). The loop's
iteration boundary compares only two (`staleness.BOUNDARY_DOCUMENTS`,
`staleness.py:76-79` — the gate config is deliberately excluded there). **The
board matches delivery**, because the question a PM is asking is *will this be
accepted*, and it names which set it used.

**The filenames are never hand-copied silently**: the surface imports the
tuple, and a test fails if what it imports differs from what it renders. Where
`briefed.json` is absent — every run no loop produced, and every loop bundle
written before that file existed — the board says nothing about staleness.

### Ruling 13 — the receipt is a path, and the board says only what walking it supports

`receipt.bundle` carries no timestamp, no message and **no digest of the cited
bundle** (`schema/acceptance.schema.json:74-77`; `BOARD_PROBE.md` gap 3). So the
board renders when and why the cited check failed by opening that bundle — and
**makes no claim that the cited bundle is unaltered.** v0 does not verify the
cited bundle's digests itself; where an attestation exists it may render
`wring audit`'s own verdict, attributed to `wring audit`. Silence about
tampering is correct; a padlock this surface did not earn is not.

### Ruling 14 — the spec's prose needs a YAML read, and that is this layer's dependency

`acceptance.json` carries each criterion's id, title and `required`, but the
spec `title` and the PM's `intent` live only in `wringer.spec.yaml`
(`BOARD_PROBE.md` gap 11). The surface reads them through the core's own spec
loader — never a second parser, for ruling 1's reason.

### Ruling 15 — `unevidenced` has FOUR causes and the board never renders one as another

(Review H2, HIGH.) `accept.py` produces `state == "unevidenced"` at four sites
with four different meanings:

| site | cause | what the board says |
|---|---|---|
| `accept.py:319-323` | unbound (`gate: null`) | Nothing checks this yet, so nobody can prove it either way. |
| `accept.py:350-354` | born green | The check passes but has never been recorded failing, so passing proves nothing yet. |
| `accept.py:374-380` | a sensitivity receipt whose pre-existence could not be established | The check passes, but this run could not establish that the check existed before the change. |
| `accept.py:386-393` | **the check arrived with the work** | A new check cannot vouch for the work that brought it. This check was created by the same change it judges. |

**Rendering the fourth as the second is false and backwards** — the record
*does* show that gate can fail; the objection is that the gate is new. It is
also the single refusal the README edit advertises as one of three things that
break the circularity objection, so getting it wrong on the board would
contradict the README two clicks away.

**The honest mechanism, stated because it is the weak part:** only `gate == null`
is structural. The other three are discriminated by **parsing the free-text
`reason` string**, which B4 forbids on a card face and which ruling 16's
totality test cannot enumerate, because the enumerable symbol is the five-value
state list and not the reason vocabulary. So:

- each of the three carries a **pinned fixture test**, so a wording change in
  `accept.py` fails loudly rather than silently re-labelling a card;
- a `reason` string matching none of the three renders **UNTRANSLATED** with
  the engine's words verbatim (ruling 17), never the generic born-green
  sentence;
- **OQ-4** asks the engine to name these sub-reasons, which is the real fix and
  is the same shape as OQ-2.

---

## §4 — Plain-language refusal rendering, total by construction (B6)

### Ruling 16 — the mapping is total, keyed on `(reason, discriminator)`, and totality is forced by a test

Every named reason the shipped code can emit gets **exactly one** PM sentence
and **one** unblocking question. **The key is `(reason, discriminator)` and not
the reason alone** (review M7), because `unevidenced` has four causes (ruling
15) and one sentence for four facts is the collapse ruling 15 exists to
prevent. `BOARD_PROBE.md` §5 is the first draft; the slice finishes it.

The reasons, enumerated from the engine at `d23d7ca`, **from public symbols**
(review M6 — the first draft reached for `loop._REASONS`, which is
underscore-private and which law 7's schema freeze does not cover):

| family | source of truth the test enumerates from | count |
|---|---|---|
| loop endings | **`graph.LOOP_REASONS`** (`graph.py:58`) — public, and already set-equal to `loop._REASONS` and `cli._LOOP_ENDINGS` in both directions by `tests/test_run.py:86-91` | 8 |
| criterion states | `schema/acceptance.schema.json:49-55` | 5 |
| `unevidenced` causes | the four sites in ruling 15, by pinned fixture | 4 |
| vacuity verdicts | `schema/vacuity.schema.json` `verdict` enum | 4 |
| health verdicts | `schema/health-report.schema.json` `$defs/gate/verdict` enum | 4 |
| signature / identity | `sign.SIGNATURE_STATES` (`sign.py:92`) and `sign.IDENTITY_STATES` (`sign.py:98`) | 7 |
| **integrity** | `sign.INTEGRITY_STATES` (`sign.py:90`) | 2 |
| fleet task outcomes | `schema/fleet-manifest.schema.json` `status` enum | 3 |

> **AMENDED 2026-08-17 — the integrity row and the exemption below it were
> both false, and had been since `ab884b5`.** OQ-5 was answered by that commit:
> `sign.INTEGRITY_STATES` is a real tuple at `sign.py:90`, so the row's
> "**no collection and no schema enum exists** — `sign.py:54-55` only" and the
> paragraph granting an exemption on those grounds describe a tree that stopped
> existing three days before this amendment. The two integrity values are now
> enumerated from the engine exactly like their two siblings, and
> **`wringer-board` already discharged the exemption in code** —
> `src/wringer_board/refusals.py:44-47` says so in its module docstring and
> `tests/test_refusals.py:150-155` deletes the per-value carve-out rather than
> leaving it as a comment nobody re-reads. The surface corrected itself and
> this spec did not follow; that lag is the defect, not the tuple.
> The `sign.py:81,87` citations in the row above had also drifted (the symbols
> are at `:92` and `:98`) and are corrected in the same edit, because leaving a
> wrong line number beside a corrected claim is how the next reader learns to
> distrust both. Original text preserved here:
>
> > | **integrity** | **no collection and no schema enum exists** — `sign.py:54-55` only | 2 |
> >
> > **The two integrity values carry an explicit per-value exemption with a reason
> > string in the test**, the shape Q3 already ruled for SECURITY.md's unprobeable
> > rows: they are hand-listed, the test says so out loud, and a *third* integrity
> > value would ship unguarded — which is stated rather than hidden, and is why
> > OQ-5 asks the core for an `INTEGRITY_STATES` tuple.

**All four families above are enumerated from a public engine symbol or a
schema enum, with no per-value exemption anywhere in the table.** A *third*
integrity value now cannot ship unguarded: it would join the tuple, and the
board's derived cross-check would redden until the mapping named it.

**Set equality in both directions.** A mapping entry for a reason the engine
cannot produce is dead text that reads as coverage, and that is exactly the
drift `tests/test_run.py:73` was written after.

### Ruling 17 — an unmapped reason renders inside a visible UNTRANSLATED state

Never invisibly, never swallowed, never best-effort-prettified. *A PM seeing an
ugly string files a bug report; a PM seeing nothing has been lied to.* The
UNTRANSLATED chip is a rendered state like any other and is covered by B3's
reachability test.

### Ruling 18 — the surface can never suppress, soften, or auto-resolve a refusal

Rendering a refusal in plain language is translation, not negotiation. There is
no dismiss, no "proceed anyway", no retry-until-it-passes, and no code path
that catches a refusal and continues. A violation is structural and greppable:
any `except` around a `wring` invocation that does not re-raise or render.

### Ruling 19 — the delivery path has no names, and the spec says so rather than inventing them

`deliver.py` raises `Refused` at 23 sites; every one is a prose string plus an
exit code, there is no reason enum, no machine-readable refusal record, and a
refused delivery writes no manifest at all (`BOARD_PROBE.md` gap 10). Three of
the 23 are reachable from an artifact and therefore renderable today — the
acceptance refusal (`deliver.py:592-606`, built from `refuses` rows), the
vacuity refusal (`deliver.py:479`) and the staleness refusal (`deliver.py:518`).

So: **the board maps the three; the other twenty render their prose verbatim
inside the UNTRANSLATED state, addressed to whoever runs the repo.** The claim
that all twenty are about git and the machine is this spec's reading of them
and the review did not re-check it; the rendering rule does not depend on it
being true. Naming the delivery refusals in the engine would be the right fix
and it is **not this cycle's** — B2 spends the one engine change on §10.
**Recorded as OQ-2** (§12).

---

## §5 — The interview surface

**Ruling 20 — the surface is a pen, not a new channel** (B5). Three
capabilities, each writing exactly what a hand-edit writes today:

1. **The conversation over `open_questions`.** An answer lands as an `answer:`
   line under its question, in the same file, in the same shape the core's spec
   loader reads (`loaded.unanswered`); `wring plan` reports what is still
   unanswered at `cli.py:2728-2744` and refuses, and that refusal is rendered,
   never pre-empted.
2. **The plain-language plan** — "here is what I will build, and here is how I
   will prove each piece" — rendered from the approved spec's criteria and the
   sidecar's `proves:` bindings (`spec.py:610-626` is the shape the drafter
   emits; `cli.py:2618-2633` writes the sidecar).
3. **The approve action**, which writes `approved: true` into
   `wringer.spec.yaml` and nothing else. **There is no `--yes` equivalent and
   this surface does not become one** — `cli.py:2717-2726` says the whole point
   of the step is that a person read what is about to be built, and a button a
   person clicks after reading a rendered plan is that same act. A button that
   approves *without* rendering the plan is not, and is forbidden. **Approving
   and answering a question are never the same action** (§1's B5 row).

The B5 test is byte equality: drive the button and the hand edit against the
same fixture and assert the resulting files are identical.

---

## §6 — The ratchet seam, oracle-agnostic (B7)

**Ruling 21 — spec the seam; build none of its machinery.**

The surface verb is one thing: **a PM's "no" on a card becomes a new or amended
criterion in `wringer.spec.yaml`, with a check that is proved red before any
repair runs.** The surface's whole job is to capture the complaint against the
criterion it belongs to and write it into the spec. What happens next belongs
to a supplier the surface does not name:

- **today**, GATEGEN's red-first path: the criterion goes into the spec, a gate
  is proposed into `wringer.gates.yaml` with a `proves:` line, a human installs
  it through `wring plan`'s diff, and the first `wring verify` records it RED
  because the thing is not built yet (`SPEC_GATEGEN_V0.md`; the probe's
  attempt-0 bundle is exactly this state on camera);
- **if Phase 3 lands the witness lane**, that lane is a second supplier of the
  same interface, for the amend-an-existing-behaviour case where no gate is
  naturally red.

**The seam's contract, and it names no oracle:** *given a criterion, a supplier
returns either a check demonstrated RED against the current tree, or a refusal.
The surface renders whichever it gets and neither retries nor substitutes.*

**This reads correctly under both outcomes of the 2026-09-30 re-test.** Under a
win, the witness lane is a second supplier and nothing here changes. Under
`WRINGER_RULING_2026-08-15.md` Q1's **automatic** de-scope — which fires on a
Phase 3 loss without a further Fable ruling — **the witness lane is out, and
the seam is served by GATEGEN alone.** R2's words on R2's trigger are *"net-new
work where the red is natural, GATEGEN as the whole product"*, and this spec
states the retreat at that strength. *(The first draft said the lane stopped
being a supplier "for that class", which left it alive for some unnamed other —
a one-word softening of a pre-committed retreat, caught by review M9 and
folded.)* **No sentence in this spec becomes false either way**, because no
sentence here depends on the witness existing.

**Q1's ceiling binds the surface verb.** The ratchet converts a piece of
unstated intent into a pinned, executable check. It does not make the check
know what the PM meant: *a check proves the criterion as it was written down.*
No artifact this cycle produces may claim the witness catches wrong fixes.

---

## §7 — The launch obligations: the quickstart number, and Demo R

**Ruling 22 — time-to-first-honest-green is a measured, filmed quantity with a
target** (L3). **Defined here; owned by the launch cycle** — no slice in §9
measures it.

- **Definition.** Wall-clock seconds from a clean checkout of a repository that
  has never run Wringer, to **the first bundle whose acceptance record reads
  `evidenced` for a required criterion.** The clock starts at the first command
  a stranger types and includes installation. *(The first draft defined it as a
  bundle "in which a required gate has failed at least once and then passed",
  which no single bundle can hold — a verify runs each gate once. Review L-4.
  `evidenced` is exactly the honest-green condition and is on disk.)*
- **Target: 10 minutes on a clean machine.** Stated as a target, not a claim;
  nothing is claimed anywhere until a capture exists.
- **Measured the way this house measures**: driven for real through the
  recorder into a committed cast, so the printout is a printout and not a person
  typing one (law 8).
- **The board is the ten-second artifact a stranger meets first**, and "send
  your PM this link" is a surface requirement: **a board page must be
  self-explanatory to a product manager with zero prior context** (B4, made
  concrete). The check is a usability one and it is cheap — hand the page to
  someone who has never heard of Wringer and ask what it says. A page that
  needs a preamble has failed.

**F6 is a LAUNCH GATE per L3, and its build is a separate cycle.**
`~/Claude/WRINGER_ENV_PLAN.md` owns it, R-ENV's one-agent review comes first,
and none of it is this spec's scope. **The quickstart number cannot honestly be
claimed while a fresh repo dies in minute three** on `No module named pytest` —
exit 1, which the loop currently reads as a repair job (`WRINGER_FACTORY.md`
F6). Measuring the number before F6 lands is legitimate; publishing it is not.

**Ruling 23 — Demo R, named** (L4). *A PM asks for a change. A vibe tool ships
it and silently breaks last week's requirement. The board shows the old
criterion going red, delivery REFUSED with the reason on screen, the loop
repairing it, and the card going green with a receipt citing the red run.*

**Slice S1 makes it filmable** and nothing later is required: every state in
that sentence is one S1 renders from stock artifacts, and the probe already
filmed four of the five. The missing one is the refusal, which needs a scenario
whose delivery is refused. **That scenario is S1's second capture** (review M11
— the first draft called it "an afternoon of scenario work, not a slice" and
then made it a DONE gate with no owner; it is now S1's, in §9's capture column).

**Launch timing is ruled in PM_ARC §11/L4 and is not this spec's to move.**
Repos may be public at any time; THE launch moment is spent once, when the
story has its ending.

---

## §8 — Non-goals (binding)

Each of these is refused, not deferred-with-a-wink.

1. **Live preview / serving the built app.** PM_ARC §3.4 v1, B8. Its own cycle.
2. **Hosting, auth, multi-user, sync, a server of any kind.** B1.
3. **Multi-repo.** F5 stays banked (PM_ARC §6).
4. **Any weakening of a refusal**, including a dismiss control, a snooze, a
   "proceed anyway", or a summary that omits one. B6, ruling 18.
5. **Any 20th command.** B2. The surface is not a `wring` subcommand.
6. **Translating `acceptance.json`'s `limits[]` into PM language.** Ruling 9's
   reason: a translated limit is a weakened limit unless the translation is
   guarded, and that guard is a cycle.
7. **Rendering PROVEN-RED.** Ruling 4. Not derivable from disk without
   re-implementing engine logic.
8. **Any judge, score, ranking, or quality verdict on a criterion.** The
   stop-list stands (`WRINGER_RULING_2026-08-15.md` sub-ruling 1): no judge
   ships, gates, scores, or appears in any product claim.
9. **Writing into `.wringer/`.** The surface reads bundles and writes only
   `wringer.spec.yaml` (§5) and its own output file.
10. **Editing a gate, a gate command, or a `proves:` binding from the
    surface.** Editing a command resets the criterion's discrimination history
    (`schema/acceptance.schema.json:60-63`; `accept.py:345` keys on
    `(gate.id, command)`); a PM surface that could do it silently would destroy
    evidence by clicking.

---

## §9 — Slice plan, and each slice names its capture

**The house does not claim unfilmed work.** No slice is DONE without its
capture.

| slice | what it builds | capture |
|---|---|---|
| **S1 — the board render** | §3 in full, from existing artifacts only. Six card states plus the REFUSED badge, both receipt kinds, the earned/withheld promise, the loud schema refusal, loop-ordered attempts. | (a) The rendered page from a real delivery. (b) The fault-injection triple: unknown schema version; broken receipt chain; a `sensitive` receipt resolved through `vacuity/`. (c) **Demo R** — the refused-delivery scenario, filmed (ruling 23). (d) **The cold-read**: the page handed to someone with no Wringer context, and what they said (§11 #1). |
| **S2 — refusal language** | §4's total mapping and its completeness test; ruling 15's four `unevidenced` fixtures; the UNTRANSLATED state; `test_no_surface_string_claims_a_wrong_fix_was_caught` and `test_no_rendered_string_uses_house_jargon`. | One board per family showing a real refusal in PM language, one showing an unmapped reason in the UNTRANSLATED chip, and the two grep tests passing over the whole rendered string table. |
| **S3 — the interview** | §5: conversation over `open_questions`, the rendered plan, the approve action. | The byte-equality fixture, filmed: the button and the hand edit producing identical files, and `wring plan`'s unanswered-questions refusal rendered rather than pre-empted. |
| **S4 — the artifact slot (CORE REPO)** | §10's engine change, alone, in the core. | A gate that leaves an artifact, the artifact digested in `digests.json`, `wring audit` covering it unchanged, the MR body carrying a count and no payload, and the B2 diff-scope assertion green. |

**S4 is sequenced last and alone**, in the core repo, to avoid file collisions
with Phase 2 (containment) and Phase 3 (witness wiring). It touches `schema/`,
`gates.py`, `evidence.py`, `config.py` and `deliver.py`'s MR body — and a board
window landing in those files while a containment window is open is exactly
what §8a's priority rule forbids.

**§8a's priority rule, restated here because it binds this spec:** **Phase 2,
Phase 3 and the 2026-09-30 re-test outrank every board slice.** Board windows
may run in parallel where files do not collide, but board work never delays a
containment or witness window and never touches their files. **If capacity
forces a choice, the date wins.**

---

## §10 — The engine change: a gate-artifact slot (slice S4, core repo, Law 7)

The one engine change this cycle spends (B2). It exists because
`schema/gate-result.schema.json` is closed over exactly nine fields with
`additionalProperties: false`, so a gate leaves `stdout.log`, `stderr.log`,
`result.json` and nothing else — and PM_ARC §3.4's "the criterion shows itself"
has nowhere to live (`BOARD_PROBE.md` gap 5).

**Ruling 24 — a NEW sibling file, never a relabel of the closed v1.** Law 7.
`result.json` gains no field and changes no meaning. Artifacts are declared in
**`gates/NNN_<id>/artifacts.json`**, schema `wringer.gate-artifacts.v1`, a
sibling on the pattern this repo has already used twice for exactly this
reason: `digests.json` beside a frozen `wringer.evidence.v1` manifest and
`briefed.json` beside a frozen `wringer.loop.v2` manifest — both schemas say so
in their own descriptions, and `schema/frozen.json` states that adding a NEW
schema file is always allowed. **The absence of the file is the compatibility
boundary** — every bundle written before it existed, and every gate that leaves
no artifact, reads exactly as it does today.

**Ruling 25 — capture mechanics.**

- **Where.** A gate writes into `gates/NNN_<id>/artifacts/` — a directory the
  harness creates and hands the gate by environment variable, the way
  `WRINGER_TASK_ID` (`loop.py:111`) is already handed to fleet children. A gate
  that writes nowhere leaves no directory and no `artifacts.json`.
- **What is recorded.** Per artifact: filename, byte size, sha256, and a media
  type taken from the extension against a closed allow-list. **No caption, no
  label, no meaning** — the harness does not get to say what a picture shows.
- **Which gates.** Opt-in per gate in `.wringer.yaml` — a new key on the gate
  stanza, added to `_GATE_KEYS` / `_CONFIG_GATE_KEYS` (`config.py:112,127`,
  enforced at `config.py:1621-1623`) and to **no** top-level key set. Off by
  default.
- **Size caps.** A per-artifact cap and a per-run total, both declared, both
  with conservative defaults. **Over-cap artifacts are OMITTED and NAMED, never
  silently truncated** — a truncated PNG is a corrupt PNG that reads as
  evidence, and `stdout_truncated` works only because text survives truncation.
  The omission is recorded in `artifacts.json` with its reason, so absence is
  stated rather than invisible. *(Not the word "refused": in this codebase
  `Refused` is a hard stop with an exit code, and an omission is not one.
  Review L-3.)*
- **Digest coverage costs nothing.** `evidence.digest_directory` walks every
  file in a bundle (`evidence.py:340-342`) and `attest.check_digests` catches
  added, missing **and** altered files (`attest.py:165-190`), so artifacts and
  `artifacts.json` are covered by the existing writer and `wring audit` verifies
  them unchanged.
- **MR bodies never carry gate output.** Standing constraint. The MR body
  (`deliver.py:845-889`) may gain a count — *"3 artifacts in the bundle"* — and
  never a payload, never a data URI, never a link that leaves the machine.

**Ruling 26 — redaction, stated honestly, and what that limits.**
`redact.py` erases the *values* of environment variables whose *names* match
`*TOKEN*`, `*SECRET*`, `*KEY*` and any pattern the repo adds, by substring
replacement, before the write (`redact.py:1-32`). **That is a text operation and
it cannot touch a binary artifact.** A screenshot can carry a token rendered on
a page, a customer's name in a fixture, an API key in a URL bar, and no pattern
in `.wringer.yaml` will remove any of it.

What that limits, ruled rather than hoped:

1. **Artifacts are never redacted, and the spec says so where a reader will
   meet it** — in the schema description, in the config key's comment, and on
   the board beside any artifact it renders.
2. **Artifacts are opt-in per gate.** Turning them on is a repo declaring that
   this gate's output is shareable.
3. **Artifacts never leave the machine by default**: not in the MR body, not in
   an attestation payload, not in anything `wring deliver --send` transmits.
   They live in the bundle, which is already one `git add -f` away from being
   public and is documented as such (`redact.py:5`).
4. **A text artifact is redacted like any other captured text**; the allow-list
   records which media types are redactable and which are not, so a reader can
   tell which of the two they are holding.

---

## §11 — Definition of DONE

This spec is DONE when all four slices have landed with their captures, and:

1. **A stranger with no Wringer context can read a board page and say what it
   means, without a preamble** — the cold-read, captured as S1(d).
2. Every card state in §3 ruling 4's table is reachable from a real fixture, and
   green without a resolved receipt chain is unreachable — both pinned by tests,
   and both receipt kinds covered.
3. The refusal mapping is total against the engine's own **public** symbol
   tables, **with no per-value exemption anywhere in it**, and the test fails
   when a new reason is added to the engine without a mapping.
   > **AMENDED 2026-08-17.** This criterion said "the two integrity values
   > carry a named exemption". That was a criterion this spec could no longer
   > pass *and should not*: `sign.INTEGRITY_STATES` landed at `ab884b5` and the
   > surface removed the carve-out, so the acceptance test as written demanded
   > an exemption the correct code has deleted. A shipped acceptance criterion
   > that a correct tree fails is worse than a stale sentence — it pressures
   > the next builder to re-introduce the defect. Strengthened, not dropped.
4. The approve button and the hand edit produce byte-identical files.
5. `wring --help` still lists 19 commands, and S4's diff adds exactly one
   schema file and no field on any frozen one.
6. **Demo R has been filmed** — S1(c).
7. Nothing in the surface claims the witness catches wrong fixes
   (`test_no_surface_string_claims_a_wrong_fix_was_caught`, built in S2), and
   the board's own limit line states Q1's ceiling in PM language.

*(The first draft carried #1, #6 and #7 as DONE gates with no slice producing
them — review M11. Each now names its slice.)*

---

## §12 — Open questions, for a Fable cycle and not for this window

- **OQ-1 — should an unanswered required `human` criterion refuse delivery?**
  Today it cannot: `Row.refuses` requires a bound gate (`accept.py:146-150`), so
  a criterion only a person can judge never stops anything, and the probe caught
  a real delivery pushed with one unanswered. Ruling 10 makes the board state
  it. Changing it is an engine policy call.
- **OQ-2 — should delivery refusals be named?** 23 prose refusals with no enum
  and no record on disk (ruling 19). Naming them would make B6's mapping total
  over the delivery path too, and would cost one engine change this cycle does
  not have.
- **OQ-3 — should the engine write "this check has been demonstrated able to
  fail" for non-evidenced rows?** It would earn PROVEN-RED (ruling 4) and it is
  a field on an artifact, not a new judgement — `accept.py` already computes it.
- **OQ-4 — should `unevidenced`'s four causes be named in the artifact?** Today
  three of the four are distinguishable only by parsing prose (ruling 15). This
  is OQ-2's defect one artifact over, and it is the one that made the board
  render the anti-circularity refusal backwards in this spec's first draft.
- **OQ-5 — should `sign.py` expose an `INTEGRITY_STATES` tuple? — ANSWERED
  YES, 2026-08-17, by a commit that pre-dated the answer.**
  `sign.INTEGRITY_STATES` landed at `ab884b5` (`sign.py:90`), beside
  `SIGNATURE_STATES` (`:92`) and `IDENTITY_STATES` (`:98`). A third integrity
  value can no longer ship unguarded past a derived check: it joins the tuple,
  and the board's cross-check reddens until the mapping names it.
  > **AMENDED 2026-08-17 — this question was open in prose and closed in code
  > for three days.** The original text ("the two integrity values are in no
  > collection and no schema enum, so a third would ship unguarded past any
  > derived check") was true when written and false when read. Recorded as an
  > answered question rather than deleted, because the gap between the commit
  > and this line is the evidence: `SPEC_REFUSAL_V0.md` §7 named these four
  > sentences instead of inheriting them, and this is where that naming is
  > discharged. The line citations `sign.py:81,87` had drifted as well.
- **DECISION PENDING — the layer's name.** `wringer-board` is proposed (§2).
  Marc's call; nothing waits on it.

---

## §13 — What this spec does not license

- It does not license **any claim about intent**. Everything the board renders
  is about the criterion **as written**. Q1's ceiling binds every string this
  cycle produces, and no artifact may claim the witness "catches wrong fixes."
- It does not license **a second implementation of the engine's judgement**.
  Ruling 1 is the boundary and it is not a style preference.
- It does not license **weakening, hiding, softening, deferring or
  auto-resolving a refusal**, in the surface or anywhere else.
- It does not license **the witness lane as a dependency**. §6 names an
  interface with two possible suppliers and reads correctly under the automatic
  de-scope, under which the lane is out entirely.
- It does not license **moving the launch**, spending the launch moment, or
  gating launch on a board slice. L4 owns that and PM_ARC §11 is where it lives.
- It does not license **board work displacing Phase 2, Phase 3 or the
  2026-09-30 re-test**. §9 restates the priority rule; if capacity forces a
  choice, the date wins.
- It does not license **the surface writing into `.wringer/`**, editing a gate,
  or touching a `proves:` binding.

---

## §14 — The review, and what it could not reach

**Independent, 2026-08-15, before any code**, by an agent that neither drafted
this spec nor will build to it — the debt `SPEC_GATEGEN_V0.md` had to carry and
pay late, paid up front here. **Verdict: SOUND WITH FINDINGS. 27 findings
(5 HIGH, 16 MEDIUM, 6 LOW). All 27 folded; none rebutted.**

**What it verified and found sound**, so a later reader knows what the pass
actually covered: all thirteen gap-inventory items answered and none silently
dropped; no B1–B8 or L1–L5 ruling weakened other than M9, which is folded;
`schema/acceptance.schema.json:30, 49-55, 60-63, 74-77`; `accept.py:146-150,
338-343, 345, 405-439`; `loop._REASONS` at exactly `loop.py:1386-1398` with 8
entries; `tests/test_run.py:73` pinning all three loop tables with set equality
in both directions; every count in ruling 16's table; ruling 8's ordering join
(`evidence_dir` is a required field of `loop-event-v2`, written at
`loop.py:721`); ruling 12's document sets; ruling 13; ruling 24's sibling-file
precedent and `schema/frozen.json`'s "adding a NEW schema file is always
allowed"; ruling 25's free digest coverage (`evidence.py:340-342`,
`attest.py:165-190`); ruling 26's redaction limit; exactly 19 `add_parser`
calls; exactly 23 `raise Refused` sites in `deliver.py` with the three
artifact-reachable ones where ruling 19 says; the README's placement, the
untouched Q1 ceiling sentence, and `tests/test_docs.py` + `tests/test_doctor.py`
green in the working tree.

**One finding was folded into this spec rather than into the artifact it
named.** Review L-2 caught a stale citation in `BOARD_PROBE.md` as well as in
this spec (`health.py:503-506` should be `502-505`). This spec's citations are
corrected; **the probe capture is left byte-identical**, because this document
pins it by sha256 and correcting a line number there would break the pin for a
nit. Captures are evidence and are not rewritten.

**What the review could not reach, stated because it bounds the verdict:**

- **Every test named in §1 and §9 is hypothetical.** No surface package exists.
  The review verified only that the symbols each test would enumerate exist and
  that the behaviours each test would assert are or are not present in the
  engine. Whether the tests are writable as described is judged, not measured.
- **The core publishes no library API.** This spec assumes the surface may
  import `staleness`, `spec`, `accept`, `health`, `sign`, `vacuity` and
  `graph.LOOP_REASONS` directly, and the core has never promised any of them
  (no `__all__`, no documented public surface). **S1's first task is to
  establish which imports the core is willing to promise**, and if the answer is
  none, the enumerations in ruling 16 come from the **schemas** instead, which
  are frozen and are a real contract. Ruling 16 is already schema-sourced for
  five of the eight families for this reason.
- The probe's seven screenshots were not opened; claims about what they show
  rest on `BOARD_PROBE.md`.
- PM_ARC §2's own `file:line` table was written against `6d8d543` and was not
  re-checked at its own commit. *(This window did verify the four citations
  PM_ARC §2 makes about `spec.py` and `cli.py` — `spec.py:610-620`,
  `cli.py:2618-2633`, `cli.py:2717-2725`, `cli.py:2728-2743` — and all four
  still point at what PM_ARC says they do at `d23d7ca`.)*
- The full suite was not run by the reviewer; only the two doc-guard modules.
  The landing window ran `scripts/ci-repro.sh` in the foreground.
- The remaining twenty `deliver.py` refusals were counted but not each read, so
  ruling 19's characterisation of them is this spec's reading and not the
  review's finding.
- Whether the recorder can capture a ten-minute install, as ruling 22 requires.
