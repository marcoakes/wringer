"""Run a gate's command: timed, timeout-enforced, streams captured.

Every command gets stdout, stderr, an exit code, a duration and a timeout
status (SPEC_VERIFY_V0.md §Config design, rule 4). The streams go to
files, not the console: the bundle is the product, and `wring verify` exists
to replace scrollback rather than reproduce it.
"""

from __future__ import annotations

import os
import signal
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from wringer import artifacts as artifacts_module
from wringer.config import Gate
from wringer.redact import Redactor

# How long a gate that overran its timeout gets between SIGTERM and SIGKILL.
KILL_GRACE_SECONDS = 2

# How long to keep reading a killed gate's streams before giving up on them.
# The gate is dead by this point, but anything it spawned and left running
# still holds the inherited pipe open, and a verifier that waits for that is
# a verifier that never returns.
DRAIN_TIMEOUT_SECONDS = 5

# The most any single captured stream may contribute to a bundle. A runaway
# gate should not fill the disk, and nobody reads the middle of a 4 GB log.
# The tail is kept, because that is where a failure announces itself.
MAX_LOG_BYTES = 1_048_576

# v0.1 targets macOS and Linux (see pyproject's classifiers). Process groups
# are the mechanism that makes a timeout stick, and they are POSIX-only.
_POSIX = os.name == "posix"

# What wait() reports for a process killed by SIGKILL on POSIX.
_KILLED = -9

# What a POSIX shell reports when it cannot find the command at all, and what
# Wringer records when a command could not be STARTED — so the two backends
# fail identically whether the shell reported it or Popen raised. `health.py`
# names the same number for the same reason: nothing ran, so nothing
# discriminated.
COMMAND_NOT_FOUND = 127


def cite(result: GateResult) -> str:
    """One line saying why a gate failed, for a row whose meaning rests on it.

    **The single evidence-line extractor in this codebase.** It lived in
    `vacuity.py` as `_cite` until 2026-08-17, when SPEC_ENV's F6 amendment
    needed the same line for an environment diagnosis; it moved here rather
    than being copied, because two extractors answering "why did this gate
    fail" is how two subtly different answers to one question ship. `vacuity`
    re-exports it under its old private name, so nothing there reads
    differently. It lives in `gates` because `gates` owns `GateResult` and
    imports nothing that could import it back.

    The **last** informative line of stderr, then of stdout. Measured against
    the shapes that actually turn up rather than reasoned about:

        ModuleNotFoundError: No module named 'yourproject'   <- last of stderr
        cat: vendor/lib.py: No such file or directory        <- the only line
        FAILED (failures=1)                                  <- last of stderr
        sh: yourtool: command not found                      <- the only line

    Taking the FIRST line instead gets `Traceback (most recent call last):`
    from a Python failure and a row of `=` from unittest — both true and
    neither any use, which was the first version of this function. SPEC_ENV's
    ruling 3 as drafted said "the first matching stderr line"; hoisting this
    function is what supersedes that, and the measured convention wins over
    the drafted one on purpose.

    "Informative" excludes separator rules: a line of one punctuation
    character repeated is the thing a test runner prints AROUND the message.

    Deliberately NOT classified into "environment" or "regression". Making
    the failure visible is the product; guessing at its meaning would be the
    cleverness this spec exists to refuse. **The classification that F6 does
    add lives in `diagnose.py` and never touches this line** — this returns
    what the gate said, and nothing about what it means.
    """
    if result.timed_out:
        return f"timed out after {result.gate.timeout}s"
    for path in (result.stderr_path, result.stdout_path):
        lines = informative_lines(path)
        if lines:
            return lines[-1]
    return f"exit {result.exit_code}, and it printed nothing"


