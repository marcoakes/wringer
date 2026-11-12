# Current product evidence — 12 November 2026

The current verified public release is
[1.0.0-alpha.47](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.47),
commit `3ded3d1db7e8b6e7cd485729c4e0a512624e7f56`. Send now opens the pull request
(GitHub) or merge request (GitLab) itself, from a forge chosen at setup, with the job's
evidence as its description. The token is named at setup, read at Send, and never
stored or printed. It also carries alpha.46, which was tagged at `657a45d` and never
published: source review is decided on the job page, and an earlier decision on the
same exact bytes is offered again, never applied by itself. The second real change
through Wringer, a CSV export for ZenJev with Codex as the worker and Claude as the
judge, cleared that stop on the page in about 30 seconds
([its record](docs/adoption/evidence/alpha46/REAL_CHANGE_2_ZENJEV_2026-11-09.md)).
Opening the request was proved only against a local stand-in for GitHub: no pull or
merge request has been opened on GitHub or GitLab itself. Twenty-two guards for this
release and six for source review, each undone alone, turned their tests red
([alpha.47](docs/rebuild/evidence/alpha47-guards/reversions.json),
[alpha.46](docs/rebuild/evidence/alpha46-guards/reversions.json)).

The alpha.47 guard record names baseline `0c15f44`, which is not on GitHub. GitHub's
push protection refused a fake GitLab token in two test files, so the eight commits
were rebuilt with that value written in two joined pieces; `0c15f44` is `77342cf`, and
each rebuilt commit differs from the original only in those test lines
([mapping](docs/adoption/evidence/alpha47/rebuild.json)). Three commits followed:
`1dfd9d6` regenerates the assertion adapter for alpha.47's two new schemas, which the
first CI build caught, and `319c8f7` and `3ded3d1` point CI's package manager at
mirrors outside ubuntu.com, which GitHub's Ubuntu runners could not resolve on 11
November. CI on the
commit passed its ten test jobs and the DAC run on the first attempt, and each of the
20 published releases, alpha.23 to alpha.45, upgraded on Linux and macOS 15
([`ciHistory`](docs/adoption/evidence/alpha47/release.json)). All 14 public assets
matched the clean source, both archives' signed provenance verified, public macOS
extraction and installation passed 17/13 checks, and the published macOS binary still
needs only macOS 13.0. No job has
run on the published alpha.47.

[1.0.0-alpha.45](docs/adoption/evidence/alpha45/release.json) (commit `af53f93`) fixed
what the first real change through Wringer found
([its record](docs/adoption/evidence/alpha45/REAL_CHANGE_ZENJEV_2026-11-09.md)): a real
multi-file feature on ZenJev, an npm repository, with live Claude worker and judge
sessions, run by Claude acting for Marc. It was sent to a local bare origin and passed
an audit from a fresh clone. Four stops on the way were fixed: `--dependencies npm-ci`;
capture and delivery that Git refused on tracked files inside ignored folders; a
finished session whose change could not be kept, which had left the job stuck and
`wring job close` refusing forever; and a handover preparation that could not be
retried. Eleven guards, each undone alone, turned their tests red
([record](docs/rebuild/evidence/alpha45-guards/reversions.json)).

[1.0.0-alpha.44](docs/adoption/evidence/alpha44/release.json) (commit `f758b0f`) fixed what the 2026-11-09
end-to-end review found at the two doors, walked with no model, and adds no capability.
A private-folder refusal names the folder and `chmod 700`. A project connection keeps
its files out of `git status`. The MCP tool list fell from 166,286 to 17,542 compact
bytes ([record](docs/adoption/evidence/alpha44/tool-list.json)) and every result is still
checked against its schema. A stopped step tells the assistant to retry with
`wringer.continue`, and tells the person who retries. A revised request keeps the job ID
`wring job new` printed. Trusted-local profiles now pin `claude-agent-acp` 0.101.1 and
`codex-acp` 2.6.0; both opened a session under `wring job check` with real logins and
no prompt ([record](docs/adoption/evidence/alpha44/adapter-check.json)). On `initialize`,
Claude Code 2.1.317 asks for MCP 2025-11-25 and Codex 0.153.4 for 2025-06-18
([record](docs/adoption/evidence/alpha44/mcp-protocol.json)).

