# Threat model

*One page, beside [SECURITY.md](SECURITY.md) rather than instead of it.
SECURITY.md states the execution boundary and the authority model in full; this
page names the five adversaries this program was built against and points at the
machinery that answers each. Where the two disagree, SECURITY.md wins.*

**The vocabulary is the programme's own and is used strictly.** `prevented`
means *the thing cannot be done*; `detected` means it can be done and will be
found afterwards, with a receipt. Most rows below are **detected**, because
detection-with-a-receipt is what this tool does — and a `prevented` written
where the truth is `detected` is the exact overclaim the product exists to
catch.

**The ceiling on every claim here**, which no artifact in this repository may
exceed ([`accept.py:107-112`](src/wringer/accept.py),
[README.md](README.md)): *a witness proves the stated criterion could fail and
was made to pass; it does not certify agreement with an unstated intended fix,
and where the criterion under-describes the intent, the witness inherits that
gap.* Nothing here catches wrong fixes, catches bad code, or certifies intent.

---

## 1. The careless agent — produces a change that does not do what was asked

**Machinery.** `proves:` binds a gate to an acceptance criterion, and a
criterion reads `evidenced` only when its bound gate passed in *this* run and
the record shows that gate can fail ([`accept.py:8-16`](src/wringer/accept.py)).
Criteria no check can settle are declared `human: true`, and nothing in the
program scores one ([`accept.py:30-32`](src/wringer/accept.py)). Delivery
refuses a bundle whose gates passed while a required bound criterion is not
evidenced ([`deliver.py:585-606`](src/wringer/deliver.py)). For net-new work a
criterion becomes a proposed gate, a human installs it, and it must be caught
red before anyone builds ([docs/specs/SPEC_GATEGEN_V0.md §Positioning](docs/specs/SPEC_GATEGEN_V0.md)).

**Classification: OUT OF SCOPE.** A change that satisfies every declared check
and still is not what was wanted is not distinguishable *from the criterion* —
the ceiling above says so, and it was measured: across two corpus runs
`wring deliver` said yes on **26 of 26** supervised rows, *including all six
whose change fails upstream's held-out tests*
([docs/corpus-2026-08-13.md:32-33](docs/corpus-2026-08-13.md)).

**What it does not do.** It does not read intent. A declared gate that already
discriminates catches a careless change and refuses the delivery
([`deliver.py:679-681`](src/wringer/deliver.py)) — that narrow case is detected,
and it is the only part of this adversary the machinery reaches.

## 2. The reward-hacking agent — makes the check pass without doing the work

**Machinery.** `wring verify --prove` re-runs the declared gates on a scratch
worktree at HEAD; every required gate passing on **both** trees is the verdict
`gates_vacuous` ([docs/specs/SPEC_VACUITY_V0.md §1](docs/specs/SPEC_VACUITY_V0.md)). It is switched on
by `.wringer.yaml` (`run.prove: true`) and a flag may only tighten it — there is
deliberately no `--no-prove`, because *the audited party does not get to choose
whether the audit runs*, and that invoker is increasingly the agent itself
([§3a](docs/specs/SPEC_VACUITY_V0.md)). Delivery refuses a `gates_vacuous` bundle and there
is no `--allow-vacuous` ([§3b](docs/specs/SPEC_VACUITY_V0.md);
[`deliver.py:468-487`](src/wringer/deliver.py)). The **born-green gate**: a
criterion whose bound gate passed while nothing in the record shows it can fail
reads UNEVIDENCED — *a gate born green evidences nothing*
([`accept.py:530-538`](src/wringer/accept.py)) — and the gate must pre-date the
change it judges ([`accept.py:540`](src/wringer/accept.py)). **Bench ruling 6**
refuses to rank at all — no winner, no score, no ordering field in any schema of
that slice — because an agent that "fixes" a planted failure by rewriting the
failing test into a tautology produces green gates *faster* than an honest fix,
so an auto-ranked bench would systematically reward reward-hacking
([docs/specs/SPEC_BENCH_V0.md §5 ruling 6](docs/specs/SPEC_BENCH_V0.md)).

**Classification: DETECTED.**

**What it does not do.** `--prove` cannot see a test that was **neutered** —
delete a failing assertion and the gate genuinely does fail at HEAD, so the
verdict is `proven` for the wrong reason; catching it needs reverse-patching,
which §1 rules out by name ([docs/specs/SPEC_VACUITY_V0.md §5a](docs/specs/SPEC_VACUITY_V0.md), pinned
by `test_prove_cannot_see_a_neutered_failing_test`). A worker is free to run
`git commit`, after which the pre-change tree is one the agent moved
([docs/specs/SPEC_BENCH_V0.md §5 ruling 6](docs/specs/SPEC_BENCH_V0.md)). And `gates_vacuous` is a
**whole-set** verdict: one insensitive gate beside a sensitive one reads
`proven` and delivers ([docs/specs/SPEC_HEALTH_V0.md §2](docs/specs/SPEC_HEALTH_V0.md)).

