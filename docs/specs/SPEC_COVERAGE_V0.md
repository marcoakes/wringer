# SPEC_COVERAGE_V0 — the number, and its twin

*Binding. Written 2026-08-28, with its field case already in hand.*

**How much of what was asked for is anybody watching?** Every surface counted
STATES — what happened to each requirement in this round. None of them
answered this, which is a different question and the one a person arrives
with.

---

## §1 The measurement this spec starts from

On run 2's delivered board, **5 of 8 requirements had no check at all — and
the defect that run existed to fix landed exactly on one of the unwatched
ones** (`docs/field-report-2026-08-28-run2.md`, finding 3). `report-names-cause`
was one of seven criteria with no gate bound, and the previous build's defect
landed precisely there.

The fact was on disk the whole time. `acceptance.json` carries `gate` per row,
so "5 of 8 are unwatched" was one subtraction away — and no artifact anywhere
did the subtraction, so a person had to read eight rows and do it themselves.

The second half has a separate body count. A person was asked to judge the
wording of a summary that appeared in **no surface Wringer had**; the
judgement was possible only because a coding agent pasted the output into a
chat window unprompted (same report, finding 2). `show:` fixed the *asking*.
Nothing counted how many requirements still had nothing to show.

---

## §2 The two sentences

> **N of M requirements carry a check that can prove them.**
>
> **K of H requirements that need a person have something to show them.**

**Ruling MR1 — two debts, two lines, never blended.** A single number over
both populations points nowhere. The remedy for the first is to write a check;
the remedy for the second is to declare a command that renders the thing a
person is being asked to look at. Those are different jobs done by different
people, and a reader told "6 of 9 covered" cannot tell which is theirs.

The populations are **disjoint and together are everything**: a requirement
marked `human` can never carry a check — that is what the marking means — so
it is counted in the second line and nowhere in the first. Counting it in the
first would make that number permanently unreachable.

**Ruling 1 — each line appears only when its population exists.** A sentence
reading "0 of 0" is a caveat over a clean record, which is how a reader learns
to skip caveats.

**Ruling 2 — the separation is visual as well as arithmetic.** Consecutive
`> ` lines are one paragraph in every markdown renderer, so the first draft
put the two numbers on a single rendered line. That is MR1's blending arriving
through the formatting. `coverage.quoted` puts a `>` between them, and both
markdown surfaces use it.

**Ruling 3 — number agreement follows the POPULATION.** One rule, and it is
the wording the ruling itself uses. Both alternatives were rendered by real
runs and read: keying the verb off the count gives *"1 of 3 requirements
carries"*, and keying the verb off one and the pronoun off the other gives
*"0 of 1 requirement that needs a person have something to show them"*.

**Ruling 4 — no house vocabulary.** These sentences are read on the board by
somebody who was never taught `criterion`, `unevidenced` or `proves:`, and the
board's jargon guard covers this text.

---

## §3 Where it lives

**Half a rendering, half a record, and that is the whole reason a file
exists.** The binding fact is already in `acceptance.json`, per row: `gate`
non-null, or a witness that covers. The visibility fact has no home anywhere —
`show:` is declared in the person's own `.wringer.yaml`, read at render time,
and recorded by nothing.

So `coverage.json` (`wringer.coverage.v1`) is a NEW sibling file. No published
schema moves, which is what the frozen-schema law allows and requires.

**Ruling 5 — one computation, one renderer.** `assess` is the only thing that
decides these numbers and `lines` is the only thing that words them. Four
surfaces quote `lines` verbatim: the bundle's `summary.md`, `mr.md`, the
certificate, and the board. This programme's most-repeated failure is two
surfaces describing one fact and drifting.

**Ruling 6 — null is not false.** `covered` is null on a row needing a person
and `shown` is null on every other one. **False is a debt somebody could pay;
null is a question nobody asked**, and collapsing them is how a record lies —
the same reason `demonstrated_able_to_fail` is three-valued.

**Ruling 7 — absent is absent.** A bundle written before this file existed has
no coverage record, and every surface renders nothing rather than a coverage
of zero.

**Ruling 8 — the certificate's face grows and its record does not.**
`coverage.json` travels into the delivery beside `certificate.json` and the
face renders it. A key added to `wringer.certificate.v1` would be a silent
break for every reader of a document already written; a key held open and
empty would be a claim that the question was asked.

