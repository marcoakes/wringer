# SPEC_CERTIFICATE_V0 — the proof that travels

*Binding. Written 2026-08-28, after a cold reviewer read a real delivery and
could not act on it.*

**Thesis in one line: the proof must TRAVEL.** A reviewer who never ran the
machine can see which requirements are proved, which are not, who judged the
one only a person can settle, and can re-check the record offline.

---

## §1 The measurement this spec starts from

On 2026-08-27 a reviewer who had not run Wringer was handed a delivery and
asked whether they could act on it. Their answer, verbatim, is in
`docs/field-report-2026-08-27-run6-rerun.md` under *"The judgement you asked
for"*. It is **partly**, and the four things they could not do are this
spec's acceptance list:

| # | Their words | What was actually wrong |
|---|---|---|
| **G1** | *"'Unevidenced' isn't a word I use … '6 of 8 requirements have no test proving them' would land faster."* | The record's machine word was the reader's vocabulary. |
| **G2** | *"It doesn't say which six. That's the big one … To find out I'd need the board, which the same file tells me 'stays with the machine that ran it.' I'm told there's a hole and told the map isn't coming."* | The titles were on disk and on no travelling surface. |
| **G3** | *"'1 for a person to judge' doesn't say it was judged … The MR doesn't show the verdict, the note, or who gave it. I'd assume it was still outstanding."* | A recorded judgement rendered nowhere. |
| **G4** | *"Nothing names the one proved criterion either."* | Same as G2, for the good news. |

The sentence in G2 is narrowed rather than deleted, and this is its current
wording wherever it is stated: **the gate LOGS stay behind; the certificate
and a copy of the board travel with the delivery.** What may not travel is
gate output — a bundle may hold whatever a gate printed and a merge request
body is public — and that was always the promise the old sentence was
protecting. It was simply broader than the promise, and a reviewer read the
difference exactly as written.

**Every one of these is a RENDERING failure, not a recording failure.** The
run that produced them had all four facts in `acceptance.json` and put none of
them in the two files that go with the code. That is what makes this a
format play rather than a measurement one, and it is why nothing in this spec
assesses anything.

The body count for G3's note is separate and worse. A judgement note reading
`your words here5` — an agent's chat placeholder with a stray keystroke —
was recorded as the reason a requirement passed and travelled into a delivered
branch (`docs/field-report-2026-08-28-run2.md`). It was caught by somebody
opening the YAML, because no surface in the program showed a judgement note to
anybody.

---

## §2 What is written, and where

`wring deliver` writes into the delivery directory, beside `mr.md`:

| File | What it is |
|---|---|
| `certificate.json` | `wringer.certificate.v1` — the machine record. A NEW sibling file; no published schema changes. |
| `certificate.md` | The face, rendered from the record and from nothing else. |
| `board.html` | A copy of the repository's board page, when it has one. |

**Ruling 1 — it re-assesses nothing.** Every requirement fact is copied out of
the `acceptance.json` that `wring verify` already wrote. A second assessor
here would be a second opinion about one run, and the two would drift — which
is the failure this whole programme is about.

**Ruling 2 — one renderer, quoted by both travelling surfaces.** `mr.md`'s
"Every requirement" section is `certificate.requirement_lines` verbatim, the
same discipline `accept.disclosure` is already under. Landing this on the
certificate and leaving the merge request to catch up is the mistake of
2026-08-22, whose second reader quoted the false face four days later.

**Ruling 3 — the engine does not render the board, it copies one.** The board
is a layer above the engine and consumes what the engine emits. An engine that
invoked `wringer-board` would be the seam dissolving from the other side. So
`wring deliver` copies `<root>/board.html` — where `wringer-drive` writes it
and where `INSTALL.md` tells every operator to put it — or copies nothing and
says which. **Absence is absence**: a delivery carrying no page must not read
like one that did.

**Ruling 4 — everything is scrubbed on the way in.** Most of all the board
page: it renders a failing card's gate stderr, so a page copied unredacted
would walk a credential out of the very bundle that redacted it.

**Ruling 5 — written on a dry run too.** The whole point of the dry run is
that a person reads what would be handed over before it is. A document that
appeared only on `--send` would be the one artifact nobody could review first.

**Ruling 6 — no certificate without a spec.** A repository that never ran
`wring spec` declared no requirements, and a certificate over none of them
would assert that nothing was asked for. It is not written, rather than
written empty.

---

## §3 The face grows; the record does not

`wringer.certificate.v1` carries exactly the facts this version earns. There
are **no empty keys held open** for facts a later slice might add: a key
present and null is a claim that the question was asked and came back empty,
which is the absence-as-verdict failure this project exists to refuse.

A later fact — a coverage number, a falsification result — rides its OWN
sibling record, and the face renders it where it finds it. The face is
designed as a rendering that may grow; the record is designed to be complete
about what it holds.

**Ruling 7 — the plain words ride IN the record.** `says` and `means` are
fields, not a renderer's private table, so a second surface rendering the same
row cannot come to describe it differently. The record's `state` enum is
untouched and stays the machine's handle.

**Ruling 8 — a `(state, cause)` with no wording REFUSES to translate.** It
renders an explicit "this document has no wording for this" rather than the
nearest phrase. A wrong plain-English label is worse than a machine word,
because it reads as though somebody checked. The board makes the same refusal
with its UNTRANSLATED chip, for the same reason.

