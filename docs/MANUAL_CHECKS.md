# Manual checks — what CI structurally cannot run

Some of this project's claims cannot be tested by any workflow, on any
runner, ever. Not "we have not got round to it": **structurally cannot**.
GitHub's macOS runners have no nested virtualization, so `container system
start` cannot work there, so the entire Apple `container` path is beyond
CI's reach by construction. The Docker-stub check (R2-02) is beyond it for a
different reason — it needs a machine with a stripped `Docker.app` to look
at, which is a state you inherit rather than create.

The honest answer to that is not to quietly assume those paths work. It is
to make the manual coverage **recorded and dated**, so anyone can see how
old the evidence is and what it actually covered.

**If you run one of these sequences, add a row.** A check nobody wrote down
is a check nobody ran — this file is subject to law 1 like everything else.

---

## Coverage record

**Last passed** — one row per host that has actually executed a sequence.

| Sequence | Host | OS | Runtime | Date | Commit | Result |
|---|---|---|---|---|---|---|
| Apple `container` | Apple silicon, MDM-managed, uid:gid `502:20` | macOS 26.5.2, `Darwin arm64` | Apple `container` 1.2.0 (Homebrew formula, Workbrew 1.7.3 / Homebrew 6.0.15) | 2026-08-05 | `75167c2` | **Passed with corrections applied by hand** — see the note below |
| Docker stub (R2-02) | Apple silicon, MDM-managed | macOS 26.5.2 | none — `/Applications/Docker.app` present as a stripped stub | 2026-08-05 | `75167c2` | **Observed, not executed as a sequence.** `d--------- 2 root admin 64`, no binary, no socket — seen while diagnosing step 4B. Sequence C below was written afterwards and has never been run as written |
| Docker Desktop on macOS | — | — | — | **never** | — | **UNCLAIMED — never tested by anyone** |
| Sequence I — the contained WORKER, attacked | Apple silicon, this machine | macOS 26.5.2 `Darwin arm64` | **podman 6.1.0** rootless, `applehv`, no admin; worker `python:3-slim`+`iptables`, broker `alpine`+`iptables` | 2026-08-15 | this commit | **RAN AND CLASSIFIED — 8 probes, and for the first time in this repository a `--privileged` CONTROL RUN beside them: 6 of the 8 flip with the boundary removed.** Host credential (file and env) unreachable; corpus mirror unreachable; github unreachable by name AND by raw address; the worker cannot disarm its own allowlist; the model API stays reachable. **2 probes measured nothing and say so** — I6's control cannot distinguish it, and I7/I8 have no tools in the `trusted_local` arm. Same macOS caveat as sequence G: a Linux VM is in the path, so this is NOT evidence about the Linux case. Capture: [containment-2026-08-15.md](containment-2026-08-15.md) |
| Sequence I — the contained ACP WORKER, attacked | Apple silicon, this machine | macOS 26.5.2 `Darwin arm64` | **podman 6.1.0** rootless, `applehv`, no admin; worker `python:3-slim`+`iptables`, broker `alpine`+`iptables` | 2026-08-15 | this commit | **RAN AND CLASSIFIED against the OTHER spawn path — a stdio ACP session carried across the container boundary, which refusal 10 used to forbid (SPEC_CONTAIN_V0 §11).** 10 probes, with BOTH control arms beside them: **7 of the 8 attack probes flip with the boundary removed, and the 8th is the model API, which is not supposed to flip.** I3 is the row this phase exists for — with `--privileged` the probe lists the corpus mirrors by name, and with the boundary on the path is absent. The three probes that previously measured nothing (I6, I7, I8) are repaired and now distinguish. Same macOS caveat: a Linux VM is in the path, so this is NOT evidence about the Linux case. Capture: [containment-2026-08-15.md](containment-2026-08-15.md) |
| Sequence I — **DOCKER on Linux, SHARED KERNEL** | GitHub Actions `ubuntu-latest` | — | **Docker** (preinstalled), native, shared kernel; worker `python:3-slim`+`iptables`, ACP worker `node:22-slim`+agent, broker `debian:stable-slim`+`iptables`, all built in-job | 2026-08-16 | `dc02dcd` | **RAN AND CLASSIFIED — the macOS VM caveat falls away for this row and for nothing else.** Both spawn shapes (shell and ACP) and the `--privileged` control. **7 of the 8 attack probes flip with the boundary removed:** host credential by file and by env, github by name AND by raw address, DNS for an undeclared name, the worker disarming its own allowlist, and the process table (2 pids contained, 202 privileged) — all BLOCKED contained, all REACHED privileged. The model API stays reachable in both, which is the allowlist working rather than failing. **I3 measured NOTHING here and says so**: a CI runner has no corpus mirror, so both arms are BLOCKED for the same reason and the probe distinguishes nothing on this host. Classified by hand: I1, I2, I5a, I5b, I6, I7, I8 **prevented**; I3 **out_of_scope on this host**; I4 not an attack. Readable without a token in the run's `::notice::` annotations |
| Sequence I — Docker on Linux, first attempt | GitHub Actions `ubuntu-latest` | — | Docker (preinstalled) | 2026-08-16 | `57f9528` | **REFUSED, exit 2 — and kept as a row because the refusal is the evidence.** `pip install -e .` puts `wring` on PATH; `scripts/sequence-i.sh:434` invokes `$ROOT/.venv/bin/wring` by absolute path, deliberately, to pin WHICH wringer is under test. Both contained arms reported *"no loop bundle was written; nothing was measured"* rather than listing arms they had not run. The control arm ran and its probes REACHED. Sequence G's third lesson — a probe whose tool is absent is an ERROR and not a pass — holding on its first outing here |
| Sequence G — the container path, attacked | Apple silicon, this machine | macOS 26.5.2 `Darwin arm64` | **podman 6.1.0**, `applehv` provider, vfkit 0.6.4 + gvproxy 0.8.9, all in `~/.local` with no admin | 2026-08-13 | `c6fce0c`+ | **RAN AND CLASSIFIED — 7 attacks, 6 prevented / 1 mitigated, and the first run found 2 of the 7 measuring nothing at all.** Read the caveat: on macOS a Linux VM sits between container and host, so this is NOT evidence about the Linux case |
| Sequence G — **on LINUX, shared kernel** | the Fedora CoreOS guest of that same podman machine | Fedora CoreOS 44.20260720.3.1 | podman 6.1.0 rootless, native | 2026-08-13 | `9065310` | **RAN AND CLASSIFIED — same 7 attacks, same 6 prevented / 1 mitigated, on a host whose kernel the container SHARES.** The host had real key material at `/home/core/.ssh/authorized_keys.d/ignition` and the container saw none of it |
| Sequence G — **DOCKER on Linux, READ AT LAST** | GitHub Actions `ubuntu-latest` | — | Docker (preinstalled), image `python:3-slim` | 2026-08-14 | `fe21b6e` | **RAN AND CLASSIFIED — 6 prevented, 1 out_of_scope.** Readable without a token because the job now emits each attack as a public `::notice::` annotation. `--network none` holds on Docker (DNS blocked AND `OSError: [Errno 101] Network is unreachable` on a raw IP); no docker socket; 3 pids. **`/etc/shadow` WAS readable** — see below |
| Sequence G — Docker on Linux | GitHub Actions `ubuntu-latest` | — | Docker (preinstalled) | 2026-08-13 | `f0b44bc` | **EXECUTED for the first time** — [run 31692802687](https://github.com/marcoakes/wringer/actions/runs/31692802687), job `attack` succeeded, 16 KB of output in the `sequence-g` artifact. **UNCLASSIFIED: nobody has read it.** The artifact and the logs both need GitHub auth (401 unauthenticated), so the seven attempts have not been sorted into prevented / detected / mitigated / out_of_scope by anybody. Until they are, this row records that the sequence RAN and nothing about what it found |
| Sequence G — this Mac | Apple silicon, MacBookAir | macOS 26.5.2 | **none installed** | 2026-08-13 | `87de283` | **REFUSED, exit 2** — no runtime, so it recorded nothing. That is the script working: a checklist reporting no failures because it ran no attacks is the advert it exists to refuse |
| Sequence L — is agent AUTH readable before the paid turn? | Apple silicon, this machine | macOS 26.5.2 `Darwin arm64` | `@agentclientprotocol/claude-agent-acp` 0.70.0, node 24 | 2026-08-21 | this commit | **RAN, AND THE ANSWER IS NO.** Authenticated and unauthenticated are indistinguishable across the whole handshake: `authMethods: []` in BOTH, `session/new` opens a session in BOTH, no error in either. The refusal exists only at `session/prompt` — the call that costs money. So no preflight can catch an unauthenticated agent, and `diagnose.FACE_TURN_REFUSED` carries the load instead. Script: `scripts/acp-auth-probe.py` |
| Docker on Linux | GitHub Actions `ubuntu-latest` | — | Docker (CI) | every push | `main` | Automated; see `.github/workflows/tests.yml` |

### About the 2026-08-05 Apple row

This is a **captured fact**, and it is worth being exact about what it
covers, because it is the only evidence the Apple path has.

On 2026-08-05 a clean, MDM-managed macOS 26 Apple-silicon host executed
`SETUP.md` at `75167c2` end to end — the first execution of the Apple
`container` path by anyone. It proved a great deal: the published image
pulled, `container` started, the bind mount resolved, real gates ran, and a
complete seven-artefact evidence bundle landed on the host **owned by the
host user** (`502:20`) from a process running as uid 1000 inside the
container. Exit 0. The full transcript is preserved verbatim in
[field-report-2026-08-05.md](field-report-2026-08-05.md).

What it does **not** mean: that the runbook as written at `75167c2` worked.
It did not. `SETUP.md` said `container images pull`, which does not exist
(AC-01), and the operator got there by correcting the command by hand. The
runbook was then rewritten from that run's captured output — but **the
rewritten text has never itself been executed on an Apple host.** It is
transcribed evidence, not re-verified evidence.

So the next Apple run has a specific job: run the rewritten sequence
verbatim, change nothing, and add a row. Until then the Apple row says
"passed with corrections applied by hand", because that is what happened.

### About the Docker Desktop row

`--user`/`-e HOME` behaviour is genuinely runtime-specific — AC-02 measured
Apple `container` translating uids across a bind mount, exactly unlike
Linux. CI covers Docker on Linux and one field run covers Apple `container`.
**Nobody has ever run Wringer under Docker Desktop on macOS**, and SETUP.md
makes claims about it. That makes it this project's largest untested
surface, and it is listed here so it is visible rather than assumed.

---

## Sequence A — the Apple `container` path

**Requires:** macOS 26 on Apple silicon. **Time:** about ten minutes, most
of it the pull. **No API key is involved at any point** — if any step asks
for one, stop: that is a bug in the runbook, not a step to complete.

Run these from a clone of this repository, verbatim from `SETUP.md`. The
point is to execute what the runbook *says*, not what you know it means. If
a command needs correcting to work, that correction is a finding — record it
rather than fixing it silently and reporting a pass.

- [ ] **1. In the repo.** `git rev-parse --show-toplevel && grep -m1 '^name = ' pyproject.toml`
      → an absolute path, then `name = "wringer"`.
- [ ] **2. Host prerequisites.** SETUP.md step 2's interpreter loop
      → any git version, and at least one line reporting Python 3.11+.
      A stock `python3 -> 3.9.x` alongside a qualifying one is fine.
- [ ] **3. Install `wring`.** `uv tool install --force --python 3.12 .`
      → `wring --version` starts `wring 0.2`, then `doctor present`.
      Note **where** it landed; `uv tool install` uses `~/.local/bin`.
- [ ] **4. Pick the runtime.** `uname -s -m; sw_vers -productVersion`
      → `Darwin arm64` and `26.` or higher, so 4A is eligible.
- [ ] **4A. `container --version`** → `1.2.0` or later. A truncated
      `commit: unspeci` is Apple's own output, not damage.
- [ ] **4A. Install if missing** — `brew install container` (a *formula*,
      not a cask; no admin password). The install is the human's to run.
- [ ] **4A. `container system start`**, then `container system status`
      → a **table**, with the row `status  running`. A blank `logRoot` is
      normal.
- [ ] **5. `container image pull ghcr.io/marcoakes/wringer:main`**
      → exit 0. **`image`, singular.** Apple unpacks *every* architecture in
      the index, so a ~160 MB pull lands as roughly 470 MB on disk.
- [ ] **5. `container image list | grep wringer`** → exactly one row naming
      the image.
- [ ] **6. Workspace.** `mkdir -p ~/wringer-workspace` and the write probe
      → `workspace writable`.
- [ ] **7. The image runs and sees the mount.** `container run --rm --volume
      "$HOME/wringer-workspace:/workspace" --workdir /workspace
      ghcr.io/marcoakes/wringer:main --version`
      → the same `wring 0.2…` line, from inside the container. **The first
      `container run` on a machine** fetches a kernel and a ~66 MB init
      image behind a six-stage ladder, taking about ten seconds. Expected,
      once.
- [ ] **8. `wring doctor` from the clone** → exit 0; the `!` lines for
      container runtime and drafting key are expected.
- [ ] **8. `wring doctor` from a directory that is not a repo** → exit 0,
      and **three `-` lines**. (`setup-selftest.sh` asserts this too, so a
      disagreement between them is itself a finding.)
- [ ] **9. Hand back.** No key touched at any point in the sequence.
- [ ] **End to end.** The "What good looks like" probe, run through
      `container run … verify` → exit 0, a bundle on disk, and **every file
      in it owned by your host uid:gid**, not by uid 1000. Check with
      `ls -lan`.
- [ ] **AC-02, both ways.** Run the same verify **without** `--user` and
      `-e HOME`. On Apple `container` it should also exit 0 and also land
      owned by the host user — the flags are required on Linux and harmless
      here. If it *fails* on your host, that is a finding and SETUP.md's
      three-runtime paragraph is wrong.
- [ ] **Record it.** Add a row to the coverage table above: host, OS,
      runtime version, date, commit, result.

---

## Sequence B — the Docker Desktop path on macOS

**Never run by anyone.** There is no checklist here yet because writing one
from imagination is how the last set of findings happened — a runbook whose
steps had never been executed. Whoever runs this first should follow
`SETUP.md`'s 4B/5/7 branch verbatim, write down what actually happened, and
turn that into this section.

The one thing worth knowing in advance: AC-02 claims Docker Desktop
translates uids across a bind mount the way Apple `container` does. That
claim is **inherited from an older draft of SETUP.md and has never been
measured.** Measuring it is the most valuable thing this sequence can do.

---

## Sequence C — the Docker stub check (R2-02)

**Requires:** a machine where `/Applications/Docker.app` exists as a
removal leftover — typically an MDM-managed Mac where Docker Desktop was
uninstalled centrally. You cannot usefully create this state; you either
have it or you do not.

- [ ] `docker version --format '{{.Server.Version}}'` → `command not found`.
- [ ] `ls -ld /Applications/Docker.app` → something shaped like
      `d---------  2 root  admin  64`. **`-ld`, not `-la`**: the stripped
      permissions are exactly what stops `ls -la` reading the directory, so
      the plural-listing form returns `Permission denied` and tells you
      nothing.
- [ ] Confirm the diagnosis holds: no binary inside, no socket. This is a
      leftover, not an install, and clearing it needs privileges — it is the
      human's or their IT's to do, never the agent's.
- [ ] **Record it.** Add a row above.

---

## Sequence D — an attestation over a *signed* commit

**Status: unverified. Never run by anyone.**

`wring attest` records what `git log -1 --format=%G?` says about the delivered
commit's signature (`G` good, `B` bad, `U` untrusted, `N` none) plus the
reported signer, verbatim, and `wring audit` reports it without re-verifying.
The unsigned half is covered by real git in `tests/test_attest.py` — a normal
commit records `N`. **The signed half is not**, because signing a commit means
generating and holding a key, and never touching a credential is the product's
most distinctive promise. `test_a_signed_commit_records_what_git_says_verbatim`
drives a stubbed `git log` instead, which tests the part that is ours (carry it
through verbatim, gloss it, never judge it) and not git's answer.

What a run would need, on a machine whose owner already signs commits:

1. In a scratch repo with signing configured (`git config gpg.format ssh`,
   `git config user.signingkey ~/.ssh/id_ed25519.pub`, `commit.gpgsign true`),
   make a signed commit and confirm `git log -1 --format=%G?` prints `G`.
2. `wring verify && wring deliver --send && wring attest`.
3. Confirm `attestation.json`'s `change.commit_signature` reads
   `{"status": "G", "signer": "<your key>", "means": "a good signature"}`.
4. `wring audit` — it must report that value and must **not** attempt to
   verify it, so the audit still passes on a machine holding no keyring.
5. Repeat with a commit signed by a key the machine does not trust: the status
   should be `U`, recorded and not refused. Wringer does not decide anybody
   else's trust.

**Do not add a signing key to CI to close this.** That is the exact thing
SPEC_PROVENANCE_V0 ruling 1 refused, and a test is not worth contradicting the
promise it exists to protect.

*Note 2026-08-15: that refusal is about a **signing key**, and it stands.
Ruling 1's separate conclusion that attestations are unsigned was superseded
by [specs/SPEC_SIGN_V0.md](specs/SPEC_SIGN_V0.md) — keyless signing holds no key, so
the sentence above is not in tension with it. Sequence H below is the other
half, and is also unrun.*

## Sequence E — `wring start` against a real agent binary

**Status: unverified. Never run by anyone.**

`wring start`'s agent step is `shutil.which` over a named table, and every
test — plus the committed recording — drives it against a **stub** executable
with the right filename. That is deliberate and stays that way: installing a
vendor agent is exactly the power SPEC_START_V0 §3c-i refuses, and putting one
in CI or in anyone's `scripts/demo.sh` path would contradict the thing being
demonstrated.

So what is proven is that detection finds a binary of that name, writes the
stanza, and never runs it. What is **not** proven is that the `command` and
`args` in `src/wringer/agents.py` are the invocation a real agent wants. Those
values are pinned in one table for exactly this reason (AGENTS.md rule 5): if
an agent's ACP entry point differs, it is a one-line diff.

What a run would need, on a machine whose owner already has an agent installed:

1. Install one of the table's agents by its own published route, and confirm
   the binary in `agents.AGENTS` is on `PATH` under that name.
2. In a scratch repo with a gate that fails, `wring start --accept-gates
   --agent <id>` with the agent's key already exported.
3. Confirm the loop reaches the agent — `worker.started` with
   `worker_kind: "acp"` in the loop ledger — and that `worker.finished`
   carries a non-empty `agent_name`. That is the handshake succeeding, which
   is the part a stub cannot show.
4. Grep the whole loop bundle for the key's value. It must not appear.
5. If the handshake fails on the pinned `args`, fix the table and say so in
   the commit — do not add a flag to work around it.

**A network clone is not on this list.** `wring start --clone` uses
`acquire.clone` unchanged, and `tests/test_start.py` exercises it over
`file://` for the reason the rest of the suite does: a test that needs someone
else's server to be up is a test that fails for reasons unrelated to this
code. The https path is `wring get`'s, and it is the same function.

