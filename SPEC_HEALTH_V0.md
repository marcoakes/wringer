# SPEC — `wring health` (the next act, move 1)

*Drafted 2026-08-09 by the planning window, from `~/Claude/WRINGER_NEXT_ACT_PLAN.md`
and the direction brief's diagnosis. **NOT YET ADVERSARIALLY REVIEWED — and
that is a debt, not a footnote.** The review was launched and all four lanes
died on an account spend limit; they returned no findings because nothing
ran, which is not the same as a clean report and must never be read as one.
Every predecessor spec was reviewed before commit and every review found
real defects — SPEC_START_V0 four HIGH, SPEC_BENCH_V0 nineteen findings
including one that broke its central claim. **Run the review before building
H1** (`~/Claude/WRINGER_HEALTH_PLAN.md` §3, slice H0). This spec's first
draft already had one hole its author caught unaided — the undefined window,
ruling 3 — which is evidence that the unreviewed state is dangerous rather
than evidence that it is fine. The originating evidence is a single day in this
repository's own history: four checks found narrowed-but-passing — a guard
that was a tautology, a guard scoped to one workflow by name, a release probe
counting 13 of 17 commands while printing "all thirteen present", a roadmap
node claiming a finished feature on registration alone — plus a credential
leak re-introduced under twenty-one green tests. Every one was caught by
method; none by machinery. This spec is that machinery, for the part of the
problem evidence bundles can see. Marc delegated the rulings on 2026-08-09;
all are DECIDED below. Binding; no approval pauses remain.
[SPEC_SUPERVISION_V0.md](SPEC_SUPERVISION_V0.md) binds as everywhere;
[SPEC_VACUITY_V0.md](SPEC_VACUITY_V0.md) is load-bearing and unchanged — its
`--prove` is the instrument that *creates* the evidence this command reads,
and its `_FIX` line is this command's remedy.*

## Positioning

> **`wring health` reads the evidence your runs already wrote and answers,
> per gate, the question no dashboard asks: is there any evidence this check
> can still fail?** A gate that cannot fail is not a gate — vacuity says that
> about one run; health says it across time.

Deterministic, offline, no LLM, no socket, no new bundle: it is a *derived
report* over evidence that already exists, from the party with no stake in
what the report says. In the agent era checks are generated in volume and
rot silently, and a check that still runs while covering less than it claims
is indistinguishable from a healthy one everywhere green ticks are counted.
This command makes the two distinguishable, with receipts.

The one-sentence test for every design question below: **would this make the
report claim more than the bundles can evidence?** If yes, it is wrong.
Health never says a gate is *good* — it says what the record shows, names
the bundles it read, and counts the ones it could not.

## 1. What it does

```
wring health                    the vitality table, over every reachable bundle
wring health --from DIR         ...also read bundles under DIR; repeatable
wring health --strict           exit 1 if any REQUIRED gate is a zombie
wring health --json             one object on stdout, no human report
wring health --output FILE      write the report file as well
```

For every gate the history knows, three questions, answered only from
recorded evidence:

- when did it last **genuinely fail** (a `failed` result on the changed
  tree — not a timeout of the harness, not an interrupted run)?
- has it ever been **proven sensitive** (a `--prove` pass recorded it
  failing on the pre-change tree while passing on the changed one — a
  `vacuity.json` row with `sensitive: true`)?
- is anything about it **drifting** — duration trend, truncation, how often
  it is skipped?

## 2. The verdicts — and what each one refuses to claim

**The window comes first, because vitality is about the recent record, not
the archive.** A *qualifying run* is any verify bundle — standalone, a loop
iteration's, or bench-sourced — in which this `(id, command)` pair has a
`result.json`. The verdict is computed over the newest `WINDOW` qualifying
runs (`WINDOW` is 25); older evidence appears in the report as history but
decides nothing, because a gate that last demonstrated it could fail forty
runs ago is exactly the gate this command exists to question. Without the
window, one ancient failure would keep a gate `alive` forever — an
anti-decay model in a decay instrument.

