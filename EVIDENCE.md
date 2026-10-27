# Current product evidence — 27 October 2026

The current verified public release is
[1.0.0-alpha.39](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.39),
commit `504543dff57cc924b1602d1f27f17123087c6d02`. It carries releases 2 and 3 of the
improvement build:

- playbook trees that only the worker sees;
- a proposer that cites the trajectory line behind each change;
- lessons recorded from decided comparisons;
- the job's research view;
- pilot amendment 1, registered and not run.

All 14 public assets matched the clean source, both archives' signed provenance
verified, and public macOS extraction/installation passed 17/13 checks. The Linux DAC
job and all six release jobs passed on the first attempt.

The test run's first attempt failed on two jobs, neither caused by the commit:

- a macOS 14 runner GitHub never supplied;
- a headless-Chromium hang inside the rehearsal's own capture helper.

Both passed when re-run unchanged. The diagnosis is in the release record's `ciHistory`.

Local validation passed 43/43 stages in a fresh clone of each release's candidate
([release 2](docs/improvement/evidence/phase-2/local-validation.json),
[release 3](docs/improvement/evidence/phase-3/local-validation.json)). 44 guards were
each removed alone, and every one turned its tests red: 43 on the first run, one after
its test was tightened ([release 2](docs/improvement/evidence/phase-2/reversions/reversions.json),
[its follow-up](docs/improvement/evidence/phase-2/reversions-followup/reversions.json),
[release 3](docs/improvement/evidence/phase-3/reversions/reversions.json)). See the
[release record](docs/improvement/evidence/phase-3/release.json).

Neither release was published under its own number:

- Alpha.37's CI stopped on time limits and then on a stale budget test.
- `v1.0.0-alpha.38` (`984c29c`) is tagged and unpublished. Its macOS release build ran
  past the release workflow's 40-minute limit.

Alpha.39 differs from that tag only in version strings, a 60-minute limit for the
release build, and a test that keeps release limits in step with the test workflow's.

All of it is fixture-tested only. No live proposer has run, no live agent has worked
on a tree, no live comparison or lesson exists, and no benefit is claimed.

[1.0.0-alpha.36](docs/improvement/evidence/phase-1/release.json) (commit `ade95ae`)
added loop trajectories and replicate sets. Trajectories read the fields each pinned
adapter was measured to carry, from one live trusted-local session per adapter
([measurements](docs/improvement/PHASE_A_MEASUREMENTS.md)). Beyond that, both are
fixture-tested only.

[1.0.0-alpha.35](docs/adoption/evidence/alpha35/release.json) (commit `e23b778`)
made `wring connect` refuse a Codex project entry that Codex would not use.

[1.0.0-alpha.34](docs/adoption/evidence/alpha34/release.json) (commit
`7c57cf1`) added delegation on this computer (the explicit trusted-local runtime)
and connection recipes for eight named MCP clients. In its release workflow the
Linux build failed once on a test race, passed when that job alone was re-run
unchanged, and the race was fixed in alpha.35.

Trusted-local is fixture-tested end to end and was rehearsed from source with the
real Codex adapter: a scripted MCP client played the agent, and Claude, as Marc's
delegated tester, approved and sent from the page. It reached a passing
fresh-clone audit and found eight defects that were fixed before release
([rehearsal record](docs/adoption/evidence/alpha34/REHEARSAL_2026-10-01.md)).
31 isolated reversions of its guards each went red
([record](docs/adoption/evidence/alpha34/reversions/reversions.json)). No journey
with a real coding app as the client has run yet; that is the
[beta gate](docs/adoption/BETA_GATE.md), and its pass will be a delegated AI
tester's, not an independent person's.

Previous release: [alpha.33](docs/restoration/evidence/phase-7/release.json),
contained graphs on a second durable runtime, Temporal, through an optional Node
adapter, tested against a local Temporal dev server only.

Earlier restoration releases: [alpha.32](docs/restoration/evidence/phase-9/release.json),
the capability ledger, showcase and registered pilot;
[alpha.31](docs/restoration/evidence/phase-8/release.json), external A2A tasks
against a local reference peer only;
[alpha.30](docs/restoration/evidence/phase-6/release.json), tournaments;
[alpha.29](docs/restoration/evidence/phase-5/release.json), gate and workflow
proposals; [alpha.28](docs/restoration/evidence/phase-4/release.json), parallel
branches, after the `v1.0.0-alpha.27` tag's release build failed on macOS 14 and
was never published; [alpha.26](docs/restoration/evidence/phase-3/release.json),
serial graphs. Every restoration phase now has a verified release. The
registered pilot has not run.
What each capability has actually shown is in the
[capability ledger](docs/CAPABILITY_LEDGER.md).