## Sequence F — the agent table has not been renamed out from under us

**Status: first run 2026-08-11, and it found a defect.**

`src/wringer/agents.py` is a hand-kept vendor table: an id, a binary, a
package, a credential variable. Nothing in the suite can check it is current,
and nothing should — asking npm whether a package is deprecated is a network
call in an offline-by-construction suite, in a project whose whole claim is
that what proves anything makes no network call. So this is a dated row
instead.

What it costs to skip: on 2026-08-11 the first person ever to install one of
these agents found `@zed-industries/claude-code-acp` deprecated and renamed.
Both halves of the entry were stale together — the current package is
`@agentclientprotocol/claude-agent-acp` and its binary is `claude-agent-acp`,
frozen at 0.16.2 versus 0.66.0 — so a user following current npm guidance
installed the agent successfully and `agents.located()` reported "not
installed" about an agent that was installed, while `wring start` printed an
install line for a dead package. Nothing in 1210 tests could have caught it,
because until that day nobody had ever tried to install a real agent.

Per entry in `agents.AGENTS`, on a machine with a network:

- [ ] `npm view <package> deprecated` → empty. Any string here is the
      finding: read it, it names the replacement.
- [ ] `npm view <package> version` → compare with what the ecosystem is
      actually installing. A package frozen many minor versions behind its
      sibling is the same defect wearing a different hat.