---

## §4 Plan-time visibility

**Ruling MR2 — a WARNING, by name, and never a refusal.** `wring plan` and the
board's plan (which `approve` prints before it writes) name every requirement
only a person can settle that has nothing declared to show them.

It does not refuse, and **the reason is a body count that does not exist
yet**. The only place this has hurt anybody is at the pen, and the pen now
speaks in capitals — `wringer-board judge` says out loud that it is asking
about something it cannot show. A plan-time refusal would stop work over a
file the person can write at any moment up to the judgement. When somebody is
hurt DESPITE the warning, the ruling is already written.

**Ruling MR3 (2026-09-02, world-class plan P0.3) — the display is PROPOSED
in the same diff as the gates, and approved by the same yes; proposed, never
installed.** Runs 4 and 4B both ended at a pen with a blank page, and 0.6.7's
answer — the drive ASKS for a `show:` command per `human` criterion — left
the person inventing one. So the drafter's sidecar (`wringer.gates.yaml`,
now `wringer.gatespec.v2`; v1 is frozen and stays readable) may carry a
`show:` block, one proposed display command per `human: true` criterion, and
`wring plan` renders it INTO the gate diff under a top-level `show:`, marked
in the plan's prose as *proposed; each runs on your machine at the pen*. The
Gate 1 ruling that `show:` lives in `.wringer.yaml` and never in the spec —
because a model-drafted value RUNS — is kept, not bent: a proposed gate is
already a model-written command that runs on the person's machine after they
apply the diff, and a proposed display is exactly that power and no larger,
so it takes exactly that consent. `wring plan` writes nothing into
`.wringer.yaml` for it, as for a gate. Where the file already has a `show:`
section the proposal is listed in words (`show_not_installable` in `--json`),
mirroring the second-`gates:`-key refusal: a second top-level key would
REPLACE the first and YAML would not say so. A proposal for a criterion a
machine decides, or one the spec never declared, is refused at plan time from
a typed sidecar and dropped with a note from a drafted reply. MR2 is
unchanged: absent or declined, the warning stands and the drive's 0.6.7
question remains the fallback, asked only for criteria still lacking a
`show:` after the diff is applied.

---

## §5 An environment-faced red says so where a person reads

**Field capture, 2026-08-28 finding 4.** The first `wring verify` of that run
recorded `ruff: command not found` — the example's gates resolve only with the
project's `.venv` on `PATH`. That is documented behaviour rather than a
defect: the bundle says plainly that gates run "with the invoking user's
privileges and the whole environment inherited". What it is not is a red the
requirement earned, and **in the summary it was indistinguishable from one. It
went into the record as one.**

Where `diagnose` has a face for a red gate:

- `summary.md`'s row carries `(maybe the environment)`, and a section below
  names the guess with the line it was read from;
- the board's card for that requirement carries the engine's own sentence.

**Ruling 9 — hint tier, and it stays there.** SPEC_ENV ruling 1: *a
classification may ROUTE and may never CLAIM.* This changes no status, no exit
code, no acceptance row and no verdict — the guard for it runs two identical
repositories, one failing on a missing command and one failing ordinarily, and
asserts the outcomes are equal.

**Ruling 10 — the word "guess" is in the block's own first sentence**, not in
a footnote. The whole licence for reading a gate's output is that nothing read
there decides anything.

**Ruling 11 — one writer for `diagnosis.json`.** Only the loop wrote it, and
the board reads the RUN bundle, so the one surface a non-engineer opens could
never show the guess. The writer moved to `diagnose.write`, beside the
classifier, and both the loop and a plain `wring verify` call it.

---

## §6 The claim ceiling, ON the surface

One plain sentence, rendered wherever the number is:

> This counts checks that are bound to a requirement. A bound check can still
> test less than the requirement means, and this number cannot see that —
> `wring health` is what watches coverage narrow over time.

A binding is a declaration somebody made. It is not a measurement of how much
of the requirement that check exercises, and this number must never be read as
one.

---

## §7 Out of scope, deliberately

- **Any refusal.** MR2 is explicit and §4 says why.
- **A quality score for a check.** That is `wring health`'s subject, across
  time, and this number is deliberately about bindings alone.
- **Falsification** — its own carrier.