**Ruling 9 — a settled human row is decided by the ANSWER, not by the cause.**
`cause` is v3-only, so a v1 or v2 record carries a `human` row with no cause
AND no judgement. Keying the wording on the cause alone made `(human, None)`
mean "a person said yes", which would print an invented verdict over a row
nobody had ever answered — in the one place this document exists to show a
person's actual answer. Found by the guard, not by review.

---

## §4 Checking it offline — the stranger's command

`wring audit certificate.json`, against the clone the reader is standing in.
No network, no model, no config, no account. **An argument SHAPE, not a
twentieth command**: the core is at its nineteen-command ceiling, and `audit`
already answers this question for two other artifacts.

Four families of claim, one line each:

1. **The counts match the rows below them.** The cheapest forgery there is,
   and the only claim checkable with nothing but the document.
2. **The requirements listed are the ones the clone's spec declares**, in
   order — plus whether the spec's bytes have moved since. The strongest check
   here and it needs no evidence bundle at all: a certificate naming
   requirements the spec does not contain is the forgery worth catching.
3. **The commit named is an object in this clone.**
4. **Per receipt**, through `health.gate_runs` — the same reader `accept` used
   to write the receipt. A second implementation could disagree with the
   engine about whether a run shows a check failing.

**Ruling 10 — three outcomes, and the third is not a hedge.** `holds`,
`broken`, and `not-checkable-here`. A claim whose evidence did not travel HAS
NOT BEEN CHECKED, and reporting it as either of the other two would be a lie
in one of the two directions — the same reason `demonstrated_able_to_fail` is
three-valued rather than two. `ok` is false only on `broken`: an ordinary
handover carries no run bundles at all, and a document that read as broken in
the normal case would teach its readers that red means nothing.

**Ruling 11 — "there is no repository here" is not "this commit is
fabricated".** The first draft reported them identically, so a certificate
read beside a bare checkout came back ✗ on a claim nobody could have checked.

**Ruling 12 — author-blind, and it is a property to TEST.** The check never
reads who wrote the branch, which agent produced it, or whose name is on the
judgement: not the commit author, not the committer, not `judgement.by`. A
verification whose answer moves when the author changes is a verification of
the author. `test_certificate.py` moves every name and asserts the outcomes
are identical, claim for claim; a second guard greps the checking half of the
module for the identity fields that exist to be read.

**Ruling 13 (2026-09-02) — one portable command: `wring audit --delivery
<dir>`.** Runs 4 and 4B (2026-09-01) each printed a multi-step audit
instruction in `mr.md` and each failed as printed — no copy step, then no
checkout, so the clone stood on `main` and claim 2 read the wrong spec and
came back `−`. Three steps a reader performs by hand are three places to be
wrong. The flag takes the delivery directory itself, copied anywhere: it
reads the delivery's own `manifest.json` for the delivered commit, adds a
read-only detached worktree at that commit (`fleet.make_worktree`, the
machinery falsify's committed-range mode already uses), checks every claim
against THAT tree's spec plus the receipts and coverage the delivery
carries, and removes the worktree in `finally`. The operator's checkout is
never switched and never written. A commit this repository does not have is
a REFUSAL — one sentence, exit 2, naming `git fetch <remote> <branch>` from
the manifest as a command — and never a `−` on every claim, which read as
"the document is fine, the auditor is not". A delivery that was never sent
(no commit in its manifest) refuses too, naming the positional form. The
positional form (`wring audit certificate.json`, against the clone the reader
stands in) is unchanged; both forms quote ONE renderer, and the claim
ceiling above is untouched — a worktree proves the cited records are intact
and consistent with the delivered tree, not that the pack was honest before
first handover. `mr.md` prints exactly the one command with the fetch beside
it, and `test_deliver.py` executes both as printed from a fresh clone,
asserting the clone is still on `main` and no worktree remains; a second
test constructs the missing-commit refusal and then runs the fetch it
printed. A zipped delivery is a later rider.

---

## §5 The claim ceiling, ON the document

`limits` is the acceptance record's own ceiling PLUS this document's, never
fewer — a shorter list on the more portable artifact would be the ceiling
quietly falling as the claim travels further.

The face renders **this document's own ceiling first, in its own plain
English**, and the record's verbatim underneath it, attributed. The record's
sentences are the engine's careful words about its own limits and rewriting
them would be a second copy that could drift; opening the section with them
would open the part a reader most needs in the exact vocabulary G1 is about.

The sentence this whole slice most needs to carry:

> This says what the record holds. It does not say the requirements were the
> right ones, and it cannot: somebody wrote them, and a change can satisfy
> every word of a requirement that describes the wrong thing.

---

## §6 Out of scope, deliberately

- **The coverage NUMBER as a first-class metric** — that is its own carrier.
- **Falsification** — its own carrier.
- **Signing.** Nothing here is signed, for the reason `SPEC_PROVENANCE_V0 §5
  ruling 1` already gives: signing would force a key into CI, and never
  touching a credential is the product's most distinctive promise.
- **Any new verb.** `audit` grew an argument shape.

## §7 Acceptance

G1–G4 above, each with a test named for the gap rather than for the function
it calls, plus:

- **G5**: nothing on the page needs the machine that ran it — the face names
  a RUN, never a path into somebody else's `.wringer/`.
- The delivery carries all three files and `mr.md` names them.
- Every page stating the old, broader sentence carries a dated amendment; the
  guard over those pages asserts the SENTENCE and not vocabulary near it, and
  not a dated marker, because both of those classes were measured passing
  with the fix removed on this repository's previous doc guard.