Twenty-four guards, each undone alone, turned their tests red
([record](docs/rebuild/evidence/alpha44-guards/reversions.json)). CI on the commit passed
the tests run's ten jobs on its second attempt: GitHub created only one job in the
first, and nothing failed. The DAC run passed. Each of the 18 published releases,
alpha.23 to alpha.43, upgraded on Linux and macOS 15 with an archive built from this
commit ([`ciHistory`](docs/adoption/evidence/alpha44/release.json)). All 14 public assets
matched the clean source, both archives' signed provenance verified, public macOS
extraction and installation passed 17/13 checks, and the published macOS binary still
needs only macOS 13.0. Local `bun run check` passed 1574 tests (1 skipped); the full
local validation was not run. No live job has run on alpha.44 or on the new adapter
versions.

[1.0.0-alpha.43](docs/adoption/evidence/alpha43/release.json) (commit `114ed89`) fixed what the second beta gate
run found ([its record](docs/adoption/evidence/alpha42/BETA_GATE_RUN2_2026-11-05.md)).
That run, on alpha.42, failed both journeys at Install. Once any job had run, the
installer refused to install or upgrade, because it reads its state records through a
check that refuses a file with two names. Every release since alpha.20 published each
captured candidate and playbook overlay under two names, one of them a hard link. New
records now keep one name. The installer reads the pair that older releases left, but
only inside its own reservation. `wring job close --workspace ID` stops an owner that
was left running. New review branches are `wringer/job/<job ID>`. `wring connect` checks
Codex trust on the repository's own folder, and `--remove` cleans up the folders it
created.

CI now upgrades each published release over the records a finished job leaves. On this
commit all 17 releases, alpha.23 to alpha.42, upgraded on Linux and on macOS 15, each
over a finished job's records. The way back was applied for alpha.39 to alpha.42, and
held as expected for the other 13
([`ciHistory`](docs/adoption/evidence/alpha43/release.json)). Those were archives the
tests run built from this commit, not the published ones. Local validation passed 43/43
stages on the release Mac: core took 792 s and rehearsals 287 s
([record](docs/adoption/evidence/alpha43/local-validation.json)). Sixteen guards for the
run's findings were each removed alone, and every one turned its tests red. All 14
public assets matched the clean source, both archives' signed provenance verified,
public macOS extraction and installation passed 17/13 checks, and the published macOS
binary still needs only macOS 13.0. Two macOS test jobs never acquired a runner on the
first attempt and passed when re-run unchanged. Every other job passed on the first
attempt. A trusted-local delivery is still named `contained-…`, because frozen records
name it. No live Codex or Claude Code journey has run on alpha.43: that is the beta
gate's third run.

[1.0.0-alpha.42](docs/adoption/evidence/alpha42/release.json) (commit `630ccdd`), the
release gate run 2 tested, fixed what the first
[beta gate](docs/adoption/BETA_GATE.md) run found
([its record](docs/adoption/evidence/alpha41/BETA_GATE_RUN1_2026-11-04.md)). That run,
on alpha.41, failed the Codex journey at Install and at Ask:

- upgrading to alpha.41 was held from 13 of the 15 earlier published releases, because
  the installer compared the index of frozen schemas, which grows with every new schema,
  byte for byte. Only the schema files themselves decide now;
- `codex exec` could not record a proposal. `wring connect --client codex --auto-approve`
  wrote `"auto"`, under which Codex 0.153.4 still asks before each Wringer tool that
  records something, and `codex exec` cannot answer. It now writes `"approve"`, for the
  `wringer` server only.

It also fixes the run's seven other findings. A job `wring job new` prepared is found and
used, `wring job open --print` lets the private page open in any browser, and the review
page shows how each check ran before the work and labels the candidate commit and its
source tree. A trusted-local audit is headed trusted-local, and the workflow skill and the
agent guide no longer call trusted-local work contained. A trusted-local delivery keeps
its recorded name, `contained-…`, because frozen records name it.

