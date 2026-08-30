# Changelog

Notable changes, newest first. Wringer follows [semantic
versioning](https://semver.org/); schema versions move independently of the
package version and are listed per release.

## 0.5.4 — 2026-08-30

**The red is earned.** Phase 1 of the receipt window, closing six paths by
which a green criterion could carry a red it did not earn, and the two
delivery interlocks that failed open on a damaged record.

### A committed bundle is not a receipt (D1)

`search_roots` includes `.wringer.example/` and `Bundle.qualifying` excluded
only bench-sourced bundles, so a bundle **checked into git** qualified.
Measured before the fix: copy `.wringer.example/` alone into an empty
directory — a fresh clone, `.wringer/` absent — and `accept` returned
`('test','pytest -q') -> Receipt(kind='failure')` from
`.wringer.example/runs/20260809-132737-4355`, whose `002_test` row is
`failed, exit 1`. Any user binding a criterion to a gate named `test` read
"every green on this board was red first" off a file that arrived with the
clone.

`Bundle` gains `committed`, decided by position as `bench_sourced` is. Both
are still read, and now **itemised**: the human report names each
non-qualifying bundle and why. `--json` is byte-identical —
`wringer.health.v1`'s `coverage.counts` is frozen, so the new fact waits for
a version rather than growing a quiet key.

### The witness lane

- **A skipped witness is never recorded passed.** `Execution.passed` was
  `exit_code == 0`, and pytest exits 0 when everything was skipped,
  deselected or never collected. The pin covers the witness's bytes, command
  and path — not the pytest *configuration*, which the worker owns. Green is
  an observation now: the probe records a mark off a passing call-phase
  report.
- **`run.prove_setup` runs in the proving worktree**, the control `vacuity`
  has had since 2026-08-11 and SPEC_GATEGEN W8 already required. A failing
  setup discards every row with the failure cited; an absent one is disclosed.

### The scratch-tree runner

Pre-change gates ran 8-way concurrent whatever `gates[].concurrent` said, and
`--serial` could not reach them. Two gates a repo never declared safe together
fail side by side in the scratch tree, and `sensitive` is `changed.passed and
not pre.passed` — so the runner manufactured `proven`. Measured: the second
row's citation became `mkdir: .excl: File exists`. One runner now, honouring
the declaration in both trees.

### Falsification counts what was delivered

The reconstruction copied only files with ADDED lines, so a deleted file — or
one the change only removed lines from — kept HEAD's version in the scratch
copy. An obsolete check the delivery removed was still there to catch mutants,
and every mutant it caught was recorded as caught. `changed_paths` names both
halves of the diff.

### The judge cannot overwrite its own answer

Duplicate criterion ids in a model reply were last-wins, so the thing being
judged chose which of its two answers Wringer read. `needs_human`, like every
other failure to understand a reply.

### An unreadable record refuses (D2)

`accept.read` and `vacuity.read_verdict` returned `None` both for "never
opted in" and for "present but truncated", and the delivery interlocks
returned on `None` — so a bundle that had **recorded** refusing rows delivered
with no refusal and no word. Twenty lines away, `_check_untracked_bytes`
already said the rule: "an unanswerable check refuses rather than passes".
One shared three-valued reader, `evidence.read_sidecar`, and two new refusals:
`acceptance_record_unreadable`, `vacuity_record_unreadable`. Absent still opts
out.

### Two surfaces that said the wrong thing about red

- `summary.md` rendered `arrived-with-the-work` and
  `pre-existence-unestablished` rows — both carrying
  `demonstrated_able_to_fail: True` — under "Bound gates that have never been
  red". They have their own section and their own sentences now.
- A loop that converges on vacuous gates **says so on the console** (D3).
  SPEC_VACUITY §3's "the loop continues" described a mechanism that never
  existed; the spec bullet is amended, dated, and the disclosure is the code
  half of that ruling.

### Warm-up

`fleet.run()` gained a `try/finally` — an interrupt left supervisors and their
workers running detached and a checkout per task on disk — and the fleet's
scratch path carries the fleet id, as every other lane's already did.

Schema versions unchanged. Twenty-six red-watches by individual reversion;
three guards were vacuous on the first pass and are recorded in the finish
report.

## 0.5.3 — 2026-08-29

**A bug review of 0.5.2, done by running it.** Six probe scripts against real
`git diff` output, real records, and this repository's own 7,736-line diff.
Four defects, and **every one of them made the checks look better than they
are** — the single direction the falsification lane must never fail in.

### Three in the mutation table

- **A dead entry.** `(" += ", " -= ")` could never fire, because `+=` matched
  first. It sat in the table looking like an operator this lane covers. The
  vacuity class this project keeps finding in its predicates, arriving in a
  data table instead.
- **`!==` contains `!=`**, so `if (a !== b)` became `if (a !!= b)` — a syntax
  error rather than a mutation, and a syntax error is caught by everything.
  Found by probing the table against the TypeScript the module's own
  documentation claims to support. The three-character operators come first
  now.
- **A run of four or more `=`** — a pytest banner, a markdown rule, ASCII art
  — was sliced by the `===` rule into `!==================`. Found by pointing
  the table at this repository's own diff, where a committed capture of a test
  transcript contains exactly that. An operator now only matches when the
  characters either side of it are not themselves operator characters.

### One on the board

The gate that printed `ruff: command not found` in the field report is `lint`,
and `lint` is **bound to no criterion**. A card is keyed to a requirement, so
the guess reached no card and the board said nothing about the one red the
report was about. It now appears in the block the page keeps engineers' facts
in — there is no requirement to attach it to, and the engine's sentence for a
face has one reader that both places share.

### Found sound, by probe rather than by reading

The diff parser against renames, filenames with spaces, multiple hunks,
deletions, new untracked files, missing trailing newlines, binary files and
content that looks like diff syntax. The certificate over v1 and v2 records,
missing titles, multi-line notes, unknown states, and a handover read outside
any repository. Coverage over rows with missing keys and states from the
future. Every rendered surface agreeing on one run's numbers. A gate that
writes into the tree, and one that is not deterministic.

## 0.5.2 — 2026-08-28

**Break the change on purpose.** Every green in this program was red first —
and red-first is a claim about ONE failure that was recorded. It says nothing
about whether the check would notice a DIFFERENT way of breaking the same
code.

```
wring verify --falsify
```

One mechanical substitution at a time, from a fixed ordered table, applied to
lines the change itself touched; the BOUND checks run against each mutant in a
scratch copy; and the record says which breakages nothing noticed. **Model-free
— no LLM, no network, no rival agent.**

**A surviving mutation is a finding about the CHECKS, never a verdict on the
work**, and the sentence a reader meets says so before it says anything else:
*these checks could not tell the difference between the code as delivered and
the code with that line broken.* The ceiling rides with it — surviving
mechanical mutation is necessary and demonstrably not sufficient, and it is
never a score.

**It refuses nothing.** No exit code, status, failing gate or acceptance row
differs between a run with the flag and a run without it, and the guard
compares all four. Whether a survivor should ever refuse a delivery is a named
future ruling that wants this version's field evidence first.

No new verb: `--prove` is the exact precedent — run the declared gates against
a different tree and compare — so this is the same flag shape on the same
command.

### What it found on a real delivery

Run 2's delivered change, measured on a clone so the operator's tree was never
touched: **23 of 24 attempted mutations survived.** The two bound acceptance
gates could not tell the delivered code from the code with a conditional
inverted. That corroborates the coverage number below — 5 of 8 requirements
unwatched — from the other direction.

### Three defects it found in itself, all inflating "caught"

- **Two same-size mutants of one file, written inside one second, shared a
  stale `.pyc`** — so the second was executed as the first's bytecode, and a
  breakage nothing checks was recorded as caught. Every write now gets a
  strictly increasing modification time. Any build cache keyed on
  `(mtime, size)` has this shape.
- **A mutant left in place while the next file's mutant ran** meant the second
  was judged against a tree carrying both.
- **The first field run came back inconclusive**, because a change that adds
  an acceptance test adds it *untracked*, and a scratch copy carries tracked
  files only. The control run refused the measurement — correctly, that is its
  whole job — but it meant most changes could never be falsified.

### A note on 0.5.1

`v0.5.1` was tagged and **never published**: CI's tag gate rejected it over a
test that asserted a shell's phrasing of "command not found", which differs
between macOS and Linux. The local release bar runs on one operating system
and is not a measurement of both. Everything that release carried is in this
one, described below, and the tag was removed rather than left pointing at
something PyPI does not have.

---

**The coverage number.** Every surface counted STATES — what happened to each
requirement in this round. None of them answered the question a person
actually arrives with: *how much of what we asked for is anybody watching?*

The field case was already in hand. On run 2's delivered board **5 of 8
requirements had no check at all, and the defect that run existed to fix
landed exactly on one of the unwatched ones**. The fact had been on disk the
whole time — `acceptance.json` carries the binding per row, so the number was
one subtraction away, and no artifact did the subtraction.

### Two debts, two lines, never blended

> **N of M requirements carry a check that can prove them.**
>
> **K of H requirements that need a person have something to show them.**

A single number over both populations points nowhere. The remedy for the first
is to write a check; the remedy for the second is to declare a command that
renders the thing a person is being asked to look at. Those are different jobs
done by different people, and a reader given one blended number cannot tell
which is theirs.

Both sentences appear on all four surfaces the counts already travel on — the
bundle's `summary.md`, `mr.md`, the certificate, and the board — from one
renderer, so they cannot come to state different numbers for one run. Each
line appears only when its population exists: a sentence reading "0 of 0" is
how a reader learns to skip caveats.

The claim ceiling rides with the number, wherever it is rendered:

> This counts checks that are bound to a requirement. A bound check can still
> test less than the requirement means, and this number cannot see that —
> `wring health` is what watches coverage narrow over time.

### A warning where the plan can still change

`wring plan` and the board's plan — which `approve` prints before it writes —
now name every requirement only a person can settle that has nothing declared
to show them. **It warns and does not refuse.** The only place this has hurt
anybody is at the pen, and the pen already speaks in capitals; a plan-time
refusal would stop work over a file the person can write at any moment up to
the judgement.

### A red the environment caused says so

The first `wring verify` of run 2 recorded `ruff: command not found` — the
example's gates resolve only with the project's `.venv` on `PATH`. Documented
behaviour rather than a defect, and **indistinguishable in the summary from a
red the requirement earned**. It went into the record as one.

Where `wring diagnose` has a face for a red gate, `summary.md`'s row now
carries `(maybe the environment)` with a section naming the guess and the line
it was read from, and the board's card for that requirement carries the
engine's own sentence. It is a hint and says so: the guard runs two identical
repositories, one failing on a missing command and one failing ordinarily, and
asserts every outcome is equal.

Only the loop wrote `diagnosis.json`, and the board reads the run bundle — so
the one surface a non-engineer opens could never show the guess. There is one
writer now, and both callers use it.

### Schema versions

| Schema | Version |
|---|---|
| `coverage-v1.schema.json` | `wringer.coverage.v1` — NEW |

`wringer.certificate.v1` is unchanged: the coverage record travels beside it as
a sibling and the face renders it. A key added to a published schema is a
silent break for every reader of a document already written, and a key held
open and empty is a claim that the question was asked.

## 0.5.0 — 2026-08-28

**The certificate: the proof travels.** A minor bump, and it is a FORMAT
change rather than a behaviour one — `wring deliver` now hands over a document
a reviewer who never ran the machine can act on, and a stranger can re-check
offline. Nothing that ran before runs differently.

On 2026-08-27 a cold reviewer was given a real delivery and asked whether they
could act on it. Their answer was *partly*, and the four things they could not
do are this release:

> *"'Unevidenced' isn't a word I use … '6 of 8 requirements have no test
> proving them' would land faster."*
>
> *"It doesn't say which six. That's the big one … To find out I'd need the
> board, which the same file tells me 'stays with the machine that ran it.'
> I'm told there's a hole and told the map isn't coming."*
>
> *"'1 for a person to judge' doesn't say it was judged. You judged that
> criterion met, with a note. The MR doesn't show the verdict, the note, or
> who gave it. I'd assume it was still outstanding."*
>
> *"Nothing names the one proved criterion either."*

**Every one of those was a rendering failure, not a recording failure.** The
run that produced them had all four facts on disk in `acceptance.json` and put
none of them in the two files that go with the code. The before-picture is
committed verbatim at
[docs/run2-2026-08-28/](docs/run2-2026-08-28/README.md).

The sentence in the second quote is narrowed rather than deleted, and this is
its wording from now on: **the gate LOGS stay behind; the certificate and a
copy of the board travel with the delivery.** What may not travel is gate
output — a bundle may hold whatever a gate printed, and a merge request body
is public — and that was always the promise the old sentence was protecting.
It was simply broader than the promise.

### What `wring deliver` writes now

Into the delivery, beside `mr.md`:

- **`certificate.md`** — the face. Every requirement BY TITLE with what the
  record can honestly say about it, in plain English; the proved ones named
  with their check and where that check is on record failing; a person's
  verdict with WHO, WHEN and their NOTE, verbatim. Nothing on it needs the
  machine that ran it — it names a run, never a path into somebody's disk.
- **`certificate.json`** — `wringer.certificate.v1`, a NEW schema file. No
  published schema changed.
- **`board.html`** — a copy of the repository's board page, when it has one,
  scrubbed like everything else in the bundle. Where there is none, the body
  says so rather than reading like a delivery that carried one.

`mr.md` quotes the same renderer, so the merge request and the certificate
cannot come to describe the same requirements differently — and the sentence
the reviewer quoted back is narrowed rather than deleted: the gate LOGS stay
with the machine that ran it, and only those.

`summary.md` and `mr.md` both stop saying `UNEVIDENCED` at a reader, because
`accept.disclosure` is the one renderer both of them quote.

### Checking one offline

```
wring audit certificate.json
```

No network, no model, no config, no account — an argument shape rather than a
twentieth command. One line per claim: that the counts match the rows below
them, that the requirements listed are the ones the clone's spec declares,
that the commit named is in the clone, and one line per receipt, joined
through the same reader that wrote the receipt in the first place.

**Three outcomes, and the third is not a hedge.** A claim whose evidence did
not travel has NOT been checked, and reporting it as either a pass or a
failure would be a lie in one of the two directions.

**Author-blind, and it is tested rather than announced.** The check never
reads who wrote the branch, which tool produced it, or whose name is on the
judgement — a test moves every one of them and asserts the outcomes are
identical, claim for claim.

### Two defects the guards caught in the first draft

- `cause` is v3-only, so a v1 or v2 record carries a `human` row with no cause
  AND no judgement. Keying the wording on the cause alone made that pair mean
  *"a person looked and said it was met"* — a verdict invented by a renderer,
  in the one place this document exists to show a person's actual answer.
- *"there is no repository here"* was reported identically to *"this commit is
  fabricated"*, so a certificate read beside a bare checkout came back ✗ on a
  claim nobody could have checked.

### Also

The suite leaves a clean checkout clean. The install-prompt guard runs
`INSTALL.md`'s lines for real, and one of them is
`wringer-board render . -o board.html` — so every `pytest` was rendering the
project's own committed page into the developer's working tree. Unnoticed for
exactly as long as nobody was changing the renderer.

### Schema versions

| Schema | Version |
|---|---|
| `certificate-v1.schema.json` | `wringer.certificate.v1` — NEW |

Everything else is unchanged. No published schema was amended.

## 0.4.12 — 2026-08-28

**The pen, reachable.** Gate 1 closed on Marc's main Mac: the sixth leg — a
delivered branch earned on a re-judge — landed. Getting there needed two
fixes, and both were about the same thing. A human criterion is the one path
in this product with no evidence surface, and it turned out a person could
neither be asked again nor be shown what they were being asked about. The
report is
[docs/field-report-2026-08-28-run2.md](docs/field-report-2026-08-28-run2.md),
verbatim.

### A `not_met` is an open objection, not a settled answer

A person judged a requirement not met. An engineer fixed exactly what they
objected to. The person ran `wringer-board judge` and was told *"nothing is
waiting on your judgement in this repository"* — while the engine went on
refusing the delivery on that same verdict, and would have gone on refusing it
forever, because the one verb that moves the pen would not offer the question
a second time.

`--id` had always recorded over a prior verdict, so anyone who already knew
the identifier could re-judge. The listing exists precisely so that a person
who does not know the ids need not read a YAML file to find them, and it was
withholding the one id that mattered. Only `met` settles a criterion now, and
a re-offered requirement prints the person's own objection back so it does not
read like a question nobody has looked at.

### `show:` — the person sees what they are judging

The criterion was about the wording of a run summary. That summary appeared in
no surface Wringer had: `wringer-board judge` printed the requirement and
stopped, `board.html` had zero occurrences of it, and the run bundle's only
copy was a string literal inside `diff.patch`. The one place it had ever
existed was the gate log from the run where the check was still failing —
visible only while the thing was broken — and the requirement's own guidance
says the person judges it *without opening the logs*. The judgement was
possible only because a coding agent pasted the output into a chat window.

`.wringer.yaml` now takes a `show:` mapping of criterion id to a command whose
output is the thing to look at, and `wringer-board judge --id` prints it under
the requirement. Where nothing is declared the command says so in capitals
rather than asking as though nothing were missing.

**In `.wringer.yaml` and deliberately not in `wringer.spec.yaml`**: the spec is
drafted by a model and this value is a command that runs. Same boundary that
makes `wring plan` print proposed gates as a diff and refuse to install one
itself.

### The board says the short version first

Added after the field verdict on the page as it stood: *"you need a PhD to
understand what is going on here."* Nothing on it was wrong; it answered "what
is the state of each requirement" and never answered what a person arrives
with. The new block names every requirement in exactly one group — proved,
nothing checking it, not finished, yours to decide, unreadable — and ends on
whether any of it can be handed over. A guard fails the build if that block
ever uses `bound`, `evidenced`, `criterion`, `red first`, `witness`,
`receipt`, `gate` or `verdict` again.

The plainer wording went wider than the block: "It was red first" is now "This
was watched failing before it was fixed", and "No check is bound to this
requirement" is now "Nothing is checking this requirement".

### A delivery refusal about an older run is history

Rendering that block against a real board found the page contradicting itself:
the summary cleared a handover the engine had refused. Behind it was an older
defect — the refusal being rendered was from the previous day, about a run two
runs back, and its cause had since been reversed by the person who raised it.
The comment above the code already promised otherwise; it was a promise about
`latest_refusal`, which sorts records by name and knows nothing about which run
is on the page. A refusal that does not name the run being rendered is now
history, and a record too old to name one is kept, because a fact that cannot
be dated has not been disproved.

## 0.4.11 — 2026-08-27

**The board and the witness.** Gate 1 — a fresh install, the login route,
converge → hold → pen, every stop legible — was run on Marc's own main Mac
against 0.4.10 and passed five of six legs; the sixth was not reached because
delivery was correctly refused on the human criterion the person judged
`not_met`. The two product defects it surfaced ship here. The report is
[docs/field-report-2026-08-27-run6-rerun-mainmac.md](docs/field-report-2026-08-27-run6-rerun-mainmac.md),
verbatim.

### The board follows the newest record, and names it

After the pen had moved and `wring verify --prove` had recorded a real red, a
fresh `wringer-board render` still said "Nobody has yet" and "0 of 8 proved" —
while `acceptance.json` in the run just written carried the person's `not_met`
verdict, and `wring deliver` was at that moment refusing delivery citing it.
The hero surface was telling a person to go and do a thing they had already
done, and staying silent about the verdict blocking the handover.

The board pinned the run it renders to the LOOP's last attempt whenever a loop
existed. Both `wring verify` and `wring verify --prove` write standalone runs
outside the loop, and both are what the engine's own refusals send a person off
to run — so the board never followed. **Recency wins**: the board renders the
repository's newest run record, whoever wrote it. The loop rail is a separate
fact and keeps telling the loop's story.

The page now names the run it rendered, in the engineers' block. The whole cost
of the finding was that a stale page and a fresh record could not be told apart
by reading them.

### A bound gate's red reaches the record

The drive told the operator, to their face, "None of them passes today",
naming the two checks it had just tried. Minutes later the record refused
delivery: "`skip-downstream-acceptance` passed, but nothing in the record shows
it can fail — a gate born green evidences nothing." Both sentences were true.

Measured before anything was written: the receipts that refusal is the absence
of come from the repository's own run bundles, keyed by `(gate_id, command)`.
The gate had no pre-change red because the runner is fail-fast — `acceptance`
failed at iteration 1, so the bundle stops there and the gate never ran inside
a recorded run while it was red. The one place that did see it red, the drive's
pre-install trial, keeps a boolean and writes nothing.

So the fact was never made, and the starvation is an engine property that
reproduces with no drive anywhere near it. **Fail-fast decides a run's OUTCOME,
not its RECORD.** A gate carrying `proves:` now runs after a required failure;
a gate with no binding is still skipped, which bounds the cost to the bindings
a repository actually declared. The run's `status`, `failed_gate`, exit code
and rerun hint are unchanged, and only the failing gate's logs are tailed.
`summary.md` marks the extra rows `(for the record)` and the console says which
gate the run actually failed at — two ✗ rows must not read as two independent
things to go and fix.

**The born-green refusal is untouched.** It fired on the wrong case; it is not
wrong to exist. A bound gate nobody has ever seen fail still reads born-green,
and a bound gate that passes after the failure still evidences nothing.

Six documents taught the starvation as current behaviour, including
SPEC_VERIFY's binding rule 2 and `docs/fleet-scale.md`'s "what it still cannot
do". All amended, and the guard over them was vacuous twice before it held —
first accepting `proves:` (ordinary vocabulary on every one of those pages),
then a dated `AMENDED` marker (two of them already carry `AMENDED 2026-08-11`
in the same paragraph). Both found by reverting each amendment individually.

### Not in this release, deliberately

The example pipeline built in that run names only one of a doubly-blocked
step's two blocking failures, against the one interview answer the drafter was
given. That is the second run's worker turn, not an engine defect, and the
criterion that would have caught it is one of the seven with no gate bound.

## 0.4.10 — 2026-08-27

**The re-run's findings.** The same operator re-ran the chain on the same
org-pinned Mac against 0.4.9. The build was blocked by the machine's own
auth — both routes measured refused, neither a Wringer defect — and the run
confirmed three 0.4.9 fixes working in the field. What it surfaced is what
ships here. The report is
[docs/field-report-2026-08-27-run6-rerun.md](docs/field-report-2026-08-27-run6-rerun.md),
verbatim (incomplete by its own statement — it still awaits the answer to
what `auth login` did on that machine).

### The runbook's example path — and the guard that shared its confusion

`docs/drive/AGENTS.md` step 6 said `cd ~/wringer-source/examples/pipeline`;
the example lives at `docs/drive/examples/pipeline`. Third shipping of the
same defect class in two days, one level deeper each time — and this time
worse in the field, because `examples/` does exist at a clone's top, without
the example in it, so the operator got a folder that looks right instead of
a clean failure.

The interesting defect is the guard. 0.4.9's followability guard walks the
page's `cd`/`sh` targets the way a reader types them — and it stayed green,
because it resolved the clone's paths against `docs/drive/` (where the
drive's documents live inside this repository) rather than against the
checkout the page's own `git clone` creates. In that coordinate system
`examples/pipeline` exists. The document and the guard had dropped the same
`docs/drive/` prefix from opposite ends, and the errors cancelled: the guard
was green not despite the defect but because it shared it. It now resolves
every clone-produced path against the repository root, was watched go red on
the shipped 0.4.9 text (both steps), and went green only with the corrected
path.

### The failed-build stop leads with the worker's own words

On a failed build turn the stop's first sentence was "the most common cause
is that the coding agent is not logged in" — honestly qualified, and on the
pinned Mac it pointed a non-engineer away from the real cause, which sat one
level down in the worker log ("Unable to verify organization for the current
authentication token…").

The refused-turn diagnosis now asks the agent about its login at the moment
the stop is composed (`worker_auth.read`, the same free read the preflight
uses — which also catches a login that expired mid-run) and branches on the
answer: the stop leads with the worker's own refusal line, quoted verbatim,
and the not-logged-in reading appears only when the agent itself reports
signed out — at which point it is the agent's word, not a guess. When the
agent still reports logged in, the remedy now says the one thing that stop
knows: a missing login is not the cause. Every surface inherits, because the
sentences are composed where the fact is made and the console, the record
and the drive all read the same object.

The record's new fact needs a schema, and published schemas are frozen — so
the loop now writes `wringer.workerdiagnosis.v3`
([schema/worker-diagnosis-v3.schema.json](schema/worker-diagnosis-v3.schema.json)):
one optional `auth_state` key over v2, present only when the agent was
asked, absent on every earlier record. Every v2 record is a valid v3
record; v2 keeps every byte it published.

### The credential table names the displacement

Measured on the pinned Mac: an `env_passthrough` Anthropic key does not
merely fail there — it **displaces a claude.ai login and takes precedence
over it**, which is the mechanism behind every "presence is worse than
absence" sentence in this repository. The credential table's pinned-machine
row now states it, beside the measured refusal ("managed settings require a
first-party login… A non-OAuth Anthropic credential cannot satisfy the org
pin"), and a guard pins both to the one page every other page points at.

## 0.4.9 — 2026-08-26

**The gate-closer.** A product manager drove the whole chain on an
IT-managed Mac — a machine class nobody here owns — and reached a delivered
branch: PRD in, interview, plan, a real coding agent building for 4m 40s, a
held handover, a human verdict, a branch on a remote. The report is
[docs/field-report-2026-08-26-run6.md](docs/field-report-2026-08-26-run6.md),
verbatim; the disposition is
[docs/field-response-2026-08-26-run6.md](docs/field-response-2026-08-26-run6.md).
Four findings, all fixed here.

### `USER` crosses into the worker, and a logged-in agent stops reporting logged out

`acp.worker_env` handed a worker `PATH`, `HOME`, `LANG`. On a Mac pinned by
managed settings to an organisation login the credential is in the macOS
Keychain, and the agent needs `USER` to resolve its own item there. Bisected on
that machine one variable at a time: without `USER`, `loggedIn: false`; with
it, `loggedIn: true, authMethod: claude.ai`. Nothing else moved it.

So a **logged-in** agent reported logged out, the drive stopped on a false red,
and the login route — the only route that class of machine has — was the one
route that could not work. `run_turn` builds its environment through the same
function, so the paid turn would have been equally blind.

`USER` is now the fourth name in the base set: identity rather than authority,
absent rather than empty when this process has none.

### The signed-out stop stops walking people into the thing that breaks them

Worse than the false red. The stop offered two routes; the operator had already
done the login, so the only apparently-untried one was `env_passthrough` of a
key — which on a pinned machine **is** the refusal. It now asks the question
`wring doctor` asks (a `stat` for a policy file, never a read) and on such a
machine names one route and says to remove a key already declared.

And the preflight's answer is now **shown when it passes**: a `worker-auth`
step rendered before anything is spent, or a step saying the question could not
be asked. The engine is asked once, so the sentence a person is shown is the
one the refusal decided on.

### `mr.md` and the bundle's `summary.md` carry the acceptance counts

The run reached delivered with `evidenced: 1, unevidenced: 6, human: 1`. The
board said so six times and `acceptance.json` per criterion; the two surfaces
that TRAVEL with the code said it zero times between them, while `mr.md`
pointed at `summary.md` as "the human-readable report". Both were true — all
gates passed — and a reviewer saw three green ticks and the word `passed`.

Both now carry the counts, from one renderer they quote verbatim. The counts
always travel; the warning only when there is something to warn about.

### The runbook's step 6 can be followed after a clean install

Step 2 says there is nothing to clone — true of the tool — and step 6 then said
`cd wringer-drive/examples/pipeline`, which has not existed since the packages
merged and is not in the wheel. A first-time reader stopped there. Step 6 now
states that the examples need a clone and gives the command, and a new guard
walks the page's own `cd`/`sh` targets in document order: every one must be
produced by an earlier step on the same page.

### Also

- **A subscription login is measured serving a build turn** — 4m 40s, exit 0,
  red gate to green, no key anywhere. The runbook's "still unmeasured" sentence
  is retired and `docs/vendors.md`'s anthropic/worker row cites the capture.
  The status did not move: it was already `MEASURED-WORKING` on the key arm.
- **The transport is told to read with a monotonic cursor**, not a count
  recomputed each poll — which lost an interview question and looked like a
  hang. The page warned about writing too early and said nothing about reading
  too late.
- **Two `wring doctor` lines answer the reader instead of describing Wringer.**
  A shell worker has no login to check; a command the roster would know by its
  bare name now says so, and says which spelling makes the question free and
  exact. The roster still matches exactly — the silence was the defect, not the
  matching.
- **Three surfaces still described the old three-name worker environment**
  (`SECURITY.md`, `worker_auth.py`, `SPEC_START_V0.md` §3a-ii, the last also
  citing two line ranges that had moved). Found by a new derived guard, not by
  a reader. That is the "one fact, three documents" disease this release's own
  finding 3 is about.

Schema versions: unchanged.

## 0.4.8 — 2026-08-26

**The full run.** For the first time in this project's life a plain-language
document went in and a delivered branch came out: a real coding agent building,
the checks proved red first, the one requirement no check can settle judged by
a person, and `wring deliver --send` landing on a remote. The whole thing is
captured verbatim in
[docs/full-run-2026-08-26.md](docs/full-run-2026-08-26.md), written by `tee`
rather than from memory.

Six findings came out of it. Five were found by running the machine; the suite
was green throughout, which is the argument for the sixth.

### The chain now completes on every release, not once per field disaster

`scripts/chain-completes.py` drives the real verb against the INSTALLED
package — a document in, the interview, the plan, the gate diff, the red trial,
a scripted worker standing in for the paid agent, convergence, and a delivered
branch on a remote — and refuses if any step is missed, if the acceptance check
was not red first, or if no branch carrying the work reaches the remote. It
needs no key, touches no network and makes no model call; the paid seams stay
manual, because a model drafting well is not a thing a release can promise.
`scripts/release-check.sh` runs it, and a test holds it there.

It earned its place immediately: it is what found the next entry.

### Wringer's own page was holding up the handover

The board is rendered before the loop, so every verify records `board.html` in
`untracked.json`; it is rendered again after the loop, because showing the
result is what it is for. `wring deliver` then refused — correctly — about a
file that is not the operator's work. The shipped example escapes only because
its `.gitignore` was written with that line already in it, and no repository a
product manager starts from has one. `wring init` already keeps `.wringer/` out
of git for this exact reason; the board is the one file Wringer writes outside
that directory, and it was left out.

### A converged run no longer says the agent did nothing

`files_written` counts writes that crossed Wringer's own `fs/write_text_file`
channel, and an agent holding its own filesystem uses none. On the full run the
count was 0 for a turn that changed seven files and 174 lines and turned the
acceptance check green — and `worker-diagnosis.json` recorded
`turn_changed_nothing`, telling the operator the agent had probably failed to
authenticate. The console half of this was fixed on 2026-08-22 and the record
was left carrying the face; `wringer-drive` reads that record, so the same
false sentence reached a person through a second door four days later. The loop
now fingerprints the working tree either side of the turn, and a changed tree
means no diagnosis at all.

### The cost is said before the spend

`wringer-drive` built the "this costs money" step before the drafting call and
RENDERED it after — so the warning arrived after the spend, and not at all when
the call failed, which is what happened. Every test of it passed, because each
asked what was emitted rather than what was shown.

### A refusal that names the answer already on file

`wring deliver` refused a `human:` criterion with "nobody has answered this —
record the decision in `wringer.judgements.yaml`". The decision had just been
recorded there. Acceptance is computed at verify time and deliver reads the
record, so the remedy could not clear the refusal it printed under. It now says
so — and only when the answer is present, unstale and `met`, because a
`not_met` answer refuses on the next verify too.

### Doctor can see a two-tool mixture

`uv` puts every tool's console scripts into ONE directory, so the split-install
check — which keyed on that directory — passed a person running a mixture of
two tool environments. Each command is now asked which environment it belongs
to: the interpreter its shebang names, compared unresolved, because every uv
environment's `bin/python` symlinks to the same base interpreter and a resolved
comparison collapses the whole machine into one owner.

## 0.4.7 — 2026-08-25

**Published.** `uv tool install wringer` gets it.

Answering [the field report of 2026-08-25](docs/field-report-2026-08-25.md),
whose verdict was *"trustworthy about what it cannot prove and unreliable at
explaining why it stopped."* Dispositions, with the repros:
[docs/field-response-2026-08-25.md](docs/field-response-2026-08-25.md).

### A refused turn now carries what the agent actually said

`error.message` was rendered and `error.code` and `error.data` were dropped. An
IT-managed Mac refused every session with `-32603 Internal error` — JSON-RPC's
generic code, which says nothing on its own — while the remedy sat in
`data.details`, in plain English, naming the command to run. The operator lost
a session and a paid drafting call to a problem whose fix was in the payload.

There is one renderer now, and everything reads it: the console, `loop.jsonl`,
`worker-diagnosis.json`, the bundle log, the drive's `stopped` step. A
multi-line remedy keeps its lines, so the command stays copyable.

Two consequences of carrying somebody else's prose, both found by building it:
a timeout was being decided by looking for the word "deadline" in the message,
and is now a fact on the exception; and the redaction moved upstream of the
console, because the scrub lived on the file writes and an agent handed a
credential by name can hand the value back in an error.

### `wring doctor` says which Wringer you are running

That report was made against `0.4.0` from an editable install, six releases
stale, and nothing said so. Doctor now names a source install on the line it
already prints, and **warns** when the installed distribution's metadata
disagrees with the version on screen — the state a `uv tool install` with a
`.pth` into a working tree produces, measured on the author's own machine.

### The builder's credential is written down in one place

Two routes exist and **the machine picks, not the person**. On a host whose
managed settings pin the coding agent to an organisation login, passing an
Anthropic key into the worker is not an ineffective remedy — it is the cause of
the refusal, and removing it is the fix. `docs/drive/AGENTS.md` carries the
measured table for both machine classes; every other page cites it, and a
derived guard fails if a second page grows its own copy. The 2026-08-22 note
recording that refusal as NOT REPRODUCED gains its dated correction: it
reproduces, on a class of machine nobody here had measured.

`wring doctor` gains a presence-only `managed settings` line. It never opens
the file, and its absence branch says out loud that one path checked is not
proof.

### Smaller, and each one a silence

- A gate proposal is never compared to itself. `'X' runs …, which is already
  what 'X' runs` survived on two arms and stopped the build on a tautology.
- A plan rendered without its decisions sidecar says the file is missing,
  instead of rendering "nothing was decided for you" by saying nothing.
- The drive says when it is reusing a spec rather than drafting one.
- `once … is answered` joins `(if unanswered, …)` as a stale deferral the
  plan refuses — two field runs, two phrasings, one detector.
- A string `worker:` naming an ACP adapter is warned about, in both forms.
- `AGENTS.md` restates the `PATH` export its examples' epilogues print, and a
  guard derives that from the scripts.

### The release bar was red, and running it is how that was found

`scripts/release-check.sh` exercises the INSTALLED package, which is the whole
point of it. Its `the suite is green` step was failing — nine tests across
four modules, all because those modules located `schema/` through an
installed module's `__file__`. That resolves to the repository root from a
source tree and to `<venv>/lib/pythonX.Y/schema` from a wheel, where nothing
is. Reproduced at `v0.4.6` as well, so it was red for at least one release.

Fixed at the source (`core_helpers.repo_root()`), with a guard derived over
every test file. **30 of 30 now, against a clean clone.**

### No schema moved

Nothing in `schema/frozen.json` changed a byte, and there is no twentieth
command.

## 0.4.6 — 2026-08-25

**Published.** `uv tool install wringer` gets it.

### An agent that will not work is now refused for free

0.4.5 measured where each ACP agent's authentication becomes visible and wrote
it down. This uses it. Some agents refuse the SESSION — two calls below the
paid turn — and until now Wringer had no way to ask an agent it had no CLI
probe for, so it returned "unknown", drafted your spec, reached the build step
and met the wall there.

Measured on this Mac, against every agent installed:

    an agent signed OUT that refuses the session   refused   1.1 s
    an agent whose own command line answers        refused   1.0 s
    an agent that opens a session                  proceeds  2.2 s
    a binary that is not installed                 proceeds    0 s

**Its whole authority is one fact** — the agent's own `session/new` error
carrying `authMethods`. A session that OPENS is explicitly not evidence and
lets the run proceed: measured, one agent opens one whether or not it is
signed in. A refusal that names no method is not an auth answer either, so a
malformed request cannot stop a run. And an agent that simply never answers is
never refused: this check may only turn a definite no into a stop, never a
silence, or it would become a gate on how fast your agent starts.

The rung is tried SECOND. Where an agent's own command line answers, that is
the more authoritative surface and is asked first.

### No schema moved

Nothing in `schema/frozen.json` changed a byte, and there is no twentieth
command.

## 0.4.5 — 2026-08-24

**Published.** `uv tool install wringer` gets it. Same release ordering as
0.4.4.

### An ACP agent's refusal now carries the agent's own instructions

When a coding agent refuses to open a session, Wringer reads what that agent
said about its own authentication and puts it in front of you — the method's
name, the agent's own description of it, and the exact command to run — instead
of `session/new was refused: Authentication required` and nothing else.
Measured end to end against a real signed-out agent:

    the agent refused to open a session: session/new was refused:
    Authentication required

    The agent says it accepts:
      - Login with Kimi account
          Run `kimi login` command in the terminal, then follow the
          instructions to finish login.
          run this yourself, once: /Users/marc/.local/bin/kimi-code login

    Wringer does not run any of these for you.

**One client implementation, every conforming agent** — no roster of special
cases, and nothing in the engine branches on a vendor's name.
[docs/specs/SPEC_ACPAUTH_V0.md](docs/specs/SPEC_ACPAUTH_V0.md) is binding;
[docs/acp-auth-2026-08-24.md](docs/acp-auth-2026-08-24.md) is the capture.

### Three things that were measured rather than assumed

- **A successful `authenticate` is not evidence, so Wringer does not call
  it.** Two independent vendors' agents, failing in opposite directions: one
  accepts its OWN advertised method id and stays unauthenticated; the other
  returns success for a method it never offered and does not implement. A
  client that believed either would report an authenticated worker and then
  fail at the paid turn.
- **Wringer never runs a command an agent supplies.** A login is your act on
  your account, and the block carrying that command comes from the agent — an
  untrusted party — so it is printed for you and never executed. A guard
  watches every process this code starts.
- **Where auth becomes visible differs per agent, and that is now a measured
  row** on [docs/vendors.md](docs/vendors.md): at process start for one, at
  `session/new` for another, and only at the paid turn for a third. It decides
  what a preflight can cost, and it was previously assumed to be one rule for
  all of ACP.

### Two guards that were short, found by an audit rather than a failure

- A guard on what this repository says about its own publication status
  covered three documents and should have covered twelve. Measured: a planted
  false sentence in `QUICKSTART.md` passed while the identical sentence in
  `README.md` failed. It derives its scope from the tree now, with an
  exclusion list that carries a reason per entry.
- Two tests hand-copied a constant that `src/` derives properly, so a fifth
  entry added in the engine would have been exercised by nothing.

### No schema moved

Nothing in `schema/frozen.json` changed a byte, and there is no twentieth
command.

## 0.4.4 — 2026-08-24

**Published.** `uv tool install wringer` gets it. A crash-fix release, cut the
same day as 0.4.3 because one of the three crashes was a regression 0.4.3
introduced.

### Three tracebacks where a sentence belonged

All found by hunting — four probe scripts, about twenty-five shapes executed
against surfaces nothing had attacked. All three are the same class, in the
two places whose entire job is that a product manager never sees a traceback.

- **`wringer-drive` could be killed by its own resume record. New in 0.4.3.**
  `checkpoint` writes `.wringer/drive/resume.json` before every question, and
  the write was unguarded — so a drive directory the process cannot write
  turned *every question in the run* into a `PermissionError`. Two shapes a
  real machine produces: a stray file where the directory goes, and a
  directory the operator cannot write (a wrong-owner checkout, or a full
  disk). **The record now fails quietly**, because the whole effect of failing
  is "the next run will not know where this one stopped" — which is exactly
  what 0.4.2 did.
- **`wringer-drive` crashed the same way one step earlier, and had since the
  verb shipped.** Copying your document into the project failed with a
  traceback instead of a refusal. **The fix here is deliberately the
  opposite**: that copy is load-bearing, so the run STOPS with a sentence and
  exit 2, carrying the operating system's own words so you can tell a full
  disk from a permissions problem.
- **`scripts/acp-auth-probe.py` crashed on a binary that is not there** — the
  single most likely thing to happen to a script whose job is measuring agents
  nobody has measured. It reports `agent_died_at: spawn` now, and invents no
  exit code for a process that never existed.

Every probe became a test, and every fix was reverted individually to watch
its own guard go red.

### What the hunt did not find

Recorded because it is also information. The Stop hook shipped in 0.4.3 held
against eight adversarial shapes — a repository path with a space, `--repo`
pointed at a file and at nothing, the harness's working directory as the
default, a closed stdin, a gate printing five megabytes, an unparseable
config, and a repository declaring zero gates. That last one BLOCKS, which is
the answer that matters. The resume digest is stable across newlines, unicode,
JSON-shaped answers and five kilobytes of text, and a record truncated to
half, to three bytes short, and to nothing never half-reads.

### No schema moved

Nothing in `schema/frozen.json` changed a byte, and there is no twentieth
command.

## 0.4.3 — 2026-08-24

**Published.** `uv tool install wringer` gets it. Same release ordering as
0.4.2 — one commit for the literal, the two documents that name the released
version and this date; then the tag locally; then `ci-repro` green with the
tag present; then `git push origin main vX.Y.Z`.

### A killed drive run comes back to the question it died on

`wringer-drive` writes `.wringer/drive/resume.json` (`wringer.driveresume.v1`,
its own schema, in its own directory — no engine schema version spent, no
field added to a frozen one). A run interrupted at the approval now resumes AT
the approval, against the same rendered plan, and says where the last run
stopped.

**The gap was measured before anything was built**, because `SPEC_DRIVE_V0` §8
had already answered "the session record earns nothing" and reversing that on
an argument would have been the wrong kind of confidence. Two real runs, the
first killed at the approval: the resumed run landed one step BEFORE it, on
the read-back the person had already confirmed, and nothing said where they
had got to. Re-asking a question somebody answered is how a person learns to
type `yes` without reading it — and the question immediately after that one is
the approval.

**It resumes TO a question and never PAST one.** The read-back is the only
question the record may skip, and only because ruling 2 states in the source
that it is not an approval. The approval, the trial, the gate approval and the
delivery are asked live on every run whatever is on disk; a structural guard
fails if that ever widens. The skip dies with the answers it confirmed — a
`wringer-board revise` brings the question straight back — and both the skip
and the resume are spoken, because a question that quietly stops being asked
is indistinguishable from one that was answered for you.

### Supervise somebody else's harness with `wring verify`

`scripts/wring-verify-stop-hook.py` plus `docs/supervise-their-harness.md`: a
Stop hook that blocks an agent from finishing on an unproven change, with the
failing check named. Measured against LangChain's `dcode`, as a
single-variable control — same agent, same hook, same prompt, told to do
nothing. Check RED: it was blocked and went and built the feature. Check
GREEN: it said `ok` and stopped. It fails CLOSED, and the page states what it
cannot promise: the harness caps Stop continuations, so a hook makes an agent
try and cannot make it impossible to stop.

### `docs/vendors.md` carries a second measured worker

`dcode` (LangChain) is `MEASURED-WORKING` on the worker lane. The matrix could
not carry it — it is keyed on vendor and LangChain ships no model — so the
page gained a second table with the reason written down, guarded harder than
the first: a row's credential may name only a variable the linked capture
shows a real run declaring.

**Two different vendors' agents have now converged the same example under the
same judge, gates and boundary.**

### Guards, and three of them were wrong first

- **A timeout never grants.** Six surfaces driven into their own ceilings: a
  gate that traps its termination and exits 0 is still not passed; a judge
  that never answers raises rather than returning a body; an auth probe that
  hangs is never `logged_in`; a closed stream is never a yes; a mute agent's
  turn never completes; a `prove_setup` that runs out of time is not `ok`. The
  SET of wait ceilings is derived from `src/`, so a new one fails until
  somebody says which kind it is.
- **Fail-closed.** An unimplemented ACP method is refused rather than answered
  `{}`; a write escaping the repository is refused AND recorded; an undeclared
  config key is a `ConfigError`; an unreadable judge reply is `needs_human`; a
  criterion the model skipped stays unscored. Wringer's one auto-approve —
  `session/request_permission` — is asserted to leave a ledger line naming
  what was approved.
- **The forward path.** A worker's environment read out of the CHILD; the
  judge's whole outbound request captured, so "only in the Authorization
  header" is measured against the URL and body too; `--env NAME` and never
  `NAME=VALUE`. Every module that starts a process is classified as building
  its child's environment or inheriting with a stated reason.
- **Spec citations.** Every `file:line` in `docs/specs/` is checked against the
  tree. It found eight defects on its first run, including a binding spec whose
  decisive reason cited two shipped strings that are no longer anywhere in
  `src/`.

`scripts/acp-auth-probe.py` no longer raises `BrokenPipeError` when the agent
it is measuring exits at startup — it reports which step it died at, its exit
code, and the agent's own sentence.

### The hunt is STOPPED, and nothing about it shipped

`docs/specs/SPEC_HUNT_V0.md` was revised a fourth time, reviewed a fourth
time, and returned **NOT SOUND** a fourth time. **No sweep was built**, no
command was added, and no behaviour in this release comes from it. The spec's
own header says so, and four decisions are recorded as owed.

It is in this changelog because the release carries the revision and the
verdict, and because the finding is worth a reader's minute: a check that
writes OUTSIDE the sweep's working copy would produce false `evidenced` rows
that every net in the design misses at once — a false proved-red, which this
project ruled worse than an uncovered criterion, manufactured by the feature
built to kill that class. Four rounds, four mechanisms measured, nothing
shipped on a maybe.

### No schema moved

`wringer.driveresume.v1` is new and belongs to `wringer-drive`. Nothing in
`schema/frozen.json` changed a byte, and there is no twentieth command.

## 0.4.2 — 2026-08-22

**Published.** `uv tool install wringer` gets it. Same release ordering as
0.4.1 — one commit for the literal, the two documents that name the released
version and this date; then the tag locally; then `ci-repro` green with the
tag present; then `git push origin main vX.Y.Z`.

### Works with what you already run, and it is measured rather than claimed

**`docs/vendors.md` is new and it is the point of this release.** One row per
vendor per lane — the model that drafts and judges, and the coding agent that
builds — with exactly four statuses and nothing else: `MEASURED-WORKING`,
`BLOCKED-ON-CREDENTIAL`, `BLOCKED-ON-AUTH-ROUTE`, `NO-AGENT-CLI`. A row may
claim `MEASURED-WORKING` only if the capture it links exists in the
repository, the order is alphabetical so no vendor can be promoted, and a
guard reads the table AND the filesystem.

Five vendors' documented OpenAI-compatible endpoints answered Wringer's own
socket — one function, no adapter, and no branch on a vendor's name anywhere
in the engine. Two coding agents were installed and probed. Two findings came
out of running rather than reading:

- `OPENAI_API_KEY` does not authenticate `codex exec`, measured without
  holding a key: with no credential and with that variable set the server
  says *"Missing bearer"* byte-identically, so it is never sent, while
  `CODEX_API_KEY` produces *"Incorrect API key provided"*.
- Kimi's ACP agent advertises a non-empty `authMethods` and refuses at
  `session/new`. `SPEC_LOOPBACK_V0`'s *"no probe below `session/prompt` can
  see auth"* is true of the adapter it was measured on and **false as a
  general statement about ACP agents**.

**The engine never defaults to a vendor, and that is now a property rather
than an intention.** `judge.endpoint` and `judge.model` have no default at
all; a generated config built from answers naming nobody comes out naming
nobody; nothing reads a question's `suggested` value at run time; and no
vendor string is an `or` fallback. The worker question offers three measured
commands instead of one, because a single offered command reads as *the*
command.

The key surfaces stop assuming one vendor: the front door asks for "the key
for whichever provider you choose", and the no-key refusal is built from the
endpoint the operator wrote in their own config — vendor-specific output from
vendor-free machinery.

### `wring audit` verifies a bare bundle, so a failed run can be checked

`attest.build` refuses a run whose gates failed — *"No attestation dresses up
a failure"* — and that refusal stands. Its unnoticed consequence was that the
bundles most likely to be disputed were the ones no verb could digest-check.
Point `wring audit` at a bundle directory and it verifies that bundle's
digests and ledger chain with no attestation, same offline contract, and it
prints what it is NOT claiming: with no attestation nothing binds that bundle
to a commit, to its siblings, or to any claim that its gates passed.

### A check that changed since it was bound stops being silently believed

New bundle sibling `checks.json` (`wringer.checks.v1`, published and frozen):
each declared gate's command, its hash, and the hash of any file the command
names. Comparing it against the bundle a receipt cites answers *is this the
check that went red?* — as a **note** on `wring verify` and on the board, never
a refusal in v0. Whether it should ever refuse is a named future ruling.

Its limits ship inside the record: a command naming no file records
`command-only` and says so, and a gate that edits its own check, runs the
edit and copies the original back leaves the record byte-identical.

### Two board findings from the field report, and a third found here

- **F13.** Two refused rows printed the identical chip under two different
  badges. The chip now names who the row waits on, from the same
  who-is-blocked partition the badge and the count line already read.
- **F14.** The raw check output moved behind the summary line it already had.
  Structural only: the board's own cold reads measured prose making the page
  worse.
- The sentence F14's answer leans on had **no CSS rule at all** and rendered
  in the check's own monospace, reading as one more line the check printed.

### Drift dies by derivation

A round-trip guard derives each writer's field set from its own source and
holds the published schema to it in both directions — catching a writer that
GROWS a field the schema never learned, which validates fine and quietly
narrows every tool targeting the format. Ten writers covered; every other
schema excluded with a stated reason, and a new schema in neither list fails.

**Command canonicalization was measured and REFUSED.** Fifteen pairs through
`shlex` and through `/bin/sh`; four disagree in the direction that does
damage, all from one cause — `shlex` strips both quote characters identically
and the shell does not, so `pytest --cov="$PKG"` and `pytest --cov='$PKG'` are
one string to a canonicalizer and two different checks to the shell. Nothing
shipped. `docs/canonicalization-2026-08-22.md` records it, including a defect
in the probe's own first version.

### The front door was fetching a stale runbook

`START-HERE.md`'s paste block pointed at the pre-merge repository. It answers
HTTP 200 and serves a runbook 7KB behind this one — no auth remedy, no vendor
worker forms, none of the key wording of the last three windows. Found by
fetching it. The guard derives the expected path from where `AGENTS.md`
actually sits.

Three surfaces also pointed a reader at `docs/vendors.md`, which exists in
this source tree and nowhere on their machine, since `uv tool install`
ships four commands and no docs. All three are URLs now.

### Schemas

`wringer.checks.v1` is new. Nothing else moved a byte.

## 0.4.1 — 2026-08-22

**Published.** `uv tool install wringer` gets it.

**The release ordering, measured rather than assumed.** `README.md` and
`SECURITY.md` both name the released version, and a guard derives that name
from `git tag` in both directions — so no ordering leaves `main` green at
every step unless the tag and the prose move in one commit:

1. **One commit**: the version literal, every document that names the released
   version, and this file's date.
2. `git tag -a vX.Y.Z -m X.Y.Z`, **locally**. A tag that has not been pushed
   has published nothing, and `git tag -d` undoes it.
3. `sh scripts/ci-repro.sh`. Green *there*, with the tag present, is the bar.
4. `git push origin main vX.Y.Z` — one act, both refs. `release.yml` publishes
   on the tag, with no stored credential.

Bumping the literal and pushing before the tag turns `main` red; tagging
before the prose moves turns it red the other way. Both were measured on
2026-08-22 by simulating the release in a clone — which is also how the
version guard was found to have been matching nothing at all.

### The wall was a missing credential, and the arcade example got built

**A coding agent drove the `arcade/` example to convergence on a real
machine, and it is the first time this repository can say that.** Three field
runs had died at the build step with `Authentication required`, and this one
had answered it from the adapter's source rather than by sending a turn.
Sending the turn settled it: `scripts/acp-auth-probe.py --prompt` was refused
signed-out, refused with `HOME` emptied, and **answered** with
`ANTHROPIC_API_KEY` in the worker's environment — `stopReason: end_turn`, over
`apiType=native`. The remedy this repository retracted the day before was
correct, and the retraction reasoned from a branch the code never takes.

The wall's real name came from a surface nobody had looked at:
`claude-agent-acp --cli` is the Claude Code CLI, and `auth status` answers
`{"loggedIn": false, …}` for free. The agent had never been logged in, and no
page here had ever said to log it in.

- **`wring run`, `wring resume` and the drive now refuse a signed-out agent
  before anything is spent**, and `wring doctor` warns about it where a person
  looks first. Only a definite "no" refuses — an unmeasured agent, an
  unparsable answer, a containment are all unknown and none of them stop a
  run. `acp.worker_env` is shared with the real turn so the check cannot bless
  an environment the worker never gets.
- **The capstone run**: 9 criteria, a red acceptance check, one 7m48s worker
  turn, converged in 2 iterations, `wring deliver` then **refused** — one
  `human:` criterion is unjudged and no check may answer it. That refusal is
  the feature.
- **A converged loop no longer tells the operator the agent changed nothing.**
  Measured on that run: five files written, gate red to green, and the ending
  printed *"finished its turn without changing a file … could not
  authenticate"*. `files_written` counts only writes through Wringer's own
  `fs/` channel, and a real agent holds the filesystem itself. The counter is
  honest; the inference from it was not.

### The third field test

`docs/field-report-2026-08-22.md` lands verbatim;
`docs/field-response-2026-08-22.md` is the finding-by-finding disposition.

**The report's first finding is about this repository's release habits and it
is the one that mattered.** The run installed `origin/main`, which was `v0.4.0`;
eleven commits and the previous run's own report existed only on the author's
machine. A field test cannot be gated on unpushed code. The version half of
that class is now derived from the tags rather than remembered.

- **Install is one command on one page.** `uv tool install wringer`.
  `INSTALL.md`'s two `--editable` installs errored on the second — both
  packages had come to declare `wringer-board` — and `docs/drive/AGENTS.md`'s
  three-repository variant would have collided the same way. Both gone.
- **README's version and packaging claims are derived**, and fail in both
  directions: a page naming an older version than the latest tag is stale, one
  naming a newer version claims a release that does not exist, and a page
  calling a command this distribution ships a separate unpublished package is
  refused by its own `[project.scripts]`.
- **The documented remedy for an unauthenticated builder was retracted here,
  and the retraction was itself wrong** — see the section above, which was
  written later the same day after the turn was finally run.
  `env_passthrough` with `ANTHROPIC_API_KEY` DOES authenticate the builder.
  The bullet that stood here said it could not, reasoning from a branch of
  `createEnvForProvider` that Wringer never reaches.
- **An assumption can no longer displace a human judgement.** A drafted reply
  whose assumption shapes a criterion the same reply marked `human: true` is
  refused whole, naming the criterion.
- **An answered question cannot reach the builder as a conditional.**
- **Bare `wring` names a way in** before the usage error. No new command.
- **The stdin bullet no longer promises more than the drain does.** The
  interlock is real and was measured in both directions; what was wrong was a
  sentence that read as total protection.
- Board: usage counts moved out from under the disclaimer heading.
- CI installs `uv`, without which a setup-script guard went red for the wrong
  reason on every ubuntu run.

## 0.4.0 — 2026-08-19

### The PM consent surface (SPEC_PMPLAN_V0)

**What a product manager approves, and how they change their mind.**

Measured first: four `wring spec --send` calls on ONE unchanged PRD
(`docs/variance-2026-08-19.md`, captures in `tests/replies/`). `prompt_tokens`
is 2206 on all four, so every difference between them is sampling variance.
They disagree about how many criteria to write, which questions to ask, and —
the finding this work exists to answer — **which decisions to take without
asking at all**. Fourteen criteria across all four runs carry a decision
buried in a criterion's test `guidance`, where the person approving the plan
never reads it as a decision. The drafter was told to prefer visible
assumptions and given no field to put one in.

**Assumptions get a channel.** A drafted reply may carry `assumptions`, each
with the decision, why it was taken, and **the question it displaced** — which
is what stops the channel becoming a tidier hiding place than `guidance` was.
They land in a new `wringer.decisions.yaml` (`wringer.decisions.v1`; the spec
schema is frozen and closed) and render on the plan under DECIDED WITHOUT
ASKING YOU, above the sentence saying that approving the plan approves them.

**The question cap is a guard, not a sentence.** "At most three questions" has
been in the drafting request's prose since PM mode shipped; it is now checked
at parse, after `parse()` so that every message `_parse_questions` exists to
give still fires first and intact.

**The plan has two registers.** Each task carries a plain-language `outcome` —
what the person will be able to do — beside the machine `objective`, and the
plan leads with the first and labels the second. It also says at approval how
many requirements have a check bound to them, how many are the person's own to
decide, and how many have nothing checking them — with the honest consequence:
approving the plan accepts that those will not be proved.

**There is a way back.** `wringer-board revise` changes an answer, or overrules
a decision taken for you (promoting it into `open_questions` with your answer,
which is the channel the briefs are written from). **Every revision withdraws
your approval**, so the plan is rendered again before it can be re-approved —
and answering a question after approval withdraws it too.

**`wring spec --send --redraft`** drafts again over an existing spec and keeps
every answer you have given. It joins on the question's TEXT, not its id: the
same id carried four materially different questions across the four captured
runs, so restoring by id would file your answer to a question you never read.

Two live defects in `wringer-board` were found and fixed on the way: a
hand-written `approved: False` was rewritten as `approved: Falsetrue`, and a
spec saying `approved: no` — valid YAML the engine accepts — could not be
approved at all.

### Also

**`wring spec --send` can reach a current-generation model again.**
`spec.build_request` always sent `"temperature": 0`, and every
current-generation Anthropic model rejects it with HTTP 400 — *"`temperature`
is deprecated for this model"* — before a token is drafted. A product manager
who named the model their team actually uses got an error instead of a
specification, at the first step of the surface. The key is removed, with no
configuration knob replacing it: `temperature: 0` never bought determinism
here, because the drafter's correctness mechanism is parse-or-refuse rather
than sampling temperature.

**`wring judge` is unchanged and still sends `temperature: 0`** — a judge that
is not deterministic is not a gate, and `schema/judge-request.schema.json`
requires it with `"const": 0`. No frozen schema moved a byte.

This changes what `.wringer/specs/<id>/request.json` contains, so the record
is worth reading before you rely on it: nothing reads the key back out, no
schema governs that body, and requests written before today keep their
`temperature` and stay readable. Measured both directions live —
`claude-opus-5` went from HTTP 400 to a complete draft, and
`claude-sonnet-4-6`, which accepted the old body, still drafts.
[`docs/temperature-2026-08-18.md`](docs/temperature-2026-08-18.md) carries the
commands, the endpoint's own error text, and the token counts.

**`judge.max_output_tokens` now defaults to 8000, not 1024.** Named as known
and unfixed in the entry above, and fixed the next day. A real PRD's draft does
not fit in 1024 tokens, and a truncated draft is not a smaller draft: `wring
spec` refuses the incomplete reply and writes nothing, so the surface's first
step failed for anyone who had not already found the knob. 8000 is the value
`wringer-drive`'s generated config has declared since it was written. The
constant is shared with `wring judge`, whose replies are small and unaffected;
no test pinned the old number, and no schema governs it.

**The drafter is shown which files the repository contains, and may bind only
to one of them.** Its rules have always said a `gate_bindings` command must
name a file that already exists, and the request never said which files those
were — so the rule was unsatisfiable. Measured on a real PRD: the drafter
complied honestly by proposing no binding at all and raising an open question
asking what the repository held, every criterion came back `unbound`, and the
repair loop ran no worker turns. The request now carries the tracked paths
(`git ls-files`, paths only, capped at 400 with the truncation announced). Where
git cannot answer, the listing is absent and the drafter is back to proposing
nothing — the behaviour that shipped before.

**A drafted binding that repeats a command already running is refused, and the
criterion is left unbound.** On 2026-08-17 the drafter proposed `run: pytest -q`
to prove "no regression on the report page" — byte for byte the repository's own
`test` gate, green before, during and after. The criterion came back
`unevidenced` and the handover was held, five seconds after a person had
approved the gate. The request forbade this in prose and the model did it
anyway. Duplicates are now compared against both the reply's own `gates:` block
and `.wringer.yaml`, on whitespace-normalised commands. A drafted duplicate is
dropped with the reason printed; a duplicate in a hand-written
`wringer.gates.yaml` is refused outright, because a line somebody typed
deliberately should not be silently ignored.

## 0.3.0 — 2026-08-08

**Four new commands, and the check that makes the rest of them mean
something.** `wring start` is the guided launch — one command from an
installed binary to a verified change with a receipt, and the program's first
interactive surface. `wring attest` and `wring audit` turn a finished run into
a provenance claim a stranger can check offline. `wring graph` composes the
loops into one resumable, evidence-driven workflow file — the "graphs of
loops" the northstar has promised since day one. And `wring verify --prove`
answers the question this project exists for: *could these gates have failed?*
A gate that passes with and without your change proved nothing about it, and
`wring deliver` refuses that bundle.

If you read one thing, make it [`docs/vacuous.svg`](docs/vacuous.svg) — a real
captured session where a worker makes a failing test pass by rewriting the
assertion into `multiply(3, 4) == multiply(3, 4)`, the loop converges, the
gates go green, and Wringer refuses to deliver it. The graph engine inherits
that refusal whole: a decision file that lies `build-status: converged` into
routing state still delivers nothing, because delivery re-reads the bundle.

Upgrading from 0.2.0 needs nothing: every command added is opt-in, no schema
changed under its own version, and `wring verify` behaves as it did.

This release also carries fifteen findings from the second field run — and the
first execution of the Apple `container` path by anyone, on a clean
MDM-managed macOS 26 Apple silicon host. CI structurally cannot run that path (GitHub's macOS runners
have no nested virtualization), so every `AC-*` finding below is information
no test, review or amount of reading could have produced. The full transcript
is preserved verbatim at `docs/field-report-2026-08-05.md`.

The through-line, for the second report running: **most of these were steps
whose gate had never been executed.** So the test coverage is the deliverable
here, not the fixes.

### Added

- **`wring start`** — the guided launch, and the program's first interactive
  surface ([docs/specs/SPEC_START_V0.md](docs/specs/SPEC_START_V0.md)). One command from an
  installed binary to a verified change with a receipt: `wring doctor`'s
  checks inline, the gates your repo already declares shown before anything is
  written, ACP agent detection, the API key, and a first build that ends on
  `wring attest`.

  **Every answer has a flag except the key**, whose non-interactive form is
  the named variable already being set. `--key <value>` does not exist and
  will not: a value on a command line is a process listing. With no terminal
  and a missing answer it exits 2 naming what it wanted — never a guess, never
  a hang. The `stdin.isatty()` gate is a safety property rather than a style,
  because CPython's `getpass` opens `/dev/tty` rather than stdin and would
  otherwise block on a terminal nobody is watching; a test forks a pty to
  prove the gate holds.

  *Wringer never stores a credential.* The key is held in memory for the
  process it launches, folded into the redactor before anything can write, and
  written nowhere. The config records the *name* of an environment variable,
  in `run.worker.acp.env_passthrough` and nowhere else — never
  `judge.api_key_env`, because that section hard-requires three values law 5
  forbids guessing. The command to make it durable is printed and not run.

  **Three refusals, each with a test.** It never installs an agent — it names
  the absent one and prints the install command
  ([docs/specs/SPEC_ACP_V0.md](docs/specs/SPEC_ACP_V0.md)'s "consent-based install belongs to
  `wring start`" parenthetical is struck rather than kept, since two shipped
  error strings already promise the opposite). It never overwrites a section
  you wrote: an existing `.wringer.yaml` is appended to, comments intact, and
  a clash is exit 3. And `--clone` fetches, records provenance, and **stops** —
  a fresh clone is untrusted input and a guided launch that ran a stranger's
  gates would be the most dangerous command in the program aimed at the least
  technical user it has.

  A launch whose first build ran against the placeholder gate **says so and
  writes no receipt** — a vacuous green produced by the onboarding flow is the
  failure this project exists to prevent.

- **`wring graph`** — graphs of loops
  ([docs/specs/SPEC_GRAPH_V0.md](docs/specs/SPEC_GRAPH_V0.md), walkthrough at
  [`docs/graphs.md`](docs/graphs.md)). Six verbs — `validate`, `run`,
  `resume`, `status`, `explain`, `render` — over a local, resumable workflow
  file with five node kinds: `intent` stages the brief into evidence, `human`
  is the `approved: false` interlock again, `loop` wraps the whole repair loop
  in process, `router` chooses between named nodes with three comparison
  forms and no expression engine, and `deliver` calls the shipped delivery
  machinery with **all of its refusals intact**. A parked graph is exit 5 — a
  person must act — and resumes from its `prev_hash`-chained ledger after a
  `kill -9`, never re-running a completed node.

  Three rules carry it. **A graph names capabilities, never commands** — there
  is no `command:` key, a key that looks like one is a hard error, and
  validating or running a stranger's graph file is exactly as safe as running
  the same Wringer commands by hand. **State routes; only bundles gate** — a
  human's `state_updates` can steer the graph but cannot forge evidence,
  because delivery re-reads the run bundle the loop actually recorded; the
  test plants `build-status: converged` for a repo whose gates never passed
  and watches the refusal. **`--send` is typed on the invocation** — it
  authorises the deliver node that invocation reaches, once; a graph file may
  not declare it, a decision file may not carry it, and resuming a parked
  graph means typing it again, because a file is not a typed flag.

  The captured park→resume session is [`docs/graph.svg`](docs/graph.svg): the
  graph parks at the interlock, a person writes `approved: true` into a file
  on camera, and the resumed graph runs the loop and routes on what it
  actually found. Budgets nest and are hard — a node's ceiling is clamped to
  the graph's remainder and enforced by the loop's own machinery — and the
  whole-artifact secret sweep drives a full graph run, staged brief and
  delivery patch included.

- **`docs/vacuous.svg`** — *the agent lies, Wringer catches it*, captured. A
  worker is handed a real bug with a real test that catches it, and it makes
  the failure go away by rewriting the assertion into
  `multiply(3, 4) == multiply(3, 4)`. The loop converges. The gates go green.
  The bug is still there. `wring verify --prove` then finds those gates pass
  on the pre-change tree too — `gates_vacuous` — and `wring deliver` refuses
  the bundle. Every frame is a real command really executed.

  The green baseline is load-bearing: `--prove` compares against HEAD, so it
  catches gates that could not fail, **not** an agent deleting a test that was
  already failing (SPEC_VACUITY_V0 §5a's stated limit). Committing the failing
  test would record `sensitive` and tell the opposite story.

- **`docs/flow.svg`** — the intent→receipt map, generated and probed like the
  roadmap: every box names the command that performs it, and a test asserts
  each is registered in the real parser. Two boxes name **no** command on
  purpose — approving a spec and reviewing a merge request are where this
  program stops and waits for a person — and a test keeps them there.

- **`examples/github-actions/`** — the recipe an organisation copies. Verifies
  with `--prove`, uploads the bundle, **blocks the merge on a vacuous
  verdict** (which already worked: `wring deliver` exits 1 on
  `gates_vacuous`), and posts `summary.md` to the pull request. Three guards,
  because a workflow under `examples/` is never executed and rots in silence:
  every `wring` line in it parses against the real CLI, `--send` appears
  nowhere, and the step it claims to have is actually there.

- **`wring verify --prove` now says on the TERMINAL that the gates proved
  nothing.** `vacuity.json` recorded `gates_vacuous` and `summary.md` carried
  the warning while the console printed `✓ test passed` and exited 0 — so a
  reader learned nothing until `wring deliver` refused the bundle much later,
  for a reason nothing had mentioned. Silent on `proven`, and silent when no
  prove pass ran, per SPEC_VACUITY_V0 §7.

- **One sweep that asks whether a credential can reach ANY artifact**
  (`tests/test_no_secret_in_any_bundle.py`). Every other redaction test here
  is per-path, written by whoever built that path — which is exactly how two
  leaks shipped. This one plants two credentials, runs the commands that
  produce artifacts, and walks **every file** under `.wringer/`. It does not
  enumerate write paths, so one added next year is covered the day it is
  added.

- **`docs/start.svg`** — a second captured recording, beside the existing one
  rather than replacing it, with `docs/start.cast.json` as its transcript. The
  key step is deliberately off-camera and the documentation says so in words:
  a prompt is the one thing this capture method cannot honestly film. The
  agent in it is a stub on `PATH`, and the documentation says that too.

- **`wring verify --prove`** — vacuity detection
  ([docs/specs/SPEC_VACUITY_V0.md](docs/specs/SPEC_VACUITY_V0.md)). After the gates pass, re-run
  them against the *pre-change* tree in a scratch worktree detached at HEAD. A
  gate that passes on both proved nothing about the change; **every** required
  gate passing on both is the verdict `gates_vacuous`, which `wring deliver`
  refuses — exit 1, naming the insensitive gates, the one-line fix, and the
  path to both trees' output. There is no `--allow-vacuous`.

  **Switched on by the config, not by a flag.** `run.prove: true` in
  `.wringer.yaml`; `--prove` tightens for one run; `--no-prove` does not exist
  and `wring run --no-prove` exits 2. The reason is authority over the
  supervised party rather than convenience — `wring run` drives an agent that
  writes code, and this check exists to catch that agent writing tautological
  tests, so the invoker must not get to switch it off. Matched deliberately to
  the `approved: false` interlock, so *flags may tighten, never loosen* is one
  rule rather than two precedents.

  **The trap this was built around**, and the reason it is worth the
  complexity: a detached worktree carries tracked files and nothing else, so
  in any repo whose dependencies are gitignored every pre-change gate fails on
  a missing environment — and the comparison reads that as PROOF. The feature
  built to catch reward-hacking would have certified it, on every run. Closed
  by `run.prove_setup` (a failing one yields `inconclusive`, never `proven`)
  and by requiring every `sensitive` row to cite the failure it rests on, so
  `ModuleNotFoundError: No module named 'yourproject'` is legible at a glance
  rather than convincing.

  No configurable ceiling exists, by ruling: skipping the pass would
  reintroduce the vacuity this feature exists to catch. The cost is measured
  instead — `worktree_ms` and `prove_ms` beside the per-gate rows.

  **The limit, stated rather than discovered later:** the pre-change tree is
  HEAD, so this catches green-baseline reward hacking and *cannot* tell you an
  agent neutered a test that was already failing — that gate really does fail
  at HEAD. Catching it would need reverse-patching, which the spec rules out
  by name. Recorded in SPEC_VACUITY_V0 §5a, in the docs, and pinned by a test.

- **`wring attest` and `wring audit`** — tamper-evident provenance
  ([docs/specs/SPEC_PROVENANCE_V0.md](docs/specs/SPEC_PROVENANCE_V0.md)). `attest` assembles the
  claim: *change C, authorized by spec S, proven by gates G against tree T,
  judged against rubric R with verdict V, delivered as branch B — and every
  bundle backing those clauses is byte-identical to when it was written.*
  `audit` checks it offline, with no config, by someone who trusts nobody
  involved. **Neither calls an LLM and neither opens a socket** — a test
  parses the module's imports rather than grepping its text, so the promise
  cannot be satisfied by deleting the sentence that makes it.

  A clause with no inputs is **absent, not invented**: an attestation over a
  bare `wring verify` bundle carries one clause and is still worth having.
  Bundles link by path; the attestation re-anchors them by digest, recording
  the sha256 of each bundle's `digests.json` file, so a *self-consistently*
  rewritten bundle — files and record edited together — still fails an audit.

  The money test: change one byte in one gate log, and `audit` names that file
  and exits 1. Captured, with the refusals, in
  [`docs/attest-and-audit.md`](docs/attest-and-audit.md).

  **It is unsigned, by decision, and says so in its own artifact.** The word
  *attestation* sounds cryptographic; a reader who assumes it means "signed by
  someone" has been misled by a green thing that means less than it looks
  like. So `attestation.json` carries a `limits` array, `attest` prints the
  first entry as a `!` line (doctor's mark for *worth knowing, not a problem*
  — never `✗`, nothing failed), `audit` repeats it **on success**, and both
  carry it in `--json`. Delete it and `audit` refuses the attestation.
  A signature, if one ever arrives, is the sibling file
  `attestation.json.sig` — never a payload field — so signing stays purely
  additive and every v0 attestation remains valid byte-for-byte.

  `commit_signature` records `git log -1 --format=%G?` verbatim plus the
  reported signer. Wringer touches no key and consults no trust store, and
  `audit` reports the value without re-verifying it: re-verification needs the
  reader's own keyring, which would put a network-shaped dependency on a
  command that must work on a plane. A repo that signs its commits gets a real
  chain for free; one that does not records `N` and loses nothing.

  Seven refusals, each exit 1 and each naming what is wrong: no `digests.json`
  (*cannot attest what cannot be checked* — every pre-0.2 bundle, including
  this repo's committed `.wringer.example/`), a digest mismatch in either
  direction, a broken `prev_hash` chain (**the first code that reads that
  field** — it has been written on every event since 0.2 and verified by
  nothing), a `dry_run` verdict, gates that did not pass, a spec saying
  `approved: false`, and a run recorded `gates_vacuous`. Each was verified by
  disabling it and watching its test fail, not by assertion.

- **`docs/MANUAL_CHECKS.md`** — a dated record of the checks CI structurally
  cannot run: the Apple `container` sequence, the Docker-stub check, and a
  "last passed" table naming host, OS, runtime version, date and commit. It
  carries an explicit **unclaimed** row for Docker Desktop on macOS, which
  nobody has ever tested and which `AC-02` showed matters more than it looked.
- **Guards against every regression below**, in `tests/test_docs.py`,
  `tests/test_detect.py`, `tests/test_init.py`, `tests/test_evidence.py` and
  `scripts/setup-selftest.sh`.
- **`scripts/scratch.sh`** — one place deciding where a script may create and
  destroy a scratch tree, defaulting to `$TMPDIR` and refusing `/`, `$HOME`
  and relative paths.

### Schema notes

- **`wringer.graph.v1`** (`schema/graph-event.schema.json`,
  `schema/graph-manifest.schema.json`) — the graph run bundle under
  `.wringer/graphs/`: an append-only, `prev_hash`-chained `graph.jsonl` that
  `wring audit`'s chain checker reads without a special case, and a manifest
  that is a convenience index over it — resume reconstructs from the ledger
  and never trusts the snapshot. Loop and delivery bundles are referenced by
  path, never nested. New files, so purely additive.

- **`wringer.vacuity.v1`** (`schema/vacuity.schema.json`) — a new sibling
  file, `vacuity.json`, so `wringer.evidence.v1` is untouched. Absent from
  every bundle whose run did not prove, which is what keeps repos that have
  not opted in behaving exactly as they do today.

- **`wringer.attestation.v1`** (`schema/attestation.schema.json`) — a new
  format, so purely additive; no frozen schema is touched. Its optional
  clauses (`authorized_by`, `judged_by`, `delivered_as`) are deliberately not
  `required`: a schema that demanded them would force the invention the spec
  forbids.

- **Every bundle now writes `digests.json`**, not only `wring verify`'s.
  `wring judge`, `wring deliver`, `wring run` and `wring fleet` bundles gain
  it, written last in each path — including `deliver`'s failure path, since a
  failed delivery is still a bundle somebody may audit. No schema moved:
  `wringer.digests.v1` already described the file, and only the verify bundle
  had ever produced one.

- **`wringer.untracked.v2`** (`schema/untracked-v2.schema.json`) supersedes
  `wringer.untracked.v1`. Each entry becomes `"<mode>:<sha256>"` — git's mode
  for the path and the digest of the payload git would store, which for a
  symlink is the link text rather than the referent's bytes. Mode and digest
  are one string so a type flip is a digest change by construction.

  **`wringer.untracked.v1` remains published, frozen and valid.** Its file is
  untouched, anything that read a v1 bundle still reads one, and `wring
  deliver` treats a v1 record the way it treats a bundle written before the
  file existed: names compared, bytes not. Editing v1's digest pattern so the
  new values fit would have silently reinterpreted every digest in every
  bundle already written, which is the one thing law 7 forbids — this is the
  first time that rule has retired a format, and `schema/README.md` carries it
  as the worked example.

### Fixed

- **`wring verify --prove` wrote its gate logs with no redaction at all.**
  `vacuity.prove` ran the pre-change gates through `gates.run` without a
  redactor, so those logs — which land inside the run bundle — got neither the
  config's patterns, nor `env_passthrough`, nor even the built-in
  `*TOKEN*`/`*SECRET*`/`*KEY*` defaults. The one set of bundle files written
  outside the guarantee SECURITY.md makes. Reproduced with a gate that echoes
  an environment variable; the value was sitting in
  `vacuity/001_<gate>.stdout.log`.

- **Redaction made delivery impossible, permanently.** `verify` writes
  `diff.patch` scrubbed; `wring deliver`'s tree-match check compared that
  against a freshly computed **raw** diff. Scrubbed bytes never equal raw
  ones, so any repository whose changed code contained something the redactor
  recognised was refused on a tree that had not moved — and the refusal's own
  remedy ("run `wring verify` again") produced the same scrubbed patch. Both
  sides are scrubbed now.

- **`wring deliver`, `judge`, `spec`, `issue` and `fleet` did not know every
  credential the config declares.** Each built a redactor from one name of its
  own choosing, and `fleet` passed none at all — so a credential named in
  `run.worker.acp.env_passthrough`, the one an *agent* is handed and the one
  `wring start` writes, reached the delivery patch in cleartext while
  `verify`'s bundle had scrubbed it. All five read
  `config.declared_secret_names` now, and a test walks every
  `Redactor.from_config` call in `src/` to keep it that way.

  For `deliver` the two are one fix: the tree-match check compares its
  scrubbed patch against `verify`'s, so a narrower list on either side breaks
  the comparison as surely as it leaks.

- **A failed ACP turn destroyed what the agent said before it died.**
  `run_turn`'s `finally` writes the session updates; the error handler then
  wrote the failure note over the same path. The bundle kept "something went
  wrong" — the half a reader already knows — and lost the only diagnostic the
  turn produced. SPEC_ACP_V0 §2 promises an ACP worker leaves the same shape
  of evidence a shell worker does, and a shell worker keeps its stdout when it
  crashes.

- **An ACP turn leaked three file descriptors.** `_stop` closes the child's
  stdin only when it has to *kill* the process, so an agent that exited
  cleanly — the common case — left stdin, stdout and stderr all open. A
  `wring fleet` drives hundreds of turns in one process, where that surfaces
  somewhere else entirely as `too many open files`.

- **A message arriving as the agent exited was discarded.** `_await` pops the
  inbound queue at the top of its loop and checks for the exit at the bottom,
  so a line landing between the two was still queued when the raise fired. On
  a fast machine the pop wins; on a loaded CI runner it does not. Both
  give-up paths drain first now.

- **Refusals did not fit a terminal.** The vacuity refusal rendered as a
  single **402-column line**. All 43 sites that print a domain exception now
  wrap, line-by-line so the indented examples a reader is meant to copy — a
  `judge:` stanza, a `git remote set-head` command — survive intact.

- **An ACP agent's output reached the evidence bundle unscrubbed.** `acp.py`
  handed the child a raw file handle for its stderr and wrote its session
  updates untouched — unlike `gates.py`, which captures through a pipe
  precisely so redaction happens *before* the write. Since an agent is handed
  a credential by name through `env_passthrough`, an agent that echoed one put
  it straight into a bundle. stderr is now a pipe, drained on its own thread,
  and both logs are scrubbed then capped.

- **`env_passthrough` values were not folded into the redactor**, though
  `config.py`'s own comment and `AcpWorker`'s docstring both promised they
  were. `loop.run` built its redactor from `evidence:` alone, so a passthrough
  variable was protected only if its name happened to match `*TOKEN*`,
  `*SECRET*` or `*KEY*`. `config.declared_secret_names` is now the single
  answer to "what does this config say holds a credential", and both
  `verify.run` and `loop.run` fold it in.

- **`wring doctor`'s key check was hardcoded to two variable names.** It read
  neither `judge.api_key_env` nor `run.worker.acp.env_passthrough`, so a repo
  whose agent wants a differently-named variable was told "no LLM API key"
  with the key correctly set. It now reads what the config declares, falls
  back to the well-known pair, and says which name it looked for.

*The next six entries close what an adversarial review of the delivery-path
work found: fourteen defects, each reproduced twice. Three were **too loose**
— `wring deliver` published a branch whose tree was not the tree the gates ran
against, and refused nothing. That is the exact failure the delivery-path work
existed to prevent, so it is fixed before anything is built on top.*

- **A rename made in an editor resurrected the deleted file on the delivered
  branch.** `_parse_status` tested the porcelain's *index* column alone, and a
  rename wears its flag in either: `R ` from `git mv`, ` R` from a rename made
  in an editor and then declared with `git add -N`, `RM` from `git mv` plus an
  edit. Missing the middle shape did not merely drop a path — the source was
  then parsed as a status line of its own, so a 3-character path sliced to the
  empty string, which vanished from the NUL-joined pathspec. `git commit
  --only` never named the deletion, and the branch shipped a file the gates
  had seen removed. No refusal, no error. Both columns are tested now.
- **`untracked.json` recorded what the gates could read, not what git would
  commit** — and one confusion caused five defects pointing in both
  directions. It hashed the bytes `open("rb")` returned, which *follows a
  symlink*, while git stores mode `120000` and a blob holding the link *text*.
  Too loose: retargeting a symlink at a file with identical bytes, replacing a
  file with a symlink to a copy of itself, and `chmod +x` on a new script all
  changed the committed tree and all delivered unrefused. Too strict, and
  **unclearable**: a dangling symlink and a symlink to a directory each
  recorded `unreadable`, which delivery refuses — and re-running `wring
  verify` recorded `unreadable` again, so no user action lifted it. And one
  hang: a symlink to a FIFO blocked `open()` forever, so **`wring verify`
  never returned**. It now records git's identity for the path,
  `"<mode>:<sha256 of the committed payload>"`, via `lstat` and `readlink`.
- **A case-only rename stranded the user on a half-made branch.** `git mv
  Foo.py foo.py` on a case-insensitive volume died `will not add file alias`
  *after* `switch --create`. Measured: no path-restricted commit can express
  it at all, and building the tree through a temporary index silently writes
  **both** paths. So it is refused from `plan()`, before any branch exists,
  naming both paths and the remedy.
- **A failed commit no longer abandons the branch it created.** Any failure
  between `switch --create` and the commit left the user standing on a branch
  Wringer had made and walked away from — with the next `wring deliver`
  refusing too, because condition 1 is *only a branch Wringer created* and
  that name now existed. The branch is undone when the commit never happened,
  and never once it has: after that it holds real work, and a failed push is a
  state to report rather than one to delete. The rollback never uses `git
  switch --force`, which is `--discard-changes` and would throw away the
  uncommitted work the failure was about.
- **The delivery pathspec no longer dies on its own size, or double-counts.**
  `_matchable` passed every path as argv: measured, 4500 long paths went
  through and 6000 raised `Argument list too long` — after the branch was
  created. It batches now (`git ls-files` has no `--pathspec-from-file`,
  checked). And `git mv a.c b.c` followed by a new file at `a.c` reports the
  name in both of git's lists, so a two-file change was announced as "3
  file(s)" in the terminal, in `--json`, and in the MR body.
- **A refusal that suggested something which could not clear it.** The
  unresolvable-default message ended "or set the branch name to something that
  is plainly not the default" — but it fires before any branch name is
  resolved, and `deliver.base` cannot clear it either, by design. It now names
  `git fetch` and `git remote set-head`, and the test follows its own
  instructions and checks the refusal is gone.

  Recorded rather than amended: commit `d0f866c` said `untracked.json` closed
  *"the last hole in this function's promise"*. It did not, and a dated note
  in `deliver.py` says so above the function rather than the claim being
  quietly overwritten.

- **An orphaned ACP worker had nothing to reap it.** `_run_worker` writes
  `worker.pgid` the instant the shell worker exists, so a SIGKILL of the loop
  still leaves `wring resume` a process group to clean up. `_run_acp_worker`
  wrote nothing — and the ACP agent runs in its own process group, so a real
  agent, holding a real session and editing a real repo, could outlive its
  supervisor with no record that it had ever existed. `wring resume` exists
  *for* the killed loop, which made this the one path where the supervision
  promise did not hold. `acp.run_turn` now reports its pid the instant the
  process exists — before the handshake, because an agent that hangs during
  `initialize` is exactly the one somebody kills the loop over.
- **The fleet deadline killed the supervisor and left the worker running.**
  `_stop` signalled the child `wring run`'s process group; the worker runs in
  its *own* group — that is how a gate timeout kills a shell and everything it
  spawned — so it survived. A deadline that stops the supervisor and not the
  work it started does not bound anything, which is the one thing a deadline
  is for; `_spawn`'s own comment had said as much about child budgets since it
  was written. Both call sites are fixed, the deadline and the no-progress
  reaper, using the same `worker.pgid` files `wring resume` already reads
  rather than a second way to find the same processes.
- **`SETUP.md`: `container image`, not `container images`** (BLOCKER). Apple
  `container` 1.2.0 spells the subcommand singular. The plural exits 64 on a
  pull with a misleading "missing plugin" diagnosis, and fails *silently*
  through a pipe on a list — so an agent cannot tell "not pulled" from "wrong
  command", and the runbook's own stop condition never fires.
- **`SETUP.md`: the Apple path, rewritten.** `brew install container` (a
  formula, no admin password) offered alongside the 95.9 MB signed `.pkg`;
  `container system status`'s real nine-row table instead of "a status line";
  the first `container run`'s six-stage kernel-and-init-image setup
  documented so a healthy run stops being a false stop; the ~470 MB on-disk
  cost of a 160 MB pull; and the version corrected from "v1.0+" to 1.2.0.
- **`SETUP.md`: `--user`/`-e HOME` are a Linux requirement, not a universal
  one.** The runbook claimed that without them the workspace is read-only and
  `wring doctor` reports a blocking problem. Measured false on Apple
  `container`, which translates uids across the mount: a flagless run exits 0
  and the bundle lands owned by the host user. The flags stay in every
  recipe; only the false claim about their absence changed.
- **`wring init` says what it found**, instead of asserting that all three
  build-config files are absent. Pointed at a real Python project it reported
  "no pyproject.toml" while the developer was looking at theirs. The
  *detection* was correct and is unchanged — the repo declares no ruff, mypy
  or pytest, so there was genuinely nothing to gate, and refusing to invent
  `pytest -q` is the documented rule holding under first contact.
- **`wring init && wring verify` exits 0 in an unconfigured repo.** The
  template's three example gates were all `make` targets, so the first run
  after `init` went red and exited 1 on a healthy tree. It now ships a
  passing `placeholder` gate — and says, on the terminal and in `summary.md`,
  that the run proved nothing until you replace it. A green exit that
  quietly means nothing would be the vacuous evidence this project exists to
  prevent.
- **Scripts no longer default to one developer's sandbox.** Five of them
  pointed `rm -rf` or `find -delete` at a hardcoded path named after one
  machine's uid and one user's home. `setup-selftest.sh` additionally
  prepended a `.venv` the current install path never creates, so it silently
  tested whatever `wring` was on `PATH` — or nothing. It now names the binary
  under test and exits 2 when there is none.
- **`SETUP.md`: the probe repo no longer commits its own evidence.** Step 7H
  hand-writes its config and never calls `wring init`, so it got no
  `.gitignore` and its `git add -A` staged the previous run's `.wringer/` —
  measured at two runs, two commits, nine tracked evidence files. On a real
  repository that pattern commits raw gate output into the user's history.
- **`SETUP.md`: step 8 now shows what a skip looks like.** It documented three
  `-` lines outside a repository and then gave a command run *from* the
  clone, where those three never skip. A captured contrasting transcript was
  added, and `setup-selftest.sh` asserts three `-` lines and three
  `"status": "skip"`.
- **`SETUP.md`: the Docker-stub check uses `ls -ld`.** It named `ls -la`,
  which the stub's own stripped permissions defeat — a diagnostic that fails
  in exactly the case it diagnoses.

### Known gaps

Written down rather than dropped. All three were found by an adversarial
audit of this cycle's own work, and all three are outside what the field
report and its remediation plan covered.

- **The template warning reaches `wring verify` and `summary.md`, and no
  further.** `wring explain` re-reads that same bundle and prints an
  unqualified green verdict, and `wring verify --json` reports
  `"status": "passed"` with nothing to distinguish an unconfigured repo from
  a proven one. The ruling for this cycle named the terminal and
  `summary.md`, and the condition is deliberately not recorded in the bundle
  (`wringer.evidence.v1` is frozen), so `explain` has nothing to read. Doing
  this properly means deciding where a "this proved nothing" fact lives
  without moving a frozen schema — a design question, not a fix.
- **Docker Desktop on macOS remains untested by anyone.** Now stated as
  unmeasured everywhere it is claimed, and tracked in
  `docs/MANUAL_CHECKS.md`, but still the project's largest untested surface.
- **The rewritten Apple `container` path has not been re-run on an Apple
  host.** It is transcribed from a captured field run, not re-verified.
  `docs/MANUAL_CHECKS.md` says so and names what the next run must do.

### Changed

- **BREAKING — `run_id` is stamped in UTC**, not in the host's local time.
  A run id is a directory *name*, and names get sorted; a container has no
  reason to share its host's timezone, and this project's own image resolves
  to `Etc/UTC`. A field run on 2026-08-05 measured a container run that
  happened twenty minutes *after* a host run of the same repository carrying
  an id that sorted forty minutes *before* it, so `ls` and `ls -t` disagreed
  about which run was newest. For a tool whose premise is auditable evidence
  that is a defect, not a preference.

  **Existing run directories are unaffected** — nothing is renamed, nothing
  is migrated, every bundle already on disk stays exactly as it is. Only
  newly created ids shift, by your UTC offset. `started_at` in the manifest
  is unchanged and stays local-with-offset: it is the field humans read.
  `wringer.evidence.v1` is untouched, and its own description of `run_id`
  already told readers not to parse it for a timestamp.

  Taken now because the format only gets more expensive to change: 0.2.0 is
  two days old and run directories are local artefacts nobody has archived.

  Belt and braces, in the same change: run ordering now prefers a run's own
  record of when it began — `started_at` from `manifest.json` or, for
  `wring judge`, from `verdict.json` — over its directory name, falling back
  to the id (read as UTC) and then to mtime. The id becoming unambiguous is
  the fix; not depending on it is what makes the next timezone a non-event.
  This matters most where there is no record to read: a loop killed
  mid-flight never writes its manifest, and killed loops are the only thing
  `wring resume` exists for.

## 0.2.0 — 2026-08-03

The release that turns an evidence compiler into a supervision layer. **Ten
new commands**, and the first release in which Wringer can write git history
at all.

### Added

- **`wring run`** — the repair loop: verify → brief → your worker → verify,
  until the evidence says stop. A worker's exit code never ends the loop.
  Contract: `docs/specs/SPEC_RUN_V0.md`, schema `wringer.loop.v1`.
- **`wring resume`** — continue a loop that was killed mid-flight, from its
  ledger. Spent iterations stay spent.
- **`wring fleet`** — hundreds of queued tasks, bounded concurrency, a
  declared self-healing ladder, liveness measured by ledger growth rather
  than by a process still existing, and honest `{succeeded, failed, parked}`
  counts. Contract: `docs/specs/SPEC_SUPERVISION_V0.md` and its eight invariants.
- **`wring judge`** — a rubric verdict over a *finished* bundle, structurally
  unable to see a worker's output. Dry-run by default. Contract:
  `docs/specs/SPEC_JUDGE_V0.md`, schemas `wringer.judge.v1` and `wringer.rubric.v1`.
- **`wring doctor`** — machine-checkable preconditions, one line per check,
  `--json`, exit 1 on anything blocking. Diagnoses; never repairs.
- **`wring spec` / `wring plan`** — the front door. A PRD in, acceptance
  criteria and a build plan out **as a file a human approves**. `approved:
  false` is an interlock no flag, environment variable or model reply may
  flip, and there is deliberately no `--yes`. Contract: `docs/specs/SPEC_INTENT_V0.md`,
  schema `wringer.spec.v1`.
- **`wring get` / `wring issue` / `wring deliver`** — work in as a URL, out
  as a reviewed branch. Contract: `docs/specs/SPEC_GET_V0.md`, schemas
  `wringer.delivery.v1` and `wringer.acquired.v1`.
- **The ACP worker seam** — `run.worker` takes an `acp:` mapping beside the
  shell form. Wringer is the ACP *client* and never the agent. Contract:
  `docs/specs/SPEC_ACP_V0.md`.
- **An OCI image**, built and run-tested by CI, published to
  `ghcr.io/marcoakes/wringer:main`. It contains Wringer and a Python runtime
  and **nothing else** — your gates run your repo's commands, so your
  toolchain comes from your repo.
- **`digests.json`** in every evidence bundle (`wringer.digests.v1`): a
  sha256 per file, written last so it covers the manifest and the summary.
  A `prev_hash` chain makes the *ledger* tamper-evident; this covers the rest
  of the bundle. Tamper-evidence, not tamper-proofing.
- **Hash-chained ledgers** — `prev_hash` on every event in every ledger.
  Written now, consumed by `wring attest` later.

### Changed

- **Wringer may now write git history — but only on `--send`, only onto a
  branch it created, never the default branch, never a force push, and with
  a ledger event appended before every write.** This is `wring deliver` and
  nothing else; `verify`, `run`, `resume`, `fleet`, `spec` and `plan` still
  touch git not at all. See `docs/specs/SPEC_GET_V0.md` §1.
- **Three commands can now send over a network**, each behind a flag you
  type and an endpoint your repo declared: `judge --send`, `spec --send`,
  `deliver --send`. Two fetch, because fetching is their purpose: `get`,
  `issue`. **Nothing that proves anything touches a network** — that rule is
  unchanged and is the one that matters.
- `wring init` no longer writes a `.gitignore` outside a git repository, and
  says why `wring verify` will refuse there.

### Fixed

- **`wring deliver` could publish a claim of verification about code that
  was never verified** — it read a bundle's *status* without checking the
  bundle described the tree being shipped. It now refuses unless the commit,
  the changed-file set and every tracked byte match the run.
- **A delivery could carry the evidence bundle itself** into a public branch
  — including whatever a gate printed — in any repo that had not run `wring
  init`. It now stages exactly the paths the plan lists.
- **An ACP agent that stopped reading its input could wedge the supervisor
  indefinitely**: the blocking pipe write was armed before either timeout
  existed. Writes are now bounded by the turn's deadline.
- **`judge.timeout` and `forge.timeout` bounded no total** — they are
  per-socket-operation timeouts, and a dribbling endpoint reset them
  forever. Both are now deadlines.
- **`fleet.child.worker_timeout` and `fleet.child.wall_clock` were parsed
  and silently discarded**, so a child could outlive the fleet that spawned
  it. `wring run` gains `--worker-timeout` and `--wall-clock`, and the fleet
  passes them down.

### Schema notes for anyone on 0.1.0

- **`wringer.evidence.v1` is unchanged and remains readable.** Bundles
  produced by 0.1.0 validate against the published schema; bundles produced
  by 0.2.0 additionally carry `prev_hash` on each event and a sibling
  `digests.json`. Both are **optional** to a reader — `prev_hash` was briefly
  marked required in the published schema during 0.2 development, which
  would have invalidated every 0.1.0 bundle including this repo's own
  committed example. That was a mistake and is corrected; a test now
  validates the committed bundle on every run.
- New schemas in this release: `wringer.loop.v1`, `wringer.fleet.v1`,
  `wringer.judge.v1`, `wringer.rubric.v1`, `wringer.spec.v1`,
  `wringer.delivery.v1`, `wringer.acquired.v1`, `wringer.digests.v1`. **All
  freeze at this tag.**

### Upgrading

Nothing to do. `wring verify` behaves as it did, its bundles are readable by
anything that read 0.1.0's, and every new command is opt-in — most require a
config section that does not exist until you add it.

## 0.1.0 — 2026-07-31

The first release: a standalone evidence compiler.

- **`wring init`** — write a `.wringer.yaml` from what your project already
  declares.
- **`wring verify`** — run the declared gates in order and write a portable
  evidence bundle: `manifest.json`, timestamped `evidence.jsonl`,
  `summary.md`, `diff.patch`, `status.txt`, and per-gate logs and results.
  `--json` for agents, `--gate` for one gate, `--output` for a chosen
  directory.
- **`wring explain`** — diagnose a finished run, without an LLM.
- Exit codes 0/1/2/3/4; secrets redacted before any write; gate timeouts
  enforced by process-group kill; schemas published under `schema/`.
- No LLM call and no network call anywhere in the release.

Contract: `docs/specs/SPEC_VERIFY_V0.md`, including its Definition of PROVEN — Wringer
verifies Wringer in CI, with the demo bundle committed, before the tag.
