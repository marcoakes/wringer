# Security

Wringer is young software (`0.3.0`). Read this before running
`wring verify` in a repository you did not write.

## Reporting a vulnerability

Use GitHub's private reporting: **Security → Advisories → Report a
vulnerability** on
[this repository](https://github.com/marcoakes/wringer/security/advisories/new).
That channel is private to the maintainer. Please do not open a public
issue for anything exploitable.

Expect an acknowledgement within a week. There is no bounty; there is
credit in the advisory unless you prefer otherwise.

Non-sensitive hardening ideas are welcome as normal
[issues](https://github.com/marcoakes/wringer/issues).

## `.wringer.yaml` is code

**`wring verify` executes the commands a repository declares, through a
shell, with your privileges.** That is the design — a gate is `make lint`
or `pytest -q`, and Wringer claims no more authority than you typing it.
The consequence is the same as `Makefile`, `package.json` scripts, or a
`.pre-commit-config.yaml`:

> Cloning an untrusted repository and running `wring verify` in it runs that
> repository's chosen commands on your machine. **Read its `.wringer.yaml`
> first.**

Wringer does not sandbox gates *itself*, and it never will — a tool that ran
your commands somewhere other than where you pointed it would be lying about
what it verified. **The container is the answer**, and since 0.2 it is a
supported, documented one rather than a suggestion.

Run the harness in the published image and a repository's gates execute
inside that container's isolation instead of against your home directory:

```bash
docker run --rm -v "$PWD:/workspace" ghcr.io/marcoakes/wringer:main verify
```

The same image runs under Apple's `container` on macOS 26 and as a
Kubernetes Job — see [docs/deployment.md](docs/deployment.md).

**Since SPEC_EXEC_V0 the config can ask for it per repository**, rather than
the whole harness being run in a box by hand:

```yaml
execution:
  backend: container
  image: ghcr.io/marcoakes/wringer:main
  network: false        # the default; `true` is the only way to switch it on
  env: [CI]             # NAMES only, and nothing not named is passed
```

Gates then run as `<runtime> run --rm --volume <repo>:/workspace --workdir
/workspace --network none --entrypoint /bin/sh <image> -c '<gate>'`, and
`execution.json` in every bundle records which backend ran and what it was
asked for. Two things that config does **not** buy, both stated at length in
SPEC_EXEC_V0 §5 and §7: **`execution:` contains gates and never the worker** —
`run.worker` runs on the host unless a separate `run.containment` section
contains it (SPEC_CONTAIN_V0), and `worker_execution` is recorded separately
saying which of those happened — and those flags buy only what the attacks below
actually measured, which is bounded and stated there rather than assumed here.

**What that is and is not.** It is meaningful isolation: a gate that deletes
`$HOME`, installs packages, or scribbles outside the repo hits the
container's filesystem, not yours. It is **not** a security boundary against
a repository you have chosen to run and actively distrust. The container has
your workspace mounted read-write by design — that is where evidence goes —
so a hostile gate can still corrupt the tree you gave it, and container
escapes exist. Treat it as the difference between a mistake and a disaster,
not as permission to run untrusted code.

Two things it does refuse. It will not verify outside a git repository
(exit `2`), because a verification claim with no commit behind it is
meaningless; and it will not verify while a merge, rebase, cherry-pick,
revert or bisect is half-finished (exit `3`), because the tree then
describes a state nobody chose. A gate id is also validated as a slug, so a
config cannot use it to write outside the run directory.

## What the evidence bundle contains

A bundle (`.wringer/runs/<run_id>/`) captures each gate's **full stdout and
stderr**, its command string, the repo's HEAD SHA, branch and dirty flag.

**Secrets are redacted before anything is written.** The values of
environment variables whose names match `*TOKEN*`, `*SECRET*` or `*KEY*` —
plus any pattern the repo adds under `evidence.redact.env` — are replaced
with `[REDACTED]` in gate logs, `diff.patch`, `status.txt`, recorded
commands and `evidence.jsonl`. This happens *before* the write, not as a
cleanup pass: the raw value never reaches the file. That is why gate output
travels through a pipe instead of straight to a file descriptor.

**What redaction does not do.** It knows about values that are in the
environment of the run. It cannot know about:

- a credential your gate reads from a file (or a vault) and then prints;
- a secret shorter than 6 characters, which is deliberately ignored — a
  two-character "secret" would match half the log and destroy the evidence;
- a token that appears only in a form the redactor never saw, e.g. base64 of
  the real value.

So the standing advice holds:

- `.wringer/` is gitignored by the template Wringer ships. Keep it that way.
- **Read a bundle before you attach it to a public issue or PR.**

Two further bounds on what a bundle can become: each captured stream is
capped (the tail is kept and the file states how many bytes were dropped),
and binary file contents never enter `diff.patch` — not even when the
repository's own `.gitattributes` defines a `textconv` driver that would
turn them into text.

## The execution boundary, stated precisely

*Added 2026-08-11 after the first real agent runs. Every claim here was
measured on this machine, and the ones that are **not** claims are marked as
loudly as the ones that are.*

**Local execution is `trusted_local`. It is not a sandbox, and this document
will not call it one.** A worker runs on your machine with your user's
reach. What follows is exactly what that does and does not bound.

### What IS bounded, and is tested

**An ACP agent gets a named environment, not your shell.** `acp.run_turn`
builds the child's environment from nothing: `PATH`, `HOME`, `LANG`, plus the
variables `run.worker.acp.env_passthrough` names. A cloud credential, a forge
token or an SSH agent socket sitting in your environment is **not** handed to
the agent unless a human wrote its name in `.wringer.yaml`.

`test_the_agent_gets_a_minimal_environment` proves it by making the agent
report the variable names it received. That test was previously vacuous —
it passed while the agent was handed `dict(os.environ)` — which is worth
knowing when weighing how much any untested claim here is worth.

**Paths Wringer serves are confined to the repository.** `fs/write_text_file`
and `fs/read_text_file` resolve inside the root or are refused, symlinks
included.

### What is NOT bounded, measured rather than assumed

**An ACP agent's own filesystem access is unrestricted.** Measured
2026-08-11: a real agent edited the repository through its own tools and
called `fs/write_text_file` **zero times**, so the confinement above never
executed. It cannot execute against any agent that can open a file itself,
which is every agent worth running. **Any file your user can read, the agent
can read** — including `~/.ssh`, `~/.aws` and a Docker socket.

**A shell worker inherits your whole environment**, exactly as a `Makefile`
target does. `.wringer.yaml` is arbitrary code by design, and that is the
same statement in a different place.

**Network access is not restricted** in local execution.

### What the container path has been measured to do, and where it stops

*Corrected 2026-08-15. Until this date the section below said the container
path had **never been adversarially tested** and that sequence G was **unrun**.
Both sentences were false, and had been for two days: sequence G ran and was
classified on 2026-08-13 (twice) and on 2026-08-14. `backend.LIMITS` was
corrected for exactly this on 2026-08-13 and this page was not, because nothing
derived one from the other. `tests/test_security_isolation_ledger.py` is now
that derivation. **Understatement is also a stale claim**, and this is the
second time this repository has paid for that lesson.*

The published image (`SETUP.md`) runs Wringer with an explicit repository
mount, and the `execution:` backend above asks a runtime for that mount plus
`--network none` and an environment allowlist. That is a real boundary and it is
the one to use for untrusted repositories.

**It has been adversarially tested.** `docs/MANUAL_CHECKS.md` sequence G drives
seven named attacks as gates through the real backend, and **refuses rather than
skips** when no runtime is present. The coverage record in that file is the
ledger, and this table may not disagree with it:

| sequence | platform | runtime | date | worker | what the attacks found |
|---|---|---|---|---|---|
| G | macOS | podman | 2026-08-13 | gates (shell) | 6 prevented, 1 mitigated |
| G | Linux | podman | 2026-08-13 | gates (shell) | 6 prevented, 1 mitigated — on a host whose kernel the container **shares** |
| G | Linux | docker | 2026-08-14 | gates (shell) | 6 prevented, 1 out_of_scope |
| I | macOS | podman | 2026-08-15 | shell worker | 8 worker probes, 6 flipping against a `--privileged` control |
| I | macOS | podman | 2026-08-15 | ACP agent | 10 probes; **7 of the 8 attack probes flip** against the control, and the 8th is the model API, which must not flip |

**What the prevented attacks cover**: no host SSH keys, no host gitconfig or
`.git-credentials`, no Docker socket, no host credential in the environment
beyond the names `execution.env` declares, a process table bounded to the
container's own namespace, and `--network none` holding against **both** a name
and a raw address.

**The seventh attack is the one to read.** `cat /etc/shadow` was
`Permission denied` under the published image and **succeeded** under
`python:3-slim` — the container's own file, no host secret, recorded
`out_of_scope`. The barrier in the first two rows was the image's own
`USER wring`, which **Wringer does not set**. Wringer sets no `--user` unless a
config asks for it, so the privilege a gate holds inside the container is the
**image's** choice, and an image that runs as root gives it root.

**This still does not say "demonstrated to isolate", and the reasons are
specific rather than cautious.** Seven scripted reads are not an escape suite:
nothing attempted a kernel exploit, a capability abuse, a cgroup or
`/proc/sys` write, or a container escape. **There is no `--privileged` control
run for sequence G**, so nothing here shows that these flags are what stopped
the attacks rather than something else — that control is the cheapest honest way
to show it and for the *gate* path it has never been done. `prevented` means
*the thing cannot be done*, the classification is a human's and no test replaces
it, and a result is a fact about one platform, one runtime and one image.

**Sequence I is a different boundary and does not extend these rows.** It
measures the WORKER under `run.containment` (SPEC_CONTAIN_V0), which is a
different mechanism — a netns holder the worker joins without `NET_ADMIN` — and
it carries the `--privileged` control run sequence G lacks, the first in this
repository. Its capture is `docs/containment-2026-08-15.md`. It is macOS and
podman only, so it says nothing about Linux or Docker, and it says nothing about
the gate path above.

**Do not read an ordinary container as VM-strength isolation.** It is not,
and no configuration in this repository makes it so. On macOS a Linux VM sits
between the container and the host, so **every macOS row above is evidence about
container ⇢ VM isolation and not about the Linux case** — which is why the
shared-kernel Linux row was run separately rather than inferred.

## Who may do what — the authority model

*Added 2026-08-11 (programme §16). Every row states what ENFORCES it, and
the classification is the programme's own vocabulary: `prevented` means the
thing cannot be done, `detected` means it can be done and will be found.
**Never `prevented` where Wringer merely records evidence afterwards.***

| authority | who holds it | what enforces it | class |
|---|---|---|---|
| produce a change | the worker | — | by design |
| approve a specification | a human, by editing the file | `approved: false` is written as a CONSTANT; a reply carrying an `approved` key is refused outright. There is no `--yes` | **prevented** |
| answer an open question | a human | a reply that answers its own open question is refused, whole | **prevented** |
| install a gate or a criterion binding | a human, by applying a diff | `wring plan` prints the diff and stops; nothing in the program applies it | **prevented** |
| call a criterion `evidenced` | nobody — it is derived | the bound gate must pass now, the record must show it can fail, and (2026-08-11) the gate must pre-date the change it judges | derived |
| authorise delivery | a human, per invocation | `--send` is typed on the command line; no file may carry it, and a graph file that tries is a named error | **prevented** |
| write git history | `deliver.py`, and only there | five refusals, each with a test that fails without it: only on `--send`, only onto a branch it created, never the default branch, never a force push, ledger event before each write | **prevented** |
| **rewrite evidence already on disk** | **a worker can** | nothing stops it — a worker has the filesystem access its own tooling gives it, measured 2026-08-11. `digests.json`, the `prev_hash` ledger chain and `wring audit` make it **findable** | **detected, NOT prevented** |
| sign an attestation | a person typing `--sign` in CI; the identity is the runner's ambient OIDC, never a key Wringer holds | `wring attest --sign` shells out to `cosign`/`gh` for keyless Sigstore signing and writes the sibling `attestation.json.sig` (`sign.py`); `can_sign_here` refuses off-CI, where the keyless flow would need an interactive browser login, so `signature_missing` is the ordinary local result and exits 0. **Caveat, in this row on purpose: the signer path has been exercised only against a stub signer and has never run against live Sigstore.** | offered, CI only |

**The row that matters is the one in bold.** Wringer's evidence is
tamper-EVIDENT, not tamper-PROOF. A worker that can write files can edit a
bundle written an hour ago; what it cannot do is make the edit undetectable,
because the digests and the ledger chain are checked by a reader who was not
there. If you need prevention rather than detection, the evidence has to
leave the machine the worker runs on — and Wringer does not do that for you.

**Every row above is parsed and probed by
[`tests/test_security_capabilities.py`](tests/test_security_capabilities.py)**,
added 2026-08-15 with the signing row's correction, in the same commit as it.
The signing row had been wrong on three counts at once — it said the
capability was not offered, that it was unsigned *by ruling* (that ruling was
reopened by [SPEC_SIGN_V0.md](SPEC_SIGN_V0.md)), and that
`attestation.json.sig` was reserved and unused while `sign.py` had been
writing it since 2026-08-12 — and it stayed wrong because a hand-kept table
had no relationship to the program that a test could check. Now a row
claiming a capability is not offered must ship a probe showing the entrypoint
absent or refusing, a row claiming one is offered must ship a probe exercising
it, and **a row with no probe at all fails the suite**. The honest limit is
stated in that file's docstring: the row→probe map is written by hand once.
What the check buys is that gaps in the map are loud.

## What Wringer never does

- **Nothing that proves anything touches a network, and nothing leaves this
  machine without a flag you typed.** `wring verify`, `wring run`,
  `wring resume`, `wring fleet`, `wring plan`, `wring explain`,
  `wring attest` (without `--sign`) and `wring audit` (without
  `--verify-signature`) make no outbound connections — nothing is
  uploaded, phoned home, or telemetered, ever, by design, in every release.
  Those two flags are the exceptions and each says so at the point of use.

  **Five commands SEND, each behind a flag you type:** `wring judge`,
  `wring spec`, `wring deliver`, `wring graph run --send` (or
  `wring graph resume --send`), and `wring attest --sign` — which shells to a
  keyless signer that reaches Sigstore, holds no key, and refuses outside CI
  where no OIDC identity is ambient. Each exists only when your repo declares
  the section it needs (`judge:`, `forge:` or `deliver:`), each defaults to
  building the request and sending nothing, and **each writes the exact bytes
  to disk before it opens a socket**, so what left the machine is auditable
  rather than asserted. Plain `http://` is refused to anything but loopback,
  redirects are not followed, and a key named by `judge.api_key_env` or
  `forge.token_env` has its value folded into the redactor so it cannot reach
  any artifact.

  The fourth arrived in P7 and is the narrowest of the four. A `deliver` node
  in a graph reaches a network only by calling the same `deliver.send` a
  person would have called by hand — a `git push`, in a subprocess, through
  every one of delivery's five refusals. It opens **no socket of its own** and
  opens **no merge request**. The flag is typed on the invocation and
  authorises the deliver node that invocation reaches, once; a graph file may
  not declare it and a decision file may not carry it, because a file is not a
  typed flag. Resuming a parked graph means typing it again.

  **Three commands FETCH**, and are not behind a flag because fetching is
  their entire purpose: `wring get` clones a repository, `wring issue` reads
  one issue, and `wring start --clone` clones one — then **stops**, because a
  fresh clone is untrusted input and it will not run a stranger's gates in
  the same breath as downloading them. Typing any of the three is itself the
  decision to reach a network.

  **One config section RESOLVES, and it is stated here rather than left to be
  discovered.** `run.containment.egress.policy: allowlist` (SPEC_CONTAIN_V0)
  builds a firewall allowlist for a contained worker, and an allowlist of
  hostnames has to become an allowlist of addresses before it can be enforced
  — so `wring run` starts the broker container and resolves the declared
  hosts **inside it**, which issues a DNS query. That is a packet caused by
  `wring run`, and the paragraph above would otherwise say it never happens.

  Four bounds on it, each of which is why this is a sentence rather than a
  retraction. It happens **only** when a repository declares that policy;
  the names resolved are **only** the ones the repository wrote down; the
  resolved addresses are **written into the bundle** (`worker_execution.
  established.egress.resolved`), so what was asked is auditable rather than
  asserted; and `wring verify` does **not** do it — the containment checks it
  performs are the static ones, which cost no process and no packet, exactly
  so that this sentence stays true of `verify`. Nothing is uploaded and
  nothing is phoned home: a DNS query for a host the repository named is the
  whole of it.

  This is also why `tests/test_network_surface.py` is not the guard here and
  does not pretend to be: it parses Python for `urllib` call sites, and a
  container runtime invoked as a subprocess is invisible to it. The guard for
  this paragraph is the same one that guards the rest of it —
  `tests/test_docs.py` discovers every document that enumerates senders and
  fetchers and fails when one stops naming a command that can reach a network.

  **Every socket in the program lives in two functions** — `judge.send` and
  `forge.request` — and a third would be a review comment.
  `tests/test_network_surface.py` is what enforces that: it parses every
  module, resolves each call through that module's own imports, and asserts
  both which functions contain a network call and that there are exactly two
  such calls.

  This paragraph used to promise a grep count instead, and **the promise was
  false**: the command it named counted its own documentation, so it returned
  five. Spelling the call out in full does not fix it — the corrected
  docstrings become hits too. A grep is not available as the check here, in
  any spelling, which is why the check parses.

  This paragraph is the one SPEC_GET_V0 §7 and SPEC_START_V0 §3e-i enumerate,
  and it is restated whenever a command changes it rather than quietly kept —
  by `wring start` in P4 and by the graph's deliver node in P7. Both
  restatements are guarded: `tests/test_docs.py` discovers every file that
  counts senders or fetchers and fails when one of them stops naming a
  command that can reach a network.
- **No writes outside the repo.** Evidence goes to `.wringer/runs/` under the
  detected git root. Gate ids are validated as slugs precisely so a config
  cannot direct a write outside the bundle.
- **No credential is ever read from a config file, stored, or relayed.** A repo names an environment *variable*; Wringer reads its value at runtime, folds it into the redactor so it cannot reach an artifact, and passes it to one request. Git's own credential helper answers for git — Wringer never sees that one at all.

  *Wringer never stores a credential.* `wring start` will ask for your API
  key so it can hand it to the build it launches; it keeps it in memory for
  that session, folds it into the redactor so it cannot reach a bundle, and
  writes it nowhere. Your config records the *name* of an environment
  variable, never a key. Nothing else in Wringer ever asks.

  There is deliberately **no `--key` flag**: a value on a command line is a
  process listing anyone on the machine can read. Its non-interactive form is
  the variable already being set, which is how every other command here
  receives one. And `wring start` prints the command to make it durable
  rather than running it — storing a credential is a larger power than
  launching a build.
- **Read-only git, except one command.** Wringer reads git state with read-only
  commands and never authenticates anywhere.

## Supported versions

Pre-1.0, **only the newest release and the tip of `main` are supported.**
Fixes land on `main` and reach you in the next release; nothing is
backported to an older one.

| Version | Supported |
|---|---|
| `main` | ✅ |
| `0.3.0` (PyPI, current) | ✅ |
| `0.2.0` (PyPI) | upgrade — `pip install -U wringer` |
| `0.1.0` (PyPI) | upgrade — `pip install -U wringer` |
| `*.dev*` (git installs) | reinstall from `main` or PyPI |

Upgrading from 0.1.0 or 0.2.0 needs nothing: `wring verify` behaves as it did, its
bundles stay readable, and every command added since is opt-in. See
[CHANGELOG.md](CHANGELOG.md).