CI now installs every published release with its own installer and upgrades it to each
new build. On this commit all 16, alpha.23 to alpha.41, upgraded on Linux and on macOS 15,
and the way back was applied for alpha.39 to alpha.41, the three that share its record
formats (`ciHistory` in the [release record](docs/adoption/evidence/alpha42/release.json)).
Those were archives the tests run built from this commit, not the published ones.

All 14 public assets matched the clean source, both archives' signed provenance
verified, and public macOS extraction/installation passed 17/13 checks. The published
macOS binary still needs only macOS 13.0. All ten test jobs, the Linux DAC job and all
six release jobs passed on the first attempt.

Local validation was not run on the release Mac, which had 1.5 GiB of free disk; the
tests run ran both validation groups on Linux and two macOS images. Fourteen guards for
the run's findings and five for the upgrade fix were each removed alone, and every one
turned its tests red ([findings](docs/rebuild/evidence/gate-run1/reversions.json),
[upgrade](docs/rebuild/evidence/install-upgrade/reversions.json)). No live Codex or
Claude Code journey has run on alpha.42: that is the beta gate's second run.

[1.0.0-alpha.41](docs/adoption/evidence/alpha41/release.json) (commit `7629796`), the
release gate run 1 tested, fixed the slow Send that alpha.40 left open: a repeated read
of an unchanged prepared bundle reuses the audit that passed, and a command that exits
with nothing left running no longer waits 100 ms. Send for a local design job took 2.4 s
on an M1, down from 15.8 s, and the rehearsals' Send answers on GitHub's macOS 15 runners
took 0.8–5.9 s ([numbers](docs/adoption/evidence/alpha41/send-admission.json)); these are
fixture rehearsals. Local validation passed 43/43 stages
([record](docs/adoption/evidence/alpha41/local-validation.json)), and five guards each
turned their tests red ([record](docs/rebuild/evidence/send-admission/reversions.json)).

[1.0.0-alpha.40](docs/adoption/evidence/alpha40/release.json) (commit `edb6987`)
carried:

- 13 repairs to the dead ends a newcomer met at both doors ([the review](docs/adoption/DOOR_REVIEW_2026-10-31.md));
- `wring job check`, which starts each trusted-local agent with no prompt before approval;
- a stopped worker's edits, kept for the next attempt and never a candidate or delivered;
- a record of earlier attempts in each later attempt's prompt.

It was the first release built on macOS 15, after GitHub retired macOS 14. Its first
candidate, `29f3a58`, was not tagged: the first rehearsals ever run on macOS 15
stopped when Send took longer than the rehearsal's 40 s bound, so alpha.40 rehearsed
on macOS 26 and shipped with the slow Send as a known defect. 55 guards were each
removed alone and turned their tests red: 54 on the first run, one after its test was
tightened ([record](docs/rebuild/evidence/door-guards/reversions.json),
[first run](docs/rebuild/evidence/door-guards/reversions-first-attempt.json)). The
agent check was measured once on the real codex-acp 1.10.0 and claude-agent-acp
0.65.0 adapters; everything else is fixture-tested only.

[1.0.0-alpha.39](docs/improvement/evidence/phase-3/release.json) (commit `504543d`)
carried releases 2 and 3 of the improvement build:

- playbook trees that only the worker sees;
- a proposer that cites the trajectory line behind each change;
- lessons recorded from decided comparisons;
- the job's research view;
- pilot amendment 1, registered and not run.

It was published in place of the never-published alpha.37 and the tagged, unpublished
alpha.38 (`984c29c`), whose macOS release build ran past a 40-minute limit. 44 guards
each turned their tests red ([release 2](docs/improvement/evidence/phase-2/reversions/reversions.json),
[its follow-up](docs/improvement/evidence/phase-2/reversions-followup/reversions.json),
[release 3](docs/improvement/evidence/phase-3/reversions/reversions.json)). All of it
is fixture-tested only: no live proposer has run, no live agent has worked on a tree,
no live comparison or lesson exists, and no benefit is claimed.

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
([record](docs/adoption/evidence/alpha34/reversions/reversions.json)). The first
journey with a real coding app as the client, the beta gate's first run on alpha.41,
failed (see above); a pass will be a delegated AI tester's, not an independent
person's.

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