- [ ] `npm view <package> bin` → the key must match the entry's `command`.
      The two are not derivable from each other and they drift as a pair.
- [ ] If anything moved: change `agents.py`, move `specs/SPEC_ACP_V0.md`'s config
      example and `tests/test_acp.py`'s fixtures with it, leave `id` alone
      (it is the vendor-neutral handle config speaks), and **do not edit the
      filmed captures** — they record what was filmed.
- [ ] **Record it.** Add a row below.

| Entry | Package checked | Result | Date | Commit |
|---|---|---|---|---|
| `claude-code` | `@zed-industries/claude-code-acp` | **Deprecated and renamed** → `@agentclientprotocol/claude-agent-acp`, binary `claude-agent-acp`; table corrected | 2026-08-11 | this commit |
| `gemini` | `@google/gemini-cli` | **never checked** | — | — |

## Sequence L — is an ACP agent's AUTHENTICATION readable before the paid turn?

**Status: RUN 2026-08-21, and the answer is NO — which is why the fix shipped
is the one it is.**

The question is not idle curiosity. `wringer-drive` now refuses before the
first paid call when the coding agent is not on PATH
(`docs/field-report-2026-08-21.md` finding 6). The obvious next move is to
preflight that the agent is LOGGED IN too, because finding 11 is an operator
who reached the build step with an agent that was installed and
unauthenticated, and lost the run there having already paid twice.

