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

from wringer import __version__, config, evidence

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
    machine = [_python(), _wring(), _git(), _runtime(declared), _api_key(root)]
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
        "llm key",
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
    located = {name: shutil.which(name) for name in WRINGER_EXECUTABLES}
    absent = [name for name, path in located.items() if path is None]
    if len(absent) == len(WRINGER_EXECUTABLES):
        # Reachable when someone runs `python -m wringer doctor` from a
        # source tree without installing — worth flagging, not fatal.
        return Check(
            "wring", WARN, f"wringer {__version__} is importable but none of "
            f"{', '.join(WRINGER_EXECUTABLES)} is on PATH",
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
            "mixture of installs:\n  " + "\n  ".join(lines),
            "Uninstall every wringer distribution and install once: "
            "`uv tool uninstall wringer wringer-board wringer-drive` then "
            "`uv tool install wringer`",
        )
    if absent:
        return Check(
            "wring", WARN,
            f"wringer {__version__} — {', '.join(absent)} "
            f"{'is' if len(absent) == 1 else 'are'} missing from an otherwise "
            "complete install:\n  " + "\n  ".join(lines),
            "Reinstall so the whole distribution is present: "
            "`uv tool install --force wringer`",
        )
    return Check(
        "wring", OK,
        f"wring {__version__}, and all four commands resolve into "
        f"{homes.pop()}",
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

    contained = cfg.run.containment
    found = worker_auth.read(cfg.run.worker, contained)
    if found.state == worker_auth.LOGGED_IN:
        how = f" ({found.method})" if found.method else ""
        return Check("worker auth", OK, f"{found.detail}{how}", scope=REPO)
    if found.state == worker_auth.LOGGED_OUT:
        return Check(
            "worker auth", WARN, found.detail,
            "Log the agent in, or declare its key under "
            "'run.worker.acp.env_passthrough' — 'wring run' will refuse until "
            "one of those is true. Neither proves the credential still works",
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
WELL_KNOWN_KEY_ENVS = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY")


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
    if failed:
        lines.append(
            f"{len(failed)} blocking problem"
            f"{'' if len(failed) == 1 else 's'} — fix the ✗ lines above."
        )
    elif skipped:
        lines.append(
            "This machine is ready. The - lines describe a repository and "
            "were not checked here — run `wring doctor` from your repo for "
            "those."
        )
    elif warned:
        lines.append("Ready. The ! lines are optional extras, not problems.")
    else:
        lines.append("Ready.")
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
