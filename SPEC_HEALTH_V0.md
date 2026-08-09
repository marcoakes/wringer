# SPEC — `wring health` (the next act, move 1)

*Drafted 2026-08-09 by the planning window, from `~/Claude/WRINGER_NEXT_ACT_PLAN.md`
and the direction brief's diagnosis. **Adversarially reviewed 2026-08-09**:
four contradiction-hunter lanes (machinery, corpus, internal, demo), all four
completed, **thirty-three findings, twelve of them HIGH** — folded below. The
first review attempt died on an account spend limit and returned `findings: []`
because nothing ran; that empty result was recorded here as a debt rather than
read as a clean report, and this line replaces it because the review has now
actually happened. The re-run harness itemises lane deaths for exactly that
reason: an empty result from a failed run is never a pass. What the review
broke is written into the rulings rather than smoothed away — the largest were
that the spec's own predicate for a genuine failure admitted every timeout
(inverting ruling 7), that `alive` and `untested` overlapped with no precedence
so two DONE boxes could not both pass, that one `wring bench` would stamp every
gate `alive` on evidence about a deliberately broken commit, that the enforcement
venue in §6 was structurally empty, that skip rate was not computable from
anything a bundle records, and that §3d's only worked coverage example cited
`wringer.evidence.v0` — **a schema version that has never existed anywhere in
this repository**, a fabricated receipt inside the spec whose thesis is that a
report may never claim more than the bundles evidence. Every predecessor spec
was reviewed before commit and every review found real defects (SPEC_START_V0
four HIGH; SPEC_BENCH_V0 nineteen, one of which broke its central claim); this
one is no exception, and the unreviewed state it briefly shipped in was as
dangerous as that history predicted. The originating evidence is a single day in
this repository's own history: four checks found narrowed-but-passing — a guard
that was a tautology, a guard scoped to one workflow by name, a release probe
counting 13 of 17 commands while printing "all thirteen present", a roadmap node
claiming a finished feature on registration alone — plus a credential leak
re-introduced under twenty-one green tests. Every one was caught by method; none
by machinery. This spec is that machinery, for the part of the problem evidence
bundles can see. Marc delegated the rulings on 2026-08-09; all are DECIDED below.
Binding; no approval pauses remain.
[SPEC_SUPERVISION_V0.md](SPEC_SUPERVISION_V0.md) binds as everywhere;
[SPEC_VACUITY_V0.md](SPEC_VACUITY_V0.md) is load-bearing and unchanged — its
`--prove` is the instrument that *creates* the evidence this command reads, its
`_FIX` line is this command's remedy, and **its §5a blind spot is inherited
whole and stated in this command's own `limits`** (ruling 13).*

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
wring health --output FILE      write that same output to FILE as well
```

`--output FILE` writes **the output the other flags selected** — the JSON
object under `--json`, the human report otherwise. It is one rule, not two
formats, and it exists because the shell spellings that would otherwise be
needed (`> file`, `| tee`) cannot appear in the Action recipe: the recipe
guard parses every `wring` line with the real parser, and a redirect lands in
`argv` as an unrecognised argument. A flag was the only spelling that could
survive the guard the DONE boxes require it to pass.

For every gate the history knows, three questions, answered only from
recorded evidence:

- when did it last **genuinely fail** (a `failed` result that was not a
  timeout, on the changed tree — not a timeout of the harness, not an
  interrupted run)?
- has it ever been **proven sensitive** (a `--prove` pass recorded it
  failing on the pre-change tree while passing on the changed one — a
  `vacuity.json` row with `sensitive: true`)?
- is anything about it **drifting** — duration trend, timeouts, truncation?

There is no fourth question about skipping. The first draft asked one, and
§3e records why it was withdrawn rather than quietly answered.

## 2. The verdicts — and what each one refuses to claim

**The window comes first, because vitality is about the recent record, not
the archive.** A *qualifying run* is any verify bundle in which this
`(id, command)` pair has a `result.json` — standalone, or written by a loop
iteration — **excluding bench-sourced bundles, which are read and shown but
decide nothing** (ruling 9). The verdict is computed over the newest `WINDOW`
qualifying runs (`WINDOW` is 25); older evidence appears in the report as
history but decides nothing, because a gate that last demonstrated it could
fail forty runs ago is exactly the gate this command exists to question.
Without the window, one ancient failure would keep a gate `alive` forever —
an anti-decay model in a decay instrument.

| verdict | means, exactly | never means |
|---|---|---|
| `alive` | the newest `WINDOW` qualifying runs hold a genuine failure or a sensitive prove row — **at any history depth** | "this gate is well designed" |
| `zombie` | at least `MIN_HISTORY` qualifying runs in the window and **no recorded evidence this gate can fail** in any of them — zero genuine failures, zero sensitive rows | "delete this gate" — a stable codebase can keep a good gate green for months; the claim is only that *nothing recent shows it discriminating* |
| `untested` | fewer than `MIN_HISTORY` qualifying runs in the window, and none of them positive — too thin to say anything | "probably fine" — thin history renders as thin history, never as health |
| `retired` | this pair is no longer the contract (§3b) — history and receipts are shown, and **no verdict is claimed** | "this gate was bad" — a retired definition is a check that was edited or removed, nothing more |

**Precedence is explicit, because the first draft left it undefined and two
DONE boxes could not both pass** (ruling 10). `retired` is decided first.
Then **positive evidence decides at any depth**: one genuine failure or one
sensitive row makes a gate `alive` whether the window holds three runs or
twenty-five, because a demonstration is a demonstration and no quantity of
runs is needed to believe one. Only when there is no positive evidence does
the count matter, and it splits `zombie` from `untested`. A gate can never
satisfy two rows.

The remedy printed beside a `zombie` is `wring verify --prove`, **and the
report states honestly what it can and cannot settle** (ruling 11). Run on a
tree with changes, a prove pass records, for each required gate, either a
`sensitive: true` row — the gate comes alive with a receipt — or an
insensitive one, which is the doubt confirmed for that gate with a receipt of
its own. It settles nothing at all in three cases the first draft's binary
denied: **optional gates are never proved** (SPEC_VACUITY §6 non-goal, so the
remedy is not printed beside an optional zombie — the note printed there says
the only route out is a genuine failure); an unchanged tree or an already-red
required gate records `not_applicable`; and a broken prove environment records
`inconclusive`. The first draft also claimed that the negative outcome is
"already refused by delivery" — false: `gates_vacuous` is a *whole-set*
verdict requiring every required gate to be insensitive, so a single
insensitive gate beside a sensitive one reads `proven` and delivers. Health
and vacuity are one thesis at two timescales, and the report says so in
exactly those words: *make the evidence better, not the check weaker*.

**`MIN_HISTORY` is 10, `WINDOW` is 25, and both are constants, not config
keys.** A tunable threshold is a knob for making zombies disappear, and the
first thing a repo under pressure would do is turn it. There is deliberately
no `health:` config section in v0.

## 3. The evidence model

### 3a. What is read, and from exactly where

Discovery is over **named search roots**, not a universal, because "every
bundle reachable from the repo" cannot be implemented and cannot be audited —
and a scope nobody can state is the narrowing defect this command hunts. The
roots, in this order, each walked recursively:

- `.wringer/runs/` — **verify bundles**, each gate's `result.json` rows;
- `.wringer/loops/` — **loop bundles**. Read for the coverage ledger and for
  labelling only. Health does **not** resolve a loop to its iterations
  through `result.final_run`: that field names only the last (converged,
  passing) verification, and it is recorded relative to the root the loop ran
  in, which the bundle itself does not name. The iteration verifies a loop
  wrote are ordinary bundles already sitting in the same root's
  `.wringer/runs/`, and they are discovered there directly — which is where
  a repairing repo generates *failure* evidence constantly: a repo using
  `wring run` feeds its own health. This is deliberate: it removes the path
  relativity that `bench._final_run_of` had to be fixed for, rather than
  reproducing it;
- `.wringer/benches/` and `.wringer/worktrees/` — **bench evidence**, read
  and itemised, **labelled `bench` and non-qualifying** (ruling 9);
- `.wringer.example/` — the committed fixture. Named explicitly because it is
  the oldest bundle in the tree and, `.wringer/` being gitignored, the only
  one in a fresh clone. It must land in `read`;
- **`--from DIR`**, repeatable — CI artifact restores, other checkouts.
- **`vacuity.json` inside any run bundle read above** supplies the per-gate
  `sensitive` rows, which are the strongest vitality evidence there is.

Reading is bundle *discovery* — **a directory containing a `manifest.json`,
readable or not** — never execution of anything. The predicate deliberately
does not require the manifest to parse or to carry a known schema version:
the first draft required both, which made every bundle §3d promises to
itemise as skipped invisible to discovery instead, so "there is no quiet
path" was false in the same spec that asserted it (ruling 12). Whether the
manifest parses decides `read` versus `skipped`; it does not decide whether
the bundle was *seen*.

**Duplicates are collapsed and said out loud.** `--from` is repeatable and
takes arbitrary paths, so the same bundle can arrive twice — `--from .`
alongside the repo's own roots, or a CI restore of the repo's own
`.wringer/runs`. Counting it twice would move gates across `MIN_HISTORY` and
pad the window until an older failure fell out of it: an unnormalised path
argument doing the job ruling 3 removed the config key to prevent. So roots
are resolved to real paths before walking, a bundle is identified by its
`run_id`, and a second sighting is **counted once and itemised in coverage as
a duplicate, naming both paths** — never silently merged.

### 3b. Identity: a gate is `(id, command)`, and an edited gate starts over

The gate's `result.json` has recorded its redacted `command` since v0.1, so
this costs no schema change and no fallback. **History attaches to the
pair.** Change the command and the vitality record resets — because the old
evidence is about a different check, and because *editing* is how checks most
often narrow: the session that motivated this spec watched a probe keep its
name while its coverage shrank. A rename with the same command likewise
starts over; continuity of meaning cannot be inferred and is not.

**Sensitivity is keyed to the pair by a join, and the join is stated here
because it is the one place ruling 2 could silently fail.** A `vacuity.json`
row carries `gate_id` and no `command` — the schema's rows are
`additionalProperties: false` and `vacuity.read_verdict` exposes exactly those
fields. Attributing a sensitive row to a pair therefore means reading the
`command` from the sibling `gates/NNN_<id>/result.json` **in that same
bundle**. An implementation that keys sensitivity on `gate_id` alone lets an
edited gate inherit its predecessor's sensitivity and stay `alive` — ruling 2
defeated in the precise case ruling 2 exists for — so the DONE box pins the
sensitivity path by name and not only the failure path.

**Health never reads a command out of `.wringer.yaml`.** Commands in
`result.json` were redacted when they were recorded; a command in the config
is raw, and scrubbing it would mean resolving declared secret names against
the live environment — an environment read, which ruling 4 forbids and which
would make the same bundles produce different bytes in different shells. So a
gate the config declares with no history at all renders with its **id only**
and its command as `—`: unknown, in the grammar §3c already requires.

**A pair that is no longer the contract is `retired`.** When a readable
config is present, that means the config declares no gate with this exact
pair; when no config is present, it means the pair appears in none of the
newest `WINDOW` bundles overall. Retired pairs render their history, their
receipts, and their prior definitions under `retired` — and carry no verdict.
Without this rule a renamed or deleted gate's window freezes at whatever it
last held and it reads `alive` in perpetuity, from evidence of arbitrary age,
for a check that no longer exists: the exact anti-decay hole ruling 3 exists
to close, walked back in by the pair-scoped window (ruling 14). The report
shows retired pairs against their id where the id survives (`test — 2 prior
definitions, history reset 2026-08-01`), so an edit is visible rather than
silently absorbed.

### 3c. What counts, and what never counts

- A **genuine failure** is `status: failed` **and `timed_out: false`** on the
  changed tree. Both halves are required and the second is not decoration:
  `gate-result.schema.json` has a two-value status whose own description
  reads *"passed requires exit_code 0 AND timed_out false"*, so **every
  timeout already records `status: failed`**. The first draft's predicate was
  `status: failed` alone, which admitted every timeout and computed `alive`
  for a gate that has only ever died of slowness — inverting ruling 7 in the
  sentence before ruling 7 states it.
- **A gate whose only failures in the window are timeouts is `zombie` or
  `untested` by the ordinary count, never `alive`**, and its timeouts are
  reported in drift. Slowness is not discrimination. The first draft said
  such a gate is "flagged `drifting`" — a word that is not one of the
  verdicts, leaving the verdict undefined for a gate whose verdict decides
  `--strict`'s exit code.
- **Bench-sourced runs never qualify** (ruling 9).
- **Interrupted runs** contribute nothing: a gate with no `result.json`
  never finished, and non-evidence is not evidence.
- **Pre-change failures** from prove passes count as *sensitivity* (the gate
  CAN fail), never as failures of the code.
- **Optional gates** get verdicts too, but never trip `--strict` — the
  contract has always been that optional gates do not decide outcomes.
  Requiredness for `--strict` is read from `.wringer.yaml` and from nowhere
  else: the per-run `optional` flag is mutable across a pair's history and a
  window can hold both values, so the recorded flag cannot source the
  decision. A pair the config does not declare is `retired` and can never
  trip `--strict`, which is the same answer arrived at twice.
- **Absence is absence.** A gate declared in `.wringer.yaml` with no history
  at all renders `untested (0 runs)`, and no count in the report is ever an
  invented zero: unknown renders as `—`.

### 3d. Skipped history is counted, out loud

**A health tool that silently skips unreadable history is itself a
narrowing check** — the exact defect class this command exists to catch,
one level up. So the report's header is a coverage statement before it is
anything else:

```
searched 5 roots · read 47 bundles (41 runs, 3 loops, 3 bench) · skipped 2 · duplicate 1
  skipped: ci-artifacts/run-991 (manifest unreadable: not JSON)
  skipped: ci-artifacts/run-992 (schema wringer.evidence.v2 — written by a newer Wringer)
  duplicate: ci-history/runs/20260801-… already read as .wringer/runs/20260801-…
