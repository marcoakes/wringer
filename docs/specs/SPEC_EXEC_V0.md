# SPEC_EXEC_V0 — where a gate runs

**Binding** for the `execution:` section, `ExecutionBackend`, `execution.json`
(`wringer.execution.v1`), and what a bundle may claim about isolation.

Status: **BUILT, half-measured**, 2026-08-12. §7 is the half that is not
measured and says so at the same volume as everything else.

---

## 1. The problem, and the sentence that was already true

`.wringer.yaml` is code. `wring verify` runs the commands a repository declared,
through a shell, with the invoking user's privileges. SECURITY.md has said so
since 0.1:

> Cloning an untrusted repository and running `wring verify` in it runs that
> repository's chosen commands on your machine. **Read its `.wringer.yaml`
> first.**

The container has been the documented answer since 0.2 — but only as a thing a
*human* typed:

```
docker run --rm -v "$PWD:/workspace" ghcr.io/marcoakes/wringer:main verify
```

That runs the whole harness in a box. It is real, and it is all-or-nothing: you
cannot ask a repo's config for it, nothing records that it happened, and a
bundle produced that way is indistinguishable from one produced on the host.

This slice makes it a **backend** the config selects, and — the part that
matters more — makes every bundle say which one ran.

## 2. `ExecutionBackend`

One seam, two implementations. The backend decides WHAT gets spawned;
`gates.py` keeps the timing, the process group, the timeout ladder, the bounded
drain and scrub-then-cap log writing. That machinery took four bolts to get
right and is not reimplemented per backend.

```python
class ExecutionBackend(Protocol):
    name: str
    def preflight(self) -> str | None: ...          # refusal, or None
    def spawn(self, gate, cwd, workdir) -> Spawn: ...
    def cleanup(self, workdir) -> None: ...
    def identity(self) -> dict: ...                # what goes in the evidence
```

**`local`** is today's behaviour to the byte: `shell=True` with the command
string, in the repo root, inheriting the whole environment. Not a compatibility
shim — the documented contract. A tool that ran your commands somewhere other
than where you pointed it would be lying about what it verified.

**`container`** is the same command inside an image the repository named.

**The backend governs GATES and nothing else.** §5 is that boundary, stated
loudly, because it is the one a reader will get wrong.

## 3. The record — `execution.json`, on every single run

A new sibling file (law 7; `wringer.evidence.v1` is frozen). **Written
unconditionally, unlike every other sibling in the bundle**, and that asymmetry
is the ruling this whole slice turns on.

Every other sibling — `vacuity.json`, `acceptance.json`, `stability.json` — is
conditional, because a reader who does not find one learns nothing either way.
This one is different in kind: **a reader who is not told where a command ran
will supply an answer, and the answer they supply is the flattering one.** So a
bundle nobody configured says `execution_mode: trusted_local` out loud, and
that is most bundles.

The word is `trusted_local`. **Never `sandboxed`, never `isolated`, never
`secure`.** A test asserts that no value the published enum can hold contains a
synonym for isolation, pinned against the schema rather than against one
instance — a future third backend inheriting a flattering word is the failure
being guarded, and it would not be written in that test.

A bundle written before this file existed does not have it, and a reader must
read absence as `unknown` rather than as either mode.

## 4. What the container backend must do, and where each is enforced