If auth were visible in the handshake, that check would be free and the whole
class would be closed at the door. So it was measured rather than assumed.

    python3 scripts/acp-auth-probe.py claude-agent-acp
    HOME=$(mktemp -d) python3 scripts/acp-auth-probe.py claude-agent-acp

The probe sends `initialize` and `session/new` and **stops** — never
`session/prompt`, which is the turn that costs money. The unauthenticated case
is made by pointing `HOME` at an empty directory, which is non-destructive:
it logs nothing out and touches no credential store. **Do not use the agent's
own logout for this** — that ends a real session somebody has to restore.

| Field | Authenticated | `HOME` empty |
|---|---|---|
| `authMethods` present | yes | yes |
| `authMethods` | `[]` | `[]` |
| `session/new` opened a session | yes | yes |
| `session/new` returned an error | no | no |

**Identical on every field that could route a decision.** The two runs differ
only in incidental teardown noise on stderr. The refusal appears at
`session/prompt` and nowhere earlier.

What follows from it, and what does not:

- The drive's preflight covers **binary-on-PATH only**, and honestly says so.
  There is no auth preflight because there is nothing to read.
- The legibility fix carries the rest: `diagnose.FACE_TURN_REFUSED` names
  authentication in the PM-facing sentence, points at the agent's own login
  and the worker log, and carries the agent's own words verbatim.
- `authMethods: []` is **not** evidence of "already authenticated". It was
  empty for an agent that could not authenticate at all, so nothing may read
  it as a positive signal.
- One agent, one version, one host. `gemini` has never been probed this way.

- [ ] Re-run when `agents.AGENTS` gains an entry, or when a version bump
      changes the handshake. If a future agent DOES distinguish, the drive can
      preflight auth for that agent and this row is what says it changed.

## Sequence G — the container path, attacked

**Status: RUN AND CLASSIFIED, 2026-08-13, on macOS via podman — and read the
caveat before you read the table, because the caveat is bigger than the
result.** A container runtime now exists on the maintainer's machine: podman
6.1.0 installed into `~/.local` with no admin rights, `applehv` provider,
vfkit + gvproxy as helper binaries. Previously unrunnable there; last refusal
was 2026-08-12, exit 2, recording nothing.

`SECURITY.md` says the container path is *designed to* isolate and explicitly
declines to say it is *demonstrated to*. This sequence is what would change
that sentence.

**It is now one command**, added with the `execution:` backend
(specs/SPEC_EXEC_V0.md §7):

```
sh scripts/sequence-g.sh [runtime] [image]
```

**And it now RUNS somewhere.** `.github/workflows/sequence-g.yml` drives it on
`ubuntu-latest`, which has Docker preinstalled — the one machine available to
this project where the sequence can execute at all. Trigger it from the Actions
tab (`workflow_dispatch`, optionally naming an image), or it fires on a push
that touches `src/wringer/backend.py`, `scripts/sequence-g.sh` or
`SECURITY.md`. The raw output lands in the run summary so recording a row is a
copy rather than a re-run, and the bundle is uploaded as an artifact.

**That job cannot go green as an answer, and does not try to.** Classifying the
seven attempts is a human's judgement; the job runs them and stops. It also
covers exactly ONE row of the table above — *Docker on Linux, GitHub Actions*.
Docker Desktop on macOS and Apple's `container` stay UNCLAIMED, because mount
and uid behaviour turned out to be genuinely runtime-specific (the 2026-08-05
field report is where that was learned).

Two things about that script are the point of it. It drives every attack **as a
gate through the real backend**, so what gets measured is the argv Wringer
actually ships rather than a bespoke command line written for the occasion. And
it **refuses rather than skips**: with no runtime on PATH it exits 2 and records
nothing, because a checklist reporting no failures because it ran no attacks is
the advert this sequence's own last line warns about.

The seven attempts, which the script runs as optional gates so that one
succeeding does not stop the rest:

- [ ] `ls ~/.ssh` → must not reveal host keys.
- [ ] `env | grep -Ei 'aws|github|token|secret'` → must be empty beyond what
      the run explicitly declared. Note what the backend asks for here: an
      env **allowlist** by name, so a variable Wringer has never heard of is
      withheld for the same reason a named credential is. That is a fact about
      the argv; whether the runtime honours it is what this sequence measures.
- [ ] `cat /var/run/docker.sock` → must not exist. A reachable Docker socket
      is host root, and finding one makes every other line here moot.
- [ ] `git config --global --list` → must not reveal host credentials.
- [ ] Read a file outside the declared mount → must fail.
- [ ] Open an outbound connection → record whether it succeeds. The backend now
      passes `--network none` unless the repo typed `network: true`, so the
      question has sharpened from "which is it?" to "does the flag hold?"
- [ ] `ps aux` → record what of the host's process table is visible.
- [ ] **Record it**, including every attempt that SUCCEEDED. An attack that
      works is the finding; a checklist with only passes is a advert.


### How the runtime got there, with no admin rights

Recorded because "install a runtime" was the blocker for eight months and the
answer turned out to be four downloads and no password. Every step ran as the
ordinary user; nothing needed `sudo`; nothing was installed system-wide.

Apple's `container` is deliberately NOT the answer here — `backend.py`'s
`_DOCKER_DIALECT` accepts `docker`, `podman` and `nerdctl` only, and
SPEC_EXEC_V0 ruling 4 says why guessing at a fourth flag surface is the worst
failure available.