```

Every skip is itemised with its reason, every duplicate names both paths, and
the roots searched are named — a scope the reader can check is the only kind
worth stating. A `--json` consumer gets the same under `coverage`. There is no
quiet path: **a bundle is read, or it is named, and the arithmetic
`discovered == read + skipped + duplicate` is pinned by a test**, because the
first draft's DONE box pinned only that the skip count matched the skip list,
which a bundle dropped before classification passes silently.

The draft's worked example cited a bundle skipped for `schema
wringer.evidence.v0 — predates gate results`. **No such schema version has
ever existed**: `manifest.schema.json` pins `schema_version` to the constant
`wringer.evidence.v1`, and a grep of the whole repository found
`wringer.evidence.v0` in exactly one place — that line. It has been replaced
above with a reason that can actually fire. It was also self-refuting: if
bundles predating gate results existed, ruling 2's "`command` has been in
every `result.json` since v0.1, so this reaches all recorded history" would
be false, and with it §3b's claim of no fallback path.

### 3e. Drift, v0 scope

Reported per gate, never part of the verdict: duration trend over the window
(median of the newest five vs the oldest five, flagged past 2×), `timed_out`
occurrences, and truncated-log occurrences. These are facts with receipts;
interpreting them is the reader's. v0 draws no "slow = bad" conclusions.

**Skip rate was specified in the first draft and is withdrawn, by name and
with the reason** — because a promise removed on the record is worth more
than one quietly unmet. It is not computable from anything a bundle records.
AGENTS.md pins the contract that *"skipped gates leave no trace in
`evidence.jsonl` and no directory"*; no bundle stores the gate set it was
planning to run; a `wring verify --gate lint` run is byte-indistinguishable
from a run where `test` was skipped, and stop-on-first-required-failure
produces the same shape for a third reason. Worse, the only observable is a
gate's absence, and absence has no `command`, so it cannot be attributed to
the `(id, command)` pair that keys the report at all — and §3c has already
ruled that absence is absence. Counting it would be the invented number §3c
bans, computed over a denominator that is by construction zero inside a
window defined by the gate's own qualifying runs. Restoring it needs a
recorded declared-gate set, which is a schema change and a different slice.

## 4. The report — derived, deterministic, and not a bundle

`wring health` writes **no bundle**. The evidence is the bundles it read;
this is a *view*, reproducible by anyone holding the same bundles **and the
same `.wringer.yaml`** — the config is a second input and the first draft's
"reproducible by anyone holding the same bundles" was wrong to omit it: §3c
renders declared-but-history-less gates, and §3b sources requiredness and
retirement from the config. `--output FILE` writes wherever named — including
under `.wringer/` if the reader types that path, which is the reader's choice
and not health writing there of its own accord; §8's non-goal forbids health
*creating* anything under `.wringer/`, not honouring a path argument.

**The report is byte-deterministic**: same bundles and same config in, same
bytes out. It carries no timestamp of its own — every date in it comes from
the bundles — reads no environment variable, and sorts at every boundary
because directory iteration order is OS-dependent. All three properties are
pinned separately (§9), because a test that merely runs twice and diffs is
satisfied by code that embeds today's date, reads the environment, and
depends on `os.listdir` order — the narrowing pattern this spec warns about
elsewhere in its own checklist.

`--json` is a **published format**: `health-report.schema.json`, a new
file, frozen on publish — because the GitHub Action step and strangers'
scripts will parse it, and an unschema'd shape consumed by automation is a
format nobody promised to keep. Top level: `schema_version`
(`wringer.health.v1`), `coverage` (roots, read/skipped/duplicate, itemised),
`gates` (one entry per `(id, command)` pair: verdict, counts, last-failure
ref, last-sensitive ref, drift facts, source label, receipts), `retired`
(prior and no-longer-contracted pairs), `limits`.

**Receipts are repo-root-relative**, and a bundle found under a `--from` root
is rendered relative to that root with the root named — never
"bundle-relative", which in this repo already means *relative to a bundle's
own root* (`vacuity.schema.json` uses it that way) and is the one base a
receipt cannot use, since a receipt's whole job is to say *which bundle*.
Getting this base wrong is what the plan calls the place this breaks first,
and the shape freezes on publish.

**`limits` is non-empty and printed on success** — the attestation's
ruling, again, because a vitality report is exactly the artifact a reader
will inflate:

1. *Health reads recorded evidence. A gate can be well designed and still
   `zombie` here — the claim is about the record, not the gate's soul.*
2. *Only declared gates are visible. Checks that live outside
   `.wringer.yaml` — scripts, CI steps, hand-kept lists — are beyond this
   instrument, and they narrow too.*
3. *Thin history cannot support `zombie`. It can support `alive`: one
   recorded failure is a demonstration, and no number of runs is needed to
   believe a demonstration.*
4. *A sensitive row proves the gate's result changed with the tree — not
   that the change was honest. SPEC_VACUITY §5a: an agent that deletes an
   already-failing assertion records `sensitive: true` for the wrong reason,
   and health will read that as vitality. This instrument inherits that blind
   spot whole.*

Limit 4 is new and is the review's sharpest structural finding: the neutering
scenario this spec chose as its own demo is precisely the scenario that mints
a fresh vitality receipt for the gate being neutered. Stating it is the only
honest option, and the demo is staged so the caveat is visible rather than
hidden (§9, box 1). Limit 3 replaces a first-draft limit that read "history
below `MIN_HISTORY` proves nothing in either direction", which was false in
the positive direction against §1's own sensitivity question.

## 5. Exit codes

`0` the report was produced, whatever it says — health is an observer, and
bench's ruling 7 applies verbatim: an instrument that exited non-zero after
successfully measuring decay would report its own state with the patient's
chart · `1` **only** under `--strict`, and only when a required gate is
`zombie` — a tightening flag in the house sense: it can only make CI
stricter, and there is no flag that loosens anything · `2` unreadable config,
or **no search root at all** — health does not require a repo when `--from`
supplies a root, because "CI artifact restores, other checkouts" is `--from`'s
stated purpose and a CI scratch directory is normally not a git checkout; the
first draft exited 2 for "not a repo" in the same sentence that said health
does not need the tree · `4` interrupted · never `3` (health refuses nothing
about the tree — it does not even need the tree, only the bundles) · **never
`5`**, and the never-returns-5 family is extended to pin it.

## 6. Where it bites: the Action, not attest (v0)

The shipped `examples/github-actions/` recipe gains a health step that renders
the vitality table into the job's step summary, where a reviewer reads it
beside the gates.

**The first draft's version of this section did not work, and the review was
right to call it the spec's emptiest claim** (ruling 15). It said "run `wring
health --json` after verify, render the delta as a PR comment", and neither
half was reachable. `.wringer/` is gitignored — AGENTS.md pins that real runs
stay local and nothing uploads, ever — and the recipe starts from a bare
`actions/checkout@v4`, so the only bundle in the job is the one `wring verify`
just wrote. One qualifying run against a `MIN_HISTORY` of 10, with ruling 3
forbidding the escape, makes **every gate on every pull request render
`untested`**. The illustrated experience — `test: zombie — no recorded failure
in 31 runs` — was unreachable in the venue the section exists to serve. And
"the delta" needs two states: §1 offers no baseline input, §4 refuses to store
a prior report, and §8 forbids CI-API calls, so there was nothing to subtract.

So, honestly: **history must be carried into the job by the workflow, and the
recipe shows how** — a cache step restoring a history directory across runs,
and `wring health --from` reading it. Wringer opens nothing and fetches
nothing; it reads a directory somebody else populated, exactly as it reads
`--from` anywhere. The step summary render needs no token and sends nothing.
The recipe states in its own comment that a first run, with no restored
history, reads `untested` for everything, and that this is the true cold-start
answer rather than a defect — the Action is also what *builds* the history at
PR cadence. **A delta is a v1 candidate and nothing more**, named here with
the reason it cannot ship in v0.

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
   `result.json` since v0.1, so this reaches all recorded history — and the
   sensitivity half reaches it only through the join §3b now states, which
   the review found was assumed and unwritten.
3. **`MIN_HISTORY` and `WINDOW` are constants — DECIDED.** A threshold key
   would be a knob whose only realistic use is making zombies disappear
   before a release; a window key would be the same knob wearing recency.
   Repos with thin history get `untested`, which is the true answer — and
   the window exists at all because without it one ancient failure keeps a
   gate `alive` forever, an anti-decay model in a decay instrument. That
   hole was found in this spec's own first draft, which referenced "the
   window" and never defined one; rulings 9 and 14 close the two further
   routes the review found back to the same place, through `--from`
   duplication and through bench evidence.
4. **No bundle, and byte-determinism — DECIDED.** The report is a view;
   the bundles are the evidence; a stored copy would be a second truth. No
   own-timestamp, no environment reads, sorted at every boundary, same bytes
   for same inputs — and the inputs are the bundles *and* the config, which
   the first draft failed to say. Three separate tests, because one
   run-twice-and-diff proves the weakest of the three.
5. **Skips are itemised or the tool is lying — DECIDED.** Silent skipping
   is the narrowing defect with a lens in its hand. The coverage statement
   leads the report, machine and human both, and it now names the roots
   searched and balances `discovered == read + skipped + duplicate`.
6. **Health is an observer: 0 on completion, `--strict` is the only tooth,
   and it only tightens — DECIDED.** Follows bench ruling 7 and the
   flags-tighten law; refusing by default would make the first run in
   every old repo a wall of red and the tool would be turned off by noon.
7. **The timeout asymmetry — DECIDED.** Timeouts alone never make a gate
   `alive`: a gate that only ever dies of slowness has never demonstrated
   it can *reject* anything, and counting it would let the least healthy
   gates read as the most alive. They surface as drift instead. §3c now
   carries the predicate that actually implements this — `status: failed`
   **and** `timed_out: false` — because the schema's `failed` already
   includes every timeout and the first draft's predicate inverted the
   ruling it sat beside.
8. **attest stays out of v0 — DECIDED** (§6). What an attestation claims
   is a different spec's contract; health earns its coupling after it has
   history of its own.
9. **Bench evidence is read, labelled, and non-qualifying — DECIDED.**
   `wring bench` refuses to start unless the baseline is red, so every bench
   guarantees a `status: failed` row for every required gate on a tree nobody
   changed, under the same `(id, command)` pairs as the repo's real gates and
   with nothing in the manifest marking it as synthetic — and a bench's
   contender loops write enough verify bundles to fill a 25-run window by
   themselves. Counting them would make gates read `alive` on a staged repair
   exercise and would push real evidence out of the window: a way to make
   zombies disappear, which is what ruling 3 refuses. Position decides it —
   anything discovered under `.wringer/worktrees/` or `.wringer/benches/` is
   bench-sourced — and the direction is deliberately conservative: excluding
   them can only produce more zombies, never fewer.
10. **Positive evidence decides at any depth; the count only splits the
    negative — DECIDED.** The first draft's `alive` row carried no history
    floor while its `untested` row claimed every thin history, so a gate with
    three runs and one failure satisfied both, and DONE boxes 3 and 4 could
    not both pass. One demonstration is enough to believe a demonstration;
    ten runs are needed before silence means anything. This also makes the
    decay demo capturable, which the first draft's checklist quietly was not.
11. **The zombie remedy states what it cannot settle — DECIDED.** Vacuity
    has four verdicts, not two; `gates_vacuous` is whole-set, so delivery
    does not refuse a bundle holding one insensitive gate beside a sensitive
    one; and optional gates are never proved at all by binding non-goal. A
    remedy printed beside every zombie row that cannot fire for optional
    gates, unchanged trees, already-red gates, or broken prove environments
    is a promise the machinery does not keep, in the product whose thesis is
    claims sized to evidence.
12. **Discovery sees a directory with a `manifest.json`, parseable or not —
    DECIDED.** The first draft required a *known schema version* to call
    something a bundle, which made every unreadable bundle undiscoverable
    and therefore unskippable — "there is no quiet path" asserted in the same
    section whose predicate built one. Seeing and classifying are separate
    steps, and only the second may fail.
13. **Vacuity's §5a blind spot is inherited and stated — DECIDED.** A
    `sensitive: true` row means the gate's result changed with the tree, not
    that the change was honest; deleting an already-failing assertion
    produces one for the wrong reason. Health reads sensitivity as vitality,
    so health inherits the blind spot exactly, and it goes in `limits` (§4,
    limit 4) rather than being discovered by a user. Closing it would need
    something that reads diffs for meaning, which is an LLM, which is a
    binding non-goal.
14. **A pair that is not the contract gets no verdict — DECIDED.** The
    window is scoped to a pair's own qualifying runs, so a renamed or deleted
    gate stops accumulating runs and its window freezes at whatever it last
    held — `alive` forever, from evidence of arbitrary age, for a check that
    no longer exists. `retired` is the fourth row of the table and claims
    nothing (§3b).
15. **The Action carries its own history or reads `untested`, and there is
    no delta in v0 — DECIDED** (§6). The enforcement venue was structurally
    empty as first written. The fix is workflow-side and stays inside the
    scope fence: Wringer reads a directory, opens nothing.

## 8. Non-goals (binding)

Any LLM call · any socket, sender, or fetcher · a new bundle family or
anything health writes under `.wringer/` of its own accord · scoring,
grading, or ranking gates · a `health:` config section or any threshold knob ·
auto-fixing, auto-deleting, or auto-proposing gates (the evolve-loop shape,
rejected in the next-act plan, stays rejected) · reading anything that is not
an evidence bundle (no git history mining, no CI-API calls) · coverage of
checks outside `.wringer.yaml` (limit 2 says so on every report) · **skip rate
or any other measure derived from a gate's absence** (§3e) · **a delta, a
baseline input, or any comparison against a stored prior report** (§6) ·
amending `wring attest` · cron/watch modes · Windows.

## 9. Definition of DONE

- [ ] the decay demo, captured end to end through real processes: the gate
      demonstrably `alive` on a genuine failure at the first run — which
      ruling 10 makes capturable — then an agent that "fixes" by neutering,
      then enough green runs that the window holds no discrimination
      (twenty-five, so the failure leaves the newest `WINDOW` and the count
      still clears `MIN_HISTORY`), and `wring health` reads `zombie` with the
      receipts. The demo does not prove the neutering change, and `docs/health.md`
      says why in limit 4's words: proving it would record `sensitive: true`
      for the wrong reason and stamp the zombie `alive`. Every bundle passes
      `wring audit` — chain and digests, a check that can actually fail. The
      bulk runs may execute as one displayed-equals-executed shell step; the
      recorder gains no new capability
- [ ] a gate whose `command` changed mid-history resets, shows its retired
      definition, and **two** tests pin the reset — one that the old history
      cannot keep the new command `alive` through a failure row, and one that
      it cannot through a **sensitivity** row, which is the half §3b's join
      exists for and the half a failure-only fixture would pass while broken
- [ ] `untested` renders for thin history with no positive evidence; a test
      fails if any absent count renders as `0`, if a thin-history gate with no
      evidence renders `alive` or `zombie`, or if a thin-history gate **with**
      a genuine failure renders anything but `alive` — the precedence of
      ruling 10 pinned in both directions
- [ ] a `sensitive: true` vacuity row makes a gate `alive` with the run
      named, from a single qualifying run; reverting the sensitivity read must
      redden exactly that test
- [ ] a gate whose only failures are timeouts is `zombie` (not `alive`, and
      not the undefined "drifting"), its timeouts appear in drift, and a test
      pins that a `status: failed, timed_out: true` row alone never satisfies
      the genuine-failure predicate — planted, because every timeout in the
      real schema already carries `status: failed`
- [ ] a bench's bundles are **read and itemised in coverage, labelled
      `bench`, and change no verdict**: a test plants a bench-sourced red row
      for a gate that is otherwise a zombie and fails if the verdict moves,
      and a second fails if a bench's bundles displace real runs from the
      window
- [ ] a pair the config no longer declares renders `retired` with **no**
      verdict, and a test fails if a frozen window renders `alive` for a gate
      that no longer exists
- [ ] the coverage header names the roots searched and itemises every skipped
      bundle with a reason and every duplicate with both paths; a planted
      unreadable-manifest bundle and a planted unknown-schema bundle both
      appear in it — proving the discovery predicate sees what it cannot read
      — and a test pins `discovered == read + skipped + duplicate`, not merely
      that the count matches the list
- [ ] `.wringer.example/` lands in `read` — the compatibility gate, and the
      oldest bundle in the tree; the report shows its `lint` rows against the
      **retired** definition (`ruff check src tests examples`) because
      `.wringer.yaml` now declares `… examples scripts`, and a test pins that
      it is neither skipped nor silently merged into the current pair
- [ ] the same bundle reachable twice (`--from` naming a path already
      searched) is counted once, itemised as a duplicate, and a test fails if
      duplication moves a gate across `MIN_HISTORY`
- [ ] determinism pinned three ways, because run-twice-and-diff proves the
      weakest one: identical `--json` bytes over the same inputs; identical
      bytes under a **mutated environment**; and no wall-clock or environment
      call anywhere in the report path, by the import-parsing test's method
- [ ] `--strict` exits 1 for a required zombie, 0 for an optional one, 0 for
      a retired one, requiredness is sourced from `.wringer.yaml` and never
      from the recorded `optional` flag, and the never-returns-5 guard family
      is extended to `health`
- [ ] `wring health --from DIR` works **outside a git repository**, and exit
      2 fires only for an unreadable config or no search root at all
- [ ] `health-report.schema.json` published, frozen in the same commit, drift
      test extended, and a real report validates against the real engine;
      receipts in it are repo-root-relative, or `--from`-root-relative with
      the root named, pinned by a test
- [ ] `wring health` provably opens no socket — the import-parsing test's
      method, not a grep
- [ ] every parser-derived guard passes in the shipping commits: command
      table and heading, module map, the roadmap row (probed on
      `docs/health.md` like P6/P7, so the node cannot go green before the
      feature is finished), and the milestone-coverage guard
- [ ] the Action recipe's health step parses against the real CLI, sends
      nothing, restores history into a `--from` directory, renders to the step
      summary, and **states in its own comment that a run without restored
      history reads `untested`** — the first draft's box passed against an
      inert step, so this one pins the history path
- [ ] `docs/health.md` carries the captured decay demo via the recorder's
      derived STEP_SETS machinery, inside its 80-column canvas
- [ ] the report's four `limits` are pinned by content, not by
      non-emptiness — the narrowing lesson, applied to this spec's own
      checklist — and limit 4 names vacuity §5a, because it is the limit a
      reader of a vitality report most needs and least wants
