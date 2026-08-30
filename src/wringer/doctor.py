"""Check the preconditions, one line each — `wring doctor`.

This exists for the agent that is setting Wringer up for somebody. An agent
with a broken environment and no diagnosis will guess, and a guessing agent
burns a person's afternoon. Every check here answers one question, says what
to do when the answer is wrong, and is machine-readable under `--json`.

It never fixes anything. Diagnosis and repair are different jobs, and a tool
that silently "fixes" a machine is a tool nobody can reason about.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from wringer import __version__, agents, config, evidence

OK, WARN, FAIL, SKIP = "ok", "warn", "fail", "skip"

# What a check is asking about. MACHINE checks are true of the computer and
# are what `wring doctor` promises to answer — "machine-checkable
# preconditions". REPO checks describe the directory you are standing in.
#
# The split is not cosmetic. Run from outside a repository, doctor used to
# exit 1 on a blocking ✗ that meant only "you are not in a repo" — so a
# setup runbook that said `mkdir workspace` and then `wring doctor` stopped
# on a problem that did not exist. Reported by a real first run, 2026-08-04.
MACHINE, REPO = "machine", "repo"


@dataclass(frozen=True)
class Check:
    """One question, its answer, and what to do about it.

    `status` is `ok`, `warn` (usable but worth knowing), `fail` (this will
    stop you), or `skip` (not applicable here, and why). Only `fail` changes
    the exit code — a warning that blocks a setup script is a warning nobody
    keeps, and a skipped check has answered nothing to block on.
    """

    name: str
    status: str
    detail: str
    fix: str = ""
    scope: str = MACHINE

    @property
    def passed(self) -> bool:
        return self.status != FAIL


def in_repository(root: Path) -> bool:
    inside = subprocess.run(
        ["git", "rev-parse", "--is-inside-work-tree"],
        cwd=root, capture_output=True, text=True,
    )
    return inside.returncode == 0 and inside.stdout.strip() == "true"


def run_checks(root: Path) -> list[Check]:
    """Every check, with the repo-scoped ones skipped outside a repository.

    Skipped rather than failed: `wring doctor` in your home directory is a
    question about the machine, and answering "this is not a repo" with a
    blocking ✗ makes a true statement into a false problem.
    """
    here = in_repository(root)
    # Read once and handed in, so the runtime check knows whether it is
    # answering "could you use a container?" or "will the next verify run at
    # all?" — the same question with two different severities.
    declared = _declared_execution(root) if here else None
    machine = [_python(), _wring(), _git(), _runtime(declared),
               _managed_settings(), _api_key(root)]
    if not here:
        skipped = [
            Check(name, SKIP, "not a git repository — run from your repo to check",
                  fix="", scope=REPO)
            for name in ("git repository", "gates", "runnable checks",
                         "last verify", "pytest parallelism",
                         "workspace writable", "worker auth")
        ]
        return machine[:4] + skipped + machine[4:]
    return (
        machine[:4]
        + [_repo(root), _config(root), _runnable_checks(root), _last_verify(root),
           pytest_parallel_check(root), _workspace(root), _worker_auth(root)]
        + machine[4:]
    )


def check_names() -> tuple[str, ...]:
    """Every name `doctor` can print, in order. Published so documentation
    can be tested against it — SETUP.md once illustrated checks that did not
    exist, which is how it came to claim doctor verifies the image pull."""
    return (
        "python", "wring", "git", "container runtime",
        "git repository", "gates", "runnable checks", "last verify",
        "pytest parallelism", "workspace writable", "worker auth",
        "managed settings", "llm key",
    )


#: Where an IT department's coding-agent policy files live. The paths
#: themselves are in `agents.py`, which AGENTS.md rule 5 makes the only place
#: a vendor string may appear — a guard caught this constant here and was
#: right to.
#:
#: **Presence only. Nothing below ever opens one.** It is somebody's
#: employer's configuration, it can carry anything, and the one thing worth
#: knowing about it — that it exists — is a `stat`. Names and paths, never
#: values, which is the same rule `env_passthrough` lives under.
MANAGED_SETTINGS_PATHS = agents.MANAGED_SETTINGS_PATHS


def _managed_settings() -> Check:
    """Is this machine's coding agent pinned to an org login?

    **Field report 2026-08-25, finding 4, and it is the most expensive shape
    in the report.** On an IT-managed Mac pinned to first-party OAuth, the
    documented remedy — `env_passthrough` of an Anthropic key — is not merely
    ineffective. It is THE CAUSE: with the key present `session/new` is
    refused, and with no key in the worker env it succeeds. The agent's own
    `auth status` reports `loggedIn: true, authMethod: api_key` the whole
    time. Presence is worse than absence, and no surface said a word.

    **What this can and cannot know.** It reports that a policy file is at a
    documented path. It does NOT read it, so it cannot say whether that
    policy pins anything — the wording says "if", and the caveat is the point
    rather than hedging. Nor can it be sure it is looking in the right place:
    the paths are Claude Code's documented ones and a vendor may move them, so
    **absence here is not evidence that a machine is unmanaged**, and the SKIP
    line names the path it looked at so a reader on a managed machine can see
    for themselves whether this check was even asking the right question.

    No machine available to this repository has one of these files, so the
    PRESENT branch has never been seen in the wild — only driven against a
    path in a test. That is said here rather than left for someone to assume.
    """
    # Asked through `agents.py`, which owns both the paths and the stat, so
    # this line and the signed-out refusal cannot come to disagree about
    # whether a machine carries one. The tuple is handed in rather than
    # implied, because this module's name for it is the one tests substitute.
    found = agents.managed_policy_file(MANAGED_SETTINGS_PATHS)
    if found is None:
        # **OK and not SKIP.** SKIP means "this is about a repository and you
        # are not in one" — every repo-scoped check uses it and one invariant
        # test derives that pairing. A machine check with nothing to report
        # has found no problem, which is what OK says. The caveat travels in
        # the sentence rather than in the mark.
        return Check(
            "managed settings", OK,
            "no coding-agent policy file at "
            f"{MANAGED_SETTINGS_PATHS[0]} (absence here is not proof this "
            "machine is unmanaged — it is one path, checked)",
        )
    return Check(
        "managed settings", WARN,
        f"this machine has a coding-agent policy file at {found}. If it "
        "pins the builder to an organisation login, an Anthropic key in the "
        "worker's environment will be REFUSED — the key is the thing that "
        "breaks it, and removing it is the fix",
        "Read that file, or ask whoever manages this machine. If it pins "
        "login: log the agent in yourself and declare NO key under "
        "'run.worker.acp.env_passthrough'. The agent's own `auth status` "
        "reports a key as valid on such a machine while every session is "
        "refused, so do not take it as proof",
    )


def _python() -> Check:
    major, minor = platform.python_version_tuple()[:2]
    version = platform.python_version()
    if (int(major), int(minor)) < (3, 11):
        return Check(
            "python", FAIL, f"Python {version} — Wringer needs 3.11 or newer",
            "Install Python 3.11+ (or use the container image, which bundles it)",
        )
    return Check("python", OK, f"Python {version}")


# The four executables one `wringer` distribution installs. Named here rather
# than discovered, because the question this check answers is "are the ones
# that should be here, here" — and a list derived from what IS on PATH could
# never notice an absence.
WRINGER_EXECUTABLES = ("wring", "wringer", "wringer-board", "wringer-drive")


def install_shape() -> tuple[str | None, str | None]:
    """Where the running `wringer` package came from, and what was installed.

    Returns `(source_directory or None, distribution_version or None)`:

    - **source_directory** is set when the imported package does NOT live in a
      `site-packages` — an editable install (a `.pth` pointing at a checkout)
      or a source tree on `PYTHONPATH`. The code that runs is then whatever is
      in that directory right now, including edits nobody has committed.
    - **distribution_version** is what the installed metadata says, which is
      the version of the thing somebody actually installed. `__version__` is
      read out of the imported source, so under an editable install the two
      can disagree — and the one a person sees is the one that is not true of
      their install.

    **Field report 2026-08-25.** The run was made against `0.4.0`, six
    releases stale, from an editable install, and nothing anywhere said so:
    seven findings were written against code that had moved, and two of them
    were already dead. Measured on this machine while fixing it, the
    `uv tool install`ed `wring` on PATH reported `0.4.6` from a `.pth` into a
    working tree whose `dist-info` said `0.4.1`. Both halves, live, at once.

    Never raises. A doctor check that fell over while reporting on the install
    would be the least useful failure in the tool.
    """
    source: str | None = None
    try:
        import wringer

        here = Path(wringer.__file__ or "").resolve().parent
        if not any(
            part in ("site-packages", "dist-packages") for part in here.parts
        ):
            source = str(here.parent)
    except Exception:  # noqa: BLE001
        source = None

    declared: str | None = None
    try:
        from importlib import metadata

        declared = metadata.version("wringer")
    except Exception:  # noqa: BLE001
        declared = None
    return source, declared


def command_owner(path: str) -> str | None:
    """The environment a wringer command will actually run in, or None.

    A console script names its interpreter in its shebang, and THAT is the
    environment whose `wringer` gets imported when the command runs. The
    directory the shim sits in says nothing about it.

    **Measured on this Mac, 2026-08-25/26.** `uv tool install` puts every
    tool's shims into ONE directory — `~/.local/bin` — so an operator running
    a mixture of two tool environments has all four commands in one place. A
    check that keys on the directory sees one directory and calls it well.
    That is the exact state this machine was in: `wringer` and `wringer-drive`
    were two separate tool environments whose shims shared `~/.local/bin`.

    The interpreter path is compared UNRESOLVED, by the directory holding it.
    Resolving would be wrong and was measured to be wrong: every uv
    environment's `bin/python` is a symlink to the same base interpreter
    (`.../uv/python/cpython-3.12-macos-aarch64-none/bin/python3.12` for all of
    `wringer`, `kimi-code` and this repo's `.venv`), so a resolved comparison
    collapses every environment on the machine into one and the check goes
    blind again. The directory holding the interpreter is the environment;
    comparing the directory rather than the file also keeps `python` and
    `python3.12` shebangs from the same install out of the false-positive pile.

    Returns None when the shebang cannot be read or names no environment — a
    binary shim, an unreadable file, or `#!/usr/bin/env python`, which
    deliberately defers the choice to PATH. None means "could not tell", which
    the caller says out loud rather than treating as agreement.
    """
    try:
        # Read THROUGH any symlink: `~/.local/bin/wring` is a link into the
        # tool environment, and the shebang lives in the file it points at.
        with open(path, "rb") as handle:
            first = handle.readline(4096)
    except OSError:
        return None
    if not first.startswith(b"#!"):
        return None
    line = first[2:].decode("utf-8", "replace").strip()
    words = line.split()
    if not words:
        return None
    if Path(words[0]).name == "env":
        # `#!/usr/bin/env python` names no environment at all.
        return None
    # **The WHOLE line, not its first word.** Found by hunting this function,
    # 2026-08-26: splitting on whitespace and taking word one truncates
    # `#!/Users/a b/venv/bin/python` to `/Users`, which collapses every
    # environment under a path with a space in it into one owner and puts the
    # mixture check straight back to blind — silently, and only for the people
    # whose home directory has a space in it.
    #
    # Taking the whole line is right for both shapes, because `.parent` drops
    # exactly one path component and an interpreter's arguments carry no
    # slashes: `/x/bin/python -s` has parent `/x/bin`, and so does
    # `/x/bin/python`.
    candidate = Path(line)
    if not candidate.is_absolute():
        return None
    return str(candidate.parent)


def _install_note() -> str:
    """The sentence appended to every `wring` line, or nothing at all."""
    source, declared = install_shape()
    if source is None:
        return ""
    said = f" — running from source at {source}, not from an installed copy"
    if declared and declared != __version__:
        said += (
            f", and the installed distribution says {declared}. The version "
            "above is read from that source tree, so it is NOT the version "
            "you installed"
        )
    return said


def _wring() -> Check:
    """Where every wringer-family command resolves, and whether they agree.

    **Field report 2026-08-21, the note on a misleading diagnostic.** An
    operator auditing an old install ran `uv tool list | grep -i wringer` —
    which HIDES `wring`, because the line reads `- wring` and does not contain
    the string "wringer". Anyone checking that way misses a shadowing binary
    entirely. Separately, `pip` does not exist on that Mac at all, so any
    `pip list | grep` check returns empty for a reason that has nothing to do
    with what is installed.

    The defect there was the test PROMPT's, not the product's, and it is worth
    fixing anyway: a person should not need a correct grep to find out which
    Wringer they are running. This repository has already shipped the failure
    that makes it matter — an agent verified its own work with a stale `wring
    0.2.0` on PATH, writing bundles with no `execution.json` into a 0.3.0 repo
    (`docs/benchmark-first-run.md`).

    So: every one of the four, resolved, with a LOUD line when they come from
    different places. WARN rather than FAIL — a split install is usable and
    the person may have arranged it on purpose — but never silent.
    """
    # **Which Wringer is this, really.** Appended to every branch below,
    # because a stale editable install is a hazard whatever else is true of
    # the PATH — field report 2026-08-25 was run against one and nothing said
    # so, which is why two of its findings were already dead.
    note = _install_note()
    source, declared = install_shape()
    shadowed = bool(source and declared and declared != __version__)

    located = {name: shutil.which(name) for name in WRINGER_EXECUTABLES}
    absent = [name for name, path in located.items() if path is None]
    if len(absent) == len(WRINGER_EXECUTABLES):
        # Reachable when someone runs `python -m wringer doctor` from a
        # source tree without installing — worth flagging, not fatal.
        return Check(
            "wring", WARN, f"wringer {__version__} is importable but none of "
            f"{', '.join(WRINGER_EXECUTABLES)} is on PATH{note}",
            "pip install wringer, or add the venv's bin directory to PATH",
        )

    lines = [
        f"{name} → {path}" if path else f"{name} → NOT ON PATH"
        for name, path in located.items()
    ]
    # One distribution, so one directory. Two means an older install is
    # shadowing part of a newer one, and the person is running a mixture.
    homes = {str(Path(path).parent) for path in located.values() if path}
    if len(homes) > 1:
        return Check(
            "wring", WARN,
            f"wringer {__version__} — the four commands resolve into "
            f"{len(homes)} DIFFERENT directories, so you are running a "
            f"mixture of installs{note}:\n  " + "\n  ".join(lines),
            "Uninstall every wringer distribution and install once: "
            "`uv tool uninstall wringer wringer-board wringer-drive` then "
            "`uv tool install wringer`",
        )
    # **One directory is not one install.** Under `uv tool install` the shims
    # of every tool land in the same directory, so the check above sees one
    # place and passes a two-environment mixture. Ask each command which
    # environment it belongs to instead of where it sits.
    owners = {
        name: command_owner(path) for name, path in located.items() if path
    }
    environments = {owner for owner in owners.values() if owner}
    if len(environments) > 1:
        told = [
            f"{name} → {owner or 'could not tell'}"
            for name, owner in owners.items()
        ]
        return Check(
            "wring", WARN,
            f"wringer {__version__} — the commands share a directory but "
            f"belong to {len(environments)} DIFFERENT installs, so you are "
            f"running a mixture{note}:\n  " + "\n  ".join(told),
            "Uninstall every wringer distribution and install once: "
            "`uv tool uninstall wringer wringer-board wringer-drive` then "
            "`uv tool install wringer`",
        )
    # Say so when the question could not be asked, rather than letting silence
    # read as agreement. On an ordinary install every shebang is readable and
    # this stays empty; it appears on the shapes where doctor genuinely cannot
    # see a mixture — a binary shim, or `#!/usr/bin/env python`.
    undetermined = [name for name, owner in owners.items() if owner is None]
    if undetermined:
        note += (
            f" (could not tell which install {', '.join(undetermined)} "
            f"{'belongs' if len(undetermined) == 1 else 'belong'} to, so a "
            "mixture of installs sharing this directory would not be visible "
            "here)"
        )
    if absent:
        return Check(
            "wring", WARN,
            f"wringer {__version__} — {', '.join(absent)} "
            f"{'is' if len(absent) == 1 else 'are'} missing from an otherwise "
            f"complete install{note}:\n  " + "\n  ".join(lines),
            "Reinstall so the whole distribution is present: "
            "`uv tool install --force wringer`",
        )
    if shadowed:
        # **The version a person reads is not the version they installed.**
        # WARN, not OK: everything they are about to measure is a fact about
        # a working tree, and every report they write will name a release it
        # was not made against.
        return Check(
            "wring", WARN,
            f"wring {__version__}, and all four commands resolve into "
            f"{homes.pop()}{note}",
            "Reinstall from the index to run a release: "
            "`uv tool install --force wringer` — or keep the source install "
            "and treat the version above as the working tree's, not a "
            "release's",
        )
    return Check(
        "wring", OK,
        f"wring {__version__}, and all four commands resolve into "
        f"{homes.pop()}{note}",
    )


def _git() -> Check:
    if shutil.which("git") is None:
        return Check(
            "git", FAIL, "git is not on PATH — Wringer records which commit "
            "was verified, so it needs one",
            "Install git",
        )
    try:
        proc = subprocess.run(
            ["git", "--version"], capture_output=True, text=True, timeout=10
        )
        return Check("git", OK, proc.stdout.strip() or "git present")
    except (OSError, subprocess.TimeoutExpired):
        return Check("git", FAIL, "git is on PATH but did not run", "Reinstall git")


def _runtime(demanded: object = None) -> Check:
    """A container runtime, if the user wants one.

    WARN normally: not required to run Wringer directly, only to run it in the
    box. **FAIL when `execution.backend: container` is declared**, because it
    has stopped being an option and become a precondition — and a doctor that
    said "worth knowing" about the thing that will halt the next `wring verify`
    is a doctor nobody consults. `demanded` is the repo's `execution:` section,
    or None outside a repo and for every config that never mentioned one.

    **`run.containment` demands one too** (SPEC_CONTAIN_V0 §3). Without this,
    a repo that contains its worker and leaves `execution:` alone got OK or
    WARN from `wring doctor` while `wring verify` exited 2 — which silently
    narrows SPEC_EXEC_V0 §9's shipped invariant to gates, and leaves the one
    command whose whole job is to diagnose this disagreeing with the command
    it is diagnosing for.
    """
    apple = shutil.which("container")
    docker = shutil.which("docker")
    mac_arm = platform.system() == "Darwin" and platform.machine() == "arm64"

    wanted = getattr(demanded, "runtime", None)
    if wanted is not None:
        # A specific runtime was named, so a different one being present
        # answers nothing: this check is about the binary that will actually be
        # invoked. Apple's `container` cannot be named — `config.parse` refuses
        # it, because its flags have not been verified against the argv Wringer
        # builds and a silently-ignored `--network none` would record
        # `network: false` over a live network.
        found = shutil.which(wanted)
        if found is not None:
            return Check("container runtime", OK, f"{wanted} at {found}")
        contained = isinstance(demanded, config.Containment)
        declares = (
            "'run.containment'" if contained
            else "'execution.backend: container'"
        )
        section = "run.containment" if contained else "execution"
        return Check(
            "container runtime", FAIL,
            f"no {wanted} on PATH, and {config.CONFIG_FILENAME} declares "
            f"{declares}",
            f"Install {wanted}, point '{section}.runtime' at a runtime you "
            f"have, or drop the '{section}:' section to run "
            f"{'the worker' if contained else 'gates'} on this machine",
        )

    if apple is not None:
        return Check("container runtime", OK, f"apple container at {apple}")
    if docker is not None:
        return Check("container runtime", OK, f"docker at {docker}")
    if mac_arm:
        return Check(
            "container runtime", WARN,
            "no container runtime found (Apple silicon detected)",
            "Install apple/container (needs macOS 26) or Docker Desktop — "
            "or skip the container and run wring directly",
        )
    return Check(
        "container runtime", WARN, "no container runtime found",
        "Install Docker, or run wring directly on this machine",
    )


def _worker_auth(root: Path) -> Check:
    """Will the coding agent be able to authenticate when the loop reaches it?

    The question two field runs answered the expensive way. `wring doctor` is
    where a person looks BEFORE they start, so it is the cheapest place this
    can possibly be asked — and the agent's own command line answers it
    without a turn.

    `warn`, never `fail`. Doctor's exit code gates setup scripts, and a signed
    out agent is a true problem for `wring run` and not for `wring verify`,
    `wring accept`, or anything else in this tool. The refusal that stops a
    run lives on the run (`loop.unauthenticated_agent`); this one's whole job
    is to say it earlier, to somebody who can still act on it for free.
    """
    from wringer import worker_auth

    path = root / config.CONFIG_FILENAME
    if not path.is_file():
        return Check("worker auth", SKIP, f"no {config.CONFIG_FILENAME}",
                     scope=REPO)
    try:
        cfg = config.load(path)
    except config.ConfigError:
        # `_config` owns this file's problems and reports them once.
        return Check("worker auth", SKIP,
                     f"{config.CONFIG_FILENAME} is invalid", scope=REPO)
    if cfg.run is None:
        return Check("worker auth", SKIP, "no 'run:' section, so no worker",
                     scope=REPO)

    # **Before the auth question, because on this shape there is no agent to
    # ask.** Field report 2026-08-25, finding 5: a project named an ACP
    # adapter as a STRING worker, which is a shell command. Nothing ever spoke
    # ACP; the only symptom was a turn that changed nothing. Measured at HEAD,
    # this check said "the worker is not an ACP agent" — true, useless, and
    # silent about the fact that the command it names IS one. The names stay
    # in `agents.py`, per AGENTS.md rule 5, including in this sentence.
    from wringer import agents

    mistyped = agents.misconfigured_string_worker(cfg.run.worker)
    if mistyped is not None:
        typed, current = mistyped
        renamed = (
            "" if typed == current else
            f" That package was also renamed — the current binary is "
            f"`{current}`."
        )
        return Check(
            "worker auth", WARN,
            f"'run.worker' is the string {typed!r}, which Wringer runs as a "
            f"SHELL COMMAND — so nothing will speak ACP to it, and "
            f"'env_passthrough' cannot be written on that shape at all."
            f"{renamed}",
            "Write it as a mapping instead:\n"
            "    run:\n"
            "      worker:\n"
            "        acp:\n"
            f"          command: {current}\n"
            "  A string worker is a shell command and stays supported — this "
            "line is here because that command names an ACP agent",
            scope=REPO,
        )

    contained = cfg.run.containment
    found = worker_auth.read(cfg.run.worker, contained)
    if found.state == worker_auth.LOGGED_IN:
        how = f" ({found.method})" if found.method else ""
        return Check("worker auth", OK, f"{found.detail}{how}", scope=REPO)
    if found.state == worker_auth.LOGGED_OUT:
        # **The remedy comes from the engine, machine-aware.** This line used
        # to offer the key route unconditionally, which on an org-pinned Mac
        # sends the reader to the one configuration that breaks the run —
        # field report 2026-08-26, finding 1's second consequence. The drive's
        # stop learned that; for one commit this line had not, which is the
        # two-surfaces-one-fact disease with a very short fuse.
        return Check(
            "worker auth", WARN, found.detail,
            worker_auth.remedy(cfg.run.worker),
            scope=REPO,
        )
    return Check("worker auth", SKIP, found.detail, scope=REPO)


def _declared_execution(root: Path) -> object | None:
    """Whichever section demands a container runtime, or None.

    Two sections can: `execution:` for gates, and `run.containment` for the
    worker. Both carry a `runtime` attribute, which is all `_runtime` reads —
    and `execution:` is checked first only because it is the older key, not
    because it outranks anything. A repo declaring both names one runtime
    twice or has a config problem `_config` will report.

    Total by construction: an unreadable or invalid config is `_config`'s
    finding, not this one's, because two checks failing over the same broken
    file tells a reader nothing the first did not.
    """
    path = root / config.CONFIG_FILENAME
    if not path.is_file():
        return None
    try:
        cfg = config.load(path)
    except config.ConfigError:
        return None
    if cfg.execution is not None:
        return cfg.execution
    if cfg.run is not None and cfg.run.containment is not None:
        return cfg.run.containment
    return None


def _repo(root: Path) -> Check:
    inside = subprocess.run(
        ["git", "rev-parse", "--is-inside-work-tree"],
        cwd=root, capture_output=True, text=True,
    )
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        return Check(
            "git repository", FAIL, f"{root} is not a git repository",
            "cd into your repo, or run: git init",
        )
    return Check("git repository", OK, f"{root}")


def _config(root: Path) -> Check:
    path = root / config.CONFIG_FILENAME
    if not path.is_file():
        return Check(
            "gates", WARN, f"no {config.CONFIG_FILENAME} here yet",
            "Run: wring init",
        )
    try:
        cfg = config.load(path)
    except config.ConfigError as exc:
        return Check("gates", FAIL, f"{config.CONFIG_FILENAME} is invalid: {exc}",
                     f"Fix {config.CONFIG_FILENAME}")
    gates = ", ".join(gate.id for gate in cfg.gates)
    extras = [
        name for name, present in
        (("run", cfg.run), ("judge", cfg.judge), ("fleet", cfg.fleet))
        if present is not None
    ]
    detail = f"{len(cfg.gates)} gate(s): {gates}"
    if extras:
        detail += f"; also configured: {', '.join(extras)}"
    return Check("gates", OK, detail)


def _runnable_checks(root: Path) -> Check:
    """**Could Wringer prove anything at all in this repository?**

    The first question anybody actually has, and until 2026-08-19 nothing
    answered it. Surveyed across 37 real repositories that day: **30 of them
    declare no test or lint command anywhere**, so the chain stops before a
    model is ever called, with *"this project has no tests or checks that
    could prove the work was done, and inventing one would prove nothing"*.
    That is correct and it is very late to find out.

    Decided from the same detector `wring init` uses, so this cannot disagree
    with what `init` would do. It runs nothing and reads no test suite: the
    question here is whether commands EXIST to be run, which is the 90% case
    and is answerable in milliseconds. Whether they pass is `last verify`
    below, and whether one of them can FAIL is a question only a real run can
    answer.
    """
    from wringer import detect

    path = root / config.CONFIG_FILENAME
    if path.is_file():
        try:
            declared = config.load(path).gates
        except config.ConfigError:
            return Check("runnable checks", SKIP,
                         f"{config.CONFIG_FILENAME} unreadable — see `gates`",
                         scope=REPO)
        if not detect.is_untouched_template(declared):
            return Check(
                "runnable checks", OK,
                f"{len(declared)} declared and ready to run", scope=REPO,
            )

    found = detect.detect(root)
    candidates = getattr(found, "candidates", ()) or ()
    if candidates:
        where = ", ".join(found.sources) or "this project"
        return Check(
            "runnable checks", OK,
            f"{len(candidates)} could be detected from {where}",
            "Run: wring init", scope=REPO,
        )
    # **WARN and not FAIL, decided deliberately.**
    #
    # This is a real blocker for the product's whole purpose, so the instinct
    # is to block on it. Two things argue the other way and they win. First,
    # `doctor` is the command an agent runs while SETTING WRINGER UP, often in
    # a directory that was a bare `git init` moments earlier — and this module
    # already carries the scar from making a true statement into a false
    # problem that way (2026-08-04). Second, the loud version of this message
    # already exists at exactly the right moment: `wringer-drive` stops with
    # *"this project has no tests or checks that could prove the work was
    # done"* before it spends a penny. So somebody who ignores this line is
    # still stopped; they are simply told earlier, and told what to add.
    return Check(
        "runnable checks", WARN,
        "none — this repository declares no test or lint command, so nothing "
        "here could prove a change yet",
        "Add a test command your project can run (a `test` script in "
        "package.json, a pytest or ruff section in pyproject.toml, or a "
        "Makefile target), then run: wring init",
        scope=REPO,
    )


def _last_verify(root: Path) -> Check:
    """What the record says about the last time those checks ran.

    **It does not run them.** `wring doctor` is a fast diagnosis and a command
    that quietly spends four minutes on somebody's test suite is one they stop
    running. So this reports what is already on disk and says plainly when
    nothing is, rather than guessing or going quiet.
    """
    runs = root / evidence.RUNS_DIRNAME
    if not runs.is_dir():
        return Check(
            "last verify", WARN, "never run here, so nothing is known yet",
            "Run: wring verify", scope=REPO,
        )
    bundles = sorted(p for p in runs.iterdir() if p.is_dir())
    if not bundles:
        return Check(
            "last verify", WARN, "never run here, so nothing is known yet",
            "Run: wring verify", scope=REPO,
        )
    latest = bundles[-1]
    summary = latest / "run.json"
    if not summary.is_file():
        return Check("last verify", SKIP, f"{latest.name} has no summary to read",
                     scope=REPO)
    try:
        payload = json.loads(summary.read_text(encoding="utf-8"))
        result = payload.get("result") or {}
        status = str(result.get("status") or "unknown")
        failed = result.get("failed_gate")
    except (OSError, ValueError):
        return Check("last verify", SKIP, f"{latest.name} is unreadable",
                     scope=REPO)
    if status == "passed":
        return Check("last verify", OK, f"all gates passed ({latest.name})",
                     scope=REPO)
    detail = f"{status} ({latest.name})"
    if failed:
        detail += f" — `{failed}` failed"
    # WARN and not FAIL: a red suite is the normal middle of a piece of work,
    # and a diagnosis that exits non-zero because somebody is mid-change is a
    # diagnosis they will stop trusting.
    return Check("last verify", WARN, detail,
                 "Run: wring verify — a red suite blocks a handover, not a diagnosis",
                 scope=REPO)


# A suite slower than this is worth a worker pool; below it, the advice is
# noise. Not a config key: a threshold nobody can turn is a threshold nobody
# argues with, and this one only decides whether a SUGGESTION is printed.
SLOW_SUITE_MS = 60_000


def pytest_parallel_check(root: Path) -> Check:
    """Offer `-n auto` to a repo whose pytest gate is slow and serial.

    The biggest speedup available to most users is one line in their OWN
    config: this repository's suite went 240s to 59s on six workers with
    identical results, because pytest was running on one core. Wringer runs
    the command a repo declares, so the fix belongs there and not in here —
    and nothing was telling anybody.

    Read from the RECORD rather than guessed: the newest bundle's own
    `duration_ms` for that gate. No bundle, no claim (absence is absence),
    and a gate already carrying `-n` gets silence, because advice repeated to
    someone who took it is how a tool teaches people to stop reading it.

    It PROPOSES and stops. `.wringer.yaml` is the one file that puts commands
    into Wringer's mouth; editing it on a user's behalf is exactly what
    `spec.gate_diff` refuses to do.
    """
    name = "pytest parallelism"
    path = root / config.CONFIG_FILENAME
    if not path.is_file():
        return Check(name, SKIP, "no config to read", scope=REPO)
    try:
        cfg = config.load(path)
    except config.ConfigError:
        # The `gates` check already reports an invalid config; saying it
        # twice would be this check claiming a problem it did not find.
        return Check(name, SKIP, "config unreadable", scope=REPO)

    serial = [
        gate for gate in cfg.gates
        if "pytest" in gate.run and not _already_parallel(gate.run)
    ]
    if not serial:
        return Check(name, SKIP, "no serial pytest gate declared", scope=REPO)

    slowest, ms = _slowest_recorded(root, serial)
    if slowest is None:
        return Check(
            name, SKIP,
            "no recorded duration for a pytest gate yet — run wring verify",
            scope=REPO,
        )
    if ms < SLOW_SUITE_MS:
        return Check(
            name, SKIP, f"`{slowest.id}` last took {ms / 1000:.0f}s — fast "
            "enough that workers would not pay for themselves", scope=REPO,
        )

    xdist = "pytest-xdist is installed" if _has_xdist() else (
        "pytest-xdist is NOT installed here — pip install pytest-xdist first"
    )
    return Check(
        name, WARN,
        f"`{slowest.id}` last took {ms / 1000:.0f}s on one core; {xdist}",
        f"In {config.CONFIG_FILENAME}, change the `{slowest.id}` gate to:\n"
        f"    run: \"{_parallel_form(slowest.run)}\"\n"
        "  Same gates, same evidence, one core per worker. Wringer runs what "
        "you declare — it will not edit this for you.",
        scope=REPO,
    )


def _already_parallel(command: str) -> bool:
    """Whether a pytest command already asks for workers.

    Matches the flag rather than the string: `-n`, `--numprocesses`, and the
    `-p xdist` plugin spelling all count, and a path that merely contains the
    letter n does not.
    """
    parts = command.split()
    return any(
        part == "-n" or part.startswith("-n=") or part.startswith("--numprocesses")
        or part.startswith("-n") and part[2:].isdigit()
        or part in ("auto",) and "-n" in parts
        for part in parts
    )


def _parallel_form(command: str) -> str:
    return f"{command} -n auto"


def _has_xdist() -> bool:
    import importlib.util

    return importlib.util.find_spec("xdist") is not None


def _slowest_recorded(root: Path, gates: list) -> tuple[object | None, int]:
    """The slowest recorded duration among these gates, from the newest
    bundle that holds one. Reads the evidence; invents nothing."""
    import json

    runs = root / evidence.RUNS_DIRNAME
    if not runs.is_dir():
        return None, 0
    ids = {gate.id: gate for gate in gates}
    best_gate, best_ms = None, 0
    for run in sorted(runs.iterdir(), reverse=True):
        gates_dir = run / "gates"
        if not gates_dir.is_dir():
            continue
        for entry in sorted(gates_dir.iterdir()):
            try:
                raw = json.loads((entry / "result.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            gate = ids.get(raw.get("gate_id"))
            if gate is None:
                continue
            ms = int(raw.get("duration_ms") or 0)
            if ms > best_ms:
                best_gate, best_ms = gate, ms
        if best_gate is not None:
            # The NEWEST bundle that mentions one of these gates decides:
            # older runs describe a suite that may no longer exist.
            break
    return best_gate, best_ms


def _workspace(root: Path) -> Check:
    """Wringer writes evidence. A read-only mount is a common container
    mistake and produces a confusing failure much later."""
    probe = root / evidence.RUNS_DIRNAME.parts[0]
    try:
        probe.mkdir(parents=True, exist_ok=True)
        token = probe / ".doctor-write-probe"
        token.write_text("ok", encoding="utf-8")
        token.unlink()
    except OSError as exc:
        return Check(
            "workspace writable", FAIL, f"cannot write to {probe}: {exc}",
            "Mount the workspace read-write (a container -v mount defaults "
            "to read-write; check for :ro)",
        )
    return Check("workspace writable", OK, f"{probe} is writable")


# The names to look for when the repository has not declared one — or when
# there is no repository to ask. Used ONLY as a fallback: a config that names
# its own variable is the authority on what this machine needs.
#
# **Alphabetical, and derived-guarded against `docs/vendors.md`.** This tuple
# was two names long and vendor-locked while the vendor page told people about
# five vendors, so somebody who followed the page and stored a Kimi key got
# "no LLM API key set" with their key correctly set — doctor had looked for
# two names, said which, and neither was theirs.
# `test_vendors.py::test_DOCTOR_LOOKS_FOR_THE_KEY_NAMES_THIS_PAGE_TELLS_PEOPLE_TO_USE`
# reads the page and fails if a variable it teaches is missing here. The page
# is the source; this list may never fall behind it.
#
# `WRINGER_API_KEY` is here because it is the BRAIN lane's convention and is
# vendor-free: it is the name `wringer-drive` writes into every generated
# config, whichever endpoint the person chose.
WELL_KNOWN_KEY_ENVS = (
    "ANTHROPIC_API_KEY",
    "CODEX_API_KEY",
    "KIMI_API_KEY",
    "OPENAI_API_KEY",
    "WRINGER_API_KEY",
)


def _declared_key_names(root: Path) -> tuple[str, ...]:
    """The variable names this repository says hold an LLM credential.

    Narrower than `config.declared_secret_names`, deliberately: that one
    answers "what must the redactor erase" and includes `forge.token_env`,
    which is a forge token and not an LLM key. Reporting a set `FORGE_TOKEN`
    as "llm key: ok" would be a check that lies to pass.

    Best-effort: an unreadable or invalid config is `_config`'s problem to
    report, and this check must not fail twice for it.
    """
    try:
        cfg = config.load(root / config.CONFIG_FILENAME)
    except (config.ConfigError, OSError):
        return ()
    names: list[str] = []
    if cfg.judge is not None and cfg.judge.api_key_env:
        names.append(cfg.judge.api_key_env)
    if cfg.run is not None and isinstance(cfg.run.worker, config.AcpWorker):
        names.extend(cfg.run.worker.env_passthrough)
    return tuple(dict.fromkeys(names))


def _api_key(root: Path) -> Check:
    """Only relevant once a judge or an agent is configured, so its absence is
    never fatal. Values are never printed — the name is the answer.

    It reads the names the CONFIG declares first. Hardcoding the two
    well-known ones meant a repo whose agent wants a differently-named
    variable got "no LLM API key" with the key correctly set, and no
    indication of which name doctor had actually looked for. `wring start`
    writes exactly such a name.
    """
    declared = _declared_key_names(root)
    looked_for = declared or WELL_KNOWN_KEY_ENVS
    named = [name for name in looked_for if os.environ.get(name)]
    if named:
        return Check("llm key", OK, f"set: {', '.join(named)} (value not shown)")
    return Check(
        "llm key", WARN,
        f"no LLM API key set — looked for {', '.join(looked_for)}",
        "Only needed for `wring judge --send` and for an agent driving "
        "`wring run`"
        + ("" if declared else "; this repo declares no name, so those are "
                               "the well-known ones")
        + ". Provide it when you launch, and never paste it to an agent",
    )


MARKS = {OK: "✓", WARN: "!", FAIL: "✗", SKIP: "-"}


def report(checks: list[Check]) -> str:
    mark = MARKS
    lines = []
    for check in checks:
        label = f"{mark[check.status]} {check.name}"
        lines.append(f"{label:<24}{check.detail}")
        if check.fix and check.status != OK:
            lines.append(f"{'':<24}→ {check.fix}")
    failed = [c for c in checks if c.status == FAIL]
    warned = [c for c in checks if c.status == WARN]
    skipped = [c for c in checks if c.status == SKIP]
    lines.append("")
    # **WARNED outranks SKIPPED, and the repo sentence is about SCOPE.**
    #
    # Reproduced in this repository: `wring doctor` printed "This machine is
    # ready" over FOUR `!` lines, one of them "you are running a mixture …
    # the version above is NOT the version you installed" — because `elif
    # skipped:` came first and, inside a repository, `pytest parallelism` and
    # `worker auth` skip routinely. The warned branch was unreachable whenever
    # anything skipped at all. The same wrong sentence is published verbatim
    # in this repo's own field report of 2026-08-27.
    #
    # And it told a reader standing in a repository to "run `wring doctor`
    # from your repo", two lines under `✓ git repository <that repo>`. That
    # clause is about the checks NOT RUN here, so it belongs to the scope
    # question, not to the presence of any skip.
    here = any(
        check.name == "git repository" and check.status == OK
        for check in checks
    )
    if failed:
        lines.append(
            f"{len(failed)} blocking problem"
            f"{'' if len(failed) == 1 else 's'} — fix the ✗ lines above."
        )
        return "\n".join(lines)

    # **Every clause that applies, and no clause swallowing another.** The
    # precedence was the bug: whichever branch matched first spoke, and the
    # skip branch matched first. Saying both is the answer to a precedence
    # question nobody should have to get right.
    outside = bool(skipped) and not here
    said = ["This machine is ready." if outside else "Ready."]
    if warned:
        said.append("The ! lines are optional extras, not problems.")
    if outside:
        said.append(
            "The - lines describe a repository and were not checked here — "
            "run `wring doctor` from your repo for those."
        )
    elif skipped:
        said.append(
            "The - lines are checks this repository gave nothing to check."
        )
    lines.append(" ".join(said))
    return "\n".join(lines)


def as_json(checks: list[Check]) -> str:
    return json.dumps(
        {
            "wringer_version": __version__,
            "ok": all(check.passed for check in checks),
            "checks": [
                {
                    "name": c.name,
                    "status": c.status,
                    "detail": c.detail,
                    # Machine-readable, so a caller can DERIVE how many
                    # checks are about the repository instead of remembering
                    # a number. `setup-selftest.sh` hard-coded three, and a
                    # fourth repo-scoped check reddened CI on both platforms
                    # — the hand-kept-count failure this repo keeps finding.
                    "scope": c.scope,
                    **({"fix": c.fix} if c.fix else {}),
                }
                for c in checks
            ],
        }
    )