1. `podman-remote-release-darwin_arm64.zip` (25,374,988 bytes) from podman's
   GitHub releases → extract `usr/bin/podman` to `~/.local/podman/bin/`,
   symlink into `~/.local/bin/`.
2. The archive contains **no VM helpers**, which is the step that is easy to
   miss. Fetch two more: `vfkit` from `crc-org/vfkit` (Developer-ID signed,
   and `codesign -d --entitlements -` shows `com.apple.security.virtualization
   = true`, which is the entitlement the whole thing turns on) and
   `gvproxy-darwin` from `containers/gvisor-tap-vsock`. Same directory.
3. `~/.config/containers/containers.conf`:

   ```
   [engine]
   helper_binaries_dir = ["/Users/<you>/.local/podman/bin"]

   [machine]
   provider = "applehv"
   ```

   **The `provider` line is required.** podman 6 defaults to `krunkit` on Apple
   silicon, which is a separate binary this recipe does not install; without it
   `podman machine start` dies with `exec: "krunkit": executable file not
   found in $PATH` after a successful `init`, which reads like a broken install
   rather than a wrong default.
4. `podman machine init --disk-size 20 --memory 4096 --cpus 4 && podman machine
   start`. The machine image is ~1 GB and the running VM cost about 6 GB of
   disk here.

Then `sh scripts/sequence-g.sh podman ghcr.io/marcoakes/wringer:main`. Bind
mounts from both `$HOME` and `$TMPDIR` resolve inside the VM without extra
configuration, which is what lets the workspace mount work at all.

### What it found — macOS / podman 6.1.0 / `ghcr.io/marcoakes/wringer:main`

**THE CAVEAT FIRST, because it decides how much the table below is worth.
On macOS there is a LINUX VM between the container and the host.** podman runs
containers inside a Fedora CoreOS guest, so every "the host is not reachable"
result here is really *the VM is not reachable from the container*, and macOS
was never the thing being escaped from. On Linux — where docker and podman share
the host kernel and where anyone reading `SECURITY.md` will actually run this —
none of that VM exists. **These seven results are evidence about container ⇢ VM
isolation and are NOT evidence about container ⇢ Linux host isolation.** The
`/proc/uptime` line below proves the point: the container reads an uptime of
223 seconds, which is the VM's age, not the Mac's.

| # | attack | verdict | what it actually saw |
|---|---|---|---|
| 1 | host-ssh-keys | prevented | `/home/wring/.ssh` and `/home/*/.ssh` do not exist; `/root/.ssh` is `Permission denied`. No host key material is reachable |
| 2 | host-credentials-in-env | prevented **by default only** | `NONE FOUND`. Wringer emits `--env NAME` solely for names in `execution.env`, which is empty here. This says the DEFAULT is clean; it says nothing about a declared passthrough, which is opt-in and is meant to arrive |
| 3 | docker-socket | prevented | neither `/var/run/docker.sock` nor `/run/docker.sock` exists. Rootless podman binds no socket into the container |
| 4 | host-git-config | prevented | `fatal: unable to read config file '/home/wring/.gitconfig'`; no `.git-credentials` |
| 5 | outside-the-mount | **mitigated, not prevented** | `/etc/shadow` is `Permission denied` — the file IS there and the barrier is the image's `USER wring`, which **Wringer does not set**. An image whose user is root reads it. `${HOME}` shows only the container's own skeleton; `/Users` does not exist |
| 6 | outbound-network | prevented | `--network none` is real and it is not just DNS: `socket.gaierror: [Errno -3] Temporary failure in name resolution` AND, on a raw IP with no name lookup, `OSError: [Errno 101] Network is unreachable` |
| 7 | host-process-table | prevented | **3** pids visible in the namespace; pid 1 is the gate's own `/bin/sh -c`. `/proc/uptime` is readable and leaks the VM's uptime — bounded, and not the host's |

### The same seven on LINUX, where the kernel IS shared

**Run the same day, inside the Fedora CoreOS guest that podman machine created**
— `podman machine ssh`, clone at `9065310`, `pip install -e .`, native rootless
podman 6.1.0. From the container's point of view that guest is an ordinary
Linux host sharing its kernel, which is the configuration everyone reading
`SECURITY.md` actually runs, and the one the macOS row above explicitly could
not speak for.

**The verdicts are identical: six prevented, one mitigated.** What makes the
Linux run worth more than a repeat is that the attacks had something real to
find:

- **The host genuinely had private key material.** `/home/core/.ssh/authorized_keys.d/ignition`
  exists on that host — podman machine's own ssh key, 118 bytes, mode `600`.
  The container saw `/home/*/.ssh: No such file or directory`. On macOS the
  equivalent probe could only prove a path was absent; here it proves a real
  secret was present and unreachable.
- `--network none` again blocks both the name and the raw IP
  (`gaierror` then `OSError: [Errno 101] Network is unreachable`) — on a shared
  kernel this is a real network namespace, not a VM boundary doing the work.
- 3 pids in the namespace, pid 1 is the gate's own `/bin/sh`.
- `/proc/uptime` is readable and here it IS the host's uptime (528s). A bounded
  info leak, and worth naming rather than rounding down to "prevented".
- `/etc/shadow` is `Permission denied` for the same reason as on macOS — the
  image's `USER wring`, which **Wringer does not set** — so item 5 stays
  `mitigated` on both platforms.

**Verdict on `SECURITY.md`: the wording still does NOT change.** "Designed to
isolate" stays, and now for a sharper reason than "we only tested macOS":

- Seven scripted probes are not an escape suite. Nothing here attempted a
  kernel exploit, a cgroup or `/proc/sys` write, a capability abuse, or a
  `--privileged` comparison. "These seven attacks were prevented" is a much
  smaller sentence than "demonstrated to isolate", and the script's own
  definition is strict: *prevented — the thing cannot be done. Not "it failed
  this time."*
- One runtime, one distro, one image at the time this was written. **Docker was
  measured on 2026-08-14** — the row and the classification are below. It went
  unread until then because the artifact and the step summary are login-walled.
- The one non-prevented item is carried by the image, not by Wringer.

**What would earn the stronger word**, stated so the next window does not have
to re-derive it: the same seven under **docker** with the results read, plus at
least one probe that attacks the boundary itself rather than reading through it
(a `--privileged` control run showing the same attacks SUCCEED is the cheapest
honest way to prove the flags are what stopped them).

**Verdict on `SECURITY.md`: the wording does NOT change, and this run is the
argument for leaving it alone rather than an argument nobody made.** "Designed
to isolate" stays. A macOS run cannot upgrade a claim about Linux, and item 5
is carried by the image's user rather than by anything Wringer asks for.

### Docker, finally read — and it settles what "mitigated" meant

