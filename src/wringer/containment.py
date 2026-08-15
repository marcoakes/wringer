"""Where the WORKER runs — SPEC_CONTAIN_V0.md.

`backend.py` is the seam that lets a repository say a gate runs somewhere
else. This is the other half, and SPEC_EXEC_V0 §5 is the reason it needed
writing: *"`run.worker` runs on the host. Always. The container backend
contains gates."* That gap was recorded rather than closed, and the first
corpus run is what it cost — three arm-B rows fetched a `.patch`, a PR diff
and a post-fix source file, because an agent with a shell and a network can
go and read the answer (`docs/corpus-2026-08-13.md` §4).

**The key is `run.containment` and never `execution.backend`, and that is a
ruling rather than a preference** (SPEC_GATEGEN_V0 §6 W9). `vacuity.prove`
returns INCONCLUSIVE unconditionally when `execution.backend == "container"`
(`vacuity.py:161-187`), because a detached worktree's `.git` is a file.
Containment carried on that key would have made every witness in the
committed re-test `inconclusive`, and the money would have measured nothing.
Because the key lives here, `vacuity.py` never sees it and the prove pass is
untouched *by construction* rather than by care.

**Declaring is not establishing.** Everything in this module exists to make
that sentence true. A declaration that cannot be honoured refuses and exits 2
with a reason that names what was missing; it never degrades to
`trusted_local`, never warns and continues, and never writes a bundle.
Degrading to uncontained while claiming containment is the defect class the
whole programme exists to catch, and it would be committed by the module
written to close it.

**The refusals split.** STATIC ones cost no process and no packet — a
`which`, an `image exists`, an `image inspect` — so every command that reads
the config performs them, `wring verify` included, and a broken declaration is
found in CI rather than an hour into a corpus pass. DYNAMIC ones need a
container running and are performed only where a worker is about to run. The
split is not tidiness: establishing an allowlist means starting a holder and
issuing a DNS query, and SECURITY.md promises `wring verify` makes no outbound
connection.

**What is measured here and what is not.** The argv is a fact about Wringer.
Whether a runtime delivers it is a different claim, and
`docs/MANUAL_CHECKS.md` sequence I is where it is measured — per platform, per
runtime, per image. Nothing in this file upgrades SECURITY.md's wording, and
the `limits` this module contributes to the record say so in the record.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from wringer.config import Containment, EGRESS_ALLOWLIST

# **No witness import, and R-6's rule is whole again.** R-6 forbids this module
# knowing anything about the witness lane: containment is a boundary and the
# witness is a check, and a module that knows both is a module where the two
# vocabularies collapse. The shadow mount forced one narrow exception —
# `WITNESS_DIRNAME`, imported as a value so the shadowed path could not drift
# from the written path. P4-3 moved the bytes out of every repository root, the
# mount went with them, and the exception is gone. `tests/test_containment.py`
# asserts this file contains no witness identifier at all.

# Where the repository is mounted inside the worker image. The same path
# `backend.WORKSPACE` uses, and for the same reason: the published Dockerfile's
# WORKDIR and its `safe.directory` scoping are written against it, so a
# different mount point makes git refuse the tree as dubiously owned.
WORKSPACE = "/workspace"

# Where the worker's own `hosts` file is mounted, read-only. This is the
# mechanism `--add-host` cannot be: podman refuses extra host entries on a
# container joined to another container's network namespace, measured
# 2026-08-15 — *"cannot set extra host entries when the container is joined to
# another containers network namespace"*.
HOSTS_PATH = "/etc/hosts"

# The word that goes in the record for a contained worker. Deliberately NOT
# `backend.CONTAINED`, which already exists and holds the string "container":
# that is the GATE vocabulary, and two constants one letter apart with
# different meanings is a trap for a grep and for a bundle reader. Also not
# `sandboxed`, `isolated` or `secure` — the rule `backend.py:61-67` sets.
WORKER_CONTAINED = "contained"

# The container id files, in the loop's own directory so they are unique per
# attempt by construction and are EVIDENCE a reader can follow. A pgid file
# would be the wrong mechanism: a container has no host process group, and on
# macOS it lives inside the runtime's Linux VM.
WORKER_CIDFILE = "worker.cid"
HOLDER_CIDFILE = "holder.cid"

HOSTS_FILENAME = "hosts"

# The binary the netns holder must carry. Named here rather than inferred, so
# refusal 6 can say which binary in which image.
BROKER_BINARY = "iptables"

# Long enough for an image inspect or a container start on a cold runtime,
# short enough that a wedged runtime does not wedge the verifier. `wring
# verify` must always return.
PROBE_TIMEOUT_SECONDS = 60
CLEANUP_TIMEOUT_SECONDS = 20

# How long the holder stays up if nothing tears it down. A backstop, not the
# mechanism: `teardown` is called on the way out of every turn. Without it a
# SIGKILL of the loop would leave a container running with an armed allowlist
# and nobody to remove it.
HOLDER_MAX_SECONDS = 24 * 60 * 60

_DOCKER_DIALECT = {"docker": "docker", "podman": "podman", "nerdctl": "nerdctl"}


class ContainmentError(Exception):
    """The declared containment cannot be honoured here (CLI exit code 2).

    Every message names what was missing. There is deliberately no variant
    that means "carried on anyway".
    """


@dataclass(frozen=True)
class Established:
    """What was actually stood up, as opposed to what was declared.

    The distinction is the whole of SPEC_CONTAIN_V0 ruling 4a. `backend.write`
    runs once per verify lap and three of its four callers never start a
    holder, so a record with one flat block would have claimed addresses that
    were never admitted — a run claiming a containment it did not have.
    """

    runtime_path: str | None
    holder_cid: str | None
    resolved: tuple[str, ...]
    # Where the `hosts` file the holder wrote actually is. Carried HERE rather
    # than recomputed at spawn time, and that is not a style choice: the
    # holder is established once for the whole loop and lives in the loop's
    # own directory, while each turn's cidfile belongs in that turn's
    # iteration directory. Recomputing the hosts path from the per-turn
    # directory is exactly the bug the first canary run found — the mount
    # named a file one directory too deep, podman refused with `statfs …: no
    # such file or directory`, and the worker exited 125 having attacked
    # nothing. It is worth noting how that surfaced: the *record* said
    # `established` and the *worker* never ran, which is precisely the
    # "claiming a containment it did not have" shape this spec is answerable
    # to — caught by a canary rather than by a reviewer.
    hosts_path: Path | None = None

    def as_json(self) -> dict[str, Any]:
        record: dict[str, Any] = {
            "runtime_path": self.runtime_path,
            "mount": WORKSPACE,
        }
        if self.holder_cid is not None:
            record["egress"] = {"resolved": list(self.resolved)}
        return record


def declared_record(settings: Containment) -> dict[str, Any]:
    """Repository POLICY, always present in a v2 record.

    This is `worker_execution`'s shipped meaning — the schema says it in these
    words: *"a statement about the repository's policy rather than about this
    invocation"* — and it is the half that reads the same on the verify lap
    before a worker and the one after.
    """
    egress: dict[str, Any] = {"policy": settings.egress.policy}
    if settings.egress.policy == EGRESS_ALLOWLIST:
        egress["hosts"] = list(settings.egress.hosts)
        egress["ports"] = list(settings.egress.ports)
        egress["broker_image"] = settings.egress.broker_image
    return {
        "mode": WORKER_CONTAINED,
        "runtime": settings.runtime,
        "image": settings.image,
        "env_allowlist": list(settings.env),
        "user": settings.user,
        "egress": egress,
    }


# --- the static refusals ----------------------------------------------------


def preflight(
    settings: Containment | None,
    root: Path,
    worker_requires: tuple[str, ...] = (),
) -> str | None:
    """Why this containment cannot be honoured here, or None.

    STATIC only (ruling 3): refusals 1, 3, 4, 6 and 9. So this runs on `wring
    verify` too — which is the point, because a missing image discovered by CI
    costs a sentence and one discovered by `wring run` costs an hour of a
    corpus pass.

    **What STATIC means here, corrected 2026-08-15.** An earlier draft of this
    docstring said *"no container is started"*, and that was false: refusals 4
    and 6 answer "does this image carry the agent" by running one throwaway
    `--network none` container with no mount and asking `command -v`
    (`_missing_binaries`). There is no offline way to read the PATH of an image
    without executing in it. What static actually promises — and what
    SECURITY.md's `wring verify` row depends on — is **no packet and no DNS**:
    every probe on this path runs with `--network none`, resolves no name and
    reaches nothing. `wring verify`'s "makes no outbound connection" promise is
    untouched and remains true. What is dynamic is the part that needs a
    NETWORK: the holder, the allowlist and the DNS the allowlist resolves,
    which is refusals 2 and 7 at `establish`.

    `worker_requires` is what Wringer KNOWS the image must carry, as opposed to
    what the repository declared in `requires:` (SPEC_CONTAIN_V0 §11 A-5). For
    an ACP worker the agent binary is `run.worker.acp.command`, so the check no
    longer depends on the repository remembering to name it twice — the two
    sets are unioned and refusal 4 reports whatever is missing, by name.
    """
    if settings is None:
        return None

    binary = _DOCKER_DIALECT.get(settings.runtime)
    if binary is None:  # pragma: no cover - config.parse refuses it first
        return (
            f"'run.containment.runtime: {settings.runtime}' is not a runtime "
            f"Wringer builds a command line for (it knows: "
            f"{', '.join(sorted(_DOCKER_DIALECT))})"
        )

    # **Refusal 9**, before anything spawns: `-v` splits on ':', so a
    # repository at a path containing one would mount something nobody named,
    # silently and in the dangerous direction. Legal on macOS and Linux, so it
    # is checked rather than assumed away (`backend.py:317-333`).
    if ":" in str(root.resolve()):
        return (
            f"the worker cannot be contained with the repository at "
            f"{root.resolve()}: a ':' in the path would be read as a mount "
            "separator, and a mount nobody named is worse than a refusal. "
            "Move the repository, or drop 'run.containment'"
        )

    # **Refusal 1.**
    found = shutil.which(binary)
    if found is None:
        return (
            f"'run.containment' needs {binary} on PATH and there is none. "
            f"Install it, point 'run.containment.runtime' at a runtime you "
            f"have ({', '.join(sorted(_DOCKER_DIALECT))}), or drop the "
            "'run.containment' section to run the worker on this machine — "
            "which is what every run did before you added it"
        )

    images = [settings.image]
    if settings.egress.policy == EGRESS_ALLOWLIST:
        images.append(settings.egress.broker_image)

    for image in images:
        # **Refusal 3.** Wringer does not pull. `podman run` would fetch it
        # for us, and that is exactly the problem: SECURITY.md's standing
        # promise is that nothing leaves this machine without a flag you
        # typed, and an implicit pull is a fetch nobody typed. So the refusal
        # prints the command instead — the same shape `wring start` uses when
        # it declines to install an agent and prints the command to run.
        if not _image_exists(binary, image):
            return (
                f"'run.containment' names the image {image!r} and it is not "
                f"present locally. Wringer does not fetch it: nothing leaves "
                f"this machine without a flag you typed, and an implicit pull "
                f"is a fetch nobody typed. Run:\n\n    {binary} pull {image}\n"
            )

    # **Refusal 4 — R-3's named case.** Wringer never bundles an agent, from
    # any vendor: the published image's own Dockerfile says so and gives the
    # reason. So an image that cannot run the declared worker is a declaration
    # that cannot be honoured, and finding that out on the first turn — after
    # a verify lap, a brief and a spawn — is finding it out too late.
    required = tuple(dict.fromkeys((*settings.requires, *worker_requires)))
    missing = _missing_binaries(binary, settings.image, required)
    if missing:
        named = (
            "'run.containment.requires' names"
            if all(name in settings.requires for name in missing)
            else "your worker needs"
        )
        return (
            f"the image {settings.image!r} does not carry "
            f"{', '.join(missing)}, which {named}. "
            "Wringer ships no coding agent from any vendor, so the image that "
            "runs your worker has to be one that carries it — build one FROM "
            "your base that adds the agent you chose, or correct 'requires'"
        )

    # **Refusal 6.** The allowlist is armed by `iptables` inside the holder.
    # An image without it cannot establish the policy, and a policy that
    # cannot be established must refuse rather than quietly become no policy.
    if settings.egress.policy == EGRESS_ALLOWLIST:
        broker_missing = _missing_binaries(
            binary, settings.egress.broker_image, (BROKER_BINARY,)
        )
        if broker_missing:
            return (
                f"the broker image {settings.egress.broker_image!r} does not "
                f"carry {BROKER_BINARY}, so the egress allowlist cannot be "
                "established. The allowlist is armed inside that container "
                "and enforced on the network namespace the worker joins; "
                "without it there is no boundary, and Wringer will not run a "
                "worker under a config that says there is one"
            )
    return None


def _image_exists(binary: str, image: str) -> bool:
    """Whether the runtime already holds this image. Never fetches."""
    try:
        done = subprocess.run(
            [binary, "image", "exists", image],
            capture_output=True,
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    if done.returncode == 0:
        return True
    # `docker` has no `image exists`; `image inspect` is the portable spelling
    # and is equally offline. Both are tried rather than dialect-switched,
    # because the failure of the first is indistinguishable from the image
    # being absent and guessing wrong refuses a run that could have proceeded.
    try:
        done = subprocess.run(
            [binary, "image", "inspect", image],
            capture_output=True,
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return done.returncode == 0


def _missing_binaries(
    binary: str, image: str, required: tuple[str, ...]
) -> list[str]:
    """Which of `required` the image does not carry.

    Runs one throwaway container with `--network none` and no mount, so this
    probe cannot itself reach anything. `command -v` per name, joined, because
    one container start costs far more than the loop inside it.
    """
    if not required:
        return []
    script = "; ".join(
        f'command -v {name} >/dev/null 2>&1 || echo "MISSING {name}"'
        for name in required
    )
    try:
        done = subprocess.run(
            [
                binary, "run", "--rm", "--network", "none",
                "--entrypoint", "/bin/sh", image, "-c", script,
            ],
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        # The probe could not be made, so nothing is claimed either way. The
        # dynamic refusal at `establish` catches a runtime that cannot start a
        # container, and it catches it with the runtime's own stderr.
        return []
    return [
        line.split(" ", 1)[1]
        for line in done.stdout.splitlines()
        if line.startswith("MISSING ")
    ]


# --- the dynamic half: establish, spawn, tear down --------------------------


def establish(
    settings: Containment,
    root: Path,
    workdir: Path,
    party: str = "worker",
) -> Established:
    """Stand the containment up, or raise. Never returns a falsy answer.

    `party` is R-6: the 2026-08-14 ruling §5 requires the witness author be
    isolated *identically to the worker* in Phase 3, so the surface takes a
    party from the start and the author path is Phase 3's to wire. The
    parameter is the whole of the concession and it costs one argument;
    hardcoding the word would be a rewrite Phase 3 had to pay for.

    Raises `ContainmentError` for refusals 2 and 7. **There is deliberately no
    return path that yields None or a partial allowlist** — a partial
    allowlist is a boundary nobody specified, and a None is the silent
    fallback ruling 3 exists to forbid.
    """
    binary = _DOCKER_DIALECT[settings.runtime]
    runtime_path = shutil.which(binary)
    workdir.mkdir(parents=True, exist_ok=True)

    if settings.egress.policy != EGRESS_ALLOWLIST:
        # `--network none` needs no holder and resolves no name, so nothing
        # here reaches a network at all. This is the path Demo C films.
        _check_the_runtime_can_run(binary, settings.image, party)
        return Established(
            runtime_path=runtime_path, holder_cid=None, resolved=(),
        )

    holder_cid = _start_holder(binary, settings, workdir, party)
    try:
        resolved = _arm(binary, settings, holder_cid, workdir)
    except ContainmentError:
        # A holder that could not be armed must not survive: it is a container
        # with a network and no policy, which is the opposite of what it was
        # started for.
        _remove(binary, holder_cid)
        raise
    return Established(
        runtime_path=runtime_path,
        holder_cid=holder_cid,
        resolved=resolved,
        hosts_path=workdir / HOSTS_FILENAME,
    )


def _check_the_runtime_can_run(binary: str, image: str, party: str) -> None:
    """**Refusal 2.** The runtime is on PATH; can it actually start anything?

    A missing podman machine, a stopped Docker daemon and a broken userns all
    look identical from `shutil.which`. The runtime's own stderr is quoted
    rather than summarised, because Wringer will not guess past it.
    """
    try:
        done = subprocess.run(
            [
                binary, "run", "--rm", "--network", "none",
                "--entrypoint", "/bin/sh", image, "-c", "exit 0",
            ],
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ContainmentError(
            f"'{binary}' is on PATH but could not start a container, so the "
            f"{party} cannot be contained: {exc}"
        ) from exc
    if done.returncode != 0:
        raise ContainmentError(
            f"'{binary}' is on PATH but could not start a container, so the "
            f"{party} cannot be contained. The runtime said:\n\n"
            f"{done.stderr.strip()}\n"
        )


def _start_holder(
    binary: str, settings: Containment, workdir: Path, party: str
) -> str:
    """The container that OWNS the network namespace and holds NET_ADMIN.

    It is a separate container on purpose. The worker joins this namespace
    **without** NET_ADMIN, so it is subject to the rules and cannot remove
    them — the boundary is not inside the thing being bounded, which is the
    one property that makes this a boundary rather than a request.
    """
    cidfile = workdir / HOLDER_CIDFILE
    cidfile.unlink(missing_ok=True)
    try:
        done = subprocess.run(
            [
                binary, "run", "--detach",
                "--cidfile", str(cidfile),
                "--cap-add", "NET_ADMIN",
                "--cap-add", "NET_RAW",
                "--volume", f"{workdir.resolve()}:/broker",
                "--entrypoint", "/bin/sh",
                settings.egress.broker_image,
                "-c", f"sleep {HOLDER_MAX_SECONDS}",
            ],
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ContainmentError(
            f"the egress allowlist could not be established for the {party}: "
            f"the broker container would not start ({exc})"
        ) from exc
    if done.returncode != 0:
        raise ContainmentError(
            f"the egress allowlist could not be established for the {party}: "
            f"the broker container would not start. The runtime said:\n\n"
            f"{done.stderr.strip()}\n"
        )
    return done.stdout.strip()


def _arm(
    binary: str, settings: Containment, holder_cid: str, workdir: Path
) -> tuple[str, ...]:
    """**Refusal 7.** Resolve, write the hosts file, drop everything else.

    Resolution happens INSIDE the holder, not on this machine, and that is not
    fussiness. On macOS the runtime's containers live in a Linux VM with its
    own resolver, so a host-side answer can name an address the container's
    resolver never returns — and the allowlist would then block the very API
    it was written to admit. Resolving where the rules apply makes the
    mismatch impossible rather than unlikely.

    DNS is then dropped entirely. The worker reaches the declared hosts
    through the `hosts` file this writes and can reach no name Wringer did not
    put in it.
    """
    hosts = " ".join(settings.egress.hosts)
    ports = " ".join(str(port) for port in settings.egress.ports)
    script = f"""