def informative_lines(path: Path) -> list[str]:
    """Non-blank, non-separator lines. See `cite`."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    kept = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if len(set(line)) == 1 and not line[0].isalnum():
            continue  # ==========, ----------, ..........
        kept.append(line)
    return kept


@dataclass(frozen=True)
class GateResult:
    gate: Gate
    exit_code: int
    duration_ms: int
    timed_out: bool
    stdout_path: Path
    stderr_path: Path
    stdout_truncated: bool = False
    stderr_truncated: bool = False

    @property
    def truncated(self) -> bool:
        return self.stdout_truncated or self.stderr_truncated

    @property
    def passed(self) -> bool:
        return self.exit_code == 0 and not self.timed_out

    @property
    def status(self) -> str:
        return "passed" if self.passed else "failed"


def run(
    gate: Gate,
    cwd: Path,
    stdout_path: Path,
    stderr_path: Path,
    redactor: Redactor | None = None,
    on_spawn: Callable[[int], None] | None = None,
    backend: Any = None,
) -> GateResult:
    """Run `gate.run` in `cwd` through the given backend, capturing its streams.

    `backend` decides WHAT gets spawned; everything else here is the same
    whichever backend it is — the timing, the process group, the timeout
    ladder, the bounded drain, and scrub-then-cap log writing. `None` is
    `backend.Local`, which is `shell=True` with the command string and is what
    every caller did before backends existed.

    `shell=True` for the local backend is deliberate: gate commands are
    project-authored shell strings (`make lint`, `pytest -q && ruff check .`),
    not argv vectors. Wringer runs what the repo's own `.wringer.yaml`
    declares — no more privilege than the developer typing it.

    The gate gets its own process group (`start_new_session`) so that a
    timeout kills the shell *and* everything it spawned. Killing only the
    shell would leave the real work running against the repo. A container
    backend needs one more step, because the process group reaches the runtime
    CLIENT and not the container it asked for: `backend.cleanup` is called
    after the kill, and without it a "killed" gate carries on working against
    the mounted tree.

    Output travels through a pipe rather than straight to the log file so
    that secrets can be removed *before* anything is written — the spec's
    rule 5. The cost is that a gate's output is held in memory until it
    exits; a gate that emits gigabytes would be a problem, and streaming
    redaction is the v0.2 answer if one ever appears.
    """
    from wringer import backend as backend_module

    redactor = redactor or Redactor()
    engine = backend if backend is not None else backend_module.Local()
    # The gate's own log directory. The container backend puts its cidfile
    # here, so a timeout can kill what it started; it is unique per attempt by
    # construction, which is what removes any need for a naming scheme.
    workdir = stdout_path.parent
    spawn = engine.spawn(gate, cwd, workdir)
    # **S4.** A directory only for a gate that OPTED IN, and an environment
    # variable only when there is one — so a gate that never declared
    # `artifacts:` runs in a byte-identical environment to before this feature
    # existed. The `WRINGER_TASK_ID` precedent: the harness makes the place and
    # tells the gate where it is, rather than the gate guessing a path or the
    # harness scraping the tree afterwards.
    artifacts_dir = artifacts_module.prepare(workdir, gate)
    env = artifacts_module.environment(artifacts_dir) if artifacts_dir else None
    started = time.monotonic()
    try:
        proc = subprocess.Popen(
            spawn.args,
            shell=spawn.shell,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=_POSIX,
            env=env,
        )
    except OSError as exc:
        # **The two backends must fail the same way, and without this they do
        # not.** `shell=True` hands a missing command to a shell, which reports
        # exit 127 and Popen raises nothing; `shell=False` with an argv raises
        # FileNotFoundError straight out of the verifier, so a runtime that
        # vanished between preflight and this gate would abandon a half-written
        # bundle with a traceback instead of a verdict.
        #
        # 127 is not an arbitrary choice: it is what the shell already reports,
        # and `health.genuine_failure` singles it out as "nothing ran, so
        # nothing discriminated" — the exact truth here. A gate that never
        # started must not read as evidence that the gate can fail.
        return _unstartable(gate, spawn, exc, stdout_path, stderr_path, redactor)
    # start_new_session makes the child a group leader, so its pgid IS its
    # pid. Reported the moment it exists, because a caller that wants to reap
    # an orphan after a SIGKILL needs this on disk *before* the work runs.
    if on_spawn is not None:
        on_spawn(proc.pid)
    timed_out = False
    try:
        out, err = proc.communicate(timeout=gate.timeout)
        exit_code = proc.returncode
    except subprocess.TimeoutExpired:
        timed_out = True
        exit_code = _terminate(proc)
        # AFTER the process-group kill and BEFORE the drain: killing the
        # runtime client closes nothing the container holds, so a container
        # still up here would keep the inherited pipe open and the drain would
        # wait out its whole 5 seconds for work that is still running.
        engine.cleanup(workdir)
        # Drain whatever the gate managed to say before it was stopped —
        # the last lines before a hang are usually the interesting ones.
        out, err = _drain(proc)
    except KeyboardInterrupt:
        # The gate runs in its own process group, so Ctrl-C reached wring and
        # not the gate: stopping it is our job, or it outlives the verifier.
        _terminate(proc)
        engine.cleanup(workdir)
        out, err = _drain(proc)
        _write_logs(stdout_path, stderr_path, out, err, redactor)
        raise

    out_cut, err_cut = _write_logs(stdout_path, stderr_path, out, err, redactor)

    # AFTER the gate has exited and its logs are written. Nothing here can
    # change the gate's verdict: `collect` returns a path or None and raises
    # nothing the caller sees, and the exit code above is already decided.
    if artifacts_dir is not None:
        artifacts_module.collect(workdir, gate, redactor)

    return GateResult(
        gate=gate,
        exit_code=exit_code,
        duration_ms=int((time.monotonic() - started) * 1000),
        timed_out=timed_out,
        stdout_path=stdout_path,
        stderr_path=stderr_path,
        stdout_truncated=out_cut,
        stderr_truncated=err_cut,
    )


def _unstartable(
    gate: Gate,
    spawn: Any,
    exc: OSError,
    stdout_path: Path,
    stderr_path: Path,
    redactor: Redactor,
) -> GateResult:
    """A gate whose command could not be started at all.

    The reason goes in `stderr.log` rather than only into an exception, because
    a bundle is what outlives the terminal: "exit 127" with an empty log is a
    reader's dead end, and the one thing they need is which program was not
    found.
    """
    program = spawn.args if isinstance(spawn.args, str) else spawn.args[0]
    note = (
        f"[wringer: the gate could not be started — {exc}. "
        f"Program: {program}. Nothing ran, so this run discriminated nothing "
        f"about the tree.]\n"
    )
    _write_logs(stdout_path, stderr_path, b"", note.encode(), redactor)
    return GateResult(
        gate=gate,
        exit_code=COMMAND_NOT_FOUND,
        duration_ms=0,
        timed_out=False,
        stdout_path=stdout_path,
        stderr_path=stderr_path,
    )


def _drain(proc: subprocess.Popen) -> tuple[bytes, bytes]:
    """Collect what a killed gate printed, without waiting forever for it.

    `communicate()` returns when the pipes close, not when the process dies.
    A gate that spawned something which outlived the kill — a daemon, a
    `setsid` child, anything holding the inherited stdout — keeps those pipes
    open, and an unbounded wait here turns a 2-second gate timeout into a
    wait for someone else's lifetime. `wring verify` must always return; the
    v0.2 loop depends on it more than a human does.

    The partial output comes off the exception, so nothing already read is
    lost. The reader machinery left behind belongs to a daemon thread that
    dies with the interpreter — closing the pipes under it would print
    thread tracebacks onto the console this tool works to keep clean, so it
    is deliberately left alone.
    """
    try:
        return proc.communicate(timeout=DRAIN_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as exc:
        note = (
            f"\n[wringer: stopped waiting for output after "
            f"{DRAIN_TIMEOUT_SECONDS}s — a process this gate left running "
            f"still held the stream open]\n"
        ).encode()
        return exc.stdout or b"", (exc.stderr or b"") + note


def _write_logs(
    stdout_path: Path,
    stderr_path: Path,
    out: bytes,
    err: bytes,
    redactor: Redactor,
) -> tuple[bool, bool]:
    """Scrub, bound, write. In that order: truncation must never be what
    saves a secret, and the limit applies to the redacted text."""
    out_data, out_cut = truncate(redactor.scrub_bytes(out), MAX_LOG_BYTES)
    err_data, err_cut = truncate(redactor.scrub_bytes(err), MAX_LOG_BYTES)
    stdout_path.write_bytes(out_data)
    stderr_path.write_bytes(err_data)
    return out_cut, err_cut


def truncate(data: bytes, limit: int) -> tuple[bytes, bool]:
    """Keep the last `limit` bytes, announcing what was dropped.

    The note goes in the file itself: a reader must never mistake a bounded
    log for a complete one, and a bundle that quietly loses evidence is
    worse than one that admits it.
    """
    if len(data) <= limit:
        return data, False
    dropped = len(data) - limit
    note = f"[wringer: {dropped} earlier bytes dropped, keeping the last {limit}]\n"
    return note.encode() + data[-limit:], True


def _terminate(proc: subprocess.Popen) -> int:
    """Ask the gate to stop, then make it stop.

    Returns the wait status — negative when a signal ended the process,
    which is the honest thing to record next to `timed_out: true`.
    """
    for hard in (False, True):
        try:
            _stop(proc, hard=hard)
        except (ProcessLookupError, PermissionError):
            pass  # already gone, but still needs reaping
        try:
            return proc.wait(timeout=KILL_GRACE_SECONDS)
        except subprocess.TimeoutExpired:
            continue
    # Unreapable even after a hard kill: report it rather than hang the
    # verifier waiting on a process the OS will not surrender.
    return proc.returncode if proc.returncode is not None else _KILLED


def _stop(proc: subprocess.Popen, hard: bool) -> None:
    """Signal the gate — its whole process group where the OS has them.

    Off POSIX there is no group to signal, so a gate that spawned children
    can leave them behind after a timeout. That is a v0.2 problem, and a
    declared one: v0.1 supports macOS and Linux.
    """
    if not _POSIX:
        if hard:
            proc.kill()
        else:
            proc.terminate()
        return
    os.killpg(
        os.getpgid(proc.pid), signal.SIGKILL if hard else signal.SIGTERM
    )