## 3. The narrowing check — a gate that silently stops being able to fail

**Machinery.** `wring health` reads the bundles your runs already wrote and
answers, per gate, whether there is any evidence this check can still fail
([docs/specs/SPEC_HEALTH_V0.md §Positioning](docs/specs/SPEC_HEALTH_V0.md)). Four verdicts — `alive`,
`zombie`, `untested`, `retired` — computed over the newest `WINDOW` qualifying
runs, so one ancient failure cannot keep a gate alive forever
([§2](docs/specs/SPEC_HEALTH_V0.md); [`health.py:502-505`](src/wringer/health.py)).
`MIN_HISTORY` is 10 and `WINDOW` is 25 and both are **constants, not config
keys**: a tunable threshold is a knob whose only realistic use is making zombies
disappear before a release ([`health.py:495-500`](src/wringer/health.py)).
`--strict` exits 1 for a required zombie and nothing else
([`health.py:924-941`](src/wringer/health.py)). Bench-sourced bundles are read
and shown and decide nothing ([docs/specs/SPEC_HEALTH_V0.md §2](docs/specs/SPEC_HEALTH_V0.md)).

**Classification: DETECTED.**

**What it does not do.** Health never says a gate is *good*; it says what the
record shows, names the bundles it read, and counts the ones it could not.
`zombie` never means "delete this gate" — a stable codebase can keep a good gate
green for months, and the claim is only that nothing recent shows it
discriminating. Thin history renders as `untested`, never as health. It inherits
vacuity §5a's blind spot whole and says so in its own `limits`
([docs/specs/SPEC_HEALTH_V0.md §2 and header](docs/specs/SPEC_HEALTH_V0.md)).

## 4. The malicious repository or graph author — their commands, your privileges

**Machinery.** Stated rather than defended: **`.wringer.yaml` is code.**
`wring verify` executes the commands a repository declares, through a shell,
with your privileges — that is the design, and Wringer does not sandbox gates
itself and never will ([SECURITY.md §`.wringer.yaml` is code](SECURITY.md)).
The container is the answer: `execution.backend: container` runs gates with an
explicit mount, `--network none` and a name-only environment allowlist, and
`execution.json` records which backend ran (same section). A **graph adds no
execution surface**: graphs name capabilities, never commands, no `command:` key
exists in the format, and the only file that may put a command into Wringer's
mouth remains `.wringer.yaml` ([docs/specs/SPEC_GRAPH_V0.md §5 ruling 1](docs/specs/SPEC_GRAPH_V0.md));
graph state is routing data and only bundles gate, so a graph that lied in state
delivers nothing ([ruling 2](docs/specs/SPEC_GRAPH_V0.md)); a graph file may not declare
`--send` and a decision file may not carry it, because a file is not a typed
flag ([ruling 5](docs/specs/SPEC_GRAPH_V0.md)). Gate ids are validated as slugs so a config
cannot write outside the run directory, and verify refuses outside a git
repository (exit `2`) and mid-merge/rebase (exit `3`) ([SECURITY.md](SECURITY.md)).

**Classification: MITIGATED.**

**What it does not do.** The container is **not** a security boundary against a
repository you have chosen to run and actively distrust: your workspace is
mounted read-write by design, so a hostile gate can still corrupt the tree you
gave it, and container escapes exist. Wringer sets no `--user` unless a config
asks, so the privilege a gate holds inside the container is the *image's*
choice. Seven scripted reads are not an escape suite, and **there is no
`--privileged` control run for sequence G**, so nothing shows those flags are
what stopped the attacks rather than something else. Read a stranger's
`.wringer.yaml` before you run it. (All of this:
[SECURITY.md §the execution boundary](SECURITY.md).)

## 5. The stale binary — the false-green selftest

**What they do.** Produce a green log from a `wring` that is not the one under
test. Testing the wrong binary and testing no binary look identical in a passing
log.

**Machinery.** `scripts/setup-selftest.sh` runs SETUP.md's own commands rather
than a paraphrase of them; it resolves the repo's `.venv` **first** and the
`uv tool` install second, **prints which `wring` it found**, and exits `2` when
there is none ([`setup-selftest.sh:18-45`](scripts/setup-selftest.sh)). CI runs
it ([`.github/workflows/tests.yml:76`](.github/workflows/tests.yml)). Every
bundle records the version that produced it — `run.started` carries
`wringer_version` ([`verify.py:251-257`](src/wringer/verify.py)), as does
`loop.started` ([`loop.py:740-747`](src/wringer/loop.py)). The version-literal
guard **discovers** every script under `scripts/` instead of keeping a list
beside them, because `setup-selftest.sh` was not on the named list, hard-coded
`^wring 0\.2`, and failed the release that bumped to 0.3 — in CI only: the guard
against stale version literals had itself gone stale
([`tests/test_docs.py:327-338`](tests/test_docs.py)).