This sequence went eight months unrun; its Docker RESULT then existed for one
day before anybody saw it. (The first draft of this section merged those two
facts into "eight months", which is a different and wrong sentence.) Why nobody
saw it:
the job ran, uploaded an artifact, and both the artifact and the step summary are
login-walled. Since `86ac742` each attack's output is emitted as a public
`::notice::` annotation, so `/repos/marcoakes/wringer/check-runs/<id>/annotations`
now answers without a token. **This row was written by reading that.**

Six prevented, on the same argv as the podman runs:

- **`--network none` holds on Docker.** `DNS BLOCKED (getent found no address)`
  and, on a raw IP with no name lookup, `OSError: [Errno 101] Network is
  unreachable`.
- **No docker socket** at `/var/run/docker.sock` or `/run/docker.sock` — the
  classic container escape is simply not reachable, which is the single most
  important thing to be able to say about a Docker backend.
- 3 pids in the namespace, pid 1 is the gate's own `/bin/sh`; `/proc/uptime`
  reads the runner's 164s — a bounded leak, named rather than rounded down.
- No host ssh keys, no host gitconfig, `/Users` absent, and the workspace mount
  owned by the runner uid `1001`.

**And the seventh settles a question the earlier runs could only guess at.**
On macOS and on the shared-kernel Linux guest, `cat /etc/shadow` returned
`Permission denied`, and this document classified that `mitigated` while saying
the barrier was the image's `USER wring` rather than anything Wringer asks for.
On Docker with `python:3-slim`, which has no `USER`, the same argv produced:

```
root:*:20668:0:99999:7:::
daemon:*:20668:0:99999:7:::
```

**That is the container's own `/etc/shadow`, not the host's** — no host secret
was exposed, and the file is a stock image artifact with no real hashes in it. It
is recorded as `out_of_scope` rather than a failure. But it demonstrates the
point that could previously only be asserted: **Wringer sets no `--user` unless a
config asks for it, so whatever privilege a gate has inside the container is the
IMAGE's choice, and a root image gives it root.** Any repository pointing
`execution.image` at something that runs as root should know that.

**What this does NOT do is upgrade `SECURITY.md`.** Three runtimes now agree on
six attacks, which is a broader base than one — and it is still seven scripted
reads, still no kernel exploit, no capability abuse, no cgroup or `/proc/sys`
write, and still no `--privileged` control run proving the flags are what stopped
anything.

### The finding that matters more than the table

**Two of the seven attacks measured NOTHING the first time, and the run
reported seven attacks.** `outbound-network` shelled out to `curl` and
`host-process-table` to `ps`; the image this repository publishes has neither,
so they printed `no curl in image` and `ps: not found` and were counted. That is
the "a table of passes is an advert" failure occurring *inside the script
written to refuse exactly that* — a check that narrowed while still passing,
which is this repository's own named defect class, found in its own security
checklist. Both probes now use tools the image has (`python3`, `getent`,
`/proc`), and the fixed run is the table above.

A third bug, same commit: the heredoc that writes `.wringer.yaml` is unquoted,
so `${HOME:-/root}` expanded on the HOST and attack 5 asked the container to
list `/Users/marc` rather than its own home. It measured something real either
way, but not the thing its name claims. Escaped now.

**Linux is now measured twice and read both times** — the shared-kernel podman
guest above, and Docker on `ubuntu-latest` below. What remains unrun is anything
that attacks the boundary rather than reading through it: no kernel exploit, no
capability abuse, no cgroup or `/proc/sys` write, and no `--privileged` control
run showing these same attacks SUCCEED when the flags are removed. That control
is the cheapest honest way to show the flags are what stopped them, and it has
never been done.

Classify each as `prevented`, `detected`, `mitigated` or `out_of_scope`, and
never write `prevented` where Wringer merely records evidence afterwards. The
script prints those four definitions and then stops, because classifying is the
half a script cannot do.

**A row saying the sequence RAN is not a row saying what it found.** The
2026-08-13 Linux CI row is exactly that halfway state: the job executed the
seven attempts against a real Docker and uploaded the output, and no human has
opened it. Classification is the half a script cannot do, and an unread artifact
classifies nothing. The macOS row IS classified, and its own caveat says why
that does not settle the Linux question.

**The Linux row now exists and it is still not enough to change the wording** —
see the verdict above for exactly why, and for the two things that would.
Nothing in this repository may say the container path is demonstrated to
isolate** — and that includes the `execution:` backend,
whose every property is a flag with a test behind it and not a measurement.
specs/SPEC_EXEC_V0.md §7 states the split; `test_docs.py` keeps SECURITY.md's wording
honest.

## Sequence I — the contained WORKER, attacked

**Status: RUN AND CLASSIFIED, 2026-08-15, on macOS via podman — with a
`--privileged` control run, which this repository had never done.**

Sequence G attacks the gate backend. This attacks the half SPEC_EXEC_V0 §5
recorded and left open: *"`run.worker` runs on the host. Always."*
SPEC_CONTAIN_V0 closes it, and this is what closing it is worth.

```
sh scripts/sequence-i.sh <runtime> <worker-image> <broker-image> [arm]
```

`arm` is `contained` (default), `privileged`, or `local`. **The two control
arms exist because their attacks are expected to SUCCEED** — if they do not,
the canaries prove nothing, and that is a finding to chase rather than a pass.

**It inherits three of Sequence G's lessons and the third is the one that
matters.** It drives every probe through the real mechanism — the probe script
*is* `run.worker`, so what is measured is the argv Wringer ships. It refuses
rather than skips with no runtime. **And it refuses when a probe's own tool is
absent from the declared image**, because G's own section titled *"the finding
that matters more than the table"* records two of its seven attacks measuring
nothing while the run reported seven attacks. Under SPEC_CONTAIN the image is
the REPOSITORY's, so that failure is strictly more likely here — and the
control arm does not rescue it, because a missing binary fails identically in
both arms and reads as "no difference" rather than as a broken probe.

**The first run of this script committed that failure anyway**, and it is
recorded in the capture rather than quietly fixed: I7 reported
`BLOCKED  FileNotFoundError: iptables` — a probe that could not execute,
counted as a boundary holding — and I8 reported a credential leak that was the
probe matching its own argv. Both are corrected; the correction is why the
table below is worth reading.

### What it found — macOS / podman 6.1.0

The table, the two controls beside it, and the two rows that measured nothing
are in [containment-2026-08-15.md](containment-2026-08-15.md). Summarised:
six probes hold under containment and flip under `--privileged`; the model API
stays reachable, which is what distinguishes a broker from `--network none`.

**Verdict on `SECURITY.md`: the wording still does NOT change.** The reasons
are Sequence G's, unchanged and now joined by one more:

- Eight scripted probes are not an escape suite. No kernel exploit, no
  capability abuse, no cgroup or `/proc/sys` write, no escape attempt.