| verdict | means, exactly | never means |
|---|---|---|
| `alive` | the newest `WINDOW` qualifying runs hold a genuine failure or a sensitive prove row | "this gate is well designed" |
| `untested` | fewer than `MIN_HISTORY` qualifying runs in the window — too thin to say anything | "probably fine" — thin history renders as thin history, never as health |
| `zombie` | at least `MIN_HISTORY` qualifying runs in the window and **no recorded evidence this gate can fail** in any of them — zero genuine failures, zero sensitive rows | "delete this gate" — a stable codebase can keep a good gate green for months; the claim is only that *nothing recent shows it discriminating* |

The remedy printed beside every `zombie` is the instrument that can settle
it in one run: `wring verify --prove`, which either records a sensitive row
(the gate comes alive with a receipt) or records `gates_vacuous` (the doubt
was correct, and delivery already refuses that bundle). Health and vacuity
are one thesis at two timescales, and the report says so in exactly those
words: *make the evidence better, not the check weaker*.

**`MIN_HISTORY` is 10, `WINDOW` is 25, and both are constants, not config
keys.** A tunable threshold is a knob for making zombies disappear, and the
first thing a repo under pressure would do is turn it. There is deliberately
no `health:` config section in v0.

## 3. The evidence model

### 3a. What is read

Every bundle reachable from the repo, plus whatever `--from` names:

- **verify bundles** (`.wringer/runs/*`) — each gate's `result.json` rows;
- **loop bundles** (`.wringer/loops/*`) — via the verify bundles their
  iterations wrote, which is where a repairing repo generates *failure*
  evidence constantly: a repo using `wring run` feeds its own health;
- **vacuity verdicts** (`vacuity.json` inside run bundles) — the
  per-gate `sensitive` rows, which are the strongest vitality evidence
  there is;
- **bench evidence** — baseline and contender bundles inside kept bench
  worktrees, labeled by source;
- **`--from DIR`**, repeatable — CI artifact downloads, other checkouts.
  Reading is recursive bundle *discovery* (a directory containing
  `manifest.json` with a known schema version), never execution of
  anything.

### 3b. Identity: a gate is `(id, command)`, and an edited gate starts over

The gate's `result.json` has recorded its redacted `command` since v0.1, so
this costs no schema change and no fallback. **History attaches to the
pair.** Change the command and the vitality record resets to `untested` —
because the old evidence is about a different check, and because *editing*
is how checks most often narrow: the session that motivated this spec
watched a probe keep its name while its coverage shrank. A rename with the
same command likewise starts over; continuity of meaning cannot be inferred
and is not.

The report shows retired pairs for the same id (`test — 2 prior
definitions, history reset 2026-08-01`), so an edit is visible rather than
silently absorbed.

### 3c. What counts, and what never counts

- A **genuine failure** is `status: failed` on the changed tree. A
  `timed_out` result counts as a failure of the *gate's subject* only if
  the gate has also failed without timing out in the window; a gate whose
  only "failures" are timeouts is flagged `drifting`, not `alive` —
  slowness is not discrimination.
- **Interrupted runs** contribute nothing: a gate with no `result.json`
  never finished, and non-evidence is not evidence.
- **Pre-change failures** from prove passes count as *sensitivity* (the
  gate CAN fail), never as failures of the code.
- **Optional gates** get verdicts too, but never trip `--strict` — the
  contract has always been that optional gates do not decide outcomes.
- **Absence is absence.** A gate declared in `.wringer.yaml` with no
  history at all renders `untested (0 runs)`, and no count in the report is
  ever an invented zero: unknown renders as `—`.

### 3d. Skipped history is counted, out loud

**A health tool that silently skips unreadable history is itself a
narrowing check** — the exact defect class this command exists to catch,
one level up. So the report's header is a coverage statement before it is
anything else:

```
read 47 bundles (41 runs, 3 loops, 3 bench) · skipped 2
  skipped: .wringer/runs/20260714-… (schema wringer.evidence.v0 — predates gate results)
  skipped: ci-artifacts/run-991 (manifest unreadable: not JSON)
```

Every skip is itemised with its reason. A `--json` consumer gets the same
under `coverage`. There is no quiet path: a bundle is read, or it is named.

