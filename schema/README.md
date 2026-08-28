# Evidence bundle schemas — `wringer.evidence.v1`

JSON Schema (draft 2020-12) for the three machine-readable files in a
`wring verify` bundle. Published so other tools can *target* the format
rather than reverse-engineer it — the point of
[RFC #2](https://github.com/marcoakes/wringer/issues/2).

| Schema | Describes |
|---|---|
| [`manifest.schema.json`](manifest.schema.json) | `manifest.json` — the run's index |
| [`evidence-event.schema.json`](evidence-event.schema.json) | **one line** of `evidence.jsonl`, not the file |
| [`gate-result.schema.json`](gate-result.schema.json) | `gates/NNN_<id>/result.json` |
| [`loop-manifest.schema.json`](loop-manifest.schema.json) | `wringer.loop.v1` — superseded by v2 below, still published and still valid; `manifest.json` of a `wring run` loop bundle, with `reason` as a closed enum of six values |
| [`loop-manifest-v2.schema.json`](loop-manifest-v2.schema.json) | `wringer.loop.v2` — `manifest.json` of a `wring run` loop bundle. `reason` is an **open string**, so a new way for the loop to stop never costs a bundle-format version; the values the code emits are named in its description and pinned by a test |
| [`loop-event.schema.json`](loop-event.schema.json) | superseded by v2 below, still published and still valid; **one line** of a loop's `loop.jsonl` |
| [`loop-event-v2.schema.json`](loop-event-v2.schema.json) | **one line** of a loop's `loop.jsonl`, with `loop.finished.reason` open for the same reason |
| [`rubric.schema.json`](rubric.schema.json) | `wringer.rubric.v1` — the acceptance criteria `wring judge` weighs a bundle against |
| [`spec.schema.json`](spec.schema.json) | `wringer.spec.v1` — `wringer.spec.yaml`, what `wring spec` drafts and a human approves |
| [`gatespec.schema.json`](gatespec.schema.json) | `wringer.gatespec.v1` — `wringer.gates.yaml`, proposed gates and the criterion each would prove. Read by nothing that runs |
| [`decisions.schema.json`](decisions.schema.json) | `wringer.decisions.v1` — `wringer.decisions.yaml`, the plain-language companion to a spec: what was decided FOR the approver instead of asking them, the plain outcome of each task, and what they consented to. NO AUTHORITY OVER WHAT IS BUILT; its `consent` block can only make `wring plan` refuse. All three blocks are declared and optional so later producers add no bytes — at publication only `assumptions` has a writer |
| [`decisions-v2.schema.json`](decisions-v2.schema.json) | `wringer.decisions.v2` — **what `wring spec` writes now.** Adds one optional key to an assumption: `criteria`, the ids of the criteria that decision SHAPED. Only the drafter can know them, because it took the decision and wrote the criteria in the same reply. It exists because on 2026-08-21 a product manager overruled the assumption `limit-of-three` with "make it five" and the criterion derived from it — "At most three games are ever shown" — stayed in the spec AND the rubric as the thing the work would be judged against. The repository recorded the correction and the thing it contradicts, side by side, and warned about neither. With the back-reference, overruling an assumption renders those criteria STALE and `wring plan` REFUSES while one stands unreviewed — rendered, never resolved: Wringer does not re-word a requirement, because choosing the words is the person's act. v1's assumption items are `additionalProperties: false` and frozen, so this is a new file (law 7); every v1 document is a valid v2 document and both are read forever |
| [`delivery-manifest.schema.json`](delivery-manifest.schema.json) | `wringer.delivery.v1` — what a verified change became: branch, commit, push, MR |
| [`coverage-v1.schema.json`](coverage-v1.schema.json) | `wringer.coverage.v1` — `coverage.json`, written beside `acceptance.json` and carried into a delivery: how much of what was asked for anybody is watching. **Two populations, disjoint, never blended into one number** — requirements a check could prove, and requirements only a person can settle. Half of it is a rendering of what `acceptance.json` already holds per row; the other half has no home anywhere, because `show:` is declared in the person's own `.wringer.yaml` and recorded by nothing, which is the whole reason a file exists. `covered` is null on a row needing a person and `shown` is null on every other one: null is a question nobody asked, and false is a debt somebody could pay. Absent is absent — a bundle from before this file existed is not a coverage of zero |
| [`certificate-v1.schema.json`](certificate-v1.schema.json) | `wringer.certificate.v1` — `certificate.json`, written by `wring deliver` into the delivery beside `mr.md`: the PORTABLE form of what the run recorded, so a reviewer who never ran the machine can see every requirement by title with its state, which ones a check proves and where that check is on record failing, and who judged the ones only a person can settle — with their words. It re-assesses nothing; every row is copied from the run's `acceptance.json`. A NEW FILE and not an amendment to any published schema, which is what law 7 requires. It carries only the facts this version earns and holds no empty keys open for later ones: a key present and null is a claim that the question was asked. `wring audit` re-checks it offline — counts against rows, requirements against the clone's spec, commit against the clone, and one line per receipt — and never reads who produced the branch |
| [`acquired-manifest.schema.json`](acquired-manifest.schema.json) | `wringer.acquired.v1` — where a working copy came from |
| [`digests.schema.json`](digests.schema.json) | `wringer.digests.v1` — `digests.json`, a sha256 per file in a bundle |
| [`untracked.schema.json`](untracked.schema.json) | `wringer.untracked.v1` — superseded by v2 below, still published and still valid; a bare sha256 per *untracked* file |
| [`untracked-v2.schema.json`](untracked-v2.schema.json) | `wringer.untracked.v2` — `untracked.json`, git's *identity* (`"<mode>:<sha256>"`) per *untracked* path in the tree the gates ran against |
| [`attestation.schema.json`](attestation.schema.json) | `wringer.attestation.v1` — `attestation.json`, the provenance claim `wring attest` writes and `wring audit` checks offline |
| [`vacuity.schema.json`](vacuity.schema.json) | `wringer.vacuity.v1` — `vacuity.json`, what `wring verify --prove` found when it ran the gates against the *pre-change* tree |
| [`fleet-manifest.schema.json`](fleet-manifest.schema.json) | `wringer.fleet.v1` — `manifest.json` of a `wring fleet` bundle |
| [`fleet-event.schema.json`](fleet-event.schema.json) | **one line** of a fleet's `fleet.jsonl` |
| [`fleetscope.schema.json`](fleetscope.schema.json) | `wringer.fleetscope.v1` — `scope.json`, which criteria each task proved and which gates those resolved to. Carries the whole declared gate set, so a task's excluded gates are computable from this file alone |
| [`judge-verdict.schema.json`](judge-verdict.schema.json) | `wringer.judge.v1` — `verdict.json`, a rubric verdict over a finished bundle |
| [`judge-request.schema.json`](judge-request.schema.json) | `request.json` — exactly what `wring judge` would send, written before any socket opens |
| [`usage.schema.json`](usage.schema.json) | `wringer.usage.v1` — `usage.json`, a sibling file in a loop bundle: what the *agent* reported spending, recorded verbatim and unverified. Absent when nothing was reported, never zero |
| [`diagnosis.schema.json`](diagnosis.schema.json) | `wringer.diagnosis.v1` — `diagnosis.json`, a sibling file in a loop bundle: **a routing diagnosis, never a verdict**. Why the final failing gate *may* have failed, as one of three named faces plus the line the guess was read from. Nothing that reads it may let it reach acceptance, vacuity or health. A sibling rather than a field on the loop manifest's `result`, which is `additionalProperties: false` in the frozen `wringer.loop.v2` — law 7, and the same answer `usage.json` and `vacuity.json` gave. Absent, never null, when no face matched |
| [`worker-diagnosis.schema.json`](worker-diagnosis.schema.json) | `wringer.workerdiagnosis.v1` — `worker-diagnosis.json`, a sibling file in a loop bundle: **a routing diagnosis about the WORKER's turn, never a verdict**. Why the last worker turn may have produced nothing, read off the turn's own ledger — no file written, no refusal raised, a clean stop reason — and never off its message text (F6: route on facts, hint on text, claim on neither). Not a fourth `face` on `wringer.diagnosis.v1`, whose enum is frozen and whose required `gate` and `evidence` name a failing gate this fact does not have. Its `remedy` points at `run.worker.acp.env_passthrough` as the operator's channel and never names a variable: Wringer does not know which of a person's secrets a worker needs and must not guess. The loop's reason stays `no_progress`; only legibility changes. Absent, never null, when the last turn did something |
| [`worker-diagnosis-v3.schema.json`](worker-diagnosis-v3.schema.json) | `wringer.workerdiagnosis.v3` — **what the loop writes now.** One OPTIONAL addition over v2: `auth_state`, what the agent's own auth surface said when the stop was composed — read by `worker_auth.read` at the moment of the diagnosis, present only when the agent was asked. It exists because of field report 2026-08-27: a refused turn's description led with "the most common cause is that the coding agent is not logged in" on a machine where the login was accepted and the service refused the token, so the sentences now branch on the agent's own answer — the worker's refusal line leads, verbatim, and the not-logged-in reading appears only when the agent itself reports signed out. Every v2 record is a valid v3 record |
| [`worker-diagnosis-v2.schema.json`](worker-diagnosis-v2.schema.json) | `wringer.workerdiagnosis.v2` — **published and frozen; the loop wrote it from 0.4.1 to 0.4.9.** v1 knew one face and every turn wearing it had finished, so it required `stop_reason`, `files_written` and `refusals`. The other ending has no such ledger: on 2026-08-21 a product manager's agent REFUSED the turn, and a refused turn never reaches a stop reason at all. v1's `face` enum is closed and the file is frozen, so the enum could not be widened in place and a required field could not be relaxed — law 7, a new file. Adds `turn_refused`; makes the three ledger fields OPTIONAL, absent rather than defaulted, because a reader finding no `files_written` knows nobody counted while one finding `0` knows somebody counted and the answer was none. Every v1 record is a valid v2 record. Its `description` names AUTHENTICATION as a possibility — the hint tier may read text and may never claim, but a hint that omits the measured cause is the silence a real operator could not act on |
| [`graph-manifest.schema.json`](graph-manifest.schema.json) | `wringer.graph.v1` — `manifest.json` of a `wring graph run` bundle |
| [`graph-event.schema.json`](graph-event.schema.json) | **one line** of a graph's `graph.jsonl` |
| [`bench-manifest.schema.json`](bench-manifest.schema.json) | `wringer.bench.v1` — superseded by v2 below, still published and still valid; `manifest.json` of a `wring bench` bundle making one attempt per contender |
| [`bench-manifest-v2.schema.json`](bench-manifest-v2.schema.json) | `wringer.bench.v2` — the same, plus `attempts` / `parallel` and a per-row `attempt`, present only when a bench made more than one. Contenders in **declared order**; no rank, score or ordering field exists anywhere in the format, and repeats buy self-agreement rather than a winner |
| [`bench-event.schema.json`](bench-event.schema.json) | superseded by v2 below, still published and still valid; **one line** of a bench's `bench.jsonl` |
| [`bench-event-v2.schema.json`](bench-event-v2.schema.json) | **one line** of a bench's `bench.jsonl`, with an optional `attempt` on `contender.finished` |
| [`acceptance.schema.json`](acceptance.schema.json) | `wringer.acceptance.v1` — `acceptance.json`, a sibling file in a verify bundle: per criterion, whether the record evidences it. Present only when an **approved** `wringer.spec.yaml` declares criteria |
| [`judgements.schema.json`](judgements.schema.json) | `wringer.judgement.v1` — `wringer.judgements.yaml` at the repository root, one entry per `human: true` criterion a PERSON has answered. **A file a person edits, exactly like `approved: true`, and for the same reason: there is deliberately no flag, no `--judge` and no environment variable that writes one**, because a machine that could fill in its own answer to a question a human was asked would be the thing this project exists to answer. `verdict` is two closed values with no `partially` and no score; `by` is recorded and NEVER verified; `criterion_digest` pins the answer to the exact wording it was given against, so rewording the requirement stales every judgement of it. A sibling file because `wringer.spec.v1` is frozen and closed |
| [`gate-artifacts.schema.json`](gate-artifacts.schema.json) | `wringer.gate-artifacts.v1` — `gates/NNN_<id>/artifacts.json`, what one gate left for a PERSON to look at. A SIBLING file: `gate-result.schema.json` is closed over nine fields, `result.json` gains nothing and means nothing new, and law 7 always allows a new file. **The absence of this file is the compatibility boundary.** Per artifact: name, size, sha256, media type from a CLOSED allow-list — **no caption, no label, no meaning**, because the harness does not get to say what a picture shows. **A binary is recorded UNREDACTED** and each row says so: substring replacement changes length, so scrubbing a compressed format yields a corrupt file that still reads as evidence. Opt-in per gate, off by default. Over-cap files are OMITTED AND NAMED, never truncated |
| [`acceptance-v3.schema.json`](acceptance-v3.schema.json) | `wringer.acceptance.v3` — the same file again when a row carries something only v3 can express: a non-null `cause`, a non-null `demonstrated_able_to_fail`, or a `judgement`. v1 and v2 remain published and frozen, and a repository with none of those still writes a byte-identical v1 or v2. `cause` names WHICH of eight conditions put a row where it is, so a surface stops telling them apart by matching free text against the engine's prose; `demonstrated_able_to_fail` is three-valued because two values would have to lie; `judgement` carries a person's answer pinned to the exact wording they answered. **Authored complete on first publication** — including the `judgement` object the slice after it populates — because publishing freezes it. **The engine does not EMIT this version yet**: `accept.EMIT_V3` is False until `wringer-board` reads it, and the bytes under `schema/fixtures/` are what the board is taught from |
| [`acceptance-v2.schema.json`](acceptance-v2.schema.json) | `wringer.acceptance.v2` — the same file when the run carried a WITNESS lane. v1 is still published and still frozen, and a run with no witness writes a byte-identical v1. Two changes, both forced by one fact — a criterion can be covered by a check the repository does not declare: `receipt.kind` gains `witness`, and `gate` may be null on a row that still **refuses**, which in v1 was impossible. The `state` vocabulary is unchanged; no new verdict word exists |
| [`refusal.schema.json`](refusal.schema.json) | `wringer.refusal.v1` — `refusal.json`, one file per **refused** delivery attempt, under `.wringer/refusals/<id>/` and never under `.wringer/deliveries/` (an entry there is what `wring attest` takes as its anchor, so a refusal record in that root would silently disable attestation until the next success). Carries the machine-readable `reason` — one of `deliver.REFUSAL_REASONS` — beside the prose message **verbatim**, because a name is for machines and the sentence is what tells a person what to do. Written from the one `except Refused` on each entry path, never from the 23 raise sites. It records that a refusal happened; it changes no refusal, no exit code and no condition, and a failure to write it is printed rather than allowed to convert a refusal into anything else |
| [`witness.schema.json`](witness.schema.json) | `wringer.witness.v1` — `witness.json`, a sibling file in a loop bundle: the check **Wringer itself authored** for each criterion, proved red on the pre-change tree before any work existed, and digest-pinned over its bytes, its command and its materialisation path. A sibling rather than a ledger event for the reason `vacuity.json` is one: `wringer.loop.v2`'s `type` is a closed enum, so an event would make every bundle carrying this lane fail its own published schema. Absent from every run with no witness lane. **The ceiling on what it may be read as:** a witness proves the stated criterion could fail and was made to pass — it does not certify agreement with an unstated intended fix |
| [`health-report.schema.json`](health-report.schema.json) | `wringer.health.v1` — `wring health --json`. The one schema here that describes a **derived view rather than a bundle**: nothing is written under `.wringer/`, the bundles it read are the evidence, and the same bundles plus the same `.wringer.yaml` produce the same bytes |
| [`checks.schema.json`](checks.schema.json) | `wringer.checks.v1` — `checks.json`, what each declared gate's CHECK was when the bundle was written: the command, its hash, and the hash of any file the command NAMES. **The second sibling written on every run**, because the anchor has to exist before anybody knows they will need it. Comparing it against the bundle a receipt cites answers *is this the check that went red?* — a NOTE in v0, never a refusal |
| [`execution.schema.json`](execution.schema.json) | `wringer.execution.v1` — `execution.json`, where a bundle's gates actually ran. **The one sibling written on every run**, opt-in or not: a reader who is not told supplies the flattering answer. `trusted_local` is never spelled `sandboxed` |
| [`execution-v2.schema.json`](execution-v2.schema.json) | `wringer.execution.v2` — the same file when, and only when, `run.containment` is declared. `worker_execution` becomes an object with `declared` (repository policy, always present) and `established` (what this lap actually stood up, **absent when it stood up nothing**). Every other run stays on v1, byte-identical; the absence of a v2 record is the compatibility boundary |
| [`concurrency.schema.json`](concurrency.schema.json) | `wringer.concurrency.v1` — `concurrency.json`, which gates ran BESIDE which. Present only when a repo declared `concurrent: true` and a group of more than one actually ran. Exists because `duration_ms` is not private to a run: health excludes these rows from its drift trend, and counts the exclusion |
| [`stability.schema.json`](stability.schema.json) | `wringer.stability.v1` — `stability.json`, a sibling file in a verify bundle: every attempt every gate that declared `stability:` made, and whether they add up to `stable_pass`, `stable_fail`, `flaky` or `unknown`. Present only when a gate declared a policy |
| [`briefed.schema.json`](briefed.schema.json) | `wringer.briefed.v1` — `briefed.json`, a sibling file in a **loop** bundle: the digests of the spec, the rubric and `.wringer.yaml` as they were BEFORE the first worker turn. A mismatch at an iteration boundary stops the loop `authority_moved` and refuses delivery — after landing, never in flight, and nothing is reverted. Absent from every loop bundle written before it existed |

The loop schemas carry their own version, now **`wringer.loop.v2`**, moving
independently of the evidence bundle: a loop *references* the runs it drove
(`evidence_dir`) rather than containing them, so the two formats can change
without dragging each other along. `loop.SCHEMA_VERSIONS` is the derived list
of versions every reader accepts, and a v1 bundle already on disk is read by
everything that read it before — a version bump that orphans existing evidence
is not a bump, it is a deletion.

`summary.md`, `diff.patch` and `status.txt` have no schema: they are for
people, and machines should read the three files above instead.

**`response.json` has no schema either, and that is a decision rather than
an omission.** It holds whatever the judge's endpoint returned — an
arbitrary JSON body from a service this project does not control. A schema
for it could only be permissive enough to guarantee nothing, and a
guarantee that means nothing is exactly what the rest of these files exist
to avoid. What Wringer *sends* is schematised, because that is the part
Wringer is answerable for.

## Absence is meaningful

Several keys appear only in the case they describe, and a reader must treat
"absent" as information rather than as "unknown":

- **`untracked`** on `git.status` — present only when something is untracked,
  so the common case keeps the shape the spec published.
- **`log`** on `gate.finished` — present only for a failing gate. It points
  at where a reader is being sent; it is not an inventory. Every gate's logs
  are on disk regardless.
- **`truncated`** on `gate.finished` — present only when `true`. Absent means
  the logs are whole.
- **`failed_gate`** on `run.finished` — present only when a required gate
  failed.

In a loop, the same convention holds: **`failed_gate`** on `verify.finished`
and **`timed_out`** on `worker.finished` appear only in the case they name.

Two absences carry more weight than any field:

- **A `gate.started` with no matching `gate.finished`** means the run was
  interrupted while that gate was running. No verdict is invented for it, and
  it gets no `result.json` — though its directory and logs may exist, holding
  whatever it printed before it was killed.
- **A gate that was skipped leaves nothing at all** — no event, no directory.
  It did not run, so the bundle says nothing about it. `summary.md` is the one
  place the full declared set appears.
- **A `worker.started` with no `worker.finished`** is the same story one level
  up: the loop was interrupted while the worker was running.

## What 0.2.0 freezes

`wringer.evidence.v1` has been frozen since 0.1.0. **At the 0.2.0 tag these
join it**, and become as immutable as it is:

`wringer.loop.v1` · `wringer.fleet.v1` · `wringer.judge.v1` ·
`wringer.rubric.v1` · `wringer.spec.v1` · `wringer.delivery.v1` ·
`wringer.acquired.v1` · `wringer.digests.v1`

Until that tag they are amendable in place on `main`, and every amendment is
named in its commit message. After it, a new field costs a version.

**`wringer.fleet.v1` and `wringer.judge.v1` had no schema FILE until
2026-08-05**, which made their freeze a promise nobody could check — the
shape this repository keeps finding in itself. They are published now, and
they describe what 0.2.0 writes rather than what would have been neater. One
wart is load-bearing: a fleet's `task.finished` carries **three disjoint key
sets** under one `type` (succeeded, failed, and exhausted-with-`on_exhausted:
fail`, which has no `status` at all). The schema models all three. Tidying
it would be amending a frozen format, and the difference between describing
and improving is the whole of law 7.

One correction is worth recording, because it is exactly what this rule
exists to prevent. During 0.2 development `prev_hash` was added to every
evidence event **and marked `required`** in the published schema, with the
version string left at `wringer.evidence.v1`. Two incompatible formats then
claimed one version, and this repo's own committed demo bundle — produced by
0.1.0, the receipt the README points at — failed the schema the repo
publishes. The fix was not a version bump but to stop requiring, in v1, a
field v1 never had. A test now validates `.wringer.example/` on every run;
its absence is why nobody noticed.

## Stability

`schema_version` in `manifest.json` is `wringer.evidence.v1`. These schemas
are strict — `additionalProperties` is `false` — because the version string
is what a new field is supposed to cost. Adding one is a spec change and
bumps the version; it is not an implementation detail.

**The freeze is enforced, not promised.** `frozen.json` records the sha256
of every published schema — the ten from the `v0.2.0` tag captured from the
tag itself, and each later one captured when it was published.
`tests/test_schema.py` fails if any changes a byte or disappears, and it
also fails if a schema is published *without* joining the freeze: a
published format nobody promised to keep is worse than an unpublished one.
Adding a new schema file is always allowed and is how a new format arrives;
editing a frozen one is not, because every bundle already written was
written against it.

**`wringer.untracked.v1` is the first format this rule has retired**, and it
is worth reading as the worked example. v1 recorded a bare sha256 of the
bytes `open("rb")` returned for each untracked path — which follows a
symlink, so it described what the *gates could read* rather than what *git
would commit*, and those are different objects. Fixing it meant changing what
the digests mean, which is exactly the change `additionalProperties` and a
version string exist to price. So `untracked-v2.schema.json` is a new file
carrying `wringer.untracked.v2`, `untracked.schema.json` is untouched and
stays frozen, and anything that read a v1 bundle still reads it. `wring
deliver` treats a v1 record the way it treats a bundle written before the
file existed: names compared, bytes not. The alternative — editing v1's
digest pattern so the new values fit — would have been a silent
reinterpretation of every digest in every existing bundle, which is the one
thing law 7 forbids.

## Targeting these formats

They are published so a tool can target the format rather than
reverse-engineer it, and they belong to nobody — that is the point. If you
are building against one and something is ambiguous, wrong, or missing, an
issue on this repository is the right place, and the format changing
because an outside consumer hit a wall is a good outcome rather than an
embarrassing one.

There is deliberately no formal RFC process yet. A standard needs
constituents before it needs ceremony, and inviting comment into an empty
room spends the one occasion when "here is our format, tell us what is
wrong with it" is a real question.

## How these stay true

[`tests/test_schema.py`](../tests/test_schema.py) runs real verifications —
a failing run with a truncated log and an untracked file, and an interrupted
run — and checks every object produced against the schema that claims to
describe it. If the code grows a field the schema does not declare, the suite
fails. That check is deliberately dependency-free (it compares declared
property names against written keys) so the repo keeps its "PyYAML and
nothing else" rule.

The same file also runs a real JSON Schema engine (`jsonschema`, draft
2020-12) over passing, failing and interrupted bundles, which is what catches
a schema that is itself malformed or a value that breaks a pattern. That
engine is a **dev-only** dependency — the runtime install is still PyYAML and
nothing else — and it does run in CI.

The rubric and the spec are not evidence; they are source, committed and
hand-edited. Their schemas are published for the same reason as the others: so
a tool can target the format instead of reverse-engineering it. Two fields in
them carry a safety meaning rather than a shape:

- **`human: true`** on a criterion — it is never sent to a judge, and comes
  back unscored rather than guessed at.
- **`approved`** on a spec — the interlock. `wring plan` refuses while it is
  false, it is required rather than defaulted so omission is not consent, and
  nothing but a person editing the file may set it. A tool that writes a spec
  and sets this true has not implemented the format; it has removed the only
  thing the format is for.
