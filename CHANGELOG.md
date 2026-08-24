# Changelog

Notable changes, newest first. Wringer follows [semantic
versioning](https://semver.org/); schema versions move independently of the
package version and are listed per release.

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