- One platform, one runtime, one image — and macOS, where a Linux VM is in the
  path. **Corrected 2026-08-18 — this bullet previously said:** *"The Linux arm
  is unrun and docker is unrun."* False since **2026-08-16**, and false against
  a row in this file's own Coverage record four hundred lines above it: `dc02dcd`
  ran sequence I on GitHub Actions `ubuntu-latest` under Docker on a **shared
  kernel**, both spawn shapes, with the `--privileged` control — 7 of the 8
  attack probes flip. `SECURITY.md`'s results table carries that row. What is
  still unrun for sequence I is **Linux + podman**, which is where the two
  arms would be compared on one kernel with one runtime; that gap is in
  `SECURITY.md`'s not-measured table under its own name.
- **The egress allowlist is an ADDRESS allowlist**, so anything co-tenanted at
  those addresses is reachable and no probe here can see it. That limit travels
  in the bundle's own `limits` array.

**What would earn a stronger word**, stated so the next window does not
re-derive it: the same eight inside the podman machine's Linux guest, where the
kernel is shared — the arm that made Sequence G's Linux row worth more than its
macOS one — plus docker, plus one probe that attacks the boundary rather than
reading through it.

### How the broker image got there

Recorded because "the holder needs `iptables`" is a real precondition and
Wringer refuses without it (refusal 6), so anyone reproducing this needs the
recipe. Two lines, no admin:

```
FROM docker.io/library/alpine:latest
RUN apk add --no-cache iptables
```

The worker image for the canary is `python:3-slim` plus `iptables` — python3
for the probes, and `iptables` so that I7 can actually **attempt** a disarm.
An image without it makes I7 measure nothing, which is the whole point above.

## Sequence H — `wring attest --sign` against live Sigstore

**Status: unverified. Never run by anyone. Added 2026-08-15 to record a debt
that was being carried in prose and nowhere else.**

`wring attest --sign` is offered in CI only. It shells out to `cosign`/`gh`
for keyless Sigstore OIDC signing, holds no key, and writes the sibling
`attestation.json.sig`. **Every exercise of it, in the whole suite, uses a
stub signer placed on `PATH`** (`tests/test_sign.py::stub_signer`, whose body
is `echo "SIGNATURE" > "$4"`). SPEC_SIGN_V0 §9 says the same thing about
itself; this file is where an unrun check is supposed to be recorded, and it
was not here.

So what is proven is Wringer's half: the argv it builds, `can_sign_here`
refusing off-CI, the sibling file being written only on success and never
partially, and `wring audit --verify-signature` reading a `.sig` back. What is
**not** proven is that a real `cosign sign-blob` or `gh attestation` accepts
that argv, that a real Fulcio certificate is minted from the runner's OIDC
identity, or that a real verification succeeds against Rekor.

What a run would need, in CI on a repository whose workflow has
`id-token: write`:

1. A workflow step that installs real `cosign`, then runs `wring verify` and
   `wring attest --sign` — nothing stubbed, nothing on `PATH` but the real
   binary.
2. Confirm `attestation.json.sig` exists and is not the stub's literal
   `SIGNATURE` bytes.
3. `wring audit <attestation> --verify-signature` in a **later, separate** job
   — one with no ambient identity of its own — and confirm it reports
   `signature_valid`.
4. Confirm the console still prints the unsigned limits sentence beside the
   signature, qualified rather than suppressed. That is
   `test_a_successful_signing_says_so_and_qualifies_the_unsigned_limit`
   happening for real.
5. Repeat with the `.sig` truncated by one byte: `signature_invalid`, and the
   audit must fail rather than fall back to `signature_missing`.

**Until this row is filled in, every document that mentions signing must carry
"exercised only against a stub".** That wording is currently in `README.md`,
`SECURITY.md`'s capability table, `specs/SPEC_PROVENANCE_V0.md`'s header amendment
and `docs/attest-and-audit.md`'s postscript — and `SECURITY.md`'s row is
probed by `tests/test_security_capabilities.py`.

- [ ] **Record it.** Add a row to the coverage record above.

## OPEN — a bench usage flake, one red run in seven, unreproduced

**2026-08-13.** `tests/test_bench.py::test_what_the_agent_reported_reaches_the_row_and_the_json`
failed once under `sh scripts/check.sh` and has not failed since. It is recorded
here rather than fixed, because **there is no diagnosis** and a guessed fix would
be worse than an honest open item — this repository has already spent a session
raising two timeouts on a "loaded machine" theory that turned out to be a
`nohup`'d SIGINT disposition.

What the failure was: `cli.main(["bench", "--json"])` returned 0, the row for the
`reporter` contender existed, and its `usage` key was **absent**. So no iteration
of that contender's loop had `turn.usage` set, and `write_usage` therefore wrote no
`usage.json`.

What has been ruled out, with the runs to say so:

| probe | result |
|---|---|
| the test alone | passes, 1.5s |
| `tests/test_bench.py` alone, `-n auto`, 3× | 84 passes, no failure |
| the FULL suite, `-n auto`, 6× | 1448 passes each time |
| the test 12× under 12 spinning CPU hogs on 8 cores | 12 passes |
| random test ordering | not installed — only `pytest-xdist` |
| cross-test pollution of module globals or `os.environ` | grepped; the one direct `os.environ` write (`test_start.py:800`) is an assertion about a different variable |
| reordered messages from the fake agent | impossible by construction: one stdout, flushed per message, usage sent before the prompt reply |
| a lost notification in `Connection._await` | the response and the inbound queue are snapshotted under ONE lock and pending messages are served BEFORE the response is returned |

What is left, unproven: the nondeterminism `--dist load` introduces is *which
worker* runs this test beside which neighbours, so a per-worker-process
interaction remains the open candidate. Nothing has been changed on that theory.

**Do not "fix" this without a reproduction.** When it recurs, the assertion prints
the whole row — capture that output, and note that pytest keeps only the last three
`pytest-of-*` tmp trees, so the loop bundle must be copied out of tmp before three
more runs go by.

## Sequence J — the README's claims about artifacts in OTHER repositories

**Added 2026-08-17, after the README asserted for a day that the board "has not
been published anywhere" while the page was live and serving.**

No test in this repository can check a claim about an artifact that lives
outside it. `tests/` runs offline by design, and the two claims below name a
different repository and a public URL. That is a structural limit, not a gap
somebody forgot — so it goes here rather than being quietly assumed, and rather
than being answered with a network call in a test suite that must stay offline.

Each row names the command that was actually run, and its actual output.