Graph execution is fixture-tested: 81 isolated reversions, a compiled public
walkthrough with two crash probes and a Node-only export check. Live agent
convergence, real containment and any benefit over a single job are unmeasured.
Follow the [execution record](docs/restoration/STATUS.md) and
[capability ledger](docs/CAPABILITIES.md).

Fixture loop control, portable audits and prediction-gated playbook experiments
are implemented. They do not establish live convergence, independent usability,
universal model improvement or a competitive performance advantage. Those need
the registered comparisons and actual observations in the
[restoration plan](docs/SOTA_RESTORATION_PLAN.md).

## Pre-publication adoption checkpoint — 28 September 2026

The following checkpoint predates alpha.23 publication. Its public-release and
native-install status is superseded by that release's attached measurements;
the original observations and unresolved live-user claims are preserved below.

This checkpoint describes an implementation candidate, not a public release or a passed live user
journey. The [rebuild ledger](docs/rebuild/STATUS.md) names exact checks and
remaining prerequisites. Exact final archive-bound measurements and the implementation report accompany
`build/rebuild-candidate/`. Earlier alpha19 artifacts do not qualify later bytes.
The final report identifies the source/binary digests for each affected check.

| Observation | State | Scope and evidence |
| --- | --- | --- |
| Source/authority/proposal/wait/recovery regressions | Measured deterministic fixtures | [Status and guard indexes](docs/rebuild/STATUS.md); isolated faults and restored controls retained |
| macOS arm64 extracted archive and owned installer | Native artifact procedure | 17 route observations and 13 installer observations; use the exact final archive report |
| Offline npm packaging/alias launch | Offline package procedure | 12 observations; exact final tarballs/report accompany the candidate; private fixture scope, no registry publish |
| Verification browser review/correction/Send | Measured scripted engineering | Real Chromium, temporary Git origin and fresh-clone audit; no real person's decision |
| Contained delegation | Unmeasured live platform | Pinned provisioning and no-model readiness procedures implemented; Apple service authorization pending; Linux/gVisor unavailable here |
| Complete Claude Code/Codex journeys | Unmeasured | [Client matrix](docs/ASSISTANT_COMPATIBILITY.md); config/parser checks are narrower evidence |
| Public release/install, Homebrew install, MCP listing | Unmeasured | Machinery staged; account, namespace, native CI and publication decisions remain |
| Independent newcomer usability | Unmeasured | Scripted clicks and owner knowledge cannot establish it |

Retained unsuccessful measurements include empty-file Node TAP appearing to pass,
stale assertion reports, concurrent schema compilation, partial owner writes,
missing npm symlink inventory, wrong intermediate npm licence metadata and lost
check/publication results. Corrections have separate red/green/reversion evidence;
the old outcomes were not rewritten. Linux DAC is a required native job, never a
macOS skip presented as Linux evidence. Missing cost is unknown.

Historical reports below retain their original dates, meaning and unsuccessful
outcomes. Their Python installation commands are not current product instructions.

---

# Historical evidence index — retired Python implementation

Archived as a historical reference during the Bun replacement (2026-09-07).
The measurements, failures and limitations below remain as recorded for their
original versions. They do not establish the behavior, live isolation or release
readiness of the current Bun product. Commands and installation advice in this
archive are not current instructions; some referenced implementation paths have
been retired from the working tree and remain in Git history.

For the current product, start with [README.md](README.md),
[installation](INSTALL.md), [the threat model](THREAT_MODEL.md), and
[the remaining release gates](ROADMAP.md).

---

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
- **One package, four executables.** This was *"four packages, two
  unpublished"* until `0.4.0` merged them, and the sentence outlived the
  merge. `pip install wringer` installs `wring`, `wringer`, `wringer-board`
  and `wringer-drive` together; there is no separate `wringer-board` or
  `wringer-drive` distribution to install, and a GitHub link to one reaches a
  tombstone that still answers 200.

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
  `docs/drive/docs/the-whole-arc.md`.
- **A loss was published.** The corpus result above was written up and kept
  rather than quietly dropped, and this file exists for the same reason.