Every one of these is a flag in the argv, and every one has a test naming the
PROPERTY rather than the flag — a test called "the argv contains `--network
none`" would survive the flag being moved somewhere it does nothing.

| Requirement | How | Enforced by |
|---|---|---|
| explicit repo mount | `--volume <repo>:/workspace --workdir /workspace`, exactly one mount | `test_the_repository_is_mounted_explicitly_and_nowhere_else` |
| explicit env allowlist | `--env NAME` per declared name, **never `--env NAME=VALUE`** | `test_the_environment_is_an_allowlist_of_names_and_never_values` |
| no host SSH / cloud / forge credentials | an allowlist, so they are absent by CONSTRUCTION — there is no denylist to keep up to date, and one mount means `~/.ssh` and a docker socket are not reachable through a path Wringer named | `test_nothing_is_inherited_that_was_not_named` |
| network off by default | `--network none` unless `network: true` | `test_the_network_is_off_unless_the_repository_asked_for_it` |
| wall-clock timeout | the gate's own `timeout`, unchanged — `gates.py` already enforces it by SIGTERM→SIGKILL on the process group | the existing timeout tests |
| process cleanup | `--cidfile` in the gate's log directory, then `<runtime> rm --force <cid>` after the kill | `test_cleanup_kills_the_container_the_cidfile_names`, `test_a_timeout_reaches_the_backends_cleanup` |
| captured stdout/stderr | unchanged: through a pipe, scrubbed before write | the existing capture tests |
| backend identity in evidence | `identity()` → `execution.json`, including the RESOLVED runtime path | `test_the_container_identity_records_the_resolved_runtime_path` |

`--env NAME` rather than `--env NAME=VALUE` is not a style choice. **An argv is
readable by anyone who can run `ps`.** The runtime reads the value from
Wringer's own environment, so a credential handed to a gate never becomes
world-readable, and the two forms differ by exactly that.

`--cidfile` rather than `--name` because the gate's log directory is already
unique per attempt, so the id is unique by construction — no naming scheme to
collide under a fleet or a bench, and the file is evidence a reader can follow
to the container that produced those logs.

### The rulings

1. **`image` is required and has no default.** The `judge.endpoint` rule: Wringer
   runs the image you wrote down, never one it guessed. A moving tag Wringer
   chose would put "ran in a container" in the evidence with nobody having
   decided which container. `ghcr.io/marcoakes/wringer:main` is documented so it
   can be copied.
2. **`execution.backend: local` may not carry any other key.** A config that
   names an image while running gates on this machine reads as isolated when it
   is not — the single most dangerous thing this section could be allowed to
   say, and the cheapest to refuse.
3. **`user` is offered, not applied.** Absent means the image's own declared
   user (uid 1000 in the published image, and its author wrote down why).
   Overriding that silently would contradict an image this repo does not own at
   run time. A Linux bind mount owned by another uid is the case that needs it;
   `wring doctor` is where the value comes from. Digits and one optional colon
   only — it reaches the runtime positionally, so the `deliver.remote` lesson
   applies (a value starting with `-` would be read as a flag).
4. **Apple's `container` is refused by name, with the reason.** Its flag surface
   has not been verified against this argv, and the failure mode of guessing is
   the worst available: a silently-ignored `--network none` writes
   `network: false` into the evidence while the network is up. Docker, podman and
   nerdctl share one argv builder because they are deliberately-compatible CLIs.
   Running the image by hand under Apple's `container` is unaffected and still
   documented — Wringer just will not generate its argv.
5. **A repository path containing `:` is refused.** `-v` splits on it, so such a
   path would mount something nobody named, silently. Legal on macOS and Linux,
   so it is checked rather than assumed away.
6. **A backend that cannot run here refuses before any gate does, and exits 2.**
   Same class as an invalid `.wringer.yaml`, because that is what it is: the file
   names an environment this machine is not. No bundle is written — one that
   proves nothing is worse than none.
7. **A command that cannot be STARTED records exit 127, in both backends.**
   Found by reverting ruling 6's guard and reading what happened:
   `shell=True` hands a missing command to a shell, which reports 127 and raises
   nothing, while `shell=False` with an argv raises `FileNotFoundError` straight
   out of the verifier — abandoning a half-written bundle with a traceback
   instead of a verdict. 127 is what the shell already reports and what
   `health.genuine_failure` singles out as "nothing ran, so nothing
   discriminated", which is the exact truth. A gate that never started must
   never read as evidence that the gate CAN fail.

## 5. What is NOT contained, said at full volume

**`run.worker` runs on the host.** Always. The container backend contains gates.

The reason is in the published image's own Dockerfile: it ships no coding agent,
from any vendor, deliberately — *"baking a vendor's CLI in here would make
'vendor-neutral' true only in the prose"* — and its comment already says the
consequence, that a loop inside the image works only if the declared worker is
itself reachable from the container. Containing the worker with the published
image would therefore break every real loop.

The scope is principled rather than convenient: the threat SECURITY.md names is
a **repository's declared gates** running on your machine, and that is exactly
what is now containable. But `run.worker` is also read from `.wringer.yaml`, so
the gap is real: `wring run` on an untrusted repository still executes that
repository's worker command on the host, under a config that says `container`.

So `execution.json` records `worker_execution` **separately**, and it says
`trusted_local` whenever the repo declares a worker at all. A single
`execution_mode` covering both would be the one field in this file capable of
lying, and it would lie in the direction of claiming more.

## 6. Collisions with the prove pass and with worktrees

A git **worktree**'s `.git` is a *file* pointing into the main repository's
`.git/worktrees/`. The container mounts one directory, so a worktree mounted
alone is a broken repository: every gate that touches git fails there, on the
environment rather than on the code.

For the prove pass that is not merely broken, it is **inverted**.
SPEC_VACUITY_V0 §1's comparison table reads a pre-change failure as PROOF, so a
false `proven` would fire on every run however tautological the tests — the same
trap `run.prove_setup` exists to close one layer down.

- **`--prove` (or `run.prove`) under the container backend records
  `inconclusive`.** That is exactly what the verdict already means: *the
  measurement could not be made honestly*. It is never `proven`, never silently
  dropped, and `wring deliver` treats it as it treats any other inconclusive.
- **`fleet.worktree: true` + `execution.backend: container` is a config error**,
  refused where the two keys meet so that no gate has to fail to discover it.

## 7. What is measured, and what is not

**This is the section to read before quoting anything above as a security
property.**

Measured, and pinned by tests: the argv Wringer builds. Every flag, on every
runtime it accepts, plus every refusal. That is a fact about *Wringer*.

**Not measured: anything a container runtime does with that argv.** No container
has ever run through this backend. The maintainer's machine has no container
runtime — no docker, podman, colima, nerdctl or lima — and installing one needs
a password this window does not have.

So:

- `docs/MANUAL_CHECKS.md` **sequence G remains unrun**, and its coverage row
  still says so.
- **SECURITY.md's "designed to isolate" is unchanged.** An argv is not a
  measurement. Upgrading that sentence on the strength of a flag would be
  precisely the defect this repository exists to catch, committed by the tool
  itself.
- Nothing anywhere claims `prevented` for a container property. `prevented`
  means the thing cannot be done, and nobody has tried.

What did change: sequence G is now **one command**, `sh scripts/sequence-g.sh`,
which drives the seven attacks as gates through the real backend so it measures
the argv that actually ships rather than a bespoke command line. **It refuses
rather than skips** — with no runtime it exits 2 and records nothing, because a
checklist reporting no failures because it ran no attacks is the advert sequence
G's own last line warns about. Run on this machine, 2026-08-12, it exited 2.

## 8. What this does NOT do

- **The worker is never contained** (§5). The gap is recorded, not closed.
- **`wring bench` and the pre-change pass always run gates locally.** Both work
  in worktrees (§6). `bench` is not even offered the backend; that is a decision
  with no test asserting the negative, and a future slice that gives benches
  their own container has to solve the `.git` problem first.
- **No image digest is recorded.** `identity()` records the image string as
  declared and the resolved runtime path. Resolving a digest means asking the
  runtime, and nothing in a verification should spawn a process to decorate a
  record.
- **No runtime version is recorded**, for the same reason.
- **`--user` is not defaulted to the host uid.** Ruling 3. A Linux bind mount
  owned by another uid needs `execution.user` typed by hand, and a user who does
  not know that will get a permission error rather than a clear message.
- **Nothing restricts the local backend.** It is the same `shell=True` it always
  was. This slice adds a choice; it does not narrow the default, and narrowing
  it would break every repository that has one.

## 9. DONE

- [x] `ExecutionBackend` with `local` and `container`.
- [x] `local` records `execution_mode: trusted_local`, on every run, and no
      value the schema allows reads as isolation.
- [x] Container: explicit mount, explicit env allowlist by NAME, network off by
      default with explicit opt-in, wall-clock timeout, cleanup that reaches the
      container, captured streams, identity in the evidence.
- [x] Host credentials absent by construction, not by denylist.
- [x] A missing runtime refuses before any gate runs and writes no bundle.
- [x] Both backends fail identically when a command cannot start (127).
- [x] `--prove` under a container is `inconclusive`, never `proven`.
- [x] `wring doctor` FAILS rather than warns when the config demands a runtime.
- [x] Sequence G is executable in one command, and refuses without a runtime.
- [x] Sequence G **unrun**; SECURITY.md's wording unchanged; no `prevented`
      claimed anywhere.
