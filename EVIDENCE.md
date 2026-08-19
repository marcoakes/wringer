# What Wringer has been shown to do, and what it has not

This file exists because the honesty was scattered across a 7,000-word README,
a dozen spec documents and several dated captures — where it read as
throat-clearing rather than as the point. It is the point. A tool that refuses
what it cannot evidence has to hold itself to that first.

**Nothing here is softened, and nothing here is new.** Every item was already
recorded somewhere in this repository; this is the index.

---

## The one claim designed to be decisive — and it LOST

On 2026-08-13 a corpus of **13 real upstream bug fixes** across 5 repositories
was run through the whole chain, twice, for **$76.99**. The claim under test:
*`delivery_eligible` is a better predictor of actually-correct than the
agent's own say-so.*

**It lost.** `wring deliver` said yes to **26 of 26** changes, including every
deliberately wrong one. The loop ran **zero** worker turns. Running `--prove`
afterwards reported **13 of 13 gates vacuous**.

An adversarial audit of the corpus then found it had been **leaking the
answer** through `.git`. That is now truncated and refused by
`forbidden_shas` — but the loss stands, and it was published rather than
buried: `docs/corpus-2026-08-13.md`.

### Why a bigger sample would lose the same way

The failure is **structural, not a sampling artefact**. The corpus's `wrong`
label is an **upstream-agreement** verdict — does this change match what the
maintainer actually did? No criterion-derived instrument can reproduce that
oracle, because a criterion describes what was asked for, not what the
maintainer had in mind.

**The boundary, stated plainly:**

> Wringer proves a criterion was made to pass and could have failed.
> **It does not prove the criterion was the right one.**

Where a criterion under-describes the intent, every check derived from it
inherits that gap — including the witness. This is a real capability boundary
and it sits inside the product. `docs/witness-programme.md` carries the full
analysis.

**The lane that does work** is net-new work with generated gates, where the
red is natural. That is sanctioned in the same document and **has never been
run at scale.** When it is, the claim will be pre-registered and published
whether it wins or loses.

## The signature has never been real

`docs/attest-and-audit.md:242`, this repository's own words:

> *"…against a stub and has never run against live Sigstore."*

So the strongest sentence the project can say — *check this without trusting
anyone* — currently rests on a stub. The attestation **format** is verifiable
offline and that part is real. The **signature path** has not been exercised.
`docs/MANUAL_CHECKS.md` Sequence H is the written procedure, unrun.

## Nobody can read the board

On 2026-08-19 six readers were handed a real rendered board and nothing else.
**Three said the work was "partly" done, three said "not finished", and none
said finished.** Every one produced a list of words they had to guess at.

The sharpest finding: the page prints eight named failing checks *and*, on the
same screen, eight requirement cards saying "Nothing checks this yet". Both
statements are true — those checks were never *installed* against those
criteria — and arranged so a careful reader concludes the page is lying.

Ceiling on that evidence: **the readers were models prompted as people, not
people.** A lower bound on the confusion, not a measurement of it. The human
protocol is written and that run is owed.
Record: `wringer-board/docs/coldread/`.

## Containment is opt-in, beside an unsandboxed default

`run.containment` exists and works — an ACP worker **can** be contained, which
was a refusal until Phase 3 made it a capability. But it is something you
switch on, and `trusted_local` sits next to it, unsandboxed. For a repository
you did not write, that is the wrong way round. Changing it is a behaviour
change and is not done.

## The code is young, and it is defect-dense under real use

On **one day**, 2026-08-19, thirty defects were found and fixed across the
three packages. Two were in shipped code. Sixteen were in code written that
same day, *after* its tests were green.

**Every single one was found by executing something. None by reading.**

Four of the guards written that day passed with their own fix reverted — all
four asserting a property of a whole file when the claim was about one line in
it. That is now a fixed step: revert each fix individually and watch that
specific guard go red.

Draw the obvious inference. This is three-week-old code with a large surface,
and the rate at which running it finds problems has not yet flattened.

## Smaller ceilings, kept because they are load-bearing

- **The buried-decision detector is a LOWER BOUND with no known ceiling.** It
  matches measured phrasings; four drafting runs produced four different ones.
  It found 10 of 14 real cases in the corpus it was built on, and there is no
  true-negative case anywhere. **Its silence is not evidence.**
- **A green gate says only what it checks.** `wring health` reports whether
  the record shows a gate can still fail — a claim about the RECORD, never
  about the gate.
- **`wringer.judgements.yaml` has no writer anywhere**, on purpose. A `human`
  criterion is answered by a person or it is not answered.
- **Four packages, two unpublished** at the time of writing. `pip install
  wringer-drive` does not resolve, because `wringer-board` is not on PyPI.

---

## What IS demonstrated

Not everything here is a caveat.

- **The engine runs its own gates on itself**, every commit, in a fresh clone
  of committed state: 1,892 tests plus lint.
- **A vacuous gate is really caught.** `--prove` runs the declared gates
  against the pre-change tree; a gate that passes there proved nothing about
  the change. That is the differentiated thing and it works.
- **The loop and the graph are real** — `wring run` and `wring graph`,
  ~4,000 lines between them, 82 tests.
- **Containment was proved**, not asserted: sequence I against a contained ACP
  worker, 7 of 8 probes flipped, with a `--privileged` control run that lists
  the corpus mirrors by name.
- **The whole arc runs end to end** — prose PRD to a built change to a
  refusal — and the refusal is the ending it was designed for:
  `wringer-drive/docs/the-whole-arc.md`.
- **A loss was published.** The corpus result above was written up and kept
  rather than quietly dropped, and this file exists for the same reason.