**Classification: DETECTED.**

**What it does not do.** Nothing in ordinary use asserts that the `wring` on
your PATH was built from the tree you are standing in. `wring doctor` names the
resolved binary and its path ([`doctor.py:117-127`](src/wringer/doctor.py)) — it
reports, it does not refuse.

---

## The worker's boundary, at SECURITY.md's strength and no stronger

`run.containment` is a **different mechanism from the gate `execution:` backend
and does not extend its rows**. Under `egress.policy: allowlist` a holder
container is started with `--cap-add NET_ADMIN`, the declared hosts are resolved
inside it, and the worker container joins that network namespace **without
`NET_ADMIN`** — the boundary is not inside the thing being bounded, which is why
the holder is a separate container at all
([docs/specs/SPEC_CONTAIN_V0.md §4](docs/specs/SPEC_CONTAIN_V0.md)). Sequence I measured it and
carries the `--privileged` control run sequence G lacks, the first in this
repository. On the macOS/podman ACP row and on the Linux/docker row, **7 of the
8 attack probes flip** against that control; the eighth is the model API, which
must not flip. The Linux/docker row shares a kernel with its host, so the macOS
VM caveat falls away **for that row and for nothing else** — every other
sequence I row is macOS and podman, and all of them say nothing about the gate
path. Do not read an ordinary container as VM-strength isolation.

Every figure in this section is quoted from SECURITY.md's coverage table.
**That table is the ledger and this page may not disagree with it** — if the
two ever differ, the sentence here is the stale one.

## Authority — and the worker holds none of it

*SECURITY.md's table is the full one, with the enforcing mechanism per row. This
is the same model cut one way: what the **worker** — the agent writing the code
— may do.*

| act | who holds it | what stands behind it | the worker |
|---|---|---|---|
| produce a change | the worker | — | **this, and only this** |
| approve a specification | a human, by editing the file | `draft()` writes `approved: false` unconditionally; no reply, flag or environment variable can set it true, and there is no `--yes`. A reply carrying `approved` is refused whole ([`spec.py:12-15`, `:675-685`](src/wringer/spec.py)) | no |
| install a gate or a criterion binding | a human, by applying a diff | `wring plan` prints the diff and stops; nothing in the program applies it ([SECURITY.md](SECURITY.md)) | no |
| call a criterion `evidenced` | nobody — it is derived | the bound gate passed now, the record shows it can fail, and the gate pre-dates the change it judges ([`accept.py:528-545`](src/wringer/accept.py)) | no |
| authorise delivery | a human, per invocation | `--send` is typed on the command line; no file may carry it ([docs/specs/SPEC_GRAPH_V0.md §5 ruling 5](docs/specs/SPEC_GRAPH_V0.md)) | no |
| write git history | `deliver.py`, and only there | five refusals, each with a test that fails without it: only on `--send`, only onto a branch it created, never the default branch, never a force push, a ledger event before each git write ([`deliver.py:1-20`](src/wringer/deliver.py)) | no |
| sign an attestation | a person typing `--sign` in CI | keyless Sigstore through a signer the user already has; Wringer holds no key, and `can_sign_here` refuses off-CI where no OIDC identity is ambient ([`sign.py:1-36`](src/wringer/sign.py)). **The signer path has been exercised only against a stub signer and has never run against live Sigstore** ([SECURITY.md](SECURITY.md)) | no |
| **rewrite evidence already on disk** | **a worker can** | nothing stops it. `digests.json`, the `prev_hash` ledger chain and `wring audit` make it **findable** ([SECURITY.md](SECURITY.md)) | **yes — the one row** |

**What the worker is handed is a path**: work given to a child is a brief file
or a bundle directory, never an inline payload
([docs/specs/SPEC_SUPERVISION_V0.md invariant 5](docs/specs/SPEC_SUPERVISION_V0.md);
[`loop.py:1-5`](src/wringer/loop.py)). `loop.py` does not import `deliver` and
never calls it; its only mentions of delivery are comments explaining why not.

**The last row is the one that matters, and it is `detected, NOT prevented`.**
Wringer's evidence is tamper-**evident**, not tamper-proof. `digests.json` is
written last and cannot cover itself, so whoever owns the disk can rewrite
everything consistently; what a chained ledger and a digest file buy is that a
silent edit becomes a detectable one, and nothing more
([`evidence.py:319-338`](src/wringer/evidence.py);
[`attest.py:60-64`](src/wringer/attest.py)). If you need prevention rather than
detection, the evidence has to leave the machine the worker runs on — and
Wringer does not do that for you.

---

*Reporting a vulnerability: [SECURITY.md](SECURITY.md) says where, and what to
expect.*
