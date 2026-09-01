"""Where a gate's command actually runs — docs/specs/SPEC_EXEC_V0.md.

`.wringer.yaml` is code. `wring verify` runs the commands a repository declared,
through a shell, with the invoking user's privileges, and SECURITY.md has always
said so plainly. This module is the seam that lets a repo say *somewhere else*
instead, without Wringer ever pretending the default is something it is not.

Two backends:

- **`local`** — today's behaviour, unchanged to the byte: `shell=True` in the
  repo root, inheriting the whole environment. Recorded in the evidence as
  `execution_mode: trusted_local`. **Never `sandboxed`, never `isolated`.** A
  reader who is not told where a gate ran will assume the safer answer, and the
  assumption is wrong in the dangerous direction — so the bundle says the
  unflattering thing out loud, on every run, opt-in or not.
- **`container`** — the same command inside an image the repo named, with an
  explicit mount, an explicit environment allowlist, and the network off unless
  the repo asked for it.

**This module changes where GATES run and nothing else.** `run.worker` is a
command too, and it is *not* contained: the published image deliberately ships
no coding agent, so an agent worker cannot run inside it, and pretending
otherwise would break every real loop. §5 of the spec is that gap stated at
full volume, and `execution.json` records the two modes separately so a bundle
can never be read as claiming more than it measured.

**What is measured here and what is not.** Every argv this module builds is
pinned by tests, so what Wringer ASKS the runtime for is a fact. Whether the
runtime delivers it is a different claim, and on 2026-08-13 it stopped being
entirely unmeasured: `docs/MANUAL_CHECKS.md` sequence G ran seven named attacks
under rootless podman, first on macOS and then inside a Linux guest whose
kernel the container shares, and six of the seven were prevented — including
private key material that really was on that host.

**That still does not upgrade "designed to isolate", and the reason is worth
keeping next to the argv.** Seven scripted reads are not an escape suite:
nothing attempted a kernel exploit, a capability abuse, a cgroup or
`/proc/sys` write, or a `--privileged` control run to prove these flags are
what stopped them. One runtime, one distro, one image; docker remains
unmeasured by anyone. Nothing in this file, and nothing in SECURITY.md,
upgrades the claim on the strength of an argv.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from wringer import containment as _containment
from wringer import evidence
from wringer.config import Execution, Gate

LOCAL = "local"
CONTAINER = "container"

# The word that goes in the evidence for the local backend, and the reason this
# module exists. "local" says where; this says what it is worth.
TRUSTED_LOCAL = "trusted_local"
# And the container's. Deliberately not "sandboxed" either: what a bundle can
# honestly claim is that the command was handed to a container runtime with a
# named image and a stated argv, which is what this word means and no more.
CONTAINED = "container"

# Where a repository is mounted inside the image. Matches the published
# Dockerfile's WORKDIR and its `safe.directory` scoping, both of which are
# written against this exact path — a different mount point would make git
# refuse the tree as dubiously owned and every gate would fail on that instead
# of on the code.
WORKSPACE = "/workspace"

# The shell the command runs under inside the container. `sh -c` rather than
# `bash -c` because the published image is Debian slim and POSIX sh is the one
# shell every candidate base guarantees; it is also the closest match to what
# `shell=True` gives locally, which is what makes a gate's command mean the
# same thing in both backends.
CONTAINER_SHELL = "/bin/sh"

# Where the runtime writes the id of the container it started. Inside the
# gate's own log directory, so it is unique per attempt by construction — no
# naming scheme to collide, and no `--name` to guess. It is also EVIDENCE: a
# reader can see which container produced these logs.
CIDFILE = "container.cid"

# Runtimes whose command line is the Docker CLI's. All three are
# deliberately-compatible reimplementations, so one argv builder is correct for
# every one of them rather than three dialects that drift.
#
# Apple's `container` is NOT here, and its absence is a ruling rather than an
# oversight (SPEC_EXEC_V0 ruling 4). Its flag surface has not been verified
# against this argv, and the failure mode of guessing is the worst one
# available: a silently-ignored `--network none` writes `network: false` into
# the evidence while the network is up. A refusal is a worse day and an honest
# record; that trade is the whole repository.
_DOCKER_DIALECT = {
    "docker": "docker",
    "podman": "podman",
    "nerdctl": "nerdctl",
}
RUNTIMES = tuple(sorted(_DOCKER_DIALECT))

# `execution.user` reaches argv POSITIONALLY as `--user <value>`, so a value
# beginning with `-` would be read as an option — the `deliver.remote` lesson
# (SPEC_GET_V0 §1's third condition), one module over. Digits and at most one
# colon: a uid, or a uid:gid. Nothing else can be spelled.
USER_PATTERN = re.compile(r"\d+(?::\d+)?")

# How long the cleanup call gets. It runs after a gate has already overrun its
# timeout, so a cleanup that hangs turns one late gate into a wedged verifier —
# and `wring verify` must always return, which the v0.2 loop depends on more
# than a human does.
CLEANUP_TIMEOUT_SECONDS = 20


class BackendError(Exception):
    """The declared backend cannot be used here (CLI exit code 2)."""


@dataclass(frozen=True)
class Spawn:
    """How to start one command: exactly what `gates.run` hands `Popen`.

    Deliberately thin. The backend decides WHAT to spawn; `gates.py` keeps the
    timing, the process group, the timeout ladder, the bounded drain and the
    scrub-then-cap log writing — machinery that took four bolts to get right
    and must not be reimplemented once per backend.
    """

    args: str | list[str]
    shell: bool


@dataclass(frozen=True)
class Local:
    """Today's behaviour, and the only backend that existed before this file.

    `shell=True` with the command string, in the repo root, inheriting the
    caller's whole environment. Not a compatibility shim — it is the documented
    contract: a tool that ran your commands somewhere other than where you
    pointed it would be lying about what it verified.
    """

    name: str = LOCAL

    def preflight(self) -> str | None:
        return None

    def spawn(self, gate: Gate, cwd: Path, workdir: Path) -> Spawn:
        return Spawn(args=gate.run, shell=True)

    def cleanup(self, workdir: Path) -> None:
        return None

    def identity(self) -> dict[str, Any]:
        return {"backend": LOCAL, "execution_mode": TRUSTED_LOCAL}


@dataclass(frozen=True)
class Container:
    """The gate's command inside an image the repository named.

    Every property the spec requires is a flag in `argv`, and every one of them
    is pinned by a test — because an argv is the only part of this that can be
    checked without a container runtime, and the difference between "we ask for
    this" and "this holds" is the difference sequence G exists to close.
    """

    settings: Execution
    name: str = CONTAINER

    def preflight(self) -> str | None:
        """Why this backend cannot run here, or None.

        Checked before any gate runs. A missing runtime discovered on gate 1 of
        9 has already cost the run; discovered here it costs a sentence.
        """
        binary = _DOCKER_DIALECT.get(self.settings.runtime)
        if binary is None:  # pragma: no cover - config.parse refuses it first
            return (
                f"'execution.runtime: {self.settings.runtime}' is not a runtime "
                f"Wringer builds a command line for (it knows: "
                f"{', '.join(RUNTIMES)})"
            )
        found = shutil.which(binary)
        if found is None:
            return (
                f"'execution.backend: container' needs {binary} on PATH and "
                f"there is none. Install it, point 'execution.runtime' at a "
                f"runtime you have ({', '.join(RUNTIMES)}), or drop the "
                f"'execution:' section to run gates on this machine — which is "
                f"what every run did before you added it"
            )
        return None

    def spawn(self, gate: Gate, cwd: Path, workdir: Path) -> Spawn:
        return Spawn(args=self.argv(gate, cwd, workdir), shell=False)

    def argv(self, gate: Gate, cwd: Path, workdir: Path) -> list[str]:
        """The whole command line, as a list a reviewer can read top to bottom.

        A pure function of the config, the gate and two paths — no clock, no
        environment read, no runtime call — so a test can assert every flag on
        a machine with no container runtime at all. That is deliberate: it is
        the one half of this feature that CAN be proven here.
        """
        binary = _DOCKER_DIALECT[self.settings.runtime]
        mount = _mount_source(cwd)
        args = [
            binary,
            "run",
            # Delete the container when it exits. Without this a verifier that
            # runs nine gates leaves nine dead containers per run, and a
            # week-old repo has thousands.
            "--rm",
            # The container id, so a timeout can kill what it started. In the
            # gate's own log directory: unique per attempt by construction,
            # and evidence a reader can follow.
            "--cidfile",
            str(workdir / CIDFILE),
            # The repository, mounted read-write BY DESIGN and not by
            # oversight: the evidence bundle is written into `.wringer/` inside
            # the tree, so a read-only mount fails late and confusingly. It is
            # also the honest limit of this boundary — a hostile gate can still
            # corrupt the tree you handed it.
            "--volume",
            f"{mount}:{WORKSPACE}",
            "--workdir",
            WORKSPACE,
        ]
        if not self.settings.network:
            # OFF BY DEFAULT, and this is the flag that says so. `network:
            # true` in the config is the only thing that removes it, which is
            # what "explicit opt-in" means when written down rather than
            # promised.
            args += ["--network", "none"]
        if self.settings.user is not None:
            args += ["--user", self.settings.user]
        for name in self.settings.env:
            # `-e NAME`, never `-e NAME=VALUE`. The runtime reads the value
            # from Wringer's own environment, so the value never enters an
            # argv — and an argv is visible in `ps` to every user on the
            # machine. A credential passed to a gate must not be readable by
            # anyone who can run `ps`, and the two forms differ by exactly
            # that. A name that is unset here passes nothing, which is the
            # right answer rather than an empty string.
            args += ["--env", name]
        args += [
            # The image's own ENTRYPOINT is `wring`; the gate is a shell
            # command, not wring's argv, so it has to be replaced.
            "--entrypoint",
            CONTAINER_SHELL,
            self.settings.image,
            "-c",
            gate.run,
        ]
        return args

    def cleanup(self, workdir: Path) -> None:
        """Kill the container this gate started, if it is still up.

        `gates.py` kills the process GROUP on a timeout, which reaches the
        runtime client and not the container it asked for — on most runtimes
        the container keeps running with nothing attached to its streams. The
        gate would then be "killed" while its work carried on against the
        mounted tree, which is the timeout not being enforced at all.

        Total by construction: every failure here is swallowed. This runs on
        the way out of an already-failed gate, and an exception would replace a
        gate's real verdict with a cleanup error.
        """
        cid_path = workdir / CIDFILE
        try:
            cid = cid_path.read_text(encoding="utf-8").strip()
        except OSError:
            return
        if not cid:
            return
        binary = _DOCKER_DIALECT.get(self.settings.runtime)
        if binary is None:  # pragma: no cover - refused at parse
            return
        try:
            subprocess.run(
                [binary, "rm", "--force", cid],
                capture_output=True,
                timeout=CLEANUP_TIMEOUT_SECONDS,
            )
        except (OSError, subprocess.SubprocessError):
            return

    def identity(self) -> dict[str, Any]:
        """What went into the evidence about where these gates ran.

        The RESOLVED runtime path, not just its name: two machines with
        `runtime: docker` can be running very different things, and a bundle
        that says only "docker" cannot tell them apart. Version is absent
        rather than guessed — reading it means running the binary, and nothing
        in a verification should spawn a process to decorate a record.
        """
        binary = _DOCKER_DIALECT.get(self.settings.runtime)
        return {
            "backend": CONTAINER,
            "execution_mode": CONTAINED,
            "runtime": self.settings.runtime,
            "runtime_path": shutil.which(binary) if binary else None,
            "image": self.settings.image,
            "mount": WORKSPACE,
            "network": self.settings.network,
            "env_allowlist": list(self.settings.env),
            "user": self.settings.user,
        }


def _mount_source(cwd: Path) -> str:
    """The host path for `--volume`, refused if it cannot be spelled safely.

    `-v` splits its argument on `:`, so a repository at
    `/Users/me/weird:name/repo` would be parsed as a different mount entirely —
    silently, and in the direction of mounting something nobody named. Legal
    on macOS and Linux, so it is checked rather than assumed away.
    """
    resolved = cwd.resolve()
    text = str(resolved)
    if ":" in text:
        raise BackendError(
            f"the container backend cannot mount {text}: a ':' in the path "
            "would be read as a mount separator, and a mount nobody named is "
            "worse than a refusal. Move the repository, or run gates locally"
        )
    return text


def for_config(settings: Execution | None) -> Local | Container:
    """The backend a config asks for. `None` — no `execution:` — is `local`.

    Absence is not a default chosen here; it is the contract every run had
    before this module existed.
    """
    if settings is None or settings.backend == LOCAL:
        return Local()
    return Container(settings=settings)


SCHEMA_VERSION = "wringer.execution.v1"
# SPEC_CONTAIN_V0 ruling 4. Written ONLY where `run.containment` is declared;
# every other run stays on v1, byte-identical to what it wrote before this
# existed. Law 7, and the house precedent for a bumped version is a second
# schema file — `untracked-v2`, `loop-event-v2`, `bench-event-v2`.
#
# **The absence of a v2 record is the compatibility boundary.** A reader that
# knows only v1 and meets a v2 record must treat it as a version it does not
# know and decline to read it. That is the honest failure: the alternative is
# reading a `worker_execution: trusted_local` that is false.
SCHEMA_VERSION_V2 = "wringer.execution.v2"


def write(
    directory: Path,
    engine: Local | Container,
    gate_ids: list[str],
    worker: bool,
    containment: Any = None,
    established: Any = None,
) -> Path:
    """Write `execution.json` — where these gates ran, on every single run.

    **Unconditional, unlike every other sibling in the bundle.** The others are
    written only when the thing they describe happened, because a reader who
    does not find them learns nothing either way. This one is different in kind:
    a reader who is not told where a command ran will supply an answer, and the
    answer they supply is the flattering one. So the bundle says
    `trusted_local` out loud on runs nobody configured, which is most of them.

    `worker_execution` is recorded SEPARATELY and, on v1, always says
    `trusted_local` when the repo declares a worker — because it is true:
    this module contains gates and not the worker. A single `execution_mode`
    covering both would be the one field in this file capable of lying, and it
    would lie in the direction of claiming more.

    **`containment` is what makes this a v2 record** (SPEC_CONTAIN_V0
    ruling 4). Passing it does two things at once and both are deliberate: the
    schema version moves, so a v1 reader stops rather than misreads, and
    `limits` moves with it, so the record does not carry `LIMITS_V1`'s fourth
    row — *"run.worker is not contained … it always says trusted_local"* —
    inside the artifact certifying containment.

    `established` is present only when this lap actually stood a containment
    up (ruling 4a). Three of this function's four callers never start a
    holder, and a record claiming addresses that were never admitted would be
    a run claiming a containment it did not have.
    """
    if containment is None:
        payload = {
            "schema_version": SCHEMA_VERSION,
            **engine.identity(),
            "gates": gate_ids,
            # The worker is a command too, and it is NOT contained: the
            # published image ships no coding agent, so an agent worker cannot
            # run inside it (the Dockerfile says so in its own comment).
            # Recorded on every run rather than only on loops, because absence
            # would be read as "no worker was involved" when it means "this
            # file did not say".
            "worker_execution": TRUSTED_LOCAL if worker else None,
            "limits": list(LIMITS_V1),
        }
    else:
        recorded: dict[str, Any] = {
            "declared": _containment.declared_record(containment)
        }
        if established is not None:
            recorded["established"] = established.as_json()
        payload = {
            "schema_version": SCHEMA_VERSION_V2,
            **engine.identity(),
            "gates": gate_ids,
            "worker_execution": recorded,
            "limits": list(LIMITS_V2),
        }
    path = directory / evidence.EXECUTION_FILENAME
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


# What this record does NOT claim, travelling with it rather than living in a
# spec nobody opened — the pattern `health.LIMITS` and `accept.LIMITS` set. An
# execution record is exactly the artifact a reader will inflate into a
# security claim, and the container row is the one that would be inflated
# furthest.
#
# **V1 AND V2 ARE SEPARATE TUPLES, AND THE SPLIT IS NOT TIDINESS.** The fourth
# row below states "run.worker is not contained … worker_execution says so
# separately, and it always says trusted_local". That sentence is true of
# every v1 record and FALSE inside a v2 one — so a single shared tuple would
# ship a denial of the claim inside the artifact that certifies it, in the one
# field this repository invented so a record could state what it does not
# claim. Editing it in place was the other exit and it breaks v1's
# byte-identity, which is the compatibility promise ruling 4 makes. So:
# `LIMITS_V1` keeps the shipped SHAPE, forever, and `LIMITS_V2` says what a
# containment record does not claim. Found by the independent review of
# SPEC_CONTAIN_V0, which called it the most dangerous thing in the first draft.
#
# **What "frozen" governs here, ruled 2026-08-15 (R-B).** Law 7 protects
# PARSERS — field names, shapes, meanings — and no code anywhere dispatches on
# this prose; humans read it. So a `limits` sentence is correctable in place
# **when and only when a named, dated measurement in this repository makes it
# false**, with the guard edited in the same commit and the reason written in
# the guard's docstring. Shipping a known-false sentence into every new record
# is the worse breach, and it is the exact defect this tuple exists to prevent.
# Row two was corrected on 2026-08-15: it said "docker is still unmeasured"
# after sequence G ran and was classified on Docker on 2026-08-14, and it said
# "seven probes on one runtime" after three combinations had been measured.
# **Records already on disk are never rewritten** — they were true when written.
LIMITS_V1 = (
    "trusted_local means the gate ran on this machine with the invoking "
    "user's privileges and the whole environment inherited. It is not a "
    "sandbox and Wringer has never claimed it is one.",
    "A container backend records the command line Wringer ASKED the runtime "
    "for. Whether the runtime delivered it is a separate claim, now PARTLY "
    "measured: MANUAL_CHECKS.md sequence G "
    "(https://github.com/marcoakes/wringer/blob/main/docs/MANUAL_CHECKS.md) "
    "ran seven named attacks on "
    "three platform-and-runtime combinations — rootless podman on macOS and on "
    "a shared-kernel Linux host, and Docker on Linux CI — and six were "
    "prevented in each. Seven scripted reads are not an escape suite, and no "
    "--privileged control run has shown that these flags are what stopped "
    "them, so this file records a request, not a guarantee.",
    "The mount is read-write by design, because the evidence bundle is "
    "written inside the tree. A hostile gate can still corrupt the tree you "
    "gave it, and container escapes exist.",
    "run.worker is not contained. The published image ships no coding agent, "
    "so an agent worker cannot run inside it — worker_execution says so "
    "separately, and it always says trusted_local.",
)

# Kept so that anything still importing the old name gets v1's bytes, which is
# what it always got. Not a shim to be removed later: v1 is frozen, so this
# name means exactly one thing forever.
LIMITS = LIMITS_V1

# v1's first three rows, plus what a CONTAINED worker record cannot say. Row
# four of `LIMITS_V1` is deliberately absent — it is the row that would deny
# this record's own claim, and dropping it is the whole reason the tuples
# split. Everything the containment mechanism does not claim comes from
# `containment.LIMITS`, which lives beside the code that would have to change
# for any of it to stop being true.
LIMITS_V2 = LIMITS_V1[:3] + _containment.LIMITS


def host_user() -> str:
    """`uid:gid` of the invoking process, for a config that wants to say so.

    Offered rather than applied. The published image declares its own user
    (uid 1000) and its author documented why; overriding that silently would
    contradict an image this repo does not own at run time. A Linux user whose
    bind-mounted repo is owned by another uid needs `execution.user`, and this
    is the value they need — printed by `wring doctor`, not injected.
    """
    return f"{os.getuid()}:{os.getgid()}"