### 3e. Drift, v0 scope

Reported per gate, never part of the verdict: duration trend over the
window (median of the newest five vs the oldest five, flagged past 2×),
`timed_out` occurrences, truncated-log occurrences, and how often the gate
is absent from runs that ran others (skip rate). These are facts with
receipts; interpreting them is the reader's. v0 draws no "slow = bad"
conclusions.

## 4. The report — derived, deterministic, and not a bundle

`wring health` writes **no bundle**. The evidence is the bundles it read;
this is a *view*, reproducible by anyone holding the same bundles, and a
copy would be a second source of truth to keep honest. `--output FILE`
writes the report wherever named (the docs commit one as a captured
artifact); nothing lands under `.wringer/` by default.

**The report is byte-deterministic**: same bundle set in, same bytes out.
It carries no timestamp of its own — every date in it comes from the
bundles. This is a testable property and a DONE box, because a report that
varied run-to-run over identical evidence would be adding something that is
not evidence.

`--json` is a **published format**: `health-report.schema.json`, a new
file, frozen on publish — because the GitHub Action step and strangers'
scripts will parse it, and an unschema'd shape consumed by automation is a
format nobody promised to keep. Top level: `schema_version`
(`wringer.health.v1`), `coverage` (read/skipped, itemised), `gates` (one
entry per `(id, command)` pair: verdict, counts, last-failure ref,
last-sensitive ref, drift facts, receipts as bundle-relative paths),
`retired` (prior definitions per id), `limits`.

**`limits` is non-empty and printed on success** — the attestation's
ruling, again, because a vitality report is exactly the artifact a reader
will inflate:

1. *Health reads recorded evidence. A gate can be well designed and still
   `zombie` here — the claim is about the record, not the gate's soul.*
2. *Only declared gates are visible. Checks that live outside
   `.wringer.yaml` — scripts, CI steps, hand-kept lists — are beyond this
   instrument, and they narrow too.*
3. *History below `MIN_HISTORY` runs proves nothing in either direction.*

## 5. Exit codes

`0` the report was produced, whatever it says — health is an observer, and
bench's ruling 7 applies verbatim: an instrument that exited non-zero after
successfully measuring decay would report its own state with the patient's
chart · `1` **only** under `--strict`, and only when a required gate is
`zombie` — a tightening flag in the house sense: it can only make CI
stricter, and there is no flag that loosens anything · `2` config or
environment (not a repo; unreadable config) · `4` interrupted · never `3`
(health refuses nothing about the tree — it does not even need the tree,
only the bundles) · **never `5`**, and the never-returns-5 family is
extended to pin it.

## 6. Where it bites: the Action, not attest (v0)

The shipped `examples/github-actions/` recipe gains a step: run
`wring health --json` after verify, render the delta as a PR comment. **The
pull request is where somebody is finally held to the answer** — a reviewer
who sees `test: zombie — no recorded failure in 31 runs` before approving
is the pull this product has been missing.

`wring attest` is deliberately **untouched** in v0. Coupling the
attestation to longitudinal history would change what an attestation
claims (today: this bundle, this run, unaltered), and that is a
SPEC_PROVENANCE amendment to make with intent, not a rider. A `limits`
line in attestations citing health is named as the v1 candidate and
nothing more.

## 7. Rulings

1. **Verdicts claim the record, never the gate — DECIDED.** `zombie` means
   "no recorded evidence of discrimination", with the count and the window
   in the same sentence. The report never says good/bad; it says what
   happened and where the receipts are. This is the positioning line's
   test applied to every output string.
2. **A gate's identity is `(id, command)` and edits reset history —
   DECIDED.** Editing is how checks narrow; continuity across an edit
   cannot be evidenced, so it is not granted. The retired-definitions
   section makes the reset visible. `command` has been in every
   `result.json` since v0.1, so this reaches all recorded history.
3. **`MIN_HISTORY` and `WINDOW` are constants — DECIDED.** A threshold key
   would be a knob whose only realistic use is making zombies disappear
   before a release; a window key would be the same knob wearing recency.
   Repos with thin history get `untested`, which is the true answer — and
   the window exists at all because without it one ancient failure keeps a
   gate `alive` forever, an anti-decay model in a decay instrument. That
   hole was found in this spec's own first draft, which referenced "the
   window" and never defined one.