set -e
: > /broker/{HOSTS_FILENAME}
printf '127.0.0.1\\tlocalhost\\n::1\\tlocalhost\\n' >> /broker/{HOSTS_FILENAME}
ADDRS=''
for host in {hosts}; do
  found=$(getent ahostsv4 "$host" | awk '{{print $1}}' | sort -u)
  if [ -z "$found" ]; then echo "UNRESOLVED $host"; exit 3; fi
  for ip in $found; do
    ADDRS="$ADDRS $ip"
    printf '%s\\t%s\\n' "$ip" "$host" >> /broker/{HOSTS_FILENAME}
  done
done
iptables -P OUTPUT DROP
iptables -A OUTPUT -o lo -j ACCEPT
for ip in $ADDRS; do
  for port in {ports}; do
    iptables -A OUTPUT -d "$ip" -p tcp --dport "$port" -j ACCEPT
  done
done
for ip in $ADDRS; do echo "RESOLVED $ip"; done
"""
    try:
        done = subprocess.run(
            [binary, "exec", holder_cid, "/bin/sh", "-c", script],
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ContainmentError(
            f"the egress allowlist could not be armed: {exc}"
        ) from exc
    if done.returncode != 0:
        unresolved = [
            line.split(" ", 1)[1]
            for line in done.stdout.splitlines()
            if line.startswith("UNRESOLVED ")
        ]
        if unresolved:
            raise ContainmentError(
                f"the egress allowlist could not be armed: "
                f"{', '.join(unresolved)} resolved to nothing from inside the "
                "broker container. Never a partial allowlist — a boundary "
                "nobody specified is not a boundary"
            )
        raise ContainmentError(
            "the egress allowlist could not be armed. The broker said:\n\n"
            f"{done.stderr.strip()}\n"
        )
    resolved = tuple(
        line.split(" ", 1)[1]
        for line in done.stdout.splitlines()
        if line.startswith("RESOLVED ")
    )
    if not resolved or not (workdir / HOSTS_FILENAME).is_file():
        raise ContainmentError(
            "the egress allowlist reported success and produced no addresses, "
            "so nothing was established. Refusing rather than running a "
            "worker under a boundary nobody can read"
        )
    return resolved


def env_names(settings: Containment, passthrough: tuple[str, ...] = ()) -> tuple[str, ...]:
    """Which NAMES cross the boundary, when two allowlists both apply.

    A shell worker has one declared allowlist: `run.containment.env`. An ACP
    worker has a second, `run.worker.acp.env_passthrough`, which existed before
    containment did and is the one a repository already writes for an agent.

    **Ruled: the union, and never the intersection** (SPEC_CONTAIN_V0 §11 A-6).
    Each name in either list was typed into `.wringer.yaml` by a human, which
    is the entire property an allowlist-by-name protects; taking the
    intersection would instead make a declared key silently inert — refusal
    11's named defect class, arriving through the back door — and would present
    as an agent mysteriously receiving no credential.

    Order is preserved and duplicates collapse, so the argv is stable and a
    test can assert it.
    """
    return tuple(dict.fromkeys((*settings.env, *passthrough)))


def _base(
    settings: Containment,
    established: Established,
    root: Path,
    workdir: Path,
    passthrough: tuple[str, ...] = (),
) -> list[str]:
    """Every flag that IS the boundary, built once for both spawn shapes.

    **This function exists because there are two worker spawn paths and a
    boundary built twice is a boundary that drifts** (SPEC_CONTAIN_V0 §11 A-1).
    A shell worker goes through `gates.run`; an ACP worker is a stdio session
    `acp.run_turn` holds open. They differ only in their tail — what is
    executed and whether stdin stays attached — and everything before that tail
    is the same mount, the same workdir, the same cidfile, the same network
    arm, the same uid and the same `--env NAME` allowlist.

    Deriving both from here means a flag added to the boundary lands on both
    paths by construction rather than by whoever remembers, which is the
    structural answer to the review finding that a guard assuming one spawn
    path would pass while the second ran uncontained.

    A pure function of the config, the established containment and two paths —
    no clock, no environment read, no runtime call — so a test can assert every
    flag on a machine with no container runtime at all.
    """
    binary = _DOCKER_DIALECT[settings.runtime]
    args = [
        binary,
        "run",
        "--rm",
        "--cidfile",
        str(workdir / WORKER_CIDFILE),
        "--volume",
        f"{root.resolve()}:{WORKSPACE}",
        "--workdir",
        WORKSPACE,
    ]
    if established.holder_cid is None:
        args += ["--network", "none"]
    else:
        # The worker JOINS the holder's namespace and is handed no NET_ADMIN,
        # so the rules apply to it and it cannot remove them. Measured
        # 2026-08-15: a joiner that installs iptables and runs `-P OUTPUT
        # ACCEPT` fails.
        args += ["--network", f"container:{established.holder_cid}"]
        if established.hosts_path is None:
            # An `Established` with a holder and no hosts file is a boundary
            # half built, and the worker would resolve nothing. Raised rather
            # than asserted: `assert` disappears under `python -O`, and this is
            # the one place where being wrong means running a worker with a
            # containment that is not what the record says it is.
            raise ContainmentError(
                "the egress allowlist named a holder but no hosts file, so "
                "the worker would resolve nothing. Refusing rather than "
                "running under a boundary the record cannot describe"
            )
        args += [
            "--volume",
            f"{established.hosts_path.resolve()}:{HOSTS_PATH}:ro",
        ]
    # **No witness mount here, and its absence is the fix rather than a gap**
    # (P4-3, ruled 2026-08-15). A `--volume {WORKSPACE}/.wringer/witness`
    # shadowing the witness bytes stood on this line until then. It worked, and
    # it was the wrong shape: it protected the witness from a CONTAINED worker
    # only, while the turn that actually does the work in arm B ran on the host,
    # where no mount of this container's can shadow anything.
    #
    # The bytes now live outside every repository root (`witness.store_dir`), so
    # they are absent from the mount for the same reason they are absent from
    # the tree — there is nothing here to shadow. A boundary drawn over a path
    # that no longer holds bytes is dead code that READS as protection, which is
    # worse than no line at all.
    #
    # **The honest residual, kept where the mount's comment was:** an
    # uncontained worker on the host can still reach the store if it goes
    # looking. Deriving a path is not hard and a path is not a boundary. What
    # the move buys is that no agent reaches the witness by tidying up its own
    # tree, which is the failure that was measured. The pin stays
    # tamper-EVIDENCE; THIS — the container, the namespace, the mount set — is
    # the boundary, and it is the only thing in this program that is one.
    if settings.user is not None:
        args += ["--user", settings.user]
    for name in env_names(settings, passthrough):
        # `--env NAME`, never `--env NAME=VALUE`. The runtime reads the value
        # from Wringer's own environment, so a credential handed to a worker
        # never becomes readable by anyone who can run `ps`. The two forms
        # differ by exactly that, and this is the whole of what "Wringer
        # stores no credential" means at the point of spawn.
        args += ["--env", name]
    return args


def argv(
    settings: Containment,
    established: Established,
    command: str,
    root: Path,
    workdir: Path,
) -> list[str]:
    """The whole SHELL worker command line, as a list a reviewer reads top down.

    The tail is `/bin/sh -c <command>`, because a shell worker is one shell
    string the repository wrote down. Everything before it is `_base`.
    """
    return _base(settings, established, root, workdir) + [
        "--entrypoint", "/bin/sh", settings.image, "-c", command,
    ]


def session_argv(
    settings: Containment,
    established: Established,
    command: str,
    args: tuple[str, ...],
    root: Path,
    workdir: Path,
    passthrough: tuple[str, ...] = (),
) -> list[str]:
    """The whole ACP worker command line — a stdio session inside the boundary.

    Two differences from `argv`, and both are ruled rather than incidental
    (SPEC_CONTAIN_V0 §11 A-1, A-2):

    1. **`--interactive`, and it is required.** A `run --rm` with no `-i`
       closes the child's stdin at once, and a JSON-RPC session dies on its
       first write. The agent would present as hanging during `initialize`,
       which `acp.py` already names as the case somebody SIGKILLs the loop
       over — so the missing flag would look like an agent defect.
    2. **Never `--tty`.** ACP frames messages as newline-delimited JSON on a
       raw pipe. A tty line-buffers, echoes what is written to it and rewrites
       newlines, corrupting that framing in a way that reads as a protocol bug
       in the agent rather than as a flag Wringer chose.

    The agent argv is carried UNSPLIT: `--entrypoint` names the binary and
    everything after the image is its arguments, so nothing re-splits a
    quoted argument the way a shell would.
    """
    return _base(settings, established, root, workdir, passthrough) + [
        "--interactive",
        "--entrypoint", command, settings.image, *args,
    ]


def translate(command: str, root: Path) -> str:
    """Rewrite host-absolute paths into the container's view of the mount.

    **Without this every documented worker command fails on its first line.**
    `bundle.write_brief` returns an absolute HOST path (`loop.py:235-238`) and
    `config.substitute` puts that string into the command; the documented form
    is `worker: claude -p "$(cat {brief})"`. Inside a container with the
    repository at /workspace that path does not exist, so the worker's first
    act is to read a file that is not there — and a worker that cannot read
    its brief is F3 all over again, in a new costume.

    Only paths under the repository root are rewritten. A path outside it is
    left exactly as written, because it is genuinely unreachable and a worker
    failing loudly on it is better than Wringer inventing a location for it.
    """
    prefix = str(root.resolve())
    if prefix in command:
        return command.replace(prefix, WORKSPACE)
    return command


def inbound(candidate: str, root: Path) -> str:
    """Rewrite a path the CONTAINED agent named back into the host tree.

    `translate` goes one way — host paths out, into a command the container
    runs. This is the other way, and the ACP path is the only one that needs
    it: the agent sees the repository at /workspace, so every path it names in
    `fs/read_text_file` or `fs/write_text_file` is a container path, and
    `acp._inside` resolves candidates against the HOST root.

    Untranslated, `/workspace/x` resolves outside the root and is refused —
    which fails closed, the right direction and the wrong answer, because it
    refuses the agent's legitimate request.

    **Confinement is unchanged, and the ordering is why.** This runs BEFORE
    `_inside` resolves, so a `..` or a symlink still escapes to exactly the
    refusal it always did, and a path that is not under /workspace is not
    rewritten into the tree at all. This function widens no permission; it
    only stops the boundary from lying to the agent about where the tree is.
    """
    if candidate == WORKSPACE:
        return str(root)
    prefix = WORKSPACE + "/"
    if candidate.startswith(prefix):
        return str(root / candidate[len(prefix):])
    return candidate


def teardown(settings: Containment, workdir: Path) -> None:
    """Remove the holder and any worker container this turn left behind.

    Total by construction: every failure is swallowed. This runs on the way
    out of a turn that may already have failed, and an exception here would
    replace the turn's real outcome with a cleanup error — the discipline
    `backend.Container.cleanup` sets (`backend.py:262-292`).

    **By cidfile, never by process group.** A container has no host pgid, and
    on macOS it lives inside the runtime's Linux VM, so the mechanism that
    reaps an orphaned worker process (`loop.worker_pgids`) cannot reach one.
    The cidfiles are what `wring resume` reads to remove a holder whose
    allowlist is still armed.
    """
    binary = _DOCKER_DIALECT.get(settings.runtime)
    if binary is None:  # pragma: no cover - refused at parse
        return
    for name in (WORKER_CIDFILE, HOLDER_CIDFILE):
        path = workdir / name
        try:
            cid = path.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if cid:
            _remove(binary, cid)


def _remove(binary: str, cid: str) -> None:
    try:
        subprocess.run(
            [binary, "rm", "--force", cid],
            capture_output=True,
            timeout=CLEANUP_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        return


def host_user() -> str:
    """`uid:gid` of the invoking process, for a config that wants to say so.

    Offered rather than applied, inheriting SPEC_EXEC_V0 ruling 3 — **but the
    consequence differs in kind for a worker and SPEC_CONTAIN_V0 §7.4 says
    so.** A gate mostly reads the mount; a worker's whole job is to write it,
    so an image running as root leaves root-owned files in the developer's
    real repository. `wring doctor` prints this value.
    """
    return f"{os.getuid()}:{os.getgid()}"


# What the containment record does NOT claim, travelling with it rather than
# living in a spec nobody opened. `backend.LIMITS_V2` carries these into the
# bundle; the pattern is `health.LIMITS` and `accept.LIMITS`, and the reason
# is that an execution record is exactly the artifact a reader inflates into a
# security claim.
LIMITS = (
    "A contained worker record states what Wringer ASKED a runtime for, plus "
    "the addresses an allowlist admitted. Whether the runtime delivered it is "
    "a separate claim, measured per platform, per runtime and per image in "
    "docs/MANUAL_CHECKS.md sequence I and nowhere else.",
    "The egress allowlist is an ADDRESS allowlist. Anything else served from "
    "those addresses is reachable, which on shared CDN infrastructure can be "
    "a large set, and no canary in sequence I can see it.",
    "The resolved addresses are a snapshot taken when the allowlist was "
    "armed. An endpoint that moves mid-run loses the worker's connection — it "
    "fails closed — and nothing here tracks DNS.",
    "The mount is read-write by design, because changing the tree is the "
    "worker's whole job. A hostile worker can corrupt the tree it was given, "
    "and container escapes exist.",
    "Wringer sets no --user unless a config asks for it, so the privilege the "
    "worker holds inside the container is the IMAGE's choice, and a root "
    "image leaves root-owned files in your repository.",
    "Containment closes a contamination channel so that a measurement is "
    "worth reading. It does not make a delivery trustworthy and says nothing "
    "about whether the worker's change is correct.",
)