| claim in `README.md` | the command run | last checked | result |
|---|---|---|---|
| ~~the board's source is public at `github.com/marcoakes/wringer-board`~~ **README no longer claims this — superseded 2026-08-22** | `curl -s -o /dev/null -w "%{http_code}" https://github.com/marcoakes/wringer-board` (unauthenticated) | 2026-08-17 | **200 — public.** Still 200 on 2026-08-22, as a TOMBSTONE: its description says the code moved into `wringer`. The board's source is now `src/wringer_board/` in this repository, so there is no cross-repo claim left to check |
| the board's page is live at `marcoakes.github.io/wringer-board/` | `curl -s -o /dev/null -w "%{http_code}" https://marcoakes.github.io/wringer-board/` | 2026-08-17 | **200** |
| `wringer-board` is **not** on PyPI, so `pip install wringer-board` fails | `curl -s -o /dev/null -w "%{http_code}" https://pypi.org/pypi/wringer-board/json` | 2026-08-17 | **404 — absent, so the claim holds.** The same probe against `wringer` returns **200**, which is the control: the check can tell the two apart |

**What would change these rows:** publishing `wringer-board` to PyPI (row 3
flips and the README's install line must change with it), or the Pages build
going unbuilt (row 2 flips). **The failure this sequence is written after is
the opposite one** — the rows were *understated* for three windows: three
consecutive handovers recorded "the board has no remote, publication is
blocked", which was true of a local clone and false of the repository. An
understatement is a stale claim exactly as much as an overstatement is, and it
cost this programme a cold-read it could have had three days earlier.

## Sequence K — `action.yml`, and the CI logs nobody here can read

**Added 2026-08-17, when the `uses: ./` job H-7 asked for went red and stayed
red through two real fixes.**

This repository's GitHub Actions logs are **403 unauthenticated**, and there is
no `gh` on the maintainer's machine. So when the action fails, the only way to
see what it did is `scripts/replay-action.sh`, which runs `action.yml`'s steps
in order against a clean clone and models the workflow job's own setup first.

| what | state |
|---|---|
| the action had ever been executed by anything before 2026-08-17 | **no** |
| `uses: ./` job added | yes, `44a61f2` |
| its first run | **RED** |
| defect 1: installed PyPI 0.3.0, then invoked `wring health`, which 0.3.0 does not have | **FIXED** — `@main` installs `@main` via `$GITHUB_ACTION_PATH` (`63de64e`) |
| defect 2: `wring verify` needs the TARGET repo's gate tools on PATH, which the action does not install | **FIXED in the job, STATED in the action** (`3f57377`) |
| the whole chain replayed locally, with the job's steps modelled | **PASSES** — lint ✓, test ✓, health ✓, exit 0 |
| defect 3: the job's checkout was SHALLOW, so `git tag` was empty and the roadmap's `ship` probe read not-shipped while the SVG drew it green | **FIXED** — `fetch-depth: 0`, as the `verify` job has carried since 2026-08-08 (`c8cf2a5`) |
| **the CI job** | **GREEN at `c8cf2a5`**, along with all eight others |
| the `experimental` label in `action.yml`'s description | **REMOVED**, per H-7, in the commit after the job went green |

**How the third one was found, since I got this wrong first:** I recorded the
logs as unreadable and the cause as undiagnosable. The logs ARE 403
unauthenticated — but **annotations are public**, and this repository already
uses `::notice::` annotations for exactly this purpose in sequence G. The
`action` job now emits the verify exit code, the bundle path, which of
`wring`/`ruff`/`pytest` are on PATH, and per gate its exit code and the tail of
BOTH streams. The first version of that probe read stderr only and reported an
empty message, because pytest writes failures to stdout.

**What this sequence is still for:** the replay script remains the way to see
what the action does without a token, and the annotation probe remains in the
job. If it goes red again, read the annotations first —
`scripts/watch-job.sh <sha> action`.

### And the thing that actually made this slow, measured

Diagnosing the action took six push-and-look cycles, and each one waited for
the whole RUN to reach `completed`. Measured on `5aa53ce`:

| | done at |
|---|---|
| `action` — **the job that answers the question** | **+3.5m** |
| `pytest (macos-latest, 3.12)` | +5.4m |
| the whole run | +5.4m |

So every cycle spent about **1.9 minutes waiting on a macOS job irrelevant to
the question**, plus up to 45 seconds of polling granularity. Roughly fifteen
minutes across the six, and **none of it was the annotations' fault** — they
are readable the moment their own job finishes.

`scripts/watch-job.sh` polls the JOB, not the run, and prints its annotations
as soon as it completes. Against an already-finished run it returns in about
two seconds. Watch the job you asked about.

## Sequence M — the paste block fetches THIS repository's current runbook

**Why it is manual.** The suite opens no sockets by construction, and the
defect this catches is invisible offline: the URL returns HTTP 200 either way.

**The defect, found 2026-08-22 by running it.** `START-HERE.md`'s paste block
— the one thing a product manager hands their agent — pointed at
`raw.githubusercontent.com/marcoakes/wringer-drive/main/AGENTS.md`, the
PRE-MERGE repository. It answers 200 and serves a runbook 7KB behind this
one, missing the auth remedy, the vendor worker forms and every key-wording
change of the last three windows. Nothing looks wrong; the person is simply
driven by a stale document. `tests/drive/test_drive_docs.py` now derives the
expected path from where `AGENTS.md` actually sits, which catches a MOVE. It
cannot catch the repository being wrong while the path is right, and it cannot
compare bytes. This does.

```bash
grep -o 'https://raw.githubusercontent.com[^ ]*' docs/drive/START-HERE.md
curl -sS -o /tmp/fetched.md -w '%{http_code} %{size_download}\n' "<that url>"
diff /tmp/fetched.md docs/drive/AGENTS.md && echo "the paste block serves THIS file"
```

**Expected:** `200`, and `diff` silent against the committed file — after the
commit that changed it has been PUSHED. A diff here on unpushed work is the
round-3 lesson, not a defect: check `git log origin/main..main` is empty
first.

## What is *not* here, and why

These are covered by automated tests and do not belong on a manual list.
They are named so nobody adds them again out of caution:

- `container images` and `ls -la /Applications/Docker.app` never appearing as
  a *command* a runbook tells you to run — `tests/test_docs.py`. Prose may
  still name them, and does: the fixes for both explain the broken form on
  purpose, and a warning that cannot spell the wrong command is not a
  warning. The guards distinguish a ```bash fence (an instruction) from an
  untagged one (a transcript of what happened).
- No script defaulting to one developer's sandbox path — `tests/test_docs.py`.
- The scratch tree a script may recursively delete always ends in a component
  the tool chose — `tests/test_scratch.py`.
- SETUP.md's step 7H and the selftest's copy of it not drifting apart —
  `tests/test_docs.py`.
- `run_id` being timezone-invariant — `tests/test_evidence.py`.
- The blank template naming what it found — `tests/test_detect.py`.
- `wring init && wring verify` exiting 0 in an empty repo, and saying the
  run proved nothing — `tests/test_init.py`.
- Step 7H's hygiene, and doctor's three skips outside a repo —
  `scripts/setup-selftest.sh`.

The dividing line is simple: if a check can run without a container runtime
and without a specific broken machine, it is a test, not a checklist item.
