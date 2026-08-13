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
| Sequence G — the container path, attacked | Apple silicon, this machine | macOS 26.5.2 `Darwin arm64` | **podman 6.1.0**, `applehv` provider, vfkit 0.6.4 + gvproxy 0.8.9, all in `~/.local` with no admin | 2026-08-13 | `c6fce0c`+ | **RAN AND CLASSIFIED — 7 attacks, 6 prevented / 1 mitigated, and the first run found 2 of the 7 measuring nothing at all.** Read the caveat: on macOS a Linux VM sits between container and host, so this is NOT evidence about the Linux case |
| Sequence G — Docker on Linux | GitHub Actions `ubuntu-latest` | — | Docker (preinstalled) | 2026-08-13 | `f0b44bc` | **EXECUTED for the first time** — [run 31692802687](https://github.com/marcoakes/wringer/actions/runs/31692802687), job `attack` succeeded, 16 KB of output in the `sequence-g` artifact. **UNCLASSIFIED: nobody has read it.** The artifact and the logs both need GitHub auth (401 unauthenticated), so the seven attempts have not been sorted into prevented / detected / mitigated / out_of_scope by anybody. Until they are, this row records that the sequence RAN and nothing about what it found |
| Sequence G — this Mac | Apple silicon, MacBookAir | macOS 26.5.2 | **none installed** | 2026-08-13 | `87de283` | **REFUSED, exit 2** — no runtime, so it recorded nothing. That is the script working: a checklist reporting no failures because it ran no attacks is the advert it exists to refuse |
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
      container runtime and llm key are expected.
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
- [ ] If anything moved: change `agents.py`, move `SPEC_ACP_V0.md`'s config
      example and `tests/test_acp.py`'s fixtures with it, leave `id` alone
      (it is the vendor-neutral handle config speaks), and **do not edit the
      filmed captures** — they record what was filmed.
- [ ] **Record it.** Add a row below.

| Entry | Package checked | Result | Date | Commit |
|---|---|---|---|---|
| `claude-code` | `@zed-industries/claude-code-acp` | **Deprecated and renamed** → `@agentclientprotocol/claude-agent-acp`, binary `claude-agent-acp`; table corrected | 2026-08-11 | this commit |
| `gemini` | `@google/gemini-cli` | **never checked** | — | — |

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
(SPEC_EXEC_V0.md §7):

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

**Verdict on `SECURITY.md`: the wording does NOT change, and this run is the
argument for leaving it alone rather than an argument nobody made.** "Designed
to isolate" stays. A macOS run cannot upgrade a claim about Linux, and item 5
is carried by the image's user rather than by anything Wringer asks for.

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

**What is still unrun: this sequence on LINUX with the results read.** The
2026-08-13 CI row above executed it on `ubuntu-latest` and nobody has opened the
artifact. That job is where the claim that matters would come from, and until
someone reads it the Linux case is unmeasured.

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

**Until a LINUX row appears with classifications, nothing in this repository may
say the container path is demonstrated to isolate** — and that includes the `execution:` backend,
whose every property is a flag with a test behind it and not a measurement.
SPEC_EXEC_V0.md §7 states the split; `test_docs.py` keeps SECURITY.md's wording
honest.

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