4. **No bundle, and byte-determinism — DECIDED.** The report is a view;
   the bundles are the evidence; a stored copy would be a second truth. No
   own-timestamp, no environment reads, same bytes for same inputs — and a
   test proves it by running twice and diffing.
5. **Skips are itemised or the tool is lying — DECIDED.** Silent skipping
   is the narrowing defect with a lens in its hand. The coverage statement
   leads the report, machine and human both.
6. **Health is an observer: 0 on completion, `--strict` is the only tooth,
   and it only tightens — DECIDED.** Follows bench ruling 7 and the
   flags-tighten law; refusing by default would make the first run in
   every old repo a wall of red and the tool would be turned off by noon.
7. **The timeout asymmetry — DECIDED.** Timeouts alone never make a gate
   `alive`: a gate that only ever dies of slowness has never demonstrated
   it can *reject* anything, and counting it would let the least healthy
   gates read as the most alive. They surface as drift instead.
8. **attest stays out of v0 — DECIDED** (§6). What an attestation claims
   is a different spec's contract; health earns its coupling after it has
   history of its own.

## 8. Non-goals (binding)

Any LLM call · any socket, sender, or fetcher · a new bundle family or any
write under `.wringer/` · scoring, grading, or ranking gates · a `health:`
config section or any threshold knob · auto-fixing, auto-deleting, or
auto-proposing gates (the evolve-loop shape, rejected in the next-act plan,
stays rejected) · reading anything that is not an evidence bundle (no git
history mining, no CI-API calls) · coverage of checks outside
`.wringer.yaml` (limit 2 says so on every report) · amending `wring
attest` · cron/watch modes · Windows.

## 9. Definition of DONE

- [ ] the decay demo, captured end to end through real processes: the
      gate demonstrably `alive` (a genuine failure on camera), then an
      agent that "fixes" by neutering, then enough green runs that the
      window holds no discrimination — and `wring health` reads `zombie`
      with the receipts, while every individual bundle still audits clean.
      The bulk runs may execute as one displayed-equals-executed shell
      step; the recorder gains no new capability
- [ ] a gate whose `command` changed mid-history resets to `untested`,
      shows its retired definition, and a test pins that the OLD history
      cannot keep the NEW command `alive`
- [ ] `untested` renders for thin history and a test fails if any absent
      count renders as `0` or any thin-history gate renders `alive` or
      `zombie`
- [ ] a `sensitive: true` vacuity row makes a gate `alive` with the run
      named; reverting the sensitivity read must redden exactly that test
- [ ] a gate whose only failures are timeouts is not `alive`, and is
      flagged in drift — pinned by a test with a planted slow gate
- [ ] the coverage header itemises every skipped bundle with a reason; a
      planted unreadable bundle appears in it, and a test fails if the
      skip count and the itemised list disagree
- [ ] byte-determinism: two runs over the same bundle set produce
      identical `--json` bytes, pinned by a test that diffs them
- [ ] `--strict` exits 1 for a required zombie, 0 for an optional one, and
      the never-returns-5 guard family is extended to `health`
- [ ] `health-report.schema.json` published, frozen in the same commit,
      drift test extended, and a real report validates against the real
      engine
- [ ] `wring health` provably opens no socket — the import-parsing test's
      method, not a grep
- [ ] every parser-derived guard passes in the shipping commits: command
      table and heading, module map, the roadmap row (probed on
      `docs/health.md` like P6/P7, so the node cannot go green before the
      feature is finished), and the milestone-coverage guard
- [ ] the Action recipe's health step parses against the real CLI, sends
      nothing, and its workflow lines are covered by the recipe guards
- [ ] `docs/health.md` carries the captured decay demo via the recorder's
      derived STEP_SETS machinery, inside its 80-column canvas
- [ ] the report's three `limits` are pinned by content, not by
      non-emptiness — the narrowing lesson, applied to this spec's own
      checklist
