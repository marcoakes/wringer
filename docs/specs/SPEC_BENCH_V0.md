# SPEC — `wring bench` (P6)

*Drafted 2026-08-08 by the planning window, from the northstar's §9c promise
and the P6 dossier's verified seams — then adversarially reviewed against the
whole corpus before commit: five lanes, nineteen findings, and the largest
are rulings below rather than shipped mistakes (the first draft claimed
`gates_vacuous` was "unreachable by construction", which is false the moment
a worker runs `git commit`; it promised kept evidence through machinery that
clobbers on name collision; and it derived a bench bound that ignored the
loop's own finish-the-step-in-flight rule). §9c itself is corrected rather
than inherited: **"via the fleet" does not work** (fleet children are
subprocesses reading their own directory's config), **"judged" is dropped**
(ruling 4), and **"cheap atop fleet + judge + ACP" was wrong** (nothing
composes without the work here). Marc delegated the open rulings on
2026-08-08; all are DECIDED below. Binding; no approval pauses remain.
[SPEC_SUPERVISION_V0.md](SPEC_SUPERVISION_V0.md) binds every primitive here
— ruling 8 addresses its invariant 7 by name rather than quietly;
[SPEC_RUN_V0.md](SPEC_RUN_V0.md), [SPEC_VACUITY_V0.md](SPEC_VACUITY_V0.md)
and [SPEC_ACP_V0.md](SPEC_ACP_V0.md) are unchanged — the vacuity spec's §5a
is load-bearing below and is quoted, never amended.*

## Positioning

> **`wring bench` runs the same repair job through every worker your repo
> declares, one at a time, under identical conditions, and writes one
> comparison bundle. It measures. It does not crown.**

"Which agent actually fixes *your* issues, in how many iterations, at what
cost" — answered with evidence a stranger can audit, and with the claims
kept exactly as large as the evidence: deterministic measures always, the
agent's own usage report when it gives one, and **no winner column**,
because the one fact that would justify one — *was the fix honest* — is
precisely the fact this machinery cannot establish (ruling 6).

The one-sentence test for every design question below: **would this make
the numbers less comparable, or the claims larger than the evidence?** If
yes, it is wrong. The northstar calls bench an attention feature, not a
moat; scope discipline is part of the design.

## 1. What it does

```
wring bench                     run every declared contender (serially by
                                default; `bench.parallel` opts into
                                concurrency — SPEC_ATTEMPTS_V0)
wring bench --contender ID      ...only the named ones; repeatable, two minimum
wring bench --prove             tighten: every contender's loop proves
wring bench --json              one object on stdout, no human report
```

A **contender** is a worker configuration declared in `.wringer.yaml` (§3).
The run, in order: validate the section · preflight every selected ACP
contender's binary (§3b) · make the **baseline worktree**, run the declared
setup in it, and verify — at least one required gate must fail, because a
benchmark of repair needs something to repair (§3a) · make every
contender's worktree and **check** each sits on the baseline's recorded sha
(§3a) · then, for each contender in declared order: setup, then the whole
repair loop — the real `loop.run`, in process, exactly as `wring run`
drives it — against the repo's own gates, recording the outcome, the loop
bundle reference, the final HEAD of its worktree, and whatever the agent
reported about its own usage. Then the next contender, same sha, same
gates, same ceiling.

## 2. Exit codes — and why 0 is not "everyone converged"

`0` the bench completed: every selected contender has a recorded outcome ·
`1` nothing to measure — no required gate fails at the baseline · `2`
config or environment: an invalid `bench:` section, an ACP contender's
binary absent at preflight, a worktree, setup, or sha-agreement failure ·
`3` refused — mid-merge/rebase, the `_refuse_unverifiable` preconditions
verbatim · `4` interrupted · and **never `5`**: nothing in a bench waits on
a person, and the existing "never returns needs_human" guard is *extended*
to pin that, not weakened.

**`wring run` exits 1 when the loop does not converge, and bench
deliberately does not follow it.** `run` executes a repair, so non-repair
is its failure. Bench *observes* contenders, so the observation completing
is its success — a contender that failed to converge is a **result**,
recorded in its row, the same way a loop outcome is a routing fact to a
graph and not a graph failure. A measuring instrument that exited non-zero
after successfully measuring a failure would be reporting its own health
with the patient's chart. `wring bench && ...` therefore means "the
comparison exists", and readers of outcomes use `--json`.

## 3. The `bench:` section

House config rules, verbatim: unknown keys are hard errors · strict
validation · slugs where names become directories · and **the only file
that may put a command into Wringer's mouth remains `.wringer.yaml`** — a
graph ruling restated because it decides ruling 1.

```yaml
bench:
  contender_wall_clock: 900     # seconds, REQUIRED — the SAME hard ceiling
                                # for every contender (invariants 3 + 8)
  contenders:                   # two or more
    - id: claude                # a slug; it names directories
      agent: claude-code        # sugar: an id from wring start's agent
                                # table, expanded through agents.worker()
                                # into the acp mapping below
    - id: gemini
      agent: gemini
    - id: scripted
      worker: "sh ./fix.sh"     # or the full acp: mapping — exactly the
                                # vocabulary run.worker already accepts
```

Validation (exit 2 on any): fewer than two contenders declared — or
selected by `--contender` — because a comparison of one is `wring run`, and
the message says so in both places · a contender with both `agent:` and
`worker:`, or neither · `agent:` naming an id not in the table · duplicate
or non-slug ids · unknown keys anywhere · a missing `contender_wall_clock`.

**Contenders may vary the worker and nothing else.** No per-contender
gates, budgets, or environment: identical conditions are what make rows
comparable, and a contender key that could loosen a ceiling would be the
flags-only-tighten rule broken inside a file. There is deliberately no
`bench.max_iterations`: `run.max_iterations` — or its shipped default —
already binds every contender equally, and a bench-level override could
only restate or loosen it. Each contender's `Config` is the repo's own
config with its `run:` section replaced by one whose `worker` is the
contender's and whose every other field is the repo's declared value or, if
no `run:` section exists, the `Run` dataclass's shipped defaults — nothing
is invented that `wring run` would not default to itself. `run.prove`
binds; nothing in `bench:` or on the command line can switch it off, and
`--prove` may only switch it on, for every contender equally.

`--contender ID` selects among *declared* contenders; no flag defines one,
because a worker on the command line is arbitrary execution the graph spec
already refused once.

**Credentials work exactly as under `wring run`.** The config names
environment variables — including the `key_env` an `agent:` expansion
brings — and those names join `config.declared_secret_names`, which stays
the single answer to "what does this config say holds a credential". At
runtime the values are read from the environment for exactly two purposes,
both existing: folding into the redactor so no artifact can carry them, and
populating the named variables in the agent's own process. Nothing is
stored, and nothing is written.

## 3a. The baseline — a benchmark of repair needs something broken

First, the **baseline worktree**: created, set up (§3b), then verified with
the real `verify.run`. **If no required gate fails, bench exits 1 and
writes no bench bundle** — there is no work, so there is nothing to
measure, and N agents would each "converge" in zero iterations. The
baseline worktree and the verify bundle inside it are kept as the evidence
of *why*, and the refusal names their path alongside the remedy: commit
the failing test that defines the job, then bench.

On a red baseline, the baseline verify's bundle is referenced from the
bench bundle — it is the evidence of *what the work was*, the same role
the graph's intent node plays. The failing required gate(s) it records are
the job every contender is measured on.

**Comparability is checked, never assumed.** Bench records the baseline
worktree's detached sha, then creates every contender worktree and reads
each one's sha back: any disagreement — a commit landing mid-creation is
the ordinary cause — is exit 2, naming the two shas. The recorded sha is
the baseline every row refers to. Uncommitted changes do not ride into
worktrees; a dirty tree gets a `!` note naming that fact, not a refusal.

## 3b. Execution — serial on purpose, isolated on purpose

**Preflight before anything runs.** For every *selected* contender whose
worker is an ACP mapping, the command must resolve on `PATH`; an absent
binary is exit 2 **before any worktree exists**, naming the agent and
printing its install command — never running it, `wring start`'s rule. A
shell `worker:` has no meaningful preflight and gets none; a worker that
fails at runtime is that contender's recorded outcome, not a bench abort.

**Serial is measurement hygiene, not a missing feature.** Parallel
contenders on one machine contend for CPU, IO and the network, and
wall-clock is a primary column (§3c) — concurrency would corrupt the very
numbers the command exists to report.

> **AMENDED 2026-08-12 by [SPEC_ATTEMPTS_V0.md](SPEC_ATTEMPTS_V0.md) §4.**
> Serial is still the DEFAULT and every sentence above is still why. What
> changed is that a repository may now *opt in* to `bench.parallel: N` and
> **spend** the wall-clock column to buy elapsed time — and when it does, the
> manifest and the summary both say the column is contended and that rows may
> not be compared on it. The reasoning is unchanged rather than overturned: the
> numbers would indeed be corrupted, so the artifact refuses to let a reader
> treat them as if they were not. `parallel: 1` builds no pool at all, and a
> test refuses a `ThreadPoolExecutor` to prove that path is untouched. SPEC_GRAPH_V0 ruling 7 ("parallelism
belongs to the fleet") is untouched: fleet tasks are *independent work*,
where throughput matters; contenders are *repeated measurements of the same
work*, where interference is error. Ruling 4 ("wrap in-process; never shell
out to yourself") decides the mechanism: bench builds one `Config` per
contender (§3) and calls `loop.run` with it, in process, the graph's loop
node's exact shape.

**Every contender runs in its own worktree**, made by the fleet's existing
`make_worktree` (still the only git write that is not `deliver`, still
metadata) — **at a bench-scoped path**: `.wringer/worktrees/` entries are
named `<bench_id>-<contender_id>`, never the bare contender id, because
`make_worktree` force-removes a colliding path and contender ids are stable
across benches — the bare name would make every second `wring bench`
silently delete the first one's evidence.

**A worktree carries tracked files only** — the trap P5 was nearly shipped
with. In any repo whose dependencies are gitignored, every gate would fail
on a missing environment and the loop would brief an agent to fight a venv.
So bench runs **`run.prove_setup`** in every worktree it creates, baseline
included, before any gate — the key already declared for exactly this
purpose, under vacuity's existing timeout — and a failing setup is exit 2,
an environment answer, never a brief. No setup declared means none run,
exactly as `--prove` behaves today.

**Budgets nest and are hard** (invariant 8), **and the bound is stated
honestly.** Every contender's loop is handed
`wall_clock = contender_wall_clock` — the *same* number, never a remainder,
so no contender is measured under conditions its predecessor set.
Enforcement is the loop's own, which by SPEC_SUPERVISION S1 stops **after
finishing the step in flight** — so a contender's true ceiling is
`contender_wall_clock` plus at most one worker turn (`run.worker_timeout`)
plus one verify, and the bench's derived bound is N of *that*, plus the
bounded git and setup steps between. A second configurable total would be a
second timer to keep honest — the graph's exact reasoning — and the
in-flight overrun is the loop's documented behaviour, not bench's to
re-legislate.

**Evidence outlives the bench: every worktree a referenced bundle lives in
is kept** — the baseline worktree (its verify bundle is the statement of
the job) and every contender worktree (the loop bundles live inside;
bundles are referenced by path and never nested). A bench that deleted any
of them would be a bench that deleted its evidence. The summary prints
where they are and the `git worktree remove` lines to reclaim the disk —
prints, never runs — and the green-baseline refusal prints the same for the
one worktree it made.

A contender whose loop raises rather than returns is recorded as outcome
`error` with the reason, and the bench continues — honest partial success,
invariant 6. A `kill -9` mid-bench leaves every completed contender's loop
bundle fully valid and the bench ledger chained to its last line.

## 3c. The ledger — measured always, reported when given, priced never

Two kinds of numbers, kept distinct because they have different authority:

- **Measured by Wringer** (always present, always comparable): wall-clock
  seconds, iterations, worker invocations, gate seconds — and two facts
  about the tree: the changed-file list of the final run, and
  **`head_moved`**: whether the contender's worktree ended on a different
  commit than the recorded baseline. The harness never writes git history,
  but a worker is an arbitrary agent and may commit; a row where it did is
  marked, because every tree-anchored verdict in that row (ruling 6) is
  relative to a tree the agent moved.
- **Reported by the agent** (present only when reported): token counts and
  the agent's own cost. ACP agents MAY send `usage_update` session
  notifications carrying `used`/`size` token counts and an optional `cost`
  with `amount` and `currency`. Wringer already receives these on every
  run and today flattens them into a truncated log string; P6 parses them
  into structured fields at last. **They are recorded verbatim as the
  agent's own claim, marked unverified** — the same honesty as the
  recorded-agent-identity precedent — **and an agent that reports nothing
  gets an absent field that must never render as zero.**

**There is no price table.** Pricing would put vendor numbers in a third
module against the vendor-strings rule, and would be wrong the week after
it was written. Cost in a bench is what the agent said it was, in the
agent's currency, or it is absent.

**The frozen loop-event schema cannot carry usage** — `worker.finished` is
`additionalProperties: false` and frozen, so a new field there would
invalidate every new loop bundle against the published schema. Usage
therefore lands as a **sibling file in the loop bundle**, `usage.json`
(`wringer.usage.v1`) — the `vacuity.json` move exactly: a new file, a new
schema, absent from every loop whose agent reported nothing, and every
existing reader untouched. Per-iteration rows (one ACP session per
iteration; `used` is cumulative within a session, so a row keeps its
session's last report), plus totals; cost totals exist only when every
reporting row shares one currency. The bench bundle's own events and
manifest — new schemas, nothing frozen — carry each contender's totals
directly.

## 4. The bench bundle — `.wringer/benches/<bench_id>/`

`wringer.bench.v1`, and every house rule the other bundles obey: an
append-only, `prev_hash`-chained `bench.jsonl` verified by the same chain
checker `wring audit` uses (the same function, not a lookalike) · a
`Redactor` built from `declared_secret_names` — which now includes every
contender's names — owning every write · `manifest.json`
(schema-versioned) · `summary.md` · **`digests.json` last, covering
everything** · loop and verify bundles referenced by path, never nested ·
ids from `evidence.new_run_id`.

Events: `bench.started` (sha, contenders, ceiling) · `baseline.verified`
(status, the failing gates, the bundle ref) · `contender.started` ·
`contender.finished` (outcome, iterations, wall-clock, `head_moved`, usage
totals when reported, the loop ref) · `contender.skipped` (with why) ·
`bench.finished`. An interrupted bench still writes its manifest and
digests over what exists — a partial bench is still a bundle somebody may
audit.

**The manifest carries a `limits` array with, at minimum, these three
entries, and the summary and `--json` repeat them on success** — the
attestation's ruling, applied here because a benchmark is the artifact most
likely to be read as a larger claim than it is:

1. *One run per contender. Agents are stochastic; a difference within noise
   is noise.*
2. *Usage and cost are the agent's own report, unverified. Absent means
   unreported, never zero.*
3. *A green gate proves the gates went green, not that the fix is honest —
   read the diffs before believing any row* (§5, ruling 6).

The summary renders contenders in **declared order** — never outcome
order — with the measured columns, the reported columns (absent rendered
as absent), each contender's changed files and `diff.patch` path, and next
actions: the exact `wring judge <final_run>` line per contender for anyone
who wants a rubric's opinion, and the worktree cleanup lines.

Schemas under `schema/` — `bench-event`, `bench-manifest`, `usage` — with
the drift test extended in the same commit as the code; new files,
additive, nothing frozen is touched.

## 5. Rulings

1. **Contenders are declared in `.wringer.yaml`, and a flag can only
   select among them — DECIDED.** The one file whose "this file is code"
   trust story is documented and guarded stays the only source of
   commands; the `agent:` sugar takes table ids only, so the `wring start`
   precedent (flags carry ids, commands live in the table) holds. No
   `--worker` flag exists, for the graph spec's ruling-1 reason. Selection
   below two is refused with the same message as declaration below two —
   a flag that could produce a single-row "comparison" would manufacture
   the artifact the floor exists to refuse.
2. **In process, serial, worktree-isolated — DECIDED.** The northstar's
   "via the fleet" is corrected: the fleet's children are subprocesses
   reading their own directory's config, so varying the worker means
   Wringer authoring configs mid-run, against the read-never-replace
   ruling. Serial execution is measurement hygiene (§3b), not a
   concession, and it reconciles graph rulings 4 and 7 instead of choosing
   between them.

   **AMENDED 2026-08-12 by [SPEC_ATTEMPTS_V0.md](SPEC_ATTEMPTS_V0.md).** *In
   process* and *worktree-isolated* are untouched and load-bearing — the
   attempts still call `loop.run` directly, which is what hands over an
   identical ceiling rather than re-deriving one across a CLI, and each attempt
   still gets its own worktree. *Serial* becomes the DEFAULT rather than the
   only mode. Two consequences the amendment owns rather than inherits: a
   Ctrl-C reaches the main thread only, so the interrupt path reaps through
   `loop.worker_pgids` or a thread pool would quietly revoke
   SPEC_SUPERVISION's reapability invariant; and no ledger event is written
   from a worker, because `Bundle.event` computes `prev_hash` by reading the
   last line and two threads there would break the chain silently.
3. **Cost is measured-or-reported, never priced — DECIDED.**
   Deterministic measures are the primary columns; the agent's
   `usage_update` report is recorded verbatim as a claim; absence is
   absence; no price table exists (§3c). The mixed case — one contender
   reports, another does not — is reported as exactly that, and refuses
   nothing, because bench does not rank (ruling 6).
4. **Bench does not judge — DECIDED.** There is no judge seam outside
   `cmd_judge`, and extracting one mid-slice is the `_open_merge_request`
   temptation G5 already declined by name. A judged bench also cannot run
   offline and would be a new sender behind a new `--send`, restating
   every network enumeration, for a verdict exactly as blind to the one
   question that matters (ruling 6) as the gates are — unless a rubric
   asked it, at which point its answer would become the auto-crown ruling
   6 refuses. `wring judge <run>` exists today for any contender's final
   bundle, and the summary prints the exact line. The northstar's
   "judged" is dropped, not deferred.
5. **The unit of comparison is the declared worker — DECIDED.** Most
   usefully two agents, hence the sugar; legitimately the same agent twice
   under different ids, or an agent against a shell script. The headline
   "which model" is the common case, not the definition, and the
   positioning line says "worker" on purpose.
6. **Bench measures and does not crown — DECIDED, and this is the spec's
   centre.** The first draft claimed the vacuity refusal was unreachable
   "by construction"; the adversarial review broke that claim and the
   honest version is stronger. While a contender's worktree stays on the
   baseline commit, `gates_vacuous` cannot occur — the planted required
   gate fails on the pre-change tree, so any converged run has a sensitive
   row and reads `proven`. But the pre-change tree is HEAD *of the
   contender's worktree*, the harness only binds itself, and **a worker is
   free to run `git commit`** — after which prove compares the fix against
   the fix, every verdict in that row is about a tree the agent moved, and
   `gates_vacuous` is reachable after all. So bench measures `head_moved`
   per row (§3c) instead of claiming impossibility. Worse for ranking: the
   attack that matters sits in SPEC_VACUITY_V0 §5a's stated blind spot —
   an agent that "fixes" the planted failure by rewriting the failing test
   into a tautology produces green gates and, with HEAD unmoved, a
   `proven` verdict, *faster* than an honest fix. An auto-ranked bench
   would systematically reward reward-hacking, in the product built to
   catch it. Reverse-patching is ruled out by the vacuity spec by name and
   not reopened. So: no winner, no score, no ordering field in any schema
   of this slice, contenders rendered in declared order everywhere, and
   the blind spot stated in the artifact's own `limits` — the reader
   ranks, with the diffs in front of them. This is not a hedge; it is the
   claim sized to the evidence, which is the product.
7. **A completed measurement exits 0 — DECIDED** (§2). Observation and
   execution report differently, and the guard family that pins "never 5"
   grows a member rather than an exception.
8. **A bench sitting does not resume, and this is said to invariant 7's
   face rather than behind it — DECIDED.** SPEC_SUPERVISION invariant 7
   says everything resumes from the ledger; the *shipped* supervisor
   practice is narrower — `wring fleet` has no resume and says so on its
   own terminal ("no fleet resume yet"), while every child loop resumes
   individually. Bench matches the shipped practice exactly: its ledger
   and kept worktrees hold every fact a future resume would need (no state
   off disk — invariant 7's second clause is fully honoured), a killed
   bench's completed contenders keep their evidence, and the console says
   plainly that a bench is one sitting, bounded by its ceilings. If
   supervisor resume ever lands, it lands for fleet and bench as one
   corpus-wide slice, and this ruling is the marker that the debt is
   shared, not bench's alone.

## 6. Non-goals (binding)

A winner, score, rank, or any ordering of contenders · calling the judge ·
any socket, sender, or fetcher (the worker's own network remains the
worker's, exactly as under `wring run`) · a price table, currency
conversion, or cost arithmetic across currencies · parallel contenders ·
`--runs N` / statistics across repeats · resuming a bench (ruling 8) ·
per-contender gates, budgets, dirs, or environments · installing an absent
agent (preflight refuses and prints the install command, §3b) · cross-repo
benches · leaderboards, registries, uploads, or badges · Windows.

## 7. Definition of DONE

- [ ] a bench of two shell-worker contenders on a scratch repo with a
      committed failing test runs to completion through real processes,
      nothing mocked; both loop bundles are valid, referenced, and inside
      kept bench-scoped worktrees — and a SECOND bench on the same repo
      leaves the first one's worktrees and bundles untouched
- [ ] a green-at-baseline tree exits 1 naming the remedy and the baseline
      verify bundle's path; no bench bundle exists afterwards
- [ ] every §3 rejection fires with a message naming the fix, including
      the below-two case naming `wring run` — for declaration and for
      `--contender` selection both
- [ ] the ceilings are provably identical: a test asserts what `loop.run`
      is *handed* for every contender (the graph clamp test's method), and
      `run.prove: true` is provably not loosenable from `bench:` or any
      flag
- [ ] `run.prove_setup` runs in every worktree before any gate, and a
      failing setup is exit 2 with no loop started and no brief written
- [ ] an ACP contender whose binary is absent is refused at preflight,
      exit 2, install command printed, before any worktree exists
- [ ] a commit landing between worktree creations is caught by the
      sha-agreement check, exit 2, naming both shas
- [ ] a contender that moves its worktree's HEAD gets `head_moved` in its
      event, row, and `--json`; one that does not, does not
- [ ] a `usage_update` emitted by the fake ACP agent lands as structured
      rows in `usage.json`, totals in the contender's row, and fields in
      `--json`; a contender reporting nothing renders absent everywhere,
      and a test fails if absent ever renders as `0`
- [ ] every credential name every contender declares reaches the bench
      redactor via `config.declared_secret_names`, and the whole-artifact
      secret sweep DRIVES a bench (it covers only commands it drives) over
      contenders with distinct credential names, then reads every file
- [ ] a bench whose *later* contender converges faster still renders
      declared order in the summary and in `--json`'s contender array —
      pinned by a test that would catch a sort
- [ ] the manifest's `limits` carry at minimum §4's three entries, the
      summary and `--json` repeat them on success, and a test pins the
      presence of each of the three by content — not merely a non-empty
      array
- [ ] `bench.jsonl` verifies with the same chain function `wring audit`
      uses; a `kill -9` mid-bench leaves completed contenders' bundles
      valid and the chain intact to its last line
- [ ] `bench.py` provably opens no socket — the import-parsing test's
      method, not a grep
- [ ] every parser-derived guard passes in the shipping commits: the
      command table and its heading, the roadmap (P6 goes green and the
      SVG is regenerated in the same commit), the flow diagram, and the
      never-returns-5 family extended to `bench`
- [ ] schemas under `schema/` with the drift test extended in the same
      commit; every schema frozen before this slice byte-identical
- [ ] `docs/bench.md` carries a captured transcript via the recorder's
      derived STEP_SETS machinery, within its 80-column canvas
